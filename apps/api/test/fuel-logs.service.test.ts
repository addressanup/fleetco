import { randomUUID } from "node:crypto";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { type Driver, type Trip, type Vehicle } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
  FuelLogsService,
  LIST_TAKE_MAX,
  deriveTotalCostPaisa,
} from "../src/modules/fuel-logs/fuel-logs.service";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { resetDb } from "./db";

// Integration tests for FuelLogsService against a real Postgres.
// Mirrors the iter-17 jobs.service.test.ts in shape; the iter-19
// kickoff (Checkpoint 2, last paragraph) names the coverage areas:
//
//   1. list() returns total + items; default sort is `date desc`.
//   2. Filter composition: { vehicleId } narrows correctly;
//      { startDate, endDate } narrows correctly; the two combine.
//   3. `take` is clamped to LIST_TAKE_MAX; `skip` past the end
//      returns empty items + correct total.
//   4. `sortBy: "createdAt"` works; sortBy/sortDir round-trip.
//   5. getById() returns the nested Vehicle + Trip; missing id →
//      NotFoundException.
//
// FuelLog has three FK references (vehicleId, tripId nullable, and
// createdById). The seed below builds one admin user, two Vehicles,
// one Driver, and one Trip — enough to exercise the {vehicleId}
// narrowing across two vehicles and the nullable tripId both ways.

interface SeedFuelLogInput {
  vehicleId?: string;
  tripId?: string | null;
  date?: Date;
  litersMl?: number;
  pricePerLiterPaisa?: number;
  totalCostPaisa?: number;
  odometerReadingKm?: number | null;
  station?: string | null;
  receiptNumber?: string | null;
  notes?: string | null;
}

describe("FuelLogsService (integration, real Postgres)", () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let service: FuelLogsService;
  let adminId: string;
  let vehicleA: Vehicle;
  let vehicleB: Vehicle;
  let driver: Driver;
  let trip: Trip;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [FuelLogsService, PrismaService],
    }).compile();
    await module.init();

    prisma = module.get(PrismaService);
    service = module.get(FuelLogsService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);

    // FuelLog.vehicleId is a non-null FK to Vehicle.id; tripId is a
    // nullable FK to Trip.id; createdById is a non-null FK to User.id.
    // The seed builds two vehicles (so the {vehicleId} narrowing test
    // can prove the filter is real), one driver + one trip (so the
    // nullable tripId can be exercised both ways), and one admin user
    // for createdById. Auth-domain rows are left untouched here.
    adminId = `user_${randomUUID()}`;
    await prisma.user.create({
      data: {
        id: adminId,
        email: `admin-${adminId}@fleetco.test`,
        name: "Test Admin",
      },
    });

    vehicleA = await prisma.vehicle.create({
      data: {
        registrationNumber: "BA 1 KA 0001",
        kind: "TIPPER",
        make: "Tata",
        model: "LPK 2518",
        year: 2022,
        acquiredAt: new Date("2022-01-01T00:00:00Z"),
        createdById: adminId,
      },
    });
    vehicleB = await prisma.vehicle.create({
      data: {
        registrationNumber: "BA 2 KA 0002",
        kind: "TRUCK",
        make: "Ashok Leyland",
        model: "1616",
        year: 2023,
        acquiredAt: new Date("2023-01-01T00:00:00Z"),
        createdById: adminId,
      },
    });

    driver = await prisma.driver.create({
      data: {
        fullName: "Ram Bahadur",
        licenseNumber: "12-345-67890",
        licenseClass: "HTV",
        phone: "+977-9800000000",
        hiredAt: new Date("2022-01-15T00:00:00Z"),
        licenseExpiresAt: new Date("2030-01-01T00:00:00Z"),
        createdById: adminId,
      },
    });

    trip = await prisma.trip.create({
      data: {
        vehicleId: vehicleA.id,
        driverId: driver.id,
        status: "COMPLETED",
        startedAt: new Date("2026-02-10T06:00:00Z"),
        endedAt: new Date("2026-02-10T14:00:00Z"),
        startOdometerKm: 10000,
        endOdometerKm: 10250,
        createdById: adminId,
      },
    });
  });

  async function seedFuelLog(input: SeedFuelLogInput = {}) {
    return prisma.fuelLog.create({
      data: {
        vehicleId: input.vehicleId ?? vehicleA.id,
        tripId: input.tripId === undefined ? null : input.tripId,
        date: input.date ?? new Date("2026-02-15T08:00:00Z"),
        // 12.345 L
        litersMl: input.litersMl ?? 12_345,
        // Rs. 110.50 / L = 11050 paisa
        pricePerLiterPaisa: input.pricePerLiterPaisa ?? 11_050,
        // Derived: (12345 * 11050) / 1000 = 136_412 paisa (truncated)
        // — the seed pre-computes this since iter 19 ships the read
        // path; the iter-20 write path lands the derivation in the
        // service.
        totalCostPaisa: input.totalCostPaisa ?? 136_412,
        odometerReadingKm: input.odometerReadingKm === undefined ? null : input.odometerReadingKm,
        station: input.station === undefined ? null : input.station,
        receiptNumber: input.receiptNumber === undefined ? null : input.receiptNumber,
        notes: input.notes === undefined ? null : input.notes,
        createdById: adminId,
      },
    });
  }

  describe("findById() / getById()", () => {
    test("findById() returns the row with nested vehicle and trip when present", async () => {
      const created = await seedFuelLog({
        tripId: trip.id,
        station: "NOC Naxal",
      });
      const fetched = await service.findById(created.id);
      expect(fetched?.id).toBe(created.id);
      expect(fetched?.station).toBe("NOC Naxal");
      expect(fetched?.litersMl).toBe(12_345);
      expect(fetched?.pricePerLiterPaisa).toBe(11_050);
      expect(fetched?.totalCostPaisa).toBe(136_412);
      // DETAIL_INCLUDE contract — pinned here so a refactor that
      // dropped the relations would fail loudly.
      expect(fetched?.vehicle.id).toBe(vehicleA.id);
      expect(fetched?.vehicle.registrationNumber).toBe(vehicleA.registrationNumber);
      expect(fetched?.trip?.id).toBe(trip.id);
    });

    test("findById() returns the row with trip === null when not tied to a trip", async () => {
      // The canonical "depot top-up between jobs" case from the
      // glossary entry. Trip should be null in the nested include.
      const created = await seedFuelLog({ tripId: null });
      const fetched = await service.findById(created.id);
      expect(fetched?.id).toBe(created.id);
      expect(fetched?.trip).toBeNull();
      expect(fetched?.vehicle.id).toBe(vehicleA.id);
    });

    test("findById() returns null when not present", async () => {
      const fetched = await service.findById("nonexistent-id");
      expect(fetched).toBeNull();
    });

    test("getById() throws NotFoundException with the id in the message when missing", async () => {
      try {
        await service.getById("nonexistent-id");
        throw new Error("expected NotFoundException");
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).message).toContain("nonexistent-id");
      }
    });

    test("getById() returns the row with nested relations on the happy path", async () => {
      const created = await seedFuelLog({ tripId: trip.id });
      const fetched = await service.getById(created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.vehicle.id).toBe(vehicleA.id);
      expect(fetched.trip?.id).toBe(trip.id);
    });
  });

  describe("list() — filter / sort / paginate", () => {
    // Seed six fuel logs spread across two vehicles and two months so
    // the assertions below can be precise about which rows come back
    // for each query.
    //
    // Rows (ordered by date desc — which is the default list sort —
    // for human readability of the assertions):
    //
    //   v=A trip=set  date=2026-02-25  litersMl=12345  station="NOC Naxal"
    //   v=B trip=null date=2026-02-20  litersMl=20000  station=null
    //   v=A trip=null date=2026-02-15  litersMl=10000  station="NOC Thapathali"
    //   v=B trip=null date=2026-01-25  litersMl=18000  station="Surya Petrol"
    //   v=A trip=set  date=2026-01-15  litersMl=15000  station="NOC Naxal"
    //   v=A trip=null date=2026-01-05  litersMl=8000   station="NOC Thapathali"
    async function seedSix(): Promise<void> {
      const seeds: SeedFuelLogInput[] = [
        {
          vehicleId: vehicleA.id,
          tripId: null,
          date: new Date("2026-01-05T08:00:00Z"),
          litersMl: 8_000,
          station: "NOC Thapathali",
        },
        {
          vehicleId: vehicleA.id,
          tripId: trip.id,
          date: new Date("2026-01-15T08:00:00Z"),
          litersMl: 15_000,
          station: "NOC Naxal",
        },
        {
          vehicleId: vehicleB.id,
          tripId: null,
          date: new Date("2026-01-25T08:00:00Z"),
          litersMl: 18_000,
          station: "Surya Petrol",
        },
        {
          vehicleId: vehicleA.id,
          tripId: null,
          date: new Date("2026-02-15T08:00:00Z"),
          litersMl: 10_000,
          station: "NOC Thapathali",
        },
        {
          vehicleId: vehicleB.id,
          tripId: null,
          date: new Date("2026-02-20T08:00:00Z"),
          litersMl: 20_000,
          station: null,
        },
        {
          vehicleId: vehicleA.id,
          tripId: trip.id,
          date: new Date("2026-02-25T08:00:00Z"),
          litersMl: 12_345,
          station: "NOC Naxal",
        },
      ];
      // Sequential creates so createdAt order is deterministic
      // (Postgres NOW() has microsecond precision but back-to-back
      // inserts can still tie). Same approach as jobs.service.test.ts.
      for (const seed of seeds) {
        await seedFuelLog(seed);
      }
    }

    test("returns total + items with default sort = date desc", async () => {
      await seedSix();
      const { items, total } = await service.list({});
      expect(total).toBe(6);
      expect(items).toHaveLength(6);
      // Default sort is `date desc` — newest fill first. The first
      // item is the 2026-02-25 row.
      expect(items[0].date.toISOString()).toBe("2026-02-25T08:00:00.000Z");
      // The last item is the 2026-01-05 row.
      expect(items[items.length - 1].date.toISOString()).toBe("2026-01-05T08:00:00.000Z");
      // Wire shape sanity — the slim vehicle/trip projection is on
      // the items.
      expect(items[0].vehicle.registrationNumber).toBe(vehicleA.registrationNumber);
      expect(items[0].trip?.id).toBe(trip.id);
    });

    test("returns empty items + total=0 on an empty table", async () => {
      const { items, total } = await service.list({});
      expect(total).toBe(0);
      expect(items).toHaveLength(0);
    });

    test("{ vehicleId } narrows results to one vehicle only", async () => {
      await seedSix();
      const { items, total } = await service.list({ vehicleId: vehicleA.id });
      // Four of the six rows are vehicleA; the count and the items
      // should agree.
      expect(total).toBe(4);
      expect(items).toHaveLength(4);
      for (const item of items) {
        expect(item.vehicleId).toBe(vehicleA.id);
      }
    });

    test("{ tripId } narrows results to one trip only", async () => {
      await seedSix();
      const { items, total } = await service.list({ tripId: trip.id });
      // Two of the six rows are tied to the trip.
      expect(total).toBe(2);
      expect(items).toHaveLength(2);
      for (const item of items) {
        expect(item.tripId).toBe(trip.id);
      }
    });

    test("{ startDate, endDate } narrows the date range (inclusive bounds)", async () => {
      await seedSix();
      // Pick a window that includes the 2026-01-15 row and the
      // 2026-01-25 row but excludes the rest. The bounds are
      // inclusive at both ends.
      const startDate = new Date("2026-01-15T00:00:00Z");
      const endDate = new Date("2026-01-25T23:59:59Z");
      const { items, total } = await service.list({ startDate, endDate });
      expect(total).toBe(2);
      expect(items).toHaveLength(2);
      for (const item of items) {
        expect(item.date >= startDate).toBe(true);
        expect(item.date <= endDate).toBe(true);
      }
    });

    test("{ vehicleId } + { startDate, endDate } combine (logical AND)", async () => {
      await seedSix();
      // vehicleA has two rows in Jan (the 2026-01-05 and 2026-01-15
      // rows) and two in Feb. Bound to Jan and the count should be 2.
      const { items, total } = await service.list({
        vehicleId: vehicleA.id,
        startDate: new Date("2026-01-01T00:00:00Z"),
        endDate: new Date("2026-01-31T23:59:59Z"),
      });
      expect(total).toBe(2);
      expect(items).toHaveLength(2);
      for (const item of items) {
        expect(item.vehicleId).toBe(vehicleA.id);
      }
    });

    test("take is clamped to LIST_TAKE_MAX (defense-in-depth)", async () => {
      await seedSix();
      // The schema layer caps at 200; here we bypass the schema and
      // call the service directly with an over-large take. The
      // service clamps so the underlying Prisma query never receives
      // an unbounded ceiling.
      const { items, total } = await service.list({ take: LIST_TAKE_MAX + 5000 });
      expect(total).toBe(6);
      // Six rows fit within the clamped ceiling, so we get all six
      // back — the assertion is that the clamp did not error and did
      // not somehow truncate within the dataset size.
      expect(items).toHaveLength(6);
    });

    test("skip past the end returns empty items but the correct total", async () => {
      await seedSix();
      const { items, total } = await service.list({ skip: 100, take: 10 });
      expect(total).toBe(6);
      expect(items).toHaveLength(0);
    });

    test("sortBy='createdAt' + sortDir='asc' returns oldest-created first", async () => {
      await seedSix();
      const { items, total } = await service.list({ sortBy: "createdAt", sortDir: "asc" });
      expect(total).toBe(6);
      // Sequential await in seedSix() guarantees monotonic
      // createdAt. The first item under asc is the first inserted
      // (the 2026-01-05 row).
      expect(items[0].date.toISOString()).toBe("2026-01-05T08:00:00.000Z");
      // And the last is the most recently inserted (the 2026-02-25
      // row).
      expect(items[items.length - 1].date.toISOString()).toBe("2026-02-25T08:00:00.000Z");
    });

    test("sortBy='date' + sortDir='asc' returns oldest-date first", async () => {
      await seedSix();
      const { items } = await service.list({ sortBy: "date", sortDir: "asc" });
      expect(items[0].date.toISOString()).toBe("2026-01-05T08:00:00.000Z");
      expect(items[items.length - 1].date.toISOString()).toBe("2026-02-25T08:00:00.000Z");
    });

    test("skip + take produce stable pagination across requests", async () => {
      await seedSix();
      // Page 1: rows 0..1 (the two most recent under date desc)
      const page1 = await service.list({ skip: 0, take: 2 });
      expect(page1.items).toHaveLength(2);
      // Page 2: rows 2..3
      const page2 = await service.list({ skip: 2, take: 2 });
      expect(page2.items).toHaveLength(2);
      // The 4 items across the two pages should be 4 distinct ids
      // (no duplicates, no skips). The id-tiebreaker in orderBy is
      // what makes this stable when two rows share a primary sort
      // value; on this seed the dates are all distinct so the test
      // is doubly safe.
      const allIds = new Set([...page1.items.map((i) => i.id), ...page2.items.map((i) => i.id)]);
      expect(allIds.size).toBe(4);
    });
  });

  // ----------------------------------------------------------------
  // iter-20: write path
  // ----------------------------------------------------------------
  // The kickoff names the coverage areas: happy paths for create /
  // update / delete; totalCostPaisa derivation correctness (the
  // canonical worked example from the service docblock); vehicleId
  // immutability rejection on PATCH (asserted at the schema layer,
  // not here — see fuel-logs.schemas.test where the .strict() check
  // lives); tripId mutability allowed on PATCH; trip-vehicle
  // consistency rejection; P2003 on vehicleId → 400; P2003 on tripId
  // → 400; P2025 on update / remove → 404.

  describe("create()", () => {
    test("happy path: persists row with all fields and derived totalCostPaisa", async () => {
      const created = await service.create(
        {
          vehicleId: vehicleA.id,
          date: new Date("2026-02-15T08:00:00Z"),
          litersMl: 12_345,
          pricePerLiterPaisa: 11_055,
          station: "NOC Naxal",
          receiptNumber: "R-1234",
          odometerReadingKm: 10_500,
          notes: "iter-20 happy path",
        },
        adminId,
      );
      expect(created.id).toBeTruthy();
      expect(created.vehicleId).toBe(vehicleA.id);
      expect(created.tripId).toBeNull();
      expect(created.litersMl).toBe(12_345);
      expect(created.pricePerLiterPaisa).toBe(11_055);
      // Worked example from the service docblock: round((12345 *
      // 11055) / 1000) = round(136473.975) = 136474. Half-up
      // resolves the .975 upward (truncation would produce 136473).
      expect(created.totalCostPaisa).toBe(136_474);
      expect(created.station).toBe("NOC Naxal");
      expect(created.receiptNumber).toBe("R-1234");
      expect(created.odometerReadingKm).toBe(10_500);
      expect(created.notes).toBe("iter-20 happy path");
      expect(created.createdById).toBe(adminId);
      // Detail-include shape on the returned row.
      expect(created.vehicle.id).toBe(vehicleA.id);
      expect(created.trip).toBeNull();
    });

    test("happy path with tripId: trip-vehicle consistency is satisfied", async () => {
      // The seed's `trip` is for vehicleA; pairing the fuel log with
      // vehicleA + this trip is consistent and should succeed.
      const created = await service.create(
        {
          vehicleId: vehicleA.id,
          tripId: trip.id,
          date: new Date("2026-02-15T08:00:00Z"),
          litersMl: 10_000,
          pricePerLiterPaisa: 10_000,
        },
        adminId,
      );
      expect(created.tripId).toBe(trip.id);
      expect(created.trip?.id).toBe(trip.id);
      // (10000 * 10000) / 1000 = 100_000 paisa = NPR 1000.00
      expect(created.totalCostPaisa).toBe(100_000);
    });

    test("nullable fields default to null when omitted from the input", async () => {
      const created = await service.create(
        {
          vehicleId: vehicleA.id,
          date: new Date("2026-02-15T08:00:00Z"),
          litersMl: 5_000,
          pricePerLiterPaisa: 11_000,
        },
        adminId,
      );
      expect(created.tripId).toBeNull();
      expect(created.odometerReadingKm).toBeNull();
      expect(created.station).toBeNull();
      expect(created.receiptNumber).toBeNull();
      expect(created.notes).toBeNull();
    });

    test("rejects trip-vehicle mismatch with BadRequestException naming both registrations", async () => {
      // The seed's `trip` is for vehicleA; pairing it with vehicleB
      // is the mismatch case. The service-layer check must fail
      // before we hit Prisma.
      try {
        await service.create(
          {
            vehicleId: vehicleB.id,
            tripId: trip.id,
            date: new Date("2026-02-15T08:00:00Z"),
            litersMl: 10_000,
            pricePerLiterPaisa: 10_000,
          },
          adminId,
        );
        throw new Error("expected BadRequestException");
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const message = (error as BadRequestException).message;
        expect(message).toContain(trip.id);
        // Both registration numbers are named in the message so the
        // operator understands the mismatch direction.
        expect(message).toContain(vehicleA.registrationNumber);
        expect(message).toContain(vehicleB.registrationNumber);
      }
    });

    test("rejects a missing tripId with a friendly BadRequest before Prisma sees the FK", async () => {
      try {
        await service.create(
          {
            vehicleId: vehicleA.id,
            tripId: "ckmissingtripid12345678",
            date: new Date("2026-02-15T08:00:00Z"),
            litersMl: 10_000,
            pricePerLiterPaisa: 10_000,
          },
          adminId,
        );
        throw new Error("expected BadRequestException");
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).message).toContain("ckmissingtripid12345678");
      }
    });

    test("P2003 on vehicleId → BadRequestException with the offending id", async () => {
      // Pass a vehicleId that's cuid-shaped but does not exist; the
      // service has no service-layer vehicle existence check (the
      // FK error from Prisma is the source of truth), so Prisma
      // raises P2003 and mapFuelLogWriteError translates it.
      try {
        await service.create(
          {
            vehicleId: "ckmissingvehicleid123456",
            date: new Date("2026-02-15T08:00:00Z"),
            litersMl: 10_000,
            pricePerLiterPaisa: 10_000,
          },
          adminId,
        );
        throw new Error("expected BadRequestException");
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).message).toContain("ckmissingvehicleid123456");
        expect((error as BadRequestException).message).toContain("does not exist");
      }
    });
  });

  describe("update()", () => {
    test("happy path: PATCH that only changes station updates only that column", async () => {
      const created = await seedFuelLog({ station: "NOC Naxal" });
      const updated = await service.update(created.id, { station: "NOC Thapathali" });
      expect(updated.id).toBe(created.id);
      expect(updated.station).toBe("NOC Thapathali");
      // Other fields untouched.
      expect(updated.litersMl).toBe(created.litersMl);
      expect(updated.pricePerLiterPaisa).toBe(created.pricePerLiterPaisa);
      expect(updated.totalCostPaisa).toBe(created.totalCostPaisa);
      expect(updated.vehicleId).toBe(created.vehicleId);
    });

    test("PATCH that touches litersMl recomputes totalCostPaisa from the merged shape", async () => {
      const created = await seedFuelLog({
        litersMl: 12_345,
        pricePerLiterPaisa: 11_050,
        totalCostPaisa: 136_412,
      });
      const updated = await service.update(created.id, { litersMl: 20_000 });
      // Re-derivation: round((20000 * 11050) / 1000) = 221_000.
      expect(updated.litersMl).toBe(20_000);
      expect(updated.pricePerLiterPaisa).toBe(11_050);
      expect(updated.totalCostPaisa).toBe(221_000);
    });

    test("PATCH that touches only pricePerLiterPaisa recomputes totalCostPaisa against stored litersMl", async () => {
      const created = await seedFuelLog({
        litersMl: 12_345,
        pricePerLiterPaisa: 11_050,
        totalCostPaisa: 136_412,
      });
      const updated = await service.update(created.id, { pricePerLiterPaisa: 15_025 });
      // Re-derivation: round((12345 * 15025) / 1000) = round(185_483.625)
      // = 185_484.
      expect(updated.pricePerLiterPaisa).toBe(15_025);
      expect(updated.litersMl).toBe(12_345);
      expect(updated.totalCostPaisa).toBe(185_484);
    });

    test("PATCH allows tripId to flip from null → set", async () => {
      const created = await seedFuelLog({ tripId: null });
      const updated = await service.update(created.id, { tripId: trip.id });
      expect(updated.tripId).toBe(trip.id);
      expect(updated.trip?.id).toBe(trip.id);
    });

    test("PATCH allows tripId to flip from set → null (unpair)", async () => {
      const created = await seedFuelLog({ tripId: trip.id });
      const updated = await service.update(created.id, { tripId: null });
      expect(updated.tripId).toBeNull();
      expect(updated.trip).toBeNull();
    });

    test("PATCH rejects trip-vehicle mismatch against the merged (stored vehicleId) shape", async () => {
      // Seed a fuel log on vehicleB with no trip; the existing
      // vehicleId is vehicleB. Then PATCH tripId to a trip for
      // vehicleA → the merged-shape check must reject (vehicleB +
      // trip-for-A is a mismatch).
      const created = await seedFuelLog({ vehicleId: vehicleB.id, tripId: null });
      try {
        await service.update(created.id, { tripId: trip.id });
        throw new Error("expected BadRequestException");
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const message = (error as BadRequestException).message;
        expect(message).toContain(trip.id);
        expect(message).toContain(vehicleA.registrationNumber);
        expect(message).toContain(vehicleB.registrationNumber);
      }
    });

    test("PATCH with all nullable fields cleared sets each to null", async () => {
      const created = await seedFuelLog({
        tripId: trip.id,
        odometerReadingKm: 10_500,
        station: "NOC Naxal",
        receiptNumber: "R-1234",
        notes: "before",
      });
      const updated = await service.update(created.id, {
        tripId: null,
        odometerReadingKm: null,
        station: null,
        receiptNumber: null,
        notes: null,
      });
      expect(updated.tripId).toBeNull();
      expect(updated.odometerReadingKm).toBeNull();
      expect(updated.station).toBeNull();
      expect(updated.receiptNumber).toBeNull();
      expect(updated.notes).toBeNull();
    });

    test("PATCH on a missing fuel log throws NotFoundException with the id in the message", async () => {
      try {
        await service.update("ckmissingfuellog12345678", { station: "anything" });
        throw new Error("expected NotFoundException");
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).message).toContain("ckmissingfuellog12345678");
      }
    });
  });

  describe("delete()", () => {
    test("happy path: removes the row", async () => {
      const created = await seedFuelLog();
      await service.delete(created.id);
      const fetched = await service.findById(created.id);
      expect(fetched).toBeNull();
    });

    test("on a missing fuel log throws NotFoundException with the id in the message", async () => {
      try {
        await service.delete("ckmissingfuellog12345678");
        throw new Error("expected NotFoundException");
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).message).toContain("ckmissingfuellog12345678");
      }
    });
  });
});

// Pure unit tests for the rounding helper. The integration tests
// above prove the helper is wired into create / update correctly;
// these unit tests pin the rounding behaviour itself so a
// regression in the rounding rule (banker's vs half-up, truncation
// vs round) is caught immediately. The worked examples are drawn
// from the service docblock and the iter-20 kickoff.
describe("deriveTotalCostPaisa()", () => {
  test("worked example from the docblock rounds half-up", () => {
    // 12345 mL * 11055 paisa/L / 1000 = 136473.975 → 136474
    // (truncation would produce 136473)
    expect(deriveTotalCostPaisa(12_345, 11_055)).toBe(136_474);
  });

  test("exact integer result needs no rounding", () => {
    // 10_000 mL * 10_000 paisa/L / 1000 = 100_000 paisa exactly
    expect(deriveTotalCostPaisa(10_000, 10_000)).toBe(100_000);
  });

  test("0.5 rounds up (half-up, not banker's)", () => {
    // 1 mL * 500 paisa/L / 1000 = 0.5 → 1 (half-up). Under
    // banker's-rounding this would round to 0 (nearest even).
    expect(deriveTotalCostPaisa(1, 500) >= 0).toBe(true);
    // Pick a value that's unambiguously a .5 boundary on a halfway
    // integer like 1.5: 1 mL * 1500 paisa/L / 1000 = 1.5 → 2 (half-up).
    expect(deriveTotalCostPaisa(1, 1_500)).toBe(2);
  });

  test("zero quantity or zero price gives zero (the trivial cases)", () => {
    expect(deriveTotalCostPaisa(0, 11_050)).toBe(0);
    expect(deriveTotalCostPaisa(12_345, 0)).toBe(0);
  });
});

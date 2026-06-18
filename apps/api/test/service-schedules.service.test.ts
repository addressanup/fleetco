import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { type MeterType, type VehicleKind } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { PrismaService } from "../src/modules/prisma/prisma.service";
import {
  ServiceSchedulesService,
  type CreateServiceScheduleInput,
} from "../src/modules/maintenance/service-schedules.service";
import { resetDb } from "./db";

// Integration tests for ServiceSchedulesService against a real Postgres
// (ADR-0037 B3). Mirrors the customers/geofences service test shape: a single
// shared TestingModule + PrismaService, resetDb in beforeEach, and a seeded
// admin User + Vehicle because ServiceSchedule.createdById and .vehicleId are
// non-null FKs. Coverage focuses on the boundaries the kickoff names — filter /
// sort / paginate, the meter-consistency rule (ADR-0037 c3), anchor seeding
// (c4), the @@unique([vehicleId, name]) P2002 → 409, and the delete-when-
// referenced P2003 → 409.

describe("ServiceSchedulesService (integration, real Postgres)", () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let service: ServiceSchedulesService;
  let adminId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [ServiceSchedulesService, PrismaService],
    }).compile();
    await module.init();

    prisma = module.get(PrismaService);
    service = module.get(ServiceSchedulesService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    adminId = `user_${randomUUID()}`;
    await prisma.user.create({
      data: { id: adminId, email: `admin-${adminId}@fleetco.test`, name: "Test Admin" },
    });
  });

  async function seedVehicle(
    overrides: {
      kind?: VehicleKind;
      meterType?: MeterType;
      odometerCurrentKm?: number;
      engineHoursCurrent?: number | null;
    } = {},
  ) {
    return prisma.vehicle.create({
      data: {
        registrationNumber: `BA-${randomUUID().slice(0, 8)}`,
        kind: overrides.kind ?? "TRUCK",
        make: "Tata",
        model: "LPK 2518",
        year: 2020,
        acquiredAt: new Date("2020-01-01T00:00:00Z"),
        odometerStartKm: 0,
        odometerCurrentKm: overrides.odometerCurrentKm ?? 0,
        meterType: overrides.meterType ?? "ODOMETER_KM",
        engineHoursStart: overrides.engineHoursCurrent ?? null,
        engineHoursCurrent: overrides.engineHoursCurrent ?? null,
        createdById: adminId,
      },
    });
  }

  function makeInput(
    vehicleId: string,
    overrides: Partial<CreateServiceScheduleInput> = {},
  ): CreateServiceScheduleInput {
    return {
      vehicleId,
      name: overrides.name ?? "Oil change",
      description: overrides.description,
      intervalType: overrides.intervalType ?? "DISTANCE_KM",
      intervalValue: overrides.intervalValue ?? 5000,
      status: overrides.status,
      lastServiceAt: overrides.lastServiceAt,
      lastServiceOdometerKm: overrides.lastServiceOdometerKm,
      lastServiceEngineHours: overrides.lastServiceEngineHours,
    };
  }

  describe("findById()", () => {
    test("returns the schedule when present", async () => {
      const vehicle = await seedVehicle();
      const created = await service.create(makeInput(vehicle.id), adminId);
      const fetched = await service.findById(created.id);
      expect(fetched?.id).toBe(created.id);
      expect(fetched?.name).toBe("Oil change");
    });

    test("returns null when not present (controller maps to 404)", async () => {
      expect(await service.findById("nonexistent-id")).toBeNull();
    });
  });

  describe("list() — filter / sort / paginate", () => {
    async function seedFive(vehicleId: string, otherVehicleId: string): Promise<void> {
      await service.create(makeInput(vehicleId, { name: "Alpha", status: "ACTIVE" }), adminId);
      await service.create(makeInput(vehicleId, { name: "Bravo", status: "ACTIVE" }), adminId);
      await service.create(makeInput(vehicleId, { name: "Charlie", status: "INACTIVE" }), adminId);
      await service.create(makeInput(vehicleId, { name: "Delta", status: "INACTIVE" }), adminId);
      await service.create(makeInput(otherVehicleId, { name: "Echo", status: "ACTIVE" }), adminId);
    }

    test("no filters → returns all rows with correct total", async () => {
      const v1 = await seedVehicle();
      const v2 = await seedVehicle();
      await seedFive(v1.id, v2.id);
      const result = await service.list({});
      expect(result.total).toBe(5);
      expect(result.items).toHaveLength(5);
    });

    test("vehicleId filter narrows to one vehicle's schedules", async () => {
      const v1 = await seedVehicle();
      const v2 = await seedVehicle();
      await seedFive(v1.id, v2.id);
      const result = await service.list({ vehicleId: v1.id });
      expect(result.total).toBe(4);
      expect(result.items.every((s) => s.vehicleId === v1.id)).toBe(true);
    });

    test("status filter narrows to matching statuses", async () => {
      const v1 = await seedVehicle();
      const v2 = await seedVehicle();
      await seedFive(v1.id, v2.id);
      const active = await service.list({ status: ["ACTIVE"] });
      expect(active.total).toBe(3);
      expect(active.items.every((s) => s.status === "ACTIVE")).toBe(true);
      const inactive = await service.list({ status: ["INACTIVE"] });
      expect(inactive.total).toBe(2);
    });

    test("empty-array status is treated as no filter (defense-in-depth)", async () => {
      const v1 = await seedVehicle();
      const v2 = await seedVehicle();
      await seedFive(v1.id, v2.id);
      const result = await service.list({ status: [] });
      expect(result.total).toBe(5);
    });

    test("sortBy=name asc/desc respects the whitelist column", async () => {
      const v1 = await seedVehicle();
      const v2 = await seedVehicle();
      await seedFive(v1.id, v2.id);
      const asc = await service.list({ sortBy: "name", sortDir: "asc" });
      expect(asc.items.map((s) => s.name)).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
      const desc = await service.list({ sortBy: "name", sortDir: "desc" });
      expect(desc.items.map((s) => s.name)).toEqual(["Echo", "Delta", "Charlie", "Bravo", "Alpha"]);
    });

    test("default sort is createdAt desc (newest first)", async () => {
      const v = await seedVehicle();
      const first = await service.create(makeInput(v.id, { name: "First" }), adminId);
      await new Promise((r) => setTimeout(r, 5));
      const second = await service.create(makeInput(v.id, { name: "Second" }), adminId);
      await new Promise((r) => setTimeout(r, 5));
      const third = await service.create(makeInput(v.id, { name: "Third" }), adminId);
      const result = await service.list({});
      expect(result.items.map((s) => s.id)).toEqual([third.id, second.id, first.id]);
    });

    test("pagination: skip + take returns the right window; total reflects the full match", async () => {
      const v1 = await seedVehicle();
      const v2 = await seedVehicle();
      await seedFive(v1.id, v2.id);
      const page = await service.list({ sortBy: "name", sortDir: "asc", skip: 2, take: 2 });
      expect(page.items.map((s) => s.name)).toEqual(["Charlie", "Delta"]);
      expect(page.total).toBe(5);
    });

    test("take is clamped at LIST_TAKE_MAX (defense-in-depth)", async () => {
      const v1 = await seedVehicle();
      const v2 = await seedVehicle();
      await seedFive(v1.id, v2.id);
      const result = await service.list({ take: 10_000 });
      expect(result.items.length).toBeLessThanOrEqual(5);
      expect(result.total).toBe(5);
    });

    test("skip beyond the result set returns an empty page with the correct total", async () => {
      const v1 = await seedVehicle();
      const v2 = await seedVehicle();
      await seedFive(v1.id, v2.id);
      const page = await service.list({ skip: 100, take: 10 });
      expect(page.items).toHaveLength(0);
      expect(page.total).toBe(5);
    });
  });

  describe("create()", () => {
    test("persists with the createdById from the session and defaults status ACTIVE", async () => {
      const vehicle = await seedVehicle();
      const created = await service.create(makeInput(vehicle.id, { status: undefined }), adminId);
      expect(created.id).toBeTruthy();
      expect(created.createdById).toBe(adminId);
      expect(created.status).toBe("ACTIVE");
      expect(created.description).toBeNull();
    });

    test("DISTANCE_KM schedule seeds lastServiceOdometerKm from the vehicle's current odometer (c4)", async () => {
      const vehicle = await seedVehicle({ odometerCurrentKm: 42_000 });
      const created = await service.create(
        makeInput(vehicle.id, { intervalType: "DISTANCE_KM", intervalValue: 5000 }),
        adminId,
      );
      expect(created.lastServiceOdometerKm).toBe(42_000);
      expect(created.lastServiceEngineHours).toBeNull();
      expect(created.lastServiceAt).toBeInstanceOf(Date);
    });

    test("ENGINE_HOURS schedule seeds lastServiceEngineHours from the vehicle's current hours (c4)", async () => {
      const vehicle = await seedVehicle({ meterType: "ENGINE_HOURS", engineHoursCurrent: 12_500 });
      const created = await service.create(
        makeInput(vehicle.id, { intervalType: "ENGINE_HOURS", intervalValue: 2500 }),
        adminId,
      );
      expect(created.lastServiceEngineHours).toBe(12_500);
      expect(created.lastServiceOdometerKm).toBeNull();
    });

    test("CALENDAR_DAYS schedule seeds neither meter anchor", async () => {
      const vehicle = await seedVehicle({ odometerCurrentKm: 9999 });
      const created = await service.create(
        makeInput(vehicle.id, { intervalType: "CALENDAR_DAYS", intervalValue: 365 }),
        adminId,
      );
      expect(created.lastServiceOdometerKm).toBeNull();
      expect(created.lastServiceEngineHours).toBeNull();
    });

    test("operator-supplied anchor values override the vehicle-derived defaults", async () => {
      const vehicle = await seedVehicle({ odometerCurrentKm: 42_000 });
      const at = new Date("2026-03-01T00:00:00Z");
      const created = await service.create(
        makeInput(vehicle.id, {
          intervalType: "DISTANCE_KM",
          lastServiceAt: at,
          lastServiceOdometerKm: 40_000,
        }),
        adminId,
      );
      expect(created.lastServiceOdometerKm).toBe(40_000);
      expect(created.lastServiceAt.toISOString()).toBe(at.toISOString());
    });

    test("meter-consistency: ENGINE_HOURS schedule on an ODOMETER_KM vehicle → BadRequestException (400, c3)", async () => {
      const vehicle = await seedVehicle({ meterType: "ODOMETER_KM" });
      let thrown: unknown;
      try {
        await service.create(makeInput(vehicle.id, { intervalType: "ENGINE_HOURS" }), adminId);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);
    });

    test("meter-consistency: ENGINE_HOURS schedule is allowed on ENGINE_HOURS and BOTH vehicles", async () => {
      const hours = await seedVehicle({ meterType: "ENGINE_HOURS", engineHoursCurrent: 100 });
      const both = await seedVehicle({ meterType: "BOTH", engineHoursCurrent: 200 });
      const a = await service.create(
        makeInput(hours.id, { intervalType: "ENGINE_HOURS", name: "Engine svc" }),
        adminId,
      );
      const b = await service.create(
        makeInput(both.id, { intervalType: "ENGINE_HOURS", name: "Boom svc" }),
        adminId,
      );
      expect(a.intervalType).toBe("ENGINE_HOURS");
      expect(b.intervalType).toBe("ENGINE_HOURS");
    });

    test("CALENDAR_DAYS and DISTANCE_KM are valid on any vehicle (incl. an hours-only one)", async () => {
      const hours = await seedVehicle({ meterType: "ENGINE_HOURS", engineHoursCurrent: 100 });
      const cal = await service.create(
        makeInput(hours.id, { intervalType: "CALENDAR_DAYS", name: "Annual", intervalValue: 365 }),
        adminId,
      );
      const km = await service.create(
        makeInput(hours.id, { intervalType: "DISTANCE_KM", name: "Tyres", intervalValue: 10000 }),
        adminId,
      );
      expect(cal.intervalType).toBe("CALENDAR_DAYS");
      expect(km.intervalType).toBe("DISTANCE_KM");
    });

    test("missing vehicle → BadRequestException (400)", async () => {
      let thrown: unknown;
      try {
        await service.create(makeInput("cnonexistentvehicleid000"), adminId);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);
    });

    test("duplicate name on the same vehicle → ConflictException (P2002 → 409)", async () => {
      const vehicle = await seedVehicle();
      await service.create(makeInput(vehicle.id, { name: "250-hour service" }), adminId);
      let thrown: unknown;
      try {
        await service.create(makeInput(vehicle.id, { name: "250-hour service" }), adminId);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ConflictException);
      expect((thrown as ConflictException).message).toContain("250-hour service");
    });

    test("the same name on DIFFERENT vehicles both succeed (the unique is composite)", async () => {
      const v1 = await seedVehicle();
      const v2 = await seedVehicle();
      const a = await service.create(makeInput(v1.id, { name: "Oil change" }), adminId);
      const b = await service.create(makeInput(v2.id, { name: "Oil change" }), adminId);
      expect(a.name).toBe("Oil change");
      expect(b.name).toBe("Oil change");
    });
  });

  describe("update()", () => {
    test("returns null when not found (controller maps to 404)", async () => {
      expect(await service.update("nonexistent-id", { name: "X" })).toBeNull();
    });

    test("happy path updates only the named fields", async () => {
      const vehicle = await seedVehicle();
      const created = await service.create(makeInput(vehicle.id, { intervalValue: 5000 }), adminId);
      const updated = await service.update(created.id, { name: "Renamed", intervalValue: 7500 });
      expect(updated?.name).toBe("Renamed");
      expect(updated?.intervalValue).toBe(7500);
      expect(updated?.intervalType).toBe("DISTANCE_KM");
    });

    test("status toggle ACTIVE → INACTIVE persists", async () => {
      const vehicle = await seedVehicle();
      const created = await service.create(makeInput(vehicle.id), adminId);
      const updated = await service.update(created.id, { status: "INACTIVE" });
      expect(updated?.status).toBe("INACTIVE");
    });

    test("lastServiceAt manual correction persists (the anchor edit path, c5)", async () => {
      const vehicle = await seedVehicle();
      const created = await service.create(makeInput(vehicle.id), adminId);
      const corrected = new Date("2026-01-15T00:00:00Z");
      const updated = await service.update(created.id, { lastServiceAt: corrected });
      expect(updated?.lastServiceAt.toISOString()).toBe(corrected.toISOString());
    });

    test("explicit null clears description; absent leaves it alone", async () => {
      const vehicle = await seedVehicle();
      const created = await service.create(
        makeInput(vehicle.id, { description: "Quarterly grease" }),
        adminId,
      );
      const cleared = await service.update(created.id, { description: null });
      expect(cleared?.description).toBeNull();

      const created2 = await service.create(
        makeInput(vehicle.id, { name: "Other", description: "Keep me" }),
        adminId,
      );
      const untouched = await service.update(created2.id, { name: "Other renamed" });
      expect(untouched?.description).toBe("Keep me");
    });

    test("changing intervalType to ENGINE_HOURS on an ODOMETER_KM vehicle → BadRequestException (c3 re-validated)", async () => {
      const vehicle = await seedVehicle({ meterType: "ODOMETER_KM" });
      const created = await service.create(
        makeInput(vehicle.id, { intervalType: "DISTANCE_KM" }),
        adminId,
      );
      let thrown: unknown;
      try {
        await service.update(created.id, { intervalType: "ENGINE_HOURS" });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);
    });

    test("changing intervalType to ENGINE_HOURS on a BOTH vehicle succeeds", async () => {
      const vehicle = await seedVehicle({ meterType: "BOTH", engineHoursCurrent: 50 });
      const created = await service.create(
        makeInput(vehicle.id, { intervalType: "DISTANCE_KM" }),
        adminId,
      );
      const updated = await service.update(created.id, {
        intervalType: "ENGINE_HOURS",
        intervalValue: 2500,
      });
      expect(updated?.intervalType).toBe("ENGINE_HOURS");
    });

    test("rename to a colliding name on the same vehicle → ConflictException", async () => {
      const vehicle = await seedVehicle();
      const a = await service.create(makeInput(vehicle.id, { name: "A svc" }), adminId);
      await service.create(makeInput(vehicle.id, { name: "B svc" }), adminId);
      let thrown: unknown;
      try {
        await service.update(a.id, { name: "B svc" });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ConflictException);
    });
  });

  describe("delete()", () => {
    test("happy path deletes the row and returns true", async () => {
      const vehicle = await seedVehicle();
      const created = await service.create(makeInput(vehicle.id), adminId);
      expect(await service.delete(created.id)).toBe(true);
      expect(await prisma.serviceSchedule.findUnique({ where: { id: created.id } })).toBeNull();
    });

    test("returns false when not found (controller maps to 404)", async () => {
      expect(await service.delete("nonexistent-id")).toBe(false);
    });

    test("blocked when a ServiceRecord references the schedule → ConflictException (P2003 → 409)", async () => {
      const vehicle = await seedVehicle();
      const schedule = await service.create(makeInput(vehicle.id), adminId);
      await prisma.serviceRecord.create({
        data: {
          vehicleId: vehicle.id,
          serviceScheduleId: schedule.id,
          performedAt: new Date("2026-02-01T00:00:00Z"),
          createdById: adminId,
        },
      });

      let thrown: unknown;
      try {
        await service.delete(schedule.id);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ConflictException);
      expect((thrown as ConflictException).message).toBe(
        "Cannot delete service schedule: it is referenced by other records.",
      );
      // The schedule survives the blocked delete.
      expect(
        await prisma.serviceSchedule.findUnique({ where: { id: schedule.id } }),
      ).not.toBeNull();
    });
  });
});

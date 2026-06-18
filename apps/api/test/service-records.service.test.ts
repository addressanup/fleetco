import { randomUUID } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { PrismaService } from "../src/modules/prisma/prisma.service";
import {
  ServiceRecordsService,
  type CreateServiceRecordInput,
} from "../src/modules/maintenance/service-records.service";
import { resetDb } from "./db";

// Integration tests for ServiceRecordsService against a real Postgres (ADR-0037
// B3). A ServiceRecord is a completed service event. Coverage: filter / sort /
// paginate, the schedule↔vehicle consistency check (ADR-0037 c5), the
// nullable-FK ad-hoc (no schedule) path, and the stale-FK P2003 → 400 mapping.
// There is no unique constraint on ServiceRecord, so no P2002 path; and nothing
// FKs into it, so delete has no 409 arm.

describe("ServiceRecordsService (integration, real Postgres)", () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let service: ServiceRecordsService;
  let adminId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [ServiceRecordsService, PrismaService],
    }).compile();
    await module.init();
    prisma = module.get(PrismaService);
    service = module.get(ServiceRecordsService);
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

  async function seedVehicle() {
    return prisma.vehicle.create({
      data: {
        registrationNumber: `BA-${randomUUID().slice(0, 8)}`,
        kind: "TRUCK",
        make: "Tata",
        model: "LPK 2518",
        year: 2020,
        acquiredAt: new Date("2020-01-01T00:00:00Z"),
        createdById: adminId,
      },
    });
  }

  async function seedSchedule(vehicleId: string, name = "Oil change") {
    return prisma.serviceSchedule.create({
      data: {
        vehicleId,
        name,
        intervalType: "DISTANCE_KM",
        intervalValue: 5000,
        lastServiceAt: new Date("2026-01-01T00:00:00Z"),
        lastServiceOdometerKm: 0,
        createdById: adminId,
      },
    });
  }

  function makeInput(
    vehicleId: string,
    overrides: Partial<CreateServiceRecordInput> = {},
  ): CreateServiceRecordInput {
    return {
      vehicleId,
      serviceScheduleId: overrides.serviceScheduleId,
      performedAt: overrides.performedAt ?? new Date("2026-02-01T00:00:00Z"),
      odometerKm: overrides.odometerKm,
      engineHours: overrides.engineHours,
      notes: overrides.notes,
    };
  }

  describe("findById()", () => {
    test("present / null branches", async () => {
      const v = await seedVehicle();
      const created = await service.create(makeInput(v.id), adminId);
      expect((await service.findById(created.id))?.id).toBe(created.id);
      expect(await service.findById("nonexistent-id")).toBeNull();
    });
  });

  describe("list() — filter / sort / paginate", () => {
    test("vehicleId and serviceScheduleId filters narrow results", async () => {
      const v1 = await seedVehicle();
      const v2 = await seedVehicle();
      const sched = await seedSchedule(v1.id);
      await service.create(makeInput(v1.id, { serviceScheduleId: sched.id }), adminId);
      await service.create(makeInput(v1.id), adminId); // ad-hoc, no schedule
      await service.create(makeInput(v2.id), adminId);

      const all = await service.list({});
      expect(all.total).toBe(3);

      const byVehicle = await service.list({ vehicleId: v1.id });
      expect(byVehicle.total).toBe(2);
      expect(byVehicle.items.every((r) => r.vehicleId === v1.id)).toBe(true);

      const bySchedule = await service.list({ serviceScheduleId: sched.id });
      expect(bySchedule.total).toBe(1);
      expect(bySchedule.items[0]?.serviceScheduleId).toBe(sched.id);
    });

    test("default sort is performedAt desc (most recent service first)", async () => {
      const v = await seedVehicle();
      const old = await service.create(
        makeInput(v.id, { performedAt: new Date("2026-01-01T00:00:00Z") }),
        adminId,
      );
      const mid = await service.create(
        makeInput(v.id, { performedAt: new Date("2026-03-01T00:00:00Z") }),
        adminId,
      );
      const recent = await service.create(
        makeInput(v.id, { performedAt: new Date("2026-06-01T00:00:00Z") }),
        adminId,
      );
      const result = await service.list({});
      expect(result.items.map((r) => r.id)).toEqual([recent.id, mid.id, old.id]);
    });

    test("performedAt asc reverses the order", async () => {
      const v = await seedVehicle();
      const a = await service.create(
        makeInput(v.id, { performedAt: new Date("2026-01-01T00:00:00Z") }),
        adminId,
      );
      const b = await service.create(
        makeInput(v.id, { performedAt: new Date("2026-06-01T00:00:00Z") }),
        adminId,
      );
      const result = await service.list({ sortBy: "performedAt", sortDir: "asc" });
      expect(result.items.map((r) => r.id)).toEqual([a.id, b.id]);
    });

    test("pagination window + take clamp + skip-past-end", async () => {
      const v = await seedVehicle();
      for (let i = 0; i < 5; i++) {
        await service.create(
          makeInput(v.id, { performedAt: new Date(`2026-0${i + 1}-01T00:00:00Z`) }),
          adminId,
        );
      }
      const page = await service.list({ skip: 2, take: 2, sortBy: "performedAt", sortDir: "asc" });
      expect(page.items).toHaveLength(2);
      expect(page.total).toBe(5);

      const clamped = await service.list({ take: 10_000 });
      expect(clamped.items.length).toBeLessThanOrEqual(5);

      const past = await service.list({ skip: 100, take: 10 });
      expect(past.items).toHaveLength(0);
      expect(past.total).toBe(5);
    });
  });

  describe("create()", () => {
    test("ad-hoc record (no schedule) persists with createdById and null serviceScheduleId", async () => {
      const v = await seedVehicle();
      const created = await service.create(
        makeInput(v.id, { odometerKm: 50_000, notes: "Roadside repair" }),
        adminId,
      );
      expect(created.createdById).toBe(adminId);
      expect(created.serviceScheduleId).toBeNull();
      expect(created.odometerKm).toBe(50_000);
      expect(created.engineHours).toBeNull();
      expect(created.notes).toBe("Roadside repair");
    });

    test("record against a schedule on the same vehicle links successfully", async () => {
      const v = await seedVehicle();
      const sched = await seedSchedule(v.id);
      const created = await service.create(
        makeInput(v.id, { serviceScheduleId: sched.id }),
        adminId,
      );
      expect(created.serviceScheduleId).toBe(sched.id);
    });

    test("schedule on a DIFFERENT vehicle → BadRequestException (consistency, c5)", async () => {
      const v1 = await seedVehicle();
      const v2 = await seedVehicle();
      const schedOnV2 = await seedSchedule(v2.id);
      let thrown: unknown;
      try {
        await service.create(makeInput(v1.id, { serviceScheduleId: schedOnV2.id }), adminId);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);
      expect((thrown as BadRequestException).message).toContain("different vehicle");
    });

    test("nonexistent (cuid-shaped) serviceScheduleId → BadRequestException", async () => {
      const v = await seedVehicle();
      let thrown: unknown;
      try {
        await service.create(
          makeInput(v.id, { serviceScheduleId: "cknonexistentschedule000" }),
          adminId,
        );
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);
    });

    test("stale vehicleId → BadRequestException (P2003 → 400)", async () => {
      let thrown: unknown;
      try {
        await service.create(makeInput("cknonexistentvehicle0000"), adminId);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);
      expect((thrown as BadRequestException).message).toContain("does not exist");
    });
  });

  describe("update()", () => {
    test("returns null when not found", async () => {
      expect(await service.update("nonexistent-id", { notes: "x" })).toBeNull();
    });

    test("happy path updates performedAt and notes", async () => {
      const v = await seedVehicle();
      const created = await service.create(makeInput(v.id, { notes: "old" }), adminId);
      const when = new Date("2026-05-05T00:00:00Z");
      const updated = await service.update(created.id, { performedAt: when, notes: "new" });
      expect(updated?.performedAt.toISOString()).toBe(when.toISOString());
      expect(updated?.notes).toBe("new");
    });

    test("re-link serviceScheduleId to a same-vehicle schedule succeeds", async () => {
      const v = await seedVehicle();
      const sched = await seedSchedule(v.id);
      const created = await service.create(makeInput(v.id), adminId); // ad-hoc
      const updated = await service.update(created.id, { serviceScheduleId: sched.id });
      expect(updated?.serviceScheduleId).toBe(sched.id);
    });

    test("re-link to a different-vehicle schedule → BadRequestException", async () => {
      const v1 = await seedVehicle();
      const v2 = await seedVehicle();
      const schedOnV2 = await seedSchedule(v2.id);
      const created = await service.create(makeInput(v1.id), adminId);
      let thrown: unknown;
      try {
        await service.update(created.id, { serviceScheduleId: schedOnV2.id });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);
    });

    test("explicit null unlinks the schedule; absent leaves it alone", async () => {
      const v = await seedVehicle();
      const sched = await seedSchedule(v.id);
      const created = await service.create(
        makeInput(v.id, { serviceScheduleId: sched.id, odometerKm: 100 }),
        adminId,
      );
      const unlinked = await service.update(created.id, { serviceScheduleId: null });
      expect(unlinked?.serviceScheduleId).toBeNull();
      // odometerKm untouched (not mentioned in the patch).
      expect(unlinked?.odometerKm).toBe(100);

      const clearedMeter = await service.update(created.id, { odometerKm: null });
      expect(clearedMeter?.odometerKm).toBeNull();
    });
  });

  describe("delete()", () => {
    test("happy path true; not-found false (no inbound-FK 409 arm)", async () => {
      const v = await seedVehicle();
      const created = await service.create(makeInput(v.id), adminId);
      expect(await service.delete(created.id)).toBe(true);
      expect(await service.delete(created.id)).toBe(false);
    });
  });
});

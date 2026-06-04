import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { CustomerStatus, GeofenceType } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { CustomersService } from "../src/modules/customers/customers.service";
import {
  GeofencesService,
  type CreateGeofenceInput,
} from "../src/modules/geofences/geofences.service";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { resetDb } from "./db";
import { BOWTIE_WKT, KATHMANDU_SQUARE_WKT } from "./fixtures/geofence";
import { seedUser } from "./fixtures/trip";

// Integration tests for GeofencesService against a real PostGIS-enabled
// Postgres (ADR-0030 G2). Mirrors customers.service.test.ts plus the
// geofence-specific cases the kickoff names: the ST_IsValid bowtie gate
// (commitment 2), the merged-shape type/ownership refine on PATCH
// (commitment 4), the stale-FK P2003 → 400 mapping, and the
// customer-delete-blocker that flows through Customer's EXISTING P2003 → 409
// arm with NO CustomersService change (commitment 4).
//
// The service's `create` receives an already-parsed `boundary` (a
// ParsedPolygon { wkt, vertexCount }) because the Zod PolygonParam transform
// runs at the controller's pipe layer — so these tests construct the boundary
// directly from the fixture WKT, exactly the shape the pipe would hand the
// service. Note a bowtie ring is a VALID vertex list (it parses through Zod)
// but is geometrically invalid — which is precisely why the service needs the
// separate ST_IsValid gate the generated column does not provide.

// Build the service-facing boundary shape from a ready WKT string. vertexCount
// is echo-only (the service stores boundary.wkt); any value is fine here.
function boundaryOf(wkt: string): CreateGeofenceInput["boundary"] {
  return { wkt, vertexCount: 5 };
}

describe("GeofencesService (integration, real PostGIS)", () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let service: GeofencesService;
  let customers: CustomersService;
  let adminId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [GeofencesService, CustomersService, PrismaService],
    }).compile();
    await module.init();

    prisma = module.get(PrismaService);
    service = module.get(GeofencesService);
    customers = module.get(CustomersService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    adminId = await seedUser(prisma);
  });

  // Seed a Customer (for CUSTOMER_SITE ownership) and return its id.
  async function seedCustomer(name = "Acme Construction"): Promise<string> {
    const c = await prisma.customer.create({
      data: {
        name,
        phone: "+977-9800000000",
        status: CustomerStatus.ACTIVE,
        createdById: adminId,
      },
    });
    return c.id;
  }

  // Build a valid CreateGeofenceInput with sensible defaults.
  function makeCreateInput(overrides: Partial<CreateGeofenceInput> = {}): CreateGeofenceInput {
    return {
      name: overrides.name ?? "Kathmandu Depot",
      type: overrides.type ?? "DEPOT",
      boundary: overrides.boundary ?? boundaryOf(KATHMANDU_SQUARE_WKT),
      customerId: overrides.customerId,
    };
  }

  describe("findById() / getById()", () => {
    test("findById returns the geofence when present, null when missing", async () => {
      const created = await service.create(makeCreateInput({ name: "Yard A" }), adminId);
      expect((await service.findById(created.id))?.name).toBe("Yard A");
      expect(await service.findById("nonexistent-id")).toBeNull();
    });

    test("getById throws NotFoundException (404) with the id named", async () => {
      let thrown: unknown;
      try {
        await service.getById("missing-geofence-id");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(NotFoundException);
      expect((thrown as NotFoundException).message).toContain("missing-geofence-id");
    });
  });

  describe("list() — filter / sort / paginate", () => {
    async function seedFive(): Promise<void> {
      const customerId = await seedCustomer("Owned Sites Co");
      const seeds: CreateGeofenceInput[] = [
        makeCreateInput({ name: "Alpha Depot", type: "DEPOT" }),
        makeCreateInput({ name: "Bravo Corridor", type: "ROUTE_CORRIDOR" }),
        makeCreateInput({ name: "Charlie Site", type: "CUSTOMER_SITE", customerId }),
        makeCreateInput({ name: "Delta Depot", type: "DEPOT" }),
        makeCreateInput({ name: "Echo Site", type: "CUSTOMER_SITE", customerId }),
      ];
      for (const seed of seeds) {
        await service.create(seed, adminId);
      }
    }

    test("no filters → all rows with correct total", async () => {
      await seedFive();
      const result = await service.list({});
      expect(result.total).toBe(5);
      expect(result.items).toHaveLength(5);
    });

    test("type filter narrows results (DEPOT)", async () => {
      await seedFive();
      const result = await service.list({ type: [GeofenceType.DEPOT] });
      expect(result.total).toBe(2);
      expect(result.items.every((g) => g.type === GeofenceType.DEPOT)).toBe(true);
    });

    test("multi-type filter is OR within the dimension", async () => {
      await seedFive();
      const result = await service.list({
        type: [GeofenceType.DEPOT, GeofenceType.ROUTE_CORRIDOR],
      });
      expect(result.total).toBe(3);
    });

    test("customerId filter narrows to the owning customer's sites", async () => {
      const customerId = await seedCustomer("Filter Target Co");
      const otherId = await seedCustomer("Other Co");
      await service.create(
        makeCreateInput({ name: "Site X", type: "CUSTOMER_SITE", customerId }),
        adminId,
      );
      await service.create(
        makeCreateInput({ name: "Site Y", type: "CUSTOMER_SITE", customerId: otherId }),
        adminId,
      );
      await service.create(makeCreateInput({ name: "A Depot", type: "DEPOT" }), adminId);

      const result = await service.list({ customerId });
      expect(result.total).toBe(1);
      expect(result.items[0]?.name).toBe("Site X");
    });

    test("empty-array type is treated as no filter (defense-in-depth)", async () => {
      await seedFive();
      const result = await service.list({ type: [] });
      expect(result.total).toBe(5);
    });

    test("sortBy=name asc respects the whitelist column", async () => {
      await seedFive();
      const result = await service.list({ sortBy: "name", sortDir: "asc" });
      expect(result.items.map((g) => g.name)).toEqual([
        "Alpha Depot",
        "Bravo Corridor",
        "Charlie Site",
        "Delta Depot",
        "Echo Site",
      ]);
    });

    test("sortBy=type groups by fence kind", async () => {
      await seedFive();
      const result = await service.list({ sortBy: "type", sortDir: "asc" });
      // Enum sort order is the Postgres enum definition order:
      // DEPOT, CUSTOMER_SITE, ROUTE_CORRIDOR.
      const types = result.items.map((g) => g.type);
      expect(types).toEqual([
        GeofenceType.DEPOT,
        GeofenceType.DEPOT,
        GeofenceType.CUSTOMER_SITE,
        GeofenceType.CUSTOMER_SITE,
        GeofenceType.ROUTE_CORRIDOR,
      ]);
    });

    test("default sort is createdAt desc (newest first)", async () => {
      const first = await service.create(makeCreateInput({ name: "First" }), adminId);
      await new Promise((r) => setTimeout(r, 5));
      const second = await service.create(makeCreateInput({ name: "Second" }), adminId);
      await new Promise((r) => setTimeout(r, 5));
      const third = await service.create(makeCreateInput({ name: "Third" }), adminId);

      const result = await service.list({});
      expect(result.items.map((g) => g.id)).toEqual([third.id, second.id, first.id]);
    });

    test("pagination: skip + take returns the right window; total reflects full match", async () => {
      await seedFive();
      const page = await service.list({ sortBy: "name", sortDir: "asc", skip: 2, take: 2 });
      expect(page.items.map((g) => g.name)).toEqual(["Charlie Site", "Delta Depot"]);
      expect(page.total).toBe(5);
    });

    test("take is clamped at LIST_TAKE_MAX (defense-in-depth)", async () => {
      await seedFive();
      const result = await service.list({ take: 10_000 });
      expect(result.items.length).toBeLessThanOrEqual(5);
      expect(result.total).toBe(5);
    });

    test("skip beyond the result set returns an empty page with the correct total", async () => {
      await seedFive();
      const page = await service.list({ skip: 100, take: 10 });
      expect(page.items).toHaveLength(0);
      expect(page.total).toBe(5);
    });
  });

  describe("create()", () => {
    test("persists a DEPOT fence with createdById from the session and stores boundaryWkt", async () => {
      const created = await service.create(makeCreateInput({ name: "Main Yard" }), adminId);
      expect(created.id).toBeTruthy();
      expect(created.name).toBe("Main Yard");
      expect(created.type).toBe(GeofenceType.DEPOT);
      expect(created.createdById).toBe(adminId);
      // The canonical text column is stored verbatim.
      expect(created.boundaryWkt).toBe(KATHMANDU_SQUARE_WKT);
      // A DEPOT fence has no owning customer.
      expect(created.customerId).toBeNull();
    });

    test("the database derives a valid geometry(Polygon,4326) from boundaryWkt", async () => {
      const created = await service.create(makeCreateInput(), adminId);
      // Prisma cannot select the Unsupported geometry column, so read it back
      // via PostGIS accessors — the same spatial idiom the hybrid confines raw
      // SQL to. The service inserted ONLY boundaryWkt; the DB derived this.
      const rows = await prisma.$queryRaw<{ type: string; srid: number; valid: boolean }[]>`
        SELECT ST_GeometryType("geometry") AS type, ST_SRID("geometry") AS srid,
               ST_IsValid("geometry") AS valid
        FROM "geofence" WHERE "id" = ${created.id}`;
      expect(rows[0]?.type).toBe("ST_Polygon");
      expect(Number(rows[0]?.srid)).toBe(4326);
      expect(rows[0]?.valid).toBe(true);
    });

    test("persists a CUSTOMER_SITE fence owned by a Customer", async () => {
      const customerId = await seedCustomer("Owner Co");
      const created = await service.create(
        makeCreateInput({ name: "Owner Site", type: "CUSTOMER_SITE", customerId }),
        adminId,
      );
      expect(created.type).toBe(GeofenceType.CUSTOMER_SITE);
      expect(created.customerId).toBe(customerId);
    });

    test("a self-intersecting (bowtie) ring → BadRequestException (the ST_IsValid gate)", async () => {
      // The bowtie stores fine at the DB level (the generated column accepts
      // it — the G1 schema test pins that), so the service's separate
      // ST_IsValid pre-write gate is what rejects it (commitment 2). 400.
      let thrown: unknown;
      try {
        await service.create(makeCreateInput({ boundary: boundaryOf(BOWTIE_WKT) }), adminId);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);

      // And nothing was written — the gate runs BEFORE the insert.
      const count = await prisma.geofence.count();
      expect(count).toBe(0);
    });

    test("a stale customerId → BadRequestException (Prisma P2003 → 400)", async () => {
      let thrown: unknown;
      try {
        await service.create(
          makeCreateInput({
            type: "CUSTOMER_SITE",
            customerId: "claaaaaaaaaaaaaaaaaaaaaaa",
          }),
          adminId,
        );
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);
      expect((thrown as BadRequestException).message).toContain("does not exist");
    });
  });

  describe("update()", () => {
    test("returns null when the geofence is not found (controller maps to 404)", async () => {
      expect(await service.update("nonexistent-id", { name: "X" })).toBeNull();
    });

    test("happy path: renames and returns the updated row", async () => {
      const created = await service.create(makeCreateInput({ name: "Old Name" }), adminId);
      const updated = await service.update(created.id, { name: "New Name" });
      expect(updated?.name).toBe("New Name");
      // Other fields untouched.
      expect(updated?.boundaryWkt).toBe(KATHMANDU_SQUARE_WKT);
      expect(updated?.type).toBe(GeofenceType.DEPOT);
    });

    test("redrawing the boundary stores the new WKT", async () => {
      const created = await service.create(makeCreateInput(), adminId);
      const newWkt = "POLYGON((85.31 27.71, 85.34 27.71, 85.34 27.74, 85.31 27.74, 85.31 27.71))";
      const updated = await service.update(created.id, { boundary: boundaryOf(newWkt) });
      expect(updated?.boundaryWkt).toBe(newWkt);
    });

    test("redrawing to a bowtie → BadRequestException (the validity gate re-runs on PATCH)", async () => {
      const created = await service.create(makeCreateInput(), adminId);
      let thrown: unknown;
      try {
        await service.update(created.id, { boundary: boundaryOf(BOWTIE_WKT) });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);
      // The stored boundary is unchanged.
      expect((await service.findById(created.id))?.boundaryWkt).toBe(KATHMANDU_SQUARE_WKT);
    });

    test("merged shape: a stored DEPOT, PATCH type→CUSTOMER_SITE alone → 400 (needs a customerId)", async () => {
      const created = await service.create(makeCreateInput({ type: "DEPOT" }), adminId);
      let thrown: unknown;
      try {
        await service.update(created.id, { type: "CUSTOMER_SITE" });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);
      expect((thrown as BadRequestException).message).toContain("CUSTOMER_SITE");
    });

    test("merged shape: a stored CUSTOMER_SITE, PATCH type→DEPOT alone → 400 (must not own a customer)", async () => {
      const customerId = await seedCustomer("Site Owner");
      const created = await service.create(
        makeCreateInput({ type: "CUSTOMER_SITE", customerId }),
        adminId,
      );
      let thrown: unknown;
      try {
        await service.update(created.id, { type: "DEPOT" });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);
      expect((thrown as BadRequestException).message).toContain("must not have a customerId");
    });

    test("merged shape: a stored CUSTOMER_SITE, PATCH customerId→null alone → 400", async () => {
      const customerId = await seedCustomer("Site Owner 2");
      const created = await service.create(
        makeCreateInput({ type: "CUSTOMER_SITE", customerId }),
        adminId,
      );
      let thrown: unknown;
      try {
        await service.update(created.id, { customerId: null });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);
    });

    test("valid re-own: PATCH customerId to another existing customer succeeds", async () => {
      const custA = await seedCustomer("Customer A");
      const custB = await seedCustomer("Customer B");
      const created = await service.create(
        makeCreateInput({ type: "CUSTOMER_SITE", customerId: custA }),
        adminId,
      );
      const updated = await service.update(created.id, { customerId: custB });
      expect(updated?.customerId).toBe(custB);
    });

    test("valid re-classify: PATCH type→DEPOT and customerId→null together succeeds", async () => {
      const customerId = await seedCustomer("Departing Owner");
      const created = await service.create(
        makeCreateInput({ type: "CUSTOMER_SITE", customerId }),
        adminId,
      );
      const updated = await service.update(created.id, { type: "DEPOT", customerId: null });
      expect(updated?.type).toBe(GeofenceType.DEPOT);
      expect(updated?.customerId).toBeNull();
    });
  });

  describe("delete()", () => {
    test("happy path: deletes the row and returns true", async () => {
      const created = await service.create(makeCreateInput(), adminId);
      expect(await service.delete(created.id)).toBe(true);
      expect(await prisma.geofence.findUnique({ where: { id: created.id } })).toBeNull();
    });

    test("returns false when the geofence is not found (controller maps to 404)", async () => {
      expect(await service.delete("nonexistent-id")).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Customer-delete-blocker (ADR-0030 c4). Deleting a Customer that OWNS a
  // CUSTOMER_SITE geofence must be blocked with a clean 409 — via Customer's
  // EXISTING P2003 → 409 arm (Geofence.customerId is onDelete: Restrict), with
  // NO change to CustomersService. This test proves the new referencer is
  // covered for free, mirroring the Jobs delete-blocker in
  // customers.service.test.ts.
  // ───────────────────────────────────────────────────────────────────────
  describe("customer-delete-blocker (Customer's existing P2003 → 409 arm)", () => {
    test("deleting a Customer that owns a CUSTOMER_SITE fence → ConflictException (409)", async () => {
      const customerId = await seedCustomer("Referenced Customer");
      const fence = await service.create(
        makeCreateInput({ name: "Their Yard", type: "CUSTOMER_SITE", customerId }),
        adminId,
      );

      let thrown: unknown;
      try {
        await customers.delete(customerId);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ConflictException);
      expect((thrown as ConflictException).message).toBe(
        "Cannot delete customer: it is referenced by other records.",
      );

      // Both rows survive the blocked delete.
      expect(await prisma.customer.findUnique({ where: { id: customerId } })).not.toBeNull();
      expect(await service.findById(fence.id)).not.toBeNull();
    });
  });
});

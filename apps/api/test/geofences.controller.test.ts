import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { BadRequestException, NotFoundException, type INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { GeofenceType, UserRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { ZodValidationPipe } from "../src/common/zod-validation.pipe";
import { AuthGuard } from "../src/modules/auth/auth.guard";
import { AUTH } from "../src/modules/auth/auth.tokens";
import type { AuthenticatedRequest } from "../src/modules/auth/auth.types";
import { RolesGuard } from "../src/modules/auth/roles.guard";
import { GeofencesController } from "../src/modules/geofences/geofences.controller";
import {
  CreateGeofenceSchema,
  ListGeofencesQuerySchema,
  UpdateGeofenceSchema,
} from "../src/modules/geofences/geofences.schemas";
import { GeofencesService } from "../src/modules/geofences/geofences.service";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { GeofenceStatusQuerySchema } from "../src/modules/telematics/telematics.schemas";
import { resetDb } from "./db";
import { seedGeofence } from "./fixtures/geofence";

// Controller-level tests for the Geofences slice (ADR-0030 G2). Three layers,
// mirroring customers.controller.test.ts + telematics.read.controller.test.ts:
//
//   1. Pipe layer — ZodValidationPipe over the three schemas, pure code (no
//      server). Pins .strict() unknown-key rejection (incl. server-controlled
//      createdById / geometry / id), the sortBy whitelist, cuid filters, the
//      shared PolygonParam's vertex-count / range rejections, and the
//      type/ownership superRefine on create.
//   2. WKT coherence — the geofence write schema and the telematics geofence
//      query schema produce BYTE-IDENTICAL WKT for the same vertex input
//      (ADR-0030 c1; the whole reason the parser is shared in common/wkt).
//   3. Controller integration (real Prisma, guards overridden) — list/detail
//      shape + 404, create returns the row with createdById from the session.
//   4. RBAC HTTP boundary (REAL AuthGuard + RolesGuard chain) — the read/write
//      split: read routes are ADMIN + OFFICE_STAFF, write routes ADMIN-only,
//      anonymous 401 on every route (401 ≠ 403).

// A short, valid `lon,lat;…` vertex list (auto-closes to a 4-vertex ring).
const VERTEX_LIST = "85.30,27.70;85.35,27.70;85.35,27.75";
// The same ring as the WKT the shared parser produces from VERTEX_LIST.
const VERTEX_LIST_WKT = "POLYGON((85.3 27.7, 85.35 27.7, 85.35 27.75, 85.3 27.7))";
// A cuid-shaped id for the customerId field (passes the loose cuid regex).
const SAMPLE_CUID = "cgeofence000000000000test";

// ───────────────────────────────────────────────────────────────────────────
// 1 — pipe layer
// ───────────────────────────────────────────────────────────────────────────

describe("ListGeofencesQuerySchema (pipe layer)", () => {
  const pipe = new ZodValidationPipe(ListGeofencesQuerySchema);

  test("bogus query key → BadRequestException (.strict())", () => {
    expect(() => pipe.transform({ tyep: "DEPOT" })).toThrow(BadRequestException);
  });

  test("invalid type enum value → BadRequestException", () => {
    expect(() => pipe.transform({ type: "WAREHOUSE" })).toThrow(BadRequestException);
  });

  test("off-whitelist sortBy (boundaryWkt) → BadRequestException (information-disclosure defense)", () => {
    // Sorting by the geometry text would leak ordering signal; the whitelist
    // is name / createdAt / type only. Same defense every list schema applies.
    expect(() => pipe.transform({ sortBy: "boundaryWkt" })).toThrow(BadRequestException);
  });

  test("off-whitelist sortBy (createdById) → BadRequestException", () => {
    expect(() => pipe.transform({ sortBy: "createdById" })).toThrow(BadRequestException);
  });

  test("take above the 200 ceiling → BadRequestException", () => {
    expect(() => pipe.transform({ take: "5000" })).toThrow(BadRequestException);
  });

  test("skip below zero → BadRequestException", () => {
    expect(() => pipe.transform({ skip: "-1" })).toThrow(BadRequestException);
  });

  test("a non-cuid customerId filter → BadRequestException", () => {
    expect(() => pipe.transform({ customerId: "not-a-cuid" })).toThrow(BadRequestException);
  });

  test("valid query parses (type csv → array, strings → numbers)", () => {
    const result = pipe.transform({
      type: "DEPOT,CUSTOMER_SITE",
      sortBy: "name",
      sortDir: "asc",
      skip: "10",
      take: "50",
    });
    expect(result.type).toEqual([GeofenceType.DEPOT, GeofenceType.CUSTOMER_SITE]);
    expect(result.sortBy).toBe("name");
    expect(result.skip).toBe(10);
    expect(result.take).toBe(50);
  });

  test("empty query → all-undefined (controller/service apply defaults)", () => {
    const result = pipe.transform({});
    expect(result.type).toBeUndefined();
    expect(result.sortBy).toBeUndefined();
    expect(result.customerId).toBeUndefined();
  });
});

describe("CreateGeofenceSchema (pipe layer)", () => {
  const pipe = new ZodValidationPipe(CreateGeofenceSchema);

  const validDepot = { name: "Depot A", type: "DEPOT", boundary: VERTEX_LIST };

  test("server-controlled createdById in the body → BadRequestException (.strict())", () => {
    expect(() => pipe.transform({ ...validDepot, createdById: "smuggled" })).toThrow(
      BadRequestException,
    );
  });

  test("database-derived geometry in the body → BadRequestException (.strict())", () => {
    expect(() => pipe.transform({ ...validDepot, geometry: "POINT(0 0)" })).toThrow(
      BadRequestException,
    );
  });

  test("a client-supplied id → BadRequestException (.strict())", () => {
    expect(() => pipe.transform({ ...validDepot, id: "smuggled" })).toThrow(BadRequestException);
  });

  test("a raw boundaryWkt key → BadRequestException (the wire field is `boundary`)", () => {
    expect(() => pipe.transform({ ...validDepot, boundaryWkt: VERTEX_LIST_WKT })).toThrow(
      BadRequestException,
    );
  });

  test("missing name → BadRequestException", () => {
    expect(() => pipe.transform({ type: "DEPOT", boundary: VERTEX_LIST })).toThrow(
      BadRequestException,
    );
  });

  test("missing boundary → BadRequestException", () => {
    expect(() => pipe.transform({ name: "X", type: "DEPOT" })).toThrow(BadRequestException);
  });

  test("invalid type enum → BadRequestException", () => {
    expect(() => pipe.transform({ name: "X", type: "WAREHOUSE", boundary: VERTEX_LIST })).toThrow(
      BadRequestException,
    );
  });

  // ── the type/ownership superRefine (ADR-0030 c4) ──

  test("CUSTOMER_SITE without a customerId → BadRequestException", () => {
    expect(() =>
      pipe.transform({ name: "Site", type: "CUSTOMER_SITE", boundary: VERTEX_LIST }),
    ).toThrow(BadRequestException);
  });

  test("DEPOT with a customerId → BadRequestException", () => {
    expect(() => pipe.transform({ ...validDepot, customerId: SAMPLE_CUID })).toThrow(
      BadRequestException,
    );
  });

  test("ROUTE_CORRIDOR with a customerId → BadRequestException", () => {
    expect(() =>
      pipe.transform({
        name: "Corridor",
        type: "ROUTE_CORRIDOR",
        boundary: VERTEX_LIST,
        customerId: SAMPLE_CUID,
      }),
    ).toThrow(BadRequestException);
  });

  test("valid DEPOT parses; boundary → closed WKT (lon lat order)", () => {
    const parsed = pipe.transform(validDepot);
    expect(parsed.name).toBe("Depot A");
    expect(parsed.type).toBe("DEPOT");
    expect(parsed.boundary.wkt).toBe(VERTEX_LIST_WKT);
    // 3 supplied vertices auto-close to 4.
    expect(parsed.boundary.vertexCount).toBe(4);
  });

  test("valid CUSTOMER_SITE with a customerId parses", () => {
    const parsed = pipe.transform({
      name: "Owned Site",
      type: "CUSTOMER_SITE",
      boundary: VERTEX_LIST,
      customerId: SAMPLE_CUID,
    });
    expect(parsed.type).toBe("CUSTOMER_SITE");
    expect(parsed.customerId).toBe(SAMPLE_CUID);
  });

  // ── the shared PolygonParam's vertex defenses ──

  test("a polygon with fewer than 3 vertices → BadRequestException", () => {
    expect(() =>
      pipe.transform({ name: "X", type: "DEPOT", boundary: "85.30,27.70;85.35,27.70" }),
    ).toThrow(BadRequestException);
  });

  test("an out-of-range vertex longitude → BadRequestException", () => {
    expect(() =>
      pipe.transform({ name: "X", type: "DEPOT", boundary: "200,27.70;85.35,27.70;85.35,27.75" }),
    ).toThrow(BadRequestException);
  });

  test("a non-numeric vertex → BadRequestException", () => {
    expect(() =>
      pipe.transform({ name: "X", type: "DEPOT", boundary: "abc,27.70;85.35,27.70;85.35,27.75" }),
    ).toThrow(BadRequestException);
  });
});

describe("UpdateGeofenceSchema (pipe layer)", () => {
  const pipe = new ZodValidationPipe(UpdateGeofenceSchema);

  test("empty body → BadRequestException (the at-least-one-field refine)", () => {
    expect(() => pipe.transform({})).toThrow(BadRequestException);
  });

  test("bogus key (id) → BadRequestException (.strict())", () => {
    expect(() => pipe.transform({ id: "smuggled" })).toThrow(BadRequestException);
  });

  test("single-field PATCH (just name) parses through", () => {
    expect(pipe.transform({ name: "Renamed" }).name).toBe("Renamed");
  });

  test("redrawn boundary parses to a closed WKT ring", () => {
    const parsed = pipe.transform({ boundary: VERTEX_LIST });
    expect(parsed.boundary?.wkt).toBe(VERTEX_LIST_WKT);
  });

  test("a {type: CUSTOMER_SITE}-only PATCH parses (ownership is a merged-shape/service concern)", () => {
    // The Update schema deliberately does NOT superRefine ownership: a partial
    // body may omit `type` or `customerId`, so the rule can only be decided
    // against the MERGED shape (the service's job). This pins that design:
    // the schema accepts a type-only PATCH; the service rejects it if the
    // merged shape is contradictory (covered in geofences.service.test.ts).
    expect(pipe.transform({ type: "CUSTOMER_SITE" }).type).toBe("CUSTOMER_SITE");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2 — WKT representation coherence (ADR-0030 commitment 1)
// ───────────────────────────────────────────────────────────────────────────

describe("WKT representation coherence (stored fence == query-param fence)", () => {
  test("the geofence write schema and the telematics query schema build IDENTICAL WKT", () => {
    // Both now consume the SAME shared PolygonParam (common/wkt), so a stored
    // fence's boundaryWkt and a T5 query-param polygon are byte-identical for
    // the same vertex input — which is what lets G5 swap a query-param fence
    // for a stored row's geometry with no change to ST_Contains.
    const stored = CreateGeofenceSchema.parse({
      name: "Coherence",
      type: "DEPOT",
      boundary: VERTEX_LIST,
    });
    const queryParam = GeofenceStatusQuerySchema.parse({ polygon: VERTEX_LIST });
    expect(queryParam.polygon).toBeDefined();
    expect(stored.boundary.wkt).toBe(queryParam.polygon?.wkt);
    expect(stored.boundary.wkt).toBe(VERTEX_LIST_WKT);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3 — controller integration (real Prisma, guards overridden)
// ───────────────────────────────────────────────────────────────────────────

describe("GeofencesController (integration, real Prisma)", () => {
  let module: TestingModule;
  let app: INestApplication;
  let prisma: PrismaService;
  let controller: GeofencesController;
  let adminId: string;
  let fakeRequest: AuthenticatedRequest;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      controllers: [GeofencesController],
      providers: [
        GeofencesService,
        PrismaService,
        { provide: AUTH, useValue: { api: { getSession: () => null } } },
      ],
    })
      // Both guards are overridden to pass-through: this describe tests handler
      // wiring, not RBAC (the real guard chain is exercised in the RBAC
      // describe below).
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    await app.init();

    prisma = module.get(PrismaService);
    controller = module.get(GeofencesController);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    adminId = `user_${randomUUID()}`;
    await prisma.user.create({
      data: { id: adminId, email: `admin-${adminId}@fleetco.test`, name: "Test Admin" },
    });
    fakeRequest = { session: { user: { id: adminId } } } as unknown as AuthenticatedRequest;
  });

  test("list returns the response shape { items, total, skip, take, sortBy, sortDir }", async () => {
    await seedGeofence(prisma, { createdById: adminId, name: "Listed Yard" });
    const response = await controller.list({ sortBy: "name", sortDir: "asc", skip: 0, take: 10 });
    expect(response).toMatchObject({ total: 1, skip: 0, take: 10, sortBy: "name", sortDir: "asc" });
    expect(response.items[0]?.name).toBe("Listed Yard");
  });

  test("getById returns the geofence when present", async () => {
    const fence = await seedGeofence(prisma, { createdById: adminId, name: "Detail Yard" });
    const fetched = await controller.getById(fence.id);
    expect(fetched.id).toBe(fence.id);
    expect(fetched.name).toBe("Detail Yard");
  });

  test("getById of an unknown id → NotFoundException (404) with the id named", async () => {
    try {
      await controller.getById("nonexistent-geofence-id");
      throw new Error("expected NotFoundException");
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).message).toContain("nonexistent-geofence-id");
    }
  });

  test("create persists a DEPOT fence with createdById from the session", async () => {
    const created = await controller.create(
      { name: "Created Yard", type: "DEPOT", boundary: { wkt: VERTEX_LIST_WKT, vertexCount: 4 } },
      fakeRequest,
    );
    expect(created.id).toBeTruthy();
    expect(created.name).toBe("Created Yard");
    expect(created.type).toBe(GeofenceType.DEPOT);
    // createdById comes from the session, never the body.
    expect(created.createdById).toBe(adminId);
    expect(created.boundaryWkt).toBe(VERTEX_LIST_WKT);
  });

  test("create persists a CUSTOMER_SITE fence owned by a real customer", async () => {
    const customer = await prisma.customer.create({
      data: { name: "Owner Co", phone: "+977-9800000000", createdById: adminId },
    });
    const created = await controller.create(
      {
        name: "Owned Site",
        type: "CUSTOMER_SITE",
        boundary: { wkt: VERTEX_LIST_WKT, vertexCount: 4 },
        customerId: customer.id,
      },
      fakeRequest,
    );
    expect(created.type).toBe(GeofenceType.CUSTOMER_SITE);
    expect(created.customerId).toBe(customer.id);
  });

  test("update returns the updated geofence; unknown id → NotFoundException", async () => {
    const fence = await seedGeofence(prisma, { createdById: adminId, name: "Before" });
    const updated = await controller.update(fence.id, { name: "After" });
    expect(updated.name).toBe("After");

    try {
      await controller.update("nonexistent-id", { name: "X" });
      throw new Error("expected NotFoundException");
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
    }
  });

  test("remove deletes the row (204/void); unknown id → NotFoundException", async () => {
    const fence = await seedGeofence(prisma, { createdById: adminId });
    const result = await controller.remove(fence.id);
    expect(result).toBeUndefined();
    expect(await prisma.geofence.findUnique({ where: { id: fence.id } })).toBeNull();

    try {
      await controller.remove("nonexistent-id");
      throw new Error("expected NotFoundException");
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4 — RBAC HTTP boundary (real AuthGuard + RolesGuard chain, ADR-0030 c5)
// ───────────────────────────────────────────────────────────────────────────

// AUTH stub identical to telematics.read.controller.test.ts: AuthGuard calls
// getSession({ headers }); the `x-test-role` header drives the caller's role,
// so one app instance serves every case. No header → null session → 401. The
// session user id is "user_test" — seeded below so write handlers (which fill
// createdById from the session) satisfy the FK and return real success codes.
const AUTH_STUB = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const role = headers.get("x-test-role");
      if (role === null) return null;
      return {
        session: {
          id: "sess_test",
          token: "tok_test",
          userId: "user_test",
          expiresAt: new Date(Date.now() + 60_000),
        },
        user: { id: "user_test", email: "user@fleetco.test", name: "Test", role },
      };
    },
  },
};

describe("Geofences RBAC (geofences:read / geofences:write, ADR-0030 c5)", () => {
  let app: INestApplication;
  let baseUrl: string;
  let seededId: string;
  let deletableId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [GeofencesController],
      providers: [
        GeofencesService,
        PrismaService,
        AuthGuard,
        RolesGuard,
        { provide: AUTH, useValue: AUTH_STUB },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0);

    const address: AddressInfo | string | null = app.getHttpServer().address();
    if (typeof address !== "object" || address === null) {
      throw new Error("expected the test server to bind a TCP port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;

    // Seed the session user (so ADMIN write handlers satisfy the createdById
    // FK → real 201/200/204) plus two fences: one for read/patch, one to
    // delete.
    const prisma = moduleRef.get(PrismaService);
    await resetDb(prisma);
    await prisma.user.create({
      data: { id: "user_test", email: "user@fleetco.test", name: "Test" },
    });
    seededId = (await seedGeofence(prisma, { createdById: "user_test", name: "RBAC Yard" })).id;
    deletableId = (await seedGeofence(prisma, { createdById: "user_test", name: "Deletable" })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  // Issue a request and return the HTTP status. `role` undefined → no header →
  // 401 path. A body (for POST/PATCH) is sent as JSON.
  async function status(
    method: string,
    path: string,
    role?: string,
    body?: unknown,
  ): Promise<number> {
    const headers: Record<string, string> = {};
    if (role !== undefined) headers["x-test-role"] = role;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return res.status;
  }

  const LIST = "/api/v1/geofences";
  const detail = (): string => `/api/v1/geofences/${seededId}`;
  const VALID_BODY = { name: "New Depot", type: "DEPOT", boundary: VERTEX_LIST };

  // ── read routes: geofences:read (ADMIN + OFFICE_STAFF) ──

  test("list (read): ADMIN → 200", async () => {
    expect(await status("GET", LIST, UserRole.ADMIN)).toBe(200);
  });

  test("list (read): OFFICE_STAFF → 200 (the positive half of the split)", async () => {
    expect(await status("GET", LIST, UserRole.OFFICE_STAFF)).toBe(200);
  });

  test("list (read): DRIVER (reserved, inert) → 403", async () => {
    expect(await status("GET", LIST, UserRole.DRIVER)).toBe(403);
  });

  test("list (read): anonymous → 401 from AuthGuard, NOT 403", async () => {
    expect(await status("GET", LIST)).toBe(401);
  });

  test("detail (read): ADMIN → 200", async () => {
    expect(await status("GET", detail(), UserRole.ADMIN)).toBe(200);
  });

  test("detail (read): OFFICE_STAFF → 200", async () => {
    expect(await status("GET", detail(), UserRole.OFFICE_STAFF)).toBe(200);
  });

  test("detail (read): anonymous → 401", async () => {
    expect(await status("GET", detail())).toBe(401);
  });

  // ── write routes: geofences:write (ADMIN only) ──

  test("create (write): ADMIN → 201", async () => {
    expect(await status("POST", LIST, UserRole.ADMIN, VALID_BODY)).toBe(201);
  });

  test("create (write): OFFICE_STAFF → 403 (authed but lacks geofences:write)", async () => {
    expect(await status("POST", LIST, UserRole.OFFICE_STAFF, VALID_BODY)).toBe(403);
  });

  test("create (write): DRIVER → 403", async () => {
    expect(await status("POST", LIST, UserRole.DRIVER, VALID_BODY)).toBe(403);
  });

  test("create (write): anonymous → 401", async () => {
    expect(await status("POST", LIST, undefined, VALID_BODY)).toBe(401);
  });

  test("update (write): ADMIN → 200", async () => {
    expect(await status("PATCH", detail(), UserRole.ADMIN, { name: "Renamed" })).toBe(200);
  });

  test("update (write): OFFICE_STAFF → 403", async () => {
    expect(await status("PATCH", detail(), UserRole.OFFICE_STAFF, { name: "Renamed" })).toBe(403);
  });

  test("delete (write): OFFICE_STAFF → 403 (gate blocks before the handler)", async () => {
    expect(await status("DELETE", `/api/v1/geofences/${deletableId}`, UserRole.OFFICE_STAFF)).toBe(
      403,
    );
  });

  test("delete (write): anonymous → 401", async () => {
    expect(await status("DELETE", `/api/v1/geofences/${deletableId}`)).toBe(401);
  });

  test("delete (write): ADMIN → 204", async () => {
    // Runs last among the delete cases; the 403/401 cases above were blocked
    // before the handler, so `deletableId` still exists for this real delete.
    expect(await status("DELETE", `/api/v1/geofences/${deletableId}`, UserRole.ADMIN)).toBe(204);
  });
});

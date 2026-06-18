import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type ServiceSchedule } from "@prisma/client";

import type {
  CreateServiceScheduleInput,
  ServiceScheduleSortColumn,
  ServiceScheduleSortDir,
  ServiceScheduleStatusName,
  UpdateServiceScheduleInput,
} from "./service-schedules.schemas";

// Re-export the schema-inferred input types so call sites (the controller and
// tests) can pull them from this module — the same convention every other
// aggregate service follows.
export type { CreateServiceScheduleInput, UpdateServiceScheduleInput };

// PrismaService is injected by NestJS via TypeScript's emitDecoratorMetadata
// (see apps/api/tsconfig.json); the class reference must remain a value import
// at runtime so the DI container can resolve it. Same eslint override as every
// other vertical-slice service.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from "../prisma/prisma.service";

export interface ListResult {
  items: ServiceSchedule[];
  total: number;
}

// Pagination defaults and bounds — same `LIST_TAKE_` prefix and 200 ceiling
// every Phase-1 list service uses. The clamp in `list` is defense-in-depth:
// the controller validates `take` against the same ceiling via the schema, but
// the service is also exported (B4's due/overdue surface fetches schedules),
// so a clamp here ensures the database is never asked for an unbounded result.
export const LIST_TAKE_DEFAULT = 20;
export const LIST_TAKE_MAX = 200;
const LIST_TAKE_MIN = 1;

// Prisma error codes. P2002 (unique violation) fires on the @@unique([vehicleId,
// name]) — two schedules with the same name on one vehicle — mapped to HTTP 409
// with field "name". P2003 (FK violation) on a write means a stale vehicleId
// → HTTP 400; on a delete it means a ServiceRecord still references the schedule
// → HTTP 409 (the delete-when-referenced arm). P2025 (record not found) →
// update/delete of a missing row → 404. See docs/runbook/api-error-mapping.md.
const PRISMA_UNIQUE_VIOLATION = "P2002";
const PRISMA_FK_VIOLATION = "P2003";
const PRISMA_RECORD_NOT_FOUND = "P2025";

@Injectable()
export class ServiceSchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List service schedules with optional vehicleId / status filters, a
   * whitelisted sort, and pagination. `total` reflects the filtered count so
   * the UI can render correct "Showing M–N of T" copy.
   *
   * Defaults: 20 rows, newest first by createdAt — matching every other list
   * surface. The `id` secondary tiebreaker (when createdAt is primary) or the
   * `createdAt` secondary (for any other primary) keeps pagination deterministic.
   * `skip` / `take` are clamped to safe bounds (LIST_TAKE_MAX = 200) as
   * defense-in-depth even though the controller already validated them.
   */
  async list({
    skip = 0,
    take = LIST_TAKE_DEFAULT,
    vehicleId,
    status,
    sortBy = "createdAt",
    sortDir = "desc",
  }: {
    skip?: number;
    take?: number;
    vehicleId?: string;
    status?: ServiceScheduleStatusName[];
    sortBy?: ServiceScheduleSortColumn;
    sortDir?: ServiceScheduleSortDir;
  }): Promise<ListResult> {
    const safeSkip = Number.isFinite(skip) && skip >= 0 ? Math.floor(skip) : 0;
    const safeTakeRaw = Number.isFinite(take) ? Math.floor(take) : LIST_TAKE_DEFAULT;
    const safeTake = Math.min(Math.max(safeTakeRaw, LIST_TAKE_MIN), LIST_TAKE_MAX);

    // Build the WHERE once; reuse for findMany + count so `total` matches what
    // findMany would return at skip=0/take=∞. Empty arrays must not produce
    // `in: []` (which matches zero rows) — the schema's csvEnum normalizes those
    // to undefined, but a belt-and-braces check keeps the service robust against
    // a future direct caller. vehicleId is a scalar equality filter.
    const where: Prisma.ServiceScheduleWhereInput = {
      ...(vehicleId ? { vehicleId } : {}),
      ...(status && status.length > 0 ? { status: { in: status } } : {}),
    };

    const orderBy: Prisma.ServiceScheduleOrderByWithRelationInput[] = [
      { [sortBy]: sortDir } as Prisma.ServiceScheduleOrderByWithRelationInput,
      ...(sortBy === "createdAt"
        ? [{ id: sortDir } as Prisma.ServiceScheduleOrderByWithRelationInput]
        : [{ createdAt: "desc" } as Prisma.ServiceScheduleOrderByWithRelationInput]),
    ];

    const [items, total] = await this.prisma.$transaction([
      this.prisma.serviceSchedule.findMany({ skip: safeSkip, take: safeTake, where, orderBy }),
      this.prisma.serviceSchedule.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Fetch one schedule by id. Returns `null` when not found rather than
   * throwing, so the controller shapes the 404 and the service stays usable
   * from other modules (B4's due/overdue surface) without exception handling
   * for the not-found path.
   */
  async findById(id: string): Promise<ServiceSchedule | null> {
    return this.prisma.serviceSchedule.findUnique({ where: { id } });
  }

  /**
   * Create a ServiceSchedule. `createdById` is supplied by the controller from
   * the authenticated session, never the client (the schema's `.strict()`
   * rejects it).
   *
   * Two service-layer concerns the schema cannot do (both need the vehicle):
   *
   *   1. Meter-consistency (ADR-0037 c3): an ENGINE_HOURS schedule is only
   *      meaningful on a vehicle whose meterType is ENGINE_HOURS or BOTH — it
   *      needs engineHoursCurrent to measure against. DISTANCE_KM and
   *      CALENDAR_DAYS are valid on any vehicle. Rejected with a clean 400.
   *
   *   2. Anchor seeding (ADR-0037 c4): "next due" is derived from a stored
   *      last-service anchor. When the operator does not supply it, seed
   *      lastServiceAt = now() and the meter reading from the vehicle's current
   *      reading for the schedule's dimension (odometer for DISTANCE_KM, hours
   *      for ENGINE_HOURS; null for CALENDAR_DAYS, which needs no meter).
   *
   * A missing vehicle is rejected here as 400 (pre-empting the FK's P2003); the
   * P2003 arm below remains as defense-in-depth against a delete racing the read.
   */
  async create(input: CreateServiceScheduleInput, createdById: string): Promise<ServiceSchedule> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: input.vehicleId } });
    if (!vehicle) {
      throw new BadRequestException(`Vehicle ${input.vehicleId} does not exist.`);
    }
    assertMeterConsistency(input.intervalType, vehicle.meterType);

    // Anchor seeding (ADR-0037 c4). "Not provided" (absent in the Zod-parsed
    // input, i.e. `undefined`) seeds the meter reading from the vehicle's
    // current reading for the schedule's dimension; an explicitly-supplied
    // value (including `null`) is respected. We key off `!== undefined` rather
    // than hasOwnProperty so a present-but-undefined key (e.g. from an internal
    // caller) is also treated as "not provided" — the real Zod flow never
    // produces a present-with-undefined optional, so the two agree in practice.
    const lastServiceOdometerKm =
      input.lastServiceOdometerKm !== undefined
        ? input.lastServiceOdometerKm
        : input.intervalType === "DISTANCE_KM"
          ? vehicle.odometerCurrentKm
          : null;
    const lastServiceEngineHours =
      input.lastServiceEngineHours !== undefined
        ? input.lastServiceEngineHours
        : input.intervalType === "ENGINE_HOURS"
          ? vehicle.engineHoursCurrent
          : null;

    const data: Prisma.ServiceScheduleUncheckedCreateInput = {
      vehicleId: input.vehicleId,
      name: input.name,
      description: input.description ?? null,
      intervalType: input.intervalType,
      intervalValue: input.intervalValue,
      status: input.status ?? "ACTIVE",
      lastServiceAt: input.lastServiceAt ?? new Date(),
      lastServiceOdometerKm,
      lastServiceEngineHours,
      createdById,
    };

    try {
      return await this.prisma.serviceSchedule.create({ data });
    } catch (error) {
      throw mapScheduleWriteError(error, input.name, input.vehicleId);
    }
  }

  /**
   * Diff-PATCH a ServiceSchedule. Returns null when the row is not found
   * (controller maps to 404), mirroring CustomersService.update.
   *
   * The service distinguishes "client provided null" (clear the field) from
   * "client did not mention" (leave it) via hasOwnProperty for the nullable
   * anchor fields. When `intervalType` changes, the meter-consistency rule is
   * re-validated against the stored vehicle's meterType (the merged-shape
   * re-validation, the rotation of the geofences ownership refine). vehicleId
   * is immutable (omitted from the schema, rejected by `.strict()`).
   */
  async update(id: string, input: UpdateServiceScheduleInput): Promise<ServiceSchedule | null> {
    const existing = await this.prisma.serviceSchedule.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    const has = (key: keyof UpdateServiceScheduleInput): boolean =>
      Object.prototype.hasOwnProperty.call(input, key);

    // Re-validate meter-consistency only when intervalType is being changed:
    // vehicleId is immutable and the vehicle's meterType is the only other
    // input, so the merged shape can only become inconsistent via intervalType.
    if (input.intervalType !== undefined && input.intervalType !== existing.intervalType) {
      const vehicle = await this.prisma.vehicle.findUnique({ where: { id: existing.vehicleId } });
      // The vehicle must exist (FK Restrict guarantees it for a live schedule),
      // but guard defensively so a vanished vehicle is a clean 400, not a crash.
      if (!vehicle) {
        throw new BadRequestException(`Vehicle ${existing.vehicleId} does not exist.`);
      }
      assertMeterConsistency(input.intervalType, vehicle.meterType);
    }

    const data: Prisma.ServiceScheduleUncheckedUpdateInput = {
      ...(input.name !== undefined && { name: input.name }),
      ...(has("description") && { description: input.description ?? null }),
      ...(input.intervalType !== undefined && { intervalType: input.intervalType }),
      ...(input.intervalValue !== undefined && { intervalValue: input.intervalValue }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.lastServiceAt !== undefined && { lastServiceAt: input.lastServiceAt }),
      ...(has("lastServiceOdometerKm") && {
        lastServiceOdometerKm: input.lastServiceOdometerKm ?? null,
      }),
      ...(has("lastServiceEngineHours") && {
        lastServiceEngineHours: input.lastServiceEngineHours ?? null,
      }),
    };

    try {
      return await this.prisma.serviceSchedule.update({ where: { id }, data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_RECORD_NOT_FOUND
      ) {
        // Row vanished between the findUnique and the update (concurrent delete).
        return null;
      }
      throw mapScheduleWriteError(error, input.name ?? existing.name, existing.vehicleId);
    }
  }

  /**
   * Hard delete. Returns true on delete, false when the schedule was not found
   * (P2025), so the controller shapes the 404.
   *
   * P2003 (FK violation) here means a ServiceRecord still references the
   * schedule (ServiceRecord.serviceScheduleId is onDelete: Restrict): mapped to
   * ConflictException (HTTP 409) with the same message shape CustomersService
   * uses, so service history is never silently orphaned by deleting its schedule.
   */
  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.serviceSchedule.delete({ where: { id } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PRISMA_RECORD_NOT_FOUND) {
          return false;
        }
        if (error.code === PRISMA_FK_VIOLATION) {
          throw new ConflictException(
            "Cannot delete service schedule: it is referenced by other records.",
          );
        }
      }
      throw error;
    }
  }

  /**
   * Fetch one schedule by id or throw NotFoundException (HTTP 404). Convenience
   * wrapper for the controller's GET /:id handler; the message echoes the id so
   * an operator chasing a bad URL sees which id missed. Mirror of
   * GeofencesService.getById.
   */
  async getById(id: string): Promise<ServiceSchedule> {
    const schedule = await this.findById(id);
    if (!schedule) {
      throw new NotFoundException(`Service schedule ${id} not found`);
    }
    return schedule;
  }
}

// The meter-consistency rule (ADR-0037 c3). An ENGINE_HOURS schedule needs a
// vehicle that actually has an hour-meter (meterType ENGINE_HOURS or BOTH);
// DISTANCE_KM and CALENDAR_DAYS are valid on any vehicle. Throws
// BadRequestException (400) on violation. Exported-style pure helper kept
// module-local; the meterType arg is the Prisma enum string union.
function assertMeterConsistency(
  intervalType: CreateServiceScheduleInput["intervalType"],
  meterType: string,
): void {
  if (intervalType === "ENGINE_HOURS" && meterType === "ODOMETER_KM") {
    throw new BadRequestException(
      "An ENGINE_HOURS service schedule requires a vehicle metered in engine-hours " +
        "(meterType ENGINE_HOURS or BOTH).",
    );
  }
}

// Translate a Prisma write error into the HTTP-facing exception.
//   - P2002 on the @@unique([vehicleId, name]) → ConflictException (409); the
//     controller adds the `field: "name"` token. Message names the offending
//     schedule name per the runbook's "name the conflicting field" convention.
//   - P2003 → BadRequestException (400): a stale vehicleId (the only client-
//     controlled FK on a write), or defensively a vanished createdById.
// Non-matching errors pass through unchanged (Nest renders them as 500).
function mapScheduleWriteError(error: unknown, name: string, vehicleId: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === PRISMA_UNIQUE_VIOLATION) {
      return new ConflictException(
        `A service schedule named "${name}" already exists for this vehicle.`,
      );
    }
    if (error.code === PRISMA_FK_VIOLATION) {
      const meta = error.meta as { field_name?: string; constraint?: string } | undefined;
      const fieldName = String(meta?.field_name ?? meta?.constraint ?? "");
      if (fieldName.toLowerCase().includes("createdby")) {
        return new BadRequestException("Authenticated user no longer exists; sign in again.");
      }
      return new BadRequestException(`Vehicle ${vehicleId} does not exist.`);
    }
  }
  return error;
}

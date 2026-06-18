import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type ServiceRecord } from "@prisma/client";

import type {
  CreateServiceRecordInput,
  ServiceRecordSortColumn,
  ServiceRecordSortDir,
  UpdateServiceRecordInput,
} from "./service-records.schemas";

// Re-export the schema-inferred input types so call sites can pull them from
// this module — the convention every aggregate service follows.
export type { CreateServiceRecordInput, UpdateServiceRecordInput };

// PrismaService is injected by NestJS via emitDecoratorMetadata; the class
// reference must remain a value import at runtime. Same eslint override as
// every other vertical-slice service.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from "../prisma/prisma.service";

export interface ListResult {
  items: ServiceRecord[];
  total: number;
}

// Pagination defaults and bounds — same `LIST_TAKE_` prefix and 200 ceiling
// every Phase-1 list service uses. The clamp in `list` is defense-in-depth.
export const LIST_TAKE_DEFAULT = 20;
export const LIST_TAKE_MAX = 200;
const LIST_TAKE_MIN = 1;

// Prisma error codes. ServiceRecord has no unique constraint, so no P2002.
// P2003 (FK violation) on a write means a stale vehicleId / serviceScheduleId /
// createdById → HTTP 400. P2025 (record not found) on update/delete → 404.
// Nothing FKs INTO ServiceRecord (the B4 ExpenseLog link points OUT of it), so
// there is no delete-when-referenced 409 arm here.
const PRISMA_FK_VIOLATION = "P2003";
const PRISMA_RECORD_NOT_FOUND = "P2025";

@Injectable()
export class ServiceRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List service records with optional vehicleId / serviceScheduleId filters, a
   * whitelisted sort, and pagination. `total` reflects the filtered count.
   *
   * Default sort is performedAt desc ("most recent service first"). The `id`
   * secondary tiebreaker (when the primary is unique-enough) keeps pagination
   * deterministic. `skip` / `take` are clamped to safe bounds as
   * defense-in-depth even though the controller already validated them.
   */
  async list({
    skip = 0,
    take = LIST_TAKE_DEFAULT,
    vehicleId,
    serviceScheduleId,
    sortBy = "performedAt",
    sortDir = "desc",
  }: {
    skip?: number;
    take?: number;
    vehicleId?: string;
    serviceScheduleId?: string;
    sortBy?: ServiceRecordSortColumn;
    sortDir?: ServiceRecordSortDir;
  }): Promise<ListResult> {
    const safeSkip = Number.isFinite(skip) && skip >= 0 ? Math.floor(skip) : 0;
    const safeTakeRaw = Number.isFinite(take) ? Math.floor(take) : LIST_TAKE_DEFAULT;
    const safeTake = Math.min(Math.max(safeTakeRaw, LIST_TAKE_MIN), LIST_TAKE_MAX);

    const where: Prisma.ServiceRecordWhereInput = {
      ...(vehicleId ? { vehicleId } : {}),
      ...(serviceScheduleId ? { serviceScheduleId } : {}),
    };

    // Primary sort + a stable secondary tiebreaker. performedAt can repeat
    // (two services the same day), so the `id` tiebreaker is always added for
    // determinism; when sorting by createdAt the id mirrors the direction.
    const orderBy: Prisma.ServiceRecordOrderByWithRelationInput[] = [
      { [sortBy]: sortDir } as Prisma.ServiceRecordOrderByWithRelationInput,
      { id: sortDir } as Prisma.ServiceRecordOrderByWithRelationInput,
    ];

    const [items, total] = await this.prisma.$transaction([
      this.prisma.serviceRecord.findMany({ skip: safeSkip, take: safeTake, where, orderBy }),
      this.prisma.serviceRecord.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Fetch one record by id. Returns `null` when not found rather than throwing,
   * so the controller shapes the 404 and the service stays usable from other
   * modules without exception handling for the not-found path.
   */
  async findById(id: string): Promise<ServiceRecord | null> {
    return this.prisma.serviceRecord.findUnique({ where: { id } });
  }

  /**
   * Create a ServiceRecord. `createdById` is supplied by the controller from
   * the authenticated session, never the client (the schema's `.strict()`
   * rejects it).
   *
   * Schedule↔vehicle consistency (ADR-0037 c5/c6 rotation of the fuel-logs
   * trip-vehicle check): when `serviceScheduleId` is set, the referenced
   * schedule must belong to the same vehicle as the record — recording truck
   * Y's schedule against excavator X's service is nonsensical. A missing
   * schedule is a clean 400 (pre-empting the FK's P2003); a vehicle mismatch is
   * a clean 400. A stale vehicleId still falls through to the FK (P2003 → 400).
   */
  async create(input: CreateServiceRecordInput, createdById: string): Promise<ServiceRecord> {
    if (input.serviceScheduleId) {
      await this.assertScheduleBelongsToVehicle(input.serviceScheduleId, input.vehicleId);
    }

    const data: Prisma.ServiceRecordUncheckedCreateInput = {
      vehicleId: input.vehicleId,
      serviceScheduleId: input.serviceScheduleId ?? null,
      performedAt: input.performedAt,
      odometerKm: input.odometerKm ?? null,
      engineHours: input.engineHours ?? null,
      notes: input.notes ?? null,
      createdById,
    };

    try {
      return await this.prisma.serviceRecord.create({ data });
    } catch (error) {
      throw mapRecordWriteError(error, input.vehicleId, input.serviceScheduleId ?? null);
    }
  }

  /**
   * Diff-PATCH a ServiceRecord. Returns null when the row is not found
   * (controller maps to 404). vehicleId is immutable (omitted from the schema).
   * `serviceScheduleId` is mutable: re-linking re-runs the vehicle-match check
   * against the STORED vehicleId. The service distinguishes "client provided
   * null" (unlink) from "client did not mention" (leave it) via hasOwnProperty.
   */
  async update(id: string, input: UpdateServiceRecordInput): Promise<ServiceRecord | null> {
    const existing = await this.prisma.serviceRecord.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    const has = (key: keyof UpdateServiceRecordInput): boolean =>
      Object.prototype.hasOwnProperty.call(input, key);

    // Re-link to a (non-null) schedule re-validates the vehicle-match against
    // the record's immutable stored vehicleId.
    if (input.serviceScheduleId) {
      await this.assertScheduleBelongsToVehicle(input.serviceScheduleId, existing.vehicleId);
    }

    const data: Prisma.ServiceRecordUncheckedUpdateInput = {
      ...(has("serviceScheduleId") && { serviceScheduleId: input.serviceScheduleId ?? null }),
      ...(input.performedAt !== undefined && { performedAt: input.performedAt }),
      ...(has("odometerKm") && { odometerKm: input.odometerKm ?? null }),
      ...(has("engineHours") && { engineHours: input.engineHours ?? null }),
      ...(has("notes") && { notes: input.notes ?? null }),
    };

    try {
      return await this.prisma.serviceRecord.update({ where: { id }, data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_RECORD_NOT_FOUND
      ) {
        // Row vanished between the findUnique and the update (concurrent delete).
        return null;
      }
      throw mapRecordWriteError(error, existing.vehicleId, input.serviceScheduleId ?? null);
    }
  }

  /**
   * Hard delete. Returns true on delete, false when the record was not found
   * (P2025), so the controller shapes the 404. No P2003 arm — nothing FKs INTO
   * ServiceRecord (the B4 ExpenseLog cost-link points the other way).
   */
  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.serviceRecord.delete({ where: { id } });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_RECORD_NOT_FOUND
      ) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Fetch one record by id or throw NotFoundException (HTTP 404). Convenience
   * wrapper for the controller's GET /:id handler; the message echoes the id.
   */
  async getById(id: string): Promise<ServiceRecord> {
    const record = await this.findById(id);
    if (!record) {
      throw new NotFoundException(`Service record ${id} not found`);
    }
    return record;
  }

  /**
   * Assert the referenced schedule exists and belongs to the same vehicle as
   * the record (ADR-0037 c5). A missing schedule → 400 (clean, pre-empts the
   * FK's P2003); a vehicle mismatch → 400. Rotation of the fuel-logs
   * trip-vehicle consistency check.
   */
  private async assertScheduleBelongsToVehicle(
    serviceScheduleId: string,
    vehicleId: string,
  ): Promise<void> {
    const schedule = await this.prisma.serviceSchedule.findUnique({
      where: { id: serviceScheduleId },
      select: { vehicleId: true },
    });
    if (!schedule) {
      throw new BadRequestException(`Service schedule ${serviceScheduleId} does not exist.`);
    }
    if (schedule.vehicleId !== vehicleId) {
      throw new BadRequestException(
        `Service schedule ${serviceScheduleId} belongs to a different vehicle; ` +
          "a service record must reference a schedule on the same vehicle.",
      );
    }
  }
}

// Translate a Prisma write error into the HTTP-facing exception. A P2003 on a
// ServiceRecord write is a stale FK: name the offending field in the 400 per
// docs/runbook/api-error-mapping.md (the web actions layer pattern-matches the
// message to set the field token). serviceScheduleId is pre-checked in the
// service, so in practice P2003 names vehicleId (or, defensively, createdById).
// Non-P2003 errors pass through unchanged (Nest renders them as 500).
function mapRecordWriteError(
  error: unknown,
  vehicleId: string,
  serviceScheduleId: string | null,
): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === PRISMA_FK_VIOLATION) {
    const meta = error.meta as { field_name?: string; constraint?: string } | undefined;
    const fieldName = String(meta?.field_name ?? meta?.constraint ?? "").toLowerCase();
    if (fieldName.includes("createdby")) {
      return new BadRequestException("Authenticated user no longer exists; sign in again.");
    }
    if (fieldName.includes("serviceschedule") && serviceScheduleId) {
      return new BadRequestException(`Service schedule ${serviceScheduleId} does not exist.`);
    }
    return new BadRequestException(`Vehicle ${vehicleId} does not exist.`);
  }
  return error;
}

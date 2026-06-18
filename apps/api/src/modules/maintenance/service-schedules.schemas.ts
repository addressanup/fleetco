import { z } from "zod";

// Zod schemas for the ServiceSchedule aggregate (ADR-0037 / Program B, B3).
// Mirrors the proven aggregate pattern (customers.schemas.ts /
// geofences.schemas.ts): enum lists duplicated from the Prisma enums (so this
// validation file does NOT pull the Prisma runtime), `.strict()` on every
// object so a typo'd or server-controlled key surfaces as HTTP 400,
// comma-separated multi-value enum filters via `csvEnum`, and an explicit
// pagination ceiling mirrored from the service-side LIST_TAKE_MAX.
//
// A ServiceSchedule is a recurring maintenance interval for a vehicle, measured
// in ONE of three dimensions (DISTANCE_KM / ENGINE_HOURS / CALENDAR_DAYS) by an
// integer intervalValue in that dimension's minor units (km / tenths-of-an-hour
// / days — never a float, ADR-0037 c2). The meter-consistency rule (an
// ENGINE_HOURS schedule needs an hour-metered vehicle, ADR-0037 c3) needs a DB
// lookup and so lives at the service layer, not here — the rotation of the
// geofences type/ownership service-side check.

// ServiceIntervalType — must mirror the Prisma enum. Order matches so an audit
// grep finds both lists side by side; order has no runtime significance.
const INTERVAL_TYPES = ["DISTANCE_KM", "ENGINE_HOURS", "CALENDAR_DAYS"] as const;
export type ServiceIntervalTypeName = (typeof INTERVAL_TYPES)[number];

// ServiceScheduleStatus — must mirror the Prisma enum (a schedule can be paused
// without deleting it, ADR-0037 c8f).
const SCHEDULE_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type ServiceScheduleStatusName = (typeof SCHEDULE_STATUSES)[number];

// Whitelist of sortable columns. Allowing an arbitrary column would invite
// expensive sorts and accidental information disclosure — the same defense
// every other list schema documents. `name` and `createdAt` cover the routine
// admin queries; the model has @@index([status]) but status is a filter, not a
// sort, like the customers surface.
const SORTABLE_COLUMNS = ["name", "createdAt"] as const;
export type ServiceScheduleSortColumn = (typeof SORTABLE_COLUMNS)[number];

const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type ServiceScheduleSortDir = (typeof SORT_DIRECTIONS)[number];

// Pagination ceiling duplicated from service-schedules.service.ts on purpose:
// the service is the runtime authority. Both constants must move together.
const QUERY_MAX_TAKE = 200;

// Integer-minor-units bounds. intervalValue is a positive integer in the
// type's minor units (km / tenths-of-an-hour / days), so the floor is 1 (a
// zero-or-negative interval is nonsensical). The meter readings are
// non-negative integers (a brand-new asset reads 0). The 100M ceiling is the
// odometer convention — way above any real value, but it catches an accidental
// milliliters-into-km / hours-into-tenths paste. Never a Float (CLAUDE.md /
// ADR-0037 c2).
const INTERVAL_VALUE_MIN = 1;
const INTERVAL_VALUE_MAX = 100_000_000;
const METER_READING_MIN = 0;
const METER_READING_MAX = 100_000_000;
const NAME_MAX = 256;
const DESCRIPTION_MAX = 2048;

const Name = z.string().trim().min(1, "Name is required.").max(NAME_MAX, "Name is too long.");

const Description = z
  .string()
  .trim()
  .max(DESCRIPTION_MAX, `Description must be at most ${DESCRIPTION_MAX} characters.`);

const IntervalTypeEnum = z.enum(INTERVAL_TYPES, {
  error: () => `intervalType must be one of: ${INTERVAL_TYPES.join(", ")}.`,
});

const StatusEnum = z.enum(SCHEDULE_STATUSES, {
  error: () => `Status must be one of: ${SCHEDULE_STATUSES.join(", ")}.`,
});

const IntervalValue = z
  .number({ error: () => "intervalValue must be an integer." })
  .int("intervalValue must be an integer.")
  .min(INTERVAL_VALUE_MIN, `intervalValue must be ${INTERVAL_VALUE_MIN} or greater.`)
  .max(INTERVAL_VALUE_MAX, `intervalValue must be ${INTERVAL_VALUE_MAX} or less.`);

const LastServiceOdometerKm = z
  .number({ error: () => "lastServiceOdometerKm must be an integer." })
  .int("lastServiceOdometerKm must be an integer.")
  .min(METER_READING_MIN, `lastServiceOdometerKm must be ${METER_READING_MIN} or greater.`)
  .max(METER_READING_MAX, `lastServiceOdometerKm must be ${METER_READING_MAX} or less.`);

const LastServiceEngineHours = z
  .number({ error: () => "lastServiceEngineHours must be an integer (tenths of an hour)." })
  .int("lastServiceEngineHours must be an integer (tenths of an hour).")
  .min(METER_READING_MIN, `lastServiceEngineHours must be ${METER_READING_MIN} or greater.`)
  .max(METER_READING_MAX, `lastServiceEngineHours must be ${METER_READING_MAX} or less.`);

// `lastServiceAt` accepts YYYY-MM-DD or ISO 8601 strings (and any value
// `new Date(...)` can parse). The coerced Date reaches the service. Mirror of
// the date helpers in fuel-logs / jobs schemas. Optional on create — the
// service defaults it to now() when the operator does not supply a backdated
// "last serviced at" (ADR-0037 c4 anchor seeding).
const LastServiceAt = z.coerce.date({
  error: () => "lastServiceAt must be a valid date (YYYY-MM-DD or ISO 8601).",
});

// cuid shape for the `vehicleId` FK, identical to the fuel-logs / geofences
// `Cuid` helper: loose enough to accept any Prisma cuid() without zod's strict
// `.cuid()` false-rejections, tight enough to keep garbage out. A stale-but-
// cuid-shaped id slips to the service and fails the insert (Prisma P2003 → 400)
// there.
const Cuid = z
  .string()
  .trim()
  .min(1, "Required.")
  .regex(/^c[a-z0-9]{8,}$/i, "Must be a valid id.");

// `vehicleId` list filter: cuid-shaped, single value. An empty string (e.g.
// `?vehicleId=`) normalizes to `undefined` so the service omits the filter
// rather than asking Prisma for `where vehicleId = ''`. Same shape as the
// fuel-logs / geofences CuidFilter.
const CuidFilter = z
  .string()
  .optional()
  .transform((raw, ctx): string | undefined => {
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return undefined;
    if (!/^c[a-z0-9]{8,}$/i.test(trimmed)) {
      ctx.addIssue({ code: "custom", message: "Must be a valid id." });
      return z.NEVER;
    }
    return trimmed;
  });

// Turn a single-string-or-comma-separated query value into a validated,
// deduplicated array of enum members. An empty result maps to `undefined` so
// the service omits the filter rather than asking Prisma for `where in ()`.
// Identical in shape to every other aggregate's csvEnum; per-file duplication
// (within and across modules) is the deferred-promotion convention the
// customers / geofences schemas document.
function csvEnum<T extends readonly [string, ...string[]]>(values: T) {
  const member = z.enum(values);
  return z
    .string()
    .optional()
    .transform((raw, ctx): T[number][] | undefined => {
      if (raw === undefined || raw === "") return undefined;
      const parts = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (parts.length === 0) return undefined;
      const seen = new Set<T[number]>();
      for (const part of parts) {
        const parsed = member.safeParse(part);
        if (!parsed.success) {
          ctx.addIssue({ code: "custom", message: `Must be one of: ${values.join(", ")}.` });
          return z.NEVER;
        }
        seen.add(parsed.data);
      }
      return Array.from(seen);
    });
}

// Coerce a string query param to a bounded non-negative integer. Out-of-range
// values return 400 with a clear message rather than being silently clamped.
// Same helper shape as every other list schema.
function intParam(min: number, max: number, fieldLabel: string) {
  return z
    .string()
    .optional()
    .transform((raw, ctx): number | undefined => {
      if (raw === undefined || raw === "") return undefined;
      const n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        ctx.addIssue({ code: "custom", message: `${fieldLabel} must be an integer.` });
        return z.NEVER;
      }
      if (n < min) {
        ctx.addIssue({ code: "custom", message: `${fieldLabel} must be ${min} or greater.` });
        return z.NEVER;
      }
      if (n > max) {
        ctx.addIssue({ code: "custom", message: `${fieldLabel} must be ${max} or less.` });
        return z.NEVER;
      }
      return n;
    });
}

// GET /api/v1/service-schedules query parameters. Filter (vehicleId / status) +
// sort + pagination, mirroring the customers / geofences list contracts.
// `.strict()` so a typo'd query key surfaces as 400 rather than being silently
// ignored.
export const ListServiceSchedulesQuerySchema = z
  .object({
    vehicleId: CuidFilter,
    status: csvEnum(SCHEDULE_STATUSES),
    sortBy: z.enum(SORTABLE_COLUMNS).optional(),
    sortDir: z.enum(SORT_DIRECTIONS).optional(),
    skip: intParam(0, Number.MAX_SAFE_INTEGER, "skip"),
    take: intParam(1, QUERY_MAX_TAKE, "take"),
  })
  .strict();

export type ListServiceSchedulesQuery = z.infer<typeof ListServiceSchedulesQuerySchema>;

// POST /api/v1/service-schedules body. Required: vehicleId, name, intervalType,
// intervalValue. Optional: description, status (defaults ACTIVE at the
// service), and the last-service anchor (lastServiceAt / lastServiceOdometerKm
// / lastServiceEngineHours — seeded by the service from the vehicle's current
// readings when omitted, ADR-0037 c4). `createdById` is NOT accepted from the
// client — the controller pulls it from `request.session.user.id`; `.strict()`
// rejects it (and any other server-owned key).
export const CreateServiceScheduleSchema = z
  .object({
    vehicleId: Cuid,
    name: Name,
    description: Description.nullable().optional(),
    intervalType: IntervalTypeEnum,
    intervalValue: IntervalValue,
    status: StatusEnum.optional(),
    lastServiceAt: LastServiceAt.optional(),
    lastServiceOdometerKm: LastServiceOdometerKm.nullable().optional(),
    lastServiceEngineHours: LastServiceEngineHours.nullable().optional(),
  })
  .strict();

export type CreateServiceScheduleInput = z.infer<typeof CreateServiceScheduleSchema>;

// PATCH /api/v1/service-schedules/:id — partial update. Every mutable field is
// optional (diff-PATCH semantics). `vehicleId` is NOT in the shape and so
// `.strict()` rejects it: a schedule records a fact about which vehicle it
// belongs to, and re-pointing it would corrupt the anchor semantics (mirror of
// the fuel-logs / expense-logs immutable-vehicleId rule). `intervalType` IS
// mutable — the service re-validates the meter-consistency rule against the
// stored vehicle's meterType when it changes. The empty-body refine rejects a
// no-op PATCH as 400 rather than silently returning the unchanged row.
export const UpdateServiceScheduleSchema = z
  .object({
    name: Name.optional(),
    description: Description.nullable().optional(),
    intervalType: IntervalTypeEnum.optional(),
    intervalValue: IntervalValue.optional(),
    status: StatusEnum.optional(),
    lastServiceAt: LastServiceAt.optional(),
    lastServiceOdometerKm: LastServiceOdometerKm.nullable().optional(),
    lastServiceEngineHours: LastServiceEngineHours.nullable().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required.",
  });

export type UpdateServiceScheduleInput = z.infer<typeof UpdateServiceScheduleSchema>;

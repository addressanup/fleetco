import { z } from "zod";

// Zod schemas for the Fuel-logs slice. Iter 19 added the read path
// (ListFuelLogsQuerySchema); iter 20 added write schemas alongside it
// (CreateFuelLogSchema, UpdateFuelLogSchema) including the
// write-time totalCostPaisa derivation rule documented at
// FuelLogsService.create / update. Keeping the read and write schemas
// in one file lets a future reviewer reading either PR see the
// adjacent contract.
//
// Mirrors apps/api/src/modules/jobs/jobs.schemas.ts (iter 17 → iter
// 18) in shape and convention — the iter-19 / iter-20 kickoffs call
// out the Jobs read- and write-path schemas as the reference shape.
// Same `.strict()` discipline (a typo'd key surfaces as HTTP 400,
// and the strictness is the wire-side enforcement of the iter-20
// rule that totalCostPaisa is server-derived and never accepted from
// the client), the same intParam helper for coerced bounds, and the
// same per-aggregate MAX_TAKE that mirrors the service-side
// LIST_TAKE_MAX.

// Whitelist of sortable columns. The iter-19 ticket explicitly scopes
// sorts to `date` and `createdAt` — the Vehicle and Liters columns are
// not sortable in iter 19 (keeping scope tight; sorting on litersMl
// would invite "sort by what unit?" UX questions a future iter can
// address alongside the per-vehicle km/L reports). Allowing arbitrary
// columns would also invite expensive sorts and accidental information
// disclosure on free-form text columns (`sortBy=notes` is the same
// defense the Trips / Jobs schemas document).
const SORTABLE_COLUMNS = ["date", "createdAt"] as const;
export type FuelLogSortColumn = (typeof SORTABLE_COLUMNS)[number];

const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type FuelLogSortDir = (typeof SORT_DIRECTIONS)[number];

// Pagination ceiling duplicated from fuel-logs.service.ts on purpose:
// the service is the runtime authority (the schema can only validate
// what the client sent; it cannot speak for the database). Both
// constants must move together when one changes; the same coupling
// jobs.schemas.ts / trips.schemas.ts document.
const QUERY_MAX_TAKE = 200;

// Coerce a string-typed query param to a non-negative integer with
// bounds checking. Same shape as the Jobs / Trips schema helper;
// out-of-range values return 400 with a clear message rather than
// being silently clamped — a deliberate `take=10000` clamped to 200
// would surprise an API consumer who expected to receive what they
// asked for.
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

// `vehicleId` / `tripId` filters: cuid-shaped, single value. The
// iter-19 ticket scopes these to cuid; this is a tighter contract
// than the Jobs `customerId` filter (which accepts any string) but
// the Fuel-log read path adds two FK filters at once and the cuid
// guard prevents `?vehicleId=&tripId=` from producing two empty-
// string equality filters in the service. An empty string after the
// `optional()` is normalized to `undefined` so the service omits the
// filter rather than asking Prisma for `where vehicleId = ''`.
const CuidFilter = z
  .string()
  .optional()
  .transform((raw, ctx): string | undefined => {
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return undefined;
    // cuid format check — minimal: starts with 'c', alphanumeric,
    // 24+ chars. We do not pull zod's z.string().cuid() because the
    // Prisma cuid() default produces strings that the strict v2
    // checker rejects in some toolchain versions. The loose check
    // here is enough to keep accidental query-string garbage out
    // without rejecting legitimate ids.
    if (!/^c[a-z0-9]{8,}$/i.test(trimmed)) {
      ctx.addIssue({ code: "custom", message: "Must be a valid id." });
      return z.NEVER;
    }
    return trimmed;
  });

// Date-range filters. `z.coerce.date()` accepts YYYY-MM-DD and ISO
// 8601 timestamps; an invalid value (e.g., "not-a-date") fails the
// parse. The bounds are inclusive at the service layer (gte / lte).
const DateFilter = z.coerce
  .date({ error: () => "Must be a valid date (YYYY-MM-DD or ISO 8601)." })
  .optional();

export const ListFuelLogsQuerySchema = z
  .object({
    vehicleId: CuidFilter,
    tripId: CuidFilter,
    startDate: DateFilter,
    endDate: DateFilter,
    sortBy: z.enum(SORTABLE_COLUMNS).optional(),
    sortDir: z.enum(SORT_DIRECTIONS).optional(),
    skip: intParam(0, Number.MAX_SAFE_INTEGER, "skip"),
    take: intParam(1, QUERY_MAX_TAKE, "take"),
  })
  // Strict so a typo'd query key (e.g., `?vehicelId=...`) surfaces as
  // 400 rather than being silently ignored. Matches the Jobs / Trips /
  // Customers contracts.
  .strict();

export type ListFuelLogsQuery = z.infer<typeof ListFuelLogsQuerySchema>;

// ---------------------------------------------------------------------
// Write-path schemas (iter 20) — POST and PATCH bodies.
// ---------------------------------------------------------------------
//
// Both schemas are `.strict()` so an unexpected key (e.g. a client
// trying to set `totalCostPaisa` or `createdById` directly, or a
// typo'd field name) surfaces as HTTP 400 with a clear message rather
// than being silently dropped. Three server-controlled fields rely on
// this strictness:
//
//   - `totalCostPaisa` is DERIVED server-side from
//     `Math.round(litersMl * pricePerLiterPaisa / 1000)` and is never
//     accepted from the wire. Documented on FuelLogsService.create /
//     update; the rule is the iter-20 closure for CLAUDE.md §"Money
//     & units" and the glossary's Fuel-log "iter-20" note.
//
//   - `createdById` is derived from the authenticated session and
//     must never be accepted from the wire (same rule every other
//     aggregate enforces — Vehicles, Drivers, Customers, Jobs, Trips).
//
//   - `id` / `createdAt` / `updatedAt` are also out of scope on the
//     wire by Prisma convention. The `.strict()` enforces it.
//
// `vehicleId` is REQUIRED on POST and IMMUTABLE on PATCH (the PATCH
// schema's `.strict()` rejects it). The rationale: a fuel log records
// a fact about which vehicle was fueled. Changing the FK after the
// fact silently rewrites history — a log that pumped fuel into
// vehicle A becomes a log that pumped fuel into vehicle B, and any
// km/L report computed against the original FK becomes a lie. Same
// precedent as the Jobs iter-18 immutability of `customerId`.
//
// `tripId` is MUTABLE on PATCH (it IS in the update shape). The
// rationale: the operator may pair a previously-unattributed fill
// with a trip after the trip is created, or unpair a fill if the
// receipt turns out to belong to a different journey. Setting tripId
// to null explicitly clears the pairing. The service re-runs the
// cross-field trip-vehicle-consistency check against the merged
// shape when tripId is touched.

// Liters bounds. The Prisma column is `Int` (milliliters, per the
// money-as-minor-units rule mechanically extended to volume; see
// CLAUDE.md §"Money & units"). The wire accepts the same integer.
// Lower bound: 1 mL (a 0-mL fill is a corrupted record, not a
// legitimate one — the operator pumped *something*). Upper bound: a
// tanker fill of 100,000 L is 100_000_000 mL, well within `Int`'s
// signed 32-bit range (2^31 - 1 = 2_147_483_647). 1_000_000_000 mL
// (one million liters) is a sane defense ceiling that no construction
// truck will ever approach but a typo or unit-mistake (entering
// liters as the integer when meaning milliliters) cannot cross.
const LITERS_ML_MIN = 1;
const LITERS_ML_MAX = 1_000_000_000;

// Price-per-liter bounds. paisa (1/100 NPR). Ceiling: NPR 100,000 /
// liter = 10,000,000 paisa, two orders of magnitude above the
// expected NPR ~150–200 / liter Nepal pump price, so a typo'd extra
// digit fails the schema rather than ending up in a per-vehicle
// fuel-cost report.
const PRICE_PAISA_MIN = 1;
const PRICE_PAISA_MAX = 10_000_000;

// Odometer bounds. Same shape as the Vehicle / Trip odometer fields.
// Upper bound 100M km is way above any real vehicle's lifetime but
// catches an accidental milliliters-into-km paste; lower bound zero
// is the inclusive floor for a brand-new vehicle whose odometer
// reads 0 at first fill.
const ODOMETER_MIN = 0;
const ODOMETER_MAX = 100_000_000;

// Free-form text bounds. Station / receipt number / notes columns
// are `String?` (unbounded in Postgres); the ceilings here keep the
// surface predictable. The receipt-number ceiling is tight because a
// fuel-station receipt number in practice is on the order of 10-30
// chars; notes is roomy because the operator may attach context.
const STATION_MAX = 256;
const RECEIPT_NUMBER_MAX = 64;
const NOTES_MAX = 4096;

const LitersMl = z
  .number({ error: () => "litersMl must be an integer." })
  .int("litersMl must be an integer.")
  .min(LITERS_ML_MIN, `litersMl must be ${LITERS_ML_MIN} or greater.`)
  .max(LITERS_ML_MAX, `litersMl must be ${LITERS_ML_MAX} or less.`);

const PricePerLiterPaisa = z
  .number({ error: () => "pricePerLiterPaisa must be an integer." })
  .int("pricePerLiterPaisa must be an integer.")
  .min(PRICE_PAISA_MIN, `pricePerLiterPaisa must be ${PRICE_PAISA_MIN} or greater.`)
  .max(PRICE_PAISA_MAX, `pricePerLiterPaisa must be ${PRICE_PAISA_MAX} or less.`);

const OdometerReadingKm = z
  .number({ error: () => "odometerReadingKm must be an integer." })
  .int("odometerReadingKm must be an integer.")
  .min(ODOMETER_MIN, `odometerReadingKm must be ${ODOMETER_MIN} or greater.`)
  .max(ODOMETER_MAX, `odometerReadingKm must be ${ODOMETER_MAX} or less.`);

const Station = z
  .string()
  .trim()
  .max(STATION_MAX, `Station must be at most ${STATION_MAX} characters.`);

const ReceiptNumber = z
  .string()
  .trim()
  .max(RECEIPT_NUMBER_MAX, `Receipt number must be at most ${RECEIPT_NUMBER_MAX} characters.`);

const Notes = z.string().max(NOTES_MAX, `Notes must be at most ${NOTES_MAX} characters.`);

// `date` accepts YYYY-MM-DD or ISO 8601 strings (and any value that
// `new Date(...)` can parse). The coerced Date is what reaches the
// service. Mirror of the date helpers in jobs.schemas.ts.
const FuelLogDate = z.coerce.date({
  error: () => "Must be a valid date (YYYY-MM-DD or ISO 8601).",
});

// cuid shape for write-path FK ids. Tighter than the Jobs
// `customerId` filter (which accepts any non-empty string) — the
// iter-20 kickoff scopes write-path ids to cuid the same way the
// read-path filters do. The service translates an invalid (but
// cuid-shaped) id into a Prisma P2003 → 400 with a field-level error
// if it slips through.
const Cuid = z
  .string()
  .trim()
  .min(1, "Required.")
  .regex(/^c[a-z0-9]{8,}$/i, "Must be a valid id.");

/**
 * POST /api/v1/fuel-logs body schema. Required: vehicleId, date,
 * litersMl, pricePerLiterPaisa. Optional: tripId (nullable; a fill
 * may or may not be paired with a trip — the canonical "depot top-up
 * between jobs" case from the glossary), odometerReadingKm, station,
 * receiptNumber, notes.
 *
 * `totalCostPaisa` is intentionally NOT in this schema. It is derived
 * server-side by FuelLogsService.create from
 * `Math.round(litersMl * pricePerLiterPaisa / 1000)`; the rounding
 * rule (half-up, not banker's) matches the operator's mental model
 * for cash receipts in Nepal and the printed receipts they audit
 * against. The `.strict()` rejects any client attempt to set the
 * field; documenting the prohibition here is worth the line so a
 * reviewer asking "why isn't totalCostPaisa in the schema?" sees the
 * answer.
 *
 * `createdById` is also excluded for the same reason; the controller
 * pulls it from the authenticated session per ADR-0021.
 *
 * Cross-field rule: when `tripId` is present, the referenced Trip's
 * `vehicleId` must match this fuel log's `vehicleId`. The check
 * cannot run at the schema layer (it needs a database lookup) and so
 * is enforced at the service layer; see FuelLogsService.create.
 */
export const CreateFuelLogSchema = z
  .object({
    vehicleId: Cuid,
    tripId: Cuid.nullable().optional(),
    date: FuelLogDate,
    litersMl: LitersMl,
    pricePerLiterPaisa: PricePerLiterPaisa,
    odometerReadingKm: OdometerReadingKm.nullable().optional(),
    station: Station.nullable().optional(),
    receiptNumber: ReceiptNumber.nullable().optional(),
    notes: Notes.nullable().optional(),
  })
  .strict();

export type CreateFuelLogInput = z.infer<typeof CreateFuelLogSchema>;

/**
 * PATCH /api/v1/fuel-logs/:id body schema. Every mutable field is
 * optional (diff-PATCH semantics, mirror of CustomersService.update /
 * JobsService.update / DriversService.update).
 *
 * Two server-controlled / immutable fields are NOT in the shape and
 * so `.strict()` rejects any attempt to set them:
 *
 *   - `totalCostPaisa` — derived; re-computed by the service when
 *     either `litersMl` or `pricePerLiterPaisa` is touched, against
 *     the MERGED shape (current row + patch). A PATCH that touches
 *     only `pricePerLiterPaisa` re-derives totalCostPaisa against
 *     the stored `litersMl`. Same derivation rule as create.
 *
 *   - `vehicleId` — a fuel log records a fact about which vehicle
 *     was fueled. Changing the FK silently rewrites history (see the
 *     prose at the top of this file). Re-creating the fuel log
 *     against the right vehicle is the right move when the operator
 *     realises the original was logged against the wrong one.
 *
 * `tripId` IS in the shape: pairing / unpairing a fill with a trip
 * is a routine post-create correction (the operator may not know
 * which trip a fill belongs to until the trip is created and they
 * reconcile receipts). The service re-runs the trip-vehicle-
 * consistency check against the merged shape when tripId is touched.
 */
export const UpdateFuelLogSchema = z
  .object({
    tripId: Cuid.nullable().optional(),
    date: FuelLogDate.optional(),
    litersMl: LitersMl.optional(),
    pricePerLiterPaisa: PricePerLiterPaisa.optional(),
    odometerReadingKm: OdometerReadingKm.nullable().optional(),
    station: Station.nullable().optional(),
    receiptNumber: ReceiptNumber.nullable().optional(),
    notes: Notes.nullable().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required.",
  });

export type UpdateFuelLogInput = z.infer<typeof UpdateFuelLogSchema>;

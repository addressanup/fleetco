import { z } from "zod";

// Web-side form schemas for the Jobs write path (iter 18). Mirrors the
// API's CreateJobSchema / UpdateJobSchema (apps/api/src/modules/jobs/
// jobs.schemas.ts) at the field level and the cross-field-rule level.
// The API is authoritative; these give the operator immediate inline
// feedback before a round-trip.
//
// Duplication-budget rationale matches customers-schema.ts / trips-
// schema.ts: a shared workspace package is deferred; the API rejects
// anything sent incorrectly, so client drift is a UX cost, not a
// correctness one.
//
// `jobNumber` and `customerId` are not in the Update shape: jobNumber
// is server-generated and permanent; reassigning a job's customer is
// out of scope (the API's `.strict()` rejects both on PATCH). The
// create form collects `customerId` (a picker) but not `jobNumber`.

const JOB_STATUSES = ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;

const DESCRIPTION_MAX = 2048;
const NOTES_MAX = 4096;

// `<input type="date">` value: YYYY-MM-DD or empty. The action layer
// sends non-empty values straight through (the API's z.coerce.date()
// accepts YYYY-MM-DD) and omits / nulls empties.
const OptionalDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$|^$/, "Use the YYYY-MM-DD date format.")
  .optional();

// Shared fields for create + update. `customerId` is added only to the
// create schema (immutable after creation). Cross-field rules
// (end >= start on each pair) are applied via superRefine on each
// derived schema; YYYY-MM-DD strings compare correctly lexicographically.
const sharedShape = {
  description: z
    .string()
    .trim()
    .min(1, "Description is required.")
    .max(DESCRIPTION_MAX, "Description is too long."),
  status: z.enum(JOB_STATUSES, {
    error: () => `Status must be one of: ${JOB_STATUSES.join(", ")}.`,
  }),
  scheduledStartDate: OptionalDateString,
  scheduledEndDate: OptionalDateString,
  actualStartDate: OptionalDateString,
  actualEndDate: OptionalDateString,
  notes: z.string().trim().max(NOTES_MAX, "Notes are too long.").optional(),
};

interface DatePairs {
  scheduledStartDate?: string;
  scheduledEndDate?: string;
  actualStartDate?: string;
  actualEndDate?: string;
}

function present(value: string | undefined): boolean {
  return value !== undefined && value.length > 0;
}

// The cross-field rule, shared by create + update superRefines. When
// both ends of a pair are present, end >= start. Mirrors the API's
// validateJobCrossFields.
function checkDatePairs(data: DatePairs, ctx: z.RefinementCtx): void {
  if (
    present(data.scheduledStartDate) &&
    present(data.scheduledEndDate) &&
    (data.scheduledEndDate as string) < (data.scheduledStartDate as string)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scheduledEndDate"],
      message: "Scheduled end must be on or after scheduled start.",
    });
  }
  if (
    present(data.actualStartDate) &&
    present(data.actualEndDate) &&
    (data.actualEndDate as string) < (data.actualStartDate as string)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["actualEndDate"],
      message: "Actual end must be on or after actual start.",
    });
  }
}

// Create form: customerId (the picker) is required; status defaults to
// PLANNED in the form's defaultValues but is always sent.
export const CreateJobFormSchema = z
  .object({
    customerId: z.string().min(1, "Pick a customer."),
    ...sharedShape,
  })
  .superRefine(checkDatePairs);

export type CreateJobFormValues = z.infer<typeof CreateJobFormSchema>;

// Update form: every field optional (PATCH semantics). No customerId /
// jobNumber — both immutable. The edit form computes a diff against
// initial values; the action sends only changed keys.
export const UpdateJobFormSchema = z.object(sharedShape).partial().superRefine(checkDatePairs);

export type UpdateJobFormValues = z.infer<typeof UpdateJobFormSchema>;

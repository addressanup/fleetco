import { Injectable } from "@nestjs/common";
// Every `@prisma/client` symbol used here is a TYPE (Prisma.Invoice* generics,
// the InvoiceStatus / DocumentType enums in type position) — there is no value
// usage (unlike CustomersService's `instanceof Prisma.PrismaClientKnownRequestError`
// on its write path), so the whole import is type-only.
import type { Prisma, InvoiceStatus, DocumentType } from "@prisma/client";

import type { InvoiceSortColumn, InvoiceSortDir } from "./invoices.schemas";

// PrismaService is injected by NestJS via TypeScript's emitDecoratorMetadata
// (see apps/api/tsconfig.json); the class reference must remain a value import at
// runtime so the DI container can resolve it. Same eslint override as the
// Customers / Jobs / Reports services.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from "../prisma/prisma.service";

// Pagination defaults and bounds. Same `LIST_TAKE_` prefix and 200 ceiling as
// every prior aggregate (Customers / Jobs / Trips / Fuel logs / Expense logs).
export const LIST_TAKE_DEFAULT = 20;
export const LIST_TAKE_MAX = 200;
const LIST_TAKE_MIN = 1;

// Slim projection for the list endpoint. The list page (D6) renders the invoice
// number, the customer name (via nested include), the status + document-type
// badges, the gross + net-receivable totals, and the issue date; pulling only
// those columns via a nested Prisma `select` keeps the wire payload small as the
// ledger grows. The detail endpoint uses the broader `findById` shape (full
// nested customer + optional job + the lines) so the detail page can render every
// field and deep-link back to /customers/<id> and /jobs/<id>.
//
// The Prisma `select` literal is the runtime authority for what the list endpoint
// returns; the controller's InvoiceListItem type (re-exported from this file)
// shapes the wire response from this same select, so a divergence is a compile
// error at the call site rather than a silently dropped field. The frozen money
// columns are nullable until issue (D2/D3), so a DRAFT row carries nulls here —
// expected, not a bug.
const LIST_SELECT = {
  id: true,
  number: true,
  status: true,
  documentType: true,
  customerId: true,
  jobId: true,
  grossPaisa: true,
  netReceivablePaisa: true,
  issuedAt: true,
  createdAt: true,
  createdById: true,
  customer: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.InvoiceSelect;

// The list item shape — derived from LIST_SELECT via Prisma's payload helper so
// the controller's response type and the tests share the precise shape.
export type InvoiceListItem = Prisma.InvoiceGetPayload<{ select: typeof LIST_SELECT }>;

// The detail shape — full Invoice + the full nested Customer (always present; the
// FK is NOT NULL), the optional nested Job (nullable FK), and the owned lines
// (ordered oldest-first so they render in the order they were captured). D4 will
// populate the lines from a job's trips; D1 returns whatever lines exist (none,
// until the write path lands).
const DETAIL_INCLUDE = {
  customer: true,
  job: true,
  lines: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.InvoiceInclude;

export type InvoiceDetail = Prisma.InvoiceGetPayload<{ include: typeof DETAIL_INCLUDE }>;

export interface ListResult {
  items: InvoiceListItem[];
  total: number;
}

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List invoices with optional filter / sort / pagination. Returns the slim
   * projection (LIST_SELECT) so the wire payload stays small even as the ledger
   * grows; the detail endpoint uses findById with the broader DETAIL_INCLUDE.
   *
   * Defaults (when the caller passes no overrides): 20 rows, newest first by
   * createdAt — matches every prior list surface. The `id` secondary tiebreaker
   * (when createdAt itself is the primary) or the `createdAt` secondary (when any
   * other column is primary) keeps paginated results deterministic — without it,
   * two rows with identical primary sort values can flip between page loads and
   * either duplicate or skip a row.
   *
   * `number` is nullable until issue (D3); Prisma's default null-ordering sorts
   * nulls last in asc and first in desc, which is the right shape for "issued
   * documents by number" — unnumbered DRAFTs slide to one end where they make
   * sense as "not yet issued".
   *
   * `skip` and `take` are clamped to safe bounds (`LIST_TAKE_MAX = 200`) as
   * defense-in-depth: the controller validates `take` against the same ceiling
   * via `ListInvoicesQuerySchema`, but the service may also be called from inside
   * other modules / future tickets (D4 assembles lines, D6 renders pages), and a
   * clamp here ensures the database is never asked for an unbounded result.
   */
  async list({
    skip = 0,
    take = LIST_TAKE_DEFAULT,
    status,
    documentType,
    customerId,
    sortBy = "createdAt",
    sortDir = "desc",
  }: {
    skip?: number;
    take?: number;
    status?: InvoiceStatus[];
    documentType?: DocumentType[];
    customerId?: string;
    sortBy?: InvoiceSortColumn;
    sortDir?: InvoiceSortDir;
  }): Promise<ListResult> {
    const safeSkip = Number.isFinite(skip) && skip >= 0 ? Math.floor(skip) : 0;
    const safeTakeRaw = Number.isFinite(take) ? Math.floor(take) : LIST_TAKE_DEFAULT;
    const safeTake = Math.min(Math.max(safeTakeRaw, LIST_TAKE_MIN), LIST_TAKE_MAX);

    // Build the WHERE clause once; reuse it for both findMany and count so
    // `total` matches what findMany would return at skip=0/take=infinity. Empty
    // arrays must not produce `in: []` (which matches zero rows in Prisma) — the
    // schema's csvEnum normalizes those to undefined, but a belt-and-braces check
    // here keeps the service robust against any future direct caller that does
    // not go through the schema.
    const where: Prisma.InvoiceWhereInput = {
      ...(status && status.length > 0 ? { status: { in: status } } : {}),
      ...(documentType && documentType.length > 0 ? { documentType: { in: documentType } } : {}),
      ...(customerId ? { customerId } : {}),
    };

    // Primary sort by the requested column + direction; secondary tiebreaker on
    // createdAt (or id, when createdAt itself is the primary) so paginated
    // results are stable across requests. Same shape as JobsService.list and
    // CustomersService.list.
    const orderBy: Prisma.InvoiceOrderByWithRelationInput[] = [
      { [sortBy]: sortDir } as Prisma.InvoiceOrderByWithRelationInput,
      ...(sortBy === "createdAt"
        ? [{ id: sortDir } as Prisma.InvoiceOrderByWithRelationInput]
        : [{ createdAt: "desc" } as Prisma.InvoiceOrderByWithRelationInput]),
    ];

    const [items, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        skip: safeSkip,
        take: safeTake,
        where,
        orderBy,
        select: LIST_SELECT,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Fetch one invoice by id with its full nested Customer, optional Job, and the
   * owned lines. Returns `null` when not found rather than throwing, so the
   * controller shapes the 404 and the service stays usable from other modules /
   * future tickets without exception handling for the not-found path (D3's issue
   * flow and D5's PDF render both load an invoice by id).
   */
  async findById(id: string): Promise<InvoiceDetail | null> {
    return this.prisma.invoice.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  }
}

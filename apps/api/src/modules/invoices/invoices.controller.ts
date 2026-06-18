import { Controller, Get, NotFoundException, Param, Query, UseGuards } from "@nestjs/common";

import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AuthGuard } from "../auth/auth.guard";

// InvoicesService is injected by NestJS via emitDecoratorMetadata; the class
// reference must remain a value import at runtime so the DI container can resolve
// it. Same pattern the Customers / Jobs / Reports controllers use.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  InvoicesService,
  LIST_TAKE_DEFAULT,
  type InvoiceDetail,
  type InvoiceListItem,
} from "./invoices.service";
import {
  ListInvoicesQuerySchema,
  type InvoiceSortColumn,
  type InvoiceSortDir,
  type ListInvoicesQuery,
} from "./invoices.schemas";

export interface InvoicesListResponse {
  items: InvoiceListItem[];
  total: number;
  skip: number;
  take: number;
  // Echo the effective sort back so the web client can render the active-column
  // indicator without re-deriving from URL params. Defaults match the service:
  // createdAt desc. Same wire contract as JobsListResponse / CustomersListResponse
  // so the web client can reuse its paginator and sortable-header components.
  sortBy: InvoiceSortColumn;
  sortDir: InvoiceSortDir;
}

// Route prefix: `api/v1/invoices`. Same versioning convention as Customers / Jobs
// (controller-level prefix). Per ADR-0021 §6 every route on this controller is
// auth-guarded at the controller level so a future route inherits the gate by
// default — opt-out would require an explicit decorator, the right direction for
// an admin-only surface.
//
// D1 ships the READ path ONLY (GET list + GET :id). The write path — create,
// issue (D3), update, cancel — and the PDF download (D5) layer on in later
// tickets. These two routes match the Jobs / Customers read surface in shape and
// validation conventions so the web client's API helpers and form patterns
// transfer without surprises.
//
// NOTE on RBAC: like the Phase-1 aggregates, this controller is AuthGuard-only
// (not RolesGuard-gated) — invoicing is an admin/office surface in v1; any role
// gating is a later decision (ADR-0039 does not scope invoice RBAC, and the web
// surface is admin-facing in Phase 4).
@Controller("api/v1/invoices")
@UseGuards(AuthGuard)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  /**
   * List invoices with filter / sort / pagination. ZodValidationPipe runs
   * `ListInvoicesQuerySchema` over the full query object, which:
   *   - rejects unknown query keys (`.strict()`) with HTTP 400
   *   - parses `status` / `documentType` from comma-separated strings into
   *     deduplicated enum arrays
   *   - normalizes `customerId` (empty string -> undefined = no filter)
   *   - parses `skip` / `take` from strings and enforces the 1..200 ceiling
   *   - validates `sortBy` against the whitelist (`createdAt` / `number`)
   *
   * Defaults applied here (when the validated query omits a field) mirror the
   * service's defaults so the echoed `sortBy` / `sortDir` / `skip` / `take` are
   * always the values that actually ran the query — the anchors the web client's
   * pagination and sort-indicator UI read.
   */
  @Get()
  async list(
    @Query(new ZodValidationPipe(ListInvoicesQuerySchema)) query: ListInvoicesQuery,
  ): Promise<InvoicesListResponse> {
    const skip = query.skip ?? 0;
    const take = query.take ?? LIST_TAKE_DEFAULT;
    const sortBy: InvoiceSortColumn = query.sortBy ?? "createdAt";
    const sortDir: InvoiceSortDir = query.sortDir ?? "desc";

    const { items, total } = await this.invoices.list({
      skip,
      take,
      status: query.status,
      documentType: query.documentType,
      customerId: query.customerId,
      sortBy,
      sortDir,
    });
    return { items, total, skip, take, sortBy, sortDir };
  }

  /**
   * Fetch one invoice by id, with the nested Customer, optional Job, and the
   * owned lines. 404 when the row does not exist, with the id named in the
   * message so an operator chasing a bad URL sees exactly which id missed.
   * Mirrors JobsController.getById / CustomersController.getById.
   */
  @Get(":id")
  async getById(@Param("id") id: string): Promise<InvoiceDetail> {
    const invoice = await this.invoices.findById(id);
    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }
    return invoice;
  }
}

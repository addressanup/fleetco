// Invoice tax-rate constants (Program D / ADR-0039 commitment 3 + commitment 9).
//
// These are the PROPOSED Nepal VAT / TDS rates the D2 calculator
// (`invoice-tax.ts`) applies and the D3 issue flow FREEZES onto each invoice as a
// per-invoice snapshot. Storing the rate ON the invoice (the `vatRateBp` /
// `tdsRateBp` columns landed in D1) is the anti-tamper guarantee of ADR-0039
// c3/c5: a future statutory rate change is forward-only and never rewrites the
// numbers on an invoice that was already issued. So these constants are the
// DEFAULTS captured at issue, not a live rate read at render.
//
// ⚠️ PROPOSED — pending operator/accountant verification (ADR-0039 c9). The PO
// accepted BUILDING NOW with these proposed values (see ADR-0039 ## Acceptance,
// 2026-06-18); the verification against current Inland Revenue Department (IRD)
// rules is a DEFERRED operator gate before any real billing, NOT a pre-build gate.
// Each value below carries the flag inline so the gate is visible at the point of
// use. A silent edit to any value here fails the explicit-value assertion in
// `apps/api/test/invoice-tax.test.ts`.
//
// The module is PURE — plain numeric constants, no DB, no I/O, no Prisma runtime
// (the InvoiceServiceType import is type-only, so this file never pulls the
// generated client). Integer basis points only; the money math stays integer
// paisa in `invoice-tax.ts`.
import type { InvoiceServiceType } from "@prisma/client";

// VAT rate in BASIS POINTS (1 bp = 0.01%). 1300 bp = 13%, the standard Nepal VAT
// rate. Basis points (not a float percent) keep the rate an exact integer so the
// `Math.round(taxable * vatRateBp / 10000)` computation never introduces a float
// rate factor — integer in, integer out, the FuelLogsService.deriveTotalCostPaisa
// discipline applied to tax.
//
// PROPOSED — operator/accountant must verify before real use (ADR-0039 c9)
export const INVOICE_VAT_RATE_BP = 1300;

// TDS (Tax Deducted at Source) rate in BASIS POINTS, selected by the invoice's
// service type. TDS is WITHHELD by the payer (the customer) and remitted to the
// IRD on FleetCo's behalf — it does NOT change the gross amount billed; it is
// captured so the invoice can show FleetCo's expected net receivable
// (ADR-0039 c3).
//
//   VEHICLE_HIRE    150 bp = 1.5% — vehicle / equipment hire
//   GOODS_TRANSPORT 250 bp = 2.5% — goods carriage (transport) within Nepal
//
// WHICH service maps to WHICH rate, and whether a given job is "hire" or
// "transport", is precisely the accountant-verified detail the agent must not
// assume (ADR-0039 c9). The `Record<InvoiceServiceType, number>` type is the
// drift guard: if a future migration adds a third InvoiceServiceType member, this
// object becomes a compile error until the new rate is supplied here.
//
// PROPOSED — operator/accountant must verify before real use (ADR-0039 c9)
export const INVOICE_TDS_RATE_BP: Record<InvoiceServiceType, number> = {
  VEHICLE_HIRE: 150,
  GOODS_TRANSPORT: 250,
};

// The basis-point denominator: a rate in basis points divided by 10_000 yields
// the fraction (1300 / 10_000 = 0.13). Named so the calculator reads as
// `taxable * rateBp / BASIS_POINTS_DENOMINATOR` rather than a bare magic 10000.
export const BASIS_POINTS_DENOMINATOR = 10_000;

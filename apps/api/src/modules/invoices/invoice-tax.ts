// The invoice VAT + TDS calculator (Program D / ADR-0039 commitment 3).
//
// This is a PURE function — primitives in, the frozen-snapshot shape out. No DB,
// no Prisma runtime, no I/O. D3's issue `$transaction` calls it to compute the
// tax breakdown ONCE and freeze every figure onto the Invoice row (the
// `subtotalPaisa` / `discountPaisa` / `vatRateBp` / `vatPaisa` / `grossPaisa` /
// `tdsRateBp` / `tdsPaisa` / `netReceivablePaisa` columns landed in D1). Once
// frozen, an issued invoice's numbers are a historical fact and are never
// recomputed at render (ADR-0039 c3/c5, the anti-tamper freeze) — which is also
// why the rates RIDE in the returned snapshot (`vatRateBp` / `tdsRateBp`), not
// just read from the constants at compute time: D3 freezes the snapshot's rates,
// so a future statutory rate change is forward-only.
//
// Every amount is integer paisa (1 NPR = 100 paisa; CLAUDE.md money-as-minor-
// units) and every rounding is half-up via `Math.round`, exactly the
// FuelLogsService.deriveTotalCostPaisa rule (integer in, integer out, half-up at
// the boundary) applied to a new computation. The rates are basis points from the
// FLAGGED proposed constants (`invoice-tax.constants.ts`); see ADR-0039 c9 — they
// are operator/accountant-verify before real billing.
import type { InvoiceServiceType } from "@prisma/client";

import {
  BASIS_POINTS_DENOMINATOR,
  INVOICE_TDS_RATE_BP,
  INVOICE_VAT_RATE_BP,
} from "./invoice-tax.constants";

/** Inputs to {@link computeInvoiceTax}: the captured line amounts, an optional
 * discount, and the service type that selects the TDS rate. All paisa values are
 * integers (the LINE is where the selling amount is first captured — D4); the
 * calculator validates that and refuses a float (the "no float leak" guard). */
export interface ComputeInvoiceTaxInput {
  /** The billable line amounts in integer paisa (each line's
   * `quantity * unitPricePaisa`, supplied by D4). Summed to the subtotal. An
   * empty array is valid and yields an all-zero snapshot — the "≥ 1 line"
   * requirement is a D3 issue-flow validation, not the pure calculator's job. */
  lineAmountsPaisa: number[];
  /** Optional discount in integer paisa applied to the subtotal; the DISCOUNTED
   * figure is the taxable base (ADR-0039 c3). Must not exceed the subtotal — a
   * discount larger than the bill is rejected (a non-negative taxable base is the
   * invariant). Omitted / undefined means no discount (treated as 0). */
  discountPaisa?: number;
  /** Selects the applicable TDS rate from {@link INVOICE_TDS_RATE_BP}
   * (VEHICLE_HIRE → 1.5%, GOODS_TRANSPORT → 2.5%). */
  serviceType: InvoiceServiceType;
}

/** The frozen tax snapshot — the exact shape of the nullable-until-issue columns
 * on the `Invoice` row (D1). D3 writes these onto the invoice at issue. */
export interface InvoiceTaxSnapshot {
  /** Σ of the line amounts, integer paisa, BEFORE any discount. */
  subtotalPaisa: number;
  /** The discount applied (the normalized input; 0 when none). */
  discountPaisa: number;
  /** The VAT rate in basis points actually used (frozen into the snapshot). */
  vatRateBp: number;
  /** VAT = round(taxable * vatRateBp / 10000), integer paisa, half-up. */
  vatPaisa: number;
  /** Gross = taxable + VAT — the amount legally billed to the customer. */
  grossPaisa: number;
  /** The TDS rate in basis points actually used (frozen into the snapshot). */
  tdsRateBp: number;
  /** TDS = round(taxable * tdsRateBp / 10000), integer paisa, half-up. A MEMO:
   * TDS is withheld by the payer and does NOT change `grossPaisa`. */
  tdsPaisa: number;
  /** Net receivable = gross − TDS — the cash FleetCo expects after the customer
   * withholds TDS and remits it to the IRD on FleetCo's behalf. */
  netReceivablePaisa: number;
  /** Echoed back so the snapshot is self-describing for D3's freeze. */
  serviceType: InvoiceServiceType;
}

/**
 * Compute a tax amount in integer paisa from a base and a basis-point rate,
 * half-up. This is the FuelLogsService.deriveTotalCostPaisa rule generalized:
 * integer base × integer rate, divided by the basis-point denominator, rounded
 * half-up via `Math.round`. Exported so the rounding rule itself is pinned by a
 * focused unit test (as `deriveTotalCostPaisa` is).
 *
 * Worked boundary: base = 50 paisa, rateBp = 1300 → 50 * 1300 / 10000 = 6.5 →
 * `Math.round` → 7 paisa. Half-up resolves the .5 upward; truncation would give
 * 6 and banker's-rounding (round-half-to-even) would also give 6 (6 is even), so
 * 7 is the half-up signature. `base` and `rateBp` are non-negative integers, so
 * the product is non-negative and `Math.round`'s round-half-toward-+∞ behaviour
 * is exactly half-up (the negative-argument asymmetry of `Math.round` never
 * applies here).
 */
export function computeTaxPaisa(basePaisa: number, rateBp: number): number {
  return Math.round((basePaisa * rateBp) / BASIS_POINTS_DENOMINATOR);
}

/**
 * Compute the full VAT + TDS breakdown for an invoice and return the frozen
 * snapshot (ADR-0039 c3). Pure: no DB, no I/O.
 *
 * The arithmetic, all integer paisa, all half-up via {@link computeTaxPaisa}:
 *   subtotalPaisa      = Σ lineAmountsPaisa
 *   taxablePaisa       = subtotalPaisa − discountPaisa            (≥ 0, guarded)
 *   vatPaisa           = round(taxablePaisa * vatRateBp / 10000)
 *   grossPaisa         = taxablePaisa + vatPaisa                  (billed to customer)
 *   tdsPaisa           = round(taxablePaisa * tdsRateBp / 10000)  (memo; withheld by payer)
 *   netReceivablePaisa = grossPaisa − tdsPaisa                    (cash FleetCo expects)
 *
 * Worked example (a multi-line invoice, no discount, VEHICLE_HIRE):
 *   lines [1_000_000, 235_050] → subtotal 1_235_050, taxable 1_235_050
 *   vat   = round(1_235_050 * 1300 / 10000) = round(160_556.5) = 160_557  (half-up;
 *           truncation → 160_556, banker's → 160_556, so 160_557 is the signature)
 *   gross = 1_235_050 + 160_557 = 1_395_607
 *   tds   = round(1_235_050 * 150 / 10000) = round(18_525.75) = 18_526
 *   net   = 1_395_607 − 18_526 = 1_377_081
 *
 * Guards (a financial calculator refuses garbage rather than silently coercing
 * it): every line amount and the discount must be a non-negative SAFE integer
 * (`Number.isSafeInteger`, which rejects floats, NaN, ±Infinity, and magnitudes
 * past 2^53 — the "no float leak" guard from the input side), and the discount
 * must not exceed the subtotal (a non-negative taxable base is the invariant; we
 * REJECT rather than clamp, because silently shrinking an operator's discount on
 * a tax document would be a quiet data-integrity bug on a compliance surface).
 * Realistic invoice amounts sit far inside the safe-integer domain — the rest of
 * the system bounds a single money field at 10_000_000_000 paisa (NPR 100M), and
 * taxable × 1300 for any such amount stays well under 2^53, so the half-up
 * `Math.round` is exact (see the floating-point note on `computeTaxPaisa`).
 */
export function computeInvoiceTax(input: ComputeInvoiceTaxInput): InvoiceTaxSnapshot {
  const { lineAmountsPaisa, serviceType } = input;

  // Validate + sum the line amounts. A non-integer / negative / non-finite /
  // absurdly-large value throws RangeError naming the offender's index, so a D4
  // bug surfaces loudly rather than as a float leaking into a frozen money column.
  let subtotalPaisa = 0;
  for (let i = 0; i < lineAmountsPaisa.length; i++) {
    const amount = lineAmountsPaisa[i];
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new RangeError(
        `lineAmountsPaisa[${i}] must be a non-negative integer (paisa); received ${String(amount)}.`,
      );
    }
    subtotalPaisa += amount;
  }
  // Guard the accumulated sum too: enough huge lines could overflow the safe
  // range even when each line was individually safe.
  if (!Number.isSafeInteger(subtotalPaisa)) {
    throw new RangeError("subtotalPaisa overflowed the safe-integer range.");
  }

  // Normalize + validate the discount.
  const discountPaisa = input.discountPaisa ?? 0;
  if (!Number.isSafeInteger(discountPaisa) || discountPaisa < 0) {
    throw new RangeError(
      `discountPaisa must be a non-negative integer (paisa); received ${String(input.discountPaisa)}.`,
    );
  }
  if (discountPaisa > subtotalPaisa) {
    throw new RangeError(
      `discountPaisa (${discountPaisa}) cannot exceed subtotalPaisa (${subtotalPaisa}); ` +
        "a discount larger than the bill is not allowed.",
    );
  }

  // The discounted figure IS the taxable base (ADR-0039 c3). Non-negative by the
  // guard above.
  const taxablePaisa = subtotalPaisa - discountPaisa;

  // VAT: rate frozen into the snapshot; amount half-up. gross = taxable + VAT is
  // the amount legally billed.
  const vatRateBp = INVOICE_VAT_RATE_BP;
  const vatPaisa = computeTaxPaisa(taxablePaisa, vatRateBp);
  const grossPaisa = taxablePaisa + vatPaisa;

  // TDS: rate selected by service type, amount half-up. It is a MEMO withheld by
  // the payer — it does NOT enter `grossPaisa`. Net receivable = gross − TDS.
  const tdsRateBp = INVOICE_TDS_RATE_BP[serviceType];
  const tdsPaisa = computeTaxPaisa(taxablePaisa, tdsRateBp);
  const netReceivablePaisa = grossPaisa - tdsPaisa;

  return {
    subtotalPaisa,
    discountPaisa,
    vatRateBp,
    vatPaisa,
    grossPaisa,
    tdsRateBp,
    tdsPaisa,
    netReceivablePaisa,
    serviceType,
  };
}

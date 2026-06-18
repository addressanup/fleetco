import { describe, expect, test } from "vitest";

import {
  buildAvailabilitySignal,
  buildReminderDeliverySignal,
  enrichLogWithAvailabilitySignal,
  isAvailabilityGood,
  isReminderDeliveryGood,
  SLI_API_AVAILABILITY,
  SLI_LATENCY_BUDGET_MS,
  SLI_REMINDER_DELIVERY,
} from "../src/common/sli";
import { MailerSendError } from "../src/modules/notifications/mailer";

// Unit tests for the FleetCo-authored API-availability SLI seams (ADR-0011,
// T_SLI1). Per the ticket we pin the pure helpers — not pino-http's internal
// logging behaviour. Tests run with LOG_LEVEL=fatal, so the contract is
// asserted through the pure functions rather than by capturing emitted logs.

describe("SLI_LATENCY_BUDGET_MS", () => {
  test("is ADR-0011's 500ms latency threshold", () => {
    expect(SLI_LATENCY_BUDGET_MS).toBe(500);
  });
});

describe("isAvailabilityGood", () => {
  // The exact boundary table the ticket specifies.
  test("a fast 2xx is good", () => {
    expect(isAvailabilityGood(200, 100)).toBe(true);
  });

  test("exactly the latency budget is still good (<= boundary)", () => {
    expect(isAvailabilityGood(200, 500)).toBe(true);
  });

  test("one millisecond past the budget is bad", () => {
    expect(isAvailabilityGood(200, 501)).toBe(false);
  });

  test("a fast 3xx redirect is good", () => {
    expect(isAvailabilityGood(301, 100)).toBe(true);
  });

  test("a 4xx is bad even when fast (the API did not serve it successfully)", () => {
    expect(isAvailabilityGood(400, 10)).toBe(false);
  });

  test("a 5xx is bad even when fast", () => {
    expect(isAvailabilityGood(503, 10)).toBe(false);
  });
});

describe("buildAvailabilitySignal", () => {
  test("tags a good request with the api_availability sli and sli_good=true", () => {
    expect(buildAvailabilitySignal(200, 120)).toEqual({
      sli: "api_availability",
      http_status: 200,
      response_time_ms: 120,
      sli_good: true,
    });
  });

  test("a slow 2xx is sli_good=false but still records status and duration", () => {
    expect(buildAvailabilitySignal(200, 900)).toEqual({
      sli: SLI_API_AVAILABILITY,
      http_status: 200,
      response_time_ms: 900,
      sli_good: false,
    });
  });

  test("a 5xx is sli_good=false", () => {
    expect(buildAvailabilitySignal(503, 12)).toEqual({
      sli: SLI_API_AVAILABILITY,
      http_status: 503,
      response_time_ms: 12,
      sli_good: false,
    });
  });
});

describe("enrichLogWithAvailabilitySignal", () => {
  test("merges the signal onto a success completion object using pino-http's responseTime", () => {
    const enriched = enrichLogWithAvailabilitySignal(
      { statusCode: 200 },
      { responseTime: 42, res: { statusCode: 200 } },
    );

    expect(enriched).toMatchObject({
      // preserves pino-http's own completion-object fields …
      responseTime: 42,
      res: { statusCode: 200 },
      // … and adds the SLI signal, latency sourced from val.responseTime (no drift)
      sli: "api_availability",
      http_status: 200,
      response_time_ms: 42,
      sli_good: true,
    });
  });

  test("merges the signal onto an error completion object and preserves err", () => {
    const err = new Error("boom");
    const enriched = enrichLogWithAvailabilitySignal(
      { statusCode: 503 },
      { responseTime: 7, res: { statusCode: 503 }, err },
    );

    expect(enriched).toMatchObject({
      err,
      sli: "api_availability",
      http_status: 503,
      response_time_ms: 7,
      sli_good: false,
    });
  });

  test("defaults response_time_ms to 0 when pino-http supplied no numeric responseTime", () => {
    const enriched = enrichLogWithAvailabilitySignal({ statusCode: 200 }, {});

    expect(enriched).toMatchObject({
      response_time_ms: 0,
      sli_good: true, // a 200 in 0ms is within budget
    });
  });

  test("does not mutate the input completion object", () => {
    const val: Record<string, unknown> = { responseTime: 10 };
    enrichLogWithAvailabilitySignal({ statusCode: 200 }, val);
    expect(val).toEqual({ responseTime: 10 });
  });
});

// The reminder-delivery SLI (ADR-0038 c8). Mirrors the API-availability pattern:
// pin the pure helpers, not the logging behaviour. The valid event is a send
// ATTEMPT; "good" means the attempt completed without a thrown error.
describe("SLI_REMINDER_DELIVERY", () => {
  test("is the reminder_delivery tag", () => {
    expect(SLI_REMINDER_DELIVERY).toBe("reminder_delivery");
  });
});

describe("isReminderDeliveryGood", () => {
  test("no error (undefined / null) is a good attempt", () => {
    expect(isReminderDeliveryGood()).toBe(true);
    expect(isReminderDeliveryGood(undefined)).toBe(true);
    expect(isReminderDeliveryGood(null)).toBe(true);
  });

  test("a thrown error is a bad attempt", () => {
    expect(isReminderDeliveryGood(new Error("boom"))).toBe(false);
    expect(isReminderDeliveryGood(new MailerSendError("rate_limit_exceeded"))).toBe(false);
    expect(isReminderDeliveryGood("a non-Error throw")).toBe(false);
  });
});

describe("buildReminderDeliverySignal", () => {
  test("a successful attempt tags reminder_delivery with sli_good=true and no error_kind", () => {
    expect(buildReminderDeliverySignal()).toEqual({
      sli: "reminder_delivery",
      sli_good: true,
    });
  });

  test("a failed attempt carries the exception CLASS NAME as error_kind", () => {
    expect(buildReminderDeliverySignal(new MailerSendError("validation_error"))).toEqual({
      sli: SLI_REMINDER_DELIVERY,
      sli_good: false,
      error_kind: "MailerSendError",
    });
    expect(buildReminderDeliverySignal(new Error("boom"))).toEqual({
      sli: SLI_REMINDER_DELIVERY,
      sli_good: false,
      error_kind: "Error",
    });
  });

  test("a non-Error throw degrades to UnknownError", () => {
    expect(buildReminderDeliverySignal("a string")).toEqual({
      sli: SLI_REMINDER_DELIVERY,
      sli_good: false,
      error_kind: "UnknownError",
    });
  });

  test("never leaks err.message — which could embed the recipient address (Tier-2 PII)", () => {
    // A MailerSendError is constructed PII-free, but defense-in-depth: the signal
    // carries only the class name, never any message text, even when the underlying
    // error's message contains an email-like string.
    const leaky = new Error("failed to deliver to operator@fleetco.example");
    const signal = buildReminderDeliverySignal(leaky);
    expect(signal.error_kind).toBe("Error");
    expect(JSON.stringify(signal)).not.toContain("operator@fleetco.example");
    expect(JSON.stringify(signal)).not.toContain("@");
  });
});

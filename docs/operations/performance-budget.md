# Performance budget

This file is the project's operational memory for the Phase-1 performance budget: the latency and page-load targets the system commits to, recorded as the budget of record so a future reader knows what "fast enough" means without re-deriving it. The numbers are fixed by the Phase-1 roadmap (`docs/product/roadmap.md` §"Phase 1 — The Spine"); this file quotes them verbatim and explains how each is measured. The performance budget is the latency-objective companion to the API-availability SLI in ADR-0011: the availability SLI asks whether each individual request succeeded within budget, while the performance budget asks whether the latency _distribution_ across all requests stays within budget.

This file's update cadence is the following. The budget numbers themselves are fixed by the roadmap and change only when the roadmap (or a superseding ADR) changes them; such a change travels in the same PR that edits the roadmap, so the two cannot drift. The measured-against-budget reporting — the actual P95 and P99 latency and the actual admin first-contentful-paint — begins at the first production deploy and, once there is live data, is reviewed on the same monthly cadence as the ADR-0011 SLOs. Until that first deploy this file is the committed budget only, not a record of measurements; the "Current status" section below states this explicitly so no reader mistakes a committed target for a live result.

## The budget

The three targets, quoted verbatim from `docs/product/roadmap.md` §"Phase 1 — The Spine" ("A performance budget is committed (P95 API latency under 500 milliseconds, P99 under 1500 milliseconds, admin first-contentful-paint under 2 seconds on a Nepal 3G connection) and tracked"):

- **P95 API latency under 500 milliseconds.** The 95th percentile of API request latency stays below 500 ms.
- **P99 API latency under 1500 milliseconds.** The 99th percentile of API request latency stays below 1500 ms.
- **Admin first-contentful-paint under 2 seconds on a Nepal 3G connection.** The Next.js admin web app paints first content within 2 s when loaded over a connection profile representative of Nepal 3G.

## How each is measured

**API latency (P95 and P99).** Both percentiles are computed from the same per-request latency the API already emits: the `response_time_ms` field on the `sli: "api_availability"` signal that is merged onto every request-completion log line. That signal is produced by `apps/api/src/common/sli.ts` (added by the SLI-instrumentation work, ADR-0011) and wired onto the pino-http completion log in `apps/api/src/app.module.ts`, so it captures 100% of completed requests. The same module exports the constant `SLI_LATENCY_BUDGET_MS` (value `500`), which the per-request availability SLI uses as its single-request latency threshold; the P95-under-500-ms budget here is the distribution-level companion to that per-request budget and is deliberately the same 500 ms number, read from the same `response_time_ms` measurement, so the committed budget and the emitted signal cannot diverge. A future 28-day or monthly report filters completion logs by `sli === "api_availability"` and takes the 95th and 99th percentiles of `response_time_ms` to evaluate these two lines of the budget. ADR-0024 wired the OpenTelemetry substrate (trace context plus trace IDs in logs); once a tracing backend exists, the same request latency is also visible as the duration of the HTTP root span, giving a second, trace-level view of the same measurement.

**Admin first-contentful-paint.** FCP is a browser-side metric, so there is no server-side instrumentation for it today and none is added by this program. It is to be measured with Lighthouse (or the `web-vitals` library) against the deployed admin web app under a throttled connection profile representative of Nepal 3G. Because it requires the deployed app and a network profile, this measurement awaits the first production deploy.

## Current status

Live tracking is not active. Phase 1 is content-complete but not yet in daily use (see `docs/CURRENT_PHASE.md`), and there has been no production deploy. This file therefore commits the budget as operational memory — the "committed" half of the roadmap's "committed and tracked" milestone — and the "tracked" half begins at the first production deploy: API P95/P99 from the `response_time_ms` signal described above, and admin FCP from a Lighthouse / web-vitals run on a Nepal-3G profile. No percentile or FCP figure is recorded here yet, and none should be added until there is real production data to record.

## Cross-references

- **ADR-0011** (`docs/architecture/decisions/0011-reliability-slos-and-incident-severity.md`) — the reliability SLOs and the two SLIs. The performance budget is the latency-objective companion to the API-availability SLI defined there, and shares its `response_time_ms` measurement and its 500 ms latency threshold.
- **ADR-0024** (`docs/architecture/decisions/0024-opentelemetry-instrumentation.md`) — the OpenTelemetry substrate (trace context and trace IDs in logs). It is the future home for trace-based latency measurement: once a tracing backend is configured, request latency is visible at the trace layer in addition to the log-layer `response_time_ms` field the budget uses today.

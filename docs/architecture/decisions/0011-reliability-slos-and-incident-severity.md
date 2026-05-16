# ADR-0011: Reliability SLOs and incident severity classification

- **Status:** Accepted
- **Date:** 2026-05-09
- **Decider:** Product owner (CEO)

## Context

The Site Reliability Engineering body of practice, developed at Google and codified in the SRE Book and SRE Workbook, anchors itself on a small number of mutually reinforcing concepts. A Service Level Indicator is a measurement of something users care about, typically expressed as the ratio of good events to valid events. A Service Level Objective is a target on that indicator over a defined time window, such as 99.0 percent availability over a 28-day rolling window. The error budget is the difference between 100 percent and the SLO, expressed as the quantity of permitted bad events; when the budget is exhausted, the team's error-budget policy dictates a halt to feature work pending reliability investment. Toil is the manual, repetitive operational work that scales linearly with service size; SRE explicitly budgets it. Postmortems are blameless and stored in a shared repository. On-call is explicit, rotated, and bounded.

For FleetCo, on-call discipline is genuinely not applicable as a solo project, since there is no rotation possible. What is applicable is the rest of the SRE stack, and adopting it before Phase 1 ships is the right time to do so, because reliability commitments are much harder to introduce after a system is live than before. The bootstrap already has the cultural scaffolding for this in the form of the postmortems folder and the runbook stubs. What it lacks is the technical commitment to specific SLIs and SLOs and a written error-budget policy.

The bootstrap also lacks an incident severity classification, which becomes important the moment Phase 1 has a real customer because severity classification is what determines how the team (currently one person) responds when something goes wrong. Without a classification, every incident gets either over-attention or under-attention, and there is no shared language for talking about what kind of incident we are in.

## Decision

We commit to a minimum viable reliability framework for Phase 1, with the explicit understanding that it will tighten as the project matures. Two SLIs are defined and tracked from the day Phase 1's first feature ships. The first is API availability, measured as the percentage of HTTP requests to the FleetCo API that return a 2xx or 3xx status within 500 milliseconds. The second is trip-creation success, measured as the percentage of trip-creation operations that complete end-to-end without producing an error visible to the user. These two SLIs together capture the most important user-facing concerns: that the system responds, and that the most central business operation (creating a trip) actually works.

The SLOs for both indicators are 99.0 percent over a 28-day rolling window. This is deliberately not the 99.9 percent or 99.99 percent that elite SRE practices target. Those higher numbers require dedicated reliability engineering, redundant infrastructure, and observability investment we do not have. 99.0 percent corresponds to about 7 hours of cumulative budget per 28 days, which is realistic for a single-VPS deployment with a one-person operations team. The SLO will tighten in Phase 2 as the system matures and the operational substrate hardens.

The error-budget policy is the following. If a single incident consumes more than 20 percent of the error budget over the rolling 28-day window, we conduct a blameless postmortem and commit to one or more concrete reliability improvements before the next feature ships. If the error budget is exhausted in any 28-day window, feature work other than P0 bug fixes and security patches is halted until the system returns to within budget for the subsequent week. The exhaustion case has not happened and may never happen, but the policy is in place so that if it does, the response is mechanical rather than negotiated under stress.

The incident severity classification has three levels. SEV1 is a customer-impacting incident in which trip creation, fuel logging, or other core business operations are unavailable or producing wrong data. The expected response is immediate (within 30 minutes of detection) and continues until service is restored. SEV2 is a customer-impacting incident in which non-core modules (reports, expense logging, compliance reminders) are degraded or unavailable, or in which a core module is degraded but still functional. The expected response is within 2 hours and continues until the next working day's start. SEV3 is a non-customer-impacting incident such as a logging gap, a backup verification failure, or a minor UI defect. The expected response is within the next working day. Every incident at SEV1 or SEV2 produces a postmortem committed to `docs/postmortems/`. SEV3 incidents do not require postmortems but do produce a tech-debt entry if a follow-up fix is needed.

## Alternatives considered

Adopting Google's standard 99.9 percent SLO was considered and rejected for the reasons described above. We do not have the operational substrate to deliver 99.9 percent reliably, and committing to a number we cannot honor would make the SLO an empty document.

Skipping the SLO and error-budget commitment until after Phase 1 ships was considered and rejected on the grounds that retrofitting reliability commitments to a live system is harder than introducing them before launch. The cost of writing this ADR now is a few hours; the cost of writing it after the first incident is dramatically higher because the writing happens under pressure and with less freedom to choose.

Adopting a more elaborate severity scale (SEV1 through SEV5, with detailed runbook entries per severity) was considered and rejected as premature elaboration. Three severity levels are sufficient for a solo project; adding more levels creates a false sense of precision and consumes maintenance attention that should go elsewhere. The scale will be revisited when there is more than one operator.

Adopting the full SRE on-call discipline (rotation, paging, escalation) was considered and rejected as not applicable to a solo project. There is no rotation. The runbook entries on incident response will be written assuming a single operator who is the founder.

## Consequences

We acquire a real reliability framework that gives the AI agent and the founder a shared language for talking about service quality. The PR template can include a question about whether a change has reliability implications. The postmortems folder, which has so far been empty, will receive its first entries when SEV1 or SEV2 incidents occur. The error-budget policy commits us to halting feature work under specific conditions, which is the kind of commitment that is easy to write and hard to honor; the writing is the first half of the work.

The cost of this framework is small relative to its value. The SLIs are measurable from data we are already collecting (Sentry for the error portion, the API logs for the latency portion). The SLOs are computed monthly. The severity classification adds a small overhead to incident response but the overhead is repaid the first time a clear severity assignment prevents an unnecessary middle-of-the-night response or focuses attention on a real customer-impacting incident.

## Revisit when

The SLOs should be revisited at the end of Phase 1 with at least eight weeks of data, to determine whether 99.0 percent was the right number or whether we should tighten or loosen it. The SLIs should be expanded as new modules ship: Phase 2's driver app will likely need a "telematics ping freshness" SLI, Phase 3's compliance reminders will need a "reminder delivery" SLI, and so on. The severity classification should be revisited if we ever have more than one operator, because severity classification interacts with on-call rotation in ways that are degenerate for a solo project.

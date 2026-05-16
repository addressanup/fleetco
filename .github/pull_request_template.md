## What

A short description of what this PR changes. Write this for a future reader who has no context from the conversation that produced the change.

## Why

Why this change is being made. Link to the phase, the slice, the ADR, or the issue this PR serves. If this change creates a new architectural decision, link to the new ADR; the ADR must be merged before the code that depends on it.

## Slice

If this PR is part of a vertical slice, identify the slice and which step of it this PR represents. For example: "Trip end-to-end, step 3 of 5 (the API endpoint and its tests)."

## Schema and data changes

Indicate whether this PR includes schema changes, and if so, whether the migration was reviewed locally with `prisma migrate dev` before being committed. Schema changes that are not migrations (such as adjustments to types or DTOs that do not require a database change) should also be noted.

If this PR introduces new data fields, indicate which data classification tier from ADR-0013 each field falls into (Tier 1 administrative, Tier 2 PII, Tier 3 operational, Tier 4 metadata) and confirm that Tier 2 and Tier 3 fields are excluded from default logging.

## Reliability and operations

Indicate whether this PR has reliability implications: does it touch a code path covered by either of the SLIs from ADR-0011 (API availability or trip-creation success), does it change the way errors are detected or recovered, does it affect the deployment process, does it affect the recovery procedure documented in the runbook.

If this PR changes operational procedures or introduces new ones, the runbook is updated in the same PR.

## Memory updates

This is the part the project's memory architecture depends on. List explicitly which memory artifacts are touched by this PR. If none should be touched, state that and explain why. The acceptable answers are not "I forgot" or "I'll add it later."

ADRs added or updated, glossary entries added or updated, runbook procedures added or updated, design slices added or archived, roadmap or current-phase tracker updated, tech-debt entries added or resolved, postmortems added (if this PR follows an incident), operational metrics updated (the DORA file is updated weekly regardless of individual PRs, but a PR that affects how a metric is computed must update the relevant section).

## Tests

Indicate which tests are included: service unit tests, module contract tests, end-to-end tests, none-and-here-is-why.

## Checklist

The reviewer should be able to verify each of these by reading the diff. Any unchecked item is a reason to delay merging.

- [ ] Lint and typecheck pass locally
- [ ] No `any`, no unjustified `@ts-ignore`
- [ ] No cross-module imports of internal files
- [ ] No real secrets present in any committed file (covered by GitHub native secrets scanning, but listed here so the human reviewer notices)
- [ ] CI security baseline passes (Dependabot, Semgrep, secrets scan, action SHA pinning per ADR-0012)
- [ ] New domain term, if any, added to `docs/glossary.md`
- [ ] If architecture changed, an ADR is added or updated
- [ ] If a procedure became routine, the runbook is updated
- [ ] If new data fields introduced, classification tier from ADR-0013 documented and logging configured appropriately
- [ ] If reliability-relevant, the SLI exposure is understood and noted
- [ ] If UI is new or replaced, tokens come from `docs/design/DESIGN.md` (no inline magic)
- [ ] If a locked mockup exists in `docs/design/slices/`, it was referenced and matched
- [ ] If a legacy surface was visually altered, that is the explicit purpose of this PR (not a side effect)
- [ ] PR description is written for a future reader who has no context

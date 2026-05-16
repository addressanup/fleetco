# DORA Metrics

This file is the project's operational memory for delivery performance. It records the four canonical DORA metrics (deployment frequency, lead time for changes, change failure rate, failed deployment recovery time) plus the rework rate, measured weekly from the data sources we already collect. The targets and the framework that produces them are documented in ADR-0010.

This file is updated weekly in the same PR that closes the week's work. The discipline is that the file is updated by the AI agent at the end of each work week, with the founder reviewing the entry as part of the weekly close. When a target is missed in any measurement window, the next planning conversation must address what changed and what we will do about it before any new feature work begins.

The format below is the structure each weekly entry follows. The first entry will appear at the end of the week in which Phase 1's first production deploy ships. Until then this file remains a stub.

## Format for weekly entries

Each entry is a section headed by the date range it covers, in the form `## Week of YYYY-MM-DD`. The entry contains five subsections, one per metric.

For deployment frequency, the entry records the number of production deployments completed during the week, the number of working days in the week, and the resulting deploys-per-working-day figure. The Phase 1 target is at least one production deploy per working day on average, measured weekly. A week with three deploys across five working days is on target; a week with one deploy across five working days is below target and triggers a planning conversation.

For lead time for changes, the entry records the median time from PR merge to production deploy completion across all deploys in the week. The Phase 1 target is under 24 hours at the median. The number is computed from GitHub Actions deployment workflow logs.

For change failure rate, the entry records the count of deploys followed within 24 hours by either a Sentry-detected error spike or a manual rollback, divided by the total deploy count for the month-to-date. The Phase 1 target is under 15 percent measured monthly, but the weekly entry shows the running figure for the current month.

For failed deployment recovery time, the entry records the time between a detected deploy failure and the deploy that restored service, for any failed deploys in the week. The Phase 1 target is under 2 hours at the 90th percentile, but for a small number of failures per week the relevant figure is just the worst-case for the week.

For rework rate, the entry records the count of follow-up PRs that fix or revise a previously merged change within 14 days, divided by the total PR count for the month-to-date. The Phase 1 target is under 25 percent measured monthly.

## Operational notes

The metrics above are honest approximations rather than perfect operational definitions. Three honest caveats are worth noting. First, "production deploy" means a deploy that reaches the production environment, not a CI build that produces an artifact; if we adopt blue-green or canary deployments later, the definition will need refinement. Second, "change failure" is detected from Sentry error spikes or manual rollbacks, which means a silent failure (a deploy that produces wrong data without raising an error) will not be captured by this metric; this is the limitation of the metric itself, not of our implementation, and the SLO framework in ADR-0011 catches some classes of silent failure that DORA-style change-failure-rate misses. Third, "rework rate" is computed by looking for follow-up PRs that mention or revert a previous PR within 14 days; this is a noisy signal because some legitimate iteration on a feature looks like rework, and some genuine rework happens slowly enough not to be caught in 14 days.

The point of the metrics is not to produce a perfect score but to produce a directional signal that we can act on. When the numbers move, we look at why. When they stay stable, we get on with the work.

## Stub: first entry

The first weekly entry will appear at the end of the week in which Phase 1's first production deploy ships. Until then this file is a stub.

# Postmortems

This folder holds postmortems for incidents that have occurred in the project's life. A postmortem is a short, blameless document that captures what happened, what the user impact was, what the timeline looked like, what the root cause was as best understood, what we changed to prevent recurrence, and what we would do differently next time. Postmortems are written within seven days of an incident's resolution while context is still fresh, and they are committed to the repository like any other piece of memory.

The folder is empty at project start because no incidents have occurred yet. Entries will accumulate as the project runs in production. Each entry will be a single markdown file named after the date and a short identifier of the incident, in the form `YYYY-MM-DD-short-identifier.md`. An example would be `2026-08-14-database-disk-full.md` for an incident on August 14, 2026 in which the production database ran out of disk space.

## When postmortems are required

The discipline established in ADR-0011 and the runbook is that all SEV1 and SEV2 incidents produce postmortems. SEV3 incidents do not require postmortems but produce a tech-debt entry if a follow-up fix is needed. Security incidents at any severity produce postmortems, because security incidents are exactly the kind that recur if not learned from; this stricter rule is documented in `docs/runbook/security-incident-response.md`.

The threshold question for whether an incident warrants a postmortem is not "was this severe enough to be embarrassing" but "did anyone (including the founder) lose time, trust, or sleep because of this, and is there anything we could learn that would prevent recurrence." The answer to the second part of the question is almost always yes for any incident worth noticing, which is why the threshold for writing a postmortem is set deliberately low.

## What goes in a postmortem

A postmortem has the following sections in order. The summary is a one-paragraph plain-English description of what happened, written for someone who was not involved. The user impact section describes who was affected and how, with the goal of being concrete about consequences rather than abstract about systems. The timeline reconstructs the sequence of events from detection to resolution, with timestamps where they are known. The root cause section explains what actually went wrong, distinguishing carefully between contributing factors and the proximate cause. The response section describes what was done to resolve the incident and what worked or did not work in the response itself. The lessons section captures what we learned, organized into "what we will change" (concrete actions with owners and dates) and "what we are accepting" (factors that contributed but that we are not changing because the cost outweighs the benefit). The action items section enumerates the specific changes from the lessons section in a form that can be tracked through to completion.

For security incidents, an additional section addresses what data was affected, what regulatory or contractual obligations were triggered, and what changes were made to the security baseline (ADR-0012) or data classification (ADR-0013) as a result.

## Why postmortems are blameless

Blameless does not mean indifferent to mistakes; it means focused on contributing factors rather than on individuals to punish. The goal of a postmortem is to convert an expensive mistake into permanent institutional knowledge, and that goal is defeated the moment the postmortem becomes a document that anyone is afraid to write or contribute to honestly. In a solo project the blameless principle is partially internal (the founder being honest with themselves rather than rationalizing) and partially external (the postmortem may be shared with the customer or with future contributors, and the writing should be honest enough to be read by them).

The blameless framing has a specific operational consequence: when a contributing factor is "the founder was tired and missed something at 11pm" or "the agent confidently produced incorrect code that the founder did not catch in review," that factor is named explicitly rather than glossed over. The action item that follows is not "be less tired" or "be more careful" but a concrete process or tooling change that reduces the chance of the same mistake recurring (an additional CI check, a refusal to deploy after a certain hour, a checklist that the founder runs through before approving any PR that touches a particular module).

## Relationship to other memory artifacts

A postmortem may produce a new ADR if the incident revealed an architectural decision that needs to be made or revised. The postmortem itself remains in this folder as the historical record; the ADR lives in `docs/architecture/decisions/` and is referenced from the postmortem.

A postmortem may produce a new runbook procedure if the response to the incident was good enough to be reusable. The procedure lives in `docs/runbook/` (or in `docs/runbook/incidents/` for incident-specific procedures) and is referenced from the postmortem.

A postmortem may produce a new tech-debt entry if a follow-up fix is identified but cannot be done immediately. The entry lives in `docs/tech-debt.md` and is referenced from the postmortem.

A postmortem may consume part of the error budget tracked under ADR-0011. If a single incident consumed more than 20 percent of the error budget over the rolling 28-day window, the postmortem must commit to specific reliability improvements before the next feature ships. This is the error-budget policy in operational form.

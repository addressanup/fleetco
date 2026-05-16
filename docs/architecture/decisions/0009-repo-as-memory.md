# ADR-0009: The repository is the project's memory

- **Status:** Accepted
- **Date:** 2026-05-09
- **Decider:** Product owner (CEO)

## Context

FleetCo is built by one person, the CEO, working with AI coding agents that have no memory across sessions. The CEO has human memory, which is unreliable across the months and years a project of this scope spans. Neither the CEO nor any individual agent session is, by itself, capable of holding the project's identity over time. We need a deliberate decision about what holds project memory across time and how that memory is structured. Without such a decision, memory exists scattered across chat logs, notes, and the heads of whichever participants happen to be present, and the project drifts as memory is lost.

## Decision

The repository is the project's memory. The substrate is the filesystem under git version control. The structure is the five categories of memory documented in `docs/architecture/memory-architecture.md`: episodic memory in `docs/architecture/decisions/`, semantic memory in `docs/glossary.md`, procedural memory in `docs/runbook/` and `BOOTSTRAP.md`, prospective memory in `docs/product/roadmap.md`, `docs/CURRENT_PHASE.md`, and `docs/tech-debt.md`, and perceptual memory in `docs/design/`. Memory updates are part of every PR that touches the relevant concept, not optional follow-up work. Stale memory is treated as worse than missing memory, because stale memory misleads and missing memory only directs the reader to investigate.

## Alternatives considered

Storing project memory in external tools (Notion, a wiki, a knowledge management product) was considered and rejected. External tools are vendor-dependent, can become unavailable, do not co-locate with code (so synchronized review is impossible), and do not benefit from the version control that git provides automatically. They are useful as iteration surfaces; they are not durable as memory.

Storing memory only in the heads of participants (the CEO's memory and whatever the current agent session happens to remember) was considered and rejected as the failure mode we are explicitly trying to avoid. Human memory is unreliable across long projects; agent memory does not exist across sessions; the project's continuity cannot depend on either.

Storing memory as code comments only, without separate documentation files, was considered and rejected because some kinds of memory (decision rationale, glossary, runbook procedures, design intent) are not natural to express as code comments and would be lost in noise if they were.

The chosen alternative — filesystem under git, with explicit categories and disciplines — has the properties of durability, version history, co-location, path-as-meaning, tool-friendliness, and human-first readability. It is the substrate that best serves the participants we have (a CEO, AI agents, and the project itself).

## Consequences

The repository acquires architectural significance beyond holding code. It is the cognitive substrate of the project. The discipline of maintaining the memory artifacts (ADRs, glossary, runbook, design folder, roadmap, current-phase tracker, tech-debt register, postmortems folder) is not housekeeping; it is what makes the project capable of thinking across sessions. The PR template enforces memory updates as part of every change. The agent operating manual (`CLAUDE.md`) grounds its rules in the memory theory, so that future agents understand why the rules exist and can apply them in edge cases the rules did not anticipate.

The cost of this decision is that memory work has to be done as part of code work, rather than deferred. The benefit is that the project has continuity across the years it will exist, and the cost of every future session starts low (read the relevant docs, work) rather than high (try to reconstruct what previous sessions decided).

## Revisit when

This decision is unlikely to be revisited. The specific tools may evolve (markdown might be supplemented with other formats over time), but the principle that the repository under git is the canonical home of project memory is stable for the life of the project.

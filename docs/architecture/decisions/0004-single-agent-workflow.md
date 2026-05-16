# ADR-0004: Single-agent workflow until end of Phase 1

- **Status:** Accepted
- **Date:** 2026-05-09
- **Decider:** Product owner (CEO)

## Context

The product owner is the sole developer of FleetCo, working with AI coding agents (primarily Claude Code). Running multiple agents in parallel using `git worktree` is a real and increasingly common technique, where one repository has multiple working directories checked out to different branches simultaneously, and each agent operates in its own working directory. The promise of parallelism is straightforward: three agents working on three things should produce more output than one agent working on one thing.

## Decision

Through Phase 0 and Phase 1, FleetCo uses one AI coding agent at a time, in one working tree. We do not parallelize. After Phase 1 ends, when conventions, schema spine, and module boundaries are stable and documented, we may run at most two agents in parallel via `git worktree`, only on slices that touch disjoint modules. We do not run three or more agents in parallel for a solo product owner under any circumstances.

## Alternatives considered

The full-parallelism alternative is what most online discussions of AI-agent productivity assume by default. The arithmetic looks compelling on the surface: more agents, more output. The problem is that the arithmetic ignores three real costs. The first is merge-conflict tax: two agents touching the same Prisma schema, the same shared types, or the same module boundary produce conflicts that someone has to resolve by hand. On a greenfield codebase where almost everything is shared scaffolding, this hits constantly. The second is architectural drift: agent A invents a pattern for error handling, agent B invents a different one. By the time the human notices, two dialects coexist in the same codebase. The third is review bottleneck: even with parallel agents, the product owner is the only human reviewer. Three PRs landing simultaneously means either rubber-stamping (which defeats the point) or becoming the bottleneck anyway.

The "deferred-parallelism" alternative, which we are choosing, accepts that solo work moves slower in raw throughput but produces less rework and less drift. Time saved on rework goes into writing good documentation and conventions, which are exactly what makes future parallelism actually viable.

## Consequences

In raw output per day, this decision means we will appear slower than the parallelism stories on social media imply. In quality of output, in stability of conventions, and in the maintainability of the resulting code, we will be substantially better off. The product owner's time goes into reviewing single, deep PRs rather than refereeing multiple shallow ones, which is also a better use of the product owner's time and attention.

The discipline that this decision creates is the foundation that later parallelism will be built on. By the end of Phase 1, the codebase will have stable conventions documented in the operating manual, clear module boundaries enforced by code review, and architectural patterns that an agent can recognize and follow. At that point, two agents working on disjoint modules can do so without producing conflicts or drift, because the surface they share is well-defined and stable.

## Revisit when

The signal to introduce two-agent parallelism is the end of Phase 1, conditional on three things being true: the codebase has stable module boundaries that an agent can identify by reading the code, the documentation includes clear conventions for error handling, logging, validation, and other cross-cutting concerns, and we have specific work that genuinely lives in disjoint modules. The signal to refuse three-or-more-agent parallelism for a solo product owner is permanent: the review bottleneck does not get easier with more parallelism, and the discipline of one PR at a time is what keeps quality high.

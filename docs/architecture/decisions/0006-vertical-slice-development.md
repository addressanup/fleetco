# ADR-0006: Vertical slice development

- **Status:** Accepted
- **Date:** 2026-05-09
- **Decider:** Product owner (CEO)

## Context

A common failure mode for AI-agent-driven greenfield projects is the horizontal-layers approach: the agent builds "the schema" first, then "the API" next, then "the UI" last. Each layer compiles. Each layer looks correct in isolation. At no point does anything actually run end-to-end until the very end, and inevitably the layers do not fit together. The mismatches are discovered late, in the form of large rework. Throughout the development period, no working software exists; only the promise of working software exists.

## Decision

FleetCo is built in vertical slices. Each slice is one user-facing workflow, built end-to-end: schema, migration, service, API, UI, and test. The slice is shippable and demoable when it lands. The next slice starts only after the current slice is in a working state.

## Alternatives considered

The horizontal-layers alternative was rejected for the reasons described above. It produces no working software during the development period, surfaces integration problems late and expensively, and gives AI agents an unbounded context (the whole layer) to work with rather than a bounded one (a single workflow), which degrades agent output quality.

The hybrid alternative (some scaffolding done horizontally, some features done vertically) was considered but rejected as a false compromise. It loses the benefit of vertical slicing (always-working software) without gaining a meaningful benefit from horizontal scaffolding. The right pattern is to scaffold only what is needed for the current slice, and to extend scaffolding when subsequent slices need it.

## Consequences

We do not design the entire database schema upfront. We grow it slice by slice, with migrations at every step. This means some early refactors as later slices reveal new constraints, which we accept as a reasonable cost. The benefit is that every slice produces working software the product owner can use the day it lands, and integration mismatches surface immediately when the slice does not work, not weeks later.

For AI agents specifically, the vertical-slice pattern works dramatically better than horizontal layers, because each slice has bounded, concrete context (this workflow, this schema, this UI), rather than the unbounded abstract context of "the schema." Bounded context is the single biggest predictor of AI-agent output quality.

Phase boundaries in the roadmap are slice-set boundaries. A phase is a set of slices that, taken together, deliver a coherent piece of business value.

## Revisit when

This decision is unlikely to be revisited; it is a working principle, not a stack choice. If the project ever needs to do a large architectural refactor that genuinely cannot be expressed as slices (such as migrating from one auth library to another), that refactor gets its own ADR and its own approach, but the default of vertical slicing for feature work remains.

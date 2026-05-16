# ADR-0007: Design system as source of truth

- **Status:** Accepted
- **Date:** 2026-05-09
- **Decider:** Product owner (CEO)

## Context

FleetCo will have a UI from Phase 1 onward. Without a deliberate decision, the visual identity of that UI will be whatever the most recent agent session happened to produce, drifting toward the agent's training defaults rather than any considered design intent. The visual identity of a product is real and load-bearing: it affects whether the user (the CEO) actually wants to use the system, whether the system feels coherent across screens, and whether maintenance work over time produces a consistent product or a patchwork. We need a deliberate place where the design intent lives, separate from the code that implements it, so that visual decisions persist across sessions and across phases.

## Decision

The canonical visual source of truth for FleetCo lives at `docs/design/`. The file `docs/design/DESIGN.md` defines the design system: tokens (colors, typography, spacing, sizing), component patterns (buttons, inputs, cards, tables, modals, navigation), voice and tone, and anti-patterns to avoid. The Tailwind theme configuration in the Next.js app derives from `docs/design/DESIGN.md`; drift between them is the failure mode and must be prevented through code review and (eventually) automated checks. When a slice introduces a new surface type that benefits from a mockup (a dashboard, a complex form, a report layout), the locked HTML mockup is committed to `docs/design/slices/<slice-name>.html` before the implementing code is written. After the implementing code merges, the mockup moves to `docs/design/slices/_archive/`.

## Alternatives considered

The default of letting visual identity emerge from code was considered and rejected. It produces drift, it leaves no place for visual decisions to be discussed without producing code, and it requires future sessions to reverse-engineer visual intent from existing screens, which inevitably produces variations. Rejected.

Storing the design system in an external tool (Figma, Notion, a brand book) was considered and rejected as a violation of the repo-as-memory principle. Anything that lives only in an external tool is, from the project's perspective, ephemeral. We can use external tools for iteration, but the conclusions must commit to the repo to count.

A bespoke from-scratch design system was considered and rejected as a poor use of solo-founder time. We will base FleetCo's design on an established system (Linear, Notion, or Vercel are the leading candidates given the dense ERP-like nature of the UI) and customize for our specific needs (NPR currency, BS dates, Devanagari font fallback, density appropriate for table-heavy ops screens).

## Consequences

The Tailwind config in the Next.js app must derive from `docs/design/DESIGN.md` rather than being independently authored. The mechanism for this derivation is to be decided in Phase 0 — the simplest version is to maintain the tokens in `DESIGN.md` and copy them into `tailwind.config.ts`, with a test or script in CI that verifies they match. A more sophisticated version (a build step that generates the Tailwind config from the markdown) can come later if drift becomes a real problem.

When external design tools (Open Design with its MCP server, Figma) are used, they are iteration surfaces. Iteration happens in the tool, the conclusion is exported to HTML and committed to `docs/design/slices/`, and from that point the committed file is canonical and the in-tool state is ephemeral. See ADR-0008 for details.

The design folder gets its own discipline: the canonical-vs-iteration separation must be maintained, mockups must be archived after implementation rather than left to clutter the active slices folder, and binary assets (images, fonts) live alongside text descriptions of what they are.

## Revisit when

This decision is unlikely to be revisited. The specifics of which base design system we customize from might change before Phase 1's first UI slice, but the principle that `docs/design/` is the canonical source of truth for visual identity is stable.

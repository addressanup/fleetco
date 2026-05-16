# ADR-0008: Iteration vs source of truth for mockups

- **Status:** Accepted
- **Date:** 2026-05-09
- **Decider:** Product owner (CEO)

## Context

External design tools, including Open Design (with its MCP server that lets coding agents read live design state) and Figma (which has plugins and exports of various kinds), are useful for iterating on visual designs. Without a deliberate rule about how external-tool state relates to repo state, designs end up living in the tool only. This violates the repo-as-memory principle: a design that lives only on the designer's laptop is not memory, because it does not survive across machines, sessions, or tool changes. It also creates a coordination problem: an AI agent implementing the slice cannot see the design unless it can talk to the tool, and tools come and go.

## Decision

External design tools are iteration surfaces. The repository at `docs/design/` is the source of truth. The mechanism is the following: iteration happens freely in the external tool (Open Design, Figma, hand-coded HTML, anywhere). When the design for a specific slice is approved as ready to implement, the design is exported to a single HTML file (or other appropriate text-based format) and committed to `docs/design/slices/<slice-name>.html`. The implementing slice references the committed file, not the tool. After the implementing code merges, the mockup is moved to `docs/design/slices/_archive/`.

For Open Design specifically, the MCP server can be used during the active iteration window to give the implementing agent live access to the design as it evolves. Once the design is locked, the agent uses the committed HTML, not the MCP. This separation prevents the project from depending on the external tool being available for the implementation to be reproducible.

## Alternatives considered

Letting designs live in external tools indefinitely was considered and rejected because it violates the repo-as-memory principle. Any design that exists only in a tool will be lost when the tool changes hands, deprecates a feature, or simply stops being something the team uses.

Forbidding external design tools entirely and requiring everything to be authored in HTML was considered and rejected because external tools are genuinely useful for iteration. The right move is not to forbid the tools but to draw a clear line between iteration and source of truth.

Maintaining both the tool state and the committed HTML as canonical was considered and rejected because two sources of truth is no source of truth. Drift between them is the failure mode, and we have no way to detect or resolve such drift mechanically.

## Consequences

The discipline this decision creates is that nothing is "designed" until it is committed. A mockup that exists only in an external tool is not yet part of the project's memory. This will sometimes feel slow when iteration is rapid, because committing is friction. The friction is intentional: it is the moment at which iteration produces a durable artifact, and forcing that moment to happen explicitly is what gives the project memory at all.

The Open Design MCP setup is per-machine and per-installation. Each developer (or CEO) who wants to use it must install Open Design locally and configure the MCP server. The path to the MCP server is therefore not committed to the repository (it would be machine-specific) but is documented in a developer-setup section of the runbook. The committed mockups in `docs/design/slices/` do not depend on Open Design being installed; they are plain HTML.

## Revisit when

This decision is stable as a principle. The specific tools we use for iteration may change over the years; the principle that committed text in the repo is the source of truth and tool state is iteration will not.

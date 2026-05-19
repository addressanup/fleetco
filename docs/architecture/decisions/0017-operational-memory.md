# ADR-0017: Operational memory as the sixth category of project memory

- **Status:** Accepted
- **Date:** 2026-05-19
- **Decider:** Product owner (CEO)

## Context

ADR-0009 (2026-05-09) decided that the repository is the project's memory, with the substrate of the filesystem under git, structured into five categories: episodic memory in `docs/architecture/decisions/`, semantic memory in `docs/glossary.md`, procedural memory in `docs/runbook/` and `BOOTSTRAP.md`, prospective memory in `docs/product/roadmap.md`, `docs/CURRENT_PHASE.md`, and `docs/tech-debt.md`, and perceptual memory in `docs/design/`.

Shortly after — alongside the delivery operating model captured in ADRs 0010 through 0013 — the project added a sixth category: operational memory, held in `docs/operations/`, for measurements taken on regular cadences. The DORA metrics file is updated weekly per ADR-0010. SLO compliance reports are computed monthly per ADR-0011. The folder, the cadence, and the discipline of treating operational measurements as memory-not-spreadsheet were all formalized in the same bootstrap wave that produced ADRs 0010 through 0013, but ADR-0009 was not updated when it happened.

The result is a discrepancy. ADR-0009's Decision section says "the five categories of memory documented in `docs/architecture/memory-architecture.md`." Every other document in the repo that counts memory categories says six. `docs/architecture/memory-architecture.md` itself has a section titled "The six categories of memory" with a labelled paragraph per category, including operational. `CLAUDE.md`'s Part 1 names six categories explicitly and gives one sentence to each. `BOOTSTRAP.md` step 5's kickoff prompt directs the agent to summarize "the six categories of memory and where each lives." `docs/glossary.md`'s Memory architecture vocabulary section has one entry per category — Episodic, Operational, Perceptual, Procedural, Prospective, Semantic — plus an entry for Substrate. `docs/operations/README.md` describes operational memory as its own category with its own cadence. ADR-0009 is the only document that still says five. The in-text cross-reference from ADR-0009 to `memory-architecture.md` makes the contradiction self-referential: ADR-0009 points at a document that disagrees with it.

ADRs are append-only. The discipline is codified in ADR-0009 itself and reiterated in `CLAUDE.md`'s "How memory artifacts behave" section. The body of any ADR is never edited; superseding a decision is done by writing a new ADR that explicitly supersedes the old one. The discipline exists because reliable episodic memory requires historical fidelity: a future reader must be able to see what was decided when, not what we wish we had decided. Editing ADR-0009 in place to change "five" to "six" would erode that invariant, and the invariant is what makes ADRs trustworthy as memory.

The fix that respects the discipline is a new ADR that narrowly supersedes ADR-0009 on the category-count claim. ADR-0009's thesis — that the repository is the project's memory, that the substrate is the filesystem under git, that memory updates are part of every PR, that stale memory is worse than missing memory — is unchanged and remains in force. ADR-0009's Status line records the partial supersession so the relationship is discoverable from ADR-0009 alone.

## Decision

Operational memory in `docs/operations/` is recognized as the **sixth category** of project memory. The project's memory architecture is structured into six categories, not five:

1. **Episodic** in `docs/architecture/decisions/`
2. **Semantic** in `docs/glossary.md`
3. **Procedural** in `docs/runbook/` and `BOOTSTRAP.md`
4. **Prospective** in `docs/product/roadmap.md`, `docs/CURRENT_PHASE.md`, and `docs/tech-debt.md`
5. **Perceptual** in `docs/design/`
6. **Operational** in `docs/operations/`

This ADR narrowly supersedes ADR-0009's "five categories" line in its Decision section. Everything else in ADR-0009 — the substrate choice (filesystem under git), the alternatives considered, the consequences accepted, the principle that stale memory is worse than missing memory — is unchanged and remains in force.

ADR-0009's Status field is updated to `Accepted; superseded in part by ADR-0017` so the relationship is discoverable from ADR-0009 alone; ADR-0009's body is not edited. The canonical six-category narrative is `docs/architecture/memory-architecture.md`, which already describes all six. Future ADRs and documents that count memory categories say six.

## Alternatives considered

**Edit ADR-0009 in place to say "six" instead of "five."** Rejected. ADRs are append-only by the discipline that ADR-0009 itself codifies and that `CLAUDE.md`'s "How memory artifacts behave" section reiterates. Editing the body of an existing ADR would erode the append-only invariant, and that invariant is what makes ADRs reliable as episodic memory. A reader six months from now would not be able to see that ADR-0009 originally said five and operational memory was a later addition; the historical record would be silently rewritten. The cost of in-place editing (loss of historical fidelity, erosion of the append-only invariant) is paid forever; the benefit (one fewer file, no qualifier on the Status line) is small. The trade is wrong, and the principle outweighs the convenience.

**Fold operational memory into one of the existing five categories.** Rejected. The most plausible folding would be into prospective memory (since operational records inform future planning) or into procedural memory (since operations are activities done over time). Neither fit is honest. Operational memory is measurement-on-cadence — records of what has happened, computed from CI and Sentry on a weekly tick. Prospective memory is intention-for-future-execution — commitments to do something later, authored as text by participants. Procedural memory is how-things-are-done — testable procedures that participants execute. The update mechanism differs (system-computed vs. participant-authored vs. participant-executed), the source differs (measurement vs. intention vs. procedure), and the failure mode differs (a missed measurement is a missed early-warning signal; a missed intention is a forgotten commitment; a missing procedure surfaces during an incident). Folding them together would obscure the distinctions and weaken the discipline that makes weekly DORA updates a non-negotiable part of the project's rhythm.

**Replace ADR-0009 entirely with a new ADR that re-states the repo-as-memory thesis with six categories.** Rejected. ADR-0009's thesis does not change. Replacing the whole ADR would discard its substantive content — the substrate justification, the four alternatives considered, the consequences accepted — for the sake of correcting one factual line. A narrow supersession is proportional to the size of the correction; a full replacement is not.

**Do nothing.** Rejected. ADR-0009 itself articulates the principle that stale memory is worse than missing memory, because stale memory tells a plausible lie a reader may act on. Leaving ADR-0009's "five" line in place — with every other document in the repo saying "six" — is exactly that failure mode. The project's own discipline requires the fix.

## Consequences

What this makes easier: future ADRs and documents can reference "six categories" without having to disclaim that ADR-0009 says five. The project's memory architecture is internally consistent. Cross-references between ADR-0009, `memory-architecture.md`, `CLAUDE.md`, `BOOTSTRAP.md`, the glossary, and `docs/operations/README.md` all describe the same architecture.

What this makes harder: ADR-0009 now has a qualified Status (`Accepted; superseded in part by ADR-0017`) rather than the clean `Accepted`. A reader of ADR-0009 must read ADR-0017 to know the current category count. This is the cost of append-only discipline applied honestly. The qualified status names ADR-0017 explicitly, so the relationship is discoverable from ADR-0009 alone — the reader is not left to guess what changed.

Costs we accept: a small amount of ongoing cognitive overhead — any future reader of ADR-0009 must look at ADR-0017 to know that the count is now six, not five. The cost is bounded (it is one extra read), recoverable (the Status line points the way), and proportional to the value of preserving ADR-0009's historical fidelity. We accept it.

Implication for future ADRs that count memory categories: they say six. If a seventh category is ever proposed, it must come through a new ADR that supersedes this one in turn — same shape, same discipline.

Implication for `docs/operations/README.md`: the README's first paragraph had inherited the pre-formalization "five primary memory categories" phrasing, positioning operational memory as a sixth-thing-that-exceeded-five rather than as the sixth member of a six-category framework. As part of the PR that lands this ADR, that phrasing is updated to match the six-category framing now codified here. The substance of the README — operational memory is its own folder, its own cadence, its own update discipline — was already correct; only the framing is brought into alignment.

## Revisit when

Any of the following:

- **A seventh memory category is proposed.** A kind of memory emerges that does not fit any of the existing six and cannot be folded into one — for example, a need to formalize the project's record of measured-but-not-acted-on signals as a distinct category from operational memory. The proposal is itself an ADR that supersedes this one.
- **Operational memory turns out to be reducible to a combination of procedural and prospective in practice.** If, after a year of weekly DORA updates and SLO reviews, the discipline does not feel structurally distinct from procedural-or-prospective work, the sixth category is removed and ADR-0017 is itself superseded.
- **The taxonomy of memory categories is reconsidered.** A different taxonomy proves more useful (for example, a split by update cadence rather than by cognitive function). At that point, ADR-0009 and ADR-0017 are both reviewed and a new framework is established by new ADR.

Otherwise, this decision is stable for the life of the project.

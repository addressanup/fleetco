# Tech Debt Register

This is the project's prospective memory for items that have been deliberately deferred and must not be lost. The tech debt register is not a wishlist of features and not a roadmap of phases; it is the place where small commitments that emerged during work-in-flight are held until they are addressed. The discipline is that nothing accepted as a future commitment leaves the conversation that produced it without being written here.

Each entry has a short title, a brief description of what is owed, the slice or PR that introduced or surfaced the debt, the reason the debt was accepted (rather than fixed in place), and a rough estimate of the work required to discharge it. Entries are removed from the register only when the debt is genuinely paid off, and the PR that pays it off mentions the debt entry in its description.

## Active debt

This section lists active debt entries. At project start, the register is empty because no code has been written yet and no decisions have been deferred. Entries will accumulate as Phase 0 and Phase 1 proceed.

## Paid-off debt

This section is an archive of debts that have been discharged. When an active entry is resolved, it moves here with a note about the PR that resolved it and the date. The archive exists so that future readers can see what kinds of debt the project tends to accumulate and what kinds of fixes tend to discharge them, which is itself a piece of organizational learning.

## Notes for future contributors

If you find yourself accepting a deferred commitment in a session — "we'll come back and clean this up later," "this is a known limitation we're shipping for now," "we'll need to revisit when X happens" — write the entry here in the same PR that creates the debt. Do not let "I'll add it later" pass; later does not arrive, and the writer's context evaporates within hours. The whole point of this register is to be the durable home for deferred work, and that only functions if entries are written at the moment the deferral is decided, not at some imagined future moment when there will be time to record them.

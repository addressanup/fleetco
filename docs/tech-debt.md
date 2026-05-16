# Tech Debt Register

This is the project's prospective memory for items that have been deliberately deferred and must not be lost. The tech debt register is not a wishlist of features and not a roadmap of phases; it is the place where small commitments that emerged during work-in-flight are held until they are addressed. The discipline is that nothing accepted as a future commitment leaves the conversation that produced it without being written here.

Each entry has a short title, a brief description of what is owed, the slice or PR that introduced or surfaced the debt, the reason the debt was accepted (rather than fixed in place), and a rough estimate of the work required to discharge it. Entries are removed from the register only when the debt is genuinely paid off, and the PR that pays it off mentions the debt entry in its description.

## Active debt

This section lists active debt entries.

### Secret scanning and secret scanning push protection unavailable at current GitHub plan tier

- **What is owed:** Enable repository-level secret scanning and secret scanning push protection for the `addressanup/fleetco` repository, satisfying in full the four-feature commitment in ADR-0012. Today, only two of the four (Dependabot alerts and Dependabot security updates) are enabled.
- **Where surfaced:** Phase 0 — Ticket 1 (repository bootstrap), first commit on `main`. The `gh api -X PATCH` calls to set `security_and_analysis.secret_scanning.status=enabled` and `security_and_analysis.secret_scanning_push_protection.status=enabled` both returned HTTP 422 with body `"Secret scanning is not available for this repository."` The repo's `security_and_analysis` field comes back as `null`, GitHub's signal that the feature is not offered for this repo/account combination — not a payload error. Verified by also attempting `secret_scanning` alone, which fails identically.
- **Why accepted now:** GitHub does not include repository-level secret scanning on private repos at the Free plan tier. Enabling it requires the GitHub Secret Protection add-on (≈$19/active-committer/month at announced pricing) or the larger GitHub Advanced Security bundle. Phase 0 contains no real secrets in the repository (only documentation), so the absence of repo-level scanning is low-risk in the immediate term. Defense-in-depth is partially provided by (a) GitHub's user-level push protection, which scans every push from the account across all repos and is free and on by default, and (b) the Semgrep job arriving in Ticket 12 per ADR-0012, whose `p/security-audit` ruleset includes secret-pattern detection that overlaps with what GitHub's scanner would catch.
- **Estimate to discharge:** ~10 minutes once the account is on a tier that includes secret scanning. The original `gh api -X PATCH` payload should then succeed unchanged; verification is one read-only `gh api /repos/addressanup/fleetco --jq '.security_and_analysis'` call.
- **Revisit when:** any of: (a) Phase 1 begins, because that is when real secrets (database password, Cloudflare R2 credentials, session secret, Sentry DSN) enter the project's operational surface, even if scoped to a local `.env`; (b) the project moves to a GitHub organization account or upgrades to a paid plan for any other reason; (c) GitHub changes the bundling or pricing of secret scanning in a way that makes enablement cheap or free.

## Paid-off debt

This section is an archive of debts that have been discharged. When an active entry is resolved, it moves here with a note about the PR that resolved it and the date. The archive exists so that future readers can see what kinds of debt the project tends to accumulate and what kinds of fixes tend to discharge them, which is itself a piece of organizational learning.

## Notes for future contributors

If you find yourself accepting a deferred commitment in a session — "we'll come back and clean this up later," "this is a known limitation we're shipping for now," "we'll need to revisit when X happens" — write the entry here in the same PR that creates the debt. Do not let "I'll add it later" pass; later does not arrive, and the writer's context evaporates within hours. The whole point of this register is to be the durable home for deferred work, and that only functions if entries are written at the moment the deferral is decided, not at some imagined future moment when there will be time to record them.

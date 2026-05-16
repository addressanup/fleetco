# Bootstrap — from this folder to a working project

This document is the procedural memory for going from the bootstrap bundle into a live repository with a first Claude Code session. Read it once, follow it once. It exists so that the procedure does not live only in someone's head, where it would be unrecoverable when needed.

## Step 1 — Create the GitHub repository

Create a private repository named `fleetco` on GitHub. The name is a placeholder and can be changed later. Do not initialize the repository with a README, because this bundle already includes one. Then, locally, in the folder containing the unzipped bundle, run the following commands. The first initializes git, the second stages all files, the third commits them with a message that describes what the commit contains, the fourth renames the default branch to `main`, the fifth points the local repository at the GitHub remote, and the sixth pushes everything to GitHub.

```bash
git init
git add .
git commit -m "chore: initial documentation, architecture, memory architecture, and delivery operating model baseline"
git branch -M main
git remote add origin git@github.com:<your-username>/fleetco.git
git push -u origin main
```

You now have a private repository on GitHub containing the project's foundational memory but no code. This state is intentional. Phase 0 is about establishing the foundation; code follows in Phase 1.

## Step 2 — Enable repository security features

Before installing Claude Code or doing anything else, enable the security features that ADR-0012 commits us to. In the GitHub repository settings, enable Dependabot alerts and Dependabot security updates under the Code security section. Enable secret scanning and secret scanning push protection in the same section. These settings are enabled per-repository for private repos and require no further configuration to start working. The Semgrep job and the action-pinning discipline come in as part of the CI pipeline that Phase 0 will set up; the Dependabot and secret scanning features are repository-level switches that are best enabled before any code is written.

## Step 3 — Install Claude Code

Claude Code is a command-line agent that reads your repository directly and works inside it. Install it with `npm install -g @anthropic-ai/claude-code` and verify the installation with `claude --version`. If the installation fails with permission errors, follow the instructions in the Claude Code documentation for setting up a user-local npm install.

## Step 4 — Open Claude Code in the repository

Navigate to the repository folder and run `claude`. The agent will start a session in the current directory, with read and write access to the files. This is the first time the agent will see this project, and the next step is critical for setting the right tone.

## Step 5 — Your first prompt

Paste this prompt verbatim, without modification, as your first message to Claude Code.

```
Read CLAUDE.md fully. Then read docs/product/vision.md, docs/product/roadmap.md, docs/architecture/overview.md, docs/architecture/memory-architecture.md, every file under docs/architecture/decisions/, docs/glossary.md, docs/CURRENT_PHASE.md, docs/design/README.md, docs/design/DESIGN.md, docs/runbook/README.md, docs/runbook/incident-response.md, docs/runbook/security-incident-response.md, docs/runbook/business-continuity.md, docs/postmortems/README.md, docs/operations/README.md, docs/operations/dora-metrics.md, and docs/tech-debt.md. After you have read all of these, do four things in order. First, summarize in 10 to 15 sentences what you understand about the project. Your summary should touch on the cognitive theory of project memory and the three participants, the substrate choice and why the filesystem under git is the right place to hold memory for our specific situation, the six categories of memory and where each lives, the foundational architectural decisions including the modular monolith and Postgres with PostGIS and the Trip as central aggregate and TypeScript end-to-end and vertical slices, the delivery operating model including the DORA targets the SLOs and the security baseline and the data classification, and the current phase and what its goal is. Second, identify any apparent gaps, inconsistencies, or unanswered questions you noticed as you read; be honest and specific. Third, propose the Phase 0 task list as a numbered checklist, smallest task first, with each task small enough to be completed in a single session. Each task should have explicit acceptance criteria including which memory artifacts will be touched. Fourth, ask me up to three clarifying questions if there is anything you genuinely need to know before we start the first Phase 0 ticket. Do not ask gratuitously; only ask if the answer would meaningfully change what you do. Do not write any code in this session. Code begins in the second session, after I have reviewed your summary, approved your gap analysis, and approved the first ticket from your proposed Phase 0 list.
```

The agent will read everything, summarize the project back to you, and propose the Phase 0 plan. Watch the summary carefully. If it paraphrases the words but misses the substance — for instance, if it summarizes the substrate argument as "we use markdown files" without articulating why that choice matters, or if it summarizes the delivery operating model as a list of ADR numbers without explaining what they protect — that is a signal that the agent has not internalized the foundation deeply enough, and you should ask follow-up questions before approving any tickets. If the summary captures the theory and the operating model faithfully, you are ready to approve the first Phase 0 ticket.

## Step 6 — The working rhythm for each ticket

For each Phase 0 ticket, follow this rhythm. First, ask the agent to restate the ticket in its own words and list its assumptions. Second, ask the agent for a plan before any code. The plan should be a vertical slice with explicit memory-artifact updates listed (which ADRs may need writing, which glossary entries may be added, which runbook procedures may need updating, which design slice files may be committed, which roadmap or current-phase or tech-debt entries may move, which operational metrics may be affected). Third, approve the plan or push back; do not let the agent skip ahead. Fourth, let the agent execute in small commits, each leaving the repo green. Fifth, review the diff and ask "what could go wrong with this?" before merging. Sixth, when the phase progresses, update `docs/CURRENT_PHASE.md` in the same PR.

## Step 7 — When something architectural is decided

If during a session you make a decision that is architectural in nature — choosing an authentication library, choosing a deployment target, choosing how to handle file uploads, anything that future sessions will need to know about — instruct the agent to write an ADR for the decision. The agent uses the template at `docs/architecture/decisions/template.md`, numbers the new ADR sequentially (the next number after the highest existing one, which is currently 0013), and includes the substantive sections: context, decision, alternatives considered, consequences, revisit-when. The ADR is reviewed and merged before any code that depends on the decision is merged. This sequence — decision, ADR, code — is not negotiable.

## Step 8 — When something procedural becomes routine

If during the project a procedure becomes routine — the deploy steps, the rollback steps, the steps to set up a new development machine, the steps to handle a particular kind of incident — instruct the agent to add it to `docs/runbook/`. Procedural memory is the kind that is most often missed, because the procedure feels obvious to the person executing it for the third time and seems unnecessary to write down. The cost of not writing it shows up months later when the procedure is needed and the person who knew it is unavailable, or when the procedure has subtly changed and the unwritten version is now wrong.

## Step 9 — The weekly operational rhythm

Once Phase 1 ships its first production deploy, a weekly operational rhythm begins. At the end of each work week, the agent updates `docs/operations/dora-metrics.md` with the week's measurements per the format documented in that file. The agent also reviews open SLO compliance against the targets in ADR-0011 and notes any incidents that occurred during the week. If a target is missed in any measurement window, the next planning conversation must address what changed and what we will do about it before any new feature work begins. This rhythm is not optional; it is the discipline that makes the delivery operating model real rather than aspirational.

## Anti-patterns to avoid

Do not paste prior chat history into Claude Code. The repo is the context. Trust the documents.

Do not let the agent "just start coding" without a plan. Always restate, plan, approve, execute. The few minutes spent on the plan recover hours that would otherwise be spent on rework.

Do not skip the ADR for "small" decisions. Small decisions compound. The threshold for writing an ADR is "would a future session need to know this?" not "is this important enough to write down?" If a future session would need to know it, the threshold is met.

Do not let `main` go red. If a build fails, fix it immediately or revert. A red `main` is not just an inconvenience; it is a violation of the trust precondition that makes the memory architecture work, because participants who cannot trust that `main` is in a good state cannot trust anything else they read in the repo.

Do not run multiple agents in parallel before the end of Phase 1. See ADR-0004. Worktree-based parallelism is a real technique, but it requires stable conventions and clear module boundaries that the project does not have yet. Adding parallelism before those exist multiplies coordination cost without improving throughput.

Do not use external tools as memory. Open Design, Figma, Notion, AI chat, project management tools — all of these can be where thinking happens. None of them is where thinking is preserved. Once a conclusion is reached in any of these tools, the conclusion is committed to the repo or it does not exist from the project's perspective.

Do not skip the operational rhythm. The weekly DORA metrics update and the monthly SLO review are not ceremonial. They are the early warning system for the failure modes that the AI-amplified delivery context is most prone to. Skipping them produces the appearance of velocity without the measurement that distinguishes velocity from drift.

Do not let CI security findings sit. If Semgrep flags something, the response is to address the finding, not to disable the check. If Dependabot flags a vulnerable dependency, the response is to update or replace the dependency. If GitHub native secrets scanning flags a leaked secret, the response is to follow the security incident response procedure in the runbook, starting with rotation. The security baseline is only valuable if its findings are acted on.

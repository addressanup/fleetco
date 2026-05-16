# Incident Procedures

This folder holds procedures for responding to specific kinds of operational incidents. The folder is empty at project start because we have not yet had any incidents and do not know what kinds will occur. Entries are added when incidents happen, in the same week the incident is resolved, by extracting the procedure that worked from the conversation that produced it.

Each entry should be testable, named after the kind of incident it addresses (such as `database-connection-pool-exhaustion.md` or `gps-ingestion-queue-backlog.md`), and should follow the same structure as procedures elsewhere in the runbook: when the procedure applies, the steps to take, what can go wrong during the procedure itself, and when the procedure was last verified.

The relationship between this folder and `docs/postmortems/` is that an incident produces both a postmortem (a record of what happened, what we learned, and what we changed) and, if the incident response was good enough to be reusable, a procedure here. Not every incident produces a runbook entry; only the ones likely to recur.

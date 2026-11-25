# Persistent knowledge foundation

The system's understanding is independent of conversation and device lifetime.
Profiles scope information to owner, project, domain, skill, quality or worker.
Observations retain source kind, reference and body. Learning proposals cite an
observation in the same profile; proposed claims do not appear in active context.
Owner-approved proposals advance a revision atomically. Conflicting revisions
must be re-reviewed. Corrections add revisions rather than overwrite evidence.

The service role may append observations and revisions but may not update or
delete them. Database administrators retain their normal privileges. No
knowledge record is an authorization grant; owner and device permissions are
managed separately. The source kind is a classification, not independently
verified provenance. Validated-learning proposals require an execution, review
or experiment observation and still require review. Automated validation and
delegated learning commits are not implemented.

Private database RPCs are deployed; the owner-consent adapter is not connected.
No learning commit endpoint is exposed through the public gateway. The initial
get_context function returns current revisions for one selected profile with a
bounded result count, not semantic or cross-profile retrieval. Proposal
idempotency, evidence verification, retrieval ranking, historical revision
views, explicit restore and retention budgets remain follow-up work. No
personal knowledge or fabricated observations have been seeded.

Local PostgreSQL tests and rollback-only live Supabase assertions passed.

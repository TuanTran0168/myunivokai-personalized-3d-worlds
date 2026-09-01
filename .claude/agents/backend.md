---
name: backend
description: Use for any work in services/* or contracts/* — Go and Rust services, NATS subjects and consumers, Postgres migrations, Redis keys and invalidation, the API gateway, auth and analytics. Also use when adding a world family, which is mostly a backend change.
---

Your operating definition is `agent-system/agents/backend-agent.md`. **Read it in
full before doing anything else**, then follow it: it names the documents that
matter for this work, the ones to skip, and what done means.

Two things from it that are worth having before that read, because both fail
silently:

- **Adding a world family is not one change.** Two required steps are invisible
  to the compiler and to every test: the Postgres family `CHECK` constraint has
  to accept the new value, and the `dna-family-results-v1` JetStream consumer's
  subject filter has to include it. Neither is generated; the second fails with
  no error at all.
- **Read a plan's corrections section before its design.**
  `agent-system/plans/services/ocean-service-plan.md` §16 contradicts its own §2
  and §7, and `analytics-service-plan.md` §Corrections found in implementation
  records four more.

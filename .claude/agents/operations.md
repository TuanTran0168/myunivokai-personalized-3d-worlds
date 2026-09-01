---
name: operations
description: Use for deploying, environment groups and variables, admin key rotation, and diagnosing something in production that is not answering — a 503, a 202 that never completes, a service that appears to be asleep.
---

Your operating definition is `agent-system/agents/operations-agent.md`. **Read it
in full before doing anything else**, then follow it: it names the runbook to
start from and the ones not to pick by title.

One thing from it worth having before that read, because no dashboard shows it:

- **A sleeping service never wakes from a NATS message.** The platform wakes
  services proactively on write and reactively on read, over a three-way
  status-code contract. A production 202-then-503 is the exact symptom that
  mechanism exists for.
  `agent-system/plans/architecture/service-wake-mechanism.md` has the design and,
  in §What was built, the three places the implementation deliberately departs
  from it.

Never skip a runbook's verification step because the previous one passed. If the
procedure turns out to be wrong, correct the runbook in the same change.

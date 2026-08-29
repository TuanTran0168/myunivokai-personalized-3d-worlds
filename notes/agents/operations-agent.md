# Operations agent

> **Document status:** Active
> **Last source review:** 2026-08-29

**Scope:** deploying, environment configuration, key rotation, and working out
what is wrong when something in production is not answering.

## Reading order

1. [../skills/render-deployment.md](../skills/render-deployment.md) — the entry
   point. It routes you to the runbook that matches the runtime; do not pick a
   runbook by its title.
2. The runbook it sends you to, followed step by step with its verification at
   each stage.
3. [../plans/architecture/v1-2026-07-22/deployment.md](../plans/architecture/v1-2026-07-22/deployment.md)
   when you need to know what `render.yaml` is *supposed* to define, as opposed
   to what it currently does.

## Do not read

The service plans in `../plans/services/`, unless a deploy step names one. They
describe what a service is for, which does not change how it is deployed, and
they are long.

## Rules specific to this work

**A sleeping service never wakes from a NATS message.** This is the single most
expensive piece of operational knowledge in the repo and it is not obvious from
any dashboard: the platform wakes services proactively on write and reactively
on read, over a three-way status-code contract.
[../plans/architecture/service-wake-mechanism.md](../plans/architecture/service-wake-mechanism.md)
has the design, the statistics, the give-up threshold, and — in §What was built
— the three places the implementation deliberately departs from it. A production
202-then-503 is the symptom this mechanism exists for.

**Two services have never had their deployment confirmed.**
`myunivokai-auth` and `myunivokai-analytics` have their own narrow checklist,
[../skills/auth-analytics-first-deploy-checklist.md](../skills/auth-analytics-first-deploy-checklist.md).
Use it rather than assuming the general guide covers them.

**Rehearse the key rotation before you need it.**
[../skills/admin-key-rotation-drill.md](../skills/admin-key-rotation-drill.md)
is written as a drill on purpose — the first time anyone rotates the admin key
should not be during the incident that requires it.

## Done means

Every verification step in the runbook actually run, not assumed; the service
answering on `/healthz`; and, if anything about the procedure turned out to be
wrong, the runbook corrected in the same change rather than in a note somewhere
else.

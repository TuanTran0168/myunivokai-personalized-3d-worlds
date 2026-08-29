---
name: deploy
description: Deploy a Myunivokai service, or work out which of the deployment runbooks applies. Use for "deploy", "ship to Render", "first production deploy", "the env group", or when a deploy has half-succeeded and you need the verification steps.
---

# Deploy

Runbooks live in `agent-system/skills/`. This skill exists to stop the wrong one
being picked by its title, which is the most common way a deploy goes wrong here.

## Route first

Read `agent-system/skills/render-deployment.md`. It is the entry point and it
routes to the runbook matching the runtime. **Do not choose a runbook by
reading its filename** — the single-container guide and the production guide
describe different platforms and each looks plausible for the other's job.

## Then follow it literally

Every stage has a verification step. Run it. Do not carry a passing earlier
stage forward as evidence that a later one worked — a deploy that half-succeeds
is the normal failure here, not the rare one, and the verifications are what
localise it.

## The two services with their own checklist

`myunivokai-auth` and `myunivokai-analytics` have never had a deployment
confirmed. They get
`agent-system/skills/auth-analytics-first-deploy-checklist.md`, not the general
guide.

## When something is deployed but not answering

Before assuming a bad deploy, check whether the service is simply asleep. A
sleeping service never wakes from a NATS message — the platform wakes it
proactively on write and reactively on read. A 202 that is followed by a 503 is
that mechanism, not a broken deploy:
`agent-system/plans/architecture/service-wake-mechanism.md`.

## Finish

If any step in the runbook turned out to be wrong, fix the runbook in the same
change. A correction recorded anywhere else is a correction the next person will
not see.

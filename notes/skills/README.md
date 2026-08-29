# Skills — procedures

> **Document status:** Active
> **Last source review:** 2026-08-29

Runbooks. Every document here is a sequence of steps with a way to verify each
one, written to be followed rather than read. If you find yourself reasoning
about *why* while executing one, that reasoning belongs in
[../plans/](../plans/README.md) or [../knowledge/](../knowledge/README.md) —
open it there, then come back to your place in the steps.

| Skill | Use when |
| --- | --- |
| [render-deployment.md](render-deployment.md) | Deploying. The entry point, which routes you to the runbook matching the runtime. |
| [production-deployment-guide.md](production-deployment-guide.md) | The first production deploy of any service: Neon, Upstash, Synadia NATS, Render env groups, per-service variables, troubleshooting. |
| [render-single-container-deployment-guide.md](render-single-container-deployment-guide.md) | Deploying the single-container variant. |
| [auth-analytics-first-deploy-checklist.md](auth-analytics-first-deploy-checklist.md) | Deploying `myunivokai-auth` and `myunivokai-analytics` specifically — the two whose deployment is not yet confirmed. |
| [admin-key-rotation-drill.md](admin-key-rotation-drill.md) | Rotating the admin key — and rehearsing it before you have to do it under pressure. |

## Adding a skill

A document belongs here when it answers "how do I do X" with steps, rather than
"what is X" with prose. Give every stage a way to check it: a runbook whose
steps cannot be verified is one nobody can safely stop halfway through, and
stopping halfway through is the normal case for a deploy that goes wrong.

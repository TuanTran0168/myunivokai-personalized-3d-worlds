# Render deployment entry point

> **Document status:** Active
> **Last source review:** 2026-08-06

The legacy public HTTP peer fleet is no longer represented by source or
`render.yaml`. Current deployment uses:

| Render name | Type | Public |
| --- | --- | :---: |
| `myunivokai-web` | Web Service | yes |
| `myunivokai-gateway` | Web Service | yes |
| `myunivokai-dna` | Web Service | no |
| `myunivokai-universe` | Web Service | no |
| `myunivokai-nature` | Web Service | no |
| `myunivokai-auth` | Web Service | no |
| `myunivokai-analytics` | Web Service | no |

**Corrected 2026-08-06:** this table previously listed `dna`/`universe`/
`nature` as Background Workers requiring a paid plan. `render.yaml` has
always deployed all of them as free-tier `type: web` instead — see
[production-deployment-guide.md §5.5–5.6](production-deployment-guide.md)
for why (Render Free doesn't support `worker`, so each opens a minimal
`/healthz` HTTP server instead) — and `myunivokai-auth` follows the exact
same pattern, as does `myunivokai-analytics` (added 2026-08-07). All six
backend services run on Render's free plan; none require a paid instance.
⚠️ Free instance hours are shared account-wide — check the remaining budget
before deploying the sixth. They communicate through operator-provisioned
managed NATS (Synadia Cloud NGS) and each owns its own Neon database.
Gateway and `auth-service` also require managed Redis (Upstash) — the same
instance, not a second one. `analytics-service` requires **no** Redis, no
signing key and no provider key: it verifies no token, calls no provider and
publishes no event.

No service sets `healthCheckPath`, so none is kept awake and none burns hours
while idle — which is what makes six free services fit inside a 750-hour
account budget that a single always-on service would nearly exhaust on its own.
The cost is that all five NATS-only services sleep, and nothing sends them the
inbound HTTP they need to wake. The gateway closes that gap on demand:
`SERVICE_WAKE_PLATFORM=http` plus a `*_SERVICE_URL` per service, entered in the
dashboard rather than committed, so moving a service to another host is a
dashboard edit. It calls a sleeping service once per lock window, triggered by
a real request, and never on a schedule — a keep-alive cron is what the budget
above rules out. Set the platform to `none` on a paid plan. See
[service-wake-mechanism.md](../plans/architecture/service-wake-mechanism.md).

Use the complete dated runbook:

- [Production Deployment Guide](production-deployment-guide.md) (Hướng dẫn Step-by-Step)
- [Sprint 1 deployment guide](../plans/sprints/sprint-01-2026-07-22/deployment-guide.md)
- [Vision V1 deployment rationale](../plans/architecture/v1-2026-07-22/deployment.md)

Do not deploy old `Dockerfile`, `Dockerfile.render`, `cmd/api`, upstream URLs,
or `GATEWAY_SHARED_SECRET`; those runtime paths were removed. Production uses
only `Dockerfile.prod` and the variables listed by the dated guide.

The repository prepares and validates configuration but does not contain
managed credentials and cannot prove a live deploy without an operator running
the runbook and recording the resulting service IDs, commit SHA, UTC time, and
smoke evidence.

# Deployment — target event-driven fleet

> **Document status:** Implemented deployment configuration; live cutover pending
> **Vision version:** v1-2026-07-22
> **Last source review:** 2026-07-22

The current `render.yaml` defines the Gateway and three private Background
Workers using component `Dockerfile.prod` files. The operator checklist belongs
in the Sprint 1 deployment guide; this document records deployment rationale.

## Target fleet

| Name | Runtime type | Public | Responsibility |
| --- | --- | :---: | --- |
| `myunivokai-web` | Vercel/Render web | yes | Next.js UI |
| `myunivokai-gateway` | Render Web Service | yes | Only browser API edge; NATS publisher/requestor; Redis client |
| `myunivokai-dna` | Render Background Worker | no | DNA commands, AI, root jobs and result queries |
| `myunivokai-universe` | Render Background Worker | no | Universe commands and query responders |
| `myunivokai-nature` | Render Background Worker | no | Nature commands and query responders |
| managed NATS | Synadia or equivalent | TLS only | Core NATS and JetStream |
| managed Redis | Redis-compatible managed service | TLS only | distributed limiter and cache |
| Neon PostgreSQL | managed database | TLS only | three service-owned logical databases |

Names express domains. Do not append `-worker`; Background Worker is the
Render resource type.

## Why domain services are Background Workers

They continuously pull durable commands and respond to Core NATS queries, and
do not need inbound HTTP. Render Background Workers are designed for
long-running queue consumers. They do not support Free instances, while Free
Web Services sleep based on inbound HTTP/WebSocket traffic. A NATS message does
not wake a sleeping Free Web Service, so representing these services as free
web apps would make queue latency nondeterministic.

References: [Render Background Workers](https://render.com/docs/background-workers)
and [Render Free limitations](https://render.com/docs/free).

If always-on worker cost is not approved, the honest alternatives are local
development or another always-on container host. Do not add an HTTP wake-up
hack or introduce Redis as a second queue.

## Managed dependency policy

### NATS

- JetStream must be enabled.
- TLS and separate credentials/subject ACLs are mandatory.
- Production streams/consumers are provisioned declaratively or by an
  idempotent bootstrap step.
- Stream storage/retention limits and consumer retry/dead-letter behavior are
  explicit environment/config values.

### Redis

- TLS is mandatory outside local development.
- Keys use the `myunivokai:` namespace and bounded TTLs.
- Rate limiting and cache entries share one deployment initially but have
  separate prefixes/metrics.
- Eviction is acceptable for caches, never for durable domain state.
- Redis downtime degrades cache/limiter behavior according to the documented
  fallback; it cannot lose jobs or worlds.

### Neon

Create exactly these logical databases for the fresh baseline:

```txt
myunivokai_dna
myunivokai_universe
myunivokai_nature
```

Each service receives only its own pooled runtime URL and direct migration URL.
Migrations run as an explicit release/pre-deploy step where supported, not
concurrently in every horizontally scaled instance.

## Required production variables

Gateway:

```txt
APP_ENV
API_ALLOWED_ORIGINS
TRUST_PROXY
NATS_URL
NATS_USERNAME / NATS_PASSWORD (or NATS_CREDENTIALS file)
REDIS_URL
RATE_LIMIT_*
JOB_CACHE_TTL / WORLD_CACHE_TTL / SHARE_CACHE_TTL
NATS_REQUEST_TIMEOUT
```

DNA:

```txt
APP_ENV
DATABASE_URL
DATABASE_DIRECT_URL
NATS_URL
NATS_USERNAME / NATS_PASSWORD (or NATS_CREDENTIALS file)
AI_PROVIDER
AI_FALLBACK_PROVIDER
AI_TIMEOUT
GEMINI_API_KEY or OPENAI_API_KEY
```

Universe/Nature:

```txt
APP_ENV
DATABASE_URL
DATABASE_DIRECT_URL
NATS_URL
NATS_USERNAME / NATS_PASSWORD (or NATS_CREDENTIALS file)
CONSUMER_*
```

The frontend receives only `NEXT_PUBLIC_GATEWAY_BASE_URL`. No NATS, Redis,
database, AI or domain-service credential belongs in its environment.

## Rollout order

1. Provision NATS credentials/ACLs, streams and consumers.
2. Provision Redis and verify TLS/read/write/TTL behavior.
3. Create the three Neon databases and run fresh migrations.
4. Deploy `myunivokai-dna`, `myunivokai-universe` and
   `myunivokai-nature`; verify NATS service discovery/query responders.
5. Deploy `myunivokai-gateway` with NATS/Redis readiness still hidden from
   public traffic.
6. Run synthetic generation, duplicate/retry and query/cache tests.
7. Deploy/rebuild the frontend against the new gateway contract.
8. Execute the full public lifecycle and failure smoke suite.
9. Cut traffic over; observe backlog, redelivery, errors, cache and DB pools.
10. Retire old HTTP peer deployments. Delete old databases only with a
    separate confirmation naming each exact database.

## Rollback

Before old services are retired, rollback switches frontend/gateway traffic to
the last known-good deployment. NATS commands accepted by the new system must
not be silently discarded; either allow consumers to drain or mark jobs failed
with a retry path. Fresh databases are preserved during rollback for diagnosis.

After destructive retirement, rollback means redeploying the previous code and
restoring/provisioning its databases, so old database deletion must never be
part of the automatic deploy command.

## Local parity

Sprint 1 keeps root `docker-compose-local.yaml` and `.env.local`, adds shared
`infra/docker-compose-local.yaml`, and gives every component its own local
Compose plus `Dockerfile.local`/two-stage `Dockerfile.prod`. Local uses
containers for NATS, Redis and PostgreSQL while production uses managed
equivalents. Subjects, stream names, database names, migrations and failure
policies remain the same.

See the dated
[Sprint 1 deployment guide](../../sprints/sprint-01-2026-07-22/deployment-guide.md)
for the implementation-time checklist.

# Solution architecture — event-driven platform V1

> **Document status:** Implemented in source; local container and deployed verification pending
> **Vision version:** v1-2026-07-22
> **Decision date:** 2026-07-22
> **Last source review:** 2026-07-22

This document is the architecture source of truth for Myunivokai V1. Sprint 1
implemented its service boundaries, contracts, persistence baselines, local
configuration, frontend flow, and Render Blueprint. Managed deployment remains
an operator verification gate rather than an inferred source-code result.

## 1. Implemented source baseline

The source contains four Go modules plus the shared contract module. The old
HTTP peer handlers/proxy and duplicated family AI implementations have been
removed. The implemented runtime is:

- the browser still has one public HTTP origin: `api-gateway`;
- the gateway publishes durable work to NATS JetStream;
- services consume commands and publish completion/failure events;
- fast internal queries use Core NATS request-reply, not JetStream;
- `dna-service` owns canonical DNA, AI providers, and root generation jobs;
- `universe-service` and `nature-service` remain independent bounded contexts;
- Redis provides distributed rate limiting and cache-aside state;
- each domain owns a newly named PostgreSQL database;
- no user authentication is introduced in this migration;
- no domain service exposes a public HTTP business API.

## 2. Naming standard

Service names describe the bounded context, not the process type. Do not add a
`-worker` suffix. A Render Background Worker is a deployment type only.

| Responsibility | Repository | Deployment name | Database |
| --- | --- | --- | --- |
| Next.js experience | `apps/myunivokai-web` | `myunivokai-web` | none |
| Public edge and coordination | `services/api-gateway` | `myunivokai-gateway` | none |
| Profile input, canonical DNA, AI, jobs | `services/dna-service` | `myunivokai-dna` | `myunivokai_dna` |
| Universe composition and lifecycle | `services/universe-service` | `myunivokai-universe` | `myunivokai_universe` |
| Nature composition and lifecycle | `services/nature-service` | `myunivokai-nature` | `myunivokai_nature` |
| Future City composition and lifecycle | `services/city-service` | `myunivokai-city` | `myunivokai_city` |

Domain folders intentionally retain the `-service` suffix (`dna-service`,
`universe-service`, `nature-service`, `city-service`). The web app includes the
brand in its folder name instead of using a bare `web` or redundant
`web-client`. Code uses kebab-case for folders and deployments, snake_case for
PostgreSQL database/table names, UPPER_SNAKE_CASE for NATS stream names, and
lowercase dot-separated NATS subjects.

## 3. Logical architecture

```txt
Browser / Next.js
       |
       | public HTTPS
       v
api-gateway -------------------------------------- Redis
       |                                     rate limits, safe caches,
       | NATS publish/request                 short-lived job projection
       v
NATS: Core + JetStream
       |                    |                    |
       v                    v                    v
dna-service          universe-service       nature-service
       |                    |                    |
       v                    v                    v
myunivokai_dna   myunivokai_universe   myunivokai_nature
```

Only the gateway accepts browser API traffic. The three domain services are
long-running NATS consumers/responders. They are deployed as Background Worker
processes when the platform supports that type, but retain their domain names.

## 4. Component ownership

### API Gateway

The gateway owns transport coordination only:

- public HTTP routes and response envelopes;
- request validation at the transport boundary and body-size limits;
- request/correlation ID generation;
- CORS and security headers;
- Redis-backed distributed rate limiting;
- Redis cache-aside reads and explicit invalidation;
- JetStream command publication with publish acknowledgement;
- Core NATS request-reply for bounded, fast queries/mutations;
- mapping timeouts/no-responders into stable public errors;
- optional future SSE/WebSocket delivery from domain events.

The gateway does not call AI, compose scenes, own world/DNA tables, choose
family semantics, or mark a durable job completed from memory alone.

### DNA Service

`dna-service` owns:

- raw questionnaire/profile input;
- canonical, family-neutral `ProfileDNA` and its versions;
- the AI provider abstraction and provider-specific adapters under
  `internal/ai/providers`;
- AI validation, repair, fallback, attempts, cost and latency logs;
- root `generation_jobs` status and result pointers;
- routing an approved DNA snapshot to the requested family command;
- consuming family completion/failure events to finalize root jobs.

Canonical DNA contains semantic concepts such as archetype, narrative,
traits, energy, facets, palette intent and atmosphere. It must not contain
planet, landmark, district, asset-path, coordinate or renderer-specific data.

### Universe Service

`universe-service` owns Universe worlds, variants, selected variants, shares,
the deterministic Universe builder, immutable DNA snapshots, inbox/outbox
records, and its database. It does not call an AI provider after migration.

### Nature Service

`nature-service` owns Nature worlds, variants, selected variants, shares, the
deterministic Nature builder, immutable DNA snapshots, inbox/outbox records,
and its database. Mountains, forests, rivers and lakes remain variants within
this bounded context unless an independently scaled product boundary is later
approved.

## 5. Messaging model

### Envelope

Every command/event payload has exactly the generic envelope approved by the
owner:

```json
{
  "jobId": "01K0ABCDEF1234567890",
  "timestamp": "2026-07-22T10:30:00Z",
  "data": {}
}
```

Domain fields such as `profileId`, `worldId`, `dnaVersion`, `worldType` and
`profileDNA` live only inside `data`. Message type and schema version live in
the subject. Trace and request metadata use NATS headers so the envelope does
not accrete transport fields.

### Streams and subjects

```txt
MYUNIVOKAI_COMMANDS  WorkQueue retention
  myunivokai.commands.dna.generate.v1
  myunivokai.commands.universe.compose.v1
  myunivokai.commands.nature.compose.v1

MYUNIVOKAI_EVENTS    Limits retention
  myunivokai.events.dna.generated.v1
  myunivokai.events.dna.failed.v1
  myunivokai.events.universe.completed.v1
  myunivokai.events.universe.failed.v1
  myunivokai.events.nature.completed.v1
  myunivokai.events.nature.failed.v1
```

Fast queries are Core NATS request-reply and are not stored in JetStream:

```txt
myunivokai.queries.dna.job.get.v1
myunivokai.queries.universe.world.get.v1
myunivokai.queries.universe.share.get.v1
myunivokai.queries.nature.world.get.v1
myunivokai.queries.nature.share.get.v1
```

JetStream provides durable work and at-least-once delivery; every consumer is
idempotent. `Nats-Msg-Id` is set to a stable `jobId:stage` value, but database
inbox records remain the durable duplicate guard. A consumer acknowledges only
after its database transaction commits. Database changes that must publish an
event use a transactional outbox. Retry exhaustion produces an explicit
failed job/event and a dead-letter subject; it is never silently dropped.

References: [JetStream](https://docs.nats.io/nats-concepts/jetstream),
[consumers](https://docs.nats.io/nats-concepts/jetstream/consumers), and
[Core NATS request-reply](https://docs.nats.io/nats-concepts/core-nats/reqreply).

## 6. End-to-end generation flow

1. The browser posts a generation request to `api-gateway`.
2. The gateway validates the transport contract, rate-limits through Redis,
   creates a sortable `jobId`, and writes a short-lived `queued` projection to
   Redis.
3. The gateway publishes `myunivokai.commands.dna.generate.v1` and waits only
   for JetStream `PubAck`. It returns `202 Accepted`; it never waits for AI.
4. `dna-service` deduplicates the command, persists the profile/root job, calls
   AI, validates canonical DNA, and commits DNA plus an outbox record.
5. Its outbox publisher emits the family compose command with an immutable DNA
   snapshot. Raw input is not propagated to family services.
6. The selected family service deduplicates, builds a seed-deterministic scene,
   stores world/variant/DNA snapshot, and emits completed or failed.
7. `dna-service` consumes the family event and finalizes the root job in
   `myunivokai_dna`.
8. The gateway may consume the event to refresh Redis, but Redis is only a
   projection. On cache miss, `GET /jobs/{jobId}` uses Core NATS request-reply
   to query `dna-service`, whose PostgreSQL row is authoritative.

Generating Nature later from the same profile reuses an approved DNA version
and begins at step 5. It does not call AI again unless the user explicitly asks
for a new DNA version.

## 7. Redis architecture

Redis is a required platform dependency from Sprint 1, but it is never the job
broker or source of truth.

| Capability | Example key | Policy |
| --- | --- | --- |
| Distributed rate limit | `myunivokai:rate:{route}:{client}:{window}` | atomic token/sliding-window operation; TTL equals the window |
| Public share cache | `myunivokai:cache:share:{family}:{slug}` | cache only privacy-safe 200 projections; bounded TTL |
| World read cache | `myunivokai:cache:world:{family}:{worldId}` | cache safe response projection; invalidate on mutation event |
| Job status projection | `myunivokai:cache:job:{jobId}` | short TTL; fallback to DNA query on miss |
| Future anonymous/session state | `myunivokai:session:{tokenHash}` | only after an approved ownership/auth contract |
| Future realtime coordination | `myunivokai:realtime:*` | ephemeral presence/subscription metadata only |

Do not store raw questionnaire input, provider output, API keys, database URLs,
or NATS credentials in Redis. Cache values are versioned so deployments can
invalidate incompatible payloads by changing the prefix.

Failure policy:

- cache unavailable: bypass cache and query the owning service;
- job projection unavailable: query `dna-service`;
- distributed limiter unavailable: fall back to a conservative in-process
  limiter, emit a degraded metric, and never pretend global limits still hold;
- Redis loss must not lose a job, world, DNA version, variant or share record.

Redis atomic counters/expiry are a standard rate-limiter building block:
[Redis rate limiter](https://redis.io/docs/latest/develop/use-cases/rate-limiter/).

## 8. Data ownership and fresh database baseline

Sprint 1 creates fresh version-one schemas; no old database migration is
required. Destructive removal of old databases occurs only after the new
deployment passes smoke tests and an operator confirms the exact targets.

`myunivokai_dna` owns:

```txt
profiles
dna_versions
generation_jobs
ai_generation_attempts
inbox_messages
outbox_messages
```

`myunivokai_universe` and `myunivokai_nature` each own:

```txt
worlds
world_variants
world_shares
inbox_messages
outbox_messages
```

Each world persists `profile_id`, `dna_version`, and an immutable
`dna_snapshot` JSON document. No service reads another service's tables and no
cross-database foreign key exists. Local development uses one PostgreSQL
server with three logical databases and three least-privilege application
roles. Neon may begin with one project and three logical databases, preserving
the option to move a bounded context to a separate project later.

## 9. Security boundary without user auth

There is no auth service in this target. Gateway verification is achieved by
removing public HTTP from domain services and enforcing NATS authentication
and subject authorization:

- gateway may publish approved command subjects and request approved query
  subjects;
- each service may subscribe only to its command/query subjects;
- service responders receive tightly scoped reply-subject permission;
- family services cannot publish commands for another family;
- credentials are separate per deployment and never reach the frontend.

NATS supports per-user publish/subscribe permissions and constrained response
permissions: [NATS authorization](https://docs.nats.io/running-a-nats-service/configuration/securing_nats/authorization).

This proves that work came from an authorized platform component; it does not
identify an end user. Until auth is approved, identifiers are unguessable and
public sharing uses separate share slugs. Object ownership remains explicitly
deferred.

## 10. Deployment topology

Recommended production topology:

```txt
Vercel or Render Web: myunivokai-web
Render Web Service:   myunivokai-gateway
Render Background:    myunivokai-dna
Render Background:    myunivokai-universe
Render Background:    myunivokai-nature
Managed NATS:          JetStream-enabled account
Managed Redis:         Redis-compatible service
Neon:                  three logical PostgreSQL databases
```

The name does not contain `-worker`; the Render resource type records that
runtime concern. Background workers are the correct type because the domain
services continuously consume NATS and do not receive public traffic.

Render Background Workers are not eligible for Free instances. Free web
services also sleep after idle HTTP/WebSocket traffic; a NATS message does not
wake them. Therefore the pure messaging topology requires paid background
compute or another always-on container host. Do not disguise a worker as a
free web service and claim reliable immediate processing.

References: [Render Background Workers](https://render.com/docs/background-workers)
and [Render Free limitations](https://render.com/docs/free).

## 11. Local runtime contract

Sprint 1 keeps the explicit local convention already familiar in the repo:
root `docker-compose-local.yaml` plus `.env.local`. The root Compose file is an
aggregator. Shared dependencies live under `infra/`; each app/service owns its
local Compose file and Dockerfiles.

The exact planned file, service, port and variable inventory is maintained in
the dated [Sprint 1 local environment contract](../../sprints/sprint-01-2026-07-22/local-environment.md).

Target layout:

```txt
docker-compose-local.yaml
.env.local

infra/
  docker-compose-local.yaml       # NATS, Redis, PostgreSQL and bootstrap
  nats/
  redis/
  postgres/

apps/myunivokai-web/
  docker-compose-local.yaml
  Dockerfile.local
  Dockerfile.prod

services/<service-name>/
  docker-compose-local.yaml
  Dockerfile.local
  Dockerfile.prod
```

Root Compose uses top-level `include` so relative build/config paths remain
owned by each included folder. Docker Compose 2.20 or later is required. The
shared infra Compose contains PostgreSQL, database initialization, NATS,
stream/consumer bootstrap and Redis. Service migrations stay inside their
owning service Compose file.

Only development-facing ports are published: web `41300`, gateway `41800`,
PostgreSQL `5432`, NATS client `4222`, NATS monitoring `8222`, and Redis `6379`.
Domain services expose no host port. Named volumes preserve PostgreSQL, NATS
JetStream and Redis development data. Health/dependency gates ensure database,
NATS and Redis are ready before migrations/services and the web waits for the
gateway.

Environment groups:

- public/local ports and `COMPOSE_PROJECT_NAME`;
- three database names, roles, passwords, pooled/direct URLs;
- NATS URL, stream names and per-service credentials;
- Redis URL, key prefix, rate-limit and cache TTL settings;
- AI provider/model/timeout/keys only for `dna-service`;
- service timeouts, retry counts, ack wait, max deliveries and shutdown grace.

`.env.local` is the active local filename, matching current developer habits.
It may contain only explicitly local/mock credentials; production secrets are
never committed or copied from it. Integrated root values are authoritative;
component-local `.env.local` files support standalone development and must use
the same documented variable contract.

Every deployable has two explicit Dockerfiles:

- `Dockerfile.local`: development dependencies, source mounts/watch or hot
  reload, readable binaries/source maps, no production-size claim;
- `Dockerfile.prod`: exactly two stages—builder and minimal non-root runtime;
  production image contains only runtime artifacts, migrations/config required
  by that process, and no compiler/package cache/source tree.

For Next.js, dependency installation and build share the builder stage; the
runtime stage copies only standalone output, static files and public assets.
For Go, the builder produces stripped static binaries and the runtime stage
contains only the required binaries/certificates/config under a non-root user.

## 12. Scale model and triggers

| Pressure | First response | Later response |
| --- | --- | --- |
| More public HTTP | scale gateway instances; Redis preserves rate/cache semantics | regional gateways with measured routing strategy |
| More AI jobs | add `dna-service` instances to one durable pull consumer | split provider/priority consumers if measured |
| More Universe jobs | scale only `universe-service` consumer instances | partition subject/stream by stable key if required |
| More Nature jobs | scale only `nature-service` consumer instances | partition independently from Universe |
| Read pressure | Redis cache-aside, DB indexes and pool tuning | read replicas/projections after evidence |
| NATS backlog | tune batch size, ack wait and consumer concurrency | add capacity/replicas; partition only after measurement |
| Database isolation | separate logical databases | move one database to its own Neon project/compute |
| New family | new bounded-context service, database, subjects and renderer | scale it independently without changing existing consumers |

Durable pull consumers distribute work across instances. Ordering is not
assumed globally; any command requiring per-world ordering carries the world
identifier inside `data` and uses optimistic version checks in PostgreSQL.

## 13. Observability and reliability gates

Every HTTP request and NATS hop carries the same safe correlation ID. Required
metrics include HTTP rate/error/duration, Redis latency/errors/hit ratio, NATS
publish failures, consumer pending/redelivery/ack latency, job stage duration,
provider latency/failure, database pool saturation, outbox age and dead-letter
count. Logs never contain raw input, full DNA, secrets or connection strings.

Readiness means dependencies required for the process role are reachable.
Graceful shutdown stops pulling new messages, finishes or NAKs in-flight work,
flushes NATS/outbox state, and closes database/Redis connections within a
configured deadline.

## 14. Migration and cutover rules

Sprint 1 is a complete replacement, not a compatibility scaffold:

1. freeze the target HTTP/message/database contracts;
2. add local NATS, Redis and three fresh databases;
3. convert the gateway from reverse proxy to NATS edge and Redis policies;
4. create `dna-service` and move the AI abstraction/orchestration into it;
5. convert Universe/Nature into NATS consumers/responders while preserving
   deterministic builders, variants and privacy-safe shares;
6. create fresh baseline migrations and do not import legacy data;
7. update frontend calls for `202 + jobId + polling`;
8. replace Render configuration and deployment runbook;
9. pass tests, local smoke, deployed smoke and failure/retry checks;
10. only then retire old public peer services and explicitly approved old
    databases.

The current HTTP architecture remains the source truth until all Sprint 1
gates pass. The target becomes implemented only at cutover.

## 15. Explicit non-goals

- no auth/user/account service;
- no Redis job queue, Redis Streams, or dual publication to Redis and NATS;
- no direct cross-service database access;
- no synchronous wait for AI through HTTP or NATS request-reply;
- no business rules in the gateway;
- no City implementation before Sprint 1 migration and Sprint 2 hardening;
- no claim of production readiness without live deployment evidence.

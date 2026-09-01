# Backend plan — Sprint 1 event-driven migration

> **Document status:** Implemented migration record; environment verification pending
> **Vision version:** v1-2026-07-22
> **Last source review:** 2026-07-22

This plan translated the approved
[solution architecture](solution-architecture.md) into the implemented backend
boundaries. Current source status is summarized in `agent-system/knowledge/backend/source-overview.md`.

## Replaced source baseline

```txt
api-gateway
  -> HTTP universe-service (synchronous AI + Universe DNA + world lifecycle)
  -> HTTP nature-service   (synchronous AI + Nature DNA + world lifecycle)
```

Current create requests can occupy an HTTP connection for up to 120 seconds.
Universe and Nature duplicate the orchestrator/world lifecycle, and gateway
rate limiting/cache/circuit state is process-local. The target removes these
constraints rather than adding NATS beside the old path.

## Target backend

```txt
api-gateway
  -> JetStream commands / Core NATS queries
  -> Redis distributed limiter and cache-aside

dna-service      -> myunivokai_dna
universe-service -> myunivokai_universe
nature-service   -> myunivokai_nature
```

Service names have no `-worker` suffix. DNA/Universe/Nature run as NATS
consumers/responders; Background Worker is their production resource type.

## Required module boundaries

### Shared contracts, not shared business logic

`contracts/` owns versioned message envelopes, command/event/query payload
schemas, canonical DNA schema, scene schemas and the public gateway OpenAPI
contract. Go modules may generate or mirror typed payloads, but must have a
contract drift test.

Do not create a shared package containing database models, repositories,
family builders or business services. Shared code is limited to stable
transport primitives after actual duplication is demonstrated.

### API Gateway

Replace upstream URL/reverse-proxy code with:

- NATS connection and JetStream publisher;
- Redis-backed rate limiter and cache-aside store;
- HTTP command handlers returning `202` after `PubAck`;
- Core NATS request-reply handlers for job/world/share reads;
- stable public error mapping for no responders, timeout, unavailable Redis
  and unavailable NATS;
- event-driven cache invalidation/refresh;
- health/readiness that distinguish process, NATS and Redis state.

Gateway has no PostgreSQL database and no family branching beyond selecting a
versioned subject from a route/command registry.

### DNA Service

Create `services/dna-service` as a Go module. Move/adapt the existing provider
interface, Gemini/OpenAI/mock adapters, orchestration, validation and logging
into this owner. Its consumers/responders own:

- `commands.dna.generate.v1`;
- `queries.dna.job.get.v1`;
- Universe/Nature completion and failure events;
- `profiles`, `dna_versions`, `generation_jobs`, `ai_generation_attempts`,
  `inbox_messages`, and `outbox_messages`.

Tests always use mock providers. Provider-specific logic stays under
`internal/ai/providers`. AI output is canonical semantic DNA only.

### Universe Service

Preserve the proven deterministic builder, seed streams, variant selection,
share privacy and persistence rules. Remove local AI ownership and HTTP
business handlers after NATS equivalents pass. The service consumes an
immutable canonical DNA snapshot and maps generic facets into Universe
semantics/config.

### Nature Service

Apply the same boundary while preserving Forest determinism and asset/scene
contracts. Remove its duplicate AI orchestrator instead of completing separate
Gemini/OpenAI adapters. Nature maps generic facets into landmarks, terrain,
vegetation, weather and water semantics.

## Reliability rules

- JetStream commands/events are at-least-once.
- Consumers write an inbox record and business state atomically.
- Outbound messages are written to outbox in the same transaction as state.
- Acks occur only after commit.
- Retries use bounded backoff; poison messages end in an observable failed job
  and dead-letter subject.
- `jobId` plus stage/consumer identity prevents duplicate effects.
- Core NATS queries have short deadlines and no side effect.
- Regeneration remains AI-free unless an explicit new-DNA command is used.
- No raw personal input appears in logs, NATS family commands, Redis caches or
  public share responses.

## Fresh data baseline

Sprint 1 creates three databases and version-one migrations:

```txt
myunivokai_dna
myunivokai_universe
myunivokai_nature
```

No old data import is required. Old migrations may remain in Git history, but
the new deployment must not reuse ambiguous database name `myunivokai`.
Deletion of old databases is a separately confirmed operator action after
cutover.

## Sprint 1 backend exit

Sprint 1 is not complete until:

- create returns `202` after durable NATS acceptance;
- DNA generation and both family compositions complete end to end;
- job polling, world lifecycle and share reads work through the gateway;
- Redis rate limiting/cache work across at least two gateway instances in a
  test topology;
- duplicate delivery, retry, restart and dependency-failure tests pass;
- all three fresh databases migrate from empty;
- no browser route needs a domain-service URL;
- no domain HTTP business route remains deployed;
- local Compose and the production deployment runbook pass;
- source overviews are re-baselined to the implemented system.

The dated checklist is
[Sprint 1](../../sprints/sprint-01-2026-07-22/README.md).

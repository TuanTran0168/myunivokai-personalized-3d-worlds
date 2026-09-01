# Sprint 01 — complete platform migration

> **Starts:** 2026-07-22
> **Status:** Deployed to production (Vercel + Render) and reachable; lifecycle,
> failure and rollback evidence still pending
> **Last source review:** 2026-07-29

## Sprint goal

Replace the existing synchronous HTTP peer fleet with the complete approved
NATS/Redis/DNA architecture and deploy it. This sprint includes contracts,
implementation, frontend migration, fresh databases, local Compose, production
configuration/runbook, smoke evidence, cutover and safe retirement planning.
It is not complete when only infrastructure or service scaffolds exist.

Architecture: [Vision V1 solution architecture](../../architecture/v1-2026-07-22/solution-architecture.md)

Sprint acceptance: [user-stories.md](user-stories.md)

Deployment guide: [deployment-guide.md](deployment-guide.md)

Local Compose and env contract: [local-environment.md](local-environment.md)

Backlog epic: [EPIC-S1-MIGRATE-001](../../backlog/engineering-backlog.md#epic-s1-migrate-001--replace-the-platform-completely-in-sprint-1)

## Committed scope

### Track A — contracts and identifiers

- Freeze the generic `jobId`, `timestamp`, `data` envelope.
- Define versioned DNA/family command, event and Core NATS query schemas.
- Define family-neutral `ProfileDNA` and immutable snapshot rules.
- Replace the health-only public OpenAPI contract with asynchronous generation,
  job, world, variant, publish and share routes.
- Use sortable globally unique IDs consistently for jobs/profiles/worlds while
  preserving opaque public behavior.

### Track B — local platform

- Keep root `docker-compose-local.yaml` as an integrated aggregator using
  Compose `include`.
- Add `infra/docker-compose-local.yaml` for PostgreSQL, JetStream-enabled NATS,
  Redis and bootstrap containers only.
- Initialize `myunivokai_dna`, `myunivokai_universe`, and
  `myunivokai_nature` plus least-privilege roles.
- Add NATS accounts/users/subject permissions, streams and durable consumers.
- Keep root/component `.env.local` conventions; allow only local/mock values in
  tracked files and keep every real credential out of Git.
- Give each deployable `Dockerfile.local`, `Dockerfile.prod`, and its own
  `docker-compose-local.yaml`; production Dockerfiles have builder/runtime
  stages only.
- Add migrations and health/dependency ordering for every service.

### Track C — Gateway

- Replace HTTP reverse proxy creation with JetStream command publication.
- Return `202` only after `PubAck`; expose job polling.
- Use Core NATS request-reply for bounded domain reads/mutations.
- Replace process-local rate limiter and share cache with Redis implementations.
- Add cache-aside job/world/share policies, invalidation and degraded behavior.
- Remove target-runtime upstream URLs and `GATEWAY_SHARED_SECRET` dependency.

### Track D — DNA Service

- Create `services/dna-service` and its version-one database migration.
- Centralize raw profile input, canonical DNA versions, root jobs, AI attempts,
  inbox and outbox.
- Move/adapt provider abstraction, mock/Gemini/OpenAI adapters and validation.
- Publish immutable DNA snapshots to Universe/Nature commands.
- Consume family completion/failure events and answer job queries.

### Track E — Universe and Nature

- Retain independent service names and fresh databases.
- Preserve deterministic builders, variants, selection, publish/share and
  privacy-safe projections.
- Replace duplicated local AI/DNA orchestration with canonical DNA mapping.
- Replace public HTTP business handlers with NATS consumers/responders.
- Add inbox/outbox, idempotency, retry/dead-letter and graceful shutdown.

### Track F — frontend

- Handle `202 + jobId` and poll with bounded backoff/deadline.
- Render queued, processing, failed and completed states accessibly.
- Recover polling after refresh without direct service URLs.
- Preserve Universe/Nature rendering, variants, publishing and share routes.
- Align runtime validation/types with executable contracts.
- Rename `clients/web-client` to `apps/myunivokai-web` and update all build,
  CI, Compose and deployment paths atomically.

### Track G — production deployment and cutover

- Replace `render.yaml` with the approved names and service types.
- Provision managed JetStream NATS, managed Redis and three Neon databases.
- Deploy `myunivokai-gateway`, `myunivokai-dna`,
  `myunivokai-universe`, and `myunivokai-nature` without `-worker` suffixes.
- Run migrations, positive/negative security tests and complete family smoke.
- Observe the new fleet before retiring old HTTP peer deployments.
- Never automate deletion of legacy databases in the deploy command.

## Suggested PR sequence

One concern per PR still applies; the sprint goal is achieved by the sequence,
not one oversized branch.

1. `feat/repo/event-contracts-v1`
2. `feat/repo/local-nats-redis-databases`
3. `feat/be/dna-service-foundation`
4. `refactor/be/universe-nats-service`
5. `refactor/be/nature-nats-service`
6. `refactor/be/gateway-nats-redis-edge`
7. `feat/fe/asynchronous-generation-flow`
8. `feat/repo/event-platform-deployment`
9. `feat/repo/event-platform-cutover-verification`

Branches may run in parallel only after contracts are merged; shared contract,
Compose and deployment files need explicit ownership to avoid accidental
overwrites.

## Definition of Done

### Automated

- [x] All Go modules pass `go mod verify`, `go vet ./...`, `go test ./...`, and
      `go build ./...`.
- [x] Frontend typecheck, lint, tests and production build pass.
- [x] Message/DNA/scene/OpenAPI schemas and fixed fixtures pass CI. *(The
      Contracts job validates every committed fixture and both families' golden
      scenes against their schema, and requires a set of deliberately broken
      scenes to be rejected — a schema can be vacuous, so "the fixture passed"
      is not evidence on its own. OpenAPI is linted by the pinned Redocly CLI.
      See `contracts/go/schema_conformance_test.go`.)*
- [x] Duplicate compose delivery produces one logical world/result in repository tests.
- [x] AI/provider tests use mock and no frontend/provider boundary is violated.
- [ ] Redis outage, NATS retry, consumer restart and database rollback tests pass.
- [ ] A clean local environment starts and migrates with one documented command.
- [ ] Every local Docker image supports the documented development watch flow;
      every production image passes the two-stage/minimal-runtime inspection.

### Local end-to-end

- [ ] Universe and Nature generation return `202`, progress and complete.
- [ ] Job status survives gateway restart and Redis flush through DNA DB fallback.
- [ ] Regeneration remains AI-free by default.
- [ ] Get/select/publish/share work through the gateway.
- [ ] Two gateway instances share one documented Redis rate limit/cache.
- [ ] Domain containers publish no HTTP business port.
- [ ] NATS ACL negative tests reject unauthorized publish/subscribe.

### Deployed

Ticked boxes carry the evidence table in
[S1-DEPLOY-001](user-stories.md#s1-deploy-001--reproducible-production-fleet),
recorded 2026-07-29T23:42Z at commit `653c845`.

- [x] Managed NATS/Redis/Neon connectivity and TLS pass. *(Gateway `readyz`
      returns `{"nats":"ready","redis":"ready"}` over HTTPS; that handler pings
      both dependencies rather than reporting process liveness.)*
- [x] Three fresh database migrations pass from empty. *(Run at service start on
      the free plan, which has no pre-deploy hook; the one failure mode found in
      production is recorded in the deployment guide §5.4.)*
- [x] All four backend deployment processes report healthy/ready by their
      documented mechanism.
- [ ] Both family public lifecycles and cache/rate-limit behavior pass.
- [ ] Failure/retry smoke proves accepted jobs are not silently lost.
- [x] Commit SHA, UTC timestamp and safe pass/fail evidence are recorded.
- [ ] Rollback is tested before old services are retired.

### Documentation

- [x] `agent-system/knowledge/backend/source-overview.md`, deployment runbook, README, env tables and
      diagrams are re-baselined to implemented source.
- [x] No document claims City or auth is implemented.
- [x] Old HTTP architecture docs are marked historical.

## Out of scope

- user authentication/accounts;
- City implementation;
- migrating old database records;
- advanced multi-region routing;
- Redis as a job queue;
- mobile/weak-device visual optimization unrelated to the migration.

## Sprint risks

The sprint is intentionally large. Contract freeze and a working vertical slice
must land early; no production cutover is allowed with a half-migrated dual
write path. If a gate misses the date, the system remains on the old deployment
and Sprint 1 stays incomplete rather than declaring a partial architecture done.

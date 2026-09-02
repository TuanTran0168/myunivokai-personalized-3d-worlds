# Vision — Myunivokai as a scalable portrait platform

> **Document status:** Active index; V1 implemented in source and deployed to
> production, lifecycle/failure verification pending
> **Last source review:** 2026-08-07 (auth-service, analytics-service and the admin app added)

Myunivokai turns one person's semantic DNA into multiple deterministic 3D
portrait families. Universe, Nature and Ocean are independent bounded contexts
so they can evolve, deploy and scale separately. Canonical DNA and AI generation
move to `dna-service`; the public gateway becomes a NATS edge; Redis supplies
shared edge state.

The target was approved and implemented in source on 2026-07-22, and deployed on
2026-07-29 to Vercel (web) and Render (Go services) against managed Neon,
Upstash and Synadia. All four services and the frontend answer over HTTPS, and
the gateway's readiness probe confirms live NATS and Redis connections — the
evidence table is in
[S1-DEPLOY-001](../sprints/sprint-01-2026-07-22/user-stories.md#s1-deploy-001--reproducible-production-fleet).
Reachability is not a lifecycle: end-to-end generation, failure/retry and
rollback evidence are still unrecorded, so do not describe the migration as
complete.

## Architecture source of truth

[Vision V1 — 2026-07-22](v1-2026-07-22/README.md) is the current
approved baseline. Its
[solution architecture](v1-2026-07-22/solution-architecture.md) is the
authoritative target for service ownership, NATS commands/events/queries,
Redis, database names, local Compose, deployment, reliability and scale
triggers.

Architecture versions use `vN-YYYY-MM-DD` so folders sort chronologically.
When a material architecture change is approved, copy only the core baseline
into a new version folder, update this pointer, and freeze the previous version.
`Last source review` remains separate: it records source verification, not an
architecture revision.

| Version | Status | Summary |
| --- | --- | --- |
| [v1-2026-07-22](v1-2026-07-22/README.md) | Current implemented source baseline | NATS/Redis edge, canonical DNA, independent Universe/Nature services |
| v2 — candidate scope | **Not approved.** Research only, except §B1 (wake counters), built 2026-08-12 | End-user identity and world ownership, operational telemetry, a Rust service, WebGPU. Argued against the source in [platform-evolution-research.md](../../evolution/platform-evolution-research.md) |

A version folder is a **frozen, approved** baseline, so unapproved work does
not get one. `platform-evolution-research.md` holds the v2 candidates until
the owner approves them; whatever survives is copied into
`versions/v2-YYYY-MM-DD/` at that point and this table's pointer moves.

```txt
web   -> api-gateway /api/*       -> NATS -> dna-service       -> myunivokai_dna
                                        -> universe-service   -> myunivokai_universe
                                        -> nature-service     -> myunivokai_nature
                                        -> ocean-service      -> myunivokai_ocean

admin -> api-gateway /api/admin/* -> NATS -> auth-service      -> myunivokai_auth
                                        -> analytics-service  -> myunivokai_analytics
                                                 ^ consumes myunivokai.events.>
                    Redis: distributed rate limits, safe caches, tokenVersion
```

## Documents

| Document | Role after the 2026-07-22 decision |
| --- | --- |
| [versions/v1-2026-07-22/](v1-2026-07-22/README.md) | **Current versioned architecture baseline** |
| [api-gateway.md](../../memory/execution-records/api-gateway-historical.md) | Historical HTTP gateway record; versioned V1 is current |
| [frontend-plan.md](../frontend/frontend-plan.md) | Current renderer architecture and frontend gaps |
| [visual-diversity.md](../frontend/visual-diversity.md) | Visual/art direction that remains valid across the migration |
| [city-service-plan.md](../services/city-service-plan.md) | Approved City product plan, now dependent on the platform migration/hardening |
| [ocean-family-research.md](../../evolution/ocean-family-research.md) | **Research; graduated 2026-08-14.** The argument and evidence behind Ocean: depth as an axis with real light-attenuation numbers, a section-by-section mirror of `ForestSceneConfig`, the ~70% frontend reuse measured file by file, verified CC0 assets and public-domain audio — and the licence wall City's multi-civilisation ambition runs into. Read it for *why*; implement from the row below |
| [ocean-service-plan.md](../services/ocean-service-plan.md) | **Built 2026-08-15; deployed verification outstanding.** Read its "What executing it found" section first — four of the plan's own claims were wrong, including a seam it recorded as needing no change that needed three. Ocean as the third family, decided 2026-08-14: the depth curve as a specified, tested piece of maths whose results are stored rather than recomputed, the seam inventory read in the working tree (including the four places that need **no** change and the one literal family check that fails no build), the frontend's second builder that the City plan never mentions, phases O0–O6 and a ten-branch sequence |
| [nature-service-plan.md](../services/nature-service-plan.md) | Historical Nature implementation record |
| [frontend-gateway-consolidation.md](frontend-gateway-consolidation.md) | Implemented single-origin frontend baseline |
| [auth-and-admin-plan.md](../services/auth-and-admin-plan.md) | Staff identity, RBAC and the `/api/admin` route group. Implemented; its read-path sections are superseded by the document below |
| [analytics-service-plan.md](../services/analytics-service-plan.md) | The admin read model (CQRS). Implemented — replaced the gateway fan-out before it was written |
| [service-wake-mechanism.md](service-wake-mechanism.md) | Cold-start handling for scale-to-zero hosting: platform-adapter wake, the SERVICE_WAKING/UNAVAILABLE/TIMEOUT split, wake statistics and the give-up threshold, and what survives a move to a paid plan or to a VPS. Implemented |
| [end-user-identity-and-ownership.md](end-user-identity-and-ownership.md) | **Proposed 2026-09-02, no code yet; scheduled as [Sprint 08](../sprints/sprint-08-2026-09-02/README.md). Twenty decisions were taken the same day across seven rounds (§16) and nothing is left open**, several of which cut scope — no email, no OAuth, no passkeys and no account-deletion feature in the first release, which also retires this plan's own §3.4 correction. The sprint covers Phases A-C only. Graduates Track A into a contract and answers `DEFERRED-AUTH-001`'s seven questions. The decision most likely to surprise a reader who knows the admin app: the **product session is a bearer token, not a cookie**, because web-on-Vercel and gateway-on-Render are two different sites and a session cookie there is a third-party cookie that fails silently on iOS. Read §2 first: two thirds of the identity layer is already shipped, because Sprint 4 built staff auth as one half of a two-audience design — `accounts.kind` already admits `end_user`, roles and permissions already carry an audience, and a `web` token is already rejected at the admin edge by a test. It corrects Track A in four places found in the NATS ACLs and `dna-service`'s schema, the largest being that **`library-service` is not needed** — `generation_jobs` already joins profile to world to family for all three families. **If approved it overrides principle 9 and D19 below.** |
| [platform-evolution-research.md](../../evolution/platform-evolution-research.md) | **Research, not approved.** The four owner proposals of 2026-08-11 — end-user ownership across two databases, operational telemetry, a Rust service, WebGPU — with their schemas, blockers and dependency graph. §B1 is built; §Track D is superseded by the row below |
| [rust-adoption-research.md](../../evolution/rust-adoption-research.md) | **Research, not approved.** Which vehicle a first Rust project should use, measured against the working tree. Finds Track C's pick correct but **blocked** on B2's undecided landing place, since service-start telemetry already shipped inside `analytics-service`; scores an unblocked alternative against Track C's own four criteria and states plainly what it does not teach |
| [telemetry-architecture-research.md](../../evolution/telemetry-architecture-research.md) | **Research, not approved.** Grounds Track B2 against how Uber's M3, Datadog's DogStatsD and the OpenTelemetry Collector actually aggregate metrics at scale, measures this system's real cardinality (~200 series) against Grafana Cloud's free-tier budget (10,000), and records a wide-events alternative the original research did not consider |
| [telemetry-service-plan.md](../services/telemetry-service-plan.md) | **Approved design, not yet built.** Graduates Track B2 and Track C into one decided plan: `telemetry-service` in Rust, a `TelemetrySink` trait switching between its own Postgres storage and Grafana Cloud OTLP (mirroring the `ai.Provider`/`wake.Platform` adapter idiom), a hand-maintained `contracts/rust` crate tested against the same fixtures as the Go suite, and results rendered in `myunivokai-admin` |
| [frontend-modernization-research.md](../../evolution/frontend-modernization-research.md) | **Route A built 2026-08-14; Route B, three.js 0.185 and WebGPU still research.** `myunivokai-web` is on Next 15.5.23 / React 19 / R3F v9, which closed all 21 `next` advisories without Next 16. Read §What executing it actually found first: five of the document's own claims were disproved in execution, including a "safe on 14" that is not — and the visual baseline it insisted on is what caught it |

## Product model

One canonical, family-neutral DNA version can produce multiple media:

| Family | Deterministic interpretation |
| --- | --- |
| Universe | planets, orbits, palette, lighting and cosmic atmosphere |
| Nature | terrain, landmarks, vegetation, water, weather and season |
| Ocean | depth, water, light attenuation, seafloor, flora, schools, drifters and bioluminescence |
| City, future | districts, skyline, roads, traffic and urban lighting |

The same DNA is snapshotted into every generated world. Family services never
read `dna-service` tables and never receive the raw questionnaire. A saved
world remains renderable even when DNA later gets a new version.

## Platform principles

1. **One public edge.** The browser calls only `api-gateway`.
2. **Durable asynchronous generation.** Long-running commands use NATS
   JetStream and return `202`; fast queries use Core NATS request-reply.
3. **Clear ownership.** Every service owns its own PostgreSQL database and
   migrations. `myunivokai_analytics` is the single deliberate exception to
   "a row lives in one place": it is a read model, and what may enter it is an
   allow list, not a copy of the source row.
4. **AI produces semantics.** Only `dna-service` calls providers. Family
   builders own seeded visual values.
5. **Deterministic regeneration.** New variants do not call AI by default.
6. **Redis is shared ephemeral state.** It owns rate-limit counters and safe
   caches, never durable jobs or domain records.
7. **At-least-once is explicit.** Inbox/outbox and idempotent consumers are
   required; `jobId` is the correlation/deduplication anchor.
8. **Names express domains.** Deployments are `myunivokai-dna`,
   `myunivokai-universe`, `myunivokai-nature`, `myunivokai-ocean`,
   `myunivokai-auth` and `myunivokai-analytics`; runtime type is not appended to
   the name. A family is named for its domain and not for its most evocative
   corner: the ocean service is `ocean`, never `abyss`, because the abyss is one
   end of its own depth axis and a sunlit reef would be a permanent mismatch
   under that name — across the database, the subjects and every public share
   URL, none of which can be renamed once a link is out.
9. **No placeholder auth for end users.** Product authentication stays
   deferred. `auth-service` is **staff-only** identity for the admin console;
   it does not open a signup path for visitors. NATS credentials and subject
   ACLs still protect internal service traffic.
10. **Admin reads never wake a domain service.** A staff page waits on the
    gateway, auth and analytics — never on universe, nature or dna, which the
    free tier may have put to sleep.
11. **Scale by measured bottleneck.** Gateway, DNA, Universe, Nature, Ocean,
    Auth and Analytics scale independently; database and stream partitioning
    happen only on evidence.

## Delivery order

The dated execution plans live under [../sprints/](../sprints/README.md).

1. **Sprint 1, starts 2026-07-22:** complete replacement—contracts,
   NATS, Redis, fresh databases, DNA service, converted family services,
   frontend async flow, Compose, Render configuration/runbook and live cutover.
2. **Sprint 2, starts 2026-08-05:** load/resilience hardening,
   observability, horizontal-scale proof and operational SLOs.
3. **Sprint 6, starts 2026-08-19:** Ocean as the third family — its own
   service, the depth curve as specified maths whose results are stored, and a
   renderer that needs no downloaded asset at all.
4. **Sprint 3, starts 2026-09-09:** introduce City contracts/service and
   high-fidelity vertical slice on the stable platform. Moved back from
   2026-08-19 on 2026-08-15 when the owner brought Ocean forward; the two
   families touch disjoint services, so the cost was calendar time only.

## Decisions recorded 2026-07-22

| ID | Decision |
| --- | --- |
| D11 | Keep Universe and Nature as independent services for domain ownership and future independent scaling. |
| D12 | Add `dna-service` as the only AI/canonical-DNA owner. |
| D13 | Gateway publishes durable generation commands to JetStream; it does not proxy create requests to domain HTTP APIs. |
| D14 | Services return long-running results as events; query paths use Core NATS request-reply. |
| D15 | Redis is mandatory for distributed rate limiting and cache-aside, but never replaces NATS or PostgreSQL. |
| D16 | No `-worker` suffix in service/deployment names. Render Background Worker is only a resource type. |
| D17 | Use fresh databases `myunivokai_dna`, `myunivokai_universe`, and `myunivokai_nature`; no legacy-data migration is required. |
| D18 | Sprint 1 must deliver the entire migration plus local and production deployment guides; partial scaffolding is not its exit. |
| D19 | User auth remains out of scope; internal trust uses NATS credentials and subject permissions. |
| D20 | Keep domain folder suffixes such as `universe-service`; rename only the frontend boundary to `apps/myunivokai-web`. |
| D21 | Shared local dependencies live in `infra/docker-compose-local.yaml`; root and component `docker-compose-local.yaml` files compose the full/standalone workflows. |
| D22 | Local runtime uses `.env.local` and `Dockerfile.local`; production uses explicit two-stage `Dockerfile.prod` images. |

## What must not happen

- Do not use both Redis and NATS as competing queues.
- Do not wait synchronously for AI in the gateway.
- Do not let domain services share a database or read each other's database.
- Do not move family composition rules into `dna-service` or the gateway.
- Do not expose raw input or full sensitive DNA in public share/cache payloads.
- Do not delete old databases before the new deployed smoke suite passes and
  the exact destructive targets are confirmed.
- Do not start City implementation before the platform migration is complete.
- Do not name any machine-readable identifier after a family's most evocative
  zone. See principle 8.
- Do not recompute a stored derived value at render time. The ocean's depth
  curve decides water, fog, god rays and caustics ONCE, in the builder, and
  what is stored is the answer — which is what makes re-tuning it safe for
  every world that already exists.
- Do not give `analytics-service` a write path, an outbox, or a call to another
  service. It consumes events, writes its own database, and answers queries.
- Do not let an admin route publish a `universe`, `nature` or `dna` subject.
- Do not add a field to `contracts.WorldSnapshot` without adding the matching
  line to the data boundary in `analytics-service-plan.md`.

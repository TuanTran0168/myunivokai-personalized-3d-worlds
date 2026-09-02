# Engineering backlog — event-driven platform

> **Document status:** Cross-sprint planning baseline; execution status lives in sprint folders
> **Last source review:** 2026-07-22

This backlog originated the approved
[Vision V1 solution architecture](../architecture/v1-2026-07-22/solution-architecture.md).
Sprint 1 source implementation now exists. Use
[Sprint 1 user stories](../sprints/sprint-01-2026-07-22/user-stories.md) for
current implementation and verification status; `Ready` labels below preserve
the original planning baseline rather than overriding sprint evidence.

## EPIC-S1-MIGRATE-001 — Replace the platform completely in Sprint 1

Status: Ready
Priority: P0
Sprint: [Sprint 1 — starts 2026-07-22](../sprints/sprint-01-2026-07-22/README.md)

As the product owner,
I want the existing synchronous peer architecture replaced in one complete
sprint,
so that the deployed product starts from the scalable NATS/Redis/DNA design
without carrying two production paths.

Scenario: Complete the new generation lifecycle

Given a fresh environment with NATS, Redis and the three new databases
When a visitor requests a Universe or Nature generation
Then the gateway returns `202` after JetStream accepts the command
And `dna-service` creates validated canonical DNA
And the selected family stores a deterministic world from the DNA snapshot
And job polling returns the completed family/world result through the gateway.

Scenario: Retire the legacy runtime safely

Given local and deployed migration smoke tests pass
When traffic is cut to the new gateway contract
Then no deployed domain service exposes an HTTP business API
And the old shared gateway key and upstream URLs are unused
And the old services remain recoverable until the observation window passes
And old databases are deleted only by a separately confirmed operator action.

Epic exit:

- [ ] Every Sprint 1 story below is Verified.
- [ ] Local one-command startup and production deployment guide both pass.
- [ ] Source overview, vision, OpenAPI and environment docs match implemented
      code rather than the migration plan.

### S1-CONTRACT-001 — Freeze public and messaging contracts

Status: Ready
Priority: P0

As a service developer,
I want executable HTTP, NATS and canonical-DNA contracts,
so that independently deployed services cannot drift silently.

Scenario: Validate a message at every boundary

Given a versioned command, event or query fixture
When CI validates and decodes it in the owning Go modules
Then its body has only `jobId`, `timestamp` and typed `data`
And its subject carries operation and version
And invalid or incompatible data fails before business persistence.

Scenario: Describe the asynchronous browser API

Given the browser uses only the gateway
When the public OpenAPI contract is validated
Then generation returns `202 + jobId`
And job/world/variant/publish/share routes and errors are complete
And no direct domain-service URL appears.

Tasks:

- [ ] Define canonical `ProfileDNA` without planet/landmark/render fields.
- [ ] Add schemas/fixtures for the generic envelope and every Sprint 1 subject.
- [ ] Replace the health-only root OpenAPI with the new public API.
- [ ] Add Go/TypeScript contract drift and scene-schema tests.

### S1-LOCAL-001 — Run the complete target locally

Status: Ready
Priority: P0

As a developer,
I want one documented local command to start the target fleet,
so that NATS, Redis, migrations and service boundaries are tested before
deployment.

Scenario: Start from an empty machine state

Given Docker and a copied root `.env`
When the developer runs the documented Compose command
Then PostgreSQL, NATS JetStream and Redis become healthy
And three fresh databases and least-privilege roles are initialized
And all migrations/services start in dependency order
And only web/gateway plus explicitly documented local diagnostics publish host
ports.

Tasks:

- [ ] Keep root `docker-compose-local.yaml` as an `include` aggregator and add
      shared `infra/docker-compose-local.yaml`.
- [ ] Keep `.env.local` for root/component local development; prohibit real
      production credentials in tracked local files.
- [ ] Give every app/service its own local Compose plus `Dockerfile.local` and
      two-stage `Dockerfile.prod`.
- [ ] Add PostgreSQL database/role initialization, NATS ACL/bootstrap, Redis,
      named volumes, health checks, reset instructions and one smoke command.
- [ ] Rename the frontend to `apps/myunivokai-web` and update all path consumers.

### S1-EDGE-001 — Convert Gateway to NATS and Redis

Status: Ready
Priority: P0

As a visitor,
I want the gateway to accept work quickly and protect the shared edge,
so that AI latency does not hold HTTP requests and scaled gateway instances
enforce one policy.

Scenario: Accept durable work

Given NATS is ready and a generation request is valid
When the gateway publishes the command
Then it waits for JetStream `PubAck`
And returns `202` with the generated `jobId`
And never calls a domain HTTP API or AI provider.

Scenario: Apply shared rate limits and cache

Given two gateway instances share Redis
When one client crosses its configured budget across both instances
Then the combined requests receive the documented `429`
And safe world/share/job reads use cache-aside with bounded TTL/invalidation
And a Redis outage activates the documented conservative limiter/cache bypass.

Tasks:

- [ ] Remove reverse-proxy/upstream URL routing from the target runtime.
- [ ] Add JetStream publisher and Core NATS request-reply client.
- [ ] Replace in-memory limiter/share cache with Redis implementations and
      explicit degraded behavior.
- [ ] Keep circuit/no-responder state local unless a measured need proves it
      must be shared.
- [ ] Add NATS/Redis health, timeouts, metrics and tests.

### S1-DNA-001 — Establish canonical DNA and job ownership

Status: Ready
Priority: P0

As a visitor,
I want one semantic profile to drive different scene families,
so that another family can be generated without another independent reading
of my questionnaire.

Scenario: Generate canonical DNA once

Given a valid DNA command
When `dna-service` handles it
Then it records an idempotent root job and profile input
And the configured provider returns schema-valid family-neutral DNA
And a versioned immutable snapshot is sent to only the requested family
And provider failures finish the job with a stable safe error.

Scenario: Reuse DNA

Given a completed profile DNA version
When a second family is requested from that version
Then `dna-service` publishes the second family compose command
And no AI provider is called again.

Tasks:

- [ ] Create `services/dna-service` and `myunivokai_dna` migration baseline.
- [ ] Move/adapt provider adapters and orchestration out of family services.
- [ ] Implement inbox/outbox, root jobs, AI attempts and query responder.
- [ ] Test mock, repair/fallback, retry, duplicate and restart behavior.

### S1-FAMILY-001 — Convert Universe and Nature to independent NATS services

Status: Ready
Priority: P0

As a platform operator,
I want Universe and Nature independently deployable and scalable,
so that load or failure in one family does not require scaling the other.

Scenario: Compose a family world idempotently

Given a valid family command with canonical DNA snapshot
When the family service receives the message one or more times
Then exactly one logical world/result is created
And the existing seeded builder remains deterministic
And an immutable `profileId`, `dnaVersion` and DNA snapshot are stored
And a completed/failed event is published transactionally.

Scenario: Query without a public peer API

Given a world/share request reaches the gateway
When it issues the versioned Core NATS query
Then the owning family replies from its own database within the deadline
And the service has no public HTTP business endpoint.

Tasks:

- [ ] Create fresh `myunivokai_universe` and `myunivokai_nature` baselines.
- [ ] Preserve builders, variants, selection, publish/share privacy and tests.
- [ ] Replace AI and HTTP business layers with command/query/event handlers.
- [ ] Add inbox/outbox, duplicate delivery, redelivery and graceful shutdown.
- [ ] Prove each service credential/database permission is isolated.

### S1-FE-001 — Adopt the asynchronous gateway flow

Status: Ready
Priority: P0

As a visitor,
I want visible reliable generation progress,
so that an asynchronous AI job does not look frozen or fail on an HTTP timeout.

Scenario: Generate and navigate to a world

Given the gateway accepts a request with `202`
When the frontend receives `jobId`
Then it polls with bounded backoff and a total deadline
And renders queued/processing/failed states accessibly
And navigates to the returned family/world only after completion
And every API request still uses one gateway origin.

Tasks:

- [ ] Replace synchronous create assumptions with typed job state.
- [ ] Preserve family selection, renderer registry, variants and share flows.
- [ ] Add polling cancellation/retry/error tests and refresh recovery.
- [ ] Update runtime validation/types from executable contracts.

### S1-DEPLOY-001 — Deploy and prove the complete fleet

Status: Ready
Priority: P0

As a platform operator,
I want a reproducible deployment and rollback guide,
so that the new architecture is verified rather than inferred from config.

Scenario: Deploy the production topology

Given managed NATS/Redis, three Neon databases and Render credentials
When the operator follows the Sprint 1 deployment guide
Then `myunivokai-gateway` runs as the public web service
And `myunivokai-dna`, `myunivokai-universe` and `myunivokai-nature` run as
always-on background services without `-worker` in their names
And credentials/subject/database boundaries pass negative tests
And both family lifecycles pass through the public gateway.

Tasks:

- [ ] Replace `render.yaml` with the target service types/names/env groups.
- [ ] Document managed NATS, Redis and three Neon database provisioning.
- [ ] Document migrations, rollout, smoke, observation, rollback and retirement.
- [ ] Record commit SHA/timestamp/pass-fail evidence without secrets.

### S1-CUTOVER-001 — Retire old services and data deliberately

Status: Planned after S1-DEPLOY-001 smoke
Priority: P0

As a platform operator,
I want an explicit cutover and retirement checkpoint,
so that accepting a fresh baseline does not cause an accidental unrecoverable
deletion.

Scenario: Retire the legacy fleet

Given the new fleet has passed the observation window and rollback evidence is
captured
When the owner confirms the exact legacy Render services and database names
Then those targets are retired without wildcard or inferred deletion
And the action and recoverability are recorded
And no new-platform resource is included.

## EPIC-S2-SCALE-001 — Prove resilience and horizontal scale

Status: Planned after Sprint 1
Priority: P1
Sprint: [Sprint 2 — starts 2026-08-05](../sprints/sprint-02-2026-08-05/README.md)

As a platform operator,
I want measured capacity, recovery behavior and end-to-end observability,
so that scaling decisions are based on bottlenecks rather than service count.

Scenario: Scale one bottleneck independently

Given a reproducible mixed workload
When gateway, DNA, Universe or Nature reaches its threshold
Then only that component is scaled
And durable consumers distribute work without duplicate business effects
And shared rate/cache semantics remain stable.

Scenario: Diagnose and recover from dependency failure

Given NATS, Redis, provider or one database is interrupted
When the platform degrades and recovers
Then metrics/traces identify the failed stage
And accepted jobs are recovered, completed or explicitly failed
And no raw profile input or secret is logged.

Tasks:

- [ ] Define load model, SLOs and per-component scale triggers.
- [ ] Add RED, consumer lag/redelivery, outbox age, Redis and DB-pool metrics.
- [ ] Prove two-gateway and multi-consumer behavior.
- [ ] Run fault injection for NATS, Redis, AI and PostgreSQL.
- [ ] Document capacity results and update deployment sizing.

## EPIC-S3-CITY-001 — Add City on the stable platform

Status: Planned after Sprint 2 gates. **Moved from 2026-08-19 to 2026-09-09 on
2026-08-15**, when the owner brought Ocean forward. Nothing about the scope
below changed; only the date did. Its open asset-budget question — CyArk's
UNESCO scans are CC BY-NC 4.0 and Ancient Egypt sits behind Synty's paywall —
is still open and still gates the multi-civilisation ambition.
Priority: P1
Sprint: [Sprint 3 — starts 2026-09-09](../sprints/sprint-03-2026-09-09/README.md)

As a returning visitor,
I want the same DNA rendered as a high-fidelity personal city,
so that Myunivokai adds a genuinely new portrait medium.

Scenario: Add a bounded context without changing existing consumers

Given the versioned canonical DNA and subject conventions
When City is introduced
Then `myunivokai-city` owns `myunivokai_city`, City commands/queries/events and
its deterministic builder
And DNA dispatch adds City without modifying Universe/Nature behavior
And the gateway selects City through its subject registry
And the frontend lazy-loads `sceneType: city`.

Scenario: Approve a high-fidelity desktop vertical slice

Given a fixed City fixture and approved visual references
When the desktop review flow creates, views and shares a City
Then layout, roads, districts, buildings, landmark, lighting and atmosphere are
deterministic and coherent
And self-hosted assets/licenses/contracts pass
And owner-approved screenshots establish the baseline before low-end tuning.

Tasks:

- [ ] Finalize CityDNA mapping from canonical DNA and CitySceneConfig schema.
- [ ] Add `city-service`, database, subjects, inbox/outbox and queries.
- [ ] Add deterministic high-fidelity renderer and complete public flow.
- [ ] Extend Compose/deployment/monitoring and pass production smoke.

## EPIC-S6-OCEAN-001 — Add Ocean as the third family

Status: Implemented; deployed verification outstanding
Priority: P1
Sprint: [Sprint 6 — starts 2026-08-19](../sprints/sprint-06-2026-08-19/README.md)
Design: [ocean-service-plan.md](../services/ocean-service-plan.md)

As a returning visitor,
I want the same DNA rendered as a personal sea at a real depth,
so that Myunivokai offers a portrait medium whose whole character comes from
one axis the other families do not have.

Scenario: Add a bounded context without changing existing consumers

Given the versioned canonical DNA and subject conventions
When Ocean is introduced
Then `myunivokai-ocean` owns `myunivokai_ocean`, Ocean commands/queries/events
and its deterministic builder
And DNA dispatch adds Ocean without modifying Universe/Nature behaviour
And the gateway selects Ocean through its subject registry, registered above the
unsupported-family catch-all
And the frontend lazy-loads `sceneType: ocean` as its own chunk.

Scenario: Depth is measured physics, not a table of three presets

Given the measured light-attenuation anchors (45% at 1 m, 16% at 10 m, 5% at
40 m, 1% at 100 m, nothing at 1000 m)
When a world is built at any depth
Then water colour, fog, visibility, god rays and caustics are DERIVED from that
depth and then STORED, so re-tuning the curve never changes an existing world
And god rays and caustics reach exactly zero at the sunlight floor without any
depth test anywhere in the builder or the renderer
And a single-exponential fit is rejected by a test, because it misses the 10 m
measurement by three orders of magnitude while looking entirely plausible.

Scenario: The preview does not lie about the world it promises

Given the create form renders a live WebGL preview before anything is generated
When the preview builder and the Go builder are compared
Then everything the depth curve decides is byte-identical across the two
languages, pinned by the Go builder's own golden fixtures
And the seeded halves stay only plausible, exactly as the forest preview does.

Tasks:

- [x] `WorldFamilyOcean`, five subject switches, scene schema and fixtures.
- [x] `ocean-service` with revision, inbox/outbox and the snapshot drift guard.
- [x] The depth curve, its eight tests, and four goldens across three zones.
- [x] Gateway route and handler, wake target, local Compose, CI job.
- [x] Procedural renderer, preview builder, share route, product flow, audio.
- [x] Four rarity entries in Go and TypeScript against the shared fixture.
- [x] `render.yaml` block on the free tier (owner-approved 2026-08-15).
- [ ] Deployed smoke across the full lifecycle, recorded with commit and time.
- [ ] Confirm an ocean world reaches `myunivokai_analytics` in production.
- [ ] Owner-approved screenshots at all three depth zones as the regression
      baseline.

## EPIC-S4-AUTH-001 — Staff identity and the internal admin app

Status: Ready
Priority: P0
Sprint: [Sprint 4 — starts 2026-08-06](../sprints/sprint-04-2026-08-06/README.md)

As a staff member,
I want a dedicated identity service and an internal admin app separate from the
3D product,
so that I can log in, be granted exactly the roles I need, and browse
records without the panel becoming a second, worse way to reach production
data.

Scenario: Staff identity never touches ownership

Given no visitor identity exists yet
When auth-service and the admin app are built
Then no `owner_account_id` column is added anywhere
And access/refresh tokens carry `audience: "admin"`, disjoint from any future
`audience: "web"` token
And [`DEFERRED-AUTH-001`](#deferred-auth-001--define-identity-before-authentication)
remains untouched — staff auth answers "may this actor act?", not "who owns
this row?".

Scenario: One gateway, two blast radii kept apart

Given the existing public gateway gains an `/api/admin` route group
When the admin route group is exercised
Then every route rejects an unauthenticated request by default, proven by an
enumerating router test
And the admin group's CORS, rate limits and NATS admin-publish permissions
are isolated from the product group.

Epic exit:

- [ ] Every Sprint 4 `S4-AUTH-*` story below is Verified.
- [ ] The admin app renders zero content without a valid staff session.
- [ ] `role:manage`'s lockout guards are proven by test, not by convention.

Sprint stories: [S4-AUTH-001 through S4-AUTH-006](../sprints/sprint-04-2026-08-06/user-stories.md#epic-s4-auth-001--staff-identity-and-the-internal-admin-app)

Source: [auth-and-admin-plan.md](../services/auth-and-admin-plan.md)

## EPIC-S4-ANALYTICS-001 — A read model for the admin app

Status: Ready
Priority: P0
Sprint: [Sprint 4 — starts 2026-08-06](../sprints/sprint-04-2026-08-06/README.md)

As a staff member,
I want the admin app's reads served by a dedicated analytics read model rather
than a live fan-out across dna, universe and nature,
so that an admin page only ever waits on analytics and auth, and a sleeping
domain service never blanks a screen it has nothing to do with.

Scenario: The read model is the only writer to its own database

Given events already flow through `MYUNIVOKAI_EVENTS`
When analytics-service is built
Then it is the only writer to its own database, fed solely by its own event
consumer
And every HTTP or NATS path into it is read-only
And no domain service ever receives a request on an admin read path.

Scenario: Close the event gap before it becomes permanent

Given variant creation, variant selection and publish emit no event today
When Sprint 4 starts
Then universe and nature begin emitting a revision-stamped `WorldSnapshot` on
every mutation before analytics-service exists to consume it
And no event needed for a later admin screen is lost to JetStream's 7-day
retention window.

Epic exit:

- [ ] Every Sprint 4 `S4-ANALYTICS-*` story below is Verified.
- [ ] `analytics-service`'s schema has no `outbox_messages` table.
- [ ] The admin dashboard, worlds table and jobs table read from analytics only.

Sprint stories: [S4-ANALYTICS-001 through S4-ANALYTICS-007](../sprints/sprint-04-2026-08-06/user-stories.md#epic-s4-analytics-001--a-read-model-for-the-admin-app)

Source: [analytics-service-plan.md](../services/analytics-service-plan.md)

## EPIC-S5-TELEMETRY-001 — Operational telemetry and the first Rust service

Status: Implemented — not Verified. Source and automated checks exist for every
story; the Rust crates have never been compiled (no toolchain on the authoring
machine) and nothing is deployed. See
[Sprint 5 §Honest status](../sprints/sprint-05-2026-08-13/user-stories.md#honest-status).
Priority: P1
Sprint: [Sprint 5 — starts 2026-08-13](../sprints/sprint-05-2026-08-13/README.md)

As a platform operator,
I want the platform to measure its own request volume, latency, error mix,
per-backend round-trip time and cache hit rate,
so that questions this repository's own research already names as
unanswerable — which routes are used, whether `Retry-After: 15` is long
enough, whether the Redis cache earns its keep — stop being unanswerable.

Scenario: Aggregate before the network, never after

Given a gateway serving any volume of requests
When telemetry is enabled
Then the gateway aggregates in memory and publishes one envelope per interval
And no design anywhere in this track puts a broker publish on the request path
And every bucket is keyed on a route template, never a raw path.

Scenario: A second language is bounded rather than accidental

Given `telemetry-service` is written in Rust while every other service is Go
When the wire contract changes in either language
Then the shared fixture test fails in CI rather than at runtime
And `agent-system/knowledge/backend/source-overview.md` states why one service is not Go, so the
next reader does not read it as an accident.

Scenario: One switch, two destinations

Given `TELEMETRY_SINK`
When it is set to `postgres` or `otlp`
Then the same envelopes land in this repository's own schema or in Grafana
Cloud, chosen once at startup
And the admin app says which one it is looking at rather than rendering an
empty chart when the answer lives elsewhere.

Epic exit:

- [ ] Every Sprint 5 `S5-TELEMETRY-*` story is Verified.
- [x] The gateway's telemetry path is off by default and provably inert when
      off — `TestWithNoCollectorTheRequestPathRecordsNothing`.
- [x] `myunivokai-admin` renders request volume, status mix and per-route p95,
      with the p95's interpolation stated on the screen rather than in a
      tooltip.

Sprint stories: [S5-TELEMETRY-001 through S5-TELEMETRY-009](../sprints/sprint-05-2026-08-13/user-stories.md#epic-s5-telemetry-001--operational-telemetry-and-the-first-rust-service)

Source: [telemetry-service-plan.md](../services/telemetry-service-plan.md)

## EPIC-S7-FE-EXPERIENCE-001 — Transition, form and ambience polish for the create/gallery experience

Status: Planned
Priority: P1
Sprint: [Sprint 7 — starts 2026-08-28](../sprints/sprint-07-2026-08-28/README.md)

As a visitor curating and revisiting a personal world,
I want the create form, the family/world transitions, the gallery backdrop and
the ambient soundscape to feel like one coherent, responsive product,
so that the surrounding experience matches the ambition already proven by the
Universe/Forest/Ocean renderers themselves.

Scenario: The create form holds up across the whole viewport range

Given a viewport anywhere between 360px and 1440px wide
When the create form renders
Then no World Family card sits orphaned on a half-empty row
And a tablet-width viewport gets its own layout tier rather than the
sub-`lg` mobile treatment
And the live-preview identity placard reaches a visitor below `lg`, not only
above it.

Scenario: Depth is heard as well as seen

Given an Ocean world's stored depth value
When its ambient soundscape mix is built
Then the mix derives from the same `oceanDepthCurve.ts` output already
driving color, fog and god-rays, not a second independent table.

Scenario: Weak devices get a real tier, not a deferral

Given the owner's 2026-08-28 decision to pull adaptive quality tiers forward
out of their post-City slot (recorded in
[frontend-plan.md](../frontend/frontend-plan.md) gap #4)
When a visitor's device classifies below the top GPU tier
Then DPR, shadow, postprocessing and LOD come from a matching profile instead
of the single fixed high-tier profile
And a visitor already at the top tier sees pixel-identical output to before
this epic.

Epic exit:

- [ ] Every Sprint 7 story below is Verified.
- [ ] No viewport between 360px and 1440px shows a create-form layout break
      named in S7-FE-RESPONSIVE-001.
- [ ] `prefers-reduced-motion: reduce` disables every animation this epic adds
      without breaking navigation.
- [ ] A visitor already at the tier-3/desktop GPU classification sees output
      pixel-identical to the pre-Sprint-7 fixed profile.

Sprint stories: [S7-FE-RESPONSIVE-001 through S7-FE-ADAPTIVE-001](../sprints/sprint-07-2026-08-28/user-stories.md#epic-s7-fe-experience-001--transition-form-and-ambience-polish-for-the-creategallery-experience)

Source: this epic has no predecessor vision document; scope and source
citations live directly in [Sprint 7's user-stories.md](../sprints/sprint-07-2026-08-28/user-stories.md),
on the same basis as [scene-fidelity.md](scene-fidelity.md) and
[world-chrome.md](world-chrome.md). The adaptive-tier story's own sequencing
decision is recorded in [frontend-plan.md](../frontend/frontend-plan.md) gap #4.

## EPIC-S8-IDENTITY-001 — End-user identity and world ownership

Status: Ready
Priority: P0
Sprint: [Sprint 8 — starts 2026-09-02](../sprints/sprint-08-2026-09-02/README.md)

This epic is what [`DEFERRED-AUTH-001`](#deferred-auth-001--define-identity-before-authentication)
becomes. It answers that story's every clause and closes it.

As a visitor,
I want an account that owns the worlds I make,
so that my collection survives a cleared browser, a new phone and a browser
that evicts storage on its own — and so that the AI bill behind those worlds
has a ceiling.

Scenario: A durable identity, and one that does not gate the first world

Given anonymous creation stays, because the first world is the product's pitch
When a visitor creates worlds anonymously and later signs up
Then the worlds carrying their minted anonymous id become owned by the new
account, exactly once and idempotently
And ownership is enforced in the same transaction as each mutation, never
against a read model
And the visitor's own worlds are listed from the server, not from
`localStorage`.

Scenario: Two audiences, one accounts table, kept structurally apart

Given Sprint 4 built staff identity as one half of a deliberately two-audience
design
When the `web` audience is turned on
Then an `end_user` account holds no role and no permission row
And a `web` token is rejected by the admin edge and an `admin` token by the
product edge, both proven by test
And `owner_account_id` never reaches `myunivokai_analytics`.

Scenario: The bill gains a ceiling without the visitor losing a world

Given no per-caller quota exists anywhere in the platform today
When a caller passes the daily AI limit
Then the world is still created, from the mock provider, and the visitor is
told once
And no create request is refused.

Epic exit:

- [ ] Every Sprint 8 `S8-IDENTITY-*` story is Verified.
- [ ] The audience separation is proven in **both** directions, not one.
- [ ] A deleted world's share URL stops resolving **through the gateway**
      immediately, proven by a test that goes through the gateway.
- [ ] A replayed claim and a second device's claim each update zero rows.
- [ ] A visitor sees their worlds on a device that has never seen them.
- [ ] No new service, no new database and no new third-party account was added.

Sprint stories: [S8-IDENTITY-001 through S8-IDENTITY-016](../sprints/sprint-08-2026-09-02/user-stories.md#epic-s8-identity-001--end-user-identity-and-world-ownership)

Source: [end-user-identity-and-ownership.md](../architecture/end-user-identity-and-ownership.md)
— **read its §16 first.** Nineteen decisions taken on 2026-09-02 supersede
parts of §3.4, §5, §9, §10, §11 and §17 in place, and most of them cut scope:
there is no account-deletion feature, no mail provider, no password reset, no
passkeys and no `library-service` in this epic.

## DEFERRED-AUTH-001 — Define identity before authentication

Status: **Closed on 2026-09-02 — superseded by
[`EPIC-S8-IDENTITY-001`](#epic-s8-identity-001--end-user-identity-and-world-ownership)
and scheduled as [Sprint 8](../sprints/sprint-08-2026-09-02/README.md).**
Deferred by owner decision on 2026-07-22 and unaffected by Sprint 4 — staff
identity in `EPIC-S4-AUTH-001` never added ownership; see that epic's first
scenario. Answered on 2026-09-02 by
[end-user-identity-and-ownership.md](../architecture/end-user-identity-and-ownership.md),
which takes every clause of this story's `Then` — issuer, account mapping,
object ownership, anonymous claim/migration, public share, deletion/export and
service authorization — as a numbered decision. Nineteen of those decisions
were taken across four rounds on 2026-09-02, and **one clause is deliberately
answered "not built": deletion/export.** The owner decided there is no
user-facing account deletion and no purge, so data erasure is discharged by a
manual runbook rather than by a feature — recorded in the plan's §10 and §16
decision 9, and carried as accepted risk 2 in the sprint. That is an answer,
not an omission, which is why this story closes rather than staying open on it.
Priority: Discovery

As a future account holder,
I want worlds owned and authorized consistently,
so that login adds actual privacy rather than a placeholder auth service.

Scenario: Approve identity later

Given Sprint 1 intentionally has no user identity
When authentication is reconsidered
Then issuer, account mapping, object ownership, anonymous claim/migration,
public share, deletion/export and service authorization are approved first
And internal NATS credentials are not confused with user authentication.

## Deferred product work retained from the previous backlog

The supported Next.js major upgrade, self-hosted Draco, asset/license budgets,
and full City breadth remain valid product/engineering work. They must be
re-estimated after Sprint 1 because the public API, runtime contracts and
deployment topology change. Do not execute the old HTTP-peer City edge stories
as written; the target uses NATS.

Adaptive weak-device quality left this list on 2026-08-28: it is no longer
merely "remains valid," it is scheduled as `S7-FE-ADAPTIVE-001` under
[EPIC-S7-FE-EXPERIENCE-001](#epic-s7-fe-experience-001--transition-form-and-ambience-polish-for-the-creategallery-experience),
pulled forward ahead of City by the owner.

Lazy renderer chunks left this list: shipped on `feat/fe/lazy-renderer-chunks`,
First Load JS 512-526 kB → 436-450 kB on the five 3D routes. Mechanism and
numbers in [../fe/threejs-scene-architecture.md](../../knowledge/frontend/threejs-scene-architecture.md)
§Family chunks.

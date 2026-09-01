# Sprint 05 user stories — telemetry-service

> **Document status:** Implemented, and locally verified end to end. The Rust
> crates compile, `cargo fmt`/`clippy -D warnings`/`test` are green in the
> container, and one gateway flush has been driven through JetStream into
> `myunivokai_telemetry` and read back out over NATS. **Not Verified:** nothing
> is deployed. See §Honest status below.
> **Sprint starts:** 2026-08-13
> **Last source review:** 2026-08-13

One epic, nine stories, ordered by dependency. `S5-TELEMETRY-001` (the shared
contract) blocks everything and lands first, for the same reason
`analytics-service-plan.md` put its contract phase first: a fixture both
languages test against is cheap now and expensive to retrofit once two
independent guesses at the shape already exist.

`S5-TELEMETRY-002` (the gateway collector) can then run in parallel with
`S5-TELEMETRY-003`/`004` (the Rust service), because envelopes accumulate on
`MYUNIVOKAI_EVENTS` with no consumer, exactly as analytics' events did before
phase 2 of that plan. `S5-TELEMETRY-007` (the admin routes) is the first story
that needs both halves alive at once.

## EPIC-S5-TELEMETRY-001 — Operational telemetry and the first Rust service

### S5-TELEMETRY-001 — Freeze the rollup contract in two languages

Status: Implemented
Priority: P0

As a service developer,
I want the rollup envelope defined once in Go and once in Rust, both tested
against the same fixture file,
so that a second language in the repository cannot silently drift from the
first.

Scenario: One fixture, two decoders

Given `contracts/fixtures/telemetry-http-rollup-event.v1.json` exists
When the Go contract test and the Rust contract test both run in CI
Then both decode that exact file into their own struct and assert the same
field values
And the Go test additionally validates it against
`contracts/schemas/message-envelope.schema.json`, like every other fixture.

Scenario: Drift fails the build rather than production

Given a developer changes a field name on the Go side only
When CI runs
Then the Rust fixture test fails on the missing field
And no decode error is discovered in a deployed service instead.

Source evidence:
- agent-system/plans/services/telemetry-service-plan.md — §Rust contracts, §Phases (phase 0)
- agent-system/evolution/rust-adoption-research.md — §Re-scoring Track C's four criteria, criterion 3

Tasks:
- [x] Add `HTTPRollupEnvelope`, `HTTPRollupBucket`, `NATSBackendBucket`, `CacheBucket`, the query/response types and the subject constants to `contracts/go` as `contracts_telemetry_rollup.go` — separate from the existing `contracts_telemetry.go`, which is fleet start telemetry and a different concern.
- [x] Create the `contracts/rust` crate mirroring `Envelope<T>`, the RPC envelope shapes and the rollup types.
- [x] Add the shared fixture and the decode test on both sides.

### S5-TELEMETRY-002 — Aggregate the gateway's own activity in memory

Status: Implemented
Priority: P0

As a platform operator,
I want the gateway to aggregate what it is doing and publish one summary per
minute,
so that request volume, latency and error mix become answerable without
putting a broker publish on the hot path.

Scenario: One envelope per interval, not one per request

Given `TELEMETRY_ENABLED=true` and a flush interval of 60 seconds
When the gateway serves any number of requests during an interval
Then exactly one message is published on
`myunivokai.events.telemetry.http.v1` for that interval
And it carries HTTP buckets, per-backend NATS round-trip buckets and Redis
cache hit/miss counters together, not three separate messages.

Scenario: The cardinality rule holds

Given a request to `/api/universe/worlds/01K0EXAMPLE000000000000014`
When the collector records it
Then the bucket's route pattern is `/api/universe/worlds/{worldID}`
And no bucket key anywhere contains a world id, job id, share slug or client
address.

Scenario: Telemetry never changes what a client sees

Given `TELEMETRY_ENABLED` is unset, which is its default
When any request is served
Then no bucket is recorded, no ticker runs and nothing is published
And every response is identical to the one the same build serves today.

Source evidence:
- agent-system/plans/services/telemetry-service-plan.md — §Gateway-side work (Go), §Durability and wake
- agent-system/evolution/platform-evolution-research.md — §B2, the cardinality rule
- agent-system/evolution/telemetry-architecture-research.md — §The number that was missing

Tasks:
- [x] Add `services/api-gateway/internal/telemetry/collector.go` — the in-memory bucket map, the histogram edges, and `Snapshot` returning one envelope's worth of buckets and resetting.
- [x] Record HTTP buckets from a middleware that reads `chi.RouteContext(...).RoutePattern()` **after** the handler chain has run, and error codes from the gateway's own error writer.
- [x] Record NATS round-trip buckets in `RPCTransport.Request`, keyed on `wake.ServiceForSubject(subject)` — the value it already computes.
- [x] Record cache hits and misses at the three existing `job:v1`/`world:v1`/`share:v1` lookup sites.
- [x] Add the flusher: a ticker plus one final flush on graceful shutdown, publishing through JetStream (`js.Publish`), never Core NATS.
- [x] Add `TELEMETRY_ENABLED` and `TELEMETRY_FLUSH_INTERVAL` to gateway config, defaulting to off.

### S5-TELEMETRY-003 — Stand up telemetry-service and its durable consumer

Status: Implemented
Priority: P0

As a platform operator,
I want a service that survives being asleep for a week and still catches up,
so that a rollup published while nothing was listening is not simply lost.

Scenario: Sleep does not lose data

Given `telemetry-service` is asleep and the gateway flushes several intervals
When the service next starts
Then its durable JetStream consumer resumes from its last acknowledged
message and processes every envelope published while it was down
And nothing depends on the service being subscribed at publish time.

Scenario: A sink is chosen once, at boot

Given `TELEMETRY_SINK=postgres`
When the service starts
Then it builds exactly one sink, logs which one, and the rest of the service
is written against the `TelemetrySink` trait rather than a concrete type
And an unknown value stops the process at startup instead of running with a
silently-wrong destination.

Source evidence:
- agent-system/plans/services/telemetry-service-plan.md — §The `TelemetrySink` trait, §Phases (phase 2)
- services/analytics-service/internal/messaging/runtime.go — the durable-consumer shape being mirrored

Tasks:
- [x] Create `services/telemetry-service` with `main.rs`, `config.rs` (env-first, dotenv second, matching every Go service's `loadEnvironmentFiles`), and the `TelemetrySink` trait.
- [x] Implement the durable pull consumer on `MYUNIVOKAI_EVENTS` filtered to the telemetry subject, `max_deliver: -1` mirroring `dnaResultsDurableName`.
- [x] Serve `/healthz` on `PORT` with `axum`, bound before the consumer starts, so a cold start has an inbound HTTP target.
- [x] Add a `Dockerfile.local`, a `Dockerfile.prod` and a `README.md` runbook alongside the other services'.

### S5-TELEMETRY-004 — Store rollups in the service's own database

Status: Implemented
Priority: P0

As a platform operator,
I want the rollups in a schema this repo owns,
so that the admin app can chart them without a vendor in the loop.

Scenario: A redelivery is not a double count

Given an envelope that has already been stored
When JetStream delivers it a second time
Then the inbox row short-circuits the write and no counter moves
And the message is acknowledged rather than redelivered forever.

Scenario: Percentiles admit what they are

Given a p95 computed from the fixed histogram buckets
When it is returned to the admin app
Then the response marks it as an interpolation over bucket edges, not an exact
value, and the screen renders that qualification next to the number.

Scenario: Retention is enforced, not documented

Given rows older than `TELEMETRY_RETENTION_DAYS`
When the retention ticker runs
Then those rows are deleted from every rollup table.

Source evidence:
- agent-system/plans/services/telemetry-service-plan.md — §Data model, §What this service tracks
- services/analytics-service/internal/services/projection_service.go — the inbox idempotency shape being mirrored

Tasks:
- [x] Add `migrations/0001_init.sql`: `http_rollups`, `error_code_rollups`, `nats_rollups`, `cache_rollups`, `inbox_messages`.
- [x] Implement `sinks::postgres::PostgresSink::write_rollup` — one transaction per envelope, inbox insert first, `ON CONFLICT` accumulation for every bucket table.
- [x] Implement the overview and per-route queries, including the `SERVICE_WAKING` count that answers the wake-conversion question.
- [x] Implement the retention ticker.
- [x] Test the histogram/percentile interpolation and the envelope→row mapping without a database.

### S5-TELEMETRY-005 — Forward to Grafana Cloud instead, on one switch

Status: Implemented
Priority: P1

As a platform operator,
I want the same rollups pushed to Grafana Cloud when I ask for it,
so that alerting is available without building it here.

Scenario: The switch is the only difference

Given `TELEMETRY_SINK=otlp`
When an envelope arrives
Then each bucket is exported as OTLP metric points and nothing is written to
any database
And no other part of the service changes behaviour.

Scenario: A missing chart reads as "look elsewhere"

Given the OTLP sink cannot answer a range query, because Grafana owns the
query surface once data is pushed there
When the admin app asks for the overview
Then the service answers with an explicit "charts live in Grafana" payload
carrying the configured dashboard URL, rather than an error or an empty chart.

Source evidence:
- agent-system/plans/services/telemetry-service-plan.md — §The `TelemetrySink` trait, §Admin surface

Tasks:
- [x] Implement `sinks::otlp::OtlpSink::write_rollup`.
- [x] Return the "charts are elsewhere" response shape from `query_range`, carrying `TELEMETRY_DASHBOARD_URL`.
- [x] Document in the service README why a pre-aggregated histogram is exported as bucket counters rather than replayed through an OTLP histogram instrument.

### S5-TELEMETRY-006 — Wake telemetry-service like every other service

Status: Implemented
Priority: P0

As a staff member,
I want opening the Telemetry screen to start the service if it is asleep,
so that an idle read model does not blank a screen.

Scenario: No special case is added

Given a query on `myunivokai.queries.telemetry.overview.get.v1`
When it finds no responder
Then `wake.ServiceForSubject` resolves `telemetry` by the same prefix rule
every other service resolves by, with no telemetry-specific branch
And the gateway answers `503 SERVICE_WAKING` with `Retry-After` and starts the
service.

Scenario: The two lists cannot drift

Given `wake.ServiceTelemetry` is added to `wake.Services`
When `TELEMETRY_SERVICE_URL` is not added to `serviceWakeURLKeys`
Then `internal/config/wake_config_test.go` fails.

Source evidence:
- agent-system/plans/services/telemetry-service-plan.md — §Durability and wake
- services/api-gateway/internal/config/wake_config_test.go

Tasks:
- [x] Add `wake.ServiceTelemetry` to `internal/wake/platform.go` (constant, `Services`, and `ServiceForSubject`'s switch).
- [x] Add `"telemetry": "TELEMETRY_SERVICE_URL"` to `serviceWakeURLKeys`.

### S5-TELEMETRY-007 — Relay the telemetry reads through /api/admin

Status: Implemented
Priority: P0

As a staff member,
I want the telemetry reads on the existing admin API,
so that they inherit its authentication, permissions, rate limit and CORS
rather than growing a second protected surface.

Scenario: A pure relay, like every other admin read

Given `GET /api/admin/telemetry/overview`
When the gateway handles it
Then it publishes exactly one `myunivokai.queries.telemetry.*` subject and
returns the reply payload unchanged
And it sums, groups and merges nothing.

Scenario: Default deny still holds

Given the enumerating admin router test
When the two new routes are registered
Then both reject an unauthenticated request and both require `chart:read`.

Source evidence:
- agent-system/plans/services/telemetry-service-plan.md — §Admin surface
- services/api-gateway/internal/handlers/admin_analytics_handler.go — the relay being mirrored

Tasks:
- [x] Add `admin_telemetry_handler.go` with `Overview` and `Routes`.
- [x] Register both under `chart:read` in `admin_router.go`.
- [x] Extend `contracts/openapi-admin.yaml` with both routes and their response schemas.

### S5-TELEMETRY-008 — Deploy telemetry-service

Status: Implemented
Priority: P1

As a platform operator,
I want the service deployable by the same blueprint every other service uses,
so that a second language does not become a second deployment procedure.

Scenario: The blueprint describes the whole fleet

Given `render.yaml`
When `myunivokai-telemetry` is added
Then it is a `type: web` free service with a two-stage `Dockerfile.prod`, like
every other service
And the gateway block gains `TELEMETRY_SERVICE_URL` as a sixth `sync: false`
entry, blank on first sync like the other five.

Scenario: CI covers the second language

Given the new `telemetry-service-checks` job
When CI runs
Then `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` and
`cargo build --release` all run, plus the fixture-decode test from
`S5-TELEMETRY-001`.

Source evidence:
- agent-system/plans/services/telemetry-service-plan.md — §Deploy and CI additions
- agent-system/skills/auth-analytics-first-deploy-checklist.md — why no new NATS user is needed in production

Tasks:
- [x] Add the `myunivokai-telemetry` block and the gateway's `TELEMETRY_SERVICE_URL` to `render.yaml`.
- [x] Add the `telemetry-service-checks` and `contracts-rust-checks` CI jobs.
- [x] Add the local-only NATS ACL block and the local compose service.
- [x] Add every new variable to `.env.example`, and the "why one service is not Go" paragraph to `agent-system/knowledge/backend/source-overview.md`.

### S5-TELEMETRY-009 — Show telemetry in the admin app

Status: Implemented
Priority: P1

As a staff member,
I want a Telemetry screen,
so that request volume, status mix and per-route latency are visible where
every other operational answer already is.

Scenario: The screen is honest about its numbers

Given the overview renders a p95
When a reader looks at it
Then the interpolation qualifier is visible next to the number, not buried in
a tooltip nobody opens.

Scenario: The screen is honest about its sink

Given the service is running with `TELEMETRY_SINK=otlp`
When the screen loads
Then it shows the "charts live in Grafana" state with a link, instead of empty
charts.

Source evidence:
- agent-system/plans/services/telemetry-service-plan.md — §Admin surface
- apps/myunivokai-admin/src/features/analytics/FleetPage.tsx — the screen being mirrored

Tasks:
- [x] Add the `telemetry` feature folder: `api.ts`, `types.ts`, `TelemetryPage.tsx`, the volume/status charts and the per-route table.
- [x] Add the `/telemetry` route and the nav entry, gated on `chartRead`.

### DEFERRED-S5-NAV-001 — Restructure the admin navigation

Status: **Done** on 2026-08-14, on the owner's trigger
Priority: Post-Telemetry

As a staff member,
I want the sidebar grouped by concern once it holds eight entries,
so that product, platform and administration screens stop reading as one flat
list.

Deferred on 2026-08-13 until the sidebar demonstrably felt crowded rather than
on the day the eighth entry landed. The owner reported exactly that on
2026-08-14 — "UI hiện tại quá rối rắm không sắp xếp khoa học" — which was the
trigger this story was waiting for.

**Chosen direction:** grouped sections inside the existing sidebar, not a
top-level section switcher. A switcher hides two thirds of the destinations
behind a control, which is the right trade at twenty entries and the wrong one
at eleven — it costs a click on every cross-group move to save vertical space
that is not scarce.

**The grouping is by whose question a screen answers, not by which service
serves it:**

| Group | Screens |
| --- | --- |
| Business | Overview · Worlds · Jobs · Content mix |
| Platform | Traffic · Performance · Reliability · Fleet |
| Administration | Accounts · Roles · Audit log |

Traffic, Performance and Reliability all read `telemetry-service` and are three
entries because they answer three questions; Overview and Content mix both read
`analytics-service` for the same reason. Grouping by producer would have filed
"how fast is the platform" beside "how many requests" only because one process
computes both.

Two screens were split out of pages that had grown past scanning: Content mix
took every distribution, the family mix and the trait radar off Overview, and
the single Telemetry page became three. A group with no visible items is
dropped entirely rather than rendered as a heading over empty space.

Delivered in `apps/myunivokai-admin/src/components/layout/nav-config.ts`
(`NAV_GROUPS`), `app-sidebar.tsx` and `breadcrumb-header.tsx`, which now prints
the group beside the page — "Platform / Performance" — so a reader who arrived
by link learns the grouping too.

## Honest status

- **Every language's checks are green.** `contracts/go`,
  `services/api-gateway` and `apps/myunivokai-admin` pass `vet`/`test`/`build`,
  `typecheck`, `lint` and the import-boundary check. `contracts/rust`
  (22 tests) and `services/telemetry-service` (57 tests) pass `cargo fmt
  --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` — run
  inside the local container, which is where the Rust toolchain lives.
- **The pipeline has been driven end to end locally.** With
  `TELEMETRY_ENABLED=true` on the gateway, a flush travelled through JetStream
  into `myunivokai_telemetry`, and
  `myunivokai.queries.telemetry.overview.get.v1` answered `200` with real
  aggregates over those rows. The stored `route_pattern` was
  `/api/universe/worlds/{worldID}` with no world id anywhere, every unmatched
  URL collapsed into one `unmatched` row, and the inbox held one
  `{instance}:{bucket_start}` row per flush. The exact commands are in
  `services/telemetry-service/README.md` §Verifying the whole pipeline locally.
- **The local run has now found two real bugs**, which is the argument for
  doing it rather than trusting a green suite. The second, on 2026-08-14: the
  request funnel's first design used backend round trips for its middle stages
  and rendered `302 → 19 → 19 → 302` against real traffic — health checks and
  404s never reach a backend, so it collapsed and then fully recovered. Every
  unit test passed, because each stage's arithmetic was individually correct;
  what was wrong was the claim the SHAPE made. Redefined as `received →
  accepted → served`, a strict subset chain, with a non-increasing assertion in
  the service suite and in both contract suites.
- The first, on 2026-08-13: a bucket
  in which every request finished inside a millisecond reported `p95 = 5 ms`,
  the interpolation's own bucket edge rather than anything observed. Zero is a
  real maximum; the clamp was treating it as a missing one. Fixed in
  `contracts/rust/src/telemetry.rs` with a test naming the case.
- **The SQL is exercised but not asserted.** The local run proves the
  statements execute and accumulate correctly against a real PostgreSQL; the
  automated suite still only asserts the query *text*, because it deliberately
  needs no database. A regression in a query would be caught by rerunning the
  local pipeline, not by CI.
- **Nothing has been deployed.** `render.yaml` describes the seventh free web
  service; the instance-hour budget has not been checked and the Neon database
  does not exist. `services/telemetry-service/README.md` §First deploy is the
  order to do it in.

# telemetry-service

> **The one service in this repository that is not written in Go.** That is a
> deliberate, bounded decision, not an accident — see
> [notes/evolution/rust-adoption-research.md](../../notes/evolution/rust-adoption-research.md)
> for what was rejected in its favour and
> [notes/plans/services/telemetry-service-plan.md](../../notes/plans/services/telemetry-service-plan.md)
> for the approved design this implements.

Consumes one aggregated rollup envelope per minute from the gateway, stores it
through whichever sink is configured, and answers admin queries over the same
one it just wrote. It never sees a raw per-request event and never talks to any
service but NATS.

## What it consumes and answers

| Subject | Direction | Shape |
| --- | --- | --- |
| `myunivokai.events.telemetry.http.v1` | in (JetStream, durable `telemetry-events-v1`) | `Envelope<HttpRollupData>` |
| `myunivokai.queries.telemetry.overview.get.v1` | request/reply | `TelemetryOverviewResponseData` |
| `myunivokai.queries.telemetry.route.list.v1` | request/reply | `TelemetryRouteListResponseData` |

It publishes nothing else. The local NATS ACL in
[infra/nats/nats-server.conf](../../infra/nats/nats-server.conf) enforces that
rather than trusting the code to honour it.

The overview answers more than a total and a p95. Four of its fields have an
obvious wrong version that still looks right on a screen, so each is stated:

- **`comparison`** measures the window against the one of the same width
  immediately before it, over a HALF-OPEN interval so the two partition the
  timeline — a closed upper bound counts the boundary minute twice and makes
  every comparison optimistic. It is **absent entirely** when that previous
  window holds no data, and `errors` compares the error COUNT rather than the
  rate: two rates subtract into a percentage-POINT difference, and calling
  that a percent change is how a card like this ends up lying.
- **`p50DurationMs`** rides beside `p95DurationMs` everywhere, including per
  route and per backend. Both are interpolations across the contract's eight
  fixed edges and the response says so in `percentileIsInterpolated`.
- **`hourlyPoints` and `hourOfDay`** are different questions. The first is a
  timeline rolled up to the hour (the minute series is 10,080 points over a
  week — a payload nobody needs and a chart nobody can read); the second is
  every day in the window summed onto a 24-hour clock, which answers "when is
  this platform *reliably* busy". Both group with an explicit
  `AT TIME ZONE 'UTC'`, because inheriting the session zone moves the peak
  hour for no reason.
- **`trafficFunnel` is a strict subset chain, and that was not free.** The
  three stages are `received` → `accepted` (4xx removed) → `served` (5xx
  removed), each containing the next. The first draft used backend round trips
  for the middle stages and produced `302 → 19 → 19 → 302` the first time it
  ran against real traffic: most requests are health checks and 404s that never
  reach a backend, so the shape collapsed and then fully recovered. Four
  counters in a row are not a funnel unless each contains the next, and a chart
  implying a containment that does not exist is worse than four separate
  numbers. Backend fan-out is a ratio and is reported as one, beside the
  backends. A test in `service/telemetry.rs` and one in each contract suite now
  assert the counts are non-increasing.

## Layout

The layering mirrors `services/analytics-service`'s Go packages one for one, so
a reader who knows that service does not have to learn a second architecture.
`src/lib.rs` carries the full table; the short version:

```
src/
├── main.rs        30 lines: config, start, wait, stop
├── lib.rs         the module tree and the layering rules
├── error.rs       Error + describe() + is_retryable()
├── runtime.rs     Application: the composition root
├── config/        Config, validation, env readers
├── domain/        models — rollup batch, aggregates, latency, query window. No I/O.
├── repository/    RollupRepository trait + postgres adapter + in-memory double
├── service/       TelemetryService: ingest, overview, routes, prune
│                  + mapping.rs: From<domain aggregate> for the wire types
├── sink/          TelemetrySink trait: postgres | otlp
├── messaging/     NATS consumer + query responders
└── http/          /healthz, the wake target
```

Why it is shaped this way — the language's own conventions, the official Cargo
layout, the error-handling split, and why there is no ORM — is
[notes/knowledge/backend/rust-service-architecture.md](../../notes/knowledge/backend/rust-service-architecture.md).
Read that before adding a layer.

## The sink switch

`TELEMETRY_SINK` is read once at startup, exactly where `AI_PROVIDER` and
`SERVICE_WAKE_PLATFORM` are read in their own services. Everything past that
line is written against the `TelemetrySink` trait.

| | `postgres` (default) | `otlp` |
| --- | --- | --- |
| Stores | `myunivokai_telemetry`, this repo's own schema | nothing locally |
| Answers range queries | yes | **no** — Grafana owns the query surface once data is pushed |
| Admin Telemetry screen | renders charts | renders a link to `TELEMETRY_DASHBOARD_URL` |
| Idempotent under redelivery | yes, `inbox_messages` | no — bounded only by JetStream's dedup window |
| Needs a database | yes | no |

The default is `postgres` for two reasons: it is the only sink the admin app
can render from, and every other switch in this repository ships pointing at
nobody else's infrastructure until an operator opts in.

Both could run at once behind a `FanoutSink` wrapping two inner sinks. The
trait does not forbid it; nothing here builds it.

## Deviations from the plan, and why

Three, all recorded rather than discovered later.

**1. No ORM, and no `.sqlx/` offline cache either.**

*No ORM:* an ActiveRecord layer cannot express this service's two real
statements — an elementwise array addition inside `ON CONFLICT`, and
`SUM(...) FILTER (...)` over grouped time buckets. SeaORM or Diesel would call
their raw-SQL escape hatch for every query in
`repository/postgres/statements.rs` and leave the entity layer as decoration
that still has to be kept in step with the schema by hand. The full reasoning,
and what would change the answer for a future CRUD-shaped service, is in
[notes/knowledge/backend/rust-service-architecture.md §6](../../notes/knowledge/backend/rust-service-architecture.md).

*No offline cache:* `sqlx`'s `query!` macros check SQL against a live database
during `cargo build`. The usual answer is `SQLX_OFFLINE=true` plus a committed
`.sqlx/` cache, which has to be regenerated by hand on every SQL edit and fails
the *build* when it goes stale — in CI, for someone who did not touch the
query. The runtime API keeps `cargo build` hermetic with no `DATABASE_URL`
anywhere in the Dockerfile. The cost is real and is why this is written down:
**a SQL mistake surfaces when the query runs, not when it compiles.** What
guards it instead is the statement tests, the in-memory repository tests, and
§Verifying the whole pipeline locally below.

`sqlx::migrate!` is still used. It reads the migrations directory at compile
time and embeds it, so it needs no database, and the container cannot start
with migrations that do not match its own binary.

**2. The runtime image is `debian:bookworm-slim`, not Alpine.** The plan named
this as one of its two acceptable answers. Matching the Go services' Alpine
runtime would mean the `x86_64-unknown-linux-musl` target plus a musl toolchain
for every transitive C dependency, on this repository's first Rust deploy. The
extra ~25 MB is irrelevant on this hosting tier; a build that fails only in CI
is not.

**3. `histogram` is `BIGINT[]`, not `JSONB`.** The one operation that column
exists for is being added to another histogram. Postgres adds two arrays
elementwise inside `ON CONFLICT` with no helper function, no read-modify-write
and no lost update under concurrent writers; JSONB would have needed all three.
The width is still fixed at 8 by the contract, and a `CHECK` enforces it on the
row.

## Known gap: this service does not announce its own boot

Every Go service publishes `myunivokai.events.<name>.service.started.v1` and
the admin Fleet screen shows it. This one does not: `contracts.ServiceNames`
has no `telemetry` entry, so adding it would mean a contracts change, an ACL
grant and a projection path — none of which the plan asks for. It is a real
inconsistency and it is named here rather than left to be noticed.

## Local development

```bash
# From the repository root — the whole stack, telemetry included.
make local-up

# This service alone, against an already-running infra stack.
cd services/telemetry-service
cp .env.example .env.local
docker compose -f docker-compose-local.yaml up --build
```

The first start compiles the dependency tree and is slow. The Compose file
mounts two named volumes — the cargo registry and the target directory — so
only the first one pays for it. Deleting `telemetry-service-cargo-target` is
the fix if a build starts behaving strangely after a toolchain change.

Without Docker:

```bash
cd services/telemetry-service
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo build --release
```

`cargo test` needs no database and no broker: 43 unit tests plus 5 integration
tests run against `repository::memory`, a faithful in-memory double that
accumulates on conflict exactly as the `ON CONFLICT` clauses do. They cover
idempotent ingest, two-instance accumulation, window clamping, error-rate
arithmetic, retention and the ack-versus-nak decision.

What they do **not** prove is that the SQL is correct — the statement tests
assert the query *text* (every `SUM` cast off `numeric`, every conflict clause
accumulating, retention covering all five tables), not its result. Stated
plainly because a suite that passes without a database is otherwise read as
more than it is. The thing that does prove it is the local stack: see
§Verifying the whole pipeline locally.

## First deploy

This is the **seventh** free web service on the Render account. Check the
instance-hour budget before syncing the blueprint, exactly as
`notes/skills/auth-analytics-first-deploy-checklist.md` records for the sixth.

1. Create the Neon database `myunivokai_telemetry` and fill `DATABASE_URL` and
   `DATABASE_DIRECT_URL` in the Render dashboard. Without them the service
   crash-loops on first boot — deliberately, because a telemetry service that
   starts with no storage looks identical to a working one until somebody opens
   the screen.
2. Link the service to the `myunivokai-shared-env` group for `NATS_URL` and the
   `nats.creds` secret file. Production is one shared Synadia user with no
   per-service allow-list; the per-user ACL blocks in
   `infra/nats/nats-server.conf` are **local only**.
3. After the service exists and has a public URL, set `TELEMETRY_SERVICE_URL`
   on `myunivokai-gateway` and redeploy the gateway. Until then the gateway
   reports `SERVICE_UNAVAILABLE` instead of `SERVICE_WAKING` for telemetry
   queries, which is correct rather than broken: it cannot promise a wake it
   has no URL to perform.
4. Set `TELEMETRY_ENABLED=true` on the gateway. It is off by default, and with
   it off nothing is ever published — the stream stays empty and this service
   has nothing to consume.

## Verifying the whole pipeline locally

The only check that exercises gateway → JetStream → this service → PostgreSQL.
Telemetry is off by default, so it has to be switched on for the run:

```bash
make local-up

# Shell environment beats --env-file in Compose interpolation, so this turns
# telemetry on without editing a tracked file. Ten seconds instead of sixty so
# a flush arrives while you are still watching.
TELEMETRY_ENABLED=true TELEMETRY_FLUSH_INTERVAL=10s   docker compose --env-file .env.local -f docker-compose-local.yaml up -d api-gateway

curl -s localhost:41800/api/v1/healthz
curl -s localhost:41800/api/universe/worlds/11111111-1111-4111-8111-111111111111
curl -s localhost:41800/nothing-here

# One flush later, the rows:
docker compose --env-file .env.local -f docker-compose-local.yaml   exec postgres psql -U myunivokai_telemetry_app -d myunivokai_telemetry   -c "SELECT bucket_start, route_pattern, method, status_class, request_count FROM http_rollups ORDER BY bucket_start;"
```

What to look for, because these are the invariants that matter:

- `route_pattern` is `/api/universe/worlds/{worldID}`, **not** the world id.
- Every unmatched URL collapsed into the single `unmatched` row.
- `nats_rollups` has a `universe` row, `cache_rollups` a `world:v1` row —
  all three concerns arrived in one envelope.
- `inbox_messages` holds one `{instance}:{bucket_start}` row per flush.

And the read path, without needing an admin token:

```bash
docker run --rm --network myunivokai-local-backend natsio/nats-box:0.19.2   nats --server nats://myunivokai_bootstrap:myunivokai_local_bootstrap@nats:4222   request myunivokai.queries.telemetry.overview.get.v1   '{"jobId":"manual-check","timestamp":"2026-08-13T15:00:00Z","data":{"hours":24}}'
```

## Operational notes

**The retention trap, inherited.** `MYUNIVOKAI_EVENTS` retains 7 days. If
nobody opens the Telemetry screen for eight days this service never wakes, and
the oldest rollup envelopes expire unconsumed — that window's counters are gone
silently. This is the same accepted trade `analytics-service` carries. The
mitigation everyone reaches for first — waking the read model from the write
path — is deliberately *not* applied: a proactive wake on a 60-second flush
cadence would keep this service awake permanently and defeat scale-to-zero
entirely.

**Percentiles are interpolations.** Every `p95` in every response is a linear
interpolation across the eight fixed histogram edges, and every response
carries `percentileIsInterpolated` so the admin UI can say so next to the
number. A p95 that looks exact and is not is worse than no p95.

**Error rate excludes 4xx.** A validation failure or a 404 is the client's
problem, and including it would produce an error rate that never goes down. The
full status mix is returned alongside, so nothing is hidden — only kept out of
the one number an operator is expected to react to.

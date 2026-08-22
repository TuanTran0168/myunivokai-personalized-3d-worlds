# Telemetry service plan — B2 + Track C, decided

> **Document status:** Approved design. **Not yet built** — this is the plan
> to implement from, not a research document. It graduates
> [platform-evolution-research.md §Track B](platform-evolution-research.md#track-b--operational-telemetry)
> (B2 specifically) and
> [platform-evolution-research.md §Track C](platform-evolution-research.md#track-c--a-service-written-in-rust)
> from research into one decided design, informed by
> [rust-adoption-research.md](rust-adoption-research.md) and
> [telemetry-architecture-research.md](telemetry-architecture-research.md).
> **Decided:** 2026-08-13 by the owner — Rust, a dual-sink switch (own
> Postgres storage and Grafana Cloud OTLP, chosen by config, not a one-time
> fork), a hand-maintained Rust mirror of the relevant Go contracts, and
> results rendered inside `myunivokai-admin` rather than only in an external
> dashboard.
> **Supersedes:** the open "which vehicle" question in
> `rust-adoption-research.md` — `telemetry-service` in Rust is confirmed as
> Track C's answer. The B2-vs-Option-2 ordering question in
> `platform-evolution-research.md` is also settled: build both sinks from the
> start rather than sequencing "Grafana first, own schema later", because the
> owner wants results in the admin app regardless.

## What this service is, in one sentence

`telemetry-service` consumes one aggregated HTTP-rollup envelope per minute
from the gateway, stores it through whichever sink is configured, and answers
admin queries over the same one it just wrote — it never sees a raw
per-request event and never talks to any service but NATS.

## What the owner decided, and why each piece is shaped this way

1. **Rust, not Go.** Restates Track C's own conclusion, now unblocked: this
   is the safest possible first Rust service in this repo — new, off the
   product's critical path, a contract shape (NATS envelope in, PostgreSQL
   out) this repo already has five examples of, and a workload (sustained
   aggregation, predictable memory) that plays to Rust's actual strengths
   rather than being CRUD wearing a new syntax.
2. **A dual-sink switch, not a single destination.** The owner asked for "a
   set of switches to choose, or whatever pattern is convenient" — the
   pattern already in this repo for exactly this shape of decision is
   `ai.Provider` (`services/dna-service/internal/ai/provider.go`): one small
   interface, adapters in their own module, selected by one environment
   variable read once at startup. `wake.Platform` is the same idiom applied
   to a different axis. This plan reuses it rather than inventing a fourth
   version of the same decision: `TelemetrySink` trait, `sinks::postgres` and
   `sinks::otlp` modules, `TELEMETRY_SINK=postgres|otlp` chosen once at boot.
3. **A parallel Rust contract, validated against the same fixtures.**
   `rust-adoption-research.md` already named the risk plainly: a second
   language means a hand-maintained copy of `contracts/go`, and
   `analytics-service-plan.md` names contract drift as this architecture's
   real long-term cost. The mitigation is not new — Track C's own writeup
   already prescribes it — this plan only confirms it is mandatory, not
   optional: the Rust side's tests must decode the exact same
   `contracts/fixtures/*.json` files the Go suite validates in CI. If a
   fixture changes and the Rust struct does not, the Rust test fails, not a
   production decode.
4. **Rendered in `myunivokai-admin`, not only in Grafana.** The postgres sink
   exists specifically so this repo's own admin app — which already depends
   on `recharts` and already has a Fleet screen reading wake-stats and
   service-starts — can show request volume, status breakdown and latency
   without an external vendor in the loop. The OTLP sink is not removed: it
   stays available for whoever wants Grafana's built-in alerting, and having
   both behind one trait costs one `match` at startup, not a fork.

## Architecture

```
api-gateway (Go)                         telemetry-service (Rust)
  middleware/logging.go                     NATS consumer (async-nats)
  already emits per-request fields    │       │
  (method, path, status, duration)    │       ▼
        │                             │   TelemetrySink trait
        ▼                             │    ├── sinks::postgres  → myunivokai_telemetry (sqlx)
  internal/telemetry/collector.go ────┴──►  └── sinks::otlp      → Grafana Cloud (opentelemetry-otlp)
  (in-memory bucket, keyed on              │
   chi RoutePattern — never raw path)      ▼
        │ ticker, 60s                  queries::* (axum + async-nats responder)
        ▼                                  ▲
  publish 1 envelope/min on                │  myunivokai.queries.telemetry.*.v1
  myunivokai.events.telemetry.http.v1  ────┘
                                            ▲
                                       api-gateway  /api/admin/telemetry/*
                                            ▲
                                       myunivokai-admin (recharts)
```

Same three-process shape every admin screen already has: gateway, the
relevant read-model service, done. No domain service (`dna`/`universe`/
`nature`) is ever touched by a telemetry read, exactly as `analytics-service`
already guarantees for business data.

### Durability and wake — decided 2026-08-13, correcting this plan's own first draft

The first draft of this plan sketched the rollup publish as a **fire-and-forget
Core NATS publish**, on the reasoning that losing counters on an unclean
shutdown is an acceptable trade for telemetry. The owner correctly rejected
that as insufficient: `telemetry-service` is a pure NATS consumer on Render's
free tier, exactly like `dna`/`universe`/`nature`/`auth`/`analytics` — it
sleeps after idle traffic, and Core NATS delivers to whoever is subscribed
**right now** or not at all. A fire-and-forget publish while this service
sleeps is not "lose one interval on a crash", it is **lose every interval for
as long as it sleeps**, which on a service nobody queries for a while could be
most of the data. That is a real miss, not the accepted trade the first draft
described it as.

Two changes fix this, and both reuse machinery this repo already has —
neither is new engineering, both are "do what `analytics-service` already
does":

**1. Publish the rollup envelope through JetStream, not Core NATS.**
`myunivokai.events.telemetry.http.v1` needs **no stream or ACL change** — it
already matches `MYUNIVOKAI_EVENTS`'s existing `myunivokai.events.>` filter,
the same free ride `world.changed` got in `analytics-service-plan.md`. A
durable JetStream stream holds the message regardless of whether
`telemetry-service` is currently awake; a durable consumer (mirroring
`dnaResultsDurableName`'s `MaxDeliver(-1)` shape) resumes from its last ack
whenever the service next runs, asleep for a minute or asleep for a day. The
gateway needs no outbox for this: unlike a domain mutation, there is no
database write to keep atomic with the publish — a plain `js.Publish()` per
flush is enough.

**2. `telemetry-service` joins the wake mechanism exactly like every other
service — no special-casing, because none is needed.** The gateway derives
which service to wake from the **subject prefix** of the query it is about
to send (`wake.ServiceForSubject`, `internal/wake/platform.go`), and this
service's query subjects already follow the same `myunivokai.queries.<service>.*`
shape as everyone else's. Three additions, each already-proven boilerplate:

- `wake.ServiceTelemetry = "telemetry"`, appended to `wake.Services`
  (`internal/wake/platform.go:132`).
- `"telemetry": "TELEMETRY_SERVICE_URL"` in `serviceWakeURLKeys`
  (`internal/config/config.go:66-67`) — **`internal/config/wake_config_test.go`
  already fails the build if these two lists drift apart**, so there is no
  way to add one and forget the other.
- `TELEMETRY_SERVICE_URL` as a sixth `sync: false` entry beside the existing
  five in `render.yaml`'s gateway block, left blank on first sync like the
  other five (the service's public URL does not exist until after it is
  created).

With both in place, opening the admin app's Telemetry screen reactively wakes
`telemetry-service` the same way opening Worlds wakes `analytics-service` —
`ServiceForSubject` needs no telemetry-specific branch, the same drift-guard
test (`TestEveryListedServiceIsResolvable`) already checks every entry in
`Services` resolves, and this one resolves by the same prefix rule as the
rest.

**What is deliberately not added: a proactive wake on every flush.** The
gateway could call `waker.Wake("telemetry")` before each 60-second flush, the
same way `POST /worlds` proactively wakes `dna` and the family service before
publishing — but doing that on a 60-second cadence would keep the service
awake continuously, which defeats scale-to-zero entirely and reproduces the
exact "744 hours/month" trap `production-deployment-guide.md §5.3` already
warns about for an accidentally-always-on service. Reactive wake plus a
durable stream is the correct combination: the service can genuinely sleep
for long stretches, and catching up costs one wake, not continuous uptime.

**The residual risk, named rather than hidden:** this is exactly the
retention trap `platform-evolution-research.md §Track A` already documents
for `analytics-service` and the proposed `library-service` —
`MYUNIVOKAI_EVENTS` retains 7 days. If nobody opens the Telemetry screen for
eight days, the oldest rollup envelopes expire unconsumed and that window's
counters are permanently gone, silently. This plan does not solve that
uniquely for telemetry; it inherits the same accepted trade and the same
three mitigations already on record (wake the read model from the write
path, raise `MaxAge` to 30 days, human discipline) — the first of which does
not apply cleanly here for the proactive-wake reason above, which is worth
stating honestly rather than papering over.

**The exit, unchanged from every other service on this mechanism:** moving
`telemetry-service` to a paid plan, a real background worker, or simply
deciding telemetry is not worth keeping needs no code change — set
`SERVICE_WAKE_PLATFORM=none` (removes waking for every service at once) or
leave `TELEMETRY_SERVICE_URL` blank (removes it for this one service only,
same as leaving any of the other five blank today). Either way the service
degrades to reporting `SERVICE_UNAVAILABLE` instead of `SERVICE_WAKING`
rather than breaking anything.

## Gateway-side work (Go) — B2, unchanged from the research sketch

`platform-evolution-research.md §B2` already specifies this; this plan adopts
it verbatim and does not redesign it:

- `internal/telemetry/collector.go`: an in-memory `map[bucketKey]bucketValue`,
  keyed on `{RoutePattern, Method, StatusClass}` — **`chi.RouteContext(ctx).RoutePattern()`,
  never `request.URL.Path`.** This is the one rule that decides whether this
  system stays inside Grafana's free tier or blows through it; see
  `telemetry-architecture-research.md`'s cardinality measurement (~200 series
  today) for why this is not a hypothetical.
- A ticker flushes one envelope per interval (default 60s) and once more on
  graceful shutdown. An unclean kill loses at most one interval of counters —
  the accepted trade for telemetry, never acceptable for anything billed.
- Publishing this is a **new** small addition to the gateway, not a rewrite:
  `myunivokai.events.telemetry.http.v1`, no JetStream needed (loss of a
  rollup interval is tolerable, so Core NATS publish-and-forget is enough,
  unlike every event that feeds `analytics-service`).

## Rust contracts — `contracts/rust`

New Cargo crate, sibling to `contracts/go`, not a translation tool run over
it — hand-maintained on purpose, so a change to the wire shape is a
conscious edit in two places rather than a generated file nobody reads.

```
contracts/
├── go/                     # unchanged, still the source of truth for Go services
└── rust/
    ├── Cargo.toml
    └── src/
        ├── lib.rs
        ├── envelope.rs     # Envelope<T>, SuccessRPCEnvelope, ErrorRPCEnvelope — mirrors contracts.go
        └── telemetry.rs    # HttpRollupEnvelope, TelemetryQueryData, TelemetryResponseData
```

```rust
// contracts/rust/src/telemetry.rs (sketch)
#[derive(Serialize, Deserialize)]
pub struct HttpRollupBucket {
    pub route_pattern: String,
    pub method: String,
    pub status_class: u8,          // 2, 3, 4, 5
    pub count: i64,
    pub duration_sum_ms: i64,
    pub duration_max_ms: i64,
    pub histogram: [i64; 8],       // 5,10,25,50,100,250,1000,+Inf ms — same edges as the Go sketch
    pub error_codes: std::collections::HashMap<String, i64>,
}

#[derive(Serialize, Deserialize)]
pub struct HttpRollupEnvelope {
    pub instance_id: String,       // which gateway instance flushed this
    pub bucket_start: String,      // RFC3339 — parsed with `time`, matching Go's time.Time wire format
    pub buckets: Vec<HttpRollupBucket>,
    // The two additions from §What this service tracks ride along in the
    // same envelope — one flush, one ack, one idempotency check, not three
    // separate publishes for three separate concerns.
    pub nats_backend_buckets: Vec<NatsBackendBucket>,
    pub cache_buckets: Vec<CacheBucket>,
}
```

**Test obligation, not optional:** `contracts/rust`'s test suite decodes
`contracts/fixtures/telemetry_http_rollup.json` — the same file a Go test
already validates via `TestContractFixturesConformToTheEnvelopeSchema`. Two
languages, one fixture, one CI failure if they disagree. Add the fixture in
Phase 0 below, before either side's code exists.

## The `TelemetrySink` trait

```rust
// services/telemetry-service/src/sinks/mod.rs
#[async_trait]
pub trait TelemetrySink: Send + Sync {
    async fn write_rollup(&self, envelope: &HttpRollupEnvelope) -> anyhow::Result<()>;
    async fn query_range(&self, query: &TelemetryRangeQuery) -> anyhow::Result<TelemetryRangeResult>;
}
```

- `sinks::postgres::PostgresSink` — `sqlx`, the schema below, answers queries
  itself.
- `sinks::otlp::OtlpSink` — forwards each bucket as an OTel metric point via
  `opentelemetry-otlp`'s gRPC exporter to Grafana Cloud. **`query_range` on
  this sink is not implemented** — Grafana owns the query surface once data
  is pushed there, so this sink's `query_range` returns
  `Err(Unsupported)` and the admin app's telemetry screen, when running
  against this sink, links out to a Grafana dashboard instead of rendering
  charts of its own. That distinction must be visible in the admin UI, not
  silently swallowed.
- Selection: `TELEMETRY_SINK` env var, read once at startup, exactly where
  `AI_PROVIDER` and `SERVICE_WAKE_PLATFORM` are read in their respective
  services — `config.rs` returns a `Box<dyn TelemetrySink>`, and the rest of
  the service is written against the trait, never against a concrete sink.
- **Both can run at once if ever wanted** — the trait does not forbid a
  `sinks::fanout::FanoutSink` wrapping two inner sinks — but that is not part
  of this plan; naming it only so a future reader does not have to invent
  the extension point.

## Data model — `sinks::postgres`

Unchanged from `platform-evolution-research.md §B2`'s sketch, owned by this
service's own database, `myunivokai_telemetry`:

```sql
-- migrations/0001_init.sql (sqlx::migrate!, plain SQL — same spirit as goose)
CREATE TABLE http_rollups (
  bucket_start    TIMESTAMPTZ NOT NULL,
  route_pattern   TEXT        NOT NULL,
  method          TEXT        NOT NULL,
  status_class    SMALLINT    NOT NULL,
  request_count   BIGINT      NOT NULL,
  duration_sum_ms BIGINT      NOT NULL,
  duration_max_ms INTEGER     NOT NULL,
  histogram       JSONB       NOT NULL,
  PRIMARY KEY (bucket_start, route_pattern, method, status_class)
);
CREATE INDEX http_rollups_recent_idx ON http_rollups (bucket_start DESC);

CREATE TABLE error_code_rollups (
  bucket_start TIMESTAMPTZ NOT NULL,
  error_code   TEXT        NOT NULL,
  count        BIGINT      NOT NULL,
  PRIMARY KEY (bucket_start, error_code)
);

CREATE TABLE inbox_messages (
  message_id   TEXT PRIMARY KEY,
  subject      TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Same idempotency shape as `analytics-service`'s inbox table — a redelivered
rollup envelope is a no-op, not a double count. Retention is a `DELETE ...
WHERE bucket_start < NOW() - INTERVAL '90 days'`, run on a ticker inside the
service; there is no rollup-of-rollups because a bucket is already a minute
wide.

Percentiles are an interpolation over `histogram`, never an exact value —
the admin UI must say so next to the number, per the existing research doc's
warning: a p95 that looks exact and is not is worse than none.

## What this service tracks — beyond the base HTTP rollup

The owner asked for this service to carry more value than the minimum HTTP
rollup already sketched. Three additions, each chosen because it closes a
question this repo's own research already named as **currently unanswerable**
rather than because more metrics are inherently good — an untracked question
is a better reason to add a table than "we might want this later."

### 1. The wake-conversion rate — no new table needed

`platform-evolution-research.md §B2` names this explicitly: *"the
`SERVICE_WAKING` → success conversion rate — the only real proof the wake
mechanism works in production rather than in a local harness"* — and it is
unmeasured today. The base schema already answers it, once `error_code`
values include `SERVICE_WAKING` (the gateway already returns that literal
code — see `README.md §Waking a sleeping service`) as a value in
`error_code_rollups`, keyed by nothing more than time bucket:

```sql
-- Conversion rate for a service over a day: SERVICE_WAKING count in bucket N
-- versus the following bucket's success count for the same route(s), joined
-- on time proximity rather than a per-request key — this is an approximation,
-- not an exact causal trace, and the admin UI must say so.
SELECT bucket_start,
       SUM(count) FILTER (WHERE error_code = 'SERVICE_WAKING') AS wakes_signaled
FROM error_code_rollups
WHERE bucket_start > NOW() - INTERVAL '1 day'
GROUP BY bucket_start
ORDER BY bucket_start;
```

No new table, no new gateway instrumentation — only a query and an honest
label on the chart. If retries ever need exact per-request correlation later,
that is a real schema change (a `wake_outcome` dimension carried on the
rollup bucket itself); this plan does not build that speculatively now.

### 2. NATS round-trip latency per backend service

The base HTTP rollup measures end-to-end gateway response time, which is
often not the same question as "which backend is actually slow" — a request
under `/api/{family}/worlds` calls `universe` or `nature` depending on the
`family` parameter, and the HTTP route alone cannot distinguish them. This is
new data this repo has never captured:

```sql
CREATE TABLE nats_rollups (
  bucket_start    TIMESTAMPTZ NOT NULL,
  service         TEXT        NOT NULL,  -- dna | universe | nature | auth | analytics
  request_count   BIGINT      NOT NULL,
  duration_sum_ms BIGINT      NOT NULL,
  duration_max_ms INTEGER     NOT NULL,
  histogram       JSONB       NOT NULL,
  error_count     BIGINT      NOT NULL,  -- includes no-responders / timeouts
  PRIMARY KEY (bucket_start, service)
);
```

Fed by the same gateway-side collector as the HTTP rollup, keyed on
`wake.ServiceForSubject(subject)` (already computed on every request/reply
call, per §Durability and wake above) rather than a second lookup — this
reuses code that already exists, not new gateway plumbing.

### 3. Redis cache hit/miss rate

`README.md §Gateway caching and invalidation` names three Redis namespaces
(`job:v1`, `world:v1`, `share:v1`) and describes the invalidation rule, but
whether the cache is actually earning its keep — hit rate, not just
existence — has never been measured:

```sql
CREATE TABLE cache_rollups (
  bucket_start TIMESTAMPTZ NOT NULL,
  namespace    TEXT        NOT NULL,  -- job:v1 | world:v1 | share:v1
  hits         BIGINT      NOT NULL,
  misses       BIGINT      NOT NULL,
  PRIMARY KEY (bucket_start, namespace)
);
```

Fed by a counter already trivial to add at each existing cache lookup site —
this is the smallest of the three additions and the one most likely to
reveal that a namespace's TTL is miscalibrated in either direction.

All three ship inside the **same** `HttpRollupEnvelope`-shaped publish (one
message per minute, not three), as sibling arrays alongside `buckets` — one
flush, one ack, one idempotency check, matching the "one envelope, not one
message per concern" discipline B2 already established for the base rollup.

## Admin surface

New nav entry, **Telemetry**, alongside the existing **Fleet** screen (Fleet
stays wake-stats/service-starts; this is a separate concern with different
volume and a different owning service, matching the data-boundary reasoning
already applied everywhere else in this repo). Gateway relay routes:

| Route | Reads | Permission |
| --- | --- | --- |
| `GET /api/admin/telemetry/overview` | request volume, status mix, p95 by route, over a window | `chart:read` (existing permission, no new one needed) |
| `GET /api/admin/telemetry/routes` | per-route table: count, error rate, p95, slowest | `chart:read` |

Both are pure relays to `telemetry-service`'s query subjects, exactly like
`admin_analytics_handler.go` — the gateway sums nothing, same rule as every
other admin route.

When `TELEMETRY_SINK=otlp`, these routes return a small payload saying
"charts are in Grafana" plus the dashboard URL (an env-configured link),
rather than 501ing — a missing chart should read as "look elsewhere," not as
a broken screen.

## Deploy and CI additions

### `Dockerfile.prod` — two build-time decisions the first draft skipped

Every service in this repo deploys to Render the same way regardless of
language: `runtime: docker` plus a two-stage `Dockerfile.prod`
([render.yaml:23-24](../../render.yaml#L23-L24)) — Render builds and runs a
container, it does not have an opinion about Rust. That means deployability
was never in question. Two decisions inside that Dockerfile were, and the
first draft of this plan named neither:

1. **`sqlx` needs a database at build time, and the builder stage has none.**
   `sqlx::migrate!` and `sqlx::query!` check SQL against a real schema
   *during* `cargo build` — there is no Go equivalent to this step, so it is
   easy to miss when copying the pattern from a Go service. Without
   `SQLX_OFFLINE=true` and a committed `.sqlx/` query cache (generated locally
   ahead of time with `cargo sqlx prepare`), the Render build fails at
   `cargo build --release`, not at runtime. Phase 3 (`sinks::postgres`) must
   commit `.sqlx/` alongside the migration it covers; Phase 7's Dockerfile
   sets `SQLX_OFFLINE=true` in the builder stage and does not expect a
   `DATABASE_URL` at build time.
2. **Rust binaries default to glibc; this repo's runtime images are Alpine.**
   The Go services get a static binary for free from `CGO_ENABLED=0` and run
   it on Alpine's musl libc. Rust needs an explicit choice: either add the
   `x86_64-unknown-linux-musl` target and a musl linker to the builder stage
   so the binary matches the existing Alpine runtime pattern, or switch this
   one service's runtime stage to `debian:bookworm-slim` (or
   `gcr.io/distroless/cc-debian12`) and accept it as the one image family that
   isn't Alpine. Phase 7 picks one before `Dockerfile.prod` is written, not
   during it.

- `render.yaml`: `myunivokai-telemetry`, same `type: web` + `/healthz`-only
  shape as every other service (Render Free has no `worker` type). **This is
  the seventh free web service on the account — check the instance-hour
  budget before this phase**, exactly the caution already on record for
  `myunivokai-analytics` as the sixth. The gateway's block also gains
  `TELEMETRY_SERVICE_URL` — a sixth `*_SERVICE_URL` entry, blank on first
  sync like the other five, filled in and redeployed once the service exists.
- No new NATS user needed for Synadia production — one shared `nats.creds`
  user, same as every other service (see
  `notes/ops/auth-analytics-first-deploy-checklist.md` for why). A local-only
  ACL block is still added to `infra/nats/nats-server.conf` for symmetry with
  every other service's local user, publishing only
  `myunivokai.events.telemetry.http.v1` reads and `$JS.API.>`/`_INBOX.>`.
- CI: new job mirroring `analytics-service-checks` —
  `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`,
  `cargo build --release`, plus the fixture-decode test from §Rust contracts.
- `notes/be/source-overview.md` gets one paragraph: the backend is Go except
  this one service, and why — Track C's own warning that an undocumented
  second language reads as an accident to the next reader.

## Phases

| Phase | Content |
| --- | --- |
| 0 | `contracts/rust` crate; `HttpRollupEnvelope` (+ `NatsBackendBucket`, `CacheBucket`) and query types in `contracts/go`; the shared fixture in `contracts/fixtures/`; both languages' tests decode it |
| 1 | Gateway B2: `internal/telemetry/collector.go` (HTTP + NATS-backend + cache buckets, one collector), the ticker, **`js.Publish()` on `myunivokai.events.telemetry.http.v1`** (JetStream, not Core NATS — see §Durability and wake) — no consumer exists yet, envelopes accumulate on the stream the same way analytics' events did before phase 2 of that plan |
| 2 | `telemetry-service` skeleton: `main.rs`, `config.rs` (`TELEMETRY_SINK` switch), the durable JetStream consumer (`MaxDeliver(-1)`, mirroring `dnaResultsDurableName`), `/healthz` via `axum` |
| 3 | `sinks::postgres`: migration (`http_rollups`, `error_code_rollups`, `nats_rollups`, `cache_rollups`, `inbox_messages`), inbox idempotency, the query handlers |
| 4 | `sinks::otlp`: forward each bucket via `opentelemetry-otlp`, plus the "charts are elsewhere" response shape |
| 5 | **Wake integration**: `wake.ServiceTelemetry` in `internal/wake/platform.go`, `TELEMETRY_SERVICE_URL` in `serviceWakeURLKeys` (`internal/config/wake_config_test.go` enforces the two stay in sync) |
| 6 | Gateway admin routes (`/api/admin/telemetry/*`) — depends on phase 3 or 4 existing |
| 7 | `render.yaml` (including `TELEMETRY_SERVICE_URL` on the gateway, left blank on first sync like the other five), CI job, local NATS ACL block, `.env.example` |
| 8 | `myunivokai-admin`: Telemetry nav entry, overview + per-route table, recharts |
| 9 | *(deferred, own trigger)* Admin navigation restructure — see §Future dependency below. Not started until phase 8 ships and the sidebar actually feels crowded, not before |

Phase 0 has no dependency on anything and should land first regardless of
which later phase comes next, for the same reason `analytics-service-plan.md`
put its contract phase first: a fixture that both languages test against is
cheap now and the only thing that is expensive to retrofit once both sides
have already guessed at the shape independently.

## What this costs

| Cost | Detail |
| --- | --- |
| A seventh free web service | Verify the account's remaining instance-hour budget before phase 7, same caution as every prior new service |
| A sixth database | `myunivokai_telemetry`, if the postgres sink is ever enabled — the OTLP-only path needs none |
| A second language in the repository | Mitigated by the shared-fixture test in phase 0, a dedicated CI job, and the `be/source-overview.md` paragraph — not eliminated, only bounded |
| Two sinks to keep working | `sinks::postgres` and `sinks::otlp` both need their own test coverage; an untested sink is worse than no sink, because the switch makes it silently reachable in production |
| The retention trap, inherited | Same as `analytics-service`'s: a real gap only if the Telemetry screen goes unopened for the stream's 7-day retention. Bounded and accepted, not eliminated — see §Durability and wake |
| Three more rollup dimensions to maintain | `nats_rollups` and `cache_rollups` are new counters at existing call sites (subject dispatch, cache lookups) — small, but each is one more place a future refactor can silently stop incrementing |

## Future dependency: the admin navigation needs restructuring once this ships

Not part of this plan's phases — the owner asked for this to be recorded as
a known consequence, not built now, and only once phase 8 above actually
ships and the sidebar demonstrably feels crowded.

`apps/myunivokai-admin/src/components/layout/nav-config.tsx` today is one
flat `NAV_ITEMS` array, seven entries, rendered as one undifferentiated list
by `AppSidebar`: Dashboard, Worlds, Jobs, Fleet, Accounts, Roles, Audit Log.
Adding **Telemetry** makes eight, and it is the entry that most breaks the
existing implicit grouping — the other seven already split cleanly into
"business data from `analytics-service`" (Dashboard, Worlds, Jobs, Fleet) and
"staff administration from `auth-service`" (Accounts, Roles, Audit Log).
Telemetry is neither: it is infrastructure/operations data about the
platform itself, read from a third service with its own data boundary. A
ninth flat entry, whatever it turns out to be, makes the case load-bearing
rather than cosmetic.

Two directions worth naming now, not deciding now:

1. **Grouped sections inside the same sidebar** — collapsible headers
   (`SidebarGroup` already exists in `components/ui/sidebar.tsx` and is
   already used per-page; the missing piece is putting more than one group
   in `AppSidebar` itself), e.g. *Product* (Dashboard, Worlds, Jobs),
   *Platform* (Fleet, Telemetry), *Administration* (Accounts, Roles, Audit
   Log). Lowest-risk: same component tree, same single page, no new routing
   concept.
2. **A top-level section switcher above the sidebar**, closer to how AWS,
   GCP or Render's own console separate concerns — a persistent
   product/platform/admin switcher that swaps which nav list `AppSidebar`
   renders. Clearer separation at the cost of one more click to cross
   sections, and a real design decision about what happens to `/` (does
   Dashboard become the product section's home, or gain a cross-section
   landing page of its own).

This plan takes no position between them. It only asserts that the decision
becomes real the moment Telemetry ships, and that whoever revisits this
should start from `nav-config.tsx`'s existing comment explaining the current
implicit split — the grouping logic already half-exists in prose, it has
just never needed a second axis (operations, alongside product and
administration) until now.

## Open decisions still needed from the owner

1. **Default `TELEMETRY_SINK` value.** This plan does not pick one. `postgres`
   gives the admin app something to render from day one; `otlp` gives
   alerting for free but nothing to look at inside `myunivokai-admin` until a
   Grafana dashboard is built by hand.
2. **Retention window for `http_rollups`.** Sketched at 90 days above,
   matching the research doc's schema; not confirmed.
3. **Which admin navigation direction to take** — grouped sections inside one
   sidebar, or a top-level section switcher — see §Future dependency above.
   Not urgent: only becomes real once phase 8 ships.

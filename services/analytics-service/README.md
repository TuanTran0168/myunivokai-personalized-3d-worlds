# Analytics Service

Analytics Service is the admin read model. It consumes events, writes its own
database, and answers admin queries. **It never publishes an event, never
accepts a write from the edge, and never calls another service.**

That last sentence is the whole design, and it is checkable in review:

> The only writer to `myunivokai_analytics` is this service's own event
> consumer. Every other path into this service is read-only.

Two structural consequences you will notice reading the code:

- There is **no `outbox_messages` table** and no outbox publish loop. Every
  other service in this repo has both. A reviewer who finds one here should
  treat it as a design violation, not an omission.
- Its NATS user may publish **no `myunivokai.*` subject at all** — only
  `$JS.API.>` (its own durable consumer) and `_INBOX.>` (a reply to whoever
  asked). The ACL in [infra/nats/nats-server.conf](../../infra/nats/nats-server.conf)
  enforces the rule rather than trusting the code to honour it.

See [notes/plans/services/analytics-service-plan.md](../../notes/plans/services/analytics-service-plan.md)
for why this exists instead of the gateway fanning out to universe, nature and
dna: three processes serve an admin page (gateway, auth, analytics), and no
sleeping domain service is ever on that path.

## What it consumes

One durable consumer, `analytics-events-v1`, filtered on the wildcard
`myunivokai.events.>` — a new event subject reaches it without a code change.

| Event | Effect |
| --- | --- |
| `dna.generated` | job → `processing` |
| `dna.failed` | job → `failed`, with the error code |
| `{family}.completed` | job → `completed`, **and** the world's first snapshot |
| `{family}.failed` | job → `failed`, with the error code |
| `{family}.world.changed` | world upsert only |

Every delivery writes an `inbox_messages` row and its projection in one
transaction. JetStream guarantees duplicate delivery; `ON CONFLICT (message_id)
DO NOTHING` makes that a non-event.

Worlds move forward only: the upsert carries
`WHERE world_projections.revision < EXCLUDED.revision`, so a redelivered or
reordered older snapshot cannot overwrite a newer one. That guard is the
reason the design chose snapshot events over fine-grained ones — the
projection needs no ordering of its own.

`created_at` on a job uses `LEAST(existing, incoming)` for the same reason,
so a late-arriving first event still yields the right `duration_ms`. All
timestamps come from envelope fields stamped by the publishing service, never
from a clock inside this service — a job spans three processes and only the
envelope is common to all of them.

## What it answers

Four subjects, queue group `analytics-service-v1`:

| Subject | Answers |
| --- | --- |
| `queries.analytics.overview.get.v1` | Totals per family, failure rate, publish rate, duration percentiles, archetype/style/mood distributions, the generation funnel, today-vs-yesterday deltas, job submissions by hour of day, and the observed rate of every rare feature |
| `queries.analytics.world.list.v1` | Paginated, filterable worlds table — including "the worlds that rolled a black hole" |
| `queries.analytics.job.list.v1` | Paginated jobs and failures with error codes |
| `queries.analytics.timeseries.get.v1` | Counts per day per family over a range |

Every aggregate is computed in SQL here. The gateway sums nothing and the
admin app sums nothing.

Three of those deserve their own note, because each has an obvious wrong
version that reads as correct:

- **The comparison is a rolling 24 hours against the 24 before it**, not two
  calendar days, and it is deliberately independent of `days`. A calendar
  comparison at 09:00 puts nine hours against twenty-four and reports a
  collapse every morning; tying it to `days` would turn a 90-day view into a
  comparison against the 90 days before it, which is a different question.
  A period whose predecessor holds nothing reports `hasBaseline: false` rather
  than a percentage — "+100%" against nothing is a trend that never happened.
- **The funnel's four stages are measured over the same set of jobs** — the
  ones submitted inside the window. Publishing is joined back through
  `source_job_id`, so a world published today from a job submitted last month
  cannot appear under a stage its job never entered. Each stage's share is of
  the FIRST stage, never the previous one.
- **p50 travels with p95 everywhere.** Both are exact here: this service has
  every job's own `duration_ms` and uses `PERCENTILE_CONT`, unlike
  telemetry-service's interpolation across fixed histogram edges. The gap
  between them is the finding — a low median under a high tail is a slow
  minority, two high numbers are a slow platform, and the fixes are opposite.

### Measuring a thing that is never stored

The rarity panel answers *the black hole is tuned to 40% — how often does it
actually come up, and which worlds got one?*

Neither half had an answer before. A rare feature is not persisted anywhere:
the frontend re-derives it from the selected variant's seed on every render.
So the seed crosses the data boundary (see below), and
`contracts/go/contracts_rarity.go` **replays the same seeded lottery** — a port
of the renderer's FNV-1a + xorshift32 PRNG — over the seeds of real worlds.
Reading 40% back out of the catalogue would answer a different question: what
the generator was aimed at, not what it hit.

Three things make it trustworthy rather than merely plausible:

- **`contracts/fixtures/rarity/rare-feature-rolls.v1.json` pins the two
  implementations together.** It is generated from the frontend's own lottery
  and asserted by both suites, seed by seed and draw by draw. Nothing else
  would notice a one-character difference in the hash or the shift order —
  both sides would keep working and quietly disagree about which worlds hit.
  It records raw draws, so re-tuning a probability leaves it untouched and it
  fails only when the lottery itself moves.
- **`world_rare_rolls` stores the raw draw, not "did it hit".** The comparison
  against the probability happens at query time, so changing the black hole
  from 40% to 20% re-derives the whole of history on the next request instead
  of stranding every row already written. It is also why the panel's count and
  the worlds list behind it are the same SQL predicate and cannot disagree.
- **The denominator is stated, and worlds with no seed are excluded from it.**
  A rare feature over a small population is mostly sampling noise: 5% over 40
  worlds expects two hits, and four is not a bug. The admin screen draws the
  band a correct lottery would land in 95% of the time and refuses to draw one
  at all below the sample size where that approximation holds. Worlds projected
  before the seed crossed the boundary are counted separately as *unmeasured* —
  they are not misses, and folding them in would report a rate that falls as
  history grows.

### Tests

The arithmetic behind all of it (delta, funnel share, peak hour, rarity
denominators and species shares) is unit-tested in
`internal/repositories/overview_math_test.go` with no database, because none of
it touches one. What a database is needed for — that the funnel's stages come
from one job set, that the comparison's two periods do not overlap — is the
SQL's own business and is stated beside those queries.

Pagination is **keyset**, never `OFFSET`: the cursor encodes the
`(timestamp, id)` the last page ended on, so page 1000 costs the same as page
1 and the response stays inside the gateway's 2500ms request/reply deadline
as the table grows. `pageSize` is clamped to 1–100 (default 25) and `days` to
1–90 (default 30) in `contracts.NormalizePageSize` / `NormalizeDays`, so the
gateway, this service and the admin app cannot disagree about what a page is.

## Data boundary

`myunivokai_analytics` is a second copy of production data, so what crosses
into it is an **allow list**, not a deny list, and
`contracts.WorldSnapshot` *is* that list. Nothing may be added to it without
a matching line in the plan's §Data boundary.

`nickname` is the only user-entered value here, kept deliberately so an admin
table has a human label. These never cross, under any phase: the submitted
form (`profiles.raw_input`), the generated profile (`dna_versions.profile_dna`,
`worlds.dna_snapshot`), the world quote, variant scene configs, AI request and
response bodies, and share slugs.

The one addition since: **`variant_seed`**, the selected variant's seed. It is
a base32 identifier this platform generated, carrying nothing a person typed —
the boundary gained a machine value and no user content, which is the only kind
of addition this list should accept. It is the selected variant's rather than
the world's first because switching variants changes the scene the world shows,
and with it which lottery it rolled.

## Local development

The service is part of the root stack; nothing extra to run:

```bash
make local-up
```

Compose creates `myunivokai_analytics` with the role
`myunivokai_analytics_app`, runs `cmd/migrate`, then starts the consumer. All
values have `${VAR:-default}` fallbacks, so no `.env.local` edit is required.

Standalone, from this directory:

```bash
cp .env.example .env.local
go run ./cmd/migrate
go run ./cmd/service
```

Checks, exactly what CI runs:

```bash
go vet ./... && go test ./... && go build ./...
```

## Deployment runbook

`render.yaml` already declares `myunivokai-analytics`. **Do all four steps
before merging to `main`**, or the service crash-loops on first boot.

1. **Verify the Render budget.** This is the **sixth** free web service on the
   account (gateway, dna, universe, nature, auth, analytics). Free instance
   hours are shared account-wide — check the remaining budget first.

2. **Create the Neon database.** A separate database from auth's. If Neon's
   project limit binds, put analytics and auth in the same *project* as
   separate databases rather than sharing one database. Then set both, e.g.:

   ```
   DATABASE_URL=postgresql://myunivokai_analytics_app:REPLACE_WITH_NEON_PASSWORD@ep-cool-fog-12345678-pooler.ap-southeast-1.aws.neon.tech/myunivokai_analytics?sslmode=require
   DATABASE_DIRECT_URL=postgresql://myunivokai_analytics_app:REPLACE_WITH_NEON_PASSWORD@ep-cool-fog-12345678.ap-southeast-1.aws.neon.tech/myunivokai_analytics?sslmode=require
   ```

   `DATABASE_DIRECT_URL` is the **unpooled** host (no `-pooler`), used only by
   the migration runner — goose takes advisory locks, which a transaction
   pooler does not carry across statements.

3. **Point it at NATS.** Nothing to configure on the broker: production uses
   Synadia Cloud with **one account user shared by every service**, supplied
   as a `nats.creds` secret file, so this service reuses the existing
   Environment Group unchanged — see
   [notes/skills/production-deployment-guide.md](../../notes/skills/production-deployment-guide.md).
   Set `NATS_URL=tls://connect.ngs.global:4222` and
   `NATS_CREDENTIALS=/etc/secrets/nats.creds`, and **do not** set
   `NATS_USERNAME` / `NATS_PASSWORD`.

   The per-user block in
   [infra/nats/nats-server.conf](../../infra/nats/nats-server.conf) is
   therefore **local-only**. That matters for how you read this service's
   read-model guarantee: locally the ACL enforces "publishes no domain
   subject", in production only the code does. If per-user permissions are
   ever configured in Synadia, this is the block to copy, and `$JS.ACK.>` is
   the line most easily missed — acknowledging a JetStream delivery publishes
   under that prefix, not under `$JS.API.>`, and omitting it makes every
   message redeliver until `AckWait` expires, forever, logging only a
   `permissions violation` line and never failing at startup.

   ```
   {
     user: myunivokai_analytics
     password: REPLACE_WITH_A_GENERATED_PASSWORD
     permissions: {
       publish: ["$JS.API.>", "$JS.ACK.>", "_INBOX.>"]
       subscribe: ["_INBOX.>", "myunivokai.events.>", "myunivokai.queries.analytics.>"]
     }
   }
   ```

   Then set `NATS_URL`, `NATS_USERNAME=myunivokai_analytics` and
   `NATS_PASSWORD` on the Render service.

4. **Turn the admin routes on.** The gateway ships with
   `ADMIN_ROUTES_ENABLED=false`; the analytics screens stay unreachable until
   it is flipped to `true` **and** `ADMIN_ALLOWED_ORIGIN` holds the admin
   app's exact origin. Flipping it with an empty origin fails config
   validation and the whole gateway — product routes included — refuses to
   start.

### First start replays whatever the stream still holds

`MYUNIVOKAI_EVENTS` retains 7 days with `discard: old`. A brand-new durable
consumer defaults to `DeliverAll`, so the first start backfills the window for
free. There is no other backfill: an outage longer than 7 days is a permanent
gap, accepted deliberately at current data volume. Diagnose a hole in the read
model as retention first, not corruption.

That retention used to be reachable without any outage at all, which is a
different and worse thing. This service sleeps when idle and woke only when a
staff member opened the console, so a week with no visit expired the oldest
events **unconsumed** — the projection permanently wrong, nothing logged
anywhere, because a message that ages out of a stream is not a failure anybody
observes. Since 2026-08-14 the gateway wakes this service on each of the four
world mutations that produce an event, after the write is accepted rather than
before it, so the consumer starts at the moment there is something to consume.
Reads still wake nothing. See `WorldHandler.wakeReadModel` in api-gateway and
[service-wake-mechanism.md](../../notes/plans/architecture/service-wake-mechanism.md).

An outage still ends in a permanent gap, and one thing remains uncovered by
design: a `service.started` event nobody asked the gateway for can still expire
if the fleet restarts during a quiet week. That costs a row of Fleet history,
not a wrong world count.

## The cost to keep paying

Every future mutation in universe-service or nature-service must also bump
`worlds.revision` and write a `world.changed` outbox row inside the same
transaction, or this read model silently drifts — the world keeps changing in
the family database and stops changing in the admin app, with nothing failing
anywhere. That is the standard price of CQRS.

The guard is already in place:
`internal/repositories/world_snapshot_test.go` in **both** family services
asserts that every mutating store method leaves an outbox event behind. When
you add a mutation, add it to that table.

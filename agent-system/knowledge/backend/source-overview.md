# Backend source overview

> **Document status:** Implemented; local container smoke passed, deployed smoke pending
> **Last source review:** 2026-08-13 (added telemetry-service)

The backend consists of one public HTTP edge and six private NATS services.
The old gateway-to-domain HTTP proxy, duplicated family AI layers, public
domain handlers, and `GATEWAY_SHARED_SECRET` runtime have been removed.

Three of the six compose worlds (dna, universe, nature). Two serve the staff
console: `auth-service` owns identity, and `analytics-service` is a CQRS read
model that exists so an admin page never has to wake a domain service. The
sixth, `telemetry-service`, is a read model for the platform's own behaviour
rather than its business data — and the one process here **written in Rust**;
see §Telemetry Service below for why, before assuming it is an accident.

## Runtime topology

```text
myunivokai-personalization
  -> API Gateway (HTTP :41800 local, PORT on Render)
       -> JetStream MYUNIVOKAI_COMMANDS
       -> Core NATS queries
       -> Redis rate/cache

DNA Service
  -> myunivokai_dna
  -> AI Provider interface (mock/gemini/openai)
  -> Universe or Nature compose command

Universe Service -> myunivokai_universe
Nature Service   -> myunivokai_nature

myunivokai-admin
  -> API Gateway (/api/admin/*, cookie session)
       -> Core NATS queries -> Auth Service      -> myunivokai_auth + Redis
       -> Core NATS queries -> Analytics Service -> myunivokai_analytics

Analytics Service
  <- JetStream MYUNIVOKAI_EVENTS (durable, wildcard myunivokai.events.>)

Telemetry Service [Rust]
  <- JetStream MYUNIVOKAI_EVENTS (durable, one literal subject)
  -> myunivokai_telemetry  (TELEMETRY_SINK=postgres)
  -> Grafana Cloud OTLP    (TELEMETRY_SINK=otlp)
```

Only Gateway serves business HTTP. Every other service runs `cmd/service`,
consumes durable commands or events, publishes outbox events, and registers
Core NATS queue responders. They each bind a bare `/healthz` port so Render's
free tier has an inbound target to cold-start against; they are declared as
`type: web` in `render.yaml` for that reason, not because they serve an API.

## Shared contracts

`contracts/go` is a small Go module used by every backend module. NATS messages
always have exactly these top-level fields:

```json
{
  "jobId": "...",
  "timestamp": "2026-07-22T12:00:00Z",
  "data": {}
}
```

Family/profile/world identifiers are inside typed `data`. Subjects carry the
domain, operation, and V1 version. JSON schemas and fixed examples live in
`contracts/schemas` and `contracts/fixtures`; the public browser contract is
`contracts/openapi.yaml`.

## API Gateway

Source: `services/api-gateway`.

- `internal/handlers`: separate DNA job, Universe, and Nature HTTP adapters over
  one shared RPC/cache transport. Each family handler receives fixed NATS
  subjects at construction time; request data cannot reroute between services.
- `internal/broker`: JetStream publish and Core NATS request-reply.
- `internal/edge`: Redis cache and atomic distributed token bucket.
- `internal/middleware`: request identity, headers, CORS, body limit, logging,
  recovery, and Redis-first rate limit with local fallback. Two product-session
  middlewares, and the difference between them is a routing decision:
  `RequireProductAccessToken` guards `/api/me`, while
  `OptionalProductAccessToken` attaches claims where a session may be absent
  and is registered on the five world WRITE routes only. It must not reach the
  reads — `/api/{family}/share/worlds/{slug}` is a public URL and answered 401
  to anybody holding an expired token while it did.
- `internal/config`: NATS/Redis/cache/edge configuration and production CORS
  validation.

- `internal/wake`: starts services that a scale-to-zero host has put to sleep,
  shaped after `internal/ai` in dna-service — dumb per-platform adapters under
  `wake/platforms`, one coordinator holding the shared policy, `wake/factory`
  holding the switch. Deliberately one self-contained directory: it is a
  hosting workaround, and its package doc lists every call site outside itself
  so deleting it later is mechanical.

`POST /api/{family}/worlds` returns `202` only after a JetStream `PubAck`.
Reads/mutations have a bounded NATS request timeout. Redis does not transport
jobs; it may be flushed without losing accepted commands or persisted worlds.

Because every other service is a pure NATS consumer, nothing sends them the
inbound HTTP a sleeping instance needs to wake. The gateway therefore splits
`no-responders` (nobody subscribed — starts the service, answers `503
SERVICE_WAKING` with `Retry-After`) from a deadline (`504 SERVICE_TIMEOUT`)
from any other broker fault (`503 SERVICE_UNAVAILABLE`), where it used to
report one code for all three. Reads wake reactively; `POST .../worlds` wakes
proactively, since a JetStream publish succeeds with no consumer alive and so
produces no error to react to. `SERVICE_WAKE_PLATFORM=none` is the default and
the correct value on an always-on host. See
`agent-system/plans/architecture/service-wake-mechanism.md`.

## DNA Service

Source: `services/dna-service`.

- owns raw `WorldInput`, profiles, root jobs, immutable DNA versions, provider
  attempts, inbox, and outbox;
- is the only service with provider adapters under `internal/ai/providers`;
- business logic depends on `ai.Provider`, not provider-specific clients;
- validates AI JSON before persistence and records a hash instead of raw prompt
  input in attempt telemetry;
- publishes one requested family compose command containing an immutable
  ProfileDNA snapshot;
- consumes family completion/failure and answers job queries.

The default mock provider makes no external call but intentionally selects
between multiple ProfileDNA presets per mood and randomizes facet energy. Its
random-index strategy is injected in tests, preserving deterministic assertions
without removing runtime variety. Variant regeneration remains inside family
services and does not call AI.

### The daily AI quota, and how a world says it was built

Design: §9 and §9.1 of
`agent-system/plans/architecture/end-user-identity-and-ownership.md`, and
decisions 8, 17 and 17b.

**The counter is the gateway's and the reason is this service's**, because
those are the two places the facts live. The gateway increments
`<REDIS_KEY_PREFIX>:quota:ai:daily:<utc day>:<caller>` before publishing the
generate command, compares it against a settings row, and puts the verdict on
the command as `contracts.AIQuotaState`. This service computes the reason,
because it is the only place all three facts exist at once: the verdict
arrived on the command, the configured primary is its own config, and the
fallback is its own runtime outcome.

**Over the limit never refuses.** The world is still created, from the preset
provider, and it is real, deterministic and the visitor's. There is no 429 on
the create path.

The orchestrator holds THREE providers. The preset one is `providers.NewMock()`
built from no configuration at all, and it is not the fallback: `aifactory`
constructs a fallback only when it differs from the primary, so production —
with `AI_PROVIDER` and `AI_FALLBACK_PROVIDER` both `mock` — has none, and a
degrade that reached for it would fail the job rather than degrade it.

`Orchestrator.GenerateProfileDNA` is four ordered branches, and **the order is
the decision**:

| # | Condition | Reason |
| --- | --- | --- |
| 1 | the primary is not an AI provider | `mock_configured` |
| 2 | the AI tier was withheld | `quota_exhausted` |
| 3 | the primary answered | `ai_generated` |
| 4 | the primary failed, a distinct fallback answered | `ai_failed_fallback` |

Swapping 1 and 2 announces a limit on an AI tier that is switched off, on every
sixth create, in the only environment that currently exists — production runs
`AI_PROVIDER: mock`. A primary failure with no distinct fallback stays a FAILED
job and carries no reason: a reason describes how a world was produced, so a
job with no world has none.

`primaryProviderCallsAI()` is written as "is not the mock" rather than as a list
of the paid providers, so a provider added later counts as AI on the day it is
added rather than being silently free.

The reason and the limit it was measured against are stored on
`generation_jobs`, in the SAME statement as the DNA version — two statements
could lose the reason to a crash between them. Both columns are nullable with
no default: NULL is the honest value for every job that predates the quota and
for every failed one. **No world table learns the reason**, which is §9.1's
rule: the truth is owed once, to the person who hit the limit, not permanently
to the friend who opens their share link.

The enum is declared in Go (`contracts.DeclaredGenerationReasons`), in a CHECK
constraint, and in a TypeScript union.
`TestTheGenerationReasonCheckAdmitsEveryDeclaredReason` reads the first and
fails in both directions against the second — the same trap a new world family
has, where the code compiles and the CHECK is the thing nobody edits.

### The account's own world list

`myunivokai.queries.dna.library.list.v1`, one keyset page, answered from
`generation_jobs` joined to `profiles`. §3.1 is why this is a query here rather
than a `library-service`: the link it would own already exists.

The owner arrives on the query and there is no other parameter for whose worlds
to list, so no request shape asks for a stranger's. The response is three
fields — world id, family, creation time — asserted on the TYPE by
`TestTheWorldListRowCarriesNothingSensitive`, so a fourth fails the build
rather than shipping unset.

Two things about this query that read as omissions and are decisions:

- **It cannot exclude a deleted world.** The flag lives in the family service's
  own database and a deletion emits no event, so nothing here is ever told. The
  filter's one home is the family service's read, which the web app already
  goes through to hydrate each card.
- **It is keyset but not constant-cost.** The filter is on
  `profiles.owner_account_id` and the order on `generation_jobs.created_at`, so
  no single index serves both and Postgres sorts the account's matching jobs.
  Never `OFFSET`, so a page boundary is stable; affordable because one create
  makes one profile. The threshold where that stops holding, and the
  denormalisation that would fix it, are in `postgres_library.go`.

The cursor is base64 of `<unix nanoseconds>:<job id>`, and the job id is not
redundant: two jobs can share a `created_at` because a retry writes its row
with the same statement's clock, so the tie-break has to be part of the cursor.
The first page uses a SEPARATE statement, because `(created_at, job_id) <
(NULL, NULL)` is NULL in Postgres and would answer every first request with an
empty page.

## Universe, Nature and Ocean services

Sources: `services/universe-service`, `services/nature-service` and
`services/ocean-service`.

Both use the same layers:

```text
cmd/service -> internal/messaging runtime -> internal/handlers NATS adapters
            -> internal/services -> internal/repositories -> PostgreSQL
```

Each service:

- consumes only its versioned compose subject;
- registers explicit Core NATS handlers for list/get/variant/publish/share;
- maps family-neutral facets into its existing deterministic scene builder;
- atomically records inbox + world + initial variant + completion outbox;
- returns the existing world/variant/publish/share JSON shapes over Core NATS;
- preserves UUID validation at Gateway and privacy-safe public projections;
- supports idempotent compose redelivery and AI-free variants;
- stores `profileId`, `dnaVersionId`, source job, visual intent, and DNA
snapshot in its own database.

`ocean-service` is a third copy of this shape and is described by every line
above.

### Ownership and deletion

Each family's `worlds` table carries `owner_account_id`, `anonymous_id` and
`deleted_at`, all nullable, none backfilled. A world with no owner is the
normal case and describes every world made before 2026-09-03.

**Exactly one of the two identity columns is ever set on a new world.** The
gateway drops the visitor's `X-Anonymous-Id` the moment a verified token gives
it an account to name instead, because a world that has an owner can never be
claimed. `owner_account_id IS NULL` answers "is this anonymous"; `anonymous_id`
answers "*which* anonymous visitor", and only the second can be turned into
ownership later.

`internal/repositories/world_ownership.go` holds the rules, and there are two
of them because deletion does not follow the others:

- `worldMutationPermitted` — a world with **no** owner is mutable by anyone
  holding its id; a world with an owner is mutable only by that owner.
- `worldDeletionPermitted` — a world with no owner is deletable by **nobody**,
  which is `ErrWorldNotOwned` and reaches the client as `403
  WORLD_NOT_CLAIMED`.

Both are applied by a `SELECT ... FOR UPDATE` inside the mutation's own
transaction, never against a read model. The mutation lookup also filters
`deleted_at IS NULL`; the deletion lookup deliberately does not, so deleting
twice answers the way deleting once did.

Deletion sets a timestamp and never removes a row. Every product read filters
it — the world read, the `?ids=` batch and share resolution — with exactly one
exception, `getWorldBySourceJob`, the create path's idempotency lookup, which
must still find a deleted world or a JetStream redelivery repeats for ever.
`deletedWorldPolicy` is what makes that exception a name rather than a missing
clause.

A deletion bumps no revision and stages no outbox row: `analytics-service` is
deliberately untouched, so the snapshot it would emit is identical to the last
one.

### The claim

One command in, one to three out. The gateway is admitted on exactly one
command subject and it is DNA's, and `dna-service` is the only service that
knows which FAMILIES a visitor used — its own `generation_jobs` rows name one
each. So `POST /api/me/worlds/claim` publishes
`commands.dna.world.claim.v1`, and `dna-service` publishes
`commands.<family>.world.claim.v1` only for the families that visitor actually
used.

`dna-service`'s `ClaimWorlds` reads those families **before** the `UPDATE`,
while `anonymous_id` still points at the rows, and discards them if the update
claimed nothing — that last line is the concurrent loser's path, and without it
a claim that took no rows would still fan out.

Each family's `ClaimWorlds` is one statement:
`SET owner_account_id = $1, anonymous_id = NULL WHERE anonymous_id = $2 AND
owner_account_id IS NULL`. The guard is the whole of the idempotency and of the
two-device race, and clearing `anonymous_id` is not tidiness — it is a bearer
credential in a JS-readable cookie, useless once an account owns the worlds it
named. No revision bump and no outbox row, for the same reason a deletion has
none.

**The claim consumers carry no delivery limit**, because a claim that gave up
would leave somebody's worlds anonymous for ever with nothing anywhere saying
so. That makes a message which can never be applied a message the fleet retries
until the stream drops it, so a transport-level failure is told apart by its
error: `ErrInvalidWorldClaimCommand` is `Term()`ed, everything else nacked. The
gateway also refuses to publish an unapplicable one, including when the fault is
its own — a verified token whose subject is not an account id is a 500 there.

Only `dna-service` is woken. The gateway owns the only waker and cannot know
which families were used; the family claim commands wait in
`MYUNIVOKAI_COMMANDS` until each service next runs. The bound that leaves is the
stream's 168-hour retention.

`nats_publish_permissions_test.go` in the gateway is where the whole command
boundary is checked: `commandSubjectRoutes` names every command subject with its
one permitted publisher and its one permitted subscriber, and the tests fail on
an extra publisher, a missing subscriber, a subject in the config the table does
not name, and any command wildcard.

The runtime owns connection lifecycle, deterministic subscription registration,
pull/ack/retry policy, and outbox polling. Fetch size/wait, retry delay,
connect/reconnect timing, publish timeout, ack wait, and maximum deliveries are
configuration values. Every inbound envelope is validated before its service is
called, and a terminal compose message is acknowledged only after its failure
event receives a JetStream acknowledgement.

DNA generation commands use bounded redelivery. After the configured maximum,
DNA Service durably creates/updates the root job as failed and queues its failure
event before terminating the poison command. Family result events use unlimited
redelivery so a temporary DNA database outage cannot silently drop the final
job state.

Universe scene configs now explicitly include `sceneType: "universe"`; Nature
continues to use `sceneType: "forest"`. The frontend registry remains
sceneType-first.

## Auth Service

Source: `services/auth-service`.

A pure Core NATS request-reply worker: no JetStream command to pull, no domain
event to publish, so it has neither a `PullSubscribe` nor an outbox loop. It
answers login/refresh/logout, account and role management, permission lookups
and the audit list, and writes a `tokenVersion` key to the gateway's Redis so
a disabled account's still-valid access token can be rejected without a
per-request round trip.

`internal/repositories` keeps one `Store` interface per backend
(`PostgresStore`, `MemoryStore`) like every other service; what is split per
concern is the *file* (`postgres_accounts.go`, `postgres_audit.go`, …), not
the type.

### System settings

Nine operator-changeable policy numbers — two quota ceilings, four token
lifetimes, an invite lifetime and the lockout pair. Design: §9.3 of
`agent-system/plans/architecture/end-user-identity-and-ownership.md`.

**The registry is `contracts.DeclaredSettings()`, not anything in this
service.** It declares each setting's key, type, description, bounds and
default, and it lives in `contracts` because both sides read it: this service
validates every write against it, and the gateway needs the two `quota.*`
defaults to answer a cache miss. A registry inside `auth-service` would mean
the gateway declaring its own copy of the number 5.

`system_settings` holds only OVERRIDES. Every setting has a default in code and
the platform is required to boot and behave correctly with the table empty and
Redis flushed, which is what `TestAnEmptySettingsTableIsAWorkingPlatform`
asserts — the screen AND a real sign-up, because a list assertion alone would
not notice a zero-length session. Defaults are held as text so that a default
and an operator's value go through the same parser and the same bounds check.

Bounds are code and are enforced on write. Two of them are load-bearing rather
than tidy: `auth.lockout.max_failed_attempts` has a floor of 1, because 0 locks
every account on its zeroth failed attempt including the one that would put the
value back; and each audience's access-lifetime range ends exactly where its
refresh range begins, so no pair of values anybody can write leaves an access
token outliving its refresh token.

**The two sides read different sources, deliberately.** This service reads
Postgres at the moment of use — it owns the table, and going through its own
Redis mirror would let a flushed cache silently revert its policy to the
defaults while the rows said otherwise. The gateway reads the mirror only, and
a miss uses its compiled-in default rather than a NATS request: see
`services/api-gateway/internal/settings/reader.go`, which is the one place this
repository inverts `RevocationChecker` and the one place a reflection test
guards the shape of a type rather than its behaviour.

A write goes row → audit → mirror, in that order. The audit line is
`<key>: <old> -> <new>` with `default` for an absent previous row, and it is
written before the mirror so the transition it records survives a Redis
failure. A failed mirror write is reported to the operator rather than
swallowed: the row is committed, but the gateway is still enforcing the old
value.

An orphan row — one whose key has left the registry — is listed and never
deleted, which is the deliberate opposite of `SyncPermissions`' trailing
`DELETE FROM permissions WHERE NOT (codename = ANY($1))`. It reaches the admin
screen with no type, no default and no bounds, because there is no declaration
left to take them from.

Two permissions gate the two routes (`settings:read`, `settings:manage`), both
in `enforcedPermissions`, and the admin screen renders the registry rather than
a hand-written form — so a tenth setting is a backend-only change, in a new
section of its own if its key prefix is new.

## Analytics Service

Source: `services/analytics-service`. Design:
`agent-system/plans/services/analytics-service-plan.md`.

The admin read model, and the one service in this repo whose shape is
deliberately asymmetric:

- **No `outbox_messages` table and no publish loop.** It consumes events,
  writes its own database and answers queries — it publishes nothing and calls
  no other service. An outbox appearing here is a design violation.
- **Its NATS user may publish no domain subject at all**, only `$JS.API.>`,
  `$JS.ACK.>` and `_INBOX.>`. Locally the ACL enforces the rule; in production
  every service shares one NGS account user, so there only the code does.
- **One durable consumer** (`analytics-events-v1`) on `MYUNIVOKAI_EVENTS`,
  filtered on the wildcard `myunivokai.events.>` with `MaxDeliver(-1)`. It is
  invisible to `dna-service`, whose consumer filters four explicit subjects.

Each delivery writes an `inbox_messages` row and its projection in one
transaction. Worlds move forward only —
`WHERE world_projections.revision < EXCLUDED.revision` — which is what makes
JetStream's duplicate and out-of-order delivery harmless without the consumer
ordering anything itself. Job timestamps come from envelope fields stamped by
the publishing service, never a local clock, because a job spans three
processes and only the envelope is common to all of them.

Reads are four query subjects on the `analytics-service-v1` queue group.
Every aggregate is SQL here; the gateway sums nothing. Pagination is keyset on
`(timestamp, id)` — never `OFFSET` — so page 1000 costs what page 1 costs and
the response stays inside the 2500ms request/reply deadline as the table
grows.

One aggregate here is not a read of anything: the **observed rare-feature
rate**. A rare feature — a black hole, a firebird — is never stored, because the
frontend re-derives it from the world's variant seed on every render. So the
seed crosses the data boundary and `contracts/go/contracts_rarity.go` replays
the renderer's own seeded lottery (a port of its FNV-1a + xorshift32 PRNG) over
real worlds' seeds. `contracts/fixtures/rarity/rare-feature-rolls.v1.json` is
generated from the TypeScript side and asserted by both suites, because nothing
else would notice the two implementations quietly disagreeing about which worlds
hit. `world_rare_rolls` stores the raw draw rather than the outcome, so
re-tuning a probability re-derives history instead of stranding it.

**The cost this design keeps charging:** every future mutation in universe or
nature must bump `worlds.revision` and write a `world.changed` outbox row in
the same transaction, or the read model drifts silently. The guard is
`internal/repositories/world_snapshot_test.go` in both family services, which
asserts every mutating store method leaves an event behind.

## Telemetry Service — and why one service is not Go

Source: `services/telemetry-service`. Design:
`agent-system/plans/services/telemetry-service-plan.md`. Runbook and deviations:
`services/telemetry-service/README.md`.

**This is the only process in the repository written in Rust, and that is a
decision rather than an accident.** Track C of
`agent-system/evolution/platform-evolution-research.md` set out to find one service worth
writing in another language and named four criteria; `rust-adoption-research.md`
scored every candidate against them and picked this one — new rather than a
rewrite, off the product's critical path (a missing dashboard panel), a
contract shape this repo already has five examples of, and a workload
(sustained aggregation, predictable memory) that plays to Rust's strengths
instead of being CRUD wearing a new syntax. Rewriting `analytics-service`,
`auth-service`'s Argon2 and `city-service` were each rejected with the
measurement that rejected them; that document is worth reading before anyone
proposes a second Rust service.

The cost is named rather than waved at: a second language means a
hand-maintained copy of `contracts/go`, and contract drift is already this
architecture's main long-term expense. The mitigation is not documentation but
a test — `contracts/rust/tests/telemetry_fixture.rs` decodes the exact same
`contracts/fixtures/telemetry-http-rollup-event.v1.json` that
`contracts/go/contracts_telemetry_rollup_test.go` decodes. Two languages, one
fixture, one CI failure if they disagree. Both jobs run in
`.github/workflows/ci.yml`.

What it does:

- **The gateway aggregates; this service stores.** `internal/telemetry` in the
  gateway keeps an in-memory map keyed on `{chi route TEMPLATE, method, status
  class}` — never `request.URL.Path`, which is the single rule that keeps the
  series count bounded — plus per-backend NATS round trips and Redis cache
  hits, and flushes one envelope per interval on
  `myunivokai.events.telemetry.http.v1`. Volume is one message per minute per
  instance regardless of traffic.
- **Published through JetStream, not Core NATS.** This service sleeps on the
  free tier, and a Core publish reaches whoever is subscribed at that instant
  or nobody — which would lose every interval for as long as it slept.
- **One switch, two destinations.** `TELEMETRY_SINK` is `postgres` or `otlp`,
  read once at startup exactly where `AI_PROVIDER` and
  `SERVICE_WAKE_PLATFORM` are read in theirs. The OTLP sink stores nothing and
  answers no range query; the admin screen then shows a link rather than an
  empty chart.
- **Its NATS user may publish no domain subject at all**, like
  `analytics-service`, and is narrower in one way: its event subscription is a
  single literal subject rather than the `myunivokai.events.>` wildcard.
- **The gateway's telemetry path is off by default** (`TELEMETRY_ENABLED`).
  With it off no middleware is registered, no ticker runs and nothing is
  published.

**The known inconsistency:** this service does *not* announce its own boot on
`myunivokai.events.telemetry.service.started.v1`, so it is absent from the
admin Fleet screen. `contracts.ServiceNames` has no `telemetry` entry, and
adding one would mean a contracts change, an ACL grant and a projection path
that the approved plan does not ask for. It is recorded here rather than left
to be noticed.

## Service start announcements

Every process announces its own boot on
`myunivokai.events.<service>.service.started.v1`, and `analytics-service`
stores it in `service_starts`.

Nothing reports a stop, because nothing can: an OOM kill or `SIGKILL` runs no
handler, so a service that tried would record every graceful shutdown and miss
every bad death - exactly backwards. A start is reported instead, and a start
nobody scheduled is the evidence that a stop happened. `instanceId` is fresh
per boot, which is what separates one process running for a week from seven
crash-restarts.

Two asymmetries are deliberate:

- **`analytics-service` publishes nothing and writes its own row directly.**
  It is the consumer, so the event would travel to itself and back, and
  sending it would need an exception in the one NATS user permitted to publish
  no `myunivokai` subject at all. That absolute is worth more than symmetry.
- **`auth-service` gains `$JS.API.>` and one literal subject.** It still
  accepts no JetStream command and publishes no domain event; a boot
  announcement is a fact about the process, not about identity.

Each service is granted its **own literal** started subject rather than a
wildcard, so identity is enforced by the broker instead of trusted from a
payload field - a service cannot announce a boot on another's behalf. The
projection checks the body against the subject and rejects a mismatch.

This is separate from the gateway's wake counters on purpose, and the split is
by lifetime. Waking is a property of one hosting tier and its statistics are
deleted with it; restarting is a property of running software. Read together
they separate *"the service never came up"* from *"it came up and then died"*.

`service_starts` is the one table in `myunivokai_analytics` that is **not** a
projection: it is a primary observation that exists nowhere else and cannot be
replayed. Any "drop and rebuild analytics" procedure must exclude it.

## Persistence

Fresh V1 database names:

| Owner | Database |
| --- | --- |
| DNA Service | `myunivokai_dna` |
| Universe Service | `myunivokai_universe` |
| Nature Service | `myunivokai_nature` |
| Auth Service | `myunivokai_auth` |
| Analytics Service | `myunivokai_analytics` |
| Telemetry Service | `myunivokai_telemetry` (only when `TELEMETRY_SINK=postgres`) |

There are no cross-database foreign keys. IDs and immutable snapshots cross
boundaries only through NATS contracts. Outbox messages are retried until
JetStream acknowledges them; consumer inbox keys prevent duplicate effects.

`myunivokai_telemetry` holds no user data at all — counts, durations and route
templates — which is why it is a separate database rather than a schema inside
the analytics one, and why it needs no data-boundary allow list.

`myunivokai_analytics` is the one deliberate exception to "each row lives in
exactly one place": it is a second copy of production data, so what may enter
it is an allow list (`contracts.WorldSnapshot`), not a projection of the
source row. `nickname` is the only user-entered value that crosses; raw form
input, generated profiles, world quotes, variant configs and share slugs
never do.

## Internal access boundary

`auth-service` serves BOTH audiences as of Sprint 8: staff identity for the
admin console (`agent-system/plans/services/auth-and-admin-plan.md`) and
end-user identity for the product (`aud=web`, decision 1 of
`agent-system/plans/architecture/end-user-identity-and-ownership.md`). One
`accounts` table, two audiences, and the separation between them is therefore
not a table boundary: it is the audience claim on the token plus the repository
refusing a role to a non-staff account.

Direct browser-to-domain access is prevented structurally:

- domain services have no HTTP listener or published host port;
- the browser receives only the Gateway origin;
- local NATS users have subject-scoped publish/subscribe permissions;
- production uses managed NATS credentials and TLS;
- each service receives only its own Neon URLs.

## Development checks

Run the root Compose config gate, then the checks in each Go module:

```powershell
docker compose -f docker-compose-local.yaml config --quiet
go test ./...
go vet ./...
go build ./...
```

The complete local/deployment workflow is in
`agent-system/sprints/sprint-01-2026-07-22/`. Source compilation and unit/regression
tests pass as of the review date. On 2026-07-22 UTC, the root stack built and
started on Docker Engine 27.4.0; all health checks passed and mock-provider
Universe and Nature jobs completed through Gateway, NATS, DNA, their family
service, and PostgreSQL. Managed deployment still requires operator
credentials. All five two-stage production images also build successfully.

That blocker is largely cleared as of 2026-08-14: the frontend moved to
Next 15.5.23 / React 19 on its own branch, with before/after scene screenshots
as the browser-regression evidence, closing every `next` advisory. What remains
is `postcss` and `sharp` pinned inside next's own tree, neither reachable from
this app, and only Next 16 replaces them — see `S1-SECURITY-001`. The upgrade
was kept out of this backend migration exactly as that story asked.

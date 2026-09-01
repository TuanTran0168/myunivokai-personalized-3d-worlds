# Analytics service plan — a read model for the admin app

> **Document status:** Implemented as of 2026-08-07 on
> `feat/be/analytics-service` — the source is `services/analytics-service`,
> and its README is the operational reference. Phases 0–6 landed on **one**
> branch rather than the seven listed below, at the owner's direction.
> Everything here still describes the design accurately; four corrections
> found while building are recorded in §Corrections found in implementation.
> **Last source review:** 2026-08-05
> **Supersedes:** the read-path decision in
> [auth-and-admin-plan.md](auth-and-admin-plan.md) — Option B is promoted from
> "later, on a trigger" to a planned service. Read that document first; this one
> only replaces its §Read path and its partial-results requirement.
> **Priority:** owner confirmed 2026-08-05 — auth-service, this plan, and
> `apps/myunivokai-admin` are the active track.
> [service-wake-mechanism.md](../architecture/service-wake-mechanism.md) is deliberately
> deferred behind all three.
> **Scheduled:** [Sprint 4](../sprints/sprint-04-2026-08-06/README.md), as
> `EPIC-S4-ANALYTICS-001` — second in the owner's priority order.

## What this service is, in one sentence

`myunivokai-analytics` consumes events, writes its own database, and answers
admin queries. It never publishes an event, never accepts a write from the edge,
and never calls another service.

That last clause is the whole design. The owner's phrasing — *"nó chỉ là write
db"* — becomes a rule that can be checked in review:

> **The only writer to the analytics database is the analytics service's own
> event consumer.** Every HTTP or NATS path into this service is read-only.

## Why this replaces the fan-out design

The admin read path in `auth-and-admin-plan.md` was Option A: the gateway
queries universe, nature and DNA over NATS and merges the answers. That plan
then had to add a per-family status envelope, a per-leg timeout, and a circuit
breaker — because API Composition makes availability multiplicative and Render
free-tier instances sleep.

A read model deletes that entire section rather than implementing it.

| | Option A — gateway fan-out | Option B — analytics read model |
| --- | --- | --- |
| Sleeping services an admin page must wake | 4 (universe, nature, DNA, auth) | **2** (analytics, auth) |
| Availability | Multiplicative across families | One database |
| Partial-result envelope | Required | **Does not exist** |
| Cross-family join | In-memory, in the gateway | A SQL join |
| History older than the source tables keep | Impossible | Native |
| Aggregate query load | Lands on production write databases | Isolated from the write path |
| Consistency | Strong | Eventual (seconds) |
| Second store of user data | No | **Yes** — see §Data boundary |

The owner's scaling argument is correct and is the reason to build it. The
reason to build it *now* is the first and third rows: the admin app becomes
simpler, not just faster.

Backfill is out of scope. The owner has confirmed current data volume does not
justify it, and JetStream's 7-day retention gives a free partial replay on first
start (see §Retention).

## Admin request path

```
myunivokai-admin (Vercel)
      │  fetch, cookie-bound access token
      ▼
api-gateway  /api/admin/*
      │  verify token locally + Redis revocation check   → auth-service (rare)
      │  myunivokai.queries.analytics.*.v1               → analytics-service
      ▼
analytics-service ──► its own Neon database
```

Three processes serve an admin page: gateway, auth, analytics. No domain service
is touched. This is the owner's hard requirement, and it is satisfied without
exception — including for single-record detail views, which is why the data
boundary below must be complete enough to render every screen.

## What the existing infrastructure already provides

This is the strongest argument for the design: almost nothing new is invented.

| Need | Status | Evidence |
| --- | --- | --- |
| A stream that captures new event subjects | **Exists** | `subjects: ["myunivokai.events.>"]` in [myunivokai-events-stream.json](../../../infra/nats/myunivokai-events-stream.json) |
| Room for another consumer | **Exists** | `max_consumers: -1` in the same file |
| A second consumer on `MYUNIVOKAI_EVENTS`, proven | **Exists** | `dnaResultsDurableName` in [runtime.go](../../../services/dna-service/internal/messaging/runtime.go) |
| At-least-once delivery that never gives up | **Exists** | `nats.MaxDeliver(-1)` on that consumer |
| Publishing an event atomically with a write | **Exists** | `outbox_messages` + `publishOutboxBatch` in all three services |
| Suppressing duplicate deliveries | **Exists** | `inbox_messages` + `ON CONFLICT (message_id) DO NOTHING`, [postgres_store.go:37](../../../services/universe-service/internal/repositories/postgres_store.go#L37) |
| Gateway permission to query analytics | **Exists** | gateway may publish `myunivokai.queries.>` in [nats-server.conf](../../../infra/nats/nats-server.conf) |
| Publisher permission for new event subjects | **Exists** | universe/nature may publish `myunivokai.events.<family>.>` — wildcards |
| Request/reply query plumbing | **Exists** | `QueueSubscribe` + a per-service queue group |
| Envelope, RPC response, error shapes | **Exists** | `Envelope[T]`, `RPCResponseData`, `SuccessRPCEnvelope` in [contracts.go](../../../contracts/go/contracts.go) |
| Config loader, migration runner, pool, health server | **Exists** | copy any service's `internal/config`, `internal/db`, `startHealthServer` |
| A NATS user for analytics | **Missing** | new block in `nats-server.conf` |
| Events for variant and publish actions | **Missing** | see §The event gap |
| Attributes in the completed event | **Missing** | `FamilyCompletedData` carries IDs only |
| Anything that wakes a sleeping service | **Missing** | see §The wake problem |

Four gaps. Three are small. One — the event gap — is the only thing that is
expensive to fix late.

Two consequences worth stating because they are easy to get wrong:

- **No stream or ACL change is needed to publish the new events.** The stream
  subject filter and both publisher permissions are already wildcards.
- **dna-service will not see the new events.** Its consumer uses
  `nats.ConsumerFilterSubjects` with four explicit subjects, so a new subject is
  invisible to it. No regression is possible in the job flow.

## The event gap

Six event subjects exist today:

| Subject | Payload | Carries |
| --- | --- | --- |
| `events.dna.generated.v1` | `DNAGeneratedData` | family, profileId, dnaVersionId |
| `events.dna.failed.v1` | `DNAFailedData` | family, code, message |
| `events.{family}.completed.v1` | `FamilyCompletedData` | family, profileId, dnaVersionId, worldId |
| `events.{family}.failed.v1` | `FamilyFailedData` | family, ids, code, message |

Two problems.

**The completed event carries identifiers and nothing else.** A read model fed
by it knows a world exists but cannot render one row of an admin table — no
archetype, no scene name, no style, no mood.

**Variant creation, variant selection and publishing emit no event at all.**
They are `myunivokai.queries.{family}.variant.create.v1`,
`.variant.select.v1` and `.world.publish.v1` — request/reply subjects, not
events. They leave no trace on the stream. Two charts named in
`auth-and-admin-plan.md` — publish rate, and how often a non-default variant is
selected — are therefore not derivable from today's events.

This is the one irreversible part. A database can be queried again at any time;
an event that was never published cannot be replayed. Everything else in this
plan can be deferred safely. This cannot.

## Design decision: snapshot events, not fine-grained events

Two ways to close the gap.

**Fine-grained** — `variant.created`, `variant.selected`, `world.published` per
family: six new subjects, a faithful action log, and a projection that must
apply events in order.

**Snapshot** — one new subject per family carrying the world's current
analytics-relevant state.

Recommend **snapshot**, for reasons that are specific to this project rather
than general:

- The projection becomes a single idempotent upsert, so duplicate delivery —
  which JetStream guarantees will happen — needs no special handling beyond the
  existing inbox table.
- Out-of-order delivery becomes harmless.
- Two new subjects instead of six: two fixtures, two schemas, two ACL-free
  additions.
- Every chart still works, because the snapshot carries `variantCount`,
  `selectedVariantNo` and `publishedAt` rather than requiring the reader to count
  events.

The cost is a larger payload and the loss of a pure action log. For an admin
read model that is the correct trade; if per-action history is ever needed, the
events are additive.

Concretely, add to `contracts/go`:

```go
type WorldSnapshot struct {
    WorldID           string      `json:"worldId"`
    Family            WorldFamily `json:"family"`
    ProfileID         string      `json:"profileId"`
    DNAVersionID      string      `json:"dnaVersionId"`
    SourceJobID       string      `json:"sourceJobId"`
    Revision          int         `json:"revision"`
    Nickname          string      `json:"nickname"`
    Role              string      `json:"role,omitempty"`
    Archetype         string      `json:"archetype"`
    SceneName         string      `json:"sceneName"`
    Mood              string      `json:"mood"`
    WorldStyle        string      `json:"worldStyle"`
    FavoriteColors    []string    `json:"favoriteColors"`
    TraitScores       TraitScores `json:"traitScores"`
    VariantCount      int         `json:"variantCount"`
    SelectedVariantNo int         `json:"selectedVariantNo"`
    PublishedAt       *time.Time  `json:"publishedAt,omitempty"`
    WorldCreatedAt    time.Time   `json:"worldCreatedAt"`
}
```

Embed it additively in `FamilyCompletedData`, and carry it alone in a new
`FamilyWorldChangedData` on
`myunivokai.events.{universe,nature}.world.changed.v1`.

Adding a field to `FamilyCompletedData` is backward compatible: `encoding/json`
ignores unknown fields, and dna-service compiles against the same package, so it
receives the field and ignores it. Events already in the stream simply decode
with the zero value.

Analytics then has **one** projection function — `completed` is the first
snapshot, `world.changed` is every later one.

## Design decision: a `revision` column on `worlds`

Add `revision INTEGER NOT NULL DEFAULT 1` to `worlds` in both families,
incremented in the same transaction as every mutation. It does two jobs that are
otherwise both awkward:

**Outbox message-id uniqueness.** The existing convention is
`<jobID>:<stage>`, but mutations have no job ID and repeat. Naming a message
`world_id:variant-selected:<variant_id>` breaks on a real sequence — select A,
select B, select A again: the third insert collides with the first, `ON CONFLICT
DO NOTHING` drops it, and the projection is left showing B. `world_id:rev:<n>`
cannot collide.

**Conflict resolution in the projection.** `UPDATE ... WHERE revision <
excluded.revision` is correct under reorderings; comparing wall-clock timestamps
from two different services is not.

## Data boundary — what crosses into analytics, and what never does

The analytics database is a second copy of production data. The boundary is
therefore an allow list, not a deny list, and the snapshot struct above *is* the
allow list. Nothing may be added to it without a matching line here.

**Never crosses, under any phase:**

| Field | Where it lives | Why |
| --- | --- | --- |
| `profiles.raw_input` | dna-service | The full submitted form: goal, challenge, interests, traits |
| `dna_versions.profile_dna` | dna-service | Full generated psychological profile |
| `worlds.dna_snapshot` | universe/nature | Same, copied per world |
| `worlds.quote` | universe/nature | AI text derived from personal input; no screen needs it |
| `world_variants.config` | universe/nature | Large scene payload; no analytical value |
| `ai_generation_attempts.request_json` / `.response_json` | dna-service | Raw prompts and completions |
| `world_shares.share_slug` | universe/nature | A public capability URL; counting publishes does not require it |

Only flat, aggregate-shaped values cross: identifiers, an archetype, a scene
name, a mood, a style, hex colors, five integers, three counters, two
timestamps.

**Added to the allow list: `world_variants.seed` (the selected variant's), as
`WorldSnapshot.VariantSeed`.**

| Field | Where it lives | Why it may cross |
| --- | --- | --- |
| `world_variants.seed` | universe/nature | A base32 identifier this platform generated. It carries nothing a person typed and nothing derived from what a person typed — the DNA it eventually shapes a scene with lives on the other side of the boundary and stays there. |

It crosses because it is the only way one question has an answer at all: *the
black hole is tuned to 40% — how often does it actually come up?* A rare feature
is never stored anywhere. The renderer re-derives it from this seed on every
draw, so no table in any database records that a world got one. Reading the 40%
back out of a config would answer a different question — what the generator was
aimed at, not what it hit.

The seed is the **selected** variant's rather than the world's first, because
switching variants changes the scene the world shows and therefore which lottery
it rolled. Note the direction of the widening: the boundary now carries one more
machine-generated value and no more user content, which is the only kind of
addition this list should ever accept.

Worlds projected before this shipped carry no seed. They stay in the read model
and stay out of every rarity denominator — the admin screen counts them
separately as *unmeasured*, because a world whose lottery cannot be replayed is
not evidence of a low rate. Each one rejoins the numbers the next time its world
changes and re-emits a snapshot.

**One open decision.** `nickname` is the only user-entered value in the allow
list. An admin table with no human label is close to unusable, so the
recommendation is to include it and to hold the line that it remains the *only*
personal field in this database. If the owner would rather it not be copied, the
worlds list identifies rows by archetype, scene name, family and date instead.

The `SELECT *` prohibition from `auth-and-admin-plan.md` still applies to the
three domain databases. It does not need to apply here, because by construction
this database contains no column that must not be read — which is the point of
writing the boundary as an allow list.

## Analytics schema

```
world_projections     world_id PK, family, profile_id, dna_version_id,
                      source_job_id, revision, nickname, role, archetype,
                      scene_name, mood, world_style, favorite_colors JSONB,
                      trait_creativity … trait_focus, variant_count,
                      selected_variant_no, variant_seed, is_published,
                      published_at, world_created_at, projected_at

job_projections       job_id PK, family, status, error_code, error_message,
                      world_id, created_at, completed_at, duration_ms

world_rare_rolls      (world_id, feature_key) PK, roll, species_roll

inbox_messages        message_id PK, subject, job_id, processed_at
```

`world_rare_rolls` stores the RAW DRAW each of a world's rarity lotteries
produced, not whether it hit. A draw depends only on the seed and stays true
forever; whether it hit depends on a probability that gets re-tuned. Storing the
draw means changing the black hole from 40% to 20% re-derives the whole of
history on the next query instead of stranding every row already written — and
it is why the rarity panel's counts and the worlds list behind them are the same
predicate rather than two things that can disagree.

Copy `inbox_messages` verbatim from the family migrations. **There is no
`outbox_messages` table** — analytics publishes nothing, and would be the first
service in the repo without one. A reviewer seeing an outbox here should treat it
as a design violation.

`job_projections` is fed by the DNA and family events and is what makes failure
rate and end-to-end duration answerable in one query. `duration_ms` comes from
the envelope timestamps, not from a clock in this service.

**Daily rollups are deferred.** With current volume, `GROUP BY date_trunc('day',
world_created_at)` over `world_projections` is cheaper than maintaining a rollup
table. Add rollups when either volume justifies it or a world is ever hard
deleted — a rollup is the only way to keep a count after its row is gone.

## Query contract

New subjects under `myunivokai.queries.analytics.*` — **no gateway ACL change
required**, because the gateway may already publish `myunivokai.queries.>`.

| Subject | Answers |
| --- | --- |
| `queries.analytics.overview.get.v1` | Dashboard: totals per family, failure rate, publish rate, archetype and style distribution |
| `queries.analytics.world.list.v1` | Paginated, filterable worlds table |
| `queries.analytics.job.list.v1` | Recent jobs and failures with error codes |
| `queries.analytics.timeseries.get.v1` | Counts per day per family over a range |

Reuse `Envelope`, `RPCResponseData`, `SuccessRPCEnvelope` and `ErrorRPCEnvelope`
unchanged, and a queue group `analytics-service-v1`, exactly as the family
services do. Every aggregate is computed in SQL inside this service; the gateway
must not sum anything.

Pagination is mandatory from the first version, including on
`world.list` — the request/reply timeout is 2500ms and an unbounded table will
eventually exceed it.

## The wake problem

**Confirmed in production, 2026-08-05** — this is no longer a hypothesis. A
live test produced `202 Accepted` on `POST /api/nature/worlds` followed by
`503 Service Unavailable` on the resulting job's status query. The 503, not
504, proves the failure was immediate — a Core NATS `no-responders` reply, not
a timed-out request — because no consumer was listening on dna-service's query
subject. Render free web instances spin down when idle and spin up only on an
**HTTP** request; a NATS message cannot wake one. Full analysis, reproduction
steps, and the fix design live in
[service-wake-mechanism.md](../architecture/service-wake-mechanism.md), which was **deferred by
the owner behind auth-service, analytics-service and the admin app** and then
**built immediately after them, 2026-08-08**, on this same branch. That
document is now Implemented.

That document's design already covers the admin app's case: the gateway gets a
reactive wake mechanism for every read path with no per-app opt-in, so
analytics-service's admin queries are woken the same way any other sleeping
service's queries would be. **No dedicated wake endpoint is needed here** — an
earlier draft of this plan proposed `POST /api/admin/wake`; that is removed.
That prediction held: `analytics-service` needed no wake-specific code of its
own. It appears in the mechanism only as one more name in `wake.Services` and
one more `ANALYTICS_SERVICE_URL`, because the gateway derives which service to
wake from the subject it was about to query.

## Retention, and the one way data can be lost

`MYUNIVOKAI_EVENTS` has `max_age: 604800000000000` (7 days) with `discard: old`.

| Situation | Result |
| --- | --- |
| Analytics asleep for minutes or hours | No loss. JetStream holds; the durable consumer resumes from its last ack |
| Analytics down for less than 7 days | No loss |
| Analytics down for more than 7 days | **Permanent gap.** Events older than the window are discarded |
| First start of the durable consumer | Free partial backfill — default `DeliverAll` replays whatever the window still holds |

No mitigation is planned, per the owner's decision that current data volume does
not justify backfill machinery. The accepted consequence is recorded here so a
future gap is diagnosed in minutes rather than investigated as corruption. If it
ever matters, the fix is a reconcile query against the three source databases,
run manually.

## Phases

Phase 1 is ordered first among the implementation phases on purpose: it is the
only work whose delay causes permanent data loss.

| Phase | Branch | Content |
| --- | --- | --- |
| 0 | `feat/repo/analytics-contracts` | `WorldSnapshot`; `FamilyWorldChangedData`; two `world.changed` subjects; four query subjects and their data types; JSON fixtures for the new events — `contracts/fixtures/` currently has none for any event |
| 1 | `feat/be/world-change-events` | **Start emitting.** `revision` column + migration in universe and nature; increment and write an outbox row inside the existing transactions for variant create, variant select and publish; enrich the completed event. No analytics service yet — events accumulate in the stream |
| 2 | `feat/be/analytics-service` | Service skeleton copied from universe-service: config, pool, migrations, hollow health server; the events consumer modelled on `dnaResultsDurableName` with `MaxDeliver(-1)`; inbox idempotency; the projection writer |
| 3 | `feat/be/analytics-queries` | The four query subjects, SQL aggregates, pagination, `QueueSubscribe` with the `analytics-service-v1` queue group |
| 4 | `feat/be/gateway-analytics-routes` | `/api/admin/*` read routes bound to the analytics queries. **Depends on auth-service phases 1–2** for token verification |
| 5 | `feat/ci/analytics-deployment` | NATS user block, `render.yaml` service, Neon database, `contracts/openapi-admin.yaml` entries |
| 6 | `feat/fe/admin-analytics-screens` | Dashboard, worlds table, jobs table in `apps/myunivokai-admin` |

Phases 0–3 have no dependency on auth-service and can proceed in parallel with
it. Only phase 4 joins the two tracks.

The new NATS user for phase 5:

```
{
  user: $NATS_ANALYTICS_USERNAME
  password: $NATS_ANALYTICS_PASSWORD
  permissions: {
    publish: ["$JS.API.>", "_INBOX.>"]
    subscribe: ["_INBOX.>", "myunivokai.events.>", "myunivokai.queries.analytics.>"]
  }
}
```

It is the only user that subscribes to `myunivokai.events.>` as a wildcard, and
it may publish no domain subject at all — the ACL enforces the read-model rule
rather than trusting the code to honour it.

## What this costs

| Cost | Detail |
| --- | --- |
| A sixth free web service | gateway, dna, universe, nature, auth, analytics. Render free instance hours are shared across an account — **verify the account's limit before phase 5** |
| A fifth database | Three Neon URLs exist today; auth and analytics add two. If Neon's project limit binds, analytics and auth can be separate databases inside one project |
| Eventual consistency | A just-created world appears in the admin app after a delay of seconds. Accepted by the owner |
| A second store of `nickname` | See §Data boundary; it is the only personal field |
| A >7-day outage loses events | See §Retention |
| Two mutation paths to keep in step | Every future write in universe or nature must also bump `revision` and write a snapshot, or the read model silently drifts. A repository test asserting that each mutating store method writes an outbox row is the cheap guard |

The last row is the real long-term cost and the one most likely to be forgotten.
It is the standard price of CQRS, and it is why the guard belongs in phase 1
rather than in a later hardening pass.

## Changes this forces in auth-and-admin-plan.md

| Section there | Change |
| --- | --- |
| §Read path table | Option B is no longer "Later, on a trigger"; it is this plan. Option A becomes the interim path for phases before analytics ships |
| §Partial results are a normal response, not an error | No longer applies to admin screens. Keep it for any product-side fan-out |
| §Where the fan-out lives | The gateway now composes nothing for admin. The extraction trigger it defines has fired, and this document is the extracted service |
| Phase 4 there | Aggregates move out of the domain services and into analytics |

Those edits should land in the same branch as this document so the two plans are
never inconsistent in history.

## Corrections found in implementation

Four things this document got wrong or left implicit, discovered by building
and then running the service against the real local stack.

**1. The NATS user needs `$JS.ACK.>`, not just `$JS.API.>`.** The ACL block in
§Phases is incomplete. Acknowledging a JetStream delivery publishes to a reply
subject under `$JS.ACK.>`, which `$JS.API.>` does not match. Without it the
consumer receives events, projects them, and then silently fails to ack — so
every message redelivers until `AckWait` expires, forever, with
`MaxDeliver(-1)`. It surfaces only as a `permissions violation` log line,
never as a startup failure.

This was **a pre-existing defect**, not a new one: `myunivokai_dna`,
`myunivokai_universe` and `myunivokai_nature` were all missing the same
permission, and dna-service's family-results consumer was demonstrably unable
to ack. All four users were corrected.

**It affects local development only.** Production authenticates to Synadia
Cloud with a single `nats.creds` account user shared by every service
(`agent-system/skills/production-deployment-guide.md`), with no per-user publish
allow-list, so nothing there was ever blocked and nothing there needs fixing.

That cuts both ways, and the plan's §Phases claim that the ACL "enforces the
read-model rule rather than trusting the code to honour it" is therefore
**true locally and not true in production**. If per-user permissions are ever
configured in Synadia — which is the only way to make that sentence true
everywhere — every consuming user needs `$JS.ACK.>` alongside `$JS.API.>`.

**2. `FamilyCompletedData.Snapshot` is a pointer, not an embedded value.**
§Design decision says "embed it additively". A pointer is strictly better: a
completed event published before this service existed decodes to `nil`, which
a reader can distinguish from a snapshot that genuinely is all zeroes. The
projection uses that distinction — a legacy completed event still projects its
*job* half and simply has no world half, so no pre-analytics job is invisible.

**3. `AddVariant` and `PublishWorld` had to become transactional.** §Phases
describes writing an outbox row "inside the existing transactions", but only
`CreateWorld` and `SelectVariant` had one. The other two were bare pool calls
and now open their own transaction, so the mutation and its event still commit
together.

**4. Publish is idempotent and must stay silent on a repeat.** Re-publishing
an already-published world returns the existing share unchanged. It therefore
bumps no revision and emits no event — a snapshot describing no state change
would show up in the read model as a real edit. `TestUnchangedMutationsEmitNothing`
in both family services pins this.

## Open decisions for the owner

1. **`nickname` in the analytics database** — **decided 2026-08-07: yes**, and
   it remains the only personal field.
2. **Snapshot events versus fine-grained events** — **decided: snapshot**, as
   recommended; shipped.
3. **Daily rollups now or later** — **decided: later**, as recommended. Not
   built. The escalation path if aggregate latency ever bites is a rollup
   table first, then a columnar store — not a document database, which is
   slower at exactly the `GROUP BY` / `percentile_cont` / `date_trunc` shape
   every query here has.
4. **When to build [service-wake-mechanism.md](../architecture/service-wake-mechanism.md)** —
   **decided: immediately after this plan**, and built on the same branch on
   2026-08-08. Confirmed production defect, deferred behind this plan, then
   taken up as the next piece of work. As predicted, analytics-service needed
   no special-casing: it is one name in `wake.Services` and one URL.

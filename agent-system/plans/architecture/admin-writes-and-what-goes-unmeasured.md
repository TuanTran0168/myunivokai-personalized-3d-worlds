# Admin writes, and what goes unmeasured

> **Document status:** Plan. Decided where it says decided; §11 lists what is
> not.
> **Written:** 2026-09-07, on branch `feat/repo/admin-and-telemetry-upgrades`.
> **Corrects:** §5.1 and §5.2 of
> [`admin-surface-and-family-service-duplication.md`](admin-surface-and-family-service-duplication.md),
> whose route counts were wrong — see §3.1. That document's *argument* stands;
> its arithmetic did not.

## 1. The one-paragraph version

The question was "what can be upgraded on the admin side, and on platform
telemetry and analytics". The repo already answers the admin half, in a place
nobody was reading: `permission_sync.go` declares **five permissions with no
route behind them**, each description naming the screen it is waiting for,
under a comment that says *"Building the routes is a feature, not a
correction."* That list is the admin backlog. It is granted to roles today, it
renders as checkboxes staff can tick, and **three of its five entries were
missing from this repo's own admin survey.** The telemetry half inverts: the
gateway has been recording share-page traffic in production **since
2026-09-04**, and no screen frames it as a business number — so the most
valuable analytics question here is answered by a query, not by
instrumentation. The one thing genuinely unmeasured is the browser, and the
code that would report it shipped yesterday and throws its answer away. Two of
the five reserved permissions turn out to be traps: `profile:read` and
`profile:reveal` cannot be built without breaking principle 10 or copying
`profiles.raw_input` across the analytics boundary, and the honest deliverable
for those two is the argument, not the route.

## 2. The question, and what research changed about it

The question as asked invites an inventory of screens. That is the wrong
instrument, because it measures what a person notices is missing rather than
what the platform has already committed to and left undone. Three sources
answer it better, and all three are in the repo:

1. **`reservedPermissions`** — the platform's own list of abilities it has
   promised and not delivered.
2. **`http_rollups` / `cache_rollups`** — what is already being measured, as
   opposed to what a screen currently shows.
3. **The absence of an inverse.** `publish` mints a share slug and nothing
   revokes one, for staff *or* for the person who published it.

Read that way, "upgrade the admin side" is mostly **finishing three reserved
slots**, and "upgrade telemetry/analytics" is mostly **naming a number that
already exists**, plus exactly one genuinely new measurement.

## 3. Verified against source, 2026-09-07

| Claim | Source | What it says |
| --- | --- | --- |
| Five permissions exist with no route | `services/auth-service/internal/services/permission_sync.go:50-56` | `reservedPermissions` — `world:unpublish`, `variant:read`, `job:retry`, `profile:read`, `profile:reveal` |
| Deleting them is not the way out | same file, comment above the list | `SyncPermissions` ends in `DELETE FROM permissions WHERE NOT (codename = ANY($1))`, so removing a codename removes it from production and every role holding it, on next boot, silently |
| The checkbox already lies | same comment | *"What is genuinely wrong is a checkbox in the Roles dialog that promises an ability nobody has"* — `RoleFormDialog` renders each description under its checkbox |
| Telemetry covers every route | `services/api-gateway/internal/handlers/router.go:68` | `middleware.Telemetry(collector)` is registered on the **root** router, above the product, identity and admin groups |
| …including the share page | `router.go:195` | `router.Get("/share/worlds/{shareSlug}", handler.GetShare)`, and the collector stores chi's **template**, never `request.URL.Path` (`telemetry/collector.go:130`) |
| It has been on since 2026-09-04 | `render.yaml:239` | `TELEMETRY_ENABLED` — *"ON since 2026-09-04"* |
| Share responses are cached at the gateway | `handlers/world_handler.go:293-299`, `rpc_transport.go:24` | `WriteCacheHit` returns before `Proxy`; namespace `share:v1` |
| `publish` has no inverse | whole-repo grep for `unpublish\|takedown` in `services/`, `contracts/` | Only prose, a permission codename, and `PermissionWorldUnpublish`. No route, no subject, no handler |
| A staff write need not be a new command | subject inventory, `contracts/go/*.go` | `myunivokai.queries.<family>.world.publish.v1` and `.world.delete.v1` are **request/reply**, not JetStream commands |
| A new query subject needs no wake change | `internal/wake/platform.go:233-247` | `ServiceForSubject` **derives** the service from `myunivokai.queries.<service>.…` rather than looking it up in a table |
| Ownership passes by accident today | `shared/family-platform/go/ownership/ownership.go`, `MutationPermitted` | `if ownerAccountID == nil { return nil }` — an unowned world is mutable by any caller, and that *"describes every world in production"* |
| Raw user input lives in dna-service | `services/dna-service/migrations/000001_init.sql:4-9` | `profiles.raw_input JSONB NOT NULL` |
| Admin reads may not reach it | `agent-system/plans/architecture/README.md:128` | Principle 10 — *"A staff page waits on the gateway, auth and analytics — never on universe, nature or dna"* |
| The analytics boundary is an allow list | `agent-system/plans/services/analytics-service-plan.md:223-227` | *"the snapshot struct above is the allow list. Nothing may be added to it without a matching line here"* |
| Widening it has a precedent | same, line 259-264 | `world_variants.seed` was added on 2026-09-03: *"a base32 identifier this platform generated… carries nothing a person typed"* |
| The snapshot has no share slug | `contracts/go/contracts_analytics.go`, `WorldSnapshot` | 19 fields, none of them the slug; `shareSlug` appears nowhere in `analytics-service` |
| Nothing measures the browser | grep for `beacon|sendBeacon|web-vitals` in `apps/myunivokai-personalization/src` | Two files match the word `telemetry`; neither sends anything |
| A public endpoint is already rate-limited | `services/api-gateway/internal/config/config.go:20-21`, `router.go:119` | Product surface: 2 requests/second, burst 20, per IP, in Redis |

### 3.1 Two numbers this repo published about itself were wrong

§5.1 of the earlier survey says the gateway *"exposes 24 routes"*; §5.2 says
*"of those 24 routes, **six mutate anything**"*. Counted from
`admin_router.go` on this branch:

| | Earlier survey | Counted |
| --- | --- | --- |
| Management routes | 24 | **26** |
| …of which read | (18) | **15** |
| …of which mutate | **6** | **11** |
| Auth routes | not counted | 4 |

The **shape** of that claim survives, and the shape was the argument: every
mutation touches exactly three nouns — accounts, roles, settings — and no
world, job, chart or audit row is writable by any route. But "six" was wrong
by nearly half, and a survey that miscounts its own subject should be corrected
before anything is built on top of it.

## 4. Finding 1 — the admin backlog is already written down, in the permission table

`permission_sync.go` splits its permissions in two. `enforcedPermissions` (10
codenames) are checked by a route. `reservedPermissions` are not:

| Codename | Its own description | Verdict (§9) |
| --- | --- | --- |
| `world:unpublish` | *"Not enforced yet — no route revokes a share slug. Reserved for that screen."* | **Build** — W5 |
| `job:retry` | *"Not enforced yet — no route retries a job. Reserved for that action."* | **Build** — W6 |
| `variant:read` | *"Not enforced yet — variants are read through world:read today. Reserved."* | **Build** — W7 |
| `profile:read` | *"Not enforced yet — no route reads profiles. Reserved for that screen."* | **Do not build** — §7 |
| `profile:reveal` | *"Not enforced yet — no route reveals masked input. Reserved, and audited when it exists."* | **Do not build** — §7 |

Three things make this list better evidence than any inventory of screens:

- **It is grantable today.** These are rows in `permissions`, synced on every
  auth-service boot, and `RoleFormDialog` renders them as checkboxes. A staff
  role can hold `world:unpublish` right now and gain nothing by it.
- **It cannot be quietly withdrawn.** `SyncPermissions` ends in
  `DELETE FROM permissions WHERE NOT (codename = ANY($1))`. A codename deleted
  from this file is deleted from production and from every role holding it, on
  the next boot, with no migration and no announcement.
- **The file already picked a side.** *"Building the routes is a feature, not a
  correction."*

**Three of the five were absent from §5 of the earlier survey**, which invented
its own A1–A5 list instead. That is the cost of surveying by inspection when
the subject keeps a list.

## 5. Finding 2 — share-page traffic is already measured, and nothing names it

The gateway's telemetry middleware sits on the **root** router, above every
group, and the collector keys buckets on chi's route *template*. So
`GET /share/worlds/{shareSlug}` has been a row in `http_rollups` since
`TELEMETRY_ENABLED` went on, and `share:v1` has been a row in `cache_rollups`
beside it. Both are already returned by shipped queries:
`TelemetryRouteSummary` carries `requestCount`, `errorRatePercent`, `p50`,
`p95`; `TelemetryCacheSummary` carries `hits`, `misses`, `hitRatePercent`.

So the following are answerable **today**, with no new instrumentation:

- How many share pages were served in a window, and how that trends
- Their latency distribution, and their error rate
- What fraction were served from Redis without waking a family service

And this is **not** answerable, for a reason worth stating precisely:

> **The two halves of the share funnel live in two services that never meet.**
> `analytics-service` knows how many worlds were published. `telemetry-service`
> knows how many share pages were served. They are separate databases, reached
> by separate subjects, and nothing joins them.

The admin app is the only place both numbers already exist in one process —
`ReliabilityPage` and the analytics overview are two fetches in the same
browser. That makes the join a **client-side** one, and it comes with a caveat
that must be on the screen rather than in this document: the two numbers are
sampled over independently-retained windows (telemetry keeps 90 days of
minute buckets; analytics keeps the projection), so their ratio is an
indicator, not an attribution. This is the same honesty the existing
`WakeSignals` field already practises — *"an approximation joined on time
proximity, not a per-request causal trace, and the admin UI must say so."*

**Per-world** view counts are a different question and §10 explains why this
plan refuses them.

## 6. Finding 3 — `publish` has no inverse, so "staff takedown" is the missing half of a user feature

`PublishWorld` mints a share slug, retrying on slug collision, and returns the
URL. Nothing anywhere revokes one. Grepping `services/` and `contracts/` for
`unpublish` and `takedown` returns prose, a permission codename, and no
mechanism.

Two consequences, and the second reframes the work:

1. **Staff cannot take down an abusive public page.** The share route is
   unauthenticated by design (*"the reads are open, and one of them must be"*),
   so the only remedy today is deleting the whole world.
2. **Neither can the person who published it.** They have the same single
   remedy. So this is not an admin feature with a staff justification; it is a
   **missing inverse**, and staff are simply the caller this branch builds
   first because that is the permission the platform already reserved.

### 6.1 It does not need a new command path

§5.4 of the earlier survey costed this as *"a new command subject, a consumer
in each family service, an audit row, and an admin UI that says queued rather
than done"*. The subject inventory says otherwise. Every world mutation in this
platform already travels as **request/reply**:

```txt
myunivokai.queries.universe.world.publish.v1
myunivokai.queries.universe.world.delete.v1
myunivokai.queries.universe.variant.select.v1
```

`commands.*` is used for `compose` and `claim` — work that takes seconds and
has nothing to wait for. A takedown has an answer, and the answer matters. So
`myunivokai.queries.<family>.world.unpublish.v1` is the shape, the gateway
proxies it exactly like `publish`, and `ServiceForSubject` **derives** the
target service from the subject string rather than consulting a table — so the
wake mechanism needs **no change at all**. The UI says *done*, or it says
`SERVICE_WAKING` and the caller retries, which is what every other world
mutation already does.

### 6.2 The one thing that must not be done the obvious way

`MutationPermitted` returns `nil` — permitted — when a world has no owner:

```go
if ownerAccountID == nil {
    return nil
}
```

Its own comment says that branch *"describes every world in production"*. So a
staff takedown implemented by calling the existing path with
`requestingAccountID: nil` **would work today, by accident, and would start
failing the moment ownership rolls out** — on exactly the owned worlds a
takedown is most likely to be about.

A staff takedown is therefore a **distinct authorization**, not an absent one:
the family service must be told the caller is staff and must record who. It is
also the first write in this platform where the gateway's admin edge and a
family service meet, which is why W5 carries an audit row and W6 and W7 do not
get to reuse its shortcut.

### 6.3 The detail that would make a takedown silently not work

The gateway drops the share cache by reading one field out of the mutation's
own response (`world_handler.go:372-385`):

```go
// A payload without it (or an unpublished world) yields "", which
// InvalidateShare treats as a no-op.
func shareSlugFromMutationPayload(payload []byte) string {
```

An unpublish leaves the world with **no** slug. So a response that reports the
world's *new* state returns `""`, `InvalidateShare` does nothing, and the page
that was just taken down **keeps being served from Redis** — for
`SHARE_CACHE_TTL`, which `render.yaml:123` sets to **60s** in production.

Sixty seconds is not a catastrophe, but the failure mode is worse than its
duration: the admin screen says *done* while the page is still up, so the
obvious staff reaction is to click again, and the second click also appears to
do nothing. **The unpublish response must therefore carry the slug it just
revoked**, not the world's resulting state — the one field where "return what
the record now says" is the wrong instinct.

## 7. Finding 4 — two of the five reserved permissions are traps

`profiles.raw_input JSONB NOT NULL` lives in **dna-service**. It is the
unprocessed thing a person typed, and it has never crossed into analytics: the
boundary carries `ProfileID` and nothing else about a profile.

A `profile:read` route therefore has exactly two implementations, and both
break a standing rule:

| Implementation | What it breaks |
| --- | --- |
| Admin route reaches dna-service | **Principle 10** — *"A staff page waits on the gateway, auth and analytics — never on universe, nature or dna, which the free tier may have put to sleep."* This is the reason `analytics-service` exists at all |
| `raw_input` crosses into the analytics boundary | Makes the analytics database a **second copy of the most sensitive data the platform holds**, for staff to browse. The boundary's own framing — *"the safest form of 'excluded from analytics' is never sent"* — was written for a field far less sensitive than this one |

`profile:reveal` is the same, worse: it exists specifically to unmask. Its
description already anticipates the cost — *"and audited when it exists"* — but
an audit row records who looked, not whether looking was permissible.

**So the deliverable for these two is the argument, not the route.** They are
the only items in this plan where building the thing the permission promises
would make the platform worse. §11 puts the choice to the owner in the two
forms that are actually available.

## 8. Finding 5 — the telemetry plan says the service was never built

`agent-system/plans/services/telemetry-service-plan.md` line 3:

> **Not yet built** — this is the plan to implement from, not a research
> document.

Against that: 31 Rust source files, `migrations/0001_init.sql` with five
tables, both Dockerfiles, `wake.ServiceTelemetry` wired in `platform.go`, two
gateway routes, three admin pages, and a live service in `render.yaml`. Every
phase 0–8 in that plan's own table has shipped; phase 9 is deferred by design.

Its §"Open decisions still needed from the owner" is in the same condition:

| Open decision | Already answered by | Value |
| --- | --- | --- |
| #1 Default `TELEMETRY_SINK` | `render.yaml:562` | `postgres` |
| #2 Retention window for `http_rollups` | `render.yaml:593-596` | 90 days, swept every 6h |
| #3 Admin navigation direction | — | **genuinely still open**, and deliberately deferred to phase 9 |

This is the `plans/` half of the rule in `CLAUDE.md`: a plan is the document
that wins when it disagrees with reality. Here reality has overtaken it, so the
plan is no longer prescribing anything — and a reader who trusts it will
conclude the platform has no telemetry.

## 9. The work, tiered by what crosses a boundary

Ordered by mechanism, not by appeal — the same discipline §5 of the earlier
survey used, applied to a corrected inventory.

### Tier 1 — corrections and reads. Nothing new crosses any boundary.

| ID | Work | Mechanism |
| --- | --- | --- |
| **W1** | Correct `telemetry-service-plan.md`'s status line; close its open decisions #1 and #2 against `render.yaml`; leave #3 open | Docs |
| **W2** | Correct §5.1/§5.2 route counts in the earlier survey; add the three reserved permissions it missed | Docs |
| **W3** | Verify telemetry data actually arrives (the earlier survey's A3, still `open` in its §14.5) | Verification, not construction |
| **W4** | **Share reach panel** — the published-worlds count beside the share-pages-served count, with the sampling caveat on the screen | Two existing queries, one new panel, zero instrumentation |

### Tier 2 — new admin writes, against permissions the platform already reserved.

| ID | Work | Mechanism |
| --- | --- | --- |
| **W5** | `world:unpublish` — revoke a share slug. New `queries.<family>.world.unpublish.v1` per family, staff-authorized distinctly from owner-authorized (§6.2), share cache invalidated, audit row, `world.changed` emitted | 3 family services + gateway + admin UI. **No wake change** (§6.1) |
| **W6** | `job:retry` — re-run a failed generation job. A write, so principle 10 does not forbid waking dna-service | dna-service + gateway + admin UI |
| **W7** | `variant:read` — list a world's variants in admin. Needs `variant_no`, `seed`, `is_selected` per variant across the boundary; `config` stays behind | Snapshot widening + boundary line + admin UI |

### Tier 3 — the one genuinely new measurement.

| ID | Work | Mechanism |
| --- | --- | --- |
| **W8** | **Client render telemetry** — what the browser actually resolved: quality tier, family, whether WebGL failed | A fourth bucket type on the **existing** rollup envelope (§9.1) |

### Tier 4 — designed, argued, not built.

| ID | Work | Why it stops here |
| --- | --- | --- |
| **W9** | `profile:read` | §7 — breaks principle 10 or the analytics boundary |
| **W10** | `profile:reveal` | §7, and it exists to unmask |
| **W11** | Per-world share view counts | §10 |

### 9.1 Why W8 fits the existing envelope instead of a new pipeline

The obvious design is a new events stream for client reports. The better one
reuses what is already load-bearing, because the client's answer is
**categorical and bounded**, not per-user:

- 3 quality tiers × 4 families × {rendered, webgl-failed} = **24 keys**,
  against `maximumTrackedRoutePatterns = 400` for HTTP. Cardinality is a
  non-problem.
- The gateway already runs a flush ticker, publishes to JetStream, and the
  Rust side already has inbox idempotency, a retention sweep, and a
  minute-bucket schema. `HttpRollupEnvelope` already carries three parallel
  bucket arrays — `Buckets`, `NATSBackendBuckets`, `CacheBuckets`. A fourth
  costs one contract field (Go **and** the hand-maintained Rust mirror, plus
  the shared fixture both languages decode), one table, one query section.
- **No identity is available to leak.** The payload is a tier and a family. It
  carries no world id, no account id, no session id, and no timing that could
  single anyone out. §15's rule is satisfied by construction rather than by a
  dropping step.

The transport is a `POST` on the product surface, which already carries a
per-IP limit of 2/second burst 20 in Redis, and a body limit. An
unauthenticated counter endpoint can be **inflated** by a determined caller —
it cannot be made to create keys, read anything, or identify anyone — and the
screen must label these numbers client-reported for that reason.

**And it is the evidence Sprint 07 is blocked on.** Six of six stories are
`Implemented` and none is `Verified`, because verification wanted real-device
evidence. `classifyDeviceQualityTier` computes precisely the classification
whose distribution is in question and discards it after the first frame;
`WebGLFailureBoundary` catches failures nobody can count. W8 turns a one-off
device test into a number that keeps arriving.

## 10. What must not be built

- **Per-world share view counts, by this route.** Counting per slug at the
  gateway is unbounded cardinality in a collector that caps route patterns at
  400 with an overflow bucket specifically to avoid that. Joining views to
  worlds in analytics needs `ShareSlug` in `WorldSnapshot` and a boundary
  line. Both are real changes; neither has been asked for; and the useful
  version of the question ("do published worlds get looked at") is answered by
  W4 without either. Recorded here so a future reader finds the reason rather
  than the gap — and so the answer is *not yet*, on evidence, rather than
  *no*.
- **`owner_account_id`, or anything derived from it, anywhere near this work.**
  §15 of the identity plan, enforced by a reflection test per family service.
  W4 counts share pages, not the people who opened them.
- **A staff takedown that reuses the owner path with a nil account.** §6.2.
- **Any client telemetry field that could single out a visitor** — no world id,
  no session id, no user agent string, no free-text.
- **`profiles.raw_input` in the analytics database.** §7.

## 11. Decisions for the owner

| # | Decision | Recommendation |
| --- | --- | --- |
| **G1** | `profile:read` / `profile:reveal`: **retire the two codenames**, or keep them and accept a documented exception to principle 10? | **Retire.** Keeping a grantable checkbox that promises staff access to raw user input is worse than the honest gap, and retiring is a one-line change in `permission_sync.go` — the deletion cost the file warns about is real but is exactly what is wanted here. This is the owner's call because the codenames were added deliberately |
| **G2** | W8 sends data from real visitors' browsers. Approve? | **Approve.** Identity-free by construction (§9.1), and it is the only route to Sprint 07's `Verified`. Flagged because it is instrumentation on real users, not because the payload is sensitive |
| **G3** | W7 widens the analytics allow list by three per-variant fields | **Approve** — the `world_variants.seed` precedent from 2026-09-03 covers exactly this data, and `config` stays behind |
| **G4** | Does W5's unpublish emit `world.changed`? | **Yes.** Unlike deletion (which is decision F5's whole problem), unpublish leaves the world in place, so the snapshot's `PublishedAt` must go back to null in the read model or the admin list will show a published world with no share page — the identity plan §10 problem, arriving by a second route |

W5 through W8 proceed under these recommendations; G1 is the only one that
blocks, and it blocks only W9/W10, which this plan already declines to build.

## 12. Sequencing

1. **W1, W2** — the corrections. They cost nothing and everything below reads
   the documents they fix.
2. **W3** — verify telemetry has data **before** W4 draws a chart from it. A
   panel fed by an empty table looks exactly like a broken panel.
3. **W4** — highest value per unit of cost in this plan: two shipped queries,
   one panel, no new data anywhere.
4. **W5** — the safety gap, and the reserved permission with the strongest
   claim.
5. **W7**, then **W6** — W7 is a read and cheaper; W6 wakes a service and is
   worth less, exactly as the earlier survey judged.
6. **W8** — largest, and the one that unblocks a sprint gate.

## 13. What this costs

| Item | Size | The part that will bite |
| --- | --- | --- |
| W1, W2 | Trivial | Nothing |
| W3 | Minutes | Production verification needs admin credentials or Render log access; local verification proves the pipeline, not the deployment |
| W4 | Small | The caveat. A ratio of two independently-windowed numbers is easy to read as an attribution, and the screen has to prevent that |
| W5 | Largest of Tier 2 | Three family services, and a **second** authorization path through `ownership` — the package that deliberately cannot express where a check runs. Plus §6.3: the response has to report the slug it revoked, or the taken-down page stays cached for 60s and the screen lies |
| W6 | Medium | A retry that re-runs AI work costs money and must respect the quota that already exists |
| W7 | Small | A boundary widening is a contract change in Go, a projection column, a migration, and a line in the allow list — four places, and the allow-list line is the one that gets forgotten |
| W8 | Largest overall | The Rust mirror and the shared fixture are hand-maintained; both languages decode the same file, so a field added on one side and not the other fails a test rather than drifting — which is the design working, but it is four files before any behaviour changes |

---

## 14. What executing it found — 2026-09-07

### 14.1 W3: the pipeline is verified against a real database. Production is not.

Run with the procedure in `services/telemetry-service/README.md` §Verifying the
whole pipeline locally, against the local stack, which was already up with
`TELEMETRY_ENABLED=true`. All four invariants that README names hold:

| Invariant | Result |
| --- | --- |
| `route_pattern` is chi's template, never the id | 58 distinct (pattern, method, status class) rows; not one contains a UUID |
| Unmatched URLs collapse to one row | a single `unmatched` row, 24 requests, 4xx |
| All three concerns arrive in one envelope | `nats_rollups` has 7 services; `cache_rollups` has all three namespaces, `share:v1` among them |
| One inbox row per flush | 3,592 rows spanning 2026-08-22 → 2026-09-07 |

So the SQL runs, the schema matches it, and two instances' counters accumulate
rather than overwrite. **A3 is closed for the pipeline and remains open for the
deployment**, which is not a distinction that can be closed from a developer
machine: it needs an admin login to production or Render log access, both
owner-held.

One gap was closable and was closed. `statements.rs` asserts on the **text** of
its SQL and CI provides no database service at all, so a column renamed in the
migration and not in the statements would pass every test and fail at runtime.
Cross-checking every identifier in the SQL against the migration: 74
identifiers, 66 resolve to a table, column or keyword directly, and all 8
remaining are output aliases (`hour_of_day`, `oldest_bucket_start`,
`histogram_1..8`), a SQL function (`array_agg`), a derived-table column
(`pair.position`) or words from assertion-message strings. **No drift.**

### 14.2 W4 could not be built from the shipped queries — and the statistic I first justified it with was my own contamination

`TelemetryRouteSummary` carried `requestCount` and `errorCount`, and
`errorCount` is the **5xx class alone** — 4xx is deliberately excluded from
every error rate on these screens, which is correct and means a route's 4xx
traffic appeared in **neither** field. So `requestCount` is not a count of
anybody having been shown anything, and `requestCount - errorCount` is not
either.

**The first version of this section, and of four source comments, said "72% of
share requests are 404s, so a naive count overstates by 3.6x". That number was
an artefact of my own testing and is withdrawn.** Querying the same table with
today excluded: **7 share requests in 16 days, all 7 of them 2xx.** Every
single 404 in that data was a probe I made myself, in this session, while
checking that the route appeared in the rollups at all. I then read my own
probes back as a finding about user behaviour.

The correction does not weaken the change, and it is worth being precise about
why. The justification is **structural, not statistical**: the share page is
the platform's only unauthenticated route reached by a URL a stranger types or
a crawler follows, so it is the one route where 404s arrive from outside — a
mistyped slug, an unpublished world, a deleted one, a bot. On any route that
receives them, `requestCount` overstates how many callers were served, and the
overstatement is invisible in the response until it happens.

What the local data actually supports is narrower and should be stated as such:
**the production miss rate is unmeasured, not low.** A developer stack sees no
public share traffic because nobody outside has the links. The only thing my
probes demonstrated is the mechanism, crudely — six mistyped slugs moved a
naive "pages served" count from 4 to 22 in the live response.

So §9's "zero instrumentation" estimate for W4 was wrong on cost too. It took a
contract field (`successCount`, in Go **and** the hand-maintained Rust mirror
**and** the admin mirror), one `FILTER` clause in `SELECT_ROUTES`, a decode, an
in-memory equivalent, and a mapping — plus two tests, one of which asserts that
`successCount` is *not* derivable from the other two counts, because that is
exactly the shortcut the next reader will try.

### 14.3 The three-copy defect this branch was about, in the admin app

`FAMILY_OPTIONS` was declared **verbatim in three page files** and
`FAMILY_CHART_CONFIG` held a fourth copy of the same labels. **Ocean shipped to
production in Sprint 6 and was missing from all four**, and from
`WorldFamily` itself, which read `"universe" | "nature"`.

The consequence was not a crash — the analytics database has no family `CHECK`
constraint, so ocean worlds project normally and appear in the admin tables.
The consequence was that they could not be *filtered for* on any of the three
screens with a family picker, and the type asserted they could not exist.

This is the same shape as the backend duplication the previous branch removed,
found in the app rather than in the services: nothing pointed at the other
three copies, so adding a family meant knowing to look. There is now one
`families.ts`, the chart config is derived from it, and the next family is one
entry. Three stale descriptions that enumerated "universe and nature" were
corrected to name no families at all — enumerating them is how they went stale.

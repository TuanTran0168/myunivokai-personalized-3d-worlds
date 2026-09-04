# The admin surface, and the duplication that decides its order

> **Document status:** Proposal, awaiting owner approval. Nothing here is built.
> **Last source review:** 2026-09-05, against `staging` at `a3154c8`
> **Answers:** "what is left to build on the admin side, or should the backend
> be refactored to be cleaner instead?"

> **Read §14 first.** Steps 1 and 2 of §9 were executed on 2026-09-05, and
> executing them proved two of this document's own claims wrong — including one
> in §7 that would have sent the next reader down a path that does not exist.
> §14 records what actually happened; the sections above it are the argument as
> it was written *before* the work.

> §4 is a production defect found while surveying for this document. It
> outranked everything else here, including the whole of §5 and §6, and it is
> now fixed.

---

## 1. The one-paragraph version

The admin app is more finished than it looks — thirteen pages, and every read
it needs already exists. What it cannot do is **act**: it can mutate accounts,
roles and settings, and nothing else, which is a deliberate consequence of
`analytics-service` being a read model rather than an oversight to fix. So
"more admin features" is mostly a question about **write paths into domain
services**, which is expensive, and only two cheap items are genuinely
outstanding. Meanwhile the three family services carry ~1,600 lines each of
platform code that is byte-identical or nearly so, and **18 of the 24 commits
that ever touched those files had to edit two or more services at once**. That
is not an aesthetic complaint; it is a measured tax with a 75% hit rate, and
§4's defect is what it looks like when the tax is paid in production instead of
in review. The recommended order is therefore: fix §4, extract only the layer
that needs no new abstraction (§7 Tier 0), then do the admin work — because two
of the three admin items would otherwise be written three times.

---

## 2. The question, split

The question arrived as an either/or — new admin features, *or* a backend
refactor. Answering it that way would be wrong, because the two are the same
decision seen from opposite ends:

- Every admin feature that reaches a family service has to be written **three
  times** today.
- The refactor has **no product value of its own**. Its entire value is the
  cost it removes from the next change.

So the refactor is not an alternative to the admin work. It is either the step
before it or a waste of a week, and which one it is depends on whether the
admin work actually touches the families. §5 says two of the three items do.

The one thing that is genuinely independent of both is §4, which is why it goes
first.

---

## 3. Verified against source, 2026-09-05

Every row was measured, not recalled. Method is stated where it matters.

| Claim | Source | Verdict |
| --- | --- | --- |
| Admin app has 13 dashboard pages | `apps/myunivokai-admin/src/app/(dashboard)/` | True |
| Admin can mutate only accounts, roles, settings | grep for `POST`/`PATCH`/`DELETE` in `apps/myunivokai-admin/src` — 3 feature modules plus auth | True |
| Admin worlds/jobs/fleet/rarity/telemetry/audit are read-only | `admin_router.go:100-124`, all `Get` | True |
| `WorldSnapshot` carries no owner and no deleted flag | `contracts/go/contracts_analytics.go:71-104` | True |
| `world_ownership.go` is byte-identical across three services | `diff` exits 0 for universe↔ocean and universe↔nature | True |
| It imports only `context` and `errors` | `services/universe-service/internal/repositories/world_ownership.go:3-6` | True |
| `postgres_store.go` is 509 lines and differs in 8 | literal `diff` universe↔ocean | True |
| Sharing is broken in all three families | §4 | **True — new** |
| Ocean has no `PUBLIC_WEB_URL` in production | live Render env, captured in `.env.render` | **True — new** |
| Identity Phases A, B and C are complete | `sprint-08-2026-09-02/user-stories.md`, 21 stories, all `Implemented` | True |
| No service imports another service | grep for `myunivokai/services/` across `services/` | True |
| A second shared Go module is an existing pattern | `contracts/go/go.mod` + a `replace` in all 7 service `go.mod` files | True |

---

## 4. The defect this survey found, which outranks the question that prompted it

**Every published world in every family returns a `shareURL` that 404s.** Two
independent bugs stack on the same line.

### 4.1 The path is missing a segment, in three identical copies

`services/{universe,nature,ocean}-service/internal/services/world_service.go:213`
— the same line, three times:

```go
ShareURL: strings.TrimRight(service.config.PublicWebURL, "/") + "/share/" + *world.ShareSlug
```

The route that exists is `/{family}/share/worlds/{slug}`. It is declared in one
place and the declaration is unambiguous —
`apps/myunivokai-personalization/src/lib/worldRoutes.ts`:

```ts
export function sharePagePath(shareSlug: string, family: WorldFamily): string {
  return `/${family}/share/worlds/${encodeURIComponent(shareSlug)}`;
}
```

and the three page folders match it exactly. `next.config.mjs` declares no
rewrites and no middleware touches `/share`, so nothing repairs the URL in
flight. The constructed link is missing `worlds/`.

### 4.2 Universe's default lost its prefix when the un-prefixed route was deleted

`worldRoutes.ts` records an owner decision: the old un-prefixed
`/share/worlds/{slug}` route "was removed outright — pre-existing share links
are not worth carrying", and therefore "each service's `PUBLIC_WEB_URL` must
carry its family prefix, or the shareUrl it prints will 404."

Nature and ocean carry theirs. Universe does not:

```
universe: get("PUBLIC_WEB_URL", "http://localhost:41300")          <- no prefix
nature:   get("PUBLIC_WEB_URL", "http://localhost:41300/nature")
ocean:    get("PUBLIC_WEB_URL", "http://localhost:41300/ocean")
```

The frontend document states the requirement. The backend default silently does
not meet it, and no test connects the two.

### 4.3 In production, ocean's share links point at localhost

`render.yaml` declares `PUBLIC_WEB_URL` with `sync: false` for all three
families, which means the value lives on the dashboard. The live environment,
read from the Render API, has it set for `myunivokai-nature` and
`myunivokai-universe` — and **absent for `myunivokai-ocean`**. An unset value
falls through to the compiled default, so every ocean world published in
production has been handed a share URL beginning `http://localhost:41300`.

### 4.4 Why nobody noticed

Two reasons, and both are worth recording because they are the general failure
mode, not this bug's private bad luck.

**A comment asserted the thing no test checked.** The nature share page says:
*"nature-service's PUBLIC_WEB_URL carries the /nature prefix, so the shareUrl it
prints lands exactly here."* The premise is true and the conclusion is false,
because the sentence never mentions the segment that is missing. A confident
comment is why a reader stops looking.

**The only correct spelling of the URL in the entire backend lives inside a
mock.** `services/api-gateway/internal/handlers/router_test.go:446` hard-codes
what a family service is supposed to have returned:

```go
"shareUrl": "http://localhost/universe/share/worlds/" + shareSlug,
```

The fixture's author knew the right shape. But it is a canned response the
gateway passes through, so it asserts nothing about the code that builds it.
**No family service has any test on `ShareURL` at all.**

### 4.5 The fix

Small, and deliberately not merged into anything else:

1. Replace the literal `"/share/"` with a named constant spelling
   `/share/worlds/` — the hard-coded path segment is a coding-style violation
   in its own right, in three files.
2. Give universe's default the `/universe` prefix its two siblings have.
3. Set `PUBLIC_WEB_URL` for `myunivokai-ocean` on the dashboard —
   `https://myunivokai.vercel.app/ocean`. This is the only step with an
   immediate production effect and it needs no deploy.
4. One test per family service asserting the built URL, because the reason this
   shipped is that the assertion existed only in a stub. The test should state
   the route shape, so that changing the route fails a backend test.

This supersedes the entries drafted as `DEFECT-SHARE-001` and
`DEFECT-SHARE-002` on the unmerged branch (§13), which described the path bug as
"one string" and the ocean bug as "one dashboard value". Both were understated:
the path bug affects all three families, not one, and the ocean value is not
merely wrong but missing.

---

## 5. The admin surface: what it can already do, and what it cannot

### 5.1 What exists

Thirteen pages — overview, worlds, world detail, jobs, fleet, content mix,
rarity, accounts, account detail, roles, audit, settings, telemetry
(overview / performance / reliability). Each is a one-line re-export over a
feature module; the pages are not stubs.

The gateway backs every one of them. `admin_router.go` exposes 24 routes across
accounts, roles, permissions, audit, settings, analytics, telemetry and wake
stats, each behind an explicit permission.

**So the honest answer to "what admin features are left" is: very few reads.**
The read surface is close to complete.

### 5.2 The asymmetry, which is a design decision and not a gap

Of those 24 routes, **six mutate anything**, and they touch exactly three
things: accounts, roles, settings. Worlds, jobs, fleet, content, rarity,
telemetry and audit are read-only.

This follows from two rules the platform already committed to, and neither
should be relaxed casually:

- **Principle 10 — an admin read never wakes a domain service.** That is the
  whole reason `analytics-service` exists as a CQRS read model.
- **§6.1 of the identity plan — no authorization decision from the read model.**

Together they mean an admin *write* against a world cannot be served the way
the reads are. It must be a command to the owning family service, which wakes
it, which makes it asynchronous, which makes it a different kind of feature
from every button the admin app has today.

That cost is the reason the tiers below are ordered by mechanism rather than by
appeal.

### 5.3 Tier 1 — reads, no new service contact, genuinely outstanding

**A1 — the deleted-world badge.** The identity plan already recorded this as a
known operational cost of a decision, in §10:

> staff will see a world in the admin list whose share page returns 404, with no
> marker explaining why. If that becomes confusing in practice the fix is one
> boolean into the snapshot and the projection — a badge, changing no aggregate
> and no chart.

`WorldSnapshot` confirms it: no deleted field. This is the cheapest real
improvement available — one boolean, one projection column, one line in the
data-boundary allow list in `analytics-service-plan.md`, one badge. It changes
no aggregate, so no chart moves and no historical number shifts.

One caveat that must be checked before starting, not after: **a deletion stages
no outbox row today** (`source-overview.md`, §Ownership and deletion — "a
deletion bumps no revision and stages no outbox row"). So the boolean has no
event to travel on. Either deletion starts emitting `world.changed`, or the
badge waits for the periodic rollup in A2. That is a real design question, and
it is the reason A1 is not simply "half a day".

**A2 — the ownership panel.** Identity-free counts only: worlds owned vs
anonymous, accounts holding at least one world, a worlds-per-account histogram.
This is Phase E's P2 and it needs the periodic rollup event, because the claim
deliberately publishes nothing and a test enforces that
(`contracts_world_claim_test.go`). See
[`phase-e-what-ownership-unlocks.md`](phase-e-what-ownership-unlocks.md).

**A3 — confirm telemetry actually arrives.** `TELEMETRY_ENABLED: "true"` is
committed in `render.yaml` (`8cb89a0`, merged). The three telemetry pages have
existed for weeks with nothing to show. The first task here is verification,
not construction, and it is finished the moment a route rollup appears.

### 5.4 Tier 2 — writes, which need a command path

**A4 — world takedown.** Public share pages are live and there is no staff way
to unpublish an abusive world. This needs a new command subject, a consumer in
each family service, an audit row, and an admin UI that says *queued* rather
than *done* — because the family service may be asleep when the button is
pressed.

**A5 — job retry.** Same shape, same cost, lower value: a failed job can
already be diagnosed from the jobs page, and re-running it is currently a
support action.

Both are three-service changes. Both are the reason §7 comes before them.

### 5.5 Tier 3 — must not be built

**"Who owns this world", shown in admin.** §15 of the identity plan forbids it
in the strongest terms available:

> **No `owner_account_id` in `myunivokai_analytics`.** Staff have no business
> reading who owns what.

It is enforced by a reflection test in each family service, not by a sentence,
and the plan's own correction records that the field was deliberately *never
added* to the snapshot because "never sent is a stronger guarantee than dropped
on arrival". This is written here so that a future reader who thinks the admin
world list looks incomplete finds the reason rather than the gap.

---

## 6. The duplication, measured

### 6.1 The shape

Each family service holds ~1,600 lines of platform code — store, ownership,
inbox/outbox, NATS runtime, handlers, config, pool, migrations — and ~1,600 to
~4,800 lines of genuinely family-specific code (universe's sky/mood/diversity
profiles; nature's forest builder; ocean's depth curve, water optics and scene
profile).

The platform half, after normalising only the family's name:

| File | Lines (universe) | Differing lines vs nature | vs ocean |
| --- | --- | --- | --- |
| `repositories/world_ownership.go` | 114 | **0** | **0** |
| `repositories/memory_store.go` | 336 | 0 | 0 |
| `db/migrations.go` | 21 | 0 | 0 |
| `db/pool.go` | 31 | 0 | 0 |
| `config/config.go` | 156 | 2 | 2 |
| `repositories/store.go` | 58 | 3 | 3 |
| `handlers/nats_handler.go` | 267 | 4 | 4 |
| `repositories/postgres_store.go` | 509 | 6 | 6 |
| `messaging/runtime.go` | 343 | 6 | 2 |

`world_ownership.go` is not "nearly identical". `diff` exits 0 against both
siblings, with no normalisation at all.

### 6.2 The tax, counted rather than asserted

Over the last 300 commits touching these paths, 24 commits actually modified
one of these files. Of those 24:

- **18 had to edit two or more family services in the same commit**
- **9 had to edit all three**

A 75% fan-out rate. And the most recent instance is this repo's own history:
`fix/be/world-read-authorization` changed 12 files to make one authorization
change — the same repository, the same service, the same test, three times.

§4 is the same tax paid the other way. One wrong line, copied into three
services, wrong in production in all three.

---

## 7. What can move, tiered by dependency rather than by wish

This is the part where a refactor usually goes wrong: the whole layer gets
extracted at once, an abstraction is invented to paper over the differences,
and the result is harder to read than three copies. So the tiers below are cut
by **what each file imports**, which is a fact, not a judgement.

### Tier 0 — no service-local imports. Moves as-is.

| File | Imports | Lines ×3 |
| --- | --- | --- |
| `repositories/world_ownership.go` | `context`, `errors` | 342 → 114 |
| `db/migrations.go` | `database/sql`, pgx stdlib, goose | 63 → 21 |
| `config/config.go` | `errors`, `os`, `strconv`, `strings`, `time`, godotenv | 468 → 156 |

**873 lines collapse to 291 and no abstraction is invented.** `config.go`
differs in exactly one line — the `PUBLIC_WEB_URL` default from §4 — which
becomes a parameter, not a new concept. `db/pool.go` (31 lines, 0 diff) follows
for free, since its only service-local import is the config that Tier 0 already
moved.

This tier is worth doing on its own merits and is a complete, shippable change.

### Tier 1 — depends on `internal/models`, which genuinely differs

`store.go`, `memory_store.go`, `postgres_store.go`, `nats_handler.go`,
`runtime.go`. Together ~1,300 lines per service.

`postgres_store.go`'s eight differing lines say precisely what is needed:

1. the `internal/models` import path
2. `completedOutboxMessageSuffix` — `":universe-completed"` vs `":ocean-completed"`
3. `contracts.ComposeUniverseCommandSubject` vs `ComposeOceanCommandSubject`
4. `contracts.WorldFamilyUniverse` vs `WorldFamilyOcean`
5. `contracts.UniverseCompletedEventSubject` vs `OceanCompletedEventSubject`
6. `world.PersonalityDNA` vs `world.OceanDNA` — three occurrences

Items 2–5 are one **family descriptor struct**: four values, no cleverness.
Item 6 is the real decision — the same field carries a different type in each
family's `models.World`, and unifying it means either Go generics with a
constraint, or an interface method, or holding the DNA as `json.RawMessage` in
the shared layer.

**That decision must not be made in the same change as Tier 0.** It is exactly
the kind of abstraction that is easy to invent and hard to remove, and there is
no reason to couple it to a move that needs no abstraction at all.

### Tier 2 — does not move

Universe's `diversity/mood/sky_scene_profile.go` and `world_config_builder.go`;
nature's `forest_config_builder.go` and `forest_scene_profile.go`; ocean's
`ocean_config_builder.go`, `ocean_scene_profile.go`, `depth_curve.go` and
`ocean_water_optics.go`. Roughly 150 KB of deliberately different code. It is
different because the families are different, and any scheme that unifies it is
the failure mode, not the goal.

---

## 8. The mechanism already exists

No new build concept is required. `contracts/go` is a separate Go module that
every service consumes through a `replace` directive:

```
require github.com/myunivokai/myunivokai/contracts/go v0.0.0
replace github.com/myunivokai/myunivokai/contracts/go => ../../contracts/go
```

A second shared module is that same pattern used twice, not a new pattern. And
the boundary it must not break is already intact: **no service imports another
service** — verified by grep across all of `services/`.

The one open naming question is where it lives. `contracts/go` holds the wire
shapes; this would hold behaviour, so it does not belong inside it. A sibling
directory is the smaller step.

---

## 9. Sequencing — the recommendation

1. **Fix §4.** Three lines, one dashboard value, three tests. It is a live
   production defect on the exact feature ownership was built to make
   worthwhile, and it depends on nothing else here.
2. **Tier 0 of the extraction.** 873 lines to 291, no abstraction invented,
   `world_ownership.go` stops existing in triplicate. Ship it and stop.
3. **A3** — confirm telemetry data is arriving. Minutes, not days.
4. **A1** — the deleted-world badge, once §5.3's outbox question is answered.
5. **Tier 1**, or **A2/A4**, whichever the owner values more — but if the
   answer is A2 or A4, Tier 1 comes first, because both are three-service
   changes and paying the 75% tax knowingly is worse than paying it by
   accident.

The order is deliberate about one thing: **step 2 is placed before the admin
work rather than after it.** A refactor with no product value is easy to
postpone forever, and every deferral is paid at 75% on the next family change.
Doing it while only Tier 0 is in scope is what keeps it from becoming a project.

---

## 10. What must not happen

- **No `owner_account_id` reaching `myunivokai_analytics`**, in any form, for
  any admin feature in §5. The rule is §15 of the identity plan and it is
  enforced by tests in three services.
- **No admin read that wakes a domain service.** Principle 10. If an admin
  feature needs live domain data, it is a command with a queued response, not
  a query.
- **No unified scene builder.** §7 Tier 2 does not move.
- **No abstraction introduced in Tier 0.** If a shared file needs an interface
  to move, it is Tier 1 and belongs in a different change.
- **No hard-coded share path.** The literal `"/share/"` in §4 is the defect and
  a named constant is the fix; replacing it with a different literal in a new
  location is not.
- **No "one big refactor branch."** Tier 0 and Tier 1 are separate changes with
  separate reviews, and either is allowed to ship without the other.

---

## 11. Decisions for the owner

| # | Question | Recommendation |
| --- | --- | --- |
| F1 | Fix §4 now, as its own branch? | **Yes.** It is live, it is small, and it is unrelated to everything else here. |
| F2 | Do Tier 0 of the extraction? | **Yes.** No abstraction is invented and it is the precondition for two of the three admin items. |
| F3 | Where does the shared module live? | A sibling of `contracts/go`, so behaviour is not filed under wire shapes. Name it in the change, not here. |
| F4 | Tier 1 — generics, interface, or raw JSON for the family DNA? | **Defer.** Decide it when Tier 0 has landed and the real seam is visible, not from a table. |
| F5 | A1's blocker — should deletion emit `world.changed`? | Open. Emitting it is the honest fix; the rollup is the cheaper one. This needs a real answer before A1 starts. |
| F6 | A4 world takedown — build it? | **Not yet.** It is the most expensive item here and there is no moderation incident driving it. |

---

## 12. What this costs

| Item | Size | Touches |
| --- | --- | --- |
| §4 the share fix | Small | 3 services, 1 dashboard value, 3 tests |
| Tier 0 extraction | Medium | 3 services, 1 new module, no behaviour change |
| A3 telemetry check | Trivial | Nothing — verification only |
| A1 deleted badge | Small, **if** F5 is answered | contracts, analytics, admin app |
| A2 ownership panel | Medium | 3 services, analytics, admin app |
| Tier 1 extraction | Large | 3 services, and one design decision |
| A4 takedown | Large | contracts, 3 services, gateway, admin app, audit |

---

## 13. Housekeeping found while surveying

Recorded rather than fixed, because none of it belongs in this document's
change.

- ~~`feat/docs/phase-e-what-ownership-unlocks` is not merged.~~ **Resolved
  2026-09-05.** Its document is now
  [`phase-e-what-ownership-unlocks.md`](phase-e-what-ownership-unlocks.md) on
  this branch, with a correction note recording that this document's §4
  (not that one's §7) is the one that actually fixed the share-URL defect. The
  branch's own code changes (to `render.yaml` and the wake package) were
  discarded rather than merged — they were already superseded by other work
  that landed in between.
- **`sprint-07`'s README says "Planned; scope approved, implementation
  absent"** while its own `user-stories.md` marks five of six stories
  `Implemented`. The README is wrong.
- **`knowledge/backend/source-overview.md` has a stale opening paragraph.** It
  says "six private NATS services" (there are seven), "three of the six compose
  worlds" (four processes do), and "Both use the same layers" heading three
  services. The body of that document is current — including a 2026-09-04
  correction — so this is the intro only.
- **Principle 9 and D19 in [`README.md`](README.md) are now false, and only the
  owner should retire them.** Principle 9 says "No placeholder auth for end
  users. Product authentication stays deferred"; D19 says "User auth remains out
  of scope". Phases A, B and C shipped, so both describe a world that no longer
  exists. They are **recorded decisions**, not descriptions, which is why this
  document flags them instead of editing them — a decision is retired by the
  person who took it. The index row for the identity plan was a different case
  and **was** corrected on 2026-09-05: it still read "Proposed 2026-09-02, no
  code yet" about 21 implemented stories, and an index that misreports status is
  simply wrong rather than superseded.
- **Sprints 04, 05, 06 and 08 can move `Implemented` → `Verified`**, on evidence
  already collected after the release.
- **`DEFECT-WAKE-001` needs re-triage.** Its "P1 rather than P0" caveat rested
  on nobody using the product, and the release removed that condition.
- Around 60 stale local branches.

---

## 14. What executing it found — 2026-09-05

§9's steps 1 and 2 were done on branch
`refactor/be/family-service-shared-platform`. Four things came out of it that
this document had wrong or did not know, recorded here rather than edited into
the sections above, because a plan that quietly agrees with its own outcome
teaches nobody anything.

### 14.1 §7 Tier 0 was wrong: `world_ownership.go` did not move as-is

The tier was built by reading each file's **imports**, and that is not the same
question as what a file **references**. `world_ownership.go` imports only
`context` and `errors` — but it uses `worldSnapshotQuerier` and `mapNotFound`,
two package-level identifiers declared in files that stayed behind. "Moves
as-is" was false.

So the file **split** instead of moving: the three predicates and two sentinel
errors went to `shared/family-platform/go/ownership`, and the two functions holding the
SQL stayed.

That turned out to be the better shape anyway, for a reason worth more than the
line count. **Where the check runs is as load-bearing as what it decides.**
`assertWorldMutable` and `assertWorldDeletable` take the world row `FOR UPDATE`
inside the mutation's own transaction, so a claim landing at the same moment
cannot change the answer between the check and the write it authorises. A
package of pure predicates cannot express that. Both files now say so out loud,
so that nobody later "finishes the job" and quietly turns a transactional check
into a separate round trip.

**The lesson generalises to the Tier 1 estimate above, which should be read as
optimistic for the same reason.** Import lists are a lower bound on coupling.

### 14.2 §4 was worse than measured: there was a fourth copy

The defect was described as two faults (the missing path segment, universe's
missing prefix) plus one missing dashboard value. There was a fourth:
`services/universe-service/docker-compose-local.yaml` also carried
`PUBLIC_WEB_URL` without the `/universe` prefix, so the local stack reproduced
the bug faithfully and nobody could have caught it by running the product
locally.

And the **cause** of the ocean gap was in this repo, not on the dashboard:
`agent-system/skills/production-deployment-guide.md` lists six services and
stops at analytics. **There has never been an Ocean section**, so no line ever
told an operator to set it. The runbook was wrong, and the operator was not.

That is why the fix was not "set the value": all three families now declare
`value:` in `render.yaml` instead of `sync: false`. The value is derivable from
the service it sits under, so there is nothing for a person to remember.

### 14.3 A new module is three changes outside the Go code, and none of them are optional

The plan discussed module *contents* and never mentioned what builds one. All
three would have broken production or the gate silently:

- **six Dockerfiles.** `Dockerfile.prod` and `Dockerfile.local` in each family
  service copy `contracts/go` explicitly. Without the same line for
  `shared/family-platform/go`, `go mod download` fails on the `replace` directive and
  every family image stops building.
- **CI.** This repo runs one job per module. A module without a job is a module
  without a gate, so `family-platform-checks` was added — otherwise the shared
  module's tests would run only on a developer's machine.
- **`docker-compose-local.yaml`**, covered in §14.2.

**Any future shared module pays these three costs too.** That is a real argument
against a second one, and it belongs next to the argument for the first.

### 14.4 What the numbers turned out to be

| Claim in this document | What executing it produced |
| --- | --- |
| Tier 0 is 873 lines → 291 | Held: 873 → 291, plus `db/pool.go` following config as predicted |
| `world_ownership.go` moves whole | **Wrong.** Split — see §14.1 |
| "no abstraction is invented" | Held. The only new signature is `config.Load(family)`, and it *removes* a divergence rather than adding a concept |
| §4 is three lines plus a dashboard value | **Understated.** Four copies, and a missing runbook section as the cause |
| No behaviour change | Held, and it is checkable: the three `share_url_test.go` files were written before the extraction and pass unchanged after it; every pre-existing ownership test still asserts through the store with only the sentinel's package qualifier changed |

### 14.5 What is now done, and what §9 still has open

- **§9 step 1 — done.** The share URL fix, with a test per family.
- **§9 step 2 — done.** Tier 0 extracted into `shared/family-platform/go`.
- **§9 step 3 — still open.** Confirming telemetry data arrives.
- **§9 step 4 — still open,** and still blocked on decision F5: deletion stages
  no outbox row, so the deleted-world badge has no event to travel on.
- **§9 step 5 — still open,** and unchanged: if the answer is A2 or A4, Tier 1
  comes first.

Decisions F1 and F2 were taken by the owner on 2026-09-05 by asking for the work.
F3 was resolved by execution: the module is `shared/family-platform/go`, a sibling of
`contracts/go`, and the rule that tells the two apart is written in its README.
F4, F5 and F6 remain open exactly as stated in §11.

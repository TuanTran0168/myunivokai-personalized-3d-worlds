# Phase E — what ownership unlocks

> **Document status:** Written 2026-09-04 as a proposal; brought onto
> `refactor/be/family-service-shared-platform` on 2026-09-05, corrected against
> what shipped in between. **Read the correction note before §7, not after —
> §7's two defects are FIXED, not open, and the fix went further than either
> row below says.**
> This is the plan [`end-user-identity-and-ownership.md` §13](end-user-identity-and-ownership.md#13-phases)
> promised and deliberately left empty: *"Phase E — product work that ownership
> unlocks. §14.5, in whatever order the owner picks."* It picks an order and
> argues for it.
>
> **Read §3 before anything else.** The idea that raised this document —
> *"owner in worlds means livelier statistics in analytics and telemetry"* —
> contains a fork that has to be split before a line is written, because one
> half of it is forbidden by
> [§15](end-user-identity-and-ownership.md#15-what-must-not-happen) and the
> other half is a product feature that has nothing to do with
> `analytics-service`. Building it as one thing is how a §15 violation gets
> written, reviewed and merged before anybody notices which half they were in.
>
> **§7 records two defects found while verifying this document against source.**
> Both are live in production right now, both are adjacent to the share-view
> idea, and neither was known before 2026-09-04. They are not Phase E work —
> they are why §7 exists.
>
> **Last source review:** 2026-09-04, against `staging` at `f9f7da4`. Reread on
> 2026-09-05 against `refactor/be/family-service-shared-platform` for the
> correction note before §7.

---

> ## Correction, added 2026-09-05 — read before §7
>
> **Both defects in §7 are fixed**, on this branch, before this document was
> brought onto it. The fix is bigger than either row describes, because
> executing it found what verifying it from a document could not:
>
> - **DEFECT-SHARE-001 was not "one string in three files".** There was a
>   fourth copy of the same bug in `universe-service/docker-compose-local.yaml`,
>   so the local stack reproduced it faithfully — nobody could have caught this
>   by running the product locally, only by reading the code, which is exactly
>   how this document found it.
> - **DEFECT-SHARE-002 was not "one dashboard value".** The reason ocean's
>   `PUBLIC_WEB_URL` was never set is that
>   `agent-system/skills/production-deployment-guide.md` has never had an Ocean
>   section — it lists six services and stops at analytics. No line ever told an
>   operator to set it. The fix was not filling in the value; it was moving all
>   three families from `sync: false` to a `value:` derived from the service, so
>   there is nothing left for a human to forget.
>
> See [`admin-surface-and-family-service-duplication.md` §4](admin-surface-and-family-service-duplication.md#4-the-defect-this-survey-found-which-outranks-the-question-that-prompted-it)
> for the full account, and its §14 for what executing the fix found that this
> document's own verification did not.
>
> **Two more claims below are now stale, and are left as written rather than
> edited, per this repo's own rule for a plan whose sections a later fact
> contradicts:**
>
> - §2's table says `TELEMETRY_ENABLED` is `"false"` in production. It has been
>   `"true"` since `8cb89a0`, merged 2026-09-05 (§4.1 below is describing a state
>   that no longer holds).
> - §7's file links point at `internal/config/config.go` in each family service.
>   That package no longer exists: `config.Load` moved to
>   `family-platform/go/config` on this same branch, and now takes the family as
>   a parameter rather than reading a per-service literal default — the fix
>   §7 asked for ("make the default fail rather than fall back to localhost") was
>   answered differently, by deriving the default from the family instead.
>
> Nothing else below is known to be stale. The fork in §3, the triage in §4-§6,
> and the sequencing in §9 were not touched by this work and stand as written.

---

## 1. The one-paragraph version

Ownership shipped in Sprint 08 and it changed what the platform is *able to
know*, not just who may write. Three things become possible that were not:
staff can finally see the funnel `land → create → keep → return` as numbers
instead of a hypothesis; an owner can be shown their own collection as a thing
with shape — how many, how rare, how often opened — which is the first product
surface in this system that is about the person rather than about one world;
and one identity can be rendered as all three families at once, which is the
product's original pitch and has never once been buildable, because until
Sprint 08 there was no *someone* to render. None of it needs a new service, a
new database, or a paid dependency. What it needs is one distinction held
firmly, and that distinction is §3.

---

## 2. What already exists, verified against source on 2026-09-04

Written first because three of Phase E's ideas are cheaper than
[§14.5](end-user-identity-and-ownership.md#145-the-ideas-triaged) says and one
is more expensive, and all four differences are facts about the working tree
rather than opinions.

| Fact | Where | What it means for Phase E |
| --- | --- | --- |
| `worlds.owner_account_id` + `worlds.anonymous_id`, partial-indexed, in all three families | [`000002_world_ownership.sql`](../../../services/ocean-service/migrations/000002_world_ownership.sql) | Every ownership question is already answerable **inside the owning service** with an index behind it. Nothing needs a schema change to be *counted* |
| `profiles.owner_account_id` in `dna-service` | [`000003_world_ownership.sql:10`](../../../services/dna-service/migrations/000003_world_ownership.sql#L10) | The triptych (§6.2) is a `WHERE` clause, not a new join |
| `WorldSnapshot` carries **no** ownership field, by decision | [`contracts_analytics.go:71`](../../../contracts/go/contracts_analytics.go#L71) | §15's corrected bullet: *"never sent is a stronger guarantee than dropped on arrival"*. §4.2 must not undo this |
| **The claim publishes no event, and a test enforces it** | [`world_claim_test.go:178`](../../../services/ocean-service/internal/repositories/world_claim_test.go#L178), [`postgres_store.go:358`](../../../services/ocean-service/internal/repositories/postgres_store.go#L358) | *"Revision drives `world.changed`, and a claim changes nothing a reader of that event could see."* So `analytics-service` **cannot currently learn that a claim happened at all.** This is the single hardest constraint in the document and §4.2 exists because of it |
| Rarity is **replayed from `VariantSeed`**, not stored | [`contracts_rarity.go:58`](../../../contracts/go/contracts_rarity.go#L58), [`postgres_queries.go:302`](../../../services/analytics-service/internal/repositories/postgres_queries.go#L302) | There is **no `rare_feature_rolls` table.** §14.5's row is imprecise, and the correction makes the feature *cheaper*: see §5.2 |
| Telemetry's key is `{route_pattern, method, status_class}` | [`rollup.rs:37`](../../../services/telemetry-service/src/domain/rollup.rs#L37) | A **pattern**, not an instance. Per-slug counting is not an extension of this schema, it is a different schema: see §4.3 |
| `world_shares` is `id, world_id, share_slug, created_at` | [`000001_init.sql:52`](../../../services/ocean-service/migrations/000001_init.sql#L52) | No `revoked_at`, no counter. Both §5.1 and §6.1 land here, in one migration |
| `account_profiles` already holds create-form defaults and one toggle | [`000004_account_profiles.sql`](../../../services/auth-service/migrations/000004_account_profiles.sql) | §14.5's *"preferences on the account"* row is **already mostly built** by decision 21. §6.4 is what is left of it, and it is small |
| Every `dna_versions` row is written with the constant `1` | [`postgres_store.go:18`](../../../services/dna-service/internal/repositories/postgres_store.go#L18) | Unchanged since §14.5 said so. The evolving DNA is still the largest idea here and still deliberately undecided (§6.3) |
| **`TELEMETRY_ENABLED` is `"false"` in production** | [`render.yaml:214`](../../../render.yaml#L214) | `telemetry-service` is deployed, its URL is set on the gateway, and it is **receiving nothing.** Every telemetry idea in this document is blocked on one dashboard value: see §4.1 |

---

## 3. The fork this idea contains, and why it must be split first

The request was one sentence: ownership means richer statistics in `analytics`
and `telemetry`, and new features in personalization. Read carefully it is
**two products that share a word**, and the word is "statistics".

**Product one — staff analytics.** `analytics-service` is a read model whose
contents are an allow list, and
[§15](end-user-identity-and-ownership.md#15-what-must-not-happen) opens with
*"No `owner_account_id` in `myunivokai_analytics`. Staff have no business
reading who owns what."* That rule is not negotiable in this document and
Phase E does not ask for an exception to it.

**Product two — the owner's own numbers.** *"You have 7 worlds, 2 published,
your rarest feature is a black hole, and your reef has been opened 34 times."*
This is a **product feature**. It is not staff analytics with a filter on it;
it is a different reader, a different authorization rule, and a different
database. It belongs in the service that owns the world.

The two are easy to confuse because both render as a chart. They are separated
by one question, and the answer decides which service builds it:

> **Does answering this require naming a person?**
> If yes, it is the owner's own number and it is computed where the owner
> column lives. If no, it may be a staff aggregate.

Applied to the ideas, the split is clean and it is not what a first reading
would guess:

| The question | Needs a person named? | Whose product | Where it is built |
| --- | --- | --- | --- |
| What share of anonymous worlds get claimed? | **No** — it is two counts | staff | §4.2, as a rollup |
| How many accounts hold more than one world? | **No** — a histogram of counts | staff | §4.2 |
| Which worlds does *this* account hold? | **Yes** | the owner | family services, on the owner read path |
| How often was *my* share opened? | **Yes** — the answer is addressed to one owner | the owner | §5.1 |
| How often was `/share/worlds/{slug}` requested overall? | No | staff | telemetry, already |

The fourth row is the trap, and it is worth stating plainly because
[§14.5](end-user-identity-and-ownership.md#145-the-ideas-triaged) gets it
wrong: *"View counts on a share — `telemetry-service` already counts requests
by route; a per-slug counter is a small extension."* It is not a small
extension of telemetry. §4.3 shows why, with the number.

---

## 4. Track P — the platform services

### 4.1 P1 — Turn telemetry on. It is switched off in production

**This is the whole of the first work item and it contains no code.**

[`render.yaml:214`](../../../render.yaml#L214) sets `TELEMETRY_ENABLED: "false"`
on the gateway. The file's own comment at
[line 469](../../../render.yaml#L469) names the two-step finish:

> *Then set `TELEMETRY_SERVICE_URL` on `myunivokai-gateway` and
> `TELEMETRY_ENABLED=true`, and redeploy the gateway.*

`TELEMETRY_SERVICE_URL` **is** set on the live service. `TELEMETRY_ENABLED` is
still `false`. So the step was half-done, and the half that was skipped is the
half that carries the data: Sprint 05 built a Rust service, a dual-sink switch
and an admin screen, deployed all three, and the screen has been reading an
empty database ever since.

The `false` is not a mistake — the comment above it explains it was deliberate,
so that envelopes would not accumulate on `MYUNIVOKAI_EVENTS` before a consumer
existed. **The consumer exists now.** The reason for the `false` has expired.

| | |
| --- | --- |
| Change | One value, `false` → `true`, on `myunivokai-gateway`, in both `render.yaml` and the dashboard |
| Cost | One rollup envelope per minute per gateway instance |
| Risk | The `render.yaml` literal must move in the same change, or the next blueprint sync reverts it. This is the same hazard `SERVICE_WAKE_TIMEOUT` demonstrated on 2026-09-04 |
| Blocks | Every other telemetry item in this document, and the honest verification of Sprint 05 |

**It also has to wait for one thing**, which is why it is not simply done
today: `TELEMETRY_ENABLED=true` on a gateway whose `main` deployment predates
Sprint 05's consumer would publish to a stream nothing drains. Do it **after**
the `staging` → `main` release, not before.

### 4.2 P2 — Staff analytics learns *that* ownership exists, never *who*

**The problem, stated exactly.** §14.2 already promised the claim rate is
answerable without identity, as *"two counts the family services already have
the columns for — worlds where `owner_account_id IS NOT NULL` over worlds
created in the same window"*, and added the mechanism: *"If it ever needs to be
a chart, it becomes a counter, not a projection field."* That sentence is the
design. What §14.2 did not know is that **there is no path for the counter to
travel**, and Sprint 08 closed the obvious one on purpose:

- The claim does not bump `revision`, so it publishes no `world.changed`
  ([`world_claim_test.go:178`](../../../services/ocean-service/internal/repositories/world_claim_test.go#L178)).
- `WorldSnapshot` has no ownership field, and §15 was *corrected* to say adding
  one would move personal data across a boundary for no reader at all.
- Principle 10 — *"Admin reads never wake a domain service"* — forbids the
  admin screen from querying `universe`, `nature` or `ocean` live.

So three doors are shut, and each was shut for a good reason. Any design that
opens one of them is wrong.

**The fourth door, which is already an idiom in this codebase.** Each family
service publishes a **periodic ownership rollup** — the same shape
`telemetry-service` already consumes: one envelope per interval, carrying
counts and no identifiers.

```txt
events.<family>.ownership.rollup.v1
  { bucketStart, family,
    worldsCreated, worldsOwned, worldsAnonymous,
    accountsHoldingWorlds, worldsPerAccountHistogram }
```

Why this is the right shape and not a compromise:

- **It cannot carry identity.** There is no field for one. The privacy
  guarantee is structural, exactly as §15 prefers it — *"enforced by a
  reflection test in each family service rather than by a sentence"*, and the
  same reflective ratchet already in place can assert it.
- **It respects principle 10.** Analytics consumes an event; it never asks a
  sleeping service anything.
- **It respects the claim's silence.** The claim stays eventless. The rollup
  observes the *column*, not the transition, so the test at
  `world_claim_test.go:178` stays green and untouched — which matters, because
  that test is the record of a decision, not an implementation detail.
- **`accountsHoldingWorlds` is a `COUNT(DISTINCT owner_account_id)`.** A
  distinct count is an aggregate over identity that discloses none, and the
  histogram is the same trick: *"three accounts hold 2 worlds each"* names
  nobody.

**What it buys, concretely.** The claim funnel, per family, per day. The one
metric §14.2 filed under *"Nowhere, by design"* becomes answerable **without
bending the design**, which is a better outcome than the trade §14.2 accepted.

**What it costs.** One consumer, one projection table, one timer per family
service, one contract, one admin chart. It is the largest item in Track P and
the only one that touches all three families.

**One warning, recorded because it is the way this goes wrong:** the histogram
must be bucketed (`1`, `2`, `3-5`, `6-10`, `11+`) and never a per-account list.
A histogram with a bucket width of one and a long tail is a re-identification
vector when the population is small, and this population is small.

### 4.3 P3 — Where §14.5 is wrong about share view counts, with the number

§14.5 rates *"View counts on a share"* a **cheap follow-on** through
`telemetry-service`. Verified against telemetry's actual schema, that is wrong,
and the correction matters because the cheap-looking version would quietly
consume the entire observability budget.

Telemetry's key is `{route_pattern, method, status_class}`
([`rollup.rs:37`](../../../services/telemetry-service/src/domain/rollup.rs#L37))
— a route **pattern**. `/share/worlds/{slug}` is *one* series today. The
measured budget, from
[`telemetry-architecture-research.md`](../../evolution/telemetry-architecture-research.md#the-number-that-was-missing-this-systems-actual-cardinality):

```txt
~50 route templates × 4 status classes ≈ 200 active series
      = 2% of Grafana Cloud's free tier (10,000 series)
```

Make the slug a label and the series count stops being a property of the code
and becomes a property of **how many worlds have ever been published**:

```txt
2,500 published worlds × 4 status classes = 10,000 series
      = 100% of the free tier, from one feature
```

2,500 published worlds is a *success* scenario, not a stress test. The feature
would therefore break the observability platform exactly when the product
starts working, and it would break it silently — a cardinality wall does not
error, it drops series.

**So the view count is not a telemetry metric. It is a domain fact**, and it
belongs on `world_shares` in the family service that owns the share (§5.1).
That is also the correct home for a second reason that has nothing to do with
cardinality: the number is *addressed to one owner*, so by §3's question it was
never a staff aggregate in the first place.

**What telemetry keeps:** the aggregate route. *"`/share/worlds/{slug}` served
4,102 requests, 3% of them 404"* is a real operational number, it is already
collected the moment P1 flips, and it needs no change at all.

---

## 5. Track O — the owner's own numbers

Product features. None of them touch `analytics-service`.

### 5.1 O1 — How many times my share was opened

One counter, in the family service, incremented where the share resolves.

- **Schema:** `world_shares.view_count BIGINT NOT NULL DEFAULT 0` and
  `last_viewed_at TIMESTAMPTZ`, in the same migration as §6.1's `revoked_at` —
  one migration per family, not two.
- **Write path:** the existing share-resolution query, which already locates the
  row by the unique `share_slug`. An `UPDATE … SET view_count = view_count + 1`
  on a row already found by unique index is not a new query plan.
- **Do not make it exact.** A share page is cached in Redis for
  `SHARE_CACHE_TTL`, so a cache hit never reaches the service and the count is
  *already* going to be an undercount. Two choices follow, and the second is
  the recommendation: either invalidate on view (which destroys the cache's
  entire purpose), or **count only cache misses and label the number honestly**
  in the UI — *"opened at least 34 times"*. The second is one word of copy
  and no architectural cost.
- **Read path:** the owner's own world payload. Never on `PublicWorld` — the
  friend who opened the link is owed no telemetry about the owner, and
  `PublicWorld` exists precisely to draw that line.

**Bot traffic is not filtered, and the UI must not imply it was.** A crawler
fetching a share page increments the counter. Filtering it properly needs a
user-agent policy nobody has written; *"opened at least N times"* survives the
imprecision, *"34 people saw your world"* does not.

### 5.2 O2 — Rarity badges, and why they are cheaper than §14.5 says

§14.5: *"Collection / rarity badges — `rare_feature_rolls` is already projected
in `analytics-service`; the mechanic is a read model away, but it is
admin-scoped today and **must not become the user-facing one**."*

The warning is right and the premise is wrong. **There is no
`rare_feature_rolls` table.** Rarity is *replayed from the selected variant's
seed* by
[`contracts_rarity.go`](../../../contracts/go/contracts_rarity.go#L58), which
`analytics-service` calls at query time
([`postgres_queries.go:302`](../../../services/analytics-service/internal/repositories/postgres_queries.go#L302)).

That changes the answer completely, and for the better:

- Rarity is a **pure function of the seed**, and the seed lives on the world in
  the family service.
- So the user-facing badge needs **no read model, no projection, and no
  contact with `analytics-service` at all.** §14.5's warning is discharged by
  construction rather than by discipline — there is nothing admin-scoped to
  accidentally reuse.
- `contracts/go` is already shared, and
  [`contracts_rarity_test.go:53`](../../../contracts/go/contracts_rarity_test.go#L53)
  (`TestRarityCatalogueMatchesTheRenderer`) already pins the Go catalogue to the
  frontend's, entry for entry. The invariant this feature needs is **already
  tested**.

**One decision the owner has to make**, and it is a product decision rather
than a technical one: a rarity badge tells a person their world is unusual, and
`RarityCatalogue` probabilities are **re-tunable**. If a probability changes,
does a badge already shown disappear? The safe answer is to store the badge set
at publish time; the honest answer is to display it live and accept that it
moves. Recommendation: **store it**, for the same reason the ocean's depth curve
is stored rather than recomputed — the repo's own rule is *"do not recompute a
stored derived value at render time"*, and a badge somebody screenshotted is
exactly the kind of value that must not silently change.

### 5.3 O3 — The collection page

The surface the first two land on, and the first page in this product about the
person rather than a world: how many worlds, across which families, how many
published, total opens, the rarest thing they have rolled.

**It depends on Phase C** (`/api/me/worlds`), which is scheduled but not built
— [`router.go:105`](../../../services/api-gateway/internal/handlers/router.go#L105)
mentions the route in a comment and does not register it. So O3 is not startable
until Phase C is, and it should be scoped as *the page Phase C's gallery grows
into* rather than as a second page competing with it.

---

## 6. Track F — features ownership unlocks

### 6.1 F1 — Revoke a share

§14.5 calls it a cheap follow-on. Verified: correct, and it shares a migration
with §5.1.

`world_shares` gains `revoked_at TIMESTAMPTZ`. Share resolution filters it, the
owner gets an endpoint, and — **the part that only fails in production** — the
Redis share cache is invalidated in the same operation. That last clause is not
a detail: §10 recorded exactly this failure mode for world deletion, *"a bug
that appears only in production, because a local run has a cold cache and a
single reader"*, and a revoke that leaves a warm cache entry is a share the
owner was told they had closed. **The world-delete invalidation already
written in Phase B is the pattern to copy, not a new problem to solve.**

### 6.2 F2 — The triptych: one identity, all three families

The product's original pitch, and the row §14.5 rates *"real project,
cheap-ish"*. Verified as **cheaper than that**: `profiles.owner_account_id`
exists, the DNA is already family-neutral by design, and `generation_jobs`
already joins profile → world → family for all three families — which is the
join §3.1 of the identity plan used to prove `library-service` was unnecessary.

So the triptych is: take one account's profile, generate the two families it
has not generated, show the three side by side. **A loop, not new science**, as
§14.5 says.

Two real costs, both worth naming before this gets scoped as easy:

1. **It multiplies AI spend by three per identity**, and the quota is per-day
   per-account. A triptych is either three days of quota or a deliberate
   exception, and that is a pricing decision, not an engineering one.
2. **Three WebGL contexts, or three sequential renders.** Decision 22 already
   paid one extra context for the profile page's backdrop; three at once on one
   page is a different question against a 60 fps floor that is the stated
   product bar. Recommendation: render them as **stills, generated once**, with
   one live scene at a time on selection. That also makes the triptych
   shareable as an image, which is the thing anybody would actually want to post.

### 6.3 F3 — DNA that evolves. Still the largest idea, still deliberately undecided

[§16's "Still open"](end-user-identity-and-ownership.md#still-open) lists
exactly two things deliberately undecided, and the first is *"what DNA version 2
means for worlds already rendered from version 1"* — with the reasoning that it
*"needs the first login to exist before it can be answered honestly."*

**The first login now exists.** So the blocking condition has cleared and the
question is answerable — but it is a **product question that must be answered
before any schema work**, and this document does not answer it. It states the
three candidate answers so the owner can pick:

| Answer | What a v1 world does when v2 arrives | Cost |
| --- | --- | --- |
| **Frozen** | Nothing. It stays a portrait of who you were, dated | Cheapest. `dna_snapshot` per world already makes this true today, with zero work |
| **Re-renderable on request** | The owner can regenerate it from v2, as a new world | One endpoint, one quota decision. Keeps both portraits |
| **Live** | The world re-renders itself against the newest DNA | Contradicts *"a saved world remains renderable even when DNA later gets a new version"* in the architecture README's product model. **Not recommended** |

The recommendation is **"frozen", plus "re-renderable on request"** — because
frozen is already the implemented behaviour, so the feature reduces to one
endpoint and the *emotional* value of the idea (*"see how you have changed"*)
is delivered by having two portraits to compare rather than by mutating one.

Everything downstream — binding one profile per account, `version_number` past
the constant `1` at
[`postgres_store.go:18`](../../../services/dna-service/internal/repositories/postgres_store.go#L18),
turning the claim into a **merge** of N anonymous profiles — is real work and
is exactly the complexity decision 6 refused to put in Sprint 08. It should be
its own plan, and it should not start until the table above has a chosen row.

### 6.4 F4 — Preferences on the account: mostly already built

§14.5's *"Preferences on the account (ambient sound, immersive mode) — cheap
follow-on, the storage is the only new part"* is now **substantially done** and
the triage row is stale: decision 21 built
[`account_profiles`](../../../services/auth-service/migrations/000004_account_profiles.sql),
which holds create-form defaults and the `autofill_create_form` toggle, and
decision 22 established the principle that *a saved preference is shown in the
thing it changes*.

What is left is two columns and their wiring — ambient audio on/off and volume,
immersive mode — both `localStorage` today. Small, and it should be scoped as
*extending an existing table* rather than as a feature.

**One rule carried forward from decision 22:** a preference added here must be
visible in the thing it changes. A volume setting on a page with no audio is
the defect that decision existed to prevent.

---

## 7. Two defects found while verifying this document

Neither is Phase E work. Both are live in production on 2026-09-04, both were
found by reading the share path that §5.1 and §6.1 land on, and both belong in
the backlog rather than in this plan.

### DEFECT-SHARE-001 — every `shareUrl` the backend returns is missing a path segment

All three family services build the published share URL as:

```go
strings.TrimRight(service.config.PublicWebURL, "/") + "/share/" + *world.ShareSlug
```

— [`world_service.go:213`](../../../services/ocean-service/internal/services/world_service.go#L213),
identical in `nature` and `universe`.

The frontend route is `/{family}/share/worlds/{slug}`
([`worldRoutes.ts`](../../../apps/myunivokai-personalization/src/lib/worldRoutes.ts),
`sharePagePath`). With production's `PUBLIC_WEB_URL` of
`https://myunivokai.vercel.app/nature`, the backend returns:

```txt
returned:  https://myunivokai.vercel.app/nature/share/<slug>
route is:  https://myunivokai.vercel.app/nature/share/worlds/<slug>
```

**The `worlds` segment is absent, so every `shareUrl` in a publish response is
a 404.** The un-prefixed legacy route was removed outright, and there is no
rewrite in `next.config.ts` or `middleware.ts` to absorb it.

**Severity is lower than it looks, and the reason is worth recording:** the
frontend never reads this field. `shareUrl` is returned by
[`api.ts:377`](../../../apps/myunivokai-personalization/src/lib/api.ts#L377)
and consumed by nothing — the app builds its own path with `sharePagePath`, and
`worldRoutes.test.ts` pins that. So the product's own Share panel works. What
is broken is **the API's answer** to anybody who is not this frontend, and the
copy in `worldRoutes.ts` — *"each service's `PUBLIC_WEB_URL` must therefore
carry its family prefix, or the `shareUrl` it prints will 404"* — describes a
guard that does not cover this case, because the prefix is correct and the URL
404s anyway.

Fix: one string, in three files, plus the test that should have caught it. It
has no test today, which is why it survived a rename that touched this exact
route.

### DEFECT-SHARE-002 — `ocean-service` has no `PUBLIC_WEB_URL` in production

`PUBLIC_WEB_URL` is `sync: false` in [`render.yaml`](../../../render.yaml#L318)
for all three families — Render never sets it, an operator does. It is set on
`myunivokai-nature` and `myunivokai-universe`. **It is absent on
`myunivokai-ocean`**, so that service falls back to its compiled default
([`config.go:59`](../../../services/ocean-service/internal/config/config.go#L59)):

```txt
http://localhost:41300/ocean
```

Every ocean world published in production has therefore been answered with a
`shareUrl` pointing at the operator's own laptop. Compounded with
DEFECT-SHARE-001, the ocean value is wrong in two independent ways.

Fix: one dashboard value, `https://myunivokai.vercel.app/ocean`. It is also an
argument for making the default *fail* rather than fall back to localhost when
`APP_ENV=production`, because a config default that silently works is a config
default that never gets set.

---

## 8. What must not happen

- **No `owner_account_id` in `myunivokai_analytics`**, and no ownership *id* on
  `WorldSnapshot`. §4.2's rollup carries counts, and the absence of an identity
  field is enforced by a test, not by review.
- **No per-slug, per-world or per-account label in telemetry.** §4.3. The
  cardinality wall does not error, it drops series.
- **No making the claim publish an event.** The test at
  `world_claim_test.go:178` is a decision. §4.2 observes the column instead.
- **No admin screen that queries a family service live.** Principle 10 —
  the free tier may have it asleep, and a staff page must not wait on that.
- **No view count on `PublicWorld`.** §5.1. The visitor who opened a link is
  not owed the owner's numbers, in either direction.
- **No revoke that skips the Redis share cache.** §6.1, and the same rule §10
  already wrote for world deletion.
- **No exact-sounding copy on an inexact number.** *"opened at least 34
  times"*, never *"34 people saw your world"* — the cache and the crawlers both
  make the second one false.
- **No unbucketed per-account histogram.** §4.2. A long tail on a small
  population re-identifies.
- **No DNA schema work before §6.3's table has a chosen row.**
- **No live-recomputed rarity badge.** §5.2, and the repo's standing rule
  against recomputing a stored derived value at render time.
- **No new service and no new paid dependency.** Every item here lands in a
  service that already exists, which is the same property that made the
  identity plan worth doing (§14.4). If an item appears to need one, it has
  been scoped wrongly.

---

## 9. Sequencing, and what this is not

**This is not a sprint and it must not become Sprint 09 by default.**
[Sprint 03 (City) starts 2026-09-09](../sprints/sprint-03-2026-09-09/README.md),
five days from this document's date, and it is the next approved scope. Phase E
is a **menu the owner picks from after City**, or a small slice taken alongside
it if the owner chooses to.

Three hard orderings, everything else is preference:

1. **The `staging` → `main` release comes first**, ahead of every item here.
   `staging` is 52 commits ahead of `main`, four sprints sit at *Implemented*
   because they were never deployed, and §4.1 is actively wrong to do before
   the release.
2. **P1 (§4.1) before any other telemetry item.** It is one value and it
   unblocks all of them, and it also converts Sprint 05 from *Implemented* to
   *Verified*, which is worth more than any single feature in this document.
3. **Phase C before O3 (§5.3).** `/api/me/worlds` does not exist yet.

If exactly one thing is taken from this document, take **P1** — it is a
dashboard value that turns on a service already deployed and paid for.

If a second, take **§5.1 + §6.1 as one migration** — view counts and share
revocation land in the same table, in the same change, in three services, and
together they make a published share into something the owner actually
controls.

**The cheapest real feature here is §5.2**, now that the premise is corrected:
rarity badges need no read model, no projection and no new table, because the
function and its cross-language test already exist.

---

## 10. Decisions the owner has to make

Recorded as open, because a plan that guesses these is a plan that gets
rewritten. Nothing below is blocking §4.1.

| # | Decision | Recommendation, and why |
| --- | --- | --- |
| E1 | Is the claim funnel worth one consumer, one table and one timer per family? | **Yes**, but only after City. It is the one metric the identity plan filed as unanswerable, and §4.2 answers it without bending §15 |
| E2 | Does a rarity badge freeze at publish time or track the catalogue? | **Freeze.** The repo's own rule against recomputing stored derived values, and a screenshotted badge must not change |
| E3 | Does a triptych cost three days of quota, or is it an exception? | **An exception with its own smaller limit.** Three days makes the feature unusable; unlimited makes it the cheapest way to spend the AI budget |
| E4 | Which row of §6.3's table is the DNA answer? | **Frozen + re-renderable.** Frozen is already the behaviour, so the feature is one endpoint |
| E5 | Is the share view count shown to the owner at all, or kept internal? | **Shown**, labelled *"at least"*. A number the owner cannot see is a column, not a feature |
| E6 | Should a `production` `APP_ENV` refuse to boot on a localhost config default? | **Yes** — DEFECT-SHARE-002 is exactly the failure it would have caught, and it went unnoticed across a whole family's deployment |

---

## 11. What this costs

| Item | New service | New DB | New dependency | Migrations | Verdict |
| --- | --- | --- | --- | --- | --- |
| P1 telemetry on | — | — | — | none | **One dashboard value** |
| P2 ownership rollup | — | — | — | 1 in analytics | Largest item; touches 3 families |
| P3 telemetry stays as is | — | — | — | none | No work — a correction, not a task |
| O1 view counts | — | — | — | 1 per family, shared with F1 | Small |
| O2 rarity badges | — | — | — | 1 per family (stored badges) | **Cheapest real feature** |
| O3 collection page | — | — | — | none | Blocked on Phase C |
| F1 revoke a share | — | — | — | shared with O1 | Small; the Redis clause is the risk |
| F2 triptych | — | — | — | none | Quota decision, not an engineering one |
| F3 evolving DNA | — | — | — | several | Its own plan. Not startable |
| F4 preferences | — | — | — | 1 in auth | Extends an existing table |

**No new paid infrastructure, for the same reason the identity plan had none:**
every service this needs is already deployed. That is the strongest fact in
this document and it is the reason Phase E can be taken in slices of one item
rather than as a sprint.

# Sprint 08 — End-user identity and world ownership

> **Starts:** 2026-09-02
> **Status:** **Phase A implemented** on
> `feat/fe-be/end-user-identity-phase-a` (one branch per phase, by the owner's
> grouping — the plan's one-story-per-branch task lines are superseded by it).
> **Phase B is all but done.** `S8-IDENTITY-007` … `010` are on
> `feat/be/end-user-identity-phase-b` (merged): a world has an owner, the owner
> travels on the commands and is enforced inside each mutation's own
> transaction, and an owner can delete a world whose caches drop before the
> response returns. `011` and `012` are on
> `feat/be/end-user-identity-phase-b-continued` — signing in turns every world
> a browser made anonymously into that account's, in one to three services
> rather than blindly in all of them; and nine policy numbers moved out of
> `.env` into a settings table an operator changes without a deploy, with the
> admin screen rendering the code-declared registry rather than a form.
> `013` and `014` (the quota and its one toast) and Phase C are committed scope
> and not started. **Read
> [user-stories.md](user-stories.md)'s Phase B corrections section** before any
> of them: twenty-one entries, and entry 8 first — a single struct literal in
> `dna-service` dropped the owner that `007` and `008` existed to establish, so
> both stories shipped inert with every test in the repository passing. Three
> more change what is left to build: the plan's `WorldSnapshot` field was
> deliberately not added, deletion is stricter than any story said, and neither
> a deletion nor a claim emits an event. Entries 13 to 21 are the settings
> story's, and 20 is the one that generalises: §9.3 asked for a comment to stop
> a later reader reintroducing a cold start on the create path, and a comment
> cannot — so the reader's SHAPE is asserted instead.
> The stories execute
> [`end-user-identity-and-ownership.md`](../../architecture/end-user-identity-and-ownership.md),
> whose twenty decisions are all taken.
> **Read [user-stories.md](user-stories.md)'s Phase A corrections section**
> before that phase's own stories: five of its claims turned out to be wrong,
> and one requirement — a signup response that hides whether an address is
> already registered — is not achievable before email exists.
> Phase A also gained **three stories after it was implemented**, all asked for
> by the owner and all on the same branch: `S8-IDENTITY-018` (the gallery shows
> the signed-in account's worlds rather than the browser's), `S8-IDENTITY-019`
> (an account page, and a create form that starts filled in) and
> `S8-IDENTITY-020` (a saved preference that changes the world rather than only
> the form). `019` spent this sprint's first migration, and
> [decision 21](../../architecture/end-user-identity-and-ownership.md#19-the-accounts-own-page-decision-21)
> is where it is argued; `020` spent nothing but is the one to read first, for
> correction 8 — a preference the profile page saved and the create page's
> canvas ignored.
> **Last source review:** 2026-09-03

## Sprint goal

Give the product its first end user. At the end of this sprint a person can
hold an account, a world can have an owner, an owner can delete one, the
anonymous worlds someone already made can be claimed into their new account,
and the gallery survives a cleared browser — which it does not today.

The AI spend also gains a ceiling for the first time, because the quota and
ownership are the same feature seen from two sides — and that ceiling is what
makes it safe to switch the AI provider on at all, which production has never
done.

Backlog epic:
[EPIC-S8-IDENTITY-001](../../backlog/engineering-backlog.md#epic-s8-identity-001--end-user-identity-and-world-ownership)

Sprint stories: [user-stories.md](user-stories.md)

Plan this sprint executes:
[end-user-identity-and-ownership.md](../../architecture/end-user-identity-and-ownership.md)
— **read its §16 first.** Twenty decisions were taken on 2026-09-02 and
several of them cut scope; §16 supersedes parts of §3.4, §5, §9, §10, §11 and
§17 in place, and the sprint is scoped to what is left rather than to what the
plan's earlier sections describe.

## Why this sprint is worth its calendar slot

Three losses that exist right now, in the order they cost us
([plan §14.1](../../architecture/end-user-identity-and-ownership.md#141-the-three-problems-login-solves-in-the-order-they-cost-us)):

1. **Every world is one cleared browser away from gone.** Ownership today is a
   `localStorage` key
   ([`savedWorlds.ts:3`](../../../../apps/myunivokai-personalization/src/lib/savedWorlds.ts)),
   so a private window or a new phone destroys a visitor's collection while the
   rows sit intact in Postgres.
2. **There is no ceiling behind the switch that turns the AI on.** Production
   runs `AI_PROVIDER: mock` ([`render.yaml`](../../../../render.yaml)), so
   today's AI spend is zero — the loss is not a bill running now, it is that
   `AI_PROVIDER: gemini` **cannot safely be typed** while the only per-caller
   control in the platform is a per-IP token bucket. The product's central
   feature is switched off, and the quota is what allows it to be switched on.
3. **Nothing can be sold and nothing can be personalised further**, because
   both need a durable identity to attach to.

And the reason it is cheap: **the identity half was already paid for by Sprint
4.** `accounts.kind` already admits `'end_user'`, `roles` and `permissions`
already carry `audience`, the access JWT already carries an audience claim, and
the admin edge already rejects a `web` token with a test pinning it. This
sprint adds **no service, no database and no third-party account** — the plan's
§3.1 removed the one service that would have. The entire schema addition is two
nullable columns per family plus one new table in an existing database.

## Scope

**Phase A — an account exists.**

- Turn on the `web` audience in `auth-service`: signup, login, refresh, logout,
  the 7-day access / 3-month refresh pair, a 12-character minimum with no
  composition rules, the Have I Been Pwned range check on signup only, and one
  new `register` audit action. **Zero migrations** — `system_settings` arrives
  in Phase B, not here, and identity itself needs no schema change at all.
  (Phase A did spend one migration in the end, for `S8-IDENTITY-019`'s account
  profiles; `system_settings` is Phase B's, as written. Both raises are
  recorded in `auth-service`'s own migration-count ratchet.)
- The gateway's `/api/auth` + `/api/me` route group as a **bearer-token** flow:
  a `RequireProductAccessToken` middleware mirroring `admin_auth.go`, its own
  third rate-limit bucket, per-email failure counters in Redis.
- The web app's auth pages, the session in **three first-party cookies the
  client writes itself**, and the app's **first Content-Security-Policy** —
  which decision 14 makes a security control rather than hygiene.
- A login button that tells the truth about a cold `auth-service`.
- The admin account list showing `kind = 'end_user'` rows, so a staff member
  can mark one inactive. The service side of that already works.
- Added after the fact, on the owner's word: an account's own gallery, its own
  profile page, a create form that opens already filled from it, and — the
  correction to that — a canvas that actually renders the family the profile
  prefers, on both pages.

**Phase B — worlds are owned.**

- Two nullable columns and two partial indexes in each of `universe`, `nature`,
  `ocean` and `dna-service`. **No backfill** (decision 16).
- Identity fields on the two commands, the ~3 NATS ACL lines, and write-path
  authorization inside the same transaction as each mutation. **The ACL lines
  turned out to be already there** for the commands that existed; the four the
  claim needed are the ones that were actually added, and the test that reads
  the config is now a table naming every command subject's one publisher and
  its one subscriber.
- The owner-only world delete as a flag, filtered server-side — and **its Redis
  cache invalidation as a separate story with its own test through the
  gateway**, because that is the half that only fails in production.
- The anonymous claim: gateway → `dna-service` → only the families that
  visitor actually used. **And the browser's own gallery shelf, without which
  the claim changes four databases and nothing a visitor can see.**
- **A `system_settings` mechanism in `auth-service`**, with **nine settings —
  `auth-service`'s own values only** (the two quota limits, the two new web
  token TTLs, the two lockout values, and three token TTLs), so a policy number
  is an audited admin change rather than the 106th line of `.env`. **The
  setting keys are dotted database rows** (`auth.token.web.access_ttl`) and
  `.env` keeps `UPPER_SNAKE_CASE` untouched — a dot is not a legal shell
  identifier, so the two namespaces cannot be confused. `.env` neither grows
  nor shrinks: the four new values get Go-constant defaults and no env var, the
  five migrated ones keep theirs as their default. The gateway
  reads the two quota limits from Redis on the hot path with a compiled-in
  default on a miss — **never** by asking `auth-service`, which sleeps. **No
  other service's config moves**: the owner scoped the other six out, and
  §9.3's audit records why that is the right call rather than a retreat.
- The daily quota counter, and the **degrade-to-mock** path rather than a
  `429`, plus the one toast that says so — driven by a **reason code**, never
  by a provider name, because production already runs on the mock provider and
  a provider-keyed message would announce a limit on an AI tier that is
  switched off.

**Phase C — the gallery is real.**

- `myunivokai.queries.dna.library.list.v1`, `GET /api/me/worlds`, and the
  gallery reading the server list with `localStorage` demoted to a cache and
  the anonymous path.

**Not a phase, but in this sprint's scope:** the rename of
`apps/myunivokai-web` to `apps/myunivokai-personalization` (decision 15), which
must land **before Phase A or after Phase C**, never during — it touches almost
every path in CI and none of the logic.

## Definition of Done

- [x] A person can sign up, log in, refresh and log out, and a staff member can
      mark that account inactive — after which the account's next request fails
      within the stated Redis `tokenVersion` window.
- [x] Every route under `/api/me` and `/api/auth` is proven to carry its
      middleware by an enumerating router test, in the shape
      `admin_router_test.go` already uses. **Plus one the plan did not ask
      for:** the four PUBLIC identity routes carry no auth middleware by
      design, so each is asserted to charge the identity rate-limit bucket —
      without it, a route registered in the wrong group passes every other
      assertion in the file.
- [x] **The audience separation is proven in both directions**: a `web` token
      is rejected by the admin edge (exists) and an `admin` token is rejected
      by the product edge (new). Either both, or the separation is not proven.
      Both are asserted across every registered route, not only against the
      middleware in isolation — and beneath both,
      `contracts.AudienceForAccountKind` makes the audience a function of
      `accounts.kind` rather than of the endpoint reached or a field in the
      request, so it cannot be asked for.
- [x] An `end_user` account cannot hold a permission row, enforced at the
      repository level with a test — `ErrRoleNotGrantableToAccountKind`, in
      both stores, with the memory store mirroring Postgres deliberately.
- [ ] A non-owner is rejected for every world mutation, table-driven so that a
      mutation added later without a check fails the build.
- [ ] An **unowned** world stays mutable by anyone holding its id — the
      pre-existing anonymous behaviour is not broken by the ownership check.
- [ ] Deleting a world removes it from the gallery, from `?ids=` and from its
      share slug **through the gateway**, verified by a test that goes through
      the gateway rather than the service.
- [ ] A replayed claim, and a second device's claim, each update zero rows.
- [ ] The 6th anonymous creation of a day is served by the mock provider and
      still produces a real world.
- [ ] **On a deployment configured with `AI_PROVIDER: mock` — which is what
      production runs today — no quota toast appears at all**, and the reason
      code is `mock_configured` rather than `quota_exhausted`. All four reason
      values are covered by a table-driven test, because three of them cannot
      be observed in production until the AI tier is switched on.
- [ ] A quota limit changed in the admin app takes effect on the next create
      with **no service restart**, is audited with its old and new value, and
      is rejected if outside its declared bounds.
      **The settings half is done** (`S8-IDENTITY-012`): the change is audited
      as `<key>: <old> -> <new>`, refused outside its declared bounds by the
      gateway and again by `auth-service`, and
      `TestASettingTakesEffectOnTheNextRequestWithoutARestart` proves the
      no-restart clause on a token lifetime. What is left is the CREATE half —
      nothing on the create path reads a quota yet, which is
      `S8-IDENTITY-013`.
- [x] **The platform serves correct traffic with an empty `system_settings`
      table and an empty Redis**, every setting resolving to its named default
      constant — and a world creation never contacts `auth-service` to learn a
      quota number.
      `TestAnEmptySettingsTableIsAWorkingPlatform` asserts both halves of the
      first clause, the screen and a real sign-up. The second is structural
      rather than tested-by-observation: `settings.Reader` holds one field, a
      one-method cache interface, so there is nothing in it to ask with —
      correction 20 explains why a behavioural test could not have carried
      that.
- [ ] `GET /api/me/worlds` returns no DNA, no raw input and no email — the same
      response-model test the share endpoint already has.
- [ ] No `owner_account_id` reaches `myunivokai_analytics`, checked against the
      data-boundary allow list in
      [`analytics-service-plan.md`](../../services/analytics-service-plan.md#data-boundary--what-crosses-into-analytics-and-what-never-does).
- [ ] A visitor sees their worlds on a device that has never seen them.
- [ ] `go test ./...`, `go vet ./...`, `npm run typecheck`, `npm run lint` and
      `npm run build` pass, and the three CI gates in
      [`ci-quality-gates.md`](../../../rules/ci-quality-gates.md) are green.

## Known accepted risks

Each of these is a consequence of a decision the owner took deliberately. They
are listed so the sprint ships with them visible rather than discovered.

1. **A forgotten password is a manual staff answer.** Decision 11 puts email
   last, so there is no reset flow in this sprint. Combined with the Have I Been
   Pwned check on signup (§5.1), the mitigation is preventative rather than
   corrective: a compromised account is a *lost* account until Phase D.
2. **There is no data-erasure path.** Decision 9 removed the account-deletion
   feature; "deleted" means a staff member marks the account inactive, and
   personal data stays in the database. Erasure is discharged by a manual
   runbook (§10), not a job.
3. **A stolen access token is a 7-day credential.** Decision 7. This is safe
   only because the gateway checks `tokenVersion` on every request, which makes
   revocation instant at any TTL — but revocation is account-wide, and there is
   no per-token deny list.
4. **Login is slow after a quiet period.** `auth-service` stays on the free
   tier (decision 3) and, because a 7-day access token means almost no refresh
   traffic, it is cold at nearly every login. The only mitigation in this
   sprint is a UI that says so honestly, which is why that is a story and not a
   nicety.
5. **Unclaimed anonymous worlds hold raw personal input with no owner who could
   ever ask for its erasure.** This is true in production **today** and is
   unchanged by this sprint; it is named here so it is a known state rather
   than a later discovery.
6. **Phase B touches six services at once** — the three families,
   `dna-service`, the gateway, and `auth-service` for the settings table. The
   risk is breadth, not rework, and it is mitigated structurally: both ownership
   columns are nullable and the contract fields are nil-safe pointers, so a
   family service deployed ahead of the gateway sees `nil` and behaves exactly
   as it does today — and the gateway's settings reader falls back to its
   compiled-in default, so it can ship before `auth-service` has the table.
   **There is no flag day** — see
   [plan §18](../../architecture/end-user-identity-and-ownership.md#18-how-much-of-this-is-demolition).
7. **A settings mechanism is a place for values to hide.** The invariant that
   prevents it — every setting keeps a named default in code, and the platform
   must run correctly with an empty table — is a rule, and rules erode. The
   guardrail is the empty-table test
   ([plan §12](../../architecture/end-user-identity-and-ownership.md#12-test-guardrails)),
   which is why it is a Definition-of-Done item and not a nice-to-have.

## Sequencing against Sprint 03 (City)

City is scheduled for 2026-09-09 and is disjoint from this sprint in services
and databases, so nothing here technically delays it. But there is one real
interaction worth stating rather than discovering:

**City is a fourth family, and a fourth family born after Phase B is born
owned.** If City ships first, it needs the same two columns, the same claim
consumer and the same ownership predicate retrofitted afterwards — the same
work done twice, in a service whose tests were written without it. If identity
lands first, City inherits the pattern from three services that already
demonstrate it, and its migration includes the columns from its first
migration.

That is a recommendation to keep City behind this sprint, not a decision — the
calendar is the owner's. It is recorded here because the cost only becomes
visible after the choice has been made.

## Out of scope

- **Phase D entirely** — `internal/mail`, email verification, password reset,
  Google OAuth, GitHub OAuth. Decision 12 put them last, and nothing in Phases
  A-C waits on a mail provider or a DKIM record.
- **Passkeys.** Removed from the plan outright by decision 18; a Phase E
  candidate. §5.4 is kept as the argument for *when*, not as scope.
- **A user-facing account-deletion feature.** Decision 9 — it does not exist
  and is not being built.
- **Paid plans and pricing.** Blocked on this sprint's quota existing, and on
  per-create cost being measured from `ai_generation_attempts` rather than read
  off a rate card ([plan §9.2](../../architecture/end-user-identity-and-ownership.md#92-what-a-world-costs-and-what-the-quota-is-really-capping)).
- **`library-service`.** Plan §3.1 showed `dna-service` already holds the
  profile → world → family link for all three families. It is not built until
  that section's trigger actually fires.
- **Any change to `analytics-service`.** No new projection field, no owner id,
  and deleted worlds keep counting in staff statistics (decision 4b).
- **Ownership transfer or gifting.** v1 ownership is write-once, which removes
  a whole race class. Transfer reopens it and needs its own plan.
- **A per-account profile with an evolving DNA.** Decision 6 keeps one profile
  per create, because a per-account profile turns the claim into a *merge* of N
  anonymous profiles — the exact complexity that must not share a sprint with
  the first login this product has ever had. Phase E.
- **Renaming `aud=web`.** Plan §17: it names the channel a token is for, not
  the app, and moving it costs a migration on two tables to buy nothing.

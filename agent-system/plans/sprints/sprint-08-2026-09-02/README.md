# Sprint 08 — End-user identity and world ownership

> **Starts:** 2026-09-02
> **Status:** Planned. The stories below are committed scope; they execute
> [`end-user-identity-and-ownership.md`](../../architecture/end-user-identity-and-ownership.md),
> whose nineteen decisions are all taken and which awaits the owner's approval.
> **Last source review:** 2026-09-02

## Sprint goal

Give the product its first end user. At the end of this sprint a person can
hold an account, a world can have an owner, an owner can delete one, the
anonymous worlds someone already made can be claimed into their new account,
and the gallery survives a cleared browser — which it does not today.

The AI bill also gains a ceiling for the first time, because the quota and
ownership are the same feature seen from two sides.

Backlog epic:
[EPIC-S8-IDENTITY-001](../../backlog/engineering-backlog.md#epic-s8-identity-001--end-user-identity-and-world-ownership)

Sprint stories: [user-stories.md](user-stories.md)

Plan this sprint executes:
[end-user-identity-and-ownership.md](../../architecture/end-user-identity-and-ownership.md)
— **read its §16 first.** Nineteen decisions were taken on 2026-09-02 and
several of them cut scope; §16 supersedes parts of §3.4, §5, §9, §10, §11 and
§17 in place, and the sprint is scoped to what is left rather than to what the
plan's earlier sections describe.

## Why this sprint is worth its calendar slot

Three losses that exist right now, in the order they cost us
([plan §14.1](../../architecture/end-user-identity-and-ownership.md#141-the-three-problems-login-solves-in-the-order-they-cost-us)):

1. **Every world is one cleared browser away from gone.** Ownership today is a
   `localStorage` key
   ([`savedWorlds.ts:3`](../../../../apps/myunivokai-web/src/lib/savedWorlds.ts)),
   so a private window or a new phone destroys a visitor's collection while the
   rows sit intact in Postgres.
2. **The AI bill has no ceiling.** No per-caller quota exists anywhere in the
   platform, and every create is a paid generation.
3. **Nothing can be sold and nothing can be personalised further**, because
   both need a durable identity to attach to.

And the reason it is cheap: **the identity half was already paid for by Sprint
4.** `accounts.kind` already admits `'end_user'`, `roles` and `permissions`
already carry `audience`, the access JWT already carries an audience claim, and
the admin edge already rejects a `web` token with a test pinning it. This
sprint adds **no service, no database and no third-party account** — the plan's
§3.1 removed the one service that would have.

## Scope

**Phase A — an account exists.**

- Turn on the `web` audience in `auth-service`: signup, login, refresh, logout,
  the 7-day access / 3-month refresh pair, a 12-character minimum with no
  composition rules, the Have I Been Pwned range check on signup only, and one
  new `register` audit action. **Zero migrations.**
- The gateway's `/api/auth` + `/api/me` route group as a **bearer-token** flow:
  a `RequireProductAccessToken` middleware mirroring `admin_auth.go`, its own
  third rate-limit bucket, per-email failure counters in Redis.
- The web app's auth pages, the session in **three first-party cookies the
  client writes itself**, and the app's **first Content-Security-Policy** —
  which decision 14 makes a security control rather than hygiene.
- A login button that tells the truth about a cold `auth-service`.
- The admin account list showing `kind = 'end_user'` rows, so a staff member
  can mark one inactive. The service side of that already works.

**Phase B — worlds are owned.**

- Two nullable columns and two partial indexes in each of `universe`, `nature`,
  `ocean` and `dna-service`. **No backfill** (decision 16).
- Identity fields on the two commands, the ~3 NATS ACL lines, and write-path
  authorization inside the same transaction as each mutation.
- The owner-only world delete as a flag, filtered server-side — and **its Redis
  cache invalidation as a separate story with its own test through the
  gateway**, because that is the half that only fails in production.
- The anonymous claim: gateway → `dna-service` → only the families that
  visitor actually used.
- The daily quota counter, and the **degrade-to-mock** path rather than a
  `429`, plus the one toast that says so.

**Phase C — the gallery is real.**

- `myunivokai.queries.dna.library.list.v1`, `GET /api/me/worlds`, and the
  gallery reading the server list with `localStorage` demoted to a cache and
  the anonymous path.

**Not a phase, but in this sprint's scope:** the rename of
`apps/myunivokai-web` to `apps/myunivokai-personalization` (decision 15), which
must land **before Phase A or after Phase C**, never during — it touches almost
every path in CI and none of the logic.

## Definition of Done

- [ ] A person can sign up, log in, refresh and log out, and a staff member can
      mark that account inactive — after which the account's next request fails
      within the stated Redis `tokenVersion` window.
- [ ] Every route under `/api/me` and `/api/auth` is proven to carry its
      middleware by an enumerating router test, in the shape
      `admin_router_test.go` already uses.
- [ ] **The audience separation is proven in both directions**: a `web` token
      is rejected by the admin edge (exists) and an `admin` token is rejected
      by the product edge (new). Either both, or the separation is not proven.
- [ ] An `end_user` account cannot hold a permission row, enforced at the
      repository level with a test.
- [ ] A non-owner is rejected for every world mutation, table-driven so that a
      mutation added later without a check fails the build.
- [ ] An **unowned** world stays mutable by anyone holding its id — the
      pre-existing anonymous behaviour is not broken by the ownership check.
- [ ] Deleting a world removes it from the gallery, from `?ids=` and from its
      share slug **through the gateway**, verified by a test that goes through
      the gateway rather than the service.
- [ ] A replayed claim, and a second device's claim, each update zero rows.
- [ ] The 6th anonymous creation of a day is served by the mock provider, still
      produces a real world, and says so once in a toast.
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
6. **Phase B touches five services at once.** The risk is breadth, not rework.
   It is mitigated structurally: both columns are nullable and the contract
   fields are nil-safe pointers, so a family service deployed ahead of the
   gateway sees `nil` and behaves exactly as it does today. **There is no flag
   day** — see [plan §18](../../architecture/end-user-identity-and-ownership.md#18-how-much-of-this-is-demolition).

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

# Sprint 08 user stories — end-user identity and world ownership

> **Document status:** Every story implemented. Phase A, B and C, plus the
> rename — twenty stories, of which one task remains open by design
> (`013`'s per-create cost, which needs `AI_PROVIDER` flipped first)
> **Sprint starts:** 2026-09-02
> **Last source review:** 2026-09-03
> **Read the Phase A corrections section before Phase A's own stories** — five
> of its claims turned out to be wrong, including one requirement that is not
> achievable before email exists.
> **Read the two corrections sections before changing any of this.**
> Phase B has twenty-four entries and Phase C has three. The one to read first
> is 8: a single struct literal in `dna-service` dropped the owner `007` and
> `008` had just gone to the trouble of establishing, so both stories shipped
> inert with every test passing — and entry 22 is its second copy, eleven
> lines away in the same file, which entry 8 did not find.
> Four more change what the code now is rather than what was built: the plan's
> `WorldSnapshot` field was not added, deletion is stricter than any story
> said, neither a deletion nor a claim emits an event, and `dna-service`
> therefore **cannot** exclude a deleted world from the account's list (25).
> Three record decisions no story states: who mints the anonymous id, what
> happens to a malformed one, and why a claim that can never apply must never
> be published.
> Of `012`'s nine (13 to 21), two matter before writing any settings code: 13,
> because the registry is in `contracts` rather than in `auth-service` and the
> reason is a number that must not exist twice, and 20, because the comment
> §9.3 asks for cannot protect the rule it describes and a shape test does.
> **And 26 before touching the gallery**: implementing §8's own merge sentence
> literally brings deleted worlds back for ever.

One epic, three phases, twenty branch-sized stories — seventeen planned, plus
`018`, `019` and `020`, which the owner added to Phase A after using it. The
phases are ordered by dependency and each ends in a shippable state:

- **Phase A** (`S8-IDENTITY-001` … `006`) — a person can hold an account.
  Nothing owns anything yet.
- **Phase B** (`007` … `014`) — a world has an owner, an owner can delete it,
  and the AI spend has a ceiling.
- **Phase C** (`015`, `016`) — a visitor sees their worlds on a device that has
  never seen them.
- **The rename** (`017`) is not a phase and must land before `001` or after
  `016`, never between them.

Inside Phase A, `001` and `002` are sequential; `004` needs `002`'s route
surface to exist. Inside Phase B, `007` gates everything else, and `008`
gates `009`, `011` and `013`. `012` gates `013`, because the quota's numbers
are settings rather than environment variables. `010` is deliberately separate
from `009` because it is the half that only fails in production, and `014` is
separate from `013` because its whole content is *when not to speak*.

**Scope note, so it is not rebuilt from the plan's earlier sections:** the plan
[`end-user-identity-and-ownership.md`](../../architecture/end-user-identity-and-ownership.md)
carries twenty decisions in §16 that supersede parts of §3.4, §5, §9, §10,
§11 and §17 in place. There is **no** account-deletion feature, **no** mail
provider, **no** password reset, **no** passkeys and **no** `library-service`
in this sprint. Read §16 before any story below.

## EPIC-S8-IDENTITY-001 — End-user identity and world ownership

Backlog epic:
[EPIC-S8-IDENTITY-001](../../backlog/engineering-backlog.md#epic-s8-identity-001--end-user-identity-and-world-ownership)

---

## Phase A — an account exists

### S8-IDENTITY-001 — Turn on the `web` audience in auth-service

Status: Implemented — `feat/fe-be/end-user-identity-phase-a`
Priority: P0

As a visitor,
I want to create an account and sign in with an email and a password,
so that the worlds I make stop being tied to one browser's storage.

Scenario: Signing up and signing in as an end user, not as staff

Given `auth-service` today issues tokens only for the `admin` audience
When a visitor signs up and then signs in through the product flow
Then the account is created with `kind = 'end_user'` and holds no role and no
permission row
And the access token carries `audience = "web"` and expires in **7 days**
And the refresh token is opaque, single-use, rotating within its family, and
expires in **3 months**
And a password shorter than 12 characters is rejected, while no composition
rule is imposed
And a password found in the Have I Been Pwned range API is rejected at signup
and at password change, but **never** blocks a login
And a signup for an email that already exists is indistinguishable in the
response from one that does not
And the signup, the login and every failure are written to `audit_events`.

Scenario: A disabled end-user account stops working

Given an `end_user` account with a valid, unexpired access token
When a staff member disables that account
Then the next request carrying that token is rejected within the
`tokenVersion` cache window, without waiting for the 7-day expiry.

Source evidence:
- agent-system/plans/architecture/end-user-identity-and-ownership.md — §4.4, §5, §5.1, §16 decisions 1, 7, 11
- services/auth-service/migrations/000001_init.sql — `kind`, `audience`, `token_version` already exist; this story adds no migration
- services/auth-service/internal/security/tokens.go — `IssueAccessToken(accountID, roles, audience, tokenVersion)`
- services/auth-service/internal/services/auth_service.go — rotation, reuse detection, lockout and audit to reuse unchanged
- contracts/go/contracts_auth.go — `AccountAudienceWeb`

Tasks:
- [x] `feat/be/web-audience-auth`: add the product signup/login/refresh/logout
      handlers for `audience = "web"`, reusing the existing Argon2id hasher,
      refresh rotation, family reuse detection and lockout paths without
      copying them.
- [x] Add the two web token lifetimes as **named Go constants only — no `.env`
      entry, no `render.yaml` key**. They are born as settings in
      `S8-IDENTITY-012` (`auth.token.web.access_ttl` = 7d,
      `auth.token.web.refresh_ttl` = 3mo), and a value that starts life as a
      setting needs a code default rather than an environment variable. Never
      literals either way.
- [x] Add the minimum-length rule and the Have I Been Pwned range check
      (k-anonymity: first 5 SHA-1 hex characters out, suffix matched locally)
      as a signup/change-password validator, with a test that no password
      leaves the process.
- [x] Add a `register` action to the audit constants, which is the whole of the
      registration metric (plan §14.2).
- [x] Add a test that a product signup can never produce an account holding a
      permission row.
- [x] Confirm in a test that **no migration** is needed: `kind`, `audience` and
      `token_version` are asserted present against the existing schema.

### S8-IDENTITY-002 — The gateway's product auth edge

Status: Implemented — `feat/fe-be/end-user-identity-phase-a`
Priority: P0

As a visitor,
I want to sign in by calling the same gateway the app already calls,
so that authentication needs no new domain, no cookie relay and no second
origin.

Scenario: Authentication is an ordinary API call

Given the gateway's product CORS configuration already allows the
`Authorization` header ([`router.go:82`](../../../../services/api-gateway/internal/handlers/router.go))
When `/api/auth/signup`, `/api/auth/login`, `/api/auth/refresh` and
`/api/auth/logout` are exercised
Then each returns its tokens in the response **body**, sets no `Set-Cookie`,
and needs no CORS change
And `/api/me/*` rejects a request with no token, an expired token, a revoked
token, or a token whose audience is not `web`
And the auth routes are rate-limited by their **own** bucket, tighter than the
product bucket and sharing no key with it
And repeated login failures for one email are throttled in Redis even when
they arrive from many different addresses.

Source evidence:
- agent-system/plans/architecture/end-user-identity-and-ownership.md — §4.1, §4.3, §5.5, §16 decision 2
- services/api-gateway/internal/middleware/admin_auth.go — the middleware this one mirrors, including the `revocation.IsRevoked` check
- services/api-gateway/internal/handlers/router.go — `productRateLimitRouteKey` / `adminRateLimitRouteKey` and the note that they must never be equal
- services/api-gateway/internal/handlers/admin_router.go — the route-group shape to follow

Tasks:
- [x] `feat/be/product-auth-edge`: add `middleware.RequireProductAccessToken`,
      mirroring `admin_auth.go` — local Ed25519 verification, then the Redis
      `tokenVersion` check, then the audience check against
      `AccountAudienceWeb`.
- [x] Add the `/api/auth` and `/api/me` route groups with a third
      `authRateLimitRouteKey = "auth"` bucket and its own named limits.
- [x] Add per-email Redis failure counters for login, keyed separately from the
      per-IP bucket.
- [x] Extend `contracts/openapi.yaml` with the auth and `/api/me` route
      surface, and keep the admin surface out of it.

### S8-IDENTITY-003 — Prove the two audiences cannot cross, in both directions

Status: Implemented — `feat/fe-be/end-user-identity-phase-a`
Priority: P0

As a service developer,
I want the staff/end-user separation to fail the build rather than fail in
production,
so that one `accounts` table serving two audiences stays a structural
separation and not a convention.

Scenario: Neither audience can act as the other

Given staff and end users share one `accounts` table by decision 1
When the audience guardrails run in CI
Then a `web` token is rejected by every `/api/admin` route
And an `admin` token is rejected by every `/api/me` route
And an account with `kind = 'end_user'` cannot be granted a permission row
And a route registered under `/api/me` or `/api/auth` without its middleware
fails the router test rather than shipping open.

Source evidence:
- agent-system/plans/architecture/end-user-identity-and-ownership.md — §12, §15
- services/api-gateway/internal/middleware/admin_auth_test.go — the existing test for one of the two directions
- services/api-gateway/internal/handlers/admin_router_test.go — the enumerating pattern to copy

Tasks:
- [x] `feat/be/identity-separation-guardrails`: add
      `product_router_test.go`, enumerating every `/api/me` and `/api/auth`
      route and asserting its middleware.
- [x] Add the missing direction: an `admin`-audience token rejected by the
      product edge.
- [x] Add the repository-level invariant test that an `end_user` account holds
      no permission row.
- [x] Add the bootstrap-command test asserting it still cannot create an
      `end_user`.

### S8-IDENTITY-004 — The web app's session, and its first CSP

Status: Implemented — `feat/fe-be/end-user-identity-phase-a`
Priority: P0

As a visitor,
I want to stay signed in across page loads and tabs,
so that signing in once is enough.

Scenario: The session survives a reload and expires on its own

Given the visitor signs in successfully
When the app stores the session
Then the access token, the refresh token and the anonymous id are held in
three first-party cookies **written by the client itself** — `path=/`,
`SameSite=Lax`, and `Secure` in production
And the app sends the access token in the `Authorization` header on every
authenticated call, rather than relying on the browser to attach anything
And an expired access token is refreshed once, transparently, and a failed
refresh signs the visitor out rather than looping
And the app serves a Content-Security-Policy that blocks inline and
third-party script.

Scenario: The CSP does not break the 3D scenes

Given every family renderer runs WebGL through React Three Fiber
When the CSP is enabled
Then all three family scenes still render, and the browser console reports no
CSP violation.

Source evidence:
- agent-system/plans/architecture/end-user-identity-and-ownership.md — §4.2, §4.5, §16 decisions 2 and 14
- services/api-gateway/internal/middleware/security_headers.go — the gateway sets headers for its own JSON; the web app sets none, which is why the CSP is in this story
- apps/myunivokai-personalization/src/lib/api.ts — the client that gains the header and the refresh-once behaviour

Tasks:
- [x] `feat/fe/product-session-and-csp`: add a session module that writes, reads
      and clears the three cookies, with every name, path and lifetime a named
      constant.
- [x] Add signup, login and account-menu screens using the app's existing glass
      surfaces rather than a new visual language.
- [x] Add single-flight transparent refresh to the API client so N concurrent
      401s cause one refresh, not N.
- [x] Add the Content-Security-Policy in `next.config`/middleware and verify
      all three renderers against it.
- [x] Record in the code, next to the cookie writer, that a JS-written cookie
      **cannot** be `httpOnly`, so the exposure equals `localStorage` and the
      CSP is the control — otherwise a later reader will assume protection that
      is not there.

### S8-IDENTITY-005 — Tell the truth about a cold sign-in

Status: Implemented — `feat/fe-be/end-user-identity-phase-a`
Priority: P0

As a visitor,
I want to be told that signing in is waking a server rather than failing,
so that a 20-60 second wait does not read as a broken product.

Scenario: The first sign-in after a quiet period

Given `auth-service` is on the free tier and is asleep
When the visitor submits the sign-in form
Then the form stays in a waiting state that names what is happening, rather
than spinning without explanation or timing out silently
And the request is retried across the wake window instead of failing on the
first `503`
And a genuine credential failure is still reported immediately and is not
disguised as a cold start.

Source evidence:
- agent-system/plans/architecture/end-user-identity-and-ownership.md — §11, §16 decisions 3 and 7 (a 7-day token means auth is cold at nearly every login)
- agent-system/plans/architecture/service-wake-mechanism.md — the `503 SERVICE_WAKING` contract and the frontend wait both frontends already implement

Tasks:
- [x] `feat/fe/auth-cold-start-honesty`: reuse the existing
      `SERVICE_WAKING` wait behaviour on the auth calls rather than writing a
      second one.
- [x] Distinguish a wake wait from a credential rejection in the UI, with a
      test for each.
- [x] Add `auth-service` to the wake platform adapters if it is absent, so the
      gateway can actually start it.

### S8-IDENTITY-006 — Staff can see and disable an end-user account

Status: Implemented — `feat/fe-be/end-user-identity-phase-a`
Priority: P1

As a staff member,
I want end-user accounts to appear in the admin account list,
so that "deleting" an account — which is marking it inactive — is something I
can actually do.

Scenario: An end-user account is administrable

Given `DisableAccount` already revokes every refresh token, bumps
`tokenVersion` and writes an audit row
When the admin account list is opened
Then accounts with `kind = 'end_user'` are listed and distinguishable from
staff accounts
And disabling one is possible from that screen
And no screen offers to grant a role or a permission to an `end_user` account.

Source evidence:
- agent-system/plans/architecture/end-user-identity-and-ownership.md — §10, §16 decision 9
- services/auth-service/internal/services/auth_service.go — `DisableAccount` already does the whole job
- apps/myunivokai-admin/src/lib/session.ts — `AccountKind = "staff" | "end_user"` is already in the frontend types

Tasks:
- [x] `feat/fe/admin-end-user-accounts`: show `kind` in the account list and
      allow filtering by it.
- [x] Ensure the role-assignment UI is unreachable for an `end_user` row,
      matching the server-side invariant from `S8-IDENTITY-003`.

### S8-IDENTITY-018 — The gallery shows my worlds, not this browser's

Status: Implemented — `feat/fe-be/end-user-identity-phase-a`
Priority: P0

Added to Phase A on 2026-09-02, by the owner, after signing up on a browser
that already held worlds.

As an account holder,
I want the gallery to show the worlds that are mine,
so that signing up does not appear to hand me somebody else's collection.

Scenario: An account created on a browser that already has worlds

Given a browser holding several worlds created without an account
When an account is created and the gallery is opened
Then none of those worlds is listed
And the gallery says how many are on this device but not part of the account
And signing out lists them again
And two accounts on one browser never see each other's worlds
And a world already on any shelf is not moved onto another by being opened,
because claiming a world by its id is what `S8-IDENTITY-011` refuses.

Source evidence:
- apps/myunivokai-personalization/src/lib/savedWorlds.ts — `SAVED_WORLD_IDENTIFIERS_STORAGE_KEY`, which was the entire notion of ownership before this
- agent-system/plans/architecture/end-user-identity-and-ownership.md — §8, §14.1, §18, and decision 9 on what deleting means
- agent-system/plans/sprints/sprint-08-2026-09-02/user-stories.md — `S8-IDENTITY-011` (claim by anonymous id) and `S8-IDENTITY-016` (the server-served list this is NOT)

Tasks:
- [x] Give every stored entry an `ownerKey`, reading a missing one as the
      anonymous shelf so no existing world is lost.
- [x] Filter every read to one owner, and answer `null` — show nothing — when
      the owner cannot be determined, rather than falling back.
- [x] Say on the page how many worlds belong to the other shelf, so an empty
      grid does not read as a loss.
- [x] Cover it with `savedWorlds.test.ts`, including both legacy storage
      shapes.

### S8-IDENTITY-019 — An account page, and a create form that starts filled in

Status: Implemented — `feat/fe-be/end-user-identity-phase-a`
Priority: P1

Added to Phase A on 2026-09-02, by the owner: "a profile page of its own, not
just Your Gallery — full name, gender and the fields from the 3D form, with a
button that fills them into it. The name fills by default."

As an account holder,
I want a page for who I am and how my worlds should start,
so that creating my second world does not mean typing everything again.

Scenario: A profile that is saveable before it is finished

Given a signed-in account that has never opened its profile
When the page is opened
Then it shows an empty profile rather than an error
And saving a name and one interest succeeds, though neither would be enough to
generate a world
And the display name is the SAME value the create form's Nickname field is
filled with, stored once in `accounts.name`
And a mood, style or family outside the contracts vocabulary is refused with
the field named
And the account id is taken from the access token, never from the request.

Scenario: The create form on the next visit

Given a saved profile with the autofill toggle on
When the create page is opened while signed in
Then the name is filled in whether or not the toggle is on
And the other fields are filled from the profile
And nothing is filled over a field already typed into
And the page says it was filled from the profile, with one action to empty it
for this world only.

Source evidence:
- contracts/go/contracts.go — `WorldInput`, `allowedMoods`, `allowedWorldStylesByFamily`, and `Validate`'s minimums, which are exactly what a draft must not enforce
- services/auth-service/migrations/000003_account_name.sql — `accounts.name`, already there, which is why the display name cost no column
- agent-system/plans/architecture/end-user-identity-and-ownership.md — §3.1 (why this is not a new service), §12 (the response-model rule), §15 (never authorize on a read model)

Tasks:
- [x] `account_profiles` in auth-service, keyed on the account, cascading, with
      NO nickname column — the nickname is `accounts.name`, projected.
- [x] `WorldInput.ValidateAsCreationDefaults`: every ceiling and vocabulary,
      not one minimum.
- [x] Two product-audience subjects and `GET`/`PATCH /api/me/profile`, with the
      account id read from the token's subject.
- [x] The page, the toggle, and the create form's autofill as two pure
      functions rather than an effect nobody can test.
- [x] Raise the migration-count guard in the same commit, per that test's own
      instruction.

---

### S8-IDENTITY-020 — A saved preference changes the world, not just the form

Status: Implemented — `feat/fe-be/end-user-identity-phase-a`
Priority: P1

Added to Phase A on 2026-09-03, by the owner, after using `S8-IDENTITY-019`:
"picking a preferred world family fills the picker when I go back out, but the
world does not change — choosing ocean still loads the universe. The settings
chosen in the form have to apply and load the right world on the demo, not just
be filled in. And the profile page should have a universe background like the
gallery."

As an account holder,
I want the world in front of me to be the world my profile makes,
so that a preference I saved is one I can see rather than one I have to trust.

Scenario: The create page opens on the family I chose

Given a saved profile whose preferred world family is the ocean
When the create page is opened while signed in
Then the picker shows Ocean AND the canvas renders an ocean
And it arrives through the same departure the picker itself plays, so the
incoming family's shader compile stays inside an animation that can afford it
And the profile's saved style is applied rather than replaced by the family's
neutral one
And "start from a blank form" carries the canvas back to the universe with it.

Scenario: The profile page shows what it is about to save

Given the profile page
When a preferred world family is chosen
Then the world behind the page becomes that family's
And that world is exactly what the create form would open with, built from the
fields as they stand on screen rather than as they were last saved
And it is shown whether or not the autofill toggle is on, because the toggle
governs the FORM and this is a preview of the setting.

Source evidence:
- apps/myunivokai-personalization/src/app/page.tsx — `renderedWorldFamily`, the second family state the canvas follows, and `worldChangeStages.ts` for why it deliberately lags the form
- apps/myunivokai-personalization/src/features/gallery/AmbientWorld.tsx — the gallery backdrop the account page now shares
- agent-system/knowledge/frontend/source-overview.md — the routes table this adds a world to

Tasks:
- [x] `showWorldFamilyOnCanvas` as the ONLY caller of `setWorldFamily`, so no
      path can move the form's family without moving the canvas.
- [x] The autofill reads the form's values from a ref at the moment the profile
      answers, not from the render that sent the request.
- [x] `buildPreviewSceneForFamily` and `buildCreateFormPreviewScene`: one place
      that decides which family's builder runs.
- [x] `AmbientBackdrop` extracted from the gallery; the account page renders the
      world its own fields describe.
- [x] The create form's field limits and `maxLength` values named once, in
      `worldFormOptions.ts`, rather than as bare numbers in two files.
- [x] The profile page mirrors the create form's minimums, and
      `profileWithCreateFormDefaults` makes them reachable on a first visit.
- [x] A `Toast` on save, whose lifetime rule is the tested part: a success
      leaves on its own, a failure waits to be read.

Scenario: The page holds itself to the rules the create form holds

Given the profile page
When the world defaults are edited
Then Core interests keeps a minimum of three, Traits a minimum of three and the
palette a minimum of one — the same floors the create form enforces
And a profile that has never been saved opens with those fields already holding
what the create form itself opens with, so the floor is met on the first visit
And the server keeps accepting less, because it bounds what may be STORED and a
row written before this rule still has to load.

Scenario: A save says so, and offers the way out

Given a profile being saved
When the save succeeds
Then a toast says so, and says which of the two things was agreed to — the
create form filled from this, or only the name, per the toggle's own state
And it carries a link back to the worlds
And it leaves on its own, while a FAILURE toast stays until it is dismissed
And a "Back to your worlds" button sits beside Save whether or not anything was
saved, because a page reached from the header menu has no back of its own.

No migration, no contract change, no new route: this story is entirely about
what the browser already had and was not showing.

---

## Phase A — corrected during execution, 2026-09-02

Written after the work, and read before the sections above. Five of Phase A's
own claims about the repository or about what was achievable turned out to be
wrong, and a sixth thing was wrong that no story had claimed at all — the
record is worth more than the tidy version.

### 1. `S8-IDENTITY-001` asks for a uniform signup response, and that is not achievable before email exists

The story's scenario says "a signup for an email that already exists is
indistinguishable in the response from one that does not". Every arrangement
was checked and none of them delivers it:

- **Return a session on a collision.** That requires verifying the submitted
  password against the existing account, so a wrong password answers
  differently from a brand-new address — the address is disclosed anyway, now
  with a password oracle attached to the disclosure.
- **Return success with no session**, the way a product with mail does ("check
  your inbox"). That needs an inbox. Decision 12 puts mail in Phase D.
- **Return the same error for both.** Then a new address cannot register.

Uniform signup responses require email verification; there is no arrangement of
a create-and-sign-in endpoint that hides the collision. `EMAIL_UNAVAILABLE` is
returned, the disclosure is accepted, and the argument is written into
`SignUpEndUser`'s doc comment rather than papered over. What bounds it: the
dedicated `auth` rate-limit bucket, the per-email counter, and an audit row per
attempt.

**LOGIN is uniform and stays uniform** — the decoy-hash path, plus the new
wrong-kind branch that pays the same Argon2id cost. That is the half of §5.1's
requirement that is both achievable and load-bearing, because login is what an
attacker probes to find live accounts.

### 2. The gateway's access-token public key was validated only when the admin surface was on

`ADMIN_ACCESS_PUBLIC_KEYS` was checked inside `if AdminRoutesEnabled`, whose
shipped default is `false`. The product edge is not gated by that flag, so a
deployment with admin routes off and no key would have mounted `/api/me`,
rejected every valid session with a 401, and said nothing about why. It is now
required unconditionally, with an error naming the variable at boot.

Not a new burden on local development: `.env.example` ships
`ADMIN_ROUTES_ENABLED=true`, so the admin block already demanded it. Two Go
fields lost their `Admin` prefix as a consequence (`AccessTokenPublicKeys`,
`TokenVersionCacheTTL`) while the environment variables kept their names — they
are live secrets in a Render environment group.

### 3. The web app already depended on a Google host at runtime, and `S8-IDENTITY-004` would have broken the forest

Most of this app's `.glb` models carry `KHR_draco_mesh_compression`, and
`@react-three/drei` points its DRACO decoder at
`https://www.gstatic.com/draco/` by default. So a CSP that blocks third-party
script — which is what the story asks for — would have stopped the nature
family rendering trees, animals and ground decor, silently.

The decoder is now committed under
`apps/myunivokai-personalization/public/vendor/draco/` from three 0.171.0, and
`useGLTF.setDecoderPath` points at it, so `script-src` names no third-party
origin at all. This was not scope creep: it is what the story's own acceptance
criterion required.

### 4. The CSP had a hole no check in this repo could see, and a browser found it

`tsc`, `next lint`, `next build` and all 700 unit tests passed against a policy
that produced **fourteen `connect-src blocked blob` violations per scene**:
`GLTFLoader` turns a model's embedded buffers and textures into Blob URLs and
reads them back through an ordinary fetch, which `connect-src` governs and not
`img-src`.

`e2e/content-security-policy.spec.ts` (`npm run check:csp`) is the instrument —
the one assertion suite in that folder rather than an artefact to eye, because
a `securitypolicyviolation` event names the directive it refused. It is not run
in CI, for the reason the Playwright config already gives about that folder.
After the fix: 6/6, with all three renderers mounting at zero violations and
the decoder fetched from `/vendor/draco/`.

### 5. Two task lines described work that did not exist, and one described a frontend change that was a backend one

- **`S8-IDENTITY-005`'s "add `auth-service` to the wake platform adapters if it
  is absent" was already done.** `wake.ServiceForSubject` cuts a subject at its
  first segment, so `myunivokai.queries.auth.web.login.v1` already resolves to
  `auth`, and `ServiceAuth` was already in the gateway's wake URL map. Verified
  rather than assumed, since the story listed it as work.
- **`S8-IDENTITY-006`'s kind filter is a backend change**, not a frontend one.
  The account list is cursor-paginated, so a client-side filter would filter
  the page it received and report "there are no end users" whenever the newest
  twenty accounts were staff. `kind` now travels `AccountListQueryData` →
  `Store.ListAccounts` → an equality predicate applied before pagination in
  both stores. The story sits in Phase A's frontend half and its task list did
  not anticipate touching `contracts/`.

### 6. Phase A shipped an account and left the gallery with no idea what one was

Nobody wrote this down as a claim, which is why it took the owner five minutes
of using the thing to find: Phase A gave the app an identity and gave worlds no
owner, so `/gallery` went on rendering `myunivokai.savedWorldIds` — a
per-BROWSER list — under the heading "Your Gallery". Signing up on a browser
that already held worlds therefore appeared to hand the new account somebody
else's collection.

It is worth being precise about whose gap it was. Ownership of worlds is Phase
B (`S8-IDENTITY-007`, `008`) and the server-served list is Phase C
(`S8-IDENTITY-015`, `016`), so no Phase A story was unfinished. What Phase A
did was make a page that had been HONEST ("worlds you created on this device")
into one that was not, by introducing the account the heading now implied. A
phase that adds an identity owes every screen that says "your" a look.

`S8-IDENTITY-018` is the fix, and it is deliberately not an early Phase C: the
shelf is still per-browser, and the page now says so in as many words. What
changed is that it is per-browser AND per-account rather than per-browser and
attributed to whoever happens to be signed in.

### 7. Three stories were added to Phase A after it was implemented

`S8-IDENTITY-018`, `019` and `020` were not in the committed scope; the owner
asked for the first two on 2026-09-02 and the third on 2026-09-03, after Phase
A's six stories were done and on the same branch. They are recorded as Phase A
stories rather than as a new phase because that is where they landed, and
pretending the plan predicted them would be the more dishonest bookkeeping.

`019` also spent the first migration this service has taken since the sprint
began. `TestAuthServiceGainsNoUnplannedMigration` is the ratchet that made that
a decision rather than a drift: it failed, and raising it to 4 in the same
commit is the protocol the test asks for in its own failure message.

### 8. A preference that filled a field and moved nothing

`S8-IDENTITY-019` shipped a preferred world family that worked exactly as
written and was useless: choosing the ocean on the profile page filled the
create form's picker with Ocean and left the canvas rendering a universe. The
owner found it within a day, and the sentence worth keeping is theirs — the
saved settings have to "apply and load the right world on the demo, not just be
filled in."

The mechanism is worth writing down because it is a shape rather than a typo.
The create page keeps TWO family states: `worldFamily`, what the form says, and
`renderedWorldFamily`, what the canvas shows. The second deliberately lags the
first by the length of the departure animation, because mounting a family for
the first time blocks the main thread for up to ~2.5 seconds compiling shaders
and that block has to happen inside an animation that can absorb it (see
`worldChangeStages.ts`). The picker's handler moved both. The autofill added by
`019` called `setWorldFamily` directly, and so did the "start from a blank
form" button — two writers to one half of a two-part invariant.

The fix is not a third state or a reconciling effect: `showWorldFamilyOnCanvas`
is now the only caller of `setWorldFamily` anywhere on the page, so a family
that cannot be shown cannot be set. **A piece of state mirrored by a second
piece of state has an invariant, and an invariant with more than one writer is
a bug waiting for its second writer** — which arrived one story later, from the
same pair of hands.

`S8-IDENTITY-020` is the fix, and it also answers the owner's second request in
the same message: the profile page now stands in front of the world its own
fields describe, so the setting is confirmed by the thing it changes rather
than by a select that agrees with you and moves nothing. It spends no
migration, adds no route and changes no contract.

### What Phase A deliberately did NOT do, so it is not mistaken for an omission

- **No migration for identity itself.** `internal/db/web_audience_schema_test.go`
  reads the committed SQL and asserts the four facts the "zero migrations"
  claim rests on. The counterpart test is a ratchet on the file COUNT, and
  `S8-IDENTITY-019` raised it from 3 to 4 for `account_profiles` — in the same
  commit, which is what that test asks for. `S8-IDENTITY-012`'s
  `system_settings` will raise it to 5 the same way.
- **The four existing `auth.*` subjects were not renamed** to say `admin`,
  even though they now silently mean it. A rename costs a coordinated
  two-service deploy plus a NATS ACL change to buy what a comment buys for
  nothing — the same call §17 made about `aud=web`.
- **`contracts/openapi-admin.yaml` is unchanged.** It documents the auth and
  analytics-read surface; the account-management routes were never in it, so
  the new `?kind=` parameter has nothing to be added to. Documenting that
  surface is its own change.

---

## Phase B — worlds are owned

### S8-IDENTITY-007 — Ownership columns, additive and with no backfill

Status: Implemented — `feat/be/end-user-identity-phase-b`
Priority: P0

As the product owner,
I want ownership stored in the services that own the rows,
so that a world's owner is checked where the world is written and nowhere else.

Scenario: The migration is instant and changes no existing world

Given three family databases and `dna-service` hold live rows
When the ownership migration runs
Then `owner_account_id` and `anonymous_id` exist as **nullable** columns with
no default, alongside one partial index each
And no existing row is rewritten, and no backfill runs
And every pre-existing world remains readable, shareable and mutable exactly
as it was
And a world already carrying an owner cannot have that owner overwritten.

Source evidence:
- agent-system/plans/architecture/end-user-identity-and-ownership.md — §6.2, §6.3, §16 decision 16, §18 non-cost 2
- services/universe-service/migrations/000001_init.sql — the `worlds` table the columns are added to
- services/dna-service/migrations/000001_init.sql — `profiles` and `generation_jobs`, which already join profile → world → family

Tasks:
- [ ] `feat/be/world-ownership-columns`: one additive migration per family
      service (`universe`, `nature`, `ocean`) — two nullable columns and the
      two partial indexes from plan §6.2.
- [ ] One additive migration in `dna-service` for `profiles`, plus the
      `generation_jobs` keyset index Phase C's list query needs.
- [ ] Make `owner_account_id` write-once in the repository layer
      (`WHERE owner_account_id IS NULL`), with a test — there is no transfer
      endpoint in v1.
- [ ] Add a test asserting a pre-plan world (both columns `NULL`) stays
      mutable by any holder of its id.

### S8-IDENTITY-008 — Ownership travels over NATS and is enforced on the write path

Status: Implemented — `feat/be/end-user-identity-phase-b`
Priority: P0

As an account holder,
I want only me to be able to change my world,
so that ownership means something a stranger holding the link cannot undo.

Scenario: A non-owner is refused

Given a world whose `owner_account_id` is set
When someone other than the owner calls publish, create-variant or
select-variant on it
Then the gateway or the family service rejects it with `403 NOT_WORLD_OWNER`
And the check is evaluated in the same transaction as the mutation, never
against a read model
And an **unowned** world is still mutable by anyone holding its id.

Scenario: The owner identity cannot be forged by a client

Given only the gateway verifies tokens
When a create command is published
Then the `ownerAccountId` on that command was set by the gateway from a
verified token
And no other NATS user is permitted to publish that command subject, so no
client and no other service can inject an owner.

Source evidence:
- agent-system/plans/architecture/end-user-identity-and-ownership.md — §6.1, §6.4, §6.5
- infra/nats/nats-server.conf — the gateway's publish allow-list holds exactly one command subject today, which is what makes the injected owner trustworthy
- contracts/go/contracts.go — the command and snapshot types the pointer fields are added to

Tasks:
- [ ] `feat/be/ownership-on-commands`: add nil-safe pointer identity fields to
      the generate and compose commands and to `WorldSnapshot`, so messages
      already on the stream decode to `nil` rather than a zero UUID.
- [ ] Set them in the gateway from the verified token, never from the request
      body.
- [ ] Add the ownership predicate to every mutating store method, table-driven
      so a mutation added later without a check fails the build.
- [ ] Add the ~3 NATS ACL lines and assert the negative case: a family service
      cannot publish the gateway's command subject.
- [ ] Add the line to `analytics-service-plan.md`'s data boundary recording
      `owner_account_id` as **excluded**, per plan §15.

### S8-IDENTITY-009 — An owner can delete their own world

Status: Implemented — `feat/be/end-user-identity-phase-b`
Priority: P0

As an account holder,
I want to delete a world I made,
so that something I do not want to keep stops being visible to anyone.

Scenario: Deletion is a flag, enforced on the server

Given a world owned by the requesting account
When the owner deletes it
Then the world stops appearing in that account's gallery, in `?ids=` results
and at its share URL
And the row still exists, so the deletion is reversible for ever
And a non-owner calling delete is rejected
And staff statistics still count the world, because analytics is deliberately
untouched
And no filtering happens in the frontend.

Source evidence:
- agent-system/plans/architecture/end-user-identity-and-ownership.md — §10, §16 decisions 4, 4b, 10
- services/api-gateway/internal/handlers/world_handler.go — the `?ids=` batch read and the share read this must filter
- services/universe-service/migrations/000001_init.sql — `world_shares`, the share slug that must stop resolving

Tasks:
- [ ] `feat/be/owner-world-delete`: add the deletion flag column and
      `POST /api/{family}/worlds/{id}/delete`, owner-only.
- [ ] Filter the flag out of every read path in the owning service — list,
      batch-by-ids and share resolution.
- [ ] Add the owner-only and the non-owner test, plus a test that the row is
      still present after deletion.

### S8-IDENTITY-010 — A deleted world's caches are actually gone

Status: Implemented — `feat/be/end-user-identity-phase-b`
Priority: P0

As an account holder,
I want a deleted world to disappear immediately, including from a link I
already sent someone,
so that "deleted" is not "deleted in a few minutes".

Scenario: The share stops resolving at once, through the gateway

Given the gateway caches world and share responses in Redis with a TTL
When an owner deletes a world whose share link has just been fetched
Then a request to that share URL **through the gateway** returns not-found
immediately, without waiting for the TTL
And the world's entry in a `?ids=` batch response is gone through the gateway
too
And the test proving this goes through the gateway rather than the family
service.

Source evidence:
- agent-system/plans/architecture/end-user-identity-and-ownership.md — §10, §12 (the cache-invalidation guardrail), §16 decision 10
- services/api-gateway/internal/handlers/world_handler.go — `worldCacheTimeToLive` and `shareCacheTimeToLive`, the two entries this story invalidates

Tasks:
- [ ] `feat/be/world-delete-cache-invalidation`: invalidate the world cache
      key and the share cache key on deletion.
- [ ] Add the gateway-level test. **A test that bypasses the gateway passes
      while the bug ships**, because the bug *is* the Redis entry — this
      sentence belongs in the test's comment.
- [ ] Decide and record how the gateway learns of the deletion (the delete
      response path versus the `world.changed` event), and make the choice
      explicit in the code rather than incidental.

### S8-IDENTITY-011 — Claim the worlds I made before I signed up

Status: Implemented — `feat/be/end-user-identity-phase-b-continued`
Priority: P0

As a visitor who has just signed up,
I want the worlds I already made to become mine,
so that signing up adds to what I have instead of starting me over.

Scenario: One claim, only the families used

Given a visitor created worlds anonymously across several days with one
anonymous id
When they sign up or sign in and claim
Then every world and profile carrying that anonymous id becomes owned by the
new account, in one transaction per service
And `anonymous_id` is cleared and `revision` advances, emitting the existing
`world.changed` event with no new event type
And only the family services that visitor actually used are woken, not all
three
And the client discards its stored anonymous id afterwards.

Scenario: Claiming twice, or from two devices, changes nothing

Given a claim has already succeeded
When the same claim is replayed, or a second device claims the same anonymous
id
Then zero rows are updated and no error is surfaced to the visitor
And a world is claimable exactly once, for ever.

Scenario: A world id is not a claim credential

Given `/worlds/{worldId}` is the URL a visitor sends to a friend
When someone attempts to claim worlds by id rather than by anonymous id
Then no such endpoint exists, and the claim matches only on the minted
anonymous id, which never appears in a URL.

Source evidence:
- agent-system/plans/architecture/end-user-identity-and-ownership.md — §7, §6.3b, §3.2, §3.3
- services/dna-service/migrations/000001_init.sql — `generation_jobs` already names the family per profile, which is how the fan-out narrows
- infra/nats/nats-server.conf — the gateway physically cannot publish a per-family claim subject, which is why the claim routes through `dna-service`

Tasks:
- [x] Accept the anonymous id on `X-Anonymous-Id` and carry it on the generate
      command through to `profiles.anonymous_id` and `worlds.anonymous_id`.
      **The CLIENT mints it, not the gateway** — corrections 9 and 10 below.
- [x] Add `POST /api/me/worlds/claim`, publishing exactly one
      `commands.dna.world.claim.v1`.
- [x] Add the `dna-service` claim handler that updates profiles and then
      publishes the per-family claim subject only for families its own
      `generation_jobs` rows name.
- [x] Add the family claim consumer: one transaction and the `IS NULL` guard.
      **No revision bump and no outbox row** — correction 6 above.
- [x] Add the idempotency and two-device tests.
- [x] Have the client clear its own anonymous-id cookie once a claim has
      succeeded. Writing it, with the 180-day named constant, shipped in Phase
      A; **moving the gallery's own shelf did not, and without it the whole
      story is invisible** — correction 12 below.
- [x] Add `X-Anonymous-Id` to the gateway's product `AllowedHeaders` — in
      `product_auth_router.go`'s `productCORSOptions`, not `router.go:82`,
      which is where the task line was written before Phase A moved it. Pinned
      by a preflight test, because it otherwise fails only in a browser.

### S8-IDENTITY-012 — System settings, so a policy number is not another `.env` line

Status: Implemented — `feat/be/end-user-identity-phase-b-continued`
Priority: P0

As the product owner,
I want the platform's policy numbers editable from the admin app and audited,
so that changing a limit is not a redeploy and `.env` stops absorbing product
behaviour.

Scenario: A limit changes without a deploy, and is attributable

Given `.env` already carries 105 example lines, `render.yaml` 176 keys, and the
seven services 170 config reads across 64 distinct variable names
When a staff member holding `settings:manage` changes a declared setting
Then the new value is validated against the setting's declared type and
bounds, and rejected if outside them
And it takes effect on the next request without any service restarting
And the change is written to `audit_events` with the actor and the old and new
values
And the setting row records who changed it last and when
And a staff member holding only `settings:read` can see the settings but not
change one.

Scenario: An empty settings table is a working platform

Given a freshly provisioned environment with no `system_settings` rows and an
empty Redis
When the platform serves traffic
Then every setting resolves to its **named default constant in code**, and
behaviour is identical to the value being set explicitly
And no request fails and no screen is blank because a settings row is absent.

Scenario: Reading a setting never wakes a sleeping service

Given `auth-service` is on the free tier and asleep, and the gateway enforces
the AI quota on the create path
When a visitor creates a world
Then the gateway resolves the limit from Redis, or from the compiled-in
default on a miss
And **`auth-service` is not contacted**, so a create never waits on a
20-60 second cold start to learn a quota number.

Scenario: A key removed from the registry does not discard an operator's value

Given a setting key is deleted from the code-declared registry
When the service next starts
Then the orphan row is left in place rather than deleted
And the admin screen shows it as an unknown setting, so removing it is a
deliberate act.

Source evidence:
- agent-system/plans/architecture/end-user-identity-and-ownership.md — §9.3 in full, §15 (the four settings prohibitions), §16 decision 20
- services/api-gateway/internal/admin/auth/revocation.go — the Postgres → Redis → gateway pattern this copies, and the **one behaviour it deliberately inverts**: a miss must not fall back to a NATS request
- services/auth-service/internal/services/permission_sync.go — the code-declared-registry shape to copy, and the `DELETE FROM permissions WHERE NOT (codename = ANY($1))` scar **not** to copy
- .env.example — 105 lines, the reason this story exists
- render.yaml — 176 `- key:` entries, the same reason

Tasks:
- [x] `feat/be/system-settings`: add the `system_settings` table to
      `auth-service` — `setting_key` primary key, `setting_value TEXT`,
      `updated_by_account_id`, `updated_at`.
      `migrations/000005_system_settings.sql`. The actor column is
      `ON DELETE SET NULL` rather than the CASCADE `account_profiles` uses on
      the same parent: a profile belongs to an account and dies with it, while
      a policy number belongs to the platform — see correction 13's neighbour
      note in the migration itself. Four columns and no `created_at`, because
      the audit log holds the history and a second timeline here could disagree
      with it.
- [x] Add a code-declared `declaredSettings` registry with key, type
      (`string` / `int` / `bool` / `duration`), default, bounds and a
      description the admin screen renders. Pinned by
      `TestDeclaredSettingsAreDeclaredDeliberately`.
      **It lives in `contracts/go/contracts_settings.go`, not in
      `auth-service` — correction 13.**
- [x] Adopt the key scheme `<domain>.<group>.<subject>.<thing>`, validated
      against `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$` and pinned by
      `TestEverySettingKeyFollowsTheScheme`, which also checks the pattern's
      rejections — a pattern nothing tests against a refusal could be `.*`.
- [x] Declare batch 1's nine settings. All nine, with the plan's defaults, held
      as **text** so a default and an operator's value go through one parser and
      one bounds check — correction 14.
- [x] Give `auth.token.web.*` descriptions that say "personalization web app"
      while the key says `web`.
- [x] Swap the four call sites from `service.cfg.X` to a lookup —
      `auth_service.go`'s lockout pair and `refreshTokenLifetime`, and
      `role_management_service.go`'s invite TTL.
- [x] The two `access_ttl` keys. `TokenIssuer` gave up **both** its lifetimes
      rather than gaining a resolver: the audience-to-lifetime choice moved to
      `AuthService.accessTokenLifetime`, beside `refreshTokenLifetime`.
      `config.WebAccessTokenTTL` and `WebRefreshTokenTTL` were **deleted** —
      correction 17.
- [x] Take **nothing** from the gateway's existing config. One new reader for
      the two quota limits; nothing the gateway reads today changed.
- [x] Leave `AUTH_TOKEN_VERSION_CACHE_TTL` and `NATS_QUERY_TIMEOUT` in `.env`.
      Untouched.
- [x] Declare each setting's permitted range in Go, and reject out-of-range
      writes. Also `TestEveryDeclaredSettingBoundsItsOwnType`, because a
      duration setting carrying integer bounds is not an error in any compiler
      — the bounds simply enforce nothing. And the two access ranges end where
      their refresh ranges begin, which is correction 16.
- [x] Take nothing from batch 2, and attempt no general migration.
- [x] Add `settings:read` and `settings:manage` to `enforcedPermissions`, both
      names chosen once. Two codes rather than one: reading a policy number and
      changing it are different acts, and the pair is asserted in both
      directions (`TestSettingsReadDoesNotGrantSettingsManage` and its twin).
- [x] Mirror every setting into Redis on write **and on service startup**, with
      no TTL. Startup mirrors the *effective* value of every declared setting,
      so a cache hit answers the gateway completely and the default stays a
      last resort rather than the normal answer for eight of nine keys.
- [x] Add the gateway-side reader: Redis, then the compiled-in default on a
      miss, and never a NATS request. **The comment this task asks for is not
      enough, and the shape is asserted instead — correction 20.**
- [x] Add a `setting_update` audit action recording `<key>: <old> -> <new>`.
      An absent previous row reads as `default`, because "there was no row" and
      "the row said nothing" are different facts.
- [x] Add `/api/admin/settings` read and write routes, permission-gated. The
      key is a path segment carrying dots, which needs no encoding.
- [x] Add the Settings screen to `apps/myunivokai-admin`, rendering the
      declared registry rather than a hand-written form. Sections come from the
      key prefix, so a new setting needs no frontend change and a new prefix
      needs no mapping table.
- [x] Add the empty-table test: no rows, no Redis, correct behaviour.
      `TestAnEmptySettingsTableIsAWorkingPlatform` asserts both halves — the
      screen reads correctly AND a sign-up produces a session with the declared
      lifetimes, which is the half a list assertion alone would miss.
- [x] Do **not** move `AI_PROVIDER` here. Not moved.

### S8-IDENTITY-013 — A daily generation limit that never refuses a world

Status: Implemented — `feat/fe-be/end-user-identity-quota-and-server-gallery`
Priority: P0

As the product owner,
I want a per-caller daily AI limit,
so that the provider bill has a ceiling instead of depending on nobody
noticing.

Scenario: Over the limit still produces a world

Given an anonymous visitor has had 5 AI generations today, or an account
holder 25 — both numbers resolved from the settings of `S8-IDENTITY-012`, with
the named constants as their defaults
When they create another world
Then the world is still created, from the **mock** provider, and is real,
deterministic, family-appropriate and theirs
And no request is refused and no `429` is returned on the create path
And the response states **why** this world was produced the way it was, as a
reason code rather than as a provider name
And the counter is keyed on the anonymous id or the account id, never on the
address, and expires with the UTC day so nothing has to clean it up
And a client cannot ask for the real provider, because the tier flag is set by
the gateway and protected by the same ACL as the owner id.

Scenario: The reason distinguishes the three routes to a mock-produced world

Given `AI_PROVIDER` is configured as `mock`, which is what production runs
today
When a caller passes the daily limit and creates another world
Then the reason is `mock_configured`, **not** `quota_exhausted`, because no AI
generation was withheld — there was no AI tier to withhold it from
And when `AI_PROVIDER` is a real provider and the caller is over the limit,
the reason is `quota_exhausted`
And when a real primary provider is tried and fails **and a distinct fallback
provider is configured**, the reason is `ai_failed_fallback` and the quota is
not implicated — while a primary failure with **no** distinct fallback ends as
a failed job, which carries no reason at all, because there is no world
And the counter keeps counting in every one of those cases, so the ceiling is
already real on the day `AI_PROVIDER` is flipped rather than starting from zero
at that moment.

Source evidence:
- agent-system/plans/architecture/end-user-identity-and-ownership.md — §9, §9.1 (the reason code and its precedence), §9.2, §16 decisions 8 and 17b
- render.yaml — `AI_PROVIDER: mock` in production, which is why a provider name cannot be the signal
- services/dna-service/internal/config/config.go — both providers default to `mock`; `defaultAIRepairAttempts = 2`, which is why one create can bill more than one call
- services/dna-service/internal/aifactory/factory.go — the fallback is only constructed when it differs from the primary, so today there is no fallback at all
- services/dna-service/internal/ai/providers/mock_presets.go — the mock already produces usable DNA; it is how the test suite runs

Tasks:
- [x] `internal/quota/daily_ai_quota.go` and `internal/edge/redis.go`:
      increment the Redis counter in the gateway **before** publishing the
      generate command. Both limits come from `S8-IDENTITY-012`'s settings
      reader — `settings.NewReader(edgeStore)` in `NewRouter`, which is the
      gateway's first settings reader. The key prefix `quota:ai:daily` is a
      named constant, and the key names its own UTC day so nothing has to clean
      it up.
- [x] `TestALimitChangedInTheAdminAppBindsOnTheNextCreate` (gateway) and
      `TestALimitChangedInTheMirrorAppliesToTheNextCreate` (quota package) —
      through the router and in isolation.
- [x] `contracts.AIQuotaState` on the generate command, honoured by
      `ai.AITierWithheld` in the orchestrator. It is a THIRD provider rather
      than the fallback: see correction 23.
- [x] `contracts.GenerationReason` on the JOB response.
      `TestNoWorldTableLearnsTheGenerationReason` holds the other half of §9.1
      — no world table learns it, so the friend who opens the share link is
      shown nothing.
- [x] Four ordered branches in `Orchestrator.GenerateProfileDNA`, with the
      failure named in the comment above them.
- [x] `TestTheSixthAnonymousCreateOfADayIsWithheldAndStillAccepted` (gateway),
      `TestAWithheldJobStillProducesValidatedDNA` (dna-service) — the second
      is the half that proves it is a WORLD and not a shrug.
- [x] `TestTheGenerationReasonCoversAllFourRoutesToAWorld`, six rows including
      a stubbed unreachable primary with and without a distinct fallback.
      Mutation-tested by inverting the precedence: it fails naming both wrong
      answers.
- [ ] Record the measured per-create cost from `ai_generation_attempts` once
      the AI tier is actually switched on, rather than carrying a rate-card
      estimate forward. **Still open, and not blocked by this story**: it needs
      `AI_PROVIDER` flipped to a real provider, which this story is the
      precondition for rather than the occasion of.

### S8-IDENTITY-014 — Say so, once, when a world came from presets

Status: Implemented — `feat/fe-be/end-user-identity-quota-and-server-gallery`
Priority: P1

As a visitor who has hit today's limit,
I want to be told why this world was built differently,
so that I read it as a limit rather than as a broken product.

Scenario: One toast, and no permanent mark

Given the create response's reason code is `quota_exhausted`
When the world finishes generating
Then a single toast names the limit and what happened, in English, using the
app's existing Liquid-Glass toast surface
And the numbers in that message come from the same named constants as the
counter, not from a literal
And the world itself carries **no** permanent tier badge, so the friend who
opens the share link — who hit no limit — is shown nothing about it
And no new toast dependency is added.

Scenario: The toast stays quiet for the two reasons that are not the visitor's

Given the deployment runs `AI_PROVIDER: mock`, as production does today
When any number of worlds are created, including past the daily limit
Then **no toast appears at all**, because nothing was withheld and there was
no AI tier to lose
And when a real primary provider fails and the fallback produces the world,
no toast appears either — that is an incident belonging to staff, and showing
it to the visitor blames them for our outage
And the frontend decides this from the **reason code only**, never from a
provider name reaching it.

Source evidence:
- agent-system/plans/architecture/end-user-identity-and-ownership.md — §9.1 (including the failure the owner found), §15 (no silent downgrade, and no announced downgrade that did not happen), §16 decisions 17 and 17b
- render.yaml — `AI_PROVIDER: mock` in production, which is what makes the quiet case the *current* case rather than a hypothetical
- apps/myunivokai-personalization/package.json — `sonner@2.0.7` is already a dependency
- apps/myunivokai-personalization/src/app/layout.tsx — the `<Toaster>` is already mounted app-wide and already cleared below the header
- apps/myunivokai-personalization/src/app/globals.css — `.lg-toast` is already the Liquid-Glass material, including the inset specular top edge

Tasks:
- [x] `src/lib/generationNotice.ts` decides, `src/app/page.tsx` speaks: one
      `toast()` on the mounted `sonner` stack, for `quota_exhausted` and
      nothing else. The copy is assembled from the limit the SERVER enforced
      and carried on the job — not from a constant in this app, which would be
      a second declaration of a settings value.
- [x] Written at the top of `generationNotice.ts`, and asserted rather than
      only written: `it("reads nothing but the reason code")` hands the
      function a job carrying `provider: "mock"` and requires silence.
- [x] A table typed `Record<GenerationReason, "speaks" | "stays silent">`, so
      a fifth reason added to the contract without a decision here is a compile
      error rather than a fourth kind of silence.

---

## Phase B — corrected during execution, 2026-09-03

Written after `S8-IDENTITY-007` … `014` were implemented. Eleven of the plan's
or the stories' own instructions turned out to be wrong, unnecessary or
insufficient, and four defects were found by reading the code rather than by a
test — entries 7, 8, 12 and 22. The record of those is worth more than the tidy
version, and entry 8 is the one to read first: it is two merged stories that
did nothing at all.

Entries 1 to 7 were written after `010`; 8 to 12 after `011`; 13 to 21 after
`012`; 22 to 24 after `013` and `014`. Phase C's own corrections (25 to 27) are
in its section further down.

### 1. The plan asked for `OwnerAccountID` on `WorldSnapshot`, and it was not added

Plan §15 says `contracts.WorldSnapshot` gains `OwnerAccountID *uuid.UUID` and
that `analytics-service-plan.md`'s data boundary records it as **excluded**.
`S8-IDENTITY-008`'s first task repeats it.

The field was **not added**, and the boundary line was written to say why. The
snapshot has exactly two consumers: `dna-service`, which reads `WorldID` and
nothing else from it, and `analytics-service`, which is required to drop the
owner. So adding it moves personal data across a service boundary **for no
reader at all**. "Never sent" is a stronger guarantee than "dropped on
arrival", and it is enforced by a reflection test in each of the three family
services rather than by a sentence in a document.

The plan's own rule survives unchanged, because the rule is that no field
crosses without a line in the data boundary — and the line is there.

### 2. The "~3 NATS ACL lines" were already in the file

`S8-IDENTITY-008` asks for them. `infra/nats/nats-server.conf` already grants
exactly what the design's trust argument requires: the gateway is the only
publisher admitted on `commands.dna.generate.v1`, `dna-service` the only one
admitted on a family compose subject, and no user holds a command wildcard. The
lines the task anticipated belong to the **claim** subjects in
`S8-IDENTITY-011`, which do not exist yet.

What was genuinely missing is the assertion. Three tests now parse the config
and fail if a second publisher appears on a command subject, if the gateway
loses its own grant, or if any service gains a command wildcard. The boundary
lives in a config file, so it is checked against the config file: every Go test
in every service would still pass while it silently moved.

### 3. `owner_account_id` is write-once, and the guard was written before the write

`S8-IDENTITY-007` asks for `WHERE owner_account_id IS NULL` on every write. At
that point **nothing writes the column** — the claim (`S8-IDENTITY-011`) brings
the first write. A store method with no caller would have been dead code for
two commits.

What shipped instead is the ratchet: a test in each family service and in
`dna-service` that scans every SQL literal in the repositories package and
fails any statement assigning `owner_account_id` without the guard in the same
statement. It finds nothing today, which is the point — the commit that adds
the write is reviewed for what it does, and the guard is the thing it would
forget.

### 4. Two index decisions differ from the plan's SQL

- The names follow the repo's own `idx_<table>_<columns>` convention rather
  than the plan's `<table>_<what>_idx`, which would have been the only indexes
  of that shape in four databases.
- **`profiles` gained an `anonymous_id` index the plan does not list.** §6.3
  gives the family tables both indexes and this table only the owner one. The
  claim's predicate is identical on both (`anonymous_id = $1 AND
  owner_account_id IS NULL`), and `profiles` gains a row for every world ever
  created, so the omission means a sequential scan over the largest table in
  `dna-service` on every signup. It reads as an oversight rather than a
  decision.

### 5. Deleting is stricter than every other mutation, which no story said

`S8-IDENTITY-009` says "a non-owner calling delete is rejected" and stops
there. It does not say what happens to an **unowned** world — which is every
world in production.

The rule taken: an unowned world stays mutable by anyone holding its id and is
deletable by **nobody**. A stranger adding a variant to a world they were sent
a link to is annoying and reversible; a stranger deleting it takes the world
out of its maker's gallery, and the maker cannot put it back. Nobody can prove
they made an unowned world, which is the same reasoning decision 16 uses to
leave a pre-plan world unclaimable.

It is refused with its own code, `403 WORLD_NOT_CLAIMED`, distinct from
`NOT_WORLD_OWNER`: "this is not yours" and "this is nobody's yet" have
different next steps, and only the second one has an answer the visitor can
act on. `S8-IDENTITY-011` is that answer.

### 6. Neither deletion nor the claim emits `world.changed`, and §7 says the claim does

Plan §7 has the claim "emitting the existing `world.changed` event". The same
argument that applies to deletion applies to it: decision 4b keeps
`analytics-service` untouched, correction 1 above keeps ownership off the
snapshot, so the event a claim or a deletion would publish is **byte-identical
to the last one**. Publishing it makes `world.changed` stop meaning "something
you can see changed" — a consumer added later would be woken for nothing, and
the read model would rewrite identical values.

Deletion therefore bumps no revision and stages no outbox row. The claim will
follow the same rule when it lands, and this correction is written now so that
`S8-IDENTITY-011`'s own task line is read against it.

### 7. A stale session broke the public share page, and no test was asking

Found in review rather than by CI, and recorded because of how it hid.

`S8-IDENTITY-008` attached the identity middleware to the whole business route
group. `/api/{family}/share/worlds/{slug}` is in that group and is the URL a
visitor sends to a friend — so **anybody whose seven-day token had expired was
answered 401 on a page that has nothing to do with their session.** Every test
passed: a page that does not care about tokens is a page nobody thought to send
a bad token to.

The middleware now sits on the five write routes only, where each one either
sets the owner or is checked against it. The test that pins it sends three
different kinds of useless credential at the share route and requires 200 from
all three.

Two smaller defects came out of the same pass: a deleted world still accepted
mutations from a caller holding its UUID (every read refused it and
`assertWorldMutable` did not), and deleting a world woke `analytics-service`
for an event that, by correction 6, never comes.

### 8. `007` and `008` shipped inert, because one line threw the owner away

Found while implementing `S8-IDENTITY-011`, in code merged to `staging` two
commits earlier. It is the most expensive finding of the phase and the cheapest
to have missed.

`GenerationService.Generate` normalizes the world input, and to attach the
normalized copy it rebuilt its envelope as a literal:

```go
normalizedEnvelope := contracts.Envelope[contracts.GenerateDNAData]{
    JobID: envelope.JobID, Timestamp: envelope.Timestamp,
    Data: contracts.GenerateDNAData{Family: envelope.Data.Family, Input: input},
}
```

`OwnerAccountID` is not in that literal. So the gateway stamped the owner from
a verified token, `dna-service` dropped it, `EnsureJob` wrote NULL, and **every
world created by a signed-in visitor was stored as anonymous.** `007` gave the
column and `008` gave it a value; between them nothing arrived. Every test in
the repository passed, because the field's journey was asserted at each end —
the gateway publishes it, the store writes what it is given — and never across
the one line in the middle that rewrites the message.

It is now `normalizedEnvelope := envelope` with one field replaced, which
cannot forget the next field either. The lesson is narrower than "test more":
**a struct literal that has to re-list its fields is a silent dropper**, and the
place to look for one is wherever a message is rebuilt rather than modified.

### 9. The client mints the anonymous id, and §7 says the gateway does

Plan §7 has the gateway minting it and returning it in the 202 body. Phase A had
already shipped the opposite — a client-minted `crypto.randomUUID` in a cookie
with a sliding 180-day window — so this was a real fork rather than a detail.

The deciding case is two tabs. Gateway-minting hands each concurrent create a
different id; the client can keep only one, and the other world is orphaned
under an id nobody holds. Read-or-create against one cookie has no such race,
costs no contract field, and leaves one minting site instead of two. The
gateway's job is what it is good at instead: **validating**, and deciding which
of the two identity fields survives.

### 10. A malformed `X-Anonymous-Id` is refused, and a claim that can never apply is never published

Two decisions no story states, both about the same failure shape: something
that looks like success and is a permanent loss.

An unparseable anonymous id on a create is a **400**, not an ignored header.
Ignoring it would create the world and answer 202 — a world with no anonymous
id, unclaimable for ever, reported as a success. A signed-in create is the
exception and ignores the header entirely, because a visitor must not be blocked
from creating anything by a 180-day cookie they never see.

And the claim's consumers have **no delivery limit at all**, on purpose: a claim
that gave up would leave somebody's worlds anonymous for ever with nothing
anywhere saying so. That makes a message which can never be applied one the
fleet retries until the stream drops it, so the two failures are told apart by
the error rather than by a delivery count —
`ErrInvalidWorldClaimCommand` is terminated, everything else nacked. The
gateway also refuses to publish one, **including when the fault is its own**: a
verified token whose subject is not an account id is a 500 there, not a poison
message downstream.

### 11. Only `dna-service` is woken, and the family claims wait in the stream

§7 asks that "only the family services that visitor actually used are woken,
not all three". That is satisfied, but not by waking: the gateway has the only
waker in the fleet and cannot know which families a visitor used —
`generation_jobs` knows, and it lives in `dna-service`, which has no waker.

So the gateway wakes `dna-service` and nothing else. `dna-service` publishes one
to three family claim commands, and each waits in `MYUNIVOKAI_COMMANDS` until
that family service next runs — which on this tier is the next time anybody
opens a world of that family. Waking all three from the gateway would spend two
cold starts per signup on services with nothing to do, which is the cost §7 was
avoiding.

**The bound this leaves, named rather than discovered:** the stream's retention
is 168 hours (`infra/nats/bootstrap.sh`). A family service that has not run for
seven days would lose the claim. That means a family with no traffic at all for
a week, from anybody — and if it becomes a real risk, the fix is the stream's
`--max-age`, not this code.

### 12. The claim is invisible without moving the browser's own shelf

`S8-IDENTITY-011`'s scenarios are all server-side, and implementing only those
would have produced a claim that changes four databases and nothing a visitor
can see.

The gallery renders from `localStorage` filtered by owner shelf
(`S8-IDENTITY-018`, Phase A). A visitor who signs up and claims five worlds
would still be looking at an empty grid and a note about worlds belonging to
somebody else. So the claim has a second half — `moveAnonymousWorldsToOwner` —
and it runs strictly **after** the server accepted, because the server is the
only thing that decides whether the claim happened and the anonymous id is the
only thing that could ever ask again.

That same note's copy promised "moving them into your account is coming", and
has been corrected: what is left of that state is a browser that lost its
anonymous-id cookie while keeping the `localStorage` list, and those worlds are
unclaimable for ever by decision 16.

### 13. The settings registry lives in `contracts`, not in `auth-service`

`S8-IDENTITY-012`'s task line says "add a code-declared `declaredSettings`
registry … Pin it with a test, as `enforcedPermissions` is pinned", and
`enforcedPermissions` lives in `auth-service`. Read literally, so would the
registry.

It is in `contracts/go/contracts_settings.go` instead, and the reason is a
value: **5**.

`auth-service` owns the table and validates every write, but the GATEWAY needs
the two `quota.*` defaults, because §9.3 forbids it from asking auth-service on
a cache miss. They are separate Go modules and neither may import the other's
internals. So a registry inside `auth-service` means the gateway declares its
own copy of the anonymous daily limit — two declarations of one number, in two
services, that must agree and would fail silently if they did not: a fresh
environment would enforce one value while the admin screen showed another.

`contracts` is where this repository already puts a vocabulary both sides read
(`PermissionCode`, `MaximumAccountDisplayNameLength`), and the same argument
put them there. What stayed in `auth-service` is what only it can do: the rows,
the audit line, the Redis mirror and the four call sites.

### 14. Defaults are held as TEXT, which is what makes the invariant checkable

The plan's central invariant is that every setting has a named default constant
and the platform behaves correctly with an empty table. Stated that way it is a
promise. Held as typed values — `5`, `10 * time.Minute` — it would have stayed
one, because a default and an operator's value would then travel through
different code.

Every default in the registry is the TEXT an operator would type, so both go
through the same parser and the same bounds check. That turns the invariant
into `TestEveryDefaultIsInsideItsOwnDeclaredRange`: a default outside its own
range is a test failure rather than something the first environment with an
empty table discovers. It also means the mirror written at startup and the
default on a cache miss are the same string in the same format, so the two
paths cannot diverge in shape.

### 15. Go cannot spell `7d`, and the plan's `3mo` is not a duration at all

Every value in batch 1 is measured in days or minutes; `time.ParseDuration`
stops at hours. So the registry's duration syntax is Go's plus one unit: a
whole number of days, `7d`.

The alternative was storing `168h` and `2160h`. An operator asked to type
`2160h` for three months cannot check it at a glance and is one keystroke from
`21600h` — precisely the class of mistake the declared bounds then have to
catch. Whole days only: `1.5d` is refused rather than rounded, because a
fractional day is expressible in hours and a settings screen must never round
silently.

The plan's `3mo` default for `auth.token.web.refresh_ttl` is written as `90d`,
for the reason the deleted `config.WebRefreshTokenTTL` already gave: a duration
cannot express a calendar month, and rounding it explicitly beats leaving a
reader to work out which month was meant.

### 16. A per-key bound cannot say "an access token must not outlive its refresh token"

The story asks for each setting's permitted range in Go, and that is what
shipped. It does not cover the one dangerous COMBINATION: a 30-day web access
token with a 1-day refresh token is two values inside their own ranges and a
session that expires before it can be renewed.

Cross-key validation was not built for one case. Instead the four ranges are
chosen so the violation cannot be expressed: each audience's access range ends
exactly where its refresh range begins (admin `1m…24h` against `24h…90d`; web
`5m…30d` against `30d…365d`). The invariant then lives in the choice of
numbers, and the failure mode of that is somebody widening one maximum without
moving the matching minimum — which nothing else would catch, so
`TestAccessLifetimeRangesCannotCrossTheirRefreshRanges` does.

### 17. The two `web` token constants were deleted, not kept as the defaults

§15 says the named constant "stays as the **default**" for every value moved
into `system_settings`, and for the five migrated ones it does — their
environment variable is still the default, and correction 18's ratchet keeps
the two sides agreeing.

For the two born-as-settings web lifetimes it would have meant two copies of
`7d`: `config.WebAccessTokenTTL` and the registry's default. So
`internal/config/web_token_lifetimes.go` is **deleted**, and the registry is the
only declaration. That file's own comment predicted this story would consume it
— "S8-IDENTITY-012 makes both of them `system_settings` rows" — so deleting it
is what it was written for, not a liberty taken with it.

The argument it carried, that a 7-day access token is defensible only because
the gateway rechecks `tokenVersion` on every request, moved with the value into
the registry's comment.

### 18. `auth-service` reads its own settings from Postgres, never from its own mirror

The story describes "Postgres → Redis → gateway resolution", which reads as one
chain both services walk. They do not walk the same one.

The gateway reads Redis because it must not wake `auth-service` on the create
path. `auth-service` reads **Postgres** at the moment of use, because it owns
the table and going through its own mirror would make its behaviour depend on a
cache it populated: a flushed Redis would silently revert this service's policy
to the defaults while the rows still said otherwise. It has no cold-start
constraint to trade against, and every reason to read the truth.

A row that no longer satisfies its declaration is ignored in favour of the
default on both sides. Bounds are code: a value that was legal when it was
written is not made legal by being in a database.

### 19. A failed mirror write is reported, and the audit row is written before it

Nothing in the story says what happens when Postgres accepts a settings write
and Redis refuses the mirror. The answer is that the operator is told, and it
is not the comfortable one — the row is already committed, so the change IS live
in `auth-service`.

What is not live is the gateway, which reads the mirror. Answering success
would tell somebody their new quota is being enforced when the old one still
is, so the write returns the error and the retry re-mirrors; writing the same
row and the same mirror twice changes nothing.

The audit row goes in **before** the mirror, so the transition it records is
the one that actually happened even when the caller saw a failure. Ordering it
after would leave a committed change with no history.

### 20. The comment §9.3 asks for cannot protect the rule, so the shape is asserted

§9.3 says to write the divergence from `RevocationChecker` down in the code,
"because a later reader will otherwise 'fix' it into consistency and
reintroduce a cold start". The comment is there. It is not enough.

Every behavioural test of the gateway's reader would still pass if somebody
gave it a requester field and used it only on a cache miss — which is exactly
the change that reader makes, because `RevocationChecker`'s shape is the one
this repository uses everywhere else. A test that only ever observes a miss
being answered from the default cannot tell "asks nobody" from "asks nobody
today".

So `TestTheSettingsReaderHasNoWayToAskAuthService` asserts the structure:
`settings.Reader` has exactly one field, it is the `SettingCache` interface,
and that interface declares exactly one method. A reader with nothing to ask
with cannot put a 20-60 second cold start back on the create path.

### 21. The bounds made an existing test's mechanism unrepresentable, which is the bounds working

`TestAuthService_AcceptInvite_RejectsAnExpiredToken` set
`InviteTokenTTL = -time.Hour`, so the invite it created was expired the instant
it existed. `auth.token.invite_ttl` declares a floor of one hour, so that
configuration can no longer exist — and with the setting resolved per call, a
negative value would have been ignored in favour of the default and the test
would have started passing or failing on a timing accident rather than on the
behaviour it names.

It now writes the past expiry straight into the row, which is what an expired
invite actually is. Worth recording because it is the shape of a small trap:
tightening a bound can make a test's SETUP impossible while leaving its
assertion looking healthy, and a resolver that falls back to a default rather
than failing is what turns that into a silent pass.

### 22. `FailGeneration` was the second copy of correction 8's defect, and correction 8 missed it

Found while adding the quota field to the generate command, which is the same
way correction 8 was found: a new field on a message is what makes a literal
that re-lists its fields visible.

`GenerationService.FailGeneration` still rebuilt its envelope as a literal
naming `Family` and `Input`, so a generate command that exhausted its
deliveries reached `EnsureJob` with **no owner and no anonymous id**, and wrote
a profile row that does not say whose it is.

It is the cheaper half of that bug — a failed job has no world, so nothing
became unclaimable and no gallery lost anything. It is still a real one: the
raw input a visitor typed is stored on that row, and a personal-data row that
has forgotten whose it is cannot be answered for.

The lesson is narrower than correction 8's and worth adding to it: **fixing a
struct-literal dropper means finding the OTHER ones in the same file.** There
were two, both rebuilding the same message type, eleven lines apart.

### 23. The quota degrade needed a third provider, because the fallback does not exist in production

`S8-IDENTITY-013`'s task says to serve a withheld job "from the mock provider",
which reads as though one is available. `aifactory` only constructs a fallback
when `AIEnableFallback && AIFallbackProvider != AIProvider`, and production
sets both to `mock` — so **today there is no fallback provider at all**, and a
degrade that reached for it would have failed the job instead of degrading it.

The orchestrator therefore holds three providers, and the preset one is built
from no configuration whatsoever. That is deliberate rather than lazy: a quota
whose degrade depends on a provider somebody has to configure is a quota that
stops enforcing itself in exactly the environment nobody configured. It is
also why there is no `AI_PRESET_PROVIDER` variable — the value would have one
legal setting.

`TestTheQuotaDegradeDoesNotDependOnAFallbackBeingConfigured` is what fails if
somebody removes it as redundant.

### 24. Two decisions about which way to fail, and they point in opposite directions

Neither story says what happens when the counter cannot be read, or when there
is nothing to count against. Both answers are the same — no AI tier — and the
reasons are different enough to write down.

**A caller with no identity at all gets no AI tier.** No account and no
anonymous id means no key, so a counter would never rise and the allowance
would be unlimited: precisely the script §9.2 says the quota exists to bound.
A browser always sends one of the two, so this is a non-browser caller, and it
costs them a preset world — which the design already decided is acceptable for
everybody.

**A counter that cannot be read also gets no AI tier**, and this one is the
**inverse of `settings.Reader`**, which answers the same Redis outage from its
compiled-in default. The asymmetry is the decision: a setting has a
known-good default, and a spent allowance has none. A ceiling that fails open
is not a ceiling, and failing closed is affordable only because the visitor
still gets a real world.

**And the bound this leaves, named rather than discovered.** A caller that
mints a fresh anonymous id per request is counted as a new visitor every time.
§9's "never on the address" rule is what makes that unfixable at this layer,
and the per-IP token bucket is what still stands against it. Closing it would
mean a per-IP counter shared by everyone behind one NAT, which is the thing
§9 rejected on purpose.

### What Phase B has NOT done yet, so it is not mistaken for an omission

- **No world made before the claim shipped has an owner**, and there is still
  no way for a visitor to give one to it. Decision 16 stands: an anonymous id
  is what a claim matches on, worlds created before one was ever sent carry
  none, and nobody can prove they made them. `WORLD_NOT_CLAIMED` is the honest
  answer to deleting one, permanently, not a temporary limitation.
- **`AI_PROVIDER` is still `mock` in production, and that is now a choice
  rather than a constraint.** The ceiling exists, so flipping it is safe; the
  per-create cost §9.2 wants measured from `ai_generation_attempts` is the one
  thing still waiting on the flip, which is why `013`'s last task stays open.
- **Nothing tells a visitor their worlds were claimed.** The claim is still
  silent by design. `014` speaks for exactly one reason code and the claim is
  not one of them.
- **The gateway reads exactly two settings**, both quota limits, and every
  other value it uses is still an environment variable. That is §9.3's batch 2
  and each one needs its handler restructured first.

---

## Phase C — the gallery is real

### S8-IDENTITY-015 — The account's world list, served by dna-service

Status: Implemented — `feat/fe-be/end-user-identity-quota-and-server-gallery`
Priority: P0

As an account holder,
I want a list of my worlds from the server,
so that my collection is not a property of one browser.

Scenario: One keyset page, and nothing sensitive in it

Given `dna-service` already links profile → world → family in
`generation_jobs`
When `GET /api/me/worlds?cursor=&limit=25` is called with a product token
Then it returns only world id, family and creation time, plus a next cursor
And it returns no DNA, no raw input and no email — the same response-model
guarantee the share endpoint already has
And pagination is keyset, never `OFFSET`
And no new service and no new database is introduced to answer it.

Source evidence:
- agent-system/plans/architecture/end-user-identity-and-ownership.md — §8, §3.1 (why this is not a `library-service`), §12 (the response-model test)
- services/dna-service/migrations/000001_init.sql — `generation_jobs` holds family, profile and world id already
- services/analytics-service/migrations/000001_init.sql — the keyset index comment explaining why every page costs the same as the first

Tasks:
- [x] `contracts.DNALibraryListQuerySubject`, answered by
      `HandleLibraryListQuery` over `PostgresStore.ListOwnedWorlds`. No ACL
      change: the config already grants `myunivokai.queries.>`. No migration
      either — the keyset index `S8-IDENTITY-007` added was written for this
      query and says so.
- [x] `GET /api/me/worlds`, in the identity group behind
      `RequireProductAccessToken`, with `DefaultLibraryPageSize` and
      `MaximumLibraryPageSize` in `contracts`.
- [x] `TestTheWorldListRowCarriesNothingSensitive` — on the TYPE rather than
      on a sample response, so a fourth field fails the build instead of
      shipping unset.
- [ ] Exclude worlds the owning family has flagged deleted. **Not done, and it
      cannot be done here — see correction 25.** The flag lives in the family
      service's own database and a deletion emits no event, so `dna-service` is
      never told. The filter's one home is the family service's read, which
      already has it: a deleted world is absent from the `?ids=` hydration.

### S8-IDENTITY-016 — The gallery reads the server, not the browser

Status: Implemented — `feat/fe-be/end-user-identity-quota-and-server-gallery`
Priority: P0

As an account holder,
I want to open the gallery on a device that has never seen my worlds and find
them there,
so that the product's promise survives a new phone.

Scenario: A device with empty storage

Given an account with several worlds and a browser whose storage was just
cleared
When the gallery is opened while signed in
Then the worlds are listed, hydrated by the `?ids=` call the app already makes
And `localStorage` is used only as a cache and as the anonymous path, never as
the source of truth
And a signed-out visitor's gallery behaves exactly as it does today.

Source evidence:
- agent-system/plans/architecture/end-user-identity-and-ownership.md — §8, §14.1, §18 (this is the only real rework in the plan)
- apps/myunivokai-personalization/src/lib/savedWorlds.ts — `SAVED_WORLD_IDENTIFIERS_STORAGE_KEY`, the entire current notion of ownership
- apps/myunivokai-personalization/src/app/gallery/page.tsx — the page that changes source

Tasks:
- [x] `src/lib/galleryWorldSources.ts` decides the source; the hook supplies
      its IO. Signed out is unchanged, including the copy.
- [x] `replaceCachedWorldReferences` — the invalidation rule is one sentence: a
      successful server read replaces this owner's entries and nothing else
      ever does. It **replaces rather than merges**, against §8's wording, for
      the reason in correction 26. And `splitIntoHydrationBatches` keeps the
      50-id cap honest, which was a latent 400 the story was right to name.
- [x] Delete replaces "Remove from gallery" on a server-backed card, two
      clicks, on `S8-IDENTITY-009`'s own pattern. The card goes only once the
      server agrees — see correction 27 for why the old button had to go rather
      than gain a sibling.
- [x] `it("finds an account's worlds on a device whose storage is empty")`.
      Reachable as a unit test only because the decision was pulled out of the
      hook: this app's vitest runs `environment: "node"` with no React testing
      library.

---

## Phase C — corrected during execution, 2026-09-03

Written after `S8-IDENTITY-015` and `016`. Three entries, and 26 is the one to
read before touching the gallery: implementing §8's own sentence literally
brings deleted worlds back for ever.

### 25. `dna-service` cannot exclude a deleted world, and the story asks it to

`S8-IDENTITY-015`'s last task says to "exclude worlds the owning family has
flagged deleted, coordinating with `S8-IDENTITY-009` so the filter has exactly
one home". The coordination is right and the location is not: **there is no
data in `dna-service` to filter on.** The deleted flag lives in the FAMILY
service's own database, and by Phase B correction 6 a deletion emits no event
at all — so nothing ever tells `dna-service` that a world is gone.

The filter's one home is therefore the family service's own read, where it
already is. The web app hydrates every card through
`GET /api/{family}/worlds?ids=`, and a deleted world is simply absent from
that response, so a page of 25 can render 24 cards. The gallery has always had
to handle that: a batch response has never been required to return every id it
was asked for.

Making `dna-service` able to do this would mean a deletion event and a
projection — a second copy of a fact, kept in step across two databases, to
save one card's worth of layout. Recorded as refused rather than as forgotten.

### 26. §8's merge rule resurrects deleted worlds, so the cache is REPLACED

§8 says `localStorage` "becomes the anonymous-visitor path and a cache, and the
two lists are merged newest-first with the server list winning on conflict."
The second half cannot do what it is for. **Winning a conflict only decides ids
present in BOTH lists**; an id present only in the cache survives the merge —
and that id is exactly a world its owner deleted, on this device or another
one. So a merge brings deleted worlds back, and brings them back permanently,
because the cache is then the only thing that still remembers them.

`replaceCachedWorldReferences` replaces this owner's entries instead, which is
what makes the stored list a cache rather than a second opinion. The
invalidation rule the story asked for is one sentence: **a successful server
read replaces this owner's entries, and nothing else ever does.**

The obvious way to get replacing wrong has its own test: **the anonymous shelf
is never touched.** Those worlds have no owner anywhere on the server, so no
server answer can speak about them, and the only thing that may ever move them
is the claim.

### 27. "Remove from gallery" became a lie, so it was replaced rather than joined

`S8-IDENTITY-016`'s third task says to ADD an owner-only delete control, which
reads as a second button beside the existing one. It is a replacement.

On a list the server serves, "remove from gallery" drops a cache entry and the
world is back on the next reload. That button was honest while the list was
this browser's own and stopped being honest the moment the source changed — so
a server-backed card gets Delete, on `S8-IDENTITY-009`'s two-click pattern,
and the card is removed only once the server agrees. An unowned world refuses
deletion outright (`WORLD_NOT_CLAIMED`), and removing the card first would
have hidden that refusal behind an optimistic update.

The anonymous shelf keeps "Remove from gallery", because there it is still
exactly true: nobody can delete those worlds and this list is all there is of
them.

**One latent defect came out of the same change.** The gallery has always sent
one `?ids=` request per family with however many ids that family held, and the
gateway answers 400 above fifty. That was unreachable while the list was capped
by what one browser happened to hold; a server list has no such accidental
ceiling, so a visitor with sixty worlds of one family would have got a 400,
fallen into the per-id fallback, and fetched sixty worlds one at a time against
a rate limit. Hydration is batched now, and the story was right to name the cap
even though the reason it named it was the wrong one.

---

## The rename — not a phase

### S8-IDENTITY-017 — `myunivokai-web` becomes `myunivokai-personalization`

Status: Implemented — `feat/repo/rename-web-to-personalization` (landed before
`S8-IDENTITY-001`, per this story's own sequencing rule)
Priority: P1

As the product owner,
I want the app folder named for what the product does rather than for its
runtime,
so that the repository says "personalization" where it currently says "web".

Scenario: A rename with no logic in it

Given the owner chose `personalization`, in full, on 2026-09-02
When the rename lands
Then `apps/myunivokai-web` is `apps/myunivokai-personalization` everywhere it
is referenced — Dockerfiles, both compose files, `Makefile`, `run.sh`, the
commented `render.yaml` block, the CI `paths:` filters and the
`agent-system/` documents
And the spelling is US `-ization` in every one of those places
And **the CI job that filters on that path is confirmed to have actually run**,
because a stale filter fails by silently not running rather than by going red
And `aud=web` is unchanged
And the deployment name is unchanged, because a share URL that is already out
cannot be renamed.

Source evidence:
- agent-system/plans/architecture/end-user-identity-and-ownership.md — §17, §16 decisions 13 and 15
- .github/workflows/ci.yml — the `paths:` filters that stop matching silently

Tasks:
- [x] `feat/repo/rename-web-to-personalization`: move the folder and update
      every reference, in one commit, with no behaviour change alongside it.
- [x] Verify the renamed CI job appears in the run, not merely that CI is
      green.
- [x] Land this **before `S8-IDENTITY-001` or after `S8-IDENTITY-016`** —
      never between, because it touches almost every path in CI and none of the
      logic, so beside a feature branch it buys nothing but merge conflicts.

Corrected during execution, 2026-09-02 — three of this story's own claims
about the repository were wrong, and the record is worth more than the tidy
version:

1. **There is no `paths:` filter anywhere in `.github/workflows/`.** Every job
   runs on every push and pull request to `staging` and `main`. So the risk
   this story built its hardest acceptance criterion around — *"a stale filter
   fails by silently not running rather than by going red"* — **did not
   exist**. The real coupling is `working-directory: apps/myunivokai-web` and
   `cache-dependency-path:` in the two frontend jobs, and a wrong value there
   fails **loudly**, which is the opposite failure mode. Both were updated.
2. **`Makefile` and `run.sh` reference no app path at all.** Both files exist;
   neither needed a single character changed. They were named in this story's
   scenario without being checked.
3. **`agent-system/` was not renamed wholesale**, which the scenario implies.
   The split follows [`CLAUDE.md`](../../../../CLAUDE.md)'s own rule: paths
   were rewritten in `knowledge/`, `rules/`, `agents/`, `skills/`, active
   `plans/` and `project-context.json`, and left untouched in `evolution/`,
   `memory/execution-records/`, `plans/architecture/v1-2026-07-22/` and the
   sprint-01 / sprint-04 / sprint-07 folders — 16 documents in total. Those
   record a moment that has passed, and the path they name was correct when
   they were written; rewriting them would forge the record rather than fix
   it. The consequence, accepted deliberately: those 16 documents contain
   links that no longer resolve.

One scope decision inside the rename, so it is not rediscovered later: the
**Vercel deployment name stays `myunivokai-web`** per decision 13, so the
commented `render.yaml` block keeps `name: myunivokai-web` while its
`dockerfilePath` and `dockerContext` move. The distinction is now written into
`render.yaml`, `deploy/single-container/Dockerfile` and
`deploy/single-container/README.md` in words, because a reader who saw only
the folder name would otherwise "fix" the deployment name and break every
share URL already handed out.

## Found in the running product after Phase C, 2026-09-04

### S8-IDENTITY-021 — A world read is checked against its owner

> **Status: Implemented** on `fix/be/world-read-authorization`.
> Reported by the owner from a browser, not by a failing job.

**As** somebody whose worlds are now tied to an account,
**I want** a world I have not published to be mine to read,
**so that** signing up means my worlds are mine rather than merely labelled.

#### What was reported

A `/worlds/{id}` link for an unpublished world belonging to another account
rendered that world, signed out, with no error. The owner's words:
*"chưa publish mà không login vẫn xem được là sao? đáng lẽ phải 401 hay 403 gì
chứ?"* — and they were right. `GET /api/{family}/worlds/{id}` answered **200**
to a caller with no credentials at all.

What it handed over is the part that makes this more than a status code: the
nickname, the `role`, the `selectedVariantId`, **every** variant with its full
`WorldSceneConfig`, and the whole `personalityDNA` — `energySignature`,
`visualHints`, `shortNarrative` and all. That is strictly **more** than the
share page is deliberately redacted down to (`PublicWorld`, `PublicVariant`,
`PublicDNA`). The redaction existed; the door beside it did not use it.

The batch read had the identical hole, which matters because fixing only the
first would have left `?ids=` as the way around it.

#### Why nothing here caught it

Not a bypass, and not missing coverage. Phase B put ownership on every
mutation, wrote the rule down once in `worldMutationPermitted`, proved it with
a five-caller table in all three family services, and guarded the table with a
**reflective ratchet over every `Store` method** so a mutation added later
without a check fails the build.

The ratchet asked one question: *does this method mutate a world?* `GetWorld`
and `GetWorldsByIDs` answered no, and were filed in a list literally commented
as *"the rest of the Store, listed so that the ratchet can tell 'a read was
added' from 'a mutation was added and nobody noticed'"*. **A read was the safe
outcome.** But a read that hands a stranger somebody's private world is not a
mutation, so the question was the wrong one — the category was the blind spot,
not the coverage.

Three documents then recorded the gap as settled design rather than as an
unclosed hole, each corrected in place on 2026-09-04:

- `registerWorldRoutes` in the gateway carried *"the reads are open, and one of
  them must be"* — true of `/share/worlds/{slug}`, quietly extended to the two
  routes beside it.
- `knowledge/backend/source-overview.md` said `OptionalProductAccessToken`
  *"must not reach the reads"*, which is the share route's requirement
  generalised to all three.
- `plans/architecture/end-user-identity-and-ownership.md` §"What ownership is
  today" said *"anyone holding a world UUID can read that world"* as a fact
  about the baseline, and §6.5 — the only section that says what ownership DOES
  — is titled *"The write path gains one behaviour and one endpoint"*. The read
  path was never specified, and unspecified became open.

#### Scenarios

1. **An owned, unpublished world, and nobody signed in** → `403
   NOT_WORLD_OWNER`, "This world belongs to another account."
2. **An owned world, and a different account's token** → the same 403. The
   account comes from the verified token and never from the body or the query.
3. **An owned world, and its owner** → 200, unchanged.
4. **An UNOWNED world, and anybody at all** → 200, unchanged. This is not a
   compromise: it is every world made before ownership existed and every world
   made by a visitor who has not signed up, and refusing them would have broken
   the product in order to secure it.
5. **A published world, by SLUG, with no session or a garbage token** → 200,
   redacted, unchanged. The regression guard that already existed
   (`TestThePublicSharePageIgnoresTheVisitorsSessionEntirely`) is why this
   could be trusted rather than hoped for.
6. **A published world, by ID, as a stranger** → still 403. Publishing opens
   the share door, not the id door.
7. **The gallery batch, `?ids=` mixing readable and unreadable worlds** →
   answers with the readable ones and drops the rest, rather than failing.

#### Decisions inside it

**403, not 404.** A 404 would hide the world's existence, which is the usual
advice. It was rejected because the WRITE path already answers 403
`NOT_WORLD_OWNER` for the same world, so a 404 on the read alone hides nothing
a POST would not reveal — and it would cost a real visitor, somebody who
followed a URL out of a screenshot or a chat, the one sentence that explains
what happened.

**The read rule delegates to the write rule.** `WorldReadPermitted` calls
`worldMutationPermitted` rather than restating it. Two copies of "an owned
world belongs to its owner, an unowned one to whoever holds its id" is one copy
too many, and the copy that drifts is the one nobody is looking at.

**The check runs in the family service, not the gateway**, matching where §6.4
put the write check — but with no transaction, deliberately. A mutation takes
the row `FOR UPDATE` so a concurrent claim cannot change the answer between the
check and the write it authorises. A read authorises nothing, so the owner
already loaded with the world is enough, and it costs no extra query:
`worldSelectColumns` has always selected `owner_account_id`.

**The gateway's `world:v1` cache had to go, and that is the half a fix like
this loses.** The key is `family:worldID`, with no room for who asked. Left in
place, the owner's own first read would store their private world under a name
a stranger's request resolves to — the ownership check would hold for exactly
one request, and Redis would answer the next sixty seconds of them, with every
ownership test still green. Putting the caller into the key was the
alternative and was rejected: `cacheStore` can Get, Set and Delete one exact
key, and `S8-IDENTITY-010`'s guarantee is that a deletion drops the world's
entry **synchronously**, before the visitor's own response returns. With an
audience in the key there is no single entry to drop and no prefix delete to
reach the rest. So: a 60-second TTL, on a read whose fanout is one person
looking at their own page, which every mutation on that page already
invalidated. `share:v1` keeps its cache — it is the genuinely public path, and
its answer is the same for everybody. The mutations still delete `world:v1`,
because an older gateway alongside a rolling deploy still writes it.

**The refusal needed somewhere to go.** The fix created a new way INTO the
world page's error state: a `/worlds/{id}` link that arrived by way of a
screenshot or somebody else's history now lands on "This world belongs to
another account." That screen previously had one outcome, a world, so its error
branch was a bare message with no navigation. It now carries
`ReturnDestinationLinks`. The share slug is not offered there and cannot be —
it exists only in the payload the read just refused.

#### Done means

- [x] `403 NOT_WORLD_OWNER` for a read of another account's world, by id and
      filtered out of `?ids=`, in universe, nature and ocean.
- [x] Both reads carry the caller from the verified token —
      `TestEveryWorldReadCarriesTheTokensAccount`, written with a body naming a
      different account, for the same reason its mutation twin is.
- [x] The by-id read is not served from cache, asserted from both ends: a
      poisoned entry under exactly the old key never reaches a response, and
      two reads produce two round trips
      (`TestTheByIdWorldReadIsNeverServedFromCache`).
- [x] An anonymous read still works and carries no invented account
      (`TestAWorldReadWithNoSessionCarriesNoAccount`). A regression guard, not
      a proof of the fix: it passes on the old code too, which is the point.
- [x] The ratchet asks a question that could catch this —
      `TestEveryStoreMethodThatReturnsAWorldIsOwnershipFiltered` derives its
      expectation from the interface, failing any `Store` method that returns a
      `WorldBundle` without being declared ownership-filtered, ownership-
      assigning, or exempt with its reason written down. `GetPublicWorld` is
      the single exemption, and it is argued rather than assumed.
- [x] Every new test verified RED against the pre-fix code, not merely green
      after it. Two of the four gateway tests and the two ownership cases of
      the family table fail without the change; the three legitimate callers
      keep passing, which is what says the fix is a filter and not a wall.
- [x] `go vet` and `go test` clean across all seven Go services; typecheck,
      lint and 801 frontend tests clean.
- [x] Verified end to end against the local stack, not only in unit tests:
      signed up a second account, created a world through the real generate →
      compose → read path, and confirmed 200 for its owner, 403 for a stranger,
      1-of-1 in the owner's batch, 0-of-1 in a stranger's, an unowned world
      still 200 for anybody, and the share URL still public with no session and
      with a garbage token.

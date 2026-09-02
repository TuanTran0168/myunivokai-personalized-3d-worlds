# Sprint 08 user stories — end-user identity and world ownership

> **Document status:** Planned
> **Sprint starts:** 2026-09-02
> **Last source review:** 2026-09-02

One epic, three phases, seventeen branch-sized stories. The phases are ordered
by dependency and each ends in a shippable state:

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

Status: Planned
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
- [ ] `feat/be/web-audience-auth`: add the product signup/login/refresh/logout
      handlers for `audience = "web"`, reusing the existing Argon2id hasher,
      refresh rotation, family reuse detection and lockout paths without
      copying them.
- [ ] Add `AUTH_WEB_ACCESS_TOKEN_TTL` (7d) and `AUTH_WEB_REFRESH_TOKEN_TTL`
      (3mo) as named config values beside the existing admin pair — never as
      literals.
- [ ] Add the minimum-length rule and the Have I Been Pwned range check
      (k-anonymity: first 5 SHA-1 hex characters out, suffix matched locally)
      as a signup/change-password validator, with a test that no password
      leaves the process.
- [ ] Add a `register` action to the audit constants, which is the whole of the
      registration metric (plan §14.2).
- [ ] Add a test that a product signup can never produce an account holding a
      permission row.
- [ ] Confirm in a test that **no migration** is needed: `kind`, `audience` and
      `token_version` are asserted present against the existing schema.

### S8-IDENTITY-002 — The gateway's product auth edge

Status: Planned
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
- [ ] `feat/be/product-auth-edge`: add `middleware.RequireProductAccessToken`,
      mirroring `admin_auth.go` — local Ed25519 verification, then the Redis
      `tokenVersion` check, then the audience check against
      `AccountAudienceWeb`.
- [ ] Add the `/api/auth` and `/api/me` route groups with a third
      `authRateLimitRouteKey = "auth"` bucket and its own named limits.
- [ ] Add per-email Redis failure counters for login, keyed separately from the
      per-IP bucket.
- [ ] Extend `contracts/openapi.yaml` with the auth and `/api/me` route
      surface, and keep the admin surface out of it.

### S8-IDENTITY-003 — Prove the two audiences cannot cross, in both directions

Status: Planned
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
- [ ] `feat/be/identity-separation-guardrails`: add
      `product_router_test.go`, enumerating every `/api/me` and `/api/auth`
      route and asserting its middleware.
- [ ] Add the missing direction: an `admin`-audience token rejected by the
      product edge.
- [ ] Add the repository-level invariant test that an `end_user` account holds
      no permission row.
- [ ] Add the bootstrap-command test asserting it still cannot create an
      `end_user`.

### S8-IDENTITY-004 — The web app's session, and its first CSP

Status: Planned
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
- apps/myunivokai-web/src/lib/api.ts — the client that gains the header and the refresh-once behaviour

Tasks:
- [ ] `feat/fe/product-session-and-csp`: add a session module that writes, reads
      and clears the three cookies, with every name, path and lifetime a named
      constant.
- [ ] Add signup, login and account-menu screens using the app's existing glass
      surfaces rather than a new visual language.
- [ ] Add single-flight transparent refresh to the API client so N concurrent
      401s cause one refresh, not N.
- [ ] Add the Content-Security-Policy in `next.config`/middleware and verify
      all three renderers against it.
- [ ] Record in the code, next to the cookie writer, that a JS-written cookie
      **cannot** be `httpOnly`, so the exposure equals `localStorage` and the
      CSP is the control — otherwise a later reader will assume protection that
      is not there.

### S8-IDENTITY-005 — Tell the truth about a cold sign-in

Status: Planned
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
- [ ] `feat/fe/auth-cold-start-honesty`: reuse the existing
      `SERVICE_WAKING` wait behaviour on the auth calls rather than writing a
      second one.
- [ ] Distinguish a wake wait from a credential rejection in the UI, with a
      test for each.
- [ ] Add `auth-service` to the wake platform adapters if it is absent, so the
      gateway can actually start it.

### S8-IDENTITY-006 — Staff can see and disable an end-user account

Status: Planned
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
- [ ] `feat/fe/admin-end-user-accounts`: show `kind` in the account list and
      allow filtering by it.
- [ ] Ensure the role-assignment UI is unreachable for an `end_user` row,
      matching the server-side invariant from `S8-IDENTITY-003`.

---

## Phase B — worlds are owned

### S8-IDENTITY-007 — Ownership columns, additive and with no backfill

Status: Planned
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

Status: Planned
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

Status: Planned
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

Status: Planned
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

Status: Planned
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
- [ ] `feat/be/anonymous-world-claim`: mint the anonymous id in the gateway
      into the 202 body, accept it back on `X-Anonymous-Id`, and carry it on
      the generate command through to `profiles.anonymous_id` and
      `worlds.anonymous_id`.
- [ ] Add `POST /api/me/worlds/claim`, publishing exactly one
      `commands.dna.world.claim.v1`.
- [ ] Add the `dna-service` claim handler that updates profiles and then
      publishes the per-family claim subject only for families its own
      `generation_jobs` rows name.
- [ ] Add the family claim consumer: one transaction, the `IS NULL` guard, the
      revision bump and the outbox row.
- [ ] Add the idempotency and two-device tests.
- [ ] Have the client write and later clear its own anonymous-id cookie, with
      the 180-day lifetime as a named constant.
- [ ] Add `X-Anonymous-Id` to the gateway's product `AllowedHeaders`
      ([`router.go:82`](../../../../services/api-gateway/internal/handlers/router.go)) —
      a one-line change that otherwise fails as a CORS preflight rejection in
      the browser and passes in every server-side test.

### S8-IDENTITY-012 — System settings, so a policy number is not another `.env` line

Status: Planned
Priority: P0

As the product owner,
I want the platform's policy numbers editable from the admin app and audited,
so that changing a limit is not a redeploy and `.env` stops absorbing product
behaviour.

Scenario: A limit changes without a deploy, and is attributable

Given `.env` already carries 105 example lines, `render.yaml` 176 keys, and the
seven services 170 config reads between them
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
- [ ] `feat/be/system-settings`: add the `system_settings` table to
      `auth-service` — `setting_key` primary key, `setting_value TEXT`,
      `updated_by_account_id`, `updated_at`.
- [ ] Add a code-declared `declaredSettings` registry with key, type
      (`string` / `int` / `bool` / `duration` — the four the config loader
      already has), default, bounds and a description the admin screen renders.
      Pin it with a test, as `enforcedPermissions` is pinned.
- [ ] Declare the two AI generation limits as its first settings, with the
      existing named constants as their defaults.
- [ ] Add `settings:read` and `settings:manage` to `enforcedPermissions` — not
      to `reservedPermissions`, because their routes ship here. Choose both
      names once: `SyncPermissions` deletes any codename that leaves the list,
      from production and from every role holding it, on the next boot.
- [ ] Mirror every setting into Redis on write **and on service startup**, with
      no TTL, so a flushed Redis self-heals on the next boot.
- [ ] Add the gateway-side reader: Redis, then the compiled-in default on a
      miss, and **never a NATS request**. Put the reason in a comment next to
      it — a later reader will otherwise make it consistent with
      `RevocationChecker` and reintroduce a cold start on the create path.
- [ ] Add a `setting_update` audit action recording `<key>: <old> -> <new>`.
- [ ] Add `/api/admin/settings` read and write routes, permission-gated, which
      the enumerating admin router test already requires.
- [ ] Add the Settings screen to `apps/myunivokai-admin`, rendering the
      declared registry rather than a hand-written form, so a new setting needs
      no frontend change.
- [ ] Add the empty-table test: no rows, no Redis, correct behaviour.
- [ ] Do **not** move `AI_PROVIDER` here. It is the most valuable candidate and
      the most expensive: `aifactory` builds the provider once at startup, so it
      would turn provider selection per-request, and the setting would need
      validating against which API keys exist. Plan §9.3 records it as the next
      candidate, deliberately outside this sprint.

### S8-IDENTITY-013 — A daily generation limit that never refuses a world

Status: Planned
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
And when a real primary provider is tried and fails so the fallback runs, the
reason is `ai_failed_fallback` and the quota is not implicated
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
- [ ] `feat/be/daily-generation-quota`: increment the Redis counter in the
      gateway **before** publishing the generate command. Both limits come from
      `S8-IDENTITY-012`'s settings reader — Redis, then the compiled-in default
      on a miss, never a request to `auth-service`. The counter's key prefix
      stays a named constant, because it is not policy.
- [ ] Add a test that a limit changed in the admin app takes effect on the next
      create with no service restart, which is the point of routing it through
      settings at all.
- [ ] Add the tier flag to the generate command and honour it in
      `dna-service` by serving that job from the mock provider.
- [ ] Return a **reason code** on the job/world response —
      `ai_generated` / `quota_exhausted` / `mock_configured` /
      `ai_failed_fallback` — computed in `dna-service`, which is the only place
      all three facts exist at once. Not a provider name: a provider name makes
      the frontend guess why, and it cannot.
- [ ] Implement the precedence explicitly: `mock_configured` **outranks**
      `quota_exhausted`. Put the reason in a comment, because reversing this
      is what produces a limit warning on a deployment that has no AI tier.
- [ ] Add the guardrail test: the 6th anonymous creation of a day is served by
      the mock provider and still yields a valid world.
- [ ] Add the table-driven reason test covering all four values, including a
      stubbed failing primary. **Three of the four cannot be observed in
      production today**, because production runs on mock — this test is the
      only thing standing between them and the day `AI_PROVIDER` is flipped.
- [ ] Record the measured per-create cost from `ai_generation_attempts` once
      the AI tier is actually switched on, rather than carrying a rate-card
      estimate forward.

### S8-IDENTITY-014 — Say so, once, when a world came from presets

Status: Planned
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
- apps/myunivokai-web/package.json — `sonner@2.0.7` is already a dependency
- apps/myunivokai-web/src/app/layout.tsx — the `<Toaster>` is already mounted app-wide and already cleared below the header
- apps/myunivokai-web/src/app/globals.css — `.lg-toast` is already the Liquid-Glass material, including the inset specular top edge

Tasks:
- [ ] `feat/fe/mock-tier-toast`: one `toast()` call on the existing stack,
      fired for `quota_exhausted` and for nothing else, with the copy assembled
      from the limit constants.
- [ ] Write next to that check, in the code, that keying on a provider name
      instead re-merges three different situations at the last possible moment.
- [ ] Add a test per reason code: one fires, three stay silent.

---

## Phase C — the gallery is real

### S8-IDENTITY-015 — The account's world list, served by dna-service

Status: Planned
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
- [ ] `feat/be/account-world-library`: add
      `myunivokai.queries.dna.library.list.v1` as one keyset query in
      `dna-service`.
- [ ] Add `GET /api/me/worlds` behind the product middleware, with the page
      size as a named constant.
- [ ] Add the response-model test, mirroring the existing share-response test.
- [ ] Exclude worlds the owning family has flagged deleted, coordinating with
      `S8-IDENTITY-009` so the filter has exactly one home.

### S8-IDENTITY-016 — The gallery reads the server, not the browser

Status: Planned
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
- apps/myunivokai-web/src/lib/savedWorlds.ts — `SAVED_WORLD_IDENTIFIERS_STORAGE_KEY`, the entire current notion of ownership
- apps/myunivokai-web/src/app/gallery/page.tsx — the page that changes source

Tasks:
- [ ] `feat/fe/account-gallery`: read `/api/me/worlds` when signed in, and keep
      the `localStorage` path for anonymous visitors.
- [ ] Demote the stored ids to a cache with an explicit invalidation rule, and
      keep the existing 50-id cap honest against a server list that can be
      longer.
- [ ] Add the owner-only delete control, wired to `S8-IDENTITY-009`.
- [ ] Add a test for the empty-storage signed-in case, which is the whole point
      of the story.

---

## The rename — not a phase

### S8-IDENTITY-017 — `myunivokai-web` becomes `myunivokai-personalization`

Status: Planned
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
- [ ] `feat/repo/rename-web-to-personalization`: move the folder and update
      every reference, in one commit, with no behaviour change alongside it.
- [ ] Verify the renamed CI job appears in the run, not merely that CI is
      green.
- [ ] Land this **before `S8-IDENTITY-001` or after `S8-IDENTITY-016`** —
      never between, because it touches almost every path in CI and none of the
      logic, so beside a feature branch it buys nothing but merge conflicts.

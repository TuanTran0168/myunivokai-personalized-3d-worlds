# Sprint 04 user stories — auth-service, analytics read model, admin app

> **Document status:** Planned
> **Sprint starts:** 2026-08-06
> **Last source review:** 2026-08-06

Two epics, ordered by dependency rather than by document. Phases 0 of both
tracks and analytics phases 0–3 have no dependency on each other and can run
in parallel; only `S4-ANALYTICS-005` and `S4-ANALYTICS-007` join the two
tracks, at auth phases 1–2 and the admin app shell respectively.

**Supersession note:** `auth-and-admin-plan.md`'s original phase 4
(`feat/be/admin-query-subjects`) and phases 5–6 (`feat/fe/admin-records`,
`feat/fe/admin-charts`) are replaced by `S4-ANALYTICS-005` and
`S4-ANALYTICS-007` below and must not be built separately — see
[analytics-service-plan.md §Changes this forces in auth-and-admin-plan.md](../../services/analytics-service-plan.md#changes-this-forces-in-auth-and-admin-planmd).

## EPIC-S4-AUTH-001 — Staff identity and the internal admin app

### S4-AUTH-001 — Freeze auth/admin contracts

Status: Implemented
Priority: P0

As a service developer,
I want versioned auth subjects and a separate admin OpenAPI file,
so that the admin surface never appears in the public API contract and every
later phase has a frozen wire format to build against.

Scenario: Contracts exist before any handler

Given the seven owner decisions in `auth-and-admin-plan.md` are answered
When phase 0 lands on `feat/repo/auth-admin-contracts`
Then `contracts/openapi-admin.yaml` exists as a file separate from the public
OpenAPI spec
And auth subjects (login/refresh/logout/account/role/permission) and their
Go types are defined in `contracts/go`
And CI lints `contracts/openapi-admin.yaml` as its own job step, alongside
the existing public spec.

**Built narrower than first scoped, deliberately:** no new `.schema.json`
files were added. Every payload this phase defines (login, account, role,
permission, audit) is either internal to Go services (gateway ↔
auth-service over NATS) or an HTTP body scoped entirely to
`openapi-admin.yaml`'s own `components.schemas` — neither crosses into a
different language runtime the way `WorldInput`/`ProfileDNA` do, which is
the actual reason those two get dedicated schema files and
`schema_conformance_test.go` coverage. Matching that file to a case that
doesn't need it would be the abstraction this repo's conventions warn
against.

Source evidence:
- agent-system/plans/services/auth-and-admin-plan.md — §Phases, Phase 0
- agent-system/rules/ci-quality-gates.md — the contract job the new lint step was added to
- contracts/go/contracts_auth.go
- contracts/openapi-admin.yaml

Tasks:
- [x] Define auth subjects and account/role/permission Go types in `contracts/go` (`contracts_auth.go`).
- [x] Add `contracts/openapi-admin.yaml` with the login/refresh/logout route surface; later phases extend it.
- [x] Add a CI lint step for `contracts/openapi-admin.yaml` alongside the existing `contracts/openapi.yaml` step.

### S4-AUTH-002 — Stand up auth-service core

Status: Implemented
Priority: P0

As a staff member,
I want to log in, refresh and log out through a dedicated identity service,
so that admin access is centrally issued, revocable and audited rather than a
shared password.

Scenario: Bootstrap and authenticate

Given an operator-supplied bootstrap password and no self-signup path
When the first admin account is created and logs in
Then `auth-service` issues an Ed25519 access JWT (10 minute expiry) and a
rotating opaque refresh token (14 day, single-use, stored hashed)
And the login is written to `audit_events` with actor, action, result and
source address
And a wrong password returns the same constant-time response whether or not
the account exists.

Scenario: Revoke immediately

Given a logged-in staff account
When an operator disables the account
Then `auth-service` bumps `accounts.tokenVersion` and writes it to Redis
And every refresh token family the account holds is revoked
And the gateway's next Redis-backed check rejects the account's existing
session, without a per-request call to `auth-service`.

Scenario: The last super admin cannot be disabled

Given exactly one enabled account with `is_super_admin`
When a disable is attempted against that account
Then the disable is refused with `LAST_SUPER_ADMIN`
And the account remains enabled — this is the one bypass path back into an
otherwise-unadministerable system, and losing it is the bricking failure the
plan's lockout guards exist to prevent.

**Narrower than the original scenario, honestly:** "or changes its password"
is removed from the revoke scenario above. A self-service change-password
subject was never in this phase's source plan (`auth-and-admin-plan.md`'s
phase-1 bullet list names login/refresh/logout, not password change), and
building one now would have been scope creep beyond what phase 1 actually
needs. `bumpAndCacheTokenVersion` is written as the one shared revocation
primitive precisely so a future password-change handler reuses it rather than
duplicating the Redis-write logic.

Source evidence:
- agent-system/plans/services/auth-and-admin-plan.md — §auth-service (Tokens, Passwords, Schema)
- agent-system/plans/services/auth-and-admin-plan.md — §Owner decisions, decision 2
- agent-system/plans/services/auth-and-admin-plan.md — §Lockout guards — enforced server-side, not in the UI
- services/auth-service/internal/services/auth_service.go
- services/auth-service/migrations/000001_init.sql

Tasks:
- [x] Create `services/auth-service` and `myunivokai_auth` migrations (`accounts`, `roles`, `permissions`, `role_permissions`, `account_roles`, `refresh_tokens`, `audit_events`).
- [x] Implement login/refresh/logout, Argon2id tuned for 512 MB instances, per-account lockout (per-IP limiting is the gateway's existing rate-limit layer, not duplicated here).
- [x] Implement the code-declared permission sync; seed `basic_user` role with `chart:read` only. `super_admin` is the bypass flag on `accounts`, not a role, so nothing is "seeded" for it beyond the bootstrap account itself.
- [x] Implement the bootstrap command — operator-supplied email/password (flags or env vars), forced change flagged on first login, no default password anywhere in the repository.
- [x] Implement refresh-token rotation with reuse detection (a replayed used token revokes its whole family) and the last-super-admin disable guard.
- [x] Write tests: password hash/verify, Ed25519 token issue/verify (wrong key, expiry), refresh-token hashing, login/lockout/reuse/logout/disable business logic against a real in-memory `Store`, permission-sync idempotency.

**Deferred to a later phase, not silently dropped:** a self-service
change-password subject; per-account audit-event query surface (frozen in
contracts, not yet answered by a handler — that is phase 5/7 territory);
`account:manage`/`role:manage` self-revocation guards, which only become
meaningful once role management itself exists.

### S4-AUTH-003 — Gateway admin route group with default-deny

Status: Implemented
Priority: P0

As a platform operator,
I want the admin API to be a separately protected route group on the existing
gateway,
so that one misconfiguration cannot expose admin surface to the public
product edge.

Scenario: Every admin route defaults to deny

Given the `/api/admin` sub-router is mounted with its own middleware stack
When a router test enumerates every registered admin route
Then every route not explicitly allow-listed as public rejects an
unauthenticated request
And the admin CORS handler allows exactly one origin, never a wildcard.

Scenario: Verify without a network hop per request

Given a staff access token and the Redis `tokenVersion` cache
When the gateway handles an admin request
Then it verifies the Ed25519 signature locally and reads the cached
`tokenVersion`
And only a cache miss calls `auth-service` once to repopulate it
And `auth-service` being asleep blocks login/refresh only, not already
authenticated navigation.

Source evidence:
- agent-system/plans/services/auth-and-admin-plan.md — §Amended: one gateway, two route groups
- agent-system/plans/services/auth-and-admin-plan.md — §How B works

Tasks:
- [x] Add a distinct `chi` sub-router at `/api/admin` with its own middleware stack.
- [x] Implement local JWT verification plus the Redis `tokenVersion` check and documented cache-miss fallback.
- [x] Add the enumerating default-deny router test.
- [x] Add the admin-only CORS handler, rate limits, and `ADMIN_ROUTES_ENABLED` switch.
- [x] Extend the gateway's NATS user with admin publish permissions only.

**Narrower than the original scenario, honestly:** this phase ships exactly
the three routes `contracts/openapi-admin.yaml` freezes —
`/auth/login` (public), `/auth/refresh` and `/auth/logout` (require a
presented refresh cookie, validated by `auth-service` itself). None needs a
declared `PermissionCode`, so the default-deny router test is behavioral
(every non-public route rejects an unauthenticated request) rather than a
permission-metadata enumeration — a generic per-route permission-declaration
registry would have been built for no consumer yet. `RequireAdminAccessToken`
(Ed25519 verify + Redis `tokenVersion` cache-miss fallback) is implemented
and unit-tested in `internal/admin/auth` and
`internal/middleware/admin_auth_test.go`, but no route mounts it yet — its
first caller is `S4-ANALYTICS-005`. The gateway's NATS user needed no config
change: its existing `myunivokai.queries.>` publish permission already covers
`myunivokai.queries.auth.>` (see the comment added to
`infra/nats/nats-server.conf`). `ADMIN_ROUTES_ENABLED` defaults to `false` in
`render.yaml` until `apps/myunivokai-admin` exists (S4-AUTH-004).

Source: `services/api-gateway/internal/handlers/admin_router.go`,
`admin_auth_handler.go`, `admin_router_test.go`;
`services/api-gateway/internal/middleware/admin_auth.go`,
`admin_auth_test.go`; `services/api-gateway/internal/admin/auth/`.

### S4-AUTH-004 — Admin app shell and staff login

Status: Implemented
Priority: P0

As a staff member,
I want a dedicated Next.js admin app with login and RBAC-aware navigation,
so that I can reach the panel with no exposure to or dependency on the 3D web
app.

Scenario: Log in and see only permitted navigation

Given a staff account with an assigned role
When the staff member logs in to `apps/myunivokai-admin`
Then the access/refresh tokens are set as `httpOnly`, `Secure`,
`SameSite=Lax` cookies
And every route other than login is denied by middleware without a valid
session
And navigation items are hidden, not just disabled, for permissions the
account lacks
And a CI check proves zero imports from `apps/myunivokai-web` or `three.js`.

**Session design, worked out during implementation, not in the source
plan:** neither gateway cookie declares a `Domain` attribute (by design — see
S4-AUTH-003), so this app's own server never sees them directly. Every
`/api/admin/auth/*` route here is a BFF relay
(`services/api-gateway`'s own routes, called server-to-server, with the
gateway's Set-Cookie headers re-emitted verbatim) — re-emitting from this
app's own response is what makes the cookies first-party to it, which is
what "own domain" and "cookie-based auth wants a server" actually cash out
to. A corollary the plan doesn't spell out: the refresh cookie's
`Path=/api/admin/auth` scoping means middleware handling any OTHER route
structurally never receives it, so a middleware-side silent refresh is not
possible — reviving an expired session is instead the login page's job (a
fetch that targets that exact path on mount) plus a 5-minute client-side
keep-alive while the dashboard stays open. See
`apps/myunivokai-admin/README.md`'s "Session model" section.

Source evidence:
- agent-system/plans/services/auth-and-admin-plan.md — §The admin app

Tasks:
- [x] Scaffold `apps/myunivokai-admin` (Next.js 15 App Router, TypeScript strict, Tailwind v4, shadcn/ui, TanStack Query v5).
- [x] Implement the login page and session middleware, default-deny except login.
- [x] Implement RBAC-aware navigation from the caller's permission list.
- [x] Add the CI check for zero `apps/myunivokai-web` / `three.js` imports.

### S4-AUTH-005 — Auth hardening

Status: Implemented
Priority: P1

As an operator,
I want an invite flow, a role-management UI and a key-rotation drill,
so that adding staff and managing roles does not require direct database
access.

Scenario: Manage roles without touching the database

Given a super admin account
When they create a role, assign permissions to it, and grant it to another
account
Then the lockout guards hold (an in-use role cannot be deleted; an account
cannot revoke its own `account:manage`/`role:manage`)
And every role write invalidates the gateway's cached role map immediately.

**Narrower/different than scoped, deliberately:**
- "Every role write invalidates the gateway's cached role map immediately"
  assumed a Redis-cached role→permissions map at the gateway that was never
  actually built (S4-AUTH-003 only cached `tokenVersion`). Rather than add
  that cache now, `RequireAdminPermission`
  (`services/api-gateway/internal/middleware/admin_permission.go`) queries
  auth-service fresh on every management request via a new
  `AuthAccountPermissionsQuerySubject`. Admin-management traffic is a
  handful of staff, not the hot path the tokenVersion cache exists for —
  adding a cache with nothing yet to invalidate would be solving a load
  problem this route group doesn't have. There is consequently no
  invalidation bug to have either: a role edit is visible on the very next
  request.
- No invite subject existed in `contracts/go` before this phase (checked;
  the vision doc names the goal but never froze a wire shape for it) — added
  `AuthInviteCreateQuerySubject`/`AuthInviteAcceptQuerySubject` and the
  matching data types, plus nullable `accounts.password_hash` and
  invite-token columns (`migrations/000002_invite_flow.sql`). No email
  infrastructure exists, so the raw invite token is returned once to the
  inviting staff member to relay out of band (surfaced in the admin UI's
  invite dialog).
- "Tune lockout thresholds from real usage" has no real usage to tune
  against yet (no deployment — see S4-AUTH-006, deliberately sequenced
  after analytics exists). Left at S4-AUTH-002's original defaults.
- Established the repo's first cursor-pagination convention (opaque
  `base64(occurredAt-or-createdAt-nanos:id)`, keyset on `(timestamp, id)
  DESC`) for account and audit-event lists — see
  `services/auth-service/internal/repositories/cursor.go`. Role lists stay
  unpaginated: roles are staff-composed, not user-generated, and
  realistically number in the dozens.

Source evidence:
- agent-system/plans/services/auth-and-admin-plan.md — §Lockout guards
- agent-system/plans/services/auth-and-admin-plan.md — §Phases, Phase 7

Tasks:
- [x] Build the invite flow and account/role management screens.
- [x] Implement role-map cache invalidation on every role write (superseded — see the note above; no cache exists to invalidate).
- [x] Run and document a key-rotation drill with two active public keys (`agent-system/skills/admin-key-rotation-drill.md`).
- [ ] Tune lockout thresholds from real usage — deferred, no real usage yet.

### S4-AUTH-006 — Deploy auth-service and the admin app

Status: Planned
Priority: P0

As a platform operator,
I want `auth-service` and the admin app in the production deployment topology,
so that staff can reach the panel outside local development.

Scenario: Production topology includes the new services

Given `render.yaml` and the admin app's Vercel project
When phase 8 deploys
Then `myunivokai-auth` runs alongside the existing fleet with its own Neon
database
And `apps/myunivokai-admin` is deployed to its own domain with its own
`.env.example`
And every credential is entered directly in the Render/Vercel dashboards,
never through the repo.

Source evidence:
- agent-system/plans/services/auth-and-admin-plan.md — §Phases, Phase 8

Tasks:
- [ ] Add the `auth-service` `render.yaml` entry and Neon database.
- [ ] Add gateway env additions for the admin route group.
- [ ] Provision the admin app's Vercel project and domain.
- [ ] Write the deployment runbook.

## EPIC-S4-ANALYTICS-001 — A read model for the admin app

### S4-ANALYTICS-001 — Freeze analytics contracts

Status: Implemented — `feat/be/analytics-service`
Priority: P0

As a service developer,
I want `WorldSnapshot`, `FamilyWorldChangedData`, the two `world.changed`
subjects and the four query subjects frozen in `contracts/go` with fixtures,
so that the event-emitting phase and the consuming phase can be built
independently without drifting.

Scenario: Contracts and fixtures exist first

Given the snapshot-events design in `analytics-service-plan.md`
When phase 0 lands on `feat/repo/analytics-contracts`
Then `WorldSnapshot` and `FamilyWorldChangedData` exist in `contracts/go`
And `myunivokai.events.{universe,nature}.world.changed.v1` and the four
`queries.analytics.*` subjects are defined
And `contracts/fixtures/` gains JSON fixtures for the new events — the first
event fixtures in the repository.

Source evidence:
- agent-system/plans/services/analytics-service-plan.md — §Design decision: snapshot events, not fine-grained events
- agent-system/plans/services/analytics-service-plan.md — §Phases, Phase 0

Tasks:
- [x] Add `WorldSnapshot` and `FamilyWorldChangedData` to `contracts/go`.
- [x] Define the two `world.changed` subjects and four `queries.analytics.*` subjects.
- [x] Add JSON fixtures for the new events under `contracts/fixtures/`.

### S4-ANALYTICS-002 — Start emitting world-change events

Status: Implemented — `feat/be/analytics-service`
Priority: P0 — ordered first among implementation work; the only phase whose
delay causes permanent data loss

As the analytics read model's future consumer,
I want universe and nature to start emitting a revision-stamped snapshot on
every world mutation now,
so that no event that will ever be needed is lost to JetStream's 7-day
retention before `analytics-service` exists to consume it.

Scenario: Every mutation increments revision and emits a snapshot

Given a world in universe or nature
When a variant is created, a variant is selected, or a world is published
Then the `revision` column increments in the same transaction as the mutation
And an outbox row is written with message id `world_id:rev:<n>`
And the completed event is enriched with the full `WorldSnapshot` fields.

Scenario: No analytics service exists yet

Given no consumer is subscribed to the new subjects
When these events publish
Then they accumulate durably in `MYUNIVOKAI_EVENTS`
And dna-service's explicit `ConsumerFilterSubjects` remains unaffected.

Source evidence:
- agent-system/plans/services/analytics-service-plan.md — §Design decision: a revision column on worlds
- agent-system/plans/services/analytics-service-plan.md — §The event gap
- agent-system/plans/services/analytics-service-plan.md — §Phases, Phase 1

Tasks:
- [x] Add `revision INTEGER NOT NULL DEFAULT 1` to `worlds` in universe and nature migrations.
- [x] Increment `revision` and write an outbox row inside the existing variant-create/select/publish transactions.
- [x] Enrich `FamilyCompletedData` with the full `WorldSnapshot` fields (additive, backward compatible).
- [x] Add a repository test asserting every mutating store method writes an outbox row — the drift guard the plan names as the real long-term cost.

### S4-ANALYTICS-003 — Stand up analytics-service's own consumer and projections

Status: Implemented — `feat/be/analytics-service`
Priority: P0

As the admin app,
I want `analytics-service` to consume events into `world_projections` and
`job_projections` with idempotent upserts,
so that duplicate or out-of-order delivery from JetStream never corrupts the
read model.

Scenario: Idempotent projection from a durable consumer

Given `analytics-service` starts fresh against `MYUNIVOKAI_EVENTS`
When it processes `dna.generated`, `dna.failed`, `family.completed`,
`family.failed` and `world.changed` events
Then it writes to `inbox_messages` with `ON CONFLICT (message_id) DO NOTHING`
before projecting
And `world_projections` upserts only when the incoming revision is greater
than the stored one
And no `outbox_messages` table exists in this service's schema.

Source evidence:
- agent-system/plans/services/analytics-service-plan.md — §Analytics schema
- agent-system/plans/services/analytics-service-plan.md — §What the existing infrastructure already provides (`dnaResultsDurableName` precedent)
- agent-system/plans/services/analytics-service-plan.md — §Phases, Phase 2

Tasks:
- [x] Scaffold `services/analytics-service` (config, pool, migrations, hollow health server) copied from `universe-service`.
- [x] Add the durable consumer modeled on `dnaResultsDurableName`, `MaxDeliver(-1)`, wildcard filter on `myunivokai.events.>`.
- [x] Implement inbox idempotency and the revision-guarded upsert into `world_projections`/`job_projections`.
- [x] Add the analytics NATS user (subscribe `events.>`, subscribe/publish `queries.analytics.>`, no domain publish permission).

### S4-ANALYTICS-004 — Serve analytics queries

Status: Implemented — `feat/be/analytics-service`
Priority: P0

As the admin app,
I want paginated overview, world-list, job-list and timeseries queries
answered entirely inside `analytics-service`,
so that every aggregate is computed once in SQL rather than summed at the
edge.

Scenario: Every aggregate is computed in SQL

Given `world_projections` and `job_projections` are populated
When the gateway relays `queries.analytics.overview.get.v1`, `world.list.v1`,
`job.list.v1` or `timeseries.get.v1`
Then `analytics-service` answers using `QueueSubscribe` with the
`analytics-service-v1` queue group
And every response is paginated, including `world.list`, given the 2500ms
request/reply deadline
And the gateway performs no summation or grouping of the returned rows.

Source evidence:
- agent-system/plans/services/analytics-service-plan.md — §Query contract
- agent-system/plans/services/analytics-service-plan.md — §Phases, Phase 3

Tasks:
- [x] Implement the four query subjects and their SQL aggregates.
- [x] Add mandatory pagination to every list/aggregate response.
- [x] Add the `analytics-service-v1` queue group and `QueueSubscribe` wiring.

### S4-ANALYTICS-005 — Wire gateway admin routes to analytics

Status: Implemented — `feat/be/analytics-service`
Priority: P0

As a staff member,
I want `/api/admin/*` read routes to call `analytics-service` instead of
fanning out to universe/nature/dna,
so that an admin page only ever waits on analytics and auth, never on a
domain service.

Scenario: Admin reads touch only two services

Given a staff member requests any admin read screen
When the gateway handles `/api/admin/*`
Then it verifies the token (locally, or via `auth-service` on a cache miss)
and queries `analytics-service` only
And no domain service (dna/universe/nature) receives any request on this path
And this replaces `auth-and-admin-plan.md`'s original admin-query-subjects
phase rather than adding to it.

Source evidence:
- agent-system/plans/services/analytics-service-plan.md — §Admin request path
- agent-system/plans/services/analytics-service-plan.md — §Changes this forces in auth-and-admin-plan.md
- agent-system/plans/services/analytics-service-plan.md — §Phases, Phase 4

Tasks:
- [x] Bind `/api/admin/*` read routes to the analytics query subjects.
- [x] Do not build the `auth-and-admin-plan.md` phase-4 domain-service aggregate subjects.
- [x] Add a gateway-level test proving no domain-service subject is published on this path.

### S4-ANALYTICS-006 — Deploy analytics-service

Status: Config landed on `feat/be/analytics-service`; the Neon database, the
Render env vars and the managed-NATS ACL block are manual steps still
outstanding — runbook in `services/analytics-service/README.md`
Priority: P0

As a platform operator,
I want `analytics-service` in the production deployment topology,
so that the read model exists outside local development.

Scenario: Production topology includes analytics-service

Given `render.yaml` and a Neon database budget
When phase 5 deploys
Then `myunivokai-analytics` runs alongside the existing fleet with its own
Neon database (or shares a project per the documented fallback)
And the analytics NATS user block from the plan is added to
`nats-server.conf`
And `contracts/openapi-admin.yaml` gains the analytics-backed admin route
entries.

Source evidence:
- agent-system/plans/services/analytics-service-plan.md — §Phases, Phase 5
- agent-system/plans/services/analytics-service-plan.md — §What this costs

Tasks:
- [x] Add the analytics NATS user block to `nats-server.conf`.
- [x] Add the `render.yaml` service entry and Neon database — verify the account's instance-hour and project limits first.
- [x] Add the admin OpenAPI entries for the analytics-backed routes.

### S4-ANALYTICS-007 — Ship admin analytics screens

Status: Implemented — `feat/be/analytics-service`
Priority: P0

As a staff member,
I want a dashboard, a worlds table and a jobs table in the admin app,
so that I can see business and job-health data without querying any database
directly.

Scenario: Render the dashboard and record tables from analytics only

Given the admin app shell and the analytics query subjects both exist
When a staff member with `chart:read` and `world:read` opens the admin app
Then the dashboard renders totals per family, failure rate, publish rate and
archetype/style distribution
And the worlds table and jobs table use cursor pagination against
`analytics-service`
And this delivers the record-list and chart work described in
`auth-and-admin-plan.md`'s original phases 5–6, superseded to read from
analytics instead of a domain-service fan-out.

Source evidence:
- agent-system/plans/services/auth-and-admin-plan.md — §Charts
- agent-system/plans/services/analytics-service-plan.md — §Phases, Phase 6

Tasks:
- [x] Build the dashboard screen (totals, failure rate, publish rate, distributions).
- [x] Build the worlds table and jobs table with TanStack Table and cursor pagination.
- [x] Wire TanStack Query against the analytics query subjects only.

# Auth service and internal admin app — plan

> **Document status:** Implemented. `services/auth-service`,
> `apps/myunivokai-admin` and the gateway's `/api/admin` route group all exist;
> `services/analytics-service` supplies the read path. This document remains the
> design record for identity, RBAC and the admin route group.
> **Last source review:** 2026-08-07
> **Scheduled:** [Sprint 4](../sprints/sprint-04-2026-08-06/README.md), as
> `EPIC-S4-AUTH-001` — first in the owner's priority order.
> **Amended:** 2026-08-05 by the owner — see [Owner amendments](#owner-amendments--2026-08-05).
> Three decisions in the original draft were reversed; the sections they touch
> are marked **Amended** and state the current decision.
> **Decisions:** all seven answered 2026-08-05 — see
> [Owner decisions](#owner-decisions--answered-2026-08-05). Phase 1 is unblocked.
> **⛔ Read path: SUPERSEDED, and the gateway fan-out was never built.** The
> owner chose Option B, and it shipped as `services/analytics-service` — see
> [analytics-service-plan.md](analytics-service-plan.md). Three parts of this
> document are dead letters and are marked in place below: §Where the fan-out
> lives, §Partial results are a normal response, and phase 4's aggregate
> subjects. They are kept, not deleted, because the reasoning that led to
> rejecting them is the reason the read model looks the way it does. Do not
> implement any of the three.

Two new deliverables, deliberately kept apart from the 3D product:

1. **`services/auth-service`** — identity for staff now, built so end-user login
   on the 3D web later is a configuration and policy step, not a rewrite.
2. **`apps/myunivokai-admin`** — an internal app for browsing and managing
   records, plus charts. Admin accounts only. No 3D, no public pages.

Nothing in the 3D web changes. The existing gateway gains an admin route group
that is organised and protected separately from the product routes.

## Owner amendments — 2026-08-05

Recorded after the original draft. Each reverses a decision above; the original
reasoning is kept in place so the trade-off accepted here stays visible.

| # | Original draft | Owner decision |
| --- | --- | --- |
| 1 | A separate `services/admin-gateway` is the only public admin edge | **One gateway.** The admin app calls the existing `api-gateway`, which relays over NATS exactly as the 3D web does. Admin lives in its own route group with its own middleware stack |
| 2 | Four fixed roles in a static table | **Dynamic RBAC, modelled on Django auth.** Roles and permissions are database rows that staff can create at runtime, with a flag marking system-owned rows such as super admin and basic user |
| 3 | End-user login is a later, separate question | **Design for it now.** The RBAC and token model must extend to 3D-web accounts so a visitor can log in and keep the history of worlds they created |

Amendment 3 has a consequence the original draft deliberately guarded against,
and it is written down here rather than discovered later: *"a visitor keeps the
history of worlds they created"* is **world ownership**, which is the subject of
[`DEFERRED-AUTH-001`](../backlog/engineering-backlog.md#deferred-auth-001--define-identity-before-authentication).
The draft forbade an `owner_account_id` column precisely so ownership could not
be decided by accident.

The guardrail is therefore restated rather than removed:

- Staff phases (1–3) still add **no** ownership column. Nothing about them
  pre-decides the question.
- The RBAC and token design must not *block* ownership either — that is what
  amendment 3 asks for, and audience-scoped tokens plus a role model with no
  staff assumptions baked in already satisfy it.
- Adding `owner_account_id`, anonymous claim/migration, deletion and export
  remains its own decision with its own approval, taken when the product
  questions in `DEFERRED-AUTH-001` are answered — not as a side effect of
  building staff auth.

In short: build so ownership *can* arrive; do not let it arrive unannounced.

## Scope

**In scope now**

- Staff login, logout, refresh, password change, account disable.
- RBAC: roles, permissions, server-side enforcement, audit trail.
- Record browsing: worlds, variants, DNA jobs, profiles, share slugs.
- A small set of operational mutations, each audited.
- Charts on business and job-health data.

**Explicitly not now**

- End-user login on the 3D web — see the next section.
- World ownership, anonymous claim/migration, deletion/export.
- Infrastructure metrics dashboards. Consumer lag and ack latency belong to
  Sprint 2's ops tooling, not to a product admin app. Overlapping the two makes
  the admin app a second, worse Grafana.
- Single sign-on, social login, organisations, billing.

## Why this does not violate DEFERRED-AUTH-001

[`DEFERRED-AUTH-001`](../backlog/engineering-backlog.md#deferred-auth-001--define-identity-before-authentication)
defers authentication until issuer, account mapping, **object ownership**,
anonymous claim/migration, public share, and deletion/export are approved. That
deferral is about *visitors owning worlds*. Every one of its open questions is a
question about ownership.

Staff identity does not touch ownership. An admin never owns a world; the admin
reads and administers records that already exist and already have no owner. So
staff auth can ship while the visitor-identity questions stay open — provided
the token design does not quietly pre-decide them. Two rules keep that promise:

- **No `owner_account_id` column anywhere** until DEFERRED-AUTH-001 is approved.
  The moment a world points at an account, ownership has been decided by
  accident.
- **Audience-scoped tokens from day one.** A staff token carries
  `audience: "admin"`; a future visitor token carries `audience: "web"`. Each
  edge accepts exactly one audience. Without this, the first end-user token ever
  issued is also a valid admin token.

`accounts.kind` is `staff` from the start, with `end_user` reserved. That is a
column value, not a decision about what an end user may own.

## The hard problem: three services own the data

This is the part to get right before writing any code. Today:

- `myunivokai_dna`, `myunivokai_universe`, `myunivokai_nature` are separate
  databases with **no cross-database foreign keys**, and nothing may read
  another service's tables ([be/source-overview.md](../../knowledge/backend/source-overview.md)).
- The only read path is Core NATS request-reply through the gateway, and every
  existing query is **by id**. There is no list, no search, no aggregate.

An admin app is the opposite shape: list everything, filter, sort across
families, count per day. Three ways to get there.

| Option | How | Verdict |
| --- | --- | --- |
| **A. Admin query subjects** | Each domain service gains list/search/aggregate subjects over its own database; the admin edge fans out and merges | **Start here** |
| **B. Read-model service** | A new `admin-service` consumes existing outbox events into its own denormalised database | Later, on a trigger |
| **C. Direct database access** | Admin app reads all three databases | **Rejected** |

**Why A first.** At current volume `SELECT date_trunc('day', created_at), count(*)`
on each family database is milliseconds, and A adds no new database, no
eventual consistency, and no backfill of existing rows. It also keeps every
table behind the service that owns it, which is the rule the whole backend was
built around.

**Why B is not premature.** The pieces already exist — outbox, inbox,
JetStream — so B is a read model, not new architecture. Adopt it when one of
these becomes true, and not before:

- a screen needs a join across two family databases that the edge cannot merge;
- aggregate queries reach a measured p95 the owner is unwilling to pay on the
  production database;
- a chart needs history the source tables do not retain.

Building B first costs a backfill path, a second source of truth for every
record, and "why does admin show 41 and the database show 42" for the rest of
the project's life.

**Why C is rejected.** Not because of purity. A schema change in
`universe-service` would silently break admin, and the failure surfaces as a
wrong number on a chart rather than a failing test in the service that changed.
It also hands one credential read access to every visitor's personal text.

**Cross-family pagination.** Two databases cannot share an offset. The contract
is a **cursor per family** — `{universe: cursor, nature: cursor}` — merged by
`createdAt` in the edge. Say this in the contract now; retrofitting it after a
UI is built against page numbers is a rewrite of both ends.

### Where the fan-out lives, and the line it may not cross

> **⛔ SUPERSEDED — not built.** The extraction trigger this section defines
> fired before any of it was written: the gateway composes nothing for admin,
> and `analytics-service` is the extracted aggregator. Kept as the record of
> why a dedicated read model was worth building.

Option A puts composition in the gateway rather than in a dedicated aggregator.
That is deliberate, and it is the position the published patterns support — but
only up to a specific line, so the line is written here rather than left to
judgement in review.

Microsoft's [Gateway Aggregation
pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/gateway-aggregation)
documents exactly this shape and then bounds it: the approach "works well when
the gateway performs **lightweight composition, shaping, and response
assembly**", and when aggregation "requires custom domain logic, complex
transformations, or longer-running orchestration", that work belongs in "a
dedicated custom service behind the gateway". The same page lists placing an
aggregation service behind the gateway as the alternative to building it in.
Thoughtworks holds
[overambitious API gateways](https://www.thoughtworks.com/radar/platforms/overambitious-api-gateways)
for the same reason — "any domain smarts should live in applications or
services" — which is the *smart endpoints, dumb pipes* rule this backend already
follows.

| The gateway may | The gateway may not |
| --- | --- |
| Fan out to the family services in parallel | Run `GROUP BY` over raw rows from more than one service |
| Interleave per-family lists by `createdAt` | Join across families on a business rule |
| Sum counts the owning services already computed | Decide which records qualify for a statistic |
| Carry a cursor per family | Transform payloads according to domain logic |

This is why the domain services expose **aggregate** subjects and not just list
subjects: `GROUP BY date_trunc(...)` runs where the data lives, so the gateway
only ever merges. Shipping raw rows to the edge to be counted there is the first
step across the line, not an optimisation.

**Chosen for this project because it is also the cheapest topology here.** A
dedicated aggregator would make the path
`admin app -> gateway -> admin-service -> family services` — one more NATS hop on
every request, and one more free-plan service that sleeps. That is the same cost
already rejected when per-request auth verification was rejected, and the same
reason one gateway was chosen over two edges.

**Extraction trigger.** Split an `admin-service` out when the gateway needs
domain logic to answer a screen — when *call, interleave, sum already-computed
numbers* is no longer enough. At that moment the gateway has become that service
without a name or tests of its own. This sits alongside the three triggers for
option B above; any of the four is sufficient.

### Partial results are a normal response, not an error

> **⛔ SUPERSEDED — not built.** This requirement existed because API
> Composition makes availability multiplicative across four sleeping services.
> A read model deletes the problem rather than handling it: an admin query now
> touches one database, so there is no partial answer to envelope. The
> requirement still stands for any future product-side fan-out.

This is a requirement, not a refinement, and the free plan is why. Composition
makes availability multiplicative — the
[API Composition pattern](https://microservices.io/patterns/data/api-composition.html)
is explicit that overall availability falls as providers are added — and these
providers sleep after roughly fifteen minutes of inactivity. An admin who signs
in rarely will therefore find one or more family services cold on almost every
visit. Fan-out is parallel, so the wait is the slowest leg rather than the sum,
but if a screen needs every leg to succeed then one sleeping service blanks the
whole page.

The Azure guidance is to make that behaviour an explicit decision: it "might be
acceptable to time out and return a partial set of data", and the choice must be
explicit "so that clients experience predictable behavior". So:

- Every admin list and aggregate response carries **per-family status**, and a
  missing family is data rather than a failed request:
  `{universe: {data: [...]}, nature: {status: "unavailable", reason: "timeout"}}`.
- The admin app renders what arrived and says plainly which family did not,
  with a retry. It never blanks a page because one service was asleep.
- Per-leg timeout, and a circuit breaker so a cold service is not hammered by a
  page that retries.
- The correlation ID already carried by
  [`RequestContext`](../../../services/api-gateway/internal/middleware/request_context.go)
  propagates across every leg, so a partial response can be explained after the
  fact.
- Counts computed from a partial fan-out are **labelled partial in the response**
  and in the UI. A total that silently omits a family is worse than no total.

## Target topology

```text
admin browser
  -> apps/myunivokai-admin        (Next.js, own domain, httpOnly cookies)
       -> services/api-gateway     /api/admin/*  (its own route group)
            -> auth.*.v1                    Core NATS  -> auth-service -> myunivokai_auth
            -> universe.admin.*.v1          Core NATS  -> universe-service
            -> nature.admin.*.v1            Core NATS  -> nature-service
            -> dna.admin.*.v1               Core NATS  -> dna-service

myunivokai-personalization (3D)  ->  services/api-gateway  /api/{family}/*  ... unchanged
```

### Amended — one gateway, two route groups

The original draft argued for a separate `services/admin-gateway`; the owner
chose a single gateway. The argument is kept below because what it was
protecting against is real, and the protection has to be rebuilt inside the one
edge rather than dropped.

> **Why a separate `admin-gateway` and not routes on the existing gateway.** They
> have opposite threat models. The admin edge wants an IP allowlist, strict rate
> limits, no CORS to any public origin, no cache, and the freedom to be taken
> offline during an incident without touching the product. Bolting it onto the
> public gateway means one misconfigured CORS entry or one route-matching mistake
> exposes admin surface to the internet, and every admin deploy risks the product
> edge. The cost is one more small Go service that reuses `internal/broker` and
> `internal/middleware` almost unchanged.

What the single gateway must do to keep that protection. Each line is a
requirement, not a preference:

- **A distinct `chi` sub-router mounted at `/api/admin`**, with its own
  middleware stack assembled separately from the product group. Not extra routes
  inside the existing group.
- **Its own CORS handler.** The product group's `AllowedOrigins`
  ([`router.go`](../../../services/api-gateway/internal/handlers/router.go)) must
  not reach the admin subtree. The admin group allows exactly one origin — the
  admin app's domain — and no wildcard is acceptable at any point.
- **Default deny, proven by test.** Every `/api/admin/*` route rejects an
  unauthenticated request, and a route with no declared permission refuses
  rather than falling through. A router test asserts this by enumerating the
  registered routes, so a new route added without a permission fails CI instead
  of shipping open.
- **Its own rate limits and no response caching**, independent of the product
  group's Redis policy.
- **No admin subject reachable from a product route**, and no product handler
  able to publish an `*.admin.*` subject. The NATS user the gateway already
  holds gains admin publish permissions, which is the one real cost of this
  amendment: a compromised gateway now reaches more subjects than before.
- **An `ADMIN_ROUTES_ENABLED` switch**, so the admin surface can be taken
  offline during an incident without redeploying the product edge — the one
  property the separate service gave for free.

The IP allowlist from the original argument is **not adopted** — the owner
decided staff log in from anywhere (decision 1). It stays enforceable at the
admin route group if that ever changes, and it is the one requirement that would
justify splitting the edge back out, since the product routes could not tolerate
it.

## auth-service

A NATS worker like the family services — no HTTP listener, no published port.
Owns `myunivokai_auth`.

**Its boundary.** auth-service handles identity and nothing else: it never reads
a world, a variant or a job. But listing accounts, roles and audit events *is*
its own data, so those queries belong here and are not scope creep. "Only auth"
constrains which tables it touches, not whether it may answer questions about
them.

### Tokens

**Short-lived access JWT plus rotating opaque refresh token.**

| | Choice | Reason |
| --- | --- | --- |
| Access token | JWT, Ed25519 (`EdDSA`), 10 minute expiry | Every edge verifies locally with a public key. No network hop per request, and login still works when `auth-service` is cold — Render's free plan makes cold starts routine |
| Access claims | `subject`, `roles`, `audience`, `tokenVersion`, `expiresAt` | Roles, not permissions: a permission list grows and a stale token must not carry it |
| Refresh token | 32 random bytes, stored hashed, single use, rotated on every refresh, 14 day expiry | Rotation makes theft detectable — a reused token invalidates the whole family |
| Transport | `httpOnly`, `Secure`, `SameSite=Lax` cookies; refresh cookie scoped to the refresh path | An admin panel with a token in `localStorage` turns any XSS into full takeover |

**Revocation.** Disabling an account or changing a password bumps
`accounts.tokenVersion`. Refresh checks it; access tokens do not. The window is
therefore **up to 10 minutes**, stated here so nobody discovers it during an
incident. Anything shorter needs a per-request check against auth-service and
gives up the cold-start property above.

**Reopened 2026-08-05.** The owner instructed that authentication must go
through auth-service, and that both an access token and a refresh token are
mandatory. The second half was never in doubt — auth-service is the only issuer
of either token, and no other component may mint one. The first half is a real
fork, because *issuing* and *verifying* are separate questions:

| | Verification | Revocation | Cost when auth-service is asleep |
| --- | --- | --- | --- |
| **A. Per-request call to auth-service** | Gateway asks auth-service on every request | Immediate | **The whole panel is unusable** until it wakes — not just login. Every navigation pays the cold start |
| **B. Local verify + revocation state in Redis** | Gateway verifies the signature locally, then checks `tokenVersion` in Redis, which auth-service writes on disable or password change | Immediate | None. Redis is always awake, and the gateway already holds a Redis client |
| **C. Local verify only** | Signature and expiry only | Up to 10 minutes | None |

**Resolved: B.** It satisfies the instruction — auth-service remains the issuer
of both tokens and the sole authority over revocation state — while keeping the
property decision 4 depends on.

`A` was rejected on a cost the cold-start argument understates. An admin request
is already `gateway -> NATS -> domain service`; adding
`gateway -> NATS -> auth-service` in front of it makes **two** round trips where
there was one, on every request, warm or cold. That is a permanent doubling of
admin API latency, not merely a cold-start penalty.

### How B works

Access claims already carry `tokenVersion`. Revocation compares the claim against
the current value:

- auth-service writes `<prefix>:auth:tokenversion:<accountId>` to Redis whenever
  it bumps the version — account disabled, password changed, or all sessions
  revoked — and seeds it at account creation. TTL longer than the maximum refresh
  lifetime, so a live session can never outlive its key.
- The gateway verifies the Ed25519 signature and expiry locally, then reads that
  key. Claim below the stored value means revoked; the request is refused.
- **On a cache miss the gateway asks auth-service once** and repopulates the key.
  A miss must never be read as "not revoked", or expiring a key would silently
  restore every token it protected.
- If Redis is unavailable the gateway falls back to asking auth-service per
  request: correct and secure, merely slow. Admin requests already depend on
  Redis for rate limiting, so this is a degradation the edge cannot avoid rather
  than one this design introduces.

The common path is a local signature check plus one Redis read. The revocation
window is effectively zero, and auth-service is only on the request path for
login, refresh, logout and a cache miss.

**Key handling.** Private key in the environment, never in git. Publish the
public key by value to the edges. Support two active public keys so rotation
does not log everyone out.

### Passwords

- **Argon2id** (`golang.org/x/crypto/argon2`, `argon2.IDKey`), 16-byte salt,
  32-byte key, parameters stored per row so they can be raised later.
- Free-plan instances have 512 MB of RAM. Do **not** start at 64 MiB per hash —
  a handful of concurrent logins will exhaust the instance. Start at the OWASP
  minimum (about 19 MiB, 2 iterations, 1 lane), cap concurrent verifications,
  and raise the cost only after measuring on the real instance size.
- No self-signup, ever. The first account comes from a bootstrap command that
  requires an operator-supplied password and forces a change on first login.
  **No default password in the repository**, not even a local-only one.
- Fixed per-account and per-IP attempt limits with lockout, and a constant-time
  response whether or not the account exists.

### Account creation is direct, not invited

Owner decision, 2026-08-12: staff account creation skips email entirely. An
admin (`account:manage`) sets the new account's email, password and roles in
one call, and the account is active immediately — no token, no second step.

The token-based invite flow (`InviteCreateData`/`InviteAcceptData`,
`AuthInviteCreateQuerySubject`/`AuthInviteAcceptQuerySubject`) was built
first and still compiles and works, but the admin app never grew a page that
calls `AcceptInvite` — there was nowhere to redeem the token it handed out,
which is exactly the confusion that triggered this decision. Rather than rip
the invite columns and endpoints out now, they stay dormant: cheap to keep,
and the natural foundation if a real email-invite flow gets built later. The
admin UI's only account-creation entry point calls `AccountCreateData`
(direct) — see `CreateAccountDialog.tsx` and
`AuthService.CreateAccount`/`UpdateAccount` in role_management_service.go.

An admin-set password still goes through the same 12-character minimum as
the bootstrap account, so a "simple" creation path doesn't become the weak
one.

### Schema

`accounts`, `roles`, `permissions`, `role_permissions`, `account_roles`,
`refresh_tokens`, `audit_events`.

Column detail for the RBAC tables — `is_system`, `audience`, and
`accounts.is_super_admin` — is in [RBAC](#rbac) rather than here, because
amendment 2 made their semantics the substance of the design rather than a
schema listing.

`audit_events` lives here because auth-service is the one service that knows who
the actor is. Every admin mutation and every login, failed login, role change
and reveal of personal data writes one row: actor, action, target, time, source
address, result. Written on the request path, not from a log tail.

## RBAC

### Amended — dynamic, modelled on Django auth

The original draft fixed four roles in this document. The owner chose runtime
management instead: roles and permissions are database rows, staff can create
them, and a flag marks the rows the system owns.

The Django model this follows, and the one line of it that matters most:
Django's `Permission` rows are **generated from code by migrations**, never typed
into the admin UI. `Group` (our role) is what an administrator actually composes.
That split is the difference between working authorization and a convincing
screen, because:

> A permission row that no route checks grants nothing. If staff can invent
> `world:teleport` in the UI, they have created a control that appears to be
> enforced and is not.

So the two halves are treated differently:

| | Who creates it | Why |
| --- | --- | --- |
| **Permissions** | **Declared in Go, synced into the table** at migration/startup. Staff read them, never invent them | Each one exists only because a route checks it. The table is a projection of code, exactly as in Django |
| **Roles** | **Created freely at runtime** by staff holding `role:manage` | Composing existing permissions is the flexibility that was actually wanted, and it cannot produce a lie |

Custom permission rows are not in scope for phase 1. If they are ever added,
they need a documented meaning and a route that consults them; until then the
sync is authoritative and prunes unknown rows.

**Amended 2026-08-14 — "each one exists only because a route checks it" was
not true, and is now stated rather than assumed.** Five of the thirteen declared
codenames — `world:unpublish`, `variant:read`, `job:retry`, `profile:read`,
`profile:reveal` — are checked by no route, and have been since S4-AUTH-005.
Nothing is insecure about that: a permission nobody consults grants nothing. It
is a *lie to the operator*, which is the exact failure this section's own
argument is built to avoid — the checkbox appears in the Roles dialog, a staff
member grants it, and the holder gains nothing.

`permission_sync.go` now splits the set into `enforcedPermissions` and
`reservedPermissions`, syncs the union exactly as before, and says so in each
reserved row's description, which the dialog renders under the checkbox.
Deleting them instead would have been worse than the problem: `SyncPermissions`
ends in `DELETE FROM permissions WHERE NOT (codename = ANY($1))`, so a codename
removed from Go is removed from production and from every role holding it on the
next boot, with nothing logged.

Two tests hold the two halves. `TestEveryAdminManagementRouteDemandsAPermission`
(gateway) refuses an authenticated account holding no permissions at every
`/api/admin` route, which is what catches a route mounted without a guard —
default-deny alone does not, since such a route still answers `401` to a
stranger while being readable by everyone who can log in.
`TestReservedPermissionsAreDeclaredDeliberately` (auth-service) pins the
reserved set, so the next codename with no route behind it has to be added on
purpose.

### Schema shape

`permissions` — `codename`, `description`, `audience`, `is_system`.
`roles` — `name`, `description`, `audience`, `is_system`.
`role_permissions`, `account_roles` — the two joins.

- **`is_system`** means: the row cannot be deleted and its `codename`/`name`
  cannot be changed. For a system *role*, its permission membership stays
  editable — `basic_user` is a policy default, and policy changes.
- **`audience`** (`admin` | `web`) is what makes amendment 3 cheap later. A role
  or permission scoped to `web` can never be granted on an `admin` token and the
  reverse, enforced in the same place that already checks the token's `audience`
  claim. Without this column, the first end-user role added becomes assignable
  to staff.

### Super admin is a bypass, not a role

`accounts.is_super_admin`, following Django's `is_superuser`: the permission
check short-circuits to allow. It is **not** a role that happens to hold every
permission.

The reason is recovery. A role that holds all permissions can be edited into a
role that holds none, and if that was the only path to `account:manage` the
system is unadministerable with no way back in. A bypass flag cannot be edited
away by a permission mistake.

Seeded system rows: `super_admin` is the flag; `basic_user` is a role with
`chart:read` and nothing else, so a newly created account is inert until roles
are granted deliberately.

### Lockout guards — enforced server-side, not in the UI

Every one of these is a way a real system gets bricked:

- The last account with `is_super_admin` cannot have the flag removed, and
  cannot be disabled.
- An account cannot revoke its own `account:manage` or `role:manage`.
- A role in use cannot be deleted; it must be unassigned first, and the response
  says how many accounts hold it.
- Deleting or editing a role writes an audit row **before** it takes effect.

### Permission strings

Verbs explicit on the resource, unchanged from the original draft plus the two
the amendments require:

```txt
world:read        world:unpublish     variant:read
job:read          job:retry
profile:read      profile:reveal      chart:read
account:read      account:manage      audit:read
role:read         role:manage
```

`role:manage` is separate from `account:manage` on purpose: granting roles and
editing what a role means are different amounts of power.

### Rules that decide whether this is authorization or decoration

- **Enforced at the admin route group, per route, default deny.** An unknown
  route and a route with no declared permission both refuse.
- The UI receives the caller's permission list **only to hide controls.** Hiding
  a button is not authorization; the edge check is.
- Roles resolve to permissions at the edge from a cached role map, so revoking a
  permission takes effect at the next request rather than the next token. With
  runtime-editable roles this matters more than it did: the cache needs an
  explicit invalidation on every role write, and a bounded TTL as a backstop.
- `profile:reveal` is separate on purpose. See Risks.

### What end-user accounts will need, so the schema does not get rewritten

Amendment 3 asks that a visitor can log in and keep the worlds they created.
That is **not** a role grant — it is an ownership check, and the two are
different mechanisms. Recording the distinction now:

- Staff authorization answers *"may this actor perform this verb?"* — roles.
- End-user authorization answers *"is this row theirs?"* — ownership, evaluated
  per object, in the owning service.

An end user therefore needs one `web`-audience role (`world:read:own`,
`world:write:own`) plus an ownership column the service checks. Roles alone
cannot express it, and stretching them to try is how object-level permission
tables become unmaintainable.

The ownership column itself still waits on `DEFERRED-AUTH-001`. What this
section fixes now is only that the grant model has an `audience` and a place for
an `:own` scope, so adding it later is additive.

## The admin app

`apps/myunivokai-admin` — its own Vercel project, its own domain, its own
`.env.example`.

| Choice | Version | Reason |
| --- | --- | --- |
| Next.js | 15, App Router | Server components keep the access token server-side; middleware is the natural default-deny gate. It also makes this app the **proving ground for the Next.js major upgrade** the 3D web already owes ([engineering-backlog.md](../backlog/engineering-backlog.md), Next.js 14 advisories) — the upgrade gets exercised somewhere no visitor can see it |
| React | 19 | Comes with Next 15 |
| TypeScript | strict, as in the 3D web | Same rules: no abbreviated names, no hardcoded magic values |
| Tailwind CSS | v4 | Already the styling language in this repo |
| shadcn/ui | current | Owned components, no runtime dependency on a component vendor |
| TanStack Query | v5 | Server state, retries, invalidation after mutations |
| TanStack Table | v8 | Sorting, filtering and cursor pagination on record lists |
| Recharts | current | Enough for these charts; swap to visx only if a chart needs custom rendering |

**Why not a Vite SPA.** Cookie-based auth wants a server, and an SPA would push
the access token into client JavaScript — the exact thing the cookie design
avoids.

Non-negotiable in this app:

- Every route requires a session. Middleware denies by default; the login page
  is the single exception.
- `noindex`, no sitemap, no share pages, no static generation of record data.
- **Zero imports from `apps/myunivokai-personalization`**, and no three.js. The only shared
  code is `contracts/`. Add a CI check for this — separation that is not tested
  is separation until the first deadline.

## Charts

From data the services already store, through the aggregate subjects of option A:

| Chart | Source |
| --- | --- |
| Worlds created per day, split by family | `worlds.createdAt` in each family database |
| Job outcomes over time — completed, failed, in flight | root jobs in `myunivokai_dna` |
| Time from accepted to completed, median and p95 | root job timestamps |
| AI provider mix, attempts per job, failure rate | provider attempts in `myunivokai_dna` |
| Variants per world, and how often a non-default variant is selected | variants per family |
| Publish rate — worlds that got a share slug | share slugs per family |

Every chart states its time zone and its bucket, and reads its range from the
query rather than a constant in the component.

## Extending to 3D-web login later

Amendment 3 makes this the direction rather than a possibility, so the list below
is the plan of record for it — not a sketch.

When DEFERRED-AUTH-001 is approved, the additional work is:

1. `accounts.kind = end_user`, self-signup, email verification, password reset.
2. `audience: "web"` tokens and a disjoint role set; the admin route group keeps
   rejecting them because it only accepts `audience: "admin"`.
3. Auth verification middleware on the product route group. Amendment 1 turns
   this from new code into **reuse**: the same gateway already verifies admin
   tokens, so this is a second group opting into the existing middleware with a
   different accepted audience.
4. The ownership decisions: `owner_account_id`, anonymous claim/migration,
   deletion and export — plus the `:own` permission scope noted in
   [RBAC](#what-end-user-accounts-will-need-so-the-schema-does-not-get-rewritten).

Steps 1–3 are additive, and amendment 1 makes step 3 cheaper than the original
draft assumed. Step 4 is the product decision that was deferred; building auth
now does not make it any easier to skip, and amendment 3 does not approve it.

## Phases

One branch each, per [git-convention.md](../../rules/git-convention.md).

| Phase | Branch | Delivers |
| --- | --- | --- |
| 0 | `feat/repo/auth-admin-contracts` | Subjects, JSON schemas, `contracts/openapi-admin.yaml` (separate file so the public spec never advertises admin routes), this plan approved |
| 1 | `feat/be/auth-service` | auth-service, `myunivokai_auth`, login/refresh/logout, Argon2id, bootstrap admin, audit events, the code-declared permission sync, seeded `super_admin` flag and `basic_user` role, lockout guards, tests |
| 2 | `feat/be/gateway-admin-routes` | The `/api/admin` route group on the existing gateway: token verification, default-deny route policy with the enumerating router test, own CORS handler for one origin, own rate limits, `ADMIN_ROUTES_ENABLED` switch |
| 3 | `feat/fe/admin-app-shell` | Next.js 15 app, login, session, RBAC-aware navigation, one record list end to end |
| 4 | `feat/be/admin-query-subjects` | List/search/aggregate subjects in dna, universe and nature, each aggregating inside the owning service; cursor-per-family pagination; the per-family partial-status envelope with per-leg timeouts |
| 5 | `feat/fe/admin-records` | Record lists and detail views, first audited mutations |
| 6 | `feat/fe/admin-charts` | The chart set above |
| 7 | `feat/be/auth-hardening` | Invite flow, account and **role management** UI, lockout tuning, key rotation drill. TOTP two-factor available here but not required — see decision 3 |
| 8 | `feat/repo/admin-deployment` | `render.yaml` entry for auth-service, gateway env additions, Vercel project, secrets, runbook |

Phases 1–3 are the smallest set that produces a usable panel: log in, see
records, nothing else. Ship that before phase 4 widens the query surface.

## Risks

**The admin panel becomes the highest-value target in the system.** It can read
every visitor's raw self-description — the most personal text the platform
holds. Mitigations, all of them in the design above rather than bolted on:
`profile:reveal` as its own permission, raw input masked by default, an audit
row per reveal, and no bulk export of personal text in phase 1.

**Cold starts.** Render's free plan sleeps. Stateless access-token verification
means a sleeping auth-service does not block navigation, only login and refresh.
Accept it internally, or pay for a warm instance before staff rely on it.

**Scope creep into content management.** "While we are here, let us edit worlds
from the admin panel" turns a read-mostly tool into a second write path into
deterministic data. Any mutation must go through the owning service's existing
rules, and any mutation that would break determinism does not get built.

**A second auth implementation.** If the 3D web later grows its own session
handling instead of using this issuer, there are two systems and one of them is
wrong. The audience claim exists so there never needs to be a second issuer.

**One gateway means one blast radius** (amendment 1). A gateway deploy now risks
both the product and the admin surface, an admin route bug can exhaust a process
the product shares, and the gateway's NATS credential now carries admin publish
permissions. The mitigations are the route-group requirements above — separate
CORS handler, separate rate limits, the enumerating default-deny test, and the
`ADMIN_ROUTES_ENABLED` switch. If the admin surface later needs an IP allowlist
that the product cannot tolerate, splitting the edge back out is the escape
hatch, and nothing in this design prevents it.

**Runtime-editable roles can be edited into a broken state** (amendment 2). This
is the cost of the flexibility that was asked for. The lockout guards and the
super-admin bypass flag are what keep it recoverable; they are requirements, not
polish, and phase 1 is not done without them.

## Owner decisions — answered 2026-08-05

Phase 1 is unblocked. Each answer and what it settles:

| # | Decision | Answer |
| --- | --- | --- |
| 1 | Admin domain and IP allowlist | **No allowlist.** Staff log in from anywhere; admins use the panel rarely. Separate domain still assumed |
| 2 | Revocation window | **Effectively zero.** Local signature verification plus a `tokenVersion` read from Redis that auth-service owns (option B). Per-request calls to auth-service rejected — they would double admin API latency permanently. See [Revocation](#tokens) |
| 3 | Two-factor | **Not required.** TOTP stays in phase 7 as available work, not a prerequisite |
| 4 | Warm instance | **Accept cold starts.** No paid instance for auth-service |
| 5 | App name | **`apps/myunivokai-admin`** |
| 6 | Custom permission rows | **Out of scope.** Permissions are declared in Go and synced; roles stay freely creatable |
| 7 | Who may edit roles | Not separately answered. With one operator, `role:manage` sits with the super admin in practice; the guards are built as specified regardless, because they cost little and a second staff member changes the answer |

### Legacy worlds without an owner

Also decided: worlds that already exist may become the super admin's or stay
empty — the owner accepted either. **They stay `NULL`**, for two reasons:

- `NULL` is true. These worlds have no owner, and recording one fabricates a
  fact that later queries will trust. A claim flow, if it is ever built, needs
  to distinguish *never owned* from *owned by someone*, and assigning them
  destroys that distinction irreversibly.
- If ownership ever grants read access to a world's source material, making one
  account the owner of every historical world hands it a path to every
  visitor's personal text that bypasses `profile:reveal` and its audit row.

This is a note on direction, not an approval to add the column — see
[Owner amendments](#owner-amendments--2026-08-05).

### Accepted risk: password-only admin access

Decisions 1 and 3 together mean a password is the only barrier to a panel that
can read the most personal text the platform holds. Recorded as accepted, not
overlooked. The compensating controls were already in this design rather than
added in response:

- Operator-supplied bootstrap password, forced change on first login, and no
  default password anywhere in the repository.
- Per-account and per-IP attempt limits with lockout, constant-time response.
- Argon2id, tuned for the real instance size.
- `httpOnly` cookies, so XSS cannot lift a token.
- `profile:reveal` as its own permission, raw input masked by default, an audit
  row per reveal, and no bulk export of personal text in phase 1.

The residual exposure is a guessed or reused password, and TOTP in phase 7 is
the answer if that becomes a real concern.

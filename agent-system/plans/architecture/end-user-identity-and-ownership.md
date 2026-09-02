# End-user identity and world ownership

> **Document status:** Proposed. **No code exists.** Twenty numbered decisions
> (25 rows, counting the five amendments `4b`, `17b`, `20b`, `20c` and `20d`)
> were taken on 2026-09-02 across **eight rounds** — most by the owner, five
> delegated to me and argued in place — and all of them are recorded in §16,
> where **nothing is left open**. Four of the last five rounds exist because
> the owner read a decision back and found it wrong, too broad, or badly
> named: `17b`, `20b`, `20c` and `20d` are corrections, narrowings and
> renamings rather than additions, and they are marked as such rather than
> quietly folded in. Several
> decisions cut scope rather than adding it, so read §16 before any other
> section: it supersedes parts of §3.4, §5, §9, §10, §11 and §17 in place.
> **Scheduled:** [Sprint 08 — starts 2026-09-02](../sprints/sprint-08-2026-09-02/README.md),
> as [`EPIC-S8-IDENTITY-001`](../backlog/engineering-backlog.md#epic-s8-identity-001--end-user-identity-and-world-ownership).
> The sprint covers Phases A-C; Phase D and Phase E are explicitly out of its
> scope.
> **Raised:** 2026-09-02 by the owner
> **Last source review:** 2026-09-02
> **Answers:** [`DEFERRED-AUTH-001`](../backlog/engineering-backlog.md#deferred-auth-001--define-identity-before-authentication),
> deferred by owner decision on 2026-07-22 and never revisited.
> **Graduates:** [`evolution/platform-evolution-research.md` Track A](../../evolution/platform-evolution-research.md#track-a--end-user-identity-and-world-ownership),
> **with four corrections** — §3 of this document. The research is still the
> argument for *why*; this plan is the contract for *what*.

This is a platform mechanism, not a service: it changes `auth-service`,
`dna-service`, three family services, the gateway, the NATS ACLs, the web app
and the deployment surface. It sits beside
[`service-wake-mechanism.md`](service-wake-mechanism.md) and
[`frontend-gateway-consolidation.md`](frontend-gateway-consolidation.md) for
that reason.

---

## 1. The one-paragraph version

Two thirds of end-user identity is already built and shipped, because Sprint 4
built staff identity as **one half of a deliberately two-audience design**:
`accounts.kind` already admits `'end_user'`, roles and permissions already carry
an `audience` of `'admin' | 'web'`, access tokens already carry an audience
claim, and the gateway's admin middleware **already rejects a `web` token** —
with a test that pins it. What does not exist is: a self-signup path, anything
that sends an email, an owner column on any world, and any notion in the web app
of a person rather than a browser. Today "my worlds" is a list of UUIDs in
`localStorage`, capped at 50, and a cleared browser is a permanently lost world.

The work is therefore smaller than it looks. The 2026-09-02 decisions (§16)
cut it further by deferring email and OAuth entirely and by declining to build
account deletion — leaving **a web app that has never had a session** as the
largest remaining piece, and the AI quota as the most valuable one. The session
is deliberately *not* a cookie here, and §4.1 says why.

---

## 2. What already exists, verified against source on 2026-09-02

The plan's credibility rests on this table. Every row was read, not assumed.

| Capability | State | Evidence |
| --- | --- | --- |
| `accounts.kind` = `'staff' \| 'end_user'` | **Shipped**, `NOT NULL`, `CHECK`-constrained | [`000001_init.sql:8`](../../../services/auth-service/migrations/000001_init.sql) |
| Roles/permissions scoped by `audience` (`'admin' \| 'web'`) | **Shipped**, `CHECK`-constrained on both tables | `000001_init.sql` `permissions`, `roles` |
| `AccountAudienceWeb` contract constant | **Shipped**, declared and validated | [`contracts_auth.go:34,60`](../../../contracts/go/contracts_auth.go) |
| Access token carries `audience` + `tokenVersion` | **Shipped**, Ed25519 (EdDSA) JWT | [`tokens.go:20-60`](../../../services/auth-service/internal/security/tokens.go) |
| A `web` token is rejected by the admin edge | **Shipped and tested** | `admin_auth.go` `claims.Audience != AccountAudienceAdmin`; [`admin_auth_test.go:90`](../../../services/api-gateway/internal/middleware/admin_auth_test.go) |
| Argon2id hashing, lockout (5 attempts / 15 min) | **Shipped** | `internal/security/password.go`, `config.go:30-31` |
| Refresh rotation with family-wide reuse detection | **Shipped** | `refresh_tokens.family_id`, `000001_init.sql` comment |
| Instant revocation via Redis `tokenVersion` | **Shipped** | `accounts.token_version`; `internal/admin/auth/revocation.go` |
| Audit table | **Shipped** | `postgres_audit.go` |
| httpOnly · Secure · SameSite=Lax session cookies | **Shipped** for staff | [`admin_auth_handler.go:125-142`](../../../services/api-gateway/internal/handlers/admin_auth_handler.go) |
| Refresh cookie path-scoped to the two routes that need it | **Shipped** | `adminAuthCookiePath = "/api/admin/auth"` |
| A Next.js BFF relay that makes gateway cookies first-party | **Shipped** for admin | [`auth-relay.ts`](../../../apps/myunivokai-admin/src/lib/auth-relay.ts) |
| Enumerating router test that fails the build on an unguarded route | **Shipped** for admin | `admin_router_test.go` |
| **Self-signup** | **Does not exist anywhere** | `auth-service/README.md`: "no self-signup exists anywhere in this service" |
| **Any email being sent** | **Does not exist.** Invite tokens are relayed by hand | `auth-service/README.md` §Invite flow |
| **`owner_account_id` on anything** | **Does not exist** | no such column in any of the 8 migration sets |
| **A per-caller AI quota** | **Does not exist.** The only defence is a per-IP token bucket | `rate_limit.go:42`, `<prefix>:rate:<routeKey>:<clientIP>` |

### What "ownership" is today

There is none. There is a capability URL and a browser-local list:

- `worlds.profile_id` is the **DNA profile**, not a person.
- The gallery is hydrated by `GET /api/{family}/worlds?ids=a,b,c`, capped at
  **50** ids per call ([`world_handler.go:24`](../../../services/api-gateway/internal/handlers/world_handler.go)).
- The id list lives in `localStorage` under `myunivokai.savedWorldIds`
  ([`savedWorlds.ts:3`](../../../apps/myunivokai-web/src/lib/savedWorlds.ts)).
- Therefore **anyone holding a world UUID can read that world**, and a visitor
  who clears their browser loses every world they made. Both are facts about
  the product today, and the second is the strongest product argument for this
  plan.

### What this plan overrides if it is approved

Two statements in the current approved baseline are contradicted by this
document, and approving it means changing them in
[`README.md`](README.md) in the same change:

- **Principle 9 — "No placeholder auth for end users. Product authentication
  stays deferred."** The first clause survives and is in fact the point: this
  is not a placeholder. The second clause ends.
- **Decision D19 — "User auth remains out of scope; internal trust uses NATS
  credentials and subject permissions."** The second clause survives unchanged
  and is load-bearing in §6.4. The first is superseded.

Principle 10 ("admin reads never wake a domain service") is untouched: this
plan adds a *product* read that wakes `dna-service`, and product reads already
wake family services today.

### The deployment fact that changes the session design

`myunivokai-web` is hosted on **Vercel**; the gateway is a Render web service
(`render.yaml:26-28`, and the commented-out block above it). Those are two
different registrable domains, so a session cookie set by the gateway would be
a **third-party cookie** to the web app — blocked by default in Safari and
Firefox, and increasingly in Chrome. This single fact is why the product
session is a bearer token while the staff session is a cookie. §4.1.

---

## 3. Where this plan corrects Track A

The research is sound in its reasoning and wrong in four specifics, all of them
found by reading the NATS ACLs and `dna-service`'s schema.

### 3.1 `library-service` is not needed. `dna-service` already holds the link

Track A proposes an eighth service with a fifth database holding a
denormalised `world_ownership_projections` table, because "all worlds of user X"
needs a JOIN that cannot cross databases.

**But that JOIN already exists inside `dna-service`.** Every generation, in
every family, writes a row that names both sides:

```sql
-- services/dna-service/migrations/000001_init.sql
CREATE TABLE generation_jobs (
  job_id         TEXT PRIMARY KEY,
  family         TEXT NOT NULL CHECK (family IN ('universe', 'nature')),  -- + ocean, 000002
  profile_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  status         TEXT NOT NULL CHECK (status IN ('queued','processing','completed','failed')),
  world_id       UUID,
  ...
);
```

`profile_id` → `world_id` → `family`, for all three families, already durable,
already indexed by a primary key, already written on the path that creates
every world. Put `owner_account_id` on `profiles` and "my worlds" becomes one
keyset query in one service that is **already woken on every create**.

The research rejected this shape (its "pattern 1") for two reasons. Neither
survives contact with this variant:

- *"Pagination is not composable across N sources."* True, and irrelevant here:
  pagination happens in **one** source (`generation_jobs`). The families are
  then asked to hydrate **a page of ids** — a batch get, not a paginated query.
- *"One page load wakes two services, three once City lands."* The gallery
  **already** calls each family with `?ids=` and already wakes them. This adds
  `dna-service`, which is +1 wake once per gallery visit, against an eighth
  service, a fifth Neon database, a new NATS user, a new Render service, a new
  JetStream consumer, and the [retention trap](../../evolution/platform-evolution-research.md#the-retention-trap--and-it-applies-to-library-service-too)
  that consumer inherits.

**Recommendation: extend `dna-service`. Do not build `library-service`.** The
gateway may already publish `myunivokai.queries.>` and `dna-service` already
subscribes to `myunivokai.queries.dna.>` (`infra/nats/nats-server.conf:40,49`),
so the read path costs **zero ACL changes**.

Build `library-service` only when the gallery must be *server-rendered in one
query*, or sorted/searched across families on fields the family services own
(mood, archetype, style). Note that trigger in the plan and stop there.

One honest cost of this choice: `dna-service` holds the most sensitive data in
the platform (`profiles.raw_input`, `ai_generation_attempts.request_json`) and
now answers a visitor-facing query. The mitigation is the discipline the share
pages already follow — the response model returns `worldId`, `family`,
`createdAt`, `status` and nothing else, enforced by a test, exactly as
`internal/models/responses.go` keeps raw input out of a share.

### 3.2 The claim command cannot be published by the gateway

Track A's flow says the gateway "publishes one claim command per family". The
ACL does not allow that, and would not without change:

```conf
# infra/nats/nats-server.conf:40 — the gateway's entire publish allow-list
publish: ["$JS.API.>", "myunivokai.commands.dna.generate.v1", "myunivokai.queries.>",
          "myunivokai.events.gateway.service.started.v1", "myunivokai.events.telemetry.http.v1"]
```

The gateway may publish exactly **one** command subject, and it is DNA's.
`dna-service`, by contrast, may already publish into all three families
(`nats-server.conf:48`).

**Recommendation: the gateway publishes one claim command to `dna-service`, and
`dna-service` fans it out.** This is both cheaper in ACL surface and *better*,
because `generation_jobs` tells `dna-service` exactly which families that
anonymous visitor actually used — so the claim wakes one to three family
services instead of blindly waking all of them.

### 3.3 The anonymous id has to travel through `dna-service`, not around it

Track A says the gateway "puts it in the compose command". The gateway never
publishes a compose command; `dna-service` does, after the AI call. So the
identity fields ride the existing two-hop path:

`POST /api/{family}/worlds` → `commands.dna.generate.v1` (**+ `ownerAccountId`,
`anonymousId`**) → `dna-service` stores them on `profiles` → `commands.<family>.compose.v1`
(**+ `ownerAccountId`, `anonymousId`**) → the family service stores them on `worlds`.

Two contract additions, both additive and both nil-safe for messages already on
the stream.

### 3.4 `account.deleted` would require giving `auth-service` an outbox it deliberately does not have — and §10 decided not to need one

> `auth-service` … "Core NATS request-reply only, no JetStream command or
> outbox, since auth-service publishes no domain event."
> — `services/auth-service/README.md`

Its ACL matches: it may publish `_INBOX.>`, `$JS.API.>` and its own
`service.started` event, and nothing else (`nats-server.conf:94`). A GDPR
erasure that must reach six services **cannot** be a request-reply fan-out from
the gateway — a half-completed deletion is the failure mode that matters, and
only a durable event survives a service being asleep mid-erasure.

So account deletion would cost `auth-service` an `outbox_messages` table, an
outbox publisher, one new publish subject and an ACL line — a real change to a
property the service README states as a design fact.

**Superseded by the §10 decision of 2026-09-02, which is not to build account
deletion at all**: "deleting" an account is a staff member marking it inactive,
and `DisableAccount` already does that correctly today. So none of this cost is
paid, the README stays true as written, and no phase carries the work. The
finding is kept here because it is what a real erasure feature would cost the
day one is wanted, and because it is the kind of thing that gets re-proposed by
someone who has not read the ACL.

---

## 4. Session architecture

### 4.1 Decided 2026-09-02: the product session is a bearer token, not a cookie

**The owner's decision, and it is the right shape for this deployment.** The
web app keeps calling the gateway directly and login is an ordinary API call:
`POST /api/auth/login` returns the tokens in the response body, and the client
sends `Authorization: Bearer <access>` on the calls that need a session. A
login flow of its own for the product, disjoint from the admin one.

This is not the same design as the staff session, and the reason is the
deployment, not taste. Cookies were the right answer for admin and are the
wrong answer here:

| Web origin | API origin | Does a session **cookie** survive? |
| --- | --- | --- |
| `myunivokai.vercel.app` | `myunivokai-gateway.onrender.com` | **No.** Two different sites, so it is a third-party cookie: it needs `SameSite=None`, which Safari has blocked since 2020 and Firefox blocks by default. It would work in local dev and in some Chrome installs, and **fail silently on iPhones** |
| `myunivokai.com` + `api.myunivokai.com` | same site | Yes — but this requires buying and attaching a domain |
| A Vercel rewrite proxying `/api/*` to the gateway | same origin | Yes, config-only — but every world payload then flows through Vercel's edge |

The gateway is **already shaped for this**: the product route group already
admits the `Authorization` header
([`router.go`](../../../services/api-gateway/internal/handlers/router.go)
`AllowedHeaders`), so the bearer path needs **no CORS change, no cookie, no
domain purchase, and no BFF**. It is the cheapest correct option available
today.

### 4.2 Where the tokens live, and the one risk this accepts

**Decided 2026-09-02: the box is a cookie the client writes itself**, not
`localStorage` — a first-party cookie on the web app's own origin, set and read
by its own JavaScript, with the value put into the `Authorization` header by
hand. The browser's automatic cross-site attachment (§4.5) is the half that is
dropped, and it is the only half that was ever a problem.

| Token | Stored | Lifetime |
| --- | --- | --- |
| Access | cookie `myunivokai_access`, `path=/`, `SameSite=Lax`, `Secure` in production | **7 days** |
| Refresh | cookie `myunivokai_refresh`, same attributes | **3 months**, rotating |
| `anonymousId` | cookie `myunivokai_anonymous`, same attributes | 180 days (§7) |

None of these are `httpOnly` — a cookie written by JavaScript cannot be, by
definition. So the XSS exposure is **identical** to `localStorage`, and the CSP
below is doing the same work either way.

Two genuine differences from `localStorage`, one in each direction:

- **In favour of the cookie:** expiry is the browser's job rather than ours (a
  `max-age` and the value is gone, with no TTL bookkeeping in application
  code), and because it is first-party to the web app, a Next.js **server**
  component on that origin could read it if the authenticated area is ever
  server-rendered. `localStorage` can never be read on the server.
- **Against:** the cookie is attached to **every** same-origin request,
  including page navigations and same-origin asset requests that have no use
  for it — a few hundred wasted bytes per request, and the value lands in the
  web app's own request logs. Also a 4 KB per-cookie ceiling, which an Ed25519
  JWT is nowhere near.

The access token is **persisted rather than held in memory**, which follows
from its 7-day lifetime rather than being a separate decision: the point of a
long access token is that a page reload needs no network at all, and a
memory-only token would force a refresh round trip on every reload — waking a
sleeping `auth-service` to do it.

**The risk being accepted, stated plainly: an XSS in the web app can steal the
refresh token, and therefore the session.** A *server-set* `httpOnly` cookie is
the only thing that removes that class of attack, and it is unavailable without
a domain (§4.5). What bounds the damage is already built:

- **Refresh rotation with family-wide reuse detection.** A stolen refresh token
  is single-use; the moment either the thief or the real visitor uses the
  rotated token, `refresh_tokens.family_id` revokes the whole family.
- **`tokenVersion` in Redis**, checked on every request, so revocation is
  instant at any TTL.
- **Nothing else.** With a 7-day access token on disk (§4.4, the owner's
  decision), a stolen token is usable until either it expires or somebody bumps
  `tokenVersion`. This is the sharpest edge in the design and it is recorded
  here rather than softened.
- **A real CSP on the web app**, which does not exist today: the gateway sets
  `default-src 'none'` for its own JSON responses
  ([`security_headers.go`](../../../services/api-gateway/internal/middleware/security_headers.go)),
  but the web app sets no headers at all. Once the session lives anywhere
  JavaScript can read it — a JS cookie and `localStorage` are the same in this
  respect — a CSP stops being hygiene and becomes a security control.
  **It is a Phase A work item, not a nice-to-have.**

**The switch trigger.** If a custom domain is ever attached, move the session to
httpOnly cookies — the gateway keeps accepting both, so the change is one
release in the client and one in the gateway, and nothing about ownership,
claim or the read path is affected. Record that as done when it happens; until
then this section is the contract.

### 4.3 CSRF

A bearer token in a header is never attached automatically by the browser, so
**this design has no CSRF surface at all** — no token ceremony, no double
submit, no `Origin` check needed. That is a genuine advantage of §4.1 over the
cookie design, and the reason it is not a compromise in every direction.

CORS stays strict regardless (`API_ALLOWED_ORIGINS`, explicit origins, never a
wildcard).

### 4.4 Token TTLs, per audience

Staff keep 10 minutes / 14 days. The product audience gets its own pair, which
means `auth-service` config gains two values rather than reusing one:

| | Access | Refresh |
| --- | --- | --- |
| `aud=admin` (unchanged) | 10 min | 14 days |
| `aud=web` (**decided 2026-09-02**) | **7 days** | **3 months**, rotating |

**Why this is defensible, and it rests on one fact:** the gateway checks the
Redis `tokenVersion` on **every** request, not only on refresh
(`revocation.go`). So revocation is instant at *any* access TTL, and the TTL
decides only how often a refresh round trip happens. Without that check a
7-day access token would be indefensible; with it, the TTL is a
traffic decision rather than a security one.

**What the 7 days does cost, and all three are real:**

1. **Revocation is account-wide, not per session.** Killing one stolen access
   token means bumping `tokenVersion`, which logs the account out everywhere.
   There is no per-token deny list, and building one is not proposed.
2. **A stolen token is a 7-day credential** unless somebody notices and revokes
   it. Refresh rotation's reuse detection does not help here — it protects the
   *refresh* token, and with a 7-day access token the refresh path runs roughly
   once a week, so a thief may never touch it.
3. **It removes the free keep-warm effect.** §11's argument that "an active
   session refreshes every 15 minutes and therefore keeps `auth-service` awake
   for free" **stops being true**: with a weekly refresh, `auth-service` is
   essentially always cold when somebody logs in. That makes §11's honest-UI
   work more important, not less. This interaction was not visible when the two
   decisions were taken separately, and it is the reason this paragraph exists.

Not negotiable: `tokenVersion` is bumped on password change, "log out
everywhere", and account disable — and `DisableAccount` already does exactly
that ([`auth_service.go:204-213`](../../../services/auth-service/internal/services/auth_service.go):
set `disabled`, revoke every refresh token, bump and cache `tokenVersion`,
write an audit row).

### 4.5 "A bearer token can live in a cookie — so what was blocked?"

Nothing about a bearer token in a cookie is blocked, and the confusion is worth
resolving precisely because the two ideas share the word *cookie*:

- **A cookie as a storage box.** The web app's own JavaScript writes
  `document.cookie` on its own origin, reads it back later, and puts the value
  into an `Authorization` header by hand. This is **first-party and works
  fine** — it is simply an alternative to `localStorage`.
- **Cookie *authentication*.** The **server** sends `Set-Cookie`, and from then
  on the **browser attaches it automatically** to every request to that server,
  which reads it instead of a header. This is what the admin app does, and this
  is the half that breaks: automatic attachment across two different sites is
  exactly what third-party cookie blocking prevents.

So the blocked thing is never the token's format — it is *who sends the
credential*. A token the client attaches by hand is never a third-party cookie,
whatever box it was kept in.

**Which box, then?** Either works, because a JS-readable cookie and
`localStorage` are equally readable by an XSS; `httpOnly` is the only box an
XSS cannot reach, and only a *server* can set an `httpOnly` cookie — which is
the cross-site problem again. **The owner chose the cookie box** (§4.2), which
buys automatic expiry and a value the web app's own server could read, and
costs a few bytes on every same-origin request. Either way the CSP is what does
the work `httpOnly` would have done.

---

## 5. Signing up

### Decided 2026-09-02: the simplest registration that does not paint us into a corner

**No email is sent in the first release.** Signup is an email address and a
password, and the address is stored **unverified** — nothing is mailed, so
nothing waits on mail infrastructure. Email and OAuth move to the very end of
the plan (Phase D), by the owner's priority.

That is genuinely the simplest thing that works, and it costs exactly two
things, both of which have to be said out loud:

1. **There is no "forgot password".** Self-service reset *is* an email feature;
   without mail there is no way to prove the person owns the address. Until
   Phase D, a forgotten password means the account is unreachable, and the only
   recovery is a staff member issuing a new credential by hand — the existing
   invite mechanism (`AuthInviteCreateQuerySubject`, whose token is already
   designed to be relayed out of band) is the closest thing that already
   exists. **This is the single largest support cost of the simple path**, and
   it is a good trade only because the product currently has few enough people
   for a manual answer to work.
2. **No trust may be attached to the address.** An unverified email is a
   *username that looks like an email*, and someone can sign up with an address
   they do not own. So nothing may key off it: no "recover by email", and
   critically, **Phase D's OAuth linking rule (§5.3) must require verification
   first** — linking a Google account to a local account that merely *claims*
   the same address would hand over the wrong account. Recorded here because
   the rule and the thing it protects against are six months apart.

Uniqueness on the address stays (one account per address) — not for trust, but
so that "log in" has one answer.

### 5.1 Credentials

- **Password**: Argon2id (exists). Minimum **12 characters**, no composition
  rules, no forced rotation — current NIST guidance, and the opposite of what
  most products still do.
- **Breached-password check**: Have I Been Pwned's range API (k-anonymity: send
  the first 5 hex characters of the SHA-1, match the suffix locally). Free, no
  key, no account, no infrastructure, and no password ever leaves the service —
  which is why it survives the "keep it simple" cut: it is one HTTP call.
  Reject on signup and on password change; **never** block a login with it.
  It matters more here than it would elsewhere, because with no password reset
  (§5) a compromised account is a *lost* account.
- **Uniform responses**: login, signup and reset must not reveal whether an
  email exists. This is a behavioural requirement with a test, not a comment.

### 5.2 Email — Phase D, and what it looks like when it arrives

No email is sent anywhere in this platform today, and by the decision above
none is sent in the first release either. This section is the contract for when
it lands, not work in Phase A.

- **Provider**: **Resend** to start — a one-call API, guided DKIM/SPF/DMARC, and
  a free tier in the region of 3,000 messages a month / 100 a day, which is far
  above this product's verification-and-reset volume. **Confirm the current
  figure and the current free-tier terms at implementation time**; provider
  pricing is the one number in this plan guaranteed to be stale by the time it
  is read. **Postmark** if deliverability ever becomes the complaint; **SES** if
  volume ever makes price the complaint. The abstraction below is what makes
  that swap one adapter instead of a migration.
- **Abstraction**: `internal/mail` with a `mail.Sender` interface and
  `internal/mail/providers/{resend,mock}` — the same shape as
  `internal/ai/providers` and the same rule from `AGENTS.md`: provider-specific
  logic stays in the provider package, services depend on the interface, and
  **tests use the mock**. Nested `<area>/<thing>`, never a run-together
  `mailsender` package.
- **Verification policy** when it exists: creating a world does **not** require
  a verified email; **publishing a share does**. Friction where the abuse is,
  not where the first impression is. Until then, neither does — see the two
  costs above.
- **Reset tokens**: 32 random bytes, stored **only** as SHA-256 (the same
  reasoning `GenerateRefreshToken` already documents), single use, 30-minute
  TTL, and a successful reset bumps `tokenVersion` so every other session dies.

### 5.3 Social login — Google, then GitHub

Authorization Code + **PKCE**, run from `auth-service`, with:

- `state` bound to a short-lived Redis entry (CSRF on the callback) and `nonce`
  verified inside the ID token;
- an **exact** registered redirect URI, one per environment, never a pattern;
- ID token validation of `iss`, `aud` (must equal our client id — audience
  confusion is a real breach class), `exp`, and signature against the
  provider's JWKS;
- `account_identities (provider, provider_subject)` unique, so the provider's
  **subject** is the identity, never the email;
- **linking rule**: an existing local account is linked to a Google identity
  only when Google asserts `email_verified` **and** the local email is already
  verified. Otherwise the person must prove the local account first. This is
  the rule that stops "sign in with an unverified email for an account you do
  not own".

Apple: only if an iOS wrapper ever exists. It is required by App Store policy,
not by the web.

### 5.4 Passkeys — removed from this plan by decision 18

> **Superseded 2026-09-02 (fourth round).** Passkeys are **not** in this plan
> at all. Decision 12 put email and OAuth last, in Phase D; a credential type
> that would land after that is a Phase E candidate, not a phase of this work.
> The analysis below is kept because it is the argument for *when* they become
> worth doing, and because §5's credential model was deliberately left
> additive so that adding them later costs nothing structural.

Passkeys are ready enough in 2026 to be a first-class *additional* credential
and not ready enough to be the *only* one for a one-person team, because the
whole cost is in the recovery and cross-device edges rather than in the
ceremony. `go-webauthn/webauthn` is the maintained Go library. Ship it after
the password + Google paths are stable, as "add a passkey to your account",
with conditional UI (autofill) on the login form. **Never** as the sole
credential.

TOTP MFA: out of scope for end users. It is worth more on **staff** accounts,
which have none today — noted as separate work, not smuggled in here.

### 5.5 Abuse defence on the identity endpoints

The gateway's per-IP bucket is one bucket per route group; identity needs its
own group and a second dimension:

- a third `authRateLimitRouteKey = "auth"` bucket with much tighter numbers than
  `product` (the two must never share a key — `router.go` already says why);
- **per-email** counters in Redis for login failures and reset requests, so a
  distributed attempt against one account is throttled even from many IPs;
- the existing account lockout stays as the last line (5 / 15 min);
- every signup, login, failure, reset, claim and deletion writes an audit row.

---

## 6. Ownership, and where it is enforced

### 6.1 The rule

> **A read model may never be the basis of an authorization decision.**

Track A's rule, kept verbatim, because it is the one thing in this design that
becomes a security hole if it is softened.

| Path | Source of truth |
| --- | --- |
| **Write** — publish, create variant, select variant, delete | `worlds.owner_account_id` in the family database, checked **in the same transaction as the mutation** |
| **Read** — "my worlds" | `dna-service`'s join (§3.1) |

### 6.2 Schema — the three family services

Identical migration in `universe-service`, `nature-service`, `ocean-service`:

```sql
-- 00000N_world_ownership.sql
-- +goose Up

-- Nullable on purpose, twice over: every world in production today is
-- anonymous and must stay valid, and anonymous creation is not being
-- removed - it is the product's entire first impression.
-- No REFERENCES: accounts live in another database on another host. The
-- Ed25519 signature the gateway verified is the existence proof.
ALTER TABLE worlds ADD COLUMN owner_account_id UUID;

-- The bearer credential for a world created before signup, cleared at claim.
ALTER TABLE worlds ADD COLUMN anonymous_id UUID;

CREATE INDEX worlds_owner_idx
  ON worlds (owner_account_id)
  WHERE owner_account_id IS NOT NULL;

CREATE INDEX worlds_anonymous_idx
  ON worlds (anonymous_id)
  WHERE anonymous_id IS NOT NULL AND owner_account_id IS NULL;

-- +goose Down
DROP INDEX worlds_anonymous_idx;
DROP INDEX worlds_owner_idx;
ALTER TABLE worlds DROP COLUMN anonymous_id;
ALTER TABLE worlds DROP COLUMN owner_account_id;
```

`ADD COLUMN` with no default is metadata-only on PostgreSQL 11+, so this is
instant against live tables.

**`owner_account_id` is write-once in v1.** Every write is
`WHERE owner_account_id IS NULL`, there is no transfer endpoint, and that
removes an entire class of race. Transfer, if it is ever wanted, is a new plan.

### 6.3 Schema — `dna-service`

```sql
ALTER TABLE profiles ADD COLUMN owner_account_id UUID;
ALTER TABLE profiles ADD COLUMN anonymous_id UUID;

-- The only query the visitor-facing read path runs: newest-first keyset over
-- one account's completed jobs.
CREATE INDEX profiles_owner_idx ON profiles (owner_account_id)
  WHERE owner_account_id IS NOT NULL;
CREATE INDEX generation_jobs_world_keyset_idx
  ON generation_jobs (profile_id, created_at DESC, job_id DESC)
  WHERE world_id IS NOT NULL;
```

### 6.3b Why `anonymous_id` exists when `owner_account_id IS NULL` already means anonymous

A fair challenge, asked on 2026-09-02, and the answer is that the two columns
answer different questions:

- `owner_account_id IS NULL` answers **"is this world anonymous?"** — correct,
  and it is exactly why the claim's `WHERE` clause uses it.
- `anonymous_id` answers **"*which* anonymous visitor?"** — which nothing else
  in the schema can answer.

Without the second column, two things this plan promises become impossible, and
one of them is the owner's own quota decision:

1. **The quota cannot be counted.** §9 gives an anonymous visitor 5 AI
   generations a day. Five *per what*? Per IP is shared by everyone behind one
   mobile network and reset by turning airplane mode on and off. `anonymousId`
   is the only per-visitor handle that exists before login, so **the quota needs
   it whether or not the claim does.** That alone pays for the column.
2. **The claim cannot be proven.** "These world ids are mine" is not a proof:
   `/worlds/{worldId}` is the URL a visitor sends to a friend, so a world id is
   public by design. Claiming by id would let the recipient of a shared link
   take the world. The `anonymousId` is the one identifier that never appears in
   a URL, which is the whole reason it is a separate value.

It is one `UUID` column, one response field, one request header and one
`WHERE` clause — and it is what makes the difference between "sign up and your
five worlds come with you" and "sign up and start again".

### 6.4 How the owner identity travels over NATS without being spoofable

The gateway verifies the Ed25519 signature and the Redis `tokenVersion`, then
puts `ownerAccountId` into the command envelope. Downstream services trust the
envelope, and they are right to, because NATS ACLs make the gateway the only
publisher that can reach `commands.dna.generate.v1`
(`nats-server.conf:40`) and `dna-service` the only publisher that can reach a
family's compose subject (`:48`). The trust boundary is the ACL file, which is
where this platform already puts it.

**Row-level security is not worth it here.** Each service connects with one
role, and the ownership predicate is already inside the same transaction as the
mutation. RLS would add a second place for the same rule to be wrong, and a
Neon-specific coupling, for no additional guarantee.

### 6.5 The write path gains one behaviour and one endpoint

- `POST /worlds/{id}/publish`, `/variants`, `/variants/{id}/select`: reject with
  `403 NOT_WORLD_OWNER` when the world **has** an owner and the caller is not
  it. An **unowned** world stays mutable by anyone holding its id — that is
  today's behaviour and removing it would break every world in production and
  every anonymous visitor.
- `POST /api/{family}/worlds/{id}/delete`: **new**, owner-only, and the first
  time a visitor can delete anything. Today only staff can unpublish.

---

## 7. Anonymous → account, and the claim

```
1. POST /api/{family}/worlds with no session
   → gateway mints anonymousId=<uuid> and RETURNS IT IN THE 202 BODY
     (the client writes it to its own myunivokai_anonymous cookie)
   → rides the generate command → profiles.anonymous_id → compose → worlds.anonymous_id
   → a subsequent create sends X-Anonymous-Id and reuses the same one

2. ... the visitor makes several worlds over several days, same anonymousId ...

3. signup or login → product session

4. POST /api/me/worlds/claim  (Authorization: Bearer + X-Anonymous-Id)
   → gateway publishes ONE commands.dna.world.claim.v1
   → dna-service, in one transaction:
        UPDATE profiles SET owner_account_id = $account, anonymous_id = NULL
         WHERE anonymous_id = $anonymous AND owner_account_id IS NULL
   → dna-service publishes commands.<family>.world.claim.v1 ONLY to the
     families its own generation_jobs rows name
   → each family service, in one transaction:
        UPDATE worlds SET owner_account_id = $account, anonymous_id = NULL,
                          revision = revision + 1
         WHERE anonymous_id = $anonymous AND owner_account_id IS NULL
        + one world.changed outbox row per updated world
   → the client drops its stored anonymousId
```

Properties that matter:

- **Idempotent.** `owner_account_id IS NULL` makes a replay a no-op, and makes
  the two-device race harmless: the second claim updates zero rows. A world is
  claimable exactly once, forever.
- **No new event type.** `revision` + outbox + `world.changed` are all in
  production.
- **The `anonymousId` is a bearer credential.** Whoever holds it owns those
  worlds, and under §4.2 it sits in a JS-readable cookie, so an XSS can take
  it. Same exposure as the refresh token, same mitigation — the CSP. 180 days
  bounds it, and the cookie's own `max-age` is what enforces that.
- **It cannot be replaced by the world ids the client already stores.** A world
  id is not a secret: `/worlds/{worldId}` is the URL a visitor sends to a
  friend. "Claim these ids" would let the recipient of a shared link claim
  someone else's world. The minted `anonymousId` is never in a URL, which is
  the whole reason it exists.
- **Unclaimed anonymous worlds have no one who can ever ask for their erasure.**
  They hold raw personal input and no owner. Given the §10 decision that
  nothing is physically purged, this stays an open gap rather than a solved
  one — it is named here so it is a known state and not a discovery. It
  **exists in production today**, unchanged by this plan.

---

## 8. The read path

`GET /api/me/worlds?cursor=&limit=25` → `myunivokai.queries.dna.library.list.v1`
→ one keyset query in `dna-service`, returning **only**:

```json
{ "worlds": [ { "worldId": "…", "family": "ocean", "createdAt": "…" } ],
  "nextCursor": "…" }
```

The web app then hydrates the page's cards with the `GET /api/{family}/worlds?ids=`
call **it already makes today**. No new hydration path, no new response model,
no card redesign.

`localStorage` does not disappear — it becomes the anonymous-visitor path and a
cache, and the two lists are merged newest-first with the server list winning
on conflict. A logged-in visitor on a new device sees their worlds; a visitor
with no account sees exactly what they see today.

---

## 9. Quotas — the argument that is really about money

There is **no per-caller quota anywhere in this platform**, and every world
creation is an AI call in `dna-service`. The only thing standing between the
provider bill and a script is a per-IP token bucket, which a script does not
respect.

Login is what makes a quota possible, so the quota ships **with** ownership,
not after it.

### Decided 2026-09-02: over the limit degrades to the mock provider. It never refuses

| Identity | AI generations per day | Beyond that |
| --- | --- | --- |
| `anonymousId` | **5** | the world is still created, from the **mock provider** |
| Account | **25** | same |

This is a better design than the `429` the plan originally proposed, and the
reason is that it costs the visitor nothing: they still get a world, it is
still deterministic, still family-appropriate and still theirs — the AI call is
the only thing withheld. A rate-limited create screen, by contrast, is a dead
end on the one screen the whole product exists for.

It is also not a hack, because the pieces exist: `dna-service` already builds a
**primary and a fallback provider** side by side
([`internal/aifactory/factory.go`](../../../services/dna-service/internal/aifactory/factory.go)),
`AI_PROVIDER` and `AI_FALLBACK_PROVIDER` both already default to `mock`, and
`internal/ai/providers/mock_presets.go` already produces real, usable DNA —
that is how the whole test suite runs.

**How it is wired**, and each step is small:

- the **gateway** owns the counter, because the gateway is where the cost is
  incurred, and it increments in Redis **before** publishing the generate
  command;
- the counter key is the `anonymousId` or the account id, which is the second
  reason `anonymousId` has to exist at all (§6.3) — a per-IP counter is shared
  by everyone behind one NAT and trivially bypassed by anyone else;
- when the count is over the limit, the generate command carries a flag saying
  so, and `dna-service` serves that one job from the mock provider. The flag is
  set by the gateway only, protected by the same ACL that protects
  `ownerAccountId` (§6.4), so a client cannot ask for the real provider;
- the response says **why** this world was produced the way it was — a reason
  code, **not** a provider or tier name (§9.1's amendment, decision 17b) — and
  the UI speaks once, for exactly one of the four reasons. **A silent quality
  downgrade is one way this design goes wrong; announcing a downgrade that
  never happened is the other.**

Every number is a named constant, never a literal — `coding-style.md` §1 — and
for the two limits that constant is the **default** behind a setting rather
than the only copy of the value: **where those numbers are stored is §9.3**,
and the owner decided on 2026-09-02 that it is not `.env`. The daily window
resets at UTC midnight and the Redis key expires with it, so there is no
cleanup job.

### 9.1 Decided 2026-09-02: one toast, no permanent marker — and the library already exists

The owner's instruction was *"a simple toast, or silence — it is a house
rule"*, with the choice delegated. **The decision is the toast**, and the
reasons are not aesthetic:

- **Silence is not actually silent.** The mock tier is *visibly* different — it
  draws from `mock_presets.go`, so it is deterministic and a visitor who
  creates twice in a row gets recognisably related worlds. Saying nothing does
  not hide the downgrade; it converts it into the belief that the product is
  broken. One line of copy converts it back into a rule the visitor
  understands.
- It is also the cheapest possible support answer for a one-person team: the
  alternative to a toast is a message asking why two worlds look alike.
- **But no permanent marker on the world.** §9 exists precisely because the
  visitor still gets a real, keepable, shareable world. A badge welded to that
  world for ever would contradict the argument the tier decision was made on,
  and it would be visible to the friend the link was sent to, who never hit any
  limit. The truth is owed **once, to the person who hit the limit**, at the
  moment they hit it — not for ever, to everyone.

**The library question is already closed by the codebase**, which is the
finding here. There is nothing to evaluate and no dependency to add:

| What | Where | State |
| --- | --- | --- |
| `sonner@2.0.7` | [`apps/myunivokai-web/package.json`](../../../apps/myunivokai-web/package.json) | already a dependency |
| `<Toaster position="top-center" theme="dark" duration={2600} offset="72px">` | [`src/app/layout.tsx:118`](../../../apps/myunivokai-web/src/app/layout.tsx) | already mounted app-wide, already cleared below the 57 px header |
| `.lg-toast` | [`src/app/globals.css:265`](../../../apps/myunivokai-web/src/app/globals.css) | already the Liquid-Glass material |
| `toast("Share link ready.")` | [`src/app/worlds/[worldId]/page.tsx:295`](../../../apps/myunivokai-web/src/app/worlds/%5BworldId%5D/page.tsx) | the existing call site to copy |

And `.lg-toast` is genuinely the Apple material rather than a blur and a
prayer — it is a `--glass-tint` fill over a `--glass-blur` backdrop filter, a
1 px `rgba(255,255,255,0.12)` hairline, a 14 px radius, brass icons, and the
part that actually makes it read as glass: `inset 0 1px 0 rgba(255,255,255,
0.22)`, the specular top edge, over a `0 24px 60px -20px` lift. `--glass-easing`
already drives the motion. So this work item is **one `toast()` call and one
string**, and the reason to write it down is to stop a future reader
"introducing a toast library".

#### The failure this design walked into, found by the owner on 2026-09-02

> The owner asked: *"if the deployment is set up as mock, does the toast still
> show?"* As written above, **yes — and it says something false.**

**Production is on the mock provider right now.**
[`render.yaml`](../../../render.yaml) sets `AI_PROVIDER: mock` and
`AI_FALLBACK_PROVIDER: mock`, and `config.go:89-90` defaults both to `mock`
anyway. So every world in production today comes from the mock provider, and a
toast keyed on *"this world came from mock"* would fire on the 6th creation to
announce a limit on an AI tier **that is not switched on**. That is not a
cosmetic bug: it is the exact failure §15 forbids, arrived at from the opposite
direction — not a silent downgrade, but a **loudly announced downgrade that
never happened**.

There are **three** independent routes to a mock-produced world, and the
version of §9.1 above conflated them:

| Route | Was an AI generation lost? | Whose fact is it? |
| --- | --- | --- |
| The caller passed the daily limit | **Yes** | the gateway — it set the flag |
| `AI_PROVIDER` is configured as `mock` | **No.** There was never an AI tier | `dna-service`'s own config |
| The primary provider was tried and failed, so the fallback ran | **No.** That is an incident | `dna-service` at runtime |

Only the first one is the visitor's business. The second is a deployment state
the visitor cannot act on and never lost anything to. The third is an
**operational** fact — it belongs in `ai_generation_attempts` and in staff
telemetry, where it already goes, and putting it in a toast would blame the
visitor for our provider being down.

**The fix: the response carries a reason, not a provider name.** A provider
name forces the frontend to guess *why*, and it has no way to know. The reason
is computed in `dna-service`, because that is the only place all three facts
exist at once — the gateway's quota flag arrived on the command, the configured
primary is its own config, and the fallback is its own runtime outcome.

```txt
generationTier.reason ∈ {
  ai_generated,          → no toast
  quota_exhausted,       → TOAST. the only value that produces one
  mock_configured,       → no toast. there is no AI tier to have lost
  ai_failed_fallback     → no toast. an incident, surfaced to staff
}
```

**Precedence, written down because two implementers would order it
differently:** `mock_configured` **beats** `quota_exhausted`. If the primary is
mock and the caller is also over the limit, the reason is `mock_configured` and
there is no toast — because nothing was withheld. Ordering it the other way
reintroduces exactly the false message the owner caught.

**And one of the four is currently unreachable, which is worth knowing before
someone tries to test it against production.** `ai_failed_fallback` requires a
fallback provider that is *distinct from* the primary — `aifactory` only
constructs one when `AIEnableFallback && AIFallbackProvider != AIProvider`
([`factory.go:19`](../../../services/dna-service/internal/aifactory/factory.go)).
Production sets both to `mock`, so today there is **no fallback provider at
all**, and a primary failure ends as a **failed job**, not as a mock world.
That is the correct behaviour and it is not one of the four reasons: a job that
failed has no world to carry a reason. So the reason code describes *how a
world was produced*, never *why one was not*.

Two consequences worth stating:

- **The frontend must never key the toast on a provider name**, even one that
  reaches it. Keying on the reason is what makes the three routes stay
  distinguishable, and a `provider == "mock"` check in the web app would
  re-merge them at the last possible moment. Name this in the code.
- **The counter keeps counting regardless.** It is correct to count creations
  even while the AI tier is off: the count is what makes the ceiling real the
  day `AI_PROVIDER` is flipped, and a counter that only starts on the flip
  starts from zero at exactly the wrong moment.

**The copy is English**, like every other string in the app (`familyOptions`,
`"Share link ready."`). Two candidates, and the second is preferred because it
names the limit rather than the machinery:

```txt
"Daily AI limit reached — this world was generated offline."   ← names our internals
"You've used today's 5 AI worlds. This one was built from presets."  ← preferred
```

The numbers in that string come from the same named constants as the counter
(`coding-style.md` §1); the copy is assembled, never a literal with a `5` typed
into it.

### 9.2 What a world costs, and what the quota is really capping

Grounded in the code rather than estimated, because the quota numbers are a
money decision and deserve arithmetic:

| Fact | Value | Source |
| --- | --- | --- |
| Default model | `gemini-2.5-flash` | [`config.go:97`](../../../services/dna-service/internal/config/config.go) |
| Output ceiling per call | **1600 tokens** | `profileDNAMaximumTokens`, [`generation_service.go:25`](../../../services/dna-service/internal/services/generation_service.go) |
| Prompt template | ~1 KB of static text plus the visitor's input | [`prompts/profile_dna_v1.go`](../../../services/dna-service/internal/ai/prompts/profile_dna_v1.go) |
| Repair attempts on a validation failure | **2**, then the fallback provider | `defaultAIRepairAttempts`, [`config.go:17`](../../../services/dna-service/internal/config/config.go) |

The consequence worth stating plainly: **one create is not one billed call.**
The orchestrator sizes its attempt slice at `2 + repairAttempts`
([`orchestrator.go:62`](../../../services/dna-service/internal/ai/orchestrator.go)),
so a create whose output keeps failing validation can bill up to ~4× the happy
path. The quota counts **creates**, so the real ceiling is the quota times
that factor. At `gemini-2.5-flash`'s published rates a happy-path create is
low single-digit tenths of a US cent; the honest way to hold this number is
**per-create cost measured from `ai_generation_attempts`**, which already
stores every attempt with its request and response, rather than from a rate
card that changes without telling us.

What that makes the quota worth: **before it, the ceiling is unbounded.** A
script that respects nothing but the per-IP bucket can run all day, and every
request would be a paid generation. After it, the worst case is
`daily_visitors × 5` plus `accounts × 25`, and that is a number a one-person
team can look at and decide about. The quota is not a fairness feature — it is
the difference between a bill with a ceiling and a bill without one.

**But be precise about the tense, because the honest version is stronger.**
Today's AI spend is **zero**: production runs `AI_PROVIDER: mock`
([`render.yaml`](../../../render.yaml)), so nothing is currently being billed
and no bill is currently running away. What is unbounded is not today's
spend — it is **the first day `AI_PROVIDER` is flipped to `gemini`**, which
with no quota in place is a switch with no ceiling behind it.

So the quota is a **precondition for turning the AI on**, not a remedy for a
bill already bleeding. That is an argument for building it *now*, while it
costs nothing to get wrong, rather than after the flip — and it is a reason the
guardrail test in §12 matters more than usual, because until the flip there is
no production signal that the quota works at all.

### 9.3 Decided 2026-09-02: the limits are admin settings, not environment variables

The owner's instruction: keep counting and keep enforcing regardless of
provider, suppress the toast when the provider is mock (§9.1 already), and make
**the limits configurable from an admin settings surface in `auth-service`** —
built as a general mechanism, because `.env` is already too crowded to keep
absorbing product policy.

**The crowding is measurable**, which is what makes this the right call rather
than a preference:

| | Count |
| --- | --- |
| Config reads across the 7 services (`get`/`getInt`/`getBool`/`getDuration`) | **170**, across **64** distinct names |
| Lines in [`.env.example`](../../../.env.example) | **105** |
| `- key:` entries in [`render.yaml`](../../../render.yaml) | **176** |

Two more variables in that is not a config change, it is a hiding place.

#### The trap, and the one place this must diverge from an existing pattern

**The gateway enforces the quota, and `auth-service` sleeps.** If the gateway
reads the limit by asking `auth-service`, then every world creation after a
quiet period waits 20-60 s for a free-tier cold start — on **the one path the
entire product exists for**. That would be a far worse regression than the
problem it solves.

The existing pattern to copy is `tokenVersion`: authoritative row in Postgres,
mirrored in Redis, read by the gateway on every request
([`revocation.go`](../../../services/api-gateway/internal/admin/auth/revocation.go)).
**But one behaviour must be inverted, deliberately:**

| | `RevocationChecker` (exists) | Settings (this plan) |
| --- | --- | --- |
| Redis hit | use it | use it |
| **Redis miss** | **request `auth-service` over NATS**, then cache | **use the compiled-in default constant. Never ask `auth-service`** |

The reason for the difference is the reason for each value's existence. A
revocation check that guesses is a security hole, so it is worth waking a
service for. A quota that guesses is off by a few generations for one visitor,
and waking a service for it costs 20-60 s on the create path. **Write this
divergence down in the code**, because a later reader will otherwise "fix" it
into consistency with `RevocationChecker` and reintroduce the cold start.

Writes go the other way and never touch the hot path:

```txt
admin app → gateway /api/admin/settings → auth-service
   → validate against the declared type and bounds
   → UPDATE system_settings  (authoritative)
   → SET the Redis mirror     (no TTL)
   → audit_events row: setting_update, "<key>: <old> -> <new>"

auth-service startup → re-mirror every setting into Redis
   (so a flushed Redis self-heals on the next boot, and the gateway's
    default-constant fallback covers the window in between)
```

#### The invariant that stops a settings table becoming the new hiding place

**Every setting has a named default constant in code, and the platform must
boot and behave correctly with an empty `system_settings` table and an empty
Redis.** A setting is an *override*, never the only copy of a value.

This is not bureaucracy — it is what keeps `coding-style.md` §1 satisfied (the
default is still a named constant) and it is what stops a fresh environment
from being broken by absent state. A settings row that has no default in code
is a required piece of database content with nothing declaring it, which is
strictly worse than the environment variable it replaced.

#### The audit: all 64 environment variables, classified

The owner asked on 2026-09-02 for every `.env` value to be examined and moved
where it can be, and then — reading the result — narrowed it: **`auth-service`
only; the other services are too hard, skip them.** Both instructions are
honoured here. The full audit stands because it is what shows *why* the
narrowing is right, and the batch that gets built is `auth-service`'s alone.

**All 64 distinct names were read from the seven `internal/config/config.go`
files**, not sampled. One rule does most of the sorting — **`.env` describes
where and how a service runs; a setting describes how the product behaves** —
and **three facts found during the audit do the rest.** All three shrink the
answer, and the third one disqualifies two candidates that pass every other
test.

##### Fact one: only two of the seven services can read a setting at all

| Service | Redis client |
| --- | --- |
| `api-gateway` | **yes** |
| `auth-service` | **yes** (and it owns the table, so it needs no Redis hop for its own values) |
| `dna-service`, `universe`, `nature`, `ocean`, `analytics` | **none** |

Five of seven services have no Redis client and no `REDIS_URL`. So a setting
consumed by `dna-service` or a family service cannot use the Redis mirror. Its
options are all worse: give that service a Redis dependency it deliberately
does not have, ride the value on the NATS command from the gateway (which works
for per-generation policy and is exactly how §9's tier flag travels, but
couples the gateway to another service's internals), or request it from
`auth-service` and pay a cold start.

**So the cheap settings are gateway-read and auth-read. Everything else is a
project.** That single fact, not the policy/deployment rule, is what decides
this sprint's batch.

##### Fact two: today, nothing is read at the moment of use

Every one of these values is captured into a struct field when the component is
built — `DNAJobHandler{completedCacheTimeToLive: serviceConfig.JobCacheTimeToLive}`
([`dna_job_handler.go:23`](../../../services/api-gateway/internal/handlers/dna_job_handler.go)),
`worldHandler{worldCacheTimeToLive: …}`
([`world_handler.go:61`](../../../services/api-gateway/internal/handlers/world_handler.go)),
`middleware.RateLimit(store, key, rps, burst)`
([`router.go:86`](../../../services/api-gateway/internal/handlers/router.go)),
and `ServiceWakeTimeout` is baked into an `http.Client{Timeout:}`
([`wake/factory/factory.go:67`](../../../services/api-gateway/internal/wake/factory/factory.go)).

So **no value becomes live merely by adding a registry row.** Each one also
costs a small refactor at its call site, from a captured value to a lookup.
That is cheap for a handful and absurd for sixty-four, which is why this is a
batch list and not a migration.

##### Fact three: a value living on both sides of a boundary must not be configurable on only one side

This is the sharpest thing the audit turned up, and it disqualifies two
otherwise-perfect candidates.

- **`AUTH_TOKEN_VERSION_CACHE_TTL` and `ADMIN_TOKEN_VERSION_CACHE_TTL` are one
  concept in two services.** `auth-service` writes the Redis entry with its
  TTL ([`auth_service.go:258`](../../../services/auth-service/internal/services/auth_service.go));
  the gateway's `RevocationChecker` re-caches with *its own*
  ([`admin_router.go:49`](../../../services/api-gateway/internal/handlers/admin_router.go)).
  Make only one of them settable and the **effective revocation window becomes
  whichever service wrote the entry last** — an unpredictable security
  property, which is strictly worse than one that is merely inconvenient to
  change.
- **`NATS_QUERY_TIMEOUT` in `auth-service` pairs with the gateway's
  `NATS_REQUEST_TIMEOUT`.** Auth's responder deadline
  ([`runtime.go:54`](../../../services/auth-service/internal/messaging/runtime.go))
  has to stay under the gateway's request deadline, or the gateway gives up
  first and the work auth completes is thrown away. Half-configurable, that
  invariant is one edit away from being violated silently.

**So: both sides, or neither.** Both stay in `.env` until the gateway side is
in scope, which the owner has deliberately excluded. This is not a difficulty
argument — a half-exposed pair is worse than an unexposed one.

##### Never a setting — and the four that look like policy but are traps

| Value(s) | Why never |
| --- | --- |
| `DATABASE_URL`, `DATABASE_DIRECT_URL`, `REDIS_URL`, `NATS_USERNAME`/`PASSWORD`/`CREDENTIALS`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `AUTH_ACCESS_PRIVATE_KEY`, `ADMIN_ACCESS_PUBLIC_KEYS` | Secrets, and `system_settings` is readable by anyone holding `settings:read` |
| `APP_ENV`, `NATS_URL`, `DATABASE_MAX_CONNS`, `NATS_CONNECT_TIMEOUT`, `NATS_RECONNECT_WAIT`, `SERVICE_SHUTDOWN_TIMEOUT` | Needed to boot, or used while shutting down. The bootstrap paradox: the connection that carries a setting cannot itself be one |
| `API_HOST`, `APP_NAME`, `PUBLIC_WEB_URL`, `SERVICE_WAKE_PLATFORM`, `TELEMETRY_ENABLED` | Deployment topology. They differ per environment by design, and two of them decide what gets *constructed* at startup |
| **`API_ALLOWED_ORIGINS`, `ADMIN_ALLOWED_ORIGIN`** | **A trap.** They look like configuration and they are the CORS boundary. One careless edit by anyone holding `settings:manage` opens the API to any origin, from a web form |
| **`TRUST_PROXY`** | **A trap.** Wrong value means every rate limit and every audit row records a spoofable address. Security posture, not policy |
| **`REDIS_KEY_PREFIX`** | **A trap.** Changing it live orphans every existing key at once — the quota counters, the `tokenVersion` cache, every cached world. It is the identity of the keyspace, not a tunable |
| **`ADMIN_ROUTES_ENABLED`** | **The purest bootstrap paradox in the repo.** As a setting, turning it off removes the screen you would use to turn it back on |
| `NATS_ACK_WAIT`, `NATS_MAX_DELIVER`, `NATS_FETCH_BATCH_SIZE`, `NATS_FETCH_MAX_WAIT`, `NATS_RETRY_DELAY` | **A trap.** These read like policy numbers, but they are **JetStream consumer state**, applied when the consumer is created. Changing the variable changes nothing until the consumer definition is updated on the server, so a setting here would silently do nothing |

##### Key naming — decided 2026-09-02, after the owner rejected the first draft

The owner read the batch table and caught a real defect: `auth_access_token_ttl`
sat next to `auth_web_access_token_ttl`, so the first key **silently meant
"admin"**. Naming one side by its audience and leaving the other implicit is
exactly the shape of mistake that gets read wrong at 2 a.m. Their proposal was
`auth_myunivokai_admin_access_token_ttl` and
`auth_myunivokai_personalization_access_token_ttl`.

**The intent is right and is adopted: every key states whose value it is, on
both sides, with nothing implicit.** Two changes to the literal form, each with
a checkable reason:

1. **`myunivokai` comes out, because it is already there.** A setting's Redis
   key is `<REDIS_KEY_PREFIX>:setting:<key>`, and `REDIS_KEY_PREFIX` defaults
   to `myunivokai` ([`config.go:83`](../../../services/auth-service/internal/config/config.go)).
   The literal form would produce
   `myunivokai:setting:auth_myunivokai_admin_access_token_ttl`. There is also
   no foreign namespace to disambiguate from: every row in `system_settings`
   in `myunivokai_auth` is this product's.
2. **The key says `web`, not `personalization` — and the *description* says
   personalization.** This is the one place I argue against the owner's word,
   and only here. `aud=web` is **frozen** by §17: it is written into
   `contracts_auth.go`, into tokens already issued, and into
   `CHECK (audience IN ('admin','web'))` on two tables. A key called
   `…personalization…` that governs tokens whose claim reads `web` creates two
   vocabularies for one concept, and §17's warning names this exact move —
   *"this is exactly the kind of tidy-up a future reader will attempt"*.
   The operator's need is met without the split, because §9.3's registry
   already declares a human description that the admin screen renders:

   > `auth.token.web.access_ttl` — *"Access token lifetime for the
   > personalization web app (token audience `web`)."*

   The person reading the screen sees "personalization"; the person reading a
   token, a migration or a contract sees `web`; and they are provably the same
   value. **If the owner still wants the literal word in the key, it is one
   string change and nothing else in the plan depends on it** — the objection
   is a naming cost, not a design one.

**The scheme:** `<domain>.<group>.<subject>.<thing>`, lower snake within a
segment, dots between. Constrained in the registry to
`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$` and pinned by the registry test.

Three properties earn the dots over flat snake_case:

- **The admin screen groups by prefix**, so `auth.token.*` and `auth.lockout.*`
  become sections with no separate category column and no frontend change when
  a setting is added.
- **A key is visibly not an environment variable, and cannot become one by
  accident.** This is the strongest of the three, and it is worth being exact
  about because the two namespaces sit side by side for every migrated value:

  > **`.env` keeps `UPPER_SNAKE_CASE` and is not touched by this scheme.**
  > A dot is not a legal character in a shell identifier —
  > `export AUTH.TOKEN=1` answers *"not a valid identifier"*, and
  > `AUTH.TOKEN=1` is parsed as a command name, not an assignment. Docker
  > Compose's `environment:` and Render's env keys inherit the same
  > restriction. So a dotted key **can only ever be a database row**, and an
  > `UPPER_SNAKE` name can only ever be an environment variable.

  That is a guarantee rather than a convention: the two namespaces cannot
  collide, cannot be swapped by a typo, and a grep for either one returns
  exactly one kind of thing. It matters here specifically because for the five
  migrated settings **both exist at once, on purpose** — the environment
  variable remains that setting's default (the invariant above), so a reader
  will see `AUTH_LOCKOUT_DURATION` in `.env` and `auth.lockout.duration` in the
  admin screen and needs to know instantly which is which.
- **The varying part is the subject, so siblings sort together** — the admin
  and web token lifetimes sit next to each other, which is how an operator
  compares them.

And one rule about the first segment: **`<domain>` names what the setting
governs, not the service that stores it.** The quota limits are `quota.ai.*`
even though the row lives in `myunivokai_auth`, because calling them `auth.*`
would be a lie about what they control — `auth-service` is the control plane
(§9.3, last subsection), not the owner of every meaning it stores.


##### Batch 1 — decided 2026-09-02: `auth-service` only, nine settings

The owner narrowed the scope directly: *"list what can be configured in
auth-service; the other services are too hard, skip them."* That is the right
call, and it makes the batch **better** rather than merely smaller, because of
a fact that is the exact mirror of fact two:

**In `auth-service`, these values are already read at the moment of use.**
`service.cfg.MaximumFailedAttempts` and `service.cfg.LockoutDuration` are read
on each failed login ([`auth_service.go:92`](../../../services/auth-service/internal/services/auth_service.go)),
`service.cfg.RefreshTokenTTL` on each token issue (line 238), and
`service.cfg.InviteTokenTTL` on each invite
([`role_management_service.go:68`](../../../services/auth-service/internal/services/role_management_service.go)).
So each is a **one-line swap** from a config field to a lookup — where the
gateway's equivalents would each need their component restructured first.

| Setting key (database row) | Type | Default | Default read from `.env` — **unchanged, not renamed** | Cost to make it live |
| --- | --- | --- | --- | --- |
| `quota.ai.daily_limit.anonymous` | int | `5` | — | **Born a setting.** No refactor at all |
| `quota.ai.daily_limit.account` | int | `25` | — | Same |
| `auth.token.admin.access_ttl` | duration | `10m` | `AUTH_ACCESS_TOKEN_TTL` | The only one not already per-call — see the note below, where it turns out to be free anyway |
| `auth.token.admin.refresh_ttl` | duration | `14d` | `AUTH_REFRESH_TOKEN_TTL` | One line; already read per call |
| `auth.token.web.access_ttl` | duration | `7d` (§4.4) | — | **New in this sprint**, and see the note below |
| `auth.token.web.refresh_ttl` | duration | `3mo` (§4.4) | — | **New.** Free |
| `auth.token.invite_ttl` | duration | `7d` | `AUTH_INVITE_TOKEN_TTL` | One line; already read per call |
| `auth.lockout.max_failed_attempts` | int | `5` | `AUTH_MAX_FAILED_ATTEMPTS` | One line; already read per call |
| `auth.lockout.duration` | duration | `15m` | `AUTH_LOCKOUT_DURATION` | One line, same call site |

The last two are **not** token lifetimes and must never be named as though they
were: `auth.lockout.duration` is how long an account stays locked after
`auth.lockout.max_failed_attempts` consecutive failed logins
([`auth_service.go:92`](../../../services/auth-service/internal/services/auth_service.go)).
They are grouped under `auth.lockout.*` for exactly that reason.

Two types, one service: **three `int` values and six durations**, across three
groups. That is enough to prove a registry and to prove the grouping, which a
single setting would not have been.

**The note, and it is a piece of luck.** `AccessTokenTTL` is the *only* auth
value baked in at construction:
`security.NewTokenIssuer(key, serviceConfig.AccessTokenTTL)`
([`main.go:95`](../../../services/auth-service/cmd/service/main.go)). But
`S8-IDENTITY-001` **already has to restructure that**, because one issuer
carrying one TTL cannot serve two audiences whose tokens live 10 minutes and 7
days. Once the TTL moves to the call site, **both** `auth.token.admin.access_ttl`
and `auth.token.web.access_ttl` are settings for free — which is why the admin
value comes along rather than being left behind as the odd one out. It is also
why this story is sequenced **after** `S8-IDENTITY-001` rather than beside it.

**Removed from an earlier draft of this batch by the same decision:** the three
gateway cache TTLs (`WORLD_`/`SHARE_`/`JOB_CACHE_TTL`). Each is gateway-read
and captured into a handler field, so each needs a real change rather than a
one-line swap. They move to batch 2.

**The gateway still gains one settings reader**, for the two quota limits —
it is the service that enforces the quota, so there is no alternative. That is
**one new reader for two new values**, not a migration of anything the gateway
already reads. Nothing the gateway reads today changes.

##### What this does to `.env`'s size — nothing, and that is the point

The two namespaces behave differently on purpose, and the arithmetic is worth
stating because "reduce `.env`" was the owner's motive:

- **The four born-as-settings** (`quota.ai.*`, `auth.token.web.*`) get a named
  **Go constant** as their default and **no environment variable at all** — no
  `.env` line, no `render.yaml` key. A value that starts life as a setting has
  no reason to be an env var first.
- **The five migrated ones** keep their environment variable **as the
  default**. Nothing is deleted, because removing the fallback would break the
  empty-table invariant above.

So `.env` **neither grows nor shrinks**, and the platform gains nine values an
operator can change without a deploy. That is the honest form of the win: this
mechanism does not clean up the 64 variables that exist, it **stops the list
from growing** every time a policy number is added — which is what the owner's
"`.env` is already too crowded" was really about.

The one thing it would be wrong to do next is delete the five environment
variables to make the list shorter. That trades a crowded file for a platform
that cannot boot into correct behaviour from a clean database.

##### What stays in `.env` in `auth-service`, and why — all 21 of its reads

The owner asked for this list specifically, so here it is in full rather than
by category. `auth-service` makes 21 config reads; nine of them become settings
above, and these twelve do not.

| Value | Why it stays |
| --- | --- |
| `AUTH_ACCESS_PRIVATE_KEY` | The Ed25519 signing key. A secret, and `system_settings` is readable by anyone holding `settings:read` |
| `DATABASE_URL`, `DATABASE_DIRECT_URL` | Secrets, **and** the bootstrap paradox — this is the connection to the table the settings live in |
| `REDIS_URL` | Secret, and needed before the Redis mirror can be written |
| `NATS_USERNAME`, `NATS_PASSWORD`, `NATS_CREDENTIALS` | Secrets |
| `APP_ENV` | Decides how strictly config is validated. A setting cannot decide whether settings are validated |
| `NATS_URL`, `NATS_CONNECT_TIMEOUT`, `NATS_RECONNECT_WAIT` | Used to establish the connection, before any setting can be read |
| `DATABASE_MAX_CONNS` | The pool is built once at startup; changing it live changes nothing until a restart, so a setting here would silently mislead |
| `SERVICE_SHUTDOWN_TIMEOUT` | Read at boot, used while shutting down — when Redis and the database may already be going away |
| `REDIS_KEY_PREFIX` | The identity of the keyspace, not a tunable. Changing it live orphans every existing key at once — including the `tokenVersion` cache this service writes |
| `AUTH_TOKEN_VERSION_CACHE_TTL` | **Fact three.** Its twin lives in the gateway |
| `NATS_QUERY_TIMEOUT` | **Fact three.** Its pair is the gateway's request deadline |

The last two are the only entries in this table that are excluded by *scope*
rather than by nature: both become good candidates the moment the gateway side
is in scope, and neither may move before it is.


##### Batch 2 — named, costed, not built

| Value(s) | Cost that keeps it out |
| --- | --- |
| **`AI_PROVIDER`** — the prize, because it would switch the AI tier on **without a redeploy**, which §9.2 argues the quota exists to make safe | Two real costs. `aifactory` builds the provider **once at startup** ([`factory.go`](../../../services/dna-service/internal/aifactory/factory.go)), so this turns provider selection from per-process into per-request — an orchestrator change, not a config move. And it must be **validated against which API keys are present**: selecting `gemini` with no `GEMINI_API_KEY` breaks generation for everyone, from a dropdown, in one click. Plus fact one — `dna-service` has no Redis |
| `AI_MAX_RETRIES`, `AI_TIMEOUT`, `AI_TOTAL_BUDGET` | High value, because `AI_MAX_RETRIES` is the **multiplier on the cost ceiling** (§9.2: one create can bill up to ~4 calls). Blocked only by fact one: `dna-service` has no Redis client |
| `AI_PROMPT_VERSION`, `GEMINI_MODEL`, `OPENAI_MODEL` | Same, and each needs an **enum constraint** validated against what the code actually registers, not free text |
| `RATE_LIMIT_REQUESTS_PER_SECOND`/`BURST`, `ADMIN_RATE_LIMIT_*` | Gateway-read, so cheap — but they are **security controls**, so they need a floor and a ceiling in code before they are exposed, and the rate-limit middleware currently takes them at construction |
| `SERVICE_WAKE_TIMEOUT`, `SERVICE_WAKE_RETRY_AFTER`, `SERVICE_WAKE_LOCK_TTL` | Genuinely wanted live, and gateway-read — but `ServiceWakeTimeout` is baked into an `http.Client`, so making it live means rebuilding that client per call or holding a settable transport |
| `WORLD_CACHE_TTL`, `SHARE_CACHE_TTL`, `JOB_CACHE_TTL` | **Moved here from batch 1** by the owner's narrowing. Real value — they decide how stale a deleted world's share can be if §10's invalidation ever fails — but each is gateway-read and captured into a handler field, so each needs its component changed rather than a one-line swap |
| `AUTH_TOKEN_VERSION_CACHE_TTL` **with** `ADMIN_TOKEN_VERSION_CACHE_TTL` | Auth-read and cheap, and **security-critical** — `AUTH_TOKEN_VERSION_CACHE_TTL` *is* the window in which a revoked token still works. Excluded by **fact three**, not by cost: its twin lives in the gateway, so the pair moves together or not at all, behind a hard maximum in code |
| `SHARE_SLUG_LENGTH` | Low value and a subtle trap: shortening it raises collision probability against slugs already issued, and it changes nothing about existing ones |
| `OUTBOX_POLL_INTERVAL`, `OUTBOX_BATCH_SIZE`, `NATS_PUBLISH_TIMEOUT`/`REQUEST_TIMEOUT`/`QUERY_TIMEOUT`, `TELEMETRY_FLUSH_INTERVAL` | Throughput tuning, mostly in services without Redis. `NATS_QUERY_TIMEOUT` carries its own warning: `analytics-service`'s keyset indexes exist to stay inside its 2500 ms, so raising it hides a slow query rather than fixing one |

##### Bounds are code, never data

For every setting, the permitted range is declared in the registry **in Go**,
and the write path rejects anything outside it. This is what makes it safe to
expose security-relevant numbers at all: an operator can tighten a lockout or
loosen a cache, but cannot type a revocation window of 24 hours or a rate limit
of zero, because the code refuses the value before the row is written. A
settings mechanism whose bounds live in the database is a settings mechanism
with no bounds.

#### Shape, and the scar it copies from `permission_sync.go`

One table in `myunivokai_auth`:

```sql
CREATE TABLE system_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_by_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`setting_value` is `TEXT` and the **type is declared in code**, deliberately
mirroring the four types the config loader already has — `string`, `int`,
`bool`, `duration`. That reuses a parsing model and a mental model already in
every service rather than introducing a JSON schema for four scalar kinds.

The registry is code-declared, in the shape
[`permission_sync.go`](../../../services/auth-service/internal/services/permission_sync.go)
already established — a `declaredSettings` slice with key, type, default,
bounds and a description the admin screen renders — and pinned by a test, for
the same reason `enforcedPermissions` is.

**And it copies that file's scar rather than its mechanism.**
`SyncPermissions` ends in `DELETE FROM permissions WHERE NOT (codename = ANY($1))`,
so a codename removed from the list is removed from production and from every
role holding it on the next boot, silently — its own comment says so. Settings
must **not** do that: a key that leaves the registry leaves an orphan row, and
the admin screen shows it as unknown so that discarding an operator's value is
a deliberate act rather than a side effect of a deploy.

Two permissions, added to `enforcedPermissions` rather than to
`reservedPermissions` because their routes ship in the same story:
`settings:read` and `settings:manage`. Note the same `DELETE` behaviour applies
to permission codenames, so these two names are chosen once and not renamed.

#### Why identity owns this, and the boundary that keeps it coherent

A fair objection: why does the *identity* service hold system configuration?
Because `auth-service` is not the identity service — it is **the staff-facing
control plane**. It already owns accounts, roles, permissions and the audit
log, all of which are operator-controlled state changed through the admin app
and requiring a permission and an audit trail. System settings are the same
kind of thing, and every alternative is worse: a settings service is an 8th
service for one table, the gateway has no database, and `analytics-service` may
only be written by its own event consumer.

The boundary, so it does not become a dumping ground: **settings are operator
policy, never domain data.** No world, family, DNA or profile state moves into
`system_settings`, ever.

---

## 10. Deletion — two different things, and only one of them is a feature

### Account deletion is not being built. It already exists as an admin action

**Decided 2026-09-02 by the owner: there is no user-facing account deletion.**
"Deleting" an account means a staff member marks it inactive, and that is
**already built and already correct** — `DisableAccount`
([`auth_service.go:204-213`](../../../services/auth-service/internal/services/auth_service.go))
sets `accounts.disabled`, revokes every refresh token for the account, bumps
and caches `tokenVersion` so live access tokens die at the gateway on their
next request, and writes an audit row. The admin app already has the endpoint
and the `account:manage` permission behind it.

So the entire cost of this, for end users, is **letting the admin account list
show `kind = 'end_user'` rows**. Nothing else.

Three things follow, and the third is the one worth knowing:

1. **No `account.deleted` event, no fan-out, no purge job.** Which means
   **§3.4's correction stops applying**: `auth-service` does not need the outbox
   it deliberately does not have, and its README stays true as written. That
   finding remains recorded there because it is what a real erasure feature
   would cost, but it is out of scope now.
2. **A disabled account's worlds keep working.** Nothing hides them; the person
   simply cannot log in. If that is not what is wanted, it is a separate
   decision, not an implementation detail.
3. **There is no data-erasure path at all**, and this is a known position rather
   than an oversight. If a person ever demands their data be removed (GDPR for
   an EU visitor; Vietnam's Decree 13/2023 grants a comparable right), it is
   done by hand against the databases. The map below is what makes that
   possible in an hour instead of a day.

### World deletion by its owner is a feature, and it is a flag

The owner-only `POST /api/{family}/worlds/{id}/delete` from §6.5 sets a flag on
the world. It is **not** physically removed.

- **Scope: the product surface** — the gallery, the world route, the share
  page. Staff analytics is deliberately outside that scope (below).
- **Enforcement: the server, never the client.** The family service filters
  flagged rows in its own query and in share resolution, so
  `GET /api/{family}/worlds?ids=…` and
  `GET /api/{family}/share/worlds/{slug}` stop returning it **to anyone**,
  including a caller with the raw UUID and no browser. A frontend that hides a
  card it was handed is not a deletion — the data is still on the wire.
- **Cache invalidation is part of the feature, not a follow-up.** The gateway
  caches both share and world responses in Redis (`ShareCacheTimeToLive`,
  `WorldCacheTimeToLive`,
  [`world_handler.go`](../../../services/api-gateway/internal/handlers/world_handler.go)).
  Flagging a world without invalidating those entries leaves the share
  resolving normally for up to the TTL after the visitor deleted it — a bug
  that appears **only in production**, because a local run has a cold cache and
  a single reader. It is called out in Phase B as its own task with its own
  test.
- **Reversible for ever.** No purge, by the same decision as above.

### Analytics keeps counting, and gets no new field

**Decided 2026-09-02 by the owner: `analytics-service` is untouched — a deleted
world keeps appearing in staff statistics exactly as before.** That is coherent
with what that read model already is: an aggregate over an allow list that
deliberately holds **no** `owner_account_id`, so it has nothing personal to
hide. Totals, timeseries and rare-feature rolls stay historically accurate
rather than silently shrinking whenever somebody deletes a world.

Nothing is added to `contracts.WorldSnapshot` or to the projection for this, so
the baseline's data-boundary rule is not engaged.

The operational cost, recorded rather than discovered: **staff will see a world
in the admin list whose share page returns 404**, with no marker explaining
why. If that becomes confusing in practice the fix is one boolean into the
snapshot and the projection — a badge, changing no aggregate and no chart. It
is deliberately **not** in scope now.

### Export

`GET /api/me/export` is **not in scope.** Once §8's read path exists it is a
small addition — one query plus the family hydration the gallery already does —
and it can be added whenever it is actually wanted.

### Where the personal data is

Not a compliance artefact — a map for the manual runbook above, and the reason
"just delete the account row" would not be a deletion:

| Service | Personal data | On account deletion (the decided behaviour) | On a real erasure request (the manual runbook) |
| --- | --- | --- | --- |
| `auth-service` | `accounts.email`, password hash, `refresh_tokens`, audit rows | Flag the account, revoke every refresh token, bump `tokenVersion` | Delete the account; keep an audit stub with no email |
| `dna-service` | **`profiles.raw_input`** (the raw personal answers), `dna_versions.profile_dna`, `ai_generation_attempts.request_json/response_json` | Nothing removed. Rows stay, unreachable through any product route | Delete every row for the account's profiles |
| `universe/nature/ocean` | `worlds.visual_intent`, **`worlds.dna_snapshot`**, `nickname`, `role`, `quote`, variants, shares | Flag the worlds; they leave every list and their shares stop resolving | Delete the worlds, variants and shares |
| `analytics-service` | admin projections, allow-listed | **Untouched by design.** Must **never** receive `owner_account_id`; the worlds keep counting in staff statistics | Unchanged - it holds no identifier to erase |
| `telemetry-service` | route rollups, no PII | Untouched | Untouched |

The `dna-service` row is the one that surprises people: `profiles.raw_input`
holds the person's own answers, and `worlds.dna_snapshot` holds them again,
once per world, in a different database.

## 11. Cold start

The domain services sleep, and 20–60 s of cold start on a **login screen** is
where abandonment actually happens. Three facts decide the mitigation:

1. An access token is verified **locally at the gateway** — no auth round trip
   per request. Only signup, login, refresh and logout touch `auth-service`, so
   a logged-in visitor browsing worlds never wakes it at all.
2. ~~An active session refreshes every ~15 minutes, so an active user keeps auth
   warm for free.~~ **This was true when the access token was 15 minutes and is
   false now.** With the 7-day access token decided in §4.4, the refresh path
   runs about once a week, so `auth-service` is asleep at nearly every login.
   Corrected here rather than left as an argument that no longer holds.
3. That login is also the least forgiving request in the product.

**Decided 2026-09-02 by the owner: `auth-service` stays on the free tier, and
the UI tells the truth.** The login and signup buttons say what is actually
happening on a cold instance, the way the create flow already does through
`SERVICE_WAKING` and the wake coordinator - never a spinner that looks broken.

Because fact 2 no longer holds, this is a **frontend work item that is not
optional**, and it is load-bearing rather than cosmetic: a login form that
appears to hang for 40 seconds is worse than one that says it is waking a
sleeping server, and under the 7-day token that form is the *normal* case
rather than the rare one. Signup has the same problem and the same fix.

Paying for a warm instance stays the one-line escape hatch if the honest UI
turns out not to be enough - nothing else in this plan changes if it is bought
later.

Wake budget:

| Action | Services woken, worst case |
| --- | --- |
| Log in | gateway + auth = **2**, and auth is nearly always cold (fact 2) |
| "My worlds" | gateway + dna + the families on that page = **2–4** (unchanged from today's gallery, +1) |
| Open one world | gateway + family = **2**, unchanged |
| Claim after signup | gateway + dna + only the families used = **3–5**, once per account, ever |

---

## 12. Test guardrails

The point is to make the *class* of mistake fail the build, in the shape this
repo already uses:

- **`product_router_test.go`** — enumerates every route under `/api/me` and
  `/api/auth` and fails when one is registered without its middleware. Exactly
  `admin_router_test.go`, applied to the product group.
- **An audience-crossing test** — a `web` token is rejected by the admin edge
  (this exists: `admin_auth_test.go:90`) **and** an `admin` token is rejected by
  the product edge (new). Both directions, or neither is proven.
- **An `end_user` account can hold no permission row.** A repository-level
  invariant with a test, so a bad role assignment cannot become staff access.
- **Claim idempotency** — a replayed claim updates zero rows; a second device's
  claim updates zero rows.
- **Ownership on the write path** — a non-owner is rejected for every mutation,
  table-driven so a new mutation without a check fails.
- **The response-model test** — `GET /api/me/worlds` returns no DNA, no raw
  input, no email. Mirrors the existing share-response test.
- **Cache invalidation on world delete** — flag a world, then assert its share
  slug and its `?ids=` entry are gone **through the gateway**, not through the
  service. A test that bypasses the gateway passes while the bug ships, because
  the bug *is* the Redis entry (§10).
- **The quota tier** — the 6th anonymous creation of a day is served by the
  mock provider and still returns a world; the 26th for an account likewise; and
  a client cannot request the AI tier by sending the flag itself.
- **The reason code, all four values, table-driven** (§9.1). This is the
  guardrail that would have caught the mistake the owner caught by reading:
  with `AI_PROVIDER=mock` the 6th creation returns `mock_configured` and **not**
  `quota_exhausted`; with a stubbed failing primary it returns
  `ai_failed_fallback`; and the frontend test asserts the toast appears for
  exactly one of the four values. Worth stating why this test earns its place:
  three of the four cases **cannot be observed in production today**, because
  production runs `AI_PROVIDER: mock`, so the test is the only thing standing
  between them and the day `AI_PROVIDER` is flipped.
- **Settings: the empty-table test** (§9.3) — no `system_settings` rows and an
  empty Redis, and every setting still resolves to its named default with
  behaviour identical to the value being set. This is the invariant that stops
  a settings row becoming required database content with nothing declaring it.
- **Settings: the gateway never asks `auth-service` for one.** Assert it on the
  create path with `auth-service` unavailable: the create still succeeds using
  the default. Without this test, "fixing" the reader into consistency with
  `RevocationChecker` puts a 20-60 s cold start on the product's main path and
  nothing fails.
- **Settings: out-of-range writes are refused** — bounds live in Go, so a
  revocation window of a day or a rate limit of zero cannot be typed into the
  admin form (§9.3).
- **Settings: a key removed from the registry leaves its row** rather than
  deleting it, unlike `SyncPermissions`. The test exists because the opposite
  behaviour destroys an operator's value silently on the next boot.
- **Playwright** — signup, login, create-while-anonymous, claim, and "my worlds"
  on a second browser context.

---

## 13. Phases

Each phase is a shippable state, and each has a property that is true at the
end of it. Sprints and stories come after approval; this is the ordering
argument.

The 2026-09-02 decisions moved a large amount of work **out** of Phase A: no
mail provider, no verification, no password reset, no account-deletion feature,
and no `auth-service` outbox. What is left in Phase A is close to the smallest
honest login.

**Phase A — an account exists.** The `web` audience turned on in `auth-service`
(signup, login, refresh, logout, the 7-day/3-month TTL pair). Password rules +
the breached-password check. Gateway `/api/auth/*` as a bearer-token flow with
its own rate-limit bucket and per-email failure counters. The admin account list
showing `kind = 'end_user'` rows, so a staff member can mark one inactive (§10
— the service side already works). One new `register` audit action, which is
the whole of the registration metric (§14.2). Web app: login, signup, account
menu, **the session in three first-party cookies the client writes itself**
(§4.2 — not `localStorage`, decision 14), **a real CSP** (§4.2), and a login
button that tells the truth about a cold `auth-service` (§11, and §4.4 cost 3
makes this unavoidable rather than optional).
*Property: a person can hold an account. Nothing owns anything.*

**Phase B — worlds are owned.** Ownership columns in three families and
`dna-service`, plus `anonymous_id` (§6.3b). Identity fields on the two
commands. Write-path authorization. The owner-only world delete as a flag,
filtered server-side, **with Redis share/world cache invalidation as its own
task and its own test** (§10 — this is the item that only fails in
production). The claim (gateway → dna → only the families used). The
`system_settings` mechanism in `auth-service` with the two quota numbers as its
first settings (§9.3), then the quota counter and the **degrade-to-mock** path
through the generate command (§9), including the one toast that says so — one
`toast()` call on a stack that is already installed and already styled (§9.1).
*Property: a world has an owner, an owner can delete it, and the AI bill has a
ceiling.*

**Phase C — the gallery is real.** `queries.dna.library.list.v1`,
`/api/me/worlds`, and the web gallery reading the server list with
`localStorage` demoted to cache + anonymous path.
*Property: a visitor sees their worlds on a device that has never seen them.*

**Phase D — deliberately last, by owner priority.** `internal/mail` + a
provider + the mock. Email verification, then password reset — which is when
"forgot password" stops being a manual support answer (§5 cost 1). Then Google
OAuth, whose linking rule depends on verification existing (§5 cost 2). Then
GitHub. **Phase D ends there** — passkeys were removed from the plan entirely
by decision 18 and are a Phase E candidate, not a step of this one.

**Phase E — product work that ownership unlocks.** §14.5, in whatever order
the owner picks. The DNA-evolution question (§16 decision 6) lives here, and so
do passkeys (decision 18).

**The rename (§17) is not a phase.** Do it before Phase A or after Phase C.

---

## 14. The business case, then the triage

### 14.1 The three problems login solves, in the order they cost us

This is not "add auth because products have auth". Each of the three is a
present, describable loss.

1. **Every world is one cleared browser away from gone.** Ownership today is
   `SAVED_WORLD_IDENTIFIERS_STORAGE_KEY` in `localStorage`
   ([`savedWorlds.ts:3`](../../../apps/myunivokai-web/src/lib/savedWorlds.ts)) —
   so a private window, a new phone, a cleared cache, or Safari's own storage
   eviction destroys the visitor's entire collection while the rows sit intact
   in Postgres. The product's whole proposition is *"a portrait of you"*, and a
   portrait you cannot find again is a demo. This is the one that costs
   retention, and it costs it silently: nobody files a complaint about a world
   they can no longer prove existed.
2. **There is no ceiling behind the switch that turns the AI on.** Stated
   carefully, because the careless version is wrong: today's AI spend is
   **zero** — production runs `AI_PROVIDER: mock`. The loss is not a bill
   running now, it is that **`AI_PROVIDER: gemini` cannot safely be typed**
   while the only per-caller control in the platform is a per-IP token bucket,
   which is a politeness mechanism and not a budget. The product's central
   feature is therefore switched off, and the quota is what allows it to be
   switched on. See §9.2.
3. **Nothing can be sold, and nothing can be personalised further.** Both
   depend on a durable identity: quotas and tiers (§9), an evolving DNA (§14.5),
   a triptych of one person across three families. None of them are blocked on
   ideas; they are blocked on there being a *someone* to attach to.

### 14.2 The funnel this has to move, and where it can honestly be measured

The funnel:

```txt
land → create anonymously → see the world → keep it (claim) → return
```

The plan deliberately does **not** put a wall in front of step 2 (decision 5,
§16). Anonymous creation stays, because the first world is the pitch and asking
for a password before the pitch is how the pitch is lost. Login is offered at
the point the visitor has something to lose — after the world exists, which is
exactly what §7's claim flow is for. That single sequencing choice is the
business content of this plan; everything else is machinery.

**Where the numbers come from, and the one place they cannot come from:**

| Question | Answered by | Cost |
| --- | --- | --- |
| Registrations per day, logins per day, failed logins, lockouts | `audit_events` in `myunivokai_auth`, `GROUP BY date` — and `idx_audit_events_occurred_at` already exists ([`000001_init.sql:86`](../../../services/auth-service/migrations/000001_init.sql)) | one new `register` audit action; **no migration** |
| Creates per day, per family, success rate, duration | `world_projections` and `job_projections` in `myunivokai_analytics` — already projected, already keyset-indexed | nothing |
| Creates on the AI tier vs the mock tier | the gateway's own quota counter (§9) | a counter it already has to keep |
| **Claim rate — what share of anonymous worlds get claimed** | **Nowhere, by design.** §15 forbids `owner_account_id` in `myunivokai_analytics`, and that rule is not being bent for a metric | see below |

That last row is the honest gap, and it is the right trade. The claim rate is
answerable **without any identity** as two counts the family services already
have the columns for: worlds where `owner_account_id IS NOT NULL` over worlds
created in the same window. That is an aggregate over a column, computed in the
owning service and reported as a number — not an owner id crossing into the
staff database. If it ever needs to be a chart, it becomes a counter, not a
projection field.

### 14.3 What becomes sellable — and the two conditions before it is

Nothing in this plan charges anybody. It is what makes charging *possible*
later, and the sequence matters:

- **Phase B's quota is the pricing lever**, because a paid tier is then a
  number change and a provider-tier flag that already exists (§9). Without the
  quota there is no product difference to sell.
- **Two conditions before any money moves.** First, a real "forgot password" —
  decision 11 leaves a forgotten password as a manual staff answer, which is
  survivable for a free account and indefensible for a paid one. That is Phase
  D. Second, `auth-service` off the free tier (decision 3): a paying customer
  cannot be asked to wait 20-60 s for a cold start to log in.
- **What it would be**, when it comes: a Stripe integration and a pricing
  decision, not an architecture change (§14.5's last row). Explicitly out of
  scope here.

### 14.4 What this costs us to run, and what it saves

| | Before this plan | After Phases A-C |
| --- | --- | --- |
| AI spend ceiling | none — so the AI stays off, and spend is zero by *avoidance* (§9.2) | `visitors × 5 + accounts × 25` creates/day, which is what makes `AI_PROVIDER: gemini` typeable |
| New paid infrastructure | — | **none.** `auth-service`, its Neon database, Redis and the gateway all already exist and are already deployed; this plan adds no service, no database and no third-party account (§3.1 killed the one service that would have) |
| Ongoing cost added | — | one more free-tier instance being woken more often, and the cold-start UI that makes that honest (§11) |
| Support surface added | — | forgotten passwords, answered by hand until Phase D (decision 11) |

The "no new paid infrastructure" row is the single strongest business fact in
this plan and it is why it is worth doing now rather than after another
family: the identity half was already paid for by Sprint 4 (§2).

### 14.5 The ideas, triaged

The feasibility column is about **this** codebase, not in general.

| Idea | Verdict | Why, and what it costs |
| --- | --- | --- |
| A durable gallery across devices | **Ship in Phase C** | It is the plan. Today a cleared browser is a lost world |
| Owner can delete a world | **Ship in Phase B** | Nothing can be deleted by a visitor today, at all |
| Per-account AI quota / tiers | **Ship in Phase B — decided** | The only real cost control; no quota exists today. Decided as degrade-to-mock rather than refuse (§9) |
| Revoke or expire a share link | **Cheap follow-on** | `world_shares` exists; add `revoked_at` + an owner endpoint |
| "Your world is ready" email | **Phase D or later** | Creation is already async (202 + polling) and a cold fleet makes it slow, so the value is real — but it now waits on the mail provider that decision 12 moved to the end |
| Preferences on the account (ambient sound, immersive mode) | **Cheap follow-on** | Currently `localStorage` only; the storage is the only new part |
| **DNA that evolves with the person** | **Real project, and the most distinctive** | `dna_versions (profile_id, version_number)` is already `UNIQUE` and already the right shape — but every row is written with the constant `dnaVersionNumberOne = 1` ([`postgres_store.go:18,107`](../../../services/dna-service/internal/repositories/postgres_store.go)), because a profile is created per create and never revisited. Bind one profile per account and version 2, 3, … start meaning something: "your universe grows with you". Needs a product decision about what a new version does to worlds already rendered from an older one |
| One identity rendered as all three families (a triptych) | **Real project, cheap-ish** | The DNA is already family-neutral by design; today each create is an independent profile. With a per-account profile this is a loop, not new science |
| A public profile page under a handle | **Real project** | Needs a handle namespace, moderation and an abuse story. Do not start it casually |
| Collection / rarity badges | **Real project, cheap** | `rare_feature_rolls` is already projected in `analytics-service`; the mechanic is a read model away, but it is admin-scoped today and must not become the user-facing one |
| View counts on a share | **Cheap follow-on** | `telemetry-service` already counts requests by route; a per-slug counter is a small extension |
| Notify me when my share is viewed | **Rejected for now** | An email per view is an abuse vector and an annoyance; a digest is fine later |
| Ownership transfer / gifting | **Deferred deliberately** | v1 makes ownership write-once, which removes a race class. Transfer reopens it and needs its own plan |
| Comments on shared worlds | **Rejected** | Unbounded moderation cost for a one-person team |
| Follow / feed / social graph | **Rejected** | Same, plus it changes the product from "a portrait" into "a network" |
| Realtime co-visiting a world | **Rejected on the perf budget** | 60 fps is the floor; a realtime service plus other visitors' avatars is a different product. Revisit only after the WebGPU track |
| Visitor-uploaded assets in a scene | **Rejected** | Contradicts the asset licence rules and adds moderation of arbitrary binaries |
| Paid plans | **Blocked until quotas exist** | Needs Phase B first; then it is a Stripe integration and a pricing decision, not an architecture change |

**The owner's own idea list was not in the message that raised this plan.** Paste
it and it gets triaged into this table on the same terms — several of the rows
above are guesses at what was on it.

---

## 15. What must not happen

- **No `owner_account_id` in `myunivokai_analytics`.** Staff have no business
  reading who owns what. One event, two consumers, two allow lists. And because
  `contracts.WorldSnapshot` gains `OwnerAccountID *uuid.UUID` (a pointer, so
  messages already on the stream decode to `nil` rather than a misleading zero
  UUID), the baseline's standing rule applies: **no field is added to
  `WorldSnapshot` without the matching line in the data boundary in
  [`analytics-service-plan.md`](../services/analytics-service-plan.md)** — and
  here that line says *excluded*.
- **No authorization decision from the read model.** §6.1.
- **No `end_user` account holding a permission row**, and no `web` token
  accepted by the admin edge — in both directions, with tests.
- **No `library-service`** until the trigger in §3.1 actually fires.
- **No silent quality downgrade** — and **no announced downgrade that did not
  happen**, which is the same rule read from the other side. A world withheld
  from the AI tier says so **once, in a toast, to the person who hit the
  limit** (§9.1). The quota is allowed to cost the visitor an AI call; it is
  not allowed to cost them the truth. Three things follow, and the last two
  were found by the owner asking what happens on a mock deployment:
  - **no permanent tier badge** on the world itself — the friend who opens the
    share link hit no limit and is owed no explanation;
  - **no toast when the primary provider is configured as `mock`**, because
    nothing was withheld and there was no AI tier to lose;
  - **no toast when the primary failed and the fallback ran.** That is an
    incident, it belongs to staff, and showing it to the visitor blames them
    for our outage.
- **No world delete that skips the Redis caches** (§10), and no filtering that
  lives in the frontend.
- **No trust attached to an unverified email address** (§5) — including, and
  especially, the Phase D OAuth linking rule.
- **No renaming `aud=web`** with the app (§17).
- **No quota, TTL, lifetime or limit as a literal.** Named config constants —
  and for the values §9.3 moves into `system_settings`, the named constant
  stays as the **default**. A setting is an override, never the only copy of a
  value: the platform must boot and behave correctly with an empty settings
  table and an empty Redis.
- **No settings read on the create path that can wake `auth-service`** (§9.3).
  A Redis miss uses the compiled-in default. This is the one place the plan
  deliberately diverges from `RevocationChecker`, and the divergence is
  load-bearing.
- **No domain data in `system_settings`.** Operator policy only — no world,
  family, DNA or profile state, ever.
- **No secret in `system_settings`**, and nothing the platform needs in order
  to boot.
- **The bootstrap command stays staff-only.**

---

## 16. Decisions

### Decided by the owner on 2026-09-02

| # | Decision | Consequence, recorded on purpose |
| --- | --- | --- |
| 1 | **Extend `auth-service` to serve the product too**, rather than build a separate `identity-service` | Keeps every hardened primitive (Argon2id, lockout, rotation, reuse detection, audit, revocation). Staff and end users share one `accounts` table, so the separation must be **structural**: `kind`, the audience claim, `end_user` holds no permission row, and a test in both directions (§12) |
| 2 | **The product session is a bearer token in the `Authorization` header**, not a cookie. Login is an ordinary API call to the gateway and the browser keeps calling the gateway directly | No domain to buy, no BFF, no CORS change, and **no CSRF surface at all**. The cost is that an XSS can steal the refresh token from wherever the client keeps it — decision 14 later moved that store to a client-written cookie, which changes the exposure **not at all** — and that is what makes the web app's missing CSP a security control rather than hygiene (§4.2) |
| 3 | **`auth-service` stays on the free tier; the UI tells the truth about a cold start** | The first login after a quiet period can take 20-60 s. Turns into a frontend work item that is not optional (§11). Buying a warm instance later changes nothing else |
| 4 | **Account deletion is a soft flag with no purge job**, scoped to the product surface and **enforced server-side** | One column per table, reversible for ever, no destructive fan-out. Personal data stays in the database after a person asks to be gone, so erasure is discharged by a **manual runbook** instead of a scheduled job (§10) |
| 4b | **`analytics-service` is untouched** — deleted worlds keep counting in staff statistics | Historically accurate aggregates, no new projection field, and the data-boundary rule is not engaged. Costs staff a world in the admin list whose share 404s with no marker saying why (§10) |
| 5 | **Anonymous creation stays** | The whole of §7 depends on it. It is also the product's first impression, and removing it was never on the table |
| 6 | **One profile per create, as today** | Recommended and taken: it keeps the claim a single idempotent column flip. "One profile per account, with an evolving DNA" becomes its own plan in Phase E, because it turns the claim into a *merge* of N anonymous profiles - exactly the complexity that should not share a sprint with the first login this product has ever had |

### Also decided 2026-09-02, in the second round

| # | Decision | Consequence, recorded on purpose |
| --- | --- | --- |
| 7 | **Access token 7 days, refresh 3 months** (§4.4) | Safe *only* because the gateway checks `tokenVersion` on every request. Costs: revocation is account-wide, a stolen token is a 7-day credential, and **§11's free keep-warm effect disappears** — with a weekly refresh, `auth-service` is cold at almost every login |
| 8 | **Over quota degrades to the mock provider; it never refuses.** 5/day anonymous, 25/day account (§9) | A visitor always gets a world. Needs a tier flag on the generate command, and needs `anonymousId` to count against. The one way it goes wrong is a **silent** downgrade, so the UI must say what happened. **Amended by 17b: "which tier" was the wrong signal** — it must say *why*, because three different situations produce a mock world and only one is the visitor's business |
| 9 | **No account-deletion feature.** "Deleting" is a staff member marking the account inactive (§10) | Already built: `DisableAccount` revokes, bumps `tokenVersion` and audits. Removes the `auth-service` outbox, the `account.deleted` event and the fan-out — **§3.4's correction stops applying**. Leaves no data-erasure path; that is now a manual runbook |
| 10 | **World deletion is a flag**, product-surface only, **server-enforced**, analytics untouched (§10) | Reversible for ever. Redis share/world cache invalidation is part of the feature — without it the share keeps resolving for up to the TTL, a bug that appears only in production |
| 11 | **Registration is email + password, unverified. No mail in the first release** (§5) | Two costs: **no "forgot password"** until Phase D (a forgotten password is a manual staff answer), and **no trust may attach to the address** — which the Phase D OAuth linking rule depends on |
| 12 | **Email and OAuth are last** (Phase D) | Nothing in Phases A–C waits on a mail provider or a DKIM record |
| 13 | **Rename `myunivokai-web`** to a personalisation word (§17) | The exact form was settled in the fourth round — see **decision 15**, which supersedes this row's recommendation. `aud=web` does **not** move; the deployment name should not move until a custom domain does |
| 14 | **The session lives in cookies the client writes itself** (§4.2), not `localStorage` | Same XSS exposure, so the CSP still does the real work. Buys automatic expiry and a value the web app's own server could read; costs a few hundred bytes on every same-origin request |

### Also decided 2026-09-02, in the fourth round and after

The owner closed the rename and the backfill question directly, and **delegated
the rest** — *"you decide, I approve"*. The delegated calls are recorded here
with their reasoning, because a delegated decision that carries no argument is
indistinguishable from a guess.

Two rows here are **amendments rather than additions**, and both came from the
owner reading a decision back and finding it wrong: `17b` corrects `17`, and
`20b` narrows `20`. They are numbered as amendments so the record shows that
the first version was wrong rather than hiding it behind a clean list.

| # | Decision | Consequence, recorded on purpose |
| --- | --- | --- |
| 15 | **The name is `myunivokai-personalization`** — the owner's own word, in full (§17) | Closes open item 1. Two costs accepted with it, and §17 now discharges both in writing: the spelling is pinned to **US `-ization`**, and 26 characters land in every path, CI filter and Dockerfile |
| 16 | **No backfill of existing worlds. `NULL` is the answer** — confirmed by the owner | Already how the schema was designed (§6.2), so this is a confirmation rather than a change: every pre-plan world is anonymous and unclaimable, for ever, and that is correct — nobody can prove they made it |
| 17 | *(delegated)* **The mock tier shows one toast and no permanent marker**, using the `sonner` + `.lg-toast` stack the app already ships (§9.1) | Closes open item 2. The owner allowed silence; the toast was chosen because the mock tier is *visibly* deterministic, so silence reads as a broken product rather than as a limit. **Zero new dependencies** — the Liquid-Glass toast already exists and is already mounted. **Amended the same day, see decision 17b — as first written this decision was wrong** |
| 17b | **The toast keys on a reason code, never on the producing provider**, and `mock_configured` outranks `quota_exhausted` (§9.1) | The owner asked what happens when the deployment is *already* on mock, and the answer was that the toast fires and lies: production runs `AI_PROVIDER: mock` today, so a provider-keyed toast announces a limit on an AI tier that is switched off. Three routes lead to a mock-produced world and only one of them is the visitor's business. Costs one enum on the job response; buys a field that also tells staff "the primary is down" apart from "the primary is off", which today is only visible by reading `ai_generation_attempts` |
| 18 | *(delegated)* **No passkeys in this plan at all.** §5.4 becomes a Phase E candidate, not a phase | Closes open item 3. Decision 12 put email and OAuth at the end; a credential type that lands *after* the end is not a plan item, it is a wish. Nothing in §5 forecloses it — the credential model stays additive |
| 19 | *(delegated)* **§14.5's triage stands as the baseline** | Closes open item 4. The owner's list never arrived across four rounds; treating the triage as provisional for ever would block the sprint. Any idea added later is triaged on the same terms, which is a normal backlog change, not a plan revision |
| 20 | **The quota limits are admin settings in `auth-service`, not environment variables** — and the mechanism is general, so later settings need no `.env` entry either (§9.3) | Taken because `.env` is already at 170 config reads over 64 distinct names, 105 example lines and 176 `render.yaml` keys. Costs one table, one admin screen, two permissions and a Redis mirror. **Its one real risk is a cold start on the create path**, which is why the gateway reads only Redis and falls back to a compiled-in default rather than asking `auth-service` — the deliberate inversion of `RevocationChecker`. Counting and enforcement are unaffected by provider (owner's instruction): the mock provider suppresses the *toast*, never the *counter* |
| 20b | **All 64 variables were audited** (§9.3), and the rest are classified as never-a-setting or as costed batch-2 candidates | The owner asked for everything movable to be moved. Three facts found in the audit shrank that honestly rather than by preference: **five of the seven services have no Redis client**, so a setting read outside the gateway or `auth-service` is a project; **no value is read at the moment of use in the gateway** — every one is baked into a struct field at construction, so a registry row alone makes nothing live there; and **a value with a twin on the other side of a boundary must not be settable on one side only**. The audit also names four values that read as policy and are traps: the CORS origins, `TRUST_PROXY`, `REDIS_KEY_PREFIX`, and `ADMIN_ROUTES_ENABLED` — which as a setting would remove the screen used to turn it back on |
| 20c | **Batch 1 is `auth-service`'s own values only — nine settings** (§9.3). The other services are out of scope | The owner narrowed it after reading 20b: *"list what can be configured in auth-service; the other services are too hard, skip them."* This makes the batch **better**, not just smaller, because `auth-service` is the mirror of the gateway — `service.cfg.MaximumFailedAttempts`, `LockoutDuration`, `RefreshTokenTTL` and `InviteTokenTTL` are **already read at the moment of use**, so each is a one-line swap. Cost of the narrowing: the three gateway cache TTLs drop to batch 2. Exception kept on purpose: the gateway still gains **one** reader for the two new quota limits, because it is the service that enforces the quota — one new reader for new values, not a migration |
| 20d | **Setting keys are dotted database rows** — `auth.token.admin.access_ttl`, `auth.token.web.access_ttl`, `auth.lockout.duration`, `quota.ai.daily_limit.anonymous` — and **`.env` keeps `UPPER_SNAKE_CASE`, untouched** (§9.3) | The owner asked whether `.env` can use dots. It cannot: `export AUTH.TOKEN=1` answers *"not a valid identifier"*, and Docker Compose and Render inherit that restriction — so a dotted key can only ever be a database row and an `UPPER_SNAKE` name can only ever be an env var. That is a guarantee, not a convention, which is what makes running both namespaces side by side safe. Behind it, the owner caught the real defect: `auth_access_token_ttl` beside `auth_web_access_token_ttl` meant the first key **silently said "admin"**. Their form was `auth_myunivokai_<audience>_access_token_ttl`; two changes with checkable reasons. `myunivokai` comes out because the Redis key is already `<REDIS_KEY_PREFIX>:setting:<key>` and that prefix *is* `myunivokai`. And the key says `web` rather than `personalization` because §17 **freezes `aud=web`** in contracts, in issued tokens and in a `CHECK` on two tables — so the app name goes in the description the admin screen renders, not in the key, and one concept keeps one vocabulary. If the owner still prefers the literal word it is a one-string change that nothing depends on |

### Still open

**Nothing.** All twenty decisions above are taken. The plan is ready for
approval, and what follows approval is user stories and a sprint, not more
design.

Two things are *deliberately* undecided and must not be mistaken for gaps,
because deciding them now would be deciding them wrongly:

1. **What DNA version 2 means for worlds already rendered from version 1**
   (§14.5, the evolving-DNA row) — a product question that needs the first
   login to exist before it can be answered honestly.
2. **The pricing numbers** (§14.3) — blocked on the quota existing and on
   per-create cost being *measured* from `ai_generation_attempts` rather than
   read off a rate card (§9.2).

## 17. Renaming `myunivokai-web`

Requested on 2026-09-02: `web` describes the runtime, not the product, and the
name should lean into personalisation.

The constraint that rules out the obvious answers is already recorded — the
product is **"My Unique OK AI", not "my universe"**, and no name may privilege
the universe family over forest or ocean. Principle 8 adds the second
constraint: a name must not be borrowed from a family's most evocative corner.

**Decided 2026-09-02 by the owner: the app is `myunivokai-personalization`.**
The full noun, not the shortened adjective — the word names the *act* the
product performs, which is what was asked for. Both of the costs I raised
against it are accepted, and both are discharged here rather than left to be
rediscovered:

- **The spelling is `-ization`, US, for ever.** `-isation` is not an accepted
  variant anywhere in this repo — not in a folder, a deployment, an import
  path, a CI filter or a sentence. This is written down because a spelling fork
  in a path is a class of bug that survives review: it fails only on
  case-sensitive filesystems and only in CI, long after the person who typed it
  has moved on. One test of it exists already for free — the CI `paths:` filter
  simply stops matching, so the job silently does not run. Check that the job
  ran.
- **26 characters is the price and it is paid once.** `apps/myunivokai-personalization`.
  Nothing about it is load-bearing except that it is typed correctly.

| Candidate | Verdict |
| --- | --- |
| `myunivokai-personalization` | **Chosen by the owner 2026-09-02.** The literal word, the full noun, the act rather than the output. Its two costs are pinned above |
| `myunivokai-personal` | The shorter form I recommended, and no longer relevant except as the record of what was considered: same root, same meaning, fewer characters, but an adjective where the owner wanted the noun |
| `myunivokai-portrait` | The repo's own existing word ("portrait platform", "portrait families" in the architecture README) — but it names the *output*, and the owner asked for the *act*. Kept in the table because the docs will still say "portrait" everywhere and that is not a contradiction |
| `myunivokai-me` | Shortest, most personal, and **collides with `/api/me`**, the account route group this very plan introduces. "The me app calls the me routes" is a sentence nobody should have to disambiguate |
| `myunivokai-persona` | A persona is a mask worn outward; personalisation is about the person. The product means the second |
| `myunivokai-mirror` | Evocative, and that is the problem: principle 8 exists to stop exactly this kind of name |

Note that "portrait" stays in the *prose* either way — it is the word the
architecture README and the family docs use for what a world is, and renaming
the app does not oblige a vocabulary purge.

### What the rename actually touches, and the one part that must not move

- **Rename freely** — `apps/myunivokai-web/` → `apps/myunivokai-personalization/`,
  and with it its `Dockerfile.*`, the
  root and component `docker-compose-local.yaml`, `Makefile`, `run.sh`, the
  commented block in `render.yaml`, the CI paths in `.github/workflows/ci.yml`,
  and every mention across `agent-system/` (dozens — a rename is mostly a docs
  change by line count).
- **Do not rename the token audience.** `aud=web` stays `web`. It names the
  *channel a token is for*, not the app, and it is written into
  `contracts_auth.go`, into shipped tokens, and into `CHECK (audience IN
  ('admin', 'web'))` on **two** tables in `myunivokai_auth`. Renaming it costs a
  migration and a contract change to buy nothing. This is written down because
  it is exactly the kind of tidy-up a future reader will attempt.
- **Think before renaming the deployment.** The Vercel project's name decides
  the production URL, and principle 8's own warning applies with full force:
  a share URL that is already out cannot be renamed. So either keep the
  deployment name as it is and rename only the repository-side folder, or
  change both **at the moment a custom domain is attached** — which, per §4.1,
  is not now.

**Sequencing:** do the rename **before** Phase A or **after** Phase C, never
during. It touches almost every path in CI and none of the logic, so landing it
next to a large feature branch buys nothing but merge conflicts.

---

## 18. How much of this is demolition?

Asked directly on 2026-09-02, and it deserves a counted answer rather than a
reassuring one. **Almost none of it. Nothing in this plan deletes a capability
or rewrites a working path.**

| Component | What changes | Torn down |
| --- | --- | --- |
| `auth-service` | Handlers for the `web` audience, two config values, plus **one new table** for §9.3's settings. **No migration to any existing table** — `accounts.kind` already admits `'end_user'` and `roles`/`permissions` already carry `audience`, so identity itself needs none; `system_settings` is a wholly new table added beside them | Nothing. Staff paths untouched |
| `api-gateway` | A new `/api/auth` + `/api/me` route group, a `RequireProductAccessToken` middleware mirroring `admin_auth.go`, a third rate-limit bucket, the quota counter, `/api/admin/settings`, and a settings reader plus **five call sites** moved from a captured value to a lookup (§9.3) | Nothing. Existing product routes untouched |
| `universe` / `nature` / `ocean` | One additive migration each (2 nullable columns + 2 partial indexes), a `WHERE` clause on **4 query sites per service — 12 in total**, one claim consumer each | Nothing |
| `dna-service` | One additive migration (2 columns, 1 index), one query subject, one claim handler, one provider-tier branch | Nothing |
| `contracts` | Additive, nil-safe pointer fields | Nothing — see below |
| NATS ACL | About 3 lines: gateway +1 publish, dna +3 publish, each family +1 subscribe | Nothing |
| `myunivokai-admin` | Let the account list show `kind = 'end_user'` rows, plus a Settings screen rendering §9.3's declared registry | Nothing |
| the web app | **The only real rework**, and it is one file family: the gallery moves from localStorage-only to server-list-plus-cache (`savedWorlds.ts` + the gallery page), plus new auth pages, a session module, and an API-client change | Nothing — `localStorage` stays as the anonymous path and the cache |

**Three specific things that would have been expensive and are not:**

1. **No `schemaVersion` bump and no golden fixtures to re-roll.** `SchemaVersion`
   belongs to `ProfileDNA` ([`contracts.go:349`](../../../contracts/go/contracts.go)) —
   the AI *output* schema — not to the command or world envelopes this plan
   touches. Adding `ownerAccountId` and `anonymousId` to a command does not go
   near it. (There are only 8 fixture files in `contracts/fixtures` in any
   case.)
2. **Every existing world stays valid, and there is no backfill** —
   confirmed by the owner on 2026-09-02 (decision 16). Both new columns are
   nullable on purpose, and `ADD COLUMN` with no default is metadata-only on
   PostgreSQL 11+, so the migration is instant against live tables. Every
   pre-plan world stays `NULL` on both columns for ever, which is not a gap but
   the correct answer: an anonymous world created before `anonymous_id`
   existed has **no one who can prove they made it**, so it must never become
   claimable. §7's claim matches on `anonymous_id`, and `NULL` matches nothing.
3. **No account-deletion machinery**, because §10 decided not to build the
   feature — which retired the `auth-service` outbox, the `account.deleted`
   event and a handler in four services. That was the single largest block of
   work in the original plan.

**The real risk is breadth, not rework.** Phase B touches **six** services at
once — the three families, `dna-service`, the gateway, and `auth-service` for
§9.3's settings table — and that is the thing to be careful about. It is
exactly why the phases exist and why each service's piece is independently
deployable:

- the ownership columns are nullable and the contract fields are nil-safe
  pointers, so a family service deployed before the gateway simply sees `nil`
  and behaves as it does today;
- and the settings mechanism has the same property for the same reason: the
  gateway falls back to its compiled-in default, so it can ship **before**
  `auth-service` has the table, and `auth-service` can ship the table before
  anything reads it.

**There is no flag day** anywhere in Phase B, and that is a design property
rather than luck.

**The one change with a large file count and no logic in it is the rename**
(§17). That is why it is sequenced outside the phases.

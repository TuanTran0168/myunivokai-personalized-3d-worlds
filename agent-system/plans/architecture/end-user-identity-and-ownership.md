# End-user identity and world ownership

> **Document status:** Proposed. **Nothing here is approved and no code exists.**
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

The work is therefore smaller than it looks in the identity layer and larger
than it looks everywhere else — the expensive parts are **email
infrastructure**, **GDPR deletion across six services**, and **a session cookie
that cannot work in production until the product has one registrable domain**.

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
different registrable domains, so a session cookie set by the gateway is a
**third-party cookie** to the web app — blocked by default in Safari and Chrome.
See §4.

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

### 3.4 `account.deleted` requires giving `auth-service` an outbox it deliberately does not have

> `auth-service` … "Core NATS request-reply only, no JetStream command or
> outbox, since auth-service publishes no domain event."
> — `services/auth-service/README.md`

Its ACL matches: it may publish `_INBOX.>`, `$JS.API.>` and its own
`service.started` event, and nothing else (`nats-server.conf:94`). A GDPR
erasure that must reach six services **cannot** be a request-reply fan-out from
the gateway — a half-completed deletion is the failure mode that matters, and
only a durable event survives a service being asleep mid-erasure.

So account deletion costs `auth-service` an `outbox_messages` table, an outbox
publisher, one new publish subject and an ACL line. That is a real change to a
property the service README states as a design fact, and the README must be
corrected in the same change. It is priced in §13 Phase B, not discovered
during it.

---

## 4. Session architecture

### 4.1 The production prerequisite: one registrable domain

`SameSite=Lax` cookies are sent on same-**site** requests, where "site" is the
registrable domain. So:

| Web origin | API origin | Session cookie works? |
| --- | --- | --- |
| `myunivokai.vercel.app` | `myunivokai-gateway.onrender.com` | **No.** Third-party cookie, blocked by default |
| `myunivokai.com` | `api.myunivokai.com` | **Yes.** Same site, first-party, no CORS credential exemption needed |
| `localhost:3000` | `localhost:41800` | **Yes.** Ports are not part of site — local dev is unaffected |

**A custom domain is a hard prerequisite for shipping login to production**, and
it is the single item on this plan with a lead time that is not engineering
(DNS, and Render + Vercel domain attachment). It should be bought and attached
in Phase A, before the code that depends on it exists.

The alternative — a BFF relay in `myunivokai-web` mirroring
`apps/myunivokai-admin/src/lib/auth-relay.ts` — works with no domain, but it
puts every authenticated world call through a Vercel function and breaks the
"the browser talks to exactly one API origin" invariant that
[`frontend-gateway-consolidation.md`](frontend-gateway-consolidation.md)
records as implemented and active. **Recommended: the domain, not the relay.**
Keep the relay as the documented fallback.

### 4.2 Cookies

Mirroring the staff design exactly, with product-audience names:

| Cookie | Path | Attributes | Lifetime |
| --- | --- | --- | --- |
| `myunivokai_web_access` | `/` | httpOnly · Secure · SameSite=Lax · host-only | access TTL |
| `myunivokai_web_refresh` | `/api/auth` | httpOnly · Secure · SameSite=Lax · host-only | refresh TTL |
| `myunivokai_anonymous` | `/api` | httpOnly · Secure · SameSite=Lax · host-only | 180 days (§7) |

**Host-only, never `Domain=.myunivokai.com`.** A domain-wide cookie is sent to
every subdomain the product ever adds, and a single subdomain takeover then
reads sessions. The cost of host-only is that a Next.js **server** component
cannot read the session — which is acceptable because the authenticated area is
client-rendered today and stays that way (§8). Public share pages, the only
server-rendered fetches in the app, need no session.

### 4.3 CSRF

`SameSite=Lax` already blocks a cross-site `POST` from carrying the cookie,
which removes the classic form-submission CSRF. That is necessary and not
sufficient: add an **`Origin` header check on every state-changing product
route** (reject a mismatch with 403), because `Lax` is a browser behaviour and
the check is ours. No token ceremony, no hidden field — this is what the
current guidance actually recommends for a cookie session behind a
same-site API.

### 4.4 Token TTLs, per audience

Staff keep 10 minutes / 14 days. The product audience gets its own pair, which
means `auth-service` config gains two values rather than reusing one:

| | Access | Refresh |
| --- | --- | --- |
| `aud=admin` (unchanged) | 10 min | 14 days |
| `aud=web` (new) | **15 min** | **30 days**, rotating |

A longer access TTL does **not** widen the revocation window here, because the
gateway checks the Redis `tokenVersion` on **every** request, not only on
refresh (`revocation.go`). Revocation stays instant at any TTL; the TTL only
decides how often a refresh round trip happens. That is also why 30 days is
safe for a consumer product: reuse detection revokes the whole token family on
theft (`refresh_tokens.family_id`).

Not negotiable: `tokenVersion` is bumped on password change, password reset,
email change, "log out everywhere", and account disable.

---

## 5. What a production account requires

Everything in this section exists in no form today. It is the true cost of
"chuẩn prod, không MVP".

### 5.1 Credentials

- **Password**: Argon2id (exists). Minimum **12 characters**, no composition
  rules, no forced rotation — current NIST guidance, and the opposite of what
  most products still do.
- **Breached-password check**: Have I Been Pwned's range API (k-anonymity: send
  the first 5 hex characters of the SHA-1, match the suffix locally). Free, no
  key, no password ever leaves the service. Reject on signup and on password
  change; **never** block a login with it.
- **Uniform responses**: login, signup and reset must not reveal whether an
  email exists. This is a behavioural requirement with a test, not a comment.

### 5.2 Email verification and reset — and the infrastructure they need

No email is sent anywhere in this platform today. That is the largest single
gap between "login" and "login, in production".

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
- **Verification policy**: creating a world does **not** require a verified
  email; **publishing a share does**. Friction where the abuse is, not where
  the first impression is.
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

### 5.4 Passkeys — phase 2, and as an addition

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
   → gateway mints myunivokai_anonymous=<uuid> (httpOnly · Secure · Lax · 180d)
   → rides the generate command → profiles.anonymous_id → compose → worlds.anonymous_id

2. ... the visitor makes several worlds over several days, same cookie ...

3. signup or login → product session

4. POST /api/me/worlds/claim  (session cookie + anonymous cookie both present)
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
   → gateway clears the anonymous cookie
```

Properties that matter:

- **Idempotent.** `owner_account_id IS NULL` makes a replay a no-op, and makes
  the two-device race harmless: the second claim updates zero rows. A world is
  claimable exactly once, forever.
- **No new event type.** `revision` + outbox + `world.changed` are all in
  production.
- **The cookie is a bearer credential.** Whoever holds it owns those worlds.
  httpOnly keeps it from XSS, Secure off plaintext, Lax off cross-site POSTs,
  and 180 days bounds it.
- **Unclaimed expiry is a PII obligation, not a tidy-up.** An anonymous world
  holds raw personal input with no owner and therefore no one who can ever
  request its erasure. Unclaimed worlds older than the cookie's own lifetime
  should be purged by a scheduled job. This gap **exists in production today**
  and this plan is the first thing that makes it fixable.

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
not after it:

| Identity | Worlds per day | Enforced |
| --- | --- | --- |
| Anonymous cookie | small (e.g. 3) | Redis counter at the gateway, **before** the generate command is published |
| Verified account | larger (e.g. 20) | same |
| Unverified account | anonymous tier | same |

Enforced at the gateway because that is where the cost is *incurred*, and
returned as `429` with `Retry-After`. Every number is a named config constant,
never a literal — `coding-style.md` §1.

---

## 10. Deletion and export, and the PII map that makes them hard

The ownership column is what creates the legal obligation, so this ships with
it and never "in a later sprint". First, where personal data actually is —
this map is the deliverable, because deletion is only as good as it:

| Service | Personal data | On erasure |
| --- | --- | --- |
| `auth-service` | `accounts.email`, password hash, `refresh_tokens`, audit rows | Delete the account; keep a minimal audit stub with no email |
| `dna-service` | **`profiles.raw_input`** (the raw personal answers), `dna_versions.profile_dna`, `ai_generation_attempts.request_json/response_json` | Delete every row for the account's profiles |
| `universe/nature/ocean` | `worlds.visual_intent`, **`worlds.dna_snapshot`**, `nickname`, `role`, `quote`, variants, shares | Delete the worlds (see below) |
| `analytics-service` | admin projections, allow-listed | Must **never** receive `owner_account_id`. Aggregates survive; identifiers do not |
| `telemetry-service` | route rollups, no PII | Untouched |

**Recommendation: erasure deletes the worlds, and published shares do not
survive.** Anonymising is tempting and wrong here: the world *is* the personal
input — `dna_snapshot` and `visual_intent` are the personal answers, restated.
A "surviving, ownerless" world would keep exactly the data the request was
about. Deletion is soft for **30 days** then purged, so a mistaken deletion is
recoverable and the obligation is still met.

`GET /api/me/export` returns worlds + profile DNA + account metadata as one JSON
document. It is a second reason the read path exists.

Mechanism: `auth-service` gains an outbox and publishes
`myunivokai.events.auth.account.deleted.v1`; `dna-service` and the three family
services each gain a handler; `analytics-service` already wildcard-subscribes to
`myunivokai.events.>` and must be checked for what it does with an event it does
not recognise. See §3.4 — this is the item Track A under-priced.

---

## 11. Cold start

The domain services sleep, and 20–60 s of cold start on a **login screen** is
where abandonment actually happens. Three facts decide the mitigation:

1. An access token is verified **locally at the gateway** — no auth round trip
   per request. Only signup, login, refresh and logout touch `auth-service`.
2. An active session refreshes every ~15 minutes, and Render free instances
   sleep after 15 minutes idle. So **an active user keeps auth warm for free**;
   only the *first* login after a quiet period is cold.
3. That first login is also the least forgiving request in the product.

**Recommendation: `auth-service` is the one domain service that must not sleep.**
It is the cheapest paid instance in the fleet and it gates everything else. If
that is refused, the fallback is honest UI — the login button says what is
happening, the same way the create flow already handles a cold fleet — never a
spinner that looks broken.

Wake budget:

| Action | Services woken, worst case |
| --- | --- |
| Log in | gateway + auth = **2** (1 if auth never sleeps) |
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
- **Playwright** — signup, verify, login, create-while-anonymous, claim, and
  "my worlds" on a second browser context. The mock mail provider makes the
  verification link readable in test.

---

## 13. Phases

Each phase is a shippable state, and each has a property that is true at the
end of it. Sprints and stories come after approval; this is the ordering
argument.

**Phase A — an account exists.** Custom domain bought and attached. The `web`
audience turned on in `auth-service` (signup, login, refresh, logout, per-audience
TTLs). `internal/mail` + Resend + mock. Email verification and password reset.
Gateway `/api/auth/*` with its own rate-limit bucket, cookies, and the Origin
check. Account deletion (trivial now — nothing is owned yet). Web app: login,
signup, verify, reset, account menu.
*Property: a person can hold an account. Nothing owns anything.*

**Phase B — worlds are owned.** Ownership columns in three families and
`dna-service`. Identity fields on the two commands. Write-path authorization +
the delete endpoint. Anonymous cookie + claim (gateway → dna → families).
Quotas. `auth-service` outbox + `account.deleted` + a handler in all four owning
services + the PII map made real. The README correction from §3.4.
*Property: a world has an owner, an owner can delete it, and an erasure request
can be honoured.*

**Phase C — the gallery is real.** `queries.dna.library.list.v1`, `/api/me/worlds`,
`/api/me/export`, and the web gallery reading the server list with `localStorage`
demoted to cache + anonymous path.
*Property: a visitor sees their worlds on a device that has never seen them.*

**Phase D — optional, and separately decidable.** Google OAuth. Then GitHub.
Then passkeys as an additional credential.

**Phase E — product work that ownership unlocks.** §14, once the owner picks.

---

## 14. What login unlocks — triaged

The feasibility column is about **this** codebase, not in general.

| Idea | Verdict | Why, and what it costs |
| --- | --- | --- |
| A durable gallery across devices | **Ship in Phase C** | It is the plan. Today a cleared browser is a lost world |
| Owner can delete a world | **Ship in Phase B** | Nothing can be deleted by a visitor today, at all |
| Per-account AI quota / tiers | **Ship in Phase B** | The only real cost control. No quota exists today |
| Revoke or expire a share link | **Cheap follow-on** | `world_shares` exists; add `revoked_at` + an owner endpoint |
| "Your world is ready" email | **Cheap follow-on, high value** | Creation is already async (202 + polling) and a cold fleet makes it slow. The mail infrastructure arrives in Phase A anyway |
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
- **No domain-wide session cookie.** Host-only, per §4.2.
- **No `library-service`** until the trigger in §3.1 actually fires.
- **No deletion that only reaches some services.** The obligation is
  all-or-durably-retried.
- **No quota, TTL, lifetime or limit as a literal.** Named config constants.
- **The bootstrap command stays staff-only.**

---

## 16. Decisions the owner must make, not inherit

Recommendations are given; these are the ones where the recommendation could
reasonably be overruled and the plan would change shape.

1. **Custom domain now?** (§4.1) — a hard prerequisite for production login.
   If no, the BFF relay is the fallback and the FE work grows.
2. **Does `auth-service` stop sleeping?** (§11) — a paid instance, or an honest
   slow first login.
3. **Erasure: delete the worlds, or anonymise them?** (§10) — recommended
   delete, 30-day soft window. This one has legal weight.
4. **Does a published share survive its owner's deletion?** — recommended no.
5. **Anonymous creation stays?** — assumed **yes** throughout. If it goes, §7
   collapses to nothing and the product loses its first impression.
6. **The quota numbers** (§9) — 3/day anonymous, 20/day verified are
   placeholders for a real decision about the provider bill.
7. **Verification gate: publish, or create?** — recommended publish.
8. **Google OAuth in the first release, or Phase D?** — recommended Phase D, so
   that the password path is stable before a second credential type exists.
9. **One profile per account (DNA evolution), or one per create as today?**
   (§14) — the most product-shaping question on this list, and the one the
   existing schema is already built for.

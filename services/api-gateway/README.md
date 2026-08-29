# Myunivokai API Gateway

The gateway is the only public backend. It owns HTTP validation, request IDs,
CORS/security headers, Redis rate limiting/cache, JetStream publication, and
bounded Core NATS request-reply. It does not call AI or domain HTTP APIs.
DNA job, Universe, and Nature routes have separate handlers. Universe/Nature
subjects are fixed when each handler is constructed; shared RPC/cache mechanics
remain centralized in `RPCTransport`.

Generation flow:

1. `POST /api/{family}/worlds` validates the existing world-input contract.
2. The gateway publishes `myunivokai.commands.dna.generate.v1` and waits for
   JetStream `PubAck`.
3. It returns `202` with `jobId`, family, and `queued` status.
4. `GET /api/jobs/{jobId}` queries DNA Service through Core NATS.
5. World, variant, publish, and share routes query the owning family through
   versioned NATS subjects.

Redis is never a job queue or source of truth. Active jobs cache for one second;
terminal jobs, worlds, and privacy-safe share projections use configured bounded
TTLs. If Redis fails, cache becomes a miss and rate limiting falls back to a
conservative process-local bucket. Readiness reports the degradation.

## Service wake

Every service behind this gateway is a pure NATS consumer, and an instance on a
scale-to-zero plan wakes only on inbound HTTP. Nothing in normal operation ever
sends one any, so a query against a sleeping service gets an immediate
`no-responders` reply — not a timeout. The gateway starts it instead.

Three failures used to collapse into one `503 SERVICE_UNAVAILABLE`. They are
now told apart, because only one of them is worth retrying:

| Code | Status | Condition | What it means |
| --- | --- | --- | --- |
| `SERVICE_WAKING` | 503 + `Retry-After` | `nats.ErrNoResponders`, and a wake platform covers this service | Asleep, now starting. The request never arrived, so retrying is safe for any method |
| `SERVICE_UNAVAILABLE` | 503 | any other transport fault, or no wake platform covers this service | A real problem; retrying will not help |
| `SERVICE_TIMEOUT` | 504 | `context.DeadlineExceeded` | Awake but slow |

Reads wake reactively, on the `no-responders` reply. Writes cannot: publishing
a command to JetStream succeeds whether or not a consumer is alive, so
`POST /api/{family}/worlds` returns `202`, the job sits at `queued`, and every
response in the trace is a success — there is no error for a reactive wake to
hang off. That path therefore wakes dna and the family service **before**
publishing.

The gateway never waits for a cold start. Its `WriteTimeout` is about eight
seconds against a 20-60 second boot, and it is itself a scale-to-zero instance,
so holding connections open would turn one sleeping service into a second
outage. It answers immediately and lets the client's retry land after the wake.

`internal/wake` is shaped like dna-service's `internal/ai`: `Platform` adapters
that know only their vendor's mechanism (`wake/platforms`), a `Coordinator`
holding the policy they all share (single-flight through Redis, a detached
context, fire-and-forget), and `wake/factory` holding the switch — which fails
at startup on an unknown name rather than silently waking nothing.

Everything lives under that one directory on purpose. This is a workaround for
a hosting constraint, not a product feature, so it is built to be deleted:
`internal/wake/` is the whole subsystem, and the package doc there lists every
call site outside it. See §Removal in
[service-wake-mechanism.md](../../notes/plans/architecture/service-wake-mechanism.md).

`SERVICE_WAKE_PLATFORM` selects the adapter. `none` is the default and the
correct value on any always-on host, so leaving free tier is one line of
config. `http` covers Render free, Koyeb, Fly.io and Railway alike, since they
differ only in the URL an operator pastes into `DNA_SERVICE_URL` and friends. A
service left without a URL is simply not wakeable and keeps reporting plain
`SERVICE_UNAVAILABLE` — the gateway never promises a wake it cannot deliver.

**Only an unknown platform name is fatal at startup.** Missing URLs are not,
and the difference is deliberate: a typo can never become correct, while a
missing URL is a stage every first deploy passes through. The targets have to
be the services' *public* URLs, and on a scale-to-zero host those do not exist
until the deploy that creates the services has finished — so refusing to start
without them is a requirement the host makes impossible to satisfy, and it
takes the entire product edge down rather than just waking.

What replaces the check is a startup line naming what this process can
actually reach, which is not always what it was configured to reach:

```json
{"level":"warn","wake_platform":"http","wakeable_services":["dna","universe"],
 "unwakeable_services":3,"message":"service wake ready"}
```

`info` when every service has a URL, `warn` when any is missing, and a
distinct `warn` when none is — because a wake platform reaching nobody looks
from the outside exactly like the defect this mechanism was built to remove,
and that line is the only thing that tells them apart.

### What gets measured, and why it lives in Redis

Two numbers, both written by the gateway because it is the only process that
observes them:

| Redis key | Written when | Meaning |
| --- | --- | --- |
| `wake:count:<service>:<utc-day>` | a wake call is sent | wakes **actually made** — after the single-flight lock, so a burst of six requests against one sleeping service counts once |
| `wake:seen:<service>` | a service replies | last moment it is known to have been running, throttled to one write a minute |
| `wake:failures:<service>` | a wake is sent | wakes with no reply since. Cleared when the service answers, and expires by itself once nobody is trying |

`GET /api/admin/wake-stats` reads all three back in one `MGET`.

### Telling a sleeping service from a dead one

Both send the identical `no-responders` reply, and the gateway used to answer
both with `SERVICE_WAKING` — so a service that crash-looped on boot, was
deleted, or that the host refused to start left the caller retrying something
that was never coming back.

`wake:failures` counts wakes sent with no reply since. After three, which is
roughly three minutes against a one-minute lock window, the gateway answers
`SERVICE_UNAVAILABLE` with no `Retry-After`.

**The wake still goes out.** Only the promise stops. Giving up on the wake as
well would remove the one thing that could bring the service back, and a
single-flighted call costs almost nothing to keep making. A store that cannot
be read answers "not failing" — failing closed there would turn a Redis blip
into a fleet-wide outage report, which is a far worse error than one client
retrying a service that is genuinely down.

They are not events to `analytics-service`, and the reason is not volume.
`analytics-service` is itself scale-to-zero, so opening a page to view wake
statistics would wake it and produce a wake to view — the measurement would
become its own dominant signal. The gateway is awake by definition whenever it
records one of these, and Redis is managed, so this path stays outside what it
measures.

`wake:seen` exists because **a service cannot report its own sleep.** A host
sends `SIGTERM` before spinning an instance down, but that same signal covers
deploys and manual restarts, and an OOM kill or a panic sends nothing at all —
so self-reported sleep would capture every graceful stop and miss every bad
death. An observation from outside has no such bias: a reply proves the
service was alive at that instant, including a reply that carries a business
error, and the gap to the next wake bounds the sleep.

**Both numbers describe scale-to-zero hosting and are meant to die with it.**
On an always-on host there are no wakes to count and `wake:seen` is always
now. That is not a limitation of the implementation; the phenomenon itself
stops existing. Durable service-lifecycle history — restarts, crashes,
versions — is a different question that outlives this subsystem, and belongs
in service startup events rather than here. See
[platform-evolution-research.md](../../notes/evolution/platform-evolution-research.md)
§Track B.

Design and the exit plan: `notes/plans/architecture/service-wake-mechanism.md`.

## Admin route group (`/api/admin`)

A second, independently configured `chi` sub-router mounted alongside the
product group, gated by `ADMIN_ROUTES_ENABLED` (default `false`, so a bare
deploy of this binary never crash-loops the product edge over admin-only vars
nobody has filled in yet). It gets its own CORS handler (`ADMIN_ALLOWED_ORIGIN`,
exactly one origin, never a wildcard), its own Redis rate-limit bucket
(`internal/handlers/router.go`'s `adminRateLimitRouteKey`, distinct from the
product group's — sharing one key would let either group's limit silently
override the other's), and default-deny by construction: every route requires
either nothing (`/auth/login`, `/auth/invite/accept`), a presented refresh
cookie (`/auth/refresh`, `/auth/logout`), or a verified access token plus one
specific permission (every record and analytics route);
`internal/handlers/admin_router_test.go` enumerates the mounted routes and
fails if a future one is added without any of the three.

`internal/admin/auth` + `internal/middleware.RequireAdminAccessToken` implement
local Ed25519 access-token verification plus the Redis `tokenVersion`
cache-miss fallback (`auth-service` is called at most once per miss, never
per request) — see
[notes/plans/services/auth-and-admin-plan.md#how-b-works](../../notes/plans/services/auth-and-admin-plan.md#how-b-works).
Session tokens travel only as `httpOnly`, `Secure` (in production),
`SameSite=Lax` cookies, never in a JSON body — see
`internal/handlers/admin_auth_handler.go`.

### Where each admin route reads from

| Routes | Backed by | Permission |
| --- | --- | --- |
| `/accounts*`, `/roles*`, `/permissions`, `/audit` | `auth-service` | `account:*`, `role:*`, `audit:read` |
| `/overview`, `/timeseries` | `analytics-service` | `chart:read` |
| `/worlds` | `analytics-service` | `world:read` |
| `/jobs` | `analytics-service` | `job:read` |

Every handler in this group is a **pure relay**: it decodes query parameters
into a contracts type, publishes one subject, and writes the payload back
verbatim. It sums nothing, groups nothing and merges nothing — every aggregate
the admin dashboard shows was computed in SQL inside `analytics-service`.

The rule that matters most here is what is *absent*: **no admin route may
publish a `universe`, `nature` or `dna` subject.** An admin page must wait on
exactly two processes — auth for the token, analytics for the data — never on
a domain service that Render's free tier may have spun down.
`admin_analytics_handler_test.go` asserts it by inspecting every subject the
broker saw, so a future refactor that "helpfully" fans a world list out to the
family services fails the build rather than shipping a 30-second admin page.

```powershell
go test ./...
go vet ./...
go build ./...
go run ./cmd/gateway
```

Local default: <http://localhost:41800>. See the root Compose file for the full
NATS/Redis/domain stack and `contracts/openapi.yaml` for public routes.

# Service wake mechanism — cold-start handling for free-tier domain services

> **Document status:** Implemented; merged to `staging` in PR #118.
> **Implemented, and measured not to work on the host it was built for.**
> On 2026-09-04 the gateway was observed logging `"wake call sent"` for three
> different services, eleven times across three windows, while not one of the
> target containers produced a single log line — and each of those services
> started normally, in 7-13 seconds, when the same URL was requested from
> outside Render. Everything below describes the design accurately and the code
> matches it; the premise it rests on — *"the wake happened when the connection
> arrived"* — is what does not hold.
>
> **Re-measured 2026-09-04 after the `staging` → `main` release (PR #159), and
> the premise is now confirmed false rather than suspected.** The observability
> this document's own fix added is deployed, and the defect survived the
> release. Reduced to one variable — the same URL from two places, nothing else
> changed — `ocean` answered `503 SERVICE_WAKING` in **0.48-0.81 s** through the
> gateway on seven consecutive attempts across ~84 s and never started, then
> started in **12.46 s** on one request to that identical `/healthz` from
> outside Render, after which the gateway answered a truthful `404` in 1.18 s.
> So gateway → NATS → service → Postgres all work and the wake is the only
> broken part.
>
> **And the mechanism is now known, from the log fields this document's own fix
> added: `wake_status` is `429`, returned in 46 and 106 milliseconds, against
> the correct host.** A 429 is Render's edge declining the request **without
> passing it to the origin**, which is the exact refutation of the premise
> quoted above: the connection arrived and the wake did not happen. It is not a
> private-network block — the request reaches the routing layer and comes back
> with an HTTP status. It is also not self-inflicted: the gateway made 23 wake
> calls in six days across six services, and the single-flight lock is visibly
> working (eight requests in 96 s produced two wake calls). The refusal is
> **source-dependent** — the same URL from an external IP returns 200 and starts
> the instance — and the likeliest reading, recorded as an unmeasured hypothesis,
> is a limit applied per shared free-tier egress address rather than per account.
>
> **One rule in the code was provably too coarse, and it is now split — 2026-09-04.**
> The rule is `platforms/http.go`'s *"the status code still decides nothing —
> the wake happened when the connection arrived"* (and the same sentence on
> `WakeObservation`). Not §Status code contract below, which is about the codes
> the gateway returns to a client and is unaffected.
>
> That rule is right about **readiness** and wrong about **delivery**. A 502 is
> a booting instance and must not count as a failure —
> `TestHTTPWakeIgnoresTheResponseStatus` keeps that and should. A **429 is a
> refusal**: the origin was never asked, and calling it a wake sent is what made
> `"wake call sent"` false twenty-one times before the fields existed to show
> it. `WakeObservation.Refused()` now reads the status as a delivery verdict
> only, `Coordinator` logs `"wake call refused"` at **warn**, and readiness
> stays undecidable — `Refused() == false` means delivered, never awake. The
> classification is in the log and deliberately **not** in the control flow: the
> give-up tally was already correct, because `RecordWakeSent` counts the
> decision to call and only `RecordServiceSeen` clears it. Read
> [DEFECT-WAKE-001](../backlog/engineering-backlog.md#defect-wake-001--the-wake-mechanism-reports-waking-services-it-does-not-wake)
> before changing anything here: it records what was ruled out (instance-hour
> limits, wrong target URLs, the 5s timeout, NATS, Redis, CORS) so the same
> four hypotheses are not re-tested.
>
> One parameter changed as a result: `SERVICE_WAKE_TIMEOUT` is **45s**, not 5s.
> §Why the gateway must not wait for the wake to finish is unaffected — the
> wake is detached from the response, so this bounds a goroutine and not a
> request — but the old 5s could not cover a measured cold start, which made it
> a second, independent bug hiding behind this one.
> **Last source review:** 2026-09-04 (status, wake timeout, response visibility)
> **Owner's framing:** *"giống như fix bẩn cho render free tier vậy"* — a patch
> for a hosting-tier constraint, not a product feature. Treat it as such: keep
> it removable in one step (see §Removal when leaving free tier) — as built, that
> step is `SERVICE_WAKE_PLATFORM=none`, and full deletion is one directory.
>
> **Not every destination wants that step.** Leaving free tier for a paid plan
> or a real background worker retires this; moving to a self-hosted VPS does
> not, and the same configuration changes job from starting services to
> detecting dead ones. See §Reuse on a self-hosted VPS, which is the answer to
> *"tránh để deadcode"* and states plainly which part should still die.

## What was built, and where it differs from this design

The design below was followed. Three things ended up different, each because
the owner asked for a shape that survives leaving Render:

**A platform abstraction, not a Render-specific ping.** The wake is an
adapter behind an interface — `internal/wake.Platform`, with
`internal/wake/platforms` holding one adapter per mechanism and
`internal/wake/factory` holding the switch. This mirrors `ai.Provider` /
`ai/providers` / `aifactory` in dna-service exactly, including the fail-fast on
an unknown name. Policy that every platform shares — single-flight, the
detached context, fire-and-forget — lives in `wake.Coordinator`, the way
`ai.Orchestrator` owns timeout and repair while providers stay dumb. Moving to
Koyeb, Fly.io or Railway is a URL change; moving to something that scales a
Deployment through an API is a new file plus one `case`.

**`SERVICE_WAKE_PLATFORM`, not `SERVICE_WAKE_ENABLED`.** §Removal proposed a
boolean. A name is strictly better: `none` *is* the off switch, so there is one
knob instead of two that can contradict each other, and `none` is an honest
description of an always-on host rather than a disabled feature. It also
mirrors `AI_PROVIDER=mock` — the default that reaches nobody's infrastructure.

**Mutations retry too.** §Frontend change kept "mutating requests are never
retried automatically". That rule is right for `429` but wrong here:
`SERVICE_WAKING` is produced by exactly one condition — the broker reporting
that no subscriber existed — so the request provably never reached a service
and a repeat cannot publish or create anything twice. Without this, the
Publish button on a sleeping service simply fails.

**Corrected 2026-08-12 — missing URLs no longer stop the deploy.** As first
built, `SERVICE_WAKE_PLATFORM=http` with zero `*_SERVICE_URL` was fatal at
startup, on the reasoning that a deploy believing it has wake coverage and
having none is worse than a loud failure. That reasoning was right about the
danger and wrong about the remedy, and it would have crash-looped the gateway
on the first sync of the blueprint — taking down the product edge, not just
waking.

The trap is structural rather than an oversight in configuration order. The
targets must be each service's **public** URL, because
[Render's own documentation](https://render.com/docs/free) states that *"Free
web services can't receive private network traffic"* — so `fromService` with
`property: host`, which is how a blueprint would normally reference a sibling
service, yields a private hostname that could never wake anything. Public
`.onrender.com` URLs do not exist until the sync that creates the services has
finished, and `render.yaml` has no string composition to build one. There is
therefore no ordering in which a first deploy can satisfy the check.

It was also inconsistent with the design on either side of it. Four missing
URLs out of five was already handled gracefully — `Supports` answers false and
those services keep reporting plain `SERVICE_UNAVAILABLE` — so the fifth being
fatal drew a cliff where this document describes a slope. And the same
question had already been settled once in this codebase: `ADMIN_ROUTES_ENABLED`
defaults to false precisely so *"a fresh deploy of this binary must not
crash-loop the product edge over admin-only vars nobody has filled in yet"*.
Waking is an optional capability of the edge, on exactly those terms.

The distinction that survives is between a **mistake** and a **stage**. An
unknown platform name is a mistake — no later configuration makes `renderr`
mean anything — and stays fatal. A missing URL is a stage every first deploy
passes through. What replaces the check is `cmd/gateway.logServiceWake`, which
states on every boot which services this process can actually reach, at `warn`
whenever that is fewer than all of them. The original fear was silent
half-configuration; the answer to it is a line that cannot be silent, not a
crash that cannot be avoided.

**Extended 2026-08-12 — the mechanism can now be checked, and it can give up.**
As first built the wake was unobservable and infinitely patient. Two additions,
neither of which changes when a wake fires:

*Statistics, in Redis, served by the gateway.* `wake:count:<service>:<day>`
counts wakes actually sent (incremented at the decision to call, not after it
returns — a host that starts an instance on connect has already started it, so
counting successes would undercount exactly the slow starts worth knowing
about), and `wake:seen:<service>` stamps the last moment a service answered
anything. `GET /api/admin/wake-stats` reads them with **one `MGET`**, never a
`SCAN`. The reason it lives in Redis rather than in analytics-service is
§Relationship to the analytics plan taken one step further: the page that
reports which services sleep must not itself wake one. The gateway is awake by
definition and Redis is managed, so opening the page costs nothing.

*A give-up threshold.* Asleep and dead send the identical `no-responders`
reply, and the gateway answered both with `SERVICE_WAKING` plus a `Retry-After`
— so a service that crash-looped on boot, whose URL was wrong, or that the host
refused to start left the client retrying forever. `wake:failures:<service>`
counts wakes sent with no reply since; past three (≈3 minutes against a
one-minute lock window, comfortably beyond the slowest cold start this platform
produces) the answer becomes `SERVICE_UNAVAILABLE` with no `Retry-After`. **The
wake still goes out** — only the promise stops, because giving up on the wake
would remove the one thing that could still fix this. The counter needs nobody
to reset it: each wake refreshes a short expiry, so a recovered service loses
its tally when wakes stop, and a reply clears it sooner. That is also what makes
it safe across more than one gateway instance — the instance that sees the
recovery need not be the one that saw the failure.

Both are optional in the same way `SingleFlightLock` is: a nil `StatsRecorder`
turns them off without affecting a single wake, and a store that cannot be read
answers "not failing". Measurement must never break the thing it measures, and
failing closed there would turn one unreachable Redis into a fleet-wide outage
report.

**Extended 2026-08-14 — the read model is woken by writes, not only by
readers.** One case the design below does not reach, found while researching
end-user ownership and recorded as B4 in
[platform-evolution-research.md](../../evolution/platform-evolution-research.md#the-retention-trap--and-it-applies-to-library-service-too):
`analytics-service` wakes only when a staff member opens the console, and
`MYUNIVOKAI_EVENTS` retains seven days. A week with no visit expires the oldest
events **unconsumed**, and the projection is then permanently wrong with nothing
logged anywhere — a message that ages out of a stream is not a failure anybody
observes.

Reactive waking structurally cannot reach it, for the same reason `POST
/worlds` wakes proactively: analytics-service is never the responder for any
request a client makes, so no `no-responders` reply exists to hang a wake off.
`WorldHandler.wakeReadModel` therefore fires on each of the four mutations that
produce an event — create, add variant, select variant, publish — and this is
the third mitigation the research section lists, chosen because it is the one
that composes: the consumer wakes at the moment there is something to consume,
and stays up for one idle window per burst of activity rather than on a
schedule.

Two boundaries make it a wake rather than a keep-alive, and both are enforced by
a test:

- **It fires after the write is accepted**, unlike the two wakes in
  `CreateWorld` that overlap cold starts on the critical path. The read model
  has hours to catch up, not milliseconds, so waking it only once an event
  provably exists keeps a client retrying a `404` from becoming a service that
  never sleeps.
- **Reads wake nothing.** Product read traffic is continuous; waking analytics
  on any of it would hold an instance up permanently for a console nobody has
  opened.

What it deliberately does not cover: `service.started`, which no client asks
the gateway for. A fleet that restarts during a quiet week can still lose a row
of boot history. That costs a line on the Fleet screen, not a wrong world
count, and covering it would mean waking the read model on every wake of every
service.

*Not part of this mechanism, though built alongside it:* each service announces
its own boot on `myunivokai.events.<service>.service.started.v1`, which
analytics-service projects into `service_starts`. That is durable
service-lifecycle history and it survives every removal path below, because
restarts happen on every platform. A process cannot report its own death — an
OOM kill runs no handler — so it reports its birth, and an unscheduled start is
the evidence a stop happened.

Everything else — proactive on write, reactive on read, the Redis single-flight
lock, the three-way status split, `/healthz` as a start signal — is as written
below.

The owner's constraint at the time of building: *"chỉ wake up 1 lần duy nhất
khi cần dùng thôi, sau đó ko ai dùng nữa cứ để nó sleep cho đỡ tốn 750h"*. That
is what this is: one call per sleeping service per lock window, triggered by
demand, with no schedule anywhere. Nothing keeps an instance awake, and
`render.yaml` still sets no `healthCheckPath` on any service.

## The defect, reproduced

Live test against production, 2026-08-05:

```
POST https://myunivokai-gateway.onrender.com/api/nature/worlds
→ 202 Accepted

GET  https://myunivokai-gateway.onrender.com/api/jobs/01KZ9CKNPBMES0RC78S2WQ8G8A
→ 503 Service Unavailable
```

The 202 proves the gateway and JetStream accepted and persisted the command.
The 503 — not 504 — proves the failure was not a slow response timing out; it
was immediate, because [rpc_transport.go:69-77](../../../services/api-gateway/internal/handlers/rpc_transport.go#L69-L77)
only produces `504 SERVICE_TIMEOUT` on `context.DeadlineExceeded`. Anything else,
including a Core NATS `no-responders` reply that returns instantly, becomes
`503 SERVICE_UNAVAILABLE`. No subscriber was listening on
`queries.dna.job.get.v1` — dna-service was asleep.

## Root cause

Render free web instances wake only on inbound HTTP. A NATS message cannot wake
one. The domain services ([dna](../../../services/dna-service/cmd/service/main.go),
universe, nature) receive no inbound HTTP in normal operation — they are pure
NATS consumers — so nothing in the current system ever wakes them once Render
puts them to sleep after idle.

Two request paths fail differently, and the difference matters for the fix:

| Path | Transport | Failure mode when the consumer is asleep |
| --- | --- | --- |
| Commands (create world) | JetStream `PullSubscribe`, workqueue retention | Message is durably held. **Not lost.** Nobody is pulling, so the job never advances past `queued` |
| Queries (list, get, publish, share, job status) | Core NATS `QueueSubscribe` | No responder exists. NATS replies `no-responders` **immediately** — not a timeout |

This split makes the write path more dangerous than the read path: a `POST`
returns `202` and looks successful, then silently stalls. The read path at
least surfaces as an error the caller can react to.

## Design: proactive wake on write, reactive wake on read

A wake mechanism that only reacts to `no-responders` is not sufficient by
itself. Trace what happens on `POST /api/nature/worlds` with reactive-only wake:

1. `POST` → `202` — a command publish never fails this way, so there is no
   error to react to.
2. dna-service is still asleep. Nobody wakes it.
3. `GET /api/jobs/{id}` → dna is queried, not nature → if dna happens to be
   awake (or was woken by an unrelated read elsewhere), this returns `200
   queued`/`processing` with no error at any point.
4. nature-service is never the target of any client-facing request during this
   flow. It is never woken. The job never leaves `processing`.

Every HTTP response in that trace can be `200`. There is no signal to hang
retry logic on. This is why the write path needs a **proactive** wake — fired
on `POST`, before any error exists — while the read path can stay **reactive**,
firing only when a request actually hits `no-responders`.

```
Write path (POST /api/{family}/worlds):
  gateway receives request
    → fire-and-forget GET to dna's  /healthz
    → fire-and-forget GET to {family}'s /healthz
    → publish command to JetStream as today
    → return 202 immediately (no added latency; the job flow is already async)

Read path (any NATS request/reply):
  gateway sends request, gets no-responders
    → SET myunivokai:wake:<service> NX EX 60   (Redis single-flight lock)
    → if lock acquired: fire-and-forget GET to that service's /healthz
    → respond 503 SERVICE_WAKING with Retry-After
    → subsequent requests within the 60s window see the lock held and skip the ping
```

## Status code contract

The current code collapses every non-timeout NATS error into one `503
SERVICE_UNAVAILABLE`. That must split, because the client needs to know whether
retrying is useful:

| Code | Condition | Meaning | Client action |
| --- | --- | --- | --- |
| `503 SERVICE_WAKING` | `errors.Is(err, nats.ErrNoResponders)`, wake ping fired | Service is asleep, has been pinged | Retry after `Retry-After` |
| `503 SERVICE_UNAVAILABLE` | Any other transport failure (NATS disconnected, marshal error, etc.) | Real infrastructure problem | Retry is unlikely to help |
| `504 SERVICE_TIMEOUT` | `context.DeadlineExceeded` | Service is awake but slow | Unchanged from today |

As built, `SERVICE_UNAVAILABLE` covers two further cases that the design above
folded into the first row, both because `SERVICE_WAKING` is only honest when
something is genuinely being started: no wake platform supports this service
(an always-on host, or a URL nobody supplied), and the wake has gone unanswered
past the give-up threshold. Neither carries a `Retry-After`. The wire contract
is unchanged for clients — a code they already handle, without the promise
attached.

## Why the gateway must not wait for the wake to finish

Two independent reasons rule out "ping, wait, retry internally, then answer the
original request":

- **Server write timeout.** [main.go:51](../../../services/api-gateway/cmd/gateway/main.go#L51)
  sets `WriteTimeout` to roughly `NATSPublishTimeout + NATSRequestTimeout +
  margin` — about 8 seconds. Docker cold start on Render free is commonly
  20–60 seconds. The HTTP response would be cut off before the domain service
  is even reachable.
- **The gateway is also a free instance.** Holding connections open for 30–60s
  while a domain service boots risks exhausting the gateway's own capacity —
  turning one sleeping service into a second incident.

The correct shape is: answer fast, tell the client when to come back, let the
client's own retry naturally land after the wake completes.

## `/healthz` is a start signal, not a readiness signal

The existing health handler in all three domain services
([dna example](../../../services/dna-service/cmd/service/main.go#L31-L33)) returns
`200` as soon as the HTTP mux binds a port — deliberately, since this is the
mechanism Render free-tier deployment already relies on to avoid needing a
Background Worker plan. It returns `200` **before** the NATS messaging runtime
has finished `Run()`.

A `200` from the wake ping means only "the container has started, or was
already running." It does not mean the service can answer a query yet. This is
why the mechanism is fire-and-forget with a client-side retry delay, never
"ping until 200, then retry immediately."

A separate, later improvement — making `/healthz` report true readiness (NATS
connected, DB reachable), the way the gateway's own `Readiness` handler already
does — is out of scope here and must be done carefully: if a domain service
ever gets a `healthCheckPath` in `render.yaml` (none is set today), a health
endpoint that reports non-200 during startup risks Render killing the container
before it finishes booting.

## Idempotency and duplicate-ping safety

The Redis `SET NX EX 60` lock exists purely to avoid noise — N concurrent
requests hitting a sleeping service should produce one outbound ping, not N.
It is not a correctness requirement: an extra HTTP GET to a public `/healthz`
endpoint is harmless. The gateway already holds a Redis client and the
`myunivokai` key prefix convention (`REDIS_KEY_PREFIX`), so this is additive,
not new infrastructure.

## SSRF note

The wake targets (`DNA_SERVICE_URL`, `UNIVERSE_SERVICE_URL`,
`NATURE_SERVICE_URL`) are operator-supplied env vars, not request-derived —
there is no user input in the URL. Validate scheme/host at config load time
regardless, so a misconfigured env var fails fast at startup rather than
producing a silent no-op or an unexpected outbound call at request time.

## Frontend change

[api.ts:57-90](../../../apps/myunivokai-personalization/src/lib/api.ts#L57-L90) already
retries idempotent GETs once on `429`, reading `Retry-After`. Extending the same
mechanism to `503 SERVICE_WAKING` — with a larger retry budget (roughly 5–8
attempts across 30–60s, to cover real Render cold-start duration) — is a
parameter change, not a new code path. The existing rule stays: mutating
requests are never retried automatically.

The frontend never learns about wake targets or service topology. It only
learns to treat one specific error code as retryable. This also removes the
need for anything like a dedicated `POST /api/admin/wake` endpoint in the
admin app — see the cross-reference below.

## Relationship to the analytics plan

[analytics-service-plan.md](../services/analytics-service-plan.md) originally proposed a
dedicated `POST /api/admin/wake` route for the admin app to call on mount. That
is now removed from that plan: if the gateway's reactive wake is in place
globally, the admin app's first query against a sleeping analytics-service
naturally receives `503 SERVICE_WAKING` and retries like any other client. A
separate endpoint would have made the frontend into a wake-aware caller for no
benefit — precisely the layering this document argues against in §Frontend
change.

## Removal when leaving free tier

This is designed to be deleted, not maintained indefinitely, once domain
services stop sleeping (paid plan, or converted to genuine Background Workers
as [the original V1 deployment doc](v1-2026-07-22/deployment.md)
specifies).

| Part | On leaving free tier |
| --- | --- |
| Proactive ping on `POST` | **Remove.** Becomes a useless outbound call on every world creation |
| Read-model wake on mutation (`wakeReadModel`) | **Remove only once `analytics-service` itself stops sleeping.** It is not part of the wake-on-demand design above: it exists because a consumer that sleeps through a seven-day retention window loses events silently. A paid gateway with a still-free read model keeps needing it |
| Reactive ping on `no-responders` | **Remove** the ping call itself |
| `no-responders` vs `DeadlineExceeded` classification | **Keep permanently** — see below |
| `SERVICE_WAKING` / `SERVICE_UNAVAILABLE` / `SERVICE_TIMEOUT` split | **Keep permanently** |
| Frontend retry on `SERVICE_WAKING` | **Keep permanently**, though it will rarely fire |
| Redis single-flight lock | **Keep** — reusable for any future expensive side effect triggered by a request burst |
| Wake counts (`wake:count:*`) | **Remove.** The number is instance-hours spent; an always-on host spends none |
| Give-up tally (`wake:failures:*`) | **Remove.** It counts unanswered wakes, and no wake is sent |
| `last_seen` stamp (`wake:seen:*`) | **Keep** — it is written on every reply and never depends on a wake having happened |
| `service_starts` (analytics) | **Keep permanently.** Never part of this mechanism; restarts happen on every platform |

The three statistics do not share a fate, and the reason is worth stating
because it is not obvious from the code: `RecordWakeSent` runs inside
`wakeDetached`, so it stops when wakes stop, while `Seen` is called from the
success path of every reply and has no dependency on the wake at all. Setting
`SERVICE_WAKE_PLATFORM=none` therefore silences the first two and leaves the
third working — which is the correct outcome on a host that does not sleep, and
**not** the correct outcome on a VPS. See the next section.

**As built, removal is two steps and the first one is free.** Setting
`SERVICE_WAKE_PLATFORM=none` makes the whole thing inert with no code change —
that is the step for moving to a paid plan or a real background worker, and the
code that stays costs one map lookup per failed request. Actually deleting it
is `rm -r services/api-gateway/internal/wake` plus a call-site list that the
package doc in `internal/wake/platform.go` enumerates in full. Everything the
mechanism owns lives under that one directory precisely so the second step is a
mechanical edit rather than a hunt.

Gate the ping behavior behind a single setting — as built, `SERVICE_WAKE_PLATFORM=none`
— so the removal step is a config change, not a code change. Keep the classification and
retry contract regardless of the flag: `no-responders` is a legitimate,
recurring production condition even on paid plans — during a rolling deploy, a
crash-restart, an OOM-kill, or a scale-down — and today the gateway detects it
but discards the distinction. That part is not a free-tier workaround; it is
missing production telemetry.

## Reuse on a self-hosted VPS

The section above assumes one destination: a host whose instances never sleep,
reached by paying for them. A **self-hosted VPS is a different destination with
a different answer**, and the difference is a single fact — on a VPS there is a
supervisor. `systemd`, or Docker's `restart: unless-stopped`, is already
responsible for restarting a process that died, and it is strictly better at it
than the gateway: it sees the exit code, it does not need a request to arrive
first, and it can back off.

That fact retires the *action* and promotes everything around it. On free tier
a `no-responders` reply is routine — it means "asleep", which is the normal
state of an idle service and carries no information. On a VPS nothing is ever
asleep, so the same reply means a crash, a rolling deploy, an OOM kill or a
misconfiguration. **The signal this mechanism was built to react to becomes an
incident report.** The detection is worth more after the migration than before
it, which is the opposite of what "free-tier workaround" suggests.

| Part | On a VPS | Why |
| --- | --- | --- |
| `no-responders` vs deadline vs broker fault | **Keep — worth more** | Every occurrence is now an incident rather than an idle service |
| Give-up tally, `SERVICE_UNAVAILABLE` past the threshold | **Keep — worth more** | It is the only thing that separates "restarting" from "down", which is the question a VPS actually asks |
| `last_seen` per service | **Keep** | A liveness view with no agent, no scrape and no schedule — a byproduct of traffic that already happens |
| Wake counts | **Keep, relabelled** | On free tier the number is *cost* (instance-hours from a 750h budget). On a VPS hours are not metered, so the same number is *how often the fleet needed intervention*. Same data, different question — the admin page needs a different word, not different code |
| Redis single-flight lock | **Keep** | Already generic; nothing about it is vendor-specific |
| `service_starts` (analytics) | **Keep** | Independent of all of this, and on a VPS it is the restart log |
| Proactive ping on `POST` | **Delete** | It exists because a JetStream publish produces no error to react to, so nothing would ever wake the consumer. On a VPS the consumer is always subscribed, and if it is not, the next query catches it reactively |
| The wake call itself | **It stops doing anything** | Whether to keep sending it is the one real decision below |

### The migration step, and the one wrinkle in it

`SERVICE_WAKE_PLATFORM=none` is *not* the right setting here, and that is worth
being precise about because it is the obvious move. `Coordinator.Wake` returns
at `Supports` before `recordWake` runs, so `none` silences the wake counter and
the give-up tally along with the wake — and those are the two parts a VPS wants
most. Only `last_seen` survives, because `Seen` is called from the reply path
and never depended on a wake. The detection is coupled to the action having a
platform.

Two ways out, and the cheap one is good enough:

**(a) Keep `http`, point it inward.** `SERVICE_DNA_URL=http://dna-service:8080`
is valid configuration today — `readServiceWakeTargets` accepts any absolute
`http` or `https` origin with no path, query or credentials, so a compose
service name or `127.0.0.1:port` passes. Everything keeps working with **zero
code change**, and the Render constraint inverts in our favour: free tier
*forced* public `.onrender.com` targets because *"free web services can't
receive private network traffic"*, while a VPS lets the gateway use the
internal address — no egress, no TLS, nothing newly exposed.

The honest cost is one `GET /healthz` per incident that starts nothing, because
the supervisor got there first. It is not a health check either — the adapter
deliberately discards the status code (see §`/healthz` is a start signal, not a
readiness signal). What actually decides the tally is the **NATS** reply: `Seen`
clears it. The HTTP call is incidental, and it fires only on `no-responders`,
never on a schedule, so a healthy fleet sends none at all.

**(b) Decouple the tally from the platform.** Count "`no-responders` replies
with no successful reply since" in `classifyTransportError` rather than in
`wakeDetached`, and the detection works with `platform=none`. This is the
cleaner design and the key would need an honest rename — it would no longer be
about wakes. It is deliberately **not** built now: it is speculative work for a
migration that has not been decided, and (a) is free and already proven.

### If the gateway really should start things

Only when there is no supervisor — containers run without a restart policy, or
something scaled to zero on purpose to save VPS memory. Then `wake.Platform` is
the seam it was built to be: a Docker-socket or systemd/D-Bus adapter is **one
file in `internal/wake/platforms` plus one `case` in the factory**, and nothing
on the request path changes.

Prefer the supervisor anyway. Two components restarting the same process is two
owners for one responsibility, and the one that loses that argument is always
the one that has to wait for a request first.

### Not dead code, and not kept out of sentiment

The test for dead code is whether removing it would lose something. Removing
this on a VPS would lose the fleet's only continuous liveness signal — and the
replacement everyone reaches for, Prometheus, is **structurally unavailable to
this architecture**: a scrape on a schedule keeps every instance permanently
awake, which is exactly what the whole design exists to avoid, and would
prevent ever moving back. See
[platform-evolution-research.md](../../evolution/platform-evolution-research.md) §The
constraint that decides everything.

So: on a VPS, delete the proactive ping, keep the classification, keep the
statistics, point the targets inward, relabel the counter on the admin page,
and let the supervisor own restarts. What should die is the *claim* that the
gateway starts services. What should live is everything it learned by trying.

## Tension with the documented V1 target

Recorded for honesty, not as a blocker: the approved V1 architecture states
three times, in
[solution-architecture.md:311-315](v1-2026-07-22/solution-architecture.md#L311-L315),
[deployment.md:39-41](v1-2026-07-22/deployment.md#L39-L41), and
[contracts-and-roadmap.md:64](v1-2026-07-22/contracts-and-roadmap.md#L64),
**"do not add an HTTP wake-up hack"** — on the assumption that domain services
would run as paid Render Background Workers, which do not sleep.

`render.yaml` already deploys all three domain services as `type: web, plan:
free`, not Background Workers. That deviation from the documented target
predates this document and predates the wake mechanism proposed here — it is
why the defect in §The defect, reproduced exists at all. This document proposes
a mitigation for a deviation that has already happened, not a new one. If the
fleet ever moves to paid Background Workers as originally specified, this
entire document — proactive ping, reactive ping, and the Redis lock — becomes
unnecessary, though the status-code classification and frontend retry contract
remain good practice regardless (see §Removal when leaving free tier).

## What is not in scope here

- Making `/healthz` report real readiness — separate, later improvement.
- Any change to command-path (`PullSubscribe`) retry or dead-lettering — the
  workqueue already holds commands durably; this document only addresses
  getting a consumer awake to pull them.
- A cron or scheduled keep-alive — explicitly rejected by the owner earlier;
  see [auth-and-admin-plan.md](../services/auth-and-admin-plan.md) for the same constraint
  applied to the admin app.

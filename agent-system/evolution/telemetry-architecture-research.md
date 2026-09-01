# Telemetry architecture research — grounding Track B2 in how large systems actually do this

> **Document status:** Research. **Nothing here is approved.** It extends
> [platform-evolution-research.md §Track B](platform-evolution-research.md#track-b--operational-telemetry)
> and [rust-adoption-research.md](rust-adoption-research.md) — neither is
> superseded, this only adds external grounding and one concrete number that
> was previously a guess.
> **Raised:** 2026-08-13 by the owner — asked to research the design behind
> the Rust telemetry service (Track C) against how other large systems handle
> metrics, since Track C is currently blocked on Track B2's undecided landing
> place.
> **Last source review:** 2026-08-13

## Why this doc exists and what it does not change

`rust-adoption-research.md` already concluded, correctly, that `telemetry-service`
in Rust cannot start as a learning project until B2 (the gateway's in-memory
HTTP rollups) ships and its landing place — Grafana Cloud OTLP, or a
self-hosted schema — is chosen. That conclusion stands. This document exists
to make that choice with real numbers and real precedent instead of guessing,
because the existing B2 sketch in `platform-evolution-research.md` was
designed from first principles, not checked against how anyone else runs this
at scale.

The headline: **every large system that does this cheaply does the same two
things this repo's B2 sketch already does** — aggregate locally before the
network hop, and key on a route template rather than a raw path. That is not
a coincidence; it is the only design that survives contact with volume. What
was missing was a concrete cardinality number for *this* system, which turns
out to make the Option 1 vs Option 2 decision easier than the original
document implied.

## What large systems actually do — three real precedents

### Uber's M3 — two-tier aggregation, not one

M3 ingests roughly 500 million metrics/second and persists ~20 million/second
to storage. It does this with a **three-stage pipeline**, not a single flush:
a local collector on each host aggregates at 1-second intervals, then an
aggregation tier re-aggregates those at 10-second and 1-minute intervals
before anything touches durable storage.

The relevant lesson is not the scale — this project is nowhere near 500M/s —
it is the **shape**: aggregation happens in at least two places, each one
reducing volume by an order of magnitude, before a write hits a database.
B2's sketch (in-gateway aggregation, flushed once per minute) is the same
shape collapsed to two stages instead of three, which is correct at this
volume: there is one gateway instance, not a fleet needing a second
aggregation tier to merge across hosts.

### Datadog's DogStatsD — client-side aggregation by name+tag, not by event

DogStatsD's client library buffers metrics **by the combination of metric
name and tags** and sends the fewest possible messages, with a default
aggregation window (2s client-side, 10s agent-side). This is exactly the
`bucketKey{RoutePattern, Method, StatusClass}` map already sketched for B2 —
the "key" concept in DogStatsD's tag combination is the same idea as this
repo's route-pattern key, just named differently.

The one new detail worth carrying over: Datadog explicitly **disables**
client-side aggregation for histogram/distribution/timing types by default,
because aggregating twice (once at the client, once at the server) silently
changes the final percentile. B2's sketch already avoids this failure mode by
computing its own fixed-bucket histogram once, in the gateway, and never
re-aggregating it anywhere downstream — but it is worth stating explicitly as
a rule for whoever builds this: **a value that will be percentile'd must be
aggregated exactly once, in exactly one place.**

### OpenTelemetry Collector — cardinality limits are a first-class config, not an afterthought

The Collector's batch processor has a `metadata_cardinality_limit` (default
1000) specifically to bound memory when batching by dynamic metadata, and the
OTel guidance is blunt: attributes like user ID, request ID, session ID, or
raw path **must never** become a metric label — "a single metric with 10
high-cardinality attributes can generate millions of unique series."

This is precisely the rule `platform-evolution-research.md` already states —
*"never `request.URL.Path`"* — arrived at independently and confirmed
verbatim by the tool that exists specifically to enforce it in production
elsewhere. Nothing to change here; it is worth citing as external validation
rather than only an internal design opinion.

## The number that was missing: this system's actual cardinality

The original document compared Option 1 (Grafana Cloud) against Option 2
(own schema) without checking whether Option 1's free tier could even hold
this system's data. It can, with enormous headroom:

```
Grafana Cloud free tier (2026): 10,000 active metric series,
50 GB logs, 50 GB traces, 14-day retention, 3 users.
```

Counted directly from `services/api-gateway/internal/handlers/*.go` (every
`.Get(`/`.Post(`/`.Patch(`/`.Delete(` route registration, product **and**
admin groups together): **~50 distinct route templates.** B2's key is
`{RoutePattern, Method, StatusClass}`, and `StatusClass` has exactly 4 values
(2/3/4/5). Method is already fixed per route (each template is registered
under one verb), so the real series count is:

```
~50 routes × 4 status classes ≈ 200 active series
```

That is **2% of the free tier's 10,000-series budget**, with room to add
every backend service's own `/healthz` and grow the route count several times
over before the free tier becomes a real constraint. The "which option" table
in `platform-evolution-research.md` treated this as an open question; it is
not one — Option 1 (Grafana Cloud OTLP) costs nothing at this system's actual
size, and B2's own suggested sequence ("ship rollups to Grafana Cloud first,
learn the queries, build the own-schema service second") can proceed with
that number as the confirming fact rather than an assumption.

## A second option the existing research did not consider: wide events instead of bucketed metrics

Everything above assumes the destination is a **metric** — a number,
aggregated, with dimensions. Honeycomb's "Observability 2.0" position argues
for a different shape entirely: ship **wide structured events** (one row per
request, with every field the request touched — method, route, status,
duration, world id, job id, error code) to a store that can slice them
arbitrarily after the fact, and derive metrics *from* the events rather than
committing to fixed buckets up front. Their stated trade-off is honest and
directly relevant here:

> *"If you work on a simple system that fails predictably, define and monitor
> a metric... but if you're dealing with modern distributed systems, you'll
> need observability to dig into issues and find answers"* — i.e. metrics
> answer questions you already knew to ask; wide events answer the ones you
> didn't.

This system already has the input for that alternative and does not know it:
`middleware/logging.go` already emits one structured JSON line per request
with `method`, `path`, `status`, `duration`, `request_id`, `client_ip` —
functionally a wide event already, just going to stdout where a free-tier
host never keeps it (the exact "sink problem" `platform-evolution-research.md`
already names). The two options this repo could pursue are therefore:

| | B2 as already sketched (rollups) | Wide events (Honeycomb-style) |
| --- | --- | --- |
| What ships | One aggregated envelope/minute, fixed dimensions | One row per request, arbitrary fields |
| Answers | Questions decided at schema-design time | Questions asked later, not anticipated |
| Volume | ~200 series, trivially small | One row per request — needs its own retention/volume conversation |
| Fits this repo's existing pattern | Yes — same shape as every other rollup/projection here | No — nothing else in this repo ships a request-scoped event stream |
| Rust learning value (Track C) | High — sustained aggregation, predictable memory | Different — an ingestion/storage service, less computation |

**This document does not recommend switching.** The rollup design is the
right one for a system whose main open questions (wake conversion rate, p95
by woken-vs-warm, which routes are actually hit) are already known — the case
Honeycomb itself concedes metrics answer well. Wide events would be the right
call if the actual, recurring pain were "we don't know what question to ask,"
which is not what motivated this track (*"số API được fetch, status trả về ra
sao"* is a question already known in advance). It is recorded here so the
option is not silently unconsidered, and because if this system's shape
changes — more services, more failure modes nobody anticipated — this is the
document that says why the answer might change too.

## What this changes in the existing recommendation

Nothing in the *sequence* — `platform-evolution-research.md`'s step 6 ("HTTP
rollups + a hosted dashboard, learn what is worth measuring") and step 7
("`telemetry-service` in Rust, now the queries are known") stand unchanged.
What changes is that step 6's first half of that decision — can the free
tier hold it — is now a measured fact (≈200 series against a 10,000 budget)
rather than an assumption, which removes the one piece of the OTLP-vs-own-service
comparison that was previously unverified.

## Sources

- [M3: Uber's Open Source, Large-scale Metrics Platform for Prometheus](https://www.uber.com/us/en/blog/m3/)
- [DogStatsD Data Aggregation — Datadog docs](https://docs.datadoghq.com/extend/dogstatsd/data_aggregation/)
- [Sending large volumes of metrics — Datadog docs](https://docs.datadoghq.com/extend/dogstatsd/high_throughput/)
- [OpenTelemetry Collector — Batch Processor README](https://github.com/open-telemetry/opentelemetry-collector/blob/main/processor/batchprocessor/README.md)
- [Handle High-Cardinality Metrics in OpenTelemetry Without Blowing Your Budget](https://oneuptime.com/blog/post/2026-02-06-handle-high-cardinality-metrics-opentelemetry/view)
- [Understand Grafana Cloud usage limits](https://grafana.com/docs/grafana-cloud/cost-management-and-billing/manage-invoices/understand-your-invoice/usage-limits/)
- [Is Grafana Cloud Free? Free Plan Limits & Upgrade Triggers (2026)](https://costbench.com/software/observability/grafana-cloud/free-plan/)
- [Structured Events Are the Basis of Observability — Honeycomb](https://www.honeycomb.io/blog/structured-events-basis-observability)
- [Metrics vs Events: A Conversation About Controlling Volume — Honeycomb](https://www.honeycomb.io/blog/metrics-vs-events-a-conversation-about-controlling-volume)
- Route count measured directly from `services/api-gateway/internal/handlers/*.go`, 2026-08-13.

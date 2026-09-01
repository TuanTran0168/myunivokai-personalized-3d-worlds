# Sprint 02 user stories — resilience and scale proof

> **Document status:** Planned
> **Sprint starts:** 2026-08-05
> **Last source review:** 2026-07-22

- `S2-OBS-001`: trace one request/job across HTTP, NATS, outbox and databases
  without logging sensitive payloads.
- `S2-SCALE-001`: prove two Gateways share one Redis policy and each domain can
  scale independently without duplicate worlds.
- `S2-FAIL-001`: inject Redis, NATS, AI and database failure and prove every
  accepted job recovers or reaches an explicit terminal failure.
- `S2-SLO-001`: record numeric SLOs, lag/cache/DB/provider metrics, alerts and
  scale triggers from measured load.

Given/When/Then details and verification evidence are completed when Sprint 2
starts; Sprint 2 must not absorb unfinished Sprint 1 deployment verification.

**Two amendments before this sprint is written, 2026-08-14.**

`S2-SCALE-001`'s two-gateway half splits in two, and writing it as one item is
what made it look permanently blocked. **In production it is not schedulable:**
every block in `render.yaml` is `plan: free`, which has no horizontal scaling,
so that half is a plan-upgrade prerequisite rather than engineering work.
**Locally it is schedulable now** — Compose can publish a port range and run
`--scale api-gateway=2` against the Redis it already starts, which proves the
shared token bucket that D15 exists to guarantee. Scope the story to the local
proof and name the production half as blocked on cost; do not carry the whole
thing as pending work, which is what
[S1-DEPLOY-001](../sprint-01-2026-07-22/user-stories.md#s1-deploy-001--reproducible-production-fleet)
did for six weeks before that story was corrected. The multi-consumer half is
unaffected — durable consumers can be exercised locally too.

`S2-OBS-001` and `S2-SLO-001` were **partly delivered ahead of this sprint** by
[Sprint 5](../sprint-05-2026-08-13/user-stories.md): the gateway already
aggregates RED-shaped metrics, per-backend NATS round-trip buckets and Redis
cache hit/miss counters, and `telemetry-service` already stores and serves
them. Deploy that first, then write these two stories around what is genuinely
still missing — traces across a job's whole path, consumer lag, outbox age and
DB-pool metrics — rather than around the 2026-07-22 wording, which predates it.

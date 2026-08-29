# Sprint 02 — resilience and scale proof

> **Starts:** 2026-08-05
> **Status:** Planned; starts only after Sprint 1 verification
> **Last source review:** 2026-07-22

## Sprint goal

Prove how the migrated platform behaves under load and dependency failure, then
turn measurements into scale triggers, dashboards, alerts and operator actions.
Sprint 2 does not finish missing Sprint 1 migration work.

Backlog epic: [EPIC-S2-SCALE-001](../../backlog/engineering-backlog.md#epic-s2-scale-001--prove-resilience-and-horizontal-scale)

Sprint stories: [user-stories.md](user-stories.md)

## Scope

- Define representative generation/read/share workloads and target SLOs.
- Instrument gateway, Redis, NATS consumers, outbox/inbox, AI and DB pools.
- Propagate safe correlation across HTTP, NATS and database logs.
- Run two or more gateway instances against one Redis policy.
- Scale DNA, Universe and Nature consumers independently and verify one logical
  effect under duplicate/redelivery.
- Measure consumer lag, ack latency, redelivery, provider time and cache hit
  ratio; document capacity before partitioning streams/databases.
- Inject Redis, NATS, provider and per-service database failures.
- Define alerts and runbook responses for backlog, dead letter, stale outbox,
  Redis degradation and database saturation.

## Definition of Done

- [ ] SLOs and scale triggers are numeric and tied to measured evidence.
- [ ] One request/job can be followed end-to-end without sensitive payloads.
- [ ] Two gateways preserve rate-limit/cache semantics.
- [ ] Additional consumer instances increase the intended family throughput
      without duplicate worlds or cross-family impact.
- [ ] Accepted jobs recover or fail explicitly under every tested outage.
- [ ] Dashboards/alerts/runbooks identify each failure class.
- [ ] Deployment sizing/cost assumptions are updated from measurements.

## Out of scope

- City product implementation;
- multi-region active-active;
- auth/accounts;
- partitioning merely for architectural appearance;
- replacing NATS with Redis Streams or another queue.

# Delivery sprints

> **Document status:** Active schedule
> **Last source review:** 2026-07-22

The folders include ISO start/end dates so a sprint name remains unambiguous in
Git history, links and deployment evidence.

| Sprint | Starts | Committed outcome |
| --- | --- | --- |
| [Sprint 01](sprint-01-2026-07-22/README.md) | 2026-07-22 | Complete NATS/Redis/DNA architecture migration, local runtime, production deploy and cutover |
| [Sprint 02](sprint-02-2026-08-05/README.md) | 2026-08-05 | Resilience, observability, capacity and horizontal-scale proof |
| [Sprint 04](sprint-04-2026-08-06/README.md) | 2026-08-06 | auth-service, the analytics read model and the internal admin app, in that priority order; the confirmed wake-mechanism defect is deliberately deferred |
| [Sprint 05](sprint-05-2026-08-13/README.md) | 2026-08-13 | Operational telemetry end to end: the gateway's rollups, `telemetry-service` in Rust behind a dual-sink switch, and the admin Telemetry screen |
| [Sprint 06](sprint-06-2026-08-19/README.md) | 2026-08-19 | Ocean as the third family: its own service, the depth curve as specified maths, and a procedural renderer |
| [Sprint 07](sprint-07-2026-08-28/README.md) | 2026-08-28 | Create-form transitions, layout/responsive fixes, gallery ambient sync, depth-driven Ocean audio, and adaptive mobile/weak-device quality tiers pulled forward ahead of City |
| [Sprint 08](sprint-08-2026-09-02/README.md) | 2026-09-02 | End-user identity and world ownership: the `web` audience, ownership in three families, the anonymous claim, the first AI quota, and a gallery that survives a cleared browser |
| [Sprint 03](sprint-03-2026-09-09/README.md) | 2026-09-09 | City bounded-context and high-fidelity vertical slice on the new platform |

Sprint numbers are allocation order, not calendar order, so the table is sorted
by start date instead. Sprint 04 was scoped after Sprint 03 but runs alongside
Sprint 02's resilience work; Sprint 05 sits between them. All three touch
services and databases disjoint from City's, so none of them delays it.
Sprint 07 is the same case again: it is FE-only, has no predecessor vision
document, and touches none of Sprint 02/03's services or databases.

Sprint 06 is the exception: it did not slot around Sprint 03, it MOVED it. On
2026-08-15 the owner brought the Ocean family forward and pushed City from
2026-08-19 to 2026-09-09. The two are disjoint in the same way, so the cost is
calendar time and nothing else — but the move is recorded here rather than left
to be inferred from two folder names.

Sprint 08 sits one week ahead of City and does **not** move it. The two are
disjoint in services and databases, so nothing is blocked either way — but
there is one interaction recorded in
[Sprint 08's README](sprint-08-2026-09-02/README.md#sequencing-against-sprint-03-city)
rather than left to be found: City is a fourth family, and a fourth family
built after ownership exists is born owned, whereas one built before it needs
the same columns, consumer and predicate retrofitted into a service whose tests
were written without them. That is a recommendation to keep City behind Sprint
08, not a decision — the calendar is the owner's.

Sprint status is evidence-based:

- **Planned:** scope and acceptance are approved, implementation absent.
- **In progress:** at least one sprint branch is active.
- **Implemented:** source and automated checks exist.
- **Verified:** named local/deployed/manual evidence also passes.

No sprint is marked complete because calendar time ended. Unfinished acceptance
remains visible and must be re-planned explicitly.

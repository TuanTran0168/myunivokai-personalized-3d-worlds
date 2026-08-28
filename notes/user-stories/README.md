# User stories and engineering tasks

> **Document status:** Active index
> **Last source review:** 2026-07-22

This folder is the cross-sprint index and product backlog. Delivery status and
acceptance evidence live beside each dated sprint in `notes/sprints/*/user-stories.md`.

## Documents

| Document | Purpose |
| --- | --- |
| [implemented-capabilities.md](implemented-capabilities.md) | What the current product already supports, expressed as verifiable stories |
| [engineering-backlog.md](engineering-backlog.md) | Approved event-driven migration, scale, City and Ocean epics with Given/When/Then acceptance |
| [scene-fidelity.md](scene-fidelity.md) | Unplanned owner-requested forest realism work, recorded so it is not invisible |
| [world-chrome.md](world-chrome.md) | Unplanned owner-requested world-chrome work — the immersive toggle, the clear glass, the family accent — recorded on the same basis |
| [Sprint 1 stories](../sprints/sprint-01-2026-07-22/user-stories.md) | Migration implementation and pending environment evidence |
| [Sprint 2 stories](../sprints/sprint-02-2026-08-05/user-stories.md) | Resilience and scale commitments |
| [Sprint 3 stories](../sprints/sprint-03-2026-09-09/user-stories.md) | City vertical-slice commitments (moved to 2026-09-09) |
| [Sprint 4 stories](../sprints/sprint-04-2026-08-06/user-stories.md) | auth-service, analytics read model and admin app commitments |
| [Sprint 5 stories](../sprints/sprint-05-2026-08-13/user-stories.md) | telemetry-service commitments — the gateway rollups, the first Rust service, the admin Telemetry screen |
| [Sprint 6](../sprints/sprint-06-2026-08-19/README.md) | Ocean as the third family — the epic carries the acceptance, so this sprint has no separate stories file |
| [Sprint 7 stories](../sprints/sprint-07-2026-08-28/user-stories.md) | Create-form transitions, layout/responsive fixes, gallery ambient sync, depth-driven Ocean audio, and adaptive mobile/weak-device quality tiers pulled forward ahead of City |

The dated delivery commitments live in [../sprints/](../sprints/README.md).
Sprint 1 is the complete platform migration, including local and production
deployment; it is not a foundation-only sprint.

Approved architecture/feature plans referenced by this backlog:

- [Vision V1 solution architecture](../vision/versions/v1-2026-07-22/solution-architecture.md) — NATS, Redis,
  DNA/family boundaries, data ownership and scale model.
- [City Service implementation plan](../vision/city-service-plan.md) — third
  family, now implemented on the new platform only after Sprints 1–2.
- [Auth-service and internal admin app plan](../vision/auth-and-admin-plan.md)
  and [Analytics-service plan](../vision/analytics-service-plan.md) — Sprint 4,
  in that priority order.
- [Telemetry-service plan](../vision/telemetry-service-plan.md) — Sprint 5,
  the gateway's HTTP/NATS/cache rollups and the first service written in Rust.

## Story format

```md
## US-AREA-NNN — Short outcome

Status: Planned | Ready | Blocked | Implemented | Verified
Priority: P0 | P1 | P2 | Post-City | Discovery

As a <persona>,
I want <capability>,
so that <value>.

Scenario: <name>

Given <precondition>
When <action>
Then <observable result>
And <additional result>

Source evidence:
- path/to/source

Tasks:
- [ ] One branch-sized implementation step
```

## Rules

- `Implemented` means source and automated checks exist.
- `Verified` additionally requires the real environment or browser/device
  evidence named by the story.
- A story cannot claim an API, provider, deployment, or performance result that
  is absent from source/evidence.
- Every task follows `notes/coding/git-convention.md`; one concern per PR from
  `staging`.
- Given/When/Then describes externally observable behavior. Internal file edits
  belong under Tasks, not under Then.

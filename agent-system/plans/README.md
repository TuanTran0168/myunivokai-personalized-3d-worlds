# Plans — what is intended

> **Document status:** Active
> **Last source review:** 2026-08-29

Prescriptive documents. **If the code and the document disagree, the code is
what changes** — that is the whole difference between this folder and
[../knowledge/](../knowledge/README.md).

A plan stays here after it ships, for as long as it is still the contract for
the thing it describes. It moves to [../memory/](../memory/README.md) only when
nothing would be decided by it any more.

> **Before trusting any plan below, look for a corrections section.** Several
> were written before the work and amended after it, and the amendment
> contradicts the original. `services/ocean-service-plan.md` §16 is the sharpest
> case: read it before §2 and §7, not after.

## architecture/

The approved shape of the platform. [architecture/README.md](architecture/README.md)
is the entry point; [architecture/v1-2026-07-22/](architecture/v1-2026-07-22/README.md)
is the current approved baseline for scale, ownership, messaging, data and
deployment — read it before any backend, messaging, data or deployment work.

[service-wake-mechanism.md](architecture/service-wake-mechanism.md) and
[frontend-gateway-consolidation.md](architecture/frontend-gateway-consolidation.md)
are cross-cutting mechanisms with the same standing.
[end-user-identity-and-ownership.md](architecture/end-user-identity-and-ownership.md)
is the third — **built: all 21 stories of
[Sprint 08](sprints/sprint-08-2026-09-02/README.md) are `Implemented` and
Phases A-C are in production. Corrected 2026-09-05; this line said "proposed,
no code yet"** — and it is the one
to read before touching `accounts`, the token audience, any world's owner, or
the web app's session. Read its **§16 first**: twenty decisions taken across
four rounds on 2026-09-02 supersede parts of six of its own sections, and most
of them cut scope rather than adding it. The first is the one to
read before touching gateway error handling, `/healthz`, the wake platform
adapters or `/api/admin/wake-stats`.

[admin-surface-and-family-service-duplication.md](architecture/admin-surface-and-family-service-duplication.md)
is the fourth, and the newest. It answers "what is left on the admin side, or
should the backend be refactored" by showing the two are one decision, and it is
now **half executed: read its §14 first.** The share-URL defect it found is
fixed — every published world in every family was handing out a 404, and
`myunivokai-ocean` had no `PUBLIC_WEB_URL` in production at all — and the Tier 0
duplication is extracted into
[`family-platform/go`](../../family-platform/go/README.md), the second shared Go
module after `contracts/go`. §14 records the two claims executing it disproved.
The admin items are all still open. Read it before proposing any admin feature —
it records which one is forbidden and why — and before any change that would be
written once per family service.

## services/

One document per family or service, each the contract for changes to it.

| Plan | State |
| --- | --- |
| [nature-service-plan.md](services/nature-service-plan.md) | Historical decision log; its early "future gateway/FE" statements are superseded |
| [ocean-service-plan.md](services/ocean-service-plan.md) | Built 2026-08-15. §16 records where the plan was wrong — including two zone boundaries that made two of the three seas identical |
| [city-service-plan.md](services/city-service-plan.md) | Approved, not implemented. High-fidelity-first phases |
| [auth-and-admin-plan.md](services/auth-and-admin-plan.md) | Implemented. Its read path is superseded by the analytics plan; the three replaced sections are marked in place |
| [analytics-service-plan.md](services/analytics-service-plan.md) | Implemented. §Corrections found in implementation records four things the design got wrong |
| [telemetry-service-plan.md](services/telemetry-service-plan.md) | Approved design, **not yet built** |

## frontend/

[frontend-plan.md](frontend/frontend-plan.md) — re-baselined; the family registry
and lazy chunks shipped, stronger runtime contracts remain.
[visual-diversity.md](frontend/visual-diversity.md) — re-baselined after the
Universe diversity rounds and the Forest renderer landed.
[forest-realism-roadmap.md](frontend/forest-realism-roadmap.md) — the current
realism level and what to improve next; read it before any "make the forest look
better" task, and note that its perf budget is **unmeasured**.
[ocean-realism-roadmap.md](frontend/ocean-realism-roadmap.md) — the same for the
ocean, and the root cause of the "wall of light" bug: the orbit camera could
rise above the water plane while the rig still believed it was submerged. The
camera half is fixed and the plan records what shipped and why it differs from
what the plan first asked for. Read it before touching the ocean camera, the
depth bands, or the fauna.

## backlog/

[backlog/README.md](backlog/README.md) explains the Given/When/Then acceptance
format and the requirement to cite source evidence.
`engineering-backlog.md` is the cross-sprint planning baseline;
`scene-fidelity.md` and `world-chrome.md` hold unplanned owner-requested work.

## sprints/

Dated commitments and the Definition of Done, one folder per sprint. **Execution
status lives here, not in the backlog** — the backlog is the baseline, the sprint
folder is what actually happened to it.

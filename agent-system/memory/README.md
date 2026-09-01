# Memory — what happened

> **Document status:** Historical record
> **Last source review:** 2026-08-29

Records of work that is finished. **Nothing here is a current plan**, and
treating one as such is the specific mistake this folder exists to prevent.

Memory earns its place by being the only honest source for one question: *where
was the plan wrong?* A plan says what someone expected; these say what was
actually found. Where the two disagree, these win.

## execution-records/

| Document | What it records |
| --- | --- |
| [frontend-deferred-work.md](execution-records/frontend-deferred-work.md) | Dynamic family chunks and forest fidelity metrics, both shipped — including what each plan predicted wrongly. Part B's measurement found a real mesh fold on the landmark ponds. |
| [frontend-refactor-plan.md](execution-records/frontend-refactor-plan.md) | The historical FE refactor sequence. Its checkboxes are stale — several unchecked items already exist in source, so never read its status table as a backlog. |
| [backend-refactor-plan.md](execution-records/backend-refactor-plan.md) | The historical Universe-only refactor sequence. |
| [api-gateway-historical.md](execution-records/api-gateway-historical.md) | The old HTTP peer gateway, superseded by Vision V1 on 2026-07-22. |

## archive/

Finished round plans, reference only: the original implementation plan, the
perf/render round, sky-from-DB, visual diversity, and the 3D next-steps
proposal.

## What to write here

`/record-to-memory` writes one of these, and enforces the test below before it
does. Use it rather than adding a file by hand — the folder is only worth
reading while everything in it earns its place.

Every genuinely useful entry has the same shape — a prediction, and then a
measurement that disagreed with it. When a round's measurements contradict its
plan, **the contradiction is the part worth writing down**; the part that went
as expected already belongs in [../knowledge/](../knowledge/README.md).

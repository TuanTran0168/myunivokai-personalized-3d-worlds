# Vision V1 — event-driven foundation

> **Document status:** Current implemented source baseline; deployment proof pending
> **Vision version:** v1-2026-07-22
> **Approved:** 2026-07-22
> **Last source review:** 2026-07-22

V1 defines the migration from synchronous HTTP peers to the NATS/Redis/DNA
platform while keeping Universe and Nature as independent bounded contexts.

## Documents frozen in this baseline

| Document | Purpose |
| --- | --- |
| [solution-architecture.md](solution-architecture.md) | Service ownership, messaging, Redis, data, security and scale model |
| [backend-plan.md](backend-plan.md) | Sprint 1 backend migration boundaries and exit conditions |
| [deployment.md](deployment.md) | Target production topology and rollout rationale |
| [contracts-and-roadmap.md](contracts-and-roadmap.md) | Contracts, dated delivery phases, risks and fitness checks |

## Lifecycle

- This folder is the current architecture baseline until a V2 is approved.
- Implementation progress belongs in `notes/sprints` and user stories, not in a
  copy of this folder.
- After V2 is approved, V1 becomes `Superseded` and remains immutable.
- Only typo, broken-link or explicit errata corrections may modify a superseded
  version; architectural decisions require a new version.
- Fine-grained edit history remains available in Git.

The active-version pointer and cross-version status live in
[../../README.md](../README.md).

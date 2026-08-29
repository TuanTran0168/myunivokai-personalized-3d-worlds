# Evolution — why the direction changed

> **Document status:** Reference
> **Last source review:** 2026-08-29

Research and business analysis. **Nothing here is approved and nothing here is
built.** These are the documents that moved the target before a plan existed to
describe the new one — the layer between "we noticed something" and "we decided
something".

Each one graduates: when its conclusion is accepted it produces a document in
[../plans/](../plans/README.md), and the copy here stays as the argument for it.

| Document | What it produced |
| --- | --- |
| [ocean-family-research.md](ocean-family-research.md) | Graduated 2026-08-14 into `plans/services/ocean-service-plan.md`. Why depth is Ocean's axis, the reuse inventory read file by file, verified CC0 assets and public-domain audio — and the licence wall that re-scoped City. |
| [ocean-visual-direction-research.md](ocean-visual-direction-research.md) | The look the ocean family was aiming at. |
| [ocean-demo-port-ba.md](ocean-demo-port-ba.md) | Business analysis written after reading both sides, before the depth rig was ported into the app. |
| [ocean-fauna-ecosystem-ba.md](ocean-fauna-ecosystem-ba.md) | The fauna expansion argument. |
| [platform-evolution-research.md](platform-evolution-research.md) | How the platform's shape should change as it grows. |
| [rust-adoption-research.md](rust-adoption-research.md) | Whether to introduce Rust at all — the reasoning behind `services/telemetry-service`. |
| [telemetry-architecture-research.md](telemetry-architecture-research.md) | How large systems actually do telemetry; extends into `plans/services/telemetry-service-plan.md`. |
| [frontend-modernization-research.md](frontend-modernization-research.md) | The Next/React upgrade path, down to the exact change three files needed. |

## Reading order

Research first, plan second — never the reverse. A plan states a decision; the
research states the alternatives that were rejected and why, which is the only
thing that tells you whether a new constraint invalidates that decision.

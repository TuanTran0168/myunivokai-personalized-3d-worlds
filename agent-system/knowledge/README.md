# Knowledge — how the system actually is

> **Document status:** Active
> **Last source review:** 2026-08-29

Descriptive documents, and the test for belonging here is one line: **if the code
and the document disagree, the document is wrong.** Anything where the reverse
holds is a plan, and lives in [../plans/](../plans/README.md).

Every document here is source-grounded — written by reading the repository, and
carrying the date on which that reading happened.

## frontend/

| Document | Read before |
| --- | --- |
| [source-overview.md](frontend/source-overview.md) | Any task in `apps/myunivokai-personalization`: the async job flow, routes, the family picker |
| [threejs-scene-architecture.md](frontend/threejs-scene-architecture.md) | Touching any 3D code — the sceneType-first renderer registry and how to add a family |
| [universe-render-mechanism.md](frontend/universe-render-mechanism.md) | Adding a universe asset: the four model layers, the texture and GLB pipelines, determinism |
| [forest-render-mechanism.md](frontend/forest-render-mechanism.md) | Adding a forest asset — including the Sketchfab licence constraint that has cost this project a round already |
| [ambient-audio-mechanism.md](frontend/ambient-audio-mechanism.md) | Any audio code or asset: the public-domain scores, what the DNA arranges, and why three earlier versions shipped verified-and-wrong |
| [3d-development-limitations.md](frontend/3d-development-limitations.md) | Visual-quality work, as background on what actually limits it |

## backend/

| Document | Read before |
| --- | --- |
| [source-overview.md](backend/source-overview.md) | Any backend task: how Gateway, DNA, Universe, Nature, Ocean, Auth and Analytics communicate over NATS/Redis, and who owns which data |
| [request-lifecycle.md](backend/request-lifecycle.md) | Changing any route, cache key or event — the five paths a request takes, and the share-page bug that proved why Redis invalidation matters |
| [design-decisions.md](backend/design-decisions.md) | Adding an external integration: the one-interface-per-vendor rule that `ai.Provider`, `wake.Platform` and `TelemetrySink` all follow |
| [rust-service-architecture.md](backend/rust-service-architecture.md) | Touching `services/telemetry-service`, the one service not written in Go |

## product/

| Document | Read before |
| --- | --- |
| [implemented-capabilities.md](product/implemented-capabilities.md) | Claiming the product does, or does not, do something. It is the source-backed inventory of what actually ships. |

## references/ and design/

External research inputs, not contracts.
[references/](references/README.md) holds the brand landscape and three.js asset
sources with their licences — check both before choosing a name or downloading a
model. [design/](design/) holds the Stitch UI mockups, whose layout ideas remain
useful even though their purple/cyan visual language is not the active design
system.

# Frontend agent

> **Document status:** Active
> **Last source review:** 2026-08-29

**Scope:** `apps/myunivokai-personalization`, `apps/myunivokai-admin`, and everything they
render — three.js scenes, the audio graph, the create form, world and share
routes.

## Reading order

1. [../rules/coding-style.md](../rules/coding-style.md) and
   [../rules/git-convention.md](../rules/git-convention.md) — always, before
   anything else.
2. [../knowledge/frontend/source-overview.md](../knowledge/frontend/source-overview.md)
   — how the app is wired: the async job flow, the routes, the family picker.
3. Then exactly one of, depending on what you are touching:
   - any 3D at all →
     [../knowledge/frontend/threejs-scene-architecture.md](../knowledge/frontend/threejs-scene-architecture.md)
   - a universe asset →
     [../knowledge/frontend/universe-render-mechanism.md](../knowledge/frontend/universe-render-mechanism.md)
   - a forest asset →
     [../knowledge/frontend/forest-render-mechanism.md](../knowledge/frontend/forest-render-mechanism.md)
   - audio →
     [../knowledge/frontend/ambient-audio-mechanism.md](../knowledge/frontend/ambient-audio-mechanism.md)
   - "make the forest look better" →
     [../plans/frontend/forest-realism-roadmap.md](../plans/frontend/forest-realism-roadmap.md)

## Do not read

`../plans/services/*` — the family service plans are backend contracts. The
scene config you consume is in `contracts/scenes/*.schema.json`, and that is the
only part of them that reaches the client.

`../memory/execution-records/frontend-refactor-plan.md` as a backlog. Its status
table is stale; several unchecked items already exist in source. Use
[../plans/backlog/](../plans/backlog/README.md).

## Rules specific to this work

**Performance is a floor, not a target.** 60 fps is the minimum, quality-first,
and the bar is never lowered for weaker hardware. Measure on a real GPU
(`--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`) — never on swiftshader,
which is 10× slower and will tell you a scene is broken when it is fine.

**The e2e suite is deliberately software-rendered, and that is a different job.**
`playwright.config.ts` pins swiftshader so two runs on the same machine differ
only by the code between them. Those shots are a before/after instrument for a
human, not a verdict — never add a pixel assertion to them. Box geometry and
scroll containment are safe to assert, because they are identical on every
machine; anything the GPU drew is not.

**A cold scene mount blocks the main thread for seconds.** Up to ~2.7 s
compiling shaders, measured, and nothing in this codebase makes it faster —
`compileAsync` was tried and does nothing on this project's driver. Schedule
main-thread animation around it, never through it. `src/features/transitions/`
is the worked example: the two canvas animations sit in windows where the thread
is known to be idle, and the window where it is not gets a CSS animation that
does not need it.

**Assets carry licences.** The Sketchfab constraint in the forest document is
not a style note — a model without `isDownloadable` and a CC licence cannot ship,
and that has already cost this project a round of work.

## Done means

`npm run typecheck`, `npm run lint` and `npm test` all clean; if the change is
visible, `npm run shoot` re-taken and the diff looked at by eye; if the change is
a performance claim, a measurement on the real GPU quoted in the commit message.

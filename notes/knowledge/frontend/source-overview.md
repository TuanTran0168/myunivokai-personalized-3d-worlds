# FE Source Overview — apps/myunivokai-web

> **Document status:** Active
> **Last source review:** 2026-08-14

Next.js 15 App Router + React 19 + TypeScript + Tailwind + React Three Fiber v9.
Every page is a client component because of WebGL and localStorage.

Route params are Promises (Next 15): the two share pages await them, and
`worlds/[worldId]` — being `"use client"` — reads them with React's `use`.

## World families — one source, two scene worlds

The client renders two scene families from the **same source**:
`WorldFamily = "universe" | "nature"`. The create form (`/`) has a Universe /
Forest picker. The client receives one `NEXT_PUBLIC_GATEWAY_BASE_URL`; a shared
gateway helper appends `/api/universe` or `/api/nature` from the family. Peer
service hosts never enter the frontend. The family is plumbed through `api.ts`,
gallery localStorage ids, the `?family=` query param, and a twin nature share
route. See
[forest-render-mechanism.md](forest-render-mechanism.md) for the forest renderer
itself.

## Routes

| Route | File | Role |
| --- | --- | --- |
| `/` | `src/app/page.tsx` | Landing + family picker. Submit -> `202 + jobId` -> queued/processing polling -> completed world redirect; pending polling resumes after refresh |
| `/worlds/[worldId]` | `src/app/worlds/[worldId]/page.tsx` | Dashboard: 3D canvas, POI panel, variants, publish/share, PNG export. Reads `?family=` to pick the API + renderer |
| `/gallery` | `src/app/gallery/page.tsx` | Worlds saved on this device (localStorage), family-aware, loaded in parallel |
| `/share/worlds/[shareSlug]` | `src/app/share/worlds/[shareSlug]/page.tsx` | Public **universe** share page |
| `/nature/share/worlds/[shareSlug]` | `src/app/nature/share/worlds/[shareSlug]/page.tsx` | Public **nature** share page (twin route; nature-service prints share URLs with the `/nature` prefix) |

## The lib layer — every piece of data passes through here

- `lib/api.ts` — the single API client, now **family-aware and asynchronous**:
  `request(family, path, init)` picks the gateway route by `WorldFamily`
  (`API_BASE_URLS_BY_FAMILY`), and every method takes a family. The `normalize*`
  functions matter most: the BE returns `{ world, selectedVariant, variants }`
  (variant list at the response ROOT) and normalize maps everything onto the
  unified `World` / `WorldVariant` types. **The FE's worst historical bug lived
  here** (reading the wrong location sent the canvas into fallback mode). If a BE
  response shape changes, fix normalize first. Creation stores the pending job
  in session storage, polls `/api/jobs/{jobId}` with bounded backoff/deadline,
  supports `AbortSignal`, and loads the world only after completion.
- `lib/gateway.ts` — validates the one configured gateway origin and owns the
  family-to-public-prefix map. Browser requests and both server-rendered share
  metadata routes use this same helper. It deliberately has no direct-service
  fallback.
- `lib/types.ts` — mirrors the BE JSON contract. `WorldSceneConfig` (universe,
  `services/universe-service/internal/models/scene.go`) **and** the forest scene
  sections + `sceneType`. Change them together with the matching BE model.
- `lib/scene.ts` — safe scene-config readers (`planetsFromScene`,
  `paletteFromScene`, `backgroundColorFromScene`) + `randomFromSeed`
  (deterministic PRNG; `Math.random()` is forbidden in scene code). Also
  `FOREST_SCENE_TYPE` / `isForestScene` and `pointsOfInterestFromScene` (adapts
  forest landmarks into the shared POI/`PlanetSceneConfig` shape so HUD, hover
  and CameraRig stay family-agnostic).
- `lib/forestScene.ts` — **deterministic preview mirror** of the Go forest
  builder (`forest_scene_profile.go` + `forest_config_builder.go`): same tables,
  same per-section PRNG streams, same draw order (xorshift mirror → plausible,
  not byte-equal). Keep it in sync on every tuning change. Covered by
  `forestScene.test.ts` (determinism + contract-bounds).
- `lib/worldRoutes.ts` — family-aware path/query helpers (`worldPagePath`,
  `sharePagePath`, `worldFamilyFromQueryValue`, `WORLD_FAMILY_QUERY_PARAMETER`).
- `lib/savedWorlds.ts` — localStorage key `myunivokai.savedWorldIds`, now
  `SavedWorldReference { worldIdentifier, family }` (legacy plain-string entries
  read as universe). IDs saved automatically on create and when opening a world.
- `lib/exportImage.ts` — downloads the WebGL canvas as PNG
  (requires `preserveDrawingBuffer`, already set on the Canvas).
- `lib/formRailCollapse.ts` + `components/WorldChromeToggle.tsx` — the one-button
  "clear the interface off the world" control, shared by the create, world and
  share pages. The collapsing region is never unmounted (on the create page the
  submit button sits outside the `<form>` and would lose its owner); it slides or
  fades and flips `visibility`, so fields keep their values and the GL context
  survives. Two `<body>` markers carry state the pages cannot reach with a
  selector — `data-world-immersive` hides the shared header/footer,
  `data-world-family` swaps the accent metal (brass → copper for forest). Those
  attribute names and the collapse duration are contracts between TypeScript and
  CSS with no compiler between them, so `formRailCollapse.test.ts` parses
  `globals.css` and fails if either drifts. See
  [../user-stories/world-chrome.md](../../plans/backlog/world-chrome.md).

## The 3D part

- [threejs-scene-architecture.md](threejs-scene-architecture.md) — three.js
  principles, the **sceneType-first** renderer registry, and how to add a scene
  type.
- [universe-render-mechanism.md](universe-render-mechanism.md) — how the universe
  is drawn (4 model layers, texture/GLB pipelines, determinism).
- [forest-render-mechanism.md](forest-render-mechanism.md) — the forest/nature
  renderer: instanced + animated GLBs, seasonal foliage recolor, bird animation
  gotchas, the horizon technique, and the **Sketchfab asset constraint**.

## State

No Redux/Zustand. Each page owns its state with `useState`/`useMemo`; planet
selection syncs between canvas and panel via props (`selectedPlanetKey` +
`onSelectPlanet`). Reach for a store only if state starts spanning pages.

## Known upgrade boundaries

- `SceneConfig` is a broad optional interface and API normalization still uses
  `any`; it is not yet a schema-derived discriminated union with runtime
  validation.
- Both family renderers are statically imported by `registry.ts`; lazy family
  chunks remain pending.
- The main canvas allows DPR up to 3 and has no adaptive quality profile or
  recoverable WebGL error boundary.
- Nature GLBs are self-hosted, but Drei still uses its default external Draco
  decoder because no local decoder path is configured.
- Catalog tests do not yet validate every asset path, attribution entry, and
  byte budget.
- `npm audit` still reports three high advisories, and none is against `next`
  itself any more. They are `postcss@8.4.31` and `sharp@0.34.5`, both pinned
  inside next's own dependency tree and unreachable from this app: postcss runs
  at build time, and `next/image` is used exactly once, with `unoptimized`, so
  the Image Optimizer that would load sharp never runs. Replacing next's pinned
  postcss needs Next 16.

See `notes/plans/backlog/engineering-backlog.md` for Given/When/Then acceptance.

## Required checks before committing

```bash
cd apps/myunivokai-web
npm run typecheck
npm run lint
npm run test
npm run build
```

`npm run test` is a hard CI step between lint and build; this list omitted it
until 2026-08-01, so a contributor following the old block could push a red
build.

`npm run shoot` is **not** in that list and must not be added to it. It
photographs both scene families and writes to `e2e/shots/`, to be compared by
eye against `e2e/reference/<stack>/` — the only instrument in this repo that
can see the canvas. Run it either side of a dependency change, never as a gate:
WebGL output moves with GPU and driver, so a pixel assertion in CI would report
"different machine" far more often than "broken scene". See
`apps/myunivokai-web/e2e/reference/README.md`.

For integrated local development, root `docker-compose-local.yaml` builds this
client with `NEXT_PUBLIC_GATEWAY_BASE_URL=http://localhost:41800`. The production
Docker image uses exactly two stages, Next.js standalone output, and a non-root
runtime user; the same image is declared in the Render Blueprint.

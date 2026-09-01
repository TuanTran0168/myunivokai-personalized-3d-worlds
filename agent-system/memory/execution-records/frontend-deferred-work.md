# FE deferred work — execution plan

> **Document status:** Both parts implemented; kept as the execution record
> **Last source review:** 2026-08-02

Two FE items were recorded across three documents with no execution plan
anywhere. This file was that plan. Both parts have now shipped, and it is kept for
what the plans got wrong — each correction cost real time to find.

| Item | Origin document | State |
| --- | --- | --- |
| [Part A — dynamic family chunks](#part-a--deferred-fe-lazy-001-dynamic-family-chunks) | [threejs-scene-architecture.md](../../knowledge/frontend/threejs-scene-architecture.md) §Family chunks | **Shipped** on `feat/fe/lazy-renderer-chunks` |
| [Part B — forest fidelity metrics](#part-b--us-forest-002-codify-the-fidelity-metrics) | [../user-stories/scene-fidelity.md](../../plans/backlog/scene-fidelity.md) US-FOREST-002 | **Shipped** on `feat/fe/forest-fidelity-metrics` |

---

## Part A — DEFERRED-FE-LAZY-001 dynamic family chunks

Goal: a visitor who opens a forest world does not download the universe
renderer, and vice versa.

### Outcome — shipped

Implemented on `feat/fe/lazy-renderer-chunks`. First Load JS 512-526 kB →
436-450 kB across the five 3D routes; per-route table and the runtime mechanism
now live in [threejs-scene-architecture.md](../../knowledge/frontend/threejs-scene-architecture.md)
§Family chunks, which is the doc to read. Three corrections to what this plan
predicted, kept because the reasoning is worth not repeating:

- **The `planetIdentityKey` blocker was overstated.** The helper was already a
  standalone module; `UniverseCanvas` only *re-exported* it, so the fix was
  deleting one line, not moving code. And it moved the bundle numbers by zero:
  every file importing the helper also imported the canvas, except
  `PlanetDetailsPanel`, which only renders on pages that mount the canvas anyway.
  It is still worth deleting — it would block a later canvas-level split — but it
  was hygiene, not a prerequisite.
- **`ComponentType` needed no widening.** `React.lazy`'s return type satisfies the
  registry's existing `SceneRendererComponent` as written; step 4's contingency
  never fired.
- **`next/dynamic` was the wrong tool, and only reading its source showed why.**
  Step 5 assumed any lazy wrapper would suspend into the existing boundary. In
  14.2.x `next/dynamic` does not suspend at all — `loadable.shared-runtime`
  renders a `loading` component, `null` by default. Because `SceneReadySignal`
  shares that boundary, it would have mounted immediately and lifted the opacity
  veil over an empty canvas. `React.lazy` throws the promise and preserves the
  original behaviour. Nothing in the build output or the test suite would have
  caught this — it is a visual regression that only shows on a cold cache.

What was verified, and what was not: `next build` output, the per-route
`app-build-manifest.json`, disjoint family markers in the two chunk files, and a
`next start` probe of the served HTML for all four route shapes. Not verified in a
browser: that opening a forest world requests *only* the forest chunk at runtime.
Which chunk gets requested follows from the prefetch call and the resolved
`sceneType`, so that part rests on the code, not on an observation.

One scope decision worth knowing: `/` prefetches **every** family after mount,
not just the selected one. It is the page whose whole job is choosing between
families, and a spinner on each flick of the picker is a worse trade than bytes
that arrive after first paint. The world and share routes still fetch exactly one
renderer, which is where the promise above actually has to hold.

### Source state before the change (kept as the baseline record)

- `scene-renderers/registry.ts:3-4` statically imports both family renderers.
- So every page that mounts a canvas ships both family code graphs.
- `SceneRendererComponent` is `ComponentType<SceneRendererProps>`
  (`scene-renderers/types.ts:20`) — a plain component type.
- `UniverseCanvas.tsx:109-111` resolves the component, then renders it inside
  `<Canvas>`.
- Four entry points import `UniverseCanvas` statically: `app/page.tsx:8`,
  `app/worlds/[worldId]/page.tsx:17`, `features/share/ShareWorldView.tsx:9`,
  `features/gallery/AmbientWorld.tsx:4`.
- There is **no** `next/dynamic` or `React.lazy` anywhere in the FE yet.
- 3D dependency weight sits in `three@0.171`, `@react-three/fiber`,
  `@react-three/drei`, `@react-three/postprocessing`.

### Coupling found — real, but not the blocker this plan claimed

- `components/PlanetDetailsPanel.tsx:5` imported `planetIdentityKey` **from**
  `UniverseCanvas`; `app/worlds/[worldId]/page.tsx` and `ShareWorldView.tsx` too.
- A pure helper re-exported from the canvas module means importing the helper
  drags three.js in with it.
- See the Outcome above for why this cost 0 kB in practice, and was still worth
  deleting.

### Steps

1. Run `npm run build` and record per-route First Load JS **before** touching
   anything. Without a before number, "improved" is unprovable — the same
   mistake Part B exists to prevent.
2. Delete the `planetIdentityKey` re-export from `UniverseCanvas`; point the
   three importers at `scene-renderers/planetIdentity`, where it already lives.
3. Convert the two registry entries to lazy components, keeping the registry's
   two-level resolution (`sceneType` first, then `theme`) unchanged.
4. Confirm the lazy component still satisfies `SceneRendererComponent`; widen the
   type only if the compiler demands it.
5. No new Suspense boundary: `<SceneRenderer>` already sits inside
   `<Suspense fallback={<CanvasLoader />}>` (`UniverseCanvas.tsx:164-175`), so a
   lazy component suspends on the boundary that exists. Leave it alone —
   `SceneReadySignal` shares that boundary, which is what keeps the veil up until
   the chunk *and* its assets are ready.
6. Prefetch the family chunk as soon as the family is known. The create form
   knows Universe vs Forest before the world exists, so the fetch can overlap
   generation instead of following it.
7. Re-run `npm run build`; compare against step 1.

### Verification

- Per-route First Load JS drops for the world and share routes.
- `npm run typecheck` and the full FE test run stay green.
- Manually: open a forest world, confirm the universe chunk is never requested
  in the network panel; then the reverse.
- The existing `isSceneReady` opacity veil (`UniverseCanvas.tsx:137`) plus
  `CanvasLoader` already cover a delayed first frame — no new loading UI.

### Risks

- Chunk fetch becomes serial after the config arrives → longer black screen.
  Step 6 is the mitigation, not an optional extra.
- `@react-three/drei` is shared by both families; it will not leave the common
  chunk, so expect a partial win, not a halving.
- Gallery ambient worlds mount several canvases; verify a lazy family resolves
  once, not once per instance.

### Cost

Small. One session. The risky part is step 6, not the split itself.

---

## Part B — US-FOREST-002 codify the fidelity metrics

Goal: every fidelity claim is a test, not a screenshot.

### Outcome — shipped, and it found a bug

Implemented on `feat/fe/forest-fidelity-metrics`. Two new modules
(`forestFidelityMetrics.ts`, `forestWaterMath.ts`) and two test files; the FE suite
goes from 126 tests to 142.

**The measurement paid for itself immediately.** US-FOREST-001 ticked "prove no
mesh folding" on the strength of an argument. Turned into a test, the claim was
false: on the 1.7-unit landmark pond the water mesh inverts triangles on real
seeds — worst signed-area ratio **-0.24**. It is now +0.53 at worst there, and
0.74+ on every lake.

Getting to that took three attempts, and the two wrong ones are the lesson:

1. **Blamed the centre.** The centre vertex never shifts sideways while ring 0
   does, so the triangles joining them looked like the candidates. Re-expressing
   the centre fade in ring units changed the worst ratio by nothing at all —
   `-0.2383` before and after, to four decimals.
2. **Blamed the shore fade's gradient.** The fade runs the shift to zero across
   `SHORE_CALM_FRACTION` of the shore radius, which for a small pond is a gradient
   above 1 — a genuine fold condition, just not this one. Clamping it moved the
   ratio from -0.2383 to -0.2302.
3. **Stopped guessing and printed the failing triangle.** Rings 4,5,5 at radii
   1.2300 / 1.3474 / 1.1337 — the shoreline is steep enough that an interior-ring
   vertex sits FURTHER out than the rim vertex beside it. The triangle is a sliver
   0.07 units thick; the rim is frozen by the shore fade and the interior vertex is
   not, so it walks through the opposite edge. The cause was shoreline steepness,
   which neither hypothesis mentioned.

The fix follows the actual geometry: clamp the sideways field to a fraction of each
triangle's own smallest altitude. Scaling all three vertices of a triangle by one
factor scales every pairwise difference by exactly that factor, so one pass is
sufficient rather than approximate.

What it costs, measured over 200 seeds per size:

| radius | vertices clamped | smallest factor |
| --- | --- | --- |
| 1.70 pond | 88% | 0.001x |
| 10.80 smallest lake | 0.046% | 0.85x |
| 12.15 and above | none | 1.0x |

So the hero water is effectively untouched and the pond gives up most of its
sideways crowding — which it was buying with inverted triangles. Wave height is
untouched everywhere, so nothing loses relief. A better fix exists if it ever
matters: the pond is over-tessellated at 96 angular segments for a 1.7-unit
radius, and scaling segments with radius the way rings already are would give it
room to keep more of the field.

### Corrections to what this plan predicted

- **The published fold metric is wrong as written.** "The Gerstner lateral shift
  never exceeds local vertex spacing" (US-FOREST-001, repeated in step 4 below) is
  a proxy that fails in both directions. It reads as a fold across open water,
  where neighbouring vertices move together and nothing is wrong, and it passed the
  pond, which folded. The acceptance sentence — "no triangle inverts" — is
  measurable directly, and that is what the test does.
- **The grid had to be extracted too, not just the displacement.** Step 3 only
  called for the wave function. A test that rebuilt the vertex layout itself would
  have proved a property of its own copy, so `waterSurfaceRestGrid` and
  `waterSurfaceTriangleIndices` are now shared by the renderer and the test.
- **Per-triangle `expect()` does not scale.** The fold sweep walks about a million
  triangles; asserting each one timed the test out at 5s. Accumulating the worst
  ratio and asserting once per radius runs the same sweep in about a second.
- **A stale comment was found while reading.** `forestMath.ts` documented the
  shipped outline as "8 harmonics, gain 2.0, SDI 1.60" — a configuration replaced
  long ago, in a file whose own code says the top harmonics are gone. Corrected to
  the measured 1.155-1.197, with the test named as the source. This is the failure
  mode US-FOREST-002 exists to end.

### Already satisfied — do not redo

- `forest/forestMath.test.ts` covers the opening camera: determinism, camera on
  dry land, inside the tree-free bank, eye above water, looking across not down,
  water fills ≥ ⅓ of frame, near bank in frame.
- So the frame-share and sight-line metrics named in US-FOREST-002 **are**
  already codified. Only three are missing.

### Missing metrics

| Metric | Threshold (from US-FOREST-001/002) | Where the input already exists |
| --- | --- | --- |
| Shoreline Development Index | > 1.15 | `createWaterOutline(seedText)` — `forestMath.ts:483` |
| Shoreline smoothness ("kink") | peak 2nd derivative of radius < 50 | same outline |
| No triangle fold under waves | Gerstner lateral shift < local vertex spacing | `ForestPondWater.tsx` |

### Blocker found

- The wave maths is JS, not GLSL — good, it is testable.
- But it is **module-private inside a `.tsx` component**: `SURFACE_WAVES:49`,
  `WAVE_STEEPNESS:66`, `RIPPLE_WAVE_COUNT:105`, the per-vertex displacement loop
  at `ForestPondWater.tsx:341-352`, and the anti-fold `lateralScale` guard
  at `:220`.
- A test cannot reach any of it without extraction first.

### Steps

1. Add `forest/forestFidelityMetrics.ts` — pure functions over an outline:
   `waterOutlinePerimeter`, `waterOutlineArea`, `shorelineDevelopmentIndex`,
   `shorelineKinkMetric`.
2. Test them across a wide seed sweep (the existing tests use hundreds of seeds;
   match that, not three hand-picked ones).
3. Extract the displacement into `forest/forestWaterMath.ts` as
   `gerstnerSurfaceDisplacement(x, z, time, lateralScale)`, exporting the wave
   table; `ForestPondWater.tsx` imports it and keeps its current behaviour.
4. Assert no fold: sample a vertex grid across several time samples, check the
   lateral shift never reaches local vertex spacing.
5. Record the measured numbers in [forest-realism-roadmap.md](../../plans/frontend/forest-realism-roadmap.md)
   and tick the US-FOREST-002 tasks.

### Trap already paid for once

- SDI alone is gameable: it was once pushed to 1.58 with high harmonics and the
  lake looked **worse** — jagged notches, not bays.
- The kink metric is that counterweight. Never land an SDI change without it.

### Verification

- Extraction step 3 is behaviour-preserving: the rendered lake must be identical
  for a fixed seed, so review the diff for accidental constant changes.
- Full FE test run green; new tests fail if the thresholds are inverted.

### Cost

Medium — larger than Part A. Step 3 touches a live renderer, and a seed sweep
usually surfaces a handful of failing seeds that need judgement calls. Give it
its own session.

---

## Where this document is linked from

Back-links exist so this plan is reachable from any entry point:

- [../README.md](../../README.md) — index structure table and audit snapshot
- [threejs-scene-architecture.md](../../knowledge/frontend/threejs-scene-architecture.md) — §Performance
- [../user-stories/engineering-backlog.md](../../plans/backlog/engineering-backlog.md) — deferred work section
- [../user-stories/scene-fidelity.md](../../plans/backlog/scene-fidelity.md) — US-FOREST-002
- [forest-realism-roadmap.md](../../plans/frontend/forest-realism-roadmap.md) — metric history
- [../vision/frontend-plan.md](../../plans/frontend/frontend-plan.md) — lazy-chunk line item

# Frontend plan — scene-family renderers

> **Document status:** Active current-source renderer plan; async API migration pending
> **Last source review:** 2026-07-22

> Sprint 1 additionally replaces synchronous create with `202 + jobId` polling
> while preserving the renderer registry and one gateway origin. The target API
> flow is defined in [Vision V1 solution architecture](versions/v1-2026-07-22/solution-architecture.md).

Part of the [vision folder](README.md). This plan describes the source that
exists now and the smallest upgrades needed next.

## Implemented baseline

- `WorldFamily = "universe" | "nature"` selects the public gateway prefix,
  API calls, gallery reference, world query parameter, share route, preview,
  and renderer.
- `registry.ts` resolves `sceneType` before Universe `theme`; Forest config
  therefore cannot fall into the solar-system renderer.
- The create form offers Universe and Forest and builds a family-specific,
  deterministic preview.
- Both share routes generate server-side metadata through the same one-gateway
  helper used by browser requests.
- Vitest covers the API normalizer, gateway URL mapping, preview builders, and
  deterministic procedural recipes.

## Gaps proven by source

### 1. The type model is not yet a discriminated union

`lib/types.ts` exposes one broad `SceneConfig`: almost every field is optional,
`sceneType` is `string`, and an index signature permits unknown keys. Universe
configs omit `sceneType` entirely while Forest emits `"forest"`. This keeps old
worlds rendering, but it cannot make invalid family/section combinations fail
at compile time.

Target, after the backend contract adds an explicit Universe discriminator:

```ts
type SolarSystemSceneConfig = SceneConfigBase & {
  sceneType: "solar-system";
  planets: PlanetSceneConfig[];
};

type ForestSceneConfig = SceneConfigBase & {
  sceneType: "forest";
  landmarks: ForestLandmarkConfig[];
};

type CitySceneConfig = SceneConfigBase & {
  sceneType: "city";
  districts: CityDistrictConfig[];
};

type SceneConfig =
  | SolarSystemSceneConfig
  | ForestSceneConfig
  | CitySceneConfig;
```

Legacy configs without `sceneType` must normalize to `"solar-system"` before
renderer resolution. Do not delete compatibility for already stored worlds.

### 2. Scene renderers are eagerly bundled — resolved

Done on `feat/fe/lazy-renderer-chunks`. Each family is now its own client-side
chunk suspending into the existing `CanvasLoader`, exactly as this section asked
— via `React.lazy` rather than `next/dynamic`, because `next/dynamic` in 14.2.x
does not suspend and would have lifted the scene-ready veil early.

Acceptance was build output, not a source-level dynamic import: First Load JS
fell 512-526 kB → 436-450 kB across the five 3D routes, `app-build-manifest.json`
lists neither family chunk under any route, and a `next start` probe confirmed
the served HTML of each route references neither. Numbers and mechanism live in
[../fe/threejs-scene-architecture.md](../fe/threejs-scene-architecture.md)
§Family chunks.

### 3. API responses are trusted at runtime

`lib/api.ts` parses JSON, normalizes through `any`, and casts payloads to the
requested generic. The defensive normalizer is valuable for legacy response
shapes, but malformed gateway/service output is not validated against a
runtime schema. Generate or hand-maintain one validated boundary; do not spread
schema checks through components.

### 4. Mobile quality was deliberately missing, now pulled forward to Sprint 7

The main canvas allows DPR up to 3 and source comments explicitly put weak
devices out of scope. There is no `PerformanceMonitor`, adaptive DPR,
family-level quality profile, LOD policy, or WebGL error boundary. The owner
decided on 2026-07-19 that City reaches a desktop high-fidelity baseline and
feature completion first, with measured mobile/weak-device tiers to follow
afterward. **On 2026-08-28 the owner pulled this forward into
[Sprint 7](../sprints/sprint-07-2026-08-28/README.md)**, alongside that
sprint's other create-form/gallery/audio polish, rather than waiting on City —
the same kind of schedule move Sprint 6 recorded for Ocean, costing calendar
order and nothing else. The constraint that survives the move unchanged: the
approved high tier must stay pixel-identical, whatever tier system ships, and
City must fit into that tier system once it exists rather than needing to
precede it.

### 5. Asset delivery has two concrete gaps

- Nature's Draco-compressed GLBs use Drei's default Google-hosted decoder
  because no local decoder path is configured. This conflicts with the repo's
  self-hosted-runtime policy.
- Catalog tests verify deterministic selection, but do not verify that every
  referenced model/HDRI/texture exists, has attribution metadata, and remains
  below its budget.

## Next sequence

1. Migrate Next.js 14 through supported majors and make the production audit
   gate green.
2. Harden the contract from BE schema to FE discriminated union plus runtime
   validation.
3. Lazy-load renderer families and publish per-family JS/asset budgets.
4. Self-host the Draco decoder and add catalog/file/license/budget tests.
5. Implement City contracts, `city-service`, gateway/deployment and the
   high-fidelity desktop renderer/product flow defined in
   [city-service-plan.md](city-service-plan.md).
6. Verify City locally and on Render against the initial desktop support matrix.
7. Add adaptive DPR/LOD/texture/shadow/reflection/effect tiers for mobile and
   weak devices; keep the approved high tier unchanged. **Reordered ahead of
   steps 5-6 by the owner on 2026-08-28** — built now in Sprint 7 against the
   three shipped families (Universe/Forest/Ocean); City adopts the same tier
   system once it ships instead of gating this step.

Given/When/Then acceptance and branch-sized tasks are maintained in
[../user-stories/engineering-backlog.md](../user-stories/engineering-backlog.md).

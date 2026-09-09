# WebGPU-first migration feasibility — myunivokai's full 3D rendering stack

> **Document status:** Research. **Nothing here is approved and no production code was modified.**
> **Raised:** 2026-09-09 by the owner — a full-stack feasibility study, not a "can we use WebGPU
> somewhere" question.
> **Last source review:** 2026-09-09
> **Method:** every repository claim below was read from the source and carries a `file:line`. Every
> external claim carries a URL, the date on the source, and the version it applies to. The strongest
> class of evidence used is the **installed** `three@0.171.0` in `node_modules`, read directly —
> what this project already has, not what an article says three.js can do. Two of my own initial
> conclusions were refuted by that source and are recorded as refuted in §27 rather than quietly
> corrected.
> **Research completeness — read this before acting:** the external half of this study was run as a
> parallel agent fleet and **the fleet was killed twice by the session limit**: 50 of 50 agents on the
> first attempt, then 7 of 8 on the second. One external topic (browser support) completed in full and
> is excellent. The remaining external ground was recovered by hand, narrowly, aimed only at the
> questions that decide the verdict. **§28.3 lists six things that are still UNVERIFIED**, and they are
> load-bearing. This document is honest about which of its sections rest on primary source and which
> rest on a single reading.
> **Supersedes:** nothing. **Amends:** `../evolution/platform-evolution-research.md` §Track D and
> `../evolution/frontend-modernization-research.md` §WebGPU — see §20, which is an audit of both, not
> a summary.

---

## The question this report answers

> Can myunivokai realistically become a WebGPU-first Three.js application, using WebGL2 as a
> compatibility fallback for unsupported devices and browsers, while preserving the current
> application's behaviour and visual identity?

Not "can we add WebGPU". The target is the whole rendering stack moving to a WebGPU-first
architecture, with WebGL2 as the compatibility path, and a user unable to tell which one they got.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Actual current architecture](#2-actual-current-architecture)
3. [Complete rendering dependency inventory](#3-complete-rendering-dependency-inventory)
4. [Exact dependency versions](#4-exact-dependency-versions)
5. [Current renderer analysis](#5-current-renderer-analysis)
6. [Three.js WebGPURenderer analysis](#6-threejs-webgpurenderer-analysis)
7. [TSL analysis](#7-tsl-analysis)
8. [Complete shader audit](#8-complete-shader-audit)
9. [Material audit](#9-material-audit)
10. [Render target / depth / MRT audit](#10-render-target--depth--mrt-audit)
11. [Post-processing audit](#11-post-processing-audit)
12. [Ocean audit](#12-ocean-audit)
13. [Creature rendering audit](#13-creature-rendering-audit)
14. [Animation audit](#14-animation-audit)
15. [WebGPU compute analysis](#15-webgpu-compute-analysis)
16. [WebGPU/WebGL interoperability analysis](#16-webgpuwebgl-interoperability-analysis)
17. [WebGPU-first architecture options](#17-webgpu-first-architecture-options)
18. [WebGL2 fallback strategy](#18-webgl2-fallback-strategy)
19. [Browser compatibility](#19-browser-compatibility)
20. [Previous research vs current reality](#20-previous-research-vs-current-reality)
21. [Migration matrix](#21-migration-matrix)
22. [Risk matrix](#22-risk-matrix)
23. [Visual parity strategy](#23-visual-parity-strategy)
24. [Performance analysis](#24-performance-analysis)
25. [Recommended target architecture](#25-recommended-target-architecture)
26. [Migration plan](#26-migration-plan)
27. [Self-challenge / second-pass research](#27-self-challenge--second-pass-research)
28. [Final feasibility verdict](#28-final-feasibility-verdict)
29. [References](#29-references)

---

## 1. Executive summary

**Verdict: FEASIBLE WITH MAJOR MIGRATION. Confidence 72%.**

There is **no hard blocker**. Every candidate blocker this study examined turned out to be
migration work with a named target, and in three cases the claimed blocker was simply wrong.

The three facts that make it feasible are all provable from the version already installed:

1. **`three@0.171.0` already ships the entire dual-backend machinery.** `build/three.webgpu.js`
   contains `WebGPURenderer`, `WebGPUBackend` **and** `WebGLBackend`, and the automatic fallback is
   wired in the constructor and fires when `backend.init()` rejects. Quoted in full in §6.2.
2. **`@react-three/fiber@9.7.0` already supports an async custom renderer.** It `await`s the `gl`
   prop when that prop is a function. Quoted verbatim in §6.5. No R3F upgrade is needed to *try*
   this.
3. **The application is mostly renderer-agnostic by construction.** No `WebGLRenderTarget` is created
   anywhere in app code; `WebGLRenderer` appears as a *type* in five places and the only thing ever
   called on it is `capabilities.getMaxAnisotropy()`. Scene generation, ocean optics, creature
   behaviour, camera framing, the audio graph, routing and persistence are pure seeded TypeScript with
   ~20 unit-test files behind them, and a backend change cannot touch any of it.

The two facts that make it *major* rather than moderate:

1. **The post-processing chain cannot come along.** `postprocessing@6.39.4` — the installed, locked
   version — contains **508** references to `WebGLRenderTarget`, **370** to `WebGLRenderer`, and
   **zero** to WebGPU, NodeMaterial or TSL. It is not unsupported by omission; it is built out of
   WebGL classes. The chain of seven effects plus N8AO must be rebuilt on three.js's own node
   pipeline, where only two of the seven have a first-party equivalent (§11).
2. **A three.js upgrade across fifteen releases is a prerequisite, and it moves the WebGL path's own
   appearance.** Current stable is **0.186.0**; the project is on **0.171.0**. r180→r181 changed
   indirect specular, PBR energy conservation and PMREM reflections — which alters how 56
   `MeshStandardMaterial` sites look *on the existing renderer*, before WebGPU is involved. And
   `postprocessing@6.39.4`'s peer range `>= 0.168.0 < 0.186.0` forces the order: three.js can reach
   0.185.x with the post chain intact, but 0.186.0+ requires the post chain to already be replaced.

**Scope of change:** roughly **18 shader-level items** (9 raw GLSL `ShaderMaterial`s, 9
`onBeforeCompile` patches) plus one shared GLSL library, one post-processing file rebuilt, one device
tier probe, one context-loss boundary, and a new async pre-flight ahead of canvas mount. That is
approximately **20 files of the ~100 in the 3D layer**, and none of the ~2,900 lines of seeded scene
maths.

**The honest caveat.** Roughly **20% of real users would land on the WebGL2 path** (§19), which makes
the fallback a *second production renderer* held to the same 60 fps floor and the same screenshots —
two shader dialects maintained forever. And WebGPU-first **adds a failure mode WebGL2 does not have**:
a `GPUDevice` can be lost mid-session on a driver update, and every buffer, texture and pipeline must
then be rebuilt. Preserving current behaviour must include not going black when that happens.

**Recommended next step is not a migration.** It is a one-day measurement that costs almost nothing
and can invalidate the whole plan: find out whether this project's headless Chromium exposes a
*hardware* WebGPU adapter on the RTX 4060 target. Without that, there is no way to prove parity, and
a migration without a parity harness is a redesign wearing a migration's clothes. See §26 Phase 0 and
§28.4.

---

## 2. Actual current architecture

Discovered from the source, not assumed. All paths relative to `apps/myunivokai-personalization/`.

```text
Next.js 15.5.23  app router  (src/app/**)
        │   "use client" boundary; renderer chunks are React.lazy
        ▼
React 19.2.8
        │
        ▼
@react-three/fiber 9.7.0   <Canvas>            src/components/UniverseCanvas.tsx:490
        │
        ├── gl={{ preserveDrawingBuffer,
        │         powerPreference:"high-performance",
        │         toneMapping: ACESFilmic (ocean) │ AgX (others) }}          :516-520
        ├── shadows={ tier.allowsShadows && (forest│ocean) ? "soft" : false } :503
        ├── dpr={activeDevicePixelRatioRange}   ceiling [1,3]                :506
        ├── key={canvasRemountKey}   ← tears down the GL context per world   :455
        └── onCreated → gl.debug.checkShaderErrors = false in production     :521
        │
        ▼
THREE.WebGLRenderer            constructed by R3F — never by application code
        │
        ├── AdaptiveResolution      walks dpr down when frames are missed    :119-200
        ├── WebGLFailureBoundary    catches render errors + webglcontextlost
        └── useDeviceQualityTier    a THROWAWAY WebGL context, before mount
        │
        ▼
Scene — family chosen by  src/features/scene-renderers/registry.ts  (one lazy chunk each)
        │
   ┌────┴──────────────┬─────────────────────┬──────────────────┐
   │                   │                     │                  │
solar-system         forest                ocean            fallback
emissive, no ground  PBR + real shadows    imperative rig    landing preview
   │                   │                     │
   │                   │                     └── createOceanRig()   ocean/oceanRig.ts:225
   │                   │                         ONE imperative three.js graph,
   │                   │                         driven from useFrame in OceanRenderer.tsx:229
   │                   │
   │                   ├── ForestTerrain / Trees / GroundDecor / DistantTreeline
   │                   │     → buildStaticInstancedMeshes()  forest/forestModels.ts:498
   │                   ├── ForestPondWater / ForestWaterway   (DataTexture ripple normals)
   │                   ├── ForestWildlife / birds  → drei useAnimations → AnimationMixer
   │                   └── <Environment>  (drei, PMREM)
   │
   ├── SolarPlanet / Sun / BinarySun / ProceduralMoons / AsteroidBelt / Comet
   ├── MilkyWayBand / ConstellationField / NebulaCloudPoints / Skybox
   └── <Environment> + <Lightformer>  (drei, PMREM)
        │
        ▼
Materials   MeshStandardMaterial ×56 · MeshBasicMaterial ×29 · PointsMaterial ×12
            SpriteMaterial ×11 · LineBasicMaterial ×1
            + 9 raw GLSL ShaderMaterials          (§8)
            + 9 onBeforeCompile patches           (§8)
        │
        ▼
@react-three/postprocessing 3.0.4  →  postprocessing 6.39.4
  EffectComposer(multisampling = f(pixelRatio))   shared/PostEffects.tsx:169
    N8AO → Bloom(mipmapBlur) → HueSaturation → BrightnessContrast
         → ChromaticAberration → Vignette → Noise(SOFT_LIGHT)
        │
        ▼
      Canvas  ──→  toDataURL (lib/exportImage.ts:28)
                └→ drawImage into 2D canvas (features/transitions/sceneStill.ts:35)
```

**The one structural fact worth naming.** The ocean is not a React tree of meshes. `OceanRenderer.tsx`
calls `createOceanRig({ renderer, scene, … })` once and drives it imperatively. For a migration this
is *good news*: the ocean — which holds four of the nine raw shaders, seven of the nine patches and the
whole shared GLSL library — presents **one** surface to port, not a hundred JSX props.

---

## 3. Complete rendering dependency inventory

Exhaustive search results. "Sites" counts textual occurrences, not distinct objects.

| Dependency | Sites | Where | Migration consequence |
| --- | --- | --- | --- |
| `WebGLRenderer` (as a **type** only) | 5 | `oceanRig.ts:46,118`, `oceanRigSurface.ts:39,64,220`, `oceanRigTerrain.ts:36,309`, `textureQuality.ts:1,29,41` | Type signatures widen to `Renderer`. The only *call* is `capabilities.getMaxAnisotropy()` |
| `WebGLRenderTarget` / `WebGLCubeRenderTarget` / MRT | **0** | — | **Nothing to migrate.** The composer owns every off-screen buffer, and it is a library |
| `readRenderTargetPixels` / `readPixels` | **0** | — | No GPU→CPU readback in app code |
| `renderer.getContext()` / `.getExtension()` / `.extensions` / `.state` / `.properties` / `.info` | 0 in scene code | — | but see the tier probe below |
| Raw WebGL context calls | 3 | `useDeviceQualityTier.ts:51,63,68` | `getContext("webgl2")`, `WEBGL_debug_renderer_info`, `WEBGL_lose_context` — **runs before any renderer exists** |
| `webglcontextlost` | 1 | `WebGLFailureBoundary.tsx` (window, capture phase) | WebGPU has no such event; needs a `GPUDevice.lost` twin |
| `ShaderMaterial` (raw GLSL) | **9 materials / 5 files** | §8 | The core shader port |
| `onBeforeCompile` | **9 patches / 5 files** | §8 | The core material port |
| `#include <chunk>` | 20 | 8 files | A `WebGLProgram.resolveIncludes` mechanism; disappears with the patches |
| `customProgramCacheKey` | 1 | `forestModels.ts:328` | Foliage program sharing |
| `InstancedMesh` | heavy | forest ×4 files, ocean fauna/flora | `InstanceNode` exists; per-frame `instanceMatrix` upload is the question |
| `CanvasTexture` (2D-canvas bakes) | 8 | `oceanFishSkinTexture`, `oceanRigSurface`, `oceanRigTerrain` ×2, `lightShaftTexture`, `nebulaCloudTexture`, `softCircleTexture`, `gasGiantTexture`, `planetRingTexture` | Backend-agnostic; colour-space tagging is the parity trap |
| `DataTexture` | 1 | `ForestPondWater.tsx:155` | Backend-agnostic |
| drei | 8 components | `useGLTF`, `useTexture`, `useAnimations`, `Environment`, `Lightformer`, `OrbitControls`, `Html`, `Clone` | `Environment`/`Lightformer` (PMREM) are the only real unknowns |
| `AnimationMixer` (via drei `useAnimations`) | 4 | `ForestWildlife.tsx:186,453,579`, `DistantBlackHole.tsx` | CPU-side, renderer-agnostic |
| `SkinnedMesh` / `Skeleton` | 0 in `src/` | **constructed by GLTFLoader** | Present at runtime — a grep of `src/` is the wrong instrument (see §14) |
| DRACO decoder | self-hosted | `shared/modelDecoders.ts`, `public/vendor` | Already app-owned because the CSP blocks Google's host |
| Canvas readback | 2 | `exportImage.ts:28`, `sceneStill.ts:35` | DOM-level, but depends on buffer-preserved-after-present semantics |
| `LineLoop` | **0** | only `lineSegments` in `ConstellationField.tsx:247` | Dodges a documented `Renderer` limitation |

---

## 4. Exact dependency versions

From `package.json`, cross-checked against `package-lock.json` **and** `node_modules`.

| Package | Declared | Locked + installed | Current latest | Upgrade needed? |
| --- | --- | --- | --- | --- |
| `three` | `^0.171.0` | **0.171.0** | **0.186.0** | **Yes — see below** |
| `@react-three/fiber` | `9.7.0` | 9.7.0 | not established | **No, for WebGPU** (§6.5) |
| `@react-three/drei` | `10.7.8` | 10.7.8 | not established | Unknown |
| `@react-three/postprocessing` | `3.0.4` | 3.0.4 | not established | Moot — being replaced |
| `postprocessing` (transitive) | — | **6.39.4** | not established | **Removed, not upgraded** |
| `react` / `react-dom` | `19.2.8` | 19.2.8 | — | No |
| `next` | `15.5.23` | 15.5.23 | — | No |
| `@types/three` | `^0.171.0` | — | — | Tracks `three` |
| `typescript` | `^5.7.2` | — | — | No |

Node `>= 22`.

### 4.1 Is a three.js upgrade required?

**Yes, but not for the reason one would guess.** The WebGPU entry point, both backends, TSL,
`PostProcessing`, `PointsNodeMaterial.sizeNode`, `pointUV`, `wgslFn`, `glslFn` and even a GLSL→TSL
transpiler are **all present in the installed 0.171.0** (§6, §7). A proof-of-concept needs no upgrade
at all.

The upgrade is required because **the node/TSL API this migration would rewrite every shader against
has moved roughly once per release**. Counting from the official Migration Guide across r171→r186:

`TextureNode.uv()`→`sample()` · `varying()`→`toVarying()` · `vertexStage()`→`toVertexStage()` ·
`label()`→`setName()` · `PI2`→`TWO_PI` · `materialAOMap`→`materialAO` ·
`shadowWorldPosition`→`shadowPositionWorld` · `directionToColor()`→`packNormalToRGB()` ·
`colorToDirection()`→`unpackRGBToNormal()` · **`PostProcessing`→`RenderPipeline`** ·
`PostProcessingUtils`→`RendererUtils` · `resolution`→`resolutionScale` ·
`colorBufferType`→`outputBufferType` · `InstancedPointsNodeMaterial` **removed** ·
`AnamorphicNode` **removed**.

Fifteen renames or removals in fifteen releases, in exactly the surface a migration touches. Writing
the port against 0.171.0 would mean writing it twice.

### 4.2 The upgrade's own cost, independent of WebGPU

These change the **existing WebGL path's appearance** and must be validated on their own:

- **r180 → r181** — *"Indirect specular light for PBR materials improved; changes overall appearance
  slightly."* · *"PBR materials now better conserve energy; rough materials brighter than before."* ·
  *"PMREM reflections improved."* — 56 `MeshStandardMaterial` sites; both the forest and solar-system
  families light entirely through `<Environment>`. This is the highest silent-risk entry in the range,
  and the prior internal research was right to flag it.
- **r181 → r182** — *"`PCFSoftShadowMap` with `WebGLRenderer` now deprecated; use `PCFShadowMap`."*
- **r185 → r186** — *"`PCFSoftShadowMap` with `WebGPURenderer` has been removed; use `PCFShadowMap`
  which is now soft as well."* Together: `shadows="soft"` (`UniverseCanvas.tsx:503`) is on a
  deprecated-or-removed path on **both** backends at current versions.
- **r183 → r184** — *"Background and environment map rotation aligned to 3D object rotation
  behavior."*
- **r177 → r178** — *"`MultiplyBlending` and `SubtractiveBlending` now require
  `Material.premultipliedAlpha` set to `true`."* — `NebulaCloudPoints` takes a `blending` prop and the
  Great Rift uses a darkening blend.
- **r184 → r185** — *"`WebGPURenderer` has changed how premultiplied alpha is implemented; configure
  opaque background color or clear color."* — the app has five additive layers and a transparent
  canvas.

### 4.3 The sequencing is forced by a peer range

`node_modules/postprocessing/package.json`:

```json
"peerDependencies": { "three": ">= 0.168.0 < 0.186.0" }
```

`postprocessing@6.39.4` supports three.js up to **0.185.x** and **excludes 0.186.0**. So:

- `0.171.0 → 0.185.x` is possible **with the existing post chain intact, on the existing WebGL path** —
  a self-contained, independently verifiable step.
- `0.186.0+` requires the post chain to already be gone.

There is exactly one safe order, and a peer range — not taste — establishes it.

---

## 5. Current renderer analysis

### 5.1 Where it is created and by whom

The application **never constructs a renderer**. `UniverseCanvas.tsx:490` mounts one `<Canvas>` and
R3F constructs `THREE.WebGLRenderer` internally. Every renderer setting is therefore either a `<Canvas>`
prop or an `onCreated` mutation.

| Setting | Current value | Source | WebGPURenderer mapping |
| --- | --- | --- | --- |
| `antialias` | R3F default `true` | R3F default props | Constructor param exists; MSAA differs — see §11 |
| `alpha` | R3F default `true` | R3F default props | Exists; **r185 premultiplied-alpha change applies** |
| `powerPreference` | `"high-performance"` | `:518` | Exists; passed to `requestAdapter()` |
| `preserveDrawingBuffer` | prop-driven, `false` default | `:290,517` | **No direct analogue.** Canvas readback semantics differ — §10.3 |
| `toneMapping` | `ACESFilmic` (ocean) / `AgX` (rest) | `:519` | **Both registered** in the node library — §6.4 |
| `outputColorSpace` | not set (three default sRGB) | — | Node path has `ColorSpaceNode` / `RenderOutputNode` |
| `shadows` | `"soft"` = `PCFSoftShadowMap`, forest + ocean only | `:503-505` | **Removed for WebGPURenderer at r186** → `PCFShadowMap` |
| `dpr` | `[1,3]`, narrowed at runtime | `:506`, `renderQuality.ts` | Renderer-agnostic; but reallocation cost interacts with pipelines — §24 |
| `stencil` / `depth` | R3F defaults | — | Constructor params exist |
| `logarithmicDepthBuffer` | not used | — | n/a |
| XR | not used | — | n/a |
| `debug.checkShaderErrors` | `false` in production | `:521` | **No analogue** — a `WebGLRenderer.debug` property |
| Frame loop | R3F default (always) | — | Unchanged |
| Resize | R3F built-in | — | Unchanged |
| Lifecycle | **full remount per world** via `key` | `:455` | The interaction with async `init()` is the real design question — §17 |

### 5.2 Three couplings that are not visible from filenames

**(a) The device tier probe runs on raw WebGL, before any renderer exists.**
`useDeviceQualityTier.ts:48-78` creates a throwaway canvas and calls
`getContext("webgl2") ?? getContext("webgl")` (`:51`), `getExtension("WEBGL_debug_renderer_info")`
(`:63`) and `getExtension("WEBGL_lose_context")` (`:68`). `deviceQualityTier.ts:139-163` then
string-matches the renderer description for software rasterisers and combines it with
`navigator.webdriver`, `hardwareConcurrency` and `deviceMemory`. **Its answer decides shadows and the
entire post-processing profile**, and `UniverseCanvas.tsx:299-301` states explicitly that both are
fixed at canvas creation and cannot be walked back later the way the pixel ratio can.

A WebGPU-first architecture needs a parallel probe via `navigator.gpu.requestAdapter()` and
`adapter.info`, and a decision about what to do when the two disagree. Bounded work, but it sits at
the very front of the mount path.

**(b) Failure detection is a WebGL event.** `WebGLFailureBoundary.tsx` listens for
`webglcontextlost` on `window` in the **capture** phase (the file explains why: the event does not
bubble). WebGPU raises no such event — device loss is the `GPUDevice.lost` promise. Lose this and the
app loses its only defence against the exact failure it was built for: *"a correctly-sized area of
background colour with no way to tell whether their world is still coming, failed, or never existed."*

**(c) The renderer is passed into the ocean rig, but barely used.** `createOceanRig({ renderer, … })`
and `createSeaTop({ renderer, … })` take a `WebGLRenderer`, and `createWaterNormalTexture(renderer)`
(`oceanRigSurface.ts:64`) takes one and **never uses it** — it bakes on a 2D canvas (`:66-71`). The
parameter is vestigial. The only genuine capability read in the entire codebase is
`gl.capabilities.getMaxAnisotropy()` in `textureQuality.ts:30,42`.

---

## 6. Three.js WebGPURenderer analysis

**All of §6 is read from the installed `node_modules/three` at 0.171.0**, which is the strongest
evidence available: it describes what this project already has. Where the current 0.186.0 differs, §4.1
and §4.2 say so.

### 6.1 The entry point ships in the installed version

`node_modules/three/package.json`:

```json
"./webgpu": "./build/three.webgpu.js",
"./tsl":    "./build/three.tsl.js"
```

Artifacts present: `three.webgpu.js` (982 KB), `three.webgpu.nodes.js` (981 KB), `three.tsl.js`
(27 KB), plus minified twins. Classes present in the bundle: `WebGPURenderer`, `WebGPUBackend`,
**`WebGLBackend`**, `Renderer`.

### 6.2 The automatic WebGL2 fallback is real, and it is an async-init fallback

`build/three.webgpu.js:42929`, verbatim:

```js
constructor( parameters = {} ) {
    let BackendClass;
    if ( parameters.forceWebGL ) {
        BackendClass = WebGLBackend;
    } else {
        BackendClass = WebGPUBackend;
        parameters.getFallback = () => {
            console.warn( 'THREE.WebGPURenderer: WebGPU is not available, running under WebGL2 backend.' );
            return new WebGLBackend( parameters );
        };
    }
    const backend = new BackendClass( parameters );
    super( backend, parameters );
    this.library = new StandardNodeLibrary();
    this.isWebGPURenderer = true;
}
```

And `Renderer.init()` at `:28702`, verbatim on the fallback path:

```js
this._initPromise = new Promise( async ( resolve, reject ) => {
    let backend = this.backend;
    try {
        await backend.init( this );
    } catch ( error ) {
        if ( this._getFallback !== null ) {
            // try the fallback
            try {
                this.backend = backend = this._getFallback( error );
                await backend.init( this );
            } catch ( error ) { reject( error ); return; }
        } else { reject( error ); return; }
    }
    this._nodes = new Nodes( this, backend );
    this._animation = new Animation( this._nodes, this.info );
    this._attributes = new Attributes( backend );
    ...
```

Four consequences, none of them guesswork:

1. **Backend selection is automatic.** The application needs no `navigator.gpu` probe to *choose*.
2. **The trigger is `backend.init()` rejection**, which is the correct trigger — it therefore also
   covers "`navigator.gpu` exists but `requestAdapter()` resolved `null`" and device acquisition
   failing asynchronously, the exact cases a naive `if (navigator.gpu)` misses (§19.2).
3. **Init is genuinely async and everything downstream is built inside the promise** — `_nodes`,
   `_pipelines`, `_bindings`, `_textures`, `_renderLists`. A renderer that has not been awaited has no
   node system at all. This is the mechanical crux of the R3F integration.
4. **`forceWebGL: true` gives a deterministic second path**, which is a far better parity-harness
   primitive than anything the project has today (§23). No document in `agent-system/` has noticed it.

### 6.3 How complete is the WebGL backend? — better than expected

`WebGLBackend` at `:34592` is not a stub. Its method surface includes `createProgram`,
`createRenderPipeline`, `createBindings`, `draw`, `copyTextureToBuffer`, `hasFeature`,
`getMaxAnisotropy`, `initTimestampQuery`, `resolveTimestampAsync` — **and**
`createComputePipeline`, `beginCompute`, `compute`, `finishCompute`, `createStorageAttribute`.

`createComputePipeline` at `:35636` is a real implementation (it builds a
`'#version 300 es … void main() {}'` fragment stub and drives the work through
`transformFeedbackVaryings` at `:35673`; there are 14 transform-feedback references in the bundle,
including `beginTransformFeedback` at `:35163` and `createTransformFeedback` at `:36180`).

**So the WebGL2 backend emulates compute via transform feedback**, which contradicts the common
assumption that compute is WebGPU-only. See §15.

**What this does NOT establish** — and it is the single biggest gap in this report — is whether the
WebGL backend produces the *same image* as `WebGLRenderer` for this application's content. Structural
presence is proven; visual equivalence is **UNVERIFIED**.

### 6.4 Both tone curves the app uses are supported

`StandardNodeLibrary` constructor, `:42904-42910`, verbatim:

```js
this.addToneMapping( linearToneMapping, LinearToneMapping );
this.addToneMapping( reinhardToneMapping, ReinhardToneMapping );
this.addToneMapping( cineonToneMapping, CineonToneMapping );
this.addToneMapping( acesFilmicToneMapping, ACESFilmicToneMapping );
this.addToneMapping( agxToneMapping, AgXToneMapping );
this.addToneMapping( neutralToneMapping, NeutralToneMapping );
```

**AgX** (solar-system, forest) and **ACESFilmic** (ocean) are both registered. The
`'ToneMappingNode: Unsupported Tone Mapping configuration.'` error at `:4464` fires only for a curve
absent from this library.

### 6.5 R3F 9.7.0 already supports an async custom renderer

`node_modules/@react-three/fiber/dist/events-156d8d12.esm.js:946` and `:15733`, verbatim:

```js
const isRenderer = def => !!(def != null && def.render);
...
const customRenderer = typeof glConfig === 'function' ? await glConfig(defaultProps) : glConfig;
if (isRenderer(customRenderer)) {
  gl = customRenderer;
} else {
  gl = new THREE.WebGLRenderer({ ...defaultProps, ...glConfig });
}
```

**R3F `await`s the `gl` factory.** So this works on the installed version:

```tsx
<Canvas gl={async (props) => { const r = new WebGPURenderer(props); await r.init(); return r; }} />
```

`WebGPURenderer` has `.render`, so it satisfies `isRenderer`. R3F's forwarded defaults are
`{ canvas, powerPreference: 'high-performance', antialias: true, alpha: true }`.

**One trap worth naming.** The app currently passes `gl` as a **config object**
(`UniverseCanvas.tsx:516-520`). Under the factory form, `applyProps(gl, glConfig)` is skipped for
functions (`:15918`: `if (glConfig && !is.fun(glConfig) && !isRenderer(glConfig) …)`), so
`toneMapping` and `preserveDrawingBuffer` must be set **by the factory itself**. Small — and exactly
the kind of silent drop that already made the ocean's tone curve a passthrough for its whole life
(`UniverseCanvas.tsx:536-543`).

### 6.6 Named limitations found in the installed bundle

Quoted because they are hard facts, with the ones that touch this app marked:

| Line | Message | Hits myunivokai? |
| --- | --- | --- |
| `:29970` | `'THREE.Renderer: Objects of type THREE.LineLoop are not supported…'` | **No** — only `lineSegments` is used |
| `:27958` | `'WebGPUNodes: Unsupported background configuration.'` | **Possibly** — custom backdrop dome |
| `:28005` | `'WebGPUNodes: Unsupported fog configuration.'` | **Possibly** — the ocean drives fog heavily |
| `:28044` | `'Nodes: Unsupported environment configuration.'` | **Possibly** — drei `<Environment>` |
| `:31223` | `'WebGPURenderer: THREE.DepthTexture.compareFunction() does not support … shader.'` | No |
| `:29709` | `'.compute() called before the backend is initialized. Try using .computeAsync()…'` | Only if compute is adopted |
| `:32245` | `throw 'THREE.WebGLBackend: Unsupported buffer data format: '` | Fallback-path throw; watch float attribute types |
| `:4464` | `'ToneMappingNode: Unsupported Tone Mapping configuration.'` | **No** — §6.4 |

The three "Unsupported … configuration" lines for background, fog and environment are the first three
things a proof-of-concept should exercise, because each has a *supported set* under the node path and
this app uses a non-default option in all three.

---

## 7. TSL analysis

**Not** "TSL supports both backends, therefore everything is portable." The partition below is what
the source supports.

### 7.1 What is present in the installed 0.171.0

Exported from `three/tsl`: `hue`, `saturation`, `grayscale`, `luminance`, `threshold`, `remap`,
`remapClamp`, `posterize` — and both escape hatches, **`glslFn`** and **`wgslFn`**. The webgpu bundle
carries `GLSLNodeParser` and `WGSLNodeParser`.

Node materials exported: `MeshStandardNodeMaterial`, `MeshBasicNodeMaterial`, `MeshPhysicalNodeMaterial`,
`PointsNodeMaterial`, `SpriteNodeMaterial`, `LineBasicNodeMaterial`, `ShadowNodeMaterial`,
`VolumeNodeMaterial`, `MeshSSSNodeMaterial`, and (in 0.171.0 only) `InstancedPointsNodeMaterial`.

Nodes relevant to this app: `InstanceNode`, `BatchNode`, `SkinningNode`, `MorphNode`, `LoopNode`,
`PointUVNode`/`pointUV`, `SpriteSheetUVNode`, `MRTNode`, `StorageBufferNode`, `StorageTextureNode`,
`ComputeNode`, `IndirectStorageBufferAttribute`, `FogNode`/`FogExp2Node`/`FogRangeNode`,
`ViewportDepthNode`, `ViewportDepthTextureNode`, `ViewportSharedTextureNode`, `ViewportTextureNode`,
`ScreenNode`, `RTTNode`, `PMREMNode`, `PMREMGenerator`, `EnvironmentNode`, `NormalMapNode`,
`BumpMapNode`, `TriplanarTexturesNode`, `VertexColorNode`, `AONode`, `ToneMappingNode`,
`ColorSpaceNode`, `RenderOutputNode`, `PassNode`, `PostProcessing`, `QuadMesh`.

### 7.2 The partition this report is willing to assert

| Class | Features | Confidence |
| --- | --- | --- |
| **Renderer-agnostic** (works on both backends) | Node materials and their slot overrides; `hue`/`saturation`/`luminance`/`grayscale`/`remap`; `attribute()`; `uniform()`; `InstanceNode`; `SkinningNode`; `MorphNode`; `LoopNode`; `pointUV`; `PointsNodeMaterial.sizeNode`; fog nodes; tone mapping nodes; `PassNode`; the four shadow filters | **VERIFIED present** in 0.171.0; *behavioural* equality on both backends UNVERIFIED |
| **WebGL-lowered, surprisingly** | Compute nodes and storage attributes — via transform feedback in `WebGLBackend` (§6.3) | VERIFIED structurally |
| **Needs different implementations** | Anything reading a raw WebGL context; `#include <chunk>` composition; `renderer.debug.checkShaderErrors`; `webglcontextlost` | VERIFIED |
| **WebGPU-only in practice** | Indirect draw, timestamp queries at useful precision, workgroup/atomics semantics, `featureLevel: "compatibility"` | **UNVERIFIED** — the agent assigned to derive the authoritative list was killed |
| **Cannot port without behavioural change** | Nothing found. Every construct in this app's shaders has a named node target (§8) | Asserted on §8's per-shader analysis |

**The gap is honest and it matters:** no authoritative WebGPU-only/GLSL-lowered node list was obtained
from three.js documentation. §7.2's fourth row is inference from the bundle, not a fetched source.

### 7.3 The slot mechanism that replaces `onBeforeCompile`

This is the crux of §8, and the mapping is clean because the app's nine patches use only four
injection points:

| `onBeforeCompile` injection | Mutates | Node slot |
| --- | --- | --- |
| `#include <common>` (declarations) | — | node graph scope; `attribute()` / `uniform()` |
| `#include <begin_vertex>` | `transformed` | `positionNode` |
| `#include <worldpos_vertex>` | world position varyings | `positionWorld` built-in |
| `#include <map_fragment>` | `diffuseColor` | `colorNode` |
| before `#include <tonemapping_fragment>` | `gl_FragColor.rgb` | `outputNode` |

And the *reason* the app uses `onBeforeCompile` rather than custom materials is stated in its own
source — `oceanCaustics.ts:206-209`: to keep three.js's lighting, fog and tone mapping and only add to
it. That is precisely what a NodeMaterial slot override does. **The technique and the target are the
same shape.** Chaining (`oceanCaustics.ts:214`, `oceanRigTerrain.ts:131`, both of which deliberately
call a previous handler) becomes *easier*, not harder: node composition is the natural form of it,
where `onBeforeCompile` is a single slot that an assignment can silently clobber.

### 7.4 TSL is a moving API

See §4.1. Fifteen renames or removals across fifteen releases, in this exact surface. Not a blocker;
a reason to migrate once, late, against a current version.

---

## 8. Complete shader audit

### 8.1 The nine raw GLSL ShaderMaterials

| # | Shader | File:line | Purpose (what it puts on screen) | Current implementation | WebGPU path | TSL possible? | WebGL2 fallback | Visual parity | Complexity | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Backdrop dome | `oceanRig.ts:453` | Preetham sky above water; fogged gradient dome below, obeying the same extinction law as every other layer | `ShaderMaterial`, `BackSide`, `depthWrite:false`, `fog:false`; `PREETHAM_SKY_GLSL`; `#include <tonemapping_fragment>`, `<colorspace_fragment>` | `MeshBasicNodeMaterial` + `outputNode`; sky library as a TSL function; chunk includes replaced by `RenderOutputNode`/`ColorSpaceNode` | **YES** | same graph | PERCEPTUALLY_EQUAL | MEDIUM | MEDIUM |
| 2 | Surface from below | `oceanRig.ts:533` | Snell's window, total internal reflection, Fresnel — the ceiling of water seen from underneath | `ShaderMaterial`, `DoubleSide`, `transparent`; Gerstner vertex displacement; chunk includes | `positionNode` for displacement + `outputNode`; shares the TSL sky/wave library | **YES** | same graph | PERCEPTUALLY_EQUAL | HIGH | MEDIUM |
| 3 | God rays | `oceanRig.ts:648` | 24-step volumetric raymarch through shafts of light, additive, depth-test off | `ShaderMaterial`, `AdditiveBlending`, `depthTest:false`; `const int STEPS = 24` loop; fbm; **`gl_FragCoord.xy`** jitter | `LoopNode` + `screenCoordinate`; additive blending is a material flag | **YES** | same graph | TUNABLE — jitter hash must match or the banding pattern shifts | HIGH | MEDIUM |
| 4 | Sea top | `oceanRigSurface.ts:264` | The sea seen from above: Water.js 4-tap normal sum, Jacobian-driven foam on folding crests, aerial perspective | `ShaderMaterial`, `DoubleSide`; 4× `texture2D`; Gerstner + Preetham libraries; chunk includes | `positionNode` + `colorNode`; `texture()` nodes | **YES** | same graph | PERCEPTUALLY_EQUAL | **VERY_HIGH** | MEDIUM |
| 5 | Jellyfish | `oceanRigDrifters.ts:88` | Additive translucent bell | `ShaderMaterial`, `AdditiveBlending` | node material + `outputNode` | **YES** | same graph | PERCEPTUALLY_EQUAL | LOW | LOW |
| 6 | Bubbles | `oceanRigDrifters.ts:225` | Rising bubbles | `ShaderMaterial`, `AdditiveBlending` | node material | **YES** | same graph | PERCEPTUALLY_EQUAL | LOW | LOW |
| 7 | Marine motes | `oceanRigDrifters.ts:360` | Marine snow and bioluminescence | `ShaderMaterial`; **`gl_PointSize`** `:406`, **`gl_PointCoord`** `:416`; additive or normal blending | `PointsNodeMaterial` + **`sizeNode`** + **`pointUV`** | **YES** | same graph | PERCEPTUALLY_EQUAL | MEDIUM | LOW |
| 8 | Sized star points | `SizedStarPoints.tsx:23,47` | Per-star size/colour/twinkle; gaussian core + inverse-square halo + diffraction spikes; **deliberately bypasses colour management** so the authored hex is what ships | `ShaderMaterial`, additive, `depthWrite:false`; **`gl_PointSize`**, **`gl_PointCoord`**, two `discard`s; 4 custom attributes | `PointsNodeMaterial` + `sizeNode` + `pointUV`; `discard` has a node form | **YES** | same graph | **TUNABLE** — the colour-management bypass must be reproduced deliberately under `RenderOutputNode` | MEDIUM | **MEDIUM-HIGH** |
| 9 | Nebula cloud points | `NebulaCloudPoints.tsx:18,44` | Rotated atlas-tile puffs; additive for nebulae, darkening for the Great Rift's dust | `ShaderMaterial`; **`gl_PointSize`**, **`gl_PointCoord`**; atlas UV; 5 custom attributes; `blending` prop | `PointsNodeMaterial` + `sizeNode` + `pointUV` | **YES** | same graph | TUNABLE — **r178 premultipliedAlpha change** applies to the darkening blend | MEDIUM | MEDIUM |

**Shaders 1, 2 and 4 share one GLSL library** in `ocean/oceanSky.ts`: `SKY_UNIFORMS_GLSL:139`,
`PREETHAM_SKY_GLSL:148`, `WAVE_UNIFORMS_GLSL(n):220`, `GERSTNER_SURFACE_GLSL(n):229`. **One library
port serves three shaders**, and `ocean/oceanShaderSource.test.ts` already unit-tests the generated
source as text — a test that can be pointed at the TSL output's structure too.

### 8.2 The nine `onBeforeCompile` patches

| # | File:line | Injects at | Mutates | Purpose | Node slot | TSL? | Complexity | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `forestModels.ts:311` | `<map_fragment>` | `diffuseColor.rgb/.a` | Collapses leaf texture to luminance, remaps to 0.72–1.12, multiplies onto per-instance season tint — so autumn orange over green leaves does not go muddy | `colorNode` | **YES** | LOW | **See below** |
| 2–4 | `oceanCaustics.ts:224,235,247` | `<common>`, `<worldpos_vertex>`, `<common>` | varyings; world position; upness | Caustics setup, including **manual `USE_INSTANCING` handling** because three's own `<worldpos_vertex>` guards `worldPosition` behind `#if defined(USE_ENVMAP)…` | `positionWorld`, `normalWorld` built-ins | **YES** — and *simpler*: the built-in nodes already account for instancing | MEDIUM | MEDIUM |
| 5 | `oceanCaustics.ts:250` | before `<tonemapping_fragment>` | `gl_FragColor.rgb +=` | Analytic caustics: refracted landing point's Jacobian from **`dFdx`/`dFdy`**, area ratio → bright veins, clamped and normalised | `outputNode` + `dFdx`/`dFdy` nodes | **YES** | HIGH | MEDIUM |
| 6 | `oceanRigFauna.ts:1503,1513,1522,1526` | `<common>`, `<begin_vertex>`, `<common>`, `<tonemapping_fragment>` | `transformed.x`/`.y`, `gl_FragColor.rgb *=` | Per-species body undulation (three styles: mobuliform wing flap, cetacean vertical, default lateral) + counter-shading dark-back/bright-belly | `positionNode` + `outputNode`; custom attributes `along`, `aPhase` | **YES** | MEDIUM | MEDIUM |
| 7 | `oceanRigFlora.ts:131,138,151,158` | same four | `transformed.xz`, `gl_FragColor.rgb *=` | Quadratic sway envelope anchored at base, free at tip; tip-to-base tone | `positionNode` + `outputNode`; attribute `aSwayPhase` | **YES** | LOW | LOW |
| 8–9 | `oceanRigTerrain.ts:136,138,144,150` | `<common>`, `<worldpos_vertex>`, `<common>`, `<map_fragment>` | `vSeabedUpness`, `diffuseColor.rgb` | Slope-driven rock vs sediment, using **already-water-tinted** colours so the fog grade survives | `colorNode` | **YES** | LOW | LOW |

**On `forestModels.ts` specifically.** The prior internal research called this *"the one file that can
fail silently and take the forest with it"* and *"a hard blocker for WebGPU"*. The first half is
correct and remains the strongest argument for a screenshot baseline: it string-replaces
`#include <map_fragment>` and depends on two internal three.js details (the chunk name and the
`diffuseColor` variable), and nothing in CI can see the result. The second half is wrong — see §20.
It also sets `customProgramCacheKey = () => "forest-foliage-recolor"` (`:328`) so all foliage shares
one program; the node path's equivalent is that one `MeshStandardNodeMaterial` instance with one
`colorNode` is shared, which is the same optimisation expressed structurally rather than as a cache
hint.

### 8.3 The escape hatches, and the transpiler nobody noticed

- **`glslFn` and `wgslFn` both exist** in `three/tsl` at 0.171.0, with `GLSLNodeParser` and
  `WGSLNodeParser` in the bundle. A shader body that resists translation has a first-party embedding
  route. **UNVERIFIED:** whether `glslFn` works under the WebGPU backend or only the WebGL one.
- **A GLSL→TSL transpiler ships in the box**: `examples/jsm/transpiler/` — `GLSLDecoder.js` (18.4 KB,
  a full GLSL expression parser with precedence and associativity tables), `TSLEncoder.js` (13.8 KB,
  a complete operator map `'=' → assign`, `'*' → mul`, `'<' → lessThan`, …), `AST.js`,
  `ShaderToyDecoder.js`, `Transpiler.js`.

  **No document in `agent-system/` has ever mentioned this**, and shader-porting cost is the largest
  number in any WebGPU estimate. It is a genuine accelerator for the maths-heavy bodies — Preetham,
  Gerstner, the fbm raymarch, the caustics Jacobian.

  **It is not a solution.** It decodes GLSL expressions and functions; it has no notion of
  `#include <chunk>` (three shaders rely on it) or `gl_PointSize` (four shaders write it), and its
  output is machine-generated code that would sit badly against
  [`../rules/coding-style.md`](../rules/coding-style.md)'s rule on fully spelled-out, explicit names.
  Use it for first-pass bodies; hand-finish the plumbing and the naming.

---

## 9. Material audit

### 9.1 Native three.js materials — 108 sites

| Material | Sites | WebGPU equivalent | Effort |
| --- | --- | --- | --- |
| `MeshStandardMaterial` | 56 | `MeshStandardNodeMaterial` | Trivial per site; **but r181 changes its appearance** (§4.2) |
| `MeshBasicMaterial` | 29 | `MeshBasicNodeMaterial` | Trivial |
| `PointsMaterial` | 12 | `PointsNodeMaterial` | Trivial |
| `SpriteMaterial` | 11 | `SpriteNodeMaterial` | Trivial |
| `LineBasicMaterial` | 1 | `LineBasicNodeMaterial` | Trivial |

No `MeshPhysicalMaterial`, no `MeshLambertMaterial`, no `MeshPhongMaterial`, no `MeshToonMaterial`.
The absence matters: the app's PBR surface is narrow, so the r181 lighting change has one shape to
validate, not five.

### 9.2 Modified materials — 9 patches on 5 files

Fully enumerated in §8.2. All are `MeshStandardMaterial` + `onBeforeCompile`, two of them chained,
one with a `customProgramCacheKey`. All map onto `positionNode` / `colorNode` / `outputNode`.

### 9.3 Fully custom materials — 9 raw GLSL `ShaderMaterial`s

Fully enumerated in §8.1. No `RawShaderMaterial`. No `NodeMaterial` or TSL in the app today.

### 9.4 The summary that matters

**Of 126 material sites, 108 are native and convert by renaming a class.** The real work is
concentrated in 18 items across 8 files, and half of that 18 shares one GLSL library.

---

## 10. Render target / depth / MRT audit

### 10.1 The app creates none

Exhaustive search: **zero** `WebGLRenderTarget`, `WebGLCubeRenderTarget`, `WebGLMultipleRenderTargets`,
`DepthTexture`, `readRenderTargetPixels`, or ping-pong buffers in application code. There is no MRT,
no float-texture readback, no feedback loop, no custom depth pass.

This removes what is normally a large and treacherous chapter of a WebGPU migration. Every off-screen
buffer in the frame belongs to `EffectComposer`, and that is a library concern (§11).

### 10.2 What the app does instead: CPU-side texture baking

| Site | Technique | Output | Parity trap |
| --- | --- | --- | --- |
| `oceanFishSkinTexture.ts:200,262` | 2D canvas | `CanvasTexture` ×2 (albedo, emissive) | `NoColorSpace` set deliberately |
| `oceanRigSurface.ts:66` | 2D canvas, 10-octave noise | `CanvasTexture` (water normals) | data map — must **not** be sRGB |
| `oceanRigTerrain.ts:186,190` | 2D canvas ×2 | `CanvasTexture` (albedo + normal) | mixed colour spaces |
| `lightShaftTexture.ts:25` | 2D canvas | `CanvasTexture` | — |
| `nebulaCloudTexture.ts:232` | 2D canvas | `CanvasTexture` (atlas) | alpha-only sampling |
| `softCircleTexture.ts` | 2D canvas | `CanvasTexture` | — |
| `gasGiantTexture.ts`, `planetRingTexture.ts` | 2D canvas | `CanvasTexture` | sRGB colour maps |
| `ForestPondWater.tsx:155` | typed array | `DataTexture` (ripple normals) | data map |

All backend-agnostic in form. The single real risk is **colour space**: `textureQuality.ts` documents
that `TextureLoader` leaves textures `NoColorSpace` and that colour maps must be tagged
`SRGBColorSpace` while data maps must not. The node path applies colour conversion at different points
(`ColorSpaceNode`, `RenderOutputNode`), so every one of these needs a deliberate check rather than an
assumption.

### 10.3 Canvas readback — two sites

- `lib/exportImage.ts:28` — `sceneCanvas.toDataURL("image/png")`, and its own comment states it
  *"requires the canvas to be created with `preserveDrawingBuffer: true`, otherwise the buffer may
  already be cleared when `toDataURL` runs."*
- `features/transitions/sceneStill.ts:35` — `drawImage(sceneCanvas)` into a 2D canvas, then
  `getImageData` on the centre pixel to detect a cleared buffer (`:38-45`) and return `null` so the
  caller cuts instead of warping a transparent rectangle.

Both go through the HTML canvas rather than a renderer API, so they are backend-agnostic *in form*.
But `preserveDrawingBuffer` has no direct WebGPU analogue, and a WebGPU canvas configures
present-time texture validity differently. **VISUAL_PARITY_RISK to test, not a blocker** — and
`sceneStill.ts` already fails safe, which is a genuine piece of luck.

### 10.4 Under the node pipeline

`RenderTarget` (the backend-neutral class), `MRTNode`, `StorageTexture`, `StorageTextureNode`,
`ViewportTextureNode`, `ViewportDepthTextureNode` and `QuadMesh` are all exported in 0.171.0, so the
node post pipeline has what it needs. Note r183: *"`WebGLCubeRenderTarget` incompatible with
`WebGPURenderer`; use `CubeRenderTarget`"* — the app creates none, but drei may internally.

---

## 11. Post-processing audit

**This is the highest-stakes section in the report and the one that sets the verdict at "major".**

### 11.1 The current chain

`shared/PostEffects.tsx:169` mounts `<EffectComposer multisampling={composerMultisamplingFor(pixelRatio)}>`
with, in order:

1. `N8AO` — forest family only, `aoRadius:2`, `intensity:2.2`, `distanceFalloff:1`, `halfRes` above a
   pixel-ratio threshold
2. `Bloom` — `mipmapBlur`, `luminanceThreshold:0.85`, `luminanceSmoothing:0.2`
3. `HueSaturation` — from stored scene data (schemaVersion 1.2) or a per-theme table
4. `BrightnessContrast` — same source
5. `ChromaticAberration` — `offset (0.0005, 0.001)`, `radialModulation`, `modulationOffset:0.15`
6. `Vignette` — `offset:0.28`, `darkness:0.55`
7. `Noise` — `premultiply`, `opacity:0.06`, `BlendFunction.SOFT_LIGHT`

Two couplings that are easy to miss: the chain is chosen **at mount time** from the device tier and
cannot be changed later (`UniverseCanvas.tsx:299-301`), and `PostEffects.tsx:117` reads the
**renderer's** pixel ratio (not the display's) to size multisampling, because using the display's
measured 37 fps against 47 on the forest at 4K.

### 11.2 The library cannot come along — and this is a hard architectural fact

`node_modules/postprocessing` 6.39.4, reference counts in its shipped `build/`:

| Symbol | Occurrences |
| --- | --- |
| `WebGLRenderTarget` | **508** |
| `WebGLRenderer` | **370** |
| `ShaderMaterial` | **178** |
| `getContext` | 52 |
| `WebGPU` | **0** |
| `NodeMaterial` | **0** |
| `TSL` | **0** |

This is not "unsupported by omission." The library is *constructed out of* `WebGLRenderer` and
`WebGLRenderTarget` — 878 references between them. Corroborated upstream: the
[pmndrs/postprocessing README](https://github.com/pmndrs/postprocessing) (fetched 2026-09-09) makes no
mention of WebGPU, WebGPURenderer, TSL or node materials, and its setup guidance is written in terms of
`WebGLRenderer` attributes.

**Classification: ARCHITECTURAL_CHANGE, not HARD_BLOCKER.** The chain must be rebuilt on three.js's own
node pipeline (`PostProcessing` in 0.171.0, renamed **`RenderPipeline`** at r183). That is one file —
`shared/PostEffects.tsx`, 169 lines — plus the retuning below.

### 11.3 Effect by effect

Three.js core at 0.171.0 ships only `PostProcessing`, `PassNode`, `RenderOutputNode`,
`ToneMappingNode` and `AONode`. Every *effect* lives in `examples/jsm/tsl/display/` (29 files).

| Current effect | Current implementation | WebGPU equivalent | TSL/node equivalent | WebGL2 fallback | Visual parity |
| --- | --- | --- | --- | --- | --- |
| `N8AO` | pmndrs, `halfRes`, needs depth+normals | **`GTAONode`** (addon) | yes | same node | **DIVERGENT → TUNABLE.** Different algorithm. r181: *"AO now only accessible in `r` channel"*; r185: *"computes more physically correct ambient occlusion; consider lowering `radius` and `scale`"*. `aoRadius:2`/`intensity:2.2` will not transfer numerically |
| `Bloom` | pmndrs, `mipmapBlur`, threshold 0.85 | **`BloomNode`** (addon) | yes | same node | TUNABLE — threshold/smoothing semantics differ from pmndrs'; r185 removed `AnamorphicNode` in its favour |
| `HueSaturation` | pmndrs | **`hue()` + `saturation()` — core TSL functions** | yes, core | same | IDENTICAL in intent; trivial |
| `BrightnessContrast` | pmndrs | no node — arithmetic | hand-write ~5 lines | same | IDENTICAL |
| `ChromaticAberration` | pmndrs, `radialModulation` | `RGBShiftNode` is a *different* effect | hand-write | same | PERCEPTUALLY_EQUAL — the radial modulation is bespoke already |
| `Vignette` | pmndrs | no node — arithmetic | hand-write ~5 lines | same | IDENTICAL |
| `Noise` (SOFT_LIGHT) | pmndrs, `premultiply` | `FilmNode` is film grain | hand-write to keep SOFT_LIGHT | same | PERCEPTUALLY_EQUAL |
| `EffectComposer` + `multisampling` | pmndrs | `PostProcessing`/`RenderPipeline` + `PassNode` | yes | same | **The real work.** MSAA and HDR buffer configuration differ; r185 changed WebGPU premultiplied alpha |

**Honest summary: two of seven effects have a first-party node, one is covered by core TSL functions,
four are small hand-written passes, and the composer wiring is rebuilt.** The cost is not the pixels —
four of these effects are five lines of arithmetic each. The cost is (a) losing a mature library,
(b) the N8AO→GTAO retune, which is a genuine look change on the forest family, and (c) owning MSAA and
HDR buffer configuration directly.

### 11.4 A live quirk any migration must decide about deliberately

`UniverseCanvas.tsx:536-543` records that `@react-three/postprocessing` sets
`gl.toneMapping = NoToneMapping` on mount and expects a `<ToneMapping>` effect in the chain, which this
chain has never had — *"So for the ocean's whole life its tone curve was a passthrough,
`toneMappingExposure` was read by nothing, and every linear value above 1 clipped flat to white."*
Two of the nine raw shaders carry comments about compensating for exactly this (`oceanRig.ts` god rays,
`oceanCaustics.ts` clamps). A migration that fixes the tone curve **will change the ocean's look**, and
several hand-tuned constants were tuned against the broken behaviour. This must be a deliberate
decision, taken once, and it is arguably a reason to fix it *before* the migration so the baseline is
honest.

---

## 12. Ocean audit

The ocean holds four of nine raw shaders, seven of nine patches, and the entire shared GLSL library.
It is the migration's centre of gravity. **The target is to preserve its current appearance, not to
redesign it.**

| Component | Current implementation | WebGPU implementation | TSL possibility | WebGL2 fallback | Visual parity | Complexity |
| --- | --- | --- | --- | --- | --- | --- |
| Geometry / vertex density | `createSeaGrid(300, 256, 1.1, 5600)` high / `(140,128,…)` low, `oceanRigSurface.ts`; `PlaneGeometry(900,900,280,280)` for the from-below sheet | unchanged — `BufferGeometry` is backend-neutral | n/a | same | IDENTICAL | TRIVIAL |
| Wave displacement | `GERSTNER_SURFACE_GLSL(n)` in vertex shader, `oceanSky.ts:229` | `positionNode` | **YES** | same | PERCEPTUALLY_EQUAL | HIGH |
| Normals | exact Gerstner normal + capillary ripple from a 4-tap `CanvasTexture` sum (Water.js's four mutually-prime periods) | same maths in TSL; `texture()` nodes | **YES** | same | PERCEPTUALLY_EQUAL | HIGH |
| Foam | surface **Jacobian** collapse (`vFold`) × uncorrelated lace pattern, threshold from Monahan whitecap fraction | same | **YES** | same | PERCEPTUALLY_EQUAL | MEDIUM |
| Reflection | analytic Preetham sky reflected through the wave normal, disc excluded and left to the specular term | same | **YES** | same | PERCEPTUALLY_EQUAL | MEDIUM |
| Refraction | Snell's window + total internal reflection on the from-below sheet | same | **YES** | same | PERCEPTUALLY_EQUAL | HIGH |
| Depth / underwater optics | `oceanOptics.ts` (451 lines) + `oceanDepthCurve.ts`, pure TypeScript feeding uniforms | **unchanged — renderer-agnostic** | n/a | same | **IDENTICAL** | NONE |
| Transparency | `transparent:true`, `DoubleSide`, `depthWrite:false` on backdrop and rays, `renderOrder:-1000` on the dome, `depthTest:false` on god rays; two materials for one water sheet, never both visible | material flags are backend-neutral; **sorting semantics need checking** | n/a | same | **TUNABLE** — transparency sort order is a classic divergence | MEDIUM |
| Fog | extinction law `1 - exp(-(d·k)²)` written by hand in each layer, plus `scene.fog` | hand-written law ports directly; `scene.fog` → `FogNode` — **but `:28005` `'Unsupported fog configuration'` exists** | **YES** | same | PERCEPTUALLY_EQUAL | MEDIUM |
| Caustics | `oceanCaustics.ts`, analytic, `dFdx`/`dFdy` Jacobian, injected into `MeshStandardMaterial` before tone mapping | `outputNode` + `dFdx`/`dFdy` nodes on `MeshStandardNodeMaterial` | **YES** | same | PERCEPTUALLY_EQUAL | HIGH |
| God rays | 24-step raymarch, fbm, `gl_FragCoord` jitter, additive, depth-test off | `LoopNode` + `screenCoordinate` | **YES** | same | TUNABLE — hash must match | HIGH |
| Particles (motes, bubbles, jellyfish) | 3 `ShaderMaterial`s, `gl_PointSize`/`gl_PointCoord`, additive | `PointsNodeMaterial` + `sizeNode` + `pointUV` | **YES** | same | PERCEPTUALLY_EQUAL | MEDIUM |
| Environment interaction | `OceanLandmarks`, `OceanSunkenRelicModel`, terrain slope-rock | `colorNode` | **YES** | same | PERCEPTUALLY_EQUAL | LOW |
| CPU vs GPU split | behaviour, spawn, optics, sea state, framing all CPU and seeded; displacement, foam, caustics, rays all GPU | split is preserved | n/a | same | **IDENTICAL on the CPU half** | — |
| Render targets | **none** | none needed | n/a | same | IDENTICAL | NONE |
| Post interaction | ocean uses `ACESFilmicToneMapping`; the composer has been nullifying it (§11.4) | `ToneMappingNode` supports ACESFilmic (§6.4) | yes | same | **CHANGES — deliberately** | MEDIUM |

**Ocean feasibility: 60/100.** Every component has a named target and nothing is blocked. The number
is held down by the sheer volume — the sea-top shader alone is the most intricate single file in the
rendering layer — and by the fact that its hand-tuned constants were tuned against a tone curve that
was silently disabled.

---

## 13. Creature rendering audit

### 13.1 The creatures that actually exist

`ocean/oceanRigFauna.ts` defines **32 species** by key (`:196`–`:1042`): butterflyfish, lionfish,
turbot, shark, swordfish, manta, dolphin, whale, goblinShark, blobfish, silversides, anthias,
lanternfish, anglerfish, barracuda, orca, clownfish, pufferfish, viperfish, blackDragonfish,
fangtooth, gulperEel, hatchetfish, giantOarfish, giantIsopod, giantSquid, vampireSquid, angelfish,
giantPacificOctopus, dumboOctopus, seaTurtle, seahorse.

No crab. Squid and octopus exist (three species); jellyfish exists but as a *drifter shader*
(`oceanRigDrifters.ts:88`), not a fauna species. Forest wildlife and birds are separate
(`forest/ForestWildlife.tsx`).

GLB bindings (`ocean/oceanFaunaModels.ts:39-68`): `FISH_MODEL_BINDINGS`, `GIANT_MODEL_BINDINGS`,
`ABYSS_VISITOR_MODEL_BINDINGS` — the abyssal-visitor lottery, *"whose order is frozen in contracts"*.
Models are reused across species with a `bodyLengthMetres` scale: `fauna-whale.glb` serves humpback
(14 m), blue whale (25 m) and sperm whale (16 m).

### 13.2 Audit against the migration

| Aspect | Implementation | Renderer-coupled? |
| --- | --- | --- |
| Spawning | seeded CPU, `randomFromSeed(seed:species.key)`, leaders and ring radius clamped to what the water can show | **No** |
| Despawning | CPU, flee radius `species.fleeRadiusMetres ?? max(16, pathRadius*0.9)` | **No** |
| Movement | CPU per frame; `turnRateRadPerSecFor(species)` | **No** |
| Animation | **GPU vertex undulation** via `onBeforeCompile` from `uCreatureTime` + per-instance `aPhase`; three styles selected by data flags (`mobuliform`, `vertical`, default lateral) | **YES — the one coupled piece** |
| Orientation / scale | CPU, per-instance matrices | **No** |
| LOD | none found as `THREE.LOD`; quality tiering instead | **No** |
| Culling | **disabled** — `mesh.frustumCulled = false` (`:1533`) | **No** |
| Instancing | one `InstancedMesh` per species (`:1531`) | Yes — `InstanceNode` exists |
| Skeletal animation | `SWIM_CLIP_PREFERENCE` declared (`oceanFaunaModels.ts:30`) with `FORBIDDEN_CLIP_FRAGMENTS` (`:37`) | Yes — via GLTF, see §14 |
| Morph targets | none in app code | — |
| Material | `MeshStandardMaterial` + baked `CanvasTexture` skin (`oceanFishSkinTexture.ts`) | Trivial rename |
| Particle effects | drifters, separate | Covered in §8.1 |
| Per-frame CPU work | position/orientation for every instance of 32 species | **No** — and unchanged |

**Unit-tested and therefore safe:** `oceanRigFaunaBehavior.test.ts`, `oceanRigFaunaCensus.test.ts`.
The behaviour is provably renderer-independent because the tests never construct a renderer.

**Creature compatibility: 90/100.** One coupled item — the undulation patch — with a named node target.

---

## 14. Animation audit

Two mechanisms, and only one touches shaders.

**(a) Skeletal, via GLTF + drei `useAnimations` → `AnimationMixer`.** Forest wildlife walk clips
(`ForestWildlife.tsx:186-197`), forest birds flap clips (`:453-471`, `:579-590`),
`solar-system/DistantBlackHole.tsx`. `AnimationMixer`, `AnimationClip`, `AnimationAction` are pure CPU
and construct no GPU resources — they mutate `Object3D` and `Skeleton` state that the renderer then
consumes. `SkinningNode` and `MorphNode` exist in the node bundle.

`ForestWildlife.tsx:453-455` carries a warning worth preserving: *"useAnimations drives the mixer on
its own internal useFrame — do NOT also …"* — a double-drive bug that a migration must not
reintroduce.

**A correction to my own first pass.** I initially recorded that there is no `SkinnedMesh` exposure,
because `SkinnedMesh` and `Skeleton` never appear in `src/`. That was wrong, and the reason is
instructive: **GLTFLoader constructs them**, not application code, so a grep of the app is the wrong
instrument. Skinning is genuinely in use, and its behaviour under a different backend is a real
question. **UNVERIFIED:** skinning fidelity under the node path.

**(b) Vertex-shader undulation driven by uniforms** — the ocean's instanced schools
(`oceanRigFauna.ts:1503-1527`) and flora sway (`oceanRigFlora.ts:138`). This is the `onBeforeCompile`
path from §8.2 and it is what makes a 32-species reef affordable: one draw call per species, animated
entirely on the GPU.

So (a) should survive a backend change untouched, and (b) is the part that must be ported.

---

## 15. WebGPU compute analysis

**Investigated, and deliberately not recommended for the parity-first migration.**

### 15.1 The surprise: compute has a WebGL2 lowering

`WebGLBackend` implements `createComputePipeline` (`:35636`), `beginCompute`, `compute`,
`finishCompute` and `createStorageAttribute`, driving the work through `transformFeedbackVaryings`
(`:35673`) — 14 transform-feedback references in the bundle. So a TSL compute node is not
automatically a WebGPU-only feature in 0.171.0.

**This contradicts the common assumption** and it changes the shape of the compute question: compute
does not automatically break the fallback requirement. What is **UNVERIFIED** is whether the
transform-feedback path is *fast enough* to be worth having, and what its numeric behaviour is.

### 15.2 The candidates, evaluated against parity-first

| Candidate | What compute would buy | What the WebGL2 path would do | Recommendation |
| --- | --- | --- | --- |
| Fish simulation (32 species, per-instance CPU updates) | Move per-instance position/orientation to the GPU | transform-feedback emulation, or keep the CPU path | **Avoid in phase one.** The behaviour is seeded and unit-tested; moving it to the GPU risks the determinism §3 depends on |
| Creature movement | same | same | **Avoid** — same reason |
| Particle systems (motes, bubbles, weather) | GPU-side integration | emulation or CPU | **Defer.** Real upside, no parity requirement broken, but not phase one |
| Culling | GPU frustum/occlusion culling | CPU | **Avoid** — the ocean explicitly disables frustum culling today; changing that changes behaviour |
| LOD | GPU selection | CPU | **Avoid** — no `THREE.LOD` in use |
| Ocean simulation | FFT ocean instead of analytic Gerstner | no equivalent | **Avoid.** This is a redesign, and §30 of the brief forbids it |
| Procedural generation | GPU noise instead of 2D-canvas bakes | CPU bakes | **Defer.** The bakes are one-time and measured; see §24 |

**Nothing here is mandatory, and the brief is right that it should not be.** The primary objective is
behavioural equivalence, and every compute candidate above trades determinism or behaviour for speed
the app has not been shown to need.

---

## 16. WebGPU/WebGL interoperability analysis

The question: is a "WebGPU compute feeding a WebGL renderer" hybrid possible and efficient?

**The honest answer for this study: the question does not arise, and that is the useful finding.**

Because `WebGPURenderer` carries *both* backends inside one renderer (§6.2), there is never a
configuration in which WebGPU-computed resources need to cross into a `WebGLRenderer`. Either the
WebGPU backend is active and its own compute path is used, or the WebGL backend is active and the
transform-feedback path is used (§15.1). Both are inside one object, sharing one node graph. **No
cross-API resource sharing is required by any architecture this report recommends.**

That matters because it removes what would otherwise be the plan's most fragile element. Architecture
C (§17) is the only shape that would need it, and this is a reason to reject C rather than a problem
to solve.

**UNVERIFIED, and flagged as such:** the general browser-level question — whether a WebGPU buffer or
texture can be consumed by a WebGL2 context today, the status of any interop proposal in the gpuweb
repository, and the frame-latency cost of a `mapAsync` readback. The agent assigned to this was killed
before reporting, and this report does **not** assert an answer. It only asserts that the recommended
architecture does not depend on one. If a future design does depend on it, that research must be done
first.

---

## 17. WebGPU-first architecture options

### Architecture A — one `WebGPURenderer`, its own automatic fallback

```text
Application → R3F → WebGPURenderer ──┬── WebGPUBackend  (WebGPU available)
                                      └── WebGLBackend   (init rejected)
```

One renderer, one node graph, one shader source. Selection is automatic on `backend.init()` rejection
(§6.2), which correctly covers async adapter failure.

### Architecture B — choose the renderer at runtime

```text
Application → async pre-flight → WebGPURenderer   (gates pass)
                               → WebGLRenderer    (gates fail)
```

Two renderers. The WebGL path could keep `postprocessing@6.39.4` and the existing GLSL shaders
untouched — which sounds attractive and is the trap: it means **two shader implementations and two
post-processing implementations maintained forever**, diverging silently.

### Architecture C — shared app abstraction, two renderer implementations

A renderer-agnostic scene description with separate WebGPU and WebGL implementations behind it. This
is the only shape that would need WebGPU→WebGL resource interop (§16), and it doubles the surface that
§23's harness must cover.

### Architecture D — A, but reached in stages (the one this report recommends)

Architecture A as the destination, reached by first upgrading three.js and replacing the post chain
**on the existing `WebGLRenderer`**, so that each step is independently verifiable and the app is
shippable throughout.

### Comparison

| Criterion | A | B | C | **D** |
| --- | --- | --- | --- | --- |
| Behavioural parity | High — one graph, one source | **Low** — two implementations drift | Medium | **High** |
| Implementation complexity | Medium | High | Very high | Medium, spread over phases |
| Maintenance | One shader dialect | **Two, forever** | Two + an abstraction | One |
| Shader portability | One TSL source | Two sources | Two sources | One TSL source |
| Post-processing portability | One node pipeline | Two pipelines | Two | One |
| Fallback reliability | **Automatic, correct trigger** (§6.2) | Manual pre-flight, easy to get wrong | Manual | Automatic |
| Performance | WebGPU native; WebGL backend unmeasured | WebGL path is today's known-good | Best possible per backend | Same as A |
| Browser compatibility | Full — fallback covers everything | Full | Full | Full |
| Future maintainability | **Best** — the path three.js is investing in | Worst | Poor | Best |
| Ships incrementally | No — one big change | Partly | No | **Yes** |

**Recommendation: Architecture D, converging on A.** Rejecting B is the substantive call, and the
reason is §19: with ~20% of users on WebGL2, B's "two implementations" is not a temporary state — it is
permanent, and the drift would be invisible because nothing in CI can see the canvas.

**What would change the recommendation:** if the WebGL2 backend turns out to be visually or
performance-unacceptable for this content (§28.3 item 1), then B becomes the only honest option, with
its maintenance cost accepted explicitly. **That is why Phase 1 exists and why it gates everything.**

---

## 18. WebGL2 fallback strategy

### 18.1 The rule

**The application must never fail because WebGPU is unavailable.** Under Architecture A/D this is
mostly structural: `getFallback` is installed by the constructor and fires on init rejection, so the
default path already degrades. But structural is not sufficient — three things must be added.

### 18.2 The detection sequence, in the order the gates actually fail

Derived from MDN's own reference code
(<https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/lost>, fetched 2026-09-09):

1. **Secure context.** Otherwise `navigator.gpu` is `undefined`. Synchronous.
2. **`navigator.gpu` present.** Build-level. Synchronous. **Proves nothing about hardware.**
3. **`await navigator.gpu.requestAdapter()` → not `null`.** Per-machine, per-driver, per-blocklist.
   **Asynchronous, and resolves `null` rather than throwing.**
4. **`await adapter.requestDevice(descriptor)`.** **Asynchronous, and can reject** even after the
   adapter succeeded — notably when `requiredLimits` cannot be met.
5. **`device.lost`** — a promise pending for the device's lifetime, for the whole session.

`WebGPURenderer`'s own fallback covers 1–4 automatically. **It does not cover 5.**

### 18.3 The three things that must be added

**(a) An async pre-flight before the canvas mounts, for the *quality tier*, not for renderer
selection.** `useDeviceQualityTier` decides shadows and the post profile before mount, from a WebGL
probe (§5.2a). It needs a `navigator.gpu.requestAdapter()` + `adapter.info` twin, and must also reject
a software adapter — otherwise a machine with a software WebGPU device gets the top tier.

**(b) A `GPUDevice.lost` handler, because this is a failure mode WebGL2 does not have.** MDN,
verbatim: *"Many causes for lost devices are transient, so you should try getting a new device once a
previous one has been lost… Note that any WebGPU resources created with a previous device (buffers,
textures, etc.) will need to be re-created with the new one."* For this app that means the forest's
`InstancedMesh` buffers, every `CanvasTexture` and `DataTexture` upload, GLTF geometry, and the whole
post chain.

**The cheapest correct answer is to reuse machinery the app already has:** treat device loss the way
`WebGLFailureBoundary` treats context loss, and **remount the canvas onto the WebGL2 path**. The app
already remounts the canvas per world via `canvasRemountKey` (`UniverseCanvas.tsx:455`) and already has
a boundary that renders a stated failure. Rebuilding every resource on a fresh device is the
alternative and it is far more work for a rarer event.

**(c) A deliberate decision about `preserveDrawingBuffer`**, since image export and the transition
stills depend on buffer-after-present semantics (§10.3).

### 18.4 What the fallback is NOT

It is not a compatibility stub. At ~20% of real users (§19.5) it is a **second production renderer**,
held to the same 60 fps floor from
[`../rules/`](../rules/) and the same reference screenshots. Any statement that the WebGL2 path is "just
the fallback" is a planning error.

---

## 19. Browser compatibility

This is the one external topic whose research completed in full, and it is the most rigorous section
in the report. All figures as of **2026-09-09**.

### 19.1 Per-platform availability

| Platform | WebGPU default? | Since | Caveat |
| --- | --- | --- | --- |
| Chrome/Edge — Windows | Yes | 113 | — |
| Chrome/Edge — macOS | Yes | 113 | — |
| Chrome/Edge — ChromeOS | Yes | 113 | — |
| Chrome/Edge — Windows ARM64 | **No** | — | flag only: `--enable-unsafe-webgpu` |
| Chrome/Edge — Linux, Intel Gen12+ | Yes | 144 | — |
| Chrome/Edge — Linux, NVIDIA + Wayland | Yes | 147 | driver ≥ 535.183.01 |
| Chrome/Edge — Linux, **AMD** | **No** | — | "tentative plan" only |
| Chrome — Android ARM/Qualcomm/Intel | Yes | 121 | Android 12+; some Adreno IDs blocklisted |
| Chrome — Android Imagination | Yes | 139 | Android 16+; PowerVR driver 25.1 blocklisted |
| Chrome — Android Samsung Xclipse | **No** | — | in progress, "probably 154" |
| Safari — macOS | Yes | 26 | **LIKELY macOS 26 Tahoe+ only** |
| Safari — iOS / iPadOS / visionOS | Yes | 26 | cleanest story of any platform |
| Firefox — Windows | Yes | 141 | no service workers |
| Firefox — macOS Apple silicon | Yes | 145 / 147 | 145 on macOS 26, 147 on older |
| Firefox — macOS **Intel** | **No** | — | Nightly only |
| Firefox — **Linux** | **No** | — | Nightly only; "expects Linux shipping in 2026" |
| Firefox — **Android** | **No** | — | behind flag; "work expected in 2026" |
| Samsung Internet | Yes | 24 | BCD `"mirror"` — inherited, not measured |
| Android WebView | **UNVERIFIED** | — | caniwebview: "support unknown" (2026-09-05) |
| iOS WKWebView | **UNVERIFIED** | — | "support unknown"; LIKELY yes on iOS 26+ |

### 19.2 Detection is four async gates, not one check

See §18.2. The critical facts: `navigator.gpu` existing proves nothing; `requestAdapter()` **resolves
`null` rather than throwing**; `requestDevice()` is a separate async step that can fail afterwards.
Chrome documents six distinct causes of a null adapter.

### 19.3 Secure context is the only true hard blocker in this report

Over plain HTTP on a non-localhost host, `navigator.gpu` is simply `undefined`
(<https://developer.mozilla.org/en-US/docs/Web/API/Navigator/gpu>). In production this is satisfied
trivially — the app is HTTPS. **The danger is in testing:** if the Playwright harness ever serves over
`http://` on a non-localhost host, every "WebGPU" screenshot is silently a WebGL2 screenshot and
parity passes for the wrong reason. Worth an assertion in the harness itself.

### 19.4 Device limits, and compatibility mode

WebGPU compatibility mode (`featureLevel: 'compatibility'`) shipped in Chrome 146, targeting OpenGL
ES 3.1. **It is a reach lever, not a free win:** its `maxTextureDimension2D` clamp of 4096 is
unusable at this app's `dpr [1,3]` on anything above a ~1366 px-wide viewport. Do not use it in
phase one.

### 19.5 The share estimate — and why it should be replaced by a measurement

caniuse reports ~84% full support and ~3% partial (~87%). The evidence file's own defensible planning
range is **~80% with `navigator.gpu` present and ~75–85% acquiring a hardware device — i.e. roughly
20% on WebGL2, plausibly more.**

Two reasons the real number is likely *worse* for this app:

- caniuse weights **global** traffic. This app's audience is Vietnam-skewed.
- **In-app browsers are WebView-backed and unverified.** Facebook, Instagram, TikTok and Zalo
  in-app browsers must be assumed WebGL2 until measured — and that is exactly the audience arriving
  from a **shared universe link**, which makes the fallback load-bearing for the app's most viral
  traffic path.

**One analytics field on the envelope that already exists would replace this estimate with a
measurement**, and it should be added before any migration decision is finalised. The app already
reports client render outcomes (`shared/reportClientRender.ts`).

### 19.6 Automated testing — the finding that changes the plan

The project's rule is real-GPU headless Chromium, never SwiftShader. But:

- `playwright.config.ts:52-60` currently launches with
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, and the config documents that
  the flag is **required** — without it Chrome renders nothing and every shot comes out pure black
  while the suite still passes.
- **SwiftShader is a GL rasteriser. It has no WebGPU.** So the existing harness *cannot reach the
  WebGPU path at all*.
- Chrome's own published headless-WebGPU flag set (`--headless=new --no-sandbox --use-angle=vulkan
  --enable-features=Vulkan --disable-vulkan-surface --enable-unsafe-webgpu`, from a **2024-01-16**
  article) is dated and Linux-oriented, and the article is unambiguous that **a real GPU is
  necessary**.
- **UNVERIFIED:** whether Playwright's default Chromium on this project's Windows/RTX 4060 target
  exposes a hardware WebGPU adapter. This is Phase 0.

---

## 20. Previous research vs current reality

An audit, not a summary. Sources:
[`../evolution/platform-evolution-research.md`](../evolution/platform-evolution-research.md) §Track D
and [`../evolution/frontend-modernization-research.md`](../evolution/frontend-modernization-research.md).

Track D already carries a supersession header written 2026-08-12 that corrects three of its own facts.
Per [`../../CLAUDE.md`](../../CLAUDE.md)'s instruction to read corrections first, that header was read
first and its corrections are treated as the document's real position.

| # | Old conclusion | Old reasoning | Current evidence | Status |
| --- | --- | --- | --- | --- |
| 1 | *"`onBeforeCompile` … **is a hard blocker for WebGPU**, not merely work."* (`frontend-modernization-research.md:508`) | `onBeforeCompile` is a `WebGLRenderer` mechanism; the equivalent is a TSL node graph, *"which is a rewrite of the technique rather than a translation"* | The reasoning is right and the label is wrong — **by the document's own words.** A rewrite is `MIGRATION_WORK`. And the rewrite target is unusually clean: all nine patches use only four injection points, which map 1:1 onto `positionNode`/`colorNode`/`outputNode` (§7.3), and `oceanCaustics.ts:206-209` states the patches exist to keep three's lighting/fog/tone mapping — exactly what a slot override preserves | **OUTDATED BLOCKER** (mislabelled, not mistaken) |
| 2 | *"`three@0.171.0` declares `exports` of `./webgpu` and `./tsl`, exactly as 0.185.1 does."* (`:586-588`) | Read from the package manifest | **Verified true.** And more: the bundle contains `WebGPURenderer`, `WebGPUBackend`, `WebGLBackend`, `PostProcessing`, `PassNode`, `wgslFn`, `glslFn`, 29 TSL display addons and a GLSL→TSL transpiler | **SOLVED — and it was right.** An earlier draft of that document nearly "corrected" this into an error; it was right to resist |
| 3 | *"What remains unestablished is … whether it is production-ready and whether its WebGL2 fallback is complete."* (`:588-590`) | Correctly framed as open | **PARTIALLY SOLVED.** The fallback's *existence and trigger* are now proven verbatim (§6.2), and the WebGL backend is substantive — it even implements compute via transform feedback (§6.3, §15.1). Its **visual** completeness for this content is still open | **PARTIALLY SOLVED** |
| 4 | *"Zero end-to-end or visual tests. Verified: no Playwright anywhere in the repository."* (`:603-604`) | Verified at the time | **OUTDATED — closed by later work.** A Playwright suite now exists with 25 reference files and 95 shots, and `playwright.config.ts` **cites that very document section as its reason for existing**. The blind spot was real and has been acted on | **SOLVED** |
| 5 | *"three.js **r171** (September 2025) ships `WebGPURenderer` as production-ready"* (Track D `:759`) | — | **Half right, and the date was already corrected** by the newer document to 2024-11-29. The renderer ships; *"production-ready"* is the document's own word and is **not** supported by any source this study fetched | **UNKNOWN** — nobody has established production-readiness for this content |
| 6 | *"automatic WebGL 2 fallback"* (Track D `:760-761`) | — | **Verified verbatim** (§6.2) | **SOLVED** |
| 7 | *"**TSL** compiles one shader source to both WGSL and GLSL … raw GLSL is now the legacy path."* (Track D `:762-764`) | — | Directionally right, dangerously compressed. TSL does target both, **but** (a) the app's shaders rely on `#include <chunk>` composition that has no node analogue, (b) no authoritative WebGPU-only node list was obtainable, and (c) the TSL surface saw **~15 renames or removals across r171→r186** (§4.1) | **PARTIALLY SOLVED** |
| 8 | *"Browser support: Chrome 113+, Firefox 141+, Safari 26."* (Track D `:765`) | — | Already corrected once (Firefox not shipped by default through 156). Now materially incomplete: **Firefox has no Linux, no Intel-macOS and no Android support at all**; **AMD on desktop Linux has no shipped WebGPU in any browser**; desktop Safari 26 is likely macOS-26-gated; **WebViews are unverified** | **STILL BLOCKED** (as a *planning* fact — ~20% on WebGL2) |
| 9 | *"`@react-three/fiber` … WebGPU support is in v9"* (Track D `:777`) | Version-table reasoning | **Verified, and stronger than claimed** — 9.7.0 `await`s the `gl` factory (§6.5), so the async pattern needs no upgrade | **SOLVED** |
| 10 | *"`three` … unchanged — already sufficient"* (Track D `:780`) | — | **True for a proof-of-concept, false for the migration.** §4.1: the node/TSL API moved ~once per release across fifteen releases, and `PostProcessing` itself was renamed to `RenderPipeline` at r183 | **PARTIALLY SOLVED** |
| 11 | *"track D is not blocked by anything WebGPU-specific … blocked by an upgrade already required to close three high-severity advisories."* (`:782-784`) | Dependency-chain reasoning | The security half is done (Next 15.5.23 is installed). But the real gate was never React or Next — it is **`postprocessing@6.39.4`**, which cannot cross to the node pipeline at all (§11.2) and whose peer range `< 0.186.0` also gates the three.js upgrade (§4.3). **Neither document identified this** | **STILL BLOCKED — and by something neither document named** |
| 12 | *"low return today, do it last, behind a flag"* (Track D verdict) | — | **Survives this study intact**, for better reasons than it had. It is now blocked on an upgrade + a post-chain rebuild + a parity harness, and gains ~20% of users nothing | **STILL VALID** |

### 20.1 The one thing both documents missed

Neither identified `postprocessing@6.39.4` as the binding constraint. Both treated the post chain as
*"a version-pin decision, not a code edit"*
(`frontend-modernization-research.md:470`). It is neither — it is a **library replacement**, it is the
single largest piece of migration work in this study, and its peer range dictates the order of every
other step (§4.3).

---

## 21. Migration matrix

| Subsystem | Current implementation | WebGPU target | WebGL2 fallback | TSL possible? | Effort | Risk | Visual parity | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Renderer construction | R3F builds `WebGLRenderer` from a `gl` config object | `gl` async factory → `WebGPURenderer` + `await init()` | same object, `WebGLBackend` | n/a | LOW | LOW | IDENTICAL | **Do — and set `toneMapping` inside the factory** (§6.5) |
| Backend selection | n/a | automatic via `getFallback` | automatic | n/a | TRIVIAL | LOW | IDENTICAL | **Do** — do not hand-roll |
| Device quality tier | throwaway WebGL context + `WEBGL_debug_renderer_info` | `requestAdapter()` + `adapter.info`, reject software | keep WebGL probe | n/a | MEDIUM | MEDIUM | IDENTICAL | **Do** — runs before mount |
| Failure boundary | `webglcontextlost` on window, capture | `GPUDevice.lost` → remount on WebGL2 | existing path | n/a | MEDIUM | **HIGH** | IDENTICAL | **Do** — new failure mode (§18.3b) |
| Canvas lifecycle | full remount per world via `key` | same, but `init()` is async | same | n/a | MEDIUM | MEDIUM | IDENTICAL | Verify interaction with StrictMode |
| Adaptive DPR | `setDpr`, reallocates targets | same | same | n/a | LOW | **PERFORMANCE_RISK** | IDENTICAL | Measure pipeline recreation cost |
| Tone mapping | `AgX` / `ACESFilmic` via `gl` prop | `ToneMappingNode` — both registered | same | n/a | LOW | LOW | **CHANGES** (§11.4) | Fix the passthrough bug **first** |
| Shadows | `PCFSoftShadowMap`, forest + ocean | **`PCFShadowMap`** — soft removed at r186 | `PCFShadowMap` | n/a | LOW | VISUAL_PARITY_RISK | TUNABLE | **Do** — deprecated on both paths |
| 9 raw GLSL shaders | `ShaderMaterial` + GLSL | node materials + TSL graphs | same graphs | **YES** | **HIGH** | MEDIUM | PERCEPTUALLY_EQUAL | **Do** — transpiler assists bodies |
| Shared GLSL library | `oceanSky.ts` string builders | TSL functions | same | **YES** | MEDIUM | MEDIUM | PERCEPTUALLY_EQUAL | **Do first** — serves 3 shaders |
| 9 `onBeforeCompile` patches | chunk string replacement | `positionNode`/`colorNode`/`outputNode` | same | **YES** | MEDIUM | MEDIUM | PERCEPTUALLY_EQUAL | **Do** — 4 slots, uniform pattern |
| `#include <chunk>` (20 sites) | `WebGLProgram.resolveIncludes` | `RenderOutputNode`/`ColorSpaceNode` | same | n/a | LOW | LOW | IDENTICAL | Disappears with the patches |
| Point/sprite shaders (4) | `gl_PointSize`, `gl_PointCoord` | `PointsNodeMaterial.sizeNode`, `pointUV` | same | **YES** | MEDIUM | LOW | PERCEPTUALLY_EQUAL | **Do** |
| Star colour-management bypass | raw `ShaderMaterial` writes unconverted sRGB | must be reproduced deliberately | same | YES | LOW | **VISUAL_PARITY_RISK** | TUNABLE | **Do carefully** — authored palette depends on it |
| 108 native material sites | `Mesh*Material` | `Mesh*NodeMaterial` | same | n/a | LOW | LOW | **CHANGES at r181** | **Do** — upgrade cost, not backend |
| **Post-processing chain** | `postprocessing@6.39.4` — 878 WebGL refs, 0 WebGPU | `RenderPipeline` + `PassNode` + TSL | same nodes | **YES** | **VERY_HIGH** | **CRITICAL** | **TUNABLE** | **ARCHITECTURAL_CHANGE — replace** |
| N8AO | pmndrs, `halfRes` | `GTAONode` | same | yes | MEDIUM | **HIGH** | **DIVERGENT → TUNABLE** | Retune `radius`/`scale` per r185 |
| Bloom | pmndrs `mipmapBlur` | `BloomNode` | same | yes | LOW | MEDIUM | TUNABLE | **Do** |
| Hue/Saturation | pmndrs | core `hue()`/`saturation()` | same | yes | TRIVIAL | LOW | IDENTICAL | **Do** |
| Brightness/Contrast, Vignette | pmndrs | hand-written TSL, ~5 lines each | same | yes | TRIVIAL | LOW | IDENTICAL | **Do** |
| Chromatic aberration, film grain | pmndrs | hand-written TSL | same | yes | LOW | LOW | PERCEPTUALLY_EQUAL | **Do** |
| Render targets / MRT / depth | **app creates none** | none needed | none | n/a | NONE | LOW | IDENTICAL | **Nothing to do** |
| `CanvasTexture` bakes (8) | 2D canvas | unchanged | unchanged | n/a | TRIVIAL | VISUAL_PARITY_RISK | IDENTICAL | Verify colour-space tagging |
| `DataTexture` (1) | typed array | unchanged | unchanged | n/a | TRIVIAL | LOW | IDENTICAL | — |
| `InstancedMesh` (forest + ocean) | `buildStaticInstancedMeshes`, per-frame `instanceMatrix` | `InstanceNode` | same | n/a | LOW | PERFORMANCE_RISK | IDENTICAL | Measure per-frame upload |
| Skeletal animation (GLTF) | drei `useAnimations` → `AnimationMixer` | unchanged; `SkinningNode` exists | unchanged | n/a | LOW | MEDIUM | IDENTICAL | **UNVERIFIED** — test skinning |
| Creature behaviour, spawn, LOD, culling | seeded CPU, unit-tested | **unchanged** | unchanged | n/a | NONE | LOW | **IDENTICAL** | **Nothing to do** |
| Ocean optics / depth curve / sea state | pure TypeScript | **unchanged** | unchanged | n/a | NONE | LOW | **IDENTICAL** | **Nothing to do** |
| Scene generation, camera, audio, state, routing | pure TypeScript, ~20 test files | **unchanged** | unchanged | n/a | NONE | LOW | **IDENTICAL** | **Nothing to do** |
| drei `Environment` / `Lightformer` | PMREM | `PMREMNode` exists | same | n/a | LOW | **HIGH** | UNKNOWN | **UNVERIFIED — test early** |
| drei `useGLTF`/`useTexture`/`OrbitControls`/`Html`/`Clone` | — | expected unchanged | unchanged | n/a | LOW | LOW | IDENTICAL | Verify |
| DRACO/KTX2 decoders | self-hosted, CSP-driven | unchanged | unchanged | n/a | TRIVIAL | LOW | IDENTICAL | — |
| Image export | `toDataURL` + `preserveDrawingBuffer` | no direct analogue | existing | n/a | MEDIUM | VISUAL_PARITY_RISK | UNKNOWN | Test |
| Transition stills | `drawImage` + centre-pixel guard | same, already fails safe | existing | n/a | LOW | LOW | IDENTICAL | Lucky — keep the guard |
| Visual parity harness | Playwright, SwiftShader, **no assertions** | must reach WebGPU + pin phase + add a metric | same | n/a | **HIGH** | **CRITICAL** | n/a | **Phase 0 — gates everything** |
| GPU compute | none | available; also lowers to transform feedback | emulated | yes | — | — | — | **Defer — not phase one** (§15) |

---

## 22. Risk matrix

### HARD BLOCKER — technically impossible or unsupported today

**One, and it is trivially satisfied in production:** WebGPU requires a **secure context**; over plain
HTTP on a non-localhost host `navigator.gpu` is `undefined`. The app is HTTPS. **The real exposure is
the test harness** (§19.3): served over `http://` on a LAN IP, every "WebGPU" screenshot is silently
WebGL2.

**Nothing else in this study qualifies.** Every other candidate — `onBeforeCompile`, `gl_PointSize`,
soft shadows, the post chain, PMREM — resolved to work, and three of them were labelled blockers by
someone (including me) and then refuted by source.

### ARCHITECTURAL CHANGE

- **Post-processing chain replacement** (§11.2) — the largest single item.
- **Async pre-flight ahead of canvas mount** for the quality tier; R3F cannot un-pick a renderer
  after mount.
- **Device-loss recovery** (§18.3b) — a new failure mode.

### MIGRATION WORK

9 raw GLSL shaders + the shared library · 9 `onBeforeCompile` patches · 108 native material renames ·
20 `#include` sites · device tier probe · failure boundary · 4 point/sprite shaders · the parity
harness.

### FEATURE GAP

- **Firefox** on Linux, Intel macOS and **all** Android: permanently WebGL2.
- **AMD on desktop Linux:** no shipped WebGPU in any browser.
- **Compatibility mode** unusable at this app's DPR (4096 texture clamp).
- **WebViews** unverified — the shared-link audience.

### PERFORMANCE RISK

- **Pipeline-creation latency on first mount.** The app measures a ~2.5 s first-mount shader stall
  under WebGL and has proven `KHR_parallel_shader_compile` does nothing on its ANGLE/D3D11 target.
  Whether WebGPU's pipeline creation is genuinely async there is **the largest unknown in this
  report**.
- **Adaptive DPR** reallocating buffers, now also recreating pipelines.
- **The WebGL2 backend's own performance** versus plain `WebGLRenderer` — unmeasured.
- Per-frame `instanceMatrix` upload for the forest's grass and the ocean's schools.

### VISUAL PARITY RISK

- **N8AO → GTAO** — different algorithm, forest family.
- **`PCFSoftShadowMap` → `PCFShadowMap`** — forest and ocean.
- **r181 PBR/PMREM appearance change** — 56 material sites, both backends equally.
- **Tone-curve fix** (§11.4) — several ocean constants were tuned against the broken behaviour.
- **Star colour-management bypass** — the authored hex palette depends on it.
- **r178 / r185 premultiplied-alpha changes** — five additive layers plus a darkening blend.
- **Transparency sort order** — the ocean stacks many `depthWrite:false` layers.
- **Canvas readback** for export and transitions.

---

## 23. Visual parity strategy

### 23.1 What already exists, measured honestly

`playwright.config.ts` + `e2e/` give: 7 pinned scene fixtures spliced from the family services' own
golden configs (`scene-baseline.spec.ts:14-58`, including five ocean depths chosen to differ from one
another), fixed viewports (1440×900 and 375×812), `--force-device-scale-factor=1`, single worker, no
retries, a production build rather than `next dev`, and 25 reference files.

What it does **not** give, in its own words:

- **No pixel assertions.** *"These are a before/after instrument for a human … compared BY EYE"*, and
  *"a pixel assertion would be worse than nothing here"* because WebGL output differs across GPUs.
- **No pinned animation phase** — `scene-baseline.spec.ts:72-79`: freezing three.js's clock from
  outside without touching React's scheduler is *"not reliably possible"*.
- **No WebGPU reachability** — SwiftShader is a GL rasteriser (§19.6).
- Not run by `npm test`, not run in CI.

### 23.2 The three things that must be added

**(a) A backend that can actually be WebGPU.** Phase 0. Either Playwright's default Chromium exposes
a hardware adapter on the RTX 4060 target, or the harness needs a headed/GPU-enabled launch. Until
this is answered nothing else in §23 is buildable.

**(b) A pinned animation phase.** The existing suite's own reason for not pinning is real, but
`WebGPURenderer`/`Renderer` drives its own `Animation` object (`:28750`, constructed inside `init()`),
and the app already funnels time through uniforms (`uTime`, `uCreatureTime`, `uSwayTime`,
`uCausticTime`, `clock.elapsedTime` in `SizedStarPoints`). **The tractable approach is to inject a
fixed time rather than to freeze a clock**: a test-only scene parameter that sets every time uniform
to a constant. That is a small, honest change to app code and it makes pixel comparison possible for
the first time.

**(c) A comparison that runs three ways on one machine.** The key primitive is
`forceWebGL: true` (§6.2), which nobody has noticed:

```text
same fixture, same viewport, same DPR, same injected time
   ├── WebGLRenderer                       ← today's baseline
   ├── WebGPURenderer (WebGPU backend)     ← the new primary
   └── WebGPURenderer (forceWebGL: true)   ← the fallback, on the SAME machine
```

Three images, two diffs, one machine, one driver. That isolates *backend* difference from *machine*
difference — which is exactly the objection the current config raises against pixel assertions, and it
answers it.

**Metric:** a perceptual difference measure with a stated tolerance, not exact equality. The
comparisons that matter are (2) vs (1) for the migration and (3) vs (1) for the fallback; (2) vs (3)
proves the two backends agree with each other.

### 23.3 What to assert, and what to keep human

Assert mechanically: the canvas is not black (the failure the SwiftShader flag once hid); mean luma and
saturation stay within tolerance per fixture; the five ocean depths remain **distinguishable from each
other** — the family's whole axis, and a failure no single image can show.

Keep human: the look. A perceptual metric cannot tell you the sea stopped reading as water.

---

## 24. Performance analysis

### 24.1 The current cost, measured in-repo

`UniverseCanvas.tsx:398-450` is first-party measurement and the best performance evidence in the
project:

| Measurement | Value | Source |
| --- | --- | --- |
| Canvas remount — toggle one interest chip | **1108 ms** blocked | `:420` |
| Canvas remount — nickname field | **1575 ms** blocked | `:421` |
| Canvas remount — family switch to forest | **2108 ms** blocked | `:422` |
| …of which inside `texSubImage2D` | **1121 ms** (8K textures; 8192×4096 = 134 MB RGBA before mipmaps) | `:424-427` |
| …most of the rest | `getProgramParameter`, re-linking shader programs | `:427` |
| Persistent-canvas alternative, first switch | 2108 → **401 ms**, `texSubImage2D` gone from the profile | `:434-436` |
| …but **reverted**: leak over six family switches | geometries 58→323, textures 37→214, **programs 26→361** | `:441-443` |
| Chrome on-disk shader **binary** cache, second-ever compile | **~2.5 s → ~230 ms** | `:448-450` |
| `compileAsync` / `KHR_parallel_shader_compile` | **no effect** on this ANGLE/D3D11 target; completion query blocked the same ~2.5–3 s | `:95-118` |
| Forest at 2560×1440 HiDPI | **11 fps**, same draw calls and triangles as the 100 fps case at 1600×900 | `:127-133` |
| Composer multisampling from display vs renderer ratio | 37 vs **47 fps** at 4K | `PostEffects.tsx:110-118` |

**Read together: the measured bottlenecks are shader/pipeline compilation, texture upload, and fill
rate — in that order.**

### 24.2 What WebGPU plausibly addresses, and what it does not

| Bottleneck | Current cost | Would WebGPU help? |
| --- | --- | --- |
| Shader/pipeline compilation on first mount | ~2.5 s, `compileAsync` proven useless here | **Possibly — and this is the main performance case for the migration.** WebGPU pipeline creation is designed to be async and cacheable. **UNVERIFIED on this ANGLE/D3D11 target**, and this project has already been burned once by an extension that advertised non-blocking behaviour and blocked |
| Texture upload (1121 ms of a family switch) | 134 MB RGBA re-upload | **No.** Same bytes over the same bus. The fix is not re-uploading — an app-level change, backend-independent |
| Fill rate (11 fps at 4K) | resolution-bound | **No.** Same pixels, same shading work. Adaptive DPR remains the only lever |
| R3F dispose leak (programs 26→361) | why the persistent canvas was reverted | **No.** React IdlePriority scheduling — an R3F/app issue on both backends |
| Draw-call count | not the bottleneck (proven at `:130-132`) | Compute/indirect draw would help a problem this app does not have |
| Per-frame `instanceMatrix` upload | unmeasured | Possibly — but measure first |

**The honest performance position:** the migration's case is *not* "WebGPU is faster". Two of the
three measured bottlenecks are untouched by a backend change, and the third is unverified on this
project's exact target. The case for migrating is architectural — one shader source, the path three.js
is investing in — and it should be argued on those terms.

### 24.3 The risk the migration adds

Pipeline creation for a scene with many distinct materials could be *worse*, not better. The forest has
~59-part canopies collapsed into ~2 draw calls, the ocean has 32 species each with its own injected
material variant, and every one becomes a pipeline. Combined with adaptive DPR reallocating targets,
this needs measuring before it is believed.

---

## 25. Recommended target architecture

```text
                            MYUNIVOKAI
                                 │
                    Next.js 15 · React 19 · app router
                                 │
                    ┌────────────┴─────────────┐
                    │  async pre-flight        │   BEFORE the canvas mounts
                    │  1 secure context        │
                    │  2 navigator.gpu         │   → decides the QUALITY TIER
                    │  3 requestAdapter()      │     (shadows + post profile),
                    │  4 adapter.info          │      NOT the renderer
                    │    reject software       │
                    └────────────┬─────────────┘
                                 │
                    @react-three/fiber  <Canvas gl={async factory}>
                                 │
                       THREE.WebGPURenderer
                                 │
                   ┌─────────────┴──────────────┐
                   │  automatic, on init reject │
                   ▼                            ▼
            WebGPUBackend                 WebGLBackend
            (~80% of users)               (~20% of users)
                   │                            │
                   └─────────────┬──────────────┘
                                 │
                     ONE node graph · ONE TSL source
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
   solar-system              forest                    ocean
        │                        │                        │
        └────────────────────────┼────────────────────────┘
                                 │
              Mesh*NodeMaterial + positionNode / colorNode / outputNode
                                 │
                    RenderPipeline (three.js native)
              GTAO → Bloom → hue/saturation → brightness/contrast
                   → chromatic aberration → vignette → grain
                                 │
                              Canvas
                                 │
                    GPUDevice.lost ──→ remount onto WebGL2
                                       (reuses canvasRemountKey +
                                        WebGLFailureBoundary)
```

**WebGPU path**

```text
Application → R3F → Three.js → WebGPURenderer → WebGPUBackend → WebGPU
```

**Fallback path**

```text
Application → R3F → Three.js → WebGPURenderer → WebGLBackend → WebGL2
```

One renderer object. One node graph. One shader source. Two backends. The application above the
renderer does not know which one it got — which is the requirement, stated as an architecture.

---

## 26. Migration plan

Phases adapted to this repository, one branch per phase with many commits, per
[`../rules/git-convention.md`](../rules/git-convention.md) and the project's phase-branching
convention. **Every phase ships and is independently revertable.**

### Phase 0 — Can we even see it? (gates everything)

- **Objective:** determine whether this project's headless Chromium exposes a **hardware** WebGPU
  adapter on the RTX 4060 target.
- **Files:** `e2e/` only — a throwaway spec that logs `navigator.gpu`, `requestAdapter()`,
  `adapter.info`, and asserts the origin is a secure context.
- **Dependencies:** none.
- **Risk:** none. **Cost:** hours.
- **Validation:** a hardware adapter string that is not SwiftShader.
- **Rollback:** delete the spec.
- **If it fails:** stop. Everything downstream is unprovable, and §28.4 becomes the whole
  recommendation.

### Phase 1 — Proof of concept on the installed version (no upgrade)

- **Objective:** answer the six UNVERIFIED items in §28.3 on `three@0.171.0`, which already has
  everything needed.
- **Files:** a scratch route, not production code. `demos/` per
  [`../rules/demos-and-artifacts.md`](../rules/demos-and-artifacts.md).
- **What to exercise, in this order:** the async `gl` factory; `<Environment>`/`Lightformer` under the
  node path; `scene.fog`; the custom backdrop dome; one `onBeforeCompile` patch ported to a
  `colorNode`; one point shader ported to `sizeNode` + `pointUV`; `forceWebGL: true`; first-mount
  pipeline latency measured with a long-task observer.
- **Validation:** each either works or produces a named error.
- **Rollback:** the branch is never merged to `staging`.

### Phase 2 — Fix the tone curve on the existing renderer

- **Objective:** make the baseline honest before anything is compared against it. §11.4 — the ocean's
  tone curve has been a passthrough for its whole life and several shader constants were tuned against
  that.
- **Files:** `shared/PostEffects.tsx`, `UniverseCanvas.tsx`, the ocean shaders' compensating clamps.
- **Risk:** **this changes the ocean's look**, deliberately, on the current renderer.
- **Validation:** the 5 ocean reference shots, re-baselined and reviewed by the owner.
- **Rollback:** single revert.

### Phase 3 — three.js 0.171.0 → 0.185.x, WebGL path only

- **Objective:** get onto a current-ish API with the existing post chain intact — the peer range
  `< 0.186.0` permits exactly this (§4.3).
- **Files:** `package.json`, lockfile, plus the r181/r182/r183/r184/r178 fallout in §4.2.
- **Risk:** **HIGH and silent.** r181 changes PBR appearance across 56 material sites;
  `forestModels.ts`'s chunk replacement can fail silently on a chunk rename.
- **Cheap defence, worth more than its size:** make `forestModels.ts`'s and every other patch's
  `.replace()` **assert that it matched**. Three lines each; converts a silent visual regression into
  a loud console error.
- **Validation:** all 25 reference shots, by eye, plus `typecheck`/`lint`/`test`/`build`.
- **Rollback:** single revert of the version bump.

### Phase 4 — Build the parity harness

- **Objective:** injected fixed time, a perceptual metric with a stated tolerance, and the
  three-way render of §23.2.
- **Files:** `e2e/`, `playwright.config.ts`, plus a test-only time parameter in scene config.
- **Dependencies:** Phase 0, Phase 3.
- **Validation:** the harness reproduces today's WebGL output against itself within tolerance — i.e.
  it is stable before it is trusted.
- **Rollback:** harness only; no production behaviour.

### Phase 5 — Replace the post-processing chain, still on WebGL

- **Objective:** move off `postprocessing@6.39.4` to three.js's `RenderPipeline` + TSL **on the
  existing renderer**, so the chain change is isolated from the backend change.
- **Files:** `shared/PostEffects.tsx`, `shared/renderQuality.ts`, `package.json`.
- **Risk:** **CRITICAL** — the N8AO→GTAO retune is a real look change.
- **Validation:** Phase 4's harness; forest AO reviewed by the owner.
- **Rollback:** revert; the old chain still works at 0.185.x.

### Phase 6 — Shared GLSL library → TSL

- **Objective:** port `oceanSky.ts` (Preetham, Gerstner) once, serving three shaders.
- **Validation:** `oceanShaderSource.test.ts` adapted; ocean shots.

### Phase 7 — The nine `onBeforeCompile` patches → node slots

- **Objective:** four slots, uniform pattern (§7.3). Start with `oceanRigFlora.ts` (lowest
  complexity) and finish with `oceanCaustics.ts` (highest).
- **Validation:** per-patch shots; the caustics Jacobian is the one to watch.

### Phase 8 — The nine raw GLSL shaders → TSL

- **Objective:** the remaining six after Phase 6, plus the four point/sprite shaders.
- **Note:** the in-box transpiler (§8.3) assists the maths bodies; hand-finish naming per
  [`../rules/coding-style.md`](../rules/coding-style.md).
- **Validation:** shot per shader; the star colour-management bypass needs explicit attention.

### Phase 9 — Renderer swap, tier probe, device-loss path

- **Objective:** `WebGPURenderer` becomes the renderer. Add the `navigator.gpu` tier probe and the
  `GPUDevice.lost` → remount-on-WebGL2 path.
- **Validation:** three-way harness; forced device loss.

### Phase 10 — Fallback validation

- **Objective:** prove the `WebGLBackend` path against the `WebGLRenderer` baseline on one machine via
  `forceWebGL: true`. **This is the phase that can still invalidate Architecture A** and force B.

### Phase 11 — Performance

- **Objective:** first-mount pipeline latency, adaptive DPR interaction, per-frame instance upload.
  Measure against §24.1's numbers.

### Phase 12 — Rollout

- **Objective:** ship behind a flag; add the analytics field from §19.5 so the WebGPU/WebGL2 split
  becomes a measurement rather than an estimate.

### Phase 13 — Only now, optimisation

Compute, indirect draw, storage buffers, GPU simulation — §15, §30 of the brief. Not before parity.

---

## 27. Self-challenge / second-pass research

The adversarial and second-pass agent fleets were killed by the session limit, so this section is my
own second pass on my own conclusions. It is thinner than the brief asked for, and that is stated
rather than disguised.

### 27.1 Two of my own claims, refuted by source

**(a) "`gl_PointSize` has no WGSL equivalent, so the four point shaders are an ARCHITECTURAL_CHANGE."**

- *Initial conclusion:* WGSL has no settable point primitive size, so `SizedStarPoints`,
  `NebulaCloudPoints`, the marine motes and the drifters need instanced-quad rewrites.
- *Counterargument:* three.js would not ship `PointsNodeMaterial` if points were unexpressible.
- *New evidence:* `PointsNodeMaterial.sizeNode` (`:13275`, copied at `:13285`) and
  `PointUVNode`/`pointUV` are the direct equivalents of `gl_PointSize` and `gl_PointCoord`.
- *Revised conclusion:* **MIGRATION_WORK with a named target.** Downgraded.

**(b) "`PCFSoftShadowMap` may have no implementation under the node path."**

- *Initial conclusion:* `PCFSoftShadowMap` appears once in the webgpu bundle versus three times in the
  WebGL build, and `:21258` throws `'Shadow map type not supported yet.'`
- *Counterargument:* one occurrence may be a re-export, not an absence.
- *New evidence:* `:21099` — `const _shadowFilterLib = [ BasicShadowFilter, PCFShadowFilter,
  PCFSoftShadowFilter, VSMShadowFilter ]`, indexed by the type constant. All four standard types
  resolve; the throw is unreachable for them.
- *Revised conclusion:* **supported in 0.171.0.** But the second pass found something better: r186
  *removed* `PCFSoftShadowMap` for `WebGPURenderer` outright. So the item is real after all — for a
  different reason, at a different version, with a different fix (`PCFShadowMap`). **This is the single
  best argument in the report for not planning against 0.171.0.**

### 27.2 Challenging the verdict from both directions

**Too pessimistic?** The strongest case: everything needed ships in the installed version, R3F already
awaits the factory, the app creates no render targets, 108 of 126 material sites are a rename, the
entire ~2,900-line scene-maths layer is untouched, a transpiler ships in the box, and `forceWebGL`
hands us a parity harness primitive for free. A narrower reading could call this **moderate**.

*Why it is still major:* one library with 878 WebGL-class references must be replaced, and a
fifteen-release upgrade that changes PBR appearance is a prerequisite. Neither is optional and neither
is small.

**Too optimistic?** The strongest case, and it is strong:

- The report asserts TSL portability per shader from the *node inventory*, not from having ported one.
  No shader in this app has been ported. Every "TSL possible? YES" in §8 is a reasoned inference.
- **Pipeline-creation latency is unmeasured** on a target that has already defeated one
  async-compilation promise (`KHR_parallel_shader_compile`).
- **The WebGL2 backend's visual output is unverified** — and ~20% of users depend on it.
- **`<Environment>`/PMREM is unverified**, and both lit families depend on it entirely.
- Device loss is a **new** failure mode being accepted in exchange for architectural tidiness.

*This is why the confidence is 72% and not higher, and why Phases 0 and 1 exist before any production
line changes.*

### 27.3 What a full second pass would still have to do

The completeness critic's job, unrun: fetch the three.js documentation for an authoritative
GLSL-lowered vs WebGPU-only node list; gather field defect reports at production scale; verify
`glslFn` under the WebGPU backend; establish drei's WebGPU posture from its own repository; and
research the general WebGPU↔WebGL interop question that §16 declines to answer.

---

## 28. Final feasibility verdict

### 28.1 The verdict

> **FEASIBLE WITH MAJOR MIGRATION**

myunivokai can become a WebGPU-first Three.js application with WebGL2 as the compatibility fallback,
preserving its behaviour and — with named, tunable exceptions — its visual identity.

**Evidence for "feasible":** the dual-backend machinery, the automatic fallback with the correct async
trigger, both tone curves, all four shadow filters, `sizeNode`/`pointUV`, `glslFn`/`wgslFn`, the node
composer and a GLSL→TSL transpiler are **all present in the version already installed** (§6, §7, quoted
verbatim). R3F 9.7.0 already awaits an async renderer factory (§6.5). The app creates no render
targets, reads no pixels back, and holds only 18 shader-level items and 5 renderer-typed signatures
against ~2,900 lines of renderer-agnostic seeded maths with ~20 test files behind it (§3, §12, §13).
`WebGLRenderer` is not deprecated anywhere in r171–r186, so the fallback is not on borrowed time.

**Evidence for "major":** `postprocessing@6.39.4` has 878 references to WebGL-only classes and zero to
WebGPU — the chain is replaced, not ported (§11.2). A fifteen-release three.js upgrade is a
prerequisite, its r181 entry changes PBR appearance across 56 material sites on the *existing*
renderer, and a peer range dictates the order (§4). The TSL surface saw ~15 renames or removals across
that range. ~20% of users make the fallback a second production renderer (§19.5). And the parity
harness that would prove any of it cannot currently reach WebGPU at all (§19.6).

**Why not "FEASIBLE BUT WITH UNAVOIDABLE BEHAVIOR/VISUAL DIFFERENCES":** the differences found —
N8AO→GTAO, `PCFSoftShadowMap`→`PCFShadowMap`, r181 PBR, premultiplied alpha — are all *tunable toward
perceptual equivalence*, and the brief's bar is explicitly perceptual, not bit-identical. **If
bit-for-bit identity were required, the verdict would be that fifth category instead.**

### 28.2 Feasibility scores

| Dimension | Score | Technical explanation |
| --- | --- | --- |
| Renderer migration | **88** | R3F 9.7.0 awaits the `gl` factory (verbatim); `WebGPURenderer` + both backends ship in the installed version; both tone curves registered; app creates no renderer itself. Deductions: the async pre-flight must move ahead of mount, `canvasRemountKey` interacts with async `init()`, and the `gl`-object→factory change can silently drop `toneMapping` |
| Shader migration | **70** | Every construct in all 9 shaders has a named node target; 3 share one library; `glslFn`/`wgslFn` and an in-box transpiler exist; `oceanShaderSource.test.ts` already tests generated source. Deductions: the sea-top and god-ray bodies are large, 20 `#include` sites have no analogue, **and not one shader has actually been ported** |
| TSL portability | **65** | `hue`/`saturation` in core; 4 clean slots replacing 9 patches; compute even lowers to transform feedback. Deductions: no authoritative GLSL-lowered/WebGPU-only list was obtained; ~15 API renames in 15 releases; behavioural equality across backends unverified |
| Post-processing migration | **45** | The lowest score, and it sets the verdict. 878 WebGL-class references in the installed library; only 2 of 7 effects have a first-party node; GTAO ≠ N8AO numerically; `PostProcessing`→`RenderPipeline`; MSAA and HDR buffers become app-owned. Credit: 4 effects are ~5 lines of TSL each and it is one 169-line file |
| Ocean migration | **60** | Holds 4 of 9 shaders, 7 of 9 patches and the whole shared library, and the sea-top shader is the most intricate file in the layer. Credit: optics, depth curve, sea state and framing are pure TypeScript and untouched; the rig is one imperative surface, not a hundred props. Deduction: constants tuned against a tone curve that was silently disabled |
| Creature/animation compatibility | **90** | Spawn, despawn, movement, orientation, culling and LOD are seeded CPU code with two dedicated test files; `AnimationMixer` is renderer-agnostic; `SkinningNode`/`MorphNode` exist. One coupled item (the undulation patch). Deduction: skinning fidelity under the node path unverified, and I initially got the skinning question wrong |
| Render target compatibility | **92** | The app creates **zero** render targets, cube targets, MRT or depth textures and reads back no pixels. All textures are 2D-canvas bakes or one `DataTexture`. Deductions: colour-space tagging is applied at different points on the node path, and the composer's buffers become app-owned |
| WebGL2 fallback | **70** | Automatic, triggered on `init()` rejection — the correct trigger, covering async adapter failure; the backend is substantive, with a real transform-feedback compute path; `WebGLRenderer` not deprecated. **Deduction, and it is the report's largest: visual and performance equivalence for this content is entirely unverified**, while ~20% of users depend on it |
| Behavioural equivalence | **68** | The whole application layer above the renderer is untouched: scene generation, seeds, spawn, behaviour, camera, optics, audio, state, persistence, UI, API. Deductions: device loss is a **new** failure mode; `webglcontextlost` has no analogue; soft shadows change; AO changes; the tone-curve fix changes the ocean deliberately; readback semantics differ |
| **Overall** | **62** | No hard blockers, a clean target for every item, and most of the app free by construction — against one library replacement, a fifteen-release upgrade that moves the baseline, a harness that cannot yet see the new path, and ~20% of users on an unmeasured second renderer |

### 28.3 Still UNVERIFIED — and load-bearing

1. **Does the WebGL2 backend produce the same image as `WebGLRenderer`** for this content?
   *Settle it:* render the 7 fixtures three ways on one machine (§23.2).
2. **Do drei `<Environment>` and `<Lightformer>` work under the node path?** Both lit families depend
   on PMREM entirely. *Settle it:* mount the forest's `<Environment>` under a `WebGPURenderer`.
3. **WebGPU pipeline-creation latency on this ANGLE/D3D11 target** versus the measured ~2.5 s WebGL
   stall. The largest performance unknown. *Settle it:* long-task measurement of first mount, both
   backends.
4. **Field defect reports** for `WebGPURenderer` at production scale — none gathered.
5. **Does `glslFn` work under the WebGPU backend**, or only the WebGL one?
6. **Does Playwright's Chromium expose a hardware WebGPU adapter** on this project's target? Phase 0.

Also open, from the browser research: desktop Safari 26 on macOS Sequoia; Android/iOS WebView support;
and this app's own real WebGPU/WebGL2 split, which one analytics field would answer.

### 28.4 The smallest technically meaningful proof of concept

**Not a migration. A measurement, then one shader.**

**Step 1 (hours):** Phase 0 — can the harness see a hardware WebGPU adapter on the RTX 4060? If not,
stop and solve that first, because parity is otherwise unprovable and a migration without a parity
harness is a redesign wearing a migration's clothes.

**Step 2 (a day or two), on the installed `three@0.171.0`, in `demos/`:** one scratch route with
`<Canvas gl={async factory}>`, rendering the forest fixture, exercising in this order:

1. `<Environment>` under the node path — **the highest-risk unknown**, and it is one line to try;
2. `scene.fog` and the custom backdrop dome, against the bundle's three
   `'Unsupported … configuration'` errors (§6.6);
3. `forestModels.ts`'s leaf recolour as a `colorNode` — the patch a previous document called a hard
   blocker, so the cheapest way to settle §20 item 1 empirically;
4. `SizedStarPoints` on `PointsNodeMaterial` + `sizeNode` + `pointUV` — settles the point-size
   question and the colour-management bypass together;
5. `forceWebGL: true` on the same page — the fallback, on the same machine;
6. first-mount pipeline latency under a long-task observer, against §24.1's numbers.

Six answers, no production code touched, on the version already installed. Together they settle four of
the six UNVERIFIED items and either raise the confidence above 85% or kill Architecture A before a
single line of the ocean is rewritten.

---

## 29. References

### Primary — the installed source (strongest evidence in this report)

| Source | Version | What it proves | Effect on myunivokai |
| --- | --- | --- | --- |
| `node_modules/three/package.json` | 0.171.0 | `./webgpu` and `./tsl` exports | The WebGPU entry point is already installed |
| `node_modules/three/build/three.webgpu.js:42929` | 0.171.0 | `WebGPURenderer` constructor, `forceWebGL`, `getFallback` | Automatic fallback is real; `forceWebGL` is a harness primitive |
| …`:28702-28760` | 0.171.0 | `Renderer.init()` fallback-on-reject; `_nodes` built inside the promise | Init is async; the trigger is correct |
| …`:42904-42910` | 0.171.0 | `addToneMapping` × 6 incl. AgX and ACESFilmic | Both of the app's tone curves are supported |
| …`:21099` | 0.171.0 | `_shadowFilterLib` includes `PCFSoftShadowFilter` | Soft shadows supported *at this version* |
| …`:13275`, `:9638-9669` | 0.171.0 | `PointsNodeMaterial.sizeNode`; `InstancedPointsNodeMaterial` | `gl_PointSize` has a direct equivalent |
| …`:34592`, `:35636`, `:35673` | 0.171.0 | `WebGLBackend` incl. `createComputePipeline` via `transformFeedbackVaryings` | The WebGL2 backend is substantive and emulates compute |
| …`:29970`, `:27958`, `:28005`, `:28044`, `:4464` | 0.171.0 | Named unsupported configurations | Background, fog and environment each have a supported set |
| `node_modules/three/build/three.tsl.js` | 0.171.0 | `hue`, `saturation`, `luminance`, `grayscale`, `remap`, `glslFn`, `wgslFn` | Two of seven post effects and both escape hatches |
| `node_modules/three/examples/jsm/tsl/display/` | 0.171.0 | 29 display nodes incl. `BloomNode`, `GTAONode` | Two of seven effects have a first-party node |
| `node_modules/three/examples/jsm/transpiler/` | 0.171.0 | `GLSLDecoder.js`, `TSLEncoder.js` | A GLSL→TSL transpiler ships in the box — unmentioned in any prior document |
| `node_modules/@react-three/fiber/dist/events-156d8d12.esm.js:946,15733,15918` | 9.7.0 | `isRenderer`; `await glConfig(defaultProps)` | Async custom renderer works without an upgrade |
| `node_modules/postprocessing/build/` + `package.json` | 6.39.4 | 508 `WebGLRenderTarget`, 370 `WebGLRenderer`, 0 `WebGPU`; peer `>= 0.168.0 < 0.186.0` | The chain must be replaced, and the peer range fixes the migration order |

### External

| Source | Date | Version | What it proves | Effect |
| --- | --- | --- | --- | --- |
| <https://registry.npmjs.org/three/latest> | 2026-09-09 | 0.186.0 | Current stable three.js | Project is 15 releases behind |
| <https://github.com/mrdoob/three.js/wiki/Migration-Guide> | fetched 2026-09-09 | r171→r186 | PCFSoft removal (r186) and deprecation (r182); `PostProcessing`→`RenderPipeline` (r183); PBR/PMREM change (r181); premultiplied alpha (r178, r185); GTAO change (r185); ~15 TSL renames; **`WebGLRenderer` not deprecated** | §4.1, §4.2, §11, §20 |
| <https://github.com/pmndrs/postprocessing> | fetched 2026-09-09 | — | README makes no mention of WebGPU/TSL/node materials | Corroborates §11.2 |
| <https://github.com/mrdoob/three.js/issues/32535> | — | — | Open issue on multi-pass setups under the node pipeline | §11 risk |
| <https://www.utsubo.com/blog/webgpu-threejs-migration-guide> | 2026 | — | Secondary: recommends three's node post-processing over pmndrs for WebGPU | Treated as secondary |
| <https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/GPUDevice.json> | `main`, 2026-09-09 | — | Firefox: no Linux, no Intel macOS, no Android | §19.1 |
| <https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Navigator.json> | `main`, 2026-09-09 | — | `navigator.gpu` availability | §19.1 |
| <https://github.com/gpuweb/gpuweb/wiki/Implementation-Status> | updated 2026-08-13 | — | Chromium Linux per-vendor rollout; **AMD desktop Linux unshipped** | §19.1 |
| <https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/webgpu.json> | `main`, 2026-09-09 | — | ~84% full + ~3% partial; Safari macOS-26 footnote | §19.5 |
| <https://webkit.org/blog/17333/webkit-features-in-safari-26-0/> | 2025-09-15 | Safari 26 | WebGPU in Safari 26 | §19.1 |
| <https://developer.chrome.com/blog/new-in-webgpu-146> | 2026-02-25 | Chrome 146 | Compatibility mode shipped | §19.4 |
| <https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips> | updated 2025-10-17 | — | Six causes of a null adapter | §18.2 |
| <https://raw.githubusercontent.com/chromium/chromium/main/gpu/config/webgpu_blocklist_impl.cc> | `main`, 2026-09-09 | — | Actual blocklist: Adreno IDs + PowerVR 25.1 | §19 (refutes a widespread NVIDIA-570 claim) |
| <https://www.w3.org/TR/webgpu/> | CR Draft, 2026-09-01 | — | Fallback adapter, compatibility limits | §19.4 |
| <https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/lost> | 2026-09-09 | — | Device loss; resources must be recreated | §18.3b — the new failure mode |
| <https://developer.mozilla.org/en-US/docs/Web/API/Navigator/gpu> | 2026-09-09 | — | Secure-context requirement | §19.3 — the one hard blocker |
| <https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedLimits> | 2026-09-09 | — | Default guaranteed limits | §19.4 |
| <https://caniwebview.com/features/web-feature-webgpu/> | updated 2026-09-05 | — | All three WebViews "support unknown" | §19.5 — the shared-link blind spot |
| <https://developer.chrome.com/docs/chromium/headless> | updated 2024-10-21 | — | Headless modes; `chrome-headless-shell` split | §19.6 |
| <https://developer.chrome.com/blog/supercharge-web-ai-testing> | 2024-01-16 | — | Headless WebGPU flags; a real GPU is necessary | §19.6, Phase 0 |

### Internal

- [`../evolution/frontend-modernization-research.md`](../evolution/frontend-modernization-research.md) — audited in §20
- [`../evolution/platform-evolution-research.md`](../evolution/platform-evolution-research.md) §Track D — audited in §20
- [`../rules/coding-style.md`](../rules/coding-style.md), [`../rules/git-convention.md`](../rules/git-convention.md), [`../rules/demos-and-artifacts.md`](../rules/demos-and-artifacts.md)

---

## Quality check

Honest ticks and crosses. A cross is more useful than a dishonest tick.

| Item | Status |
| --- | --- |
| Entire repository structure inspected | ✅ 1,410 tracked files mapped; 3D layer read |
| Relevant source files actually read | ✅ all 9 shaders, all 9 patches, renderer, composer, tier probe, boundary, harness, fauna, models — quoted with `file:line` |
| `agent-system` research inspected | ✅ audited as propositions in §20, not summarised |
| Exact three.js version identified | ✅ 0.171.0 installed **and** locked; 0.186.0 current |
| Current three.js WebGPU state researched | ⚠️ **partially** — the installed source was read exhaustively; the *documentation* agent was killed |
| Current TSL state researched | ⚠️ **partially** — inventory from installed source + migration guide; no authoritative node-portability list |
| WebGPU specification researched | ⚠️ **partially** — via the browser-support research; not read directly for compute/interop |
| Current browser support researched | ✅ thoroughly — 23 dated sources |
| Renderer audited | ✅ |
| Materials audited | ✅ 126 sites classified |
| Custom shaders audited | ✅ 9 shaders + 9 patches, with per-item TSL targets |
| Ocean audited | ✅ per-component chain, §12 |
| Creatures audited | ✅ 32 species enumerated from source |
| Animation audited | ✅ both mechanisms; one earlier error of mine corrected |
| Post-processing audited | ✅ per-effect, with the library's coupling measured |
| Render targets audited | ✅ — the app creates none |
| Depth/MRT audited | ✅ — none in app code |
| WebGL-specific APIs audited | ✅ all 5 type sites, 3 raw context calls, 1 event listener |
| WebGPU/WebGL interoperability investigated | ❌ **NOT properly researched.** §16 shows the recommended architecture does not need it, and declines to assert an answer |
| WebGL2 fallback investigated | ⚠️ **structurally proven, behaviourally unverified** — §28.3 item 1, the report's largest gap |
| Behavioural parity investigated | ✅ per subsystem, with named exceptions |
| Previous research challenged | ✅ 12 claims audited and classified |
| First conclusion challenged | ⚠️ **by me, not by an adversarial fleet** — §27; two of my own claims refuted |
| Migration matrix created | ✅ §21, 38 rows |
| Risk matrix created | ✅ §22, six categories |
| Target architecture proposed | ✅ §25, after a four-way comparison |
| Migration phases proposed | ✅ §26, 14 phases adapted to this source |
| Field defect reports gathered | ❌ agent killed; §28.3 item 4 |
| Adversarial verification of load-bearing claims | ❌ fleet killed; §27 is a single-author second pass |
| **No production code modified** | ✅ **nothing outside this file was touched** |

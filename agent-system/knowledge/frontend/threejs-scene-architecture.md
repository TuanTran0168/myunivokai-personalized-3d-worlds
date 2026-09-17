# three.js in Myunivokai — Principles and scene renderer architecture

> **Document status:** Active
> **Last source review:** 2026-07-19

This document explains how three.js works, how this repo uses it, and how to
customize/extend it. The registry pattern below is no longer hypothetical: the
**forest/nature family is the real second renderer** (see
[forest-render-mechanism.md](forest-render-mechanism.md)). City is now the
approved third family, but remains planned source; its contract and delivery
order are in [../vision/city-service-plan.md](../../plans/services/city-service-plan.md).

## 1. three.js fundamentals

Three.js is a 3D rendering library on top of WebGL. Everything revolves around
four concepts:

### Scene graph

A 3D scene is a tree. When a parent node rotates/moves, all children follow.

```txt
Scene
├── Sun (mesh + point light)
├── Group (orbit inclination)      <- rotating this group tilts the whole orbit
│   ├── OrbitPath (faint ring)
│   └── Group (planet anchor)       <- position changes each frame = planet orbits
│       ├── Group (axial tilt)      <- rotation.z = axial tilt
│       │   ├── Planet mesh         <- rotation.y increases = self rotation
│       │   └── Ring mesh
│       └── Html label
└── Points (background stars)
```

This is exactly why the code in `solar-system/` nests multiple `<group>`
elements: each level owns one transform, keeping orbit / axial tilt / spin
independent of each other.

### Mesh = Geometry + Material

- **Geometry**: the shape (vertices, faces). `sphereGeometry`, `ringGeometry`, etc.
- **Material**: how the surface reacts to light.
  - `meshStandardMaterial`: real lighting (planets — the side facing the sun is lit, the far side is dark).
  - `meshBasicMaterial`: self-lit, ignores lights (sun, orbit rings, skybox).
- **Texture**: an image mapped onto the surface via UV coordinates. three.js
  spheres ship with world-map-style UVs, so an equirectangular image (like NASA
  textures) wraps straight into a planet.

### Render loop

three.js redraws about 60 times per second. Each frame, code may mutate
position/rotation before drawing — that IS animation. In React Three Fiber
(R3F), the `useFrame((state, delta) => ...)` hook runs every frame:

```tsx
useFrame(({ clock }) => {
  const orbitAngle = orbitPhase + clock.elapsedTime * orbitSpeed;
  orbitAnchor.position.set(Math.cos(orbitAngle) * orbitRadius, 0, Math.sin(orbitAngle) * orbitRadius);
});
```

Key rule: **never call setState inside useFrame** (it would re-render React at
60fps). Mutate through a `ref`, as above.

### Camera, lights, interaction

- `PerspectiveCamera(fov, aspect, near, far)` — the viewer's eye. The repo reads
  `distance`/`fov` from the BE config.
- Lights: a `pointLight` at the sun shines in all directions (planets get
  day/night sides), plus a weak `ambientLight` so the dark side stays visible.
- Mouse interaction: three.js uses **raycasting** — a ray is shot from the
  camera through the cursor to find the mesh it hits. R3F wraps this as
  `onClick` / `onPointerOver` props on the mesh.

### React Three Fiber (R3F)

R3F turns the scene graph into JSX: `<mesh>`, `<group>`, `<pointLight>` are
tree nodes. React manages the tree; three.js does the drawing. On top of that:

- `useLoader(TextureLoader, url)` — loads textures and suspends, so wrap in `<Suspense>`.
- `@react-three/drei` — ready-made utilities: `OrbitControls` (mouse rotate/zoom),
  `Html` (DOM anchored to a 3D position).
- `@react-three/postprocessing` — post effects; the repo uses `Bloom`
  (bright spots bleed light — the sun blazes).

## 2. The repo's scene renderer architecture

Principle: **one scene = one renderer**, plugged in through a registry. The
universe is just the first renderer; City will be a new renderer, never a
modification of the old one.

```txt
apps/myunivokai-personalization/src/
├── components/UniverseCanvas.tsx          <- shell: Canvas + camera + bloom + hover overlay
└── features/scene-renderers/
    ├── types.ts                           <- SceneRendererProps: the contract every renderer implements
    ├── registry.ts                        <- sceneType-first resolution: resolveSceneTypeRenderer(scene) THEN theme
    ├── planetIdentity.ts                  <- identity key for selectable objects
    ├── shared/                            <- usable by every scene type
    │   ├── CameraRig.tsx                  <- OrbitControls + fly-to-selected-object animation
    │   ├── PlanetPositionTracker.ts       <- Map of key -> Vector3: renderers write, CameraRig reads
    │   ├── StarParticleField.tsx          <- background stars via BufferGeometry + Points
    │   └── PostEffects.tsx                <- Bloom, intensity from config.postFX
    ├── solar-system/                      <- the solar system renderer
    │   ├── SolarSystemRenderer.tsx        <- composes Sun + planets + orbits + skybox
    │   ├── Sun.tsx                        <- sun texture + glow + pointLight (the only light source)
    │   ├── SolarPlanet.tsx                <- surface texture, axial tilt, spin, ring, label
    │   ├── OrbitPath.tsx                  <- faint orbit ring
    │   ├── Skybox.tsx                     <- inside-out sphere with the milky-way texture
    │   └── planetTextureCatalog.ts        <- texture catalog + per-style axial tilt
    ├── forest/                            <- the forest/nature renderer (sceneType "forest")
    │   ├── ForestRenderer.tsx             <- composes terrain + trees + wildlife + weather + landmarks
    │   ├── forestModels.ts                <- GLB catalog + instancing/animation helpers
    │   ├── forestMath.ts                  <- terrain height sampler, path/blend helpers
    │   └── Forest*.tsx                    <- Terrain/Trees/Wildlife/WeatherEffects/GroundDecor/SkyDome/...
    └── fallback/FallbackUniverseRenderer.tsx <- abstract scene when no config exists (landing preview)
```

### Data flow from backend to pixels

```txt
BE returns a scene config (JSON)
  -> lib/api.ts normalizes onto lib/types.ts types
  -> lib/scene.ts: safe readers for palette/planets/background (+ isForestScene)
  -> UniverseCanvas: registry resolves the renderer sceneType-FIRST
       resolveSceneTypeRenderer(scene)  // "forest" -> ForestRenderer
       else resolveSceneRenderer(theme) // universe themes -> SolarSystemRenderer
  -> the renderer reads its config sections and animates in useFrame
```

The backend decides the **data** (how many planets, orbits, speeds — derived
from Personality DNA + seed). The frontend decides the **presentation**
(textures, lighting, effects).

### Determinism

The same seed must always draw the same scene. Every "random" FE value
(star positions, orbit inclinations) comes from `randomFromSeed(seed)` in
`lib/scene.ts` (an xorshift PRNG) — `Math.random()` is forbidden in scene code.

### One material, two shader systems

Since §26 Phase 7 began, a material that customises its shader exists **twice**,
and both ship at once. This is not a transitional inconvenience — it is what
makes the migration checkable.

- `WebGLRenderer` draws GLSL. Custom shading is a `ShaderMaterial`, or a stock
  material patched through `onBeforeCompile` and `shared/shaderChunkPatch.ts`.
- The node renderer (`WebGPURenderer`, on either the WebGPU or the WebGL2
  backend) assembles shaders from a **node graph**. There is no GLSL string to
  patch — `onBeforeCompile` does not exist on a node material — and
  `WebGLRenderer` cannot draw one.

**The node path is all-or-nothing**: one raw GLSL `ShaderMaterial` left in a
scene is a scene that cannot run on the node renderer. So the port proceeds
material by material with both implementations live, `scene-parity.spec.ts`
renders the same scene through both, and the difference is the remaining debt.

The machinery is `shared/nodeMaterials.ts` and `shared/useNodeMaterialModules.ts`:

```txt
UniverseCanvas's async `gl` factory
  -> loadNodeMaterialModules()        caches three/webgpu + three/tsl, once
  -> fiber awaits the factory before mounting ANY child
  -> useNodeMaterialModules()         synchronous from then on, null on the classic path
  -> createSomeMaterial(source, nodeModules)   picks its implementation
```

Three rules, each of which has already cost something:

- **The two implementations read ONE set of constants.** Declared separately
  they drift, the frames differ by an amount too small to notice and too large
  to be right, and nothing throws. `forestFoliageMaterial.ts` is the reference
  shape: constants at the top, a `…Glsl()` builder and a node builder below
  them, and a test asserting the shader string contains no numeric literal the
  module does not declare.
- **`null` node modules is the ordinary answer, not an error.** It is what
  every visitor gets until Phase 9. A material factory that throws or falls
  back loudly on the classic path is wrong.
- **Decide on the RENDERER, not on the graphics API.** `WebGPURenderer` with
  `forceWebGL: true` is still a node renderer — it draws node graphs through a
  WebGL2 backend — and that is the configuration ~20% of users land on after
  the swap. `isNodeRenderer` therefore tests for `renderer.backend`, the same
  question `ParityHarnessBridge.describeBackend` asks.
- **A sized point is a QUAD on the node path, and its per-instance attributes
  must be `InstancedBufferAttribute`s.** WebGPU has no point size at all, so
  `SizedStarPoints` and `NebulaCloudPoints` are a `Points` on the classic path
  and an instanced `Sprite` on the node one — the only port so far where the
  dual path changes the SCENE GRAPH and not just the shader. Build the per-item
  values with `perInstanceAttribute()` from `shared/nodeMaterials.ts`; see the
  trap below for why the obvious spelling does not work.

### `positionLocal` stops being the geometry attribute the moment you set `positionNode`

GLSL's `position` is the vertex attribute and nothing ever overwrites it. TSL's
`positionLocal` looks like the same thing and is not: `NodeMaterial.setupPosition`
does `positionLocal.assign( this.positionNode )` (`NodeMaterial.js:804`), so from
then on it holds the DEFORMED result. The attribute is `positionGeometry`
(`Position.js:33`, literally `attribute('position','vec3')`).

Any port whose vertex shader both moves the vertex and reads `position` for
something else — a normal, a local height, a radius — has to use
`positionGeometry` for the second use. That is most of them: a sprite, a
billboard, a shell and a deformed mesh all do it.

**It fails by shading, not by geometry, which is why a number will not catch
it.** The ocean's bubbles are drawn rim-only — `1 - |dot(normal, viewDir)|` with
the normal taken from the sphere's own outward direction — so feeding that term
the bubble's world position instead makes it near-constant across the sprite and
the bubbles render as **solid white discs instead of rings**. Parity moved by
0.15 of 255, comfortably inside the ocean's recorded headroom, and the suite
stayed green. What caught it was cropping the two frames side by side: every
bubble was in exactly the right place and none of them was the right shape.

The same trap does not apply to `positionView`, which is what GLSL's
`modelViewMatrix * vec4(world,1.0)` produces and is correct to use for near-plane
and depth work — `sizedStarPointsMaterial.ts` and `nebulaCloudPointsMaterial.ts`
both rely on that and both are right.

### `instancedBufferAttribute()` does not make an attribute instanced

Given a raw `Float32Array` or a plain `BufferAttribute` — the two shapes its own
JSDoc lists first — three's `instancedBufferAttribute()` returns a node the GPU
steps **once per vertex**. It does not warn, the shader compiles, and nothing
throws. Three lines have to agree and only one input makes all three agree:

1. `createBufferAttribute`'s general return is
   `new BufferAttributeNode(...).setUsage(usage)` — **`.setInstanced()` is never
   called** (`BufferAttributeNode.js:387`). Only its `mat3`/`mat4` branches call
   it, so the `true` the function's name promises is dropped for every `float`,
   `vec2` and `vec3`.
2. The one surviving route into `node.instanced` is the constructor reading it
   off the value: `this.instanced = value.isInstancedBufferAttribute` (`:146`).
3. A raw array is worse: `setup()` wraps it in a plain `InterleavedBuffer` and
   sets the flag on the ATTRIBUTE (`:355`), but for an interleaved attribute both
   backends read it off the BUFFER — `WebGPUAttributeUtils.js:307` and
   `WebGLBackend.js:2555`. three's own `@TODO: Add a possible:
   InstancedInterleavedBufferAttribute` on the line above is the admission.

So pass a real, non-interleaved `InstancedBufferAttribute`. WebGPU then takes
`WebGPUAttributeUtils.js:312` and emits `stepMode: 'instance'`; the WebGL2
backend takes `WebGLBackend.js:2551` and calls `vertexAttribDivisor`.

**What it looks like when it is wrong is a white screen, nowhere near the
cause.** A per-vertex step makes all N instances re-read elements 0..3 of the
instance buffer as the quad's four corners. Those are star world positions,
hundreds of units across, so every sprite becomes a pair of screen-filling
triangles — and the bloom chain downsamples the whole frame through a mip
pyramid and returns it white. `count = 1` draws one such quad and the frame
survives, which is why bisecting on `count` found the boundary while bisecting
on the shader maths never could: nothing in the shader was wrong.

`nodeMaterials.test.ts` asserts all of this against three's real code, so a
version bump that fixes `createBufferAttribute` fails a unit test in a second
rather than a screenshot in ten minutes.

### A finished port is not a matching frame

Two families now have no hand-written shader left, and both still differ from
the classic renderer:

| family | fully ported | WebGPU vs WebGL | WebGPU vs forceWebGL |
|---|---|---|---|
| forest | yes | 19.49 | 1.24 |
| universe | yes | 12.22 | 0.45 |
| ocean | no, one `ShaderMaterial` left | 61.43 | 0.04 |

The universe is the sharper data point because its number **did not move**:
12.19 before its two point shaders were ported, 12.22 after. What was eliminated
by measurement, using `ParityHarnessBridge.readSceneState()`, is that at the
pinned moment all three backends agree on the clock (6.0000), the camera
(identical to four decimals) and the scene graph (50 drawn objects, world
position checksum 26.501) — so the renderers are handed the same arrangement.
What is left is a frame that sits systematically brighter in the shadows and
midtones while the saturated highlights match, which is the signature of the
**post chain**: pmndrs' `EffectComposer` and three's TSL nodes are two
implementations of the same six passes. No shader port closes that, and Phase 10
cannot judge the fallback until it is attributed.

### A refused material is not drawn wrong — it is drawn with default render state

When `NodeBuilder` meets a material it cannot convert it logs
`Material "ShaderMaterial" is not compatible` and substitutes `new NodeMaterial()`
(`NodeBuilder.js:3145`). The substitute carries none of the original's render
state: not `side`, not `depthWrite`, not `blending`, not `transparent`.

The consequence is the opposite of what the message suggests. A refused
`BackSide` dome that the camera sits inside — the ocean's backdrop, its god rays
— becomes `FrontSide`, is back-face culled, and **is not drawn at all**. So the
node path's frame is not a mess of wrongly-shaded surfaces; it is a frame with
holes in it, and the holes are invisible wherever something behind them happens
to be the right colour.

That is why every material port in this migration is accompanied by a test
comparing `side`, `depthWrite`, `transparent` and `fog` between the two paths.
The colour is the easy half.

### The two paths encode at different times, and additive layers are where that shows

This is the open architectural question of the ocean's port, and it is not a
tuning detail.

**The classic path encodes per material.** A `ShaderMaterial` that ends with
`#include <tonemapping_fragment>` and `<colorspace_fragment>` applies ACES and
sRGB itself; one that does not, writes raw linear values straight into an
already-encoded framebuffer.

**The node path encodes once, for the whole frame.** `Renderer.needsFrameBufferTarget`
(`Renderer.js:2446`) is true whenever `toneMapping` is not `NoToneMapping` or the
output colour space differs from the working one; the renderer then draws the
scene into a linear target and runs one output transform over it
(`Renderer.js:1778`). `UniverseCanvas.tsx:618` sets `renderer.toneMapping` to
ACES on the `WebGPURenderer` for this family, so both conditions hold. The ocean
mounts no post chain on either path — `isOceanFamilyScene ? null :` — so this
renderer pass is the only encode there is.

For every ordinary material the two are equivalent: one encode either way.

**For ADDITIVE materials they are not.** The ocean's drifters and its god rays
deliberately write `gl_FragColor` with no includes, because encoding a
near-additive layer inflates it about two and a half times — linear 0.15 encodes
to 0.40. The god ray shader carries the measurement in its own comment: encoded,
the rays clipped the entire visible band of a 14 m reef to pure white, 100% of
measured pixels. On the node path those same layers go through the frame-wide
transform and ARE encoded.

So the two paths do not merely differ in where the encode happens; they
composite additively in different spaces. Classic adds linear values onto
sRGB-encoded ones, which is physically wrong and is what the look was tuned
against. The node path adds in linear and then tone maps, which is correct and
is a different picture.

**There is no per-material opt-out from a frame-wide pass**, so this cannot be
closed by porting harder. It is a decision about which compositing model the
ocean should have, and therefore a look decision. Until it is made, the god rays
should not be ported: the shipped comment already predicts the result.

### The node path's equivalent of a chunk patch is a subclass, not a node assignment

This is the finding of §26 Phase 7 and it cost a wrong port before it was
understood.

Nine materials in this app INJECT into a shader three otherwise assembles
itself. The kelp bends `transformed` and keeps three's lighting; the seabed
multiplies `diffuseColor` and keeps three's texture; the caustics add to
`gl_FragColor` and keep three's fog. None of them replaces anything, and on the
classic path `onBeforeCompile` plus a `#include` marker is exactly an injection.

**`positionNode` and `outputNode` are not the node-path spellings of those
markers.** Both REPLACE the value three computed, and what they replace is
load-bearing:

- `NodeMaterial.setupPosition` applies instancing at `NodeMaterial.js:796` and
  reads `positionNode` at `:802` — **after** it — then does
  `positionLocal.assign(...)`, which discards the instance matrix outright. A
  kelp bed ported that way does not sway wrongly. Every blade collapses onto the
  world origin, because each instance's position WAS that matrix.
- `outputNode` is read at `:545`, after `setupOutput` has already folded fog
  into the result, so a multiply expressed there scales the fog as well as the
  surface. The classic patches all sit at `<tonemapping_fragment>`, which three's
  fragment shaders place BEFORE `<fog_fragment>` (`meshphysical.glsl.js`, last
  six lines).

The mechanism that does inject is the one three documents on `setupOutput`
itself (`NodeMaterial.js:1160-1178`): **subclass the node material, override the
setup step, modify the ambient property node, and hand control back to
`super`.** That puts the change exactly where the chunk marker puts it and keeps
everything three does around it. `shared/nodeMaterialChunkPatch.ts` is that
subclass, with the three injection points named:

    <begin_vertex>          ->  localPositionOffset     (setupPosition)
    <map_fragment>          ->  diffuseColorMultiplier  (setupDiffuseColor)
    <tonemapping_fragment>  ->  litColorAdjustment      (setupOutput)

**Two things get shorter rather than longer on the node path.**
`positionWorld` and `normalWorld` are always available in the fragment stage and
are already instanced — `Instance.js:213` and `:237` assign through
`positionLocal` and `normalLocal`. The caustics patch's entire vertex stage, two
varyings and an `#ifdef USE_INSTANCING` branch exist only because three's
`<worldpos_vertex>` hides its `worldPosition` behind
`#if defined(USE_ENVMAP) || ...` and may not emit it at all. None of that is
needed here.

### A dropped patch is worse than a refused material, because nothing reports it

A refused `ShaderMaterial` prints `Material "ShaderMaterial" is not compatible`
and drops the draw. **`onBeforeCompile` does not exist on a node material**:
assigning it is legal JavaScript, the property sits on the object, three never
reads it, and the effect is simply gone. No refusal, no console line, no thrown
error — the kelp stops swaying, the seabed stops being rock, the sand stops
having caustics on it, and the frame still looks like a frame.

So every patch site in this app goes through `applyClassicShaderPatch`, which
refuses to attach to a node material and says which patch was dropped, and
`shaderChunkPatchSites.test.ts` scans the source the bundler builds so the next
patch cannot be written without a node arm.

**The same shape bites the uniforms.** Three of the caustics' four values are
written AFTER the material exists — `tintSeabed` supplies strength, colour and
depth once the world's water and lighting are known, and the frame loop writes
the clock. A node uniform initialised from the same number at build time holds
the placeholder forever, and for strength the placeholder is ZERO: a seabed with
no caustics, on the node path only, indistinguishable from a seabed in water too
deep for them. Every ported uniform set that has a late write therefore hands
back a `synchronise()` the frame loop must call, in the same shape and for the
same reason `waveUniformNodes` hands back `setElapsedSeconds`.

### Camera focus (NASA-Eyes style)

Clicking a planet makes `CameraRig` lerp the `OrbitControls` target toward that
planet every frame (the planet keeps moving; the camera follows). Clicking
empty space lerps back to the center. The bridge is `PlanetPositionTracker`:
each planet writes its world position into a shared Map every frame, and
CameraRig just reads it. A future renderer (city, etc.) writes building
positions into the same Map and camera focus works with zero changes to
CameraRig.

## 3. How to customize

### Tuning the current scene

Every tunable is a named constant at the top of its file (per repo coding style):

- Sun size/brightness: `SUN_SCALE_MULTIPLIER`, `SUN_LIGHT_INTENSITY` in `Sun.tsx`
- Bloom strength: `BLOOM_LUMINANCE_THRESHOLD` in `PostEffects.tsx` (lower = more things glow); `bloomIntensity` itself comes from the BE
- Planet size relative to config: `PLANET_SIZE_MULTIPLIER` in `SolarPlanet.tsx`
- Orbit inclination: `MAXIMUM_ORBIT_INCLINATION_RADIANS` in `SolarSystemRenderer.tsx`
- Star density: the BE supplies `config.particles`; fallbacks live in `StarParticleField.tsx`

### Swapping/adding planet textures

Drop a file into `apps/myunivokai-personalization/public/textures/solar-system/` and add an
entry to `planetTextureCatalog.ts` (with `axialTiltRadians`, plus
`ringTextureUrl` for ringed planets). Textures come from Solar System Scope
(CC BY 4.0) — keep the credit in `ATTRIBUTION.md`.

### Adding a new scene type (City is the approved next implementation)

The forest/nature family is the worked example — follow its shape:

1. Create `features/scene-renderers/<scene-name>/`.
2. Write the main component implementing `SceneRendererProps` (see `types.ts`) —
   draw freely with three.js: terrain via `PlaneGeometry` + displacement,
   buildings via `InstancedMesh`, sky via shaders... no limits.
3. For click-focusable objects: write positions into `PlanetPositionTracker`
   and call `onSelectPlanet`/`onHoverPlanet` (the shared contract keeps these
   names). If your config uses a different noun (forest uses `landmarks`), adapt
   it into the shared POI shape in `lib/scene.ts` (see
   `pointsOfInterestFromScene`) so HUD/hover/camera stay family-agnostic.
4. Register the renderer in `registry.ts` under its `sceneType` (resolved BEFORE
   theme), e.g. the forest maps `sceneType: "forest"` -> `ForestRenderer`.
5. A big new family is usually its own backend peer with its own scene config +
   `sceneType` discriminator (forest = nature-service, `ForestSceneConfig`); a
   small variant of the solar system can instead just add a theme.

A scene-switch is just the `sceneType`/family the config carries; old renderers
are never touched. The client already exposes this as the Universe/Forest picker
on the create form.

### Performance

- The main Canvas currently allows `dpr={[1, 3]}` for quality-first rendering;
  weak-device adaptation is **not implemented**. Per owner decision, City first
  establishes and ships its desktop high-fidelity baseline. A measured
  `PerformanceMonitor`/adaptive-DPR and effect/LOD tier follows after City is
  feature complete and must not degrade the approved high tier.
- Mobile particle counts are lower than desktop where the renderer reads the
  paired config values.
- Choose texture resolution by screen-space role and measured sharpness. City
  hero assets may justify higher source resolution than repeated background
  props; compression/tiering comes after the high-fidelity reference is locked.
- Many repeated objects (asteroids, buildings) -> use `InstancedMesh`: one draw call for thousands of objects.

### Family chunks

The registry is sceneType-first **and** lazy: `registry.ts` loads each family
renderer through `React.lazy` over a dynamic `import()`, so a visitor who opens a
forest never downloads the solar system.

Measured on `feat/fe/lazy-renderer-chunks` — `next build`, before → after:

| Route | Before | After |
| --- | --- | --- |
| `/` | 512 kB | 436 kB |
| `/gallery` | 514 kB | 438 kB |
| `/universe/share/worlds/[shareSlug]` | 514 kB | 439 kB |
| `/nature/share/worlds/[shareSlug]` | 514 kB | 439 kB |
| `/worlds/[worldId]` | 526 kB | 450 kB |

Family chunks: forest 52 kB, universe 64 kB (uncompressed on disk). Neither
appears under any route in `app-build-manifest.json`.

- three.js, fiber and drei stay in the shared chunk — both families need them.
  The ~75 kB saved is family-specific renderer code, not the engine. Expect the
  same shape from any future family: a partial win, never a halving.
- **`React.lazy`, not `next/dynamic`.** `next/dynamic` in 14.2.x does not
  suspend: its loadable runtime renders a `loading` component — `null` by
  default — while the chunk is in flight. The renderer shares its Suspense
  boundary with `SceneReadySignal`, so a non-suspending wrapper lets that signal
  mount immediately, lift the opacity veil, and show an empty canvas until the
  chunk lands. `React.lazy` throws the promise, so the existing
  `<Suspense fallback={<CanvasLoader />}>` catches it and the veil behaves as it
  did when only asset loading could suspend.
- No `ssr: false` is needed. `<Canvas>` children are rendered by the r3f
  reconciler on the client and never join the server-rendered tree.
- A chunk that starts loading only when the world response lands trades bytes for
  a round trip. `prefetchSceneRendererForFamily` exists so callers that know the
  family earlier start the chunk alongside the world request: share routes from
  the path, the world page from `?family=`, the create form from its picker.
- Adding a family = one loader + one registry entry + one `prefetch` branch.

Do not re-export a pure helper from `UniverseCanvas`. It makes this module — and
three.js behind it — a dependency of anything that only wanted the helper.
`planetIdentityKey` lives in `scene-renderers/planetIdentity` for that reason.

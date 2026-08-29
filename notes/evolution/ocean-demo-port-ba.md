# Porting the ocean depth rig into the app — BA before the rewrite

> **Document status:** Business analysis. Written after reading BOTH the
> prototype's source (`demos/ocean-depth-rig/ocean-scene.js`, 3100 lines) and
> photographs of both renderers at the same six presets. Every claim below cites
> a line number or a measurement.
> **Written:** 2026-08-19, branch `feat/repo/ocean-service`.
> **Companions:** [ocean-visual-direction-research.md](ocean-visual-direction-research.md)
> (the art direction this prototype was built to prove),
> [../vision/ocean-service-plan.md](../plans/services/ocean-service-plan.md) (the contract,
> untouched by this document).

## Why this document exists

The port has been "nearly there" for several rounds. Each round tuned the app
against a *remembered* design, because the only artefact anyone compared was a
screenshot in a chat message. Two instruments changed that:

- `e2e/ocean-reference.spec.ts` photographs the prototype itself, through the
  same browser, the same software GL (`--use-angle=swiftshader`), the same
  viewport and the same settle time as the app's own suite.
- `e2e/measure.mjs` reduces any frame to six numbers.

So for the first time the gap is arithmetic rather than opinion. This document
is the analysis of that gap, and it **overturns two of my own earlier
conclusions**. Both reversals are recorded rather than quietly dropped, because
each one sent a round of work in the wrong direction.

## The measurements

Same six presets, same instrument. `ref-` is the prototype, `demo-` is the app.

**The instrument had to be fixed before any of this could be trusted.** The
prototype's own control panel is `19.5rem` — 312 px of a 1440 px viewport — and it
is nearly black. `measure.mjs` cropped only the top 18% (the app's chrome), so
every reference reading was the prototype's water *plus a dark bar over a fifth of
the frame*. That biased the reference downward on both luma and saturation, in the
same direction as the difference being investigated: an instrument error that does
not add noise but manufactures the expected result. It now masks each renderer's
own chrome and only its own.

The corrected reference, against the app before this work and after it:

| view | ref | app before | app after |
|---|---|---|---|
| above-water | 0.547 · 0.16 · `#808e95` | 0.580 · 0.16 · `#88979c` | **0.577 · 0.12 · `#8c9598`** |
| golden-hour | 0.378 · 0.24 · `#5e615e` | 0.278 · 0.29 · `#424849` | **0.344 · 0.25 · `#585853`** |
| reef | 0.633 · 0.64 · `#4fb5d0` | 0.434 · 0.67 · `#2e7f88` | **0.462 · 0.61 · `#3f8391`** |
| open-water | 0.683 · 0.54 · `#69bed9` | 0.556 · 0.85 · `#21a9c4` | **0.490 · 0.88 · `#1895b9`** |
| twilight | 0.289 · 0.81 · `#17556b` | 0.421 · 0.84 · `#1c7e9e` | **0.228 · 0.96 · `#05465d`** |
| abyssal-plain | 0.191 · 0.60 · `#1a3543` | 0.364 · 0.55 · `#376677` | **0.265 · 0.45 · `#324852`** |

Total absolute luma error fell from 0.764 to 0.563 — a 26% reduction — and the
three worst views improved most: golden hour from −0.100 to −0.034, twilight from
+0.132 to −0.061, the abyss from +0.173 to +0.074.

**What the correction changed about the diagnosis.** With the contaminated
reference I reported that the app was uniformly too bright in deep water and that
it had lost saturation above water. Both were wrong. The app was too bright in the
DARK views and too dark in the LIT ones — it compressed the dynamic range — and
above water its saturation already matched the reference exactly (0.16 both). I
had also claimed the app's local contrast had collapsed; the corrected numbers
show the opposite, the app carries roughly twice the local detail of the
prototype at every preset, because the prototype's dark UI text had been inflating
its own `detail` reading.

That last point is the one worth keeping. Looking at the two reef frames side by
side: **the prototype's reef is mostly empty, bright, flat cyan with a single
shark in it.** The app's is a dense, darker, busier field. The prototype does not
win on fidelity or on content — it wins on brightness and on restraint, and no
amount of adding things will close that gap.

## Finding 1 — the effect stack is the brightness gap

The prototype's file header, line 19:

> Runs with NO post-processing on purpose: `ocean-service-plan.md` §12 requires
> the frame to read with the effect stack disabled.

It renders with `renderer.toneMapping = ACESFilmicToneMapping` and
`toneMappingExposure = p.exposure`, straight to the canvas
(`ocean-scene.js:31-32`).

The app renders through `@react-three/postprocessing`'s `EffectComposer`, which
**sets `gl.toneMapping = NoToneMapping` on mount** and expects a `<ToneMapping>`
effect in the chain. `PostEffects.tsx` has none. So the app's frames go through:

1. `oceanToneMap.ts` — a **Narkowicz 2015** ACES *approximation*, injected into
   every ocean material by hand, because the renderer's own curve was dead.
2. Bloom, capped at 0.32 intensity with a 0.94 luminance threshold.
3. A vignette at 0.24 darkness.

Three separate divergences from the reference, all of them lifting or reshaping
the frame, and none of them present in the thing being matched. Narkowicz and
three.js's `ACESFilmicToneMapping` are different curves — three's applies
`exposure / 0.6` before an RRT/ODT fit, Narkowicz applies none — so identical
scene values cannot produce identical pixels no matter how the exposure is
tuned.

**Decision: ocean scenes do not mount `PostEffects` at all.** Then
`toneMapping: ACESFilmicToneMapping` works natively, `toneMappingExposure`
becomes live, and the app's tone curve is *the same code* as the prototype's
rather than an approximation of it.

This is also the largest simplification available anywhere in the family. It
deletes:

- `oceanToneMap.ts` entirely,
- every `applyOceanToneMapping(...)` call site,
- the `${OCEAN_TONEMAP_GLSL}` splice in six hand-written shaders,
- the `oceanToneMap(` assertion in `oceanShaderSource.test.ts`,
- the `clearColor = fogColor * exposure` pre-multiply in `oceanRig.ts`, which
  exists *only* because the clear colour was the one pixel the injected curve
  could not reach,
- the `profile="ocean"` branch in `PostEffects.tsx`.

Universe and nature keep the composer exactly as it is. Both are in production
and neither is touched.

## Finding 2 — the app renders 396 animals where the prototype renders 2440

This is the reason the water column reads empty, and it is the single biggest
visual difference in the screenshots the user sent.

The prototype builds 14 schools plus a jellyfish layer
(`ocean-scene.js:2070-2095`). The app's `OCEAN_RIG_SPECIES` has **10**. The four
missing ones are precisely the mass schools:

| missing species | count | what its absence costs |
|---|---|---|
| silversides | **1400** | the shimmering cloud that makes a reef a reef |
| anthias | **340** | the near-field orange — the only saturated colour underwater |
| lanternfish | **300** | the twilight zone's entire population |
| anglerfish | 4 | the abyss's one glowing lure |
| jellyfish | **110** | the drifting layer both midwater zones depend on |

2154 of 2550 animals, absent. The user's twilight screenshot is a lanternfish
swarm plus jellies; the app's twilight is empty water for exactly this reason.

### Why they went missing — the causal chain

The app made fauna **GLB-only**. In `oceanRig.ts:667`, every school is created
with a one-vertex placeholder and `school.mesh.visible = false`, becoming visible
only when `loadSpeciesGeometry` resolves. A species with no `.glb` on disk can
therefore never appear — and there is no GLB for silversides, anthias,
lanternfish or anglerfish, because the prototype builds those **procedurally**
from `fusiform()` / `bodyGeometry()` / `wingGeometry()` (`ocean-scene.js:1563-1815`).

The prototype's own approach is the opposite and is the correct one
(`loadRealModels`, `ocean-scene.js:2483`): build a procedural body **always**,
then adopt a real GLB over it if the catalogue has one, and if the catalogue is
missing entirely, set `__oceanModelsLoaded = "unavailable"` and carry on looking
fine. Procedural is the floor, GLB is the upgrade.

Meanwhile the app already contains ~600 lines of exactly the needed procedural
bodies in `oceanModels.ts` (`fishGeometryForKey`, `drifterGeometryForKey`,
`giantGeometryForKey`, `abyssVisitorGeometryForKey`) and **all of it is dead** —
the module's only live export is `LANDMARK_BASE_COLORS`. `oceanSwimming.ts` (197
lines) is imported by nobody at all.

### Reversal 1 — "replace the carousel with real schooling" was wrong

I previously listed as a defect that the app moves fish with
`leader.angle += leader.speed * 0.016` instead of using the
separation/cohesion/neighbour constants in `oceanSwimming.ts`.

Reading the prototype: **it is also a carousel.** Leaders ride circular paths at
a per-species `pathRadius`, and members hold fixed offsets around their leader
scaled by `spread`. There are no boids anywhere in the thing being matched.
`oceanSwimming.ts` is dead in the app because the design never needed it.

And this answers the user's question about *cá bơi gần bơi xa* directly. Depth
layering is not an LOD system — it is **14 concentric rings at radii 13, 15, 16,
17, 19, 20, 26, 30, 44, 58, 64, 68, 76 and 118 m**, each with its own body size
from 0.24 m to 13 m, its own `spread`, its own `leaders` count, and `slow` /
`tightRing` flags for solitary animals. The app already ports these numbers
faithfully for the 10 species it has. It just needs the other four.

## Finding 3 — three cheap layers the app never got

All three are visible in the user's screenshots and all three are small.

**The foreground frame** (`ocean-scene.js:2096-2133`). Four near-black tapered
blades at z ≈ -2.5, parented to **the camera**, `renderOrder = 4000`. The
prototype's own comment calls it "the single highest-value cheap change: it is
what tells the eye it is INSIDE the water rather than looking at a picture of
water." It is the dark diagonal band on the right edge of the twilight and abyss
screenshots. ~35 lines.

**Bathymetric ridge silhouettes** (`ocean-scene.js:889-913`). Three rings of
flattened cones at radius 58 / 112 / 205 m, `MeshBasicMaterial` with
`fog: true`, tinted `fog × dark` where dark is 0.58 / 0.34 / 0.18. Unlit, left
entirely to the fog. These are the receding dark ridges on the abyss horizon —
they are what gives the deep a *distance*. ~25 lines.

**Bubble vents** (`ocean-scene.js:1482-1545`). 700 instanced icosahedra rising
from **9 discrete vents**, not scattered: "a stream reads as bubbles; a uniform
scatter reads as dust." Rim-only shading, additive. ~60 lines.

## Finding 4 — marine snow has one layer instead of four

The prototype runs three snow layers plus a separate bioluminescent one
(`ocean-scene.js:2201-2213`):

| layer | count | radius | size | fall | blending |
|---|---|---|---|---|---|
| snow-far | 2900 | 120 | 0.9 | 0.30 | normal |
| snow-mid | 1200 | 46 | 2.4 | 0.24 | normal |
| snow-near | 130 | 14 | 4.6 | 0.16 | normal |
| biolum | 900 | 80 | 2.6 | 0.05 | **additive + flicker** |

The app has one layer: 2600 motes in a ±70 m box, additive, with the biolum
colour chosen per-particle by `step(0.72, vSeed)`. That collapses four distinct
distance cues into one uniform haze — and it is the *near* layer, the 130 big
soft motes at 14 m, that does most of the work of putting the camera inside a
medium.

## Finding 5 — the key light is not normalised

The prototype pins the key light's magnitude to `0.22 + 0.78·brightness^0.7`
by dividing through its own peak, then floors each channel at
`KEY_FLOOR = #08222E` (`ocean-scene.js:222-228`):

```js
key = SURFACE_SUN.clone().multiply(spectral);
key.lerp(SURFACE_SUN, 0.22);
key.multiplyScalar((0.22 + 0.78 * pow(brightness, 0.7)) / keyPeak);
key.r = max(key.r, KEY_FLOOR.r);   // and g, b
```

The app instead multiplies by `fog + 0.3` and **never divides by the peak, and
has no floor** (`oceanRig.ts:255-257`). So the key's brightness rides on the fog
colour's magnitude instead of being pinned. In the abyss the app's key peaks
near 0.095 where the prototype's is exactly 0.22 — the app's deep key is *too
dark*, which is why the near field is carried almost entirely by the dive lamp
and the sponges blow out.

## Reversal 2 — the PBR textures are not the sand fix

Last round I reported that six 1k PBR maps sit committed in
`public/assets/ocean/textures` and are loaded by nothing, and that wiring them in
was the largest single visual win. I wrote `oceanRigTextures.ts` to do it.

**The prototype loads zero image textures.** Its sand is procedural
(`sandTextures()`, `ocean-scene.js:749`) — and the reason it does not stripe is
that its ripple is **domain-warped by an fbm**, with an fbm grain term carrying
more weight than the ripple itself:

```js
const grain  = fbm2(x * 0.28, y * 0.28);
const ripple = 0.5 + 0.5 * Math.sin(x * 0.22 + fbm2(x * 0.05, y * 0.05) * 7);
const h = grain * 0.55 + ripple * 0.45;
```

The app's, in `oceanRigTerrain.ts`:

```js
const ripple = Math.sin(along * Math.PI * 2 * 9) * 0.5
             + Math.sin(along * Math.PI * 2 * 23) * 0.18;
```

Two pure sines along one axis, no warp, no grain. That is the corduroy — so the
*diagnosis* was right and the *prescription* was wrong. The fix is 6 lines of
the prototype's own noise, not a texture pipeline.

`oceanRigTextures.ts` is therefore deleted rather than wired: it is unused, and
keeping an unused module is the exact dead-code problem this document raises
against `oceanModels.ts` and `oceanSwimming.ts`. The committed JPGs stay on
disk — they are licensed and attributed, and the seabed is not the only thing
that could ever use them — but nothing pretends to consume them.

## Finding 6 — the two views the user named

**Above water** (`data-viewer="-22" data-sun="32" data-yaw="118" data-wind="12"`)
and **golden hour** (`data-viewer="-12" data-sun="5" data-yaw="0" data-wind="6"`)
differ in the app on four specific values:

| value | prototype | app |
|---|---|---|
| `backdrop.scale` above water | **9** | 16 |
| `camera.far` above water | **9000** | 12000 |
| `seaTop.uExposure` | **1.0**, renderer carries `p.exposure` | folded into the injected curve |
| camera yaw | **locked to the sun** when `above \|\| surfaceInSight` | free |

The yaw lock is not cosmetic and it is why golden hour works at all. The preset
sets `data-yaw="0"`, which points the camera **at** the sun, putting the disc,
the aureole and the specular glitter path in frame together;
`applyWorld` then holds that relationship (`ocean-scene.js:2740-2745`):

> Whenever the surface is in reach, the sun is the subject: the window, the god
> rays and the glitter all live in one direction, and a camera pointed anywhere
> else in a sunlit ocean is pointed at nothing.

The app's shared camera has no such rule, so an above-water world is framed by
whatever `universeCameraPosition` happened to return — which is how a sunset
renders as a grey band.

## The plan, ordered by measured impact

| # | change | files | why this order |
|---|---|---|---|
| 0 | Ocean bypasses `PostEffects`; renderer-level ACES; delete `oceanToneMap.ts` and all its call sites | `UniverseCanvas.tsx`, `PostEffects.tsx`, `oceanRig*.ts`, `oceanShaderSource.test.ts` | unblocks every later comparison — until the curve matches, no tuning means anything |
| 1 | Procedural bodies always, GLB adopted over them; add silversides / anthias / lanternfish / anglerfish; add the jellyfish layer; add the `nearField` emissive branch | `oceanRigFauna.ts`, `oceanModels.ts` | +2154 animals; the largest visible difference |
| 2 | Foreground frame, ridge silhouettes, bubble vents | `oceanRig.ts` + one new module | ~120 lines for three of the strongest depth cues |
| 3 | Marine snow 1 layer → 3 + additive biolum layer | `oceanRig.ts` | restores the near-field medium cue |
| 4 | Key light normalised to its peak, `KEY_FLOOR` floor | `oceanRig.ts` | fixes the too-dark deep key and the blown sponges |
| 5 | Above-water: `backdrop.scale` 9, `far` 9000, sun-locked yaw | `oceanRig.ts`, `UniverseCanvas.tsx` | the two views the user named |
| 6 | Sand: fbm grain + fbm-warped ripple; delete `oceanRigTextures.ts` | `oceanRigTerrain.ts` | removes the corduroy |
| 7 | Correct `measure.mjs` to mask the prototype's UI column | `e2e/measure.mjs` | so the remaining deltas are honest |
| 8 | Delete `oceanSwimming.ts`; prune dead exports from `oceanModels.ts` | — | 800 lines of code no path reaches |

## What this document does not change

The service contract, the depth curve, the Jerlov water model, the boundary
rule, determinism, the seed streams, the rarity contract, renderer registration
and the scene lifecycle are all untouched. Every change above is inside the
ocean renderer or gated on `isOceanScene(scene)`.

## Two more bugs, found only by implementing the plan

Neither was visible from reading the source. Both were found by fixing the tone
curve first, re-measuring, and asking why the remaining error had the shape it
did — which is the argument for having the instrument at all.

### The colour constants were sRGB fractions used as linear radiance

`CLEAR_WATER` was stored as `[0.17, 0.58, 0.67]`. Those are the sRGB *fractions*
of `#2C93AC` — 44/255, 147/255, 172/255. The prototype writes
`new Color("#2C93AC")`, and three.js converts sRGB to linear on the way in, giving
`[0.0252, 0.2918, 0.4125]`. So the same colour entered the same maths with red
6.8× too high, green 2× and blue 1.6×.

`ABYSS_GLOOM` and the new `KEY_LIGHT_FLOOR` had the same fault. `SKY_HAZE_LINEAR`
did not — it had been converted by hand — and that inconsistency is what made the
bug findable at all: one constant in the file obeyed a rule the others did not.

Because the palette renormalises by its own peak, the *brightness* error largely
cancelled and the *hue* error did not. The abyss therefore rendered at saturation
0.42 against the prototype's 0.60, with a mean of `#41626e` against `#1a3543` —
paler and greyer, worst exactly where the water is darkest. Every constant is now
derived from its hex through an explicit `linearFromHex`, and a test asserts each
one matches what `new Color(hex)` produces.

### The abyssal-gloom blend was applied on the wrong side of the normalisation

The app computed the water's hue, blended it toward the abyssal gloom, and *then*
normalised the result to the value floor. The prototype normalises first and
blends second.

That ordering is not cosmetic. Normalising after the blend scales the result back
up to `0.13 + 0.66·brightness^0.8`, which throws away precisely the darkening the
blend just performed — the gloom becomes a pure hue shift and a trench comes out
as bright as the twilight zone above it. Measured: the abyss at luma 0.33 against
the prototype's 0.19.

The same function had a second divergence beside it: the blend was driven by raw
`luminance` against a 0.02 threshold where the prototype uses perceptual
`brightness` against 0.16. At 142 m that is 83% gloom instead of 59%.

A unit test guarded the wrong behaviour here. `never goes black, however deep`
asserted the deepest fog peak was above 0.1 — which was not an invariant but a
measurement of the bug, since 0.1 is only reachable by renormalising the gloom
away. It has been replaced with the relation it was standing in for: **the trench
must be darker than the twilight zone above it**, which is what depth as an axis
actually requires.

## What shipped, and what is left

Done: the composer bypass and the deletion of the injected tone curve; the four
mass schools and the jellyfish layer, with procedural bodies as the floor and GLBs
as an upgrade; the foreground frame, ridge silhouettes and bubble vents; marine
snow at four layers with only the living one additive; the normalised key light;
the sun-aimed camera for any world where the surface is in reach; the sand's
tileable domain warp; the two colour bugs above; the instrument correction; and
the deletion of `oceanSwimming.ts` and `oceanRigTextures.ts`.

Left, and now the whole of the remaining gap: **the lit views are too dark and too
saturated.** Reef is 0.462 against 0.633, open water 0.490 against 0.683 with
saturation 0.88 against 0.54. Both are views whose frame is mostly the underwater
surface and Snell's window, so the next place to look is the window's own gain —
the prototype drives it from two near-white colours at roughly full strength,
while the app drives an analytic Snell's-window function through
`uSkyGain = 0.16 + fogValue·0.62`, which is 0.47 at those depths.

Not attempted: bubbles above the waterline, procedural silhouette variety beyond
the three ridge rings, and camera drift/breathing.

## Postscript — "where is the water surface?" was a config-generation gap

Asked after the renderer work landed: the above-water and golden-hour views were
demonstrably working, so why did no world show them?

Because no world could. The renderer was never the problem — the two views were
unreachable by construction, in two independent ways, both in ocean-service:

| | service allowed | prototype uses |
|---|---|---|
| altitude above water | **1.4 → 7.8 m** | 12 m and 22 m |
| sun elevation | **31.5° → 74.5°** | 32° and **5°** |

**Golden hour was arithmetically impossible.** The sun's band was a single pair of
constants used for every world, with a floor of 0.55 rad. Nothing could draw a
low sun, so every ocean world was midday and the renderer's sunrise path had never
once been asked for.

**The altitude band produced no horizon.** It was 1.4–7.8 m, documented as "a
person's eye height on the water". But wind in this family reaches 13 m/s, and
Pierson–Moskowitz puts the significant wave height there at 3.6 m — so at 4.5 m up
the crests are at eye level, the sea fills the frame, and there is no sky line.
The one view that exists to show the surface showed only water.

**And it almost never happened anyway.** A breach needed the shallows (drawn about
31% of the time) and then a 1-in-6 roll: roughly **5% of all oceans**, which is
rare enough that a person can generate all day and conclude the view does not
exist.

### What changed

- Altitude band **4 → 24 m**. The low end clears the crests of the roughest sea
  this family can generate; the high end is where the prototype composes.
- **The sun's band now depends on the medium.** Underwater it is unchanged, and
  that band is *right* rather than merely conservative: Fresnel reflectance at the
  air–water interface climbs steeply below about 20° and Snell's window narrows
  with it, so a 5° sun underwater does not light a water column, it bounces off
  the top of it. Above the waterline nothing has to survive that trip, so the band
  opens to 3.4°–40°. Same roll, same seed stream, different band — **no underwater
  world moves by a digit.**
- Breach probability **1/6 → 1/3** of the shallows, taking above-water worlds from
  ~5% to ~10% of oceans.

### The reason this survived so long

**Every golden fixture was underwater.** Four worlds, all below the waterline, so
the entire negative half of this family's own axis sat outside the compatibility
contract in both languages — and the two builders agreed perfectly about
everything they were being asked about. Two golden worlds now cover it, chosen to
bracket the sun band:

```
surface-golden-hour   OCN-GOLDEN-SURFACE-17   -16.85 m   sun  6.3°   IB water
surface-daylight      OCN-GOLDEN-SURFACE-13   -14.84 m   sun 34.4°   III water
```

Both are read by the TypeScript cross-language test as well, and both are shot by
`scene-baseline`. Measured against the prototype's own two above-water presets:

| view | prototype | app, from a real generated world |
|---|---|---|
| golden hour | 0.378 · 0.24 · `#5e615e` | **0.380 · 0.21 · `#62615c`** |
| above water | 0.547 · 0.16 · `#808e95` | **0.580 · 0.12 · `#8c9699`** |

Golden hour matches to within 0.002 luma and four units per channel.

The general lesson is worth keeping separate from the ocean: **a renderer feature
that no seed can produce is a feature that does not exist**, and a fixture set that
covers only one side of an axis will report health while half the axis rots.

---

# Round three: the depth control, and five bugs the camera was hiding

Reported from two screenshots of the create page: picking **The Abyss** rendered the
water surface, and "two strange objects in the left and right corners following
along". Both were real. Chasing the second uncovered a chain of four further faults,
every one of which had been invisible because the camera was pointed away from the
thing that was wrong.

## 1. The depth control did not select a depth

`DEPTH & MOOD` offers four options named after depths — Still Water, Drifting, Reef
Surge, The Abyss — and each was a `zoneWeights` triple, a *probability* per zone, on
the reasoning that a hard mapping would make repeated generations samey. The Abyss
carried 15% weight on the shallows, and a shallow world had a one-in-three chance of
breaking the surface, so **picking the abyss drew a sea surface 5% of the time.**
That is not variety. A control the user selects is a coordinate, not a lean.

Four options, three zones and a negative half of the axis, so the table squares
without inventing anything:

| option | mood | zone | medium |
|---|---|---|---|
| Still Water | `focused` | sunlitShallows | **above the water** |
| Reef Surge | `energetic` | sunlitShallows | under |
| Drifting | `dreamy` | twilightReach | under |
| The Abyss | `reflective` | abyss | under |

`focused` is the one above the waterline, which also makes the surface the **first**
view of the family: the create form's mood state initialises to `focused`. "Still
water" describes a surface — there is no visible stillness at 142 m — and that mood
already carried the lowest current multiplier of the four, so it had the calmest sea
before any of this.

`surfaceBreachProbability` is gone. How often is no longer a probability; it is a
property of what the person chose. The rate test that guarded it (4–22% of oceans)
was replaced by the two-sided contract: picking it gets it every time, not picking it
excludes it every time. A rate is the right assertion for something nobody selects.

## 2. The two objects in the corners

The foreground fronds — four near-black tapered planes locked to the lens, the
prototype's single highest-value depth cue. Two things were wrong, and the prototype
documents the first itself:

- **They were drawn at every depth.** A frond is algae. At 142 m it is vegetation
  with no sunlight, growing out of nothing, two metres from a lens — so it cannot
  read as a plant, and anything in frame that cannot be read as *something* is read
  as a fault in the picture. Now gated on the flora's own physics: the seabed in
  sight, and the viewer within `algaeDepthLimitMetres`.
- **They were longer than the frame.** At 3.2–4.9 m tall, anchored at y ≈ −2 and
  z ≈ −2.5, they ran off the top of a 55° frame. A tapered blade whose tip you can
  see is a plant; the same blade with its tip outside the frame is a bar with two
  parallel edges, which is chrome. Halved, so the tips land near the centre line.

The prototype gets away with the length because its canvas is a narrow panel beside a
sidebar. A full-width 1.93:1 frame does not.

## 3. The camera never looked at the subject

This is the big one, and it explains the gap round two closed out with.

The prototype picks its **pitch** from which boundary is in frame, and states plainly
why aiming at the world origin instead is a bug: "the target used to be placed at
radius 16 from the WORLD ORIGIN while the camera orbits at radius 30, so every pitch
came out roughly half what it claimed: an intended 60 degrees rendered as 27, which
puts the entire frame OUTSIDE Snell's 48.6-degree cone."

Ours aimed at the origin from a raised position — about **10° down, always**, whatever
was in frame:

| what is in frame | prototype | ours |
|---|---|---|
| above water | −0.32, toward the glitter path | −10° |
| surface and floor | +0.42, window in the top third | −10° |
| surface only | **+1.05, 60° up into Snell's window** | −10° |
| floor only | −0.22, the plain | −10° |

Round two recorded the remaining gap as "the lit views are too dark and too
saturated… the next place to look is the window's own gain". The window's gain was
never the problem. **Snell's window was not in the frame at all.** No shader change
could have fixed a subject that is off camera.

Fixed by giving `CameraRig` a `restingTarget` — an absolute aim offset *from the
camera*, snapped on the first frame rather than lerped, because OrbitControls derives
the camera position from its target and moving the target drags the camera with it.

Two corrections came out of doing it:

- **Radius.** Pushing out to the prototype's 30 m was a clear regression: landmarks
  sit on a ring and 30 m stands on it. Kept at the config's 16–24 m. The prototype
  can orbit at 30 because it has no landmarks at all — it is a study with boulders.
  Copying its radius without copying its emptiness moved the problem into the frame.
- **Above-water pitch is −0.10, not −0.32.** Read from the prototype's *output*
  rather than its source: at 55° FOV, −0.32 puts the horizon 17% down the frame,
  while its published golden hour has it at about 40%. Both cannot come from −0.32,
  and they do not — it eases the pitch in at 0.02 per frame from level, so its
  screenshots are of an unsettled camera. The image is what was reviewed and liked.

## 4. Additive layers were being sRGB-encoded

Once the camera looked up, the reef clipped **100% of the measured band to pure
white**. Every component was a faithful port — the surface shader, the Preetham sky,
`uSkyGain`, both exposure curves, `uBrightness`, the fog density, the light rig, the
seabed tint, the boulder scatter, all byte-identical. The difference was four
`#include <colorspace_fragment>` lines added in a sweep that required every fragment
shader to route through the renderer's tone curve — enforced by a test I wrote.

That rule is right for shaders that **replace** what is behind them and wrong for
shaders **summed into** it. sRGB encoding is steep near black — a linear 0.15 encodes
to 0.40 — so encoding an additive contribution inflates it about two and a half times
before it is added. Four layers doing that at once (god rays, jellyfish, bubbles,
marine snow) is a haze over every underwater frame; on the god rays it was a white
screen.

The test now asserts the real rule, which it can do because the blending mode is
declared in the source right above each shader. **A test can enforce a wrong rule
perfectly.**

## 5. Two more of the same shape: content standing where the viewer stands

Both found by measurement, both the identical defect:

- **Landmarks** were placed at 0.50–0.88 of the basin radius. The basin is 26–38 m
  and the camera orbits at 16–24 m, so the ring landed at 13–33 m and overlapped the
  orbit almost completely. On the abyssal-plain fixture one came to rest 9.6 m from
  the lens and filled the frame with a pale slab measuring three times the
  reference's brightness — read at first as a seabed lighting fault. Now placed at
  `cameraDistance + 8 … + 34`, so the collision is impossible by construction.
- **Boulders** had the same problem: a fixed 5–34 m near band, 150 instances,
  straddling the orbit. Both bands now start 6 m outside it, keeping the prototype's
  widths so density and recession are unchanged.

The invariant these two now share, stated once: **content lives outside the viewer's
own position.** The basin is a scatter bound for dressing, not a wall — the test that
said "landmarks are inside the basin" was satisfied by a landmark standing exactly
where the camera does, which is how it passed for the whole life of the bug.

## 6. Two smaller ones, both real

- **The sand albedo was read as linear.** `CanvasTexture` defaults to `NoColorSpace`
  in three 0.171, so bytes spanning 0.41–0.70 as sRGB fractions were sampled as
  linear radiance instead of 0.14–0.44 — about two and a half times too bright, on
  the floor *and* the boulders, which share the map. Same class of bug as the colour
  constants in round two, in a different place.
- **The submersible lamp was a floodlight.** three.js applies no inverse-square term
  once `distance` is set: the whole falloff is `pow(1 - d/distance, decay)`, so the
  prototype's 140 m at decay 1.3 runs 1.00 at the lens to 0.75 at thirty metres. Its
  own note says the light should be "near field hot, mid field carved, far field
  gone"; its numbers do not do that. Now 40 m at decay 2, with the reach scaled to
  four times the floor clearance so the seabed arrives at one exposure across a
  clearance band of 2–9 m.

Also: the renderer was computing `pow(brightness, 1.3)` for god-ray strength while
the backend published `lighting.godRayStrength` from the depth curve and had it
ignored. It reads the config now. And `lighting.surfaceAzimuthRadians` is new —
the sun's compass bearing was a single shared constant, so every above-water world in
the family put its sun in the same place. It was the one authored parameter in the
prototype study with no counterpart here, and the prototype varies it per view.

## What the measurement instrument was doing wrong

Worth its own note, because it is the second time. `measure.mjs` cropped only the top
18% of app frames, on the stated reasoning that "the app has no side panel". The app
has four. They are frosted glass, so over bright water they go nearly white.

The tell was three columns agreeing and one screaming: on the open-water frame the
app matched the prototype on mean luma (0.670 vs 0.683), on saturation (0.52 vs 0.54)
and on mean colour (`#6abbcf` vs `#69bed9`) while reporting 18% of pixels blown
against 0.8%. That is not a possible property of the same water. Acting on the number
cost a round of camera tuning aimed at a highlight that was a UI panel.

App frames are now measured on the central band that is scene and nothing else. It
samples less of the frame; it samples only the frame.

## Where the six views land

Every one of the prototype's own presets, rendered by the app from the prototype's
parameters, measured on the corrected instrument:

| view | prototype | app | Δ luma |
|---|---|---|---|
| reef | 0.633 · 0.64 · `#4fb5d0` | 0.639 · 0.59 · `#55b6cd` | **+0.006** |
| abyssal plain | 0.191 · 0.60 · `#1a3543` | 0.205 · 0.24 · `#2e3636` | **+0.014** |
| golden hour | 0.378 · 0.24 · `#5e615e` | 0.406 · 0.26 · `#6c6760` | **+0.028** |
| twilight | 0.289 · 0.81 · `#17556b` | 0.257 · 0.96 · `#055069` | **−0.032** |
| open water | 0.683 · 0.54 · `#69bed9` | 0.721 · 0.46 · `#7bc6de` | **+0.038** |
| above water | 0.547 · 0.16 · `#808e95` | 0.632 · 0.09 · `#9aa3a6` | **+0.085** |

Total |Δluma| **0.203**, with no clipping anywhere — against 0.698 and 100% / 28.8% /
17.1% clipped at the moment the camera was first corrected. The reef, which round two
left 0.171 too dark, is within 0.006; the abyss, which was 0.358 too bright, is
within 0.014.

## What is left

- **Above water is +0.085 luma and −0.07 saturation.** It shares the −0.10 pitch with
  golden hour, which lands at +0.028, so the difference is the bright midday sky
  filling 40% of the frame rather than the framing itself.
- **Twilight holds saturation 0.96 against 0.81** with almost no local contrast
  (detail 0.03 against 0.10). It is a flat wash of one blue. The frame is a water
  column with no boundary in it, which is the hardest thing this family draws.
- **The create-page abyss is 0.422 against the world page's 0.177** on the same
  preset. Different seed, so a different floor clearance and camera distance; the
  spread within one preset is wider than it should be.

## The pattern across all six

Every one of these was invisible to every test, and every one was hidden by the same
thing: **the camera was not looking at it.** The god rays clipped a whole frame while
pointing off-axis. The landmark filled the frame only when the orbit happened to
coincide with the ring. The fronds read as chrome only at full width. The window's
gain was blamed for a subject that was off camera.

Which names the check this family still lacks: not another assertion about a number,
but a sweep that puts the camera where each view is *supposed* to look and measures
what is actually there.

---

# Round four: the check that was missing, and two answers of the form "no"

Round three ended by naming what this family still lacked: "not another assertion
about a number, but a sweep that puts the camera where each view is supposed to
look and measures what is actually there." That is built now. The other two open
items were researched and one of them turned out to have no defect behind it,
which is a result worth writing down rather than a gap to keep chasing.

## The frame budget

`src/features/scene-renderers/ocean/oceanFrameBudget.test.ts`, fourteen
assertions over the eleven committed ocean frames. It measures the tracked
screenshots rather than rendering anything — it cannot catch a regression before
someone re-shoots, but `e2e/shots` is tracked, so a drifting re-shoot fails the
build on the commit that carries it, with the offending image in the same diff.

Every bound is set where a real past defect sat, not at the edge of current
output:

| bound | the defect it would have caught |
|---|---|
| `blown ≤ 2%` | god rays clipping **100%** of a reef; the composer's dead tone curve |
| `crush ≤ 5%` | the lamp-off case at **65%** crushed |
| `luma` within ±0.09 of each preset | abyss **+0.358** (landmark at the lens), reef **−0.171** (window off camera) |
| `sat ≥ 0.30` underwater | deep water rendering grey at saturation **0.02** |
| **abyss darker than reef and twilight** | the abyss measuring 0.385 against its own reef's 0.380 |
| **reef ÷ abyss > 2** | the whole depth axis collapsing into a colour grade |

The last two are the valuable ones, because they are RELATIONS. Every individual
number in the inverted-axis bug sat inside a plausible range; only the order
showed it. A magnitude bound would have passed the frame where the deepest world
in the family drew the strongest sunlight.

Verified by mutation, not by passing: with `maximumBlown` set to 0 and one preset
pointed at the wrong image, six of the fourteen fail with the measured value in
the message. A budget nobody has watched fail is a budget that might be reading
zeros.

The measurement itself moved to `e2e/frameMetrics.mjs` so that `measure.mjs` —
the table a person reads — and the test that fails a build share one
implementation. Two copies of a measurement is two instruments that disagree, and
this family has already lost a round to an instrument that was wrong in the
direction of the answer being looked for.

## The twilight zone is flat, and the reference is wrong

Ours measures local detail 0.05 against the prototype's 0.10 at the same depth.
The cause turned out to be two separate things, and only one of them was a bug.

**The bug.** Every large animal in the frame rides a ring authored in absolute
metres — 118 m for the whale, 76 for the manta, 68 for the shark — while how far
you can see is not an absolute. In Jerlov I the sighting range is about 65 m, so
at 142 m depth the shark arrived at 34% of its contrast and the whale at 4%, which
is gone. What was left in frame was three hundred lanternfish 0.3 m long, and a
frame whose only visible inhabitants are 0.3 m long has no scale reference at all.

The ring is now clamped to the sighting range, which is a statement about the
medium rather than a tuning choice: **an animal further away than the water is
clear is not a distant animal, it is an absent one.** Near-field species are
untouched — every ring under about 60 m already sits inside the budget.

**The part that is not a bug.** That clamp moved detail 0.04 → 0.05, and the rest
of the gap should not be closed. Looking at the two frames side by side, the
prototype's twilight is populated by reef-shaped fish at 142 m, because it gates
nothing by depth — it is a style study and its species list is the same at every
depth on the slider. Ours gates by real depth bands, so at 142 m it draws
lanternfish, which are the most abundant vertebrate on Earth and live exactly
there.

So the remaining difference is that **our twilight is more correct and less
interesting.** Matching the number would mean putting animals where they do not
live. The honest next step is not to copy the prototype's population but to give
the mesopelagic the large animals that genuinely inhabit it — sixgill sharks,
squid, hatchetfish — and there are no CC0 models for those in the catalogue yet.
Recorded as content work, not as a rendering defect.

## The above-water sky: every constant already matches

The remaining +0.085 luma and −0.07 saturation on the midday sea was chased
through the whole sky path, and every value is byte-identical to the prototype:

- `turbidity 3, rayleigh 3, mieCoefficient 0.0035, mieDirectionalG 0.8` — the
  clear-maritime model, not three.js's hazy `turbidity 10 / rayleigh 2`
- `cutoffAngle 1.6110731556870734`, `steepness 1.5`, `EE 1000`, the same `sunfade`
- `preethamSky` itself, line for line, including the `19000×` sun disc
- `airExposure` = `0.26 · (0.62 + 0.38 · min(1, sinElevation/0.5))`
- air haze: 1200 m sighting range, fog density 1/1200 against the prototype's
  hand-written 0.00085

The framing matches too — both put the horizon about 40% down the frame.

There is no mismatch left to find, so no fudge factor is being added to close the
last 0.085. Note also that the two above-water reference frames disagree with each
other: the prototype eases its pitch in at 0.02 per frame, so its published
screenshots are of a camera still moving, and no single pitch matches both. Golden
hour, the showcase of the two, lands at +0.028.

## Four point nine megabytes that were never loaded

Six Poly Haven PBR maps were in the tree, staged, and referenced by nothing. They
were fetched to fix a striping artifact on the seabed; what actually fixed it was
giving the procedural noise a domain warp and integer wave numbers. Removed, with
the asset IDs kept in `ATTRIBUTION.md` so they are re-fetchable in one call.

Worth a line because the reasoning generalises: git history is permanent, and an
asset nobody loads is an asset the next person has to work out whether they are
allowed to delete.

## The instrument was wrong a third time, at the other viewport

Committing the baselines meant looking at the mobile set, which had not been
re-shot in a while. Re-shooting it produced this:

```
preview-ocean-abyss     0.161 | sat 0.27 | #2b2925
preview-ocean-drifting  0.159 | sat 0.27 | #2b2825
preview-ocean-still     0.160 | sat 0.27 | #2b2925
preview-ocean-surge     0.164 | sat 0.27 | #2c2a26
```

Four different seas, four numbers within 0.005 of each other and the same mean
colour to two digits. That is not a measurement of four scenes; it is a
measurement of one piece of furniture. The window was calibrated as fractions of
a 1440×900 frame, and the app does not scale to 375×812 — it RELAYOUTS. The
panels stop flanking the canvas and stack under it, so the desktop band landed
almost entirely on opaque card.

Two fixes, and the second is the one that matters:

- The window is now **derived from the frame's own pixel width** rather than
  passed in by the caller. A caller that has to declare which layout it is
  looking at is a caller that can declare the wrong one, and the failure is
  silent — which this instrument has now been guilty of twice.
- Frames that contain **no scene at all** are named and skipped instead of
  measured. The create page does not render its live preview at the mobile
  viewport; the form takes the whole page. Those four screenshots are worth
  keeping as layout baselines and are worth nothing as scene metrics. A metric
  that cannot fail is worse than no metric, because somebody eventually acts on
  it, and in this family somebody did — twice.

With the window calibrated, the mobile world pages measure properly and the depth
axis holds independently at the second viewport:

| preset | mobile luma | saturation |
|---|---|---|
| Reef Surge | 0.502 | 0.71 |
| Drifting | 0.389 | 0.86 |
| Still Water, midday | 0.536 | 0.14 |
| Still Water, golden hour | 0.335 | 0.23 |
| The Abyss | 0.193 | 0.14 |

Those are in the budget too, as six more cases. It is worth having both: the
mobile build is not the desktop one scaled — it drops to `quality: "low"`, with
fewer instances and a smaller shadow map — so a depth axis that only holds at
1440×900 holds by accident.

Counting this one, the measuring instrument has been wrong three times in this
family's life and each error pointed the same way: toward the answer being looked
for. It is the most reused component in the work and the least reviewed. Worth
remembering next time a number is surprising — check the ruler before the thing
being measured.

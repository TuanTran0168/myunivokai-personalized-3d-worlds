# Forest realism — where it stands and what is left

Companion to [forest-render-mechanism.md](../../knowledge/frontend/forest-render-mechanism.md), which
explains *how* the forest renders. This file answers the recurring owner
question: **"forest đang ở cấp độ nào, và nên cải thiện gì tiếp?"**

Written 2026-07-27, branch `feat/fe-be/scene-realism-pass`.

## Level today: 3 of 5 — "stylised realism"

| Level | Meaning | Status |
|---|---|---|
| 1 | Flat primitives, cartoon palette | passed |
| 2 | Real GLB assets, real HDRI | passed |
| 3 | **PBR materials, correct light ratios, AO, real water** | **here** |
| 4 | Vegetation density + variety that reads as a real biome | partial |
| 5 | Photoreal (SSR/SSGI, volumetrics, terrain-blended assets) | not attempted |

It no longer reads as "hoạt hình" (cartoon), which was the original complaint.
What keeps it off level 4 is **density and variety**, not shading.

## What got it to level 3 (do not undo these)

- **Key-to-fill light ratio ~3:1.** The old rig ran sun 1.35 against ~1.27 of
  combined fill — a 1:1 ratio, which is the optical signature of overcast studio
  light. That was the real reason the sun "chưa giống thật", not its colour.
  Constants live at the top of `ForestRenderer.tsx` with the reasoning inline.
- **N8AO ambient occlusion**, forest-gated in `shared/PostEffects.tsx`. Contact
  shadows are most of what makes objects sit *on* ground rather than float.
  Note: `EffectComposer` children types reject `null`, so effects are assembled
  as a filtered JSX array.
- **PBR ground relief** — Poly Haven CC0 normal + ARM maps in `ForestTerrain`.
  Albedo deliberately stays vertex-colour/season-driven; only the relief comes
  from the texture, so seasons still work.
- **Real trees** — Sketchfab game-ready fir/oak packs, split into variants.
- **Distant treeline + rolling far hills** so the world does not end at a flat
  slab edge (`ForestDistantTreeline.tsx`, `DISTANT_*` in `forestMath.ts`).
- **Water** — see below.

## Water system (`ForestWaterway.tsx`)

Two halves, built differently on purpose:

- **Lake** — planar, at the **origin**. `MeshReflectorMaterial` is a real
  render-to-texture mirror and needs a planar mesh; the clearing centre is the
  one part of the height field guaranteed flat
  (`CLEARING_FLATTEN_INNER_FRACTION`). Radius = `0.46 × clearingRadius`.
- **River** — follows the rolling terrain, so it *cannot* be a planar mirror.
  Gets env reflection + scrolling ripple normals + transparency instead. Moving
  shallow water hides the absent mirror; still water would not.

Ripple normal map is **procedural** — summed sines at *integer* frequencies,
which is what guarantees seamless tiling. Zero asset bytes, no attribution
obligation. Shared singleton, cloned per surface so each scrolls independently.

### The shoreline must not be a circle

First attempt used `circleGeometry` and the owner's verdict was immediate: *"Hồ
nước quá tệ nó giống như một hình tròn vậy."* A perfect circle never reads as a
lake at any material quality.

Fixed with `createWaterOutline` in `forestMath.ts`: a seeded sum of sine
harmonics giving `radiusFactorAt(angle)`. **The frequencies must be integers**,
or the loop fails to close at `theta = 2*PI` and leaves a visible notch at the
seam — the same constraint the ripple normal map has, for the same reason.
Amplitudes sum to 0.30, so the outline reaches `1.30 ×` the mean radius; that
figure is `maximumOutlineRadiusFactor()` and is what neighbours must clear.

The water surface and its shoreline band are generated from the **same** seed, so
the bank keeps a constant width around an irregular shore.

### Downloaded water assets: there is no supply

Asked for repeatedly, so this was **checked rather than argued**:

**Both** major CC0 libraries were queried, and neither has a water surface:

```
curl -s "https://api.polyhaven.com/assets?t=textures"                  # 786 assets
curl -s "https://ambientcg.com/api/v2/full_json?type=Material&q=water" # 12 hits
```

ambientCG's twelve "water" hits are `Ice001`–`Ice004` (frozen lake),
`Ground035`/`Ground083` (beach, river mud) and `SurfaceImperfections*` (stain
overlays). Poly Haven has zero water-surface normal maps. Every "water" tag hit is a **beach, sand, coral
or mud** ground texture (`aerial_beach_*`, `coast_sand_*`, `coral_*`,
`mud_cracked_dry_riverbed_002`). Poly Haven is the CC0 library this project
already uses for HDRIs and ground PBR, so if it were there we would have it.

A lake **GLB** does not help either, for reasons independent of supply: it is a
static baked mesh, so it can neither ripple nor drive a planar reflector, and it
would arrive with an arbitrary pivot/up-axis — the exact failure that sank the
baked-scene attempt (see [[forest-baked-scene-approach-failed]]). It also could
not match the terrain basin carved for it.

**Re-check before spending time on this again**: the blocker is supply, not
preference. If a CC0 water normal map appears, it drops straight into
`getRippleNormalTexture`'s slot.

### The animal "ping lag" was caused by a previous fix

Reported as *"động vật di chuyển đi lên rồi lại giật lùi về, giống kiểu ping lag"*.

At the end of its path an animal's `headingSign` flips, so the target yaw rotates
180°. An earlier pass replaced the instant flip with a smooth eased turn — which
at 3.2 rad/s takes about **0.98 s**. But translation never waited for it. The
standing-still pause was only `2 × 0.06` of the cycle ≈ **0.4 s**, so for the
remaining ~0.6 s the animal walked in its NEW direction while still facing the
OLD one. That is what reads as rubber-banding.

The instant flip had been ugly but never produced backwards motion. **The fix
introduced the bug.**

Now the turn rate is **derived from the pause duration**
(`π / (pauseSeconds × ANIMAL_TURN_COMPLETION_FRACTION_OF_PAUSE)`) so the two agree
by construction at any path length or walk speed, and the pause fraction rose to
0.11. Anything that changes path length, walk speed, or the pause must keep this
relationship — a fixed turn rate cannot.

### Gerstner waves, and the folding they cause

Summed sines are symmetric and rounded, which made the surface read as regular
diagonal banding. Real waves are **sharp at the crest and flat in the trough**,
and that asymmetry comes from vertices moving **horizontally** toward crests, not
from a taller vertical wave. So the displacement is now Gerstner, with 8 waves
instead of 4.

Two things this forces:

1. **Rest positions must be stored.** The wave phase is evaluated at the
   undisplaced XY. Reading it back from the live position attribute feeds the
   displacement into its own input and the surface drifts away every frame.
2. **The mesh folds where the lateral shift exceeds local vertex spacing.** At the
   outline's 192 segments it folded almost everywhere — inverted triangles get
   backface-culled, so it shows up as flickering holes. Fixed by a 96-segment
   surface grid (independent of the outline's own resolution), a centre taper on
   the sideways shift only, and steepness 0.35.

Verified with an orientation test rather than by eye: **0 folded triangles across
33,024 checks** (4,128 triangles × 8 time samples). **Re-run that test after any
change to steepness, wave amplitudes, ring count or segment count.**

### From overhead you see the BOTTOM, not the sky

The realisation that mattered most, and it took far too long. **The camera looks
nearly straight down. At normal incidence water's Fresnel reflectance is about
2%.** So from this viewpoint a lake shows its bed through the water — the
turquoise in every lake photo is *pale rock seen through shallow water*, not a
reflection.

Every earlier pass had built an **opaque** surface and then tried to make it
convincing with reflection and shading. That cannot work from above: an opaque
dark disc is a spill of liquid, not water.

What changed:

- **`MeshReflectorMaterial` is gone.** It cost a full extra scene render to
  produce a uniform dark wash. A mirror only earns its cost at grazing angles;
  the environment map covers those.
- **The water is translucent** (`LAKE_SURFACE_OPACITY`). This is the realism
  mechanism, not a stylistic choice.
- **`ForestTerrain` paints the carved basin as a lake bed** — pale sand at the
  margin shading to dark silt with depth. Seen through translucent water, that
  gradient *is* the lake's colour. Left grass-green, the lake read as a lawn
  under glass.
- **Normal map strength halved** to 0.22; at 0.45 the tiled ripple map read as a
  repeating carpet of dark squiggles. The geometry waves carry the motion now.

**If the camera ever becomes shore-level by default, revisit this** — the
trade-off inverts and a real reflector starts paying for itself again.

### Two silent geometry bugs behind the "splat" look

Both were invisible in code review and obvious once measured (peak second
derivative of the shoreline radius — how sharply the shore kinks):

1. **Branching on the sign of the excursion put a corner at every
   bay↔headland transition.** `if (excursion < 0) excursion *= GAIN` steps the
   derivative from 2 straight down to 1 at each zero crossing. Weighting the gain
   through a sigmoid keeps it C1. **Kink 967 → 12.4.**
2. **A hard `Math.max` floor gave flat-bottomed bays joined by sharp corners.**
   Now the depth approaches the floor asymptotically — linear near zero, so
   shallow bays are unchanged.

### Measure the shoreline instead of eyeballing it

The outline kept being called puddle-shaped after several rounds of tuning. The
useful move was to **measure** it: limnology's **shoreline development index**
= perimeter ÷ perimeter of a circle of equal area. A perfect circle is 1.00; real
lakes run **1.5–3.0**.

The "organic" outline scored **1.09** — mathematically almost a circle. That
settled it: the eye was right and the tuning had been cosmetic.

Raising harmonic amplitudes only reaches ~1.37 and costs 2.5 units of tree band,
because it grows headlands as well as bays. What works is
`WATER_OUTLINE_BAY_DEPTH_GAIN`: **amplify inward excursions only.** Bays cut in,
headlands stay put, so the maximum radius — which is what bounds the tree band —
is unchanged.

| configuration | SDI | kink | tree band |
|---|---|---|---|
| 5 smooth harmonics | 1.09 | — | 17.2 |
| 8 harmonics + bay gain, hard clamp | 1.58 | 967 | 16.9 |
| **5 harmonics + smooth bay gain** | **1.18** | **12.4** | **16.7** |

**SDI alone is gameable, and I gamed it.** Pushing high harmonics (17, 23) drove
SDI to 1.58 and the result read as a jagged splat: SDI counts perimeter and cannot
tell one big sweeping bay from a row of small notches. Real shorelines are
**smooth curves with a few large bays**. The shipped version scores *lower* on SDI
and looks considerably better.

**Use both numbers.** SDI for how convoluted, kink for how smooth. Optimising
either alone produces a characteristic failure: a circle, or a splat.

**Both numbers are tests now** (`forestFidelityMetrics.test.ts`), and the table
above is a hand measurement of configurations that no longer ship — read it as
history, not as the current score. Measured over 4000 seeds, what ships scores:

| | measured range | threshold |
|---|---|---|
| development index | 1.155 - 1.197 | > 1.15 |
| kink | 7.9 - 17.8 | < 50 |

The index floor sits about 0.005 above its threshold, so any change that rounds
the shoreline off will trip the test rather than pass quietly.

The same round turned the wave-fold claim into a test and found it false for the
landmark ponds — see [deferred-work-plan.md](../../memory/execution-records/frontend-deferred-work.md) Part B.

### Islands

An unbroken sheet of water reads as a puddle however large. Islands are the
cheapest strong counter-cue here: the water is a sheet at a fixed height, so any
terrain rising past it simply emerges — **no extra mesh, no hole cut in the
water**, just a bump in the height field taken as a `max` (not a sum, or the
islet inherits the bed's slope).

The one subtlety: an islet must be placed by **testing its whole rim** against
the shoreline, not by estimating from its centre. With bays at 0.3× the mean
radius and headlands at 1.5×, an islet sitting comfortably inside a headland can
have its far side in the next bay, where it merges into the bank and becomes a
peninsula. Estimating from the centre left ~⅓ of islands like that; rim testing
with an inward pull-in leaves none.

### Water colour

Water has almost no colour of its own — what you see is the sky and the far bank.
The palette was a saturated `#2E6E8E` pool-blue, which against desaturated
woodland is one of the strongest fake signals in the scene. It survived several
passes **because each pass judged the surface, not the palette.** Now dark
blue-greens (`#22414C` and friends), and the shore band is wet earth rather than
dry olive.

### Puddle vs lake is scale and silhouette, not material

After the surface had displaced waves, sharp reflection and a good normal map,
the verdict was still *"nhìn nó giống vũng nước hơn là hồ nước"*. The lesson:
**no amount of surface work makes a small round body of water read as a lake.**
Three things decide it, all geometric:

1. **Size relative to the scene.** The lake was ~26 units across in an 80-unit
   forest — 11% of the forest's area. Now 1.35 × clearing, ~35 units across,
   **21%**. Scale is judged relative to surroundings, not absolutely.
2. **Elongation.** Puddles are round; lakes lie along a valley. Outline harmonic
   2 now carries most of the amplitude (0.26 against 0.075/0.05/0.032/0.02), so
   every seed comes out around **2:1**, pointing in a seed-dependent direction.
   The high harmonics only add inlets on top of that long axis.
3. **Something recognisable at the waterline.** Water with a bare ring around it
   reads as a puddle because there is nothing to judge size against.

That third point reversed an earlier change. The planting buffer had been applied
to the combined sampler, pushing **trees and decor** off the bank — which
produced exactly that bare ring and made things worse. Now only
`ForestTrees` gets `treePlantingDistanceSampler`; grass, ferns and rocks keep the
unbuffered `clearFloorDistanceSampler` and run down to the water.

**The ceiling on lake size is the tree band.** Trees start at
`maxShoreline + 1.6 + 2.8`. At 1.35 × clearing that is 22.8, leaving a 17-unit
band before the treeline at 40. Push the lake much further and the forest stops
being a forest.

**This change broke the animal wander band and it was silent.** The outer bound
was `min(2.4 × clearing, 0.8 × treeline)` = 22.8, which fell *below* the new
inner bound of 20.2 + margin, collapsing the band to its 4-unit floor. It is now
treeline-relative. **Any future lake resize must re-check every radius in the
table below** — they are coupled, and the failure mode is a silently degenerate
range, not an error.

### What finally decided it: the viewpoint, not the water

Six rounds of shape, scale, palette and wave work all ended in *"vẫn giống vũng
nước"*. The measurable reason was never in the water.

The opening camera sat at the backend's rolled `camera.distance` of 14–20 with
its height at `0.42 ×` that, aimed at the origin. Against a lake whose outer
radius is 16–22 for the same clearing range, **the camera stood inside the
lake**, six to eight units above the surface, looking down at 22.8°. The bottom
edge of a 50° frame then lands on open water at ~0.62 × the camera distance, so:

- the near bank is **cropped out of frame entirely** — no foreground, no scale
  reference;
- the far bank sits in the middle distance under a tall band of forest, so the
  **forest wins the frame** and the water reads as small;
- at near-normal incidence the surface shows ~2% reflection, so it never picks
  up the sky either.

Pulling further back does not help — it only shrinks the lake. Every reference
photo the owner sent is taken **from the bank**: a strip of shore at the bottom,
water receding at a grazing angle, far shore and treeline compressed toward the
horizon. Perspective does what no amount of shoreline detail can.

`forestShoreCameraFraming` (in `forestMath.ts`) now derives the opening camera
from the lake instead of rolling it independently:

- it stands on the shoreline radius **at its own azimuth** — the mean radius is
  useless here, since the outline swings 0.3×–1.48× and a camera placed against
  the mean stands in the water on any seed that bulges along +Z;
- the standoff is **solved**, not tuned: standoff and look-down angle each
  depend on the other, so a constant that frames the waterline at one clearing
  radius misses at the rest of the range. Six fixed-point passes;
- the standoff is clamped inside `LAKE_SHORE_PLANTING_BUFFER` (2.8 → **4.5**),
  which is what guarantees no trunk stands between the camera and the water.
  Everything on that segment is closer to the water than the camera is, so one
  comparison clears the whole line;
- the eye rises if the bank's own crest would block the sight line to the far
  shore. Rare — 4 cases in 1080 — but when a grazing view is blocked it is
  blocked completely, so the guard is worth its cost.

Measured over 180 terrain cases spanning the backend's whole range
(clearing 8–11, hill amplitude 0.8–2.2):

| Property | Before | After |
|---|---|---|
| Look-down angle | 22.8° | 4.31°–15.51° |
| Camera vs shoreline | inside the lake | 3.22–4.00 units of dry bank |
| Water share of frame height | near bank not even in frame | **≥ 41.6%** |
| Trees between camera and water | possible | impossible by construction |

**Accepted limits, all measured rather than assumed:**

- The foreground strip of bank is lost on 18 of 180 seeds, where the standoff
  hits its clamp. Widening the buffer to 5.2 fixes most of them but costs a
  steeper view and another unit of tree-free ring — the wrong trade.
- An islet interrupts the far water on ~19% of seeds. The blockers are always
  **past the lake centre** (measured at radius −1.2 to −5.2, ground 0.47–0.74
  against island peak 0.75), so the near half always reads. Overlapping
  silhouettes are a depth cue; left alone. Raising the eye to clear an islet
  near the far shore would need ~4.5 units of height and would throw away the
  grazing angle.
- Only the central sight line is guaranteed clear of trunks. Off-axis rays can
  cross a bay that recedes further than the bank.

**The bank itself is almost never the occluder** — the shore blend slopes the
ground down to exactly 0 at the waterline, so there is no crest to see over.
That was the first hypothesis and it was wrong; the 10.5-unit occlusions in the
first measurement were islands.

### The lake was a literal plane

The single biggest cause of *"nhìn vẫn còn giả"*. The surface was a triangle fan:
one centre vertex, a ring of boundary vertices, **all at the same height, no
interior geometry at all**. No material rescues that — a flat sheet reflects the
sky uniformly and reads as painted plastic however good the normal map is.

It is now a tessellated radial grid (22 rings × 160 segments ≈ 3.5k vertices,
6.9k triangles) **displaced every frame** by four travelling waves whose
directions are unaligned and whose wavelengths are not integer multiples — so the
sum never settles into a pattern. Measured: **0.378 m peak-to-trough, 10.5° max
slope.**

Normals come from the **analytic derivative** of the same height field, not from
recomputing face normals — that would cost a full index-buffer pass per frame and
come out faceted anyway.

Verified before shipping (a bad index buffer shows as holes, which is invisible
until rendered): no edge shared by more than two triangles, zero degenerate
triangles, 204 boundary edges = 160 rim + 44 seam (the seam vertices are
coincident and get identical displacement, so it cannot crack).

**Two constraints that bit during this change:**

- Waves must taper to nothing at the rim, with a **smoothstep** — a linear taper
  leaves a visible crease where it starts and keeps enough amplitude at the edge
  for a trough to dip through the shoreline band.
- `WATER_SURFACE_HEIGHT` must stay **low** (0.07). Raising it to clear the
  deepest trough leaves the water visibly perched above its own bank like a
  filled pool. It does not need to clear anything: the rim is calm, and the
  interior has a carved bed a metre down.
- The shoreline band is an **annulus**, not a disc, tucked `SHORELINE_UNDERLAP`
  under the water. A disc under the lake would z-fight the water everywhere.

### Why the surface read as plastic

Verdict was *"mặt hồ như miếng nhựa không giống nước"* with a visible square grid.
Three separate causes, and the first pass had fixed only the third:

**1. The ripple map was a lattice.** It summed four plane waves at frequencies
rounded off an evenly spaced fan — a textbook interference grid. Measured
self-correlation across the tile 0.852 (1.0 = exact repeat). Now 18 waves with
irregular frequency vectors: 0.618.

The wave count was chosen by sweeping, and **more is worse** — amplitude falls as
`1/λ²`, so extra high-frequency waves add almost no slope while still enlarging
the normalisation sum, flattening the water:

| waves / maxFreq | self-correlation | slope spread |
|---|---|---|
| 4 / 4 (old) | 0.852 | — |
| **18 / 7 (shipped)** | **0.618** | **0.136** |
| 28 / 9 | 0.700 | 0.116 |
| 48 / 13 | 0.605 | 0.090 |

**2. The second ripple layer was dead code.** `ForestPondWater` built a second
scrolling texture and advanced its offset every frame — and never bound it to
the material. The comment claimed two interfering layers; there was one, sliding
in a single direction, which is exactly what reads as a dragged plastic sheet.
It now feeds `distortionMap`, at `0.62 ×` the normal layer's tile scale and
scrolling the opposite way, so the two cannot correlate.

**3. Ripples were sized in UV, not world units.** A fixed texture repeat means
ripples scale with the surface, so making the lake hero-sized also gave it
metres-wide ripples. Repeat is now `diameter / RIPPLE_WORLD_TILE_SIZE`, and the
river's repeat was matched to it so both bodies of water have the same physical
chop.

Depth cue comes from **vertex colours** (dark centre, bright shallows) rather
than `MeshReflectorMaterial`'s depth-blend options — see below for why those are
unusable here.

### The reflector blew out

The first tuning showed white patches with a visible grid. Two causes:
`mixStrength 2.2` pushed the reflection past the sky's own brightness, and the
depth-blend parameters (`depthScale`, `minDepthThreshold`, ...) need a depth
buffer that this scene's **alpha-masked foliage does not populate cleanly**, so
they banded. Reflection is now a support term: `mixStrength 0.8`, `mirror 0.4`,
no depth blending.

**Only one reflector per scene.** The landmark pond had a second one, which at
its size appeared purely as a blown-out white blob for the cost of a whole extra
scene render. It now uses environment reflection (`reflective={false}`).

### Terrain sampler split

`clearFloorDistanceSampler` (path + water) goes to **trees and decor** only.
`ForestTerrain` gets the **path-only** sampler, because that sampler also *paints*
the ground as bare dirt — running it over the river turned the channel into a
wide tan road across the whole clearing.

### Making the lake big required carving the terrain

The lake started at `0.46 × clearing` and the verdict was *"Hồ nước phải to đùng"*.
It is now `0.85 × clearing`, which **does not fit inside the terrain's naturally
flat zone** (`CLEARING_FLATTEN_INNER_FRACTION` = 0.65). Simply enlarging the disc
puts rolling hilltops through the middle of a planar water surface.

So `createTerrainHeightSampler` now **carves a basin**. This is the load-bearing
detail: the carve is driven by the **signed** shore distance
(`createLakeSignedEdgeDistanceSampler`), not the clamped one. Driven from the
clamped distance the bed is flat at full depth right up to the shoreline, and the
water plane ends up perched on a vertical wall as deep as the lake. Signed, the
surface passes through exactly zero at the waterline: it shelves down to
`LAKE_BED_DEPTH` over `LAKE_BED_SHELF_WIDTH` going in, and climbs back to the
hills over `LAKE_SHORE_BLEND_WIDTH` going out.

Verified numerically before shipping (worth redoing after any change here):
shoreline discontinuity 0.0001 m, highest terrain inside the lake exactly at the
waterline, depth profile `0 → −0.13 → −0.47 → −1.33 → −1.80` at 0/0.5/1/2/3 m in.

### Angle convention — easy to get silently backwards

The water mesh is built in local XY and laid flat with a `-PI/2` X rotation, which
maps local `(x, y)` to world `(x, -y)`. So the world angle `atan2(z, x)` is the
**negated** authoring angle — hence `waterOutlineAngleAt`. Get this wrong and the
shoreline is mirrored relative to every exclusion test, which shows up only as
objects standing in water exactly where the outline bulges. Checked: worst
geometry-vs-sampler mismatch 3.55e-15.

### The river must not cross the lake

First version ran one ribbon from `-span` to `+span` through the origin, so a
light strip with its own banks was drawn on top of the water — *"nó bị sông đè lên
rồi"*. Now there are **two** ribbons, outflow and inflow, each starting at
`riverLakeExitDistance` (the outline radius at the river's own heading, so the
mouth lands on the shore even where the lake bulges) minus a small overlap.

### Things the backend positions by radius alone

`landmark.radiusFromCenter` comes from Nature DNA and knows nothing about the
lake, so lanterns and shrines stood in open water. `ForestRenderer` computes
`shoreClearanceRadius` and both `ForestLandmarks` and `ForestWildlife` clamp to
it. **Anything new placed by radius needs the same treatment.**

**The radii are a coupled set. Changing one breaks another:**

Defaults are clearing 9.5, treeline 40.

| Feature | Radius | Why |
|---|---|---|
| Lake (mean) | `1.35 × clearing` ≈ 12.8 | hero-sized; requires the terrain carve |
| Lake (max, bound) | `1.48 × mean` ≈ 19.0 | `maximumOutlineRadiusFactor()` = 1 + Σ harmonic amplitudes; measured outlines peak below it, so the bound is deliberately conservative |
| `shoreClearanceRadius` | max + 1.8 ≈ 20.8 | dry land for landmarks and animals |
| Animal wander | 20.8 → 28.0 | outer is `0.7 × treeline`; a clearing-relative outer now falls *below* the inner bound |
| Tree scatter | starts ≈ 23.5 | `clearFloorDistanceSampler` minus the 4.5 planting buffer |
| Opening camera | local shore + 3.2…4.0 | `forestShoreCameraFraming`; must stay inside the planting buffer or a trunk blocks the lake |
| Decor scatter | `0.9 × clearing` ≈ 8.6 | **unbuffered** — runs to the waterline on purpose; ~10% of picks skipped |
| River span | `0.82 × treeline` | stops short of `DISTANT_RISE_INNER_FRACTION` so the channel never climbs the far ridge |
| Shore band width | `0.075 × lake radius` | proportional; a fixed width becomes a hairline once the lake is big |

Water is a no-grow surface exactly like the dirt path, so
`createRiverEdgeDistanceSampler` is composed with the path sampler into one
`clearFloorDistanceSampler` in `ForestRenderer`. Consumers (terrain texture,
trees, decor) did not have to learn about the river.

## Wildlife: the "giật lùi về" bug

Animals occasionally jerked/teleported backwards. **Two independent causes**,
both fixed in `ForestWildlife.tsx`:

1. The ping-pong heading flipped a full 180° on a single frame at each
   waypoint. Now the yaw eases at `ANIMAL_YAW_TURN_RATE_RADIANS_PER_SECOND`,
   so the turn happens during the existing end-of-path pause.
2. `elapsedSeconds` accumulated **raw** `deltaTime`. Any frame hitch — a GLB
   finishing its decode, tab blur, a shader compile — hands `useFrame` one huge
   delta, which jumps the ping-pong parameter far enough to teleport the animal,
   sometimes visibly backwards along its own path. Clamped to
   `MAXIMUM_ANIMAL_FRAME_DELTA_SECONDS` (1/15s).

Lesson worth generalising: **any `useFrame` that integrates a looping parameter
needs a delta clamp**, or a hitch reads as a teleport.

Separately, feet-not-stepping was a clip/ground-speed mismatch, fixed by
driving `action.timeScale` from the config `walkSpeed`
(`WALK_CLIP_TIMESCALE_PER_WALK_SPEED`) and freezing it to 0 during the pause.

## Next, in value order

1. **Undergrowth density (biggest remaining win).** `MAXIMUM_DECOR_PIECES = 90`
   over the whole floor is sparse; real forest floors are cluttered. Wants
   instanced grass cards, not more GLB props.
2. **Terrain-blended tree bases.** Trunks meet the ground on a hard line. A
   ring of moss/litter cards at each trunk base is the cheap fix.
3. **Volumetric god rays** for the `sunRays` weather kind — currently only a
   light-intensity multiplier.
4. **Still-stylised on purpose:** birch (white bark *is* the species identity),
   dead trees, snow pine. Upgrade only if they specifically look wrong.
5. **Water polish:** shoreline foam line, and depth-based colour ramp so the
   lake middle is darker than its edge.
6. **Now that the view grazes the water,** two things that were invisible from
   above start to matter: the ripple normal map tiles every 2.4 world units and
   will streak under strong anisotropic compression, and the far shoreline is a
   hard line with no haze. Check both before adding anything else to the water.

## Performance budget — unverified

Per forest, desktop: ~180 LOD0 trees + ~260 distant trees + N8AO + 3072²
shadow map + a 512² reflector re-render (the lake draws the scene twice).

**No real-device FPS measurement has been taken.** If it stutters, turn these
knobs in this order — cheapest visual loss first:

1. lake reflector `resolution` 512 → 256
2. `SHADOW_MAP_SIZE` 3072 → 2048
3. `ForestDistantTreeline` counts
4. `trees.countDesktop`

## Asset rules learned the hard way

- **Geometry is the bottleneck, textures are cheap.** Poly Haven trees were
  57.9 MB (smallest) to ~900 MB of `.bin` — unusable. Sketchfab game-ready packs
  are the right source.
- **Draco for static geometry, meshopt for animated/skinned.** Draco destroys
  skeletal animation.
- **Never run `simplify` on alpha-masked foliage.**
- **Check `isDownloadable` + license slug BEFORE downloading.** An API token
  cannot override an author's download setting — three candidate models 403'd.
- **Do not use whole-scene "baked" meshes for the forest.** Tried and reverted;
  see the `forest-baked-scene-approach-failed` memory. Display scenes carry
  arbitrary up-axis/pivot and some are aerial photogrammetry tiles — they render
  as tilted floating slabs with the animals underneath.

## Rare features

`solar-system/rareFeatures.ts`. Black hole walked 6% → 20% → **40%** (owner
decision: it is the showpiece and should be easy to find while iterating). The
contract test bound in `rareFeatures.test.ts` moved with it and now asserts
`< 0.5` — "rare" must never mean the majority case.

The 20% step alone did not make it findable, and that turned out **not** to be a
probability bug: `DistantBlackHole` sat at radius 30 while `CameraRig`'s
`ORBIT_CONTROLS_MAXIMUM_DISTANCE` is 26, so it was parked outside the view cone
almost always. Now at radius 18, elevation 7. **Placement is constrained by the
camera envelope, not by taste.**

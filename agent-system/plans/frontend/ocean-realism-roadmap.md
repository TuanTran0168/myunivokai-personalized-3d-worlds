# Ocean realism — the camera breach, the seabed, and what is left

Companion to [ocean-service-plan.md](../services/ocean-service-plan.md) and to the
prototype study in [`demos/ocean-depth-rig`](../../../demos/ocean-depth-rig).
Sibling of [forest-realism-roadmap.md](forest-realism-roadmap.md), and written for
the same recurring owner question: **"ocean đang ở cấp độ nào, và nên cải thiện
gì tiếp?"**

Written 2026-09-01, branch `feat/fe/world-entry-cinematics`.

Every constant quoted here was read from the source, not remembered. Where a
claim is an inference rather than a reading, it says so.

## The headline: the "wall of light" is the camera leaving the water

The owner's own diagnosis was right, and it is worth stating plainly because two
earlier rounds of work looked in the wrong place:

> *"Lỗi quay camera xuống dưới phản chiếu ánh nắng mặt trời tôi nghĩ là do góc cam
> đã bị trồi lên trên mặt nước… tôi thấy nó còn mất hết các model động vật nữa,
> chỉ có trồi lên mặt nước mới thế thôi."*

The camera really does rise above the water plane. Everything else — the blown
highlights, the lost saturation, the vanished animals — follows from that one
fact. Two prior investigations chased the shader instead, and both were wrong:

| Hypothesis | Verdict | How it was settled |
|---|---|---|
| Bloom stacking (mood × style multipliers) | **disproven** | Forcing `bloomIntensity` to ~0 made `meanLuma` *rise* 0.7368 → 0.7559 |
| Excess brightness in the Snell's-window shader | **treating a symptom** | Owner rejected it twice: *"Tăng độ sâu là khoảng cách không phải giảm ánh sáng do độ sâu"* |
| Camera crosses the waterline | **confirmed, with numbers** | Below |

### The geometry, exactly

The rig is built in a **camera-relative frame**. The orbit target is *not* the
world origin, and the orbit radius is *not* the backend's `camera.distance`:

| Quantity | Value | Source |
|---|---|---|
| Water surface plane | `y = +viewerDepthMetres` | `oceanRig.ts:536` |
| Seabed group | `y = -floorClearanceMetres` | `OceanRenderer.tsx:315` |
| Camera at framing time | `y = 0` | `oceanMath.ts:519` |
| Orbit target | `y = sin(pitch) × OCEAN_AIM_DISTANCE_METRES` | `oceanMath.ts:532` |
| `OCEAN_AIM_DISTANCE_METRES` | `20` | `oceanMath.ts:422` |
| Pitch, surface **and** floor in reach | `0.22` rad → target at **+4.364 m** | `oceanMath.ts` (`oceanCameraPitch`) |
| `ORBIT_CONTROLS_MAXIMUM_DISTANCE` | `26` | `CameraRig.tsx:28` |
| `ORBIT_CONTROLS_MAXIMUM_POLAR_ANGLE` | `Math.PI` — **no clamp** | `CameraRig.tsx:30` |

Because the target is built as a 20 m offset *from the camera*,
`|target − camera| = √((20 cos p)² + (20 sin p)²) = 20` exactly. **The orbit
radius is a fixed 20 m.** The backend's `camera.distance` (16–24 m, from
`minimumCameraDistance = 16.0` and `cameraDistanceRange = 8.0` in
`ocean_scene_profile.go:718-719`) only decides where the camera stands relative
to the world origin and where the landmark ring sits. It never reaches
`OrbitControls`.

So the reachable camera height is `target.y + R·cos(φ)`, maximised at φ → 0:

- at the resting radius: `4.364 + 20 = 24.36 m`
- after a scroll-zoom to the 26 m cap: `4.364 + 26 = **30.36 m**`

Against a water plane at `depthBandByZone[sunlitShallows] = {12, 32}`, that means
**91.8 % of sunlit-shallows worlds can be breached** once the visitor zooms out,
and 61.8 % without zooming at all. Twilight (45–170 m) and abyss (1050–3800 m)
are unreachable; above-water worlds take the correct `above` code path.

Dragging *down* with the mouse is the breach direction: `OrbitControls.rotateUp`
subtracts from φ, so a downward drag walks the camera up over the pole.

### Why the frame goes white, and why the animals go with it

`above` is computed **once, at rig build, from the config depth** —
`isAboveWater(v) = v < 0` (`oceanOptics.ts:449`), called at `oceanRig.ts:224` —
and it drives roughly fifteen build-time decisions. It is never re-evaluated. So
when the camera breaches, the rig still believes it is underwater and:

1. **The from-below surface shader paints zenith sky.** It measures the critical
   angle with `float upness = abs(dot(view, tilted));` (`oceanRig.ts:509`). Seen
   from above, `dot ≈ −1`, `abs` makes it `+1`, `sinTheta ≈ 0`, so
   `window = 1.0` across the whole downward hemisphere and the fragment is raw
   Preetham sky — the same value it would give looking straight up.
2. **The one term that dims it is a distance term, and breaching collapses it.**
   `swallow = 1 − exp(−(d·uFogDensity)²)` with `d = length(vWorld − cameraPosition)`
   (`oceanRig.ts:526-528`). From one metre above the sheet, `d = 1` and
   `swallow ≈ 0.0004`. Nothing is removed.
3. **The renderer is still metered for water.** `adaptationExposure()` is roughly
   4–5× the `airExposure()` the same rig would use for the same sun
   (`oceanRig.ts:260-261`, `oceanOptics.ts:394-397` and `:444-446`), and three.js
   applies it globally to the sky sheet now filling the frame.
4. **The animals are not culled — they are occluded.** Verified directly:

   ```
   PlaneGeometry(900, 900, 280, 280)          oceanRig.ts:474
   side: DoubleSide, transparent: true        oceanRig.ts:477-479
   (no depthWrite override → depthWrite true)
   gl_FragColor = vec4(color * uBrightness, 1.0)   oceanRig.ts:530  ← alpha 1
   surface.position.x/z = cameraPosition.x/z      oceanRig.ts:906-907
   ```

   A 900 m, alpha-1, depth-writing sheet that follows the camera in x/z is, from
   above, **an opaque lid over the entire scene**. Everything below is
   depth-rejected. Fauna has no `.visible` gate and `frustumCulled = false`
   (`oceanRigFauna.ts:1531`); it is simply on the far side of the lid, and is
   additionally clamped below the surface plane by construction
   (`oceanRigFauna.ts:1667`, `:1719`, `:1829`, `:1847`).
5. **The god rays keep accumulating** below `uSurfaceY` only
   (`oceanRig.ts:619`), additive, `depthTest: false`, so they lay an unbounded
   wash over the bright lid in the lower half of the frame.
6. **There is no sky.** The backdrop stays the underwater dome — a 420 m shell
   whose own `swallow` term saturates to flat fog colour — because the `9×`
   above-water rescale at `oceanRig.ts:449` is gated on `above`.
7. **There is no wave surface to look down on.** `seaTop`, the correct
   from-above water (real reflected sky, foam, whitecaps), is only constructed
   `if (above)` (`oceanRig.ts:546`).
8. **The foreground fronds survive**, at 2.2–2.6 m from the lens with
   `renderOrder = 4000`. Two black blades in the corners against a white sheet is
   exactly the reported frame.

### The prototype could never do this

`demos/ocean-depth-rig` pins its camera at `y = sin(t·0.42) × 0.3` — a ±0.3 m
breathing — and moves *the world* instead, with an explicit note that the
waterline "is the one thing in this scene that must never move with the camera"
(`ocean-scene.js:3092-3097`). It needs no orbit clamp because it has no orbit.
**Production replaced that with a real orbit and did not carry over the
constraint that made it safe.** That is the whole regression.

### The invariant

Let `V` = `viewerDepthMetres`, `T_y` = orbit target height, `R_max` = the largest
orbit radius `OrbitControls` permits, `A` = the surface sheet's peak crest
displacement, `n` = the camera near plane. The camera must stay below the
sheet's lowest *trough*, not its mean plane:

```
T_y + R_max + A + n  <  V          (unconditional form)

φ_min ≥ arccos((V − A − n − T_y) / R_max)    (clamped form, when the argument < 1)
```

Substituting today's numbers: `4.364 + 26 + 1.4 + 0.1 = 31.86 < V`. The band's
own ceiling is 32 m. **So raising the depth band alone cannot fix this** — it
would collapse the band to `[32, 40]` against `orangeDeathMetres = 40.0`, which
is the hard `sunlitShallows` ceiling in `depth_curve.go:82`. The owner's
instinct (increase the distance) is the right *axis*; the lever has to be
`R_max` and `T_y`, not `V` alone.

> **Corrected while implementing.** Two of these terms were wrong, and the
> unconditional form was the wrong form to reach for.
>
> `A = 1.4` was a guess. The crest is not a constant: the sheet is a
> Pierson–Moskowitz realisation driven by a wind the world carries, `Hs = 0.0214
> U²` over `U ∈ [5, 13]`, so `A` runs from 0.54 m to 3.36 m — more than double
> the figure used here at the windy end. The shipped clearance derives it from
> the world's own wind rather than assuming one.
>
> And `R_max` is not a constant of the problem either; it is whatever the
> visitor has scrolled to. Written as an unconditional inequality it looks like
> a fixed budget to be met by shrinking `R_max` or growing `V`, which is what
> sent this section toward a distance cap. The **clamped form is the one that
> matters**, evaluated live: `φ_min` is a function of the current radius, it
> costs nothing at the close end, and it needs no change to `R_max` or `V` at
> all. See work item 1 for what shipped.

## Work item 1 — stop the breach — DONE. Shipped.

Pure geometry, no shader, no brightness, no exposure. What shipped is not quite
what this section first prescribed, and the difference is worth reading: the
plan asked for a fixed polar clamp plus a smaller distance cap, and the code
ships a polar clamp that is **re-solved every frame against the live orbit
radius**, with the distance cap untouched at 26 m.

That change came from the owner, who supplied the missing measurement:

> *"zoom in thì ko bị còn zoom out góc cam sát mặt nước thì bị"*

Which is the geometry stated exactly. The camera's height is
`target.y + radius * cos(polar)`, so the lift a given tilt buys is proportional
to the RADIUS. A fixed angle would have to be the one that survives the widest
zoom, and would then forbid at 3 m a look that is perfectly safe at 3 m —
trading the reported wrong camera for an unreported one. A bound that is a
function of the radius costs nothing at the close end and everything only at the
end where the breach lives.

**What was built.**

- `oceanSurfaceClearanceMetres(windSpeedMetresPerSecond)` in `oceanMath.ts`. The
  waterline is a MEAN, not a lid: the Gerstner sheet's troughs hang below the
  plane at `y = viewerDepthMetres` by as much as its crests stand above it, so a
  lens level with the plane is already out of the water half the time. Rayleigh
  over the thousand-odd waves a visitor sits through puts the extreme crest at
  `0.93 * Hs`, and 0.6 m is added for the near plane the renderer pushes out to
  0.5 m while the rig is drawn. At the family's calmest wind (5 m/s) that is
  1.14 m; at its windiest (13) it is 3.96 m.
  - **Not** the Gerstner sum's own bound of `1.22 * Hs`. That is all twelve
    components cresting at one point at one instant — true once in the life of
    the sea, and insuring against it costs a fifth of a shallow world's column.
- `oceanCameraCeilingMetres(viewerDepthMetres, windSpeedMetresPerSecond)`,
  returning `null` above water — those worlds have no sheet over the lens to
  come out of. They have the MIRROR problem, a camera that can dive under their
  sea, which is a different bound and is **not** closed by this work.
- `minimumPolarAngleUnderCeiling(ceilingHeight, targetHeight, orbitRadius)` in
  `cameraIntro.ts` — the inverse of the height expression, clamped, returning 0
  when the ceiling is out of the radius's reach.
- `CameraRig` gained `maximumCameraHeightMetres`. It writes
  `orbitControls.minPolarAngle` rather than correcting the position afterwards,
  because the controls re-derive the camera from (target, radius, polar,
  azimuth) on every update: a position correction is recomputed away next frame,
  and it also reads as a shove rather than as a limit. It is applied three
  times a frame — at the top, at the intro's own posed radius, and again after
  the final `update()`, because a scroll-zoom is applied INSIDE `update()` and
  one frame of a stale bound is one frame of white water.
- `SphericalOffsetLimits` gained `minimumPolarRadiansAtRadius`, a function of
  the radius rather than a number. Every pose in `CAMERA_INTRO_POSES` both lifts
  the camera and pulls it back, and the two compound; three of the ten opened a
  12 m world above its own surface before the visitor had touched anything.
  `cameraIntro.test.ts` keeps that as an assertion so the floor cannot be
  quietly removed and the suite stay green.
- `clampCameraAboveTerrain` now refuses to lift the lens through the ceiling.
  Without that the terrain clamp is a way AROUND the polar clamp rather than a
  companion to it — it fires after the controls have had their say, and it lifts
  the orbit TARGET with it, raising the crossing for every later frame. Where
  the corridor is genuinely too thin the ceiling wins: a lens in the sand is a
  dark frame, a lens through the surface is a white one with the world behind it.

**What it costs, measured across 120 generated worlds.** Nothing below the
shallows: twilight and abyss come out at `minPolarAngle = 0` at every radius,
because a ceiling 100 m up is not reachable from a 26 m orbit. In the shallows
the close end is also untouched — at the 2.5 m minimum distance the bound is 0
in every world the generator makes, which is a test, not an observation. It
bites only at the wide end, and even there it leaves room: a 17.6 m world in a
10 m/s wind keeps 36.6 degrees of lift above its resting shot at full zoom-out,
a 20.6 m world keeps 47.5, and a 26.9 m world is unrestricted until past 20 m of
radius. **No resting framing is disturbed** — also a test.

**Explicitly rejected: recomputing the medium live from the camera's y.** It
sounds like the "real" fix and it is not. `above` is baked into ~15 build-time
decisions, three of which are structural rather than uniform swaps — which of
two surface meshes exists at all, whether the seabed was built
(`oceanRig.ts:686`), and the species roster (`:797-798`). "Recompute live" means
rebuilding the rig on every crossing, with the teardown cross-fade
`OceanRenderer.tsx:208-217` already has to cover. It is a feature with a hitch
attached, not a distance fix. Keep it as a possible later feature if a genuine
above/below transition is ever wanted.

**Not done, and deliberately.** `1a`, the ocean-owned distance cap, was dropped:
with the bound tracking the radius there is no geometric reason to take the
zoom-out away, and the landmark-ring argument for capping it is a composition
argument that belongs with work item 4 and should be measured there, not
smuggled in under a bug fix.

### The two sighting ranges disagree — DONE. Shipped.

`UniverseCanvas.tsx:314-322` passes `scene.water.visibilityMetres` (the
**light**-limited minimum, `ocean_config_builder.go:270`) into
`oceanCameraFraming`, while `oceanRig.ts:227` used `sightingRangeMetres(attenuation)`
(the **clarity** limit alone) — and `OceanRenderer.tsx`'s own `sightLimit`
(gating whether landmarks stand on anything at all) re-derived that same
clarity-only figure a second time, independently. Three call sites, two
different formulas, disagreeing by up to 17.6 m on whether a surface,
seafloor, or landmark should even be drawn.

Fixed by making `visibilityMetres` a stored config field on `OceanRigOptions`,
following the exact shape `godRayStrength`/`causticStrength` already use: a
caller with a real backend value passes it and it wins outright; a caller
with none — a demo, a test, a world saved before this field existed — falls
back to the old clarity-only estimate, unchanged. `OceanRenderer.tsx` now
passes `water?.visibilityMetres` into `createOceanRig`, and its own local
`sightLimit` reads the same field before falling back, so all three
computations that used to disagree now read one number when the backend has
supplied one. The backend's own value is already the correct one to defer
to — `buildWaterConfig` (`ocean_config_builder.go:270`) computes it as
`min(depthResponse.VisibilityMetres, SightingRangeForWaterType(waterType))`,
the light and clarity limits together, which is exactly the quantity "how
far can you actually see" means.

Not independently unit-tested: `createOceanRig` and `OceanRenderer` both need
a real WebGL context/DOM this repo's Node test environment doesn't have (the
same boundary `causticStrength`'s wiring hit). Pinned by `tsc`, the full 628-
test vitest run, and the GLSL lint — not by a render. `oceanFrameBudget.test.ts`
cannot catch this either: it reads committed screenshots, not a live render,
so a fixture whose world happens to have light- and clarity-limits that
already agreed would show no diff regardless. Any world where they diverge
will now render its surface/seafloor/landmarks/god-rays at a different reach
than before this fix — an intentional correction, not a regression, but a
real behaviour change with no automated visual proof.
## Work item 2 — the fish

The owner reported two things, and they are two different bugs. Do not conflate
them.

> *"Cá đang di chuyển ko ổn, cá đang bơi thì biến mất, nên cho chúng bơi ra xa
> dần chứ ko biến mất trước mắt."*

### 2a. What the movement model actually is

Read in full: fish ride **closed circular rings centred on the world origin**.

```
leader.angle += leader.speed * speedMultiplier * dt
leaderTarget = (cos(angle)*radius, height, sin(angle)*radius)
radius = min(species.pathRadius, ringLimit) * (0.35 … 1.10)
ringLimit = Math.max(6, visibilityMetres)            oceanRigFauna.ts:1555
```

There is **no wrap, no teleport, no despawn, no respawn, and no instance-count
change** — `mesh.count` is set once at `new InstancedMesh(placeholder, material,
species.count)` (`:1529`) and never touched. `frustumCulled = false`.
`speciesIsPresent` is evaluated once at rig build.

So the fish never *leave*. They orbit forever at a roughly constant distance
band. **That is the real content of the owner's request**: there is currently no
departure behaviour at all to make gradual.

### 2b. The two things that make a fish disappear — DONE. Shipped.

| Mechanism | Evidence | Character |
|---|---|---|
| **The camera breach** (work item 1) | the opaque lid, above | everything vanishes at once — already fixed |
| **The model-adopt cross-fade** | `ADOPT_FADE_HALF_SECONDS = 0.22`, fade-out → geometry swap → fade-in, driven by `material.opacity` with `material.transparent = true` | one whole school blinks out and back over 0.44 s |

The adopt fade fires when that species' GLB finishes downloading —
`loadSpeciesGeometry(species).then(model => school.adopt(model))`
(`oceanRig.ts:840-842`). It is per-species and asynchronous, so on a cold cache
different schools blink at different moments, seconds after the scene appears.
A visitor watching a fish swim sees it vanish. **This is almost certainly the
"cá đang bơi thì biến mất" the owner means.**

Shipped exactly the cheap version this section proposed: the fade is now
depth-aware. At the moment a fade starts, the nearest leader's distance to the
camera is measured against `visibilityMetres`, and `ADOPT_FADE_HALF_SECONDS`
(now a per-fade `adoptFadeHalfSeconds`, scaled from a `_BASE` constant) is
scaled toward zero as fog-swallow approaches 1. A school already several
sighting ranges out swaps its geometry the same tick the fade would have
started — nothing left to hide, so nothing left to animate. A school still in
clear water gets the full 0.22 s fade, unchanged.

### 2c. The departure behaviour the owner asked for — DONE. Shipped.

Added a **swim-out** to the ring model: every leader's *rendered* radius (never
the persistent `leader.radius`) eases past the ring toward
`ringLimit × 1.6` and back over a 90 s cycle, phased per-leader so schools
never sync. At the multiplier's peak a leader sits at
`1 − exp(−1.6²) ≈ 92 %` fog-swallowed — visibly dissolving into haze rather
than vanishing at a hard edge — then eases back to its ordinary orbit. This
reads as *behaviour* rather than a fade, needs no material transparency (the
instanced draw and its sorting stay untouched — the reason this was preferred
over a per-instance alpha in the first place), and the scene's own fog does
the actual dissolving.

Universal rather than a per-species opt-in like `approachesCamera`: the
report was about ordinary schools generally, not a rare spectacle for a
handful of charismatic species. One correction made while shipping it: when a
school carries no `visibilityMetres` (the open-water default,
`Number.POSITIVE_INFINITY` — every real call from `oceanRig.ts` passes a real
figure, but a school built without one, as most of this file's own tests do,
did not), `ringLimit` is `Infinity` and `Infinity × 1.6` propagated as `NaN`
through the leader's heading normalisation the moment the envelope engaged,
freezing every school in the rig, not just the ones under test. Fixed by
falling back to `species.pathRadius × 1.6` when `ringLimit` is not finite —
with no fog to dissolve into, the "outward" swim is a lap past the species'
own ring rather than a distance the water defines.

### 2d. Other movement defects found while reading

- **Fixed.** The leader's height is clamped to `[floorY, ceiling]` before the
  surfacing and camera-approach blends, and was not re-clamped after — "a
  giant that blends toward `cameraPosition.y` follows a breached camera above
  the surface." The fix caps the *blend target* (`cameraPosition.y`, clamped
  to `[floorY, ceiling]`) rather than the *blended result*, because one
  species — the dolphin — sets both `approachesCamera` and `surfacing`, and
  its surfacing breach legitimately sits above `ceiling` (bounded instead by
  `ceiling + breachHeight` at the per-member position clamp). Re-clamping the
  result would have clipped a real breach every time it happened to coincide
  with the approach cycle; capping the target does not touch surfacing at all.
- **Confirmed not a live bug.** `members[i]` is guarded with
  `if (!member) continue;`, which would leave that instance's matrix stale
  rather than hidden if a hole were reachable. It is not: `members` is built by
  sequential `.push()` inside a loop that only `break`s when
  `leaders[i % leaders.length]` is undefined, which requires
  `species.leaders === 0` — every one of the roster's 32 species sets
  `leaders >= 1`. `members.length` is therefore always either `species.count`
  or (for a hypothetical future zero-leader species) `0`; never a partially
  populated array with a hole in the middle. Left as a defensive guard, not a
  bug to fix.
- **Not fixed, and still open.** `setSurfacing` is defined and returned on the
  `School` interface, and is called nowhere in `src/`. This is narrower than
  first read: the dolphin's breathing cycle still runs and still raises
  `breachHeight`, using the DEFAULT `baseOffset = 0` / `breach = -1.2` the
  closure initialises — surfacing is not dead. What is dead is the ability to
  *change* those two numbers live (e.g. from `OceanRenderer.tsx`, the way the
  whale-fall mat and selection ring were re-anchored to the sediment line in
  work item 4a-fix). No caller has ever needed to, so there is no wiring bug
  to point at yet — just an unused capability, left as found.

## Work item 3 — the seabed, and "raise the floor"

> *"Nâng cao đáy của dưới biển lên chỉ có 2 tầng gần nhất thấy đáy thôi, còn lại
> ở trên cứ trong xanh đi."*

### 3a. There are only three zones, and two of them already show the floor

```
zoneKindsInOrder = { sunlitShallows, twilightReach, abyss }     ocean_scene_profile.go:39
onBottomZones    = { sunlitShallows, abyss }                    ocean_scene_profile.go:231
```

| Zone | Depth band | Floor clearance band | Floor drawn? |
|---|---|---|---|
| `sunlitShallows` | 12 – 32 m | 6 – 18 m | yes |
| `twilightReach` | 45 – 170 m | **1900 – 3900 m** | no — open blue water |
| `abyss` | 1050 – 3800 m | 2 – 9 m | yes |

*(Bands as they stand in the working copy, i.e. including the uncommitted
`{3,28}→{12,32}` and `{2,14}→{6,18}` raise.)*

So the machinery the request asks for **already exists** — `twilightReach` is
already a midwater world with no floor, and `OceanRenderer.tsx:148-161` documents
exactly that design ("a world with no floor has no floor objects"). What is in
question is only *which* two zones are on the bottom.

### 3b. Decided: B. Shipped.

The owner chose **B — raise the floor within each world**, and it is done.

`floorClearanceBandByZone[sunlitShallows]` came down from **6–18 m to 5–10 m**,
in `ocean_scene_profile.go` and mirrored in `oceanScene.ts`. Twilight and abyss
are untouched.

The bar it was set against is the point. Two different numbers decide whether a
floor is visible, and only one of them was ever checked:

| | What it is | Who used it |
|---|---|---|
| `DepthAt(m).VisibilityMetres` | how much **light** is left at that depth | `TestOnBottomZonesCanActuallySeeTheirFloor` |
| `sightingRangeMetres(waterType)` | the water's own **clarity**, depth-independent | the renderer, at `oceanRig.ts:227` |

The shallows can roll `3C` (kd475 0.420), sighting range **11.85 m**, boundary
reach 17.77 m. An 18 m clearance was therefore outside the reach outright — and
at the reach itself the renderer's fog term had already swallowed **90 %** of the
seabed. The old band passed the light test comfortably and produced an invisible
floor anyway.

At 10 m: **51 %** swallowed in the worst water the zone can draw, **4 %** in the
clearest (`IB`, 49.89 m). The minimum came down to 5 m so the band keeps its
spread; below that the ambient kelp (1.9–5.1 m, `oceanRigFlora.ts`) closes over
the viewer's head.

Two new tests pin it, one per side, and both were confirmed to fail on the old
band before being accepted:

- `TestOnBottomZonesSeeTheirFloorThroughTheirOwnWater` (`depth_curve_test.go`) —
  the worst water a zone can roll must leave the seabed under 60 % swallowed at
  the furthest the world can be placed above it. Old value: 90 %, fails.
- `keeps the seabed legible in every world that is placed on one`
  (`oceanScene.test.ts`) — the same bar on the preview builder, measured against
  the **stored** visibility, which is `min(light, clarity)` and therefore
  stricter than the renderer. Old value: 75 %, fails.

Nothing on this side used to pin the band at all; the FE/BE mirror was a comment.

**One consequence to carry into work item 1.** Raising the floor makes the breach
*worse*, not better. `clampCameraAboveTerrain` keeps the lens 1.5 m above the
sand and lifts `orbitControls.target.y` by the same delta. A closer seabed means
that clamp engages sooner and lifts the target further, and the breach ceiling is
`target.y + R_max`. This does not argue against B — it raises the priority of
1a and 1b.

### 3c. The other reading — CLOSED, and not by doing it

The request also admitted a second reading, **A — swap which zones are
on-bottom**: "the two nearest layers" as the two *shallowest*, so
`sunlitShallows` + `twilightReach` show a floor and the abyss becomes open blue
water. It was not chosen, and this plan then kept half of it open:

> **Worth doing later** — give `twilightReach` a floor by cutting
> `floorClearanceBandByZone[twilightReach]` from 1900–3900 m down inside the
> sighting reach. It is the zone most likely to read as empty today.

**That premise is no longer true, measured 2026-09-02.** The boundary rule in
`buildDepthConfig` already got there, and got there better. A twilight world
that can see neither boundary is either lifted to the shallow end of its OWN
band, where the surface is in reach, or given a **seamount** under it
(`seafloorMetres = metres + minimumRiseClearanceMetres + roll * riseClearance
RangeMetres`). Over 600 seeds × 4 moods:

| twilight worlds | surface in sight | floor in sight | neither |
|---|---|---|---|
| 654 | 418 (64 %) | 236 (36 %) | **0** |

So a third of twilight worlds already have a floor, and none of them is the flat
blue rectangle reading A was proposed to fix. Cutting the band would replace *an
occasional seamount* with *a permanent shelf* in every one of them, which is the
open-water identity this same document argues for at length two sections up, and
it would cost a `schemaVersion` bump and a re-roll of all six goldens to do it.

**Closed, and pinned instead.** `TestTheTwilightReachAlwaysShowsOneBoundary`
(`ocean_config_builder_test.go`) asserts the guarantee that made the item
obsolete, so the zone cannot quietly go back to being empty and the item cannot
be re-proposed from a stale premise. `TestTheTwilightReachHasNoFloorInSight`
stays exactly as it is — the *band* is still kilometres down; it is the boundary
rule that reaches in, per world.

- **Still not worth doing** — removing the abyss floor. It would delete the
  hydrothermal vents, whale falls and tubeworm fields, which are the abyss's
  entire identity, and `oceanRig.ts` would draw a black screen.

### 3d. It cannot be the camera fix, and must not be attempted as one

Recorded here because it will otherwise be re-proposed: the unconditional
no-breach bound is `V > 31.86 m` today, against a band ceiling of 32 m and a
zone ceiling of `orangeDeathMetres = 40.0`. Depth alone cannot get there. Once
work item 1 lands (`R_max` 26 → 20, aim distance possibly 20 → 12), the bound
falls to about 24 m, which sits comfortably inside the band and makes the clamp
a no-op for most worlds. **Do work item 1 first; re-tune the bands after, if at
all.**

Note also: the uncommitted `{3,28} → {12,32}` raise has *already* silently fixed
the load-time half of the breach — the opening move's maximum camera height over
all ten `CAMERA_INTRO_POSES` is 9.17 m, which cleared a 3 m water plane and does
not clear a 12 m one. **Do not revert that band.**

## Work item 4 — what stands on the seabed

### 4a. Inventory

Six landmark kinds, all **procedural**, in `oceanLandmarkGeometry.ts`:

| Function | Line |
|---|---|
| `buildHydrothermalVent` | 139 |
| `buildRockPinnacle` | 190 |
| `buildCoralGarden` | 235 |
| `buildKelpCathedral` | 297 |
| `buildWhaleFall` | 342 |
| `buildSunkenRelic` | 404 |

Plus, from `oceanRigTerrain.ts`: the seabed mesh with procedural sand/rock
textures (`createSandTextures`, `SAND_ALBEDO = #D8BE93`, `ROCK_ALBEDO = #6E6A62`),
two boulder bands standing off at `cameraDistanceMetres +
BOULDER_CAMERA_STANDOFF_METRES (6)`, kelp beds and barrel sponges from
`oceanRigFlora.ts`, and three rings of unlit cone silhouettes at 58 / 112 / 205 m
from `oceanRigFraming.ts`.

**The owner's requested additions largely already exist**: `buildSunkenRelic` is
the shipwreck, `buildRockPinnacle` plus the two boulder bands are the rock
field, `buildCoralGarden` is the coral bed. Before adding anything, the honest
next step is to **look at them** — the suspicion is not that they are missing but
that they are rarely in frame.

### 4a-fix. Landmarks were hovering — DONE. Shipped.

Reported against a real frame: *"vài vật thể tương tác được dưới biển đang bị
nằm sai tọa độ, nó đang lơ lửng"*, with a screenshot of a whale fall's rib cage
and its bacterial mat hanging in clear water with daylight underneath.

**Two independent causes, both of which put the same thing on screen.**

**1. The service lifted every landmark off the floor.**
`HeightAboveFloor = landmarkHeightBase + heightRoll × landmarkHeightRange`, with
the constants `0.0` and `6.0` — a blind roll of 0 to 6 m ABOVE the seabed that
never asked what kind the landmark was. Every one of the six kinds is a bottom
feature, and `oceanLandmarkGeometry.ts` normalises each one's foot to `y = 0`
in a function called `standOn`, whose own comment says it exists "so a landmark
stands on the sediment instead of hovering over it". The lift put it straight
back into the water column.

The comment that justified the field — "an ocean is a volume, so a landmark can
sit on the floor or hang in the water column" — is a true sentence about oceans
and a false one about these six shapes. The tell was in the file already:
`OceanRenderer.tsx` had fixed the two OTHER ways a landmark could hang (midwater
worlds, above-water worlds) and the ordinary case, a floor that IS drawn,
survived both fixes.

Replaced by `landmarkBedDepthMetresByKind`, a per-kind depth the shape beds INTO
the sediment, shipped as a negative `heightAboveFloor`: 0.20 m for a kelp
holdfast, 0.30 for a vent chimney, 0.25 for a coral head, 0.35 for a pinnacle
with talus at its foot, 0.50 for a whale fall (half in the sediment is what the
kind IS), 0.55 for a wreck. Plus 0-0.15 m of jitter, so two whale falls settled
differently. The field stays in the contract for the kind that eventually does
hang — a jellyfish bloom, a midwater aggregation — but it is no longer a free
roll.

**2. The renderer placed the foot against one sample, and against the wrong
surface.** `heightSampler(x, z)` was evaluated at the landmark's CENTRE. A foot
is a footprint: the seabed carries 1.2 m dunes over an 18 m wavelength, so a
shape five metres across on a slope has its uphill edge buried and its downhill
edge in open water however correct its centre is.

Worse, `heightSampler` is the height FUNCTION, while what the eye sees is that
function sampled on a grid and joined with flat triangles. Those triangles cut
every corner, so the drawn floor hangs BELOW the function — about **0.2 m** at
desktop's 2.27 m vertex spacing and **0.6 m** at mobile's 5.67 m. An object
placed on the function stands that far above the sand it appears to rest on,
and it is worse on the weaker device, which is the opposite of how a quality
setting should fail. This is why the bed depths above could not simply absorb
it: covering mobile's 0.6 m would have buried a third of every shape on
desktop, to pay for an artefact desktop does not have.

`lowestSeafloorUnderFootprint` (`oceanMath.ts`) takes the minimum over the
footprint, and when the mesh spacing is known it samples AT THE MESH VERTICES,
across every cell the footprint touches. A triangle never dips below its own
corners, so that minimum is at or below the drawn surface everywhere under the
shape — exact, not an estimate. The spacing travels from the rig as
`floorCellSizeMetres` (0 before the rig exists, which falls back to a ring on
the analytic function).

**Two things had to move with the group**, because its origin is now BELOW the
sand: the whale fall's bacterial mat, which is the reason that landmark reads as
an ecosystem rather than a bone pile, and the selection ring — a click with no
visible feedback is a broken landmark whatever its y is. Both are now measured
from the sediment line, clamped at zero so a future hanging kind keeps its ring
at its own base.

**Found while doing it, and fixed here:** the 1.5 bump committed earlier in this
branch never moved `contracts/scenes/ocean-scene-config.schema.json`, whose
`schemaVersion` is a `const`. `contracts/go`'s conformance test was red and the
ocean-service suite was green, because they are different modules. **Run every
Go module, not the one you edited.** The e2e fixtures were stale for the same
reason and are regenerated by `e2e/refresh-ocean-fixtures.mjs`.

Schema is **1.6**. Pinned by
`TestEveryLandmarkKindSettlesIntoTheSeabedRatherThanHoveringOverIt` (never
above the floor; every kind has a bed depth; an absolute cap) and, on the
renderer's side where the standing heights live, by the
`lowestSeafloorUnderFootprint` and landmark-placement blocks in
`oceanMath.test.ts` (never buried past 40 % of its own height; the mesh
vertices really are the points sampled; a dip no cell under the shape reaches is
ignored).

**Not done, and deliberately:** the same mesh-versus-function gap applies to
flora and boulders, which are placed on `heightAt` too. They get away with it
because they are small and already sunk by a fraction of their own size, but it
is the same defect and it belongs in one change, not bolted onto this one.

### 4b. Landmarks may be beyond the fog — MEASURED, partially fixed. Shipped.

The suspicion was that the shipwreck and the coral garden are already built
and simply never in frame. Measured with a 5,000-sample Monte Carlo per water
type over the old formula:

```
RadiusFromCenter = cameraDistance + landmarkCameraStandoffMetres
                                  + radiusRoll × landmarkRingDepthMetres
```

with `landmarkCameraStandoffMetres = 8.0` and `landmarkRingDepthMetres = 26.0`,
against the fog term the renderer actually uses, `1 − exp(−(d/range)²)` with
`range = SightingRangeForWaterType(water)`:

| Zone | Water | Range | Mean visible | Worst roll | % of rolls < 10 % visible |
|---|---|---|---|---|---|
| sunlitShallows | IB (clearest) | 49.9 m | 51.3 % | 26.0 % | 0 % |
| sunlitShallows | II | 38.3 m | 33.4 % | 10.4 % | 0 % |
| sunlitShallows | III | 29.4 m | 17.4 % | 2.1 % | 36 % |
| sunlitShallows | 1C | 21.7 m | 5.2 % | 0.08 % | 81 % |
| sunlitShallows | 3C (murkiest) | 11.8 m | **0.1 %** | 0.00 % | **100 %** |
| twilightReach / abyss | I, IA, IB only | 49.9–63.7 m | 51–66 % | 26–44 % | 0 % |

Confirmed and worse than the back-of-envelope estimate this section originally
gave: `sunlitShallows` is the only zone allowed anything past `IB` (`I`/`IA`/`IB`
alone can be drawn in twilight and the abyss, and those are all comfortably
inside reach), so the defect is confined to — but severe in — coastal shallow
worlds. In `3C` water, every roll placed the landmark beyond ten sighting
range's worth of fog; the shipwreck and coral garden were exactly as suspected,
built and never seen.

**What shipped, and what it cannot fix.** `landmarkMaxSightingRangeFraction =
0.9` caps the ring's spread at 90 % of the world's own sighting range
(`SightingRangeForWaterType(water.JerlovWaterType)`), computed once per world
and applied as `ringSpread = clamp(0, landmarkRingDepthMetres, maximumUsefulRadius
− innerRingRadius)`. This is a genuine fix for `II`/`III` water, where the old
roll wasted distance the fog had already erased. It is **not** a fix for
`1C`/`3C`: `landmarkCameraStandoffMetres` alone already places the ring's inner
edge past those waters' sighting range (24–32 m against an 11.8–21.7 m range),
and that inner edge is load-bearing — it is the clearance invariant
`TestLandmarksAreHeroFirstAndDeduped` exists to enforce, so a fix cannot shrink
it without reopening the camera/landmark collision that invariant was written
against. In `1C`/`3C` shallows every landmark now settles at the closest legal
position instead of a random one, which is the best this lever can do; a real
fix needs the camera itself to stand closer in turbid water, which is a framing
change and out of scope here. Schema bumped to **1.7**.

Pinned by `TestLandmarkRingNeverReachesPastTheWatersOwnSightingRange`
(Go) and its FE mirror in `oceanScene.test.ts`, each checked against both a
world whose water leaves the ring unconstrained and one that pins it to the
inner edge, so neither branch can silently stop being exercised.

### 4c. Two seams worth closing while in this file — DONE. Shipped.

- **Two different caustics implementations ran side by side.** The seabed,
  boulders and sponges used a ridged-sine `causticVeins` copied from the
  prototype; only landmarks used the physically derived differential-area form
  in `oceanCaustics.ts`. They computed different fields at strengths ~5.4×
  apart (`causticStrength * 0.185` on the terrain side, the raw value on the
  landmark side — `1 / 0.185 ≈ 5.4`), so a coral head and the sand it stood on
  were lit by different patterns. `oceanRigTerrain.ts`'s own `applyCaustics`,
  `createCausticUniforms` and the whole `GLSL_CAUSTICS` chunk are gone; the
  seabed, its boulders (`oceanRigTerrain.ts`) and its sponges
  (`oceanRigFlora.ts`) now call `oceanCaustics.ts`'s `applyCaustics` directly,
  with no local gain. One bonus this unification pays for on its own: the
  differential-area form's `uCausticDepth` — veins widen and soften with how
  far light travels from surface to floor — now reaches the seabed too, wired
  from `seafloorDepthMetres`, the exact quantity the landmarks already used for
  the same uniform.
- **The seabed's caustic strength was recomputed locally** rather than read
  from `lighting.causticStrength`, which the landmarks used directly — the
  same class of defect the rig already fixed once for `godRayStrength`.
  `OceanRigOptions` gained a `causticStrength?: number` field, mirroring
  `godRayStrength?: number` exactly, defaulting to `1` (no dampening) for a
  caller with no stored value to pass. It is **multiplied** against the
  existing local term, not swapped in for it: the two model different physics.
  `causticStrength` (the depth curve's own value) is how much LIGHT survives
  to this depth, reaching zero at the sunlight floor; the local coherence term
  is how much of the floor still lies within a few attenuation lengths of the
  viewer, past which even surviving light draws an incoherent blur rather than
  a pattern. Before this, the seabed had only the second term and the
  landmarks had only the first — not two effects reconciled, but one missing
  from each side.

Pinned by `oceanRigTerrain.test.ts`: `tintSeabed` passes `causticStrength`
straight through to the shared uniform with no separate gain, and sets
`uCausticDepth` from the surface-to-floor distance it is given, floored at
0.5 m. The multiplication itself lives in `createOceanRig`, which needs a real
`WebGLRenderer` and canvas to build (sand textures, sky, surface) and so sits
outside what this test environment (Node, no DOM) can exercise directly —
the same boundary every other part of the full rig's construction already
sits behind.

### 4d. Making the sand itself read as real — DONE, and two of the four were already done

The list this section shipped with was: slope-based blending between
`SAND_ALBEDO` and `ROCK_ALBEDO`, ripple-mark normal detail, contact darkening
under every prop, and extending `PostEffects`' N8AO gate to the ocean. Checked
one at a time against the code, 2026-09-02:

- **Slope-based sand/rock blending — DONE, shipped now.** `applySlopeRock` in
  `oceanRigTerrain.ts` shifts the floor's albedo toward the rock's on the steep
  faces, as a per-channel multiplier derived from the two colours AFTER
  `tintSeabed`'s water terms — blending to an untinted basalt would have put dry
  rock on a seabed seen through forty metres of water. The thresholds are the
  sine of 5.7 degrees to the sine of 15, set against the relief `heightAt`
  actually builds (a 90 m swell of ±5.5 m, an 18 m dune of ±1.2 m, an 11 m
  ripple of ±0.16 m, so the steepest face it can make is about 14 degrees). A
  threshold picked for a mountain would never have fired at all.
  `slopeRockChannelShift` is pure and tested, including the two guards that
  matter: it never brightens a slope, and it never takes one to black.
- **Ripple-mark normal detail — already done.** `createSandTextures` bakes a
  domain-warped ripple at integer wave numbers (so it tiles in both axes) with
  the grain outweighing it 0.55 to 0.45, and a normal map at 3.4x relief.
- **Contact darkening under every prop — already done, by real shadows.** The
  ocean was missing from `UniverseCanvas`' `shadows` list for its whole life,
  which made every `castShadow` in the rig inert; that is fixed, and the floor,
  the boulders, the flora and the landmarks all cast and receive. There is no
  contact darkening on the low-quality path, where `keyLight.castShadow` is
  false — that is the quality ladder working as designed, not a missing feature.
- **N8AO for the ocean — CLOSED, it cannot be done and should not be.** The
  ocean renders STRAIGHT TO THE CANVAS with no `EffectComposer`, and that is a
  correctness decision, not a tuning one: the composer sets
  `gl.toneMapping = NoToneMapping` and expects a `<ToneMapping>` effect the
  chain never had, so for the family's whole life its tone curve was a
  passthrough and every linear value above 1 clipped flat to white. Re-adding
  the composer to get one AO pass would give the washed-out frame back.

## Work item 5 — water realism, ranked

Restorations from our own prototype come first: the code is in the repo, it was
reviewed and liked, and it is cheap.

| # | Change | Gain / cost | Files | Status |
|---|---|---|---|---|
| 1 | **Unify caustics** on the differential-area form (4c) | high / medium | `oceanRigTerrain.ts`, `oceanRigFlora.ts`, `oceanRig.ts` | DONE |
| 2 | **Restore anisotropic god-ray sampling.** Prototype samples the beam cross-section at `section * vec2(0.30, 0.075)`; production uses isotropic `beamPlane * 0.09`. The 4:1 anisotropy is what makes a shaft a *curtain* instead of a blob. Also restore the `grain` octave, the depth `fade`, and the per-fragment march jitter that hides 24-step banding | high / small | `oceanRig.ts` | DONE |
| 3 | **Wire up `BLUE_SEA_YAW_OFFSET_RADIANS`** (118°, `oceanSky.ts:117-128`) — it is written, documented, and imported by nothing. Above-water worlds currently always shoot *into* the sun. Prototype measurements: facing the sun gives saturation 0.12, facing 118° away gives 0.17 overall and 0.31 in the near field, same shaders. Apply only for a high sun; keep yaw 0 for golden hour | high / small | `oceanMath.ts` | DONE |
| 4 | **Window-centred sparkle falloff** — restore `* (1.0 - coneT)` in place of `* window`, so Snell's window has a radial gradient rather than a flat disc with a hard rim | low / trivial | `oceanRig.ts` | DONE |

### Item 2 — DONE. Shipped.

`oceanRig.ts`'s god-ray fragment shader gained the four things the prototype had
and production had quietly dropped: the beam plane is now sampled at
`vec2(0.30, 0.075)` instead of an isotropic `0.09` — narrow along the beam's
own axis, wide across it, which is the 4:1 ratio that reads as a *shaft*
rather than a blob; a second, finer-scale `noise` octave (`grain`, 0.62-1.0)
rides on top of the thresholded `fbm` so an edge is not one smooth gradient;
a `fade = exp(-max(0, uSurfaceY - p.y) * 0.02)` term dims a sample the
FARTHER below the surface it sits, independent of how far the camera is from
it — the march's own `uExtinction` term only ever measured the camera's own
viewing distance, never how much water lies straight above a given point; and
the march offset is now `jitter + i * stepSize` with `jitter` a per-fragment
hash of `gl_FragCoord`, rather than the fixed `(i + 0.5) / STEPS` phase every
fragment shared, which is what turns 24-step banding into noise instead.
Pinned by the existing `oceanShaderSource.test.ts` GLSL lint, which nothing
about this change was expected to trip — only new arithmetic, no new
reserved words or shadowed built-ins.

### Item 3 — DONE. Shipped.

`oceanCameraFraming` (`oceanMath.ts`) gained a sixth, optional
`sunElevationRadians` parameter, defaulting to
`HIGH_SUN_ELEVATION_THRESHOLD_RADIANS` itself — so a caller with nothing to
pass (every call site before this change) gets the offset OFF, exactly the
behaviour that existed before this parameter did. `UniverseCanvas.tsx` now
passes `scene?.lighting?.surfaceAzimuthRadians`'s sibling field,
`surfaceElevationRadians`, through to it.

`HIGH_SUN_ELEVATION_THRESHOLD_RADIANS = 0.3` splits the above-water band
(0.06-0.70 rad) between the family's two archetypes — golden hour rolls
around 0.08, daylight around 0.65 — with wide margin on both sides. The
offset applies only `above && sunElevationRadians > threshold`: above water
only, because underwater the god rays and Snell's window still need the
camera looking along the sun's actual bearing to have anything to show, and
only past the threshold, because a low golden-hour sun is the one case where
shooting straight at it is the composition itself — which is why the
prototype's own golden-hour preset ships yaw 0 rather than the offset.

Pinned by four new tests in `oceanMath.test.ts`: yaw equals the sun's own
bearing above water under a low sun, turns exactly
`BLUE_SEA_YAW_OFFSET_RADIANS` away from it under a high one, never applies
underwater even under a high sun, and defaults to no offset for a caller that
passes no elevation at all.

### Item 4 — DONE. Shipped.

`oceanRig.ts`'s water-surface fragment shader gained the prototype's own
`coneT = clamp(sinTheta / 0.75, 0.0, 1.0)` — the same critical-angle geometry
the window's own `smoothstep(0.70, 0.775, sinTheta)` is built from, just
un-smoothed into a plain ratio — and the sparkle term switched from
`* window` to `* (1.0 - coneT)`. `window` is a flat 1 across the whole disc
and only drops at the rim over a 0.075-wide smoothstep band, so the sparkle
it gated was a flat highlight with a thin dark ring at the edge. `coneT` is 0
at the zenith and rises linearly to 1 at the critical angle, so `1 - coneT`
gives the sparkle a radial falloff across the whole window — brightest
looking straight up, fading gradually toward the rim — matching how the
prototype's own comment describes it: *"strongest where refraction magnifies
the slope."* Not independently testable: this is a pure fragment-shader
change with no CPU-side logic, caught only by `oceanShaderSource.test.ts`'s
GLSL lint (which found nothing to flag — no new reserved words or shadowed
built-ins) and otherwise falling into the same Node/no-DOM boundary as items
2 and 3 above.

### From the open web

The state of the art for the *above-water* surface is FFT ocean (Tessendorf 2001)
with a JONSWAP/Horvath directional spectrum, multi-cascade. The good current
implementations are **WebGPU/TSL**, not WebGL2:
[Poseidon](https://github.com/owenyuwono/poseidon) (three.js + WebGPU, three
cascades, TMA depth correction, Donelan–Banner spreading),
[Three.js Water Pro](https://docs.threejswaterpro.com/) and
[Three.js Water Free](https://baditaflorin.github.io/threejs-water-free/),
[WebTide](https://github.com/BarthPaleologue/WebTide) (BabylonJS/WebGPU).
The older WebGL route is [jbouny/fft-ocean](https://github.com/jbouny/fft-ocean).

**Recommendation: do not take this on yet.** It is a renderer-backend migration
(WebGPU) for a benefit confined to above-water worlds, which are a minority, and
this family's Gerstner surface is already spectrum-driven (Pierson–Moskowitz with
Monahan whitecaps). Revisit when the project moves to WebGPU for other reasons.

Worth reading for the underwater half, which is where this family lives:
[Papadopoulos & Papaioannou, *Realistic Real-time Underwater Caustics and
Godrays*](https://graphics.cs.aueb.gr/graphics/docs/papers/GraphiCon09_PapadopoulosPapaioannou.pdf)
— directly applicable to items 1 and 2 above;
[jeantimex/threejs-water](https://github.com/jeantimex/threejs-water) for a
compact reference implementation of differential-area caustics;
[Martin Renou, *Real-time rendering of water caustics*](https://medium.com/@martinRenou/real-time-rendering-of-water-caustics-59cda1d74aa).

## Work item 6 — assets

`apps/myunivokai-web/public/assets/ocean/models/` holds **15 GLBs, 8.9 MB, all
fauna**. Nothing on the seabed is a loaded model; every prop is procedural.

The repo already has a verified source catalogue at
[`agent-system/knowledge/references/threejs-assets.md`](../../knowledge/references/threejs-assets.md).
For rocks and materials it points at **Poly Haven** (CC0, public API, no key) and
**ambientCG** (CC0, `/full_json`, no login) — both agent-downloadable, both a
better fit than Sketchfab.

**That document now needs one correction.** It states that Sketchfab downloads
require a human login and that "agents/CI cannot pull Sketchfab files". Its own
text notes the Download API accepts *"OAuth2 Bearer **or** a static account API
token"*, and the owner has now provisioned exactly such a token in
`apps/myunivokai-web/.env.local.secret` (gitignored; offline tooling only, no
`NEXT_PUBLIC_` prefix). Under the folder rule in `CLAUDE.md`, `knowledge/`
describes reality, so **reality is right and the document must be corrected** —
Sketchfab is now conditionally agent-downloadable for this project.

Standing constraints that still apply:

- **CC0 or CC-BY only**, with attribution recorded where CC-BY.
- **Never commit the token**; never redistribute an asset whose licence forbids
  stand-alone redistribution.
- **No whole-scene meshes.** The forest baked-scene attempt failed on exactly
  this — an arbitrary pivot and up-axis, no way to match terrain carved for it.
  A shipwreck must arrive as a single prop with a known scale, then be placed by
  the height sampler like every other seabed object.
- Any photoscan must be decimated and texture-resized hard before it fits the
  web budget.

**Recommendation per prop:**

| Prop | Verdict | Why |
|---|---|---|
| Rock field | **procedural** (extend the existing boulder bands) | Already exists, already placed by the height sampler, zero bytes |
| Coral | **procedural** (extend `buildCoralGarden`) | Needs to vary per world from a seed; a fixed mesh would repeat visibly |
| Shipwreck | **loaded model**, if a clean CC0/CC-BY one exists | The one prop whose realism comes from man-made detail a seeded generator cannot invent. `buildSunkenRelic` is the fallback and stays |

**The conditional in that last row has now been tested**, and the correction to
`threejs-assets.md` above has been made — the Download API answers HTTP 200 to
the account token, no browser. See
[`../../evolution/ocean-seabed-props-research.md`](../../evolution/ocean-seabed-props-research.md).
The short version, because it changes what "if a clean one exists" is worth:
there is **exactly one CC0 shipwreck on Sketchfab**, it is a 250 k-triangle
museum photoscan whose GLB is 14.5 MB — larger than all fifteen of this family's
existing models put together — and **no CC0 hydrothermal vent exists at all**.
Everything cheap is CC-BY and reads as a game prop. The research recommends the
photoscan, decimated hard, and only as the rare `sunkenRelic` lottery prop; and
it recommends building the vent, whose visual identity is a plume and a light
rather than geometry.

It also answers the second half of the owner's request, "các mỏ dưới đáy biển
phát sáng", with something better than the request: almost nothing on a real
seabed glows, but a black smoker does — dull red-orange thermal radiation at the
mouth, and *stochastic blue-white flickers* at the precipitation front from
crystalloluminescence and collapsing bubbles. Measured at real vents, and
nothing in this repo does anything like it.

### Work item 6 — DONE. The experiment ran, and both halves shipped.

**The wreck. The decimation experiment the research said had to happen first
happened, and the read survives.** Pipeline, measured 2026-09-02 and committed
as `scripts/fetch-ocean-wreck.mjs` so it can be re-derived:

| step | size | triangles |
|---|---|---|
| raw GLB | 14.54 MB | 250 k |
| `simplify --ratio 0.02` | 3.43 MB | 11 k |
| `resize 512` | 1.39 MB | |
| `prune --keep-attributes false` | 1.39 MB | (drops the unused second UV) |
| `quantize` | 1.01 MB | |
| `jpeg`, `normalTexture` only | **608.66 KB** | |

The last step is the biggest single win and the least obvious: the base colour
arrived as a 60 KB JPEG and the normal map as a **493 KB PNG**, so nine tenths of
what was left after quantizing was one lossless normal map for a prop seen at
2.6 m through seawater. `--ratio 0.02` rather than the research's estimated 0.01
because at 11 k the plate seams and the broken edge still read, and the 150 KB
that buys is spent in a small fraction of worlds.

**Looked at, not assumed.** Rendered at the landmark's own 2.6 m height in the
reef fixture: it reads as a hull — gunwale, plating, a stern settled into the
sand. In the abyss fixture it is invisible, which is the abyss's own light
budget rather than the model's fault (visibility ~12 m, brightness ~0), and is
an argument for the vent's glow rather than against the wreck.

Wired exactly as the research recommended: **only when the rarity lottery hits**
(`rarityFeature("ocean-sunken-relic")`, p = 0.2), because the backend emits
`sunkenRelic` as an ordinary non-hero kind and gating on the KIND would have put
609 KB into a large share of worlds. `buildSunkenRelic` stays as the ordinary
case and is also the loaded model's Suspense fallback, so a download in flight
is a procedural wreck rather than a hole in the seabed. `OceanSunkenRelicModel`
scales the scan to the procedural relic's height, grounds its foot at y = 0 for
`lowestSeafloorUnderFootprint`, and clones its materials before patching them —
the loader caches the GLTF, so patching in place would put one world's caustics
and fog on every world that ever loads it.

**The vent. Built, not sourced, and now it glows.** No CC0 hydrothermal vent
exists, and the geometry was never the problem: `buildHydrothermalVent` already
grows a proper black smoker (stacked leaning chimneys, sulphide crust toward the
top, a talus of collapsed chimney at the foot). What it lacked was the two
things a real vent is recognised by, and they are two different phenomena:

- **the mouth** radiates a dull red-orange continuously, because the fluid
  leaving it is 300–400 °C. It breathes with the turbulence; it does not flash.
- **the precipitation front**, about a metre higher, throws brief blue-white
  flashes as sulphides crystallise out and bubbles collapse —
  crystalloluminescence and sonoluminescence, stochastic, sub-second, never
  periodic. `hydrothermalFlickerIntensity` in `oceanMath.ts` is that behaviour,
  as a pure function of time and a per-vent phase, tested for all six properties
  that make it read as a vent rather than a lamp: bounded 0..1, dark more than
  85 % of the time, several flashes a minute, reaching full brightness,
  independent between two vents in one field, and deterministic.

Both are additive sprites, not real lights. A point light per vent would light
the chimney properly and cost a forward-rendered light per fragment in the
family's most expensive frame. Confirmed in the abyss fixture: the chimney is a
silhouette with a dull orange point at its mouth, which is the whole read.

## Ordering, and what breaks

The dependencies are real; this order is not arbitrary.

- ~~**Work item 3b** (raise the shallows floor, reading B)~~ — **done**, ahead of
  the rest at the owner's direction. It does not touch `depthBandByZone`, so it
  never depended on work item 1; it only makes 1 more urgent (see 3b).
- ~~**Work item 1** (the breach)~~ — **done**. It shipped as a radius-tracking
  polar clamp rather than the fixed clamp plus distance cap this plan first
  called for; work item 1 says why, and the owner's zoom-in/zoom-out
  observation is the reason.
1. ~~**Reconcile the two sighting ranges**~~ — **done**. Everything downstream
   reads `T_y`, and 3b made the disagreement between them the load-bearing
   number; it never blocked work item 1, which is solved from whatever `T_y`
   the framing produced, but the two — now three — call sites could disagree
   about whether a surface was even drawn.
2. ~~**Make `ocean-look-down.spec.ts` drive the camera**~~ — **done**, and the
   belief it was built on was wrong for the third time. It always drove the
   camera; what it could not do was SEE it. See below for the measurement.
3. ~~**The above-water mirror**~~ — **done**. `oceanCameraFloorMetres` is the
   ceiling reflected about the waterline, `maximumPolarAngleOverFloor` is
   `minimumPolarAngleUnderCeiling` from the other end, and `CameraRig` narrows
   `maxPolarAngle` with it every frame against the live radius. Proven on the
   create page's `Glass Shallows` preview, which is an above-water world:
   the drag now stops at -13.92245 m against a floor of -13.92245 m, polar held
   at 2.047 rad instead of running to PI.
4. ~~**The orbit radius ratchet**~~ — **done**. The seabed is now a polar bound
   like the surface already was, so the drag STOPS at the sand instead of
   pushing through it and being corrected. Measured after: reef `26.000` and
   abyss `26.000`, against `4.30` and `3.98` before — the visitor's zoom
   survives the gesture.
5. ~~**The point-blank pale object**~~ — **closed, it was a symptom of 4**. The
   0.647 luma frame was a creature at 4.3 m, which is where the ratchet had
   parked the lens; with the radius held at 26 m the same drag measures 0.330
   luma at 0.646 saturation — water. A deliberate zoom to the 2.5 m minimum onto
   a large animal is still a bright frame, and that is a close pass rather than
   a wall of light.
6. ~~**Work item 2b** (adopt cross-fade)~~ — **done**, and the ordering was
   stale about it: the fade is depth-aware and the section has said "Shipped"
   since the round that closed it.
7. ~~**Work item 5** items 2–4~~ — **done**, all three. The god-ray anisotropy,
   `BLUE_SEA_YAW_OFFSET_RADIANS`, and the window-centred sparkle falloff each
   have their own "DONE. Shipped." section.
8. ~~**Work item 4c** (unify caustics)~~ — **done**. One differential-area
   implementation, shared by the seabed, the flora and the landmarks.
9. ~~**Work item 2c** (swim-out behaviour)~~ — **done**.
10. ~~**Work item 3c** — the `twilightReach` floor~~ — **closed, not done**.
    Measured: the boundary rule already puts a boundary in every twilight
    world's frame (418 surface / 236 seamount / 0 neither, in 654), so the item
    rested on a premise that stopped being true. Pinned by a test instead.
11. ~~**Work item 6** — the shipwreck model~~ — **done**. 609 KB, CC0,
    lottery-gated, and the vent was built rather than sourced. The pipeline is
    committed next to the asset.

### The orbit radius ratchet — DONE. Shipped.

Found by the pose probe while proving item 2, and it had been there all along:
dragging the orbit DOWN pulled the radius in from **26 m to 4.3 m**, silently
throwing away the zoom the visitor had set.

The mechanism is three correct things composing into a wrong one.
`clampCameraAboveTerrain` lifts camera **and** target by the same delta, which
preserves the offset by design. The idle re-centre then lerps the target back
onto the family's framing. And `OrbitControls.update()` re-derives the radius
from `position - target` every frame, clamped to `[minDistance, maxDistance]`.
Lift, restore, re-derive: with the lens pinned on the sand and the target being
pulled back to where the family wants it, each frame shortens the offset a
little. It ends with the camera 4.3 m below its own target, which is the
vertical gap between the clamped lens height and the resting aim point.

Fixed the way work item 1 fixed the ceiling: **express the seabed as a polar
bound** (`applyCameraFloor` now takes the higher of the family's own floor and
the sampled terrain height plus `MINIMUM_HEIGHT_ABOVE_TERRAIN_METRES`, capped by
the ceiling so the two bounds can never cross). The drag then simply stops at
the sand at the radius it already had, and `clampCameraAboveTerrain` stays as
the correction of last resort rather than the mechanism.

| case | radius before | radius after | polar after |
|---|---|---|---|
| Reef Crest, dragged down | 4.30 | **26.000** | 1.701 |
| The Abyss, dragged down | 3.98 | **26.000** | 1.727 |

**And it closed the pale-object item with it.** The 0.647 luma frame was a
creature filling the viewport at 4.3 m — which is exactly where the ratchet had
parked the lens. The same drag now measures **0.330 luma at 0.646 saturation**:
water, with animals in it at animal distances. What remains is a visitor
deliberately wheeling in to the 2.5 m minimum against a large animal, and that
is a close pass rather than a fault.

**Every numbered item on this list is now closed.** Seven were done, two were
closed by measurement rather than by code (3c's premise had stopped being true;
the pale object was a symptom of the ratchet), and the four that follow work
item 6 were already shipped and only the ordering list had not been told. What
is left in this plan is the open web's FFT-ocean note, which recommends against
itself until the project moves to WebGPU, and 2d's unused `setSurfacing`
capability, which is an unused capability rather than a fault.

### Blast radius

- **`oceanFrameBudget.test.ts` measures committed screenshots** in
  `e2e/shots/desktop/` and `e2e/shots/mobile/` with `maximumBlown: 0.02`,
  `maximumCrush: 0.05`, `minimumLuma: 0.08`, `maximumLuma: 0.8` and per-preset
  luma ±0.09. **Any visual change must re-shoot the fixtures in the same
  commit** (`npm run shoot`; `e2e/refresh-ocean-fixtures.mjs` for the ocean set)
  or the build fails in a file the author did not touch.
- **`CameraRig` is shared by every family.** A per-family clamp must not leak —
  the same hazard `OceanRenderer.tsx:243-255` already caught once for the far
  plane.
- **Any change to `depthBandByZone` / `floorClearanceBandByZone`** must be
  mirrored byte-for-byte between `ocean_scene_profile.go` and
  `apps/myunivokai-web/src/lib/oceanScene.ts`, needs a `schemaVersion` bump, and
  re-rolls all six goldens (`UPDATE_GOLDEN=1 go test ./...` in
  `services/ocean-service`). The working copy is already mid-flight on exactly
  that pair of edits at schemaVersion 1.5.
- **The god-ray restoration is a brightness increase**, on an additive
  depth-test-off layer whose own comment records that it once clipped 100 % of a
  reef frame to white. Measure it; do not eyeball it.

### The regression test — corrected

`e2e/ocean-look-down.spec.ts` drove the right gesture and measured the right two
quantities (`MINIMUM_FRAME_SATURATION = 0.18`, `MAXIMUM_FRAME_LUMA = 0.45`), and
still could not have caught this. Two things were wrong with it and both are now
fixed:

- Its own comment recorded the **wrong conclusion** — that the abyss reproducing
  the fault ruled out the camera crossing the waterline. True for the abyss,
  **false for the reef**, and that inference is precisely how this cause
  survived two rounds. The same pale frame had two causes; fixing the abyss one
  (the unfogged backdrop dome) left the reef one standing.
- It also had the **drag direction backwards**: `OrbitControls.rotateUp`
  SUBTRACTS from the polar angle, so dragging the mouse down RAISES the camera.
  That inversion is the whole mechanism — "turning the camera down" is the
  gesture that walks the lens up and out of the sea.
- And it **never zoomed out**, which is the condition the owner reported. It now
  wheels to the distance limit before dragging. Dragging at the resting radius
  measured clean frames while the bug was live, which is why this file was green
  throughout.

The geometric assertion this section asked for went into `oceanMath.test.ts`
instead of here, and is stronger there: it checks every world the generator can
make, at every radius in the envelope, without a GPU or a seeded coin flip.

**And a fourth thing was wrong with this file, found by trying to use it as
proof.** The fix was disabled and the spec re-run as a control. It passed, with
numbers within noise of the fixed build — reef `0.285 / 0.632` unfixed against
`0.299 / 0.621` fixed. That was read as meaning the gesture never reached
`OrbitControls`, on the strength of the screenshot from the unfixed run looking
like the untouched resting framing and of the arithmetic for the world it drives
(`energetic`, 18.65 m deep) putting the lens at 24.4 m if the drag had landed.

### The input was landing all along — DONE. Shipped.

**Measured 2026-09-02, on the production build, with the camera's own pose
published from inside the rig** (`shared/cameraPoseProbe.ts`, one pre-allocated
record mutated per frame onto `window`). The wheel reaches the distance limit
and the drag reaches the polar limit in every ocean mood the create page can
make:

| preview world | resting radius → dragged | dragged polar | lens height | ceiling |
|---|---|---|---|---|
| Glass Shallows | 19.74 → 26.0 | 1.449 → ~0 | 24.00 | none — above water |
| Mesophotic Current | 21.83 → 26.0 | 1.607 → 1.143 | 15.159 | **15.159** |
| Reef Crest | 21.10 → 26.0 | 1.241 → ~0 | 21.635 | 24.737 |
| The Abyss | 18.57 → 26.0 | 1.217 → ~0 | 21.635 | 1773.27 |

Two of the old note's supporting facts fell with it. The page carries **exactly
one canvas**, at the full viewport, so `page.locator("canvas").first()` was
never reading the wrong one. And the 18.65 m reef is gone: 3b sank the shallows,
so the reef's ceiling now sits at **24.74 m** and a drag to the pole stops three
metres under it — the drag that was supposed to prove the input had landed could
no longer breach that world even if it landed perfectly, which is why the frame
looked untouched.

So the gap was never the input path. It was that a threshold on pixels is the
wrong instrument for a claim about a camera, and the wrong instrument produced a
confident wrong answer twice. The spec now reads the pose out of the running rig
and asserts what a screenshot cannot carry:

- the wheel widened the orbit (against the resting radius, not a hardcoded 26);
- the drag turned it by more than 0.1 rad — **the assertion that turns a green
  run into evidence**, because it is the one that fails when the camera does not
  move;
- the lens finished at or under the ceiling *that rig was given*, read from the
  probe rather than re-solved in the test.

`Mesophotic Current` is the world where the last one bites, and it is now in the
spec for that reason: its drag stops dead **on** the clamp, 15.1589381768 m
against a ceiling of 15.1589381768 m, 0.000 m of headroom. That is work item 1's
clamp doing its job, end to end, through the real input path — the thing this
file could not show before.

**Two faults the same measurement turned up, neither of them the camera
breaching:**

- **Dragging DOWN ratchets the orbit radius in, 26 m → 4.3 m.** The terrain
  clamp lifts camera and target together (which preserves the offset, by
  design), and the idle lerp then puts the target back on the family's framing —
  so every frame shortens the offset a little, and the lens ends up 4.3 m under
  its own target sitting on the seabed. Reproduced in Reef Crest (4.30 m) and
  The Abyss (3.98 m). The zoom the visitor set silently disappears.
- **The frame at the end of that is a pale object at arm's length.** Mesophotic
  Current measured **0.647 luma** there — over the file's 0.45 ceiling — and the
  screenshot is a single flat-white creature filling the viewport with no water
  in front of it. Probably the same family as the god-ray clip: a lit surface at
  point blank has no medium left to attenuate it. Because that is a measurement
  of a creature and not of the medium, the spec runs Mesophotic in the raising
  direction only, and says so.

One threshold is now thin on purpose and worth knowing about: Mesophotic raised
measures **0.437 luma against the 0.45 ceiling**, because the lens ends on the
clamp with the surface directly overhead. It is the frame a brightness
regression blows first.

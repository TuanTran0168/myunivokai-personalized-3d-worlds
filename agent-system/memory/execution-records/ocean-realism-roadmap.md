# Ocean realism roadmap — execution record

> **Document status:** Historical record
> **Last source review:** 2026-09-02

[`plans/frontend/ocean-realism-roadmap.md`](../../plans/frontend/ocean-realism-roadmap.md)
is now closed: every numbered item on its ordering list is done, closed by
measurement, or was already shipped. The plan itself carries what each item
became. This file carries the part the plan cannot: **where it was wrong, and
what the wrong belief cost.**

Four contradictions, in the order they were found.

---

## 1. "The input never reaches OrbitControls" — false, and it was the wrong instrument talking

**Predicted** (roadmap, *The regression test — corrected*, written 2026-09-01):

> The world it drives (`energetic`, 18.65 m deep, surface in sight and drawn)
> would have the lens at 24.4 m — six metres into the air — if that drag had
> landed. **The input never reaches `OrbitControls`.**

That conclusion was drawn from a control run: the camera fix was reverted, the
spec re-run, and it passed with frame statistics within noise of the fixed build
(reef `0.285 / 0.632` unfixed against `0.299 / 0.621` fixed). The screenshot was
read as the untouched resting framing.

**Measured 2026-09-02**, on the production build, by publishing the camera's own
pose from inside `CameraRig` (`shared/cameraPoseProbe.ts`, one pre-allocated
record mutated per frame onto `window`) and reading it from the spec:

| preview world | resting radius → dragged | dragged polar | lens height | ceiling |
|---|---|---|---|---|
| Glass Shallows | 19.74 → 26.0 | 1.449 → ~0 | 24.00 | none — above water |
| Mesophotic Current | 21.83 → 26.0 | 1.607 → 1.143 | 15.159 | 15.159 |
| Reef Crest | 21.10 → 26.0 | 1.241 → ~0 | 21.635 | 24.737 |
| The Abyss | 18.57 → 26.0 | 1.217 → ~0 | 21.635 | 1773.27 |

The wheel reaches the distance limit and the drag reaches the polar limit in
every mood. The input path was never broken.

**Why the wrong conclusion was reachable.** Two supporting facts had gone stale
under it:

- The page carries **exactly one canvas**, at the full viewport, so
  `page.locator("canvas").first()` was never reading the wrong element — a
  suspicion the note had listed first.
- The 18.65 m reef no longer existed. Work item **3b sank the shallows the same
  day**, so the reef's ceiling now sits at **24.74 m** and a drag to the pole
  stops three metres under it. The arithmetic that was supposed to prove the
  input had landed could no longer breach that world *even if it landed
  perfectly*, so the frame looked untouched either way.

**What it cost.** A round of work aimed at an input path that was fine, and a
belief recorded in a comment where the next reader would have inherited it. The
roadmap notes this was "the second time a wrong belief about that file has cost
a round"; this was the third.

**The transferable lesson, which is not about this file.** A threshold on frame
statistics cannot distinguish *the camera did not breach* from *the camera did
not move*. Both are ordinary frames of water. Any test asserting on a camera has
to assert on the camera, and the assertion that turns a green run into evidence
is the boring one: **the pose changed at all.**

---

## 2. Work item 3c — the premise had stopped being true

**Predicted** (roadmap §3c, *the other reading, still open*):

> **Worth doing later** — give `twilightReach` a floor by cutting
> `floorClearanceBandByZone[twilightReach]` from 1900–3900 m down inside the
> sighting reach. It is the zone most likely to read as empty today.

**Measured 2026-09-02**, sweeping `NewOceanConfigBuilder().Build` over 600 seeds
× 4 moods and classifying every twilight world by what is in reach of it
(`SightingRangeForWaterType(MurkiestWaterTypeForZone(zone)) * 1.5`):

| twilight worlds | surface in sight | floor in sight | neither |
|---|---|---|---|
| 654 | 418 (64 %) | 236 (36 %) | **0** |

The boundary rule in `buildDepthConfig` already handles it, per world, and more
cheaply than a band change: a twilight world that can see neither boundary is
either lifted to the shallow end of its own band or given a **seamount**. A
third of them already have a floor, and none of them is the flat blue rectangle
the item was proposed to fix.

**Rejected, and why.** Cutting the band would have replaced *an occasional
seamount* with *a permanent shelf* in every twilight world — deleting the
open-water identity the same document argues for at length — and cost a
`schemaVersion` bump plus a re-roll of all six goldens to do it.

**Shipped instead:** `TestTheTwilightReachAlwaysShowsOneBoundary`
(`ocean_config_builder_test.go`), which pins the guarantee that made the item
obsolete. `TestTheTwilightReachHasNoFloorInSight` stays as it is — the *band* is
still kilometres down; it is the boundary rule that reaches in.

**The lesson.** An open plan item's premise decays as the code around it moves.
This one was made false by a change that shipped in the same plan, two sections
above it, and nothing linked the two.

---

## 3. The orbit radius ratchet — three correct behaviours composing into a wrong one

Not predicted anywhere. Found because the pose probe from §1 made the camera
legible for the first time.

**Measured:** dragging the orbit DOWN pulled the radius from 26 m to **4.3 m**
(reef) and **3.98 m** (abyss), silently discarding the zoom the visitor had set,
and ending with the lens 4.3 m *below its own target*.

**The mechanism**, and each step of it is correct on its own:

1. `clampCameraAboveTerrain` lifts camera **and** target by the same delta,
   which preserves the offset — deliberately, and documented.
2. The idle re-centre lerps the target back onto the family's framing.
3. `OrbitControls.update()` re-derives the radius from `position - target` every
   frame, clamped to `[minDistance, maxDistance]`.

Lift, restore, re-derive. With the lens pinned on the sand and the target being
pulled back to where the family wants it, the offset shortens a little every
frame, and it converges on the vertical gap between the clamped lens height and
the resting aim point — which is exactly the 4.3 m measured.

**Fixed** by expressing the seabed as a polar bound, the way work item 1 had
already expressed the surface: `applyCameraFloor` takes the higher of the
family's own floor and the sampled terrain plus
`MINIMUM_HEIGHT_ABOVE_TERRAIN_METRES`, capped by the ceiling so the two bounds
can never cross. The drag then stops at the sand at the radius it already had —
reef and abyss both measure **26.000** after.

**And it closed another item with it.** The roadmap's "point-blank pale object"
(a 0.647 luma frame of a flat-white creature filling the viewport) was this
ratchet's symptom: the creature was at 4.3 m because that is where the ratchet
had parked the lens. The same drag now measures **0.330 luma at 0.646
saturation**. Two items, one cause.

---

## 4. The wreck decimation experiment — right verdict, three wrong estimates

**Predicted** ([`../../evolution/ocean-seabed-props-research.md`](../../evolution/ocean-seabed-props-research.md)):
decimate 250 k → ~5 k, resize the two textures to 1 k, accept **~400 KB**;
render it at 2.6 m **in the abyss fixture** and look at it.

**Measured 2026-09-02** (pipeline committed as
`apps/myunivokai-web/scripts/fetch-ocean-wreck.mjs`): 250 k triangles and
14.54 MB down to 11 k and **608.66 KB**. The verdict held — at 2.6 m it reads as
a hull, with gunwale, plating and a stern settled into the sand — but every
number around it was off:

- **The textures were the budget, not the triangles.** After `quantize`, 55 % of
  what remained was one lossless 512² PNG normal map (493 KB) against a 60 KB
  base-colour JPEG. Re-encoding that one texture was the largest single win in
  the chain and appeared nowhere in the plan.
- **`--ratio 0.02`, not 0.01.** The model is three primitives and the ratio
  applies per-primitive; 0.02 lands at 11 k triangles, where the plate seams and
  the broken stern edge survive.
- **The abyss fixture was the wrong place to look.** It is black — visibility
  ~12 m, brightness ~0 — so the wreck is invisible there for reasons that have
  nothing to do with decimation. The read was judged in the reef fixture. (That
  same darkness is an argument *for* the vent's new thermal glow, which is the
  other half of work item 6.)

**The lesson.** "Decimate the geometry" was the instinct and the geometry was
never the problem. Inspect where the bytes actually are before choosing which
knob to turn, and choose a fixture that can show the thing being judged.

# Ocean visual direction — research and BA before more code

> **Document status:** Research + business analysis. Nothing proposed here is
> implemented yet; the style-study prototype in §11 is the only executable
> output.
> **Written:** 2026-08-18, branch `feat/repo/ocean-service`.
> **Companions:** [3d-development-limitations.md](3d-development-limitations.md)
> (why quality is asset + art-direction bound), [forest-realism-roadmap.md](forest-realism-roadmap.md)
> (the same exercise done for forest), [../vision/ocean-family-research.md](../vision/ocean-family-research.md)
> and [../vision/ocean-service-plan.md](../vision/ocean-service-plan.md) (the
> contracts, which this document does **not** touch).

---

## 0. TL;DR (tiếng Việt)

- **Chẩn đoán:** ocean tệ **không phải** vì shader sai. Fog, caustics, god ray,
  hấp thụ ánh sáng theo bước sóng đều đúng vật lý. Nó tệ vì **khung hình không
  được dựng như một bức tranh dưới nước**: không có tiền cảnh, không có bóng
  silhouette ở xa, dải sáng-tối bị nén vào giữa, và mọi vật đều nằm ở trung cảnh.
- **Đúng như memo giới hạn đã dự đoán:** ~80% cái đẹp nằm ở asset + ánh sáng +
  **bố cục**. Đợt vừa rồi ta đổ công vào trục "đúng vật lý" và để trống trục
  "bố cục". Trục đang thiếu lại là trục **rẻ hơn**.
- **Quyết định style: chọn stylized "graphic depth" (kiểu Abzû), KHÔNG chọn
  realism.** Lý do quyết định: style đó *cần* silhouette + mật độ + instancing —
  đúng những gì stack này làm được — và nó **tha thứ** cho việc tái dụng model
  CC0 (dương xỉ làm san hô mềm), vì mắt chỉ đọc bóng dáng chứ không đọc chi tiết
  bề mặt.
- **Sinh vật: kiến trúc hiện tại sai một cấp.** Abzû vẽ **10.000 con cá bằng
  instancing + vertex animation, KHÔNG dùng xương**. Ta đang giới hạn **26 con
  có xương** chạy trên đường ellipse — vừa đắt nhất có thể, vừa vi phạm đúng
  tiêu chí §12 của chính plan ("schools move as groups, not as individuals on
  parallel paths"). Hàm `BODY_UNDULATION_GLSL` viết sẵn cho việc này **đang là
  code chết**.
- **Cái rẻ nhất mà thiếu nhất:** một vật tiền cảnh **tối** trong 1–2 m trước
  camera. Một tàu lá rong, một góc đá. Đó là thứ nói với mắt "bạn đang ở TRONG
  nước", và hiện tại nó hoàn toàn không tồn tại.
- **Có bản xem trước chạy được:** §11 — một file HTML tự chứa, kéo slider độ sâu,
  bật/tắt từng lớp để thấy lớp nào đóng góp bao nhiêu, chạy **không có
  post-processing**.

---

## 1. What the complaint actually is

The owner's words across three specs: *"still visually BAD"*, *"the environment
is empty"*, *"looks like placeholder geometry"*, *"project rất là tệ"*. Read
against the screenshots from the last implementation pass, the failure
decomposes into five things, none of which is a shader defect.

| # | Symptom in the frame | Real cause |
|---|---|---|
| 1 | Nothing is close to the camera | **No foreground layer exists at all.** Every object sits 8–40 m away. Underwater photography and underwater painting both get their depth from something dark within arm's reach |
| 2 | Everything sits in one narrow band of brightness | **The value range is compressed.** Absorption plus a single teal key light put sand, rock, plant and fish inside roughly the middle third of the value scale. Stylised art deliberately uses separated value steps |
| 3 | Distant things are fuzzy texture, not shapes | **We render detail at every distance.** Water destroys detail long before it destroys shape — far geometry should become a flat dark silhouette, not a blurry version of near geometry |
| 4 | The whole frame is one hue | Only *reflected* light is absorbed. We have no near-field objects and almost no emitted light, so nothing in the frame is exempt from the teal. Resolvable **without** breaking the physics — see §4 |
| 5 | The twilight zone is empty | Almost everything the renderer draws stands on a seafloor that, at 142 m viewer depth over a 3.9 km floor, **is not in the frame**. There is no midwater ecosystem |

**The meta-finding.** Every one of the five is a *composition* problem.
[3d-development-limitations.md §3](3d-development-limitations.md) already ranked
the sources of beauty — *"(1) asset có chủ đích → (2) ánh sáng/hậu kỳ → (3) bố
cục do người sắp → (4) độ chi tiết mesh"* — and the last pass spent its effort
on a fifth item that is not on that list: physical correctness of light
transport. That work is not wasted, but it structurally cannot produce the
missing result, in exactly the way the room-kit demo could not.

---

## 2. Reference teardown: `jeantimex/threejs-water`

Fetched and read 2026-08-18. A three.js port by Yong Su of Evan Wallace's WebGL
Water, with real additions.

**What it implements:** the 2D wave equation solved on the GPU with a discrete
Laplacian over **ping-pong buffers**; caustics by the differential-area method
(`brightness = originalArea / projectedArea`); Fresnel reflection/refraction
blending via Schlick's approximation; ray intersection in the fragment shader
(quadratic for spheres, slab method for boxes, SDF for rounded pools); and a
`SimulationObject` interface where objects displace water through
`CompoundSphereWaterDisplacement` — overlapping spheres approximating a complex
mesh.

**What it gives us, honestly:**

| Its technique | Verdict for ocean |
|---|---|
| Differential-area caustics | **Already ours.** `oceanCaustics.ts` uses exactly this, via `dFdx`/`dFdy` Jacobians. Confirming, not new |
| GPU wave equation with ping-pong buffers | **Not applicable, and adopting it would be a mistake.** It simulates a *bounded pool with reflecting walls* reacting to dropped objects. An open ocean has no walls and nothing to drop; the interactive ripple is the entire point of that demo and is not a feature ocean has |
| Fragment-shader ray/pool intersection | Not applicable — it exists to shade a pool's own walls analytically |
| Fresnel + refraction seen from below | **Directly relevant and currently missing.** Ocean has no from-below surface material with a proper Fresnel term, and Snell's window is on the plan's feature-complete list |
| `CompoundSphereWaterDisplacement` | Interesting as a general pattern (approximate an expensive mesh with spheres); no ocean feature needs it today |

**Conclusion:** the repo validates our caustics maths and is a good source for
the **from-below Fresnel surface**. Nothing else. It is not a shortcut to the
look — which matches the rule
[ocean-family-research.md](../vision/ocean-family-research.md) already recorded:
the references define the checklist; none of them supplies the code.

---

## 3. The finding that decides the look

**An underwater frame is built from value layers, not from objects.**

Every reference agrees, and it is the one thing our renderer does not do. Abzû's
team *"intentionally chose the most iconic elements of each species and focused
their design on those, ... simplifying less important details and reducing visual
noise"*. Underwater painting tutorials give the same instruction from the other
end: cooler and darker toward the background, contrast raised in the foreground,
and in deep scenes **high-contrast silhouettes are the primary subject**.

Stated as a rule we can code against:

> At any moment the frame must contain (a) something near-black within 2 m of
> the camera, (b) a readable mid-tone subject at 5–15 m, and (c) a flat, darker
> silhouette mass at 25 m and beyond. If any of the three is missing, the image
> reads flat no matter how correct the light transport is.

Our renderer currently produces **(b) only**. That is the whole gap in one line,
and it explains why more density, better caustics and a truer volumetric march
each failed to fix it: every one of them added more (b).

---

## 4. The colour contradiction is not a contradiction

Two requirements looked mutually exclusive during the last pass:

- Plan §12: *"a red-tinted object at 30 m reads brown-grey without anyone
  authoring brown"* — physically mandatory, and the family's whole thesis.
- Owner: *"the screenshot should still contain meaningful colour accents"*.

Both hold, because absorption applies **per metre of water on the path from the
surface to the object and from the object to the eye**. Three exemptions follow
directly:

1. **Near-field objects.** A fish 1.5 m from the camera has lost almost none of
   its return path. Reds survive at that range. So accent colour belongs on
   **foreground** creatures and props — the same layer §3 says is missing. One
   fix, two problems.
2. **Emitted light.** Bioluminescence is not sunlight and never travelled the
   surface path. Blue-green dominates in nature, but reds and violets occur and
   are physically legitimate at any depth.
3. **The key light's hue is a curve output, not a cap on hue variety.** At 16.7 m
   `surfaceLightColor` is `#1E7F7A`; a single light of that hue makes everything
   that hue. A **second, dimmer, complementary fill** — deep blue-violet from
   below and behind, around 0.25 of key — does not break absorption. It is what
   real water does through multiple scattering, and it immediately gives every
   object two-hue shading instead of one.

**Rule: desaturate with distance, never with proximity.** Colour is a foreground
and emission budget, not a global tint.

---

## 5. Art style: three candidates, one recommendation

| | A. Graded realism (current) | **B. Stylised graphic depth (Abzû-like)** | C. Graphic / near-2D (neal.fun *The Deep Sea*) |
|---|---|---|---|
| Water | PBR everywhere, physical absorption | Physical absorption, used as a **composition tool** | Flat colour bands |
| Detail | Texture at all distances | **Silhouette at distance, detail only near camera** | None |
| Creatures | Few, accurate, skinned | **Many, simplified, instanced + vertex-animated** | Illustrated, static |
| Colour | One hue, physically derived | Desaturated field + saturated near/emissive accents | Bold, arbitrary |
| Requires | Photoreal assets, high poly budget | **Silhouette-readable assets, instancing, density** | Illustration skill |
| Ceiling on our budget | **Low** | **High** | Medium, but abandons 3D |
| Forgives CC0 reuse? | No — a fern reads as a fern up close | **Yes — at silhouette scale a fern reads as soft coral** | n/a |
| Evidence | — | Abzû: 10,000 fish, no rigs (GDC 2017); Fontaine's group-behaviour fish | neal.fun reached millions with no 3D at all |

**Recommendation: B, decisively.**

Not because it is prettier in the abstract, but because **B's requirements are
exactly our capabilities, and its tolerances forgive exactly our weaknesses**:

- B needs *density*. Density is what instancing and a deterministic builder are
  good at, and it costs no artist hours.
- B needs *silhouette reading*. Silhouette reading is what makes the 16 reused
  CC0 nature GLBs legitimate rather than a compromise — and it is why rejecting
  `landmark-heart-tree.glb` was correct: a heart is a *recognisable* silhouette,
  which is the only failure mode this style has.
- B does **not** need photoreal materials, terrain-blended assets, SSR/SSGI or
  WebGPU — the four things
  [ocean-family-research.md](../vision/ocean-family-research.md) and
  [frontend-modernization-research.md](../vision/frontend-modernization-research.md)
  already ruled out.
- B keeps the depth curve intact. Absorption *is* the value ladder B wants; we
  simply stop spending the ladder on surface texture and start spending it on
  layer separation.

Choosing B is therefore **not a rewrite**. It is a redistribution of where the
existing value range and the existing polygon budget get spent.

---

## 6. How creatures should move — the architecture is wrong by one level

### What Abzû did

Procedural animation, **vertex animation shaders for the swim cycle**, and
**static mesh instancing**, rendering up to **10,000 fish on screen with no
skeletal rigs**. Performance came from spatially sorting the fish in memory by
world position and updating them in chunks. Godot's documentation writes the
technique down, crediting Abzû: sine waves in the vertex shader, wave frequency
from position along the body, a gradient that **suppresses motion at the head
and promotes it at the tail**, and a per-instance offset so no two fish beat in
phase.

### What we do

`OceanSkinnedSchool.tsx`: `MAXIMUM_SKINNED_MEMBERS = 26`, each a
`SkeletonUtils.clone` with its own `AnimationMixer`, positioned on an ellipse
(`path.centerX + cos(angle) * radiusX`). That is:

- **two orders of magnitude short** of the count that makes a school read as a
  school;
- the most expensive available way to animate a fish (CPU skinning per clone);
- and literally *"individuals on parallel paths"*, which
  [ocean-service-plan.md §12](../vision/ocean-service-plan.md) names as a
  failure condition.

Meanwhile `oceanSwimming.ts` already contains `BODY_UNDULATION_GLSL` — the
correct vertex-shader implementation, with the quadratic head-to-tail envelope
and the tailward phase term — and **nothing imports it except its own test**.
The right code was written and never wired up.

### Proposed three-tier fauna

| Tier | On screen | Mesh | Animation | Colour |
|---|---|---|---|---|
| **Hero / giant** | 1–3 | Skinned GLB (keep `OceanSkinnedSchool`) | Authored clip + `burstAndCoastThrottle` | Near-silhouette; scale is the effect |
| **School** | 300–2000 | One low-poly `InstancedMesh` per species | **`BODY_UNDULATION_GLSL` in the vertex shader**, per-instance phase | Two-tone: dark back, bright belly. A school reads by *flicker*, not by fish |
| **Far silhouette** | 20–80 | Instanced quad or ~20-triangle fish | Vertex undulation, unlit | Flat, one value darker than the fog |
| **Foreground individual** | 1–2 | The best GLB available | Skinned or vertex | **Full saturation** — this is where colour lives (§4) |

### Movement rules

- **Boids at the school level, not the fish level.** Simulate 6–10 school
  *leaders* on the CPU with separation / cohesion / alignment; every member holds
  a fixed lattice offset from its leader plus a noise wander. Cost is
  O(leaders²) and the read is a group. This is the mechanism Fontaine describes
  as *group-behaviour algorithms*, and the upgrade path
  [ocean-family-research.md](../vision/ocean-family-research.md) already
  identified for `ForestWildlife.tsx`'s flock code.
- **Speed is frequency, never amplitude** — already correct in `tailBeatHertz`,
  and it must survive the port to GLSL.
- **Batoids do not bend along the body.** Already documented via `BATOID_MODE`;
  the pectoral wave is a separate vertex term.
- **Schools must occupy the water column, not a band above the floor.** This is
  the specific fix for the empty twilight frame: the vertical distribution
  currently derives from the seafloor sampler, so when the floor is 3.9 km down,
  so are the fish.
- **Determinism is unaffected.** Per-instance phase, lattice offset and species
  choice are seeded draws appended to a properly named new stream, exactly as
  `-rocks-boulder` was.

---

## 7. Environment construction — the layer stack, in order

Each row is a layer the frame must contain. The rows marked **MISSING** are the
whole of the current gap.

| Order | Layer | Status | Note |
|---|---|---|---|
| 0 | View-direction gradient backdrop | done | Pins the horizon to the fog colour exactly |
| 1 | `FogExp2` from the depth curve | done | Do not touch |
| 2 | **Far silhouette masses** — 2–3 flat dark ridge/rock rings at 0.7 / 1.0 / 1.4 × visibility | **MISSING** | The cheapest geometry in this document. Unlit `MeshBasicMaterial`, one value darker than the fog. This is what makes water read as *big* |
| 3 | Seabed + three rock size classes | done | Keep |
| 4 | Mid vegetation in clusters | done | Keep |
| 5 | School / far-silhouette fauna | partial | §6 |
| 6 | God rays | done | Only above the sunlight floor |
| 7 | Marine snow, three parallax sizes | partial | Near-camera motes must be **large and out of focus**; that is the depth cue, not the count |
| 8 | **Foreground framing element** — kelp blade, rock edge or coral arm within 1–2 m, near-black, partially off-frame | **MISSING** | Single highest-value cheap change in this document |
| 9 | From-below surface with Fresnel + Snell's window | partial | Only above ~60 m. Borrow the Schlick term from `threejs-water` |
| 10 | Midwater drift set — jellyfish, siphonophores, motes | **MISSING** | The twilight zone has no other possible content |

**Camera, not geometry, does the rest.** Two changes with no asset cost: a very
slow positional drift plus a low-amplitude "breathing" bob, and a soft vignette.
Being underwater is a *motion* cue before it is a colour cue, and neither touches
the shared camera contract — both are additive offsets.

---

## 8. UX/UI: the depth number is content

The strongest single piece of evidence in
[ocean-family-research.md](../vision/ocean-family-research.md) is that
neal.fun's *The Deep Sea* moved millions of people **with no 3D at all** — the
depth axis itself was the content. We render the depth axis and then never tell
the user what they are looking at.

All of the following are cheap, and none touches the camera or the lifecycle:

- **Depth HUD.** Metres, zone name, and *"surface light remaining: 16%"* — the
  curve already computes `lightFraction`, so this is a read, not a calculation.
  Below 1000 m it should say plainly that **no sunlight reaches here** and that
  every visible photon is emitted by something alive. That sentence does more for
  the abyss than any shader will.
- **Descent reveal on load.** The camera arrives from slightly above and settles.
  It communicates depth as a journey without a diving controller, which
  [§13 of the plan](../vision/ocean-service-plan.md) puts out of scope.
- **Silence and pressure.** Reuse the existing ambient audio mechanism; the abyss
  should be quieter and lower, not louder.
- **Do not** ship a depth slider in the product. Depth is the world's identity,
  derived from DNA. The slider belongs only in the style-study prototype (§11).

---

## 9. What to stop doing

- **Stop tuning shaders as the response to "it looks bad."** The ranked causes
  are in §1; low-level shader work is phase 10 of the owner's own development
  order, not phase 1.
- **Stop rendering detail at distance.** It spends frame time to produce the
  exact thing that flattens the image.
- **Stop scattering 26 skinned fish.** Either it is a hero, or it is instanced.
- **Do not add anything else that stands on the seafloor** until the midwater set
  exists — two of the three zones cannot see the floor.

---

## 10. Hard vs soft limits, for ocean specifically

**Hard** (architectural; not purchasable at this design):

- WebGL2 only → no FFT waves, no path-traced volumetrics, and none of the
  WebGPU/TSL references (Deep Abyss, Three.js Water Pro) are reachable.
- `@react-three/postprocessing` pinned at 3.0.4 against three 0.171.0 → the
  effect stack and the three version move together.
- The frame must read **with post-processing disabled** (plan §12), so bloom can
  never be load-bearing for bioluminescence.
- Deterministic generation → no runtime mesh synthesis, no `Math.random()`.

**Soft** (buy with effort):

- Silhouette layers, foreground framing, midwater set → **hours, not asset
  budget.** This is the cheap half of the gap.
- Instanced vertex-animated schools → one shader plus one refactor; the GLSL is
  already written and tested.
- From-below Fresnel surface → one material; the technique is available from
  `threejs-water`.
- Species silhouette quality → the only item that genuinely wants an artist or
  more curation, and it comes **last**, not first.

**Unresolved and blocking verification:** `EffectComposer` blacks out the ocean
under software WebGL (swiftshader), so every screenshot to date was taken with
post-processing disabled and nothing has been confirmed on a real GPU.

---

## 11. Previewable output, and the phase order

The owner's constraint — *"có thể xem được trước output đơn giản đã"* — is
correct, and should become a rule rather than a one-off: **no phase lands without
an image.**

**Prototype built alongside this document:** a single self-contained HTML style
study with three.js inlined — no build step, no network. It exposes a depth
slider, the three zone presets, and a **per-layer toggle set**, so the
contribution of each row in §7 can be seen in isolation. Its purpose is to settle
the art-direction question *before* `OceanRenderer.tsx` is touched, and it runs
**without post-processing** on purpose, so what is seen is what the renderer must
achieve unaided.

| Phase | Work | Image that proves it |
|---|---|---|
| V1 | Foreground framing element + far silhouette masses + second fill light | Same seed, before/after, sunlit reef. Should be the largest single jump in this document |
| V2 | Instanced vertex-animated school (`BODY_UNDULATION_GLSL` wired), boids at leader level | A frame where a school reads as one moving body |
| V3 | Midwater drift set, water-column vertical distribution | A twilight frame that is no longer empty |
| V4 | Value-step pass: separate near/mid/far bands, second fill, near-field saturation | Visible value separation on all three zones |
| V5 | From-below Fresnel surface + Snell's window | Looking up from 15 m |
| V6 | Depth HUD + descent reveal + vignette | The load sequence |
| V7 | Only now: shader refinement, LOD, real-GPU performance | Frame-time table |

---

## 11b. Correction found by building the prototype: depth is a place, not a colour

The first prototype was wrong in a way the research doc had not caught, and the
owner named it immediately: *"Cải của bạn là độ sáng theo độ sâu chứ không phải độ sâu
thực sự."* It varied the palette with depth and left the seabed at the same
distance at 17 m and at 2431 m.

**Depth is spatial.** Two numbers, not one:

```
floorClearance  = seafloorMetres - viewerMetres
surfaceDistance = viewerMetres
```

and one rule applied twice: **a boundary is drawn only when it lies within about
1.5 visibilities.** Everything else falls out.

| World | Viewer | Seabed | Surface | Floor | What it is |
| --- | --- | --- | --- | --- | --- |
| Reef | 8 m | 15 m | in sight | in sight | Both boundaries in one frame |
| Open water | 17 m | 3.7 km | in sight | **gone** | Shallow with **no bottom** |
| Twilight | 142 m | 3.9 km | gone | gone | Pure water column |
| Abyssal plain | 2431 m | 2455 m | gone | in sight | Floor, lit only by living things |

The real renderer already computes `floorClearanceMetres` and gates the boundary
on `visibilityMetres * 1.5`; the prototype had discarded it. Two consequences
worth carrying into the renderer work:

1. **"Shallow" does not imply a visible seabed.** The open-ocean mean depth is
   3,682 m, so a diver at 17 m over open water sees the surface and nothing
   below. That frame is a real world state, not a bug, and it is the one the
   twilight-zone emptiness problem is a special case of.
2. **Species belong to zones, and the reason is anatomy, not art.** Bottlenose
   dolphins surface every 20-40 s and coastal animals rarely exceed 9-30 ft, so
   a pod cannot inhabit a world where it can never reach air — and a pod rising
   to breathe is the most legible behaviour any animal in the scene can perform.
   Lanternfish (Myctophidae) migrate between 10 m and 2000 m, carry
   species-specific rows of photophores for counter-illumination, and are the
   most abundant vertebrates on Earth: they are what makes the twilight zone
   populated. Roughly **76% of open-ocean animals are bioluminescent**, which is
   why the abyss has light at all.

Also added in the same pass, each of which the owner had asked for by name and
each of which turned out to be a layer rather than a shader tweak: the water
surface seen from below (Snell's window, a 97-degree cone whose edge sits 41
degrees up — so the camera has to look **steeply** up, about 62 degrees, before
the disc is inside a 58-degree frame), rising bubble streams from vents (0.42 m/s,
spiral wobble from alternating vortex shedding, expanding as pressure falls), and
barrel sponges for floor mass, since a reef built only from blades has nothing
solid in it.

**Two proportion bugs found only by looking at the render**, both of the kind no
test catches: every body profile used `pow(sin(PI * pow(t, k)), n)` with `k < 1`,
which drives the radius from zero to a third of maximum inside the first tenth
of the body — a flat disc where the snout should be, a funnel pointed at the
camera. The fix is an asymmetric bump that reaches zero at both ends,
`r(t) = K · t^a · (1-t)^b`, with the shoulder forward at `a/(a+b)`. And the
bodies were 2.5× too fat: a shark is about 6:1 length to depth, not 2.5:1.

---

## 11c. Second correction: the frame was dark because absorption was doing two jobs

The v3 prototype was rejected with one sentence — *"biển lại quá tối và kém hấp
dẫn… không thể nhìn được"* — on the abyssal preset, which rendered as a black
rectangle with a few green arcs in it. Four separate faults produced that, and
three of them are in the real renderer's design too, not only in the prototype.

### Fault 1 — photometry mapped straight to screen luminance

The depth curve returns *light remaining*, and every colour and every light was
multiplied by it. Below 200 m that number is a fraction of a percent; below
1000 m it is exactly zero. Multiplying a palette by zero produces a black
rectangle — which is correct physics and a useless image.

Every deep-sea photograph humanity owns was made either by an eye that had
dark-adapted (about five orders of magnitude in twenty minutes) or by a camera
carrying its own light. Neither maps irradiance to display luminance. So the
prototype now keeps two separate numbers:

| number | what it is | what it drives |
| --- | --- | --- |
| `brightness` | physical light remaining, `pow(fraction/0.45, 0.42)` | **ratios** between surfaces, caustic and god-ray strength |
| `litness` | `max(brightness, 0.11 + 0.30 × biolum)` | light-rig intensities — never zero |
| `exposure` | `1.02 + pow(1 − min(1, brightness/0.26), 1.6) × 0.62` | tone-map exposure; **1.02 near the surface, so it changes nothing there** |

Adaptation only ever lifts a frame that has already gone too dark to read. This
is one line in `applyWorld` and it is the difference between a picture and a
black rectangle.

### Fault 2 — absorption was setting hue *and* value

`fog = CLEAR_WATER × spectral × brightness` counts depth twice: `spectral`
already removes most of the light on its own. At seventeen metres it produced
`#0A2A49`, where clear tropical water photographs as a luminous blue-teal.

Absorption decides **which hue survives** — that part is sound, and it is the
mechanic that makes depth legible without anyone authoring a palette. It must
not also decide how bright the frame is. Split:

```js
const fog = CLEAR_WATER.clone().multiply(spectral);
fog.lerp(CLEAR_WATER, 0.34);                       // one hue is symptom four
const fogValue = 0.13 + 0.66 * Math.pow(brightness, 0.8);   // floored, never 0
fog.multiplyScalar(fogValue / Math.max(fog.r, fog.g, fog.b, 1e-4));
fog.lerp(ABYSS_GLOOM, pow(1 - min(1, brightness/0.16), 1.5) * 0.85);
```

Seventeen metres went from `#0A2A49` to `#1F94C1` with **no change to the depth
model at all**. Everything else in this section only became visible once this
was fixed.

Corollary, learned immediately afterwards: anything that has to read as brighter
than the water must be **derived from the water's value, not set to a
constant**. Brightening the fog while leaving Snell's window on fixed colours
made the window disappear into the water. The window is now `zenith ≈ 1.3 ×`
and `rim ≈ 1.8 ×` the water's value at every depth, and that ratio is what a
viewer actually reads as "a window".

### Fault 3 — the surface, seen from below, was painting a dark opaque ceiling

Outside Snell's 48.6° cone the surface is a mirror by total internal
reflection. At the grazing angles that fill most of a level frame, that mirror
covered the upper half of every underwater shot — and the mesh is 450 m across
with `fog: false`, so a sheet of water four hundred metres away was being drawn
at full strength. Water swallows it long before that.

```glsl
float d = length(vWorld - cameraPosition);
float swallow = 1.0 - exp(-pow(d * uFogDensity, 2.0));
color = mix(color, uWaterColor, clamp(swallow, 0.0, 1.0));
```

Same extinction law as the medium, because the sheet is *in* the medium.
Overhead it is metres away and survives untouched; at grazing angles it is gone.
This single term is what removed the "dead dark zone at the top of the frame"
that had been diagnosed as an art-direction problem twice.

### Fault 4 — ambient raised to "brighten the scene"

§13 of the forest memo and this document's own light-rig section both say it:
an ambient strong enough to brighten a scene lights every face of every object
equally and flattens all of them. Raising ambient to `0.9` in the deep turned
the abyssal seabed into a flat slab of one colour that no amount of lamp work
could shape. Ambient is now `0.30 + brightness × 0.28` — weak at every depth —
and the near field belongs to a **dive light**: a point light at the camera,
range 140 m, decay 1.3, ramping in only as the sun runs out.

The dive light is not a cheat. Below the photic zone there is no other way to
see anything, which is why every image we have of the deep sea was lit this way,
and it earns back the one thing absorption takes: near-field colour, at exactly
the depth where the frame has nothing else in it.

### And one preset that was simply wrong

The abyssal preset placed the viewer 24 m off the bottom with 20 m of
visibility, so the seabed was 79% fog: a flat slab, by construction. A
submersible flies a few metres off the bottom. The preset is now 7 m, and the
lamp pool reads.

---

## 11d. Above the waterline — the cheapest beauty in the study

Asked for, and worth more than it costs: `viewerMetres < 0` is not a special
case bolted on, it is the same rig with the medium swapped. Air extinguishes
light roughly a thousand times more slowly than water, so visibility becomes
kilometres, distance reads as haze rather than absorption, and **nothing in
frame is dark**. That is why every water demo anyone links to is an above-water
one, and why this preset is now what the study opens on.

### What was taken from three.js's own `Water.js`

`examples/jsm/objects/Water.js` is the shader behind `webgl_shaders_ocean` and
behind most of the water people post. Read in full at
`apps/myunivokai-web/node_modules/three/examples/jsm/objects/Water.js`.

| technique | verdict | why |
| --- | --- | --- |
| One tiling normal map sampled **four times** at four scales and four scroll rates, summed (`getNoise`, divisors 103 / 107 / 8907·9803 / 1091·1027) | **taken verbatim, constants included** | The plane never moves. The periods are mutually prime enough that the sum never visibly repeats, which is why it holds up at a metre and at a kilometre and costs nothing. |
| `sunLight()`: `shiny 100, spec 2, diffuse 0.5` | **taken verbatim** | The specular is the glitter path; the diffuse is what stops the far water going flat. |
| Fresnel with `rf0 = 0.3` | **taken, but at the physical 0.02** | Water.js inflates rf0 to compensate for a dim mirror texture. Our sky is analytic and correctly bright, so the honest number works. |
| Reflection from a real render target via an oblique-frustum mirror camera | **rejected** | A second full scene render per frame is not in the mobile budget. Replaced with an analytic sky reflection: exact for an empty horizon, wrong for anything standing in the water. Nothing stands in this water — **but the moment the renderer puts a boat, a rock or a cliff at the surface, this is the term that has to become a render target.** |
| No foam at all | **added** | Whitecaps are most of what makes a sea read as a sea. |

### Findings the reference does not contain

- **A sum of plane waves is always quasi-periodic**, so a procedurally generated
  normal map made of sines lays a visible cross-hatch lattice across the whole
  sea. This is the identical failure the caustics had, and it takes the
  identical fix: **warp the domain with a tileable noise field** before
  evaluating the waves. Tileability survives because the warp itself tiles.
  (Water.js dodges this by shipping a photographic `waternormals.jpg`, which a
  self-contained demo cannot.)
- **Only the swell should be geometry.** At 30 m per quad nothing finer
  survives, and displacing what cannot be resolved makes a sea shimmer with
  aliasing instead of with light. Everything below swell scale is the normal map.
- **Foam is not paint on a crest.** It needs the steep, high part of the swell
  *and* a second uncorrelated pattern, or it reads as a stripe drawn along the
  crest line. Watch out for using the normal map's **Z channel** in that second
  pattern: it sits near 1.0 everywhere and pins the mask wide open.
- **Highlights need something below them.** With a pale sky, the whitecaps and
  the glitter path were both invisible — not because they were weak, but because
  the water was already as bright as they were. Deepening the sky and saturating
  the water made both appear with no change to their own strength. This is the
  same value-ladder rule as §3, in a different medium.
- **The haze the water fades into must be the colour the sky has at the
  horizon**, or the two meet on a hard step and the sea becomes a painted
  backdrop. Same rule as the underwater fog/backdrop match.

### One sun, used twice

The sun sits 32° above the horizon. Seen from underneath, refraction bends it
toward the zenith by Snell's law, so it appears at about 50° — inside the
window, near its rim. The underwater layers now use the **bent** direction, so
the god rays and the hot spot inside Snell's window agree with the sky that is
making them:

```js
const horizontal = Math.hypot(SUN_ABOVE.x, SUN_ABOVE.z);
const sinRefracted = horizontal / 1.333;
```

And whenever the surface is in reach the camera locks its yaw to the sun's
azimuth, because the window, the god rays and the glitter all live in one
direction, and a camera pointed anywhere else in a sunlit ocean is pointed at
nothing.

### Scale discipline, learned the hard way

A three-metre shark on a 42 m ring passes within twelve metres of a camera
orbiting at thirty, and at a 58° field of view it fills half the frame. Up
close, procedural geometry is exactly as crude as it is — flat fin quads, a
blobby body — so the animal meant to be *a moment* became the worst thing on
screen. Big animals were moved out to 58–118 m; small fish were moved **in** to
13–19 m, because a 22 cm fish at 26 m is two pixels and is not content. This is
not a workaround for weak meshes; it is how these animals are actually filmed.

### Not fixed, and known

- No reflected geometry above water (analytic sky only, see the table).
- The above-water frame is art-directed for one sun elevation; golden hour is a
  different and probably better-looking preset that has not been tried.
- The sea is still monochrome blue-grey rather than the deep blue of the
  references — the remaining gap is a real sky model (Preetham/Hosek, i.e.
  three.js `Sky.js`) instead of a two-colour gradient.
- Nothing verified on real GPU hardware: every screenshot in this round is
  swiftshader.
- Dolphins are the only animal drawn above the waterline, and only during a
  breach.

---

## 11e. Third correction: the custom shaders were never tone-mapped

Found while porting a real sky model, and it retroactively explains three
rounds of art-direction argument.

Every hand-written `ShaderMaterial` in the prototype — the surface seen from
below, the surface seen from above, the backdrop — ended with a bare
`gl_FragColor = ...`. three.js does **not** apply tone mapping or the output
colour-space conversion for you: those are two shader chunks a material has to
include. Water.js and Sky.js both end with exactly:

```glsl
#include <tonemapping_fragment>
#include <colorspace_fragment>
```

Without them:

- **`renderer.toneMappingExposure` did nothing** to any custom shader, and any
  value above 1.0 clipped hard to white. **That is what "chói lóa" was.** Snell's
  window was not too bright — it was *unmapped*. Every "keep this under 1.0 in
  linear so the tone map doesn't clip it" note written in earlier rounds was a
  workaround for a missing include, and the workaround was hiding the cause.
- **Linear values were written straight into an sRGB framebuffer**, so every
  custom shader rendered darker than authored, which is part of why the frame
  kept needing to be lifted.

A `ShaderMaterial` gets the `TONE_MAPPING` define, the `toneMapping()` function
and the `toneMappingExposure` uniform automatically as long as
`material.toneMapped` is true, which is the default. The whole fix is two lines
per shader. **Check this first in the real renderer**: `OceanRenderer`'s custom
materials are the same shape and the same bug class.

### The lesson, stated so it survives

Three rounds of this study were spent adjusting colours to compensate for a
broken pipeline. The tell was available the whole time and was not read: *large
areas of pure #FFFFFF with no gradient at all*. Clipping is flat; a bright
gradient is not. A tone map that is working never produces a plateau.

---

## 11f. A real sky, and a sun that is one number

Snell's window and the sea surface had been built from hand-picked hexes
(`#2E6E96` zenith, `#DCEEF7` rim) that had to be re-tuned every time the water's
value changed. They are gone. `examples/jsm/objects/Sky.js` — Preetham's
analytic daylight model, the one three.js ships and the one behind
`webgl_shaders_ocean` — is now ported into this demo as **one GLSL function**,
and three different things call it:

| caller | direction it asks about |
| --- | --- |
| the sky dome, above water | the view direction, with the solar disc |
| the sea surface, above water | the reflected view direction, **without** the disc — a mirrored 19000× disc through a wave normal is a field of white pixels, not a glitter path |
| Snell's window, below water | the view direction **un-refracted**: `sin(air) = 1.333 × sin(water)` |

That last row is the one worth having. Every pixel inside the cone now looks at
a real direction in a real sky: the dark zenith at the centre, the entire
compressed horizon at the rim, the sun where the sun actually is — and it cannot
disagree with the dome, because it is the same function.

Porting it required one structural change. Preetham's per-view constants
(`betaR`, `betaM`, `sunE`, `sunfade`) live in Sky.js's **vertex** shader, which
makes the model unusable from any other material. They depend only on turbidity,
rayleigh, the Mie coefficient and the sun direction, so they were moved to the
CPU and shared by reference as one uniform block.

**Turbidity is the setting that matters and the reference's value is wrong for
us.** three.js's ocean example ships `turbidity: 10, rayleigh: 2` — a hazy
coastal sky, which measured here at **saturation 0.05**: a white rectangle. The
water can only ever be as blue as the sky it mirrors. `turbidity: 3,
rayleigh: 3` is the clear blue sky this family wants.

### The sun is now a control, and Snell's law is applied to it properly

One slider, 1° to 80°, with eight consumers routed through a single function —
because disagreement between the sky, the specular highlight, the god rays and
the window is precisely the class of bug that cost this study three rounds. The
underwater direction is derived, never authored:

```js
const sinRefracted = Math.cos(elevation) / 1.333;
```

A sun on the horizon refracts to 48.6° from vertical — the rim of the window. A
sun overhead stays overhead. **There is no sun position that puts daylight
outside the cone**, which is why the cone exists. God rays now travel along the
refracted direction, and the key light comes from where the sun actually is
rather than from the `(-24, 74, 14)` it had been nailed to since v1.

Golden hour is a preset, not a rewrite: elevation 5°.

### And a composition rule that is worth more than any shader

Measured: facing the sun gives the above-water frame **saturation 0.12**. Facing
118° away gives **0.17 overall and 0.31 in the near field**, with the same
shaders and the same exposure. The reason is geometric — water mirrors the sky
it faces, the sky opposite the sun is the deep blue one, and the sky *at* the
horizon is white by optical path length no matter what. So the presets carry a
facing, measured from the sun: `Above water` looks 118° away for a blue sea,
`Golden hour` looks straight into the glitter path.

This is why every guide on photographing the sea says to keep the sun behind
your shoulder, and it belongs in the renderer's camera defaults, not in a
shader.

---

## 11g. Real models, and the proof that the locomotion model is asset-independent

The twelve CC0 GLBs in `apps/myunivokai-web/public/assets/ocean/models/` were
the largest thing this study had never touched. Four are now wired into the
prototype — shark, dolphin, whale, manta ray — as the actual bytes the renderer
will ship.

**Nothing about the animation had to change.** The swim shader's entire contract
with its geometry is one float attribute, `along`, 0 at the nose and 1 at the
tail. Any mesh that can be put in the same local frame inherits the whole
locomotion model — anguilliform onset, tail-beat frequency, mobuliform
spanwise flapping, counter-shading — for free. That is the Abzû approach, and
this is the proof of it rather than the claim.

The four models are **74 to 405 triangles**. Everything the earlier rounds
assumed about model cost was wrong in the cheap direction: these are low-poly
CC0 assets and instancing them is free. The schools stay procedural anyway,
which is the correct call for a different reason — a thousand instances of a
detailed mesh is the cost the vertex-animation approach exists to avoid, and at
two pixels across nobody can tell.

### Three things that had to be solved, and one that must not be guessed

1. **A self-contained page cannot `fetch()` a `.glb`** from a `file://` URL.
   Models travel as base64 `data:` URLs written into the page at build time.
   `GLTFLoader` itself is an ES module whose only dependencies are three and one
   helper, so the build step turns it into a classic script mechanically:
   replace the import block with a destructure off the global `THREE`, inline
   `toTrianglesDrawMode`, rewrite the export to a global. Not one line of the
   loader is patched.
2. **Counter-shading is written in absolute units** against a body about 0.34
   deep, which is what the procedural profiles produce. The shark GLB is 0.11
   deep once normalised on length, so a real model rendered in one flat tone
   until the belly coordinate was rescaled by `0.17 / halfHeight`.
3. **The manta's longest axis is its wingspan, not its body.** Taking the
   longest axis as the body axis turns a ray into a snake.
4. **Which end is the head must be declared, not inferred.** Two heuristics were
   tried and both failed silently:
   - *the vertically deeper end* — wrong for a dolphin, whose dorsal fin and
     tail stock are deeper than its rostrum;
   - *the end with more total cross-section* — wrong for a shark, because
     summing lets tessellation vote, and that GLB carries far more vertices in
     its fins than in its shoulders.

   The mean cross-section per half is right for all four, but "right for all
   four" is not a rule. So orientation is **declared per model** and then
   **checked** against the measurement, with a console warning on disagreement.
   An animal swimming backwards is an obvious bug that a still frame never
   reveals.

The renderer will need this same table. It is metadata, and it belongs next to
`oceanDressingModels.ts`.

---

## 11h. Measuring the frame instead of looking at it

No frame in this study has been seen on real GPU hardware: every screenshot came
from swiftshader in a headless browser, described by an agent. Three rounds were
tuned by eye and three rounds shipped a fault the eye looked straight past — a
frame clipped to white, a frame crushed to black, a seabed that was a flat slab
of one colour. All three are trivial to detect with numbers, so
`demos/ocean-depth-rig/measure.mjs` now does:

| metric | what it catches | healthy |
| --- | --- | --- |
| `luma` | exposure | 0.30–0.60 daylight, 0.15–0.30 abyss |
| `blown` | **glare, numerically** | under ~2% |
| `crush` | image thrown away | ~0% |
| `sat` | a grey frame wearing a palette | over ~0.10 |
| `detail` | local contrast — **the flat-slab detector** | over ~0.5 where objects should be |

`detail` is the one a human reviewer cannot replace: a mean luminance cannot
tell a lit seabed from a painted one. It is also what proved the abyssal floor
was still flat after being made *visible*, which led to the boulders.

Current state, all six presets, at 900×520 under swiftshader:

| preset | luma | blown | crush | sat | detail |
| --- | --- | --- | --- | --- | --- |
| Above water | 0.52 | 0.0% | 0.0% | 0.17 | 2.47 |
| Golden hour | 0.33 | 0.0% | 0.0% | 0.31 | 2.67 |
| Reef | 0.56 | 0.2% | 0.0% | 0.74 | 2.20 |
| Open water | 0.62 | 0.0% | 0.0% | 0.69 | 0.96 |
| Twilight | 0.46 | 0.0% | 0.0% | 0.69 | 1.24 |
| Abyssal plain | 0.22 | 0.0% | 0.0% | 0.66 | 1.00 |

It also asserts every model's declared orientation against its measured profile
and exits non-zero on any page error, so it is a check, not a report. **This is
the smallest useful piece of infrastructure in the whole study**, and the
renderer should have the same thing wired into `scene-baseline.spec.ts`, where
the fixtures and the headless browser already exist.

### Still not fixed, and now precisely stated

- **No reflected geometry above water.** The reflection is analytic sky: exact
  for an empty horizon, wrong for anything standing in the water. The day the
  renderer puts a rock, a boat or a cliff at the waterline, this becomes a
  render target — and the three.js forum thread on the ocean example is the
  place to start, because Water.js reflects correctly only for a plane whose
  **Object3D** is oriented, not one whose geometry was rotated.
- **The horizon band is white and always will be.** Optical path length at 0°
  elevation is unbounded; that is not a bug and cannot be tuned away. It can
  only be composed around, which is what the sun-relative facing does.
- **Open water measures `detail` 0.96 across the whole frame** — the quietest
  preset by the numbers as well as by eye. Water with no boundary in reach has
  nothing in it but drifters, and it needs more of them.
- **Twilight's lower third measures `detail` 0.39**: flat. Same cause.
- **Still nothing on real hardware.** `measure.mjs` narrows what can hide there;
  it does not replace it.

---

## 11i. The sea state is one number, and it is wind speed

The surface was five sine waves with amplitudes chosen by eye. It is now a
**Pierson–Moskowitz spectrum realised as eight Gerstner components**, and the
only input is the wind speed at 10 m — which is what every marine forecast,
every moored buoy and every paper on this uses. That matters for the service far
more than it matters for the demo: a config can carry `windSpeedMetresPerSecond`
and mean something, where `swellAmplitudeMetres: 1.3` means nothing to anyone.

### What is derived, and from what

| quantity | formula | source |
| --- | --- | --- |
| significant wave height | `Hs = 2.14e-2 · U²` | Pierson–Moskowitz 1964, fully developed sea |
| peak angular frequency | `ωp = 0.877 g / U₁₉.₅` | same |
| spectral density | `S(ω) = α g² ω⁻⁵ exp(−β (g/(U ω))⁴)`, α = 8.1e-3, β = 0.74 | same |
| wavenumber | `k = ω² / g` | deep-water dispersion |
| whitecap coverage | `W = 3.84e-6 · U₁₀^3.41` | Monahan & O'Muircheartaigh 1980 |
| Beaufort force | WMO bands in m/s | WMO |

`U₁₉.₅` is the wind at 19.5 m, because that is where the weather ships that
produced the spectrum measured it; the log wind profile puts it about 6% above
`U₁₀`. Component amplitudes are `sqrt(2 S(ω) Δω)` — the standard discrete
realisation of a continuous spectrum — then scaled so that `4·sqrt(variance)`
equals `Hs` exactly, because a spectrum sampled at eight points does not carry
its own variance faithfully but a wave height is a promise.

What that produces, and it can be checked against any Beaufort table:

| U₁₀ | Beaufort | Hs | peak λ | whitecaps |
| --- | --- | --- | --- | --- |
| 2 m/s | 1 | 0.09 m | 4 m | 0.00% |
| 5 m/s | 3 | 0.54 m | 23 m | 0.09% |
| 10 m/s | 5 | 2.14 m | 94 m | 0.99% |
| 15 m/s | 6 | 4.82 m | 211 m | 3.93% |
| 20 m/s | 8 | 8.56 m | 374 m | 10.49% |

### Three things this changed that were not about numbers

**Gerstner, not sine.** Water particles travel in circles, so crests sharpen and
troughs flatten. The horizontal half of that circle is the only reason a rendered
sea has the asymmetric profile a real one has; a sine gives symmetric humps at
any amplitude. Gerstner also ties knots if pushed past `Q · Σ(A k) = 1`, so the
steepness is held at 0.72 of that limit — sharp crests, no knots.

**Foam belongs to the Jacobian, not to the crest height.** The determinant of the
horizontal displacement gradient collapses exactly where the surface is
overtaking itself, and overtaking itself *is* breaking. Foam now appears on the
forward face of steep crests without being told to, and the threshold is driven
by Monahan's coverage so a Beaufort 3 sea has streaks and a Beaufort 8 sea is a
tenth white. (The mapping from coverage to threshold is a fit; the coverage
going into it is measured. That is still a large improvement on a slider.)

**A polar grid, not a plane.** A flat 6 km plane at 200 segments puts 30 m
between vertices, and at a 94 m peak wavelength that aliases the swell into a
shimmer. What matters is angular size from the camera, so the mesh is now rings
whose radius grows geometrically: 1.4 m spacing at the viewer, hundreds at the
horizon, for the same vertex count. This is the cheap cousin of a projected grid
and the renderer should use it for anything that extends to a horizon.

**And the two faces of the water finally share one surface.** Before this the sea
seen from above and the ceiling seen from below ran different wave functions —
two unrelated shapes for one sheet of water. Same discipline that fixed the sky:
one function, several callers.

### A finding worth stating plainly

**A physically correct Beaufort 4 sea is not very dramatic.** The old hand-tuned
swell was about 4.7 m peak-to-trough; a real Beaufort 4 is 1.2 m. When the
spectrum went in, the frame's measured local contrast *fell by 40%*. The
dramatic ocean everyone pictures is Beaufort 6 and up, so the presets now say so
— and the reason the frame still reads is that the sparkle was never in the
swell. It is in the capillary ripple, which lives entirely below vertex scale
and comes from the normal map.

---

## 11j. Water clarity is a parameter, and visibility never depended on depth

Jerlov's 1976 classification is still what ocean optics uses: **I, IA, IB, II,
III** for open ocean and **1C–9C** for coastal, defined by the downwelling
diffuse attenuation coefficient `Kd`. It is now the demo's water input, and it
replaces the hand-typed light table outright — the table was a curve fitted to
one kind of water, and this is the physics that produced it.

Per-channel `Kd` is reconstructed from two individually-sourced terms, because
the published tables are spectra and this file does not have them:

```
Kd(channel) = a_pure_seawater(channel) + load · shape(channel)
a_pure_seawater  = 0.30 / 0.065 / 0.016 per metre   (red / green / blue)
shape            = 0.5  / 0.8   / 1.0
load             = Kd(475 nm) of the type − 0.016
```

`a_pure_seawater` is a **floor, not a parameter**: no water can be clearer, and
it is why red dies in the first few metres of even the clearest ocean. `load` is
the type's own turbidity, weighted toward blue because CDOM and phytoplankton
absorb hardest at short wavelengths.

**That last detail is the whole reason coastal water is green.** Not "more
attenuation" — attenuation with a different colour. And the model produces the
full progression on its own: at type 7C, `Kd` blue exceeds `Kd` red, so an
estuary comes out brown. Nobody authored that.

| type | Kd rgb | sighting range | 1% of blue at | green left at 40 m |
| --- | --- | --- | --- | --- |
| I | 0.304 / 0.072 / 0.025 | 64 m | 184 m | 5.6% |
| IB | 0.317 / 0.092 / 0.050 | 50 m | 92 m | 2.5% |
| II | 0.335 / 0.120 / 0.085 | 38 m | 54 m | 0.8% |
| 1C | 0.392 / 0.212 / 0.200 | 22 m | 23 m | 0.0% |
| 5C | 0.642 / 0.612 / 0.700 | 8 m | 7 m | 0.0% |

Cross-check: the clearest ocean water is reported at 60–80 m horizontal
visibility, and the euphotic (1% PAR) depth of open ocean is famously about
100 m. The table produces 64 m and 92 m from Jerlov's own `Kd` and nothing else.

### The conceptual error this exposed

The old model computed `visibility = 20 + 80 · brightness`. **Visibility is a
property of the water, not of the depth.** At two thousand metres a lamp reaches
exactly as far as it does at twenty; what runs out with depth is the *sun*.
Getting that backwards is why the abyssal preset had 20 m of sighting range and
could not show its own seabed — and the metric proves the fix: with `Kd`-derived
range, the abyssal floor's measured local contrast went from **1.53 to 4.80**
with no change to any light, colour or geometry.

Sighting range is now `4.6 / Kd(green)`: contrast falls by `1/e` per attenuation
length and the eye gives up around 2%, which is 4.6 lengths.

---

## 11k. What the ocean service should carry

This is the payoff of the last three rounds, and the reason to write any of it
down. A world in this family should be describable by **five numbers and an
enum**, all of which are things oceanographers already measure:

| field | unit | drives | source of truth |
| --- | --- | --- | --- |
| `viewerDepthMetres` | m, negative for air | which boundaries are in frame, all absorption | §11b |
| `seafloorDepthMetres` | m | the same, applied twice | §11b |
| `jerlovWaterType` | enum I…9C | `Kd` rgb → colour, light-with-depth, sighting range, fog density, caustic coherence | §11j |
| `windSpeedMetresPerSecond` | m/s at 10 m | wave spectrum, wave height, peak wavelength, whitecap coverage, choppiness | §11i |
| `sunElevationDegrees` | ° | the whole sky, the refracted underwater sun, god-ray direction, key light | §11f |
| `sunAzimuthDegrees` | ° | camera facing, and the composition rule that a sea is blue away from the sun | §11f |

Everything else in the renderer — every colour, every fog density, every light
intensity, every foam threshold — is **derived**, and the derivations are the
ones in this document. Nothing in that list is an art-direction number, none of
it needs a designer to tune per world, and all of it is deterministic from a
seed plus a config.

Three properties of that shape are worth naming, because they are what makes it
worth doing:

1. **It cannot produce an incoherent world.** A hand-authored palette can pair
   50 m of visibility with estuary-green water; `Kd` cannot.
2. **It is legible in a rarity catalogue.** "Jerlov I, Beaufort 2, sun at 70°" is
   a describable, findable, tradeable kind of ocean. "fogDensity 0.0135" is not.
3. **It survives contact with real assets.** Nothing in the list is about meshes,
   so swapping procedural bodies for the CC0 GLBs changed none of it (§11g).

What is NOT in the list, deliberately: anything about which animals are present.
Species are a zone question answered by depth plus water type plus the rarity
roll, and mixing them into the physics is how a config starts needing a designer.

---

## 12. Sources

All opened 2026-08-18.

- [jeantimex/threejs-water](https://github.com/jeantimex/threejs-water) — GPU
  wave equation with ping-pong buffers, differential-area caustics, Schlick
  Fresnel, fragment-shader ray intersection; port of Evan Wallace's WebGL Water.
- [GDC Vault — Creating the Art of ABZÛ](https://www.gdcvault.com/play/1024409/Creating-the-Art-of-ABZU),
  [80.lv coverage](https://80.lv/articles/gdc-2017-creating-the-art-of-abzu),
  [Game Developer](https://www.gamedeveloper.com/art/video-creating-the-striking-underwater-seascapes-of-i-abzu-i-)
  — vertex animation plus static mesh instancing, 10,000 fish, no skeletal rigs,
  spatial sorting with chunked updates; iconic-element species stylisation.
- [Godot — Animating thousands of fish with MultiMeshInstance](https://docs.godotengine.org/en/stable/tutorials/3d/vertex_animation/animating_thousands_of_fish.html)
  — the technique written down, crediting Abzû: sine waves in the vertex shader,
  frequency from body position, head-suppressing gradient, per-instance offset.
- [Vertex displacement shader for a swimming fish](https://elvismd.com/index.php/2020/06/13/tutorial-vertex-displacement-shader-for-a-swimming-fish/)
  and [Bitshift Programmer](https://www.bitshiftprogrammer.com/2018/01/how-to-animate-fish-swimming-with.html)
  — concrete shader form.
- [Codrops — Creating Stylized Water Effects with React Three Fiber](https://tympanus.net/codrops/2025/03/04/creating-stylized-water-effects-with-react-three-fiber/)
  and [screen-space refraction / Beer–Lambert underwater in R3F](https://nitinchotia.medium.com/building-an-immersive-underwater-scene-with-react-three-fiber-and-three-js-ed1ed9114506)
  — depth-texture absorption on our exact stack.
- [Realistic real-time underwater caustics and godrays](https://www.academia.edu/20286286/Realistic_real_time_underwater_caustics_and_godrays)
  — both effects at 60 fps on commodity hardware; confirms the approach taken.
- [Visual enhancement and 3D representation for underwater scenes: a review (arXiv 2505.01869)](https://arxiv.org/pdf/2505.01869)
  — wavelength attenuation order and suspended-particle scattering.
- [CLIP STUDIO — drawing underwater scenes](https://tips.clip-studio.com/en-us/articles/11207)
  — the painters' rules: cooler and darker background, contrast forward,
  silhouettes as the subject in deep scenes, near bubbles blurred.
- [Stylised art-direction principles](https://nastyrodent.com/stylized-3d-characters-art-direction-principles/)
  — a compressed value range with **deliberate value steps** is what gives
  stylised work its readable shape.
- [Colour grading in three.js post-processing](https://moldstud.com/articles/p-an-in-depth-look-at-color-grading-techniques-in-threejs-post-processing)
  — LUT-driven grading, for V4.
- [three.js `Water`](https://threejs.org/docs/#examples/en/objects/Water) and
  [`webgl_shaders_ocean`](https://threejs.org/examples/webgl_shaders_ocean.html)
  — read in full from `node_modules/three/examples/jsm/objects/Water.js`:
  the four-lookup `getNoise`, `sunLight(shiny 100, spec 2, diffuse 0.5)`, the
  oblique-frustum mirror camera. Teardown in section 11d.
- [three.js forum — ocean water example question](https://discourse.threejs.org/t/ocean-water-example-question/10623/10)
  — Water.js reflects correctly only for a plane whose **Object3D** is oriented,
  not one whose geometry was rotated; the mirror normal is `(0,0,1)` in local
  space. Relevant the day the renderer wants real reflections.
- [Anderson Mancini — realistic water simulation](https://water-simulation.vercel.app/)
  and [Sketchfab: water](https://sketchfab.com/tags/water) — surveyed as targets
  for what the frame should look like, not as code.
- [three.js `Sky`](https://threejs.org/docs/#examples/en/objects/Sky) —
  Preetham's *A Practical Analytic Model for Daylight*, read in full from
  `node_modules/three/examples/jsm/objects/Sky.js` and ported into the demo as a
  callable function. Its shipped constants — turbidity 10, rayleigh 2 — measure
  at saturation 0.05 here and were replaced with 3 / 3. Teardown in section 11f.
- [Preetham, Shirley, Smits — A Practical Analytic Model for Daylight (SIGGRAPH 1999)](https://www.researchgate.net/publication/220720443_A_Practical_Analytic_Model_for_Daylight)
  — the paper the shader implements; the source of the optical-path term that
  makes a low sun red and the horizon white.
- [three.js `GLTFLoader`](https://threejs.org/docs/#examples/en/loaders/GLTFLoader)
  — turned into a classic script by the demo's build step, unpatched. Section 11g.
- Pierson & Moskowitz 1964, via
  [WikiWaves: Ocean-Wave Spectra](https://www.wikiwaves.org/index.php/Ocean-Wave_Spectra)
  and [Pierson-Moskowitz Spectrum, ScienceDirect topic](https://www.sciencedirect.com/topics/engineering/pierson-moskowitz-spectrum)
  — the one-parameter fully-developed spectrum, `Hs = 2.14e-2 U²`,
  `ωp = 0.877 g / U₁₉.₅`, α = 8.1e-3, β = 0.74. Implemented in section 11i.
- [NTNU: Sea state parameters and engineering wave spectra](https://folk.ntnu.no/oivarn/hercules_ntnu/LWTcourse/partB/3seastate/3%20SEA%20STATE%20PARAMETERS%20AND%20ENGINEERING%20WAVE%20SPECTRA.htm)
  — JONSWAP's peak-enhancement factor γ over Pierson-Moskowitz, for the day the
  service wants fetch-limited seas as well as fully developed ones.
- [Monahan & O'Muircheartaigh 1980, *Optimal Power-Law Description of Oceanic Whitecap Coverage Dependence on Wind Speed*](https://journals.ametsoc.org/view/journals/phoc/10/12/1520-0485_1980_010_2094_opldoo_2_0_co_2.xml)
  — `W = 3.84e-6 U₁₀^3.41`, robust biweight fit to Monahan 1971 plus Toba & Chaen
  1973. This is where the foam threshold comes from.
- [A Survey of Ocean Simulation and Rendering Techniques in Computer Graphics (arXiv 1109.6494)](https://arxiv.org/pdf/1109.6494)
  — Gerstner vs. spectral (FFT/Tessendorf) surfaces, projected grids, and the
  steepness limit past which Gerstner self-intersects.
- Jerlov 1976 water types, via
  [Solonenko & Mobley, *Inherent optical properties of Jerlov water types*](https://opg.optica.org/ao/upcoming_pdf.cfm?id=236972),
  [*Measured IOPs of Jerlov water types*](https://www.researchgate.net/publication/364766106_Measured_IOPs_of_Jerlov_water_types)
  and [Kd-based optical classification, J. Earth Syst. Sci.](https://www.ias.ac.in/article/fulltext/jess/111/03/0237-0245)
  — published Kd for I / IA / IB / II / III and the coastal 1C–9C series. The
  per-channel reconstruction and its limits are stated in section 11j.
- [Akkaynak & Treibitz, *What Is the Space of Attenuation Coefficients in Underwater Computer Vision?* (CVPR 2017)](https://openaccess.thecvf.com/content_cvpr_2017/papers/Akkaynak_What_Is_the_CVPR_2017_paper.pdf)
  — why a single scalar "water colour" cannot represent a water body, and why the
  attenuation has to be per-channel.
- [Bainbridge 1958, *The Speed of Swimming of Fish as Related to Size and to the Frequency and Amplitude of the Tail Beat*](https://journals.biologists.com/jeb/article/35/1/109/13233/The-Speed-of-Swimming-of-Fish-as-Related-to-Size)
  — `V = ¼ L (3f − 4)`, V in cm/s, f in Hz, L in cm: speed follows tail-beat
  FREQUENCY and body length, not amplitude, and it is linear above about 5 Hz.
  The demo's per-species beat rates should be derived from this rather than set;
  logged as the next locomotion task.
- Internal, verified in source on 2026-08-18: `oceanSwimming.ts`
  (`BODY_UNDULATION_GLSL` unused outside its own test), `OceanSkinnedSchool.tsx`
  (`MAXIMUM_SKINNED_MEMBERS = 26`), `OceanFauna.tsx` (ellipse paths),
  `OceanParticles.tsx`, `oceanDressingModels.ts`.

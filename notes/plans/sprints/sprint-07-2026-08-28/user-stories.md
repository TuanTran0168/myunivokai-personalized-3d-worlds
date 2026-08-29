# Sprint 07 user stories

> **Sprint starts:** 2026-08-28
> **Last source review:** 2026-08-28

One epic, six stories. S7-FE-RESPONSIVE-001 and S7-FE-CUSTOMFORM-001 touch
only `apps/myunivokai-web/src/app/page.tsx` and `lib/formSelection.ts` and can
run in any order relative to the others. S7-FE-GALLERY-001 and
S7-FE-AUDIO-001 are independent of each other and of the form work.
S7-FE-TRANSITION-001 is the only story that reaches into both the gallery and
the create form, so it is easiest to land last, once the layout it animates
around has stopped moving. S7-FE-ADAPTIVE-001 is independent of all five —
it changes per-device render parameters inside each family renderer, not
layout or audio — but its own verification (no visual regression at the
existing high tier) is cheapest to run last, after the other stories have
stopped changing what the canvas renders.

## EPIC-S7-FE-EXPERIENCE-001 — Transition, form and ambience polish for the create/gallery experience

### S7-FE-RESPONSIVE-001 — Close the tablet breakpoint gap and fix the create-form layout

Status: Implemented (branch `fix/fe/sprint-07-experience-batch`; Verified needs real-device/browser evidence beyond this session's own Playwright checks)
Priority: P1

As a visitor on a tablet or a phone,
I want the create form to use the screen space it actually has and to show me
the same live-preview payoff a desktop visitor gets,
so that the experience does not silently degrade below `lg`.

Scenario: Tablet gets its own layout tier

Given a viewport between 768px and 1023px
When the create page renders
Then it no longer falls back to the sub-`lg` stacked mobile treatment, which
today applies unconditionally because no `md:` rule exists anywhere in the
file
And the floating rail/preview split degrades in one intermediate step instead
of jumping straight from full split to fully stacked.

Scenario: World Family's third card is not orphaned

Given the World Family group renders Universe, Forest and Ocean inside a
`grid-cols-2` container
When the group lays out at any rail width
Then no option sits alone, left-aligned, on a half-empty row.

Scenario: Mobile gets the live-preview payoff too

Given a visitor on a viewport below `lg` collapses the form rail
When the collapsed state is active
Then a compact identity placard (nickname, curated-from, palette) is shown,
reusing the same data the desktop-only card at `page.tsx:394` already renders,
not only on `lg` and above.

Scenario: A long form gives a sense of progress

Given the rail's internal scroll region contains all nine field groups (World
Family, Nickname, Primary Role, Core Interests, Traits, Goal, Mood, World
Style, Palette)
When the visitor scrolls through it
Then a lightweight position indicator shows how far through the sections they
are.

Source evidence:
- apps/myunivokai-web/src/app/page.tsx:351,377 — grep-confirmed zero `md:`
  occurrences in the file; the split only ever toggles on `lg:`
- apps/myunivokai-web/src/app/page.tsx:461 — World Family `grid-cols-2` with
  3 options
- apps/myunivokai-web/src/app/page.tsx:394 — the identity placard, `hidden
  w-[290px] lg:block`
- apps/myunivokai-web/src/app/page.tsx:457 — `.rail-scroll`, the internal
  scroll region with no progress indicator
- apps/myunivokai-web/src/app/page.tsx:717 — Palette swatches at `h-10 w-10`
  (40px), below the common ~44px touch-target guidance
- apps/myunivokai-web/src/lib/formRailCollapse.ts — the existing collapse
  state to reuse for the mobile placard, rather than adding a second one

Tasks:
- [x] Add an `md:` layout tier for the create page's hero/rail split.
- [x] Fix the World Family grid so a 3rd option never sits alone (`grid-cols-3`,
      or center the trailing item on `grid-cols-2`).
- [x] Render the identity placard on collapse below `lg` too, driven by
      `formRailCollapseState`, not only inside the existing `lg:block` branch.
- [x] Add an IntersectionObserver-driven section indicator inside
      `.rail-scroll`.
- [x] Bump Palette swatch touch targets to at least 44px on narrow viewports.

Implementation note: manual Playwright screenshot verification (not a
committed test) caught two real bugs the task list above did not anticipate,
both fixed before this story was marked Implemented:

- The progress indicator's `IntersectionObserver` was rooted on `.rail-scroll`
  itself. Below `lg` that element has no scrollport of its own (the page
  scrolls, not the rail), so a non-clipping element root never moves relative
  to its own children as the page scrolls — the indicator froze at whatever
  its first layout produced. Fixed by rooting on the viewport (`root`
  omitted) and relying on the browser's native ancestor clip-chain, which
  still restricts intersection to the rail's own scrollport once
  `md:overflow-y-auto` applies.
- The new `md:absolute` rail wrapper computes a definite height from
  `md:top-16`/`md:bottom-16`, but the `<section>` inside it only had
  `lg:h-full` and `.rail-scroll` only had `lg:overflow-y-auto` — both still
  gated one tier later than the wrapper's own new breakpoint. Below `lg` (at
  the new `md` tier specifically), the form's content overflowed straight
  past the card's rounded border, uncontained, instead of scrolling inside
  it. Fixed by moving both to `md:`.

### S7-FE-CUSTOMFORM-001 — One shared custom-value control for every chip group

Status: Implemented (branch `fix/fe/sprint-07-experience-batch`; Verified needs real-device/browser evidence beyond this session's own Playwright checks)
Priority: P2

As a visitor completing the create form,
I want every chip group to accept a value I typed myself, not only the ones
the group ships with,
so that the portrait is built from words that are actually mine.

Scenario: Adding a custom value works the same everywhere

Given any chip group in the create form
When the visitor opens its custom-value control and submits a non-empty value
Then `toggleItem`/`ensureRange` in `lib/formSelection.ts` adds it exactly
once, respecting that group's existing min/max
And the same component renders the affordance, so a fix to validation or
dedupe applies to every group at once rather than to whichever group happened
to get it first.

Source evidence:
- apps/myunivokai-web/src/lib/formSelection.ts — the existing generic,
  tested `toggleItem`/`ensureRange` logic every group already shares
- apps/myunivokai-web/src/app/page.tsx — per-group chip rendering, to audit
  for how many groups currently duplicate a "+Custom" input versus how many
  do not have one at all

Tasks:
- [x] Audit `page.tsx` for which chip groups render their own custom-value
      input today and which have none.
- [x] Extract one `<ChipGroupWithCustom>` component consuming
      `toggleItem`/`ensureRange`, replacing every per-group duplicate.
- [x] Cover the shared component with the same rigor as
      `formSelection.test.ts`.

Implementation note: the audit found three groups on the generic
`toggleItem` path, not two — Core Interests, Traits, and Palette. Palette
stayed out of scope: it renders fixed color squares (`rounded-xl`), not the
`rounded-full` pill chips the rest of this story means by "chip group", and
"a custom color" is a materially different control (a color picker) than a
custom text value. World Family, Mood and World Style were never on this
path at all — they are single-select enums backed by real per-value
visual/audio profiles (see `FAMILY_COPY`/`oceanMoodOptions` etc.), so a
free-text "custom" option there would not map to anything the renderer
understands. Traits is the one group that gained the affordance for the
first time; it keeps its own accent color (`secondary`, not Interests'
`primary`) through a small `accent` prop on the shared component rather than
losing that distinction to a hard-coded color.

### S7-FE-TRANSITION-001 — Shared-element and camera transitions between worlds

Status: Implemented (branch `feat/fe/world-entry-cinematics`; Verified needs
real-device/browser evidence beyond this session's own Playwright checks —
see "What the software-GL harness could and could not show" below)
Priority: P2

As a visitor,
I want opening a saved world from the gallery, or switching world family in
the create form, to feel like the scene is continuing rather than resetting,
so that the product's core delight — a world that reacts to me — is not
undercut by an abrupt cut.

Scenario: A gallery card opens into its world

Given a visitor selects a saved-world card in the gallery
When the world route loads
Then the card's position and size animate into the full canvas frame instead
of a hard navigation cut
And the transition is skipped entirely under `prefers-reduced-motion: reduce`.

Scenario: A family switch in the create form gets a camera cue

Given the visitor changes World Family while the live preview is mounted
When the new family's scene config resolves
Then the preview camera performs a short settle move before the new scene's
first frame is shown
And the existing `isSceneReady` opacity veil still covers any residual
pop-in, unchanged.

Source evidence:
- apps/myunivokai-web/src/features/scene-renderers/registry.ts — the
  `React.lazy` family boundary this transition wraps around
- apps/myunivokai-web/src/components/UniverseCanvas.tsx — the `isSceneReady`
  veil and where `CameraRig` is mounted
- apps/myunivokai-web/src/features/scene-renderers/shared/CameraRig.tsx —
  the camera control surface to extend, not replace
- apps/myunivokai-web/src/features/gallery/SavedWorldCard.tsx — the gallery
  card this story animates from

Tasks:
- [x] Add a shared-element transition from `SavedWorldCard` into the world
      route's canvas frame. Built as a genie scanline warp, NOT Framer Motion
      `layoutId` — see "Owner direction mid-sprint" below.
- [x] Extend `CameraRig` with a short settle move triggered on family change,
      gated behind `prefers-reduced-motion`.
- [ ] Extend the same settle to a PLANET change. Not built: a selection change
      does not remount the canvas, so it never reaches the entry the family
      switch goes through, and the existing focus glide already animates it.
      Left open rather than claimed.
- [x] Add a check that reduced-motion disables both transitions without
      breaking navigation or the existing veil.

Owner direction mid-sprint (2026-08-29):

The owner asked for the loading spinner to go — "đừng làm cái spinner vô nghĩa
nữa" — and for the world to arrive on a gentle, artistic camera move, and
supplied https://www.ui-layouts.com/components/mac-genie as the bar for this
and every other transition. That reference is not a layout morph: its source
(`registry/components/mac/genie-effect.tsx`) rasterises the moving element and
redraws it row by row on a 2D canvas, giving each row a delayed start. So the
shared-element task was built that way instead of with `layoutId`, which also
kept Framer Motion out of the dependency list.

The one place this departs from the story as written: the story said the
`isSceneReady` veil stays "unchanged". The veil MECHANISM is unchanged — same
state, same crossfade — but its contents are not, because removing the spinner
was the explicit instruction. It now holds the world's own background colour
and, on the routes that exist to show one scene, that scene's archetype and
name.

What was built:

- `lib/easing.ts` — the curves both motions share, extracted when the second
  consumer appeared rather than duplicated.
- `scene-renderers/shared/cameraIntro.ts` — the opening move as pure spherical
  geometry, and three entry modes: `cinematic` (world, share), `settle` (the
  create preview) and `none` (the gallery backdrop).
- `features/transitions/genieWarp.ts` — the row geometry, expanded from the
  reference's rectangle-to-POINT collapse to a rectangle-to-rectangle unfold.
- `features/transitions/worldOpenOrigin.ts` — the card's rectangle, handed
  across the navigation in sessionStorage and consumed on read.
- `features/transitions/GenieReveal.tsx` — the overlay that snapshots the
  scene's first frame and unfolds it, while `UniverseCanvas` holds both the
  canvas and the camera move so the still it froze keeps matching the frame it
  hands back to.

Two defects found by measuring rather than by looking, both fixed:

- Clamping the camera pose every frame buys a dead hold. A forest shot near the
  70-unit ceiling asks for 73, gets 70 back, and sits still through the opening
  stretch of its own entrance. The start offset is now resolved once, inside
  the envelope, and the frames after it interpolate from there.
- An unclamped frame delta skipped the move entirely on a first load. Measured
  on the world route: the entry armed, ONE frame rendered at the pulled-back
  start, the main thread blocked 4.2 s compiling shaders, and the next frame
  arrived with a 4.2 s delta — progress went straight to 1 and the camera cut
  back in a single 2.48-unit jump. A stall must pause the move, not
  fast-forward it. Capped at 1/15 s.

What the software-GL harness could and could not show:

Reading `camera.position` out of `renderer.render` each frame (via three.js's
`__THREE_DEVTOOLS__` hook) proved the entry reaches its clamped start exactly —
9.697 to 11.830, a 1.22x pull-back — eases away from it with a visibly
accelerating first stretch, and never leaves the resting framing under
`reducedMotion: reduce`. The ocean's entry was checked separately, since that
camera sits inside its medium: it lifts rather than dropping, so the seabed
clamp is never engaged.

What it could NOT show is either motion at speed. The suite's swiftshader
renders these scenes at roughly 1.5 fps, so consecutive `requestAnimationFrame`
timestamps are ~650 ms apart — longer than the genie's whole 620 ms run, which
therefore collapses to two frames there. The warp's SHAPE was verified instead
by driving the production `genieRowAt`/`genieRowHeight` over a synthetic banded
image at fixed progress values and looking at the frames: the classic genie
taper, no seams between rows, and a final frame landing pixel-exactly on the
destination box. Smoothness on real hardware is still unwitnessed.

Second owner pass (2026-08-29):

The owner saw the above and asked for three things: push the transition further
toward the mac-genie reference, vary the opening camera angle instead of using
one, and either make the remaining spinner nicer or replace it with something
like a phone's left-right swipe.

1. The genie got the two terms a rectangle-to-rectangle unfold does not get for
   free. Collapsing into a dock POINT gives the reference its funnel
   automatically — both edges converge on one coordinate — while interpolating
   between two rectangles only ever widens, which is a staggered zoom. So
   `GENIE_NECK_PINCH` puts a waist back in (peaking at the midpoint of each
   row's own travel, so the waist travels down the sheet) and
   `GENIE_BOW_STRENGTH` holds the centreline back toward the card so it arrives
   on a curve rather than a straight line. The reference's glow was added too,
   riding the trailing edge — the edge still being drawn out, and so the one the
   eye follows. Horizontal stagger went 0.55 to 0.65, the reference's own value.
   All three are exactly zero at both ends of a row's travel: the reveal hands
   over to the live canvas on the last frame, and any deformation still present
   there is a visible jump.
2. `CAMERA_INTRO_POSES` replaces the single start pose with six, picked by
   `hashSeed(scene.seed)` so a world opens the same way every visit while
   different worlds differ. Two invariants hold across the set, both
   load-bearing and both tested: every pose has a non-zero azimuth offset,
   because a bearing is the one axis no family envelope can clamp flat; and no
   pose has a positive polar offset, because the ocean's camera sits at the
   viewer's own depth plane and a start below the framing would trip the terrain
   clamp, which lifts the orbit TARGET and would silently walk the resting shot
   upward.
3. `components/SweepRail.tsx` plus `.sweep-rail`. The loading tone of
   `StatusMessage` no longer spins a `Loader2`; it sets the label in the same
   mono caps the scene title cards use over a rail with a lit segment
   travelling across it. `GeneratingOverlay` gained the same rail — it is the
   longest wait in the product and its armillary rings say the app is alive
   without saying anything is going anywhere. The small in-button spinners were
   left alone: a 16-pixel icon inside a button is the right idiom and a rail
   does not fit one.

Measured, not assumed: the camera tap was re-run across four seeds landing on
four different poses, against the same universe fixture whose resting framing is
(0, 3.755, 8.940). The furthest opening offsets came out
pull-back (+0.94, +1.74, +1.50), crane-down (+0.31, +2.36, +0.03), swing-right
(+1.75, +0.82, +0.43) and long-approach (-1.24, +1.87, +2.27) — each dominated
by the axis its name claims, so the variety is real and not a relabelling. The
genie's new shape was checked the same way as before, by driving the production
geometry over a banded image: the bow is plainly visible as a straight source
stripe rendering as a curve, and progress 1.00 still lands flat, unbowed,
unpinched and unlit on the destination box.

Still unwitnessed on real hardware, same as the first pass: both motions at
speed. The swiftshader harness cannot render them fast enough to judge.

Third owner pass (2026-08-29): the swipe the owner actually meant

The sweep rail from the second pass answered the wrong question. Asked for
"vuốt trái phải của điện thoại", it was read as a request about the loading
indicator; the owner clarified that what should move is the WORLD — "vuốt 1 phát
cả page luôn khi đổi world, nguyên mảng world luôn", the way a phone carries the
next page in and macOS and Windows carry a window out.

`features/transitions/swipeGesture.ts` + `SceneSwipe.tsx`, built to the same
shape as the genie: a pure module for the numbers, a sibling overlay component
driven by the scene container's ref. It runs on the create page's family switch
and on the world page's variant select and regenerate.

Three decisions, each with the reason it was not the obvious one:

- **The still is captured by the CALLER**, one statement before the state
  update, not by the component when it notices. By the time the component could
  notice, React has swapped the canvas for the next world and the frame worth
  keeping is gone. The create page had to opt into `preserveDrawingBuffer` for
  this, as the world route already had for Export Image.
- **CSS keyframes, not requestAnimationFrame.** This gesture runs at the exact
  moment the next world is mounting, compiling shaders and uploading textures —
  measured at over four seconds of blocked main thread on the world route in the
  first pass. A JS animation writing `style.transform` per frame would be queued
  behind all of it and sit frozen; a compositor animation keeps its frame rate
  through a blocked main thread. Every number the keyframes use is written on by
  the TypeScript module as a custom property, so the stylesheet holds the shape
  of the gesture and not a second copy of its timing.
- **Parallax, not a shared rail.** The arriving panel travels the full width and
  the leaving one 32% of it, dimming to 0.35 and settling back to 0.94 scale.
  Both panels moving together reads as a slideshow; the difference is what makes
  it read as one screen sliding over another. Same ratio iOS uses.

### S7-FE-GALLERY-001 — Gallery ambient backdrop reflects the visitor's own worlds

Status: Implemented (branch `fix/fe/sprint-07-experience-batch`; Verified needs real-device/browser evidence beyond this session's own Playwright checks)
Priority: P2

As a returning visitor,
I want the gallery's background world to be one of my own saved worlds
instead of a fixed demo Universe,
so that the gallery feels like mine rather than a generic showcase.

Scenario: The backdrop follows the most recently viewed world

Given the visitor has at least one saved world
When the gallery page mounts
Then `AmbientWorld` renders that world's real scene config instead of the
hard-coded `AMBIENT_WORLD_INPUT`
And falls back to the existing hard-coded input only when no saved world
exists.

Scenario: The single backdrop canvas may carry sound

Given `SavedWorldCard` renders no canvas of its own (a static palette strip
and text, not a live scene) and `AmbientWorld` is the gallery's only canvas
When the gallery page mounts
Then `enableAmbientSound` may be turned on for that one backdrop, without
reintroducing the "several canvases at once" conflict `UniverseCanvas.tsx`
already documents.

Source evidence:
- apps/myunivokai-web/src/features/gallery/AmbientWorld.tsx — the
  hard-coded `AMBIENT_WORLD_INPUT`
- apps/myunivokai-web/src/features/gallery/useSavedWorlds.ts — existing
  saved-world read access to source the real scene from
- apps/myunivokai-web/src/components/UniverseCanvas.tsx:85-87 — the
  multi-canvas comment this story must not violate
- apps/myunivokai-web/src/features/gallery/SavedWorldCard.tsx — re-read
  during implementation and found to render no canvas at all today (only a
  palette strip and text), correcting this story's original premise that it
  had per-world canvases with sound already off

Tasks:
- [x] Read the most-recently-viewed saved world from `useSavedWorlds` and
      pass its real scene into `AmbientWorld`.
- [x] Keep the existing hard-coded input as the empty-gallery fallback.
- [x] Enable `enableAmbientSound` only on the backdrop canvas; confirm
      `SavedWorldCard`'s own canvases remain silent.

Implementation note: "most-recently-viewed" did not already exist anywhere
in the codebase — `useSavedWorlds`'s own order is most-recently-*saved*
(`addWorldIdentifierToGallery` prepends only on first save; re-viewing an
already-saved world is a no-op there, by design, since that list also drives
the gallery grid's own display order). A new, separate
`recordLastViewedWorld`/`readLastViewedWorld` pair in `lib/savedWorlds.ts`
tracks actual view recency without touching the grid's own order. Also
found and corrected: the "single backdrop canvas may carry sound" scenario
above originally assumed `SavedWorldCard` already had its own per-world
canvases with sound off; re-reading that file during implementation found
it renders no canvas at all, so the scenario's Given was rewritten to match.

Known pre-existing issue found while verifying (out of scope for this
story): Forest-family scenes never clear their "Rendering forest" loading
veil in this dev/software-GL (swiftshader) Playwright environment,
reproduced identically on the unmodified `/worlds/[worldId]` route with the
same mocked fixture — confirmed unrelated to this change, not something
this story's code touches.

### S7-FE-AUDIO-001 — Depth-driven ambient mix for Ocean worlds

Status: Implemented (branch `fix/fe/sprint-07-experience-batch`; Verified needs real-device/browser evidence beyond this session's own Playwright checks)
Priority: P2

As a visitor in an Ocean world,
I want the ambient soundscape to change with depth the same way light and
color already do,
so that depth reads as one coherent physical axis across sight and sound, not
just sight.

Scenario: The mix follows the stored depth curve

Given a world's stored depth value and the existing `oceanDepthCurve.ts`
outputs
When the ambient soundscape graph builds its mix for an Ocean world
Then instrument gain/filtering derive from the same depth curve outputs
already driving color, fog and god-rays
And no independent depth-to-audio table is invented alongside it.

Source evidence:
- apps/myunivokai-web/src/lib/oceanDepthCurve.ts — the FE depth curve
  already pinned to the Go builder's goldens
- services/ocean-service/internal/services/depth_curve.go — the canonical
  depth curve this story must not fork
- apps/myunivokai-web/src/lib/ambientSoundscape.ts — the existing DNA-driven
  recipe builder actually extended (see implementation note below)

Tasks:
- [x] Identify which parameters can take a continuous depth input without
      breaking the seed-deterministic contract Universe and Forest already
      rely on.
- [x] Wire Ocean's stored depth into the graph for those parameters only.
- [x] Add a test asserting the mix at the three depth zones Ocean's golden
      fixtures already use.

Implementation note: the parameters that changed (`toneCutoffHertz`,
`bedGain`) are produced in `lib/ambientSoundscape.ts` (the pure recipe
builder), not `features/audio/ambientSoundscapeGraph.ts` (the Web Audio
graph, which already consumed both fields — it just never received a
depth-varying value for them). This story's own Source evidence originally
named the graph file; corrected once the actual edit site was clear. Also
caught and fixed: `ambientSoundscapeSignature`'s ocean branch keyed only on
`zone`, not `metres` — once metres continuously drives the mix, two worlds
sharing a zone but not a depth would silently share a signature, and the
React effect that rebuilds the audio graph would never fire for the
difference.

### S7-FE-ADAPTIVE-001 — Adaptive quality tiers, pulled forward ahead of City

Status: Planned
Priority: P1

As a visitor on a mobile or weak device,
I want the renderer to detect what my device can actually do and choose a
matching quality tier,
so that the experience is usable there without lowering what a desktop
visitor already gets.

Scenario: GPU tier gates render features, not the reverse

Given a device is classified into GPU tier 1, 2 or 3 (mobile and desktop use
distinct thresholds) at canvas mount
When the canvas builds its render settings
Then DPR range, shadow quality, the active postprocessing set and LOD
distances come from that tier's profile
And the tier-3/desktop profile is exactly today's fixed settings, unchanged.

Scenario: A session degrades or recovers at runtime

Given `<PerformanceMonitor>` observes fps staying below a sustained threshold
When this happens mid-session on any device
Then the canvas steps down one adaptive parameter (DPR first, then
postprocessing) rather than staying pinned to its initial tier
And steps back up if fps stays high for a sustained window afterward.

Scenario: A WebGL failure is contained, not a blank canvas

Given WebGL context creation or a shader compile fails on a low-tier device
When the canvas would otherwise render nothing
Then a WebGL failure boundary renders a stated fallback instead of a silent
blank frame.

Scenario: The approved high tier does not move

Given a visitor whose device already classifies at tier 3/desktop
When this story ships
Then their rendered output is pixel-identical to the pre-Sprint-7 fixed
profile, checked directly rather than assumed.

Source evidence:
- notes/plans/frontend/frontend-plan.md — gap #4 (updated 2026-08-28 to record the
  owner pulling this step forward out of its post-City slot); §Next sequence
  step 7
- `@react-three/drei`'s `PerformanceMonitor` — already a project dependency,
  currently unused anywhere in `apps/myunivokai-web`
- `detect-gpu` (pmndrs) — not yet a dependency; the GPU-tier classification
  library researched for this sprint

Tasks:
- [ ] Add `detect-gpu`; classify GPU tier once at canvas mount, with distinct
      mobile/desktop thresholds.
- [ ] Define per-tier render profiles (DPR range, shadow map size,
      postprocessing set, LOD distances); promote today's fixed settings to
      the tier-3/desktop profile unchanged.
- [ ] Wire `<PerformanceMonitor>` for continuous runtime step-down/step-up.
- [ ] Add the WebGL context-lost/compile-failure boundary named as missing in
      `frontend-plan.md` gap #4.
- [ ] Verify: capture tier-3/desktop output before and after; confirm no
      visual regression on any of the three shipped families.

Owner pass (2026-08-29): the runtime half, driven by a measurement

The owner asked for 60 fps as a floor and for the machine's power to be used
rather than budgeted — "60fps là tiêu chuẩn tối thiểu, cao hơn càng tốt. Tận
dụng sức mạnh của máy". That is the opposite emphasis from this story as
written, which is about making weak devices usable, so the runtime scenario was
built and the `detect-gpu` tier classification was left alone. Nothing here
lowers what a strong machine gets; a strong machine is measured and left at
native resolution.

**Measured first, on the real GPU.** Every earlier frame-rate claim in this repo
was impossible to make because the Playwright suite forces swiftshader, which
renders these scenes at roughly 1.5 fps. Headless Chromium launched with
`--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist` gets the discrete GPU
instead, verified by reading `UNMASKED_RENDERER_WEBGL` back out. On an
RTX 4060 Laptop, against a production build:

| condition | Universe | Forest | Ocean |
| --- | --- | --- | --- |
| 1600x900 dpr1 | 424 -> 427 | 100 -> 104 | ~2000 |
| 1600x900 dpr2 | 146 -> **215** | **42 -> 70** | 675 -> 685 |
| 2560x1440 dpr2 | 66 -> **100** | **11 -> 52** | ~300 |

Eight of the nine hold 60 fps or better where six did before, and the worst case
improved 4.7x. The one still short is the forest at genuine 4K, at 52 fps.

**The diagnosis is the useful part.** Frame time scaled with pixel count while
draw calls stayed at 83 and triangles at 4.1 million, unchanged, across a
ten-fold range of resolutions. These scenes are FILL-RATE bound, not geometry
bound, so LOD distances and instancing — the obvious levers — would have bought
nothing. What was actually being paid per pixel:

- An **8x-multisampled RGBA16F** composer target. At 5120x2880 its resolve alone
  moves close to a gigabyte a frame, and its value falls away as the display's
  own density rises: at dpr 2 the panel is already supersampling 4 device pixels
  into every CSS pixel, so 8x on top is 32 samples per CSS pixel.
- **N8AO at full resolution.** AO is a low-frequency term that darkens a crease
  over tens of pixels, never one.

Both now scale with the pixel ratio (`shared/renderQuality.ts`), and neither is
a quality reduction in perceived terms — the scene still renders every native
pixel. That pair alone took the forest from 42 to 57 at dpr 2 and from 11 to 30
at 4K.

**`AdaptiveResolution` is the safety net**, and it is deliberately narrower than
this story's scenario asks for. It only ever gives resolution back, never climbs,
and three attempts were needed to get it right — each failure measured:

1. Seeded from the canvas's dpr CEILING of 3 rather than the renderer's actual
   ratio, so the first "step down" computed 2.75 and RAISED the ratio on a
   display at 2. A 30 fps forest went to 19.
2. A climb rule. With vsync on, a scene holding 60 on a 60 Hz panel is
   indistinguishable from one that could manage 200, so headroom cannot be read
   from the frame rate — and guessing made the ratio hunt, resampling the whole
   image on every swing. Removed; the controller is monotonic.
3. Driven by drei's `PerformanceMonitor`, whose factor SATURATES: once fully
   declined it stops firing `onChange`, so a scene needing three steps got one
   and settled at 36 fps having been told it was finished. Replaced with a
   `useFrame` window and a proportional jump — frame time is linear in pixels
   and pixels go as the ratio squared, so `ratio * sqrt(fps / 60)` lands in one
   adjustment instead of four.

Plus one more that only a watch-it-converge run showed: with a 1.2 s warm-up and
a single bad window, the universe family — 215 fps once running — walked itself
from 3200x1800 down to 2000x1125 in the nine seconds after load, entirely on
readings taken while it was still compiling shaders. It now waits for the
scene-ready signal, then 2.5 s, then needs two consecutive slow windows. Watched
again afterwards: universe and ocean are never touched at any resolution, and
only the forest steps down.

One hypothesis was tried and REJECTED by measurement rather than kept because it
sounded right: basing multisampling on the DISPLAY's density instead of the
renderer's, on the argument that a HiDPI panel hides the extra samples even when
the render ratio has been dropped below it. It measured 37 fps against 47 on the
forest at 4K. Rendering at ratio 1 and letting the browser upscale produces a
dpr-1 image with dpr-1 aliasing, and multisampling is still what smooths it.

Still open, and named rather than quietly dropped: the forest at 4K, 52 fps. It
is 4.1 million triangles and 59 shader programs, and closing that gap means
reducing what is IN the scene rather than how many pixels it is drawn into.
The `detect-gpu` classification, the per-tier profiles and the WebGL failure
boundary in the tasks above are all still unstarted.

Follow-up (2026-08-29): a report that swiping worlds felt "extremely laggy"
turned out to be this same shader-compile freeze, not a bug in the swipe
itself. Profiled with the CPU sampler (`Profiler.start`/`stop` over CDP, not
just wall-clock timing): swiping into the forest for the first time in a
browser session spends 2.5-3 of it inside `getProgramInfoLog` /
`getProgramParameter`, three.js's own diagnostic and uniform/attribute readback
on each of ~44 shader programs' first bind. The swipe's CSS keyframes keep
running through this (compositor, not main-thread), but everything ELSE on the
page — clicks, typing, the veil's own fade-in — is genuinely frozen for that
stretch, which is what read as lag rather than a slow transition.

`WebGLRenderer.compileAsync`, the standard fix for this exact class of freeze,
was implemented, then measured and REMOVED. `KHR_parallel_shader_compile` is
present on this project's ANGLE/D3D11 target (confirmed via
`getSupportedExtensions()`), but its completion-status query blocked for the
same 2.5-3s the plain path did — verified in both headless AND headed real
Chrome, so it is not a headless-testing artifact. This driver does not honour
the extension's non-blocking contract, and shipping the mechanism anyway would
have been dead weight: profiling also showed it was compiling roughly DOUBLE
the needed program count, because `compile()` warms against the canvas's own
output color space while `PostEffects`' composer actually renders the scene
into a separate linear intermediate target — two color-space variants of
nearly every material, only one of which the composer ever uses.

What DID turn out to matter, found by testing with a PERSISTENT Chrome profile
instead of a fresh one per run (`launchPersistentContext`, not
`launch`/`newContext`): Chrome caches compiled shader BINARIES on disk, keyed
by source, independent of any page's WebGLRenderer. A brand new tab, brand new
WebGL context, brand new renderer, same machine's Chrome profile — the SECOND
time the forest's shaders are ever compiled, the same ~44-program readback
dropped from 2633 ms to 350 ms in the final measurement (matches the earlier
CPU-profile figures: 2547 ms cold vs 231-350 ms warm across three separate
runs). The expensive case is "the first time this visitor's browser has ever
compiled a forest", not "every swipe" — every fresh-profile/headless/CI
measurement in this sprint's other notes is, unavoidably, the cold-cache
number, since none of them persist a Chrome profile between runs.

The only real, safe fix landed: `WebGLRenderer.debug.checkShaderErrors = false`
in production (kept on in dev, so a genuine shader error still prints). A real
three.js-documented saving, but small next to the readback that remains
mandatory. The complete fix — reusing one `<Canvas>`/WebGLRenderer across a
world swap instead of remounting it on every seed change — is blocked on r3f
unconditionally calling `forceContextLoss()` on unmount regardless of whether
the renderer was r3f's own or supplied via the `gl` prop, so a "persistent
renderer" reference does not survive the swap either. Doing this properly means
no longer keying the Canvas remount on `seed` at all, moving the camera-pose
reset, the per-family tone-mapping/shadow config, and the genie reveal's
still-matches-live-frame guarantee onto imperative effects instead — a real
piece of work, not attempted here, and not something to start unreviewed under
a "the swipe feels laggy" report.

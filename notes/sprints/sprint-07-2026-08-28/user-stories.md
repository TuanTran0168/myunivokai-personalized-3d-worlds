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

Status: Planned
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
- [ ] Add a shared-element transition (e.g. Framer Motion `layoutId`) from
      `SavedWorldCard` into the world route's canvas frame.
- [ ] Extend `CameraRig` with a short settle move triggered on family or
      planet change, gated behind `prefers-reduced-motion`.
- [ ] Add a check that reduced-motion disables both transitions without
      breaking navigation or the existing veil.

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
- notes/vision/frontend-plan.md — gap #4 (updated 2026-08-28 to record the
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

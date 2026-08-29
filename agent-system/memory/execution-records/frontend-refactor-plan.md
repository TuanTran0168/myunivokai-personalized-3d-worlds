# FE Production Refactor Plan — clients/web-client

> **Document status:** Needs re-baseline — several unchecked items already exist in source
> **Last source review:** 2026-07-18
> **Current backlog:** [../user-stories/engineering-backlog.md](../../plans/backlog/engineering-backlog.md)

> **Known stale status rows:** Vitest and its CI step are implemented; Sonner
> toast/loading UI exists; both share families implement server-rendered
> metadata; the Vitrine/Liquid-Glass tokens/layout are present in source. The
> old unchecked table is preserved as a decision/history record, not as proof
> that those features are missing. Typed runtime contracts, adaptive mobile 3D
> quality, and a complete accessibility/recovery pass remain real gaps.

Goal: end the MVP phase. Each item is **one branch + one separate PR**, in
order. Every branch must pass `npm run typecheck && npm run lint && npm run build`,
and from the testing setup onward must ship with unit tests (vitest).

Status: mark ✅ when the PR is merged into `staging`.

| # | Branch | Priority | Status |
|---|---|---|---|
| V | **Visual reskin V1–V6** (de-AI the chrome) — see §V below | 🔴🔴🔴 highest — supersedes the U visual language | ⬜ |
| U1 | `feat/fe/ui-shell-and-tokens` | 🔴🔴🔴 highest — UI overhaul foundation | ⬜ |
| U2 | `feat/fe/create-canvas-hero` | 🔴🔴🔴 highest — canvas-first create page | ⬜ |
| U3 | `feat/fe/dashboard-hud` | 🔴🔴 high — command-deck world page | ⬜ |
| U4 | `feat/fe/share-gallery-landing` | 🔴 high — public surfaces polish | ⬜ |
| 1 | `fix/fe/scene-render-consistency` | 🔴🔴 visible bug | ✅ |
| 1b | `feat/fe/mood-style-impact` | 🔴 pairs with BE mood | ✅ |
| 2 | `feat/fe/unit-testing-setup` | 🔴 foundation | ⬜ |
| 3 | `refactor/fe/typed-api-client` | 🔴 required before deploy | ⬜ |
| 4 | `refactor/fe/form-validation` | 🔴 required before deploy | ⬜ |
| 5 | `refactor/fe/page-decomposition` | 🟡 structure | ⬜ |
| 6 | `feat/fe/toast-and-loading-states` | 🟡 UX | ⬜ |
| 7 | `feat/fe/share-page-ssr-metadata` | 🟡 social sharing | ⬜ |
| 8 | `feat/fe/mobile-performance` | 🟡 weak devices | ⬜ |
| 9 | `refactor/fe/cleanup-a11y` | 🟢 cleanup | ⬜ |

## V. Visual Reskin Overhaul (V1–V6) — de-AI the chrome

Goal: kill the "looks fake / AI-generated" *surface* and reach the Apple /
supercar-interior / interior-design bar the product is benchmarked against —
**without re-architecting the canvas-hero layout (U1–U4 stays) and without any
behavior change.** Same form state, same payload, same API calls, same scene
builder, same handlers, same pointer-events choreography. Only tokens, chrome
surfaces, copy, and iconography change. Every V-branch must keep all gates green
(`npm run typecheck && lint && build && test`).

This **supersedes the cosmic "command deck" visual language** that U1–U4
introduced. U1–U4 fixed the *layout* (canvas as hero — that is genuinely good
and is kept); they did **not** touch the visual language, and that language is
the actual "AI template" tell. The look V kills (read from the code, not
guessed):

- the purple→cyan 45° CTA gradient — `globals.css:64` `.btn-gradient`
  `linear-gradient(45deg,#a078ff,#4cd7f6)`, the single most recognizable
  AI-startup signature, repeated on every CTA;
- **uniform** glassmorphism as a reflex on every surface — `globals.css:48`
  `.glass-panel` (`rgba(15,23,42,.72)` + `blur(20px)` + white/10 top-lit border).
  *(The chosen Vitrine direction brings glass back deliberately as one defined
  Liquid-Glass material on floating islands — see below. V kills the
  frost-everything reflex, not glass itself.)*;
- decorative glow — `tailwind.config.ts:50-52` `shadow-glow`/`shadow-cyan`,
  `globals.css:56` `.glass-panel-glow`;
- ambient pulsing orbs — `.pulse-bg` + the two orbs mounted in `layout.tsx`;
- the `.chip-shimmer` "AI is thinking" sweep;
- the **Material-Design-3 default token vocabulary** copied verbatim
  (`surface`/`on-surface`/`primary-container`/`*-fixed`) — the fingerprint of an
  untouched theme-builder export;
- HUD-cosplay microcopy — `page.tsx:144` "syncing", `:151` the fake
  `INTEREST-INTEREST-01` "Signature", `:197` "initialize your personal 3D data
  space", and the theatrical `GeneratingOverlay` phrases ("Forging a unique
  world seed…");
- `Sparkles`/`Wand2` "magic AI" iconography on the create header and submit.

### The constraint that decides the direction (verified in code)

The 3D canvas background is **deterministic per atmospheric mood**, mirrored from
the Go backend: `lib/scene.ts:190-195` `MOOD_SCENE_PROFILES` →
focused `#050816`, dreamy `#0b0720`, energetic `#140712`, reflective `#04070c`
(↔ `internal/services/mood_scene_profile.go`), fed into the palette at
`scene.ts:332`. It is **seed-locked and cannot be recolored without breaking the
determinism brand promise.**

Consequence: a **warm-paper or warm-graphite** chrome (the editorial "Atlas" and
automotive "Coachwork" directions) would wrap a *cool* dreamy/reflective world in
*warm* chrome on every generation and read as two unrelated apps stapled
together — and you cannot fix it without diverging from Go or breaking seed-lock.
So the chrome must be **dark and neutral.** That rules out 3 of the 5 explored
directions on engineering grounds, not taste. (Full exploration: a 5-direction /
3-judge design study; the dark-neutral finalists were "Observatory" and "The
Vitrine".)

### Chosen direction (LOCKED 2026-06-26): The Vitrine + Liquid Glass

A warm true-black **gallery** that mounts the universe like a masterwork: a single
**brass** metallic accent (`#C9A35B`), an **editorial serif masthead** (production
self-hosts a Didone — Fraunces/Playfair — via `next/font`; CSP-safe), brass
small-caps placard labels, a **vermillion** live dot, and the engraved
**accession placard** ("UNIVERSE NO. 0XX · CURATED FROM …") leading the identity.

The chrome is **Apple-style Liquid Glass, not flat frosted glassmorphism.** The
world goes **full-bleed**; the form rail, identity, and caption become **floating
glass islands** hovering above it. The material is deliberate and used *only* on
those floating islands — never the old reflex of frosting every surface:

- a translucent dark tint kept **very transparent** (≈`rgba(16,15,20,0.30–0.34)`)
  so the live world reads through it;
- `backdrop-filter: blur(26px) saturate(160%) brightness(1.05)` — the
  `saturate`/`brightness` are what make it *refract* the per-mood world behind it
  (the move only works because the canvas is the live thing behind the glass);
- a bright **specular** top-left edge + a faint brass inner rule;
- a soft, large shadow that **lifts** each island off the world.

The two warmth grafts still apply: the **planet caption-plate** (name + brass
rule + meaning line) and the **accession placard** replacing the fake
`Signature: INTEREST-INTEREST-01` tag.

Why this still escapes the AI look despite using glass: the tell was never "blur"
— it was *uniform* frost + `white/10` borders on every element with no light
interaction. Here glass is **one named material, on floating islands only, over a
full-bleed live world, with real specular + lift** — the Apple bar the product is
benchmarked against. The purple→cyan gradient, glow shadows, pulse orbs, shimmer,
and the MD3 token vocabulary are still deleted.

> **Reference:** the create-page Liquid-Glass mockup approved 2026-06-26 (warm
> true-black, brass, serif, very-transparent floating glass rail over the
> full-bleed world). The Observatory matte "instrument deck" remains the
> documented fallback **if the glass proves too heavy on weak devices** — V6 /
> mobile-perf gates `backdrop-filter` behind the existing `qualityProfile`
> (reduce blur radius / drop `saturate` on low-end).

### Token map (current → house system)

| Current | New | Note |
|---|---|---|
| `surface` `#0e1323` | `mount` `#0B0B0E` | Warm near-black island base (under the glass tint) |
| `surface-lowest` `#080d1d` | `void` `#08080A` | Page ground behind the full-bleed world |
| `surface-low`/`-container`/`-high`/`-bright` (4 navy steps) | `card` `#131217` / hover `#1A181E` | Tonal navy steps → warm-black levels |
| `on-surface` `#dee1f9` | `paper` `#F2EEE6` | Warm gallery-white, not cool default white |
| `on-surface-variant`/`outline`/`outline-variant` | `grey` `#B6B0A4` / `faint` `#807868` / `hairline` `rgba(255,255,255,.10)` | Out of MD3 vocabulary; AA-checked |
| `primary`/`primary-container` (`#a078ff`) | `brass` `#C9A35B` | One brass metallic accent replaces the gradient |
| `secondary`/`secondary-container` (cyan) | **removed**; `vermillion` `#E0573A` for the live dot only | Deletes the two-stop gradient |
| `primary`/`*-fixed`/`on-*-fixed` (MD3) | **removed** | The theme-builder fingerprint |
| `boxShadow.glow`/`boxShadow.cyan` | **removed**; one soft neutral *lift* shadow for floating glass | Emphasis = brass rule + value contrast, not neon |
| `.glass-panel` (flat 20px frost + white/10) | **`liquid-glass` material**: very-transparent tint + `blur+saturate+brightness` + specular edge + lift | Deliberate; floating islands only |
| `fontFamily.display` (Space Grotesk) | editorial **serif** (self-hosted Didone in prod) | Gallery masthead voice |
| `label-caps` (0.1em mono-upper) | **brass small-caps** labels (kept — on-brand for the gallery) | Vitrine *keeps* engraved caps; mono stays for data |
| body `#050816` + feTurbulence noise | `void #08080A`, no grain | Warm gallery ground, not cosmic void |

### Branch sequence (one concern per branch, off `staging`)

| # | Branch | Scope | Status |
|---|---|---|---|
| V1 | `feat/fe/v-foundation-tokens` | `tailwind.config.ts` + `globals.css` only: remap/rename tokens to the warm-black + brass house system, define the **`liquid-glass`** material (very transparent) + `btn-brass`, neutralize `.pulse-bg`/`.chip-shimmer`/noise, recolor `.btn-gradient`→solid brass + `.focus-ring`→brass, serif `display` font. **Shim: keep old token names + utility classes resolving to the new look so no page reflows mid-migration.** | ⬜ |
| V2 | `feat/fe/v-shell-and-deck` | `layout.tsx` shell: remove the two pulse orbs, matte graphite header/footer + hairline, **keep the documented 57px header offset contract.** | ⬜ |
| V3 | `feat/fe/v-create-reskin` | `app/page.tsx` chrome: glass rail → matte panel, sentence-case labels, drop `Sparkles`/`Wand2`, placard + honest SEED·BODIES readout, stepper → quiet serif chapter numerals, ink swatches/CTA. **Preserve every field, handler, the debounced preview, and the canvas-hero split-grid byte-for-byte.** | ⬜ |
| V4 | `feat/fe/v-dashboard-hud-reskin` | World page + `PlanetDetailsPanel` + `VariantList`: HUD islands → opaque graphite plates (keep pointer-events choreography exactly), **graft the planet caption-plate**, solid-ink bars. Preserve the PNG export ref + all action handlers. | ⬜ |
| V5 | `feat/fe/v-share-gallery-reskin` | Share + gallery + `SavedWorldCard` + `GeneratingOverlay`: **graft the engraved accession placard**, matte gallery cards with mono SEED/CREATED data line, one-shot scan loader + terse copy (keep `aria-live`). | ⬜ |
| V6 | `feat/fe/v-scene-coherence-tune` | **Optional, last.** Retint `UniverseCanvas.tsx:95` bottom fade → `deck`; *if* the scene still over-glows against matte chrome, lower the bloom **scale** — note bloom is seed-derived (`scene.ts:319-321` → `postFX.bloomIntensity`, fallback `DEFAULT_BLOOM_INTENSITY` in `PostEffects.tsx`), so scale globally, do **not** rewire the seed→bloom mapping. **Do NOT touch `MOOD_SCENE_PROFILES` backgrounds — determinism + the seed-locked per-mood void are preserved.** | ⬜ |

### Acceptance (V overhaul)

- [ ] No purple→cyan gradient, no `.pulse-bg`/`.chip-shimmer`, no
      `shadow-glow`/`shadow-cyan`, no `Sparkles`/`Wand2`, no MD3 `*-fixed` tokens.
      Glass appears **only** as the one defined `liquid-glass` material on floating
      islands — never flat frost on every surface.
- [ ] The live world is the luminous element; chrome is one Liquid-Glass material
      + brass hairlines, floating above the full-bleed canvas.
- [ ] Every planet shows a name + meaning caption-plate; the world shows a
      curatorial accession placard, not the fake "Signature" tag.
- [ ] Canvas-hero layout, all form fields, handlers, the debounced preview, the
      pointer-events choreography, the PNG export ref, and the 57px header
      contract are byte-for-byte unchanged.
- [ ] WCAG AA contrast holds (paper `#F2F0EA` ~15:1 on deck; `grey #9A968C`
      ≥4.5:1; amber/brass used as signal/large only); `prefers-reduced-motion`
      freezes the one-shot scan and the live dot.
- [ ] Determinism intact: no change to `MOOD_SCENE_PROFILES`, no `Math.random`
      in scene code.

## UI Overhaul (U1–U4) — TOP PRIORITY

Goal: a premium, professional interface where the **3D canvas is the hero**, not a
boxed-in widget — the "futuristic command deck" feel of the Stitch reference
(`agent-system/design/stitch_personal_universe_3d_v2`), benchmarked against the restraint of
Apple / supercar / interior-design sites. **Pure presentation: no logic or
behavior change.** Same form state, same payload, same API calls, same scene
builder (`buildPreviewSceneConfig` / `sceneFromVariant`), same handlers — only
layout, spacing, and chrome change. Every U-branch must keep all existing tests
green (`npm run typecheck && lint && build && test`).

Design language is already half-built and stays the single source of truth — see
`agent-system/knowledge/design/stitch_personal_universe_3d_v2/personal_universe_3d/DESIGN.md`:
deep-space navy `#050816`, glassmorphism (20px backdrop blur, 1px white/10
border, brighter top edge), gradient CTA (purple→cyan), Space Grotesk headlines /
Inter body / JetBrains Mono data-labels. The tokens and fonts already exist in
`tailwind.config.ts` + `globals.css`; what is missing is **layout composition**
(canvas as hero + floating HUD panels) and a few ambient utilities.

Reference → screen mapping:
- Create page → `create_universe_form_3` (full-bleed canvas right, narrow form rail left).
- World page → `3d_universe_dashboard_1` / `_2` (full-bleed solar system, floating glass HUD overlays + bottom action toolbar).
- Share page → `public_share_page_1` (canvas hero, then traits / celestial-bodies / CTA).
- Gallery → `saved_worlds_gallery` (card grid with thumbnail, tags, seed/created stats).
- Landing (optional) → `landing_page_1` (hero + 3-step "Architecting Your Soul").

### U1. feat/fe/ui-shell-and-tokens

Foundation every other U-branch builds on. No page reflow yet — just the shared
shell and missing design primitives.

- Extend `tailwind.config.ts`: named font sizes (`display-lg` 48/`headline-md`
  24/`label-caps` 12/`stat-lg` 28) and any missing color tokens
  (`on-primary-fixed` `#23005c`, etc.) so utilities read like the DESIGN.md scale.
- `globals.css`: add ambient `pulse-bg` (slow-pulsing blurred gradient orbs),
  `chip-shimmer` (AI-processing shimmer on active chips), `glass-panel-glow`
  (gradient top-left stroke), and the faint SVG noise texture on `body` (kills
  banding). All behind `prefers-reduced-motion` where animated.
- `layout.tsx` shell: real nav (How it works / Gallery — keep links honest, no
  dead routes), a footer, container max-width `1440px` with generous desktop
  margins (48px), ambient pulse orbs mounted once at the shell level.

Acceptance: shell renders on every page with the new chrome; no page-body layout
change yet; all gates green.

### U2. feat/fe/create-canvas-hero  ← the user's #1 ask ("more canvas space")

Restructure `app/page.tsx` to the `create_universe_form_3` layout: the Live DNA
Preview canvas goes **full-bleed on the right (~58% width, edge-to-edge, no card
frame)** as the hero; the form collapses into a **narrow glass rail on the left
(~42%) that scrolls internally** while the canvas stays pinned. On mobile the
canvas stacks on top as a tall hero, form below.

- Keep EVERY field and all state/handlers byte-for-byte: nickname, role,
  interests, traits, goal, challenge, mood (4 buttons), world style (5 buttons),
  palette, submit → `api.createWorld(payload)`. The debounced `previewScene`
  pipeline is untouched.
- The form rail uses tighter vertical rhythm + section dividers so all fields fit
  a scrollable column without feeling cramped (Apple-style restraint).
- Sticky submit CTA at the bottom of the rail; keep the progress stepper.
- Fold the small "Signature / Active palette" stats into a compact HUD strip
  overlaid on the canvas corner (reference) instead of a separate card.

Acceptance: canvas occupies markedly more screen than today; form fully usable by
scrolling the rail; preview still updates live; identical payload submitted;
tests green.

### U3. feat/fe/dashboard-hud

Restructure the world page (`app/worlds/[worldId]/page.tsx`) to the
`3d_universe_dashboard_1/_2` command-deck: the `UniverseCanvas` fills the viewport
behind floating glass HUD panels — profile/archetype card, "Trait Mapping" bars,
"World DNA" planet list, and a centered bottom action toolbar
(Regenerate Variant / Export Image / Share Link / Save World).

- All actions wire to the EXISTING handlers (regenerateVariant, publishWorld +
  loadWorld, selectVariant, gallery save). No new endpoints, no behavior change.
- Panels are `pointer-events-auto` islands over a `pointer-events-none` canvas
  layer so orbit-drag still works in the gaps.
- Reuse the share-page canvas-sizing fix (absolute inset-0 canvas under a
  relative z-10 overlay) so there is no zoom/blur/lag regression.

Acceptance: world page reads as a HUD over the live solar system; every existing
action works unchanged; consistent scene with create-preview and `/share`.

### U4. feat/fe/share-gallery-landing

Public-facing polish (can split into 2 PRs if it grows): share page →
`public_share_page_1` (canvas hero, then Core Traits / Celestial Bodies / "Inspired
by what you see?" CTA); gallery → `saved_worlds_gallery` card grid (thumbnail,
title, tags, SEED/CREATED mono stats); optional landing hero `landing_page_1`.
Coordinate with item #7 (share SSR metadata) — do the visual layout here, keep the
server-component/OG-tag conversion as #7 so the two concerns stay separate.

Acceptance: share + gallery match the reference visual quality; no behavior change.

## 1. fix/fe/scene-render-consistency

Problem: the 3D scene is built **three different ways in three places**, so the
same world looks different depending on where you view it, and the create-page
preview does not render the real scene at all.

Confirmed root causes (read from the code, not guessed):

1. **The "Live DNA Preview" renders the abstract fallback, never the real scene.**
   `app/page.tsx` passes `selectedVariant({ id: "preview", variants: [] })`,
   which is `undefined`; `sceneFromVariant(undefined)` returns a scene with no
   planets and no theme; `UniverseCanvas` then sees `hasConfiguredPlanets ===
   false` and forces `FallbackUniverseRenderer`. The preview ignores every form
   field (mood, palette, style, interests) and looks nothing like the
   solar-system the user gets on `/worlds`. The "SYNCING..." label is decoration.
2. **Three different fallback seeds.** `lib/scene.ts` uses
   `"myunivokai-local-seed"`, `UniverseCanvas` uses `"myunivokai"`, and
   `sceneFromVariant` chains `seed ?? id ?? "myunivokai-local-seed"`. When a seed
   is missing, the same world draws a different star field / orbit inclination on
   different pages because `randomFromSeed` receives a different input.
3. **Scene construction is duplicated across call sites that drift.** `/worlds`
   builds the scene via `sceneFromVariant` (`seed ?? id ?? FALLBACK`); `/share`
   builds it via `buildShareSceneConfig` (`{ seed: variant.seed, ...config }`,
   no `?? id` branch). A published world whose `variant.seed` is empty therefore
   renders with a different seed on `/share` than on `/worlds`. The BE share
   contract (`PublicVariant.Config`) does include the full planet list, so this
   is purely an FE consistency bug.

Work:

- **One source of truth for scene construction.** Move all scene building into a
  single `resolveSceneConfig(variant)` (or extend `sceneFromVariant`) in
  `lib/scene.ts`, used by the world page, the share page, and the normalize
  layer. Delete `buildShareSceneConfig`'s separate `??` chain; the share page
  must produce the same `SceneConfig` the world page does for the same variant.
- **One canonical fallback seed.** Declare `CANONICAL_FALLBACK_SEED` once in
  `lib/scene.ts`; `UniverseCanvas` imports it instead of its own literal. No
  second seed constant anywhere.
- **Make the Live DNA Preview real and local.** Build a deterministic preview
  `SceneConfig` from the current form state (palette ← favoriteColors,
  background ← mood, planet count ← interests/traits, seed ← a hash of the
  inputs) and render it through the SAME `SolarSystemRenderer`. No backend / AI
  call (we never call AI from the FE) — purely local and deterministic via
  `randomFromSeed`. The preview then matches the look-and-feel of the result and
  updates live as the user edits the form.
- **Confirm `/share` renders the solar system.** Verify the BE share service
  actually populates `variant.config.planets`; with the unified builder, a
  published world must render the same solar system on `/share` as on `/worlds`,
  never the abstract fallback (unless planets are genuinely absent).
- Bootstrap a minimal `vitest` config here (the full setup + CI wiring is item
  2) and add a regression test: the same variant yields an identical
  `SceneConfig` (seed + planet count) on every code path, and the preview
  builder is deterministic for fixed inputs.

Acceptance:

- The create-page preview shows a solar system that reflects the chosen palette
  / mood / style and updates as the form changes — not the abstract blob.
- A given world renders consistently on `/worlds` and `/share` (same seed → same
  star field and orbits).
- `/share` renders the solar system for any published world.
- `npm run test` covers the unified scene builder and the preview builder.

## 1b. feat/fe/mood-style-impact

Problem: the Atmospheric Mood and World Style controls did not stand out when
selected, and neither changed the Live DNA preview — World Style was a plain
`<select>` and Mood only reshuffled the seed.

Work:

- Make selection prominent: Mood and World Style are both button grids now
  (ring + glow + scale + a check badge on the selected one); World Style is no
  longer a dropdown.
- Mood drives the preview's bloom, star density, motion and background via a
  `MOOD_SCENE_PROFILES` map that mirrors the backend `moodSceneProfile`
  (`feat/be/mood-scene-params`) exactly, so the preview and the generated world
  react to mood in the same direction.
- World Style drives the orbital character (orbit inclination multiplier per
  theme) in the shared `SolarSystemRenderer`, so the style choice visibly
  changes both the preview and the generated world without overriding the
  user's color palette.
- Tests: the mood profile mapping (energetic brighter/busier than reflective,
  neutral fallback) and the mood background applied to the built preview.

Pairs with BE `feat/be/mood-scene-params`; the mood mapping values are kept
identical on both sides.

Acceptance: clicking a Mood or World Style visibly changes the preview, and the
selected control is unmistakable.

## 2. feat/fe/unit-testing-setup

Problem: the FE has zero tests. The "variants at response root" bug survived
every check because only typecheck/lint run — a unit test on normalize would
have caught it.

Work:

- Install `vitest` + `@testing-library/react`, add an `npm run test` script
  (building on the minimal vitest config introduced in item 1).
- First tests for the two riskiest areas:
  - `lib/api.ts`: normalizeWorld/normalizeVariant/normalizeShare against JSON
    fixtures copied from the real BE shapes (`models/responses.go`).
  - `lib/scene.ts`: `randomFromSeed` determinism, `planetsFromScene`, `paletteFromScene`.
- Add the test step to CI (`.github/workflows/ci.yml` has a reserved TODO) and
  update `agent-system/knowledge/frontend/source-overview.md`.

Acceptance: `npm run test` runs in CI; both lib files covered.

## 3. refactor/fe/typed-api-client

Problem: `lib/api.ts` is full of `any` and defensive `??` fallback chains for
shapes that do not exist (`world_id`, `scene_config`, ...). Defensive code like
this hides bugs instead of exposing them (lesson from the variants bug).

Work:

- Define zod schemas for each real BE response (`CreateWorldResponse`,
  `WorldResponse`, `VariantResponse`, `PublicWorldResponse`) — exactly ONE
  shape per endpoint, no snake_case guessing.
- `request<T>()` parses through zod: a wrong-shaped response throws a clear
  error naming the bad field instead of silently rendering fallback visuals.
- Remove every `any` from `lib/api.ts`; derive `lib/types.ts` types via
  `z.infer` so they can never drift.

Acceptance: no `any` left under lib/; fixture tests pass; a response missing a
key field throws an error that names the field.

## 4. refactor/fe/form-validation

Problem: the create form silently fills defaults when fields are empty
(empty nickname becomes "Neo", empty goal becomes a generated sentence). That
violates the explicitness principle and users never learn what was sent.

Work:

- Install `react-hook-form` + zod resolver (both in the original plan's stack).
- Zod schema mirroring the BE validation rules (`validation/world.go`):
  nickname 2-32, interests 3-8, traits 3-6, goal 10-220, ...
- Show per-field errors under each input; disable submit while invalid.
- Delete `ensureRange`/silent defaults; make the "Custom" interest button real
  (today it is decoration only).
- Map BE `VALIDATION_ERROR.details` back onto the matching form fields.

Acceptance: submitting an empty form shows per-field errors and sends no
request; a BE 400 with details highlights the right fields.

## 5. refactor/fe/page-decomposition

Problem: `app/page.tsx` is 335 lines mixing landing + form + options; the world
page also owns too much logic. The original plan's feature-folder structure is
not followed.

Work:

- Split per the original plan:
  - `features/create-universe/`: `CreateUniverseForm.tsx`, `formSchema.ts`,
    `constants.ts` (interestOptions, moodOptions, ... leave the page).
  - `features/dashboard/`: `WorldHeaderPanel.tsx`, `PublishPanel.tsx`,
    `VariantsPanel.tsx` (the world page only composes + holds state).
- Each page.tsx is roughly 80 lines or less, orchestration only.
- No behavior change — pure refactor; tests from earlier items must pass untouched.

Acceptance: build + tests pass; the page.tsx diff is mostly deletions.

## 6. feat/fe/toast-and-loading-states

Problem: notices are static StatusMessages that never dismiss; API errors show
raw; the canvas Suspense fallback is null, so texture loading shows a black box.

Work:

- Toast component (auto-dismiss after `TOAST_AUTO_DISMISS_MILLISECONDS`,
  stacking, success/error variants) replacing static notices on the world page.
- A real Suspense fallback in the canvas: spinner/skeleton instead of null.
- Action buttons (publish, variant, export) share a consistent disabled+spinner
  treatment.

Acceptance: creating a variant pops a toast that disappears by itself; a slow
world page shows a skeleton instead of a black block.

## 7. feat/fe/share-page-ssr-metadata

Problem: the share page is a client component — links shared to
Facebook/Zalo/Twitter get no title/preview (bots do not run JS). This is the
one page that needs SEO.

Work:

- Convert `share/worlds/[shareSlug]/page.tsx` into a server component fetching
  from the API (the 3D canvas stays a client child).
- `generateMetadata()`: title = sceneName, description = shortNarrative,
  OpenGraph + Twitter card.
- (Optional) an `opengraph-image` route rendering a simple OG image from the
  palette + scene name.

Acceptance: `curl` on a share page shows og:title/og:description in raw HTML.

## 8. feat/fe/mobile-performance

Work:

- Detect weak devices (deviceMemory/hardwareConcurrency) and apply a named
  `qualityProfile`: lower dpr, bloom off, fewer sphere segments.
- A resize listener for particle counts (currently read once at mount).
- Lazy texture loading: distant planets use flat colors until textures arrive
  (avoids the initial white flash).
- Test on a real phone; record results in the PR.

Acceptance: no severe frame drops in Lighthouse mobile; no WebGL crash on the
test device.

## 9. refactor/fe/cleanup-a11y

Work:

- `aria-label` on every icon-only button (export, copy, remove, ...).
- Focus trap in GeneratingOverlay; `prefers-reduced-motion` disables the
  spinning animation.
- Sweep remaining magic numbers into named constants (agent-system/rules/coding-style.md).
- Delete dead code/imports; re-sync `agent-system/knowledge/frontend/source-overview.md` with the new
  structure.

Acceptance: `npm run lint` passes with jsx-a11y rules enabled.

## Definition of production-ready (FE)

- [ ] The scene renders consistently everywhere: the create-page preview, the
      world page, and the share page draw the same world the same way.
- [ ] Unit tests for lib (api normalize, scene helpers) run in CI.
- [ ] No `any` left in `src/lib/`.
- [ ] The form validates for real and never invents data for the user.
- [ ] Share links unfurl properly on social networks.
- [ ] Runs smoothly on a mid-range phone.
- [ ] Every page.tsx only orchestrates; logic lives in features/.

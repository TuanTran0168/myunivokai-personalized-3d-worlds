# Ocean family research — the deep sea as the third scene family

> **Document status:** Research. **Nothing here is approved.** It exists so the
> owner's 2026-08-14 proposal can be argued against the real source before it
> becomes a sprint, and so the comparison it forces — Ocean against the already
> approved [city-service-plan.md](city-service-plan.md) — is made on evidence
> rather than on which one sounds better.
> **Raised:** 2026-08-14 by the owner
> **Last source review:** 2026-08-14
> **Graduated 2026-08-14** into
> [ocean-service-plan.md](ocean-service-plan.md), which is the document to
> implement from. This one remains the argument and the evidence behind it —
> read it for *why* depth is the axis and why City is re-scoped, not for phases.
> The owner's decisions taken on graduation: Ocean proceeds as its own service,
> named `ocean`; O4 and O5 are answered in the plan's §1; O2 and O3 remain open
> there with the phase each one gates.

The owner's brief, verbatim:

> *"tôi đang thích cái services về đại dương bên dưới có cá bơi rong rêu rồi
> sinh vật kì bí độ sâu của biển cả… tham khảo về hình ảnh và màu sắc trong
> thủy quốc của genshin impact khi nhân vật lặn dưới nước có cá bơi và san hô,
> sinh vật phát sáng, sinh vật khổng lồ. độ sâu, ánh sáng."*

And the deployment decision, taken in the same conversation: **`ocean-service`
is its own service**, like every other family. This document does not re-argue
that.

---

## The one finding that decides the design

**Depth is the family's main axis, and unlike every other axis in this
repository it has real physical numbers behind it.**

Forest's axis is `season`: four kinds, and a table of tint/ground/particle
values somebody had to invent. Universe's is `theme`: five names, same story.
Ocean's axis is depth in metres, and the entire palette falls out of measured
light attenuation:

| Depth | Surface light remaining | Colour that has died | What the scene is |
| --- | --- | --- | --- |
| 1 m | **45 %** | — | Full spectrum, caustics sharp, sun disc visible through Snell's window |
| 10 m | **16 %** | **red** | Red coral reads brown-grey. This is physically correct, not a stylisation |
| 40 m | ~5 % | orange | God rays become soft columns; caustics nearly gone |
| 100 m | **1 %** | yellow | Blue-green only. Photosynthetic coral stops |
| 200–1000 m | ≈0 | — | **Twilight zone.** Bioluminescence starts to dominate the frame |
| > 1000 m | **0** | — | **Abyss.** No sunlight reaches here at all. Every photon on screen is emitted by something alive |

Sources: [Introduction to Oceanography §6.5 Light](https://rwu.pressbooks.pub/webboceanography/chapter/6-5-light/),
[NOAA Ocean Explorer — Light and Color in the Deep Sea](https://oceanexplorer.noaa.gov/wp-content/uploads/2025/04/light-and-color-fact-sheet.pdf),
[Geosciences LibreTexts §6.10 — Light in the Ocean](https://geo.libretexts.org/Bookshelves/Oceanography/Introduction_to_Physical_Oceanography_(Stewart)/06:_Temperature_Salinity_and_Density/6.10:_Light_in_the_Ocean_and_Absorption_of_Light).

Two consequences worth stating before any code:

1. **`lighting.fogColor` and `fogDensity` stop being invented.** They already
   exist in the forest contract as builder-chosen values. In Ocean they are
   *derived* from `depth` by an absorption curve, which means the palette is
   defensible rather than tuned, and re-tuning it is a formula change rather
   than a table edit.
2. **It resolves the caustics argument rather than picking a side.** Caustics
   and god rays are the star of the sunlit zone and are *physically absent*
   below ~1000 m, because there is no sun to refract. So `causticStrength` and
   `godRayStrength` are functions of depth that reach zero on their own. One
   renderer covers both the Fontaine-like reef and the owner's "Abyssal Trench"
   idea; they are the two ends of a single axis, not two features.

---

## Reference products, verified

Every link below was opened during this research. Two of the most attractive
options are recorded because they are **rejected**, and the reason matters more
than the rejection.

### Usable as visual/technical reference

| Product | Stack | What it proves or teaches |
| --- | --- | --- |
| [The Sea We Breathe](http://www.theseawebreathe.com) — Unseen Studio ([Awwwards](https://www.awwwards.com/inspiration/the-sea-we-breathe-dive-into-3-immersive-underwater-journeys)) | **three.js** + WebGL + sound design | The closest analogue to this repository that exists: three.js, audio, narrative, award-level. Direct evidence that plain three.js reaches the target quality without WebGPU |
| [World Ocean Explorer](https://worldoceanexplorer.org/deep-sea-aquarium.html) | **WebGL** | Deep-sea species presented in 3D. Reference for how a creature is *shown* rather than merely scattered |
| [Convex Seascape Survey](https://www.awwwards.com/inspiration/underwater-convex-seascape-survey) | WebGL, scroll-driven | Descent as a scroll interaction |
| [neal.fun — The Deep Sea](https://mymodernmet.com/the-deep-sea/) | 2D scroll, **not** 3D | The strongest evidence in this document that **the depth axis is itself the content**. Millions of people scrolled it with no 3D at all |
| [three.js ocean example](https://threejs.org/examples/webgl_shaders_ocean.html) | WebGL2 | The canonical surface shader — seen from *above*. Ocean needs the view from *below*, which is a different problem |
| [Deep Abyss](https://discourse.threejs.org/t/deep-abyss-underwater-experience/92214) | three.js **WebGPU + TSL** | The prettiest reference found — volumetric fog, god rays, caustics, fish schools. **Not reachable on this stack**; see below |

### Rejected, with reasons

| Product | Why it is out |
| --- | --- |
| [Tidewater](https://ilikekillnerds.com/2026/05/21/i-built-tidewater-threejs-ocean-kit/) | Has exactly the right feature list — Snell's window, caustics, depth fog, god rays. But **$75/developer, closed source, redistribution prohibited**, tested against **three r184** while this repo is on 0.171.0, and its primary path is WebGPU/TSL with WebGL2 as fallback |
| [Three.js Water Pro](https://docs.threejswaterpro.com/) | **WebGPU only.** FFT waves and caustics on a renderer this repo does not have |
| [Deep Abyss](https://discourse.threejs.org/t/deep-abyss-underwater-experience/92214) | WebGPU + TSL. Under `WebGPURenderer`, `@react-three/postprocessing` does not work at all — verified in [frontend-modernization-research.md §WebGPU](frontend-modernization-research.md). Bloom is the mechanism bioluminescence depends on, so this is not a partial loss |

**The rule this implies:** these products define the *checklist* — Snell's
window, depth fog, god rays, caustics, marine snow — and none of them supplies
the *code*. That is the same conclusion `ForestPondWater.tsx` reached on its
own and wrote into its header: no CC0 source has a water-surface material, so
the surface is procedural. Ocean inherits that position rather than departing
from it.

### What Genshin Impact's Fontaine actually teaches

From the developers' own [interview](https://screenrant.com/genshin-impact-fontaine-interview/)
and [art analysis](https://rifttrek.com/genshin-impact-art-a-deep-dive-into-mihoyos-stunning-visual-design-in-2026/):

**Take:**

- The underwater ecosystem uses **group-behaviour algorithms** to simulate fish
  schools — emergent, not hand-animated. This is the upgrade path for
  `ForestWildlife.tsx`'s existing flock code, not a new subsystem.
- Creature design = **a real animal plus one fantastical element** (hermit crab
  → Armored Crab). This is the formula that makes CC0 stylised assets work:
  take the CC0 manta, add emissive markings and scale, and it reads as designed
  rather than downloaded.
- Refracted light and emitted light are treated as **two separate lighting
  systems**. That is the depth axis restated as an art-direction rule.

**Do not take:** Fontaine's architecture is **Art Deco and Belle Époque** —
gold ornament, geometric pattern, clockwork. That is the *city* of Fontaine.
It belongs to City's mood board, not Ocean's, and importing it would blur both
families.

---

## What the current stack can and cannot do

Verified against `apps/myunivokai-web/package.json` and the installed tree on
2026-08-14:

| Dependency | Version | Bearing on Ocean |
| --- | --- | --- |
| `three` | 0.171.0 | WebGL2. Everything below is WebGL2-reachable |
| `@react-three/fiber` | 9.7.0 | R3F v9. `<bufferAttribute args={[array, itemSize]} />` is the v9 form — the trap that cost four files in the Next upgrade |
| `@react-three/drei` | 10.7.8 | `useGLTF`, `Html`, `OrbitControls`, `Text` |
| `@react-three/postprocessing` | 3.0.4 — **pinned** | Bloom. 3.0.5 raises its `three` peer to `>=0.182.0`, so the effect stack and the three version are locked together |
| `next` / `react` | 15.5.23 / 19.2.8 | Route params are async; share routes must `await`/`use` them |

Reachable on WebGL2, in descending order of confidence:

- **Depth fog** — `FogExp2`, already the mechanism behind `lighting.fogDensity`.
- **God rays** — additive cone geometry, the same technique the forest already
  uses for sun shafts.
- **Bioluminescence** — emissive materials plus the Bloom pass that is already
  mounted in `PostEffects.tsx` and already reads its intensity from
  `config.postFX`.
- **Marine snow / plankton** — instanced quads, five existing particle systems
  to copy from.
- **Fish schools** — skinned GLB clones with real clips, exactly as the birds
  work today, with boids replacing the two fixed flight patterns.
- **Kelp and coral** — `InstancedMesh` plus the existing wind-lean vertex maths
  with the wind vector renamed to a current vector.
- **Caustics** — an animated projected texture on the seafloor, cheap in the
  sunlit zone. [Real-time caustics needs GPU shaders to hold 60 fps](https://medium.com/@martinRenou/real-time-rendering-of-water-caustics-59cda1d74aa),
  which is the argument for keeping them **only where depth says they exist**.

Not reachable, and should not be attempted: FFT wave simulation, path-traced
volumetrics, and anything else on the WebGPU list above.

---

## `OceanSceneConfig` — a 1:1 mirror of `ForestSceneConfig`

The point of this table is that Ocean is a **disciplined copy**, not an
invention. Left column exists in
[contracts/scenes/forest-scene-config.schema.json](../../contracts/scenes/forest-scene-config.schema.json)
today.

| Forest section | Ocean section | Change |
| --- | --- | --- |
| `season` (4 kinds, blend toward adjacent) | **`depth`** (metres + zone, blend toward adjacent zone) | Same shape, real numbers |
| `weather` (rain/snow, intensity) | **`current`** (direction, strength, marine-snow density) | Same shape |
| `trees` (placementSeed, counts, speciesMix, windStrength, windDirectionRadians) | **`flora`** (kelp, coral, anemone; `currentStrength`, `currentDirectionRadians`) | Field rename; **same vertex maths** |
| `wildlife.groundAnimals` + `birdFlocks` | **`fauna.schools`** (boids) + **`fauna.drifters`** (jellyfish) | Flocks gain a Y axis and a boid rule set |
| — | **`fauna.giants`** ⭐ | New. One whale or manta emerging from fog and leaving. Cheapest dramatic beat available: scale plus a fog-reveal distance |
| `ambientParticles` (leaves, petals, fireflies, snow dust) | **`bioluminescence`** (plankton bloom, drifting spores) | Recolour, redistribute by depth |
| `landmarks` (heartTree, standingStone, pond, …) | **`landmarks`** (shipwreck, ancient arch, hydrothermal vent, kelp cathedral) | Identical mechanism, new vocabulary |
| `lighting` (sun elevation/azimuth, hdriKey, fog) | **`lighting`** (surface light, `godRayStrength`, `causticStrength`, fog **derived from depth**) | **Drops `hdriKey` entirely** |
| `terrain` | **`seafloor`** | Near copy |
| `camera`, `postFX`, `hud`, `assets` | unchanged | — |

The stored config stays small for the same reason the forest's does: only
semantics and hero placements are stored; mass scatter is re-derived on the
frontend from placement seeds.

---

## Reuse inventory — verified file by file

Every row was read, not assumed.

| Ocean needs | Existing source | Work |
| --- | --- | --- |
| Fish schools | [`forest/ForestWildlife.tsx`](../../apps/myunivokai-web/src/features/scene-renderers/forest/ForestWildlife.tsx) — `SkeletonUtils.clone` + `useAnimations`, `circling`/`crossing` patterns, per-bird clip phase offset, per-individual tint | Add a Y axis and boid separation/alignment/cohesion |
| Kelp sway | [`forest/ForestTrees.tsx`](../../apps/myunivokai-web/src/features/scene-renderers/forest/ForestTrees.tsx) — one `InstancedMesh` per (variant, part), whole-object wind lean | Rename wind → current |
| Surface seen from below | [`forest/ForestPondWater.tsx`](../../apps/myunivokai-web/src/features/scene-renderers/forest/ForestPondWater.tsx) — tessellated radial grid, Gerstner displacement, translucent over a painted bed | Invert normals, add Snell's window |
| Seafloor | `forest/ForestTerrain.tsx` — `PlaneGeometry` + height sampler | Near copy |
| Bioluminescence | `forest/ForestAmbientParticles.tsx` (fireflies) + `shared/PostEffects.tsx` (Bloom, intensity from BE) | Recolour and redistribute |
| Click a creature to focus | `shared/CameraRig.tsx` + `shared/PlanetPositionTracker.ts` | **Zero changes.** A new family writes positions into the same Map and camera focus works — stated in [threejs-scene-architecture.md](../fe/threejs-scene-architecture.md) and true in source |
| Landmarks → HUD/hover | `lib/scene.ts` `pointsOfInterestFromScene` | One adapter branch beside the forest one |
| Renderer registration | [`scene-renderers/registry.ts`](../../apps/myunivokai-web/src/features/scene-renderers/registry.ts) | One lazy loader, one `SCENE_TYPE_RENDERER_REGISTRY` entry, one `prefetchSceneRendererForFamily` branch |
| GLB normalisation + compression | `forest/forestModels.ts` `normalizationForObject`, and the gltf-transform Draco pipeline in [forest-render-mechanism.md](../fe/forest-render-mechanism.md) | Reuse as is |

**What Ocean does *not* need that forest did:** a sky dome, three HDRI files,
four seasonal palettes, rain and snow particle systems, and a distant treeline.
Exponential depth fog removes the draw distance that made the treeline
necessary. This is a genuine subtraction, not an optimistic estimate.

---

## Assets and audio

Same pipeline as forest — [poly.pizza](https://poly.pizza), self-hosted,
never hotlinked. Sketchfab remains owner-manual only: its download endpoints
return HTTP 401 without an OAuth session even for CC-BY models, verified and
recorded in [forest-render-mechanism.md](../fe/forest-render-mechanism.md).

| Need | Source | Licence | Agent-downloadable |
| --- | --- | --- | --- |
| Fish, dolphin, shark, **whale, manta** — 7 models, each with its own swim animation | [Animated Fish Bundle — Quaternius](https://poly.pizza/bundle/Animated-Fish-Bundle-ZkGbjS8m8g) | **CC0** | ✅ |
| Kelp, seaweed | [poly.pizza/search/seaweed](https://poly.pizza/search/seaweed) | mixed CC0/CC-BY — filter `License=1` | ✅ |
| Coral | [poly.pizza/search/coral](https://poly.pizza/search/coral) | mixed | ✅ |
| Jellyfish (47 results) | [poly.pizza/search/jellyfish](https://poly.pizza/search/jellyfish) | mixed | ✅ |
| Whale song, hydrophone ambience | [NOAA PMEL Acoustics](https://www.pmel.noaa.gov/acoustics/multimedia.html), [NPS humpback recordings](https://archive.org/details/HumpbackWhalesSongsSoundsVocalizations), [NOAA Whale Song](https://archive.org/details/WhaleSong_928) | **Public domain** (US government work) | ✅ |

The whale bundle being **the same author as the forest animal pack** is worth
more than it sounds: art direction matches for free, which is the single
hardest thing to buy with CC0 assets.

**Two things to build rather than download:**

- **Jellyfish should be procedural.** A translucent bell with shader-driven
  tentacles both looks better than a static GLB and emits its own light. The
  same argument `ForestPondWater.tsx` made about water.
- **Abyssal creatures are the known gap.** There is no agent-downloadable CC0
  anglerfish or giant squid. This is the same shape as the "realistic CC0
  vegetation gap" already recorded in
  [threejs-assets.md](../references/threejs-assets.md). Three exits: build
  procedurally, have the owner download one manually, or stylise from the
  existing bundle. Pick before promising the feature.

**Audio fits with no new mechanism.** The soundscape reads exactly one input —
`SceneConfig` — and the forest bed is already band-passed noise (wind in
foliage). Ocean changes the filter and adds whale calls as a sample category.
The public-domain constraint recorded in
[ambient-audio-mechanism.md](../fe/ambient-audio-mechanism.md) is satisfied by
NOAA rather than worked around.

---

## The rare-feature lottery already exists, and has no ocean entries

[`contracts/go/contracts_rarity.go`](../../contracts/go/contracts_rarity.go)
is a complete gacha mechanism: each feature owns a PRNG stream derived from the
variant seed, species are chosen by a second draw, every roll is replayable
from the seed, and the admin Rarity screen already reports the **observed** rate
against the **configured** one. Five entries exist. None is an ocean.

Proposed additions, in the existing shape:

| Key | p | Species (ordered) |
| --- | --- | --- |
| `ocean-bioluminescent-bloom` | 0.35 | — |
| `ocean-whale-passage` | 0.12 | humpback · blue whale · manta parade |
| `ocean-sunken-relic` | 0.20 | — |
| **`ocean-abyss-visitor`** | **0.05** | anglerfish · giant squid · gulper eel |

`ocean-abyss-visitor` is the owner's "sinh vật kỳ bí" expressed in the
mechanism that already exists — as rare as the rarest universe feature, and
measurable, which is what makes it worth showing off.

**Two rules from that file are load-bearing and must not be broken:**

1. **Species order is a contract.** Reordering the slice reassigns the species
   of every world already generated, because selection is by
   `floor(roll × len)`.
2. **Every feature owns its own `seedSuffix`.** Adding or re-tuning one feature
   must never shift another's roll.

The catalogue is mirrored between Go and `lib/rarity.ts` and pinned by
[`contracts/fixtures/rarity/rare-feature-rolls.v1.json`](../../contracts/fixtures/rarity/rare-feature-rolls.v1.json).
Ocean entries land in all three or none.

---

## Integration points with the platform

Ocean is a peer service, so it inherits every seam the other families use.
This list is the actual work, verified against source.

**Contracts**

- `WorldFamilyOcean` in [`contracts/go/contracts.go`](../../contracts/go/contracts.go),
  plus `Valid()`, `ComposeCommandSubject()`, `CompletedEventSubject()`,
  `FailedEventSubject()`, `WorldChangedEventSubject()` — five switches, each of
  which fails closed today.
- `myunivokai.commands.ocean.compose.v1`, `myunivokai.queries.ocean.*`,
  `myunivokai.events.ocean.*` following the existing naming.
- `contracts/scenes/ocean-scene-config.schema.json` + a golden fixture.

**dna-service** — dispatch is already generic:
`job.Family.ComposeCommandSubject()` at
[`postgres_store.go:118`](../../services/dna-service/internal/repositories/postgres_store.go).
Adding the family to the switch is the whole change; no new AI pipeline, since
Ocean consumes canonical DNA like every other family.

**api-gateway** — `WorldHandler` is already parameterised by family and subject
set ([`world_handler.go:39-59`](../../services/api-gateway/internal/handlers/world_handler.go)).
One handler construction plus one `businessRouter.Route("/api/ocean", …)` beside
the two at [`router.go:88-92`](../../services/api-gateway/internal/handlers/router.go).

**Wake mechanism** — `wake.ServiceOcean` in the `Services` slice and
`OCEAN_SERVICE_URL`, both already guarded by
`internal/config/wake_config_test.go`. `ServiceForSubject` resolves by subject
prefix, so no ocean-specific branch is needed — the same property
telemetry-service relied on.

**analytics-service** — the read-model amendment in
[city-service-plan.md](city-service-plan.md) applies unchanged and is the
easiest thing to forget, **because nothing fails when you do**: ocean worlds
would simply never appear in the admin app. From the first migration:
`worlds.revision`, a `world.changed` outbox row written **inside the same
transaction** as every mutation, the first `WorldSnapshot` attached to the
`completed` event, and `world_snapshot.go` + `world_snapshot_test.go` copied
from universe-service — that test is the only thing that catches the omission.

**Deployment** — an eighth `type: web`, `plan: free` block in `render.yaml`
mirroring the `myunivokai-nature` block, a `myunivokai_ocean` Neon database, an
`ocean-service-checks` CI job, a `services/ocean-service/docker-compose-local.yaml`
added to the root `include:` aggregator, and the `OCEAN_DATABASE_*` keys in
`.env.example`.

**No NATS work.** Production runs a **single shared Synadia user with no
per-user publish allow-list**; the per-service permission blocks exist only in
`infra/nats/nats-server.conf`, which is local-development-only and says so in
its first line. Recorded here because an earlier draft of this research listed
it as deploy work, which it is not — see
[auth-analytics-first-deploy-checklist.md](../ops/auth-analytics-first-deploy-checklist.md).

**Frontend**

- `WorldFamily` union in `lib/types.ts` (currently `"universe" | "nature"`).
- `API_BASE_URLS_BY_FAMILY` in `lib/api.ts`, **and the literal family check at
  `api.ts:176`** — a hardcoded `=== "universe" || === "nature"` that a new
  family will silently fall through. Found by reading; it would not fail a
  build.
- `app/ocean/share/worlds/[shareSlug]/page.tsx` mirroring the two share routes,
  with `params` awaited (Next 15).
- One registry entry, one loader, one prefetch branch.
- The renderer folder itself, which is the bulk of the work.

**Free-tier count.** This makes eight `plan: free` services, and blocker **B11**
in [platform-evolution-research.md](platform-evolution-research.md) — *confirm
the plan's instance-hour limits before committing to two new services* — is
still open. Three of the seven that exist have never been deployed. This is an
operator decision, not an engineering one, and it belongs before phase 0 rather
than after phase 6.

---

## Ocean weighed against City

Both are approved-or-proposed independent services. The difference is not
ambition, it is what each one runs into.

| | 🌊 Ocean | 🏙️ City |
| --- | --- | --- |
| CC0 assets sufficient? | **Yes.** One CC0 bundle covers fish and giants, same author as the forest pack | **Partly.** Modern and medieval-European yes; Ancient Egypt, UNESCO and Asian are gaps — see below |
| Frontend reuse | **~70 %** — birds→fish, trees→kelp, pond→surface, fireflies→bioluminescence, terrain→seafloor | **~30 %** — district graph, road hierarchy and skyline composition are all new |
| Subtractions | No sky dome, no HDRI, no seasons, no rain/snow, no treeline | None; adds traffic and skyline composition on top |
| Creative axis | **Depth** — real physics, palette derives itself | Density/verticality — every table invented |
| GPU cost | **Low** — fog cuts draw distance | **High** — skyline needs foreground/mid/background plus a hero landmark |
| Audio | Public-domain source verified (NOAA) | Urban ambience under PD is harder |
| Planning state | This document only | **[city-service-plan.md](city-service-plan.md) approved**, Sprint 3 starts **2026-08-19** |
| Largest risk | Abyssal creature assets | **The multi-civilisation ambition hits a licence wall** |

### City's licence wall, stated precisely

The owner asked whether City can render modern, Western, European, Asian,
Ancient Egyptian and UNESCO architecture. Researched:

| Style | Best source found | Licence | Agent-downloadable |
| --- | --- | --- | --- |
| Modern / Western | [Kenney City Kit](https://kenney.nl/assets/city-kit-commercial), [KayKit City Builder Bits](https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0) | **CC0** | ✅ (already verified in [threejs-assets.md](../references/threejs-assets.md)) |
| Medieval European | KayKit Medieval Hexagon Pack, 200+ tiles/buildings | **CC0** | ✅ |
| Asian — Japanese | Sinto Shrine Essentials (20 models, `.glb`) | per-asset, must be checked | ✅ |
| Asian — Chinese | [CS-Studio Building Set 1](https://cs-studio.itch.io/cs-building-set1/purchase) free tier; the full pack is **$89.99** | unclear / paid | partial |
| **Ancient Egypt** | [Synty POLYGON Ancient Egypt](https://syntystore.com/products/polygon-ancient-egypt) | **PAID** | ❌ |
| **UNESCO heritage** | [CyArk / Google Open Heritage](https://artsandculture.google.com/project/cyark) — 25+ laser-scanned sites | **CC BY-NC 4.0** | ❌ requires application |

Two hard stops:

1. **CyArk is NonCommercial.** It is by far the most attractive source for
   "UNESCO monuments" — Angkor, Pompeii, Chichén Itzá at scan fidelity — and
   this repository's asset rule is CC0-preferred with CC-BY acceptable when
   credited. **NC is neither**, and NC is a trap even while the product is
   free.
2. **Ancient Egypt and good Asian architecture are behind money.** This is the
   same shape as forest's realistic-vegetation gap, but it lands on precisely
   what makes City exciting.

City remains buildable in stylised modern/medieval-European form. The
multi-civilisation version is a **budget decision**, and Sprint 3 should not
start on 2026-08-19 with an ambition whose assets do not exist. That decision
belongs to the owner and is listed below.

---

## The owner's three feature ideas, 2026-08-14

### 1. Abyssal Trench — already inside this design

Coral, bioluminescent jellyfish, caustics and god rays, undersea ambience and
meditative music. This is not a separate feature: it is a **preset of
`OceanSceneConfig`** at `depth > 1000` with `godRayStrength = 0`,
`causticStrength = 0` and maximum bioluminescence, while the coral-and-light-
shaft image is the same config near the surface. Building Ocean delivers both.

### 2. Audio-visual synesthesia — the cheapest idea with the widest reach

Hook a Web Audio `AnalyserNode` into the three.js shaders so nebulae, aurorae,
water and fireflies move with the bass and tempo of the Satie / Bach / Debussy
piece already playing.

Verified feasible and small:
[`ambientSoundscapeGraph.ts:312`](../../apps/myunivokai-web/src/features/audio/ambientSoundscapeGraph.ts)
builds exactly one `masterGain` that connects to `audioContext.destination`,
and the file carries a signal-flow diagram in its header. An analyser tap is a
handful of lines in a documented place. No service, no contract, no backend.

Three constraints, all of which already exist in the repository:

1. **`useFrame` must not call `setState`.** Read the analyser into a ref and
   write uniforms directly — the pattern the scene code already follows.
2. **Audio is gesture-gated.** `useAmbientSoundscape.ts` creates a suspended
   context and arms a one-shot gesture listener, so a visitor who never clicks
   hears nothing and the analyser returns silence. **The scene must be complete
   at zero modulation**; audio reactivity is an additive layer, never the
   primary light source.
3. **The twelve visual-regression screenshots committed under
   `apps/myunivokai-web/e2e/reference/` will break** if the scene pulses. They
   must be captured with modulation pinned to zero.

Its real value: it applies to **every** family — universe, forest, ocean, city
— and no competitor can copy it, because no competitor's music is generated
from the same DNA as the picture.

### 3. Lost Ancient Sanctuary — good, with two traps found in source

Floating steles and temples carved with glowing runes made from the visitor's
own soul keywords, Zelda/Laputa in feel. Architecturally it is closer to
**Universe** (floating, gravity-free) than to City.

**Trap 1 — 3D text drags in a CDN.** `drei` ships `<Text>`, which is built on
troika, and [troika fetches its default font and unicode-font-resolver data
from jsDelivr at runtime](https://github.com/protectwise/troika/blob/main/packages/troika-three-text/README.md).
That is the **same class of defect as the Draco decoder still being fetched
from Google's CDN**, already recorded as debt in
[forest-render-mechanism.md](../fe/forest-render-mechanism.md). Self-hosting
the full resolver data set is ~300 MB. The exit is to pass one self-hosted font
file directly to `<Text font=…>` — and `apps/myunivokai-web/public/fonts/`
**does not exist yet**. The font must carry **Vietnamese diacritics**, or
"Kiên định" renders as "Kien inh".

**Trap 2 — privacy, and the rule is already written.** [AGENTS.md](../../AGENTS.md)
states *"Public share APIs must not return raw sensitive input."* Carving
`archetype`, `facets`, `coreSymbol` and `quote` is fine — those are AI-derived
semantics. Carving `interests`, `goal` or `challenge` is **not**: that is the
visitor's raw questionnaire input, and the share page is public. This boundary
belongs in the scene contract, not in a reviewer's memory.

---

## Open decisions

| # | Decision | Why it blocks | Owner or engineering |
| --- | --- | --- | --- |
| O1 | Does Ocean take Sprint 3's slot from City? | Sprint 3 starts **2026-08-19**. City's plan is approved; displacing it must be written down, not allowed to drift | Owner |
| O2 | Does City keep the multi-civilisation ambition? | Ancient Egypt and UNESCO need **paid assets or none**. Deciding after C3 wastes the phase | Owner (budget) |
| O3 | Eight free services — is the instance-hour budget real? | Blocker **B11**, still open, with three services already built and never deployed | Operator |
| O4 | Abyssal creatures: procedural, owner-downloaded, or stylised? | Decides whether `ocean-abyss-visitor` can be promised at all | Owner + engineering |
| O5 | Does synesthesia ship independently of Ocean? | It touches no backend and improves all families; it can fill any slot | Owner |

## What must not happen

Following the convention of [README.md](README.md) §What must not happen:

- Do not buy or vendor Tidewater / Water Pro. They target WebGPU and a three
  version this repo does not run.
- Do not use CyArk / Open Heritage assets. NonCommercial is outside this
  repository's licence policy.
- Do not render caustics or god rays below the depth at which sunlight exists.
  It is wrong and it costs GPU time to be wrong.
- Do not let Ocean ship without the `revision` column and the `world.changed`
  outbox row. Nothing fails; the worlds simply never reach the admin app.
- Do not reorder a rarity feature's `Species` slice. It reassigns the species
  of every world already generated.
- Do not carve raw questionnaire input into a publicly shared scene.
- Do not make audio-reactive modulation load-bearing for a scene's readability.
  Most visitors never grant the audio gesture.
- Do not add a field to `contracts.WorldSnapshot` without adding the matching
  line to the data boundary in
  [analytics-service-plan.md](analytics-service-plan.md).

## Sources

All retrieved 2026-08-14.

**Ocean science** — [Introduction to Oceanography §6.5 Light](https://rwu.pressbooks.pub/webboceanography/chapter/6-5-light/) ·
[NOAA Ocean Explorer, Light and Color in the Deep Sea](https://oceanexplorer.noaa.gov/wp-content/uploads/2025/04/light-and-color-fact-sheet.pdf) ·
[Geosciences LibreTexts §6.10](https://geo.libretexts.org/Bookshelves/Oceanography/Introduction_to_Physical_Oceanography_(Stewart)/06:_Temperature_Salinity_and_Density/6.10:_Light_in_the_Ocean_and_Absorption_of_Light)

**Reference products** — [The Sea We Breathe](http://www.theseawebreathe.com) ·
[World Ocean Explorer](https://worldoceanexplorer.org/deep-sea-aquarium.html) ·
[Convex Seascape Survey](https://www.awwwards.com/inspiration/underwater-convex-seascape-survey) ·
[neal.fun The Deep Sea](https://mymodernmet.com/the-deep-sea/) ·
[three.js ocean example](https://threejs.org/examples/webgl_shaders_ocean.html) ·
[Deep Abyss](https://discourse.threejs.org/t/deep-abyss-underwater-experience/92214) ·
[Tidewater](https://ilikekillnerds.com/2026/05/21/i-built-tidewater-threejs-ocean-kit/) ·
[Three.js Water Pro](https://docs.threejswaterpro.com/) ·
[Water caustics in real time](https://medium.com/@martinRenou/real-time-rendering-of-water-caustics-59cda1d74aa)

**Genshin Impact / Fontaine** — [Screen Rant developer interview](https://screenrant.com/genshin-impact-fontaine-interview/) ·
[Fontaine art analysis](https://rifttrek.com/genshin-impact-art-a-deep-dive-into-mihoyos-stunning-visual-design-in-2026/)

**Assets and audio** — [Animated Fish Bundle, Quaternius](https://poly.pizza/bundle/Animated-Fish-Bundle-ZkGbjS8m8g) ·
[Poly Pizza — Quaternius](https://poly.pizza/u/Quaternius) ·
[seaweed](https://poly.pizza/search/seaweed) · [coral](https://poly.pizza/search/coral) · [jellyfish](https://poly.pizza/search/jellyfish) ·
[NOAA PMEL Acoustics](https://www.pmel.noaa.gov/acoustics/multimedia.html) ·
[NPS humpback recordings](https://archive.org/details/HumpbackWhalesSongsSoundsVocalizations) ·
[NOAA Whale Song](https://archive.org/details/WhaleSong_928)

**City architecture** — [Kenney City Kit](https://kenney.nl/assets/city-kit-commercial) ·
[KayKit City Builder Bits](https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0) ·
[Synty POLYGON Ancient Egypt](https://syntystore.com/products/polygon-ancient-egypt) ·
[CyArk / Google Open Heritage](https://artsandculture.google.com/project/cyark) ·
[CS-Studio Chinese Building Set](https://cs-studio.itch.io/cs-building-set1/purchase)

**Frontend mechanism** — [troika-three-text README](https://github.com/protectwise/troika/blob/main/packages/troika-three-text/README.md)

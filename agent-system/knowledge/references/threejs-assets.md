# Three.js and 3D asset references

> **Document status:** Reference catalog
> **Last link review:** 2026-09-01

This catalog collects places to find models, environments and textures suitable
for Three.js/React Three Fiber. In this project, "Three.js compatible" normally
means a self-hosted `.glb` or glTF 2.0 asset that has been inspected, optimized
and tested in the real scene. A marketplace label alone is not enough.

## How to read the confidence markers

The 2026-07-24 update added rows from a deep-research pass. Each non-obvious
factual claim is tagged so a reader knows how much to trust it before acting:

| Marker | Meaning |
| --- | --- |
| **[verified]** | Confirmed by 3-vote adversarial verification and/or a direct read of the source's own page/API on 2026-07-24 (some also confirmed with a live unauthenticated HTTP fetch). |
| **[primary]** | Read directly from the source's own documentation, but the adversarial verification pass did not complete. Treat as reliable but re-check on the day of use. |
| **[search-only]** | Surfaced by search and not yet re-verified. Confirm the license and download mechanics yourself before admitting the asset. |

Two axes are annotated on every source because they are the project's real
constraints:

- **Downloadability** — *agent-downloadable* (a script/CI can pull the file from
  a direct URL or a public API with no human login) vs *owner-manual* (a signed-in
  human must download the file and place it in the repo).
- **Fidelity** — *realistic/PBR*, *scan* (photogrammetry, needs heavy decimation),
  or *stylized/low-poly*.

## The one thing to internalise first

With this project's three hard constraints — **CC0 + self-hosted + agent-downloadable**
— you can only get **two of three** for realistic *meshes*. Concretely:

- Realistic **PBR materials + HDRI environment maps** are abundant, CC0, and
  agent-downloadable (Poly Haven, ambientCG). This is where most of a scene's
  perceived realism comes from — see
  [../fe/3d-development-limitations.md](../frontend/3d-development-limitations.md).
- Realistic **model meshes** that are CC0 are scarce, and mostly arrive as
  **photoscans** (Poly Haven, Smithsonian) that must be decimated hard, or as
  **Sketchfab CC-BY** assets that require an **owner manual download**.

Practical rule: **hero/landmark = a realistic scan (Poly Haven / Smithsonian /
NASA), decimated, or a Sketchfab CC-BY asset the owner downloads by hand;
background/high-count = instanced low-poly whose realism is carried by PBR
materials + HDRI.** This is the "layout first, model second" strategy already
written into [../vision/city-service-plan.md](../../plans/services/city-service-plan.md).

## Preferred download sources (general)

Use these in order unless a scene has a specific art-direction requirement.

| Priority | Source | Typical use | License | Download | Note |
| --- | --- | --- | --- | --- | --- |
| 1 | [Quaternius](https://quaternius.com/) · [FAQ](https://quaternius.com/faq.html) | Coherent low-poly nature, animals, city, space kits | CC0 (catalog-wide) **[verified]** for the Animated Animal Pack | agent (via Poly Pizza) / owner (site ZIP) | Best first stop for a consistent stylized scene; not realistic |
| 1 | [Kenney 3D](https://kenney.nl/assets/category:3D) · [support/FAQ](https://kenney.nl/support) | Modular game/city kits, prototypes | CC0 **[verified]** (City Kit page) | agent (direct ZIP) **[verified]** | Lightweight, consistent, low-poly |
| 1 | [Poly Haven](https://polyhaven.com/) · [API ToS](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md) | Realistic HDRI, PBR textures, some scanned models | CC0 (catalog-wide) **[verified]** | agent (**public API, no key** — only a Referer/user-agent header) **[verified]** | The main CC0 *realistic* source. Current forest HDRIs come from here |
| 1 | [ambientCG](https://ambientcg.com/) · [API docs](https://docs.ambientcg.com/api/v2/full_json/) | PBR materials, HDRIs, terrain, some scanned models | CC0 (catalog-wide) **[verified]** | agent (**`/full_json` API, no login**) | Nine asset types (3DModel, Atlas, Brush, Decal, HDRI, Material, PlainTexture, Substance, Terrain) **[verified]** |
| 2 | [Poly Pizza](https://poly.pizza/) · [API v1.1](https://poly.pizza/docs/api/v1.1) | Searchable low-poly glTF/GLB models | **Per-asset mixed** CC0/CC-BY **[verified]** | agent (files public, **API needs a one-time owner key**) **[verified]** | Current nature pipeline uses it. `License` search filter: `1`=CC0, `0`=CC-BY **[verified]** |
| 2 | [pmndrs/assets](https://github.com/pmndrs/assets) | Small web-ready GLBs, HDRIs, textures for R3F | CC0 (repo) | agent (GitHub) | Already optimized; still self-host intentionally |
| 2 | [ToxSam/open-source-3D-assets](https://github.com/ToxSam/open-source-3D-assets) | 991+ GLB registry with JSON index | **Per-asset** CC0/CC-BY **[verified]** | agent (JSON DB + direct links) **[verified]** | Good for bulk browsing; check each asset's license field |
| 2 | [Smithsonian Open Access](https://www.si.edu/OpenAccess) — see space section for the agent-friendly mirror | Scanned cultural/natural-history/space objects | CC0 (marked items) | see space section | High-detail scans; decimate/resize aggressively |

CC0 is preferred. CC-BY is acceptable only when `ATTRIBUTION.md` records the
asset title, creator, source URL, exact license and any required license link.

## Family 1 — Forest / Nature

| Rank | Source | License | Download | Fidelity | Note |
| --- | --- | --- | --- | --- | --- |
| 1 | [Quaternius Ultimate Animated Animal Pack](https://quaternius.com/packs/ultimateanimatedanimals.html) · [on Poly Pizza](https://poly.pizza/bundle/Animated-Animal-Pack-ILAPXeUYiS) | CC0 **[verified]** | agent (Poly Pizza) | Stylized low-poly | **12 animals, 12+ real skeletal clips each** (Walk/Gallop/Jump/Attack/Death) **[verified]**. Solves the hardest need — animated wildlife — but is stylized, not PBR |
| 2 | [Poly Haven — models](https://polyhaven.com/models) | CC0 **[verified]** | agent (public API, no key) **[verified]** | Realistic / scan | The only sizeable CC0 realistic source. Sparse on trees; photoscans → decimate hard |
| 3 | [ambientCG — 3DModel + Terrain + Material](https://ambientcg.com/) | CC0 **[verified]** | agent (API) | Realistic / scan | Strong for rocks / ground / materials rather than trees |

**Realistic CC0 vegetation is the known gap.** There is no strong
"agent-downloadable realistic tree pack" under CC0. Options: carry the realism
with PBR bark/leaf **materials** + HDRI on instanced silhouettes, or accept
**Sketchfab CC-BY trees downloaded by the owner** for a few hero trees — exactly
the pipeline already documented in
[../fe/forest-render-mechanism.md](../frontend/forest-render-mechanism.md).

## Family 2 — Universe / Space

| Rank | Source | License | Download | Note |
| --- | --- | --- | --- | --- |
| 1 | [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources) · [nasa.gov](https://www.nasa.gov/3d-resources/) | "Free and without copyright", NASA usage guidelines (**no NASA logo/insignia**) **[verified: license]** | agent (raw GitHub; some `.glb`/`.usdz` ready) | The source already in use. Mixed per-file formats; normalize scale |
| 2 | [NASA Bennu asteroid](https://science.nasa.gov/resource/bennu-3d-model) | Public domain **[primary]** | agent (glTF ~840 KB, no login) | Realistic, light asteroid — fits the belt/comet scenery |
| 3 | [Smithsonian Open Access — Harvard LIL mirror](https://source.coop/harvard-lil/smithsonian-open-access) | Public domain / CC0 **[verified]** | agent (**S3 direct, no login** — `aws s3 cp` / Rclone; serves GLB/glTF/OBJ + USDZ) **[verified]** | **Notable find:** get CC0 Smithsonian space models (Apollo 11 Command Module, Space Shuttle Discovery…) **without a Sketchfab login**. Scans → decimate |
| — | [Smithsonian on Sketchfab](https://sketchfab.com/Smithsonian) | CC0 (~172 models) | **owner-manual (login required)** **[verified]** | Prefer the Harvard mirror above for automation |

## Family 3 — City (prep for Sprint 3)

| Rank | Source | License | Download | Fidelity | Note |
| --- | --- | --- | --- | --- | --- |
| 1 | [Kenney City Kit](https://kenney.nl/assets/city-kit-commercial) (Commercial/Suburban/Industrial/Roads) | CC0 **[verified]** | agent (direct ZIP, no login) **[verified]** | Stylized low-poly modular | Most reliable CC0 city source to lock **layout grammar + contract** first (phases C0–C1). Not final high-fidelity |
| 2 | [KayKit City Builder Bits](https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0) | CC0 1.0, no attribution **[verified]** | agent (public GitHub) **[verified]** | Stylized (cleaner than Kenney) | glTF + OBJ + FBX, modular |
| 3 | [Map3D (OSM → GLB)](https://www.provixx.com/2026/06/map3d-turn-any-city-into-downloadable.html) | Open-source tool **[search-only]** | agent (exports GLB) | Blocky footprints | Good for **real-location base blocks/roads**; drape PBR materials + hero landmarks on top |

High-fidelity city is still **hero landmark (scan/bespoke) + instanced low-poly
background wearing PBR materials**. No "realistic CC0 city pack, agent-downloadable"
exists.

## Cross-cutting — CC0 HDRI + PBR materials (the backbone of "realistic")

| Source | License | Download | Content |
| --- | --- | --- | --- |
| [Poly Haven Public API](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md) | CC0 **[verified]** | agent (**no API key**, just a Referer/user-agent header) **[verified]** | HDRI + PBR textures + models. Already the forest HDRI source. Downloaded CC0 files need no credit; using the *live* API to surface content requires visibly crediting Poly Haven |
| [ambientCG v2 API](https://docs.ambientcg.com/api/v2/full_json/) | CC0 catalog-wide **[verified]** | agent (`/full_json`, no login) | Materials / HDRI / Terrain / 3DModel — fills gaps Poly Haven misses |

## Optimization pipeline note

[glTF-Transform CLI](https://gltf-transform.dev/) (MIT, current 4.4.1): **Meshopt
preserves morph targets and skeletal animation; Draco does not optimize for
animation** **[primary]**. Therefore compress **animated wildlife with Meshopt**
(universe already uses Meshopt) and keep Draco for static, vertex-heavy forest
geometry — consistent with the Draco-decoder-self-hosting debt noted in
[../fe/forest-render-mechanism.md](../frontend/forest-render-mechanism.md).

## Conditional source: Sketchfab

- Browse [Sketchfab](https://sketchfab.com/) for visual quality and models that
  explicitly allow download.
- Check the exact model license and [Sketchfab license terms](https://sketchfab.com/licenses).
- **Downloading requires an `Authorization` header** — the [Download API](https://sketchfab.com/developers/download-api)
  takes an OAuth2 Bearer token *or* a static account API token. A public model
  page or an `isDownloadable` flag does NOT enable anonymous download.
  **[verified]**
- **CORRECTED 2026-09-01: Sketchfab IS agent-downloadable for this project.**
  This section previously read "agents/CI cannot pull Sketchfab files; the owner
  downloads them logged-in", drawn from an HTTP 401 seen with no credential at
  all. That conclusion did not follow from the evidence, and its own bullet
  above already said a static account API token is accepted. The owner has since
  provisioned exactly such a token in
  `apps/myunivokai-web/.env.local.secret` (gitignored, offline tooling only, no
  `NEXT_PUBLIC_` prefix), and both endpoints were exercised with it:
  `GET /v3/search?type=models&downloadable=true&license=cc0` returns results, and
  `GET /v3/models/{uid}/download` returns **HTTP 200** with signed `glb`, `gltf`,
  `usdz` and `source` URLs valid for 300 seconds. No browser, no OAuth round
  trip, no human in the loop. **[verified 2026-09-01]**
- What that does NOT change: the licence rule (CC0 or CC-BY only, attribution
  recorded where CC-BY), the no-whole-scene-mesh rule, and the size problem.
  Sketchfab's realistic assets are photoscans — the one CC0 shipwreck in the
  whole catalogue ships a **14.5 MB GLB at 250 k triangles**, against 8.9 MB for
  all fifteen of the ocean family's existing models put together. Reachable is
  not the same as usable; see
  [../../evolution/ocean-seabed-props-research.md](../../evolution/ocean-seabed-props-research.md).
- Never commit an OAuth/API token. Never redistribute a raw asset when its
  license forbids stand-alone redistribution.

These Sketchfab pages were previously selected as visual-quality references;
they are not approved production assets:

- Trees: [Quasarus tree collection](https://sketchfab.com/quasarus/collections/trees-54bacbe6470547ca85c8c09c30f43b5f)
- Forest scenes: [Lava Forest](https://sketchfab.com/3d-models/lava-forest-world-of-flame-florals-2c991c7e151143da8a6a4ec3a4b03bf8), [Pixel Forest Environment](https://sketchfab.com/3d-models/pixel-forest-environment-ac8b262a12bc4adf88ee40a0d2c939f2), [Dirt Road Through Forest](https://sketchfab.com/3d-models/update-dirt-road-through-forest-c4676cdf7715484382400ff63faffd45), [Forest in the Mountains](https://sketchfab.com/3d-models/the-landscape-is-a-forest-in-the-mountains-27b7e06431f244ef84e28bada7560c98)
- Birds and wildlife: [Phoenix](https://sketchfab.com/3d-models/phoenix-bird-844ba0cf144a413ea92c779f18912042), [Spix's Macaw](https://sketchfab.com/3d-models/spixs-macaw-ararinha-azul-3858b6f1d48a48108142d97f9b67bd9d), [Fire Bird](https://sketchfab.com/3d-models/fire-bird-8fbb5c7672b947e68f649141e93a0adf), [Realistic Animals Pack](https://sketchfab.com/3d-models/realistic-animals-pack-d982cb29aa1b402ab9a50d3372683076)

## Avoid / caveats

- **Sketchfab for automation** — usable with the account token now provisioned
  (see the Sketchfab section above, corrected 2026-09-01), but its realistic
  catalogue is photoscans that need aggressive decimation before they fit the
  web budget. The constraint is size and licence, not access.
- **3d.si.edu (Smithsonian direct site)** — did not extract reliably for an
  agent; use the [Harvard LIL mirror](https://source.coop/harvard-lil/smithsonian-open-access) instead.
- **Khronos glTF-Sample-Assets** — per-asset **mixed** licenses including
  restrictive ones (Sponza = CryEngine agreement, Duck = SCEA, BrainStem =
  Poser EULA) **[verified]**. Use for loader/material testing only, and check
  each file's license.
- **Any "realistic" scan** (Poly Haven / Smithsonian / ambientCG photoscans) —
  must be decimated and texture-resized aggressively before it fits the web
  budget.

## Test and reference models

| Source | Correct use |
| --- | --- |
| [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/Models.md) | Test GLTFLoader, materials, animations, extensions. Per-asset license — **do not assume one license for the collection**. **[verified]** |
| [three.js GLTFLoader example](https://threejs.org/examples/webgl_loader_gltf) | Confirm how an asset behaves in the official Three.js renderer. Technical reference, not a production catalog |

## Inspection and optimization tools

| Tool | Purpose |
| --- | --- |
| [glTF Report](https://gltf.report/) | Drag-and-drop inspection of hierarchy, meshes, materials, animations and extensions |
| [glTF Transform CLI](https://gltf-transform.dev/cli) | Inspect, validate, prune, resize and compress GLB/glTF (Draco, Meshopt, KTX2, WebP) |
| [Three.js GLTFLoader docs](https://threejs.org/docs/pages/GLTFLoader.html) | Supported glTF extensions and loader integration |
| [Three.js DRACOLoader docs](https://threejs.org/docs/pages/DRACOLoader.html) | Draco decoder configuration and trade-offs |
| [Three.js loading guide](https://threejs.org/manual/en/loading-3d-models.html) | Official loading and troubleshooting workflow |

## Admission checklist for this repository

Before an external asset becomes production data:

1. Record the original page, creator, exact asset-level license and download
   date. Save a local license file when supplied.
2. Reject unclear licenses, editorial-only assets, non-commercial restrictions
   and recognizable third-party brands unless explicitly approved.
3. Prefer GLB. Convert other source formats offline; never load a marketplace
   URL at runtime.
4. Inspect hierarchy, dimensions, origin, animation clips, material maps,
   extensions, polygon count, draw calls and texture memory.
5. Optimize with the repository's documented glTF Transform pipeline, then
   re-check appearance and animation. Preserve the `.glb` extension and verify
   the binary header. Use Meshopt for animated assets, Draco for static
   vertex-heavy geometry.
6. Store the asset under the owning app's `public/assets/` tree and add it to a
   typed catalog rather than hardcoding a URL in a component.
7. Update the owning asset `ATTRIBUTION.md`, including CC0 assets for provenance
   even when attribution is optional.
8. Test desktop and mobile performance in the actual scene. A model that loads
   successfully is not automatically within the scene budget.

The forest-specific implementation rules remain in
[forest-render-mechanism.md](../frontend/forest-render-mechanism.md). The renderer and
scene-selection contract remains in
[threejs-scene-architecture.md](../frontend/threejs-scene-architecture.md).

External pages can change or disappear. Re-check availability, the asset-level
license and download terms on the day an asset is selected.

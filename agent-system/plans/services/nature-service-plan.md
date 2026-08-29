# Nature family — `nature-service` plan (v2, peer service)

> **Platform amendment — 2026-07-22:** This remains a historical record of the
> shipped HTTP peer. Sprint 1 preserves its deterministic builder and product
> lifecycle but replaces its local AI/DNA orchestration and HTTP business API
> with canonical DNA plus NATS commands/queries. The approved target is
> [Vision V1 solution architecture](../architecture/v1-2026-07-22/solution-architecture.md).

> **Document status:** Historical decision log — implementation details below contain superseded round-state
> **Last source review:** 2026-07-22
> **Current source:** [../be/source-overview.md](../../knowledge/backend/source-overview.md) and [../fe/forest-render-mechanism.md](../../knowledge/frontend/forest-render-mechanism.md)

Part of the [vision folder](../architecture/README.md). Written 2026-07-16 against commit
`392f785` (staging = main, schema 1.2 live in production). **v2 supersedes the
v1 "stateless composer" draft** after the owner clarified the architecture.
Gateway amendment (2026-07-17): `services/api-gateway` now fronts both peer
services; statements quoting "no gateway yet" below record the earlier N-round
scope and are superseded by round G.

> "Chỉ cần giữ nature-service. Hiện tại cứ random như universe service — cơ chế
> giống nhau, chỉ khác DNA thôi. Chưa có API gateway và FE đâu, cứ build
> services thôi."

Status: **BE rounds shipped, awaiting deploy**. N1 merged (PR #63, commit
`22aca0b`); vision docs merged (PR #62); N2 (own database + Render deploy
files) and the contract/golden-fixture part of N3 merged through PR #64.
Swagger and local Docker parity were completed together on
`feat/be/nature-service-dev-parity`. This document is the working context for
every future session on this track — it is deliberately self-contained.

---

## Tóm tắt cho owner (VI)

- **Kiến trúc:** `services/nature-service` là một service Go **ngang hàng và
  độc lập** với `services/universe-service` — **cùng một cơ chế**: input người
  dùng → AI sinh DNA (mặc định mock, như prod hiện tại) → builder deterministic
  theo seed → scene config → lưu → variants/share. **Chỉ khác lớp DNA**:
  planets trở thành **landmarks** trong rừng. Các N-round không sửa
  `universe-service`; round G sau đó chỉ chuyển edge middleware và thêm shared
  gateway credential, không đổi model, migration hay business flow.
- **Gateway và FE đều đã có.** Gateway route theo prefix
  (`/api/universe/*`, `/api/nature/*`); frontend chỉ nhận một gateway origin,
  đã có picker Universe/Forest, preview Forest, gallery family-aware và route
  share Nature. Các câu “future FE picker” ở phần lịch sử bên dưới là trạng
  thái của round cũ, không còn là current state.
- **Sản phẩm:** rừng cây là "chân dung tính cách" thứ hai — gió thổi cây đung
  đưa, **4 mùa + giao mùa**, thời tiết **mưa/nắng**, **thú đi lại, chim bay**,
  **thu lá rụng, đông tuyết**. Mỗi DNA landmark là một điểm click-to-focus
  (cây thiêng, hồ nước, tảng đá, bụi hoa, thân cây đổ, đèn thờ).
- **Độ đẹp ưu tiên #1:** model GLB CC0 trên mạng (Quaternius/Kenney/Poly
  Haven), tự host, nén Draco; HDRI lighting, golden-hour bias, grade màu theo
  mùa.
- **Database (quyết định 2026-07-17):** owner không có kinh phí cho nhiều
  Neon instance → dùng **chung Neon project hiện tại**, tạo thêm **một logical
  database** bên trong (`myunivokai_nature`) — **0 đồng**, 1 click trên
  dashboard. Cùng compute/storage quota nhưng connection string riêng, bảng
  riêng, goose version table riêng → một migration lỗi của nature **không thể**
  chạm vào data universe đang chạy prod. KHÔNG dùng chung bảng/schema với
  universe.
- **Thứ tự:** N1 pipeline trên memory store (**xong**, PR #63) → N2 DB riêng +
  goose + deploy files (**xong**, branch `feat/be/nature-service-be-rounds`) →
  N3 contract JSON + golden fixtures + Swagger (**xong**; Swagger và local
  Docker parity nằm trong `feat/be/nature-service-dev-parity`) → N4 AI thật
  (dời lại — owner: "cứ random như universe
  service") → N5 curate asset. FE (F1–F5) sau khi service đứng vững.

---

## 1. Owner decisions (log)

| Date | Decision |
| --- | --- |
| 2026-07-16 (1) | Microservices immediately; forest scenery is the second family; Go backend first; beauty-first CC0 assets; gateway stays far-future. |
| 2026-07-16 (2) | **Architecture correction:** `nature-service` (not `scene-nature-service`) is a **full peer** of universe-service — same mechanism end-to-end (AI DNA → seeded builder → store → share), only the DNA layer differs. NOT a stateless compose endpoint; universe-service is not modified at all. No gateway and no FE work yet. |
| 2026-07-17 (3) | **One branch for all BE work** (`feat/be/nature-service-be-rounds`), pushed before any FE work. **Database:** no budget for extra Neon instances → share the existing Neon project and create a second **logical database** (`myunivokai_nature`) inside it — zero cost, own connection string/tables/goose state, zero blast radius into the production universe data. Never share tables or a schema with universe-service. |
| 2026-07-17 (4) | **Gateway implemented without auth-service:** one public edge routes `/api/universe/*` and `/api/nature/*`; CORS/rate limit move to the gateway; public Render upstream business routes require a shared gateway credential. |
| 2026-07-17 (5) | **Primitive visuals rejected** ("Chất lượng thực sự rất tệ. Không chấp nhận được... sử dụng model trên mạng"): N5 pulled forward — every procedural primitive replaced with curated CC0/CC-BY GLBs (poly.pizza, Quaternius-first for style coherence), self-hosted + Draco-optimized. |
| 2026-07-18 (10) | **Polish round P6** (owner feedback on P5): (a) confirmed by test that **Sketchfab downloads are login-gated** (`/i/models/{uid}/download` and the v3 download API return HTTP 401 without an OAuth token, even for `isDownloadable: true` CC-BY models) — I cannot pull quasarus/phoenix myself; the owner downloads (logged in) and drops the `.glb` in, I wire it. (b) Fixed the "forest is a visible square slab when zoomed out": the ground was a finite square `PlaneGeometry`. Now the far terrain **rises into forested hills past the treeline** (height sampler distant-rise term), the ground plane is much larger (treeline ×1.6→×3.2), the mid-far band is tinted a **forest-canopy green** (rising hills read as tree-covered), and the outer rim **fades to the horizon/fog colour** so the square's edge and corners dissolve into the sky. FE-only, no schema change. |
| 2026-07-18 (9) | **Polish round P5** (owner feedback on P4): (a) schema **1.2** — more ground-animal slots (3→5) + individuals per slot (1-2→1-3) and higher per-season active counts, so several species share the clearing ("tăng số lượng động vật"); (b) lower + wider bird altitude band (min 12→5, range 6→17) so flocks land in distinct high/low tiers instead of all-too-high; (c) fixed birds flying backward (per-model `headingOffsetRadians`, both current birds needed π); (d) **rare "legendary" ground animal** ("động vật quý hiếm"): ~40% of worlds (seeded off world seed = DNA) host one luminous-coat animal — White Stag / Golden Fox / Spirit Wolf / Verdant Stag (recolor of an existing animated animal, plays its Walk clip, interactive POI energy 100), joining the existing special-bird crosser; (e) **WASD / arrow-key free-roam** panning added to the shared CameraRig for BOTH families (target+camera glide together, speed scales with zoom, gated off input focus + gallery backdrop; focus-on-select still overrides). schema 1.2 goldens regenerated; FE mirror synced. |
| 2026-07-18 (8) | **Polish round P4 — birds** (owner: fake flapping looked bad, birds were in a perched pose while flying, species not diverse; wants occasional special birds "tùy DNA"). Flock birds swapped to models with REAL skeletal flap clips: a rigged Hawk (Fly clip, Sherkiz CC-BY) + Quaternius Armabee (Fast_Flying clip, CC0, style-matched); the fake whole-body-roll flap is gone (wings now flap via `useAnimations`), staggered per bird. Birds are bbox-centered so they don't pivot around an off-body point. **Special rare crosser** ("thi thoảng có 1 con bay qua"): ~35% of worlds (seeded roll off the world seed = DNA) get one distinctive bird — Firebird / Azure Macaw / Golden Raptor (the animated hawk scaled up with a vivid emissive plumage) — arcing high across the sky on a long loop with a long empty-sky gap between passes. FE-only + seed-derived, no schema/golden change. Owner's bird references (Sketchfab, login-gated for download — poly.pizza remains the pipeline; the special-bird tints are the CC0 stand-in): [phoenix](https://sketchfab.com/3d-models/phoenix-bird-844ba0cf144a413ea92c779f18912042), [spix macaw](https://sketchfab.com/3d-models/spixs-macaw-ararinha-azul-3858b6f1d48a48108142d97f9b67bd9d), [fire bird](https://sketchfab.com/3d-models/fire-bird-8fbb5c7672b947e68f649141e93a0adf), [realistic animals pack](https://sketchfab.com/3d-models/realistic-animals-pack-d982cb29aa1b402ab9a50d3372683076). If the owner downloads any of these `.glb` and drops them in `public/assets/nature/models/`, wire them into BIRD_MODEL_DEFINITIONS / SPECIAL_BIRD_DEFINITIONS in `forest/forestModels.ts`. |
| 2026-07-18 (7) | **Polish round P3** (owner feedback on P2 screenshots): (a) create-page selection chips restyled — selected = filled/bold, unselected = ghost outline (the fill/text were inverted so selected read as disabled); (b) god-ray shafts use a soft gradient texture instead of hard rectangles; (c) foliage material forced `flatShading` + per-tree brightness jitter so canopies read as leaf clusters not smooth blobs; (d) birds swapped to flying-pose GLBs (Poly by Google, 2 silhouettes × 3 plumage tints) with a flap-bob wingbeat illusion — the perched glider is gone; (e) more/faster drifting clouds + seeded sheet-lightning double-flashes during heavy rain. **Tree quality reference the owner wants matched:** [quasarus "Trees" collection on Sketchfab](https://sketchfab.com/quasarus/collections/trees-54bacbe6470547ca85c8c09c30f43b5f) (aspiration bar; Sketchfab still needs login to pull — poly.pizza remains the download pipeline). |
| 2026-07-18 (6) | **Beauty/polish round P1** ("đẹp hơn nữa, đa dạng động vật hơn, gió tuyết mưa, ánh sáng môi trường, tương tác được với nhiều vật thể hơn"): schema **1.1** widens animal pools (stag/bear/squirrel); HDRI image-based lighting (Poly Haven, self-hosted per `hdriKey`); rain becomes wind-carried streaks, snow drifts with the wind, grass ripples in gust waves; animals join the clickable POI layer (hover tooltip + camera follows the wanderer). Owner's visual reference bar — Sketchfab scenes to aspire to (NOT downloadable sources; Sketchfab downloads need login/API token, poly.pizza remains the pipeline): [lava forest](https://sketchfab.com/3d-models/lava-forest-world-of-flame-florals-2c991c7e151143da8a6a4ec3a4b03bf8), [pixel forest environment](https://sketchfab.com/3d-models/pixel-forest-environment-ac8b262a12bc4adf88ee40a0d2c939f2), [dirt road through forest](https://sketchfab.com/3d-models/update-dirt-road-through-forest-c4676cdf7715484382400ff63faffd45), [forest in the mountains](https://sketchfab.com/3d-models/the-landscape-is-a-forest-in-the-mountains-27b7e06431f244ef84e28bada7560c98). Form UX: mood cards get forest labels (Frostwood/Blossom/Summer Meadow/Amber Autumn — same 4 backend values), World Style hidden for nature. |

Consequences vs. the old D1–D5 decision set:

- **D1 (`scene_type` on world_variants)** — moot for now: each service owns its
  own worlds; nothing dispatches by scene type. Revisit only when a gateway or
  a cross-service "portrait series" feature becomes real.
- **D2 (Go)** — unchanged, confirmed ("Backend bằng Golang").
- **D3 (gateway)** — triggered by the second public service and implemented in
  round G; no auth-service was required.
- **D4 (one nature service for forest/mountain/lake)** — unchanged: the service
  is named `nature-service`; forest is its first scene family
  (`sceneType: "forest"`), mountains/lakes join later inside it.
- **D5 (embedded/remote flag)** — obsolete: there is no remote compose call to
  fall back from. "Rollback" = don't deploy / turn off the nature service;
  universe is untouched either way.

## 2. Where the code stands today (anchors for a fresh session)

| Piece | Where | Relevance |
| --- | --- | --- |
| The mechanism cloned | `services/universe-service` | chi router; request-id/logging/recovery; `WorldService` (create/get/batch/regenerate/select/publish/share); AI `Orchestrator` (primary→repair→fallback, mock default); `Store` interface with memory + postgres implementations; goose migrations; zerolog. CORS and rate limiting moved to api-gateway in round G. |
| Deterministic builder pattern | `internal/services/world_config_builder.go` + `mood/sky/diversity_scene_profile.go` | Dedicated PRNG stream per section, fixed draw order, named-constant bounds, `round()` 2dp, mirror-pair discipline. The forest builder follows exactly this. |
| Seeded PRNG | `internal/seed/prng.go` (FNV-64a → `math/rand`) | Copied byte-identical into nature-service. |
| Mock AI mechanism | `internal/ai/providers/mock.go` + `mock_presets.go` | Parses the user prompt back into a profile, picks a preset group by mood, personalizes planet names from interests/traits. Nature clones this with forest presets and landmark names. |
| Prod config | `render.yaml`, `Dockerfile.render`, `docker-entrypoint-render.sh` | Universe deploys with `AI_PROVIDER=mock` in production today ("cứ random như universe service"). Nature reuses the same deploy shape in round N2. |
| CI | `.github/workflows/ci.yml` | Gets a third job `nature-service-checks` (go vet + test). |

## 3. The product idea — a forest as a personality portrait

The visitor lands in a clearing. Trees sway in the wind. Depending on the
person: cherry blossoms drift in a spring shower, fireflies blink in a summer
dusk, red-gold maples shed leaves into an autumn mist, or snow settles
silently on pines. A deer crosses the path; a flock of birds arcs over the
treeline. Around the clearing stand **landmarks — one per DNA landmark**: the
heart-tree, a standing stone, a still pond, a flower patch, a fallen mossy
log, a small lantern shrine. Click one and the camera glides to it and reads
its meaning — the same POI interaction the universe has, in a new medium.

### Semantic mapping (input → NatureDNA → forest), all seed-deterministic

| Input | Drives | How |
| --- | --- | --- |
| `mood` | **Season bias** + wind + wildlife + bloom | focused → winter-leaning (crisp, still); dreamy → spring-leaning (blossom, soft); energetic → summer-leaning (lush, breezy, most wildlife); reflective → autumn-leaning (golden, misty). Weighted PRNG draw (~55/15/15/15), never a hard mapping. |
| Seed roll | **Giao mùa** | ~20% of variants blend toward an adjacent season (e.g. autumn → winter at 0.4: last leaves + first snow). |
| `favoriteColors` | Palette accents | Primary/secondary flow into `palette` exactly like universe. |
| `interests` / `traits` | **Landmark names** | The mock provider (and later the real AI prompt) names landmarks from the user's own interests/traits — same rule as universe planets. |
| NatureDNA `landmarks[]` | POI layer | Kind per landmark from a deterministic table (first is always the heart-tree); placement on the clearing ring from the `-forest-landmarks` stream. |
| Variant regenerate | New seed → possibly new season/weather | "Time and seasons as variant dimensions", for free, no AI call. |

## 4. Architecture — two peer services

```txt
       (current FE picker: Universe / Forest)
        │                                      │
        ▼                                      ▼
 universe-service                        nature-service
 ─ REST /api/v1/*                        ─ REST /api/v1/*  (same route shapes)
 ─ AI DNA: PersonalityDNA (planets)      ─ AI DNA: NatureDNA (landmarks)
 ─ builder → WorldSceneConfig             ─ builder → ForestSceneConfig
   (schemaVersion 1.2, solar system)       (schemaVersion 1.2, sceneType "forest")
 ─ Neon DB (worlds, variants, share)     ─ own Neon logical database
 ─ peer behind gateway                  ─ peer behind gateway

 (Implemented round G: api-gateway path-prefix routing — /api/universe/* and
  /api/nature/* — see api-gateway.md)
```

Rules:

- **universe-service is never modified** by this track. Zero migrations, zero
  new fields, zero shared code changes. Prod safety by construction.
- **Same mechanism, cloned**: router/middleware/error envelope/orchestrator/
  store interface are cloned into nature-service (small, boring, proven code).
  Shared-library extraction is deliberately NOT done now — two copies are
  cheaper than a premature `libs/` module; revisit at a third service.
- **Same route shapes** (`/api/v1/worlds`, `/variants`, `/publish`,
  `/share/worlds/{slug}`, `/healthz`, `/readyz`) so the gateway is pure
  path-prefix routing and the FE client code can be reused per service.
- **AI stays mock by default** (`AI_PROVIDER=mock`), matching universe prod
  today. Real providers (Gemini/OpenAI) are a later round (N4) — the port is
  mechanical because the orchestrator/provider interfaces are identical.
- **Storage isolation**: nature-service gets its **own Neon database** (same
  Neon project, separate database → separate connection string, own
  `goose_db_version`), with the same table shapes (worlds, world_variants,
  ai_generations). No cross-service DB access, ever.

## 5. NatureDNA — same shape, forest semantics

`PersonalityDNA` → `NatureDNA`: identical envelope (schemaVersion, archetype,
sceneName, quote, shortNarrative, traitScores, energySignature, visualHints),
with **`planets[]` → `landmarks[]`** (`DNALandmark`: key, name, type, meaning,
energy; 3–7 items; named from interests/traits). Prompt version:
`forest-dna-v1`. The mock preset library is forest-flavored (Grove Keeper,
Dawn Wanderer, … per mood group), same selection mechanics as universe's
`mock_presets.go`.

## 6. `ForestSceneConfig` evolution — historical v1 baseline

The field list below records the original 1.0 design. Source now emits schema
1.2; the current executable description is
`contracts/scenes/forest-scene-config.schema.json` plus the four golden
fixtures under `services/nature-service/internal/services/testdata/`.

Envelope: `schemaVersion: "1.0"`, `sceneType: "forest"`, sceneName, archetype,
quote, theme, palette, camera, postFX (bloom + per-season `grade`), hud.
Renderers are keyed by `(sceneType, schemaVersion)`.

**Size discipline:** stored config stays ~3–4 KB. Only semantic and hero
placements are stored (landmarks). Mass scatter — hundreds of trees, grass,
leaf particles, bird paths — is computed **frontend-side from seeds embedded
in the config** (exactly like `MilkyWayConfig.Seed` today). BE decides *what
and how much*; FE derives *where* deterministically.

Sections (all bounds are named constants in `forest_scene_profile.go`):

| Section | Fields (summary) |
| --- | --- |
| `season` | kind (spring/summer/autumn/winter), optional blendTowardKind + blendAmount (giao mùa), foliageColors[3], groundKind (grass/leafLitter/snow/moss) |
| `lighting` | timeOfDay (day/goldenHour/dusk), sunElevationRadians, sunAzimuthRadians, sunColor, ambientColor, hdriKey, exposure, fogColor, fogDensity |
| `terrain` | placementSeed, clearingRadius, treelineRadius, hillAmplitude, hillFrequency, pathEnabled, rockCount, grassTuftCountDesktop/Mobile |
| `trees` | placementSeed, countDesktop/Mobile, speciesMix[{modelKey,weight}], scaleMin/Max, foliageTintStrength, windStrength, windDirectionRadians, windGustFrequency |
| `weather` | kind (clear/sunRays/overcast/rain/snow — season-constrained), intensity, cloudCoverage, rainDropCountDesktop/Mobile, snowflakeCountDesktop/Mobile |
| `wildlife` | groundAnimals[{modelKey,count,pathSeed,walkSpeed,scale}] (≤3), birdFlocks[{modelKey,birdCount,pathSeed,altitudeMin/Max,flightSpeed,pattern}] (≤2) |
| `ambientParticles` | fallingLeafCount (autumn), blossomPetalCount (spring), fireflyCount (summer dusk), snowDustCount (winter) |
| `landmarks[]` | one per DNA landmark: key,name,meaning,kind,angleRadians,radiusFromCenter,accentColor,energy — first kind is always heartTree |
| `assets` | catalogVersion, modelKeys[] (every GLB key the config references), hdriKey |

### PRNG streams — same discipline as universe schema 1.2

Every section draws from its own stream; **all draws always happen, in fixed
order, even when a gate zeroes the feature** — adding features later never
shifts existing draws. Labels are prefixed `-forest-` so future mountain/lake
families in the same service can never collide.

| Stream | Draws (fixed order) |
| --- | --- |
| `seed + "-forest-season"` | season roll (mood-weighted), transition roll, transition direction, blend amount, foliage palette pick |
| `seed + "-forest-lighting"` | timeOfDay roll, sun elevation, azimuth, exposure, fog roll, fog density, bloom |
| `seed + "-forest-terrain"` | clearing radius, hill amplitude, hill frequency, rock count, grass count, path roll, camera distance |
| `seed + "-forest-trees"` | count, species-mix pick, scale min, scale max, tint strength, wind strength, wind direction, gust frequency |
| `seed + "-forest-weather"` | kind roll (per-season weight table), intensity, cloud coverage (particle counts derive — no extra draws) |
| `seed + "-forest-wildlife"` | 3 fixed ground slots × (species, count, speed, scale) + 2 fixed flock slots × (bird count, altitude base, altitude span, speed, pattern); slots beyond the active count are drawn then discarded |
| `seed + "-forest-ambient"` | leaf count, petal count, firefly count, snow-dust count (each zeroed unless its season/time gate holds) |
| `seed + "-forest-landmarks"` | per landmark: kind roll, angle jitter, radius |

FE-side scatter streams (renderer, later — labels fixed now):
`{seed}-forest-tree-placement`, `-forest-grass`, `-forest-rocks`,
`-forest-animal-{index}`, `-forest-birds-{index}`, `-forest-leaves`,
`-forest-petals`, `-forest-fireflies`.

### Season tables (named constants)

| Season | Weather weights | Species mix | Wildlife | Ambient | Grade intent |
| --- | --- | --- | --- | --- | --- |
| spring | clear/sunRays/overcast/rain | birch, oak, pine, **blossom** | deer, rabbit, fox; most birds | blossom petals | fresh, slightly bright |
| summer | clear/sunRays/rain/overcast | oak, birch, pine (deep green tint) | deer, fox, boar, rabbit; birds | fireflies at dusk | warm, saturated |
| autumn | clear/sunRays/overcast/rain | oak, birch, dead (amber tints) | deer, fox, boar; fewer birds | **falling leaves**, mist bias | golden, +sat, +contrast |
| winter | clear/overcast/**snow** | pine, **pine-snow**, dead | deer, wolf, fox — sparse; rare birds | **snowfall** + snow dust | desaturated, cool, crisp |

Transition (`blendTowardKind`, `blendAmount` 0.2–0.6) keeps the dominant
season's weather/ground; the FE lerps tint/particle counts by the blend.

## 7. Beauty-first asset strategy (độ đẹp / độ sắc nét)

Unchanged from v1 of this plan — the quality ceiling is **assets + art
direction** (option B of
[3d-development-limitations.md](../../knowledge/frontend/3d-development-limitations.md)). The
**as-built** asset pipeline (real paths, the gltf-transform recipe actually
used, and the Sketchfab download constraint) is documented in
[../fe/forest-render-mechanism.md](../../knowledge/frontend/forest-render-mechanism.md); this table
is the original sourcing intent:

| Pack | License | Gives us |
| --- | --- | --- |
| Quaternius — Ultimate Nature / Stylized Nature MegaKit | CC0 | Trees (incl. snow-capped winter variants), rocks, stumps, grass, flowers |
| Quaternius — Ultimate Animated Animals | CC0 | Rigged deer, fox, wolf, rabbit… with idle/walk clips |
| Kenney — Nature Kit | CC0 | Prop fallback, path tiles |
| Poly Haven | CC0 | HDRIs (forest/meadow 1–2K), ground textures (grass, leaf litter, snow) |
| Birds (flapping, low-poly) | **TBD in N5** | Verify a CC0 animated bird; CC-BY fallback with attribution |

Rules: CC0 preferred, CC-BY with `ATTRIBUTION.md`; **never hotlink** — all
assets self-hosted. As built, they live under
`clients/web-client/public/assets/nature/` (`models/` + `hdri/`, with
`ATTRIBUTION.md`), optimized with `gltf-transform optimize --compress draco
--texture-size 256|512`. Budgets: GLB ≤ 500 KB, HDRI ≤ 2 MB, forest route lazy
payload ≤ 8 MB, forest JS chunk ≤ 300 KB gzip. The BE `assets` section only
emits keys from a versioned catalog table; a FE vitest later asserts every key
resolves to a real file (pattern: `planetTextureCatalog.test.ts`).

## 8. The Go service — `services/nature-service`

Module `github.com/myunivokai/myunivokai/services/nature-service`. A clone of
the universe-service layout, DNA layer renamed, no DB code until N2:

```txt
services/nature-service/
  cmd/api/main.go                     # memory store; refuses production start until the DB round
  internal/config/config.go           # env: PORT, APP_ENV, AI_*, DB_*, GATEWAY_SHARED_SECRET, SHARE_SLUG_LENGTH
  internal/httpx/                     # error envelope + request-id (same shapes as universe)
  internal/middleware/                # RequestID, Logging, Recover, GatewayAuthentication
  internal/models/                    # NatureDNA (landmarks), World/WorldInput/WorldVariant, ForestSceneConfig, responses
  internal/seed/                      # byte-identical PRNG copy + NAT-/VAR- seed generators
  internal/ai/                        # provider iface + Orchestrator (repair/fallback) — validator returns NatureDNA
  internal/ai/prompts/forest_dna_v1.go
  internal/ai/providers/mock.go|mock_presets.go   # forest preset library, landmarks named from interests/traits
  internal/aifactory/factory.go       # mock only; gemini/openai error "later round"
  internal/validation/world.go        # WorldInput rules (same), ValidateNatureDNA, NatureDNASchema
  internal/repositories/              # Store interface + MemoryStore (postgres lands in N2)
  internal/services/
    forest_scene_profile.go           # mood→season weights + every season/lighting/wildlife table + all bounds
    forest_config_builder.go          # the deterministic builder (streams above)
    world_service.go                  # create/get/batch/regenerate/select/publish/share — same flow as universe
  internal/handlers/                  # router, world_handler, share_handler, health_handler, landing (JSON)
  docs/                               # generated Swagger docs; UI is development-only
  Dockerfile                          # local image used by docker-compose-local.yaml
  docker-compose-local.yaml            # Postgres + migration + API on ports 5433/8081
  .dockerignore                       # keeps env files and build artifacts out of the context
  Dockerfile.render                   # Render image; entrypoint optionally runs migrations
  go.mod
```

Direct API (same shapes as universe; gateway exposes `/api/nature/*`):

```txt
POST /api/v1/worlds                          → 201 CreateWorldResponse (world, variant, natureDNA)
GET  /api/v1/worlds?ids=...                  → 200 WorldListResponse
GET  /api/v1/worlds/{worldId}                → 200 WorldResponse
POST /api/v1/worlds/{worldId}/variants       → 201 VariantResponse (no AI call — seed only)
POST /api/v1/worlds/{worldId}/variants/{variantId}/select → 200
POST /api/v1/worlds/{worldId}/publish        → 200 PublishResponse (share slug)
GET  /api/v1/share/worlds/{shareSlug}        → 200 PublicWorldResponse
GET  /api/v1/healthz | /api/v1/readyz        → liveness / store readiness
```

Error taxonomy identical: `VALIDATION_ERROR`, `NOT_FOUND`, `AI_UNAVAILABLE`
(503 + Retry-After), `AI_OUTPUT_INVALID` (502), `RATE_LIMITED` (429),
`INTERNAL_ERROR` — same envelope JSON, so FE error handling is reusable.

## 9. Determinism & mirror discipline

- Same three invariants: AI produces semantics only; every visual number from
  `seed.NewPRNG` within named-constant bounds; regenerate never calls AI.
- **Mirror pair (landed with the F-rounds):** `internal/services/forest_scene_profile.go`
  and `forest_config_builder.go` ↔ `clients/web-client/src/lib/forestScene.ts`
  (same tables, same per-section streams, same draw order; FE PRNG is the
  xorshift mirror, so previews are plausible, not byte-equal). Keep the two
  in sync on every tuning change — the scene.ts ↔ universe discipline.
- Golden fixtures (N3) become the executable compatibility contract; any byte
  diff ⇒ bump the forest schemaVersion and keep a reader for the old one.
- Known note from the 1.2 review: Go `math.Round` vs JS `Math.round` differ on
  negative halfway ties — the mirror is structural, documented non-issue.

## 10. Roadmap — rounds and gates

BE gates per round: `go vet ./... && go test ./... && go build ./...`.

| Round | Branch | Content | Done when |
| --- | --- | --- | --- |
| **N1** ✅ | `feat/be/nature-service-scaffold` (merged, PR #63, `22aca0b`) | The whole pipeline on the memory store: config/middleware/handlers + NatureDNA + mock provider + orchestrator + forest profile & builder + worlds/variants/share API + tests + CI job | Gates green; smoke-tested end-to-end locally |
| **N2** ✅ | `feat/be/nature-service-be-rounds` | Own **logical** Neon database (second database inside the existing Neon project — zero cost, owner decision 2026-07-17), goose migrations (worlds/world_variants/ai_generations, `nature_dna` column), `cmd/migrate`, postgres store, Dockerfile.render + entrypoint, render.yaml entry | Gates green. Create database `myunivokai_nature`; set its pooled/direct URLs and `PUBLIC_WEB_URL`; after round G the shared gateway secret is also required in production. |
| **N3** ✅ | `feat/be/nature-service-be-rounds` + `feat/be/nature-service-dev-parity` | `contracts/scenes/forest-scene-config.schema.json` + golden fixtures in testdata (the executable contract; regenerate deliberately with `UPDATE_GOLDEN=1`) + generated Swagger docs/UI outside production. The parity branch also adds the local Postgres → migration → API Docker stack. | Golden test green; a byte-diff for an existing seed fails CI; Swagger is hidden in production; local Docker smoke survives an API restart. |
| **N4** (deferred) | `feat/be/nature-real-ai` | Port Gemini/OpenAI REST providers + repair prompts (mechanical — interfaces identical), env keys. Deferred — owner: "cứ random như universe service" (universe prod also runs mock today) | Real DNA behind `AI_PROVIDER=gemini`; mock stays the fallback |
| **N5** ✅ | `feat/fe/nature-scene-fe-rounds` (pulled forward — owner 2026-07-17 rejected the primitive visuals: "Chất lượng thực sự rất tệ... Tham khảo các models trên sketchfab") | 33 curated CC0/CC-BY GLBs from poly.pizza/Quaternius-style sources, now about 6.7 MB, plus 3 self-hosted Poly Haven HDRIs about 3.9 MB. Catalog + runtime normalization + instancing/animation are implemented in `features/scene-renderers/forest/forestModels.ts`. | Rendering and licenses are present; automated catalog-file/license/budget validation remains a new backlog task |
| **F1–F5** ✅ | `feat/fe/nature-scene-fe-rounds` (combined into ONE round, owner order 2026-07-17: "Gom các F liên quan với nhau lại code 1 lần luôn") | FE, all in one: `sceneType`-first renderer registry + `WorldFamily` plumbing (family param on every API call, family stored with gallery ids, `/worlds/{id}?family=nature`, `/nature/share/worlds/{slug}`), procedural ForestRenderer (terrain+clearing+path, wind-swayed instanced trees, sky dome+sun, weather rain/snow/clouds/sun-rays, seasonal ambient particles, wandering animals + bird flocks, clickable landmark POIs feeding the shared HUD/camera), preview mirror `lib/forestScene.ts` (mirror pair of `forest_scene_profile.go`+`forest_config_builder.go`) + create-form Universe/Forest picker. Primitives-only visuals until N5 GLBs; deployment now gives FE one `NEXT_PUBLIC_GATEWAY_BASE_URL`, while nature-service still needs `PUBLIC_WEB_URL=<web-origin>/nature` so backend share URLs land on the nature share route | FE gates green: typecheck, lint, vitest (incl. forestScene determinism/contract tests), next build |
| **G** ✅ | `feat/be/api-gateway` | api-gateway per [api-gateway.md](../../memory/execution-records/api-gateway-historical.md): path-prefix routing to both services | Implemented without auth-service once the second public peer made one edge valuable |

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Cloned plumbing drifts from universe-service over time | Acceptable by design (services are independent); extract a shared lib only at a third service |
| Memory store reaches production | Same fail-fast guard as universe: refuse production start without a database (until N2) |
| Free-tier cold start on a second service | Accepted (owner): "try again" UX; universe unaffected |
| Animals/birds are the hardest FE work | v1 FE patterns deliberately simple: closed-loop paths, clip crossfade only |
| Bird model licensing unclear | Resolved in N5; CC-BY fallback with attribution |
| Two mock DNA libraries to keep interesting | Forest presets live in one file (`mock_presets.go` clone); add presets freely — they are content, not code |

## 12. Defaults chosen (flag to owner if wrong)

1. **Same API route shapes** as universe-service (`/api/v1/worlds`…) so the
   gateway is pure path-prefix routing and FE client code is reusable.
2. **Season is seed-random with mood bias** — no season picker in v1;
   regenerate rolls a new one ("cứ random như universe service").
3. **Own Neon database** (same Neon project) in N2 — no shared tables with
   universe-service, no cross-service reads.
4. **Mock AI only in N1** (matching universe prod today); real providers in N4.

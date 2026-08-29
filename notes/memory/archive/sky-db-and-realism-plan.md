# Sky-from-database + photoreal sky v2 + cursor + header link

> **Document status:** Archived historical implementation record
> **Last source review:** 2026-07-18

> **TL;DR (VN):** Mọi thông số vẽ Milky Way / chòm sao (số lượng sao, bảng màu,
> độ mờ mây, tốc độ xoay, seed, số chòm sao…) chuyển thành section `sky` trong
> `WorldSceneConfig` do **backend sinh deterministic và lưu vào Postgres**;
> frontend chỉ đọc và render (có default cho world cũ). Đồng thời nâng độ chân
> thực theo kỹ thuật của các demo three.js/Stellarium (PSF 2 thành phần,
> diffraction spikes, phân bố cấp sao, màu blackbody, Great Rift, mây fBm
> domain-warp). Kèm: custom cursor brass và nút API ở header.

Branch: `feat/fe-be/sky-from-database` (off staging sau khi PR #50 merge).
Status legend: `[ ]` todo · `[x]` done · `[~]` partial/deferred.

---

## 1. Sky config from database

### Why
Đến nay `MilkyWayBand.tsx` / `ConstellationField.tsx` hardcode toàn bộ hằng số
(5200/4200/1800/26 sao, bảng màu, opacity, tilt, seed cố định
`myunivokai-milky-way`). Yêu cầu: **tất cả phải load từ DB** — backend là nguồn
sự thật, mỗi world có bầu trời riêng, đổi world style/mood đổi cả trời.

### Where it lives (facts from codebase)
- BE model: `services/universe-service/internal/models/scene.go` → `WorldSceneConfig`.
- Builder: `internal/services/world_config_builder.go` — deterministic từ
  `BuildWorldConfigInput{DNA, Seed, VariantNo, Input}`, PRNG = FNV-64a(seed)
  → `math/rand` (`internal/seed/prng.go`). Floats đi qua `round()` (2 chữ số).
- Storage: `world_variants.config JSONB` → **không cần migration** cho field mới;
  world cũ thiếu `sky` → FE fallback defaults.
- Mirror contract: `clients/web-client/src/lib/types.ts` (types) và
  `src/lib/scene.ts` `buildPreviewSceneConfig` (live preview) phải mirror BE —
  cùng quy tắc như mood profile hiện tại (`mood_scene_profile.go` ↔ `MOOD_SCENE_PROFILES`).
- Contract shell: `contracts/schemas/world-scene-config.schema.json` — thêm `sky`
  vào `properties`, **không** thêm vào `required` (backward compat với row cũ).
- AI: KHÔNG thêm field AI mới (tránh tăng rủi ro 502 AI_OUTPUT_INVALID). Sky được
  suy deterministic từ Seed + Theme (DNA.VisualHints.Theme) + Mood. Phase sau có
  thể cho AI gợi ý "skyIntent" — ghi ở §6.

### New BE structs (`models/scene.go`)
```go
type SkyConfig struct {
    MilkyWay       MilkyWayConfig      `json:"milkyWay"`
    Constellations ConstellationConfig `json:"constellations"`
}
type WeightedColor struct { Color string; Weight float64 } // json: color, weight
type MilkyWayConfig struct {
    Seed string
    AllSkyStarCount, BandStarCount, CoreStarCount, HeroStarCount int
    NebulaCloudCount, CoreCloudCount, DustCloudCount int
    StarColors, CoreStarColors            []WeightedColor // blackbody anchors (vendian.org)
    NebulaCloudColors, CoreCloudColors, DustCloudColors []WeightedColor // photo-derived LUT
    NebulaCloudOpacity, CoreCloudOpacity, DustCloudOpacity float64
    BandTiltXRadians, BandTiltZRadians float64
    RotationRadiansPerSecond float64
}
type ConstellationConfig struct {
    Seed string; DisplayCount int
    StarColor, LineColor string          // theo theme (bảng theme → tint)
    GlowMultiplier float64               // theo mood (clamp 0.7–1.3)
    RotationRadiansPerSecond float64
}
```

### Builder rules (BE `sky_scene_profile.go` + `world_config_builder.go`)
- **PRNG riêng**: `seed.NewPRNG(input.Seed + "-sky")` — không đụng chuỗi draw cũ,
  world/preview cũ giữ nguyên giá trị từng field hiện có.
- Seeds phát cho FE: `MilkyWay.Seed = input.Seed + "-milky-way"` (mỗi world một
  galaxy — trước đây fixed chung), `Constellations.Seed = input.Seed` (khớp
  fallback FE hiện tại nên world cũ không đổi hình chòm sao).
- Counts: dải ngẫu nhiên × `ParticleMultiplier` (mood): allSky 4800–5600,
  band 5200–6000, core 2400–2800, hero 22–32; mây nebula 380–460, core 140–180,
  dust 240–280 (dust không scale mood — nó là cấu trúc).
- Opacity mây × `BloomMultiplier`, clamp; GlowMultiplier chòm sao =
  clamp(BloomMultiplier, 0.7, 1.3).
- Tilt X 0.35–0.65, Z 0.2–0.5 (mỗi world dải Ngân hà nghiêng khác nhau).
- Rotation: 0.003 (milky way) / 0.005 (constellation) × `MotionMultiplier`,
  làm tròn 4 chữ số (`roundTo(v, 4)` mới — `round()` 2dp sẽ nghiền 0.003 → 0).
- Theme → tint: bảng `themeSkyProfiles` (BE là nguồn sự thật; bảng
  `THEME_CONSTELLATION_TINTS` ở FE giữ làm fallback cho world cũ):
  cosmic-galaxy #EAF2FF/#8FB6FF · nebula #F3E8FF/#C084FC · crystal #EAFBFF/#7DD3FC
  · aurora #ECFFF6/#6EE7B7 · cyber-orbit #E6FDFF/#22D3EE · default brass.
  Theme cũng swap một entry accent trong `NebulaCloudColors`.
- DisplayCount chòm sao: 6–8 (đã yêu cầu "thưa ra").
- `SchemaVersion` bump `"1.0"` → `"1.1"` (additive) — cả BE lẫn `PREVIEW_SCHEMA_VERSION`.

### FE consumption
- `types.ts`: `SceneSkyConfig` / `SceneMilkyWayConfig` / `SceneConstellationConfig`
  / `WeightedSkyColor` (mirror comment như các type khác).
- `scene.ts`: `buildPreviewSceneConfig` sinh `sky` bằng cùng bảng/dải giá trị
  (PRNG FE riêng `randomFromSeed(seed + "-sky")` — không đụng draw cũ). Preview
  không cần trùng số tuyệt đối với BE (xorshift ≠ math/rand), chỉ cần cùng dải +
  cùng mapping — đúng như mood profile lâu nay.
- `SolarSystemRenderer` truyền `sky={scene.sky}`; `MilkyWayBand` nhận
  `sky?: SceneMilkyWayConfig`, `ConstellationField` đọc `scene.sky?.constellations`.
- **Fallback + clamp phòng thủ** (DB có thể chứa rác): thiếu field → default cũ;
  clamp count ≤ 20000 sao / ≤ 2000 mây / displayCount ≤ 12, opacity 0–1,
  |rotation| ≤ 0.05.
- api.ts không cần sửa: `normalizeVariant` giữ nguyên `config` (đã xác minh).

### Tests
- BE `world_config_builder_test.go`: sky deterministic (2 lần build giống hệt),
  counts trong dải, theme đổi tint, mood scale glow/mật độ, seeds đúng suffix.
- FE `scene.test.ts`: preview có `sky`, deterministic, mood/theme ảnh hưởng đúng.

---

## 2. Photoreal sky v2 (kỹ thuật từ three.js/Stellarium/Shadertoy)

Nguồn: tiffnix.com/star-rendering, Stellarium StelSkyDrawer, iquilezles.org/articles/warp,
threejs-journey galaxy, vendian.org starcolor, Tanner Helland Kelvin→RGB,
pegwars nebula notes, Wikipedia/EarthSky Great Rift. (Link đầy đủ ở §7.)

Từng mục — cái gì, vì sao, ở đâu:

1. **PSF 2 thành phần** (`SizedStarPoints` fragment): thay smoothstep+exp bằng
   `core = exp(-d²·16)` + `halo = 0.03/(d²+0.03) · smoothstep(1.0, 0.6, d)`.
   Gaussian cho lõi sắc, inverse-square cho quầng ảnh chụp (ánh sáng quầng thật
   giảm ~1/r²).
2. **Diffraction spikes** cho hero stars: `pow(max(0, 1−|p.x·p.y|·28), 10)` +
   bản sao xoay 45° ×0.3, nhân `(1−d)`; gate bằng uniform `uSpikeStrength`
   (chỉ layer hero = 1). Hero sprite to hơn (spike cần chỗ). Ảnh thật chỉ
   ~1–3% sao sáng nhất có spike.
3. **Phân bố cấp sao thật**: sample magnitude với pdf ∝ 3^m (số sao tăng ~3×/cấp),
   `brightness = 2.512^(−m)` nén ảnh chụp `pow(b, 0.55)`, `size ∝ pow(b, 0.45)`
   (Stellarium). Thay power-law cũ — dải động lớn hơn nhiều, đa số sao là chấm mờ.
4. **Màu blackbody**: bảng màu sao = anchor vendian (O #9bb0ff → M #ffcc6f),
   weight lệch nóng cho sao sáng, lệch nguội cho sao mờ; desaturate về trắng
   theo độ sáng (lõi trắng, quầng mang màu). Bảng này giờ do **BE phát trong
   `sky.milkyWay.starColors`**.
5. **Great Rift**: absorption nhân theo vĩ độ — centerline uốn lượn (2 sóng sin),
   strength ~0.85 trên cung ~π về phía lõi, width 0.035–0.055 rad; sao bị
   reject-resample gần rift → 2 rail sáng + khe tối; mây dust đặt DỌC rift
   thay vì rải sigma đều. Sigma dải nở ra ~1.9× quanh lõi (bulge).
6. **Mây fBm domain-warp** (`nebulaCloudTexture` v2): công thức iq nguyên văn
   (q, r, warp 4.0; fbm 5 octave, lacunarity 2, gain 0.5) bake vào **atlas 3
   biến thể** (768×256): 2 warped + 1 ridged (cho dust). Per-sprite: variant
   index + rotation. Value noise 1 tầng cũ chính là lý do "khói cục".
7. **Nhiều sprite, alpha thấp**: nebula 130→~420 / core 55→~160 / dust 95→~260
   sprite, alpha hiệu dụng 0.02–0.08 (additive) và 0.05–0.22 (dust). Mắt không
   segment được từng sprite nữa → chỉ thấy tổng = vân mây liền. Mobile: giảm nửa
   số mây (check viewport như StarParticleField).
8. **Màu mây phân tầng theo ảnh thật**: haze xanh xám #2A3550/#8FA5CE → thân kem
   #E8DCC0 → lõi vàng nhạt #F5E3B8 → viền bụi nâu đỏ #6B4530/#4A3020 → rift
   gần đen #0D0D12 (BE phát trong config).
9. **Chòm sao kiểu bản đồ sao**: nét nối co 8% mỗi đầu (không chạm sao — đúng
   phong cách star chart), line mảnh/mờ hơn, sao chính nhỏ lại một chút.
10. Giữ: twinkle, parallax 3 lớp, skybox ảnh thật làm nền, alpha=1 trick
    (additive contribution tuyến tính), frustumCulled=false, renderOrder
    dust(1) < constellations(2) < particles(3).

---

## 3. Custom cursor (globals.css)

- SVG data-URI, sao 4 cánh brass `#C9A35B` viền ink `#1B1402` + glow mờ, 24×24,
  hotspot tâm (12 12) — hợp chrome "observatory-warmed".
- `body` → cursor default; `a, button, [role=button], label, select, summary`
  → biến thể pointer (sao + vòng ring). Input/textarea giữ `text`.
- `UniverseCanvas` giữ inline `grab`/`pointer` chức năng (kéo xoay) — không đổi
  hành vi, chỉ chrome. Fallback `auto`/`pointer` luôn đứng sau url().

## 4. Header: nút sang backend

- `layout.tsx` (header inline, PHẢI giữ cao 57px — HEADER_OFFSET_PIXELS contract):
  thêm `<a>` ngoài (external) cạnh GALLERY, style y hệt link GALLERY
  (`font-mono text-xs uppercase tracking-widest …`), label "API",
  `target="_blank" rel="noopener noreferrer"`.
- **Không hardcode URL**: origin suy từ `NEXT_PUBLIC_API_BASE_URL`
  (`new URL(base).origin`) — helper `backendOriginUrl()` export từ `lib/api.ts`.
  Prod = https://myunivokai.onrender.com, dev = http://localhost:8080.

---

## 5. Checklist thực thi

- [x] BE: structs `SkyConfig` + `sky_scene_profile.go` (bảng theme/palette/dải số)
- [x] BE: `world_config_builder.go` build sky từ PRNG `seed+"-sky"`, bump 1.1
- [x] BE: `roundTo(v, digits)`; tests builder; `go vet` + `go test ./...` xanh — commit `d4f8e4d`
- [x] Contracts: thêm `sky` vào properties (không required)
- [x] FE: types mirror + `buildPreviewSceneConfig` sinh sky + 5 tests mới (36/36 xanh)
- [x] FE: `MilkyWayBand`/`ConstellationField` đọc config + clamp/fallback — commit `0c1a709`
- [x] FE: PSF v2 + spikes + magnitude + rift + atlas mây warp (photoreal v2) — cùng `0c1a709`
- [x] FE: cursor + nút API header — commit `3080c22`
- [x] Gates FE (typecheck/lint/vitest/build) xanh đủ
- [x] Review diff: workflow 5-agent bị đứt vì session limit → self-review tập
      trung theo đúng 5 hướng (determinism/mirror, backward-compat, shader/GL,
      Go quality, UX). Findings đã fix: `backendOriginUrl()` không còn throw
      khi env sai (fallback default thay vì sập root layout); link API ẩn ở
      màn < sm để giữ contract header 57px; geometryKey MilkyWay bổ sung
      hero/coreCloud counts; regenerate swagger docs (`swag init`) để API docs
      hiện `sky`. Đã xác minh không cần fix: fallback seed world cũ giữ nguyên
      chòm sao + galaxy chung; rift resample deterministic; mip bleed atlas vô
      hại (viền tile trong suốt); tailwind `disabled:cursor-*` thắng rule
      cursor mới; counts BE luôn nằm trong clamp FE.
- [x] Update file này (status) — người dùng tự push branch
      `feat/fe-be/sky-from-database` và mở PR vào staging.

## 6. Deferred / phase sau

- AI gợi ý "skyIntent" (adjective) → builder map sang palette bias — cần thêm
  field vào PersonalityDNA schema, đụng validation strict-mode; để round riêng.
- PROFILE_VERSION pair-test CI (notes/plans/frontend/frontend-plan.md) — làm khi tách
  scene families; sky đi trước theo mirror-comment discipline.
- Panorama thật (ESO/NASA Deep Star Maps, bản đã xoá sao) làm underlay tuỳ chọn.
- Tone-map `1−exp(−c·k)` cho pileup additive nếu lõi vẫn cháy trắng.

## 7. Reference links (research)

- https://tiffnix.com/star-rendering (PSF, spikes 1/r², HDR bake)
- https://iquilezles.org/articles/warp/ · https://thebookofshaders.com/13/ (fbm)
- http://www.vendian.org/mncharity/dir3/starcolor/details.html (anchor màu sao)
- https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html
- https://en.wikipedia.org/wiki/Great_Rift_(astronomy) · EarthSky Great Rift
- https://threejs-journey.com/lessons/galaxy-generator (pow(u,3) scatter, additive)
- http://pegwars.blogspot.com/2018/12/rendering-nebulae.html (LUT màu từ ảnh NASA)
- https://stellarium.org/doc/0.11/classStelSkyDrawer.html (size ∝ pow(lum, 0.45))
- http://casual-effects.blogspot.com/2013/08/starfield-shader.html

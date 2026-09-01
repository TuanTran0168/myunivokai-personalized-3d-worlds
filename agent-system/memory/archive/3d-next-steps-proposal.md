# Đề xuất phát triển tiếp từ memo "Giới hạn 3D" (chưa duyệt)

> **Document status:** Archived historical proposal
> **Last source review:** 2026-07-18

> Trả lời cho câu hỏi "có thể phát triển gì thêm không?" sau khi đọc
> `agent-system/knowledge/frontend/3d-development-limitations.md` + khảo sát thực tế (repo, kit CC0,
> kỹ thuật three.js). Kết luận: **có 3 đợt**, xếp từ rẻ đến đắt, và đợt rẻ
> nhất là thứ memo chưa nói tới.

## Phát hiện quan trọng khi khảo sát

1. **Nhánh `demo/fe/room-kit` đã bị xoá** (không còn local lẫn remote). Điểm
   swap `FurnitureForSlot` mà memo §11 nhắc chỉ còn trên giấy — room phải dựng
   lại, nhưng nên dựng "chính chủ" theo trình tự vision (1a→1b→1c) thay vì
   demo ad-hoc lần nữa.
2. **Option A rẻ hơn memo ước** vì phần render hiện tại còn rất "trống":
   toàn scene chỉ có 1 Bloom + ambient 0.18 + 1 point light của Sun — không
   shadow, không fog, không color grade, không rim/fill, không IBL. Trong khi
   các package ĐÃ CÀI sẵn mọi thứ cần (drei 9.122: ContactShadows,
   AccumulativeShadows, SoftShadows, Environment/Lightformer;
   @react-three/postprocessing 2.19.1: Vignette, Noise, LUT, HueSaturation,
   N8AO, ToneMapping). Tức là còn một tầng "art direction miễn phí" trước khi
   phải đổ tiền vào asset.
3. **Option B có số liệu khả thi cụ thể** (license đã verify):
   - **KayKit Furniture Bits** (CC0, itch.io) — 50+ model GLTF, MỘT atlas
     gradient 1024px dùng chung → đúng look *Summer Afternoon* nhất, 1
     material = ít draw call; cả bộ ~3.6MB chưa nén. → **style anchor**.
   - **Kenney Furniture Kit** (CC0) — ~140 pieces GLB, kho đồ vật lớn nhất.
   - **Quaternius Ultimate House Interior** (CC0) — 82 model GLB, duy nhất có
     cửa sổ/cửa/rèm/kết cấu (cần cho ngữ nghĩa slot "bàn dưới cửa sổ").
   - **Poly Pizza** để nhặt đồ vật theo trait (guitar, telescope, easel…) —
     check license từng model.
   - **Pipeline nén: chọn meshopt, KHÔNG Draco** — decoder meshopt ~30KB nằm
     trong bundle JS (thoả ràng buộc no-CDN), Draco bắt tự host ~700KB decoder
     và drei mặc định trỏ CDN Google. Lệnh:
     `npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt --texture-compress webp --texture-size 512`
     (~5–30KB/piece sau nén). KHÔNG cần KTX2 cho kit flat-color.
   - **Ngân sách**: ≤3MB brotli cho cả phòng, 300–2k tam giác/món,
     ≤50 draw calls mobile (share 1 atlas material + merge tĩnh + `<Clone/>`).

## Lộ trình đề xuất (3 đợt)

### Đợt 1 — "Grade pass" cho universe hiện tại (Option A, ~vài ngày, 0 asset)
Nâng chất scene đang có NGAY, đồng thời là bộ preset ánh sáng/hậu kỳ tái dùng
cho room sau này. FE-only theo bảng theme/mood (kiểu
`THEME_ORBIT_INCLINATION_MULTIPLIERS`) — chưa đụng BE/schema:
1. **Vignette + film grain + micro chromatic-aberration** (giờ, impact cao) —
   gộp chung 1 fullscreen pass với Bloom sẵn có, gần như miễn phí.
2. **Grade theo theme**: HueSaturation + BrightnessContrast trước, LUT 3D sinh
   procedural sau (LookupTexture.createNeutral(32) + transform per theme —
   deterministic, không fetch).
3. **Rim/fill rig theo mood** — fix mặt tối hành tinh đen kịt: hemisphere
   (secondary/bg) + directional rim bám camera (accent). Đèn analytic ~free.
4. **Fog exp2 tint theo mood background** (skybox + sky layers miễn nhiễm sẵn).
5. **Chuẩn hoá selective bloom**: threshold 0.45→1.0, emitter chủ đích đẩy màu
   >1 (pattern SKYBOX_BRIGHTNESS_MULTIPLIER có sẵn) → planet hết loang bloom.
6. **AgX tone mapping** (three 0.171 có sẵn) + exposure theo mood.
7. **Fix chi phí ẩn**: EffectComposer đang multisampling 8 mặc định → 0/4 cho
   mobile.
8. Khi preset ổn định qua 1 vòng tuning → promote vào `postFX` schema 1.2
   (theo đúng pattern sky 1.1: BE builder + mirror + fallback).

### Đợt 2 — Nền móng scene-family (vision 1a + 1b, phải làm trước room)
- **1a BE** `feat/be/scene-composer-registry`: package `internal/scenes`,
  interface `SceneComposer`, chuyển WorldConfigBuilder → solarsystem.Composer,
  **golden test byte-identical**, migration `scene_type` trên world_variants
  (DEFAULT 'solar-system'), API thêm `preferredSceneType` optional.
- **1b FE** `feat/fe/scene-type-registry`: registry 2 tầng lazy theo sceneType
  (dynamic import — visitor universe không tải code room), SceneConfig thành
  discriminated union, legacy normalize về "solar-system".
- Dọn copy hardcode universe cho generic: tooltip "Unknown planet", gallery
  "{n} bodies", share OG copy, GeneratingOverlay, gate `hasConfiguredPlanets`.

### Đợt 3 — Room family (vision 1c, Option B thật sự)
`feat/fe-be/scene-family-room`: composer BE (slots + layout grammar
deterministic: giường-sát-tường, bàn-dưới-cửa-sổ, đồ vật theo DNA planet) +
renderer FE với **điểm swap GLB dựng lại**; kit KayKit làm anchor + Kenney/
Quaternius bù; meshopt pipeline + `useGLTF` self-hosted; ánh sáng ấm từ preset
Đợt 1 + **ContactShadows frames={1}** (desktop) / **AO blob CanvasTexture**
(mobile — pattern softCircleTexture có sẵn) + **RoomEnvironment IBL** (procedural,
không CDN) + **meshToonMaterial ramp sinh code** để giấu "chất kit". DNA planets
map sang đồ vật ý nghĩa → giữ nguyên click-to-focus/DNA panel (props
planet-named dùng như POI, đúng chỉ dẫn frontend-plan.md).

## Không làm (giữ nguyên kết luận memo)
- AI-mesh runtime (phá deterministic + regenerate-free).
- Nhân vật đi lại (trục UX riêng, rất nặng).
- Tách microservice trước khi family thứ 2 sống trong monolith (vision "What
  NOT to do").

## Phương án FE-only — scope chốt sau trao đổi

> Chỉ FE, ưu tiên **đẹp + nét rõ**; tối ưu máy yếu & BE tạm out of scope.

Câu hỏi "model vẽ nào?" — trả lời tách theo TÔNG (memo đã cảnh báo lệch tông):
universe hiện tại là semi-photoreal (texture NASA + Milky Way photoreal) →
**model phải photoreal, KHÔNG dùng kit low-poly** (kit để dành room/nature).

### S1 — Fix độ nét (0 asset, phát hiện lỗi thật khi khảo sát repo)
1. **`colorSpace` chưa set ở MỌI texture** (grep 0 kết quả) — JPG sRGB đang bị
   sample như linear → hành tinh nhạt/bệt. Fix: `texture.colorSpace =
   SRGBColorSpace` tại Skybox/SolarPlanet/Sun. (Retune
   `SKYBOX_BRIGHTNESS_MULTIPLIER = 2.2` sau fix — nó được tune trên nền sai.)
2. **`anisotropy` = 1 mặc định** (grep 0 kết quả) — vành Saturn nhìn nghiêng,
   rìa hành tinh, dải skybox đều sập mip mờ. Fix:
   `texture.anisotropy = gl.capabilities.getMaxAnisotropy()` (~16).
3. **DPR clamp [1, 1.8]** (UniverseCanvas) — dưới cả native màn 2x → mờ toàn
   cục. Máy yếu out of scope → nâng `[1, window.devicePixelRatio]` (hoặc [1,3]).
4. **Bug UV vành Saturn**: `RingGeometry` UV phẳng nhưng
   `2k_saturn_ring_alpha.png` là dải RADIAL → vành đang map sai, cần remap UV
   theo bán kính thì mới thấy vân vành thật.
5. Sphere segments 40×28 → 96×64 (fly-to close-up hết lộ cạnh);
   `<EffectComposer multisampling={8}>` pin tường minh; gl
   `powerPreference: "high-performance"`.

### S2 — Nâng texture 8K (nguồn CŨ, license CŨ — đã verify URL + size)
Solar System Scope (CC BY 4.0, chính nguồn trong ATTRIBUTION.md) có bản 8K:
sun 3.7MB · earth_daymap 4.6MB · jupiter 3.1MB · saturn 1.1MB ·
saturn_ring 65KB · **stars_milky_way 1.9MB (skybox 2k hiện tại là chỗ mờ
nhất — swap 1 tên file)** · mercury 15MB / venus 12.5MB / mars 8.4MB (re-encode
q80 còn ~3–5MB) · uranus/neptune chỉ có 2k (không sao — gradient trơn).
**Earth thêm lớp**: night map (2k 255KB/8k 3.1MB), clouds (shell riêng xoay
lệch tốc độ), normal + specular TIF (convert PNG; specular đảo thành
roughnessMap — biển bóng, đất nhám). Skybox đẹp hơn nữa: ESO Milky Way pano
(CC BY, credit "ESO/S. Brunier", JPEG 7.8MB) — dust lane ảnh chụp thật.

### S3 — Model photoreal: NASA 3D Resources (phát hiện chính)
**Kho GitHub nasa/NASA-3D-Resources đã re-export 257 file GLB nén sẵn
Draco + WebP** (2024–25), public domain (không cần attribution; không dùng
logo NASA làm branding). Đã tải + parse thử, picks (file mẫu nằm trong
scratchpad session):
- **Perseverance** 4.76MB/200k tri — chất lượng nhất kho, PBR clearcoat đầy đủ.
- **Juno (A)** 8.6MB — quay quanh hành tinh kiểu Jupiter; **Cassini (A)** 1.6MB;
  **Voyager (B)** 1.6MB — vành ngoài; **JWST (B)** 0.96MB (gương vàng PBR);
  **Hubble (A)** 1.6MB (⚠️ bản B 819k tri KHÔNG có material — bẫy);
  **Parker Solar Probe** 0.42MB — gần Sun; **Bennu** 0.31MB (shape radar thật).
- ⚠️ Scale các model lệch nhau hàng trăm lần — luôn normalize bằng `Box3`.
- Cần `DRACOLoader` decoder self-host (`public/draco/` — drei mặc định trỏ CDN
  Google, vi phạm ràng buộc no-CDN) hoặc re-encode meshopt bằng gltf-transform.
- PBR spacecraft "chết" nếu thiếu env map → set `scene.environment` từ
  cubemap render chính Milky Way của mình (procedural, không CDN).
- Smithsonian CC0: Apollo 11 Command Module (scan thật, cần decimate).
  ESA (67P) là CC BY-**SA** — để sau, license rườm hơn.
- **Hook sản phẩm**: DNA planet năng lượng cao nhất được một "vệ tinh nhân
  tạo" bay quanh (chọn model theo seed) — trang sức cá nhân hóa đúng triết lý.

### S4 — Procedural (0 MB, đúng triết lý deterministic)
- **Asteroid belt**: IcosahedronGeometry detail 3 + dịch đỉnh theo FBM simplex
  seeded (4–5 octave, amplitude ~0.25R, bóp méo dạng củ khoai), 2–3 biến thể
  geometry × `InstancedMesh` 2–5k instance, phân bố gaussian quanh bán kính
  vành đai, scale power-law (nhiều nhỏ ít to), trôi Keplerian bằng
  `u_time` trong vertex shader (bit-identical mọi timestamp).
- **Comet**: nucleus icosphere tối (albedo ~0.04) + đuôi bụi cong (Bezier,
  ấm) + đuôi ion thẳng xanh — tái dùng nguyên shader SizedStarPoints/mây.

### Thứ tự làm (FE-only) — ĐÃ THỰC THI, branch `feat/fe/universe-visual-quality`

- [x] S1 fix độ nét — commit `c903777` (sRGB colorSpace, anisotropy max,
      DPR [1,3], **fix bug UV vành Saturn**, segments 96×64, MSAA pin 8,
      skybox multiplier retune 2.2→3.0)
- [x] S2 texture 8K/4K + Earth night/clouds/normal/gloss-ocean — `031b600`
      (payload ~5MB → ~25MB, ATTRIBUTION cập nhật adaptations)
- [x] Grade pass — `6224ee4` (vignette + grain + CA, grade theo theme,
      hemisphere fill + rim light, fogExp2 theo mood bg — các lớp trời
      fog-exempt, AgX tone mapping, selective bloom threshold 0.85 + sun
      HDR ×1.5)
- [x] S4 belt + comet procedural — `3ab1480` (seededNoise3d, 1100 instance
      power-law, đuôi bụi cong + đuôi ion xanh anti-sunward)
- [x] S3 NASA models — `7b898e2` (Hubble/JWST/Cassini/Voyager meshopt
      ~1.78MB, seed chọn 1 chiếc bay quanh hành tinh năng lượng cao nhất;
      Bennu vào vành đai; Lightformer IBL no-CDN)

Gates: typecheck + lint + 36 tests + build xanh sau từng commit. Người dùng
tự push branch + mở PR vào staging. Tinh chỉnh thị giác (multiplier skybox,
grade, mật độ belt) chờ feedback nhìn thực tế.

## Kit tham khảo cho family sau (đều CC0, cùng bộ 3 tác giả → đồng tông)
- Nature: Kenney Nature Kit (330), Quaternius Ultimate Nature / Stylized
  Nature, KayKit Forest.
- City: Kenney City Kit Suburban/Roads/Commercial/Industrial, KayKit City
  Builder Bits; tham khảo layout: Kenney Starter Kit City Builder (open source).

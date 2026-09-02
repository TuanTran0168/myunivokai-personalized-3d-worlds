# Cơ chế vẽ khu rừng bằng models — Myunivokai FE (nature/forest)

> **Document status:** Active
> **Last source review:** 2026-07-18

> Tài liệu này ghi lại **cơ chế thực tế** của renderer rừng
> (`features/scene-renderers/forest/`, nhánh `feat/fe/nature-scene-fe-rounds`,
> 07/2026): rừng được vẽ từ loại "model" nào, mỗi loại đi qua pipeline gì, và
> những cái bẫy đã trả giá để học. Đây là bản song sinh của
> [universe-render-mechanism.md](universe-render-mechanism.md) cho họ scene
> `nature`. Đọc kèm [threejs-scene-architecture.md](threejs-scene-architecture.md)
> (nguyên lý three.js + registry) và
> [../vision/nature-service-plan.md](../../plans/services/nature-service-plan.md)
> (nhật ký quyết định N1–N5 / P1–P6 + link tham chiếu Sketchfab của owner).

## Bức tranh tổng: 3 loại "model", 1 nguồn sự thật

Khác universe (chủ yếu primitive + shader), rừng chủ yếu là **GLB asset thật**.
Mọi thứ trên màn hình thuộc đúng 1 trong 3 loại:

| # | Loại | Kỹ thuật | Ví dụ |
|---|---|---|---|
| 1 | **Instanced GLB tĩnh** | 1 `InstancedMesh` cho mỗi (variant, part) → vài trăm–vài nghìn vật thể trong ít draw call | Cây, đá, cỏ, bụi/dương xỉ/hoa/nấm/gốc cây (understory), landmark |
| 2 | **Skinned/animated GLB** | clone bằng `SkeletonUtils.clone` + `useAnimations` chạy clip xương thật | Thú (deer/fox/wolf có clip Walk), chim (Fly/Fast_Flying) |
| 3 | **Procedural / shader / particle** | hình học sinh từ noise + quad instanced | Địa hình (PlaneGeometry + height sampler), mưa/tuyết/mây, tia nắng, đom đóm, cánh hoa/lá rơi, mặt ao |

Nguồn sự thật duy nhất là `ForestSceneConfig` (JSON từ nature-service,
**schemaVersion 1.2**, `sceneType: "forest"`) + chuỗi `seed`. **Không có gì vẽ
"khơi khơi"**: hoặc số liệu đến từ config (sections season/lighting/terrain/
trees/weather/wildlife/ambientParticles/landmarks), hoặc suy ra tất định từ seed
qua `randomFromSeed(seed + "-forest-<stream>")`. `Math.random()` bị cấm trong
scene code — hệt universe.

## Luồng dữ liệu từ DB đến pixel

```txt
Neon (nature DB, world_variants.scene_config JSON)
  → nature-service trả ForestSceneConfig (schemaVersion 1.2)
  → lib/api.ts chuẩn hoá về lib/types.ts (các section forest)
  → lib/scene.ts: isForestScene(scene) + pointsOfInterestFromScene (landmarks → POI)
  → registry.ts: resolveSceneTypeRenderer(scene) khớp sceneType "forest" TRƯỚC theme
  → ForestRenderer compose toàn bộ node bên dưới
```

Điểm mấu chốt kiến trúc: registry **phân giải theo `sceneType` trước, `theme`
sau**. Forest → `ForestRenderer`; nếu không có sceneType thì mới rơi về map theme
(5 theme universe → `SolarSystemRenderer`). Xem
[threejs-scene-architecture.md](threejs-scene-architecture.md) mục "sceneType-first".

Landmark rừng được **adapt thành POI** qua `pointsOfInterestFromScene` (bọc vào
`PlanetSceneConfig`) nên HUD/hover/CameraRig dùng chung, không phân biệt họ scene.

Phân công cứng vẫn như universe: **BE quyết định data** (mùa, thời tiết, mật độ
cây, slot thú, vị trí landmark — sinh từ Nature DNA + seed), **FE quyết định
presentation** (model nào, texture, ánh sáng, hậu kỳ). Giá trị FE đọc từ config
đều phải có fallback + clamp để world cũ (thiếu field mới) vẫn render.

## ⚠️ Nguồn asset & giới hạn Sketchfab (đọc trước khi tìm model mới)

Danh mục nguồn tải, giấy phép, model tham chiếu và công cụ kiểm tra dùng chung
được duy trì tại [threejs-assets.md](../references/threejs-assets.md). Phần dưới
đây là các ràng buộc riêng của pipeline forest hiện tại.

**Pipeline tải model của rừng là [poly.pizza](https://poly.pizza), KHÔNG phải
Sketchfab.** Đây là trần chất lượng hiện tại và lý do:

- **Sketchfab chặn tải sau đăng nhập.** Đã kiểm chứng bằng test thật (không đoán):
  cả `https://sketchfab.com/i/models/{uid}/download` lẫn API v3
  `https://api.sketchfab.com/v3/models/{uid}/download` đều trả **HTTP 401
  `"Authentication credentials were not provided."`** khi không có OAuth token —
  **kể cả** model gắn `isDownloadable: true` giấy phép CC-BY. Không có phiên đăng
  nhập của owner thì agent/CI **không thể** lấy file. Vì vậy các link Sketchfab
  owner gửi (bộ sưu tập cây quasarus, phoenix/macaw/fire-bird…) chỉ là **thanh
  tham chiếu độ đẹp để hướng tới**, ghi trong nhật ký quyết định
  [../vision/nature-service-plan.md](../../plans/services/nature-service-plan.md) — chúng
  KHÔNG phải nguồn tải được.

- **Cách đưa đúng model Sketchfab vào (owner làm 1 lần, agent ghép):**
  1. Đăng nhập Sketchfab → mở model → **Download 3D Model** → chọn định dạng
     **glTF (.glb)**.
  2. Bỏ file vào `apps/myunivokai-personalization/public/assets/nature/models/`, đặt tên gợi
     nhớ (vd `tree-quasarus-oak.glb`).
  3. Báo tên file + nó là loại gì. Agent sẽ nén Draco + chuẩn hoá scale rồi cắm
     vào catalog trong `forest/forestModels.ts` (`TREE_MODEL_CATALOG` /
     `BIRD_MODEL_DEFINITIONS` / `SPECIAL_BIRD_DEFINITIONS`…). Cơ chế instancing +
     gió + nhuộm mùa đã sẵn, chỉ trỏ file mới.
  4. Nếu owner có **Sketchfab API token** và muốn cấp, agent dùng được — nhưng
     tải thủ công qua trình duyệt (đã đăng nhập) an toàn và nhanh hơn, và **không
     bao giờ** commit token vào repo.

- **Kho hiện dùng:** 33 GLB + 3 HDRI (~6.5 MB GLB tổng, sau nén), tự host dưới
  `apps/myunivokai-personalization/public/assets/nature/`. Model chủ yếu từ **Quaternius**
  (CC0, style low-poly đồng bộ) trên poly.pizza; vài file CC-BY (vd chim hawk)
  có ghi công. HDRI từ **Poly Haven** (CC0). Mọi nguồn + giấy phép nằm ở
  `public/assets/nature/ATTRIBUTION.md` — cập nhật file đó mỗi khi thêm asset.

Nguyên tắc bất di: **CC0 ưu tiên, CC-BY phải ghi công, tuyệt đối không hotlink**
— mọi asset tự host trong `public/`. **Gap hiện tại:** model GLB là self-hosted
nhưng Drei vẫn lấy Draco decoder mặc định từ Google CDN vì source chưa gọi
`useGLTF.setDecoderPath(...)`. Backlog yêu cầu copy decoder versioned vào
`public/draco/` và cấu hình path local để policy runtime self-hosted đúng hoàn
toàn; xem [Drei useGLTF](https://drei.docs.pmnd.rs/loaders/gltf-use-gltf).

## Pipeline nén GLB + chuẩn hoá (làm offline, trước khi commit)

Mỗi model chạy qua gltf-transform:

```bash
npx --yes @gltf-transform/cli optimize input.glb output.glb \
  --compress draco --texture-size 512 --simplify false
```

(Cây/đá/decor để 512px; model nhỏ trên màn hình có thể 256px.)

- **Chọn Draco cho rừng:** khối lượng vertex lớn (nhiều cây), Draco nén hình học
  mạnh. Source hiện còn dùng decoder mặc định từ gstatic; đây là technical debt,
  không phải kiến trúc đích. Giữ Draco nhưng self-host decoder versioned, hoặc
  chỉ đổi sang Meshopt sau benchmark payload/decode/frame time. Universe dùng
  Meshopt và không có dependency decoder CDN này.
- **🪤 BẪY ĐÃ TRẢ GIÁ — tên file output PHẢI kết thúc `.glb`.** Nếu đặt output
  không có đuôi `.glb`, gltf-transform lặng lẽ ghi ra **JSON + .bin + texture
  rời** trùng tên → GLB "hỏng" (mất magic bytes `glTF`), scene vỡ. Sau khi nén
  luôn kiểm 4 byte đầu là `glTF`.

### Chuẩn hoá kích thước lúc load — `normalizationForObject`

Đơn vị các model lệch nhau rất nhiều, nên **luôn chuẩn hoá bằng bounding box**.
`normalizationForObject(object, targetSize, normalizeBy)` trả về
`{ scale, footOffsetY, centerOffset:[x,y,z] }`:

- `scale` = `targetSize / kích-thước-theo-trục-chọn` (cao/max).
- `footOffsetY` đẩy đáy bounding box về `y = 0` → cây/thú đứng trên mặt đất, không
  lún/lửng lơ.
- `centerOffset` căn tâm XZ → dùng cho vật cần xoay quanh tâm thân (chim).

## Loại 1 — Cây & lá (instanced GLB + nhuộm màu theo mùa)

`ForestTrees.tsx` dựng **1 `InstancedMesh` cho mỗi (variant, part)** của cây,
rải theo `-forest-tree-placement`, mỗi cây nghiêng theo gió (whole-tree wind
lean). Catalog ở `TREE_MODEL_CATALOG` (birch / oak×2 / pine×2 / pine-snow /
dead×2; blossom = dùng lại silhouette oak).

### 🪤 `splitIntoVariants` — chỉ tách file "bộ nhiều model"

`extractInstancedModelVariants(sceneRoot, targetHeight, splitIntoVariants)`:

- **Mặc định `false`** → coi cả file là 1 model, gộp mọi mesh con (thân + lá là
  các mesh anh em của CÙNG một cây).
- **`true` chỉ cho file chứa NHIỀU model rời** (vd "Birch Trees" gói 3 cây trong
  1 file) → tách **tại node nhóm**, không tách mesh anh em.
- **Bug gốc đã fix (P2):** extractor từng tách thân + tán của MỘT cây thành 2
  "variant" → rừng toàn **thân trơ + tán bay lơ lửng**. Cờ này là cách sửa.

### 🪤 Nhuộm lá theo mùa — `recolorableFoliageMaterial` (bài học "lá như hình vuông")

Yêu cầu: đổi màu lá theo mùa (xuân xanh non → thu vàng) mà vẫn giữ chi tiết tán.
**Cách SAI đã trả giá (P3):** bỏ texture lá đi rồi flat-shade một material trắng
→ tán chi tiết bị "bẹp" thành khối đa giác vuông vức ("lá như hình vuông").

Cách ĐÚNG (`recolorableFoliageMaterial(originalMaterial)`):

1. **Giữ nguyên** `map` (texture lá) + `normalMap` + normal mượt; set
   `color = #FFFFFF` (không nhân tint kiểu cũ — nhân tint lên texture xanh sẽ ra
   màu bùn).
2. `onBeforeCompile` thay `#include <map_fragment>` bằng shader dùng **độ sáng
   (luminance)** của texture làm chi tiết, nhân với **màu mùa per-instance** làm
   sắc:
   ```glsl
   vec4 sampledLeafColor = texture2D(map, vMapUv);
   float leafLuma = dot(sampledLeafColor.rgb, vec3(0.299, 0.587, 0.114));
   leafLuma = mix(0.72, 1.12, leafLuma);
   diffuseColor.rgb *= leafLuma;   // rồi nhân màu mùa ở tầng instanceColor
   ```
3. `customProgramCacheKey = () => "forest-foliage-recolor"` để mọi material lá
   share 1 program (không phình shader cache).

Một số loài giữ màu riêng bất kể mùa: blossom (`SPECIES_SEASON_TINT_MULTIPLIERS`
≈ 0.25), pine-snow (≈ 0.2) — tuyết/hoa không bị nhuộm theo mùa.

## Loại 2 — Chim (clip xương thật) và thú

`ForestWildlife.tsx`. Model animated được clone bằng `SkeletonUtils.clone` (KHÔNG
`<Clone>` thường — cần skeleton riêng mỗi cá thể) + `useAnimations`.

### 🪤 BA cái bẫy chim đã trả giá

1. **Đừng gọi `mixer.update()` thủ công.** drei `useAnimations` tự update mixer
   trong một `useFrame` nội bộ. Gọi thêm `mixer.update()` = **update 2 lần/frame
   → vỗ cánh nhanh gấp đôi**. Chỉ set clip + `play()`, để drei lo phần chạy.
2. **Chim bay lùi → `headingOffsetRadians`.** Model có "mặt nghỉ" khác nhau; cộng
   offset để mũi chim hướng theo vận tốc. Cả 2 chim hiện tại cần `Math.PI`
   (`BIRD_MODEL_DEFINITIONS`).
3. **Double-scale khi căn tâm.** `centerOffset` (căn bbox) phải đặt trên **CÙNG
   group với scale**, không phải group con của group đã scale — nếu không offset
   bị nhân scale lần nữa → chim lệch trục xoay. Mixer root gắn ở group cha chưa
   scale.

Trước đó (P3) chim là model tĩnh giả vỗ bằng cách lắc cả thân — trông như "chim
tư thế đậu mà vẫn bay". P4 đổi sang model có clip xương thật:
`bird-hawk.glb` (clip `metarig|Fly`, Sherkiz CC-BY) và
`bird-armabee.glb` (clip `CharacterArmature|Fast_Flying`, Quaternius CC0).
`BIRD_PLUMAGE_TINTS` cho 3 sắc lông; flap được **stagger** (lệch pha) mỗi con.

Thú mặt đất (`GroundAnimal`): là POI click được, camera bám theo bằng một
`Vector3` tracker sống, đi ping-pong (ping-pong wander), đóng băng clip Walk khi
pause. deer/fox/wolf có clip Walk; boar/rabbit/bear/squirrel tĩnh; stag animated.

### Vật thể quý hiếm theo DNA (seed-gated, FE-only, không đổi schema)

Hai tính năng hiếm suy ra tất định từ **world seed = DNA** (không thêm field
config):

- **Chim đặc biệt bay qua** (`SPECIAL_BIRD_DEFINITIONS`, xác suất
  `SPECIAL_BIRD_PROBABILITY = 0.35`): ~35% world có 1 con firebird / azure-macaw
  / golden-eagle (hawk phóng to + emissive) vòng ngang trời trên quỹ đạo dài, có
  quãng trống dài giữa các lần bay qua. `resolveSpecialBird(seed)` seeded.
- **Thú huyền thoại** (`SPECIAL_ANIMAL_DEFINITIONS`, `SPECIAL_ANIMAL_PROBABILITY
  = 0.4`): ~40% world có 1 white-stag / golden-fox / spirit-wolf / verdant-stag
  (recolor thú animated + lông phát sáng). `AnimalModel` nhận optional
  `coatColor` / `emissiveIntensity`.

Đây là mẫu "rare feature theo DNA" tái dùng được: roll seeded off world seed, tô
lại asset sẵn có — không cần asset mới, không đụng contract.

**Xác suất và danh sách species giờ nằm ở `src/lib/rarity.ts`**, không phải ở
`forestModels.ts`. `forestModels.ts` chỉ còn giữ phần *hình thức* (model, màu
lông, scale) và map theo key. Lý do: species được chọn theo **index**
(`floor(roll * length)`), nên đảo thứ tự danh sách sẽ gán lại species cho mọi
world đã sinh ra — và admin app (màn `/rarity`) replay đúng lottery này bằng Go
để đo tỉ lệ thực tế, nên hai bên phải dùng chung một danh sách có thứ tự.

Một chi tiết dễ vấp: `ForestWildlife` nhận `worldSeed` = `terrain.placementSeed`
= `<variant seed>-forest-terrain-scatter`, nên stream thật của con chim là
`<variant seed>-forest-terrain-scatter-forest-special-bird`. Đó là tai nạn của
đường dây truyền tham số chứ không phải quyết định — nhưng nó là stream mà các
forest đã render thật sự dùng, nên `contracts/go/contracts_rarity.go` phải replay
đúng chuỗi đó. `TestPlacementSeedMatchesTheRarityContract` bên nature-service giữ
hai bên khớp nhau.

## Loại 3 — Địa hình, chân trời, thời tiết

### Địa hình + "giết mảnh vuông khi zoom xa" (P6)

`ForestTerrain.tsx` + `forestMath.ts::createTerrainHeightSampler`. Nền là
`PlaneGeometry` hữu hạn → zoom ra lộ mép vuông. Cách khử (P6):

- Height sampler thêm **đồi rừng nhô lên qua treeline** (distant-rise term) →
  nhìn xa gặp dãy đồi thoải, không phải mép cắt. Cây vẫn dừng ở treeline; đồi nhô
  bắt đầu ngoài đó nên không có gì lửng lơ.
- Nền to hơn nhiều (treeline ×3.2, 160 segment/cạnh).
- Dải mid-far **nhuộm xanh tán rừng đậm** (đồi nhô đọc như rừng phủ cây); rìa
  ngoài **fade về `horizonColor` (= `lighting.fogColor`)** nên góc/mép vuông
  thành màu trời và tan vào vòm trời + sương.
- FE-only, distant-rise = 0 trong treeline nên vị trí cây/thú/landmark **không
  đổi** (không phá determinism).

### Thời tiết, ánh sáng, HDRI

- `ForestWeatherEffects.tsx`: mưa = quad streak instanced xoay theo vận tốc rơi +
  gió tạt; tuyết trôi theo gió; `LightningFlashes` (chớp đôi seeded khi mưa
  ≥0.5); mây nhiều/nhanh hơn; tia nắng dùng **texture gradient mềm** (P3, thay vì
  hình chữ nhật cứng — dùng chung `shared/lightShaftTexture.ts`).
- `ForestRenderer.tsx`: rig đèn analytic (directional "mặt trời" đổ bóng +
  hemisphere + ambient nhẹ) **chỉ hỗ trợ**, phần lớn không khí đến từ **HDRI IBL**
  (`<Environment files={natureHdriUrlForKey(lighting.hdriKey)}>`, Poly Haven, tự
  host theo `HDRI_FILES_BY_KEY`). Cường độ nắng nhân theo `weather.kind`
  (overcast/rain/snow làm phẳng).
- `fogExp2` luôn có tối thiểu (`MINIMUM_RENDER_FOG_DENSITY`) để treeline không cắt
  cạnh cứng vào vòm trời.

## PRNG streams + kỷ luật mirror

Mỗi feature dùng **stream seed riêng** (hậu tố cố định), rút số theo **thứ tự cố
định** — thêm feature mới không được làm lệch số của feature cũ (world cũ phải
trông y hệt sau deploy):

```txt
FE: {seed}-forest-tree-placement, -forest-grass, -forest-rocks,
    -forest-decor, -forest-animal-{i}, -forest-birds-{i}, -forest-leaves,
    -forest-petals, -forest-fireflies, -forest-special-bird, -forest-special-animal
BE: {seed}-forest-season, -lighting, -terrain, -trees, -weather, -wildlife,
    -ambient, -landmarks
```

**Mirror pair:** `lib/forestScene.ts` (preview) ↔
`services/nature-service/internal/services/forest_scene_profile.go` +
`forest_config_builder.go` — cùng bảng, cùng stream per-section, cùng draw order.
FE PRNG là xorshift mirror → preview *hợp lý*, không byte-equal với BE. **Đổi
tuning thì phải sửa cả hai phía.** Golden fixtures của BE là hợp đồng thực thi:
byte-diff cho seed cũ = breaking change ⇒ bump `schemaVersion` + giữ reader cũ.

## Checklist thêm asset/model rừng mới

1. **License rõ** (CC0 / CC-BY + ghi công) và **tự host** trong
   `public/assets/nature/` — không CDN runtime. Cập nhật `ATTRIBUTION.md`.
2. Model từ **poly.pizza** (tải trực tiếp được). Sketchfab chỉ là tham chiếu —
   owner tự tải logged-in rồi đưa file (xem mục Sketchfab ở trên).
3. Nén trước khi commit: `gltf-transform optimize --compress draco --texture-size
   256|512`. **Output PHẢI đuôi `.glb`**; kiểm magic bytes `glTF`.
4. Khai báo qua catalog trong `forestModels.ts` (không hardcode URL trong
   component). Đặt `targetHeight`; chỉ set `splitIntoVariants: true` cho file
   chứa nhiều model rời.
5. Lá cây → `recolorableFoliageMaterial` (giữ texture, đừng flat-shade trắng).
6. Model animated → clone `SkeletonUtils.clone` + `useAnimations`; **không** gọi
   `mixer.update()` thủ công; đặt `flapClipName` + `headingOffsetRadians`; căn
   bbox trên cùng group với scale.
7. Mọi lựa chọn "ngẫu nhiên" → `randomFromSeed(seed + "-forest-<stream-mới>")`,
   không đụng stream cũ, giữ nguyên thứ tự rút.
8. Nếu là feature "hiếm theo DNA" → roll seeded off world seed, recolor asset sẵn
   có (mẫu special-bird/animal) — ưu tiên cách này trước khi thêm asset mới.
9. Chạy đủ 4 gate FE: `npm run typecheck && npm run lint && npm run test &&
   npm run build`. Nếu chạm mirror (tuning) → đồng bộ `forestScene.ts` ↔ builder
   Go và cân nhắc golden/schema.
10. Catalog phải có test CI xác nhận mọi model/HDRI key resolve tới file thật,
    attribution có entry và tổng size không vượt budget; test này chưa có trong
    source ở lần review 2026-07-18.

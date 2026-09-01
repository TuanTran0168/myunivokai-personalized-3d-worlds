# Cơ chế vẽ vũ trụ bằng models — Myunivokai FE

> **Document status:** Active
> **Last source review:** 2026-07-18

> Tài liệu này ghi lại **cơ chế thực tế** đang chạy trên nhánh
> `feat/fe/universe-visual-quality` (07/2026): vũ trụ được vẽ từ những "model"
> nào, mỗi loại đi qua pipeline gì, và quy tắc bắt buộc khi thêm model mới.
> Đọc kèm [threejs-scene-architecture.md](threejs-scene-architecture.md)
> (nguyên lý three.js + kiến trúc renderer) — file này đào sâu tầng asset/model
> mà file kia chỉ lướt qua.

## Bức tranh tổng: 4 loại "model", 1 nguồn sự thật

Mọi thứ trên màn hình thuộc đúng 1 trong 4 loại, xếp theo chi phí payload
tăng dần:

| # | Loại model | Payload | Ví dụ trong scene |
|---|---|---|---|
| 1 | **Data-driven primitives** — hình học có sẵn của three.js, tham số từ DB | 0 MB | Hành tinh (sphere), orbit ring, sao nền (points) |
| 2 | **Custom shader points** — GLSL tự viết vẽ từng hạt | 0 MB | Sao PSF, dải Milky Way, mây bụi nebula, đuôi sao chổi |
| 3 | **Procedural geometry** — hình học sinh bằng noise từ seed | 0 MB | ~1100 thiên thạch, nhân sao chổi |
| 4 | **GLB assets thật** — model NASA nén meshopt, tự host | ~1.78 MB | Hubble/JWST/Cassini/Voyager, thiên thạch Bennu |

Nguồn sự thật duy nhất là `WorldSceneConfig` (JSON từ BE, schemaVersion 1.1)
+ chuỗi `seed`. **Không có gì được vẽ "khơi khơi"**: hoặc số liệu đến từ DB
(mảng planets, section `sky`, palette, postFX), hoặc được suy ra tất định từ
seed qua `randomFromSeed(seed + "-tên-stream")`. `Math.random()` bị cấm
trong scene code.

### Quy tắc stream PRNG riêng

Mỗi feature dùng **stream seed riêng** (hậu tố tên):
`-orbit-inclinations`, `-asteroid-belt`, `-rock-<i>`, `-bennu`, `-spacecraft`,
`-sky` (BE)… Lý do: thêm feature mới không được làm lệch các lần rút số của
feature cũ — world cũ phải trông y hệt sau khi deploy code mới.

## Luồng dữ liệu từ DB đến pixel

```txt
Neon Postgres (world_variants.scene_config JSON)
  → BE trả WorldSceneConfig (schemaVersion 1.1, có section sky do BE sinh)
  → lib/api.ts chuẩn hoá về lib/types.ts
  → lib/scene.ts: reader an toàn (paletteFromScene, planetsFromScene, …) + fallback/clamp
  → UniverseCanvas: resolveSceneRenderer(scene.theme) chọn renderer từ registry.ts
  → SolarSystemRenderer compose toàn bộ node bên dưới
```

Phân công cứng: **BE quyết định data** (bao nhiêu hành tinh, orbit, tốc độ,
màu, section sky — sinh từ Personality DNA + seed), **FE quyết định
presentation** (texture nào, shader nào, ánh sáng, hậu kỳ). Giá trị nào FE
đọc từ config đều phải có fallback + clamp (ví dụ `resolveMilkyWayConfig`)
để world cũ chưa có field mới vẫn render được.

## Loại 1 — Data-driven primitives (hành tinh, texture thật)

### Catalog texture

`solar-system/planetTextureCatalog.ts` map mỗi "vai" hành tinh → bộ URL
texture trong `public/textures/solar-system/` (Solar System Scope, CC BY 4.0,
ghi công trong `ATTRIBUTION.md` cùng thư mục). Độ phân giải: 8K cho
sun/skybox/earth/jupiter/saturn, 4K mercury/venus/mars, 2K phần còn lại.

Tại lần review 2026-07-18, thư mục này có 22 file khoảng **31.3 MB**. Đây là
source budget đáng kể, không phải “free” chỉ vì geometry là primitive. Trước
khi thêm texture mới phải triển khai/đo quality tier hoặc KTX2/WebP phù hợp,
bao gồm network bytes, decode/upload time, GPU memory và frame time.

### Pipeline chất lượng texture — bắt buộc cho MỌI texture mới

`shared/textureQuality.ts` có 2 helper, chọn đúng loại:

- `applyColorTextureQuality(texture, gl)` — cho texture MÀU (surface, ring,
  skybox): gắn `SRGBColorSpace` + max anisotropy. Thiếu tag sRGB thì JPG bị
  sample như linear → màu nhạt/bệt (đây từng là bug thật toàn codebase).
- `applyDataTextureQuality(texture, gl)` — cho texture DỮ LIỆU (normal map,
  roughness, alpha/clouds): CHỈ anisotropy, **tuyệt đối không sRGB** (sRGB
  hoá data map sẽ bóp méo vector/độ nhám).

### Earth — ví dụ stack nhiều map trên 1 mesh

`SolarPlanet.tsx` khi entry có map phụ:

- `nightLightsTextureUrl` → `emissiveMap` + emissive trắng, intensity 0.75
  (đèn thành phố chỉ hiện phía đêm — three tự nhân với phần thiếu sáng).
- `cloudsTextureUrl` → **shell sphere riêng** bán kính ×1.02, `alphaMap`,
  quay nhanh hơn bề mặt ×1.35 → mây trôi lệch pha.
- `normalMapTextureUrl` → địa hình nổi khi ánh sáng xiên.
- `roughnessTextureUrl` → biển bóng/đất nhám. File gốc NASA là SPECULAR map
  nên đã **đảo màu** sẵn offline (specular → roughness) trước khi commit.

Hooks phải gọi vô điều kiện: map phụ nào không có thì load fallback
`?? textureEntry.textureUrl` rồi bỏ qua, không được `if` quanh `useLoader`.

### Bẫy UV đã gặp: RingGeometry

UV mặc định của `RingGeometry` là planar (tia từ tâm) trong khi texture vành
Saturn là dải RADIAL 1 chiều. Phải remap UV theo tỉ lệ bán kính —
`buildRadialRingGeometry(inner, outer)` trong `SolarPlanet.tsx`. Không remap
thì vân vành biến mất (bug đã fix ở commit `c903777`).

## Loại 2 — Custom shader points (bầu trời)

Toàn bộ bầu trời "chụp ảnh thiên văn" là 2 shader tự viết + 1 atlas texture
sinh procedural, KHÔNG có ảnh tải về:

- **`shared/SizedStarPoints.tsx`** — mỗi sao 1 hạt với attribute riêng
  (size/màu/twinkle). Fragment shader vẽ PSF 2 thành phần: lõi Gaussian
  `exp(-d²·16)` + quầng nghịch đảo bình phương `0.03/(d²+0.03)` có cửa sổ
  cắt, cộng gai nhiễu xạ (diffraction spikes) cho sao sáng qua
  `uSpikeStrength`. Thống kê sao thật: phân bố độ sáng theo cấp sao pdf ∝ 3^m,
  màu theo blackbody. Được tái dùng cho đuôi sao chổi.
- **`shared/nebulaCloudTexture.ts`** — atlas 768×256 gồm 3 variant mây fBm
  domain-warped (2 wispy + 1 ridged) sinh lúc runtime từ seed cố định; sprite
  mây chọn variant + xoay ngẫu nhiên seeded, chế độ "nhiều sprite alpha thấp".
- **`MilkyWayBand` / `ConstellationField`** — hình dạng dải Ngân Hà (vĩ độ
  band, Great Rift, bụi) và chòm sao đều đọc từ `scene.sky` do **BE sinh và
  lưu DB** (schemaVersion 1.1) — xem `agent-system/memory/archive/sky-db-and-realism-plan.md`.

Quy tắc riêng tầng sky: mọi material thuộc sky phải `fog={false}` —
`PointsMaterial`/`lineBasicMaterial` MẶC ĐỊNH bị fog ăn, sky ở bán kính xa sẽ
mờ đi ~35% nếu quên. Sky cũng phải `depthWrite={false}` + render order hợp lý
để không giành depth với object thật.

## Loại 3 — Procedural geometry (vành đai + sao chổi)

Nguyên liệu là `shared/seededNoise3d.ts`: value noise lattice-hash 3D tất
định theo seed + `fractalNoise3d` (fBm nhiều octave).

**Vành đai (`AsteroidBelt.tsx`)** — công thức "đá củ khoai":

1. Icosphere detail 3 → đẩy vertex dọc pháp tuyến theo fBm (amplitude 0.38)
   → scale lệch trục (elongation) → `computeVertexNormals()`.
2. Chỉ tạo **3 geometry variant**, mỗi variant 1 `InstancedMesh` ~366
   instance (tổng 1100) → 3 draw call cho cả vành đai.
3. Rải instance bằng `setMatrixAt`: góc đều, bán kính/độ cao Gaussian
   (Box-Muller từ PRNG seeded), scale power-law `min + range·u²` (nhiều viên
   nhỏ, ít viên to — đúng thống kê vành đai thật), màu `setColorAt` ±35%.
4. Cả group quay cứng 0.008 rad/s. Vị trí vành = orbit xa nhất + 1.7.

**Sao chổi (`Comet.tsx`)**: nhân là icosphere displaced, coma là sprite mềm,
2 đuôi là particle của `SizedStarPoints` sinh sẵn trong không gian local +Z
(đuôi bụi cong ấm 700 hạt + đuôi ion thẳng xanh 350 hạt); mỗi frame chỉ
`lookAt` để đuôi luôn quay lưng về Mặt Trời — không rebuild particle.

Ưu điểm của loại này: **0 byte download, đa dạng vô hạn theo seed**. Đây là
loại nên ưu tiên khi muốn thêm chi tiết mới.

## Loại 4 — GLB assets thật (NASA models)

### Nguồn và pipeline nén (làm offline, trước khi commit)

Nguồn: [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources)
(public domain; KHÔNG dùng logo/phù hiệu NASA — xem
`public/models/solar-system/ATTRIBUTION.md`). Mỗi model chạy qua:

```bash
npx @gltf-transform/cli optimize input.glb output.glb \
  --compress meshopt --texture-compress webp --texture-size 1024
```

**Chọn meshopt, KHÔNG Draco**: drei `useGLTF` decode meshopt native trong
bundle (~30KB), còn Draco mặc định fetch decoder ~700KB từ CDN Google — vi
phạm rule no-CDN. Kết quả thực tế: 5 model = ~1.78MB tổng.

### Catalog + chuẩn hoá kích thước

`solar-system/spacecraftCatalog.ts` là nơi khai báo model: tên, URL trong
`public/models/solar-system/`, và `targetSize`. Đơn vị của model NASA lệch
nhau tới ~200 lần, nên **luôn chuẩn hoá bằng bounding box**:

```ts
const boundingBox = new Box3().setFromObject(gltf.scene);
const scale = targetSize / Math.max(size.x, size.y, size.z);
```

### Quy tắc dùng GLB trong scene (checklist bắt buộc)

1. **`<Clone object={gltf.scene} />`** thay vì `<primitive>` — cho phép cùng
   model xuất hiện nhiều chỗ và không mutate cache của `useGLTF`.
2. **`useGLTF.preload(url)`** ở module scope cho mọi URL trong catalog.
3. **Bọc `<Suspense fallback={null}>` riêng** — world không bao giờ chờ
   satellite; model tự hiện khi tải xong.
4. **Tắt raycast bằng traverse** (`object.raycast = () => null`) — scenery
   không được chặn click vào hành tinh (DNA object).
5. **Bẫy model không có material**: Bennu ship KHÔNG material — phải traverse
   tint màu thủ công, nếu không nó trắng toát.
6. Chọn model theo seed: `randomFromSeed(seed + "-spacecraft")` → world nào
   cũng có "vệ tinh của riêng mình", tất định.
7. **Vật thể to phải đặt theo camera, không theo bán kính** — xem mục dưới.

### Đặt vật thể lớn: giải theo camera, không theo bán kính

Bug thật đã gặp (2026-08-02): hố đen rare đặt trên vòng bán kính 18, góc
azimuth random cả vòng, elevation cố định 7. Camera universe luôn ở
`[0, distance*0.42, distance]` với `distance ∈ [7, 12]` và nhìn về gốc qua
lens 50° → **phần lớn vòng đó nằm cạnh hoặc SAU lưng camera**. World thật
`WLD-DR3HMIJRZ2` có hố đen lệch trục 157°, tức ngay sau lưng người xem, trong
khi `RareFeatureBadge` vẫn ghi "Black Hole". Nhìn từ ngoài y như world bị mất
thông số khi share, dù seed và scene config hai trang giống nhau từng byte.

Quy tắc rút ra:

- Tham số hoá vị trí theo **hệ trục màn hình** (forward/right/up dựng từ vị
  trí camera), không theo góc world thô. `distantBlackHolePlacement.ts` là
  bản mẫu: depth tính từ gốc dọc trục nhìn, rồi offset trong mặt phẳng màn
  hình.
- Biên offset phải **trừ đi kích thước của chính model** (`targetSize / 2`)
  cộng lề, và đo bằng nửa chiều CAO khung với tỉ lệ khung vuông — viewport
  rộng hơn chỉ thêm chỗ, nên qua được vòng tròn nội tiếp là qua mọi cửa sổ.
  Chặn từng trục riêng sẽ để lọt góc chéo ra ngoài khung.
- Lens hẹp không được kẹp offset về 0 (dán vật thể vào trục nhìn, bị Sun che):
  đẩy depth ra xa cho đủ chỗ.
- Các con số camera của cảnh mở nằm ở `universeCameraFraming.ts`. Đừng copy
  chúng vào component — bản sao riêng chính là thứ đã cho hố đen trôi ra sau
  lưng camera.
- Invariant "nằm trong khung" phải là **unit test** trên nhiều seed và nhiều
  cấu hình camera (`distantBlackHolePlacement.test.ts`), không phải hằng số
  chỉnh tay.

### Gắn model vào object chuyển động

`OrbitingSpacecraft.tsx` KHÔNG couple vào `SolarPlanet`: nó đọc vị trí live
của hành tinh chủ (hành tinh energy cao nhất) qua `PlanetPositionTracker`
(Map chia sẻ mà mỗi planet ghi world-position mỗi frame). Pattern này dùng
lại được cho bất kỳ vật thể nào cần "bám theo" object khác.

## Tầng ánh sáng + hậu kỳ (áp lên cả 4 loại)

- **Rig 3 đèn**: pointLight ở Sun (key) + hemisphere tint palette (fill — mặt
  đêm hành tinh không đen kịt) + directional lạnh từ sau-trên (rim — tách
  silhouette khỏi nền). Đèn analytic gần như miễn phí.
- **IBL tự sinh** (`SpaceEnvironment.tsx`): `<Environment frames={1}>` render
  MỘT lần 2 `Lightformer` (rect ấm + fill lạnh) thành cubemap 128 —
  panel/gương vàng của spacecraft có thứ để phản chiếu. Không bao giờ dùng
  `preset` của drei (fetch HDR từ CDN).
- **fogExp2** density 0.012 tint theo background mood — orbit xa chìm dần vào
  không gian. Sky layers miễn nhiễm (`fog={false}`).
- **PostEffects** (`shared/PostEffects.tsx`): bloom CHỌN LỌC threshold 0.85 —
  chỉ vật tự đẩy màu HDR >1 (Sun ×1.5, sao) mới glow; vignette + film grain +
  chromatic aberration gộp 1 fullscreen pass; grade màu riêng từng theme qua
  `THEME_SCENE_GRADES`; MSAA 8.
- **AgX tone mapping** đặt ở `UniverseCanvas` (`gl.toneMapping`), dpr `[1,3]`.

## Checklist thêm model/asset mới

1. License rõ ràng (CC0 / public domain / CC BY + ghi công) và **tự host**
   trong `public/` — không CDN runtime.
2. Nén trước khi commit: texture đúng cỡ cần (8K chỉ cho vật chiếm nhiều màn
   hình), GLB qua meshopt+webp. Cập nhật `ATTRIBUTION.md` cùng thư mục.
3. Khai báo qua catalog file (không hardcode URL trong component), hằng số
   đặt tên cho mọi giá trị tune.
4. Texture màu → `applyColorTextureQuality`; data map → `applyDataTextureQuality`.
5. Mọi lựa chọn "ngẫu nhiên" → `randomFromSeed(seed + "-stream-mới")`,
   không đụng stream cũ.
6. Scenery → tắt raycast; vật phát sáng → cân nhắc màu HDR >1 +
   `toneMapped={false}` thay vì hạ bloom threshold.
7. Chạy đủ 4 gate FE: typecheck, lint, vitest, build.

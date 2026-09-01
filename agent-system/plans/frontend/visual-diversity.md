# Định hướng đa dạng hình ảnh và model Three.js

> **Document status:** Active after source re-baseline
> **Last source review:** 2026-07-19

Tài liệu này ghi current state sau khi các round Universe diversity và Forest
renderer đã land, rồi xếp hướng mở rộng dựa trên source, asset budget và nguồn
model có giấy phép rõ ràng.

## Baseline đã có trong source

Universe đã vượt qua hầu hết “thang đa dạng” cũ:

- scene config 1.2 có `belt`, `comets`, `sun`, `postFX.grade` và sky 1.1;
- catalog có 14 vai texture, phân bổ seeded không lặp trước khi hết pool;
- procedural gas giant, moon, ring, asteroid, comet và sky layers;
- rare features như binary sun và meteor shower;
- model NASA tự host cho spacecraft/asteroid;
- mọi lựa chọn ngẫu nhiên dùng stream seeded riêng.

Forest cũng đã là family thứ hai thật:

- schema 1.2, mùa/thời tiết/động vật/landmark/HDRI;
- 33 GLB tự host khoảng 6.7 MB và 3 HDRI khoảng 3.9 MB;
- instancing cho cây/decor, skeletal animation cho thú/chim, procedural terrain
  và particle;
- rare special bird/animal theo seed.

Vì vậy các câu cũ như “chưa có family thứ hai”, “gas giant/moon chưa làm”, hoặc
“HDRI chưa resolve” là lịch sử, không còn là backlog.

## Giới hạn hiện tại đọc trực tiếp từ source

1. Hai renderer được import tĩnh trong `registry.ts`; người chỉ xem Universe
   vẫn nhận code của Forest trong cùng graph client.
2. `public/textures/solar-system` khoảng 31.3 MB; tổng static 3D asset đã vượt
   mốc 40 MB từng được đề xuất làm trigger quality tiers.
3. Canvas chính cho DPR tới 3 và ghi rõ weak devices đang ngoài scope; chưa có
   adaptive DPR, LOD hay effect tier theo frame time.
4. Nature GLB nén Draco nhưng `useGLTF` chưa cấu hình decoder local. Drei mặc
   định tải decoder từ Google CDN, trái với mục tiêu runtime self-hosted.
5. Chưa có test duyệt toàn bộ catalog để bảo đảm file tồn tại, attribution tồn
   tại và size không vượt budget.
6. Universe scene config chưa có `sceneType: "solar-system"`; FE phải hiểu
   thiếu discriminator là Universe legacy.

## Format và kỹ thuật model nên chuẩn hoá

- **GLB/glTF 2.0 là format runtime mặc định.** Three.js `GLTFLoader` hỗ trợ
  Draco, Meshopt, KTX2/Basis, WebP, instancing và nhiều extension PBR:
  [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html).
- **Mesh compression:** dùng Meshopt khi muốn decoder nằm trong bundle; dùng
  Draco khi mesh hưởng lợi rõ, nhưng self-host decoder bằng
  `useGLTF.setDecoderPath(...)` hoặc path argument. Drei xác nhận decoder mặc
  định là CDN: [Drei useGLTF](https://drei.docs.pmnd.rs/loaders/gltf-use-gltf).
- **Texture compression:** đánh giá KTX2/Basis cho texture lớn; đừng chỉ nhìn
  dung lượng file, phải đo GPU memory và thời gian upload.
- **Repeated objects:** tiếp tục `InstancedMesh`; **far objects:** chuẩn bị LOD;
  **weak devices:** `PerformanceMonitor`/adaptive DPR. Đây là các pattern chính
  thức của R3F: [Scaling performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance).
- **Validation:** chạy glTF Validator/asset audit và một viewer độc lập trước
  khi đưa model vào catalog. Bộ [Khronos glTF Sample Assets](https://github.khronos.org/glTF-Assets/)
  phù hợp làm fixture interoperability, không phải kho sản phẩm mặc định; phải
  đọc license của từng asset.

## Model/scene family phổ biến và phù hợp với Myunivokai

### 1. City — family thứ ba đã được owner phê duyệt

Ngày 2026-07-19, owner chọn City và kiến trúc `city-service` độc lập. City cho
độ khác biệt lớn với Universe/Forest và map DNA tốt: skyline, district density,
traffic pulse, window warmth, neon/lantern ratio. Kế hoạch chi tiết nằm tại
[city-service-plan.md](../services/city-service-plan.md).

Nguồn phù hợp:

- [Quaternius Downtown City MegaKit](https://quaternius.com/packs/downtowncitymegakit.html):
  hơn 300 modular pieces, có glTF, CC0;
- [Kenney City Kit Commercial](https://kenney.nl/assets/city-kit-commercial) và
  [City Kit Suburban](https://www.kenney.nl/assets/city-kit-suburban): CC0,
  style đơn giản, dễ instance/LOD.

Hai nguồn trên phù hợp cho layout/contract prototype và placeholder có license
rõ, nhưng phong cách low-poly không mặc nhiên đạt yêu cầu final. Baseline City
ưu tiên đẹp, sắc nét và thực tế: final catalog cần art direction thống nhất,
PBR material, authored placement, hero landmark, coherent lighting/shadow/
reflection và visual review trên desktop. Mobile tier không chặn phase này;
nó chỉ bắt đầu sau khi City feature complete.

### 2. Room / personal gallery — phù hợp cho trải nghiệm gần gũi

Room có thể biến traits/interests thành bàn, sách, tranh, đèn và góc trưng bày.
[Kenney Furniture Kit](https://kenney.nl/assets/furniture-kit) có 140 asset CC0.
Đây là lựa chọn tốt cho prototype vì layout grammar rõ, nhưng khó đạt đẹp nếu
chỉ scatter ngẫu nhiên; cần authored slots như bàn sát tường, đèn cạnh ghế.

### 3. Mountain / lake / river — mở rộng trong `nature-service`

Đây là hướng ít tăng backend fleet nhất vì quyết định owner đã đặt các theme tự
nhiên dưới Nature. Nguồn:

- [Kenney Nature Kit](https://kenney.nl/assets/nature-kit): 330 asset CC0;
- [Quaternius Ultimate Nature Pack](https://quaternius.com/packs/ultimatenature.html):
  150 model CC0, nhưng bản pack liệt kê FBX/OBJ/Blend nên phải export/optimize
  GLB offline;
- Poly Haven cho HDRI/PBR hero assets; toàn bộ asset là CC0 theo
  [license chính thức](https://polyhaven.com/license).

Ưu tiên reuse forest catalog, terrain sampler và lighting; chỉ tách renderer
theo `sceneType` khi mountain/lake có contract khác thật, không tạo service mới.

### 4. Animated wildlife / avatar

[Quaternius Ultimate Animated Animal Pack](https://quaternius.com/packs/ultimateanimatedanimals.html)
có glTF, nhiều clip và CC0. Source Forest đã dùng cùng kiểu pipeline nên có thể
mở rộng species mà không đổi kiến trúc. Avatar người chỉ nên vào roadmap khi có
story điều khiển/identity rõ; character controller là một feature lớn, không
phải model swap.

### 5. High-realism hero props

[Poly Haven](https://polyhaven.com/) phù hợp cho vài hero prop/HDRI chất lượng
cao, không phù hợp để đưa hàng loạt model photogrammetry vào mobile scene.
Dùng cho landmark có ngân sách riêng, LOD và texture tier; không hotlink runtime.

## Thứ tự nâng cấp đã phê duyệt

1. P0: hoàn tất Next.js security migration và executable contracts.
2. P1: chốt executable City contracts, xây `city-service`, database và gateway
   route theo [city-service-plan.md](../services/city-service-plan.md).
3. P1: dựng City high-fidelity desktop baseline; asset prototype low-poly chỉ
   dùng để kiểm tra grammar, không quyết định chất lượng final.
4. P1: hoàn chỉnh renderer và create/view/regenerate/select/publish/share, rồi
   xác minh local/Render end-to-end.
5. Post-City: sau khi visual baseline được owner duyệt mới thêm adaptive DPR,
   LOD, texture/shadow/reflection/effect tiers cho mobile và máy yếu.
6. Sau City mới đánh giá breadth tiếp theo: mountain/lake, room hoặc species.

## Guardrails

1. AI sinh semantics; builder sinh visual numbers; renderer sinh pixels.
2. Không `Math.random()`/`Date.now()` trong scene identity.
3. Feature mới dùng PRNG stream mới và giữ world cũ render được.
4. Asset phải self-host, license rõ, attribution cập nhật và có budget.
5. Không tải asset/decoder từ CDN runtime nếu source không có explicit policy
   và fallback.
6. Không gọi City “optimized for broad devices” trước khi có device evidence.
   Bản high-fidelity đầu tiên có thể có support matrix desktop rõ ràng, nhưng
   vẫn phải có đường fallback an toàn khi WebGL/model load thất bại.
7. Vòng tối ưu sau không được làm desktop high tier giảm độ sắc nét hoặc lệch
   art direction đã duyệt.

Các acceptance criteria Given/When/Then nằm trong
[../user-stories/engineering-backlog.md](../backlog/engineering-backlog.md).

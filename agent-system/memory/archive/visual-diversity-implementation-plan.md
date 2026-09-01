# Kế hoạch triển khai "vẽ đa dạng hơn" — 5 rounds

> **Document status:** Archived historical implementation record
> **Last source review:** 2026-07-18

> Bản triển khai của định hướng
> [vision/visual-diversity.md](../../plans/frontend/visual-diversity.md) (thang 5 bậc).
> Ghi đủ chi tiết để nếu phiên làm việc đứt giữa chừng, phiên sau (hoặc người
> khác) đọc file này là tiếp tục được đúng chỗ.
>
> **Cách làm việc đã chốt với owner (2026-07-11)**: mỗi round = 1 branch =
> 1 PR vào `staging`. Claude code + commit local + 4 gates xanh → owner tự
> push, tự check bằng mắt, tự merge → owner nói "tiếp tục" thì mới sang round
> kế. Không code gối đầu round.
>
> **Thứ tự đã chốt với owner (2026-07-11)**: round FE-only đi trước, round
> cần BE dồn về cuối. Lý do: các round FE-only áp dụng HỒI TỐ — world cũ tự
> có feature mới vì mọi thứ rút từ seed lúc render; round BE thì chỉ world
> tạo SAU khi merge mới có section schema 1.2 trong DB. Đánh đổi chấp nhận:
> càng để round BE muộn, càng tích thêm world "thế hệ cũ" render bằng
> fallback (nhìn y như hiện tại, không hỏng gì).

## Trạng thái

> **Cập nhật 2026-07-11**: owner quyết định gộp R2+R3+R4 (toàn bộ phần
> FE-only còn lại) vào MỘT branch duy nhất
> `feat/fe/visual-diversity-fe-rounds`, mỗi round một commit riêng.
> Phần R4 liên quan BE (promote flag rare-feature vào schema) vẫn dời sang R5.

| Round | Branch | Bậc | Trạng thái |
| --- | --- | --- | --- |
| R1 — Procedural gas giants | `feat/fe/procedural-gas-giants` | 3 | **ĐÃ MERGE** (PR #57) |
| R2 — Moons + seeded rings | `feat/fe/visual-diversity-fe-rounds` | 3 | **CODE XONG** (`f364787`, gates xanh) — chờ owner duyệt mắt |
| R3 — Texture pool expansion | `feat/fe/visual-diversity-fe-rounds` | 2 | **CODE XONG** (`c1dc14a`, gates xanh) — chờ owner duyệt mắt |
| R4 — Rare sky events | `feat/fe/visual-diversity-fe-rounds` | 4 | **ĐÃ MERGE** (PR #59) |
| R5 — Scene diversity config (schema 1.2) | `feat/fe-be/scene-diversity-config` | 1 | **CODE XONG** (BE `4d58ef6` + FE `3b88d9f`, gates xanh) — chờ owner duyệt |

Thứ tự thực thi: R1 → R2 → R3 → R4 → R5. Các round KHÔNG phụ thuộc nhau về
kỹ thuật (stream PRNG riêng cho từng feature, file gần như không chạm chung)
— thứ tự này thuần túy là quyết định FE-trước-BE-sau của owner, đổi được nếu
owner mở scope BE sớm hơn.
Bậc 5 (scene family mới) KHÔNG thuộc chuỗi này — đi theo roadmap
[vision/README.md](../../plans/architecture/README.md), chặn bởi duyệt D1–D5.

## R1 — Procedural gas giants (`feat/fe/procedural-gas-giants`) — ĐÃ MERGE

Mục tiêu: một số hành tinh nhận bề mặt khí quyển dải mây SINH THEO SEED —
không world nào giống world nào — thay vì rút mãi từ pool 8 texture ảnh thật.

Cách làm (quyết định kỹ thuật):

1. **CanvasTexture equirectangular sinh CPU** (theo tiền lệ
   `shared/nebulaCloudTexture.ts`), KHÔNG viết ShaderMaterial riêng — lý do:
   texture cắm thẳng vào `meshStandardMaterial` nên toàn bộ pipeline sáng/tối
   ngày-đêm, rim/fill, fog, grade, bloom dùng lại nguyên vẹn, không phải
   tự viết lighting trong GLSL.
2. **Chống rách mép (seam)**: sample noise 3D trên mặt trụ —
   `noise(cos(longitude)·f, latitude·f_stretch, sin(longitude)·f)` — kinh độ
   0/2π tự khớp, không cần vá mép.
3. **Công thức bề mặt**: màu = ramp dải theo
   `latitude + turbulence·fbm(...)`; số dải, biên độ xoáy, độ tương phản,
   0–2 "bão" oval (kiểu Vết Đỏ Lớn) đều rút từ stream
   `randomFromSeed(seed + "-gas-giant-" + planetIndex)`.
4. **Màu từ DNA**: ramp dải sinh quanh `planet.color` (biến thiên
   lightness/saturation), không phá nhận diện màu của hành tinh.
5. **Luật gán vai**: hành tinh đủ lớn (theo size đã render) có xác suất
   seeded trở thành gas giant procedural; hành tinh nhỏ giữ texture ảnh.
   Ngưỡng + xác suất là hằng số đặt tên.
6. **Hooks vô điều kiện**: hành tinh procedural vẫn `useLoader` texture
   fallback như thường rồi bỏ qua (pattern có sẵn ở Earth maps).
7. **Tách phần pure**: hàm sinh "recipe" (tham số dải/bão từ seed) tách khỏi
   phần vẽ canvas → unit test determinism cho recipe (canvas không test được
   trong jsdom).
8. Độ phân giải texture: hằng số, khởi điểm 1024×512 (dải mây tần số thấp,
   không cần 8K); texture cache theo key seed+index để không sinh lại khi
   re-render.

Definition of done: 4 gates xanh; cùng seed → cùng hành tinh gas giant với
cùng hoa văn; world cũ đổi hình ở các hành tinh được gán vai (chấp nhận —
đây là feature thị giác FE, không phải data DB); owner duyệt bằng mắt.

## R2 — Moons + seeded rings (gộp trong `feat/fe/visual-diversity-fe-rounds`)

Quyết định kỹ thuật khi triển khai (commit `f364787`):

- `moonRecipe.ts` (pure, test được) + `ProceduralMoons.tsx` (bake geometry):
  0–3 moon cho hành tinh size render ≥ 0.5, stream `seed-moons-<index>`;
  recipe tự roll 30% không moon. Icosphere detail 2 displaced bằng fBm +
  hố thiên thạch tường minh (bowl + rim, tham số trong recipe). Moon là con
  của anchor tự quay → tidal lock miễn phí; nằm TRONG nhóm axial-tilt nên
  nghiêng theo hành tinh.
- `planetRingRecipe.ts` + `planetRingTexture.ts`: vành 12–24 dải màu
  desaturate từ DNA color, có khe Cassini (22%/dải), bake strip 256×4 map
  vào `buildRadialRingGeometry`; xác suất gán 22%, stream
  `seed-procedural-ring-<index>`, KHÔNG gán chồng vai Saturn (ring ảnh).
- Moon system dịch ra ngoài theo bán kính NGOÀI THỰC của ring (photo 2.2 /
  procedural theo recipe) + margin 0.35, nên moon không bao giờ cắt mặt
  phẳng ring kể cả recipe worst-case.
- Sau khi code xong đã chạy review 8 góc (line-by-line, removed-behavior,
  cross-file, reuse, simplification, efficiency, altitude, conventions) bằng
  agent độc lập; fixes gộp trong commit review-fixes: gộp 4 builder vai
  thành `buildPlanetRoleAssignments` (1 pass), memo `planets` ổn định,
  sanitize màu hex DNA, share `smoothstep`/`hexColorToRgbTriple` vào
  `shared/proceduralTextureMath.ts`, export hằng số scale từ Sun.tsx cho
  BinarySun, helper `resolveRareFeaturesForScene` chung cho badge.

1. Mặt trăng: 0–3 moon procedural cho hành tinh lớn — icosphere + crater
   noise (tái dùng `seededNoise3d`), group lồng trong planet anchor (pattern
   axial-tilt/spin sẵn có), stream `seed+"-moons-"+planetIndex`.
2. Moon KHÔNG ghi vào `PlanetPositionTracker` (không phải DNA object,
   không click-focus), tắt raycast.
3. Vành đai seeded cho hành tinh bất kỳ: xác suất seeded, texture vành 1D
   procedural theo palette (CanvasTexture nhỏ), dùng lại
   `buildRadialRingGeometry` (đã fix UV radial ở round visual-quality).
4. Cẩn trọng: hành tinh vai Saturn ĐÃ có ring texture ảnh — luật gán không
   được chồng ring procedural lên ring ảnh.

DoD: gates xanh; determinism; owner duyệt mắt.

## R3 — Texture pool expansion (gộp trong `feat/fe/visual-diversity-fe-rounds`)

Quyết định kỹ thuật khi triển khai (commit `c1dc14a`):

- Thêm 6 texture 2K: moon (8K tải về, downscale System.Drawing q85), ceres/
  eris/makemake/haumea (bản "fictional" của SSS) + venus atmosphere → pool
  8 thành 14. ATTRIBUTION.md đã cập nhật. Payload public/ = 31.6MB (< 40MB).
- "Seed rút không lặp" = `buildPlanetTextureAssignment`: Fisher-Yates shuffle
  catalog indices theo stream `seed-planet-texture-assignment` → mỗi world
  gặp pool theo thứ tự riêng (planet 0 không còn luôn là Earth), không lặp
  style cho đến khi dùng hết pool. World cũ đổi texture (chấp nhận, tiền lệ
  R1).
- Tint: entry có cờ `allowsPaletteTint` (chỉ 4 dwarf fictional) nhân
  `material.color` = DNA color pha 72% trắng (55% ban đầu bị owner chê "nhìn
  giả" — tint đậm biến texture thành bi phấn màu); Earth/moon/hành tinh nhận
  diện cao không tint.
- Feedback mắt của owner (2026-07-14), fix trong commit polish: (1) Earth
  loại khỏi lottery ring procedural (cờ `excludeFromProceduralRing` — Earth
  đeo vành nhìn như lỗi render); (2) belt chỉnh về tỉ lệ thật: đá nhỏ hơn
  (max 0.08 vs 0.13), tối hơn (albedo thấp, `#655B4F`), power 2.6 nghiêng
  về đá vụn, dải tãi rộng hơn (sigma 0.75), 1400 instance.

1. Tải bộ texture Solar System Scope chưa dùng (moon, ceres, eris, makemake,
   haumea…) — license CC BY 4.0, resize offline về 2K (script PowerShell
   System.Drawing như round trước), cập nhật
   `public/textures/solar-system/ATTRIBUTION.md`.
2. Thêm entry catalog → pool 8 thành 15+; seed rút không lặp.
3. Luật tint theo palette: `material.color` nhân màu — CHỈ cho hành tinh vai
   fiction, không tint Earth/hành tinh nhận diện cao.
4. Kiểm tổng payload: hiện ~27MB, trần đề xuất ~40MB trước khi bắt buộc làm
   quality tiers.

DoD: gates xanh; payload trong trần; ATTRIBUTION đủ.

## R4 — Rare sky events (gộp trong `feat/fe/visual-diversity-fe-rounds`)

Quyết định kỹ thuật khi triển khai (commit `ba7b716`):

- `rareFeatures.ts`: mỗi feature roll trên stream RIÊNG
  (`seed-rare-feature-<key>`) thay vì một stream chung như plan gốc — mạnh
  hơn: thêm/bớt/đổi thứ tự feature không làm lệch roll của feature khác.
  Test tần suất trên 1000 seed cố định (biên ±3.5σ).
- `MeteorShower.tsx` (5%): 6 vệt sao băng chu kỳ lệch pha, trail = particle
  tái dùng star PSF shader (SizedStarPoints), bay theo dây cung trên vòm
  trời bán kính 48.
- `BinarySun.tsx` (3%): sao lùn đỏ scale 0.34 quay quanh sun chính bán kính
  2.4 (trong quỹ đạo hành tinh đầu 3.2), pointLight yếu (10 vs 38) để key
  light không đổi.
- `RareFeatureBadge.tsx`: pill brass trên cả world page + share page, derive
  seed y hệt UniverseCanvas (mirror). UI tiếng Anh theo convention app.

1. Stream `seed+"-rare-features"` + bảng xác suất là hằng số đặt tên
   (RARE_FEATURE_PROBABILITIES).
2. Feature đầu tiên: mưa sao băng định kỳ (~5%) — particle streak tái dùng
   `SizedStarPoints`; binary sun (~3%) — sun thứ hai nhỏ quay quanh trọng
   tâm (cẩn trọng: pointLight thứ hai + bloom).
3. **Nhãn bắt buộc**: HUD/share page hiển thị tên feature hiếm user "trúng"
   — không nhãn thì feature hiếm vô nghĩa.
4. Nếu cần cross-surface tuyệt đối (BE biết world có binary sun để ghi vào
   share metadata) → promote flag vào schema 1.2, gộp vào R5 ngay sau đó.

DoD: gates xanh; xác suất kiểm bằng test trên 1000 seed cố định (đếm tần
suất trong khoảng cho phép); owner duyệt mắt.

## R5 — Scene diversity config, schema 1.2 (`feat/fe-be/scene-diversity-config`)

**Round duy nhất đụng BE — owner mở scope BE 2026-07-16.**
Làm y tiền lệ round sky-from-database (schema 1.1, xem
`agent-system/memory/archive/sky-db-and-realism-plan.md`).

Quyết định kỹ thuật khi triển khai (BE `4d58ef6`, FE `3b88d9f`):

- **KHÔNG cần DDL migration**: scene config nằm trong cột JSONB
  `world_variants.config` — thêm section chỉ là thay đổi payload JSON. Row cũ
  (schema 1.0/1.1) không bị đụng tới nhờ pointer + `omitempty`; đọc row cũ và
  serialize lại cũng KHÔNG inject key mới. Migration library đã có sẵn từ đầu
  (`pressly/goose/v3`, runner `internal/db/migrations.go`, Render chạy
  `/app/migrate` trước khi start API khi `RUN_MIGRATIONS_ON_START=true`) —
  round này không thêm file migration nào.
- **BE builder mới** `internal/services/diversity_scene_profile.go` (mirror
  FE: `clients/web-client/src/lib/scene.ts`): section `belt` (presence 85%,
  density 300–2500 scale theo mood particle multiplier, gap 1.3–2.2, 5 màu
  regolith tối, tilt ±0.12), `comets` (count 0–3 weighted 20/45/25/10, tail
  multiplier 0.7–1.4), `sun` (4 lớp nhiệt độ G/K/F/A weighted 45/25/20/10,
  HDR 1.35–1.65; lớp G tái tạo đúng hằng số pre-1.2), promote `postFX.grade`
  (bảng theme y hệt PostEffects cũ, KHÔNG PRNG — world 1.2 grade y hệt world
  cũ cùng theme). Stream riêng `seed+"-belt"/"-comets"/"-sun"` — draw order
  của mọi field cũ (kể cả sky) không xê dịch; test isolation guard trong
  `diversity_scene_profile_test.go`.
- **FE resolver theo tiền lệ MilkyWayBand** (clamp + fallback per-field, đặt
  trong file renderer): `resolveBeltConfig` (AsteroidBelt — enabled:false trả
  null cả belt lẫn Bennu qua wrapper component để không phạm luật hooks),
  `resolveCometsConfig` (export từ Comet.tsx, SolarSystemRenderer mount N
  comet), `resolveSunConfig` (Sun.tsx), `resolveSceneGrade` (PostEffects —
  bảng theme chuyển về `lib/scene.ts` export `sceneGradeForTheme` để cả
  preview lẫn fallback dùng chung một nguồn). MỌI fallback = đúng hằng số
  pre-1.2 → world cũ pixel-y-hệt.
- **Comet nhiều con**: comet index 0 giữ NGUYÊN tên stream cũ
  (`seed-comet-orbit/-nucleus/-dust-tail/-ion-tail`) và đúng 1 lần rút ở
  stream orbit → world cũ (fallback count=1) giữ nguyên sao chổi; comet 1–2
  bay xa hơn (+1.2/bậc) với mặt phẳng quỹ đạo rút từ stream riêng theo index.
  Tail multiplier nằm trong geometryKey vì nó đổi mảng particle.
- **Sun tint**: `new Color(surfaceTintColor).multiplyScalar(hdrMultiplier)` —
  default trắng ×1.5 ≡ `Color(1.5,1.5,1.5)` cũ từng bit. BinarySun (sao lùn
  đỏ rare event) không đổi.
- **Promote flag rare-feature vào schema: QUYẾT ĐỊNH BỎ** — chưa có nhu cầu
  cross-surface thật (badge + canvas đã derive chung qua
  `resolveRareFeaturesForScene`); BE muốn biết thì phải port xorshift FE sang
  Go, thêm một mirror-pair nữa không đáng. Mở lại khi share metadata cần.
- Contract `contracts/schemas/world-scene-config.schema.json` thêm
  belt/comets/sun/postFX.grade (đều NOT required); swagger regen
  (`swag init -g cmd/api/main.go -o docs --parseDependency --parseInternal`).

1. BE models: section `belt`, `comets`, `sun` + promote `postFX` grade —
   pointer + `omitempty`.
2. BE builder: sinh từ DNA + mood profile, stream riêng (`seed+"-belt"`,
   `seed+"-comets"`, `seed+"-sun"`); bump `schemaVersion` → `1.2`; cập nhật
   JSON schema contract; regen swagger
   (lệnh trong memory: `swag init` — xem note round sky).
3. BE tests: determinism + bounds.
4. FE types + resolver (`resolveBeltConfig`…): clamp + fallback = hằng số
   hiện tại → world 1.0/1.1 render y như cũ.
5. FE renderers đọc config: `AsteroidBelt` (có/không, mật độ 300–2500, bán
   kính, màu đá, độ nghiêng), `Comet` (số lượng 0–3, cỡ đuôi), `Sun` (tint
   nhiệt độ + cường độ HDR), `PostEffects` (grade từ config thay bảng theme).
6. FE preview mirror: mở rộng `buildPreviewSkyConfig` pattern → preview khớp
   world thật (mirror-pair discipline).
7. Nếu R4 đã cần promote flag rare-feature (binary sun…) vào schema thì gộp
   luôn vào round này.

DoD: gates BE (test + build) + 4 gates FE xanh; world cũ pixel-y-hệt
(fallback đúng); world mới tạo có section 1.2 trong DB.

## Guardrails chung (áp cho mọi round)

- Determinism: mọi biến thể từ `randomFromSeed(seed + "-stream-riêng")`;
  cấm `Math.random`/`Date.now` trong scene code.
- Stream PRNG mới cho feature mới — không làm lệch lần rút của feature cũ.
- Hằng số đặt tên cho mọi giá trị tune; không hardcode.
- Texture màu → `applyColorTextureQuality`; data map →
  `applyDataTextureQuality` (xem
  [fe/universe-render-mechanism.md](../../knowledge/frontend/universe-render-mechanism.md)).
- Scenery mới → `raycast={() => null}`.
- 4 gates FE sau mỗi cụm: typecheck, lint, vitest, build.
- Commit format `[ACTION][SCOPE][branch]: message` + trailer Co-Authored-By.

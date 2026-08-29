# City Service — kế hoạch triển khai

> **Platform amendment — 2026-07-22:** City remains an approved independent
> bounded context, but the HTTP peer/gateway steps in this document are
> superseded by [Vision V1 solution architecture](../architecture/v1-2026-07-22/solution-architecture.md). City is
> scheduled for Sprint 3 only after the Sprint 1 NATS/Redis/DNA migration and
> Sprint 2 hardening pass. Its deployment name is `myunivokai-city` (no
> `-worker` suffix), it consumes NATS commands/queries, and it receives canonical
> DNA snapshots from `dna-service` rather than owning another AI/DNA pipeline.

> **Read-model amendment — 2026-08-07:** a family service is now also an event
> publisher for the admin read model, and this is the easiest thing to forget
> because **nothing fails when you do** — City worlds simply never appear in
> the admin app. `city-service` must therefore, from its first migration:
>
> - carry `worlds.revision INTEGER NOT NULL DEFAULT 1`;
> - bump that revision and write a `world.changed` outbox row **inside the same
>   transaction** as every mutation (variant create, variant select, publish);
> - attach the world's first `contracts.WorldSnapshot` to its `completed` event
>   rather than publishing a separate one;
> - add `city` to `contracts.WorldFamily` and its `WorldChangedEventSubject()`;
> - copy `internal/repositories/world_snapshot.go` and
>   `world_snapshot_test.go` from `universe-service` — the test asserts every
>   mutating store method leaves an event behind, and is the only thing that
>   catches the omission.
>
> No stream or NATS ACL change is needed: the events stream and
> `analytics-service`'s consumer both filter on wildcards. See
> [analytics-service-plan.md](analytics-service-plan.md).

> **Document status:** Approved implementation plan
> **Last source review:** 2026-07-22

## 1. Quyết định sản phẩm và kiến trúc

Ngày 2026-07-19, owner chọn City là scene family thứ ba và chọn kiến trúc
`city-service` độc lập, không đặt City trong `nature-service`.

City là một stateful peer ngang hàng với Universe và Nature:

```txt
web-client
  -> api-gateway
       /api/universe/* -> universe-service -> universe database
       /api/nature/*   -> nature-service   -> nature database
       /api/city/*     -> city-service     -> city database
```

Gateway tiếp tục là public origin duy nhất mà frontend biết. `city-service` sở
hữu nghiệp vụ, dữ liệu, AI orchestration và scene contract của City; gateway
chỉ xác minh, áp policy và chuyển tiếp request.

Quyết định này không đồng nghĩa sao chép mù `universe-service`. City chỉ reuse
các pattern đã chứng minh phù hợp: Go + chi, pgxpool, provider abstraction,
semantic DNA, deterministic builder, lifecycle create/get/regenerate/select/
publish/share, gateway credential và health/readiness. Tên model, schema và
layout rules phải phản ánh domain đô thị.

## 2. Thứ tự ưu tiên: high-fidelity trước

Baseline đầu tiên nhắm tới desktop/laptop có WebGL2 ổn định. Mục tiêu là cảnh
City đẹp, sắc nét, có chiều sâu và thuyết phục về ánh sáng trước khi giảm chất
lượng để chạy trên mobile hoặc máy yếu.

Thứ tự bắt buộc:

1. đúng contract và deterministic;
2. hoàn chỉnh vòng đời backend và gateway;
3. đạt art direction high-fidelity trên desktop;
4. hoàn chỉnh create/view/regenerate/select/publish/share;
5. có visual review và regression evidence;
6. sau đó mới xây quality tiers, LOD sâu và tối ưu máy yếu/mobile.

Trong phase high-fidelity, không hạ texture, shadow, reflection hoặc post effect
chỉ để đạt một mobile budget chưa được yêu cầu. Tuy nhiên error boundary, asset
load failure và accessible fallback vẫn là yêu cầu an toàn cơ bản; “beauty
first” không có nghĩa để toàn trang crash.

### Definition of high-fidelity feature complete

City chỉ được coi là feature complete trước vòng tối ưu khi:

- một seed luôn tạo cùng layout, asset choices, ánh sáng và chuyển động;
- skyline, district, road, landmark và lighting đều phản ánh `CityDNA`;
- PBR materials, environment lighting, shadow, reflection và color grading
  cùng một art direction, không giống tập model rời rạc được scatter;
- hero buildings/landmarks đủ chi tiết khi camera ở khoảng cách trải nghiệm;
- cạnh công trình, texture và chữ/ánh sáng cửa sổ không mờ bất thường trên
  viewport desktop mục tiêu;
- create/view/regenerate/select/publish/share hoạt động qua gateway;
- scene cũ tiếp tục render sau deploy mới;
- screenshot/reference review được owner duyệt và có bộ visual regression cơ
  sở cho các phase tối ưu sau.

Thiết bị, viewport và GPU chuẩn phải được ghi lại khi bắt đầu implementation;
không ghi một FPS hoặc cấu hình phần cứng giả định vào acceptance criteria khi
chưa đo.

## 3. Domain contract dự kiến

Các tên dưới đây là planning boundary, chưa phải contract đã tồn tại trong
source. Phase C1 phải chốt JSON Schema/OpenAPI trước khi FE và BE triển khai
song song.

### `CityDNA` — semantic, không chứa thông số render

Những nhóm ý nghĩa cần biểu diễn:

- urban archetype và architectural character;
- density, verticality và mức độ trật tự/hữu cơ;
- social energy, movement rhythm và day/night character;
- district identities và landmark meaning;
- palette/mood tokens có thể chủ ý map sang các family khác;
- mobility character, weather mood và energy signature.

AI provider chỉ sinh semantic DNA đã validate. Không để AI sinh trực tiếp tọa
độ, polygon count, texture path, light intensity hoặc camera values.

### `CitySceneConfig` — deterministic render contract

Envelope tối thiểu phải có:

- `schemaVersion`;
- `sceneType: "city"`;
- seed/variant identity;
- environment và time/weather state;
- districts và layout graph;
- roads/paths;
- building/prop instances;
- landmarks;
- traffic/ambient movement;
- lighting, reflections và post-processing profile;
- camera/focus hints nếu thật sự thuộc scene contract.

Builder thuần nhận `(CityDNA, seed, variantNo, input)` và sinh config. Mỗi
feature ngẫu nhiên dùng named PRNG stream riêng để thêm field mới không làm đổi
world đã lưu.

## 4. Visual architecture high-fidelity

### Layout trước, model sau

City cần một layout grammar có chủ đích:

- district graph quyết định vùng thương mại, dân cư, công viên và landmark;
- road hierarchy quyết định trục chính, đường phụ và pedestrian space;
- authored placement rules giữ cửa ra vào, mặt tiền, vỉa hè, cây và props hợp
  lý;
- skyline composition có foreground, midground, background và hero landmark;
- density/height variation xuất phát từ DNA và seed, không scatter thuần túy.

### Asset pipeline

- Runtime format mặc định: GLB/glTF 2.0, asset và decoder tự host.
- Quaternius/Kenney CC0 phù hợp để kiểm tra layout và contract, nhưng style
  low-poly không mặc nhiên là final high-fidelity art direction.
- Final catalog cần PBR materials nhất quán, normal/roughness/metalness maps,
  texture resolution theo vai trò và license manifest rõ ràng.
- Poly Haven có thể cung cấp CC0 HDRI/PBR cho environment hoặc hero material;
  không hotlink asset lúc runtime.
- Asset phải đi qua glTF validation, scale/pivot/naming audit và visual review
  trước khi vào catalog.
- Repeated buildings, windows, street props và traffic vẫn nên dùng instancing;
  instancing là tổ chức GPU, không phải hạ chất lượng hình ảnh.

### Rendering baseline

High-fidelity baseline cần đánh giá:

- physically coherent environment/key/fill lighting;
- contact shadow và shadow hierarchy thay vì bật shadow đồng đều;
- tone mapping, exposure, fog/atmosphere và color grading có kiểm soát;
- reflection strategy cho kính, mặt đường ướt và nước nếu có;
- texture anisotropy và output resolution đủ giữ cạnh/chi tiết sắc nét;
- chuyển động giao thông/ambient có nhịp nhưng không phá determinism;
- camera path và focus point cho thấy skyline/landmark tốt nhất.

Không thêm screen-space effect chỉ vì “trông cinematic”. Mỗi effect phải có
reference, mục đích hình ảnh và screenshot so sánh trước/sau.

## 5. Các phase triển khai

### C0 — Prerequisites và contract alignment

Mục tiêu: City không nhân rộng contract debt hiện tại.

- hoàn thành executable scene contracts và public Gateway OpenAPI baseline;
- chốt `CityDNA`, `CitySceneConfig` và compatibility policy;
- tạo fixtures/golden scenes đại diện ít nhất cho nhiều density, mood và
  day/night combinations;
- chốt visual references và desktop review matrix.

Exit: schema validate được trong CI và FE có discriminated type cho `city`.

### C1 — `city-service` foundation

Mục tiêu: một Go peer độc lập, testable và chưa phụ thuộc renderer.

- module/service layout theo boundary của Universe/Nature;
- config, PostgreSQL/Neon migrations, repository và transactions;
- AI provider interface + mock provider cho test;
- deterministic city builder và output validation;
- lifecycle parity create/get/regenerate/select/publish/share;
- health/readiness, structured errors, request ID và gateway-key enforcement;
- Swagger/OpenAPI của peer và unit/integration tests.

Exit: service tests xanh, golden fixtures ổn định, direct business request thiếu
gateway credential bị từ chối.

### C2 — Gateway, local stack và Render blueprint

Mục tiêu: FE vẫn chỉ cần một gateway URL.

- thêm upstream City và `/api/city/*` theo cùng policy pattern hiện có;
- route-specific timeout/body/rate-limit policy dựa trên loại thao tác;
- aggregate readiness và failure taxonomy bao gồm City;
- thêm city database/service vào root Docker Compose và one-command workflow;
- thêm City vào `render.yaml`, environment matrix và deployment runbook;
- smoke test direct-peer protection và toàn bộ lifecycle qua gateway.

Exit: local và Render topology có bằng chứng; không có browser call trực tiếp
tới City peer.

### C3 — High-fidelity asset and scene foundation

Mục tiêu: khóa art direction trước khi nối toàn bộ UI.

- xây catalog/manifest với license và PBR roles;
- tạo authored modular block, district/road grammar và hero landmark;
- triển khai material, lighting, shadow, reflection, atmosphere và camera rig;
- duyệt screenshot ở các seed/mood/day-night fixtures;
- ghi baseline network size, GPU memory, draw calls và frame time để biết chi
  phí thực, nhưng chưa hạ art quality cho máy yếu.

Exit: owner duyệt high-fidelity vertical slice và catalog không còn asset tạm
không rõ license.

### C4 — City renderer và product flow

Mục tiêu: City là family thứ ba hoàn chỉnh trong sản phẩm.

- lazy City renderer entry trong scene registry;
- runtime validation trước khi render;
- create-page City selection và form semantics;
- view/regenerate/select/publish/share qua gateway;
- loading/error/empty states và share metadata;
- deterministic visual tests cùng visual regression baseline.

Exit: definition of high-fidelity feature complete ở mục 2 được thoả mãn.

### C5 — Production verification

Mục tiêu: phân biệt “code đã có” với “fleet đã được chứng minh”.

- CI đầy đủ cho ba Go peers, gateway và FE;
- local Docker smoke;
- Render/Neon migration và end-to-end smoke;
- logging/metrics không chứa raw input, AI output hoặc secrets;
- ghi commit SHA, thời điểm và kết quả kiểm tra.

Exit: City được đánh dấu `Verified`, không chỉ `Implemented`.

### C6 — Mobile và weak-device optimization, thực hiện sau cùng

Chỉ bắt đầu khi C4/C5 hoàn tất và visual baseline đã được khóa.

- đo device matrix thật, không suy luận từ user agent;
- thêm high/balanced/low tiers, adaptive DPR và hysteresis;
- tạo LOD/impostor/visibility strategy cho distant districts;
- tier shadow, reflection, post effects, traffic và texture delivery;
- giữ high tier giống visual baseline đã duyệt;
- kiểm tra mỗi tier không đổi seed, layout hoặc semantic identity;
- giữ fallback khi WebGL/model load thất bại.

Exit: weak devices cải thiện có số đo, còn desktop high tier không bị regression
về độ sắc nét hoặc art direction.

## 6. Branch/PR sequence đề xuất

Mỗi dòng là một concern, branch từ `staging`, merge lại `staging`:

1. `feat/repo/city-executable-contracts`
2. `feat/be/city-service-foundation`
3. `feat/be/city-generation-lifecycle`
4. `feat/be/city-gateway-routing`
5. `feat/repo/city-local-render-deployment`
6. `feat/fe/city-high-fidelity-scene`
7. `feat/fe/city-product-flow`
8. `feat/repo/city-production-verification`
9. `feat/fe/city-weak-device-optimization` — chỉ mở sau khi các branch trước đã
   hoàn tất và visual baseline được duyệt.

Không checkout implementation branch từ branch docs hiện tại. Sau khi PR docs
được merge vào `staging`, từng branch implementation phải checkout từ
`staging` mới nhất theo Git convention.

## 7. Không nằm trong scope City đầu tiên

- auth-service hoặc account system;
- multiplayer, editable city builder hoặc character controller;
- simulation kinh tế/dân cư;
- server-side mesh baking;
- một shared universal DNA chưa có product contract;
- mobile-first art direction hoặc buộc desktop asset xuống low-poly;
- tách một service mới cho từng district/theme.

Acceptance criteria Given/When/Then và task selection nằm tại
[../user-stories/engineering-backlog.md](../backlog/engineering-backlog.md).

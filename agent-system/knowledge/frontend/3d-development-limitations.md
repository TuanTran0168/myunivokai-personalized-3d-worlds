# Myunivokai — Giới hạn khi phát triển hình ảnh 3D (memo cho team)

> **Document status:** Reference memo — its room-demo references are historical
> **Last source review:** 2026-07-18

> Mục đích: giải thích **vì sao chất lượng hình ảnh 3D không thể "bật một nút" là đạt mức như các demo tham chiếu** (ví dụ *Summer Afternoon* — https://summer-afternoon.vlucendo.com), và **cái gì là giới hạn cứng (không tiền/thời gian nào giải được ở kiến trúc hiện tại) so với giới hạn mềm (đổi được bằng đầu tư)**. Viết sau khi thử một bản demo "room kit" và thấy kết quả chưa đạt kỳ vọng.

---

## 0. TL;DR

- Kiến trúc hiện tại **rất mạnh** cho việc sinh **vô số cảnh cá nhân hoá, độc nhất, rẻ, tái lập được** — nhưng **đánh đổi** đúng thứ tạo nên vẻ đẹp của các demo thủ công: **bàn tay nghệ sĩ**.
- Khoảng cách tới chất lượng *Summer Afternoon* **không phải là bài toán AI hay engineering** — nó chủ yếu là **asset 3D + art direction**. AI đã là phần rẻ và dễ nhất rồi.
- **AI không "gen ra tất cả rồi mình áp config"**. AI đóng vai **đạo diễn/trang trí** (chọn ý nghĩa, bố cục, màu), **không phải thợ dựng model**. Trần hình ảnh bị chặn bởi **thư viện model**, không phải bởi năng lực AI.
- Demo vừa rồi (nội thất ghép từ khối primitive) **chứng minh được đường ống chạy đúng**, nhưng **không thể** chứng minh được chất lượng cuối — vì ~80% cái đẹp nằm ở asset được model/texture tử tế + ánh sáng + bố cục, thứ mà primitive tự-ghép không với tới.

---

## 1. Hệ thống hiện hoạt động thế nào (bối cảnh)

```
Người dùng mô tả bản thân
   → AI sinh "Personality DNA" (CHỈ ngữ nghĩa: tên, ý nghĩa, năng lượng, slot…)
   → Builder deterministic (KHÔNG gọi AI) + seed ngẫu nhiên
   → WorldSceneConfig (mọi con số 3D: vị trí, kích thước, tốc độ…)
   → Renderer vẽ cảnh (universe = hệ mặt trời; room = nội thất)
```

Ba nguyên tắc bất biến, là **thế mạnh cốt lõi** của sản phẩm:

1. **AI chỉ sinh ngữ nghĩa.** Mọi số 3D suy ra deterministic từ seed.
2. **Regenerate không gọi AI.** Cùng seed → cùng cảnh; đổi seed → cảnh khác, tức thì, gần như miễn phí.
3. **Mỗi người một cảnh độc nhất**, sinh tự động, chi phí ~0.

Chính ba điều này tạo ra **căng thẳng nền tảng** với mục tiêu "đẹp như đồ thủ công" (mục 2).

---

## 2. Căng thẳng cốt lõi: "sinh tự động & độc nhất" ⟷ "thủ công & tinh xảo"

| | *Summer Afternoon* (tham chiếu) | Myunivokai (của chúng ta) |
|---|---|---|
| Cách tạo | Nghệ sĩ **dựng tay từng chi tiết**, cố định | **Sinh tự động** theo seed |
| Số lượng cảnh | **Một** cảnh duy nhất, ai xem cũng như nhau | **Vô hạn** cảnh, mỗi người khác nhau |
| Nguồn "đẹp" | **Công sức nghệ sĩ** (model, texture, bố cục, ánh sáng tinh chỉnh thủ công) | Thuật toán + seed |
| Chi phí mỗi cảnh | Rất cao (giờ công nghệ sĩ) | ~0 |
| Tái lập / cá nhân hoá | Không cần (chỉ 1 cảnh) | Là lý do tồn tại của sản phẩm |

**Hai hướng này kéo ngược nhau.** Mỗi bước tiến về phía "tinh xảo như thủ công" đều phải trả bằng **công sức nghệ sĩ** hoặc **giảm tự do sinh tự động**. Không có bữa trưa miễn phí.

---

## 3. Giới hạn #1 — Trần hình ảnh bị chặn bởi ASSET + ART DIRECTION, không phải AI

Tách bạch hai trục độc lập:

- **Hình khối vật lý (mesh 3D)** — *cái gì* hiện trên màn hình. **Bị chặn bởi thư viện model đang có.** AI không nặn ra mesh mới lúc chạy.
- **Ngữ nghĩa + bố cục + màu + ánh sáng** — vật nào là nét tính cách nào, đặt đâu, màu gì, sáng ấm cỡ nào. **Trục này AI mở** hoàn toàn.

→ Nói gọn: **AI là người trang trí, không phải thợ mộc.**

### Phổ chất lượng hình ảnh (từ thấp đến cao)

| Cách | Trần đẹp | Deterministic? | Công sức | Ghi chú |
|---|---|---|---|---|
| Primitive thô (box/cầu) | Rất thấp | ✅ | ~0 | Trạng thái ban đầu |
| **Primitive tự-ghép** (demo vừa rồi) | Thấp–TB | ✅ | Thấp | Đủ để thấy *cách làm*, **không đủ đẹp** |
| **Kit GLB CC0** (Kenney/Quaternius) | TB–Cao | ✅ | TB (tìm/tối ưu asset) | Đúng chất demo tham chiếu |
| Model đặt riêng (bespoke) | Cao | ✅ | Cao (cần nghệ sĩ 3D) | Gần tham chiếu nhất |
| AI nặn mesh lúc chạy | "Vô hạn" nhưng lộn xộn | ❌ | Cao + chậm + tốn | **Xa mục tiêu hơn** (mục 4) |

### Vì sao demo primitive tự-ghép chưa đẹp

Vẻ đẹp của *Summer Afternoon* đến từ, theo thứ tự quan trọng: **(1) asset được model + texture có chủ đích → (2) ánh sáng/bóng/hậu kỳ tinh chỉnh → (3) bố cục do người sắp → (4) độ chi tiết mesh.** Primitive tự-ghép chỉ chạm được phần (2) và một phần (3); **không thể** thay thế (1). Ghế/bàn ghép từ hộp trông vẫn là "hộp khéo hơn", không phải đồ nội thất thật.

→ Demo **chứng minh được đường ống** (dispatch scene-type, layout deterministic, click-to-focus, không phá universe, có sẵn "điểm swap" sang GLB). Nó **không thể** chứng minh chất lượng cuối — đó là giới hạn của primitive, không phải của công sức.

### Ngay cả khi dùng GLB thật cũng có trần

- **Biến thể là tổ hợp từ tập hữu hạn.** Vài chục model × màu × scale × cách sắp = hàng triệu phòng khác nhau *về tổ hợp*, nhưng **vốn từ vựng hình khối** vẫn cố định.
- **"Trông có chủ đích" không tự có.** Rải model ngẫu nhiên → trông lộn xộn. Phải ràng đặt vào **lưới bố cục được thiết kế** (giường sát tường, bàn dưới cửa sổ…). Đây là công thiết kế + code, **cho từng loại scene**.

---

## 4. Giới hạn #2 — Kỳ vọng "AI gen ra tất cả" chưa khả thi

Runtime text-to-3D (AI nặn mesh theo mô tả) **có tồn tại**, nhưng với dự án này nó:

- **Phá 2 bất biến cốt lõi**: không còn deterministic (cùng seed ≠ cùng cảnh), và regenerate **buộc gọi AI** (đắt + chậm) thay vì tức thì/miễn phí.
- **Chậm & tốn**: mỗi vật vài chục giây tới vài phút + phí API mỗi lần. Dựng cả phòng on-demand = chờ lâu, hoá đơn cao.
- **Khó đồng nhất phong cách**: mỗi mesh sinh ra một kiểu → cảnh lệch tông.
- **Trớ trêu**: cái look thủ công sạch sẽ kia **chính là thứ AI-mesh hiện chưa làm được** — nó cho topology bẩn, tỉ lệ lệch. Đi hướng này **xa mục tiêu thẩm mỹ hơn**, không gần hơn.

→ Vai trò tin cậy của AI ở đây là **đạo diễn/trang trí**, không phải **thợ dựng model**.

---

## 5. Giới hạn #3 — Coherence & art direction không tự có (chi phí lặp lại cho MỖI scene)

Cảnh đẹp vì **con người sắp đặt**: tỉ lệ, hoà sắc, khoảng trống, điểm nhấn, tâm trạng ánh sáng. Sinh tự động phải **mã hoá những điều này thành luật** (layout grammar, ràng buộc palette, preset ánh sáng) — và vẫn khó bằng một nghệ sĩ làm thủ công một lần.

Quan trọng cho lộ trình "my country / my house / my room…": **mỗi scene type lặp lại toàn bộ chi phí này** — bộ asset riêng, lưới bố cục riêng, ánh sáng riêng, tương tác riêng. **Không phải "tái dùng miễn phí".** Kiến trúc cho phép cắm thêm scene dễ dàng (đó là điểm mạnh), nhưng **nội dung nghệ thuật của mỗi scene vẫn phải làm lại**.

---

## 6. Giới hạn #4 — Ràng buộc nền tảng (web + three.js)

- **Ngân sách hiệu năng WebGL**: số đa giác, draw calls, shadow map, hậu kỳ đều ăn frame-time. Máy yếu / mobile bị giới hạn thật sự (code đã phải hạ số hạt, shadow, post cho mobile).
- **Trọng lượng asset**: GLB thêm nhiều MB → cần nén (Draco/meshopt), lazy-load, màn hình chờ.
- **Không phụ thuộc mạng ngoài**: một số môi trường deploy không cho tải CDN (ví dụ HDR environment) → **mọi asset phải tự host**.
- **Mobile** là mẫu số chung thấp nhất — thường quyết định trần chất lượng có thể bật mặc định.

---

## 7. Giới hạn #5 — Mô hình tương tác

- Hiện tại: camera **orbit + click-to-focus** (bấm vật → bay tới → đọc DNA). Đã thống nhất giữ.
- **Nhân vật đi lại** (như demo tham chiếu) là **một trục riêng, rất nặng**: character controller + animation + va chạm + camera bám, và **đổi hẳn UX**. Không phải một toggle — là một khối việc lớn nếu muốn thêm sau.

---

## 8. Giới hạn CỨNG vs MỀM

**Giới hạn cứng** (kiến trúc/bản chất — không mua được bằng tiền ở thiết kế hiện tại):
- Sinh-tự-động **về bản chất** khó đạt độ tinh xảo của thủ-công-một-lần.
- Muốn giữ deterministic + regenerate-không-AI ⇒ **không** dùng được AI-mesh runtime.
- Trần hình khối bị chặn bởi thư viện model tại thời điểm chạy.

**Giới hạn mềm** (đổi được bằng đầu tư):
- Chất lượng asset → tiền/thời gian cho nghệ sĩ 3D hoặc công curate pack CC0.
- Độ "được thiết kế" → công art direction + layout grammar.
- Hiệu năng/mobile → công tối ưu.
- Mỗi scene type mới → công lặp lại (asset + renderer + tương tác).

---

## 9. Các hướng đi & đánh đổi trung thực

| Hướng | Công sức | Độ gần tham chiếu | Ghi chú |
|---|---|---|---|
| **A. Stylized tối giản** — dồn vào ánh sáng/hậu kỳ/palette, hình khối đơn giản | Thấp | Thấp–TB | Rẻ, "có gu" nhưng không phải mức tham chiếu |
| **B. Kit GLB CC0 + lưới bố cục + 1 lượt art-direction** | TB | TB–Cao | Bước nhảy thật; vẫn là tổ hợp hữu hạn |
| **C. Asset đặt riêng + art director chuyên trách** | Cao | Cao | Gần tham chiếu nhất; chậm & tốn |
| **D. Định vị lại sản phẩm** — giá trị là *cá nhân hoá + ý nghĩa*, không phải đồ hoạ AAA | Rất thấp | (đổi kỳ vọng) | Truyền thông theo thế mạnh thật |
| ~~E. AI-mesh runtime~~ | Cao | Bấp bênh/thấp | **Không khuyến nghị** (mục 4) |

---

## 10. Khuyến nghị

1. **Nếu muốn nâng chất thật sự**: chọn **B** — nối kit GLB CC0 (Kenney/Quaternius) vào đúng "điểm swap" đã có sẵn, thêm lưới bố cục được thiết kế + một lượt tinh chỉnh ánh sáng/hậu kỳ. Đây là mức "đáng đồng tiền" nhất.
2. **Nếu ngân sách hạn chế**: **A** cho ra kết quả "có gu" với chi phí thấp; kèm **D** để kỳ vọng khớp thực tế.
3. **Đặt kỳ vọng đúng với team/khách**: **mức *Summer Afternoon* = đầu tư hạng C** (nghệ sĩ + art direction chuyên trách). Đó là một dự án nghệ thuật, không phải một tính năng bật/tắt.
4. **AI không phải nút thắt.** Đừng kỳ vọng "AI gen đẹp hơn". Nút thắt là **asset + art direction**, và đó là chỗ cần đổ nguồn lực nếu muốn đẹp.

---

## 11. Demo vừa rồi chứng minh & KHÔNG chứng minh điều gì

- **Đã chứng minh (đường ống chạy tốt):** dispatch theo scene-type, layout deterministic từ seed, registry renderer, click-to-focus tái dùng nguyên, **universe không hề bị ảnh hưởng**, và có sẵn **điểm swap sang GLB** (đổi 1 hàm là lên model thật).
- **Không (và không thể) chứng minh:** chất lượng hình ảnh cuối — vì đó là giới hạn của primitive, cần asset thật + art direction mới vượt qua.

*Ghi chú kỹ thuật: bản demo nằm ở nhánh `demo/fe/room-kit`, chưa merge. Điểm swap sang GLB là hàm `FurnitureForSlot` trong `clients/web-client/src/features/scene-renderers/room/kit/furniture.tsx`.*

# Hướng Dẫn Triển Khai Backend Gộp 1 Container Trên Render ("Trick")

> **Trạng thái:** Nghiên cứu + build artifact cục bộ đã xong
> (`deploy/single-container/`). **Chưa deploy thật lên Render dưới dạng 1
> service gộp** — tài liệu này là hướng dẫn từng bước để làm điều đó, không
> phải xác nhận nó đã chạy.
> **Đọc trước:** `deploy/single-container/README.md` — phần research giải
> thích vì sao Hugging Face Spaces bị loại (Docker SDK giờ trả phí), vì sao
> Koyeb bị loại (bị Mistral AI mua lại tháng 2/2026, dashboard đang giữa quá
> trình sáp nhập, không còn đáng tin để phụ thuộc), và vì sao câu trả lời
> thực ra nằm sẵn trong `render.yaml` chứ không cần rời khỏi Render.

## 0. "Trick" ở đây là gì

`render.yaml` hiện khai báo **8 service riêng biệt**, mỗi service một khối
`type: web` / `runtime: docker` / `dockerfilePath` trỏ vào
`Dockerfile.prod` của chính service đó (`myunivokai-gateway`, `-dna`,
`-universe`, `-nature`, `-ocean`, `-auth`, `-analytics`, `-telemetry`). Mỗi
service này là **một container Render riêng**, và cả 8 dùng chung một hạn
mức 750 giờ/tháng của tài khoản — chia 8 phần.

`deploy/single-container/` đã build sẵn một Dockerfile khác: gộp cả 8 tiến
trình đó (`api-gateway`, `dna`, `universe`, `nature`, `ocean`, `auth`,
`analytics`, `telemetry`) chạy qua `supervisord` bên trong **một** image
duy nhất. Vì Render vốn đã hỗ trợ `runtime: docker` với `dockerfilePath`/
`dockerContext` tuỳ ý (chính là cách 8 service hiện tại đang chạy), việc
"gộp" này không cần rời khỏi Render — chỉ cần tạo **thêm một Web Service**
trỏ vào `deploy/single-container/Dockerfile` thay vì tạo tài khoản ở nền
tảng khác. Kết quả: hạn mức 750 giờ chia cho **1** thay vì **8**, và chuỗi
"đánh thức service này để nó đánh thức service kia" gộp thành một lần thức
duy nhất — vì cả 8 tiến trình đã luôn chạy cùng lúc trong cùng container.

Vì mọi thứ vẫn nằm trên Render, **không cần tạo Neon database mới, không
cần Upstash mới, không cần Synadia NATS user mới** — dùng lại chính xác
những gì 8 service hiện tại đang dùng (copy giá trị từ tab Environment của
từng service cũ sang service gộp mới). Đây là điểm khác biệt lớn nhất so
với hướng dẫn deploy-sang-nền-tảng-khác đã bị bỏ.

## 1. Việc cần chuẩn bị: hầu như không có gì mới

### 1.1. Neon Postgres — dùng lại 7 database đã có

Không tạo database mới. Vào Render dashboard, mở tab **Environment** của
từng service hiện tại (`myunivokai-dna`, `-universe`, `-nature`, `-ocean`,
`-auth`, `-analytics`, `-telemetry`) và copy `DATABASE_URL` +
`DATABASE_DIRECT_URL` của mỗi service — đây chính là giá trị sẽ dán vào
service gộp mới ở bước 3, chỉ đổi tên biến (`DNA_DATABASE_URL`,
`UNIVERSE_DATABASE_URL`, ... — xem `.env.example` để biết tên chính xác
từng service).

Nếu `myunivokai-analytics` trên Render chưa có `DATABASE_URL` thật (service
mới, có thể vẫn đang để trống theo cảnh báo "BEFORE MERGING THIS TO main"
trong `render.yaml`), phải điền nó ở đó **trước**, vì service gộp sẽ cần
cùng giá trị.

### 1.2. Upstash Redis — dùng lại 1 instance đã có

Copy `REDIS_URL` từ tab Environment của `myunivokai-gateway` (hoặc
`myunivokai-auth`, cùng giá trị) — không tạo Upstash instance mới.

### 1.3. Synadia Cloud NATS (NGS) — dùng lại, nhưng cách lấy nội dung khác

Production hiện dùng chung 1 Synadia user, nội dung file `.creds` không
nằm trực tiếp trong tab Environment dạng text — nó được mount qua nhóm
biến dùng chung `myunivokai-shared-env` (Secret File `nats.creds`), liên
kết thủ công qua dashboard cho từng service (xem comment trong
`render.yaml` gần khối `myunivokai-analytics`/`myunivokai-telemetry`).

Hai lựa chọn cho service gộp mới:

- **(Khuyến nghị cho lần deploy đầu)** Lấy lại file `.creds` gốc từ Synadia
  Cloud dashboard (Account → Users → tải lại `.creds` của user hiện có —
  không cần tạo user mới), mở bằng text editor, copy toàn bộ nội dung dán
  vào biến `NATS_CREDS_CONTENT` — đúng cơ chế `docker-entrypoint.sh` đã
  build sẵn, không phụ thuộc việc liên kết Secret File có đúng hay không.
- **(Việc nên làm sau khi deploy thành công lần đầu)** Liên kết service gộp
  mới vào nhóm `myunivokai-shared-env` có sẵn qua dashboard, rồi bỏ hẳn
  `NATS_CREDS_CONTENT`/bước ghi file trong `docker-entrypoint.sh` — xem
  `deploy/single-container/README.md` mục "Why an entrypoint script writes
  the NATS credentials file" để hiểu vì sao chưa làm ngay từ đầu.

### 1.4. Khoá ký JWT cho Auth Service

⚠️ **Không dùng lại** `AUTH_ACCESS_PRIVATE_KEY` hiện có trên
`myunivokai-auth` — nếu service gộp mới chạy song song với `myunivokai-auth`
cũ trong giai đoạn chuyển tiếp (mục 4), hai service ký token bằng cùng khoá
là chấp nhận được (cùng token vẫn hợp lệ ở cả hai), nhưng một khi
`myunivokai-auth` cũ bị gỡ, khoá cũ nên được coi là của service gộp luôn —
không sinh khoá mới trừ khi muốn buộc mọi người dùng đăng nhập lại. Nói
cách khác: copy y nguyên giá trị `AUTH_ACCESS_PRIVATE_KEY` từ
`myunivokai-auth` hiện tại sang, không chạy lại `openssl rand -base64 32`.

---

## 2. Tạo Service Gộp Trên Render

### 2.1. (Khuyến nghị) Build + smoke-test cục bộ trước

```bash
# Từ thư mục gốc repo — bắt buộc, vì mọi go.mod phụ thuộc contracts/go
# (và telemetry-service phụ thuộc contracts/rust) ở đường dẫn tương đối cố định.
docker build -f deploy/single-container/Dockerfile -t myunivokai-services-single .

# Copy deploy/single-container/.env.example thành deploy/single-container/.env,
# điền giá trị thật lấy từ bước 1 (KHÔNG commit file .env này).
# NATS_CREDS_CONTENT truyền riêng bằng -e vì --env-file của Docker là
# line-based, không giữ được value nhiều dòng — đặt nội dung file .creds vào
# deploy/single-container/.env.nats-creds (cũng bị .gitignore chặn):
docker run --rm -p 8080:8080 \
  --env-file deploy/single-container/.env \
  -e NATS_CREDS_CONTENT="$(cat deploy/single-container/.env.nats-creds)" \
  myunivokai-services-single
curl http://localhost:8080/api/v1/healthz
```

Chạy được cục bộ với thông tin thật gần như đảm bảo Render build cùng
Dockerfile cũng chạy được — khác biệt chính là mạng (Render outbound tới
Neon/Upstash/Synadia thường không bị chặn, vì 8 service hiện tại đã chứng
minh điều đó rồi).

### 2.2. Tạo Web Service mới trên Render dashboard

1. Trong **cùng** Render account/team đang chạy 8 service hiện tại (không
   cần tổ chức mới), bấm **New → Web Service**.
2. Kết nối cùng repo Git đang dùng cho 8 service kia.
3. Cấu hình:
   - **Runtime:** Docker
   - **Dockerfile Path:** `./deploy/single-container/Dockerfile`
   - **Docker Build Context Directory:** `.` (thư mục gốc repo — bắt buộc,
     lý do giống hệt `dockerContext: .` của mọi service khác trong
     `render.yaml`)
   - **Plan:** Free (giống 8 service hiện tại)
   - **Port:** không cần chỉnh tay — `EXPOSE 8080` trong Dockerfile cộng
     `PORT` mặc định Render tự cấp đã khớp; `docker-entrypoint.sh` đọc
     `PORT` từ môi trường Render set sẵn.
4. Đặt tên dễ phân biệt, ví dụ `myunivokai-single` — tránh trùng tên với 8
   service hiện tại vẫn đang chạy song song trong giai đoạn kiểm chứng
   (mục 4).

### 2.3. Điền biến môi trường

Copy từng dòng trong `deploy/single-container/.env.example` vào tab
**Environment** của service mới. Nguồn của từng nhóm biến (đối chiếu bước 1):

| Biến | Nguồn |
| --- | --- |
| `NATS_URL` | `tls://connect.ngs.global:4222`, giữ nguyên |
| `NATS_CREDS_CONTENT` | Nội dung file `.creds` lấy lại từ Synadia (bước 1.3) |
| `REDIS_URL` | Copy từ `myunivokai-gateway` hiện tại (bước 1.2) |
| `API_ALLOWED_ORIGINS` | Copy từ `myunivokai-gateway` hiện tại |
| `ADMIN_ROUTES_ENABLED` / `ADMIN_ALLOWED_ORIGIN` / `ADMIN_ACCESS_PUBLIC_KEYS` | Copy từ `myunivokai-gateway` hiện tại nếu `myunivokai-admin` đã hoạt động |
| `*_DATABASE_URL` / `*_DATABASE_DIRECT_URL` (×7) | Copy từ Environment tab của từng service tương ứng (bước 1.1) |
| `AI_PROVIDER`, `GEMINI_API_KEY`, `OPENAI_API_KEY` | Copy từ `myunivokai-dna` hiện tại |
| `UNIVERSE_PUBLIC_WEB_URL` / `NATURE_PUBLIC_WEB_URL` / `OCEAN_PUBLIC_WEB_URL` | Copy từ service tương ứng hiện tại |
| `AUTH_ACCESS_PRIVATE_KEY` | Copy nguyên từ `myunivokai-auth` hiện tại (bước 1.4 — **không** sinh khoá mới) |
| `TELEMETRY_OTLP_ENDPOINT`, `TELEMETRY_DASHBOARD_URL` | Copy từ `myunivokai-telemetry` hiện tại |

⚠️ Thiếu một biến KHÔNG bắt buộc (ví dụ `GEMINI_API_KEY` khi
`AI_PROVIDER=mock`) không kéo sập cả container —
`docker-entrypoint.sh` default mọi biến optional về rỗng trước khi
supervisord đọc, nên thiếu chỉ khiến MỘT tiến trình báo lỗi rõ ràng của
riêng nó (xem `deploy/single-container/README.md` mục "Why
docker-entrypoint.sh defaults every optional variable").

### 2.4. Deploy

Bấm **Create Web Service**. Lần build đầu chậm (biên dịch 7 Go module + 1
Rust crate từ đầu). Theo dõi log build; nếu fail thường là lỗi Dockerfile
path/context (mục 2.2), biến môi trường chỉ ảnh hưởng lúc chạy chứ không
ảnh hưởng lúc build.

---

## 3. Xác Minh Sau Khi Deploy

### 3.1. Health check

```bash
curl https://<ten-service-moi>.onrender.com/api/v1/healthz
# Kỳ vọng: {"service":"Myunivokai API Gateway","status":"ok"}
```

Nếu container không "healthy": một trong bảy service worker có thể
crash-loop vì thiếu biến (log của service đó nói rõ tên biến thiếu) —
gateway vẫn trả lời healthz bình thường vì các tiến trình độc lập, nên
"container unhealthy" và "một service con crash-loop" là hai việc khác
nhau, đọc log để phân biệt.

### 3.2. Đọc log tách theo từng service

Mỗi tiến trình ghi log JSON có field cố định (`level`, `time`, `message`,
`subject` với các service qua NATS) ra `stdout`/`stderr` riêng, nhưng
Render gộp log của cả container thành một luồng — lọc theo service bằng
`message` gốc, ví dụ tìm `"dna message processed"` để chỉ xem log dna.

### 3.3. Kiểm tra migration đã chạy

```bash
# Dùng DATABASE_DIRECT_URL của từng database (giống hệt giá trị đang dùng
# cho 8 service hiện tại — không đổi database nào cả):
psql "$DNA_DATABASE_DIRECT_URL" -c "\dt"
```

### 3.4. Kiểm tra pipeline NATS đầu-cuối

```bash
nats --creds nats.creds --server tls://connect.ngs.global:4222 \
  request myunivokai.queries.telemetry.overview.get.v1 \
  '{"jobId":"manual-check","timestamp":"2026-08-22T15:00:00Z","data":{"hours":24}}'
```

Trả về JSON có `chartsAvailable` nghĩa là telemetry-service (và cả đường
truyền NATS) đang sống.

---

## 4. Chuyển Đổi: Chạy Song Song Trước Khi Gỡ 8 Service Cũ

Vì service gộp mới dùng **cùng** database/NATS user/Redis với 8 service cũ,
chạy cả hai cùng lúc trong lúc kiểm chứng là an toàn — cả hai đọc/ghi cùng
dữ liệu, không có phân kỳ trạng thái. Trình tự khuyến nghị:

1. Deploy service gộp mới (mục 2), **chưa** trỏ `myunivokai-web` (Vercel)
   vào nó — vẫn trỏ vào `myunivokai-gateway` cũ.
2. Test thủ công bằng cách gọi thẳng URL Render của service gộp
   (`https://<ten-service-moi>.onrender.com/...`), không qua traffic thật.
3. Khi đã tin tưởng, đổi `NEXT_PUBLIC_GATEWAY_BASE_URL` trên Vercel sang URL
   service gộp, redeploy `myunivokai-web`. Đồng thời cập nhật
   `API_ALLOWED_ORIGINS` trên service gộp khớp domain Vercel thật.
4. Theo dõi vài ngày traffic thật chạy qua service gộp ổn định.
5. Chỉ khi đó mới **Suspend** (không xoá ngay, để còn rollback được) từng
   service cũ trong số 8 (`myunivokai-gateway`, `-dna`, `-universe`,
   `-nature`, `-ocean`, `-auth`, `-analytics`, `-telemetry`) — hạn mức
   750 giờ/tháng chỉ thực sự được giải phóng sau bước này.
6. Sau một chu kỳ billing không có sự cố, xoá hẳn 8 service cũ và dọn khối
   tương ứng khỏi `render.yaml`.

---

## 5. Troubleshooting

Phần lớn lỗi ở đây **giống hệt** `production-deployment-guide.md` §6 vì
cùng codebase, cùng Neon/Upstash/Synadia — đọc mục đó trước (`Authorization
Violation`, `max ack pending`, `outbox_messages does not exist`,
auth-service thiếu biến). Dưới đây chỉ liệt kê phần khác biệt riêng của
việc gộp 1 container.

### 5.1. Một service báo thiếu biến, bảy service còn lại vẫn chạy bình thường

Hành vi **đúng như thiết kế** — xem `deploy/single-container/README.md`
mục "Why docker-entrypoint.sh defaults every optional variable". Đọc log
của đúng service đó (mục 3.2), sửa đúng biến nó cần, Render tự redeploy khi
sửa biến môi trường qua dashboard.

### 5.2. `PORT` bị trùng giữa các tiến trình con

Sáu trong bảy worker Go tự bind một health server nội bộ trên `$PORT`, mặc
định `:8080` nếu biến trống. `supervisord.conf` đã gán cứng mỗi worker một
`PORT` khác nhau (8082-8087, telemetry dùng 8081) — nếu tự thêm tiến trình
thứ chín, tránh dải cổng này và 8080 (dành cho gateway/Render).

### 5.3. Container build xong nhưng khởi động chậm / Render coi là unhealthy quá sớm

Tám tiến trình cùng mở kết nối NATS + sáu migration Postgres chạy gần như
đồng thời trên một instance duy nhất — chưa đo trên Render thật. Nếu health
check timeout trước khi container kịp sẵn sàng: (a) tăng health check grace
period nếu Render có tuỳ chọn, (b) tạm nâng lên plan trả phí để xác nhận
đây đúng là vấn đề tài nguyên trước khi quyết định ở lại Free tier.

### 5.4. Cần trỏ `myunivokai-web` (Vercel) sang service gộp mới

Xem mục 4, bước 3 — đổi `NEXT_PUBLIC_GATEWAY_BASE_URL` và
`API_ALLOWED_ORIGINS` cùng lúc, sai một trong hai khiến CORS chặn ở bước
preflight, không phải lỗi backend.

# Hướng Dẫn Triển Khai Lên Môi Trường Production (Production Deployment Guide)

> **Cập nhật lần cuối:** 2026-08-22 (thêm mục 5.8-5.15: toàn bộ sự cố thật gặp phải khi deploy đồng loạt `auth`/`ocean`/`analytics`/`telemetry` và bật `ADMIN_ROUTES_ENABLED` lên production)
> **Trạng thái:** Active. Phần gốc (gateway/dna/universe/nature) đã Tested trên
> Production; phần `myunivokai-auth` (mục 2.4, Service 5, 5.7) và phần
> `myunivokai-analytics` (Service 6) là hướng dẫn mới theo `render.yaml`,
> **chưa có bằng chứng deploy thật** — xác nhận và xoá dòng này sau lần deploy
> đầu tiên.

Tài liệu này hướng dẫn chi tiết từng bước (step-by-step) cách cấu hình và triển khai (deploy) toàn bộ hệ thống Microservices của dự án MyUnivokai lên các nền tảng đám mây (Cloud).

---

## 1. Tổng quan Kiến Trúc Hệ Thống

Dự án MyUnivokai được cấu thành từ 5 thành phần cốt lõi phân tán trên nhiều nền tảng:

1. **Frontend (Vercel):** Ứng dụng Next.js.
2. **Backend (Render):** Hệ thống gồm 6 Microservices viết bằng Go (`api-gateway`, `dna-service`, `universe-service`, `nature-service`, `auth-service`, `analytics-service`). Tất cả được deploy dưới dạng `Web Service` để tối ưu chi phí (sử dụng gói Free của Render). ⚠️ Giờ giới hạn instance của gói Free được tính chung cho cả tài khoản — **kiểm tra ngân sách còn lại trước khi thêm service thứ 6**.
3. **Database (Neon.tech):** Cơ sở dữ liệu PostgreSQL Serverless (gồm 5 database độc lập — `myunivokai_dna`, `myunivokai_universe`, `myunivokai_nature`, `myunivokai_auth`, `myunivokai_analytics`).
4. **Cache & Rate Limit (Upstash):** Dịch vụ Redis Serverless — `auth-service` cũng dùng chung instance này để ghi `tokenVersion` cho cơ chế revocation, không cần Redis riêng.
5. **Message Broker (Synadia Cloud - NGS):** Mạng lưới NATS JetStream đảm nhiệm việc giao tiếp không đồng bộ (asynchronous messaging) giữa các Microservices. `auth-service` chỉ dùng Core NATS request-reply (không JetStream), nên dùng chung `nats.creds` như các service khác mà không cần quyền `$JS.API.>`. `analytics-service` thì ngược lại: nó tạo một durable consumer riêng trên stream `MYUNIVOKAI_EVENTS`.

> ℹ️ **Về phân quyền NATS:** tất cả service dùng **chung một account user** qua một file `nats.creds` duy nhất, tức trên NGS **không có allow-list publish nào** — user đó toàn quyền trong account. File `infra/nats/nats-server.conf` (phân quyền chi tiết từng service) chỉ áp dụng cho NATS chạy local. Hệ quả cần biết: luật "analytics-service không được publish subject domain nào" được **ACL bảo đảm ở local, nhưng ở production chỉ có code bảo đảm**. Nếu sau này bạn cấu hình permission riêng từng user trên Synadia, mọi user có consumer đều cần **`$JS.ACK.>`** bên cạnh `$JS.API.>` — ack một message JetStream là publish vào prefix đó, thiếu nó thì message redeliver vô hạn và chỉ hiện ra dưới dạng dòng log `permissions violation`, không bao giờ crash lúc khởi động.

---

## 2. Hướng Dẫn Chuẩn Bị Tài Nguyên Từng Bước

### Bước 2.1: Thiết lập Database trên Neon.tech
Hệ thống sử dụng mô hình Database-per-service. Bạn cần tạo 5 database riêng biệt.
1. Đăng nhập vào [Neon.tech](https://neon.tech/) và tạo một Project mới (Ví dụ: `myunivokai-db-prod`).
2. Vào mục **Databases**, tạo lần lượt 5 database:
   - `myunivokai_dna`
   - `myunivokai_universe`
   - `myunivokai_nature`
   - `myunivokai_auth`
   - `myunivokai_analytics` — read model của admin. Đây là **bản sao thứ hai của dữ liệu production**, nên phải là database riêng: không thứ gì trong luồng sản phẩm đọc nó, và chỉ event consumer của `analytics-service` ghi vào nó.

   > Nếu giới hạn số Project của Neon chặn bạn, đặt `analytics` và `auth` **cùng một project** dưới dạng hai database tách biệt — đừng gộp chung một database.
3. Vào mục **Dashboard** -> **Connection Details**:
   - Tích chọn **Pooled connection** (để dùng PGBouncer). Copy chuỗi kết nối (thường có `?sslmode=require`). Đây chính là `DATABASE_URL`.
   - Bỏ tích **Pooled connection**. Copy chuỗi kết nối trực tiếp. Đây là `DATABASE_DIRECT_URL` (dùng để chạy Migration).

### Bước 2.2: Thiết lập Redis trên Upstash
1. Đăng nhập vào [Upstash](https://upstash.com/) và tạo một Redis Database mới (Ví dụ: `myunivokai-redis-prod`).
2. Kéo xuống mục **Connect to your database** ở trang Dashboard.
3. Chuyển sang tab **Redis CLI** hoặc **URI**. Copy toàn bộ chuỗi URL bắt đầu bằng `rediss://...`. Đây chính là `REDIS_URL`.

### Bước 2.3: Thiết lập NATS JetStream trên Synadia Cloud (NGS)
> ⚠️ **CẢNH BÁO QUAN TRỌNG:** 
> Synadia cung cấp 2 loại chứng thực: 
> 1. Personal Access Token (bắt đầu bằng `nhg_...`): Chỉ dùng để gọi REST API (HTTP).
> 2. File Credentials (`.creds`): Chứa NKey Seed và User JWT. **BẮT BUỘC PHẢI DÙNG FILE NÀY** để kết nối các Go Microservices thông qua giao thức TCP của NATS.

1. Đăng nhập vào Synadia Cloud.
2. Tạo Account, sau đó tạo một User mới (Ví dụ: `myunivokai_prod_user`).
3. Tải file thông tin xác thực về máy tính (file sẽ có đuôi là `.creds`). Mở file này bằng trình soạn thảo văn bản (Notepad/VS Code), bạn sẽ thấy cấu trúc gồm `-----BEGIN NATS USER JWT-----` và `-----BEGIN USER NKEY SEED-----`. Giữ nguyên nội dung này cho bước sau.

### Bước 2.4: Sinh khoá ký JWT cho Auth Service

`auth-service` ký access token bằng Ed25519, không dùng secret dạng chuỗi tuỳ ý
— xem `notes/vision/auth-and-admin-plan.md#tokens`. Sinh một seed 32-byte,
base64-encode, cho biến `AUTH_ACCESS_PRIVATE_KEY`:

```bash
openssl rand -base64 32
```

> ⛔ **KHÔNG dùng lại giá trị trong `.env.local`/`.env.example` của repo** —
> đó là khoá throwaway chỉ dùng cho Docker Compose local, không có giá trị bảo
> mật nào ở production. Sinh khoá mới cho mỗi environment (production,
> staging nếu có), lưu vào **Render Dashboard**, không lưu vào bất kỳ file
> nào trong repo hay gửi qua kênh chat/email không mã hoá.

---

## 3. Cấu Hình Biến Môi Trường Dùng Chung (Environment Groups) Trên Render

Vì cả 6 Go Services đều cần kết nối chung vào NATS, để tránh cấu hình lặp lại nhiều lần, chúng ta sẽ tạo một nhóm biến môi trường dùng chung.

1. Đăng nhập vào [Render Dashboard](https://dashboard.render.com).
2. Ở cột menu bên trái, chọn **Env Groups** -> Bấm **New Environment Group**.
3. Đặt tên là: `myunivokai-shared-env`.
4. Kéo xuống phần **Secret Files**:
   - Bấm **Add Secret File**.
   - Tại ô **Filename**: Nhập chính xác tên `nats.creds`.
   - Tại ô **Contents**: Dán toàn bộ nội dung của file `.creds` mà bạn đã tải từ Synadia ở Bước 2.3.
5. Cuộn lên phần **Environment Variables**, thêm các biến sau:
   - Khóa: `NATS_URL` | Giá trị: `tls://connect.ngs.global:4222`
   - Khóa: `NATS_CREDENTIALS` | Giá trị: `/etc/secrets/nats.creds`
   > ⛔ **Lưu ý:** Tuyệt đối KHÔNG khai báo biến `NATS_USERNAME` và `NATS_PASSWORD`.
6. Bấm **Create Environment Group**.

---

## 4. Triển Khai Backend Lên Render (Render Blueprint)

Hệ thống đã được thiết kế sẵn file `render.yaml` (Infrastructure as Code). Khi bạn push code lên GitHub, Render sẽ tự động nhận diện và tạo ra 6 Web Services.

### Bước 4.1: Liên kết (Link) Environment Group
1. Lần lượt bấm vào từng Service trên Render Dashboard (`myunivokai-gateway`, `myunivokai-dna`, `myunivokai-universe`, `myunivokai-nature`, `myunivokai-auth`, `myunivokai-analytics`).
2. Chuyển sang tab **Environment**.
3. Ở mục **Linked Environment Groups**, bấm **Link** và chọn nhóm `myunivokai-shared-env`. Bấm Save.

### Bước 4.2: Điền Các Biến Môi Trường Đặc Thù Cho Từng Service
Vẫn ở tab **Environment** của từng Service, điền các giá trị đặc thù sau vào mục **Environment Variables** (Các biến này đã được khai báo sẵn khung trong `render.yaml`, bạn chỉ cần điền giá trị):

#### 🚀 Service 1: API Gateway (`myunivokai-gateway`)
- `API_ALLOWED_ORIGINS`: `https://myunivokai.vercel.app` (Lưu ý: Không có dấu `/` ở cuối).
- `REDIS_URL`: Dán chuỗi kết nối Upstash Redis từ Bước 2.2.

#### 🚀 Service 2: DNA Service (`myunivokai-dna`)
- `DATABASE_URL`: Dán chuỗi kết nối Pooled của database `myunivokai_dna` (Bước 2.1).
- `DATABASE_DIRECT_URL`: Dán chuỗi kết nối Direct của database `myunivokai_dna`.
- `GEMINI_API_KEY`: API Key của nền tảng AI Google Gemini.
- `OPENAI_API_KEY`: API Key của nền tảng AI OpenAI.

#### 🚀 Service 3: Universe Service (`myunivokai-universe`)
- `DATABASE_URL`: Dán chuỗi kết nối Pooled của database `myunivokai_universe`.
- `DATABASE_DIRECT_URL`: Dán chuỗi kết nối Direct của database `myunivokai_universe`.
- `PUBLIC_WEB_URL`: `https://<web-origin>/universe` — **có** hậu tố `/universe`,
  đối xứng với nature. Trang share của universe là `/universe/share/worlds/{slug}`.

#### 🚀 Service 4: Nature Service (`myunivokai-nature`)
- `DATABASE_URL`: Dán chuỗi kết nối Pooled của database `myunivokai_nature`.
- `DATABASE_DIRECT_URL`: Dán chuỗi kết nối Direct của database `myunivokai_nature`.
- `PUBLIC_WEB_URL`: `https://<web-origin>/nature` — **có** hậu tố `/nature`, vì
  trang share của forest nằm dưới prefix đó: `/nature/share/worlds/{slug}`.

#### 🚀 Service 5: Auth Service (`myunivokai-auth`)
- `DATABASE_URL`: Dán chuỗi kết nối Pooled của database `myunivokai_auth`.
- `DATABASE_DIRECT_URL`: Dán chuỗi kết nối Direct của database `myunivokai_auth`.
- `REDIS_URL`: Dán **cùng** chuỗi kết nối Upstash Redis đã dùng cho gateway ở
  Bước 2.2 — `auth-service` chỉ ghi một key (`tokenVersion`) vào đó, không cần
  instance Redis riêng.
- `AUTH_ACCESS_PRIVATE_KEY`: Dán giá trị đã sinh ở Bước 2.4. **Không** dùng
  chung giá trị giữa các environment, và không copy giá trị trong
  `.env.local` của repo (khoá đó chỉ dùng cho Docker Compose local).
- Các biến `AUTH_ACCESS_TOKEN_TTL`, `AUTH_REFRESH_TOKEN_TTL`,
  `AUTH_TOKEN_VERSION_CACHE_TTL`, `AUTH_ARGON2_*`, `AUTH_MAX_FAILED_ATTEMPTS`,
  `AUTH_LOCKOUT_DURATION` đã có `value` mặc định ngay trong `render.yaml`
  (không phải `sync: false`) — không cần điền thêm, trừ khi muốn đổi.

#### 🚀 Service 6: Analytics Service (`myunivokai-analytics`)
- `DATABASE_URL`: Dán chuỗi kết nối Pooled của database `myunivokai_analytics`.
- `DATABASE_DIRECT_URL`: Dán chuỗi kết nối Direct của database
  `myunivokai_analytics`. Bắt buộc phải là host **không pooled** (không có
  `-pooler`): goose lấy advisory lock khi migrate, mà transaction pooler không
  giữ lock đó xuyên suốt các câu lệnh.
- Không có biến nào khác cần điền. Service này **không xác thực token, không
  gọi provider nào, và không publish event nào** — nên nó không có
  `REDIS_URL`, không có khoá ký, không có API key. Nếu thấy một credential
  xuất hiện ở đây thì đó là dấu hiệu read model đã làm việc nó không được
  phép làm.

> ⚠️ **`analytics-service` sẽ crash-loop nếu deploy trước khi tạo database.**
> Khác với các service khác, nó là service mới hoàn toàn: `render.yaml` khai
> báo sẵn nhưng `DATABASE_URL` là `sync: false`. Tạo database ở Bước 2.1 và
> điền hai biến trên **trước** khi merge lên `main`.

> ℹ️ **Lần khởi động đầu tiên tự backfill một phần.** Stream
> `MYUNIVOKAI_EVENTS` giữ 7 ngày với `discard: old`, và một durable consumer
> mới mặc định `DeliverAll` — nên analytics sẽ tự chiếu lại toàn bộ những gì
> stream còn giữ, miễn phí. Ngoài cửa sổ 7 ngày đó thì không có backfill nào
> khác: một sự cố dài hơn 7 ngày là mất dữ liệu vĩnh viễn, đã được chấp nhận
> ở mức dữ liệu hiện tại. Khi thấy lỗ hổng trong read model, hãy nghĩ tới
> retention trước, đừng nghĩ tới hỏng dữ liệu.

> 🔒 **Admin routes vẫn tắt cho tới khi bạn bật.** `render.yaml` để
> `ADMIN_ROUTES_ENABLED=false` trên gateway, nên các màn hình analytics chưa
> truy cập được. Muốn bật thì đổi thành `true` **và** điền
> `ADMIN_ALLOWED_ORIGIN` bằng đúng origin của admin app. Bật với origin rỗng
> hoặc wildcard sẽ fail config validation và làm **cả gateway** không khởi
> động được — kể cả các route sản phẩm.

> 🔑 **Tạo tài khoản super-admin đầu tiên sau khi deploy xong.**
> `auth-service` không có đường tự đăng ký (self-signup). Sau khi service
> `myunivokai-auth` chạy thành công (xem log "auth service ready"), mở
> **Shell** của service đó trên Render Dashboard và chạy:
> ```bash
> ./bootstrap --email you@example.com --password "mot-mat-khau-manh-it-nhat-12-ky-tu"
> ```
> Đây là lệnh **thủ công, chạy một lần duy nhất**. Không đưa email/mật khẩu
> vào biến môi trường của `render.yaml` hay bất kỳ file nào trong repo — xem
> `notes/vision/auth-and-admin-plan.md#passwords` (không có mật khẩu mặc định
> nào trong repo, kể cả cho production).

> 🚨 **BẮT BUỘC ĐỔI TRƯỚC/CÙNG LÚC VỚI KHI DEPLOY BẢN NÀY — quên là link share
> universe chết.** Trước đây universe **không** có hậu tố; giờ hai service dùng
> chung một dạng `<web-origin>/<family>`. Cả hai đều `sync: false` trong
> `render.yaml`, nên **phải nhập tay trên Render dashboard** — sửa file này
> không tự cập nhật service đang chạy.
>
> Route cũ `/share/worlds/{slug}` đã bị **xoá hẳn**, không còn redirect (quyết
> định của owner: không giữ link share cũ). Hệ quả:
>
> - Nếu universe-service còn `PUBLIC_WEB_URL` **không có** `/universe`, nó sẽ in
>   ra `shareUrl` trỏ tới route không tồn tại → **404**.
> - Mọi `shareUrl` **đã lưu trong database universe** từ trước bản này cũng trỏ
>   vào route đã xoá → các link share cũ **sẽ 404**. Đây là đánh đổi đã được
>   chấp nhận, không phải lỗi.

Sau khi lưu lại, Render sẽ tự động tiến hành build Docker image từ các file `Dockerfile.prod` và khởi động các services. 

---

## 5. Database Migrations (Tự Động Chạy Khi Service Khởi Động)

> **Cập nhật 2026-07-26:** Phiên bản trước của tài liệu này yêu cầu chạy `go run cmd/migrate/main.go` thủ công.
> - Lý do trước đây phải chạy tay: Render Free tier không hỗ trợ `preDeployCommand`.
> - Từ commit `7aa4053`, mỗi service (`dna-service`, `universe-service`, `nature-service`) tự gọi `db.Migrate(...)` ngay trong `cmd/service/main.go`.
> - Lệnh migrate chạy trước khi service kết nối pool và trước khi start messaging runtime.
> - Migrate dùng `DATABASE_DIRECT_URL`, fallback về `DATABASE_URL` nếu biến đó thiếu.
> - Nếu migrate lỗi, service gọi `log.Fatal` và không start. Đây là fail-fast, thay cho việc chạy ngầm với bảng thiếu.
>
> **Cập nhật 2026-08-06:** `auth-service` (`cmd/service/main.go`) theo đúng
> cùng pattern — tự migrate `myunivokai_auth` trước khi kết nối pool, dùng
> `DATABASE_DIRECT_URL`/`DATABASE_URL` giống hệt 3 service kia. Ngoài migrate,
> nó còn tự đồng bộ (sync) bảng `permissions` và seed role `basic_user` mỗi
> lần khởi động — xem `internal/services/permission_sync.go`. Đây không phải
> migration SQL, không cần thao tác gì thêm từ operator.
>
> **Cập nhật 2026-08-07:** `analytics-service` theo đúng cùng pattern. Hai
> migration mới cũng đi kèm bản này ở phía family service:
> `universe-service` và `nature-service` đều thêm cột
> `worlds.revision INTEGER NOT NULL DEFAULT 1`. Trên PostgreSQL 11+, `ADD
> COLUMN` với DEFAULT không đổi là thao tác **chỉ sửa metadata** — không
> rewrite bảng, nên không có downtime dù bảng đã có dữ liệu production.

Điều kiện tiên quyết duy nhất: `DATABASE_DIRECT_URL` phải được điền đúng trên Render cho cả 5 service (dna, universe, nature, auth, analytics — theo Bước 4.2). Khi điều kiện đó được đáp ứng, migrate chạy tự động mỗi lần deploy. Không còn bước thủ công nào cần thực hiện.

Binary `cmd/migrate/main.go` vẫn tồn tại độc lập, dùng cho debug hoặc chạy migrate ngoài luồng deploy:
```bash
cd services/dna-service   # hoặc universe-service / nature-service / auth-service / analytics-service
set DATABASE_DIRECT_URL="postgres://..." # (hoặc export trên Mac/Linux)
go run cmd/migrate/main.go
```

---

## 6. Các Chú Ý Quan Trọng & Xử Lý Sự Cố (Troubleshooting)

### 5.1. Lỗi Xác Thực NATS (`nats: Authorization Violation`)
- **Triệu chứng:** Xem log trên Render thấy gateway hoặc các service khác báo lỗi này liên tục rồi crash.
- **Cách xử lý:** 99% nguyên nhân là do bạn đang cố dùng Personal Access Token (`nhg_...`) thay vì file `.creds`. Hoặc bạn gõ sai tên biến môi trường (Ví dụ: gõ là `NATS_CREDENTIALS_FILE` trong khi code Go chỉ đọc `NATS_CREDENTIALS`). Hãy rà soát lại thật kỹ Bước 3.

### 5.2. Lỗi Giới Hạn Pull Subscriptions (`consumer max ack pending exceeds system limit`)
- **Triệu chứng:** DNA, Universe, Nature kết nối được NATS nhưng báo lỗi không thể tạo Consumer do vượt quá hạn mức 25,000 của hệ thống.
- **Cách xử lý:** Đây là hạn chế của tài khoản Synadia Free. Code đã được vá bằng cách thêm cờ cứng `nats.MaxAckPending(1000)` vào mọi lời gọi `PullSubscribe()` (Commit `661903b`). Tuyệt đối không xóa các dòng cấu hình này trong các file `internal/messaging/runtime.go`.

### 5.3. Giới Hạn Thời Gian Miễn Phí (750 Giờ/Tháng Của Render)
- **Hiện tại `healthCheckPath` đang TẮT cho toàn bộ service trong `render.yaml`** — kể cả gateway (dòng bị comment). Không service nào bị Render ping định kỳ, nên không service nào bị giữ thức.
  - Trước đây mục này ghi gateway bật `healthCheckPath` và ngốn 744 giờ/tháng. Điều đó không còn đúng; ghi lại đây thay vì xoá, vì con số 744 giờ vẫn là thứ sẽ xảy ra nếu ai đó bật lại.
- 750 giờ/tháng dùng chung cho cả tài khoản, trong khi một service thức 24/7 đã tốn ~730 giờ. Nghĩa là **không đủ ngân sách để giữ thức dù chỉ một service**, chứ chưa nói tới sáu.
- Đó chính là lý do cron/keep-alive định kỳ bị loại, và tại sao cơ chế đánh thức theo nhu cầu là phương án duy nhất vừa ngân sách: nó gọi đúng một lần cho mỗi service đang ngủ trong mỗi cửa sổ khoá, do request thật kích hoạt, rồi để service ngủ lại. Xem `notes/vision/service-wake-mechanism.md`.
- Vẫn nên giám sát Free Hours nếu chưa nâng gói. Mô hình microservices phân mảnh khiến tài khoản Free cạn rất nhanh.

### 5.4. Lỗi `relation "outbox_messages" does not exist` + `prepared statement name is already in use` (DNA/Universe/Nature)
- **Triệu chứng:**
  - Outbox publisher loop báo lỗi bảng không tồn tại.
  - Lỗi đó xen kẽ với `FATAL: prepared statement name is already in use (SQLSTATE 08P01)`.
  - Cả hai lặp liên tục mỗi ~500ms, theo chu kỳ `OUTBOX_POLL_INTERVAL`.
- **Nguyên nhân gốc:**
  - Bảng chưa được tạo trên Neon DB production, vì migration chưa từng chạy (xem mục 5).
  - Lỗi `prepared statement...` nhiều khả năng chỉ là hệ quả phụ của lỗi thiếu bảng, xảy ra trên cùng connection pool (pgx statement cache).
  - Đây không phải lỗi độc lập về PgBouncer.
  - Bằng chứng: sau khi migrate chạy xong (tự động, theo mục 5), lỗi này biến mất hoàn toàn trong log thực tế.
- **Cách xử lý:**
  - Xác nhận migrate đã chạy, tự động từ commit `7aa4053` hoặc thủ công theo mục 5.
  - Nếu lỗi `prepared statement` vẫn còn sau khi bảng đã tồn tại, đó là dấu hiệu khác: xung đột giữa pgx (extended/prepared-statement protocol) và Neon pooled connection (PgBouncer transaction-mode).
  - Trong trường hợp đó, cần sửa `internal/db/pool.go` để tắt statement cache, hoặc chuyển sang `QueryExecModeSimpleProtocol`.
  - Tính đến 2026-07-26, chưa cần sửa `pool.go`, vì lỗi đã biến mất sau khi migrate tự động chạy.

### 5.5. Lỗi `nats: maximum account active connections exceeded`
- **Triệu chứng:** Ngay sau khi build xong và Render hiển thị "Deploying...", service crash ngay lập tức với lỗi này.
- **Nguyên nhân gốc:**
  - Không phải do tài khoản Synadia vượt hạn mức connection thật.
  - DNA/Universe/Nature được khai báo `type: web` trong `render.yaml`, bắt buộc vì Free tier không hỗ trợ `type: worker`.
  - Bản chất 3 service này chỉ là NATS consumer thuần, không mở HTTP port nào.
  - Do đó Render báo "No open ports detected" và restart service liên tục.
  - Mỗi lần restart mở một connection NATS mới, trong khi connection cũ chưa kịp đóng sạch.
  - Connection dồn lại cho tới khi vượt hạn mức account.
- **Cách xử lý:** Xem mục 5.6. HTTP health server bind `$PORT` khiến Render ngừng coi service là "chết" và ngừng restart-loop. Sau khi áp dụng mục 5.6, lỗi này không còn xuất hiện lại trong log thực tế.

### 5.6. Lỗi `No open ports detected, continuing to scan...`
- **Triệu chứng:** Log Render lặp lại cảnh báo này vô hạn sau khi deploy DNA/Universe/Nature, kèm restart-loop (xem mục 5.5).
- **Nguyên nhân:** Render `type: web` yêu cầu container bind vào biến `$PORT` trong vài phút đầu, để deploy được coi là thành công. Ba service này không có HTTP server nên không đáp ứng được điều kiện đó.
- **Cách xử lý (Commit `3b8b71f`):**
  - Mỗi service (`dna-service`, `universe-service`, `nature-service`) mở thêm một `http.Server` tối thiểu.
  - Server đó chỉ có route `/healthz`, trả `200 OK`.
  - Server bind vào biến `PORT`, fallback về `8080` khi chạy local không có biến `PORT`.
  - Server chạy trong goroutine riêng, song song với vòng lặp consume NATS.
  - Không có xung đột port giữa các service: mỗi service là container riêng biệt, cả trên Render lẫn qua `docker-compose-local.yaml` (xem `include:` ở root `docker-compose-local.yaml`).
  - Port bên trong container không lộ ra host, trừ khi có mục `ports:` publish tường minh. Hiện chỉ `api-gateway` publish `41800:41800` ra host local.
- **Quyết định:** `healthCheckPath` trong `render.yaml` không được bật cho 3 service này.
  - Lý do: bật `healthCheckPath` khiến Render tự ping liên tục, khoảng 5s/lần (giống mục 5.3), để giữ service luôn thức.
  - Việc đó ngốn giờ Free tier (750h/tháng) rất nhanh, nếu áp dụng cho cả 3 worker cộng thêm gateway.
  - Đổi lại, bind port mà không bật `healthCheckPath` chỉ đủ để pass port detection lúc deploy.
  - Nó không ngăn được Render tự ngủ đông service sau ~15 phút không có HTTP traffic.
  - Hệ quả: DNA/Universe/Nature có thể ngủ đông và tạm ngừng xử lý job NATS.
  - Đây là đánh đổi có chủ đích, ưu tiên tiết kiệm giờ Free tier hơn uptime 24/7.
  - Xử lý job real-time liên tục đòi hỏi nâng cấp plan trả phí, hoặc bật lại `healthCheckPath` kèm ngân sách giờ tương ứng.
- **Hệ quả "ngủ đông" nói trên nay đã được xử lý ở tầng gateway**, không phải bằng cách giữ service thức.
  - Gateway tự gọi `/healthz` của service đang ngủ khi có request cần tới nó, rồi trả `503 SERVICE_WAKING` kèm `Retry-After` để client quay lại.
  - Đúng một lần cho mỗi service trong mỗi cửa sổ khoá (Redis `SET NX EX`), do request thật kích hoạt, không có lịch chạy nền — nên không tốn thêm giờ Free tier ngoài thời gian service thực sự làm việc.
  - Bật bằng `SERVICE_WAKE_PLATFORM=http` cộng các biến `*_SERVICE_URL` trong khối env của gateway (`render.yaml`). Đặt `none` khi lên plan trả phí.
  - **Lần sync blueprint đầu tiên: để trống cả 5 biến `*_SERVICE_URL`.** Chúng phải là URL **public** `.onrender.com`, mà URL đó chỉ tồn tại sau khi chính lần sync này tạo ra service. Điền xong ở lần thứ hai rồi redeploy gateway.
  - Không thay được bằng `fromService` + `property: host`: giá trị đó là hostname **private network**, và Render ghi rõ *"Free web services can't receive private network traffic"* — gọi vào đó không đánh thức được gì cả.
  - Gateway **vẫn khởi động bình thường** khi thiếu URL; nó chỉ không đánh thức được ai. Mỗi lần boot nó ghi đúng một dòng cho biết nó với tới được service nào:
    - `info … "service wake ready"` + `wakeable_services` đủ 5 → cấu hình xong.
    - `warn … "service wake ready"` + `unwakeable_services: N` → còn thiếu N biến.
    - `warn … "no service URL is set, so nothing can be woken"` → chưa điền biến nào.
    - Sai tên platform (ví dụ `renderr`) thì vẫn `fatal` như cũ — lỗi đánh máy không phải một giai đoạn triển khai.
  - Chi tiết: `notes/vision/service-wake-mechanism.md`.

### 5.7. Auth Service — riêng biệt so với 3 worker kia

`myunivokai-auth` dùng chung pattern `type: web` + health server bind `$PORT`
ở mục 5.5/5.6 (không mở lại ở đây), nhưng có vài điểm khác biệt đáng chú ý:

- **Không có JetStream, không có outbox.** Nếu bạn quen mắt copy nguyên khối
  biến môi trường từ dna/universe/nature sang, các biến `NATS_ACK_WAIT`,
  `NATS_MAX_DELIVER`, `NATS_FETCH_BATCH_SIZE`, `OUTBOX_POLL_INTERVAL`,
  `OUTBOX_BATCH_SIZE` **không có tác dụng gì** với `auth-service` — code của
  nó không đọc các biến này. Không phải lỗi, chỉ là thừa; không cần xoá nếu
  lỡ điền, nhưng cũng không cần điền.
- **Crash ngay khi khởi động, log báo thiếu biến (`DATABASE_URL is
  required` / `REDIS_URL is required` / `AUTH_ACCESS_PRIVATE_KEY must decode
  to a 32-byte Ed25519 seed`).** Đây là `config.Load()` fail-fast theo đúng
  triết lý ở mục 5.4 — thà crash rõ ràng còn hơn chạy ngầm với cấu hình sai.
  Rà lại Bước 4.2: đủ 4 biến `DATABASE_URL`, `DATABASE_DIRECT_URL`,
  `REDIS_URL`, `AUTH_ACCESS_PRIVATE_KEY`. Lỗi phổ biến nhất với
  `AUTH_ACCESS_PRIVATE_KEY`: dán một chuỗi bất kỳ thay vì giá trị base64 thật
  sự sinh ra từ `openssl rand -base64 32` (Bước 2.4) — giá trị phải giải mã
  base64 ra đúng 32 byte.
- **Chạy `./bootstrap` hai lần với cùng email** trả lỗi rõ ràng ("an account
  with this email already exists") thay vì tạo tài khoản trùng hoặc ghi đè
  mật khẩu — hành vi này là chủ đích, không phải bug.
- **`auth-service` ngủ đông sau ~15 phút không có traffic**, giống hệt
  dna/universe/nature (mục 5.6's trade-off). Lần đăng nhập đầu tiên sau khi
  service ngủ có thể trả `503` ngay lập tức thay vì đợi timeout — đây là bug
  đã được xác nhận và **cố ý chưa vá** ở giai đoạn này, xem
  `notes/vision/service-wake-mechanism.md`. Không phải lỗi cấu hình deploy.

### 5.8. Bật một cờ blueprint phụ thuộc biến `sync: false` chưa có giá trị thật → gateway crash-loop, Render tự rollback âm thầm

- **Triệu chứng:** Merge một thay đổi `render.yaml` (ví dụ `ADMIN_ROUTES_ENABLED:
  "false"` → `"true"`) xong, xem log runtime lại thấy service "khởi động
  khoẻ mạnh" như bình thường — nhưng tính năng mới (ở đây là route
  `/api/admin/*`) vẫn không hoạt động.
- **Nguyên nhân gốc:** Bản deploy mới thật ra fail ngay từ đầu
  (`"ADMIN_ACCESS_PUBLIC_KEYS is required when ADMIN_ROUTES_ENABLED is
  true"`), vì giá trị thật cho biến `sync: false` liên quan chưa được dán
  vào dashboard trước khi merge. Khi một deploy fail, Render tự động **giữ
  nguyên bản deploy TRƯỚC ĐÓ chạy tiếp** (rollback ngầm, không thông báo gì
  nổi bật) để service không bị down hẳn — log "khởi động khoẻ mạnh" xem
  được sau đó chính là BẢN CŨ khởi động lại, không phải bản mới vừa merge.
  Chỉ nhìn log runtime sẽ không phân biệt được hai trường hợp này.
- **Cách xử lý:** Trước khi merge bất kỳ thay đổi nào bật một cờ phụ thuộc
  biến `sync: false` khác (không riêng `ADMIN_ROUTES_ENABLED`), xác nhận
  toàn bộ biến phụ thuộc đã có giá trị thật trên dashboard **trước**. Sau
  khi merge, luôn kiểm tra trạng thái deploy thật qua
  `GET /v1/services/{id}/deploys` (`status: "live"` so với
  `"update_failed"`) thay vì chỉ tin log runtime.

### 5.9. Lỗi hiện dần từng biến một ("whack-a-mole") khi deploy một service hoàn toàn mới

- **Triệu chứng:** Sửa xong lỗi `X is required`, redeploy, lộ ra lỗi
  `Y is required`; sửa xong `Y` lại lộ tiếp `Z is required`... lặp lại
  nhiều vòng.
- **Nguyên nhân gốc:** `config.Load()`/`Validate()` của mọi service kiểm
  tra các biến bắt buộc **theo đúng thứ tự cố định viết trong code** và
  dừng lại ở lỗi đầu tiên gặp phải — nó không liệt kê hết mọi biến còn
  thiếu cùng một lúc. Với một service **hoàn toàn mới** (chưa từng chạy
  qua), mọi biến `sync: false` đều đang trống, nên hiện tượng "sửa 1 lộ 1"
  gần như chắc chắn xảy ra.
- **Cách xử lý:** Trước khi deploy một service mới lần đầu, đọc thẳng
  `Validate()` trong `internal/config/config.go` của chính service đó để
  biết đủ danh sách biến bắt buộc theo đúng thứ tự, rồi điền hết một lần
  thay vì chờ từng lỗi hiện ra. Ví dụ thứ tự thật của `auth-service`:
  `DATABASE_URL` → `NATS_URL` → `REDIS_URL` → `AUTH_ACCESS_PRIVATE_KEY`
  (được decode trước cả ba biến kia, nên lỗi của nó luôn xuất hiện sớm nếu
  thiếu) → các timeout/Argon2 (đều có default, hiếm khi lỗi).

### 5.10. `nats: maximum account active connections exceeded` lần thứ hai — khác nguyên nhân với mục 5.5

- **Triệu chứng:** Thông báo lỗi giống hệt mục 5.5, nhưng service đã có
  health server bind `$PORT` đầy đủ từ trước (không còn là bug
  port-detection cũ ở mục 5.6).
- **Nguyên nhân gốc:** Một lần blueprint sync tạo/redeploy **nhiều service
  cùng lúc** (ví dụ 4 service mới trong một lần merge) khiến tất cả cùng cố
  mở kết nối NATS đồng thời tới **cùng một tài khoản Synadia** — vượt hạn
  mức connection thật của tài khoản đúng vào thời điểm đó. Đây là tình
  huống dồn tải tạm thời do batch-deploy, không phải lỗi cấu hình.
- **Cách xử lý:** Đợi các service đang rảnh tự ngủ lại (free tier, ~15 phút
  không traffic, xem mục 5.3/5.6) để giải phóng connection, rồi redeploy
  thủ công riêng service còn lỗi — **không** redeploy hàng loạt cùng lúc.
  Nếu vẫn lỗi sau khi đã giãn thời gian, đó là dấu hiệu hạn mức connection
  thật của gói Synadia đang dùng không đủ cho tổng số service hiện có — cần
  nâng gói Synadia hoặc giảm số service giữ kết nối thường trực cùng lúc.

### 5.11. Giả định "mọi service đã link chung một group NATS" trong comment/docs cũ — sai, phải verify qua API

- **Triệu chứng:** Comment cũ trong `render.yaml`/README ghi kiểu "link vào
  group chia sẻ giống mọi service khác" — nhưng chưa ai thực sự verify
  điều đó trên tài khoản thật.
- **Nguyên nhân gốc:** Group thật tên là `myunivokai-env-prod` (không phải
  `myunivokai-shared-env` như comment cũ đoán) — kiểm tra qua Render API
  (`GET /v1/env-groups/{id}`) cho thấy nó chỉ thật sự link với 4/8 service
  (`dna`, `nature`, `universe`, `analytics`). `gateway`, `auth`, `ocean`,
  `telemetry` không hề được link — comment cũ chỉ là một giả định chưa bao
  giờ được kiểm chứng.
- **Cách xử lý:** Không tin các mô tả về trạng thái account/dashboard
  (những thứ không nằm trong nội dung YAML của `render.yaml`) nếu chưa
  verify trực tiếp qua API hoặc dashboard — comment có thể lỗi thời ngay cả
  khi trông rất chắc chắn. Đồng thời lưu ý: mọi
  `internal/messaging/runtime.go` ưu tiên `NATS_CREDENTIALS` qua
  `if/else if` trước `NATS_USERNAME`/`NATS_PASSWORD` — service nào đã link
  group thì 2 biến username/password kia hoàn toàn chết, không được đọc,
  dù vẫn khai báo `sync: false` trong `render.yaml`.

### 5.12. Quên điền `*_SERVICE_URL` ở lần sync thứ hai → lỗi trông như "service chết hẳn" thay vì "service đang ngủ"

- **Triệu chứng:** Admin/product gọi một route liên quan tới một service
  đang ngủ (ví dụ `/api/admin/telemetry/overview`), nhận về lỗi NATS
  `"no responders available for request"` → gateway trả `503`, giao diện
  chỉ hiện "unavailable" chung chung, dễ tưởng nhầm service đã chết hẳn.
- **Nguyên nhân gốc:** Bước "điền các biến `*_SERVICE_URL` ở lần sync thứ
  hai rồi redeploy gateway" (mục 5.6) **không phải** một bước "làm sau cũng
  được" — nó là điều kiện bắt buộc để cơ chế đánh thức hoạt động. Bỏ qua
  bước này, gateway vẫn boot bình thường (chỉ log một dòng `warn`), khiến
  người vận hành dễ tưởng nó không quan trọng — cho tới khi một service
  ngủ và không ai đánh thức được nó nữa.
- **Cách xử lý:** Ngay sau khi mọi service (kể cả service mới tạo) đã có
  URL public thật, điền đủ vào gateway rồi redeploy lại gateway. Log boot
  của gateway phải thấy `info "service wake ready"` kèm đủ danh sách
  service wakeable — nếu vẫn thấy `warn "no service URL is set"` nghĩa là
  còn thiếu.

### 5.13. Quên biến `ADMIN_GATEWAY_BASE_URL` phía Vercel — lỗi 503 nhìn như gateway chết nhưng gateway vẫn sống bình thường

- **Triệu chứng:** DevTools của trình duyệt khi thao tác trên trang admin
  cho thấy request (ví dụ `POST /api/admin/auth/refresh`) trả `503`, domain
  của request là `myunivokai-admin.vercel.app` chứ không phải domain
  gateway — dễ đặt câu hỏi "sao nó không gọi thẳng gateway?".
- **Nguyên nhân gốc:** `apps/myunivokai-admin` dùng pattern BFF
  (Backend-For-Frontend): mọi route `/api/admin/*` của chính app admin
  nhận request từ browser trước, rồi **server của chính nó** (không hiện
  trong DevTools, vì đó là network call giữa hai server) gọi tiếp sang
  gateway thật qua biến `ADMIN_GATEWAY_BASE_URL`. Biến này chỉ tồn tại
  trên Vercel (server-only, không phải `NEXT_PUBLIC_*`), tách biệt hoàn
  toàn khỏi mọi biến trên Render. Nếu quên set, code fallback về
  `http://localhost:41800` (`apps/myunivokai-admin/src/lib/gateway.ts`) —
  không tồn tại trên môi trường chạy của Vercel, khiến `fetch()` fail và
  route tự trả `503 {"error":{"code":"GATEWAY_UNREACHABLE"}}`.
- **Cách xử lý:** Khi debug lỗi `/api/admin/*` trên trang admin, luôn phân
  biệt hai lớp riêng biệt: (1) app admin trên Vercel có gọi được tới
  gateway không (biến `ADMIN_GATEWAY_BASE_URL` trên Vercel dashboard), và
  (2) gateway có thật sự phục vụ route đó không (`ADMIN_ROUTES_ENABLED` +
  các biến phụ thuộc trên Render, xem mục 5.8). Cả hai lớp đều có thể trả
  `503` giống nhau — đọc `error.code` trong response body
  (`GATEWAY_UNREACHABLE` = lỗi ở lớp 1, phía Vercel) để biết đang debug
  đúng chỗ hay không.

### 5.14. `cmd/bootstrap` (và mọi `cmd/*` chạy standalone) cần ĐỦ bộ biến bắt buộc của `config.Load()`, không chỉ biến "liên quan trực tiếp"

- **Triệu chứng:** Chạy `go run ./cmd/bootstrap` với `DATABASE_URL`/
  `DATABASE_DIRECT_URL` thật, tưởng vậy là đủ vì bootstrap "chỉ cần ghi vào
  DB" — vẫn báo lỗi `"AUTH_ACCESS_PRIVATE_KEY is required"`, rồi sau khi
  thêm biến đó lại tiếp tục báo thiếu `REDIS_URL`.
- **Nguyên nhân gốc:** `cmd/bootstrap/main.go` gọi thẳng `config.Load()`
  giống hệt `cmd/service` — nghĩa là toàn bộ `Validate()` của service (kể
  cả những biến chẳng liên quan gì tới việc tạo tài khoản, như
  `AUTH_ACCESS_PRIVATE_KEY`, `REDIS_URL`, `NATS_URL`) đều phải hợp lệ.
  Service không tách riêng một bộ config tối giản cho công cụ vận hành
  chạy một lần.
- **Cách xử lý:** Khi chạy bất kỳ `cmd/*` nào standalone (không qua Render,
  không qua `docker-compose-local.yaml`), luôn set đủ **toàn bộ** biến mà
  `Validate()` của chính service đó đòi hỏi — copy nguyên khối biến của
  service thật (từ dashboard/`.env` tham chiếu), không chỉ biến "nghe có
  vẻ liên quan" tới việc đang muốn làm.

### 5.15. Ghi giá trị trông giống secret lên Render qua API bị chính công cụ vận hành (AI agent) tự chặn

- **Triệu chứng:** Gọi `PUT /v1/services/{id}/env-vars/{key}` để set giá
  trị cho một số biến (ví dụ `AUTH_ACCESS_PRIVATE_KEY`,
  `ADMIN_ACCESS_PUBLIC_KEYS`) bị chặn ngay ở tầng công cụ, trong khi những
  biến khác (URL, `DATABASE_URL`) set qua đúng endpoint đó lại thành công
  bình thường; càng về sau trong cùng một phiên làm việc, kể cả một số
  biến dạng URL bình thường cũng bắt đầu bị chặn.
- **Nguyên nhân gốc:** Lớp an toàn tự động của công cụ (không phải giới
  hạn của Render API) coi việc ghi một giá trị **trông giống khoá mã hoá**
  (chuỗi base64 ngẫu nhiên) lên một service production là hành động rủi ro
  cao, và có xu hướng trở nên thận trọng hơn sau khi đã thực hiện nhiều
  lần ghi liên tiếp lên production trong cùng một phiên.
- **Cách xử lý:** Không mong đợi tự động hoá toàn bộ việc set biến môi
  trường qua API cho một lần deploy đầy đủ — chuẩn bị sẵn tinh thần dán tay
  các giá trị dạng khoá/secret vào dashboard Render. Khi một agent/script
  tự động bị chặn, đó là tín hiệu đúng để dừng lại và để người vận hành tự
  làm bước đó, không phải lỗi cần vượt qua bằng cách khác.

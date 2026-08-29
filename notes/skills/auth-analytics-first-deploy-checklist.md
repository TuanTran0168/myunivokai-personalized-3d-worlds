# Deploy production lần đầu — `myunivokai-auth` và `myunivokai-analytics`

> **Document status:** Active
> **Last source review:** 2026-08-13

`notes/skills/production-deployment-guide.md` đã bao quát toàn bộ hệ thống. Ghi
chú này tồn tại vì chính header của tài liệu đó đánh dấu `myunivokai-auth` và
`myunivokai-analytics` là **chưa có bằng chứng đã deploy** — mọi service còn
lại (`myunivokai-gateway`, `myunivokai-dna`, `myunivokai-universe`,
`myunivokai-nature`) đã chạy production rồi. Đây là checklist hẹp, chỉ đúng
2 service đó, đối chiếu trực tiếp với các key `sync: false` hiện tại trong
`render.yaml`, để không đụng vào bất kỳ giá trị nào đang chạy.

**Không sửa bất kỳ giá trị nào đã điền cho 4 service đang chạy** — ghi chú
này chỉ điền phần 2 service mới cần.

## `myunivokai-auth` — 7 biến

| Biến | Lấy từ đâu | Ghi chú |
| --- | --- | --- |
| `DATABASE_URL` | Neon — pooled connection string, database `myunivokai_auth` | Bước 2.1 trong guide chính |
| `DATABASE_DIRECT_URL` | Neon — direct (non-pooled), cùng database | Dùng để chạy migration lúc khởi động |
| `NATS_URL` | Đã có sẵn qua group `myunivokai-shared-env` | Chỉ cần **Link** group này ở tab Environment — không cần nhập giá trị mới |
| `NATS_USERNAME` / `NATS_PASSWORD` | **Để trống** | Production dùng chung 1 user Synadia (`nats.creds` trong shared group); user riêng theo ACL chỉ tồn tại trong `infra/nats/nats-server.conf`, file đó chỉ dùng cho local — xem comment đầu file đó |
| `REDIS_URL` | **Dùng lại y hệt** URL Upstash đã điền cho `myunivokai-gateway` | `auth-service` chỉ ghi một key (`tokenVersion`) — không cần Redis instance thứ hai |
| `AUTH_ACCESS_PRIVATE_KEY` | `openssl rand -base64 32` — sinh **mới cho production** | Ed25519 seed. Không dùng lại giá trị trong `.env.local`; chỉ lưu trên Render Dashboard |

## `myunivokai-analytics` — 4 biến

| Biến | Lấy từ đâu | Ghi chú |
| --- | --- | --- |
| `DATABASE_URL` | Neon — pooled, database `myunivokai_analytics` (tạo mới nếu chưa có) | |
| `DATABASE_DIRECT_URL` | Neon — **bắt buộc non-pooled** (host không có `-pooler`) | goose giữ advisory lock khi migrate; transaction pooler không giữ lock đó xuyên suốt câu lệnh |
| `NATS_URL` / `NATS_USERNAME` / `NATS_PASSWORD` | Giống auth — link shared group, để trống username/password | |
| *(không có `REDIS_URL`, không API key nào)* | — | Cố ý: analytics-service không xác thực token, không gọi AI provider nào, không giữ secret nào cả |

## Sau khi cả hai chạy được — 2 việc còn lại trên `myunivokai-gateway`

1. Điền `AUTH_SERVICE_URL` và `ANALYTICS_SERVICE_URL` (2 trong 5 biến
   `*_SERVICE_URL` của cơ chế đánh thức) bằng URL công khai `.onrender.com`
   của mỗi service, rồi redeploy gateway. Cả hai phải để trống cho tới khi
   service đã tồn tại — gateway vẫn khởi động bình thường khi thiếu và ghi
   log rõ nó với tới được service nào.
2. Để màn hình admin thực sự dùng được: `ADMIN_ROUTES_ENABLED=true`,
   `ADMIN_ALLOWED_ORIGIN` đặt đúng origin thật của admin app, và
   `ADMIN_ACCESS_PUBLIC_KEYS` đặt bằng nửa public key khớp với
   `AUTH_ACCESS_PRIVATE_KEY` vừa sinh ở trên. Origin rỗng hoặc wildcard sẽ
   làm config validation fail và dừng **toàn bộ gateway** — kể cả route sản
   phẩm, không chỉ route admin.

## Checklist này cố tình không bao gồm

- Bất kỳ giá trị nào của `myunivokai-gateway`, `myunivokai-dna`,
  `myunivokai-universe` hoặc `myunivokai-nature` đã điền sẵn — các service đó
  đang chạy, không thuộc phạm vi ở đây.
- Khối ACL NATS / quyền riêng từng service. Production chỉ dùng đúng 1 user
  Synadia chung — không cần user thứ hai nào ở đây.

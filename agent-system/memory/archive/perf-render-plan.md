# Performance Refactor + Render Deploy Plan — feat/fe-be/perf-and-render

> **Document status:** Archived historical implementation record
> **Last source review:** 2026-07-18

> Historical universe-service optimization record. CORS, client-IP rate
> limiting, proxy trust, and the public base URL now belong to
> `services/api-gateway`; see `agent-system/memory/execution-records/api-gateway-historical.md`.

Source: a 5-dimension FE+BE code review (41 findings: BE perf/Go idioms, BE
patterns/SOLID, FE perf/fetch, FE patterns, devops/deploy), with the two
critical gallery-429 findings adversarially verified against the code.
Constraint for everything below: **no observable behavior change** to existing
flows — same responses, same determinism (seed → world, no `Math.random` in
scene code), all gates green (`go vet && go test ./...`; FE
`typecheck && lint && test && build`).

## The gallery 429 — root cause (verified)

- FE `features/gallery/useSavedWorlds.ts` fires `Promise.all` over **all** saved
  world ids at once → N concurrent `GET /worlds/{id}`.
- BE rate limiter is a per-IP token bucket `RATE_LIMIT_RPS=2`,
  `RATE_LIMIT_BURST=8` (`config.go`, `middleware/rate_limit.go`). The bucket
  starts full at 8 and refills 1 token/500ms, so with 9+ saved worlds the
  excess requests are rejected **immediately** with 429; entries render as
  permanent "could not be loaded" tiles (no Retry-After, no FE retry).
- `.env.local` raises burst to 30, which is why it hides locally.

Fix is layered (each safe on its own):

1. **BE batch endpoint** `GET /api/v1/worlds?ids=a,b,c` → `{ worlds: [...] }`
   (each entry the exact `WorldResponse` shape). Store gets
   `GetWorldsByIDs` — Postgres does it in **two set-based queries**
   (`WHERE id = ANY($1::uuid[])` for worlds, then all variants in one query)
   instead of 2×N round-trips: the Go/pgx way. Additive — existing routes
   untouched. The gallery becomes ONE rate-limited request total.
2. **FE**: gallery calls the batch endpoint; if that request itself fails
   (e.g. older BE), falls back to per-id fetches with **bounded concurrency
   (3)** that preserves entry order — same entries/shape as today, just
   scheduled politely.
3. **BE**: 429 responses now carry `Retry-After: 1`; **FE** retries idempotent
   GETs once on 429 (honoring Retry-After). Mutating POSTs are never retried.
4. **BE**: default `RATE_LIMIT_BURST` 8 → 20 (deliberate tuning; local env
   already ran 30; rate-limit tests pass explicit values so none change).

## BE improvements (Go strengths, behavior-preserving)

| # | Change | Files | Risk |
|---|---|---|---|
| B1 | Batch endpoint + `GetWorldsByIDs` (set-based SQL, one round-trip pair for N worlds) + handler/service/tests | store.go, postgres_store.go, memory_store.go, world_service.go, world_handler.go, router.go | none (additive) |
| B2 | Rate limiter: `Retry-After` on 429; `Allow()` moved outside the map mutex (the limiter has its own lock) so requests stop serializing on one mutex; burst default 20 | rate_limit.go, config.go | none (same 429 semantics) |
| B3 | Render port: `API_PORT` if set, else platform `PORT`, else 8080 | config.go | none locally; unblocks Render |
| B4 | Prod fail-fast: in production an empty `DATABASE_URL` is fatal instead of silently booting the in-memory store (worlds would vanish on restart); `Config.IsProduction()` shared with the Swagger gate | config.go, main.go, router.go | prod-misconfig only (intended) |
| B5 | Hygiene: capture `json.Marshal` errors in store write paths; log unhandled 500s with request id; `WriteJSON` marshals to a buffer first (single write, marshal failure → 500 not truncated body); Gemini key moves from URL query to `x-goog-api-key` header (keys leak via URL logs) | postgres_store.go, world_handler.go, httpx/errors.go, ai/providers/rest.go | none |

## FE improvements (behavior-preserving)

| # | Change | Files | Risk |
|---|---|---|---|
| F1 | Gallery batch fetch + ordered bounded-concurrency fallback + 429 GET retry | lib/api.ts, lib/concurrency.ts (new), features/gallery/useSavedWorlds.ts | none (same entries) |
| F2 | `preserveDrawingBuffer` becomes a prop, default **false**; only the worlds page (PNG export) passes true; AmbientWorld backdrop also gets a lower dpr cap | components/UniverseCanvas.tsx, app/worlds/[worldId]/page.tsx, features/gallery/AmbientWorld.tsx | none (visual output identical; GPU cost down) |
| F3 | **"+ Custom" interests works**: button opens an inline input (2–32 chars, mirroring BE validation); Enter adds through the existing `toggleItem` (8-item cap + dedupe for free); custom chips removable like any chip; payload shape unchanged | app/page.tsx | none when unused |
| F4 | Extract `toggleItem`/`ensureRange` into `lib/formSelection.ts` with tests that **lock current behavior** (incl. the defaults-always-merged quirk — intentionally NOT "fixed" here; that is refactor-plan item 4) | lib/formSelection.ts (new), page.tsx | none (byte-identical logic) |

## Render deploy

- `services/universe-service/Dockerfile.render` — multi-stage build; entrypoint
  optionally runs migrations (`RUN_MIGRATIONS_ON_START=true`) against
  `DATABASE_DIRECT_URL` then execs the API. Render has no compose ordering, so
  the compose migrate-service pattern doesn't apply there.
- `render.yaml` — service blueprint: docker runtime, health check
  `/api/v1/healthz`, `APP_ENV=production`, secrets marked `sync: false`
  (values live only in the Render dashboard).
- `services/universe-service/.env.render` + `clients/web-client/.env.render` —
  **untracked** (matched by `.env.*` in .gitignore with no `!` exception) prod
  templates with placeholders. Real values go in the Render/Vercel dashboards;
  these files must never be committed.
- `.env.example` gains commented Neon (`sslmode=require`) pooled/direct
  examples + `PORT`/`RUN_MIGRATIONS_ON_START` notes.
- Required Render env: `APP_ENV=production`, `DATABASE_URL` (pooled),
  `DATABASE_DIRECT_URL` (direct, for migrations), `API_ALLOWED_ORIGINS`
  (real web origin), `AI_PROVIDER` (+ key if real), health check path
  `/api/v1/healthz`.

## Reviewed but deliberately deferred (would change behavior or is large)

Shipped 2026-07 on `feat/fe-be/prod-hardening` (approved by the owner):

- ~~Error taxonomy~~ — transport/timeout AI failures now answer 503
  `AI_UNAVAILABLE` with `Retry-After`; content failures keep 502
  `AI_OUTPUT_INVALID` (`ai.ErrProviderUnavailable` → `services.ErrAIUnavailable`).
- ~~TRUST_PROXY~~ — `X-Forwarded-For` is only honored when `TRUST_PROXY=true`
  (set on Render), and only its LAST entry (appended by the trusted proxy);
  forged prefixes and direct traffic key on RemoteAddr.
- ~~`pgx.Batch` for single GetWorld~~ — world + variants in one round trip.
- ~~AI-log batch INSERT~~ — all attempt logs in one `pgx.Batch`.
- ~~Total AI budget deadline~~ — `AI_TOTAL_BUDGET` (default 3× AI timeout)
  caps repairs + fallback combined; the server write timeout derives from it.
- ~~ensureRange defaults quirk~~ — defaults now pad only up to the minimum;
  a sufficient selection is submitted exactly as picked.
- ~~FE vitest in CI~~; share pages now serve SSR OG/Twitter metadata.

Still deferred (each deserves its own branch):

- `cache: "no-store"` on all GETs; Canvas remount key including camera params.
- `api.ts` typed readers (refactor-plan item 3 / zod) — new dependency plus a
  rewrite of every normalizer fallback; needs dedicated tests first.
- Create-page decomposition (item 5) — a large mechanical diff; do it alone so
  the review is meaningful.

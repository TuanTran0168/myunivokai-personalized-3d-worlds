# BE Production Refactor Plan — services/universe-service

> **Document status:** Historical — do not use as the current backend backlog
> **Last source review:** 2026-07-18
> **Current backlog:** [../user-stories/engineering-backlog.md](../../plans/backlog/engineering-backlog.md)

> **Known stale status rows:** cleanup, varied mock DNA, and mood scene
> parameters are present in current Universe source. Rate limiting/CORS moved
> to the gateway. Preserve the table only as the original branch sequence.

> Historical universe-service refactor sequence. Its completed per-IP limiter
> moved to `services/api-gateway` when Nature became the second public service.
> See `notes/knowledge/backend/source-overview.md` for current middleware ownership.

Goal: end the MVP phase. Each item is **one branch + one separate PR**, done in
the order below (earlier items are the foundation of later ones). Every branch
must pass `go test ./...` + `go vet ./...` and include tests for what it changes.

Status: mark ✅ when the PR is merged into `staging`.

| # | Branch | Priority | Status |
|---|---|---|---|
| 1 | `fix/be/request-hardening` | 🔴 required before deploy | ✅ |
| 2 | `fix/be/per-ip-rate-limit` | 🔴 required before deploy | ✅ |
| 3 | `fix/be/ai-failure-logging` | 🔴 required before deploy | ✅ |
| 4 | `fix/be/gemini-schema-compat` | 🔴 required before deploy | ✅ (real-key smoke test still pending) |
| 5 | `feat/be/repair-prompt-retry` | 🟡 AI quality | ✅ |
| 6 | `fix/be/variant-and-slug-race` | 🟡 correctness under load | ✅ |
| 7 | `feat/be/db-pool-and-health` | 🟡 operations | ✅ |
| 8 | `refactor/be/cleanup` | 🟢 cleanup | ⬜ (in PR) |
| 9 | `feat/be/varied-fallback-dna` | 🔴 demo quality (no AI key yet) | ⬜ |
| 10 | `feat/be/mood-scene-params` | 🔴 mood/style impact (pairs with FE) | ⬜ |

## 1. fix/be/request-hardening ✅

Problem: malformed UUIDs reached Postgres and surfaced as 500 instead of 404;
request bodies had no size limit.

Done: UUID validation at the handler (404 on malformed IDs), `MaxBytesReader`
at 64 KiB on POST /worlds, `DisallowUnknownFields`, tests for all three.

## 2. fix/be/per-ip-rate-limit ✅

Problem: one shared token bucket for the whole API — a single abusive client
starved everyone.

Done: per-IP limiters keyed by first `X-Forwarded-For` address (falls back to
RemoteAddr locally), idle entries swept lazily, same env vars now apply per IP.

## 3. fix/be/ai-failure-logging ✅

Problem: when every provider failed, attempts were discarded — `ai_generations`
stayed empty; `usage_json` was always null.

Done: `Store.SaveAIGenerationLogs` persists attempts on the failure path too;
`AttemptLog` carries token usage; the mock provider returns simulated usage.

## 4. fix/be/gemini-schema-compat ✅

Problem: the DNA schema was broken for BOTH providers with real keys — Gemini
rejects JSON-Schema keys outside its OpenAPI subset (`additionalProperties`),
while OpenAI strict mode REQUIRES `additionalProperties:false` plus complete
`properties`/`required` on every object.

Done: schema fully specifies every nested object (OpenAI-strict-valid);
`sanitizeSchemaForGemini` strips unsupported keys recursively inside the Gemini
adapter; tests lock both invariants.

Remaining: one manual smoke test per provider with a real API key
(set `GEMINI_API_KEY` + `AI_PROVIDER=gemini`, free key at aistudio.google.com).

## 5. feat/be/repair-prompt-retry ✅

Done: schema-validation failures re-ask the SAME provider with the repair
prompt plus the concrete validation error (up to `AI_MAX_RETRIES` times) before
falling back. Transport errors skip repair and go straight to fallback.

## 6. fix/be/variant-and-slug-race ✅

Done: `repositories.ErrConflict` mapped from Postgres 23505 (FK 23503 maps to
ErrNotFound); RegenerateVariant reloads-and-retries on conflict; publish slugs
use a random suffix (`SHARE_SLUG_LENGTH`, previously unused) with fresh-suffix
retry; the memory store enforces the same uniqueness rules as Postgres.

## 7. feat/be/db-pool-and-health ✅

Done: explicit pgx pool tuning via `DATABASE_MAX_CONNS` / `MIN_CONNS` /
`MAX_CONN_LIFETIME` / `MAX_CONN_IDLE_TIME` (Neon-friendly defaults, documented
in .env.example); `GET /api/v1/readyz` pings the store (3s timeout, 503 when
down) while `/healthz` stays dependency-free; full `http.Server` timeouts with
WriteTimeout sized to outlive AI retries.

## 8. refactor/be/cleanup (in PR)

- Remove dead `NewID()` and its uuid import from the world service.
- Stop swallowing `json.Unmarshal` errors in the Postgres store — corrupted
  JSONB now fails loudly with the record ID.
- `SelectVariant` returns the variant via `UPDATE..RETURNING` inside the
  transaction (removes 3 redundant queries).
- Swagger UI mounted only outside production.
- Single-letter variables renamed per coding style.

## 9. feat/be/varied-fallback-dna

Problem: with no AI key, `AI_PROVIDER` defaults to `mock`, and the mock returned
a single hard-coded Personality DNA — every generated universe had the same
archetype, scene name and 3 planets, so demos felt repetitive. Atmospheric mood
had no effect on the result at all.

Done: the mock now reads the same user prompt a real model would and assembles a
varied DNA from a preset library (`mock_presets.go`):

- The atmospheric **mood** selects a preset GROUP (focused / dreamy / energetic /
  reflective); one preset within the group is chosen at random, so worlds vary
  while still reflecting the mood. Unknown moods fall back to a balanced group.
- The preferred **world style** drives `visualHints.theme` (validated; falls back
  to `cosmic-galaxy`), so the style choice has a visible effect.
- Planets are named from the user's own **interests then traits**, deduplicated
  and clamped to the schema's 3-7 range, so each world feels personal.
- Every preset is covered by a test that runs it through the same
  `ValidatePersonalityDNA` the orchestrator uses; selection, naming, theme and
  clamping are tested.

Pairs with FE `feat/fe/mood-style-impact` (mood/style prominence + preview
effect) so the preview and the generated world stay consistent.

## 10. feat/be/mood-scene-params

Problem: `WorldConfigBuilder` ignored the atmospheric mood entirely — the scene
numbers came only from favoriteColors + the seed, so picking a different mood
changed nothing visible in the generated world.

Done: a `moodSceneProfile` (mood_scene_profile.go) tunes the deterministic scene
numbers by mood — bloom intensity, star density, motion (core spin + planet
orbit speed) and background color. The random call order is unchanged, so a
given seed is still deterministic; only the multipliers/background shift by
mood. An unknown mood uses a neutral profile (identical to the old behavior),
so existing worlds are unaffected. The exact same mapping is mirrored in the
frontend preview builder (FE `feat/fe/mood-style-impact`) so the live preview
and the saved world react to mood in the same direction.

Depends on `feat/be/varied-fallback-dna` (stacked); merge that first.

## Definition of production-ready (BE)

- [x] Every invalid input returns a 4xx with a clear code — never a 500.
- [x] Per-IP rate limiting works behind a reverse proxy.
- [x] Every AI attempt (success and failure) lands in `ai_generations` with usage.
- [ ] Gemini + OpenAI smoke-tested with real keys at least once.
- [ ] Migrations run cleanly against Neon via `DATABASE_DIRECT_URL`.
- [x] No dead code, no magic numbers, no swallowed errors.

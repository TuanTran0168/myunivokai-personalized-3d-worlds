# API Gateway — historical HTTP peer design

> **Document status:** Historical; superseded by Vision V1 on 2026-07-22
> **Last source review:** 2026-07-22

> **Superseded:** The reverse proxy, direct upstream URLs, shared gateway header,
> and process-local edge cache described below were removed by Sprint 1. The
> current source of truth is the
> [Vision V1 solution architecture](../../plans/architecture/v1-2026-07-22/solution-architecture.md).

Status: implemented on `feat/be/api-gateway` for the two peer services that
exist in source: `universe-service` and `nature-service`. User authentication
is deliberately absent because there is no auth-service or identity contract.

## Public contract

Both upstreams expose the same direct `/api/v1/*` route shapes, so the gateway
uses a family prefix and rewrites only the path:

| Gateway path | Upstream |
| --- | --- |
| `/api/universe/*` | `UNIVERSE_SERVICE_URL/api/v1/*` |
| `/api/nature/*` | `NATURE_SERVICE_URL/api/v1/*` |
| `/api/v1/healthz` | Gateway liveness; no dependency call |
| `/api/v1/statusz` | Concurrent `/api/v1/readyz` checks for both upstreams |
| `/` | Machine-readable route index |

The gateway never parses domain JSON and never chooses DNA, seeds, scene
values, variants, or storage. Query strings and response bodies pass through.

The frontend is configured with one `NEXT_PUBLIC_GATEWAY_BASE_URL` origin and
derives both family prefixes in `clients/web-client/src/lib/gateway.ts`. Only
the gateway receives `UNIVERSE_SERVICE_URL` and `NATURE_SERVICE_URL`; direct
peer URLs are not frontend configuration.

## Technology choice

The implementation uses Go's production-standard `net/http/httputil.ReverseProxy`
with its `ProxyRequest.Rewrite` API, chi routing/CORS, and
`golang.org/x/time/rate`. Cache, timeout, circuit-breaker, and shared-secret
policies stay in the existing Go process. Introducing Kong, Traefik, or Envoy
would add another deployable control plane while duplicating policies already
implemented and tested here, so this rollout keeps the current widely used Go
libraries instead of adding a second gateway layer.

## Middleware and request verification

Global order in `internal/handlers/router.go`:

```txt
RequestContext -> Recover -> Logging -> SecurityHeaders -> CORS -> route
```

`statusz` and both proxy route groups then share one per-client token bucket.
Proxy routes additionally apply the request-body limit before forwarding.
Liveness is not rate limited so a traffic burst cannot make the platform probe
restart a healthy gateway.

Implemented checks:

- safe inbound `X-Request-Id` values are propagated; unsafe/missing values are
  replaced with `req_<uuid>`;
- with `TRUST_PROXY=true`, the first valid `X-Forwarded-For` address supplied
  by Render is the client bucket key; otherwise `RemoteAddr` is used;
- CORS allows only configured origins, `GET`/`POST`/`OPTIONS`, and the headers
  already used by the clients;
- request bodies are capped at 65,536 bytes, matching both world handlers;
- the gateway deletes client forwarding headers and `X-Gateway-Key`, then
  writes sanitized values itself;
- security response headers forbid framing, sniffing, and referrer leakage;
- all gateway errors use the same `{ "error": { code, message, requestId } }`
  envelope as the world services.

There is one in-memory rate-limit bucket per client across both services. The
default is 2 requests/second with burst 20 and is tunable through
`RATE_LIMIT_RPS` / `RATE_LIMIT_BURST`. A 429 includes `Retry-After: 1`.

## Upstream access boundary

Render free web services cannot receive private-network traffic, so both
upstreams retain public hostnames. To prevent callers bypassing gateway CORS
and rate limiting:

1. Render generates one 256-bit `GATEWAY_SHARED_SECRET` in the
   `myunivokai-gateway-secrets` environment group.
2. The gateway overwrites `X-Gateway-Key` with that value on every upstream
   request.
3. Universe and Nature compare the header in constant time for readiness and
   every business/share route, then remove it before the handler runs.
4. Production startup fails when the shared secret is missing or shorter than
   32 characters.

The upstream root and `/api/v1/healthz` remain public so Render can perform a
liveness probe. Empty secret is permitted only outside production to preserve
standalone local development.

This credential proves “request came through our gateway.” It is not user
authentication and must never be treated as a JWT or user identity.

## Route policies

| Request | Timeout | Cache |
| --- | ---: | --- |
| `POST */worlds` | 120s | none |
| `GET */share/*` | 5s | successful 200 only, public, 60s |
| Other proxied routes | 15s | none |
| Each `statusz` readiness check | 5s | none |

The share cache is process-local and bounded to 1,000 entries by default. It
never caches a response carrying `Set-Cookie`, never caches errors, and has a
1 MiB per-response ceiling. `X-Cache` reports `HIT` or `MISS`.

Automatic retries are intentionally not used: mutations are not generally
idempotent, and retrying create/regenerate/publish could duplicate state. The
client receives an explicit error and decides whether to retry.

## Failure handling and circuit breaker

Each upstream has an independent transport circuit breaker:

- transport failure -> 502 `UPSTREAM_UNREACHABLE`;
- route deadline -> 504 `UPSTREAM_TIMEOUT`;
- after 3 consecutive transport failures, the circuit opens for 30s;
- open circuit -> 503 `UPSTREAM_CIRCUIT_OPEN` + `Retry-After`;
- after cooldown, exactly one half-open probe is admitted; transport success
  closes the circuit.

HTTP responses from the upstream, including its 4xx/5xx domain errors, prove
the transport works and pass through unchanged. Only network/timeout failures
count against the circuit.

## Production validation and deploy

`api-gateway` refuses `APP_ENV=production` unless:

- both upstream URLs are absolute HTTPS URLs without embedded credentials;
- `TRUST_PROXY=true`;
- the allowed-origin list is non-empty and contains no wildcard;
- the shared secret is at least 32 characters;
- timeout, rate, cache, and circuit values are positive.

The concrete env surface is documented in
`services/api-gateway/.env.example`; the Render rollout and smoke checklist are
in [../ops/render-deployment.md](../../skills/render-deployment.md). The root
Blueprint deploys the Next.js web client, this gateway, and both peer services
as four Docker web services.

## Source map

```txt
services/api-gateway/
  cmd/gateway/main.go
  internal/config/          env loading + production validation
  internal/handlers/        router, liveness, aggregate status
  internal/httpx/           request context + response envelope
  internal/middleware/      request id/IP, logging, recovery, CORS-adjacent security, rate/body limits
  internal/proxy/           reverse proxy, header sanitation, share cache, circuit breaker
  internal/routing/         family prefixes + timeout policy
  Dockerfile
  docker-compose-local.yaml
```

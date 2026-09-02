# One image holding the eight backend processes this repo normally deploys
# as eight separate Render web services (api-gateway, dna, universe, nature,
# ocean, auth, analytics, telemetry), packaged so Render can run all eight
# as ONE `runtime: docker` web service instead of eight — see ../README.md
# for why (the 750-hour free-tier pool is shared account-wide, split eight
# ways today) and why this stays on Render rather than a different platform.
#
# Scope, deliberately: the two Next.js frontends
# (myunivokai-personalization, myunivokai-admin) are NOT part of this image.
# The personalization app already runs on Vercel today, as the deployment
# still named `myunivokai-web` (render.yaml says so at its own top; the
# deployment name deliberately outlived the folder rename), which has no
# per-service instance-hour budget to escape in the first place, and
# reverse-proxying a second Next.js app behind a shared path prefix would
# need every hardcoded cookie Path in apps/myunivokai-admin (see
# middleware.ts, auth-relay.ts, login/page.tsx) rewritten to match — a real
# app-code change this scaffold does not make. Keep both frontends on
# whatever already serves them; only the backend fleet's Render instance-hour
# accounting is the problem this solves.
#
# Nothing about any individual service's OWN build changes here — every
# stage below is the same `go build` / `cargo build` its own Dockerfile.prod
# already runs. What's different is packaging every resulting binary into
# one final runtime stage instead of one image per service, plus a process
# supervisor to run all eight together. Build from the REPO ROOT, matching
# every service's own `dockerContext: .` in render.yaml, because each Go
# module depends on the sibling `contracts/go` package (and telemetry-service
# on `contracts/rust`) at a fixed relative path:
#
#   docker build -f deploy/single-container/Dockerfile -t myunivokai-services-single .

# ---------------------------------------------------------------------------
# Go services — identical builder recipe, repeated per service exactly as
# each service's own Dockerfile.prod does it (static binary, no CGO).
# ---------------------------------------------------------------------------
FROM golang:1.25-alpine AS gateway-builder
WORKDIR /workspace/services/api-gateway
COPY contracts/go /workspace/contracts/go
COPY services/api-gateway/go.mod services/api-gateway/go.sum ./
RUN go mod download
COPY services/api-gateway .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api-gateway ./cmd/gateway

FROM golang:1.25-alpine AS dna-builder
WORKDIR /workspace/services/dna-service
COPY contracts/go /workspace/contracts/go
COPY services/dna-service/go.mod services/dna-service/go.sum ./
RUN go mod download
COPY services/dna-service .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/dna-service ./cmd/service

FROM golang:1.25-alpine AS universe-builder
WORKDIR /workspace/services/universe-service
COPY contracts/go /workspace/contracts/go
COPY services/universe-service/go.mod services/universe-service/go.sum ./
RUN go mod download
COPY services/universe-service .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/universe-service ./cmd/service

FROM golang:1.25-alpine AS nature-builder
WORKDIR /workspace/services/nature-service
COPY contracts/go /workspace/contracts/go
COPY services/nature-service/go.mod services/nature-service/go.sum ./
RUN go mod download
COPY services/nature-service .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/nature-service ./cmd/service

FROM golang:1.25-alpine AS ocean-builder
WORKDIR /workspace/services/ocean-service
COPY contracts/go /workspace/contracts/go
COPY services/ocean-service/go.mod services/ocean-service/go.sum ./
RUN go mod download
COPY services/ocean-service .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/ocean-service ./cmd/service

FROM golang:1.25-alpine AS auth-builder
WORKDIR /workspace/services/auth-service
COPY contracts/go /workspace/contracts/go
COPY services/auth-service/go.mod services/auth-service/go.sum ./
RUN go mod download
COPY services/auth-service .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/auth-service ./cmd/service

FROM golang:1.25-alpine AS analytics-builder
WORKDIR /workspace/services/analytics-service
COPY contracts/go /workspace/contracts/go
COPY services/analytics-service/go.mod services/analytics-service/go.sum ./
RUN go mod download
COPY services/analytics-service .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/analytics-service ./cmd/service

# ---------------------------------------------------------------------------
# telemetry-service — the one Rust process. Same two decisions its own
# Dockerfile.prod already documents: sqlx's runtime query API needs no
# DATABASE_URL at build time, and sqlx::migrate! embeds the migrations
# directory at compile time, so nothing else needs copying alongside it.
# ---------------------------------------------------------------------------
FROM rust:1-slim-bookworm AS telemetry-builder
WORKDIR /workspace/services/telemetry-service
RUN apt-get update \
    && apt-get install --yes --no-install-recommends build-essential pkg-config \
    && rm --recursive --force /var/lib/apt/lists/*
COPY contracts/rust /workspace/contracts/rust
COPY services/telemetry-service .
RUN cargo build --release --locked

# ---------------------------------------------------------------------------
# Runtime. Debian, not Alpine — the same call telemetry-service's own
# Dockerfile.prod already made (its Rust binary is glibc, not musl); running
# every process on the same base means one apt-get instead of an apk/apt
# split for a container that already has eight things to keep straight.
# supervisord runs and restarts all eight; only api-gateway is reachable
# from outside this container (see supervisord.conf's comment on why the
# other seven need no public port at all once nothing has to wake them).
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates supervisor \
    && rm --recursive --force /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app --home-dir /app --create-home app

COPY --from=gateway-builder    /out/api-gateway        /app/gateway/api-gateway
COPY --from=dna-builder        /out/dna-service         /app/dna/dna-service
COPY --from=universe-builder   /out/universe-service    /app/universe/universe-service
COPY --from=nature-builder     /out/nature-service      /app/nature/nature-service
COPY --from=ocean-builder      /out/ocean-service       /app/ocean/ocean-service
COPY --from=auth-builder       /out/auth-service        /app/auth/auth-service
COPY --from=analytics-builder  /out/analytics-service   /app/analytics/analytics-service
COPY --from=telemetry-builder  /workspace/services/telemetry-service/target/release/telemetry-service /app/telemetry/telemetry-service

# Migrations directories: each cmd/service main.go runs its own migration on
# boot against DATABASE_DIRECT_URL before it does anything else (see
# agent-system/skills/production-deployment-guide.md §5) — nothing here invokes
# cmd/migrate separately, this only has to put the SQL where MIGRATIONS_DIR
# (set per-process in supervisord.conf) points. telemetry-service needs no
# entry here: sqlx::migrate! embeds its migrations into the binary itself.
COPY services/dna-service/migrations        /app/dna/migrations
COPY services/universe-service/migrations   /app/universe/migrations
COPY services/nature-service/migrations     /app/nature/migrations
COPY services/ocean-service/migrations      /app/ocean/migrations
COPY services/auth-service/migrations       /app/auth/migrations
COPY services/analytics-service/migrations  /app/analytics/migrations

COPY deploy/single-container/supervisord.conf /etc/supervisor/conf.d/myunivokai.conf
COPY deploy/single-container/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /var/log/supervisor && chown -R app:app /app /var/log/supervisor

# The platform's single public port. Only api-gateway binds it; the other
# seven processes bind localhost-only ports for supervisord's own use (none
# of them serve public traffic — see supervisord.conf).
EXPOSE 8080

# The entrypoint runs as root to write /app/secrets/nats.creds from
# NATS_CREDS_CONTENT and hand it the right ownership, then execs supervisord
# — which also stays root (it drops privilege per-program via `user=app` in
# supervisord.conf) so it can write /var/log/supervisor and manage child
# processes; every app process it launches does not run as root.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/conf.d/myunivokai.conf"]

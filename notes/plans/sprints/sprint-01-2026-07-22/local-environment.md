# Sprint 01 local Docker environment contract

> **Document status:** Implemented and verified on a local Docker Engine
> **Sprint starts:** 2026-07-22
> **Last source review:** 2026-07-23

This contract preserves the repository's explicit local naming style while
separating shared infrastructure from component-owned development containers.

## 1. Decisions

- Keep root filename `docker-compose-local.yaml`.
- Use `.env.local` as the active local environment filename.
- Keep a `docker-compose-local.yaml` inside every app/service for standalone
  development.
- Put only shared dependencies in `infra/docker-compose-local.yaml`.
- Keep domain folder suffixes: `dna-service`, `universe-service`,
  `nature-service`, and future `city-service`.
- Rename `clients/web-client` to `apps/myunivokai-web` during Sprint 1.
- Every deployable owns `Dockerfile.local` and `Dockerfile.prod`.
- Production Dockerfiles use exactly two stages: builder and minimal runtime.
- Production credentials never live in any `.env.local`.

## 2. Target tree

```txt
docker-compose-local.yaml          # integrated stack aggregator
.env.local                        # integrated local values

infra/
  docker-compose-local.yaml        # shared dependencies only
  .env.local                      # standalone infra values
  nats/
    nats-server.conf
  redis/
    redis.conf
  postgres/
    init-databases.sh

apps/
  myunivokai-web/
    docker-compose-local.yaml
    .env.local
    Dockerfile.local
    Dockerfile.prod

services/
  api-gateway/
    docker-compose-local.yaml
    .env.local
    Dockerfile.local
    Dockerfile.prod
  dna-service/
    docker-compose-local.yaml
    .env.local
    Dockerfile.local
    Dockerfile.prod
    migrations/
  universe-service/
    docker-compose-local.yaml
    .env.local
    Dockerfile.local
    Dockerfile.prod
    migrations/
  nature-service/
    docker-compose-local.yaml
    .env.local
    Dockerfile.local
    Dockerfile.prod
    migrations/
```

## 3. Compose ownership

### Root aggregator

Root `docker-compose-local.yaml` contains no duplicated service definition. It
uses top-level `include`:

```yaml
name: myunivokai-local

include:
  - path: ./infra/docker-compose-local.yaml
    env_file: ./.env.local
  - path: ./services/api-gateway/docker-compose-local.yaml
    env_file: ./.env.local
  - path: ./services/dna-service/docker-compose-local.yaml
    env_file: ./.env.local
  - path: ./services/universe-service/docker-compose-local.yaml
    env_file: ./.env.local
  - path: ./services/nature-service/docker-compose-local.yaml
    env_file: ./.env.local
  - path: ./apps/myunivokai-web/docker-compose-local.yaml
    env_file: ./.env.local
```

`include` requires Docker Compose 2.20 or later. Unlike combining unrelated
files with multiple `-f` flags, included files resolve build contexts, bind
mounts and config paths relative to their own folder. The implementation must
run `docker compose config` in CI to detect name/resource conflicts.

The long syntax wires the root `.env.local` into interpolation for every
included model. Therefore normal integrated commands do not need a repeated
`--env-file` flag. Each application runtime also declares its component
`.env.local` through service-level `env_file`; explicit `environment` entries
remain the higher-precedence whitelist used by the integrated stack. Migration
jobs and shared infrastructure intentionally keep explicit variable lists so a
database initializer never receives AI keys and one infrastructure container
never receives another component's credentials.

Reference: [Docker Compose include](https://docs.docker.com/reference/compose-file/include/).

### Shared infra

`infra/docker-compose-local.yaml` owns only:

```txt
postgres
postgres-init
nats
nats-bootstrap
redis
```

Responsibilities:

- one PostgreSQL server with three logical databases and least-privilege roles;
- JetStream-enabled NATS, local users/subject permissions, streams and durable
  consumer bootstrap;
- Redis persistence/health for local rate-limit and cache tests;
- shared backend network and named data volumes.

It does not build or start application/domain code.

### Component Compose files

Each component owns its container definition, build context, environment,
source mounts, health check and service-specific dependency declarations.

| Compose file | Owned containers |
| --- | --- |
| `apps/myunivokai-web/docker-compose-local.yaml` | `myunivokai-web` |
| `services/api-gateway/docker-compose-local.yaml` | `api-gateway` |
| `services/dna-service/docker-compose-local.yaml` | `dna-migrate`, `dna-service` |
| `services/universe-service/docker-compose-local.yaml` | `universe-migrate`, `universe-service` |
| `services/nature-service/docker-compose-local.yaml` | `nature-migrate`, `nature-service` |

Domain services expose no host HTTP business port after the NATS migration.
Migration jobs remain component-owned even though PostgreSQL is shared infra.

## 4. Local and production Dockerfiles

### `Dockerfile.local`

The local image optimizes developer feedback, not size:

- Go SDK or Node toolchain is present;
- dependencies are cached in dedicated layers/volumes;
- source is bind-mounted or synchronized;
- Go services use a pinned hot-reload/watch tool or Compose watch;
- Next.js runs its development server;
- readable build output and race/debug tooling may be enabled;
- local Compose selects only `Dockerfile.local`.

### `Dockerfile.prod`

Every production Dockerfile has exactly two stages:

```txt
builder -> runtime
```

Go production rules:

- builder downloads modules and produces stripped static service/migration
  binaries;
- runtime uses a minimal pinned base, non-root user and required CA
  certificates only;
- no Go compiler, module cache or source tree remains;
- Universe/Nature/DNA background processes expose no fake HTTP port.

Next.js production rules:

- builder performs `npm ci` and `npm run build` in one stage;
- runtime copies only `public`, standalone output and static output;
- runtime uses a non-root user and production environment;
- no development dependencies or source tree are copied.

Production configuration (`render.yaml`) references `Dockerfile.prod` only.
Local Compose references `Dockerfile.local` only. The current generic
`Dockerfile` and `Dockerfile.render` names are retired after equivalent smoke
tests pass.

## 5. Environment files

### Integrated root `.env.local`

Root `.env.local` is the source for a full local stack. It includes:

```dotenv
COMPOSE_PROJECT_NAME=myunivokai-local
APP_ENV=development

WEB_PORT=41300
GATEWAY_PORT=41800
POSTGRES_PORT=15432
NATS_CLIENT_PORT=14222
NATS_MONITOR_PORT=18222
REDIS_PORT=16379

POSTGRES_ADMIN_USER=myunivokai_admin
POSTGRES_ADMIN_PASSWORD=<local-only-value>

DNA_DATABASE_NAME=myunivokai_dna
DNA_DATABASE_USER=myunivokai_dna_app
DNA_DATABASE_PASSWORD=<local-only-value>

UNIVERSE_DATABASE_NAME=myunivokai_universe
UNIVERSE_DATABASE_USER=myunivokai_universe_app
UNIVERSE_DATABASE_PASSWORD=<local-only-value>

NATURE_DATABASE_NAME=myunivokai_nature
NATURE_DATABASE_USER=myunivokai_nature_app
NATURE_DATABASE_PASSWORD=<local-only-value>

NATS_URL=nats://nats:4222
NATS_STREAM_COMMANDS=MYUNIVOKAI_COMMANDS
NATS_STREAM_EVENTS=MYUNIVOKAI_EVENTS
NATS_GATEWAY_USERNAME=myunivokai_gateway
NATS_GATEWAY_PASSWORD=<local-only-value>
NATS_DNA_USERNAME=myunivokai_dna
NATS_DNA_PASSWORD=<local-only-value>
NATS_UNIVERSE_USERNAME=myunivokai_universe
NATS_UNIVERSE_PASSWORD=<local-only-value>
NATS_NATURE_USERNAME=myunivokai_nature
NATS_NATURE_PASSWORD=<local-only-value>

REDIS_URL=redis://redis:6379/0
REDIS_PASSWORD=<local-only-value>
REDIS_KEY_PREFIX=myunivokai

RATE_LIMIT_REQUESTS_PER_SECOND=2
RATE_LIMIT_BURST=20
JOB_CACHE_TTL=30s
WORLD_CACHE_TTL=60s
SHARE_CACHE_TTL=60s

NATS_REQUEST_TIMEOUT=3s
NATS_QUERY_TIMEOUT=2500ms
NATS_ACK_WAIT=2m
NATS_MAX_DELIVER=5
NATS_FETCH_BATCH_SIZE=1
NATS_FETCH_MAX_WAIT=1s
NATS_RETRY_DELAY=2s
NATS_CONNECT_TIMEOUT=5s
NATS_RECONNECT_WAIT=2s
NATS_PUBLISH_TIMEOUT=5s
SERVICE_SHUTDOWN_TIMEOUT=15s

AI_PROVIDER=mock
AI_FALLBACK_PROVIDER=mock
AI_ENABLE_FALLBACK=true
AI_TIMEOUT=35s
GEMINI_API_KEY=
OPENAI_API_KEY=

NEXT_PUBLIC_GATEWAY_BASE_URL=http://localhost:41800
```

### Component `.env.local`

Each component keeps a minimal `.env.local` for running only that component.
It contains only variables owned/consumed by that component. Integrated startup
must ensure root values override or match component defaults; Sprint 1 adds a
configuration consistency check so credentials/ports cannot drift silently.

Policy:

- local/mock-only values may be committed if they grant no access outside the
  developer machine/Compose network;
- real AI keys, managed NATS credentials, Redis URLs and Neon URLs are always
  ignored and supplied out of band;
- production never loads `.env.local`;
- frontend `.env.local` contains only `NEXT_PUBLIC_*` values intended for the
  browser.

Do not reintroduce target-runtime `UNIVERSE_SERVICE_URL`,
`NATURE_SERVICE_URL`, or `GATEWAY_SHARED_SECRET`.

## 6. Networks, volumes and ports

Networks:

```txt
edge     myunivokai-web, api-gateway
backend  api-gateway, dna-service, universe-service, nature-service,
         postgres, nats, redis
```

Named volumes:

```txt
myunivokai-postgres-data
myunivokai-nats-data
myunivokai-redis-data
```

Published developer ports:

| Port | Purpose |
| ---: | --- |
| 41300 | branded web app |
| 41800 | gateway HTTP API |
| 15432 | optional local PostgreSQL diagnostics; container port remains 5432 |
| 14222 | optional local NATS CLI/client diagnostics; container port remains 4222 |
| 18222 | local NATS monitoring; container port remains 8222 |
| 16379 | optional local Redis diagnostics; container port remains 6379 |

The non-default host ports avoid collisions with PostgreSQL, NATS, or Redis
already installed on a developer machine. All container-to-container URLs keep
their standard ports, so this does not change application behavior.

Database/NATS/Redis diagnostic ports bind to localhost only where Compose
supports the host binding syntax. Domain services publish no host port.

## 7. Startup order

1. PostgreSQL, NATS and Redis pass health checks.
2. `postgres-init` creates databases/roles idempotently.
3. `nats-bootstrap` creates streams and consumers idempotently.
4. DNA/Universe/Nature migrations complete.
5. Domain consumers/responders connect and become ready.
6. Gateway verifies NATS and Redis readiness.
7. `myunivokai-web` starts against the single gateway origin.

## 8. Developer commands

Integrated stack:

```powershell
docker compose --env-file .env.local -f docker-compose-local.yaml config
docker compose --env-file .env.local -f docker-compose-local.yaml up --build
docker compose --env-file .env.local -f docker-compose-local.yaml ps
docker compose --env-file .env.local -f docker-compose-local.yaml down
```

`--env-file .env.local` is required. Compose auto-loads a root `.env` when the
flag is absent, and that file outranks the `env_file:` entries under `include:`,
so a machine holding a deploy-shaped `.env` boots the local stack against
production NATS, production Redis and the live AI provider. `make local-up`
passes the flag.

Standalone component example:

```powershell
docker compose --env-file infra/.env.local `
  -f infra/docker-compose-local.yaml up -d
docker compose --env-file services/universe-service/.env.local `
  -f services/universe-service/docker-compose-local.yaml up --build
```

The first command owns shared dependencies. Component Compose files remain
valid independently and join the same named network, but do not duplicate or
implicitly create NATS, Redis, or PostgreSQL.

Volume reset is destructive and deliberately separate. Before running a reset,
resolve and confirm the Compose project is exactly `myunivokai-local`; state
that local PostgreSQL, JetStream and Redis data will be removed.

## 9. Runtime evidence

Verified at `2026-07-22T17:23:50Z` on Docker Engine 27.4.0 using the root
command without `--env-file`:

- all local images built successfully;
- PostgreSQL, NATS, Redis, Gateway, DNA, Universe, and Nature became healthy;
- PostgreSQL/NATS bootstrap and all three migrations exited with code 0;
- Web, Gateway liveness/readiness, and NATS monitor returned HTTP 200;
- a Universe job completed as world
  `a8783af6-6d68-4855-9498-811bbf652010` with `sceneType=universe`;
- a Nature job completed as world
  `bba11de8-46f2-49e4-8217-3e6b4aabf3d1` with `sceneType=forest`;
- no fatal/error/panic entry appeared in the final two minutes of runtime.

The smoke exposed and fixed two portability issues: standard dependency ports
collided with host installations, and Windows CRLF broke Alpine shell scripts.
Diagnostic host ports now use the documented project-specific range, while
`.gitattributes` keeps container-mounted shell scripts on LF.

Revalidated at `2026-07-22T17:52Z` after splitting Gateway/domain handlers and
externalizing NATS runtime policy:

- root and all component Compose config gates passed;
- every required runtime was healthy and migrations/bootstrap exited 0;
- Universe job `01KY5FBB9C45SY4YWE557Z02XT` completed as world
  `0e382246-542c-4e16-a6c3-a5a77c4720d1` with `sceneType=universe`;
- Nature job `01KY5FBCARRB79RQ3Q3JQ8PNFK` completed as world
  `f2f46410-b8e4-4a20-af77-7af0d547c415` with `sceneType=forest`;
- the same mock input produced different valid archetypes, confirming restored
  random ProfileDNA preset selection;
- no fatal/error/panic entry appeared in Gateway, domain, NATS, Redis, or
  PostgreSQL logs;
- shutdown used `down` without `-v`, so persisted local volumes were retained.
- all five `Dockerfile.prod` targets built their final runtime images;
- production dependency audit remains a separate failing gate because the
  existing Next.js 14 tree has a high-severity advisory; see
  `S1-SECURITY-001` before any production promotion.

## 10. Acceptance

- [x] Docker Compose 2.20+ is validated before using `include`.
- [x] `docker compose ... config` resolves every included file without
      duplicate resource names or wrong relative paths.
- [x] Root and component runtime `.env.local` files are referenced explicitly;
      integrated commands no longer depend on an implicit CLI flag.
- [ ] Full stack and each component Compose path are documented and tested.
- [x] Local images use `Dockerfile.local`; production uses `Dockerfile.prod`.
- [x] Every production Dockerfile contains exactly builder/runtime stages.
- [ ] Production image inspection finds no compiler, package cache, source tree
      or real secret.
- [ ] Hot reload/watch works for Go and Next.js local development.
- [x] Fresh local volumes initialize databases, NATS and Redis automatically.
- [ ] Restart preserves pending JetStream work and local data volumes.
- [x] Domain services are unreachable through host HTTP.
- [x] No production credential exists in a tracked `.env.local`.

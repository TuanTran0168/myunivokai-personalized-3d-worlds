# Implemented product capabilities

> **Document status:** Active source-backed inventory of the current platform
> **Last source review:** 2026-07-23

Sprint-specific acceptance and verification stay with each dated sprint. This
file is only a compact inventory of capabilities that now exist in source; the
current architecture remains
[Vision V1](../../plans/architecture/v1-2026-07-22/solution-architecture.md).

## US-CURRENT-001 — One browser API origin

Status: Implemented

As a frontend user,
I want every API request to use one gateway origin,
so that deployment and browser security policy have one public edge.

Scenario: Route a selected family

Given the web client is built with `NEXT_PUBLIC_GATEWAY_BASE_URL`
When it requests a Universe or Nature operation
Then it calls `/api/universe/*` or `/api/nature/*` on that gateway origin
And no domain-service hostname is frontend configuration.

Source evidence:

- `apps/myunivokai-personalization/src/lib/gateway.ts`
- `apps/myunivokai-personalization/src/lib/api.ts`
- `services/api-gateway/internal/handlers/router.go`
- `services/api-gateway/internal/handlers/dna_job_handler.go`
- `services/api-gateway/internal/handlers/universe_handler.go`
- `services/api-gateway/internal/handlers/nature_handler.go`
- `services/api-gateway/internal/handlers/rpc_transport.go`
- `render.yaml`

## US-CURRENT-002 — Create both portrait families asynchronously

Status: Implemented in source

As a visitor,
I want to choose Universe or Forest from the create screen,
so that the same personal input can become a different visual medium.

Scenario: Generate a family-specific world

Given the create page shows the Universe/Forest picker
When the visitor submits the form for one family
Then the gateway durably publishes one generation command
And `dna-service` creates canonical DNA before the selected family composes it
And job polling leads to the matching deterministic renderer and family route.

Source evidence:

- `apps/myunivokai-personalization/src/app/page.tsx`
- `apps/myunivokai-personalization/src/lib/api.ts`
- `services/api-gateway/internal/handlers/world_handler.go`
- `services/api-gateway/internal/handlers/universe_handler.go`
- `services/api-gateway/internal/handlers/nature_handler.go`
- `services/dna-service/internal/services/generation_service.go`
- `services/dna-service/internal/ai/providers/mock_presets.go`
- both family services' `internal/services/world_service.go`

## US-CURRENT-003 — Regenerate without another AI call

Status: Implemented

As a world owner,
I want a new visual variant without another provider request,
so that experimentation is fast, deterministic, and inexpensive.

Scenario: Regenerate a variant

Given a stored world already has a DNA snapshot
When the client posts to its variants endpoint
Then the selected family service creates a new seed/config through its
deterministic builder
And it does not invoke an AI provider.

Source evidence:

- both family services' `internal/services/world_service.go`
- both family services' `internal/services/world_service_test.go`
- `services/dna-service/internal/ai/provider.go`

## US-CURRENT-004 — Prevent direct domain-service bypass

Status: Implemented in source

As a platform operator,
I want domain services reachable only over authorized NATS subjects,
so that callers cannot bypass edge CORS, rate limits, and validation.

Scenario: Call a domain service directly

Given Universe, Nature, and DNA run as private background services without HTTP listeners
When a caller has no service-specific NATS credential or tries an unauthorized subject
Then NATS rejects the publish/subscribe operation
And only the public gateway exposes business HTTP routes.

Source evidence:

- `infra/nats/nats-server.conf`
- all three domain services' `internal/messaging/runtime.go` and
  `internal/handlers/nats_handler.go`
- `services/api-gateway/internal/handlers/router.go`
- `render.yaml`

## US-CURRENT-005 — Publish privacy-safe share pages

Status: Implemented

As a world owner,
I want to publish a shareable 3D portrait,
so that other people can view its meaning without receiving my raw personal input.

Scenario: Read a published world

Given a selected variant has been published
When a visitor opens the family-specific share route
Then the frontend fetches it through the gateway and renders the selected scene
And the public response model omits raw `WorldInput` and the private DNA snapshot.

Source evidence:

- both family services' `internal/handlers/nats_handler.go`
- both family services' `internal/models/responses.go`
- both frontend share routes under `apps/myunivokai-personalization/src/app/`

## US-CURRENT-006 — Start the full local topology once

Status: Verified on local Docker Engine

As a developer,
I want one local command to run web, gateway, three domain services, migrations,
three databases, NATS, and Redis,
so that localhost exercises the production request boundary.

Scenario: Start the integrated stack

Given Docker is running
When the developer runs `docker compose -f docker-compose-local.yaml up --build`
Then PostgreSQL initializes three owned databases and migrations complete
And NATS JetStream/ACL bootstrap and Redis become available to the fleet
And domain services expose no host HTTP ports
And the web client uses only `http://localhost:41800`.

Source evidence:

- root `docker-compose-local.yaml`
- `infra/docker-compose-local.yaml`
- root `Makefile`
- each component's `docker-compose-local.yaml`
- both family lifecycle smoke records in the Sprint 1 local environment guide

# Backend agent

> **Document status:** Active
> **Last source review:** 2026-08-29

**Scope:** `services/*`, `contracts/*`, NATS subjects and consumers, Postgres
migrations, Redis keys.

## Reading order

1. [../rules/coding-style.md](../rules/coding-style.md) and
   [../rules/git-convention.md](../rules/git-convention.md).
2. [../knowledge/backend/source-overview.md](../knowledge/backend/source-overview.md)
   — who owns which data, and how the services talk over NATS and Redis.
3. [../knowledge/backend/request-lifecycle.md](../knowledge/backend/request-lifecycle.md)
   — **mandatory** before changing any route, cache key or event. It carries the
   share-page bug that proved why Redis invalidation is not optional.
4. Then whichever applies:
   - a new external integration →
     [../knowledge/backend/design-decisions.md](../knowledge/backend/design-decisions.md)
     for the one-interface-per-vendor rule
   - anything in `services/telemetry-service` →
     [../knowledge/backend/rust-service-architecture.md](../knowledge/backend/rust-service-architecture.md)
   - a family or service change → its contract in
     [../plans/services/](../plans/README.md#services), **corrections section
     first**
   - gateway error handling, `/healthz`, wake adapters, `/api/admin/wake-stats` →
     [../plans/architecture/service-wake-mechanism.md](../plans/architecture/service-wake-mechanism.md)

## Do not read

`../knowledge/frontend/*` — the client's contract with you is entirely in
`contracts/`. If a frontend document would change your decision, the contract is
underspecified and that is the thing to fix.

`../memory/execution-records/api-gateway-historical.md` as a design. It is the
pre-V1 HTTP peer gateway and describes a shape the platform deliberately left.

## Rules specific to this work

**Adding a world family is not one change.** Two of the required steps are
invisible to the compiler and to every test, and a family that skips them
half-works in a way that looks like a data bug:

1. the Postgres family `CHECK` constraint has to accept the new value — a
   migration, not a code change;
2. the `dna-family-results-v1` JetStream consumer's subject filter has to
   include the new family, or its results are published and never consumed.

Neither is generated. Both must be done by hand, and the second fails silently.

**Read a plan's corrections before its design.** `plans/services/ocean-service-plan.md`
§16 contradicts its own §2 and §7: a seam the plan called "None" needed three
changes, and two zone boundaries made two of the three seas identical.
`plans/services/analytics-service-plan.md` §Corrections found in implementation
records four more, including a pre-existing `$JS.ACK.>` gap in the local NATS
ACL.

**One interface per vendor.** `ai.Provider`, `wake.Platform` and `TelemetrySink`
all follow the same shape, and a fourth integration is expected to. Business
services depend on the interface, never on a provider.

**AI is never called from the client, and never produces geometry.** It produces
the semantic profile only — the reasoning is in
[../knowledge/backend/design-decisions.md](../knowledge/backend/design-decisions.md).

## Done means

`go build ./...` and `go test ./...` clean across every touched service; any new
migration applied against a local database and rolled forward from empty; any
new NATS subject exercised end to end through
`infra/docker-compose-local.yaml`, not just unit-tested.

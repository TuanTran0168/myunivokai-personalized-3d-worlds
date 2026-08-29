# Nature Service

Nature Service is the private NATS bounded context for deterministic Forest
worlds. It does not expose HTTP and does not call an AI provider.

It consumes `myunivokai.commands.nature.compose.v1`, snapshots canonical
ProfileDNA, builds the existing Forest SceneConfig, persists inbox/world/variant
and completion outbox atomically, and answers versioned Core NATS queries for
get/list/variant/select/publish/share.

`internal/handlers/NATSHandler` owns compose and world-lifecycle transport
handling; `internal/messaging` owns NATS connection, subscription, retry/ack,
and outbox lifecycle.

## World-change events (S4-ANALYTICS-002)

Every mutation — variant create, variant select, publish — bumps
`worlds.revision` and writes a `world.changed` snapshot to the outbox **inside
the same transaction as the mutation**. World creation carries its first
snapshot on the existing `completed` event instead, so `analytics-service` has
one projection function rather than two.

`internal/repositories/world_snapshot.go` is the single place that decides
what leaves this database. It is an **allow list**, not a projection of the
row: the world quote, the DNA snapshot, variant scene configs and share slugs
are absent on purpose and must stay absent — see
[notes/plans/services/analytics-service-plan.md](../../notes/plans/services/analytics-service-plan.md)'s
data boundary.

Two behaviours worth knowing before changing this code:

- **A mutation that changes nothing emits nothing.** Re-publishing an
  already-published world returns the existing share unchanged, so it bumps no
  revision — a snapshot describing no state change would appear in the admin
  app as a real edit.
- **`revision`, not a timestamp, orders the read model.** JetStream delivers
  duplicates and can reorder; the projection upserts only when the incoming
  revision is greater, which comparing wall-clock timestamps written by two
  different services could never do correctly.

`world_snapshot_test.go` asserts every mutating store method leaves an event
behind. When you add a mutation, add it there — the failure mode otherwise is
silent: this database keeps changing and the admin app stops.

```powershell
go test ./...
go vet ./...
go build ./...
go run ./cmd/migrate
go run ./cmd/service
```

Local integrated startup is owned by root `docker-compose-local.yaml`. Standalone
component startup expects `infra/docker-compose-local.yaml` to already be running.
Production uses the two-stage `Dockerfile.prod` and Render Background Worker
name `myunivokai-nature`—the runtime type is intentionally not appended to the
name.

The Forest renderer/asset contract is documented in
`notes/knowledge/frontend/forest-render-mechanism.md` and remains covered by deterministic and
golden tests.

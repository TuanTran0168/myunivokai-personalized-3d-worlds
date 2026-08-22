# Universe Service

Universe Service is the private NATS bounded context for deterministic solar
system worlds. It consumes canonical ProfileDNA snapshots, owns
`myunivokai_universe`, and answers world lifecycle queries through Core NATS.
It exposes no HTTP server and contains no provider adapter.

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
[notes/vision/analytics-service-plan.md](../../notes/vision/analytics-service-plan.md)'s
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

Production uses `Dockerfile.prod` as Render Background Worker
`myunivokai-universe`. Local integrated startup is owned by the root Compose
aggregator; component Compose expects shared `infra` to be running.

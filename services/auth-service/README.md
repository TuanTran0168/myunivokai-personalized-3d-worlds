# Auth Service

Auth Service is the private NATS bounded context for staff identity. It owns
`myunivokai_auth` and answers login/refresh/logout/tokenversion/account
queries through Core NATS. It exposes no HTTP business API — the same rule
every other domain service follows — and it never reads a world, a variant
or a job. See [agent-system/plans/services/auth-and-admin-plan.md](../../agent-system/plans/services/auth-and-admin-plan.md).

`internal/services/AuthService` owns the login/refresh/logout/lockout rules;
`internal/security` owns Argon2id password hashing and Ed25519 access-token
minting/verification; `internal/redis` writes the `tokenVersion` cache the
gateway's revocation check reads; `internal/handlers/NATSHandler` owns
transport; `internal/messaging` owns the NATS connection and subscriptions —
Core NATS request-reply only, no JetStream command or outbox, since
auth-service publishes no domain event.

## Repository layout

`internal/repositories` has one `Store` interface and one implementation per
backend (`PostgresStore`, `MemoryStore`) — matching the pattern
universe-service, nature-service and dna-service already use elsewhere in
this repo, rather than a separate repository type per aggregate
(`AccountRepository`, `RoleRepository`, ...). What's split **within** each
implementation is the *file*, not the *type*: `postgres_accounts.go`,
`postgres_refresh_tokens.go`, `postgres_roles_permissions.go` and
`postgres_audit.go` (mirrored by `memory_*.go`) all define methods on the
same `*PostgresStore` / `*MemoryStore` receiver — Go has no rule that a
type's methods live in one file, so this is purely a readability split, not
an architectural one.

This was a deliberate choice over per-aggregate repositories: a second
interface per aggregate would be inconsistent with every other service in
this repo, and would cost real wiring (multiple constructor arguments, a
composed interface, more mocks in tests) for an auth database with five
tables. Reconsider if a table set here ever grows enough that one file per
concern stops being enough on its own — that has not happened yet.

## Invite flow (S4-AUTH-005)

`accounts.password_hash` is nullable: an invited account exists with no
password from the moment `AuthInviteCreateQuerySubject` creates it, guarded
by a check constraint requiring either a password or a live invite token
(`migrations/000002_invite_flow.sql`). No email infrastructure exists, so
the raw invite token is returned once to the inviting staff member (the
admin app's invite dialog surfaces it directly) to relay out of band.
`AuthInviteAcceptQuerySubject` sets the password and logs the account in —
the same `LoginResponseData` shape a normal login returns.

## Key rotation

`TokenIssuer` signs with one private key at a time; the gateway's
`TokenVerifier` accepts a list of public keys, so a rotation adds the new
key to the gateway before switching auth-service to sign with it, and only
removes the old key once every session has had time to refresh. See
[agent-system/skills/admin-key-rotation-drill.md](../../agent-system/skills/admin-key-rotation-drill.md)
for the exact steps and a real run's observed results.

## First run

Generate an Ed25519 seed for `AUTH_ACCESS_PRIVATE_KEY` (32 raw bytes,
base64-encoded) and put it in the root `.env.local` — never commit a real
value:

```powershell
# any of these work; all print a base64 32-byte value
openssl rand -base64 32
```

Then create the first account (no self-signup exists anywhere in this
service):

```powershell
go run ./cmd/bootstrap --email you@example.com --password "a-strong-password-12-chars-or-more"
```

or set `AUTH_BOOTSTRAP_EMAIL` / `AUTH_BOOTSTRAP_PASSWORD` instead of flags.
The created account is a super admin and must change its password on first
login.

```powershell
go test ./...
go vet ./...
go build ./...
go run ./cmd/migrate
go run ./cmd/service
```

Production uses `Dockerfile.prod` as a Render web service, `myunivokai-auth`
— a free-tier `PORT`-bound health server for the same cold-start reason every
other domain service has one; see
[agent-system/plans/architecture/service-wake-mechanism.md](../../agent-system/plans/architecture/service-wake-mechanism.md).
Local integrated startup is owned by the root Compose aggregator; component
Compose expects shared `infra` to be running.

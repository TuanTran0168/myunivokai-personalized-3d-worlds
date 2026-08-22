# CI and quality gates

> **Document status:** Active
> **Last source review:** 2026-07-22

`.github/workflows/ci.yml` runs on every push and pull request to `staging` or
`main`. Jobs are intentionally not path-filtered.

## Contract job

The shared Go module runs module verification, vet, test, and build. The same
job lints **both** `contracts/openapi.yaml` and `contracts/openapi-admin.yaml`
with the pinned Redocly CLI version — the admin spec is deliberately a separate
document so the public API spec never advertises staff routes.

Its tests also **enforce** the JSON Schemas rather than only parsing them
(`contracts/go/schema_conformance_test.go`): the committed fixtures and both
families' golden scenes are validated against the schema that claims to describe
them, and deliberately broken scenes prove the validator rejects. Nothing is
fetched over the network — a `$ref` to an unregistered URL fails compilation, so
a document is only ever checked against schemas in this repository.

This is the gate that catches a builder and its contract drifting apart. It
found four such drifts the first time it ran (wind gust frequency, weather
intensity and both rain-drop counts had outgrown their documented ranges), none
of which any other check could see.

The mutation tests are not optional decoration. A schema can be vacuous — the
universe scene schema mostly asserts which sections must be present — so "the
fixture passed" means nothing until a deletion is shown to fail. Each family
therefore has a set of mutations that must be rejected.

## Golden scene fixtures

Both families commit golden scene configs, and they serve two purposes at once:

| Family | Fixtures | Guards |
| --- | --- | --- |
| Nature | `services/nature-service/internal/services/testdata/forest-golden-*.json` | byte-level builder output, plus forest scene schema conformance |
| Universe | `services/universe-service/internal/services/testdata/universe-golden-*.json` | byte-level builder output, plus universe scene schema conformance |

The service-side test compares bytes: a saved world must render forever, so any
change to what the builder emits for an existing seed is a breaking change.
Regenerate only deliberately, after bumping the family's scene schema version:

```txt
UPDATE_GOLDEN=1 go test ./internal/services -run TestGoldenFixtures          # nature
UPDATE_GOLDEN=1 go test ./internal/services -run TestUniverseGoldenFixtures  # universe
```

The universe cases cover all five themes, because the theme selects palette,
sky, belt, sun and grade — one theme would fix a fifth of the surface.

## Backend jobs

Six independent jobs run in:

- `services/dna-service`;
- `services/universe-service`;
- `services/nature-service`;
- `services/api-gateway`;
- `services/auth-service`;
- `services/analytics-service`.

Each runs:

```txt
go mod verify -> go vet ./... -> go test ./... -> go build ./...
```

## Frontend jobs

Two, one per app:

```txt
# apps/myunivokai-web
npm ci -> npm run typecheck -> npm run lint -> npm run test -> npm run build

# apps/myunivokai-admin
npm ci -> npm run typecheck -> npm run lint -> npm run check:boundary -> npm run test -> npm run build
```

`check:boundary` is the admin app's own gate and exists only there: it fails
the build on any import of `apps/myunivokai-web` or three.js, which is the
only mechanical way to keep "the two apps share no code" true over time.

Go and npm dependency caches are enabled, and the concurrency group cancels a
superseded run on the same ref.

## Local environment job

The root Compose graph is rendered with `.env.local` so invalid includes,
interpolation, service references, or Compose syntax fail in CI without
requiring the containers to start.

## Branch protection

Require all ten jobs before merging to `staging` or `main`:

- `Contracts (lint + vet + test + build)`;
- `Backend (go vet + test)` (legacy display name; this is universe-service, and the job now also builds);
- `Nature service (go vet + test)` (legacy display name; also builds);
- `DNA service (go vet + test + build)`;
- `Auth service (go vet + test + build)`;
- `Analytics service (go vet + test + build)`;
- `API gateway (go vet + test + build)`;
- `Frontend (typecheck + lint + test + build)`;
- `Admin app (typecheck + lint + boundary + test + build)`;
- `Local Compose configuration`.

Adding a Go module means adding a job here **and** in the branch-protection
list — a module with no job is not covered by anything, and a job missing from
the required list can go red without blocking a merge.

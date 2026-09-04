# `family-platform/go` — the code the three family services share

> **Document status:** Implemented
> **Last source review:** 2026-09-05

**This is not a service.** It has no `cmd/`, it is not in `render.yaml`, and it
deploys nowhere. It sits beside `contracts/go` rather than inside `services/`
for exactly that reason: everything under `services/` is a deployable, and this
is not one.

`contracts/go` is the precedent, not an analogy — same shape, same
`replace` directive in each consumer's `go.mod`, same position in the tree. The
difference is what each holds: **`contracts/go` holds the shapes that cross a
service boundary; this holds behaviour that happens to be identical inside
several services.** A thing that crosses the wire belongs in `contracts/go`
even if it also happens to be shared code.

## Why it exists

`universe-service`, `nature-service` and `ocean-service` each carried their own
copy of the same platform layer. Measured on 2026-09-05, before this module:

- `internal/repositories/world_ownership.go` was **byte-identical** across all
  three — `diff` exited 0, with no normalisation at all;
- `internal/config/config.go` differed in **one line**, and that line was
  `PUBLIC_WEB_URL`'s default, which was **wrong** in universe's copy;
- `internal/db/migrations.go` and `internal/db/pool.go` differed in **none**;
- of the 24 commits that had ever touched these files, **18 had to edit two or
  more services at once, and 9 had to edit all three.**

That last number is the argument. A 75% fan-out rate is a tax on every future
change, and the share-link defect fixed in the commit before this one is what
it costs when it is paid in production instead of in review: one wrong string,
copied three times, wrong in all three.

## What may enter, and what may not

The rule is about **dependencies, not tidiness**, because tidiness is how a
shared module becomes a junk drawer.

**May enter:** code that is identical in every family service and depends only
on the standard library, an external library, or `contracts/go`.

**May not enter:**

- **anything that imports a service's `internal/models`.** The three families'
  world types genuinely differ, and unifying them needs a decision — generics,
  an interface, or raw JSON — that has not been taken. `store.go`,
  `memory_store.go`, `postgres_store.go`, `nats_handler.go` and `runtime.go`
  are near-identical and are still deliberately outside this module for that
  reason alone. See §7 Tier 1 of
  [`admin-surface-and-family-service-duplication.md`](../../agent-system/plans/architecture/admin-surface-and-family-service-duplication.md).
- **anything a family could reasonably want to differ on.** Scene profiles,
  config builders and depth curves are different because the families are
  different. Moving them here is the failure mode, not the goal.
- **anything with only one caller.** One copy is not duplication.
- **a new abstraction invented to make something fit.** If a file needs an
  interface in order to move, it is not ready to move.

## What is here

| Package | Holds | Notes |
| --- | --- | --- |
| `config` | `Config`, `Load`, `Validate` | `Load` takes the family, and derives the `PUBLIC_WEB_URL` default from it. The family is a parameter and not an environment variable because which family a process is cannot be configured — it is decided by which binary is running |
| `db` | `Connect`, `Migrate` | Each family still owns its own database and its own migration files; only how they are reached is shared |
| `ownership` | `MutationPermitted`, `ReadPermitted`, `DeletionPermitted` and the two sentinel errors | The rules with **no database in them**. The SQL that loads the owner `FOR UPDATE` stayed in each service, and the package doc says why |

## What deliberately stayed behind

`assertWorldMutable` and `assertWorldDeletable` are still in each service's
`internal/repositories`. They are seven lines each and they depend on that
package's querier interface and error mapping — but the real reason is that
**where the check runs is as load-bearing as what it decides.** They take the
world row `FOR UPDATE` inside the mutation's own transaction, so a claim landing
at the same moment cannot change the answer between the check and the write it
authorises. This module cannot express that, and must never be read as if it
did.

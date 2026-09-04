# `shared/` — code more than one service runs

> **Document status:** Active policy
> **Last source review:** 2026-09-05

One directory, so that shared code has an address instead of accumulating
wherever it was first needed. This file is the rule that keeps it from becoming
a junk drawer, and it is short on purpose.

## The one distinction: `shared/` is not `contracts/`

Both hold code that several services depend on, and they are told apart by a
single question — **does it cross a service boundary at runtime?**

| | `contracts/` | `shared/` |
| --- | --- | --- |
| Holds | The **wire surface**: message shapes, subjects, JSON schemas, OpenAPI specs, fixtures | **Behaviour** that several services happen to implement identically |
| Crosses the network | Yes — that is what it is for | No. It is compiled into each service and never travels |
| Languages | `go/`, `rust/`, plus `schemas/`, `openapi*.yaml`, `fixtures/`, `scenes/` | Per module; today only Go |
| Changing it | Is a **contract change** — both sides must agree, and a schema test says so | Is an ordinary refactor. Nothing on the wire moves |

A message shape belongs in `contracts/` even when it is also shared code. A
helper that never leaves the process belongs here even when every service uses
it. When in doubt: if a wrong change would break a *deployed* service that was
not rebuilt, it is a contract.

That is why `contracts/` stays at the repository root rather than moving in
here. It is not a Go library that happens to be shared — it is the system's
interface, with language bindings inside it.

## Layout

```txt
shared/<concern>/<language>/
```

Concern first, language second — the same shape as `contracts/go`, so a Rust
sibling later is `shared/<concern>/rust/` and nothing has to be rearranged.

| Module | What it holds |
| --- | --- |
| [`family-platform/go`](family-platform/go/README.md) | The platform layer `universe`, `nature` and `ocean` share: config loading, database connection and migrations, and the world-ownership rules. Its own README carries the admission rule for what may enter it |

## Before adding a module here

A new module is not free, and the costs are **not** in the Go code. Every one
of these is required, and each one fails silently if forgotten — this list is
written from the three that were missed the first time:

1. **A `replace` directive in every consumer's `go.mod`**, plus the `require`.
2. **A `COPY` line in every consumer's `Dockerfile.prod` AND `Dockerfile.local`**,
   before `go mod download`. Without it the `replace` target does not exist in
   the build context and **every image stops building.**
3. **A CI job.** This repo runs one job per module; a module without a job is a
   module without a gate, and its tests run only on the author's machine.
4. **A row in the table above**, so the next person finds it without a search.

So the bar is not "this code appears twice". Two copies of thirty lines are
cheaper than a module. The bar is closer to: *the same edit has had to be made
in several services repeatedly, and getting it wrong in one of them is a real
defect rather than an untidiness.* `family-platform/go` cleared it on evidence
— 11 of the 12 commits that ever touched the files it absorbed had to edit two
or more services at once, and the one string that drifted between copies was
shipping 404s in production.

## What must not happen

- **No module here that imports a service's `internal/` package.** If shared
  code needs a service's own types, it is not shared code yet — it is a design
  decision nobody has taken.
- **No wire shape here.** That is `contracts/`, and the rule above is the test.
- **No module without the four steps above.** A half-wired module breaks a
  deploy rather than a build, which is the expensive way to find out.
- **No "misc", "common" or "utils" module.** A name that does not say what is
  inside is an invitation to put anything inside.

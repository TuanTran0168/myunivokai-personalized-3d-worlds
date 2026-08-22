# Rust service architecture — the language, the layout, and why this repo's one Rust service looks the way it does

> **Document status:** Active reference. Read before touching
> `services/telemetry-service` or `contracts/rust`.
> **Last source review:** 2026-08-13
> **Grounded in:** the official Rust Book, the Cargo Book and the Rust API
> Guidelines — every claim marked *(official)* is from one of those and is
> linked at the bottom. Everything else is a decision this repository made,
> and says so.

This is the Rust equivalent of
[../fe/threejs-scene-architecture.md](../fe/threejs-scene-architecture.md):
the document you read when you have forgotten why the code is shaped like
this, or when you are adding to it and want to add in the same direction.

---

## 1. The keywords, in one table

Read this first. Everything after it assumes these words mean what is written
here.

| Keyword | What it actually is | Why it matters here |
| --- | --- | --- |
| **Package** *(official)* | What a `Cargo.toml` describes. Builds one library crate at most, and any number of binaries | `telemetry-service` is one package producing one lib + one bin |
| **Crate** *(official)* | The unit of compilation. A tree of modules producing a library or an executable | `myunivokai_contracts` and `telemetry_service` are two crates |
| **Module** *(official)* | `mod`. Controls organisation, scope and **privacy** of paths | Every layer in this service is a module |
| **`src/lib.rs`** *(official)* | The library crate's root | Where the whole service actually lives |
| **`src/main.rs`** *(official)* | The binary crate's root | 30 lines: read config, start, wait, stop |
| **`tests/`** *(official)* | Integration tests, each file its **own crate** | Can only see the library's **public** API — which is why it is a real test of the seams |
| **`pub`** | Makes an item visible outside its module | Absence of `pub` is a compiler-enforced private implementation detail |
| **`use`** | Brings a path into scope | Never changes what is public; only what is convenient |
| **Trait** | A shared interface, like a Go interface — but implementable *for* types you do not own | `TelemetrySink`, `RollupRepository` |
| **`dyn Trait`** | A trait object: dynamic dispatch, one pointer | `Arc<dyn RollupRepository>` is what makes the in-memory test double possible |
| **`impl Trait`** | Static dispatch, monomorphised | Faster, but cannot be stored in a struct field of varying type |
| **`Result<T, E>`** *(official)* | A recoverable error, as a value | Every fallible function in this service |
| **`panic!`** *(official)* | An unrecoverable error — a bug | Reachable in this service only through `.expect()` on a poisoned mutex |
| **`?`** *(official)* | Returns `Err` early, converting through `From` | Why `sqlx::Error` becomes our `Error` with no `match` |
| **`From`/`Into`** | The standard conversion traits | `#[from]` on an error variant is what makes `?` convert |
| **Ownership / borrow** | One owner; `&` shares, `&mut` excludes | Why the domain layer passes `&RollupBatch` and never clones to be safe |
| **`Arc<T>`** | Atomically reference-counted shared ownership | How one repository is shared by four tasks |
| **`Mutex<T>`** | Data guarded by a lock — the *data* is inside the lock, not beside it | The in-memory repository's whole state |
| **`async`/`.await`** | A future; does nothing until polled | Every I/O call here |
| **`tokio::spawn`** | Hands a future to the runtime as a task | Each consumer, responder and ticker is one |
| **`#[async_trait]`** | Macro that boxes async trait methods | Needed because `async fn` in traits is not yet `dyn`-compatible |
| **`thiserror`** | Derives `std::error::Error` for a typed enum | Library errors — the ones callers match on |
| **`anyhow`** | One opaque error type with context | Application errors — the ones a human reads |
| **`serde`** | Serialise/deserialise by derive | The wire contract |
| **`sqlx`** | Async SQL driver + type-safe binder. **Not an ORM** | All storage |
| **`clippy`** | The lint suite. `-D warnings` makes lints errors | CI gate |
| **`rustfmt`** | The formatter. Not configurable enough to argue about | CI gate |

---

## 2. Rust's design philosophy, and what it costs you

Four ideas explain most of the language's surprises.

**Ownership instead of a garbage collector.** Every value has exactly one
owner; when the owner goes out of scope the value is dropped. Borrows (`&T`,
`&mut T`) let others read or mutate without taking ownership, and the compiler
proves no borrow outlives its owner. The cost is that "just store a reference
here" is often a fight; the payoff is that use-after-free and data races are
compile errors. *The practical rule in this service:* pass `&` for reading,
take ownership when storing, reach for `Arc` only when several tasks genuinely
share one thing.

**Errors are values, not control flow.** *(official)* Rust has no exceptions.
The Book splits failures in two: **recoverable** ones are `Result<T, E>` and
must be acknowledged before the code compiles; **unrecoverable** ones are
`panic!` and mean a bug. The `?` operator is the ergonomic half — it returns
the `Err` early and **converts it through `From`** on the way *(official)*,
which is why one `#[from]` attribute removes every `match` that would otherwise
sit between `sqlx` and this service's own error type.

**Traits over inheritance.** There are no classes and no subtyping. Shared
behaviour is a trait, and a trait can be implemented for a type you did not
define. Two dispatch styles: `impl Trait` (static, monomorphised, fast) and
`dyn Trait` (dynamic, one vtable pointer, storable). This repository uses
`dyn` at exactly two seams — the sink and the repository — because both need to
be *chosen at runtime*, which static dispatch cannot do.

**Privacy is compiler-enforced, and modules are the tool.** *(official)* The
Book's stated reason for the module system is to "clarify where to find code"
and to separate a public interface from "implementation details you reserve the
right to change". Nothing is public unless it says `pub`, so a layering rule
written only in a document is a suggestion, while one expressed in module
privacy is checked on every build.

---

## 3. The official Cargo layout, verbatim

*(official — the Cargo Book)*

```
.
├── Cargo.lock
├── Cargo.toml
├── src/
│   ├── lib.rs          # the library crate
│   ├── main.rs         # the default binary
│   └── bin/            # additional binaries
├── benches/            # benchmarks
├── examples/           # examples
└── tests/              # integration tests, one crate per file
```

Naming *(official)*: binaries, examples, benches and integration tests use
`kebab-case`; modules inside them use `snake_case`.

**Cargo recognises those directories by convention, and nothing else.** There
is no official opinion below `src/` — no `models/`, no `services/`, no
`handlers/`. Anything you read online about "the standard Rust service layout"
is a community convention, including everything in the next section. That is
worth knowing before someone tells you this repository is doing it wrong.

---

## 4. How `telemetry-service` is laid out, and why

The layering is **not** copied from a Rust blog. It is
`services/analytics-service`'s Go package structure, expressed in Rust, so that
a reader who knows that service does not have to learn a second architecture to
read this one.

```
services/telemetry-service/
├── Cargo.toml
├── migrations/0001_init.sql        # sqlx::migrate!, embedded at compile time
├── src/
│   ├── main.rs                     # 30 lines: config, start, wait, stop
│   ├── lib.rs                      # module tree + the layering table
│   ├── error.rs                    # Error, Result, describe(), is_retryable()
│   ├── observability.rs            # tracing/JSON logging setup
│   ├── runtime.rs                  # Application: composition root
│   ├── retention.rs                # the deletion ticker
│   ├── config/
│   │   ├── mod.rs                  # Config + SinkName + validation
│   │   └── env.rs                  # env readers, Go-style duration parsing
│   ├── domain/                     # ← models. No I/O anywhere in here.
│   │   ├── rollup.rs               # RollupBatch: wire contract → storage model
│   │   ├── aggregate.rs            # what a read returns
│   │   ├── latency.rs              # LatencySummary: average, p95, slowest
│   │   └── window.rs               # QueryWindow newtype (clamped by construction)
│   ├── repository/                 # ← storage port + adapters
│   │   ├── mod.rs                  # RollupRepository trait
│   │   ├── memory.rs               # faithful in-memory double, for tests
│   │   └── postgres/
│   │       ├── mod.rs              # pool, transactions
│   │       ├── statements.rs       # every SQL string, one file
│   │       └── rows.rs             # PgRow → domain
│   ├── service/                    # ← application layer
│   │   ├── telemetry.rs            # ingest, overview, routes, prune
│   │   └── mapping.rs              # From<domain aggregate> for wire type
│   ├── sink/                       # ← destination port (postgres | otlp)
│   ├── messaging/                  # ← transport: NATS consumer + responders
│   ├── http/health.rs              # /healthz, the wake target
│   └── testing.rs                  # shared fixture builders
└── tests/rollup_pipeline.rs        # integration test over the public API
```

### The dependency rule

Each layer may call the one below it and never the reverse.

```
runtime  ──▶ messaging / http  ──▶ sink  ──▶ service  ──▶ repository  ──▶ domain
                                                                          ▲
                                        error ──────────────────────────────┘
                                        (shared by all, because a failure crosses all)
```

| Layer | Knows about | Must never know about |
| --- | --- | --- |
| `runtime` | everything | — |
| `messaging`, `http` | sinks, envelopes | SQL, percentiles |
| `sink` | services, exporters | NATS, transactions |
| `service` | repositories, domain | SQL, NATS, sinks |
| `repository` | domain, sqlx | responses, percentiles |
| `domain` | itself | I/O of any kind |

### Why `lib.rs` + a two-line `main.rs`

Three concrete payoffs, not style:

1. `tests/` files are separate crates that can only reach a **library**. A
   service whose logic is in `main.rs` can be tested only through its process.
2. `cargo doc` renders the layering above as a browsable map.
3. It forces the public API to be a decision. Anything `main.rs` needs must be
   `pub`, which makes accidental coupling visible in a diff.

### Why a repository **trait** and not just the Postgres type

Because of what it made possible: `service/telemetry.rs` has eight tests that
run in microseconds against `repository::memory`, covering idempotency,
two-instance accumulation, window clamping, error-rate arithmetic and
retention. Before the trait existed, the only tests this service had asserted
the *text* of its SQL. That is worth something and it is not the same thing.

The in-memory double is **shipped**, not `#[cfg(test)]`, for the reason above:
integration tests cannot see a unit-test module. The same reasoning is why the
standard library ships `io::Cursor`.

### Why `sink` and `service` are both there

They answer different questions. `sink` is *where do the rollups land* — a
deployment fact, switched by one environment variable. `service` is *what does
a p95 mean, what counts as an error, how long is data kept* — business policy.
The OTLP sink has no repository and no service at all, which is the clearest
proof the two are not the same layer.

### When a Rust file is actually too long

Line count is the wrong measure here, and reaching for it is usually a Go or
Java reflex arriving intact. **Unit tests live in the same file as the code
they test** — `#[cfg(test)] mod tests`, the convention the Rust Book states
outright — so a healthy Rust file is routinely half tests. In this service
`service/telemetry.rs` is 401 lines of which 275 are its test module, and
`repository/memory.rs` is 412 lines for the same reason.

That co-location is load-bearing, not habit: a `tests/` file is a separate
crate and sees only `pub` items, so moving those tests out would mean making
private helpers public purely to be testable. Widening an API to satisfy a file
size is a bad trade in both directions.

The measure that does work is **what makes this code change**. `service/` was
split on exactly that:

| File | Changes when |
| --- | --- |
| `service/telemetry.rs` | a *rule* changes — which percentile, what counts as an error, how long data is kept |
| `service/mapping.rs` | `myunivokai-contracts` changes — a wire field is added, renamed or retyped |

Before the split, `overview()` was 93 lines in which four lines of policy sat
among six hand-written closures copying fields one at a time. The closures were
not merely verbose: two of them produced the same `TelemetryVolumePoint` from
different sources, and the one that filled `p95DurationMs` with `0` because a
wake signal *has no latency* was indistinguishable on sight from a genuinely
quiet minute. As named `From` impls they carry doc comments saying so, and
`overview()` reads `.map(Into::into).collect()` six times. See **C-CONV-TRAITS**
in §8.

---

## 5. Error handling: `thiserror` for libraries, `anyhow` for the binary

This split is the ecosystem's convention and this service follows it exactly.

| | `thiserror` | `anyhow` |
| --- | --- | --- |
| Produces | A typed enum you can `match` | One opaque error with a context chain |
| Use when | A caller decides something from the failure | Nobody does; a human reads it |
| Here | `domain`, `repository`, `service`, `sink` | `main.rs`, `runtime.rs`, startup |

The decision rule: **if code branches on the error, it must be typed.** This
service branches twice, and both are in `error.rs` rather than at the call
site:

- `Error::describe()` → the status, code and sentence a caller receives. It is
  `analytics-service`'s `describeQueryError` in Rust, and it exists so two
  handlers cannot disagree about what a failure means.
- `Error::is_retryable()` → ack or nak. Getting this backwards is expensive in
  both directions: naking a permanently broken envelope blocks every message
  behind it forever, while acking a transient database failure loses an
  interval that would have stored fine a second later.

A public error message is a **fixed sentence**, never the error's own text: a
`sqlx` error can name a column, a constraint or a host, and none of that
belongs in a response to the admin app. The detail goes to the log.

---

## 6. Why there is no ORM, and what would change the answer

The Rust ecosystem has three real options, and the community's own summary of
when to use each is unusually clear:

| | Style | Best for |
| --- | --- | --- |
| **sqlx** | Async driver + type-safe binder. Not an ORM | Raw SQL, async workloads, "if you think in SQL" |
| **Diesel** | Compile-time-checked query DSL | Strongly typed queries; heavier compile times |
| **SeaORM** | ActiveRecord over sqlx | CRUD-heavy services; does *not* catch schema mismatches at compile time |

**This service is not CRUD.** Its write path adds two arrays elementwise
inside an `ON CONFLICT` clause:

```sql
histogram = (
    SELECT ARRAY_AGG(pair.stored + pair.incoming ORDER BY pair.position)
    FROM UNNEST(http_rollups.histogram, EXCLUDED.histogram)
         WITH ORDINALITY AS pair(stored, incoming, position)
)
```

and its read path is `SUM(...) FILTER (WHERE status_class >= $2)` over grouped
time buckets. Neither is expressible in an ActiveRecord API. SeaORM or Diesel
would call their raw-SQL escape hatch for every statement in
`repository/postgres/statements.rs`, leaving an entity layer as decoration that
still has to be kept in step with the schema by hand.

**What would change the answer:** a service dominated by
`find_by_id` / `insert` / `update` / relations — a `library-service` or a
`city-service`, say. If one of those is ever written in Rust, SeaORM is the
right thing to reach for, and this paragraph is the permission to do so.

### The `query!` macros are deliberately not used either

`sqlx::query!` checks SQL against a **live database during `cargo build`**.
The usual workaround is `SQLX_OFFLINE=true` plus a committed `.sqlx/` cache
generated by `cargo sqlx prepare` — which must be regenerated on every SQL edit
and fails the *build* when it goes stale, in CI, for someone who did not touch
the query. This service uses the runtime API instead, so `cargo build` is
hermetic and needs no `DATABASE_URL`.

The cost is real and is the reason it is written down: **a SQL mistake surfaces
when the query runs, not when it compiles.** What guards it instead:

- unit tests over the SQL text (every `SUM` cast off `numeric`, every conflict
  clause accumulating, retention covering all five tables);
- unit + integration tests over the *logic* via the in-memory repository;
- migrations embedded by `sqlx::migrate!`, which is a macro that reads a
  directory and needs no database.

---

## 7. Testing, and what each kind of test is actually worth

| Kind | Where | Sees | Proves |
| --- | --- | --- | --- |
| Unit | `#[cfg(test)] mod tests` in the file | private items | one function's behaviour |
| Integration | `tests/*.rs`, one crate each | **only `pub`** | the seams still exist |
| Doc test | `///` examples | the public API | the documentation is not a lie |

Two rules this service holds itself to:

1. **A test double must be faithful.** `repository::memory` accumulates on
   conflict, takes the greater of two maxima and sums histograms elementwise —
   the same operations the `ON CONFLICT` clauses perform. A double that behaved
   differently would let a test pass on behaviour the database does not have.
2. **Say what a passing suite does not prove.** `cargo test` here needs no
   database and no broker. It therefore proves the logic and *not* the SQL,
   and both this document and the service README say so, because a green suite
   is otherwise read as more than it is.

**The verification that is not a test:** the local Docker stack. `make
local-up`, drive traffic at the gateway with `TELEMETRY_ENABLED=true`, and read
the rows. That is how the p95 bug in §9 was found.

---

## 8. Conventions worth knowing from the Rust API Guidelines *(official)*

The full checklist is linked below; these are the ones this repository leans
on, with their official codes.

| Code | Guideline | Where it shows up here |
| --- | --- | --- |
| **C-CASE** | Casing follows RFC 430 | `RpcError`, not `RPCError` — an acronym is one word |
| **C-NEWTYPE** | Newtypes give static distinctions | `QueryWindow` — a clamped window cannot be confused with an `i64` |
| **C-VALIDATE** | Functions validate their arguments | `LatencySummary::new` floors negatives; `Config::validate` refuses to start |
| **C-GOOD-ERR** | Error types are meaningful and well-behaved | `Error` + `describe()` + `is_retryable()` |
| **C-STRUCT-PRIVATE** | Structs have private fields | `LatencySummary`'s four fields are private; only its questions are public |
| **C-CONV-TRAITS** | Conversions use `From`/`TryFrom`/`AsRef` | `service/mapping.rs` — domain aggregate → wire type, never an ad-hoc closure |
| **C-DEBUG** | All public types implement `Debug` | Every domain type derives it |
| **C-OBJECT** | Traits are object-safe if useful as trait objects | Why `RollupRepository` and `TelemetrySink` are usable as `dyn` |
| **C-CRATE-DOC** | Crate-level docs are thorough | `lib.rs` carries the layering table |

Naming note that trips up Go readers: Go's `HTTPRollupData` is `HttpRollupData`
in Rust and `RPCError` is `RpcError`. The JSON on the wire is identical either
way, which is the only thing both languages have to agree on.

---

## 9. Bugs this design actually caught

Written down because "the architecture is good" is worth nothing without
examples.

**A p95 of 5 ms on a bucket where nothing took a millisecond.** Found by
running the real pipeline and reading the response, not by a test. The
interpolation treated an observed maximum of `0` as "unknown" and skipped its
own clamp, so a bucket of sub-millisecond requests reported the bucket's *edge*
(5 ms) instead of what happened. Zero is a real maximum — the gateway floors a
sub-millisecond request to it. Fixed in
`contracts/rust/src/telemetry.rs::clamp_to_observed_maximum`, with the test
naming the case.

**A zero-width flush interval discarding real counters.** A shutdown arriving
immediately after a tick produced two flushes inside one millisecond, and the
contract's own validation rejected the second for a non-positive width —
throwing away counters that were perfectly real. Found by a test in
`services/api-gateway/internal/telemetry/flusher_test.go`, fixed by flooring
the reported width at 1 ms and keeping the counts.

**An ambiguous `AsRef<Path>`.** The first container build failed because
`.into()` on a `&str` left the target type ambiguous — a transitive dependency
adds its own `AsRef<Path>` impl to the candidate set. The fix was to delete the
conversion. Worth remembering as the shape of a whole class of Rust errors:
*too many* valid answers, not none.

---

## 10. Working on this service

```bash
# The fast loop: the container has the toolchain, the host may not.
docker compose --env-file .env.local -f docker-compose-local.yaml \
  exec telemetry-service cargo check --all-targets     # ~12s incremental

# The gates CI runs, in the order it runs them.
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo build --release
```

Reading order for someone new: `lib.rs` (the map) → `domain/` (the vocabulary)
→ `service/telemetry.rs` (the decisions) → `repository/postgres/statements.rs`
(the SQL) → `runtime.rs` (the wiring). `main.rs` last, because it says almost
nothing.

---

## Sources

Official:

- [The Rust Programming Language — Managing Growing Projects with Packages, Crates, and Modules](https://doc.rust-lang.org/book/ch07-00-managing-growing-projects-with-packages-crates-and-modules.html)
- [The Cargo Book — Package Layout](https://doc.rust-lang.org/cargo/guide/project-layout.html)
- [The Rust Programming Language — Error Handling](https://doc.rust-lang.org/book/ch09-00-error-handling.html)
- [The Rust Programming Language — Recoverable Errors with `Result` and the `?` operator](https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html)
- [Rust API Guidelines — Checklist](https://rust-lang.github.io/api-guidelines/checklist.html)

Community, for the layering and ORM comparisons — read as opinion, not
specification:

- [The best way to structure Rust web services — LogRocket](https://blog.logrocket.com/best-way-structure-rust-web-services/)
- [Crate layout best practices: lib.rs, mod.rs and src/bin — DEV](https://dev.to/sgchris/crate-layout-best-practices-librs-modrs-and-srcbin-4abd)
- [A Guide to Rust ORMs — Shuttle](https://www.shuttle.dev/blog/2024/01/16/best-orm-rust)
- [SQLx vs Diesel vs SeaORM — Rustify](https://rustify.rs/articles/rust-sqlx-vs-diesel-vs-seaorm-2026)

In this repository:

- [notes/vision/rust-adoption-research.md](../vision/rust-adoption-research.md) — why this service and not another
- [notes/vision/telemetry-service-plan.md](../vision/telemetry-service-plan.md) — the approved design
- [notes/be/source-overview.md](source-overview.md) — where this sits in the backend
- [services/telemetry-service/README.md](../../services/telemetry-service/README.md) — the runbook

# Rust adoption research — which vehicle, now that the first one is blocked

> **Decided 2026-08-13, graduated to
> [telemetry-service-plan.md](../plans/services/telemetry-service-plan.md).** The owner picked
> `telemetry-service`, this document's own top recommendation, and resolved
> its blocker (B2's undecided landing place) by building both candidate
> landing places behind one switchable sink rather than choosing between
> them. Nothing below is wrong; read it for *why* `telemetry-service` won
> over `tools/asset-pipeline`, and read the plan for what is actually being
> built.
>
> **Document status:** Research. **Nothing here is approved.** It extends
> [platform-evolution-research.md §Track C](platform-evolution-research.md#track-c--a-service-written-in-rust),
> whose four selection criteria are adopted unchanged; only the candidate that
> best satisfies them has changed, because the repository has.
> **Raised:** 2026-08-12 by the owner — "tính toán xem có services nào có thể
> sử dụng rust để tôi có thể học hỏi"
> **Last source review:** 2026-08-12, against the working tree

## The headline

Track C picked `telemetry-service` and picked correctly. It is still the
strongest candidate on merit. It is now **blocked on a decision nobody has
made**, which for a learning project is the same as unavailable.

That leaves a genuine choice rather than a ranking, and the two options teach
different things:

| | `telemetry-service` in Rust | `tools/asset-pipeline` in Rust |
| --- | --- | --- |
| Teaches | Rust **in this architecture** — async NATS, SQL, envelope decoding, a deployed service | Rust **the language** — ownership, error handling, a CLI |
| Blocked by | An undecided question, see below | Nothing |
| Blast radius | A missing dashboard panel | A file in `public/` that fails review |
| Honest weakness | Cannot start today | Does not exercise the part of the stack this repo is made of |

## What changed under Track C

Track C was written on 2026-08-11. Three things landed on 2026-08-12.

**B1 shipped.** Wake counters, a consecutive-unanswered tally, and
`GET /api/admin/wake-stats`.

**Service-start telemetry shipped, inside `analytics-service`.**
`migrations/000002_service_starts.sql`, `models.ServiceStart`,
`RecordOwnStart`, `ListServiceStarts`, `contracts.ServiceStartRecord`, and a
gateway route. Track B's stated trap was *"this must not go into
`analytics-service`"*, so this deserves to be read precisely rather than filed
as a violation: the trap's two reasons were the data boundary and **volume**,
and volume was the load-bearing one — request events are two to three orders of
magnitude more numerous than business events. A service start is one row per
process boot, which is **lower** cardinality than a world, not higher. The
letter of the trap was crossed; its reasoning was not.

**The Fleet screen shipped**, reading both of the above.

The consequence for Track C is specific. The telemetry a learner would have
built is now only its high-volume half — B2, the in-gateway HTTP rollups — and
B2's landing place is explicitly undecided:

> *"They are not exclusive. Option 1 is the fastest way to know what is worth
> measuring; option 2 is worth building **after** that is known. Building the
> schema first means guessing at the queries."*

So `telemetry-service` cannot be started as a learning project without first
making the Grafana-Cloud-versus-own-service call that Track B deliberately
deferred, and making that call to justify a language choice is the tail wagging
the dog. **It is blocked, not wrong.**

### What would unblock it

Ship B2 (the gateway's in-memory rollups, flushed on a ticker) and point it at
Grafana Cloud's free OTLP endpoint. Run it long enough to learn which queries
are actually asked. At that point `telemetry-service` has a known schema, a
known query shape, and a real reason to exist — and it becomes the Rust project
Track C described, with every one of its four criteria intact.

## Re-scoring Track C's four criteria

Track C's criteria are adopted unchanged. Only the scoring is new.

| Criterion | `telemetry-service` | `tools/asset-pipeline` |
| --- | --- | --- |
| 1 · New, not a rewrite | Yes | Yes |
| 2 · Off the product critical path | Yes — a missing panel | **Strongest available** — runs offline, output is reviewed as a file |
| 3 · A contract that already exists | Yes — NATS envelope in, PostgreSQL out | **No, and that inverts** — see below |
| 4 · Plays to Rust's strengths | Yes — sustained ingestion, predictable memory | **Weak, and it is worth saying so** |

Criterion 3 is the interesting one. For a *service*, "a contract that already
exists" is a strength: only the language is unfamiliar. But that contract is
`contracts/go`, the single source of truth for subjects, the envelope and
`WorldSnapshot` — and a Rust service must keep a hand-maintained parallel copy
of it. Track C already names the mitigation, and it is the right one: the Rust
tests must decode **the same `contracts/fixtures/` files** the Go suite
validates. That is real, and it is also real that
[analytics-service-plan.md](../plans/services/analytics-service-plan.md) names drift as this
architecture's main long-term cost. A second language doubles the surface that
mitigation has to cover.

A CLI has no envelope at all, so criterion 3 becomes **moot rather than
satisfied** — no coupling to keep honest, and no architecture learned either.

## A correction, because it changes the recommendation

An earlier reading of this called the asset pipeline "CPU-bound for real". The
measurement does not support that:

```
36 .glb files, 11.9 MB total
largest single file:  2.14 MB  tree-oak-realistic.glb
                      1.59 MB  tree-fir-realistic.glb
5 HDRI/texture files, 5.9 MB
```

Compressing 36 files of that size is seconds of work. `rayon` across them saves
seconds. **Performance is not the argument**, and a recommendation resting on it
would be wrong. The argument is reproducibility, below.

## Option 2 in detail — `tools/asset-pipeline`

The pipeline that produced every asset under `public/assets/` is run by hand
with `npx @gltf-transform/cli`, and its settings survive only as prose in
[ATTRIBUTION.md](../../apps/myunivokai-web/public/assets/nature/ATTRIBUTION.md).
`apps/myunivokai-web/scripts/` contains exactly one file, `build-brand-mark.mjs`,
and it is unrelated.

What that prose actually encodes is not trivial, and it is not uniform:

- **Draco for static geometry, meshopt for animated** — because Draco does not
  preserve skeletal animation. Get this backwards on one file and the animals
  stop moving.
- Textures at 512px WebP for the Quaternius props, **1024px** for the four
  animated animals, **2048px at quality 90** for the fir pack.
- Per-file animation pruning: the bear shipped 81 clips and keeps one; the
  squirrel keeps `run` rather than a walk, "because a scamper is the correct
  squirrel gait".
- Geometry deliberately **not** simplified on the fir pack, because decimation
  destroys the alpha-masked leaf cards that carry the realism.

That is a build with real decisions in it, recorded in a markdown table nobody
can execute. Re-downloading one asset means re-reading that table and hoping.
A committed tool turns it into `cargo run -- optimize --profile animated`.

| Concern | Crate |
| --- | --- |
| glTF read/write | `gltf` |
| Texture resize + WebP encode | `image`, `webp` |
| Mesh compression | `meshopt` |
| Parallel over files | `rayon` |
| CLI | `clap` |
| Errors | `anyhow`, `thiserror` |

What it does **not** need, and this is most of its appeal: no NATS, no
PostgreSQL, no migration runner, no `render.yaml` entry, no NATS ACL block, no
`.env`, no secret, no free-instance hour, and **no line of `contracts/go`**.
Its cost is one CI job (`cargo fmt --check`, `cargo clippy -- -D warnings`,
`cargo test`) and one paragraph in [../be/source-overview.md](../knowledge/backend/source-overview.md)
saying why a second language is in the tree — Track C's own warning, which
applies to a tool as much as to a service: an undocumented second language
reads as an accident to the next reader.

## Rejected, with the measurement that rejected each

**Rewriting `analytics-service`.** The question that started this. Every
aggregate it serves is already computed by PostgreSQL — `COUNT(*) FILTER`,
`percentile_cont`, `generate_series`, keyset pagination — so the Go process is
a relay between a socket and a query planner. Rust would optimise the part that
is not slow, and would require a hand-maintained copy of the envelope contract
to do it.

**`auth-service`'s password hashing.** The one genuinely CPU-and-memory-bound
thing in the backend, and deliberately so: `argon2.IDKey` with parameters tuned
for a 512 MB instance. Rust cannot make it faster — being slow is the entire
function of a KDF — and it is the most security-critical code in the
repository. Wrong place to be a beginner.

**Rust → WASM for scene generation.** Track C rejected this on bundle size and
was right; the workload measurement makes it firmer. The forest places ~180
trees on desktop (`ForestTrees.tsx`, `countDesktop ?? 180`, mobile 0.4×), plus
ground decor bounded by `MAXIMUM_DECOR_PIECES` and grass tufts, all inside a
`useMemo` that runs once at mount. That is milliseconds. Adding a WASM payload
to save them is a solution looking for a problem. Track C's own re-open
condition stands: revisit if City's generation proves CPU-bound.

**`city-service` as a greenfield Rust service.** Superficially ideal — Sprint 3,
no existing code to discard. It fails on the read-model amendment in
[city-service-plan.md](../plans/services/city-service-plan.md), which requires City to copy
`world_snapshot.go` and `world_snapshot_test.go` from `universe-service`, add
`city` to `contracts.WorldFamily`, and bump a revision inside the same
transaction as every mutation. Rust means hand-porting all of it, against a
failure mode the amendment states plainly: **nothing fails when you get it
wrong** — City worlds simply never appear in the admin app. A silent failure
mode is the worst possible place to be learning a language.

## Sources

Everything above was read from the working tree on 2026-08-12: file counts and
byte sizes measured with `find`, the pipeline settings from
`public/assets/nature/ATTRIBUTION.md`, the Argon2 parameters from
`services/auth-service/internal/security/password.go`, the tree counts from
`ForestTrees.tsx`, and the telemetry landing from
`services/analytics-service/migrations/000002_service_starts.sql` and
`contracts/go/contracts_telemetry.go`. Track B and Track C are quoted from
[platform-evolution-research.md](platform-evolution-research.md).

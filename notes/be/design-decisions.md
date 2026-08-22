# Key design decisions

> **Document status:** Implemented
> **Last source review:** 2026-08-13

Three decisions that shape more of this codebase than their size suggests, and
that a reader will otherwise re-litigate. Moved out of the root `README.md`,
which now points here — a README is where you find out what a repository *is*,
not where you argue with it.

---

## AI only generates the semantic profile — all 3D numbers are deterministic

- The AI produces concepts: archetype, narrative, mood, energy, palette intent.
- Every rendering number comes from the seed inside safe mathematical bounds.
- That covers orbit radii, planet sizes, forest density and lighting angles.
- Alternative variants therefore cost **zero AI calls**.
- The same seed always produces the same scene, on any page, forever.
- `Math.random()` is banned in scene code; the frontend mirrors the seeded PRNG.

The line between the two is what makes a variant free. Move a single number
across it — let the AI choose an orbit radius "for variety" — and every variant
becomes an API call, every scene becomes unreproducible, and the seeded PRNG in
the frontend becomes decoration.

See [fe/universe-render-mechanism.md](../fe/universe-render-mechanism.md) and
[fe/forest-render-mechanism.md](../fe/forest-render-mechanism.md).

## Every world plays music, and the same DNA arranges it

- The notes are **real compositions in the public domain**, shipped as note data.
- Six pieces — Satie, Bach, Debussy — 84 kB for all six; a world fetches one.
- The sound comes from CC0 recorded instruments: 39 samples, 1.27 MB total.
- The DNA chooses the piece, the instruments, the tempo, the key and how full
  the chords are; the seed chooses the opening phrase, the room and the timing.
- `Math.random()` is banned here exactly as in scene code — same seed, same
  performance, on every page and every reload.
- Famous modern songs are not an option however freely their sheet music
  circulates: a composition is copyrighted for 70 years after the composer's
  death, and playing it with our own samples is what a sync licence covers.
- Audio never reaches for a provider, so swapping to a live AI changes nothing
  on this path.

Full mechanism, including how to audition and measure it:
[fe/ambient-audio-mechanism.md](../fe/ambient-audio-mechanism.md).

## Single public edge with interchangeable AI providers

- The browser talks to the gateway and nothing else.
- `Gemini`, `OpenAI` and `mock` sit behind one `ai.Provider` interface, one file
  each in `services/dna-service/internal/ai/providers`.
- `dna-service` depends on the interface, never on a vendor client. Switching
  provider is an `AI_PROVIDER` environment variable, not a code change.
- `mock` is the default, needs no API key, runs the whole flow end to end, and
  is what CI runs.
- `dna-service` is the only service that holds a provider key at all.

`internal/wake` in the gateway is built to the same shape on purpose:

| DNA service | Gateway wake | Role |
| --- | --- | --- |
| `ai.Provider` | `wake.Platform` | The interface the business logic depends on |
| `internal/ai/providers/` | `internal/wake/platforms/` | One adapter file per vendor |
| `ai.Orchestrator` | `wake.Coordinator` | The policy every adapter shares |
| `AI_PROVIDER` | `SERVICE_WAKE_PLATFORM` | The switch, read once at startup |

Two ports, two sets of adapters, one shape. A third integration should be built
the same way rather than inventing a fourth arrangement.

`telemetry-service` follows it a third time in Rust, with `TelemetrySink`,
`sink/{postgres,otlp}.rs` and `TELEMETRY_SINK` —
[rust-service-architecture.md](rust-service-architecture.md) §Why `sink` and
`service` are both there.

# Ambient audio — how the music is made and how to audition it

> **Document status:** Active mechanism reference
> **Last source review:** 2026-08-05

Every world plays music. The **notes** are a real composition in the public
domain; the **sound** comes from recorded instruments; the **performance** — which
piece, who plays it, in what key, at what tempo, how full — comes from the same
seed and the same DNA the visuals use. `Math.random()` is banned here exactly as
it is in scene code.

## Four attempts, and why the first three failed

This is the part worth reading. All three failures shipped with a green test
suite, and all three were caught by a person listening.

**1. Oscillator pad, low register.** Every voice sat between 47 and 106 Hz with
the noise bed lowpassed to 170–320 Hz. Correct on studio monitors, *silent* on the
laptop and phone speakers people actually use, which roll off steeply below
~150 Hz. 36 tests passed: they checked determinism and numeric bounds and never
asked whether the output landed where a speaker can reproduce it.

**2. Oscillator pad raised, plus synthesised bell/pluck notes.** Reported as a
long painful sustained tone whose layers never blended. Rendering the three layers
in isolation measured why: the pad was **0.052 RMS against the melody's 0.012** —
four times louder than the notes it was supposed to sit under.

**3. Recorded instruments, notes drawn from a pentatonic scale at rolled gaps.**
The instruments were accepted. The music was rejected as *disjointed*, and that
was right. A consonant note at a random gap gives a note **sequence**. A melody
needs a motif that returns, phrases that breathe, a pulse to sit on and a cadence
to land on, and none of that was there.

**4. Written compositions, performed.** The notes come from a composer.

The lesson is the one [3d-development-limitations.md](3d-development-limitations.md)
already recorded for the visuals, applied twice over: *the algorithm is the cheap
part.* First the sound had to come from a recording instead of an oscillator, then
the notes had to come from a composer instead of a random number generator.

## The parts

| File | Purity | Job |
| --- | --- | --- |
| [`lib/ambientSoundscape.ts`](../../../apps/myunivokai-web/src/lib/ambientSoundscape.ts) | Pure | The arranger. Rolls a performance from the seed and the scene config. Unit-testable in node. |
| [`features/audio/arrangements.ts`](../../../apps/myunivokai-web/src/features/audio/arrangements.ts) | I/O | The scores: types, fetch, validation, role filter. |
| [`features/audio/instrumentSamples.ts`](../../../apps/myunivokai-web/src/features/audio/instrumentSamples.ts) | I/O | Sample catalog, fetch, decode, nearest-note lookup. |
| [`features/audio/ambientSoundscapeGraph.ts`](../../../apps/myunivokai-web/src/features/audio/ambientSoundscapeGraph.ts) | Impure | The performer. Recipe + score + buffers into Web Audio nodes. Performs **no I/O**, which is what lets the offline renderer feed it from disk. |
| [`features/audio/useAmbientSoundscape.ts`](../../../apps/myunivokai-web/src/features/audio/useAmbientSoundscape.ts) | Impure | AudioContext lifecycle, gesture gate, asset loading, crossfade on scene change. |

## What is playing

1. **Melody** — the top line of the score, on the world's instrument.
2. **Harmony** — the chord tones, on a *different*, softer instrument.
3. **Bass** — the bottom line, on the low piano. Every other sampled instrument
   starts at C4 and the scores reach MIDI 27.
4. **Bed** — looping seeded noise through a lowpass (universe: air) or bandpass
   (forest: wind in foliage). Stays dry; reverberated noise is fog.
5. **Space** — convolution reverb from a generated impulse response, plus a
   feedback delay. Without these, any synthesis reads as clinical.

Twelve public-domain pieces (Satie ×3, Bach ×2, Debussy ×2, Chopin ×2, Schumann,
Scriabin, Tchaikovsky) and eight instruments. See
[arrangements/ATTRIBUTION.md](../../../apps/myunivokai-web/public/assets/audio/arrangements/ATTRIBUTION.md)
and [audio/ATTRIBUTION.md](../../../apps/myunivokai-web/public/assets/audio/ATTRIBUTION.md).

It was six, and six could not cover thirteen slots — Bach's C major prelude was
answering for four of them, so worlds that share nothing else shared a tune. The
six added are each matched to the slot they fill: the Raindrop prelude for rain,
"By the Hearth" for snow, Träumerei for the dreamy nebula.

**The MIDI converter is now in the repository** at
[tools/midi-to-arrangement.mjs](../../../apps/myunivokai-web/tools/midi-to-arrangement.mjs),
and the audition harness at
[src/lib/ambientAudition.audition.ts](../../../apps/myunivokai-web/src/lib/ambientAudition.audition.ts).
Both were previously treated as throwaway. Rebuilding them to add six pieces was
most of a day, and three of the converter's rules had to be recovered by trial
against the shipped output — see ATTRIBUTION.md for what they are. Verified: the
committed converter reproduces all six original note arrays byte for byte.

**Famous modern songs are not an option**, however freely their sheet music
circulates. The composition is under copyright for 70 years after the composer's
death (50 in Vietnam) and playing it with our own samples is exactly what a sync
licence covers.

## What the DNA controls

The same ProfileDNA that reaches the eyes reaches the ears:

| From the scene config | Becomes |
| --- | --- |
| Universe `theme` | The piece, the melody instrument, and the colour of the bed |
| Forest `weather` + `intensity` | The piece, the instrument, and the bed's level and width |
| Average point energy | The tempo, within the range set for that piece |
| Planet / landmark count | How full the chords are — how many are played at all |
| Forest `season` + `lighting.timeOfDay` | How far the key is transposed |
| `postFX.bloomIntensity` | How open the tone filter sits |
| Seed | Key jitter, which phrase it opens on, the room, the humanising |

## Does this survive the switch to a real AI provider?

Yes, with one gap worth knowing about. Recorded here because it was asked
directly and the answer is not visible from the audio code alone.

The music reads exactly one input: `SceneConfig`. It never calls a provider — the
frontend calling AI is banned outright — and it sits *downstream* of schema
validation, so it cannot tell whether `mock`, Gemini or OpenAI produced the DNA.
Swapping the provider is an environment variable
([`aifactory/factory.go`](../../../services/dna-service/internal/aifactory/factory.go)),
so there is nothing on the audio side to change.

How much freedom each field carries matters more than the swap itself:

| Field | What it decides | How far a live provider moves it |
| --- | --- | --- |
| Point `energy` | Tempo | Continuous — the widest audible effect |
| Point count | Chord fullness | Follows how much the visitor wrote |
| `season` + `lighting.timeOfDay` | Transposition | 4 x 3 = 12 combinations |
| `theme` / `weather.kind` | **The piece and the instruments** | Closed enum, five values each |
| Seed | Opening phrase, room, humanising | Unbounded |

The two fields that choose the music are closed enums in the contract —
[personality-dna.schema.json](../../../contracts/schemas/personality-dna.schema.json)
and [forest-scene-config.schema.json](../../../contracts/scenes/forest-scene-config.schema.json)
— and the identity maps cover all ten values. A provider cannot invent a sixth
theme: validation rejects it and the orchestrator repairs. Every lookup falls
back with `?? DEFAULT` and every number is type-checked and clamped besides, so
the worst a malformed payload produces is the default piece — not silence, and
not a throw.

A live provider therefore makes the music **more** varied than the mock presets
do, but only along tempo, key and density. Piece and instrument variety is
bounded by the enums, not by the model.

**The gap.** Add a sixth theme to the enum later and the music silently falls
back to the default piece, and *no test fails* — the recipe test sweeps a theme
list written inside the test file instead of read from the contract. Whoever adds
the theme has to remember a file nowhere near the one they are editing. A test
that reads the enum out of the schema and asserts the identity map covers it
would close this.

**If a provider should choose the music directly**, that needs a contract field
beside `visualHints`, Go validation, and a mapping row. Map **mood to our
whitelist** — never let a model return a piece or a song title. Asked for
"reflective piano" a model will name *River Flows in You* or a Ghibli cue within
a sentence, and both are firmly in copyright. A whitelist can be licence-checked
in CI; a generated title cannot.

## Constraints that are not negotiable

**Register.** Two floors, because a recording is not a sine. A sine at 110 Hz on a
laptop speaker is silence — there is nothing but the fundamental. A recorded harp
at the same pitch carries partials at 220, 330, 440 Hz and the ear reconstructs
the fundamental from them. So the melody clears MIDI 52 (~165 Hz) and the bass,
which only supports, may sit at MIDI 43 (~98 Hz). This matters more with written
scores than it did with generated notes: they reach MIDI 27, which is 44 Hz.

**Gesture.** A browser will not emit audio before the visitor has interacted with
the document. The AudioContext is constructed inside the click handler, never in
an effect. Ambience defaults to on, which is *not* autoplay — the hook arms the
first gesture, which on a world page is the first orbit-drag.

**Sample stretch.** A recording pitch-shifted more than about a fifth stops
sounding like the instrument. Notes further out are folded by octaves.

**Balance is not gain.** See below. This one cost two rounds.

## Auditioning it — the only way to know it sounds good

Topology tests prove the graph is wired correctly. They cannot tell you it is
music; three versions shipped verified-and-wrong. Render it and listen:

```powershell
cd apps/myunivokai-web
npm install --no-save node-web-audio-api
npx vitest run --config vitest.audition.config.ts --disable-console-intercept
```

The harness lives behind **its own vitest config** so `npm test` can never try to
run it: `node-web-audio-api` is a `--no-save` development aid, and a missing
optional dependency must not be able to fail CI. `vitest.config.ts` matches
`src/**/*.test.ts`; the audition is `src/**/*.audition.ts`.

The renderer drives the **real** graph module against a Node implementation of
Web Audio. Three things make it work:

- The graph schedules against `audioContext.currentTime` on a `setInterval`.
  Offline rendering has no wall clock, so the interval callback is captured and
  driven by hand.
- `currentTime` is shadowed with an own property on the context instance. A
  `Proxy` breaks the library's private class fields.
- ESM resolves against the **script's** location, not the working directory, so the
  script has to sit inside `apps/myunivokai-web` to find its dev dependency.

`node-web-audio-api` is installed `--no-save` on purpose: a development aid, not
a runtime or CI dependency. Installing one `--no-save` package prunes a
previously `--no-save`-installed one, so install everything in one command.

### Measure, do not just listen

Each of these found a fault that reading the code did not.

**Layer isolation — on every world, not a sample.** Render with each line's gain
zeroed and compare RMS. This proved attempt 2's pad was 4.3x the melody. Then it
caught the *same fault arriving through note density* in attempt 4: the recipe
guarantees the accompaniment's gain is below the melody's, and that turned out to
prove nothing, because the accompaniment plays three to five times as many notes.
Isolating one world looked fine; isolating all ten found **four** where the
accompaniment was louder than the tune, the worst at 0.17x.

The fix was a measured model — `lead = factor(instrument pair) / soundingBeatRatio`
— inverted into a correction, with the ratio half computed from the score at build
time so a rebuilt arrangement cannot leave it stale. Plus two structural changes
that no gain could substitute for:

- **Never a blown instrument as the accompaniment.** A recorder holds its full
  level for the written duration, so under a plucked melody it always wins.
- **The accompaniment gets a fraction of the release.** Letting a dense chord part
  ring as long as the tune turns a progression into a wash.

**Onset count via spectral flux.** An RMS envelope is useless here — a continuous
layer under a long reverb tail looks flat no matter how many notes play. Use a
real radix-2 FFT: the first attempt at this used a strided DFT that aliased and
pinned the centroid at sampleRate/4 for every input. Flux found a soft-attack
instrument producing *one* detectable onset in 37 seconds.

**Band balance.** Rain weather once measured 52% of all energy above 1200 Hz: hiss
burying the music it was supposed to sit under.

**Per-instrument and per-piece level trim.** Both measured, neither guessable.
Kalimba playing the same Gymnopédie notes as a vibraphone measured **eight times
quieter** — a short plucked ping cannot carry a sparse piece, and no gain fixes
that without clipping the individual notes, so it was given Bach's running
sixteenths instead. Loudness across pieces is driven by notes per bar far more
than by any gain: Bach is 549 notes in 35 bars where Gymnopédie No. 3 is 326 in 60.

### Where it currently measures

Thirteen worlds, 60 s each, master 0.6 × piece trim, after the catalogue went
from six pieces to twelve:

| | Range |
| --- | --- |
| Onsets | 0.75–2.98 per second |
| Peak | 0.25–0.57 — no clipping |
| RMS | 0.0495–0.0895 — 1.81x spread |
| Melody lead over accompaniment | 1.13x–2.63x — melody leads in all thirteen |
| Bed | the quietest layer in every world |

**Layer isolation earned its keep again on this pass.** Two of the six added
pieces measured the accompaniment LOUDER than the tune on the first render —
forest/clear at 0.70x and forest/overcast at 0.77x — and both had passed every
assertion in the suite, because the suite checks gains and gain is not balance.
Neither was fixed by a number: BWV 870 went to a different family and Chopin's
E minor prelude was given a blown instrument. Then ocean/surge came back at
1.03x, a tune technically ahead and not audibly so, and needed a third pass.

**Do not add a piece without running this.** Three renders per world at roughly
2.5 s each is about 100 seconds for the whole catalogue.

### Tempo is not a rate

A bare beats-per-minute bound used to be asserted, and across a catalogue this
wide it means nothing: BWV 870 puts 3.9 note attacks on every beat where a
Gymnopédie puts 0.79, so 30 bpm is busier in one piece than 58 is in the other.
The unit test now asserts **onsets per second**, computed from the shipped
arrangement's own note density — the same number this section reports, which is
what makes a failing build checkable against a real listen.

# Bubbles, and what an ocean world should sound like

> **Document status:** Research. Nothing here is approved and nothing here is built.
> **Written:** 2026-09-01
> **Question:** the owner asked for *"âm thanh bọt biển dưới đáy biển để sinh động"* —
> bubble sound on the seabed, to make it feel alive.

---

## The gap this is really about

The platform's audio is good and it is the wrong kind of good. `features/audio/`
performs a **written arrangement** — melody, harmony, bass, sampled instruments,
reverb, delay, and a filtered noise bed — and `lib/ambientSoundscape.ts` already
bends it by ocean depth: `oceanDepthToneMultiplier` closes the tone filter and
`oceanDepthBedGainMultiplier` lifts the bed as a world goes deeper.

So an ocean world has **music that knows how deep it is**, and **no sound that
comes from anything in it**. Nothing a fish, a vent, a wave or a bubble does
makes a noise. That is the gap, and "bọt biển" is the right thing to notice
first, because a bubble is the one underwater sound everybody can identify
instantly and the one that is cheapest to make honestly.

## Why bubbles are worth synthesising rather than sampling

Because the physics is a two-line formula and it hands the family its own axis
for free.

**Minnaert (1933).** A bubble rings at

```
f₀ = (1 / 2πr) · √(3γP / ρ)
```

with γ the polytropic index of the gas, P the ambient pressure and ρ the water
density. At the surface this reduces to the number every acoustician carries:

```
f₀ ≈ 3.26 / r     Hz · m
```

A 3 mm bubble sings at about 1.1 kHz. A 1 cm bubble at about 330 Hz. Big bubbles
are low, small bubbles are high — which is why a stream of fine bubbles is a
sparkle and a single burp from a regulator is a *bloop*.

**And then the part that matters here.** `P` is the *ambient* pressure, which
underwater is

```
P(z) = P_atm + ρgz     ≈ 1 atm per 10 m
```

so **f₀ scales as √P**. The same bubble that rings at 1.1 kHz at the surface
rings at **1.9 kHz at 24 m** (Reef Crest) and at **3.5 kHz at 100 m**. Depth is
this family's whole axis, and it is already a factor in the bubble's pitch
before anyone writes a line of design. That is exactly the shape of thing this
project keeps reaching for: one physical number in, the character out.

**The sound itself** ([van den Doel 2005, *ACM TAP* 2(4)](https://dl.acm.org/doi/10.1145/1101530.1101554)):
an exponentially damped sinusoid whose pitch **rises** as it decays, because the
bubble shrinks as it radiates.

```
p(t) = A · e^(−d t) · sin(2π f(t) t)
f(t) = f₀ (1 + ξ d t)
```

van den Doel's own listening study put **ξ ≈ 0.1** as the value that reads as a
real bubble. The rising pitch is not a detail — a damped sinusoid at constant
pitch reads as a *bell*, not a bubble, and that single term is the difference.

**One number to read out of the paper before implementing:** the damping
coefficient `d` as a function of `f₀`. It is in van den Doel 2005 and this
research did not verify a value, so do not let one be invented.

That is the whole synthesiser. In Web Audio: one `OscillatorNode` with a
scheduled `frequency` ramp into a `GainNode` with an exponential ramp. Perhaps
fifteen lines, no asset, no network, no licence — which matters, because the
repo's audio rules and the demos' no-network rule both point the same way and
because the ocean family already chose procedural over imported for every prop
on its seabed.

## What else is down there, measured

A bubble alone is a novelty. The reason a reef sounds alive is that it is loud,
and it is loud for a reason nobody expects.

**Snapping shrimp are the dominant sound in every warm shallow sea on earth.**
A shrimp closes its claw fast enough to cavitate the water, and the *collapsing
bubble* — the same physics as above, run backwards and violently — makes a
broadband crack over 200 dB re 1 µPa. In aggregate a reef crackles continuously.

The soundscape splits cleanly by frequency, which makes it easy to build in
layers:

| Band | Source | Behaviour |
| --- | --- | --- |
| **below 1 kHz** | surface waves, distant swell | continuous, louder in rough weather |
| **2–5 kHz** (broad peak, energy out past 100 kHz) | **snapping shrimp** | dense irregular crackle; *louder at night*, louder in summer |
| transient | bubbles, fish | sparse events |

Sources: [Frontiers in Marine Science 2021](https://www.frontiersin.org/journals/marine-science/articles/10.3389/fmars.2021.779283/full),
[PLOS One 2015](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0143691),
[JMSE 13(3) 517](https://doi.org/10.3390/jmse13030517).

**The shrimp crackle is the single highest-value sound in this list** and it is
the cheapest: a Poisson-scheduled train of very short filtered noise bursts.
It is also *diagnostic* — it belongs to warm shallow reefs and to nowhere else,
so it is a depth and zone cue rather than decoration.

## What it would look like as a layer

A `features/audio/oceanDiegeticLayer.ts` sitting beside the arrangement rather
than inside it — the arrangement is a piece of music and this is not. Driven by
the two things the config already carries, `depth.zone` and `depth.metres`:

| Zone | What it is made of |
| --- | --- |
| **Sunlit shallows** | shrimp crackle (dense, the bed of the whole thing), surge from the surface swell, occasional bubble trains |
| **Twilight reach** | near silence, a low rumble, very sparse bubbles. The silence is the point — this is the zone with no floor and no company |
| **Abyss** | almost nothing, and a vent hiss when a `hydrothermalVent` landmark is near — filtered noise, and the bubbles that go with the plume this family already draws |

Two properties that fall out for free and are worth stating because they are the
reason to do it this way:

1. **Bubble pitch is a depth cue nobody has to author**, from `√P` above.
2. **Shrimp density is a zone cue nobody has to author**, because the zone
   already exists in the config and the shrimp only live in one of them.

## What has to be got right, or it will be worse than silence

- **Ambient audio here is opt-in and remembered** (`AmbientSoundToggle`,
  `lib/ambientSoundPreference.ts`). This layer follows the same gate. A visitor
  who turned sound off does not get bubbles.
- **It must not compete with the arrangement.** The music occupies the midrange
  and the shrimp crackle occupies 2–5 kHz, which is fortunate, but the level has
  to be set against the music rather than in isolation.
- **Periodicity is the failure mode.** A bubble every 800 ms is a machine.
  Poisson scheduling with a seeded PRNG (never `Math.random()` — the same rule
  as everywhere else in this repo) or it will be switched off within a minute.
- **Node budget.** One oscillator per bubble, created and discarded per event,
  is standard Web Audio practice, but a shrimp crackle at reef density is
  hundreds of events per second and must not be hundreds of nodes per second —
  it wants one pre-rendered noise buffer retriggered, or a single buffer of
  crackle generated offline at load and looped with variation.

## Where this could go next, and what it does not settle

- **A demo would settle it in an hour.** `demos/ocean-bubble-bench/` — a page
  with a depth slider and a water-type selector that plays the layer, so the
  owner can hear whether the depth-driven pitch actually reads before anything
  is built into the app. It is the honest next step and it follows the pattern
  the transition bench and the depth rig already set.
- **Unverified:** the damping coefficient `d(f₀)`. Read van den Doel 2005.
- **Unverified:** whether shrimp crackle reads as "alive" or as "static" through
  laptop speakers, which is where most of this will be heard. That is a listening
  question and no amount of reading answers it.
- **Not researched:** whether the arrangement should *duck* for the diegetic
  layer, or the other way round, or neither.

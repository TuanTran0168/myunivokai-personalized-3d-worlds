# sun-tone-curve

Four tone curves applied to the colours the sun actually hands the renderer, to
settle one report: **"the sun looks as if a sheet of frosted glass were laid
over it — it is not fiery red like it used to be."**

The report is accurate, the cause is a fix rather than a regression, and the
answer is one constant.

## What happened

Until `3f09796` (2026-09-10) the universe, forest and fallback families rendered
with **no tone curve at all**. `EffectComposer` sets
`gl.toneMapping = NoToneMapping` on mount, none of those three chains contained
a `<ToneMapping>` pass, and so the AgX curve `UniverseCanvas` asked for was
applied to nothing. Every linear value above 1 hit the display ceiling flat.

That was a real bug — `sceneToneMapping.ts` exists because of it — and restoring
the curve was right. But **a flat clamp is not a neutral baseline. It is a look**,
and it is the look every world in this app was authored against: a clipped
highlight keeps all of its saturation, because clamping the top of a channel
that was already at the top changes nothing while the other channels stay where
they are. Nine months of "the sun is fiery orange" was the clip.

The curve restored was AgX, chosen while fixing the clipping rather than while
looking at the result. AgX's defining behaviour is that it desaturates as it
approaches the top of its range — that is *how* it avoids clipping. So the
report describes AgX working exactly as designed.

## The numbers

`node measure.mjs`, over the sun texture's full brightness ramp, both reported
worlds, star surface and glow shell:

```
Saturation kept, against the no-curve build
  AgX (was)                  0.632
  ACES Filmic                0.838
  Khronos PBR Neutral        1.062

Where each curve puts a neutral, in linear units in and out
  No curve (the old build)   mid 0.18 -> 0.1800   ·   shadow 0.02 -> 0.0200
  AgX (was)                  mid 0.18 -> 0.2145   ·   shadow 0.02 -> 0.0182
  ACES Filmic                mid 0.18 -> 0.2131   ·   shadow 0.02 -> 0.0073
  Khronos PBR Neutral        mid 0.18 -> 0.1400   ·   shadow 0.02 -> 0.0025
```

**A veil is two things, and AgX does both.** It keeps 63% of the saturation the
old build had, and it *lifts* the mid-tones — 0.18 becomes 0.215 — while barely
touching the deep shadows, which is what stops the black of space reading as
black. Less colour and lighter darks is the definition of frosted glass.

The worst single case is the default world's glow shell, `#FDB813`:

| | old build | AgX | ACES | Neutral |
| --- | --- | --- | --- | --- |
| rgb | `255 211 24` | `217 184 118` | `240 212 90` | `247 184 65` |
| saturation | 0.91 | **0.46** | 0.63 | **0.74** |

## What shipped

`DEFAULT_FAMILY_TONE_MAPPING` in
`apps/myunivokai-personalization/src/features/scene-renderers/shared/sceneToneMapping.ts`
is now **`NeutralToneMapping`** — Khronos PBR Neutral — for universe, forest and
the fallback. It keeps 1.06 of the old build's saturation, takes middle grey
*down* to 0.14, and crushes a deep shadow from 0.02 to 0.0025, so space is black
again. It is still a real tone curve: nothing clips flat, which is what the
original fix was for.

**The ocean is untouched.** That family's grade was designed and proven against
three.js's own ACES at a per-depth `toneMappingExposure`, where the adaptation
curve *is* the exposure. It is the one family here with a design history to
protect.

Changing the choice is one constant, and `dist/sun-tone-curve.html` renders all
four side by side to choose from.

## Running it

```powershell
cd demos/sun-tone-curve
node measure.mjs          # the table, and two checks on itself
node build.mjs            # -> dist/sun-tone-curve.html, opens from file://
```

## What is measured, and what is not

**The curves are transcribed, not imported**, because a tone curve in three.js
is GLSL that exists only inside a compiled material — there is no JavaScript
entry point to hand a colour to. `measure.mjs` therefore checks its own
transcription before printing anything, and both checks earned their place:

- **Every colour-space matrix row sums to 1**, which is the same statement as
  "white maps to white". The first draft had two rows of the two Rec.2020
  matrices swapped, and the symptom was a pure white star leaving AgX as
  `211 206 218` — a violet-tinted grey, which reads as a finding about the
  renderer rather than as a typo.
- **A neutral in is a neutral out**, for all four curves. None of them is a
  white-balance operation.

A third check was written and removed: *"AgX holds middle grey at 0.18"*. It is
not true of three's implementation, which puts 0.18 at 0.215, and asserting it
would have been asserting a property AgX does not have. It is reported as a
number instead — and it turned out to be half the answer.

**A frame is not these swatches.** Bloom, the grade, the vignette, the film
grain and the glow shell's additive blend over the star all sit between this
colour and a rendered pixel, and none is modelled here. What makes the
comparison fair anyway is that all of them are identical across the four
columns: the tone curve is the only thing that differs, so the *difference*
between columns is the difference in the frame even though the absolutes are
not.

It does not model the sun texture's own hue, only its brightness ramp. And it
says nothing about the forest or the ocean, whose subjects are not a small
bright disc on black and which may want a different answer — the forest's AO
retune is still waiting on the owner's eye for the same reason.

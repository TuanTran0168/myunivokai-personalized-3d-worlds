# Reference shots

One directory per dependency stack these scenes were photographed on, named
after the versions that produced them. They are committed, and the shots under
`e2e/shots/` are not, because these two things are different:

- `e2e/shots/` is **output**. `npm run shoot` overwrites it every run.
- `e2e/reference/<stack>/` is **evidence**. It says what the scene looked like
  on a stack that was known good, so the next person to change a dependency has
  something to compare against instead of a memory.

## Why these are worth committing at all

WebGL screenshots are usually a bad thing to keep in git: they differ by GPU,
by driver, by the machine's load at the moment of capture. These do not, or
much less so — `playwright.config.ts` forces
`--use-gl=angle --use-angle=swiftshader`, a **software** rasteriser, so the
image depends on the code and the fixture rather than on whose laptop ran it.
That is what makes a committed image a reference somebody else can reproduce
rather than a souvenir.

It is not a promise of pixel equality. Font rasterisation, SwiftShader's own
version and the animation phase (see `scene-baseline.spec.ts` — the phase is
deliberately not pinned) all still move. **Compare these by eye, for content.**
A planet missing, a canvas gone black, foliage that lost its seasonal recolour:
those are what these images exist to catch. Two degrees of orbit are not.

### The line above has been ignored once, expensively

Measuring the universe's star across the three sets gives saturation 0.550,
0.599 and **0.321** — a series that reads as a collapse arriving with the
three@0.185.1 upgrade, and it was read that way, and it is wrong. Pinning the
animation phase and changing nothing but the dependency puts the same star at
saturation 0.381 on three 0.171.0 and **0.380** on 0.185.1. Fifteen releases
move it by 0.001; the free phase moves it by 0.28.

So the rule is sharper than "compare by eye": **a number taken off these images
carries the camera and the phase along with the code, and the phase term is
larger than anything a dependency is likely to do.** A question of the form "has
this moved?" belongs in a spec that pins the clock through the parity harness —
`sun-colour.spec.ts` is the worked example, and `driver-parity.spec.ts` is the
same lesson learned a second time on a different axis.

## How to use them

```powershell
npm run shoot                    # writes e2e/shots/
```

Then open the matching pair — `e2e/shots/desktop/forest-world.png` against
`e2e/reference/<stack>/desktop/forest-world.png` — and look at them.

After a dependency change lands and the scenes have been checked, copy
`e2e/shots/` to a new `e2e/reference/<new-stack>/` and commit it. Keep the old
directory: the point of a series is that it is a series.

## What is in each set

| Shot | What it is for |
| --- | --- |
| `universe-world` | The solar-system renderer: planets, rings, belt, comets, sun, HUD islands |
| `forest-world` | The forest renderer, and the one that used to be most likely to fail silently — `forestModels.ts` recolours foliage by patching a three.js built-in shader with a string replacement that throws nothing when it stops matching. Since the 0.185.1 upgrade that replacement is guarded: `shared/shaderChunkPatch.ts` reports a marker that has gone missing, and `shaderChunkPatch.test.ts` fails the build before a browser is opened. This shot is still the one to look at, but it is no longer the only thing standing between a chunk rename and a wrong frame |
| `universe-share` / `forest-share` | The public share pages, which render the same scenes through a different route and a different data shape |
| `world-loading` | The Suspense fallback, on the one screen where a regression looks like a hang rather than an error |
| `landing` | No WebGL at all — routing and layout, so an App Router break shows up without the canvas in the way |

Each at `desktop` (1440×900) and `mobile` (375×812), the width where the world
page's HUD stops being an overlay and becomes a scrolling column.

## The sets

| Directory | Stack | Shot on | Why |
| --- | --- | --- | --- |
| `next-14.2.23-react-18.3.1-r3f-8.17` | Next 14.2.23, React 18.3.1, @react-three/fiber 8.17, three 0.171.0 | 2026-08-14 | The last stack before the Route A upgrade. Every `next` advisory open at the time is against this one — it is a reference, not a state to return to |
| `next-15.5.23-react-19.2.8-r3f-9.7` | Next 15.5.23, React 19.2.8, @react-three/fiber 9.7.0, three 0.171.0 | 2026-08-14 | Route A. Closes all 21 `next` advisories and puts this app on the stack `myunivokai-admin` already runs |
| `next-15.5.23-react-19.2.8-r3f-9.7-three-0.185.1` | the same, on three 0.185.1 | 2026-09-10 | Fifteen three.js releases, plus the composer tone curve restored. **Two changes in one directory** — see below |

### Why the 0.185.1 set carries two changes

Because the tone curve had to be fixed first. `NoToneMapping` was being assigned
by `EffectComposer` on mount, so every family that mounts the chain — forest,
universe, the fallback — had no tone curve at all and clipped anything above 1.0.
Comparing an upgrade against a clipped baseline compares two things at once, so
`agent-system/research/webgpu-full-migration-feasibility-2026.md` §26 sequences
the fix ahead of the upgrade, and this directory is shot after both. **The
`r3f-9.7` set above is therefore a picture of the clipping**, not of a look worth
returning to.

Re-shooting twice was considered and skipped: the shoot takes twenty minutes and
the numbers already separate the two changes. The upgrade's own contribution was
isolated with a control run — the same specs with the upgrade branch's source
stashed, so `three@0.171.0` rendered them — and it moved these frames by
**+0.007, +0.002 and −0.003 luma**, inside the ±0.024 phase noise measured
between two runs of identical code. r181's PBR changes, rated a HIGH and silent
risk in the migration plan, are not visible at this instrument's resolution.

**These twelve frames are the series, and they are not the whole shoot.** The
ocean family arrived after the series started and is graded by its own
machinery — `demo-*` against `ref-*` under `e2e/shots/`, with numeric bounds in
`src/features/scene-renderers/ocean/oceanFrameBudget.test.ts`. Adding it here
would make the directories incomparable, which is the one thing a series must
not be.

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
| `forest-world` | The forest renderer, and the one most likely to fail silently — `forestModels.ts` recolours foliage by patching a three.js built-in shader with a string replacement that throws nothing when it stops matching |
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

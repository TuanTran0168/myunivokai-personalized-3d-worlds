# demos

Prototypes kept because the owner liked them, or because they settled a question
that would otherwise be argued about in words.

A demo here is **not** production code and is not imported by any app. It exists
to answer one question with a picture before the answer costs a renderer
refactor. If a demo proves something, the finding belongs in `agent-system/`; the code
stays here as the evidence.

**Every artifact built for the owner lands here**, in the change that creates
it. A page that exists only as a `claude.ai/code/artifact/...` URL is not in the
repository: it cannot be diffed, cannot be found by anyone without the link, and
goes with the conversation that made it. Two of this project's settled arguments
were settled by a page like that. The committed file is the original; the URL is
a copy of it. See
[agent-system/rules/demos-and-artifacts.md](../agent-system/rules/demos-and-artifacts.md).

## Rules

- **Two source files, one build step.** A demo should be a shell (`shell.html`)
  plus one script. Anything that needs a bundler, a framework or a dev server
  does not belong here — it belongs in `apps/`. A `measure.mjs` alongside them is
  fine and encouraged: see below for why.
- **Measure the output, don't describe it.** A demo is judged on a picture, and
  the person or agent producing it is the least reliable judge of it. If a demo
  makes visual claims, it ships a script that checks them numerically.
- **Never commit a vendored library.** three.js is 1.3 MB. Splice it in at build
  time from `apps/myunivokai-web/node_modules`; `dist/` is gitignored.
- **No network at runtime.** The built file must open from the filesystem with
  no CDN, no fonts, no remote assets. Textures are generated procedurally on a
  canvas.
- **No `Math.random()`.** Same rule as the app: seeded PRNG only, so a demo
  looks the same every time it is opened and a screenshot means something.
- **Say what it does not prove.** Every demo's header comment records its own
  limits.
- **Correct it when its subject ships.** A bench that still reads as a proposal
  after its proposal was built is worse than no bench — the next person takes
  its recommendation as the current design, one revision late.

## Contents

### `world-change-transition/`

The bench that chose how changing world should look. Four ways to cross, played
against the same floating form rail, with the 2.5 s cold load simulated — plus a
loader per world family. `Genie out · hold · in` was approved from it and is what
ships in `apps/myunivokai-web/src/features/transitions/`.

```
# no build step; open it directly
demos/world-change-transition/between-worlds.html
node demos/world-change-transition/measure.mjs   # checks its three claims
```

No build step because there is nothing to splice in: the worlds are hand-painted
on a 2D canvas, and the whole point is to judge motion and layering rather than
to render a scene.

Three claims, all checked numerically by `measure.mjs`:

| Claim | How it is checked |
| --- | --- |
| the timeline is 620 ms out, hold, 620 ms in | each stage timed from the click to its Play button coming back |
| the hold is painted in the **arriving** world's ground | canvas sampled mid-hold, clear of the loader, against both candidate colours |
| the rail never moves | its bounding box read before, mid-gesture and after |

The corrections written into the page after it shipped are the part worth
reading. The bench cannot show the one thing that decided the implementation:
both genie halves are canvas `requestAnimationFrame` loops, so they freeze
during the real compile block exactly as the old swipe did. The destination is
therefore not mounted until the departure has finished, and only the hold — DOM
and CSS, `transform` and `opacity` only, so it runs on the compositor — overlaps
the blocked main thread.

**What it does not prove:** its stall is a `setTimeout`, not a blocked main
thread, so every stage here keeps animating through it and in the app only the
hold would. Nothing measured here says anything about the real 2.7 s.

### `ocean-depth-rig/`

An interactive style study for the ocean family: the art direction argued for in
[agent-system/evolution/ocean-visual-direction-research.md](../agent-system/evolution/ocean-visual-direction-research.md),
made visible so the direction can be accepted or rejected before
`OceanRenderer.tsx` is touched.

```
node demos/ocean-depth-rig/build.mjs     # writes dist/ocean-depth-rig.html
node demos/ocean-depth-rig/measure.mjs   # checks it, exits non-zero on faults
# then open demos/ocean-depth-rig/dist/ocean-depth-rig.html
```

The build splices in three.js, `GLTFLoader` (turned into a classic script,
unpatched) and four CC0 GLBs as base64 — a self-contained page cannot `fetch()`
a model from a `file://` URL. Output is about 1.9 MB and needs no server.

Four controls, and every one of them is a quantity an oceanographer measures:

| control | unit | what follows from it |
| --- | --- | --- |
| viewer depth | m, **negative for air** | which boundaries are in frame; all absorption |
| seabed depth | m | the same rule, applied twice |
| Jerlov water type | enum I…7C | Kd per channel → colour, light-with-depth, sighting range, fog, caustics |
| wind at 10 m | m/s | Pierson–Moskowitz spectrum → wave height, wavelength, choppiness, whitecaps |
| sun elevation | ° | the Preetham sky, the refracted underwater sun, god rays, key light |

Nothing in the rig is an art-direction number: the colours, fog densities, light
intensities and foam thresholds are all derived, and section 11k of the research
doc is the argument that the service should carry exactly these fields.

The bathymetry rule is one line — a boundary is drawn only when it lies within
about 1.5 sighting ranges — and those two depths produce six different worlds:

| Preset | Viewer | Seabed | Sun | In frame |
| --- | --- | --- | --- | --- |
| Above water | **−22 m** | 3.7 km | 32°, 118° off the bow | sky, swell, whitecaps — a blue sea, because it faces away from the sun |
| Golden hour | **−12 m** | 3.7 km | 5°, dead ahead | the glitter path, and a red sky the optical path makes on its own |
| Reef | 8 m | 15 m | 58° | surface **and** floor |
| Open water | 17 m | 3.7 km | 46° | surface only — **no bottom, even though it is shallow** |
| Twilight | 142 m | 3.9 km | — | neither: pure water column |
| Abyssal plain | 2448 m | 2455 m | — | floor only, lit by a lamp and by living things |

The sun is one slider with eight consumers. Above water it drives the Preetham
atmosphere ported from three.js's `Sky.js`; below water Snell's law bends it
toward the zenith, and the view up through the window is that same sky sampled
per pixel with the refraction inverted.

A negative depth is not a special case: it is the same rig with air as the
medium. The surface has two materials — Snell's window from below, the three.js
`Water.js` technique from above — and they are never both on.

The layer checkboxes switch each row of the research doc's layer stack on and
off, so the contribution of any one layer can be seen in isolation. Runs
**without post-processing** on purpose: the plan requires the frame to read with
the effect stack disabled.

**What it proves:** that depth has to move geometry rather than only tint it;
that far silhouettes, a foreground frame and a complementary fill together are
most of the missing image; that a school of a thousand vertex-animated instances
costs less than twenty-six skinned clones; and that species belong to zones —
a dolphin needs air, a lanternfish needs the mesopelagic.

It also proves four things about brightness, all of which apply to the real
renderer and are written up in section 11c of the research doc: that physical
irradiance must not be mapped straight to screen luminance; that absorption may
set the water's hue but not its value; that the from-below surface has to be
fogged by the same law as the medium or it paints a dark ceiling over the top of
every frame; and that an ambient raised to brighten a scene flattens it.

And it now proves the thing it was built to prove about the assets: **the
locomotion model is asset-independent.** Four of the repo's CC0 GLBs — shark,
dolphin, whale, manta — are loaded and instanced with the same vertex-animation
shader the procedural bodies use, and nothing about the animation changed. The
shader's whole contract with its geometry is one float attribute, `along`, 0 at
the nose and 1 at the tail. The four models are 74 to 405 triangles.

**What it does not prove:** the schools are still procedural, on purpose — a
thousand instances of a detailed mesh is the cost the whole approach exists to
avoid. Its caustics are a cheap ridged-sine approximation, not the
differential-area form the renderer uses. The above-water reflection is an
analytic sky, not a render target, so it is exact only for an empty horizon — put
anything at the waterline and that term has to change. And no frame here has been
seen on real GPU hardware; `measure.mjs` narrows what can hide there but does not
replace it.

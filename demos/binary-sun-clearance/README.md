# binary-sun-clearance

Three frames of the create form's live preview, pinned to the same instant, that
settle two separate questions the owner asked about one screenshot: **"why are
there two suns?"** and **"why is the sun paler than the old build?"**

The answers are different, and only one of them is a bug.

## Why there are two suns

`binary-sun` is a 3% rare feature, shipped in `ba7b716` and unchanged since. It
did not appear because of the WebGPU work. It appeared because the preview's seed
contains the nickname — `previewSeedFromInputs` in `src/lib/scene.ts` — and
`profileAutofill.ts` types the nickname in from the account's display name at
sign-in. The older screenshot the owner compared against was taken signed out.

With every other field at `CREATE_FORM_INITIAL_VALUES`:

| nickname | rare features rolled | core scale | sun tint / glow |
| --- | --- | --- | --- |
| *(empty → "Neo")* | none | 1.22 | `#FFFFFF` / `#FDB813` |
| `Trần Đăng Tuấn` | `binary-sun`, `black-hole` | 1.41 | `#FFE3C4` / `#FF9E4A` |

So a name changed the star, the camera, the core scale and the lottery. Whether
it should is a product decision and is not made here.

## The bug: the two stars were welded together

`BinarySun.tsx` orbited the companion at the **world-unit** constant 2.4, with
the comment "outside the primary sun's glow shell". That was measured against
`DEFAULT_SUN_SCALE` and never re-checked against the sun the generator actually
draws. The primary's radius is `core.scale × 1.45`, and `core.scale` is seeded
over 1.05–1.50 — the same range in `world_config_builder.go:62` and in the
preview builder — so the primary swells from 1.52 to 2.18 world units while the
companion's orbit stood still:

```
coreScale 1.20   primary radius 1.740   companion near edge 1.808   clearance +0.068
coreScale 1.25   primary radius 1.813   companion near edge 1.784   clearance −0.029  ← intersects
coreScale 1.41   primary radius 2.044   companion near edge 1.705   clearance −0.340  ← the reported frame
coreScale 1.50   primary radius 2.175   companion near edge 1.660   clearance −0.515
```

Above core scale ≈1.24 the companion's photosphere is **inside** the primary's.
That is 59% of the seeded range, so roughly 1.8% of all universes — 3% of them
binary, 59% of those welded — rendered one lumpy star instead of two.

The fix expresses the orbit in primary radii instead of world units, which
cannot drift out of clearance whatever the seed rolls, and tilts it out of the
planets' plane.

| | |
| --- | --- |
| `before-welded-into-the-primary.png` | the companion bulging out of the primary's right limb, one continuous mass |
| `after-clear-of-the-primary.png` | the same pinned instant, the companion a complete disc with its own limb and its own halo |
| `no-rare-feature-empty-nickname.png` | the same form with the nickname empty — no companion, no black hole |

## What is measured, and what is not

**The geometry is not measured from these pixels, deliberately.** Counting
bright regions to assert "one blob became two" was written first and discarded:
the primary's additive glow shell sits above every threshold low enough to catch
the companion's disc, so a sweep gives 1 region at 0.66 of the frame's peak and
8 at 0.78. A count that swings like that is not evidence. The geometry is proven
by arithmetic instead, over the whole seeded range and in world units, by
`apps/myunivokai-personalization/src/features/scene-renderers/solar-system/binarySunGeometry.test.ts`,
which runs in `npm test`. Look at the crops with your eyes; trust the test for
the number.

**The colour is measured**, because "the sun looks pale" deserves a number.
`measure.mjs` finds the star by its brightest pixel and means everything above a
luminance floor around it — the same method as `e2e/sun-colour.spec.ts`:

```
after-clear-of-the-primary       rgb 194.1 158.3  97.9 · saturation 0.495 · peak 231
no-rare-feature-empty-nickname   rgb 192.2 174.6 114.7 · saturation 0.403 · peak 204
```

**The star called pale is the more saturated and the brighter of the two.** So
whatever is reading as washed out, it is not the star's colour: both the
saturation and the peak move the other way. What does differ is the halo — the
glow shell is drawn at 1.22× the star's radius, so a core scale of 1.41 spreads
a low-opacity `#FF9E4A` over visibly more of the frame than 1.22 spreads
`#FDB813`, and a binary world pays for a second one. The levers are
`SUN_TEMPERATURE_CLASSES` in `src/lib/scene.ts` (which classes exist and how
often they are drawn) and `SUN_GLOW_SCALE_MULTIPLIER` / `SUN_GLOW_OPACITY` in
`Sun.tsx`. Which of them to turn is a look decision, and the owner's.

## Reproducing

The frames come from a committed spec, not from a hand-taken screenshot:

```powershell
cd apps/myunivokai-personalization
$env:SHOOT_PORT = "41399"
npx playwright test e2e/create-form-preview.spec.ts --project=desktop
```

`?parityRenderer=webgl&paritySeconds=6` pins the animation clock — `UniverseCanvas`
reads the harness off `window.location.search` wherever it is mounted, the home
page included — so two runs differ by the code between them and not by the
moment the shutter opened. Then crop and measure:

```powershell
cd ../../demos/binary-sun-clearance
node measure.mjs "after-clear-of-the-primary=../../apps/myunivokai-personalization/e2e/shots/create-form-preview/desktop-binary-sun.png"
```

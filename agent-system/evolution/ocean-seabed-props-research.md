# The wreck and the glow — what should stand on the seabed

> **Document status:** Research. Nothing here is approved and nothing here is built.
> **Written:** 2026-09-01
> **Question:** the owner asked for *"model đắm tàu hoặc các mỏ dưới đáy biển phát sáng"* —
> a shipwreck, or glowing deposits on the seafloor.

Two requests that look like one and are not. The wreck is an **asset-sourcing**
question with a measurable answer. The glow is an **art-direction** question
whose answer turns out to be more interesting than the request assumed.

---

## Part 1 — the shipwreck

### What the plan said, and what it was missing

[`plans/frontend/ocean-realism-roadmap.md`](../plans/frontend/ocean-realism-roadmap.md)
work item 6 recommends:

> | Shipwreck | **loaded model**, if a clean CC0/CC-BY one exists | The one prop
> whose realism comes from man-made detail a seeded generator cannot invent.
> `buildSunkenRelic` is the fallback and stays |

The conditional was never tested. It is now.

### Sketchfab is reachable now, and that changes the search

The token the owner provisioned works. Measured 2026-09-01, both endpoints, with
a static account API token and no browser:

```
GET /v3/search?type=models&downloadable=true&license=cc0   → results
GET /v3/models/{uid}/download                              → HTTP 200
   { glb: 14.5 MB, gltf: 69 MB, usdz: 9.4 MB, source: 118 MB }  signed, 300 s
```

[`knowledge/references/threejs-assets.md`](../knowledge/references/threejs-assets.md)
said the opposite — "agents/CI cannot pull Sketchfab files" — from an HTTP 401
seen with no credential at all, which does not support that conclusion. It has
been corrected, because `knowledge/` describes reality and reality is right.

### What is actually there

Every downloadable model on Sketchfab matching wreck-shaped queries, with its
real triangle count:

| Model | Licence | Triangles | Verdict |
| --- | --- | --- | --- |
| **Stern Of SS Rifle** (Scottish Maritime Museum) | **CC0** | 249,984 | The only CC0 wreck in the catalogue. A museum photoscan of a real pre-fabricated screw steamer |
| Sunken Shipwreck | CC-BY | 3,108 | Ships with a treasure chest. A pirate prop |
| shipwreck low poly | CC-BY | 4,697 | Rigged animated sail — a floating ship, not a wreck |
| Low Poly Ship Wreck | CC-BY | 7,204 | Plausible silhouette, one texture |
| ShipWreck | CC-BY | 15,775 | |
| Sunken Ship low Poly | CC-BY | 15,040 | |
| Shipwreck Island | CC-BY | 12,851 | A whole scene. Banned by the no-whole-scene rule |
| Edro III / Point Reyes / Endurance / Robert Gaskin | CC-BY | 250 k – 600 k | Photoscans of real wrecks |

**The finding is the shape of that table.** There is exactly **one** CC0 wreck
in existence on the platform, it is a 250 k-triangle photoscan, and its GLB is
**14.5 MB — larger than the ocean family's entire model catalogue** (15 GLBs,
8.9 MB, all fauna). Everything cheap is CC-BY and reads as a game prop rather
than as a thing that sank.

### The argument this settles

The plan's reasoning for loading rather than building was that a wreck's realism
"comes from man-made detail a seeded generator cannot invent". That is true of
the 250 k photoscan and false of every low-poly candidate: at 3–7 k triangles a
downloaded wreck is a *different person's* procedural guess at a wreck, with a
licence obligation attached and no ability to vary per world.

So the real choice is binary, and it is not the one the plan framed:

**A. Take the CC0 photoscan and pay for it.** Decimate 250 k → ~5 k, resize the
two textures to 1 k, and accept ~400 KB. The detail that survives decimation on
a scan is the *silhouette and the baked albedo* — rivet lines and plate seams
survive as texture, not as geometry, which is exactly the man-made detail the
plan wanted. It is CC0, so no attribution obligation and no redistribution
problem. It is one specific real ship, so every ocean world gets the same wreck.

**B. Extend `buildSunkenRelic`.** Zero bytes, varies per seed, already placed by
the height sampler, already tinted by the water. Its weakness is the one the
geometry file already names: architecture is straight lines, and a procedural
generator is bad at the *irregular* damage that says a thing broke.

**Recommendation: A, and only A, and only as the rare `sunkenRelic` lottery
prop.** Keep `buildSunkenRelic` as the ordinary case. The rarity feature already
exists (`rarityFeature("ocean-sunken-relic")`), so a 400 KB download that
appears in a small fraction of worlds is a good trade, and a 400 KB download in
every world is not.

**What would kill A:** if decimation to 5 k destroys the read. That is a
twenty-minute experiment (`gltf-transform simplify` + `resize`, render it at
the landmark's 2.6 m height in the abyss fixture, look at it) and it must happen
before any of this is planned, not after.

### The rules that still bind

From [`threejs-assets.md`](../knowledge/references/threejs-assets.md) and work
item 6, none of them relaxed by the token:

- CC0 or CC-BY only; attribution recorded where CC-BY.
- **Never commit the token.** It lives in the gitignored
  `apps/myunivokai-web/.env.local.secret` and is used by offline tooling only.
- **No whole-scene meshes.** The forest baked-scene attempt failed on exactly
  this — an arbitrary pivot and up-axis with terrain carved for it. A wreck
  arrives as a single prop with a known scale and is placed by
  `lowestSeafloorUnderFootprint` like every other seabed object.
- The prop must have its **foot at y = 0**, because that is the contract
  `standOn` in `oceanLandmarkGeometry.ts` establishes and everything on the
  seabed obeys.

---

## Part 2 — the glow

### The request assumed something that is nearly false

"Mỏ dưới đáy biển phát sáng" — glowing deposits on the seafloor. Almost nothing
on a real seabed glows. Polymetallic nodule fields, brine pools, methane seeps,
manganese crusts: all dark. **In the abyss the light comes from animals**, which
is a thing this family already knows — `depth_curve.go` drives `GodRayStrength`
and `CausticStrength` to exactly zero at the sunlight floor precisely so that
below it the only light is biological.

But there is one real exception, and it is better than the request.

### Black smokers do emit light, and it was a surprise to oceanography too

Measured at deep-sea vents ([White et al. 2002, *JGR Solid Earth*](https://www.whoi.edu/cms/files/75_121648.pdf)):

- **Thermal radiation dominates above 700 nm.** A 350 °C chimney is a black
  body; photon flux climbs from about 10⁶ photons cm⁻² s⁻¹ sr⁻¹ at 700 nm to
  about 10¹⁰ at 1000 nm. To a human eye this is effectively invisible — a very
  faint dull red at best. The vent shrimp *Rimicaris exoculata* has eyes tuned to
  it, which is why anyone looked.
- **There is anomalous light at 400–600 nm**, *orders of magnitude* brighter
  than thermal radiation predicts. Attributed to mechanisms of the mixing front
  itself: vapour-bubble luminescence, chemiluminescence, crystalloluminescence
  and triboluminescence — light made by minerals crashing out of solution and by
  bubbles collapsing.
- **Bioluminescence has been photographed on a black smoker chimney**
  ([Oceanography 16(4)](https://tos.org/oceanography/article/first-evidence-of-bioluminescence-on-a-black-smoker-hydrothermal-chimney)),
  from organisms living on it.

### What that means for the renderer

The instinct — a steady cyan bloom around the vent — is the one thing the
physics does not support. What it supports is better, and it is a **two-part
glow with completely different characters**:

| Layer | Colour | Behaviour | Physical basis |
| --- | --- | --- | --- |
| **The mouth** | dull red-orange, very dim | steady, tight to the aperture, falls off within a chimney's width | black-body tail of 350 °C fluid |
| **The precipitation front** | blue-white, brief | *stochastic flickers* in the plume where fluid meets cold seawater — sparse, sub-second, never periodic | crystalloluminescence and bubble collapse |

The second layer is the interesting one and nothing in this repo does anything
like it. A vent that flickers irregularly is alive in a way a bloom sprite is
not, and the flicker is not an effect somebody invented — it is the mineral
precipitating.

`buildHydrothermalVent` already builds the chimney, and `OceanLandmarks.tsx`
already draws the plume as a cone at `VENT_PLUME_HEIGHT = 6.5`. Both layers
attach to what exists.

### Do not import a vent

Same search, same answer, harder:

| Model | Licence | Triangles |
| --- | --- | --- |
| Black Smoker (hydrothermal vent) | CC-BY | 118,784 |
| Ep. #64 Black Smoker Sulfide | CC-BY | 89,808 |
| Sequoia Vent — Mariana Islands | CC-BY | 749,999 |
| D1246 Miniature deep sea hydrothermal… | CC-BY | 3,995,548 |

**No CC0 vent exists at all.** Every candidate is a research photoscan two to
four orders of magnitude over budget, and a vent's whole visual identity is the
plume and the light, neither of which is geometry. Build it; the geometry is
already built.

---

## What to do, in order

1. **Twenty minutes: decimate the CC0 wreck and look at it.** Everything about
   part 1 hangs on whether a 250 k scan survives the trip to 5 k. Nothing else
   should be planned until that picture exists.
2. **Give the vent its two-layer glow.** Cheap, self-contained, no assets, and
   it is the thing the owner asked for in the form the ocean actually takes.
3. **Only then** decide whether the wreck is worth a plan.

## What this research does not settle

- Whether a decimated photoscan reads at 2.6 m in fogged water. Not measured.
- What a stochastic flicker costs. The vent is one of six landmark kinds and
  there can be several per world; a per-frame random draw per vent is nothing,
  but an emissive that dirties a material every frame is not nothing.
- Whether CC-BY attribution is acceptable to the owner at all. No CC-BY asset is
  in the repo today, so this would be the first, and the attribution has to live
  somewhere a visitor can reach.

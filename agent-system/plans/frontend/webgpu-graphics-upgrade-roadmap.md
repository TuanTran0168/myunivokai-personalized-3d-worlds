# WebGPU graphics upgrade roadmap — what the node path makes possible, and in what order

> **Document status:** Active plan. **Corrected and expanded 2026-09-18 —
> read §0 first**, it lists what this document got wrong before anything was
> built on it.
> **Written:** 2026-09-17, branch `feat/fe/webgpu-migration-phase-13`;
> corrected 2026-09-18, branch `feat/fe/webgpu-graphics-upgrade`
> **Companion to:** [`../../research/webgpu-full-migration-feasibility-2026.md`](../../research/webgpu-full-migration-feasibility-2026.md)
> (the migration itself, §26 Phases 0–13) and
> [`../../knowledge/frontend/threejs-scene-architecture.md`](../../knowledge/frontend/threejs-scene-architecture.md)
> (what the two paths actually do today)

The migration is finished as a migration. Phases 0–13 took this app from one
`WebGLRenderer` and nine hand-written GLSL shaders to a `WebGPURenderer` with
two backends, one node graph, one shader source, an eight-pass node post chain,
a device-loss path, an analytics field that counts which backend really drew,
and — Phase 13 — pipelines that compile off the main thread.

**This document is about what comes after, and its first job is to say that
almost none of it should start yet.** Every stage below is gated, and the gates
are not ceremony: they are the specific measurements that would otherwise be
asserted rather than known. A stage whose gate is open is worth building. A
stage whose gate is shut is a good idea that would be built on a number nobody
has.

---

## 0. Corrections, made 2026-09-18 before a line was built on this

This document was written in one pass at the end of §26 Phase 13 and was not
reviewed. A six-way audit of the render path then checked it against the code
and against the migration report, and **four of its load-bearing claims were
wrong**. They are corrected in place below; they are listed here because a
reader who skipped them would build the wrong thing first.

**1. §1 said the fallback's first-mount cost was mostly solved. It is not.**
The row read "node/WebGL2 now below it on three fixtures of four". The measured
table says node/WebGL2 is below the classic renderer on **one** fixture, the
universe. What is true of three fixtures is each one against ITSELF before the
warm-up existed — a different comparison, and the plan quietly swapped them. So
the day the flag goes on, a fifth of visitors take a **13.6 s** freeze on the
forest and a **2.9 s** freeze underwater.

**2. There is therefore a SECOND rollout blocker, and this plan named only one.**
Stage 0's canvas readback is real. So is the forest's fallback first mount. A
rollout gated only on the readback would ship the freeze.

**3. Stage 3's premise was half wrong in the app's favour.** The linear HDR
buffer it proposes to introduce is **already the default** — `Renderer` defaults
`outputBufferType` to `HalfFloatType` and `PassNode` stamps its target from
`getOutputBufferType()`, so the universe and the forest have had it since
Phase 5. Only the ocean lacks one, because it mounts no chain. Stage 3's real
scope is one family.

**4. And Stage 3 forbade the cheapest way to give the ocean that buffer, on a
blocker that does not exist on this path.** It said a frame-wide pass "cannot
read" the per-depth `toneMappingExposure`. On the node path it can:
`toneMappingExposure` is `rendererReference( 'toneMappingExposure', 'float' )`,
a uniform that tracks the renderer, and `NodePostEffects.tsx` already uses it
with a comment saying it must keep working "if this chain ever serves that
family". The blocker was true of `postprocessing`@6.39.4 and was inherited
without rechecking.

**One more, smaller and in the other direction.** §6 rejects GPU procedural
texture generation because "§24.1 attributes 1121 ms of the forest's remount to
`texSubImage2D`". That 1121 ms is the solar-system family's committed 8K JPEGs
(8192x4096, 134 MB of RGBA once decoded). **No procedural bake in this repo is
anywhere near 8K** — the largest is the gas giant's 1024x512. The rejection may
still be right; the reason given for it is not.

---

## 1. The state this plan starts from

Everything in this section is measured, and each number names where.

| Property | Where it stands | Source |
| --- | --- | --- |
| Renderer | `WebGPURenderer`, two backends, one node graph | §26 Phase 9 |
| Rollout flag | `NEXT_PUBLIC_NODE_RENDERER`, **off** | §26 Phase 12 |
| Visual parity vs `WebGLRenderer` | universe **12.22**, forest **19.49**, ocean **9.90** of 255 | §26 Phases 8, 10 |
| Fallback vs primary | universe 0.44, forest 1.31, ocean 0.02 of 255 | §26 Phases 4, 5 |
| First mount, blocked main thread | node/WebGPU below classic on every fixture. **node/WebGL2 is below it on ONE of four** — see §0 | §26 Phases 11, 13 |
| node/WebGL2 against classic, blocked | universe 1244 vs 2094 · forest **13593 vs 3596** · ocean 2872 vs 1129 · surface 307 vs 214 ms | §26 Phase 13 |
| HDR compositing | **already the default** on the node chain; the ocean is the one family without a chain | `Renderer` `outputBufferType`, `PassNode` |
| Canvas readback | **broken on both node backends** — `preserveDrawingBuffer` does not exist there | §26 Phase 9 |
| Steady-state frame cost | **measured 2026-09-18** — forest 7.40 ms a frame classic against 1.00 ms node; see Stage 1 | `sustained-load.spec.ts` |
| GPU compute in the app | none | §15 |

Two of those rows are the whole reason this document is ordered the way it is.
The readback is what keeps the flag off, so nothing below reaches a visitor
until it is fixed. And the missing frame rate is what makes every performance
claim below unfalsifiable until Stage 1 exists.

---

## 2. Stage 0 — Stop reading the canvas (one of the two rollout blockers)

**Gate: open. This is the next piece of work, and nothing else here starts
before it.**

**The defect.** `WebGPURendererParameters` does not declare
`preserveDrawingBuffer`, and the string appears zero times in
`three.webgpu.js` against twice in `three.module.js`. Both node backends
therefore read back a fully transparent canvas — 0 of 256 samples carrying
alpha, against 256 of 256 on the classic renderer. The WebGL2 backend failing
too is what rules out WebGPU present-time semantics as the explanation: it is
the same graphics API as the row that works.

**Two features read that buffer.** `features/transitions/sceneStill.ts` already
fails safe and the caller cuts. `lib/exportImage.ts` now refuses rather than
downloading a transparent PNG. Both are guards, not fixes: with the flag on, a
visitor loses the download button and every scene change becomes a hard cut.

**Measured 2026-09-18, and it settles which defect this is.** The diagnostic
used to report only "0 of 256 samples carry alpha", which cannot tell a buffer
that was cleared from a buffer whose alpha channel is zero — and those need
completely different fixes, one a renderer parameter and one a rewrite. It now
counts colour separately. The answer on both node backends is **0/256 alpha and
0/256 colour**, against 256/256 and 256/256 on the classic renderer: the buffer
is empty, not transparent. There is no cheap fix.

**The fix is to render the picture instead of scraping it.** An offscreen render
target, drawn on demand, read back with `readRenderTargetPixelsAsync`.

**It is NOT one implementation for both paths, and this plan said it was.** The
two methods share a name and nothing else: `WebGLRenderer`'s takes
`( renderTarget, x, y, width, height, buffer, activeCubeFaceIndex, textureIndex )`
and fills a buffer the caller allocates; the node `Renderer`'s takes
`( renderTarget, x, y, width, height, textureIndex, faceIndex )` and returns the
data itself. A single call site cannot serve both, so the capture needs a small
per-renderer adapter — which is a dozen lines, not a redesign, but it has to be
in the plan rather than discovered.

**What makes it a piece of work rather than a patch, and it is the honest
reason it is not in Phase 13.** The readback becomes asynchronous, and all three
call sites are synchronous today for reasons that are written down:
`page.tsx:388` captures one statement before the state update that would destroy
the frame; `WorldTransition.tsx:244` captures inside a `requestAnimationFrame`
loop whose own comment says *"Everything about the pacing depends on this line
not moving earlier"*; `GenieReveal.tsx:83` captures inside an effect. An `await`
in the middle of those is a scheduling change to the transition system, in the
one part of this app whose documented design is built around knowing when the
main thread is idle. It needs its own branch, its own before/after shoot, and
`world-transition.spec.ts` re-run.

**Done means:** the export produces a real PNG on all three renderers, the
transitions warp a real still on all three, and the RATCHET in
`e2e/node-path-diagnostic.spec.ts` is deleted rather than inverted.

---

## 3. Stage 1 — A sustained-load harness (the instrument every later stage needs) — **BUILT**

**Gate: open, and this is the one that goes FIRST.** The plan originally put
Stage 0 first because it is the rollout blocker. That was an ordering by
urgency rather than by dependency: Stage 0 unblocks shipping, Stage 1 unblocks
knowing, and every stage below Stage 1 makes a performance claim that cannot be
checked until it exists. Stage 0 can run beside it.

**What is missing, exactly.** The parity harness draws with `frameloop="never"`
and steps a pinned clock sixty times, *precisely so that it never measures a
frame rate* — that is what makes two images comparable, and it is the right
trade for parity. It is the wrong instrument for everything below. §26 Phase 11
says so in its own words: adaptive DPR and per-frame instance upload "are NOT
measured … both need a sustained-load harness this one is the wrong shape for".

**What it has to produce**, and the list is short because a long one never gets
built:

- a free-running frame loop on a fixture, after a warm-up long enough that
  pipeline creation is finished (Phase 13 makes that a bounded wait rather than
  a guess);
- frame-time percentiles, not a mean — the repo's bar is a floor, and a mean
  hides exactly the frames that break it;
- per-frame CPU time attributable to instance uploads, because that is the
  quantity Stage 2 claims to remove;
- three legs, like every other measurement here: `WebGLRenderer`, node/WebGL2,
  node/WebGPU.

**The trap this must avoid, and it has already caught this project twice.** Run
it on SwiftShader and it will report that a fine scene is broken; run it on the
real GPU with something else on the machine and two runs differ by the load
rather than by the code. It belongs in the `webgpu` Playwright project, on the
real driver, and its output is percentiles with the machine named beside them.

**Done means:** a number for today's renderer on all four fixtures, committed as
the baseline that every stage below is measured against.

### BUILT 2026-09-18, and the baseline is below

`e2e/sustained-load.spec.ts` on the `webgpu` project, driven by
`measureSustainedFrames` on the parity harness. Sixty warm-up frames stepped and
discarded, three hundred timed at a fixed sixty-per-second timeline, percentiles
by nearest rank. RTX 4060 Laptop, ANGLE/D3D11, one run per cell.

**Milliseconds per frame, p50 / p99 / worst:**

| fixture | `WebGLRenderer` | node · WebGL2 | node · WebGPU |
| --- | --- | --- | --- |
| universe | 0.50 / 9.60 / **496.1** | 0.10 / 0.20 / 0.30 | 0.10 / 0.70 / 6.40 |
| forest | **7.40** / 9.00 / 236.3 | 1.00 / 2.30 / 3.70 | 1.00 / 2.50 / 69.9 |
| ocean, underwater | 0.70 / 9.70 / 28.2 | 0.70 / 1.80 / 3.90 | 1.00 / 4.00 / 97.2 |
| ocean, above water | 0.00 / 0.20 / 0.30 | 0.10 / 0.80 / 3.40 | 0.10 / 0.50 / 0.70 |

**THE FOREST COSTS 7.40 ms A FRAME ON THE RENDERER EVERY VISITOR HAS, AND 1.00 ms
ON THE ONE THEY DO NOT.** That is 44% of a 60 fps budget against 6%, and it is
the first steady-state number this project has ever had. Phase 11 measured the
first mount and found the node path better; this measures every frame after it
and finds the same thing, larger.

**What it is NOT: proof that the node renderer is seven times faster.** The
draw accounting says the two legs were asked for similar but not identical work
— the forest's classic leg draws 215 calls over 8.07M triangles, the node/WebGPU
leg 173 over 6.51M — so about a fifth of the gap is less geometry, not faster
drawing. And the node/WebGPU column understates itself: its per-frame number is
CPU submission, and the queue drain after the three hundred frames is **579 ms**
on the forest, which is another ~1.9 ms a frame of GPU work that had not
finished. Classic and node/WebGL2 drain in 0.0 ms because they have no queue to
drain. **Corrected for both, the forest is roughly 7.4 ms against roughly 3 ms.**
Still the largest single performance difference measured on this migration.

**Where the difference is, measured rather than assumed.** The two families that
mount a post chain are the two with the gap; the ocean, which mounts none on
either path, agrees to within 0.3 ms on every leg. So this is the cost of
`postprocessing`'s `EffectComposer` against three's `RenderPipeline`, not of
`WebGLRenderer` against `Renderer`.

**The worst frames are the other finding, and they belong to the classic path.**
A 496 ms frame on the universe and a 236 ms frame on the forest, one per run,
against a worst of 3.7 ms on node/WebGL2. One frame in three hundred is not a
frame rate problem, it is a visible hitch, and the instrument that would have
found it did not exist until now.

**A defect in the instrument, named rather than worked around.** On the two
node/WebGL2 cells that mount the post chain, the draw accounting reports "2
calls, 2 triangles" — a bare composite — where the WebGPU leg of the same
fixture reports 173 calls over 6.5M triangles. The ocean's node/WebGL2 cells,
which mount no chain, account correctly. So `info` on that backend does not
accumulate across a chained frame the way `autoReset = false` promises. **This
is a hole in the instrument, not a claim about the scene**: §26 Phases 5 and 10
already photographed those legs and found them within 0.44 and 1.31 of 255 of
the WebGPU leg, so they are drawing the forest. Two of twelve cells therefore
have timings that can be trusted and draw counts that cannot.

---

## 4. Stage 2 — Particle integration on the GPU

**Gate: SHUT until Stages 0 and 1 are done.** This is the first stage that is a
graphics change rather than an instrument, and it is the one §15.2 already
picked out: *"Defer. Real upside, no parity requirement broken, but not phase
one."*

**The candidates, and they are chosen by what they cost today rather than by
what would be fun to move:** the ocean's three marine-snow layers plus the
bioluminescent fourth, the bubbles, and the forest's weather. Each is a large
instanced population whose per-frame positions are integrated on the CPU and
uploaded.

**The design constraint that decides the shape.** This app's determinism is not
a preference: the same seed must produce the same scene on any device, and
`oceanRigFaunaBehavior.test.ts` and `forestMath.test.ts` are the reason that
holds. So **spawn stays on the CPU, seeded, tested** — only the integration
moves. A particle whose starting state is seeded and whose motion is a pure
function of elapsed time and that state is reproducible on the GPU; a particle
whose motion depends on the order the GPU happened to schedule it is not, and
none of these needs to.

**The fallback is not hypothetical and must be measured, not assumed.** §15.1 is
the surprising part of that section: three's WebGL backend implements
`createComputePipeline` through `transformFeedbackVaryings`, so a TSL compute
node is not automatically a WebGPU-only feature. What is UNVERIFIED is whether
the transform-feedback path is *fast enough to be worth having* — and roughly a
fifth of visitors are on it. A stage that improves the WebGPU leg and regresses
the WebGL2 leg has not improved this app.

**Done means:** Stage 1's percentiles improve on the WebGPU leg, do not regress
on the WebGL2 leg, and `scene-parity.spec.ts` is unmoved on all three ocean
fixtures.

---

## 5. Stage 3 — One linear HDR buffer for the additive layers

**Gate: SHUT until Stage 0. Independent of Stages 1 and 2.**

**This is the stage with a real picture behind it, and the ocean's 9.90 of 255
is the argument for it.** Phase 8 established what that number is: the two paths
composite additive light in different spaces. The classic path adds a linear
quantity to an sRGB-encoded backdrop; the node path adds it in linear and
encodes once. §26's own arithmetic showed no compensating scalar exists — the
correction `r' = r / E'(b)` varies from 2.54 to 1.12 across one shaft — so the
god rays were ported faithfully and the difference stated.

**The node path's model is the physically correct one.** That is the finding to
build on rather than tune away: light adds in linear. What it is missing is the
headroom to add into. Today the ocean renders straight to the canvas with no
composer, so every additive layer is clipping against an 8-bit target before the
tone curve ever sees it.

**What WebGPU changes about that.** `rgba16float` render targets are ordinary on
this path rather than an extension dance, and the node post chain already owns
its own buffers (§26 Phase 5). The upgrade is: render the ocean's additive
layers into a float target, tone-map once at the end, and let the roll-off do
what the shader's own comment history says two rounds of hand-tuning were
reaching for — the strength halved to 1.05 and put back to 2.2, a 0.62 ceiling
added and then removed "once the renderer's ACES was back to do the roll-off
properly".

**Corrected 2026-09-18 — see §0, items 3 and 4.** Two things this section said
were wrong, and both made the stage look harder than it is.

The float buffer is **not** a new capability to introduce: `Renderer` defaults
`outputBufferType` to `HalfFloatType` and `PassNode` stamps its render target
from `getOutputBufferType()`, so the universe and the forest have composited in
linear half-float since Phase 5. **The ocean is the only family without one**,
and only because `UniverseCanvas` mounts no chain for it.

And the reason it mounts no chain — "a frame-wide pass cannot read the per-depth
`toneMappingExposure`" — is false on this path. `toneMappingExposure` is
`rendererReference( 'toneMappingExposure', 'float' )`: a uniform that tracks the
renderer property `oceanRig.ts` sets once per rig build. `NodePostEffects.tsx`
already uses it, with a comment saying it must keep working "if this chain ever
serves that family". The blocker is real for `postprocessing`@6.39.4 and was
inherited from it without rechecking.

**So the design is smaller than the stage as written.** Either give the ocean a
minimal node chain — a scene pass and the tone-map node it already has — or
pass `outputType: HalfFloatType` to the renderer, which configures the CANVAS
as `RGBA16Float` with an extended tone-mapping mode and adds no fullscreen
buffer at all. The second has not been tried and is one constructor argument.

**What it must still not break.** The ocean's grade was designed and measured
against three's own ACES at a per-depth exposure. Any chain that serves it must
apply exactly that curve at exactly that exposure, and the parity harness is
what says whether it did.

**Done means:** the ocean's node-vs-classic number is explained rather than
smaller — a look decision the owner has seen, with both frames side by side in
`demos/`.

---

## 6. Stage 4 — The surfacing the scenes already paid for and were not getting

**Gate: OPEN, and it needed no WebGPU at all. Every visitor gets this today, on
both renderer paths.** It is in this document because an audit run for WebGPU
upgrades kept finding things that were simply wrong, and a plan that lists
screen-space reflections while two animals render as chrome is a plan with its
priorities inverted.

**Built 2026-09-18** on branch `feat/fe/webgpu-graphics-upgrade`:

| Defect | What a visitor saw | Fix |
| --- | --- | --- |
| `animal-bear.glb` and `animal-boar.glb` surface only through `KHR_materials_pbrSpecularGlossiness`, which three 0.185.1 does not implement | a white, fully metallic, mirror-rough bear and boar — 2 of the 8 forest animals | converted to metallic-roughness by `scripts/convertSpecularGlossinessModels.mjs`; the committed WebP diffuse maps were already inside the files |
| every tree, decor mesh, landmark and animal had `receiveShadow = false` | nothing in the forest self-shadowed: a trunk in its own canopy's shadow was lit as if in the open | `receiveShadow` on, everywhere the shadow camera reaches |
| every texture arriving inside a `.glb` kept `anisotropy = 1` | bark and leaf cards smeared into grey mips at walking distance | `applyLoadedModelTextureQuality` in the one model walk they all pass through |
| the forest ground's normal and ARM maps were loaded with `useTexture` and never touched | the largest surface in the family, seen almost entirely at grazing angles, dissolving a few metres out | the same helper, which had existed since the planets were sharpened and was called only from `solar-system/` |
| the shared ripple normal map set `minFilter = LinearFilter` | three allocates no mips at all, so a 256px scrolling normal map fed a specular highlight from level 0 at every distance — crawling sparkle on the pond and the river | `LinearMipmapLinearFilter` |

**The ratchet that keeps them fixed.** `committedModelAssets.test.ts` reads
three's own `EXTENSIONS` map out of the installed `GLTFLoader.js` and fails if
any committed model REQUIRES an extension that map does not contain. It was run
against the unconverted bear and fails on it, which is the only evidence that a
passing test means anything.

**Still open in this stage, and both are the ocean's:**

- **Ocean fauna have no material maps at all**, and `oceanRigFauna.ts` deletes
  `uv`, `uv1`, `uv2` and `tangent` from every geometry it merges — so a normal
  or roughness map could not be sampled even if one were added. Thirteen of the
  sixteen models ship zero images. The code already names the symptom
  (`oceanRig.ts:778`, "this is why the giant Pacific octopus rendered with zero
  visible texture") and works around it by assigning `emissiveMap = map`.
- **The 58 GLBs were produced under three incompatible compression policies**
  and no pipeline is committed, so "re-export the ocean fauna with maps" has no
  reproducible command behind it yet.

---

## 7. Stage 5 — The effects the node path actually unlocks

**Gate: SHUT until Stage 1. Every item here is a frame-time claim.**

three 0.185.1 ships an effect library that only the node path can use —
`three/addons/tsl/display/` — and the app currently mounts eight of about forty
nodes. These are the ones an audit of the three families picked out, ranked by
how much they change what a person sees. **None is a small change**, and each
one's WebGL2 answer has to be measured rather than reasoned about, because a
per-pixel raymarch is free on WebGPU and is not free on the backend a fifth of
visitors get.

| Upgrade | What changes | Node | Risk |
| --- | --- | --- | --- |
| **God rays occluded by the trees** (`GodraysNode`) | the forest's sun shafts are six additive billboards today and pass through trunks; this makes them a shadow-aware raymarch broken up by the canopy the shadow map already holds | `display/GodraysNode.js` | needs the main light casting shadows, which the forest already does; 64-step march on WebGL2 is the question |
| **Temporal antialiasing** (`TRAANode`) | the only item on this list that probably BUYS frame time: it replaces the multisampling Phase 9 wired into the constructor, and an 8x-resolved target is the largest per-pixel cost in the frame | `display/TRAANode.js` | ghosting on the fast-moving layers — the ocean's drifters and the forest's weather |
| **Screen-space reflections on water** (`SSRNode`) | the app has no scene reflections of any kind; the pond, the river and the sea surface all fake it | `display/SSRNode.js` | grazing-angle only, or it reads as a mirror floor |
| **Translucent foliage and jellyfish** | backlit leaves and drifting bells are the two places subsurface scattering is the whole look, and both are luminance remaps today | `MeshSSSNodeMaterial` — **not** `display/SSSNode.js`, which is a screen-space denoiser and not subsurface scattering | a per-material change, so it has to survive the parity harness |
| **Lens flare on the sun** (`LensflareNode`) | the universe family's bloom already selects the sun; a flare is what the frame is missing | `display/LensflareNode.js` | taste — it is the one item here that can look cheap |
| **Planet atmosphere** | a scattering rim shell the solar family does not have | app-side TSL | none beyond cost |
| **Clustered lighting** (`ClusteredLightsNode`) | the only item found that the WebGL2 backend genuinely cannot have | `lighting/ClusteredLightsNode.js` | splits the two backends' look, which Architecture A exists to avoid |

**The rule for this stage, and it is the one Phase 13 learned the hard way:**
an effect that improves the WebGPU leg and regresses the WebGL2 leg has not
improved this app. Every row above gets three legs and a percentile, or it does
not ship.

---

## 8. Stage 6 — The asset pipeline, which is where the first mount actually goes

**Gate: OPEN for the measurement, SHUT for the change until Stage 1.**

**The 8K JPEGs are the real owner of §24.1's 1121 ms.** `8k_earth_daymap.jpg`
is 4.4 MB on disk and 8192x4096x4 = **134 MB of RGBA once decoded**, and the
solar-system catalogue holds several. KTX2/BasisU would upload them
GPU-compressed with mipmaps and no decode at all — and three 0.185.1 already
ships `KTX2Loader`, the Basis transcoder (`examples/jsm/libs/basis/`) and an
explicit WebGPU branch, while drei ships the `Ktx2` wrapper. The decoder would
be self-hosted exactly as the DRACO one already is, for the CSP reason
`modelDecoders.ts` documents.

It is not free: ETC1S on disk is larger than a well-compressed JPEG, so this
trades download bytes for GPU bytes and a stall. **That trade needs the
measurement Stage 1 produces**, and it is the clearest case on this list of a
change that is obviously right in GPU terms and not obviously right in total.

**Also open here, and cheaper:** there is no LOD of any kind in the app, and the
repo already contains the low-detail asset that would prove it out
(`tree-fir-distant.glb` beside `tree-fir-realistic.glb`).

---

## 9. What this plan deliberately does not propose

Each of these has been considered and rejected, with the reason, so that a later
reader finds an argument rather than an omission.

| Not proposed | Why |
| --- | --- |
| **GPU frustum / occlusion culling** | The ocean disables frustum culling today, on purpose. Turning it back on in a different place changes what is drawn, which is a behaviour change dressed as an optimisation (§15.2). |
| **FFT ocean instead of analytic Gerstner** | A redesign, not an upgrade. The sea state, optics and depth curve are pure TypeScript with tests behind them, and replacing the wave model throws that away to buy detail nobody has asked for (§15.2). |
| **Moving creature behaviour to compute** | Seeded, unit-tested, and the determinism it guarantees is a product property. §15.2 says avoid; nothing since has changed that. |
| **Procedural texture generation on the GPU** | Still not proposed, but **the reason given here was wrong** (§0). The 1121 ms of `texSubImage2D` is the solar-system family's committed 8K JPEGs; the largest procedural bake in the repo is 1024x512. The honest reason is that the bakes are one-time, seeded and unit-tested, and moving them to the GPU trades that for a saving nobody has measured. The 8K JPEGs are a separate and better target — see Stage 4. |
| **A percentage-based rollout** | Decided in Phase 12 and re-affirmed here: it needs a stable per-visitor identifier, and this app deliberately has none. That absence is what lets an unauthenticated browser POST into the platform's own numbers. |
| **Retiring `WebGLRenderer`** | Not while the classic path is what every visitor renders through. `WebGLRenderer` is not deprecated anywhere in r171–r186, so the fallback is not on borrowed time and there is no deadline forcing this. |

---

## 10. The three decisions this plan closes

Presented for approval at the end of Phase 12 and decided on 2026-09-17, with
the owner's instruction to decide them rather than hold them.

**1. The god rays keep the faithful port, and the difference is documented
rather than corrected.** Accepted. No compensating scalar exists — this is
arithmetic, not taste — and a constant chosen to make one measurement agree is
an invented lever dressed as physics. The lever if the classic look is wanted
back is `GOD_RAY_STRENGTH_MULTIPLE`, one number, and it moves both paths.
Stage 3 is where the difference gets addressed properly.

**2. A lost `GPUDevice` falls back to `WebGPURenderer` + `forceWebGL`, not to
`WebGLRenderer`.** Accepted. It keeps one renderer class and one shader source,
a lost device says nothing about WebGL2, and it is a configuration with real
traffic on it rather than a stub reached only by accident. Phase 13 also removes
the one argument against it: the WebGL2 backend's first-mount cost.

**3. No percentage-based rollout.** Accepted, and recorded in §6 above as a
standing decision rather than a phase-local one.

---

## 11. What this document does not prove

- **No stage below Stage 1 has a measurement.** Every performance claim here is
  a prediction with a named gate in front of it, and the gate exists because the
  instrument does not.
- **One machine.** Every number in §1 is an RTX 4060 Laptop under ANGLE/D3D11
  with a cold shader cache on every page. The WebGPU/WebGL2 split those numbers
  are weighted by is still §19.5's estimate until the flag goes on and the
  analytics field Phase 12 shipped starts answering.
- **Field defect reports for `WebGPURenderer` at production scale remain
  ungathered** (§28.3 item 4), and cannot be gathered from this machine. That is
  an argument for turning the flag on and reading the failure counts, not an
  argument for any stage above.
- **Stage 5's table is a reading of three's source, not of its behaviour.** Every
  node named there was confirmed to exist in the installed 0.185.1 with the
  signature claimed. Not one has been run in this app. §30.2 of the migration
  report is the standing warning about exactly that distinction: `sizeNode` and
  `pointUV` are both present in the export list and both do nothing, and the
  only way that was found was by running them.
- **Stage 4's five fixes are verified mechanically and not photographically.**
  The unit ratchet proves the bear is no longer asking for an extension three
  cannot read; it does not prove the bear looks like a bear. That is what the
  re-taken shoot is for, and it is the reason the shoot is part of "done" in
  `agents/frontend-agent.md` rather than optional.

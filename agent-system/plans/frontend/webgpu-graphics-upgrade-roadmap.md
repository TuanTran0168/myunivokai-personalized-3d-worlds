# WebGPU graphics upgrade roadmap — what the node path makes possible, and in what order

> **Document status:** Active plan, nothing below is built
> **Written:** 2026-09-17, branch `feat/fe/webgpu-migration-phase-13`
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

## 1. The state this plan starts from

Everything in this section is measured, and each number names where.

| Property | Where it stands | Source |
| --- | --- | --- |
| Renderer | `WebGPURenderer`, two backends, one node graph | §26 Phase 9 |
| Rollout flag | `NEXT_PUBLIC_NODE_RENDERER`, **off** | §26 Phase 12 |
| Visual parity vs `WebGLRenderer` | universe **12.22**, forest **19.49**, ocean **9.90** of 255 | §26 Phases 8, 10 |
| Fallback vs primary | universe 0.44, forest 1.31, ocean 0.02 of 255 | §26 Phases 4, 5 |
| First mount, blocked main thread | node/WebGPU below classic everywhere; node/WebGL2 now below it on three fixtures of four | §26 Phases 11, 13 |
| The forest on node/WebGL2 | **13.6 s blocked against the classic renderer's 3.6 s**, and precompiling the pipelines barely moved it | §26 Phase 13 |
| Canvas readback | **broken on both node backends** — `preserveDrawingBuffer` does not exist there | §26 Phase 9 |
| Steady-state frame rate on the node path | **never measured** | §26 Phase 11 |
| GPU compute in the app | none | §15 |

Two of those rows are the whole reason this document is ordered the way it is.
The readback is what keeps the flag off, so nothing below reaches a visitor
until it is fixed. And the missing frame rate is what makes every performance
claim below unfalsifiable until Stage 1 exists.

---

## 2. Stage 0 — Stop reading the canvas (the rollout's only named blocker)

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

**The fix is to render the picture instead of scraping it.** An offscreen render
target, drawn on demand, read back with `readRenderTargetPixelsAsync` — which
exists on both `WebGLRenderer` and the node `Renderer`, so it is one
implementation for both paths and is more robust than `preserveDrawingBuffer`
ever was.

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

## 3. Stage 1 — A sustained-load harness (the instrument every later stage needs)

**Gate: open. Independent of Stage 0 and can run beside it.**

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

**What it costs and what it must not break.** Two fullscreen float buffers on a
family that deliberately has none, on a path where the per-depth
`toneMappingExposure` **is** the adaptation curve and a frame-wide pass cannot
read it. That last point is not a detail — it is the documented reason the ocean
bypasses the composer at all, and any design that does not answer it is wrong
before it is written.

**Done means:** the ocean's node-vs-classic number is explained rather than
smaller — a look decision the owner has seen, with both frames side by side in
`demos/`.

---

## 6. Stage 4 — What this plan deliberately does not propose

Each of these has been considered and rejected, with the reason, so that a later
reader finds an argument rather than an omission.

| Not proposed | Why |
| --- | --- |
| **GPU frustum / occlusion culling** | The ocean disables frustum culling today, on purpose. Turning it back on in a different place changes what is drawn, which is a behaviour change dressed as an optimisation (§15.2). |
| **FFT ocean instead of analytic Gerstner** | A redesign, not an upgrade. The sea state, optics and depth curve are pure TypeScript with tests behind them, and replacing the wave model throws that away to buy detail nobody has asked for (§15.2). |
| **Moving creature behaviour to compute** | Seeded, unit-tested, and the determinism it guarantees is a product property. §15.2 says avoid; nothing since has changed that. |
| **Procedural texture generation on the GPU** | The 2D-canvas bakes are one-time and measured. §24.1 attributes 1121 ms of the forest's remount to `texSubImage2D` uploading them — that is an upload cost, and generating them on the GPU does not remove an upload, it moves it. |
| **A percentage-based rollout** | Decided in Phase 12 and re-affirmed here: it needs a stable per-visitor identifier, and this app deliberately has none. That absence is what lets an unauthenticated browser POST into the platform's own numbers. |
| **Retiring `WebGLRenderer`** | Not while the classic path is what every visitor renders through. `WebGLRenderer` is not deprecated anywhere in r171–r186, so the fallback is not on borrowed time and there is no deadline forcing this. |

---

## 7. The three decisions this plan closes

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

## 8. What this document does not prove

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

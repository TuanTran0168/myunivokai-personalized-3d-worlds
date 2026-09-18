import { isNodeRenderer } from "./nodeMaterials";

/**
 * THE ONE LINE THAT DECIDES WHETHER EITHER NODE BACKEND COMPILES ITS PIPELINES
 * ASYNCHRONOUSLY, AND THE APP WAS NOT CALLING IT.
 *
 * §26 Phase 13. Phase 11 measured the first mount on three renderers and found
 * one number going the wrong way — main-thread time BLOCKED during a first
 * mount, in milliseconds:
 *
 *     fixture              WebGLRenderer   node/WebGL2   node/WebGPU
 *     universe                   2410          2547          1046
 *     forest                     3596         14660           890
 *     ocean, underwater          1069          4947           734
 *     ocean, above water          203           257           144
 *
 * §24.3 predicted the shape of that column — "pipeline creation could be WORSE
 * for a scene with many distinct materials" — and §17 names it as the one
 * finding that could still force Architecture B, because the WebGL2 backend is
 * what roughly a fifth of visitors get. What neither section knew is that the
 * measurement was taken on three.js's SYNCHRONOUS pipeline path, on both
 * backends, and that taking the other one is a single call.
 *
 * # Read from three's own source rather than from its documentation
 *
 * `Renderer.compileAsync()` (`three.webgpu.js:60065`) assigns
 * `this._compilationPromises = compilationPromises` and swaps
 * `_handleObjectFunction` for `_createObjectPipeline`. That array is the only
 * thing either backend tests:
 *
 *   WebGPU  `:82515` `if ( promises === null )` → `device.createRenderPipeline`,
 *           which blocks. The `else` at `:82535` → `createRenderPipelineAsync`.
 *   WebGL2  `:72602` `if ( promises !== null && this.parallel )` → poll
 *           `COMPLETION_STATUS_KHR` from `requestAnimationFrame` until the link
 *           finishes. Otherwise `_completeCompile` runs inline, and reading a
 *           link status inline is what stalls the thread.
 *
 * `this.parallel` is `extensions.get( 'KHR_parallel_shader_compile' )`
 * (`:71353`). So on the node path the extension is present, three supports it,
 * and **it is unreachable except through `compileAsync`** — `render()` leaves
 * `_compilationPromises` null, which is the sole reason the WebGL2 column above
 * is four times the classic renderer's.
 *
 * # This is not the `compileAsync` that was tried before and did nothing
 *
 * `agent-system/agents/frontend-agent.md` records that "`compileAsync` was
 * tried and does nothing on this project's driver". That was
 * `WebGLRenderer.compileAsync` (`three.module.js:17472`), a different class with
 * a different implementation, and the note stands for the classic path — which
 * is every visitor while the rollout flag is off. Nothing here changes that
 * path: `rendererCompilesPipelinesAsynchronously` returns false for a renderer
 * with no `backend`, which is exactly how `nodeMaterials.ts` identifies the
 * classic renderer.
 *
 * # What it buys, and what it does not
 *
 * It moves work OFF the main thread. It does not remove the work: the same
 * pipelines are built, and wall-clock to the first frame can be the same or
 * slightly longer. That distinction is the whole point of the unit Phase 11
 * chose — a visitor feels a frozen tab, not a slow one — and it is why the
 * canvas holds its frames until this resolves rather than racing it. A frame
 * drawn mid-warm-up would create its own pipelines through `render()`, with
 * `_compilationPromises` back to null, and pay the synchronous cost after all.
 */

/**
 * How long the canvas will hold its first frame waiting for the warm-up.
 *
 * Ten seconds, against a measured worst case of 14.7 s of BLOCKED time on the
 * slowest fixture — deliberately shorter than the thing it is replacing,
 * because a warm-up that has not finished by then has stopped being an
 * optimisation and become a blank screen. On the timeout the frames start
 * anyway and the pipelines are built the old way, one at a time, as each object
 * is first drawn. The visitor gets the behaviour they had before this file
 * existed rather than a canvas that never arrives.
 */
export const NODE_PIPELINE_WARM_UP_CEILING_MILLISECONDS = 10_000;

/** `compileAsync` resolved: every pipeline in the first frame is already built. */
export const NODE_PIPELINE_WARM_UP_COMPILED = "compiled";
/** The ceiling was reached first. Frames start; three builds them as it goes. */
export const NODE_PIPELINE_WARM_UP_TIMED_OUT = "timed-out";
/** `compileAsync` rejected. Same recovery as the timeout, and worth counting separately. */
export const NODE_PIPELINE_WARM_UP_FAILED = "failed";
/** Not a node renderer, so there is no asynchronous pipeline path to take. */
export const NODE_PIPELINE_WARM_UP_SKIPPED = "skipped";

export type NodePipelineWarmUpOutcome =
  | typeof NODE_PIPELINE_WARM_UP_COMPILED
  | typeof NODE_PIPELINE_WARM_UP_TIMED_OUT
  | typeof NODE_PIPELINE_WARM_UP_FAILED
  | typeof NODE_PIPELINE_WARM_UP_SKIPPED;

export type NodePipelineWarmUpReport = {
  outcome: NodePipelineWarmUpOutcome;
  /** Wall-clock spent in the warm-up, rounded. Zero when it was skipped. */
  milliseconds: number;
};

/** The shape `compileAsync` is called through, so nothing here imports `three/webgpu`. */
type RendererWithAsynchronousCompile = {
  compileAsync?: (scene: unknown, camera: unknown) => Promise<unknown>;
};

/**
 * Whether this renderer has an asynchronous pipeline path worth taking.
 *
 * Two questions, and both are asked of the INSTANCE rather than of the flag
 * that built it — the distinction `nodeMaterials.ts` and
 * `ParityHarnessBridge.describeBackend` both make, for the reason Phase 0
 * recorded: a `WebGPURenderer` whose `init()` rejects becomes a WebGL2 renderer
 * silently, and code that trusted the request would be wrong for exactly the
 * population §19.5 exists to count. Here both answers lead to the same place —
 * `WebGPURenderer` has `compileAsync` on either backend — but asking the
 * instance is what keeps that true when it stops being true.
 *
 * `WebGLRenderer` also has a `compileAsync`, and this returns false for it on
 * purpose. See the header: that one is a different implementation on a class
 * with no `backend`, and it was measured to do nothing on this driver.
 */
export function rendererCompilesPipelinesAsynchronously(renderer: unknown): boolean {
  return isNodeRenderer(renderer) && typeof (renderer as RendererWithAsynchronousCompile).compileAsync === "function";
}

/**
 * Runs a pipeline warm-up under a ceiling and reports how it ended.
 *
 * Takes the compile as a function rather than a renderer so the policy — the
 * ceiling, the three endings, the rounding — can be tested without a GPU. The
 * losing side of the race is not cancelled, because there is nothing to cancel:
 * `compileAsync` has no abort, and the pipelines it is building are the ones the
 * renderer is about to want either way. The timer IS cleared, so a resolved
 * warm-up does not keep a ten-second handle alive on a page that has moved on.
 */
export async function warmUpNodePipelines(
  compilePipelines: () => Promise<unknown>,
  ceilingMilliseconds: number = NODE_PIPELINE_WARM_UP_CEILING_MILLISECONDS
): Promise<NodePipelineWarmUpReport> {
  const startedAt = performance.now();
  let ceilingTimer: ReturnType<typeof setTimeout> | undefined;
  const ceilingReached = new Promise<NodePipelineWarmUpOutcome>((resolve) => {
    ceilingTimer = setTimeout(() => resolve(NODE_PIPELINE_WARM_UP_TIMED_OUT), ceilingMilliseconds);
  });
  let outcome: NodePipelineWarmUpOutcome;
  try {
    outcome = await Promise.race([
      compilePipelines().then(() => NODE_PIPELINE_WARM_UP_COMPILED as NodePipelineWarmUpOutcome),
      ceilingReached
    ]);
  } catch {
    // A rejected compile is not a reason to withhold the scene. Three has
    // already logged whatever it could not build, and the render path will try
    // again object by object.
    outcome = NODE_PIPELINE_WARM_UP_FAILED;
  } finally {
    clearTimeout(ceilingTimer);
  }
  return { outcome, milliseconds: Math.round(performance.now() - startedAt) };
}


/**
 * THE SCENE PASS, HANDED FROM THE POST CHAIN TO THE WARM-UP, AND THE REASON IT
 * HAS TO BE.
 *
 * `renderer.compileAsync( scene, camera )` builds pipelines for the render context
 * the renderer is in WHEN IT IS CALLED. A render object is cached under its
 * context (`Renderer._objects.get( object, material, scene, camera, lightsNode, renderContext, clippingContext )`),
 * and the context itself under its render target and MRT
 * (`this._renderContexts.get( renderTarget, this._mrt )`, `three.webgpu.js:60094`).
 * A scene compiled against the canvas and then DRAWN into a pass's target is a
 * different render object with a different pipeline, so the warm-up builds one
 * set and the first frame builds another.
 *
 * three knows this and says so in the one place it matters —
 * `PassNode.compileAsync`'s own doc comment (`three.webgpu.js:40913`): *"this method must
 * be called after the pass configuration is complete. So calls like setMRT()
 * and getTextureNode() must proceed the precompilation."* Its body sets the
 * pass's render target and MRT, compiles, and puts both back.
 *
 * So on a family that mounts the node post chain, the warm-up has to go through
 * the pass rather than through the renderer, and only `NodePostEffects` has the
 * pass. It is announced here rather than passed down a prop because the two
 * components are SIBLINGS inside the canvas, and the chain is built
 * asynchronously — three dynamic imports — so the pass does not exist yet when
 * the warm-up's effect runs. A promise is the honest shape for "it will be
 * there"; the ceiling in `warmUpNodePipelines` is what makes it safe for it never
 * to be.
 */
export type ScenePassForWarmUp = { compileAsync: (renderer: unknown) => Promise<unknown> };

let announcedScenePass: ScenePassForWarmUp | null = null;
let scenePassWaiters: ((scenePass: ScenePassForWarmUp) => void)[] = [];

/** Called by the post chain once its scene pass is configured. */
export function announceScenePassForWarmUp(scenePass: ScenePassForWarmUp): void {
  announcedScenePass = scenePass;
  const waiters = scenePassWaiters;
  scenePassWaiters = [];
  for (const waiter of waiters) waiter(scenePass);
}

/**
 * Called by the post chain when it tears its pipeline down.
 *
 * Guarded on identity for the same reason `ParityHarnessBridge`'s cleanup is: a
 * canvas remount tears the old tree down before the new one mounts, so an
 * unguarded withdrawal lets a dying chain remove the live chain's pass.
 */
export function withdrawScenePassForWarmUp(scenePass: ScenePassForWarmUp): void {
  if (announcedScenePass === scenePass) announcedScenePass = null;
}

/** The announced scene pass, or a promise for the next one announced. */
export function scenePassForWarmUp(): Promise<ScenePassForWarmUp> {
  if (announcedScenePass) return Promise.resolve(announcedScenePass);
  return new Promise((resolve) => {
    scenePassWaiters.push(resolve);
  });
}

/**
 * The last warm-up this page ran, for the parity harness to read.
 *
 * Module-level rather than a `window` global, so nothing about this reaches a
 * production page that is not already importing the renderer it describes.
 * `ParityHarnessBridge` is the only reader, and it only exists in a build that
 * set `NEXT_PUBLIC_PARITY_HARNESS`.
 *
 * One canvas draws at a time, but two exist briefly during a remount, so a
 * dying canvas's warm-up can land after the new one has started. The value is a
 * diagnostic rather than a control — nothing branches on it — and
 * `first-mount-cost.spec.ts` reads it only after waiting for the second harness
 * registration, which is the same ordering that spec already relies on.
 */
let lastWarmUpReport: NodePipelineWarmUpReport | null = null;

export function recordNodePipelineWarmUp(report: NodePipelineWarmUpReport): void {
  lastWarmUpReport = report;
}

export function lastNodePipelineWarmUp(): NodePipelineWarmUpReport | null {
  return lastWarmUpReport;
}

/** Drops the record. **Tests and a fresh canvas only.** */
export function forgetNodePipelineWarmUp(): void {
  lastWarmUpReport = null;
}

/** Drops the announced scene pass and anyone waiting for one. **Tests only.** */
export function forgetScenePassForWarmUp(): void {
  announcedScenePass = null;
  scenePassWaiters = [];
}

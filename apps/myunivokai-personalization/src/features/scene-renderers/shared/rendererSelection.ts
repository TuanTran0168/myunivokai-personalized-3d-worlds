import {
  PARITY_RENDERER_WEBGL,
  PARITY_RENDERER_WEBGPU_FORCED_WEBGL,
  type ParityRenderer
} from "./parityHarness";

/**
 * WHICH RENDERER THIS CANVAS BUILDS — THE ONE POLICY DECISION, WRITTEN AS A
 * PURE FUNCTION SO IT CAN BE ARGUED WITH.
 *
 * §26 Phase 9 makes `WebGPURenderer` something a visitor can actually get, and
 * Phase 12 decides who. Three inputs, in strict order of precedence, and the
 * order is the interesting part:
 *
 *   1. the parity harness, which is the only caller allowed to name a renderer
 *   2. a lost `GPUDevice`, which is a failure this page has already survived
 *   3. the rollout flag
 *
 * # This function asks nothing about the hardware, and that is deliberate
 *
 * `webgpuSupport.ts` can tell you whether an adapter exists. It is not consulted
 * here, because §17 rejects "choose the renderer at runtime" by name: a manual
 * pre-flight is *"easy to get wrong"* against a fallback `WebGPURenderer`
 * installs in its own constructor and fires on `backend.init()` rejecting — the
 * one event that actually decides. Phase 0 measured a machine that reported a
 * fifteen-feature adapter and then refused the device; a pre-flight would have
 * answered "yes" on that row. **The renderer is chosen by policy, the backend is
 * chosen by three.**
 *
 * # Why there is no percentage rollout
 *
 * A staged rollout needs a stable bucket per visitor, which needs an identifier
 * that survives a reload. This app deliberately has none — `reportClientRender`
 * sends a tier, a family and an outcome, with no world id, no account id and no
 * session id, and that absence is what lets an unauthenticated browser POST
 * into the platform's own numbers at all. Minting an identifier so that a
 * percentage could be computed would put an identity into a system built not to
 * have one, to buy a gradualness that a boolean plus the analytics field from
 * §19.5 already provides: turn it on, read the WebGPU/WebGL2 split and the
 * failure counts, turn it off. That is the trade, stated rather than hidden
 * behind the word "flag".
 */

/** `WebGLRenderer` — the classic path, GLSL materials, the `postprocessing` chain. */
export const RENDERER_CHOICE_CLASSIC = "classic";
/** `WebGPURenderer` — node materials, the node post chain, backend chosen by three. */
export const RENDERER_CHOICE_NODE = "node";
/** `WebGPURenderer` pinned to its WebGL2 backend. Same materials, no WebGPU. */
export const RENDERER_CHOICE_NODE_FORCED_WEBGL = "node-forced-webgl";

export type RendererChoice =
  | typeof RENDERER_CHOICE_CLASSIC
  | typeof RENDERER_CHOICE_NODE
  | typeof RENDERER_CHOICE_NODE_FORCED_WEBGL;

/**
 * The variable's name, for messages only. **Never use it as the lookup key** —
 * `parityHarness.ts` records what happens when a `NEXT_PUBLIC_*` reference is
 * not statically analysable, and it happened in this repository: the browser
 * bundle ships `process.env` as `{}` and the flag is silently off in exactly
 * the build that set it.
 */
const NODE_RENDERER_ENVIRONMENT_VARIABLE_NAME = "NEXT_PUBLIC_NODE_RENDERER";

/** The variable a build has to set to put visitors on the node renderer. */
export function nodeRendererEnvironmentVariableName(): string {
  return NODE_RENDERER_ENVIRONMENT_VARIABLE_NAME;
}

/**
 * Whether this BUILD ships the node renderer to visitors.
 *
 * Off unless the variable is exactly `"1"`. Not "anything truthy": a deploy that
 * sets it to `"false"` or `"off"` meaning to disable it must not enable it, and
 * that is a more likely mistake than a deploy that sets it to `"true"` meaning
 * to enable it.
 */
export function nodeRendererIsEnabled(): boolean {
  // Statically analysable on purpose — see the note above.
  return process.env.NEXT_PUBLIC_NODE_RENDERER === "1";
}

export type RendererSelectionInputs = {
  /** The harness's request, or null in every build that is not the harness's. */
  harnessRenderer: ParityRenderer | null;
  /** `nodeRendererIsEnabled()`, passed in so this stays a pure function. */
  nodeRendererEnabled: boolean;
  /**
   * Whether a `GPUDevice` has already been lost on this page.
   *
   * One-way. A page that has lost a device once does not try WebGPU again for
   * its lifetime — MDN says many causes are transient and a fresh device can be
   * requested, but every resource made with the old one has to be rebuilt, and
   * that is the forest's instanced buffers, every `CanvasTexture` and
   * `DataTexture` upload, the GLTF geometry and the whole post chain. §18.3(b)
   * chooses the cheaper correct answer and so does this.
   */
  graphicsDeviceLost: boolean;
};

/**
 * Which renderer to build.
 *
 * **A lost device falls back to `WebGPURenderer` with `forceWebGL: true`, not to
 * `WebGLRenderer`**, and that is the one choice here worth defending. Three
 * reasons, in order of weight:
 *
 *   - It keeps Architecture A. One renderer class, one node graph, one shader
 *     source. Falling back to the classic renderer means the remounted scene
 *     rebuilds every material through the other implementation — the branch
 *     §17 calls the trap, reached at the worst possible moment.
 *   - **A lost `GPUDevice` says nothing about WebGL2.** They are different APIs
 *     on different code paths; the device was lost, not the GPU.
 *   - It is a configuration that ships anyway. Roughly 20% of visitors get the
 *     WebGL2 backend from the start (§19.5), so the fallback is a path with
 *     real traffic on it rather than a stub reached only by accident.
 */
export function rendererChoiceFor(inputs: RendererSelectionInputs): RendererChoice {
  if (inputs.harnessRenderer) {
    if (inputs.harnessRenderer === PARITY_RENDERER_WEBGL) {
      return RENDERER_CHOICE_CLASSIC;
    }
    return inputs.harnessRenderer === PARITY_RENDERER_WEBGPU_FORCED_WEBGL
      ? RENDERER_CHOICE_NODE_FORCED_WEBGL
      : RENDERER_CHOICE_NODE;
  }
  if (inputs.graphicsDeviceLost) {
    return RENDERER_CHOICE_NODE_FORCED_WEBGL;
  }
  return inputs.nodeRendererEnabled ? RENDERER_CHOICE_NODE : RENDERER_CHOICE_CLASSIC;
}

/** Whether this choice builds a `WebGPURenderer` at all. */
export function buildsNodeRenderer(choice: RendererChoice): boolean {
  return choice !== RENDERER_CHOICE_CLASSIC;
}

/** Whether this choice pins that renderer to its WebGL2 backend. */
export function forcesWebGLBackend(choice: RendererChoice): boolean {
  return choice === RENDERER_CHOICE_NODE_FORCED_WEBGL;
}

/**
 * A suffix for `canvasRemountKey`, so that changing the choice remounts.
 *
 * The renderer is created by the `gl` factory, which React calls once per
 * `<Canvas>`. Nothing about a renderer can change without a new canvas, so the
 * device-loss recovery is a remount or it is nothing — and the key is where a
 * remount is expressed in this component. Empty for the ordinary choice so that
 * no key changes for anybody until a device is actually lost.
 */
export function rendererRemountSuffix(choice: RendererChoice): string {
  return choice === RENDERER_CHOICE_NODE_FORCED_WEBGL ? "-forced-webgl" : "";
}

/**
 * The reason a `GPUDevice.lost` promise resolved without anything going wrong.
 *
 * `device.destroy()` resolves the same promise, and the renderer destroys its
 * device on dispose — which this app does on every canvas remount, and there is
 * one of those per world. Treating that as a failure would remount the canvas
 * onto the fallback the first time a visitor toggled an interest chip.
 */
export const GRAPHICS_DEVICE_LOST_REASON_DESTROYED = "destroyed";

/** Whether a resolved `GPUDevice.lost` is a real loss rather than a teardown. */
export function isUnexpectedDeviceLoss(reason: string | undefined): boolean {
  return reason !== GRAPHICS_DEVICE_LOST_REASON_DESTROYED;
}

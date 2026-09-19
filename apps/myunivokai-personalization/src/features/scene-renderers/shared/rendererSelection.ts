import {
  PARITY_RENDERER_WEBGL,
  PARITY_RENDERER_WEBGPU_FORCED_WEBGL,
  type ParityRenderer
} from "./parityHarness";
import { WEBGPU_ADAPTER_HARDWARE, type WebGPUAdapterAvailability } from "./webgpuSupport";

/**
 * WHICH RENDERER THIS CANVAS BUILDS — THE ONE POLICY DECISION, WRITTEN AS A
 * PURE FUNCTION SO IT CAN BE ARGUED WITH.
 *
 * §26 Phase 9 makes `WebGPURenderer` something a visitor can actually get,
 * Phase 12 decided who, and the 2026-09-19 rollout made it the default. Four
 * inputs, in strict order of precedence, and the order is the interesting part:
 *
 *   1. the parity harness, which is the only caller allowed to name a renderer
 *   2. the kill switch, which outranks device loss so that switching the node
 *      path off during an incident cannot be undone by a dying GPU
 *   3. a lost `GPUDevice`, which is a failure this page has already survived
 *   4. what `navigator.gpu` says, used as a veto and never as a promise
 *
 * # This function now asks about the hardware, and ONLY to say no
 *
 * It did not, until the rollout went on, and the reason it did not is written
 * out at length in `webgpuSupport.ts`. The short form: §17 rejects "choose the
 * renderer at runtime" because a pre-flight cannot PROMISE that WebGPU will
 * work — `requestDevice()` can reject after `requestAdapter()` succeeded, and
 * Phase 0 measured exactly that machine.
 *
 * **Nothing here treats the probe as a promise.** An answered `hardware` still
 * builds a `WebGPURenderer` and still leaves the fallback to three, exactly as
 * before. What the probe buys is the other answer: when there is no adapter at
 * all, the node renderer would land on its WebGL2 backend, and that backend
 * blocks the main thread for **13.6 s on the forest's first mount against the
 * classic renderer's 3.6 s** (§26 Phase 13). Refusing to ship that to the ~20%
 * of visitors who have no WebGPU is the entire purpose of the veto, and it is
 * sound in a way a promise would not be: an adapter that resolved null cannot
 * be followed by a device that succeeds.
 *
 * So: **the renderer is still chosen by policy and the backend is still chosen
 * by three.** The policy simply now includes a fact about the browser that the
 * app already pays for — `deviceQualityTier` has probed the adapter since
 * Phase 9, and `webgpuAdapterAvailabilityOnce()` is that same call, shared.
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

/** The variable a build sets to move visitors off the default rollout. */
export function nodeRendererEnvironmentVariableName(): string {
  return NODE_RENDERER_ENVIRONMENT_VARIABLE_NAME;
}

/** Classic renderer for everyone. The kill switch, and it outranks device loss. */
export const NODE_RENDERER_ROLLOUT_OFF = "off";
/** Node renderer wherever the browser actually has WebGPU. **The default.** */
export const NODE_RENDERER_ROLLOUT_WHERE_WEBGPU_IS_REAL = "where-webgpu-is-real";
/**
 * Node renderer for everyone, WebGL2 backend included. **The default since
 * 2026-09-19, by the owner's decision.**
 *
 * **WHAT THIS ACCEPTS, STATED PLAINLY BECAUSE IT IS MEASURED AND NOT A RISK.**
 * A browser with no WebGPU gets `WebGPURenderer` on its WebGL2 backend, and §26
 * Phase 13 measured that backend blocking the main thread for **13593 ms on the
 * forest's first mount against the classic renderer's 3596 ms**, and 2872 ms
 * against 1129 ms underwater. §19.5 puts roughly 20% of visitors there, and
 * says the real figure is likely worse for this product: caniuse weights global
 * traffic, this audience is Vietnam-skewed, and the in-app browsers a shared
 * universe link arrives through — Facebook, Instagram, TikTok, Zalo — are
 * WebView-backed and unverified.
 *
 * **WHAT IT BUYS.** One renderer for everybody. The classic path stops being a
 * second shipping implementation that has to be kept in visual step with this
 * one — which is what the 12.22 / 19.80 / 9.90 divergence between the two was
 * about — and every effect the node path unlocks reaches every visitor rather
 * than the WebGPU share of them.
 */
export const NODE_RENDERER_ROLLOUT_EVERY_VISITOR = "every-visitor";

export type NodeRendererRollout =
  | typeof NODE_RENDERER_ROLLOUT_OFF
  | typeof NODE_RENDERER_ROLLOUT_WHERE_WEBGPU_IS_REAL
  | typeof NODE_RENDERER_ROLLOUT_EVERY_VISITOR;

/**
 * Spellings of the variable that mean "turn this off".
 *
 * A list rather than one exact string, and the direction of the default is why.
 * While the rollout shipped OFF, the safe reading was "on only when the value is
 * exactly `1`", because a deploy that typed `false` meaning to disable it must
 * not accidentally enable it. **Flipping the default flips which typo is
 * dangerous**: the deploy that types something unrecognised now enables the
 * thing it meant to switch off. So every plausible way of writing "off" is
 * recognised, and the rest of the argument is unchanged.
 */
const ROLLOUT_VALUES_MEANING_OFF = ["0", "off", "false", "no", "disabled"];

/** The one spelling that opts a build back into the WebGPU-gated middle setting. */
const ROLLOUT_VALUE_MEANING_WHERE_WEBGPU_IS_REAL = "where-webgpu-is-real";

/**
 * WHICH ROLLOUT THIS BUILD SHIPS — and the default is `every-visitor`.
 *
 * **Unset means the node renderer for EVERY visitor, WebGL2 backend included.**
 * The owner took that decision on 2026-09-19, after being shown the cost it
 * buys and the cost it accepts, in those words: *set it, and if something
 * breaks we fix it*. What it accepts is written out in
 * `NODE_RENDERER_ROLLOUT_EVERY_VISITOR` and is not softened here.
 *
 * # Why this is a code default rather than a deployment variable
 *
 * It was set here rather than in `.env.local` because `.env.local` cannot reach
 * production. That file is committed, but it carries
 * `NEXT_PUBLIC_GATEWAY_BASE_URL=http://localhost:41800` — a value no deployed
 * build could be using — which proves the Vercel deployment overrides this
 * repository's env from its own dashboard. A rollout that lived in a file
 * production does not read would be a rollout that silently did not happen, and
 * `parityHarness.ts` records this project having shipped exactly that bug once
 * before.
 *
 * `.env.local` sets it too, to the same value, so that local development and
 * the Playwright build are explicit rather than relying on a default. The two
 * agreeing is deliberate; if they ever disagree, the variable wins and the
 * deployment is the one to check.
 *
 * # The escapes, in the order a person reaches for them
 *
 *   - any of `ROLLOUT_VALUES_MEANING_OFF` → the classic renderer for everyone.
 *     The kill switch. One environment variable and a rebuild of the frontend,
 *     no code change, no revert.
 *   - `where-webgpu-is-real` → the node renderer only where `navigator.gpu`
 *     reports a hardware adapter. **This was the default for the length of one
 *     commit** and is the middle setting: it keeps the WebGPU win and gives up
 *     the WebGL2 backend's first mount. It is what to reach for if
 *     `every-visitor` turns out to cost more than it is worth, before reaching
 *     for the kill switch.
 */
export function nodeRendererRollout(): NodeRendererRollout {
  // Statically analysable on purpose — see the note above. A `process.env[key]`
  // lookup reads `{}` in the browser bundle, and it has happened here before.
  const configured = process.env.NEXT_PUBLIC_NODE_RENDERER;
  if (configured === undefined || configured.trim() === "") {
    return NODE_RENDERER_ROLLOUT_EVERY_VISITOR;
  }
  const normalised = configured.trim().toLowerCase();
  if (ROLLOUT_VALUES_MEANING_OFF.includes(normalised)) {
    return NODE_RENDERER_ROLLOUT_OFF;
  }
  if (normalised === ROLLOUT_VALUE_MEANING_WHERE_WEBGPU_IS_REAL) {
    return NODE_RENDERER_ROLLOUT_WHERE_WEBGPU_IS_REAL;
  }
  // ANYTHING ELSE IS THE DEFAULT, INCLUDING `every-visitor` ITSELF AND THE OLD
  // `1`. The unrecognised value is the one worth thinking about: it now lands on
  // the most aggressive setting rather than the safest, which is the price of
  // making the default the aggressive one. It is paid down by
  // ROLLOUT_VALUES_MEANING_OFF accepting every plausible spelling of off, so the
  // typo that matters — someone trying to disable this in an incident — is the
  // one that still works.
  return NODE_RENDERER_ROLLOUT_EVERY_VISITOR;
}

export type RendererSelectionInputs = {
  /** The harness's request, or null in every build that is not the harness's. */
  harnessRenderer: ParityRenderer | null;
  /** `nodeRendererRollout()`, passed in so this stays a pure function. */
  rollout: NodeRendererRollout;
  /**
   * What `navigator.gpu` said, or **null while it has not answered yet**.
   *
   * Null is not "no WebGPU" — it is "nobody has asked, or the answer is still
   * in flight", and the difference decides whether a canvas may be built at
   * all. `rendererDecisionFor` reports that as `isDecided: false` rather than
   * guessing, because guessing here means building a renderer that cannot be
   * swapped without throwing the canvas away.
   */
  webgpuAdapter: WebGPUAdapterAvailability | null;
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
 * # A lost device recovers onto the CLASSIC renderer, and that REVERSED on 2026-09-19
 *
 * It used to recover onto `WebGPURenderer` with `forceWebGL: true`. §18.3(b)
 * gave three reasons; the argument is now made on one measurement instead.
 *
 * **THE REASONING HERE WAS REWRITTEN THE SAME DAY IT WAS WRITTEN, AND THE FIRST
 * VERSION IS WORTH ONE LINE.** It argued that the WebGL2 backend "ships to
 * nobody" after the rollout, which was true for the length of one commit —
 * while the default was `where-webgpu-is-real`. The owner then set the default
 * to `every-visitor`, which puts roughly 20% of visitors back on that backend,
 * and the premise died. The conclusion did not, so the conclusion is restated
 * from what survives rather than left standing on a dead reason.
 *
 * **WHAT SURVIVES IS THE NUMBER.** The WebGL2 backend blocks the main thread
 * for **13593 ms on the forest's first mount against the classic renderer's
 * 3596 ms** (§26 Phase 13). A page that has lost its `GPUDevice` is rebuilding
 * its canvas either way, so the choice is only WHICH rebuild — and answering a
 * dead GPU with this app's slowest possible remount, at the moment the visitor
 * is already looking at a broken scene, is the worst of the two.
 *
 * **AND THE CLASSIC RENDERER IS NOT A STUB**, which is the objection this has to
 * answer now that it ships to nobody by default. `scene-parity` pins it as the
 * baseline on every fixture of every run, so it is the most continuously
 * photographed renderer in this repository. Recovery lands on tested code.
 *
 * The two surviving §18.3(b) reasons are real and are outweighed: keeping
 * Architecture A costs a rebuild through the other implementation, and a lost
 * `GPUDevice` genuinely says nothing about WebGL2. Neither buys back ten
 * seconds.
 */
export type RendererDecision = {
  /** The renderer to build — or the safe one to fall back on if `isDecided` is false. */
  choice: RendererChoice;
  /**
   * Whether this answer can be acted on.
   *
   * False in exactly one case: the rollout is `where-webgpu-is-real` and the
   * adapter has not answered. The caller must hold the canvas rather than mount
   * `choice`, which is why `choice` is the CLASSIC renderer in that state — if
   * a caller ignores this field, it ships today's shipping renderer rather than
   * an unproven one.
   */
  isDecided: boolean;
  /**
   * Whether this choice is a recovery from a lost `GPUDevice`.
   *
   * Carried on the decision rather than left for the caller to remember,
   * because `rendererRemountSuffix` needs it: the recovery is now the CLASSIC
   * renderer, whose ordinary suffix is empty, so a suffix derived from the
   * choice alone would leave the remount key unchanged and the recovery would
   * never happen at all.
   */
  recoversFromDeviceLoss: boolean;
};

export function rendererDecisionFor(inputs: RendererSelectionInputs): RendererDecision {
  // The harness outranks everything, including the kill switch, because a build
  // that sets NEXT_PUBLIC_PARITY_HARNESS is not a build a visitor can reach.
  if (inputs.harnessRenderer) {
    if (inputs.harnessRenderer === PARITY_RENDERER_WEBGL) {
      return { choice: RENDERER_CHOICE_CLASSIC, isDecided: true, recoversFromDeviceLoss: false };
    }
    return {
      choice:
        inputs.harnessRenderer === PARITY_RENDERER_WEBGPU_FORCED_WEBGL
          ? RENDERER_CHOICE_NODE_FORCED_WEBGL
          : RENDERER_CHOICE_NODE,
      isDecided: true,
      recoversFromDeviceLoss: false
    };
  }
  // THE KILL SWITCH OUTRANKS DEVICE LOSS, and it is kept there deliberately
  // even though the case is currently unreachable. A build with the kill switch
  // on never creates a `WebGPURenderer`, so it has no `GPUDevice` to lose — but
  // the recovery below is the one branch that has already been reversed once,
  // and an incident switch that a future recovery target could outrank would be
  // a kill switch that does not kill. Ordering it here costs one comparison.
  if (inputs.rollout === NODE_RENDERER_ROLLOUT_OFF) {
    return { choice: RENDERER_CHOICE_CLASSIC, isDecided: true, recoversFromDeviceLoss: false };
  }
  // THE RECOVERY IS THE CLASSIC RENDERER, not the node renderer's WebGL2
  // backend. See this function's header for the reason that stopped being true.
  // It decides without the adapter because the adapter is irrelevant: this page
  // already had a device and lost it.
  if (inputs.graphicsDeviceLost) {
    return { choice: RENDERER_CHOICE_CLASSIC, isDecided: true, recoversFromDeviceLoss: true };
  }
  if (inputs.rollout === NODE_RENDERER_ROLLOUT_EVERY_VISITOR) {
    return { choice: RENDERER_CHOICE_NODE, isDecided: true, recoversFromDeviceLoss: false };
  }
  if (inputs.webgpuAdapter === null) {
    return { choice: RENDERER_CHOICE_CLASSIC, isDecided: false, recoversFromDeviceLoss: false };
  }
  // HARDWARE AND NOTHING ELSE — REACHED ONLY ON THE `where-webgpu-is-real`
  // SETTING, which is no longer the default. `software` is the trap worth
  // naming: Chrome falls back to SwiftShader for WebGPU on configurations where
  // WebGL is still hardware-accelerated, so an adapter that answers
  // `swiftshader` describes a machine that would render every node frame on the
  // CPU while the classic renderer it just left was using the GPU. `none` and
  // `absent` are the ~20% with no WebGPU at all.
  return {
    choice: inputs.webgpuAdapter === WEBGPU_ADAPTER_HARDWARE ? RENDERER_CHOICE_NODE : RENDERER_CHOICE_CLASSIC,
    isDecided: true,
    recoversFromDeviceLoss: false
  };
}

/**
 * Whether the page must wait for `navigator.gpu` before it can build a canvas.
 *
 * Derived from `rendererDecisionFor` rather than re-deriving the rule, so the
 * question "do we need the adapter?" and the question "what do we build?"
 * cannot drift apart — the second is the only definition of the first.
 */
export function rendererDecisionNeedsAdapterAnswer(
  inputs: Omit<RendererSelectionInputs, "webgpuAdapter">
): boolean {
  return !rendererDecisionFor({ ...inputs, webgpuAdapter: null }).isDecided;
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
 *
 * **IT READS THE DECISION AND NOT THE CHOICE, and that stopped being a detail on
 * 2026-09-19.** The recovery used to be `node-forced-webgl`, whose suffix is
 * distinctive, so keying on the choice was enough. The recovery is now the
 * CLASSIC renderer, whose suffix is empty — so a page that lost its device
 * while on the node renderer would produce the same key it already had, React
 * would keep the dead canvas, and the recovery would silently not happen.
 */
export function rendererRemountSuffix(decision: RendererDecision): string {
  if (decision.recoversFromDeviceLoss) {
    return "-recovered";
  }
  return decision.choice === RENDERER_CHOICE_NODE_FORCED_WEBGL ? "-forced-webgl" : "";
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

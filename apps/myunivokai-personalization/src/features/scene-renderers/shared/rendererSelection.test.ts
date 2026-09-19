import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PARITY_RENDERER_WEBGL,
  PARITY_RENDERER_WEBGPU,
  PARITY_RENDERER_WEBGPU_FORCED_WEBGL
} from "./parityHarness";
import {
  NODE_RENDERER_ROLLOUT_EVERY_VISITOR,
  NODE_RENDERER_ROLLOUT_OFF,
  NODE_RENDERER_ROLLOUT_WHERE_WEBGPU_IS_REAL,
  RENDERER_CHOICE_CLASSIC,
  RENDERER_CHOICE_NODE,
  RENDERER_CHOICE_NODE_FORCED_WEBGL,
  buildsNodeRenderer,
  forcesWebGLBackend,
  isUnexpectedDeviceLoss,
  nodeRendererRollout,
  rendererDecisionFor,
  rendererDecisionNeedsAdapterAnswer,
  rendererRemountSuffix
} from "./rendererSelection";
import {
  WEBGPU_ADAPTER_ABSENT,
  WEBGPU_ADAPTER_HARDWARE,
  WEBGPU_ADAPTER_NONE,
  WEBGPU_ADAPTER_SOFTWARE
} from "./webgpuSupport";
import { watchGraphicsDevice } from "./graphicsDeviceLoss";

/**
 * §26 Phase 9's one policy decision, the rollout that turned it on, and the
 * failure mode WebGL2 does not have.
 *
 * All pure enough to test without a GPU, which is the point of their being
 * separated from the canvas at all: CI has no WebGPU, so anything that could
 * only be checked by mounting a node renderer could not be checked here.
 */

const NO_HARNESS_ON_THE_DEFAULT_ROLLOUT = {
  harnessRenderer: null,
  rollout: NODE_RENDERER_ROLLOUT_WHERE_WEBGPU_IS_REAL,
  graphicsDeviceLost: false
} as const;

describe("rendererDecisionFor", () => {
  /**
   * **THE RELEASE PROPERTY.** On the default rollout, a browser that answers
   * with a real WebGPU adapter gets the node renderer with no flag set anywhere.
   * This is what "force bật WebGPU" means in code, and if it ever fails the
   * rollout has silently reverted to the classic renderer for everybody.
   */
  it("gives the node renderer to a browser with a real WebGPU adapter, with nothing configured", () => {
    expect(
      rendererDecisionFor({ ...NO_HARNESS_ON_THE_DEFAULT_ROLLOUT, webgpuAdapter: WEBGPU_ADAPTER_HARDWARE })
    ).toEqual({ choice: RENDERER_CHOICE_NODE, isDecided: true, recoversFromDeviceLoss: false });
  });

  /**
   * **THE SAFETY PROPERTY THAT REPLACED "THE FLAG SHIPS OFF".**
   *
   * A browser with no WebGPU would put a `WebGPURenderer` on its WebGL2
   * backend, which §26 Phase 13 measured at **13593 ms of blocked main thread
   * on the forest's first mount against the classic renderer's 3596 ms**. That
   * is the regression this veto exists to refuse, and it is roughly 20% of
   * visitors (§19.5).
   *
   * `software` is in this list for a separate reason worth keeping: Chrome
   * falls back to SwiftShader for WebGPU on machines where WebGL is still
   * hardware-accelerated, so shipping the node path there would move a visitor
   * from the GPU onto the CPU.
   */
  it("refuses the node renderer wherever WebGPU is absent, refused or software", () => {
    for (const webgpuAdapter of [WEBGPU_ADAPTER_ABSENT, WEBGPU_ADAPTER_NONE, WEBGPU_ADAPTER_SOFTWARE] as const) {
      expect(rendererDecisionFor({ ...NO_HARNESS_ON_THE_DEFAULT_ROLLOUT, webgpuAdapter })).toEqual({
        choice: RENDERER_CHOICE_CLASSIC,
        isDecided: true, recoversFromDeviceLoss: false
      });
    }
  });

  /**
   * **WHILE THE ADAPTER HAS NOT ANSWERED, NOTHING MAY BE BUILT.** A renderer is
   * created by the `gl` factory, once per `<Canvas>`, and cannot be changed
   * afterwards — so a canvas mounted during this state is a canvas that has to
   * be thrown away to correct it. The choice reported alongside is the CLASSIC
   * renderer on purpose: a caller that ignores `isDecided` ships today's
   * shipping renderer rather than an unproven one.
   */
  it("reports an undecided classic renderer while the adapter has not answered", () => {
    expect(rendererDecisionFor({ ...NO_HARNESS_ON_THE_DEFAULT_ROLLOUT, webgpuAdapter: null })).toEqual({
      choice: RENDERER_CHOICE_CLASSIC,
      isDecided: false,
      recoversFromDeviceLoss: false
    });
  });

  /**
   * **THE KILL SWITCH OUTRANKS DEVICE LOSS, AND ASKS NOTHING.** A deploy that
   * switches the node path off to stop an incident must not have it handed back
   * by a lost `GPUDevice` — whose recovery is the node renderer's WebGL2
   * backend, which is still the node path.
   */
  it("gives everyone the classic renderer under the kill switch, even after a lost device", () => {
    for (const graphicsDeviceLost of [false, true]) {
      for (const webgpuAdapter of [null, WEBGPU_ADAPTER_HARDWARE] as const) {
        expect(
          rendererDecisionFor({
            harnessRenderer: null,
            rollout: NODE_RENDERER_ROLLOUT_OFF,
            webgpuAdapter,
            graphicsDeviceLost
          })
        ).toEqual({ choice: RENDERER_CHOICE_CLASSIC, isDecided: true, recoversFromDeviceLoss: false });
      }
    }
  });

  /**
   * `every-visitor` is what the flag used to mean when set to `1`: the node
   * renderer whether or not WebGPU exists. It is kept because it is the only
   * way to measure the WebGL2 backend in a real deployment, and it decides
   * without waiting because there is nothing it would wait for.
   */
  it("gives the node renderer to everyone on the every-visitor rollout, without asking the adapter", () => {
    expect(
      rendererDecisionFor({
        harnessRenderer: null,
        rollout: NODE_RENDERER_ROLLOUT_EVERY_VISITOR,
        webgpuAdapter: null,
        graphicsDeviceLost: false
      })
    ).toEqual({ choice: RENDERER_CHOICE_NODE, isDecided: true, recoversFromDeviceLoss: false });
  });

  /**
   * THE HARNESS OUTRANKS EVERY ROLLOUT IN BOTH DIRECTIONS, and the second
   * direction is the one that matters: a build with the node renderer on must
   * still be able to photograph the CLASSIC renderer, or the parity suite loses
   * its baseline and compares the node path against itself.
   */
  it("lets the harness name the renderer whatever the rollout says", () => {
    for (const rollout of [
      NODE_RENDERER_ROLLOUT_OFF,
      NODE_RENDERER_ROLLOUT_WHERE_WEBGPU_IS_REAL,
      NODE_RENDERER_ROLLOUT_EVERY_VISITOR
    ] as const) {
      const shared = { rollout, webgpuAdapter: null, graphicsDeviceLost: false } as const;
      expect(rendererDecisionFor({ ...shared, harnessRenderer: PARITY_RENDERER_WEBGL })).toEqual({
        choice: RENDERER_CHOICE_CLASSIC,
        isDecided: true, recoversFromDeviceLoss: false
      });
      expect(rendererDecisionFor({ ...shared, harnessRenderer: PARITY_RENDERER_WEBGPU })).toEqual({
        choice: RENDERER_CHOICE_NODE,
        isDecided: true, recoversFromDeviceLoss: false
      });
      expect(rendererDecisionFor({ ...shared, harnessRenderer: PARITY_RENDERER_WEBGPU_FORCED_WEBGL })).toEqual({
        choice: RENDERER_CHOICE_NODE_FORCED_WEBGL,
        isDecided: true, recoversFromDeviceLoss: false
      });
    }
  });

  /**
   * **A LOST DEVICE RECOVERS ONTO THE CLASSIC RENDERER, AND THIS REVERSED ON
   * 2026-09-19.**
   *
   * §18.3(b) said "remount onto the WebGL2 path", on three reasons. The third
   * was that the WebGL2 backend "ships anyway" to roughly 20% of visitors — and
   * the rollout ended that, by sending browsers without WebGPU to the classic
   * renderer instead. With nobody on the WebGL2 backend, recovering onto it
   * would answer a dead GPU with a **13593 ms** forest first mount where the
   * classic renderer's is **3596 ms**, at the moment a visitor is already
   * looking at a broken scene.
   *
   * It also closes the last hole in the rollout's own claim: refusing to send
   * ordinary visitors to that backend and then sending them there on device
   * loss would be the policy contradicting itself where nobody watches.
   */
  it("recovers onto the classic renderer after a lost device, not onto the WebGL2 backend", () => {
    expect(
      rendererDecisionFor({
        ...NO_HARNESS_ON_THE_DEFAULT_ROLLOUT,
        webgpuAdapter: WEBGPU_ADAPTER_HARDWARE,
        graphicsDeviceLost: true
      })
    ).toEqual({ choice: RENDERER_CHOICE_CLASSIC, isDecided: true, recoversFromDeviceLoss: true });
    expect(buildsNodeRenderer(RENDERER_CHOICE_CLASSIC)).toBe(false);
    expect(forcesWebGLBackend(RENDERER_CHOICE_CLASSIC)).toBe(false);
  });

  /**
   * **THE RECOVERY DECIDES WITHOUT THE ADAPTER.** A page that lost a device
   * already proved it had one, so waiting on `navigator.gpu` would hold a broken
   * canvas to re-learn something it just watched fail.
   */
  it("recovers without waiting for the adapter to answer", () => {
    expect(
      rendererDecisionFor({
        ...NO_HARNESS_ON_THE_DEFAULT_ROLLOUT,
        webgpuAdapter: null,
        graphicsDeviceLost: true
      })
    ).toEqual({ choice: RENDERER_CHOICE_CLASSIC, isDecided: true, recoversFromDeviceLoss: true });
  });

  /** The harness still wins, so a loss in one leg cannot silently rewrite a shot. */
  it("keeps the harness's choice even after a lost device", () => {
    expect(
      rendererDecisionFor({
        harnessRenderer: PARITY_RENDERER_WEBGPU,
        rollout: NODE_RENDERER_ROLLOUT_OFF,
        webgpuAdapter: null,
        graphicsDeviceLost: true
      })
    ).toEqual({ choice: RENDERER_CHOICE_NODE, isDecided: true, recoversFromDeviceLoss: false });
  });
});

describe("rendererDecisionNeedsAdapterAnswer", () => {
  /**
   * **ONE STATE ASKS THE DRIVER, AND THE OTHER FOUR DO NOT.** Every `false`
   * here is a `requestAdapter()` that is not made, on a page whose renderer is
   * already determined — which matters because this app remounts its canvas on
   * every world, every variant and every interest chip.
   */
  it("asks the driver only when the answer could still change the renderer", () => {
    expect(rendererDecisionNeedsAdapterAnswer(NO_HARNESS_ON_THE_DEFAULT_ROLLOUT)).toBe(true);

    expect(
      rendererDecisionNeedsAdapterAnswer({ ...NO_HARNESS_ON_THE_DEFAULT_ROLLOUT, graphicsDeviceLost: true })
    ).toBe(false);
    expect(
      rendererDecisionNeedsAdapterAnswer({
        ...NO_HARNESS_ON_THE_DEFAULT_ROLLOUT,
        harnessRenderer: PARITY_RENDERER_WEBGL
      })
    ).toBe(false);
    expect(
      rendererDecisionNeedsAdapterAnswer({ ...NO_HARNESS_ON_THE_DEFAULT_ROLLOUT, rollout: NODE_RENDERER_ROLLOUT_OFF })
    ).toBe(false);
    expect(
      rendererDecisionNeedsAdapterAnswer({
        ...NO_HARNESS_ON_THE_DEFAULT_ROLLOUT,
        rollout: NODE_RENDERER_ROLLOUT_EVERY_VISITOR
      })
    ).toBe(false);
  });
});

describe("nodeRendererRollout", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * **UNSET IS ON.** The frontend deploys on Vercel and this variable is set
   * nowhere in this repository, so "unset" is what production reads — the
   * default IS the rollout, and this test is the only place that says so
   * executably.
   */
  it("defaults to the WebGPU-gated rollout when nothing is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_NODE_RENDERER", undefined);
    expect(nodeRendererRollout()).toBe(NODE_RENDERER_ROLLOUT_WHERE_WEBGPU_IS_REAL);
    vi.stubEnv("NEXT_PUBLIC_NODE_RENDERER", "   ");
    expect(nodeRendererRollout()).toBe(NODE_RENDERER_ROLLOUT_WHERE_WEBGPU_IS_REAL);
  });

  /**
   * **FLIPPING THE DEFAULT FLIPPED WHICH TYPO IS DANGEROUS.** While the rollout
   * shipped off, only `1` could enable it and a mistyped `false` was harmless.
   * Now an unrecognised value ENABLES the thing a deploy meant to switch off, so
   * every plausible spelling of "off" has to be recognised — that is what this
   * test is protecting, not the strings themselves.
   */
  it("accepts every plausible spelling of off, in any case", () => {
    for (const configured of ["0", "off", "false", "no", "disabled", "OFF", " False ", "No"]) {
      vi.stubEnv("NEXT_PUBLIC_NODE_RENDERER", configured);
      expect(nodeRendererRollout()).toBe(NODE_RENDERER_ROLLOUT_OFF);
    }
  });

  it("opts into the unguarded rollout only for the one deliberate spelling", () => {
    vi.stubEnv("NEXT_PUBLIC_NODE_RENDERER", "every-visitor");
    expect(nodeRendererRollout()).toBe(NODE_RENDERER_ROLLOUT_EVERY_VISITOR);
  });

  /**
   * `1` was the old "on", and a deploy still carrying it must not be broken by
   * the rename. It now means the guarded rollout, which is the safer of the two
   * things it could have meant.
   */
  it("reads the old on-value, and anything unrecognised, as the guarded rollout", () => {
    for (const configured of ["1", "true", "on", "yes", "nonsense"]) {
      vi.stubEnv("NEXT_PUBLIC_NODE_RENDERER", configured);
      expect(nodeRendererRollout()).toBe(NODE_RENDERER_ROLLOUT_WHERE_WEBGPU_IS_REAL);
    }
  });
});

describe("rendererRemountSuffix", () => {
  const settled = (choice: typeof RENDERER_CHOICE_CLASSIC | typeof RENDERER_CHOICE_NODE | typeof RENDERER_CHOICE_NODE_FORCED_WEBGL) => ({
    choice,
    isDecided: true,
    recoversFromDeviceLoss: false
  });

  /**
   * EMPTY FOR EVERY ORDINARY CHOICE. The suffix joins `canvasRemountKey`, and a
   * non-empty one for the classic or the plain node path would change every
   * key in the app — remounting a canvas costs up to 2.1 seconds of blocked
   * main thread (§24.1), so a cosmetic suffix is not cosmetic.
   */
  it("moves the remount key only for the fallback", () => {
    expect(rendererRemountSuffix(settled(RENDERER_CHOICE_CLASSIC))).toBe("");
    expect(rendererRemountSuffix(settled(RENDERER_CHOICE_NODE))).toBe("");
    expect(rendererRemountSuffix(settled(RENDERER_CHOICE_NODE_FORCED_WEBGL))).not.toBe("");
  });

  /**
   * **THE BUG THIS EXISTS TO CATCH.** The device-loss recovery is now the
   * CLASSIC renderer, whose ordinary suffix is empty — so a suffix derived from
   * the choice alone would hand a page that lost its device the very key it
   * already had. React would keep the dead canvas and the recovery would
   * silently not happen, which is indistinguishable from the loss itself.
   */
  it("moves the remount key for a recovery, whose renderer has no suffix of its own", () => {
    const recovered = rendererRemountSuffix({
      choice: RENDERER_CHOICE_CLASSIC,
      isDecided: true,
      recoversFromDeviceLoss: true
    });
    expect(recovered).not.toBe("");
    expect(recovered).not.toBe(rendererRemountSuffix(settled(RENDERER_CHOICE_CLASSIC)));
  });
});

describe("graphics device loss", () => {
  /**
   * **`device.destroy()` RESOLVES THE SAME PROMISE**, and this app destroys a
   * device per world — every interest chip, every nickname edit, every family
   * switch remounts the canvas. Without this filter the first ordinary remount
   * would look like a driver failure and push the visitor onto the fallback for
   * the rest of the page's life.
   */
  it("does not treat an intentional teardown as a failure", () => {
    expect(isUnexpectedDeviceLoss("destroyed")).toBe(false);
    expect(isUnexpectedDeviceLoss("unknown")).toBe(true);
    expect(isUnexpectedDeviceLoss(undefined)).toBe(true);
  });

  it("calls back once for a real loss", async () => {
    const onLost = vi.fn();
    const watched = watchGraphicsDevice({ backend: { device: { lost: Promise.resolve({ reason: "unknown" }) } } }, onLost);
    expect(watched).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(onLost).toHaveBeenCalledWith("unknown");
  });

  it("stays silent when the device was destroyed on purpose", async () => {
    const onLost = vi.fn();
    watchGraphicsDevice({ backend: { device: { lost: Promise.resolve({ reason: "destroyed" }) } } }, onLost);
    await Promise.resolve();
    await Promise.resolve();
    expect(onLost).not.toHaveBeenCalled();
  });

  /**
   * ROUGHLY 20% OF VISITORS REACH THIS AND CORRECTLY FIND NOTHING (§19.5). The
   * WebGL2 backend has no `GPUDevice`, so a null here is the ordinary answer and
   * must not be an error.
   */
  it("reports that there was nothing to watch, without throwing", () => {
    const onLost = vi.fn();
    expect(watchGraphicsDevice({ backend: {} }, onLost)).toBe(false);
    expect(watchGraphicsDevice({}, onLost)).toBe(false);
    expect(watchGraphicsDevice(null, onLost)).toBe(false);
    expect(watchGraphicsDevice(undefined, onLost)).toBe(false);
    expect(onLost).not.toHaveBeenCalled();
  });
});

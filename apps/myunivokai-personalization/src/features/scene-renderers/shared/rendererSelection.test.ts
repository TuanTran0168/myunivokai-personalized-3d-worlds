import { describe, expect, it, vi } from "vitest";
import {
  PARITY_RENDERER_WEBGL,
  PARITY_RENDERER_WEBGPU,
  PARITY_RENDERER_WEBGPU_FORCED_WEBGL
} from "./parityHarness";
import {
  RENDERER_CHOICE_CLASSIC,
  RENDERER_CHOICE_NODE,
  RENDERER_CHOICE_NODE_FORCED_WEBGL,
  buildsNodeRenderer,
  forcesWebGLBackend,
  isUnexpectedDeviceLoss,
  rendererChoiceFor,
  rendererRemountSuffix
} from "./rendererSelection";
import { watchGraphicsDevice } from "./graphicsDeviceLoss";

/**
 * §26 Phase 9's one policy decision, and the failure mode WebGL2 does not have.
 *
 * Both are pure enough to test without a GPU, which is the point of their being
 * separated from the canvas at all: CI has no WebGPU, so anything that could
 * only be checked by mounting a node renderer could not be checked here.
 */

describe("rendererChoiceFor", () => {
  /**
   * **THE SAFETY PROPERTY OF THE WHOLE PHASE.** With the flag off and no
   * harness, every visitor gets exactly the renderer they got before this file
   * existed. If this test ever fails, Phase 9 shipped a renderer swap that
   * Phase 12 had not authorised.
   */
  it("gives every ordinary visitor the classic renderer while the flag is off", () => {
    expect(
      rendererChoiceFor({ harnessRenderer: null, nodeRendererEnabled: false, graphicsDeviceLost: false })
    ).toBe(RENDERER_CHOICE_CLASSIC);
  });

  it("gives the node renderer once the flag is on", () => {
    expect(
      rendererChoiceFor({ harnessRenderer: null, nodeRendererEnabled: true, graphicsDeviceLost: false })
    ).toBe(RENDERER_CHOICE_NODE);
  });

  /**
   * THE HARNESS OUTRANKS THE FLAG IN BOTH DIRECTIONS, and the second direction
   * is the one that matters: a build with the flag ON must still be able to
   * photograph the CLASSIC renderer, or the parity suite loses its baseline and
   * compares the node path against itself.
   */
  it("lets the harness name the renderer whatever the flag says", () => {
    for (const nodeRendererEnabled of [false, true]) {
      expect(
        rendererChoiceFor({ harnessRenderer: PARITY_RENDERER_WEBGL, nodeRendererEnabled, graphicsDeviceLost: false })
      ).toBe(RENDERER_CHOICE_CLASSIC);
      expect(
        rendererChoiceFor({ harnessRenderer: PARITY_RENDERER_WEBGPU, nodeRendererEnabled, graphicsDeviceLost: false })
      ).toBe(RENDERER_CHOICE_NODE);
      expect(
        rendererChoiceFor({
          harnessRenderer: PARITY_RENDERER_WEBGPU_FORCED_WEBGL,
          nodeRendererEnabled,
          graphicsDeviceLost: false
        })
      ).toBe(RENDERER_CHOICE_NODE_FORCED_WEBGL);
    }
  });

  /**
   * A LOST DEVICE FALLS BACK TO THE WEBGL2 BACKEND, NOT TO `WebGLRenderer`.
   *
   * §18.3(b) says "remount the canvas onto the WebGL2 path", and the path that
   * keeps Architecture A is `WebGPURenderer` with `forceWebGL`. Falling all the
   * way back to the classic renderer would rebuild every material through the
   * other implementation at the worst possible moment — and a lost `GPUDevice`
   * says nothing about WebGL2, which is a different API on a different code
   * path.
   */
  it("falls back to the WebGL2 backend after a lost device, keeping the node materials", () => {
    expect(
      rendererChoiceFor({ harnessRenderer: null, nodeRendererEnabled: true, graphicsDeviceLost: true })
    ).toBe(RENDERER_CHOICE_NODE_FORCED_WEBGL);
    expect(buildsNodeRenderer(RENDERER_CHOICE_NODE_FORCED_WEBGL)).toBe(true);
    expect(forcesWebGLBackend(RENDERER_CHOICE_NODE_FORCED_WEBGL)).toBe(true);
  });

  /** The harness still wins, so a loss in one leg cannot silently rewrite a shot. */
  it("keeps the harness's choice even after a lost device", () => {
    expect(
      rendererChoiceFor({
        harnessRenderer: PARITY_RENDERER_WEBGPU,
        nodeRendererEnabled: false,
        graphicsDeviceLost: true
      })
    ).toBe(RENDERER_CHOICE_NODE);
  });
});

describe("rendererRemountSuffix", () => {
  /**
   * EMPTY FOR EVERY ORDINARY CHOICE. The suffix joins `canvasRemountKey`, and a
   * non-empty one for the classic or the plain node path would change every
   * key in the app — remounting a canvas costs up to 2.1 seconds of blocked
   * main thread (§24.1), so a cosmetic suffix is not cosmetic.
   */
  it("moves the remount key only for the fallback", () => {
    expect(rendererRemountSuffix(RENDERER_CHOICE_CLASSIC)).toBe("");
    expect(rendererRemountSuffix(RENDERER_CHOICE_NODE)).toBe("");
    expect(rendererRemountSuffix(RENDERER_CHOICE_NODE_FORCED_WEBGL)).not.toBe("");
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

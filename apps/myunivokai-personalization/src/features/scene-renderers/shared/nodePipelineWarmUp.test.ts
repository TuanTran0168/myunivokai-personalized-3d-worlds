import { describe, expect, it } from "vitest";
import {
  NODE_PIPELINE_WARM_UP_CEILING_MILLISECONDS,
  NODE_PIPELINE_WARM_UP_COMPILED,
  NODE_PIPELINE_WARM_UP_FAILED,
  NODE_PIPELINE_WARM_UP_TIMED_OUT,
  announceScenePassForWarmUp,
  forgetNodePipelineWarmUp,
  forgetScenePassForWarmUp,
  lastNodePipelineWarmUp,
  recordNodePipelineWarmUp,
  scenePassForWarmUp,
  rendererCompilesPipelinesAsynchronously,
  warmUpNodePipelines,
  withdrawScenePassForWarmUp
} from "./nodePipelineWarmUp";

/**
 * The ceiling used by the tests that need one to be reached. Two milliseconds,
 * because these assert WHICH side of the race won, not how long it took.
 */
const NEGLIGIBLE_CEILING_MILLISECONDS = 2;

/** Long enough that a resolved compile always wins the race on any machine. */
const UNREACHABLE_CEILING_MILLISECONDS = 60_000;

describe("rendererCompilesPipelinesAsynchronously", () => {
  it("is false for the classic renderer even though it has a compileAsync of its own", () => {
    // THE CASE THIS FUNCTION EXISTS FOR. `WebGLRenderer` has a `compileAsync`
    // method, and it is a different implementation that was measured to do
    // nothing on this project's driver. Selecting on the method alone would put
    // every visitor through it while the rollout flag is off.
    expect(rendererCompilesPipelinesAsynchronously({ isWebGLRenderer: true, compileAsync: async () => {} })).toBe(
      false
    );
  });

  it("is true for a node renderer on either backend", () => {
    const onWebGPU = { backend: { isWebGPUBackend: true }, compileAsync: async () => {} };
    const onWebGL2 = { backend: { isWebGLBackend: true }, compileAsync: async () => {} };
    expect(rendererCompilesPipelinesAsynchronously(onWebGPU)).toBe(true);
    // The fallback is the whole reason this is worth doing — §26 Phase 11
    // measured it at 15.3 s of blocked main thread on the forest, four times
    // the classic renderer, and it is what roughly a fifth of visitors get.
    expect(rendererCompilesPipelinesAsynchronously(onWebGL2)).toBe(true);
  });

  it("is false for a node renderer whose build has no compileAsync", () => {
    expect(rendererCompilesPipelinesAsynchronously({ backend: { isWebGPUBackend: true } })).toBe(false);
  });

  it("is false rather than throwing for nothing at all", () => {
    expect(rendererCompilesPipelinesAsynchronously(null)).toBe(false);
    expect(rendererCompilesPipelinesAsynchronously(undefined)).toBe(false);
  });
});

describe("warmUpNodePipelines", () => {
  it("reports compiled when the compile resolves first", async () => {
    const report = await warmUpNodePipelines(async () => undefined, UNREACHABLE_CEILING_MILLISECONDS);
    expect(report.outcome).toBe(NODE_PIPELINE_WARM_UP_COMPILED);
    expect(report.milliseconds).toBeGreaterThanOrEqual(0);
  });

  it("reports timed-out and RESOLVES when the compile never does", async () => {
    // The property the whole change hangs on: `UniverseCanvas` holds its frames
    // until this settles, so a warm-up that could hang would be a canvas that
    // never draws. A pending promise stands in for a driver that never returns.
    const report = await warmUpNodePipelines(() => new Promise<void>(() => {}), NEGLIGIBLE_CEILING_MILLISECONDS);
    expect(report.outcome).toBe(NODE_PIPELINE_WARM_UP_TIMED_OUT);
  });

  it("reports failed rather than rejecting when the compile throws", async () => {
    const report = await warmUpNodePipelines(async () => {
      throw new Error("pipeline creation failed");
    }, UNREACHABLE_CEILING_MILLISECONDS);
    expect(report.outcome).toBe(NODE_PIPELINE_WARM_UP_FAILED);
  });

  it("reports failed when the compile throws synchronously", async () => {
    // `compileAsync` is called through a `.call`, and a renderer in a bad state
    // can throw before it ever returns a promise. An unhandled throw here would
    // leave the frames held forever.
    const report = await warmUpNodePipelines(() => {
      throw new Error("no device");
    }, UNREACHABLE_CEILING_MILLISECONDS);
    expect(report.outcome).toBe(NODE_PIPELINE_WARM_UP_FAILED);
  });

  it("defaults its ceiling to the measured one rather than to an arbitrary number", () => {
    // Ten seconds against §26 Phase 11's worst measured case of 15.3 s blocked:
    // deliberately shorter than the stall it replaces, so the ceiling is a
    // recovery rather than a second way to wait.
    expect(NODE_PIPELINE_WARM_UP_CEILING_MILLISECONDS).toBe(10_000);
  });
});

describe("the last warm-up record", () => {
  it("starts empty, holds what was recorded, and can be forgotten", () => {
    forgetNodePipelineWarmUp();
    expect(lastNodePipelineWarmUp()).toBeNull();
    recordNodePipelineWarmUp({ outcome: NODE_PIPELINE_WARM_UP_COMPILED, milliseconds: 42 });
    expect(lastNodePipelineWarmUp()).toEqual({ outcome: NODE_PIPELINE_WARM_UP_COMPILED, milliseconds: 42 });
    forgetNodePipelineWarmUp();
    expect(lastNodePipelineWarmUp()).toBeNull();
  });
});

describe("the scene-pass handoff", () => {
  it("resolves immediately for a pass announced before anyone asked", async () => {
    forgetScenePassForWarmUp();
    const scenePass = { compileAsync: async () => undefined };
    announceScenePassForWarmUp(scenePass);
    await expect(scenePassForWarmUp()).resolves.toBe(scenePass);
  });

  it("resolves a waiter that asked first, which is the ordinary case", async () => {
    // THE ORDERING THIS EXISTS FOR. The warm-up`s effect runs as soon as the
    // canvas mounts; the post chain builds its pass after three dynamic
    // imports. So the asker is almost always first.
    forgetScenePassForWarmUp();
    const waiting = scenePassForWarmUp();
    const scenePass = { compileAsync: async () => undefined };
    announceScenePassForWarmUp(scenePass);
    await expect(waiting).resolves.toBe(scenePass);
  });

  it("withdraws only its own pass, so a dying chain cannot unregister the live one", () => {
    forgetScenePassForWarmUp();
    const dying = { compileAsync: async () => undefined };
    const live = { compileAsync: async () => undefined };
    announceScenePassForWarmUp(dying);
    announceScenePassForWarmUp(live);
    withdrawScenePassForWarmUp(dying);
    return expect(scenePassForWarmUp()).resolves.toBe(live);
  });

  it("leaves the warm-up on its ceiling when no pass is ever announced", async () => {
    // A post chain that failed to build must not hold the frames forever. The
    // ceiling is the whole recovery, and this is the case that needs it.
    forgetScenePassForWarmUp();
    const report = await warmUpNodePipelines(async () => {
      const scenePass = await scenePassForWarmUp();
      return scenePass.compileAsync(null);
    }, NEGLIGIBLE_CEILING_MILLISECONDS);
    expect(report.outcome).toBe(NODE_PIPELINE_WARM_UP_TIMED_OUT);
  });
});

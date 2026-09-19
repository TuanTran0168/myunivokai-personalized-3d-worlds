import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WEBGPU_ADAPTER_ABSENT,
  WEBGPU_ADAPTER_HARDWARE,
  WEBGPU_ADAPTER_NONE,
  WEBGPU_ADAPTER_SOFTWARE,
  WEBGPU_ADAPTER_PROBE_TIMEOUT_MILLISECONDS,
  classifyWebGPUAdapterIdentity,
  forgetWebGPUAdapterAvailability,
  probeWebGPUAdapter,
  webgpuAdapterAvailabilityOnce
} from "./webgpuSupport";

/**
 * THE ONE BRANCH NOTHING ELSE CAN EXERCISE.
 *
 * CI has no WebGPU at all, the visual suite forces SwiftShader which has none,
 * and the parity suite's machine has a real GPU — so the software-adapter
 * branch is reachable from no automated run in this repository. That is exactly
 * why `classifyWebGPUAdapterIdentity` is a pure function over four strings: the
 * classification can be tested where the adapter cannot be produced.
 */

const originalNavigator = globalThis.navigator;

function setNavigator(value: unknown) {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
}

afterEach(() => {
  setNavigator(originalNavigator);
});

describe("classifyWebGPUAdapterIdentity", () => {
  it("names the three software rasterisers a browser can hand back", () => {
    expect(classifyWebGPUAdapterIdentity({ architecture: "swiftshader" })).toBe(WEBGPU_ADAPTER_SOFTWARE);
    expect(classifyWebGPUAdapterIdentity({ device: "llvmpipe (LLVM 15.0.7, 256 bits)" })).toBe(
      WEBGPU_ADAPTER_SOFTWARE
    );
    expect(classifyWebGPUAdapterIdentity({ description: "Microsoft Basic Render Driver" })).toBe(
      WEBGPU_ADAPTER_SOFTWARE
    );
  });

  it("reads any of the four fields, because browsers populate different ones", () => {
    expect(classifyWebGPUAdapterIdentity({ vendor: "Google Inc. (SwiftShader)" })).toBe(WEBGPU_ADAPTER_SOFTWARE);
    expect(classifyWebGPUAdapterIdentity({ device: "WARP" })).toBe(WEBGPU_ADAPTER_SOFTWARE);
  });

  it("treats a real GPU as hardware", () => {
    expect(
      classifyWebGPUAdapterIdentity({ vendor: "nvidia", architecture: "lovelace", device: "NVIDIA GeForce RTX 4060" })
    ).toBe(WEBGPU_ADAPTER_HARDWARE);
    expect(classifyWebGPUAdapterIdentity({ vendor: "apple", architecture: "common-3" })).toBe(
      WEBGPU_ADAPTER_HARDWARE
    );
  });

  /**
   * FAILING TOWARD QUALITY, WHICH IS THE REPO'S STANCE AND NOT A DEFAULT.
   *
   * Chrome redacts `adapter.info` under some privacy settings and answers with
   * empty strings rather than throwing. Reading that as "software" would quietly
   * drop every such visitor to the minimal profile — no shadows, no bloom, no
   * ambient occlusion — for having turned a toggle on.
   */
  it("treats an adapter that describes itself as nothing as hardware", () => {
    expect(classifyWebGPUAdapterIdentity(undefined)).toBe(WEBGPU_ADAPTER_HARDWARE);
    expect(classifyWebGPUAdapterIdentity({})).toBe(WEBGPU_ADAPTER_HARDWARE);
    expect(classifyWebGPUAdapterIdentity({ vendor: "", architecture: "", device: "", description: "" })).toBe(
      WEBGPU_ADAPTER_HARDWARE
    );
    expect(classifyWebGPUAdapterIdentity({ vendor: "   " })).toBe(WEBGPU_ADAPTER_HARDWARE);
  });
});

describe("probeWebGPUAdapter", () => {
  it("answers absent when the browser has no WebGPU", async () => {
    setNavigator({});
    await expect(probeWebGPUAdapter()).resolves.toBe(WEBGPU_ADAPTER_ABSENT);
  });

  /**
   * `requestAdapter()` RESOLVES NULL RATHER THAN THROWING when the driver is
   * blocklisted, which §18.2 calls out as gate 3 and which Phase 0 measured on
   * five of eight launch modes. A probe that only caught exceptions would read
   * that as success.
   */
  it("answers none when the browser has WebGPU but will not give an adapter", async () => {
    setNavigator({ gpu: { requestAdapter: async () => null } });
    await expect(probeWebGPUAdapter()).resolves.toBe(WEBGPU_ADAPTER_NONE);
  });

  it("classifies the adapter it does get", async () => {
    setNavigator({
      gpu: { requestAdapter: async () => ({ info: { vendor: "nvidia", architecture: "lovelace" } }) }
    });
    await expect(probeWebGPUAdapter()).resolves.toBe(WEBGPU_ADAPTER_HARDWARE);

    setNavigator({ gpu: { requestAdapter: async () => ({ info: { architecture: "swiftshader" } }) } });
    await expect(probeWebGPUAdapter()).resolves.toBe(WEBGPU_ADAPTER_SOFTWARE);
  });

  /** The older promise-shaped API, still shipped by browsers that were early. */
  it("falls back to requestAdapterInfo when there is no info property", async () => {
    setNavigator({
      gpu: {
        requestAdapter: async () => ({ requestAdapterInfo: async () => ({ device: "lavapipe" }) })
      }
    });
    await expect(probeWebGPUAdapter()).resolves.toBe(WEBGPU_ADAPTER_SOFTWARE);
  });

  it("never rejects, whatever the browser does", async () => {
    setNavigator({
      gpu: {
        requestAdapter: async () => {
          throw new Error("refused");
        }
      }
    });
    await expect(probeWebGPUAdapter()).resolves.toBe(WEBGPU_ADAPTER_ABSENT);

    setNavigator({
      gpu: {
        requestAdapter: async () => ({
          requestAdapterInfo: async () => {
            throw new Error("redacted");
          }
        })
      }
    });
    // An adapter that refuses to describe itself is a working adapter.
    await expect(probeWebGPUAdapter()).resolves.toBe(WEBGPU_ADAPTER_HARDWARE);
  });
});

describe("webgpuAdapterAvailabilityOnce", () => {
  afterEach(() => {
    forgetWebGPUAdapterAvailability();
    vi.useRealTimers();
  });

  /**
   * **ONE `requestAdapter()` PER PAGE, NOT ONE PER CANVAS.** Two callers want
   * this fact — the rollout veto and the quality tier — and this app remounts
   * its canvas on every world, every variant and every interest chip. Without
   * the memo, each of those would ask the driver again for a value that cannot
   * have changed.
   */
  it("asks the driver once however many callers there are", async () => {
    let requestCount = 0;
    setNavigator({
      gpu: {
        requestAdapter: async () => {
          requestCount += 1;
          return { info: { vendor: "nvidia" } };
        }
      }
    });

    const answers = await Promise.all([
      webgpuAdapterAvailabilityOnce(),
      webgpuAdapterAvailabilityOnce(),
      webgpuAdapterAvailabilityOnce()
    ]);

    expect(answers).toEqual([WEBGPU_ADAPTER_HARDWARE, WEBGPU_ADAPTER_HARDWARE, WEBGPU_ADAPTER_HARDWARE]);
    expect(requestCount).toBe(1);
    await expect(webgpuAdapterAvailabilityOnce()).resolves.toBe(WEBGPU_ADAPTER_HARDWARE);
    expect(requestCount).toBe(1);
  });

  /**
   * **A WEDGED DRIVER MUST NOT HOLD THE CANVAS FOREVER.** `probeWebGPUAdapter`
   * never rejects, but nothing stops it hanging, and the canvas does not mount
   * until this answers. Timing out resolves to `absent`, which selects the
   * classic renderer — a machine that took longer than Phase 0's 15 ms by two
   * orders of magnitude is not a machine to hand an unproven render path.
   */
  it("answers absent rather than hanging when the driver never replies", async () => {
    vi.useFakeTimers();
    setNavigator({ gpu: { requestAdapter: () => new Promise(() => {}) } });

    const answer = webgpuAdapterAvailabilityOnce();
    await vi.advanceTimersByTimeAsync(WEBGPU_ADAPTER_PROBE_TIMEOUT_MILLISECONDS);

    await expect(answer).resolves.toBe(WEBGPU_ADAPTER_ABSENT);
  });

  /** A driver that answers in time beats the timeout, and leaves no timer behind. */
  it("keeps the driver's answer when it arrives before the bound", async () => {
    vi.useFakeTimers();
    setNavigator({ gpu: { requestAdapter: async () => null } });

    const answer = webgpuAdapterAvailabilityOnce();
    await vi.advanceTimersByTimeAsync(0);

    await expect(answer).resolves.toBe(WEBGPU_ADAPTER_NONE);
    expect(vi.getTimerCount()).toBe(0);
  });
});

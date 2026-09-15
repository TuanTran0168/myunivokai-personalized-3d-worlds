import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PINNED_SECONDS,
  PARITY_RENDERER_WEBGL,
  PARITY_RENDERER_WEBGPU,
  PARITY_RENDERER_WEBGPU_FORCED_WEBGL,
  parityHarnessRequest,
  PINNED_CLOCK_STEP_COUNT,
  pinnedClockTimestamps
} from "./parityHarness";

/**
 * The harness's two properties that a browser cannot be asked about cheaply:
 * that it is OFF by default, and that its clock is deterministic.
 *
 * Both matter more than they look. An always-on renderer switch is a production
 * behaviour reachable from a query string, and a clock that is only nearly
 * deterministic makes every parity number a guess.
 */

const HARNESS_VARIABLE = "NEXT_PUBLIC_PARITY_HARNESS";
const originalValue = process.env[HARNESS_VARIABLE];

function withHarnessEnabled(enabled: boolean) {
  if (enabled) {
    process.env[HARNESS_VARIABLE] = "1";
  } else {
    delete process.env[HARNESS_VARIABLE];
  }
}

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env[HARNESS_VARIABLE];
  } else {
    process.env[HARNESS_VARIABLE] = originalValue;
  }
});

describe("parity harness switch", () => {
  it("is off without the build flag, whatever the URL asks for", () => {
    withHarnessEnabled(false);
    expect(parityHarnessRequest("?parityRenderer=webgpu&paritySeconds=6")).toBeNull();
  });

  it("is off with the build flag but no request", () => {
    withHarnessEnabled(true);
    expect(parityHarnessRequest("")).toBeNull();
    expect(parityHarnessRequest(undefined)).toBeNull();
    expect(parityHarnessRequest("?somethingElse=1")).toBeNull();
  });

  it("resolves each of the three renderers", () => {
    withHarnessEnabled(true);
    expect(parityHarnessRequest("?parityRenderer=webgl")?.renderer).toBe(PARITY_RENDERER_WEBGL);
    expect(parityHarnessRequest("?parityRenderer=webgpu")?.renderer).toBe(PARITY_RENDERER_WEBGPU);
    expect(parityHarnessRequest("?parityRenderer=webgpu-forcewebgl")?.renderer).toBe(
      PARITY_RENDERER_WEBGPU_FORCED_WEBGL
    );
  });

  /**
   * A typo photographs the normal app rather than crashing it — and cannot pass
   * unnoticed either, because the spec asserts the backend it actually got.
   */
  it("ignores an unknown renderer name instead of throwing", () => {
    withHarnessEnabled(true);
    expect(parityHarnessRequest("?parityRenderer=webgpu2")).toBeNull();
    expect(parityHarnessRequest("?parityRenderer=WEBGPU")).toBeNull();
  });

  it("falls back to the default pinned time on a missing or nonsense value", () => {
    withHarnessEnabled(true);
    expect(parityHarnessRequest("?parityRenderer=webgl")?.pinnedSeconds).toBe(DEFAULT_PINNED_SECONDS);
    expect(parityHarnessRequest("?parityRenderer=webgl&paritySeconds=abc")?.pinnedSeconds).toBe(
      DEFAULT_PINNED_SECONDS
    );
    expect(parityHarnessRequest("?parityRenderer=webgl&paritySeconds=0")?.pinnedSeconds).toBe(
      DEFAULT_PINNED_SECONDS
    );
    expect(parityHarnessRequest("?parityRenderer=webgl&paritySeconds=-4")?.pinnedSeconds).toBe(
      DEFAULT_PINNED_SECONDS
    );
    expect(parityHarnessRequest("?parityRenderer=webgl&paritySeconds=2.5")?.pinnedSeconds).toBe(2.5);
  });
});

describe("pinned clock", () => {
  it("ends exactly on the requested time", () => {
    const timestamps = pinnedClockTimestamps(6);
    expect(timestamps).toHaveLength(PINNED_CLOCK_STEP_COUNT);
    expect(timestamps[timestamps.length - 1]).toBeCloseTo(6, 10);
  });

  it("steps evenly, so every frame sees the delta the motion was authored for", () => {
    const timestamps = pinnedClockTimestamps(6);
    const deltas = timestamps.map((timestamp, index) => timestamp - (index === 0 ? 0 : timestamps[index - 1]));
    for (const delta of deltas) {
      expect(delta).toBeCloseTo(6 / PINNED_CLOCK_STEP_COUNT, 10);
    }
  });

  /**
   * The property the whole harness rests on. R3F's manual frameloop assigns
   * `clock.elapsedTime = timestamp` and derives `delta` from the previous one,
   * so an identical list of timestamps is an identical animation phase — on any
   * machine, at any speed, on either backend. If this list were derived from
   * anything the environment supplies, the parity numbers would be noise.
   */
  it("is a pure function of its arguments", () => {
    expect(pinnedClockTimestamps(6)).toEqual(pinnedClockTimestamps(6));
    expect(pinnedClockTimestamps(6)).not.toEqual(pinnedClockTimestamps(3));
    expect(pinnedClockTimestamps(6, 4)).toEqual([1.5, 3, 4.5, 6]);
  });
});

import { describe, expect, it } from "vitest";
import { mapWithBoundedConcurrency } from "./concurrency";

describe("mapWithBoundedConcurrency", () => {
  it("preserves input order in the results regardless of completion order", async () => {
    const delaysMilliseconds = [30, 5, 20, 1, 10];
    const results = await mapWithBoundedConcurrency(delaysMilliseconds, 2, async (delay, index) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return `item-${index}`;
    });
    expect(results).toEqual(["item-0", "item-1", "item-2", "item-3", "item-4"]);
  });

  it("never exceeds the concurrency limit", async () => {
    const concurrencyLimit = 3;
    let inFlight = 0;
    let peakInFlight = 0;
    await mapWithBoundedConcurrency(Array.from({ length: 12 }, (_, i) => i), concurrencyLimit, async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    });
    expect(peakInFlight).toBeLessThanOrEqual(concurrencyLimit);
    expect(peakInFlight).toBeGreaterThan(1);
  });

  it("handles an empty input and a limit larger than the input", async () => {
    expect(await mapWithBoundedConcurrency([], 4, async (item) => item)).toEqual([]);
    expect(await mapWithBoundedConcurrency([1, 2], 10, async (item) => item * 2)).toEqual([2, 4]);
  });
});

import { describe, expect, it } from "vitest";
import type { WorldFamily } from "@/lib/types";
import { WORLD_LOADERS, worldLoaderForFamily } from "./registry";

// Every family the app can render a world for. Written out here rather than
// derived from WORLD_LOADERS itself: a test that asked the registry which
// families exist would agree with the registry no matter what it left out.
const EVERY_WORLD_FAMILY: WorldFamily[] = ["universe", "nature", "ocean"];

describe("WORLD_LOADERS", () => {
  it("has a loader for every world family", () => {
    // The real guard is the `Record<WorldFamily, WorldLoader>` type, which
    // fails the build rather than a test. This is the reminder of what that
    // type is protecting: a family without a loader would spend its whole cold
    // start showing another world's wait.
    for (const family of EVERY_WORLD_FAMILY) {
      expect(WORLD_LOADERS[family]).toBeDefined();
    }
    expect(Object.keys(WORLD_LOADERS).sort()).toEqual([...EVERY_WORLD_FAMILY].sort());
  });

  it("gives each family its own ground, mark and sentence", () => {
    // Two families sharing any one of the three would mean the hold no longer
    // says which world is being built, which is the only reason it exists.
    const grounds = new Set<string>();
    const labels = new Set<string>();
    const marks = new Set<unknown>();
    for (const family of EVERY_WORLD_FAMILY) {
      const loader = worldLoaderForFamily(family);
      grounds.add(loader.groundClassName);
      labels.add(loader.waitingLabel);
      marks.add(loader.Mark);
      expect(typeof loader.Mark).toBe("function");
    }
    expect(grounds.size).toBe(EVERY_WORLD_FAMILY.length);
    expect(labels.size).toBe(EVERY_WORLD_FAMILY.length);
    expect(marks.size).toBe(EVERY_WORLD_FAMILY.length);
  });

  it("keeps every ground on the shared base class", () => {
    // `.world-loader-ground` is what makes the ground fill the overlay and
    // carry the slow breath; the family class only supplies the colours. A
    // ground that dropped the base class would be an invisible zero-height
    // element, and the destination scene would be visible while it mounted.
    for (const family of EVERY_WORLD_FAMILY) {
      expect(worldLoaderForFamily(family).groundClassName.split(" ")).toContain("world-loader-ground");
    }
  });

  it("says what is being built rather than reporting progress", () => {
    for (const family of EVERY_WORLD_FAMILY) {
      const label = worldLoaderForFamily(family).waitingLabel;
      expect(label.length).toBeGreaterThan(0);
      // There is no percentage to give, and inventing one would be a lie told
      // to the only visitor who cannot see that the mark is still moving.
      expect(label).not.toMatch(/%|\bloading\b/i);
    }
  });
});

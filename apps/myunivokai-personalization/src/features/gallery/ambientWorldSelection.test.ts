import { describe, expect, it } from "vitest";
import { pickAmbientWorldEntry } from "./ambientWorldSelection";
import type { SavedWorldEntry } from "./useSavedWorlds";
import type { World } from "@/lib/types";

function entry(worldIdentifier: string, hasWorld = true): SavedWorldEntry {
  return {
    worldIdentifier,
    family: "universe",
    world: hasWorld ? ({ id: worldIdentifier, variants: [] } as World) : undefined,
    errorMessage: hasWorld ? undefined : "not found"
  };
}

describe("pickAmbientWorldEntry", () => {
  it("prefers the last-viewed world when it is in the loaded list", () => {
    const entries = [entry("newest"), entry("middle"), entry("oldest")];
    expect(pickAmbientWorldEntry(entries, { worldIdentifier: "middle", family: "universe" })).toBe(entries[1]);
  });

  it("falls back to the most recently saved world when nothing was viewed yet", () => {
    const entries = [entry("newest"), entry("oldest")];
    expect(pickAmbientWorldEntry(entries, null)).toBe(entries[0]);
  });

  it("falls back to the most recently saved world when the last-viewed one is gone", () => {
    // Removed from the gallery, or failed to load this time.
    const entries = [entry("newest"), entry("oldest")];
    expect(pickAmbientWorldEntry(entries, { worldIdentifier: "deleted", family: "universe" })).toBe(entries[0]);
  });

  it("skips entries that failed to load", () => {
    const entries = [entry("failed", false), entry("loaded")];
    expect(pickAmbientWorldEntry(entries, { worldIdentifier: "failed", family: "universe" })).toBe(entries[1]);
  });

  it("returns undefined when there is nothing usable at all", () => {
    expect(pickAmbientWorldEntry([], null)).toBeUndefined();
    expect(pickAmbientWorldEntry([entry("failed", false)], null)).toBeUndefined();
  });
});

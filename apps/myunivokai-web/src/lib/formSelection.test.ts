import { describe, expect, it } from "vitest";
import { addUnlessPresent, ensureRange, toggleItem } from "./formSelection";

describe("toggleItem", () => {
  it("adds an item below the maximum and removes it above the minimum", () => {
    expect(toggleItem(["a", "b", "c"], "d", 3, 8)).toEqual(["a", "b", "c", "d"]);
    expect(toggleItem(["a", "b", "c", "d"], "d", 3, 8)).toEqual(["a", "b", "c"]);
  });

  it("refuses to remove below the minimum and to add above the maximum", () => {
    expect(toggleItem(["a", "b", "c"], "a", 3, 8)).toEqual(["a", "b", "c"]);
    expect(toggleItem(["a", "b", "c", "d"], "e", 3, 4)).toEqual(["a", "b", "c", "d"]);
  });

  it("never duplicates an already-selected item (safe for custom entries)", () => {
    const selection = ["a", "b", "c", "Cooking"];
    expect(toggleItem(selection, "Cooking", 3, 8)).toEqual(["a", "b", "c"]);
  });
});

describe("ensureRange (behavior lock — see formSelection.ts)", () => {
  const defaults = ["Technology", "Design", "AI"];

  it("returns the defaults when nothing is selected", () => {
    expect(ensureRange([], defaults, 3, 8)).toEqual(defaults);
  });

  it("submits a sufficient selection exactly as picked — no invented defaults", () => {
    expect(ensureRange(["Music", "Art", "Science"], defaults, 3, 8)).toEqual(["Music", "Art", "Science"]);
  });

  it("pads with defaults only up to the minimum, skipping duplicates", () => {
    expect(ensureRange([" Technology ", "Music", ""], defaults, 3, 8)).toEqual([
      "Technology",
      "Music",
      "Design"
    ]);
  });

  it("caps the selection at the maximum", () => {
    const nineSelections = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"];
    expect(ensureRange(nineSelections, defaults, 3, 8)).toEqual(nineSelections.slice(0, 8));
  });
});

describe("addUnlessPresent", () => {
  it("adds a genuinely new item, same as toggleItem", () => {
    expect(addUnlessPresent(["a", "b", "c"], "d", 3, 8)).toEqual(["a", "b", "c", "d"]);
  });

  it("leaves an already-selected item alone instead of toggling it off", () => {
    // The bug this exists to prevent: a visitor types a custom value that
    // happens to match a chip they already picked and presses Enter.
    // toggleItem alone would read that as "remove it".
    expect(addUnlessPresent(["a", "b", "c"], "b", 3, 8)).toEqual(["a", "b", "c"]);
  });

  it("still refuses to add above the maximum", () => {
    expect(addUnlessPresent(["a", "b", "c", "d"], "e", 3, 4)).toEqual(["a", "b", "c", "d"]);
  });
});

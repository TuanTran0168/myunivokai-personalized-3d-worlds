import { describe, expect, it } from "vitest";
import {
  activeSectionIndex,
  isScrolledToEnd,
  pickActiveSectionId,
  resolveActiveSectionId
} from "./formSectionProgress";

describe("pickActiveSectionId", () => {
  it("picks the most-visible section", () => {
    expect(
      pickActiveSectionId(
        [
          { id: "world-family", intersectionRatio: 0.2 },
          { id: "nickname", intersectionRatio: 0.9 }
        ],
        "world-family"
      )
    ).toBe("nickname");
  });

  it("ignores sections with zero ratio", () => {
    // ratio 0 means "not intersecting the observer's root margin at all" —
    // a section that has merely scrolled out must not win.
    expect(
      pickActiveSectionId(
        [
          { id: "world-family", intersectionRatio: 0 },
          { id: "nickname", intersectionRatio: 0.4 }
        ],
        "world-family"
      )
    ).toBe("nickname");
  });

  it("keeps the current section on an exact tie, so it does not flicker", () => {
    expect(
      pickActiveSectionId(
        [
          { id: "traits", intersectionRatio: 0.5 },
          { id: "goal", intersectionRatio: 0.5 }
        ],
        "traits"
      )
    ).toBe("traits");
  });

  it("keeps the previous active id when nothing is visible", () => {
    // Between two sections' rootMargin bands is not a state the indicator
    // should visibly collapse out of.
    expect(pickActiveSectionId([{ id: "goal", intersectionRatio: 0 }], "traits")).toBe("traits");
  });

  it("returns null when nothing has ever been visible", () => {
    expect(pickActiveSectionId([{ id: "goal", intersectionRatio: 0 }], null)).toBeNull();
  });
});

describe("activeSectionIndex", () => {
  const sectionIds = ["world-family", "nickname", "primary-role"];

  it("finds the active id's position", () => {
    expect(activeSectionIndex(sectionIds, "nickname")).toBe(1);
  });

  it("defaults to the first section when nothing is active yet", () => {
    expect(activeSectionIndex(sectionIds, null)).toBe(0);
  });

  it("defaults to the first section for an id it does not recognize", () => {
    expect(activeSectionIndex(sectionIds, "unknown-section")).toBe(0);
  });
});

describe("isScrolledToEnd", () => {
  it("is false part-way down the field column", () => {
    expect(isScrolledToEnd({ scrollTop: 120, clientHeight: 210, scrollHeight: 800 })).toBe(false);
  });

  it("is true at the exact bottom", () => {
    expect(isScrolledToEnd({ scrollTop: 590, clientHeight: 210, scrollHeight: 800 })).toBe(true);
  });

  it("tolerates the fractional scrollTop a zoomed display produces", () => {
    expect(isScrolledToEnd({ scrollTop: 588.5, clientHeight: 210, scrollHeight: 800 })).toBe(true);
  });

  it("is true when there is nothing to scroll at all", () => {
    expect(isScrolledToEnd({ scrollTop: 0, clientHeight: 800, scrollHeight: 800 })).toBe(true);
  });
});

describe("resolveActiveSectionId", () => {
  const sectionIds = ["world-family", "nickname", "palette"];

  it("uses the most-visible section while there is still scroll left", () => {
    expect(
      resolveActiveSectionId(
        sectionIds,
        [
          { id: "world-family", intersectionRatio: 0.1 },
          { id: "nickname", intersectionRatio: 0.8 }
        ],
        "world-family",
        false
      )
    ).toBe("nickname");
  });

  it("hands the last section the lead at the bottom of the scroll", () => {
    // The band sits a fifth of the way down the column, so the final section is
    // pinned below it and can never win on ratio. Without this the indicator
    // stops one segment short of full however far the visitor scrolls.
    expect(
      resolveActiveSectionId(sectionIds, [{ id: "nickname", intersectionRatio: 0.9 }], "nickname", true)
    ).toBe("palette");
  });

  it("has no last section to pick when there are none", () => {
    expect(resolveActiveSectionId([], [], null, true)).toBeNull();
  });
});

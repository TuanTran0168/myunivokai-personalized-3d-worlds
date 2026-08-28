import { describe, expect, it } from "vitest";
import { activeSectionIndex, pickActiveSectionId } from "./formSectionProgress";

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

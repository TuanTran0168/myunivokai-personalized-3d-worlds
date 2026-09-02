import { describe, expect, it } from "vitest";
import { sharePagePath, worldFamilyFromQueryValue, worldPagePath } from "./worldRoutes";

// These paths are a published contract, not an internal detail: the backends'
// PUBLIC_WEB_URL is configured to match them, and every shareUrl already
// persisted in a database points at them. Changing one without changing the
// deployed env var breaks live share links, so it should break a test first.

describe("sharePagePath", () => {
  it("gives every family the same prefixed shape", () => {
    expect(sharePagePath("abc123", "universe")).toBe("/universe/share/worlds/abc123");
    expect(sharePagePath("abc123", "nature")).toBe("/nature/share/worlds/abc123");
  });

  it("keeps the two families symmetric", () => {
    const universePath = sharePagePath("same-slug", "universe");
    const naturePath = sharePagePath("same-slug", "nature");
    expect(universePath.replace("/universe/", "/nature/")).toBe(naturePath);
  });

  it("encodes slugs so a hostile slug cannot escape the route", () => {
    expect(sharePagePath("a/b?c=d#e", "universe")).toBe("/universe/share/worlds/a%2Fb%3Fc%3Dd%23e");
  });
});

describe("worldPagePath", () => {
  it("keeps universe on the bare path and tags nature with the family query", () => {
    expect(worldPagePath("world-1", "universe")).toBe("/worlds/world-1");
    expect(worldPagePath("world-1", "nature")).toBe("/worlds/world-1?family=nature");
  });
});

describe("worldFamilyFromQueryValue", () => {
  it("only treats an exact nature value as nature", () => {
    expect(worldFamilyFromQueryValue("nature")).toBe("nature");
    expect(worldFamilyFromQueryValue("universe")).toBe("universe");
    expect(worldFamilyFromQueryValue(null)).toBe("universe");
    expect(worldFamilyFromQueryValue("Nature")).toBe("universe");
  });
});

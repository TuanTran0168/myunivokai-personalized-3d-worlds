import { describe, expect, it } from "vitest";
import {
  GALLERY_DESTINATION,
  PERSONALIZATION_DESTINATION,
  returnDestinationsFrom
} from "./returnDestinations";

describe("returnDestinationsFrom", () => {
  it("offers both ways out from a screen that is neither of them", () => {
    expect(returnDestinationsFrom("/account")).toEqual([PERSONALIZATION_DESTINATION, GALLERY_DESTINATION]);
  });

  // The two cases that make this a function rather than a constant: a toast on
  // the create page must not offer the create page, and a toast on the gallery
  // must not offer the gallery.
  it("never offers the page it is being shown on", () => {
    expect(returnDestinationsFrom("/")).toEqual([GALLERY_DESTINATION]);
    expect(returnDestinationsFrom("/gallery")).toEqual([PERSONALIZATION_DESTINATION]);
  });

  it("reads a trailing slash, a query string and a hash as the same page", () => {
    expect(returnDestinationsFrom("/gallery/")).toEqual([PERSONALIZATION_DESTINATION]);
    expect(returnDestinationsFrom("/gallery?family=ocean")).toEqual([PERSONALIZATION_DESTINATION]);
    expect(returnDestinationsFrom("/gallery#top")).toEqual([PERSONALIZATION_DESTINATION]);
  });

  it("keeps the root path a path when it is stripped of its slash", () => {
    // "/" trimmed of trailing slashes is "", which would match nothing and let
    // the create page offer itself.
    expect(returnDestinationsFrom("/?family=nature")).toEqual([GALLERY_DESTINATION]);
  });

  // The labels are the owner's own words for these two screens, and the point
  // of asserting them is that they are what a person reads on a button. A
  // rename that says something else about where a link goes should have to
  // change a test.
  it("names the create form as the personalization and the gallery as the gallery", () => {
    expect(PERSONALIZATION_DESTINATION).toEqual({
      kind: "personalization",
      href: "/",
      label: "Back to your personalization"
    });
    expect(GALLERY_DESTINATION).toEqual({ kind: "gallery", href: "/gallery", label: "Back to your gallery" });
  });
});

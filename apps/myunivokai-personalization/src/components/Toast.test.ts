import { describe, expect, it } from "vitest";
import { TOAST_AUTO_DISMISS_MILLISECONDS, toastLifetimeMilliseconds } from "./Toast";

describe("toastLifetimeMilliseconds", () => {
  // A confirmation nobody read still happened.
  it("lets a success leave on its own", () => {
    expect(toastLifetimeMilliseconds("success")).toBe(TOAST_AUTO_DISMISS_MILLISECONDS);
  });

  // An error nobody read is an error nobody can act on, and one that vanishes
  // mid-sentence is worse than one that was never shown. This is the assertion
  // that stops "make them consistent" from being an easy change.
  it("keeps a failure until it is dismissed", () => {
    expect(toastLifetimeMilliseconds("error")).toBeNull();
  });

  it("gives a success long enough to read a sentence and click beside it", () => {
    expect(TOAST_AUTO_DISMISS_MILLISECONDS).toBeGreaterThanOrEqual(5000);
  });
});

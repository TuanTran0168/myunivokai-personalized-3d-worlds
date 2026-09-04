import { describe, expect, it } from "vitest";
import { UNIVERSE_MOOD_OPTIONS, UNIVERSE_STYLE_OPTIONS } from "@/features/world-form/worldFormOptions";
import { AUTH_BACKDROP_INPUTS, authBackdropSceneFor } from "./authBackdropScene";
import type { AuthCredentialsFormMode } from "./authCredentialsFormState";

const AUTH_MODES: AuthCredentialsFormMode[] = ["sign-in", "sign-up"];

describe("authBackdropSceneFor", () => {
  it("gives the same screen the same world every visit", () => {
    // A world that changed on every mistyped password would be the create
    // page's live preview, which is a different thing: this one is scenery.
    for (const mode of AUTH_MODES) {
      expect(authBackdropSceneFor(mode).seed).toBe(authBackdropSceneFor(mode).seed);
    }
  });

  it("gives the two screens different worlds", () => {
    // They are one route apart. An identical backdrop would make the link
    // between them look broken.
    expect(authBackdropSceneFor("sign-in").seed).not.toBe(authBackdropSceneFor("sign-up").seed);
  });

  // The ratchet that matters, and the reason these inputs are exported.
  // moodSceneProfile falls back to a neutral profile for a mood it does not
  // know and the style is only ever read here, so a typo in either would not
  // throw - it would render two nearly identical scenes and look like a
  // decision somebody made.
  it("only uses moods and styles the universe family declares", () => {
    const declaredMoods = UNIVERSE_MOOD_OPTIONS.map((option) => option.value);
    const declaredStyles = UNIVERSE_STYLE_OPTIONS.map((option) => option.value);
    for (const mode of AUTH_MODES) {
      expect(declaredMoods, `${mode} mood`).toContain(AUTH_BACKDROP_INPUTS[mode].mood);
      expect(declaredStyles, `${mode} style`).toContain(AUTH_BACKDROP_INPUTS[mode].preferredWorldStyle);
    }
  });

  it("builds a scene with planets to look at", () => {
    for (const mode of AUTH_MODES) {
      expect(authBackdropSceneFor(mode).planets?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

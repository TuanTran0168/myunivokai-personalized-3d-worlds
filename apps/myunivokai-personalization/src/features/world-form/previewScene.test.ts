import { describe, expect, it } from "vitest";
import { FOREST_SCENE_TYPE, OCEAN_SCENE_TYPE } from "@/lib/scene";
import { OCEAN_ZONE_SUNLIT_SHALLOWS } from "@/lib/oceanScene";
import { EMPTY_ACCOUNT_PROFILE, type AccountProfile } from "@/lib/accountProfile";
import { buildCreateFormPreviewScene, buildPreviewSceneForFamily } from "./previewScene";
import { createFormValuesFromProfile } from "./profileAutofill";
import { CREATE_FORM_INITIAL_VALUES, defaultStyleForFamily } from "./worldFormOptions";

const PREVIEW_INPUT = {
  nickname: "Neo",
  interests: ["Technology", "Design", "AI"],
  traits: ["curious", "builder", "focused"],
  mood: "focused",
  preferredWorldStyle: "cosmic-galaxy",
  favoriteColors: ["#8B5CF6", "#06B6D4"]
};

/**
 * Nicknames only, because the nickname is part of the preview seed: eleven
 * different oceans to assert the calm default over, rather than the one the
 * fixed input would give.
 */
const PREVIEW_SEED_NICKNAMES = ["Neo", "Tuan", "A", "Bob", "Zoe", "Mira", "Kai", "Ivy", "Q", "Lan", "Minh"];

/** A viewer above this is out of the water; ocean depth counts downward from it. */
const WATERLINE_METRES = 0;

function profileWith(change: Partial<AccountProfile>): AccountProfile {
  return { ...EMPTY_ACCOUNT_PROFILE, ...change };
}

describe("buildPreviewSceneForFamily", () => {
  it("builds a forest scene for the nature family", () => {
    expect(buildPreviewSceneForFamily("nature", PREVIEW_INPUT).sceneType).toBe(FOREST_SCENE_TYPE);
  });

  it("builds an ocean scene for the ocean family", () => {
    expect(buildPreviewSceneForFamily("ocean", PREVIEW_INPUT).sceneType).toBe(OCEAN_SCENE_TYPE);
  });

  // The universe family is the one with no sceneType: the renderer registry
  // reads that absence as "solar system", which is why it is asserted rather
  // than left implied.
  it("builds a universe scene with no sceneType for the universe family", () => {
    const scene = buildPreviewSceneForFamily("universe", PREVIEW_INPUT);
    expect(scene.sceneType).toBeUndefined();
    expect(scene.planets?.length).toBeGreaterThan(0);
  });

  // Only that the option reaches the ocean builder — what it then means for
  // the water is oceanScene.test.ts's subject, not this router's. Asserted
  // over several seeds, with the second expectation there to prove the first
  // one is worth making: without it, a run where every seed happened to
  // surface on its own would pass while the option was being dropped.
  it("passes the calm-surface default through to the ocean builder", () => {
    const oceanInputs = PREVIEW_SEED_NICKNAMES.map((nickname) => ({ ...PREVIEW_INPUT, nickname }));
    for (const input of oceanInputs) {
      const calm = buildPreviewSceneForFamily("ocean", input, { showCalmSurfaceDefault: true });
      expect(calm.depth?.zone).toBe(OCEAN_ZONE_SUNLIT_SHALLOWS);
      expect(calm.depth?.metres).toBeLessThan(WATERLINE_METRES);
    }
    const rolledDepths = oceanInputs.map((input) => buildPreviewSceneForFamily("ocean", input).depth?.metres ?? 0);
    expect(rolledDepths.some((metres) => metres > WATERLINE_METRES)).toBe(true);
  });
});

describe("buildCreateFormPreviewScene", () => {
  // The bug this whole module exists to make impossible: a saved preferred
  // family that filled the form's picker and left the world alone.
  it("renders the family the profile prefers, not the form's default", () => {
    const values = createFormValuesFromProfile(
      profileWith({
        preferredWorldFamily: "ocean",
        creationDefaults: { ...EMPTY_ACCOUNT_PROFILE.creationDefaults, preferredWorldStyle: "" }
      }),
      CREATE_FORM_INITIAL_VALUES
    );
    expect(values.preferredWorldStyle).toBe(defaultStyleForFamily("ocean"));
    expect(buildCreateFormPreviewScene(values).sceneType).toBe(OCEAN_SCENE_TYPE);
  });

  it("renders the forest for a nature profile", () => {
    const values = createFormValuesFromProfile(profileWith({ preferredWorldFamily: "nature" }), CREATE_FORM_INITIAL_VALUES);
    expect(buildCreateFormPreviewScene(values).sceneType).toBe(FOREST_SCENE_TYPE);
  });

  // An empty profile is the common case — the page is opened before it has
  // ever been saved — and it has to land on exactly what the create form shows
  // a signed-out visitor.
  it("falls back to the create form's own world for an empty profile", () => {
    const values = createFormValuesFromProfile(EMPTY_ACCOUNT_PROFILE, CREATE_FORM_INITIAL_VALUES);
    expect(values).toEqual(CREATE_FORM_INITIAL_VALUES);
    expect(buildCreateFormPreviewScene(values).sceneType).toBeUndefined();
  });

  // The account path and the manual path have to land on the SAME world.
  // A profile that prefers the ocean is not a form nobody has touched, so its
  // preview rolls a depth — exactly as it does for a signed-out visitor who
  // clicks Ocean in the picker.
  it("lands on the same ocean a visitor picking it by hand would get", () => {
    const fromProfile = createFormValuesFromProfile(
      profileWith({ preferredWorldFamily: "ocean" }),
      CREATE_FORM_INITIAL_VALUES
    );
    const pickedByHand = {
      ...CREATE_FORM_INITIAL_VALUES,
      worldFamily: "ocean" as const,
      preferredWorldStyle: defaultStyleForFamily("ocean")
    };
    expect(fromProfile).toEqual(pickedByHand);
    expect(buildCreateFormPreviewScene(fromProfile).depth?.zone).toBe(
      buildCreateFormPreviewScene(pickedByHand).depth?.zone
    );
  });
});

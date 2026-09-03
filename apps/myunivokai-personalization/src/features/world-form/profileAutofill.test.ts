import { describe, expect, it } from "vitest";
import { EMPTY_ACCOUNT_PROFILE, type AccountProfile } from "@/lib/accountProfile";
import { createFormValuesFromProfile, isCreateFormPristine } from "./profileAutofill";
import { CREATE_FORM_INITIAL_VALUES, type CreateFormValues } from "./worldFormOptions";

function pristineValues(): CreateFormValues {
  return { ...CREATE_FORM_INITIAL_VALUES };
}

function profileWith(change: Partial<AccountProfile>): AccountProfile {
  return {
    ...EMPTY_ACCOUNT_PROFILE,
    ...change,
    creationDefaults: { ...EMPTY_ACCOUNT_PROFILE.creationDefaults, ...(change.creationDefaults ?? {}) }
  };
}

describe("whether the form may be filled from a profile", () => {
  it("is pristine when nothing has been touched", () => {
    expect(isCreateFormPristine(pristineValues())).toBe(true);
  });

  // The subtlety worth a test rather than a comment: the display name is
  // filled from storage before the profile request answers, so a filled
  // nickname must not make the form look edited.
  it("is still pristine after the display name has been filled in", () => {
    expect(isCreateFormPristine({ ...pristineValues(), nickname: "Neo" })).toBe(true);
  });

  it("is not pristine once any other field has changed", () => {
    expect(isCreateFormPristine({ ...pristineValues(), goal: "Ship the thing" })).toBe(false);
    expect(isCreateFormPristine({ ...pristineValues(), interests: ["Art"] })).toBe(false);
    expect(isCreateFormPristine({ ...pristineValues(), worldFamily: "ocean" })).toBe(false);
    expect(isCreateFormPristine({ ...pristineValues(), favoriteColors: ["#8B5CF6"] })).toBe(false);
  });

  // Same items, different order, is a change: the palette's order is what the
  // preview renders, so treating it as unchanged would let autofill overwrite
  // a deliberate reordering.
  it("treats a reordered list as changed", () => {
    expect(
      isCreateFormPristine({ ...pristineValues(), interests: ["AI", "Design", "Technology"] })
    ).toBe(false);
  });
});

describe("applying a saved profile to the form", () => {
  it("uses every field the profile has an answer for", () => {
    const filled = createFormValuesFromProfile(
      profileWith({
        displayName: "Neo",
        preferredWorldFamily: "ocean",
        creationDefaults: {
          nickname: "Neo",
          role: "Explorer",
          goal: "Chart the shelf",
          challenge: "Time",
          interests: ["Art", "Music"],
          traits: ["calm"],
          mood: "dreamy",
          favoriteColors: ["#F97316"],
          preferredWorldStyle: "coral-garden"
        }
      }),
      pristineValues()
    );

    expect(filled).toEqual({
      nickname: "Neo",
      role: "Explorer",
      goal: "Chart the shelf",
      challenge: "Time",
      interests: ["Art", "Music"],
      traits: ["calm"],
      mood: "dreamy",
      worldFamily: "ocean",
      preferredWorldStyle: "coral-garden",
      favoriteColors: ["#F97316"]
    });
  });

  // The asymmetry that makes an unfinished profile useful rather than
  // destructive: an empty saved field stops overriding, it does not clear.
  it("leaves the form's own defaults where the profile says nothing", () => {
    const filled = createFormValuesFromProfile(profileWith({ displayName: "Neo" }), pristineValues());

    expect(filled.interests).toEqual(CREATE_FORM_INITIAL_VALUES.interests);
    expect(filled.traits).toEqual(CREATE_FORM_INITIAL_VALUES.traits);
    expect(filled.favoriteColors).toEqual(CREATE_FORM_INITIAL_VALUES.favoriteColors);
    expect(filled.mood).toBe(CREATE_FORM_INITIAL_VALUES.mood);
    expect(filled.worldFamily).toBe(CREATE_FORM_INITIAL_VALUES.worldFamily);
    expect(filled.goal).toBe("");
    expect(filled.nickname).toBe("Neo");
  });

  // A style belongs to exactly one family. Applying a saved family without
  // giving it a style of its own would leave the previous family's style
  // behind, and posting that pair is a 400 from the gateway.
  it("gives a saved family its own neutral style when no style was saved", () => {
    const filled = createFormValuesFromProfile(
      profileWith({ preferredWorldFamily: "nature" }),
      pristineValues()
    );

    expect(filled.worldFamily).toBe("nature");
    expect(filled.preferredWorldStyle).toBe("wildwood");
  });

  it("does not apply a saved style when no family was saved", () => {
    const filled = createFormValuesFromProfile(
      profileWith({ creationDefaults: { ...EMPTY_ACCOUNT_PROFILE.creationDefaults, preferredWorldStyle: "nebula" } }),
      pristineValues()
    );

    expect(filled.worldFamily).toBe(CREATE_FORM_INITIAL_VALUES.worldFamily);
    expect(filled.preferredWorldStyle).toBe(CREATE_FORM_INITIAL_VALUES.preferredWorldStyle);
  });

  it("keeps a nickname already in the form when the profile has no display name", () => {
    const filled = createFormValuesFromProfile(profileWith({}), { ...pristineValues(), nickname: "Typed" });

    expect(filled.nickname).toBe("Typed");
  });
});

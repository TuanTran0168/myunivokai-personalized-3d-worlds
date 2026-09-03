import { describe, expect, it } from "vitest";
import { buildCreateWorldPayload } from "./createWorldPayload";
import { CREATE_FORM_INITIAL_VALUES, MAXIMUM_GOAL_LENGTH, type CreateFormValues } from "./worldFormOptions";

function valuesWith(change: Partial<CreateFormValues>): CreateFormValues {
  return { ...CREATE_FORM_INITIAL_VALUES, ...change };
}

describe("buildCreateWorldPayload", () => {
  // What a first-time visitor sends by pressing the button and typing nothing.
  // These fallbacks are the reason the form is usable empty, so they are
  // asserted as values rather than left to the reader of the function.
  it("fills the empty fields the form opens with", () => {
    const payload = buildCreateWorldPayload(CREATE_FORM_INITIAL_VALUES);
    expect(payload.nickname).toBe("Neo");
    expect(payload.role).toBe("Explorer");
    expect(payload.challenge).toBeUndefined();
    expect(payload.goal).toBe("Build a personal universe around Technology, Design, AI with a curious energy.");
  });

  it("keeps what the visitor actually typed, trimmed", () => {
    const payload = buildCreateWorldPayload(
      valuesWith({ nickname: "  Tuấn  ", role: " Builder ", goal: " Ship the thing ", challenge: " I overthink " })
    );
    expect(payload.nickname).toBe("Tuấn");
    expect(payload.role).toBe("Builder");
    expect(payload.goal).toBe("Ship the thing");
    expect(payload.challenge).toBe("I overthink");
  });

  // The written-for-you goal names the interests it was written from, so a
  // custom selection has to reach it — this is what makes two different forms
  // produce two different worlds rather than one boilerplate sentence.
  it("writes the goal from the visitor's own interests and traits", () => {
    const payload = buildCreateWorldPayload(
      valuesWith({ interests: ["Music", "Sailing", "Ceramics"], traits: ["patient", "curious", "quiet"] })
    );
    expect(payload.goal).toBe("Build a personal universe around Music, Sailing, Ceramics with a patient energy.");
  });

  it("never exceeds the goal ceiling the backend enforces", () => {
    const payload = buildCreateWorldPayload(valuesWith({ goal: "x".repeat(MAXIMUM_GOAL_LENGTH * 2) }));
    expect(payload.goal).toHaveLength(MAXIMUM_GOAL_LENGTH);
  });

  // Below the minimum the form's own defaults pad the selection, so the world
  // is built from three interests even when one was chosen. Padding, not
  // replacement: the chosen one stays first.
  it("pads a short selection with the form's defaults", () => {
    const payload = buildCreateWorldPayload(valuesWith({ interests: ["Sailing"], traits: ["patient"] }));
    expect(payload.interests).toEqual(["Sailing", "Technology", "Design"]);
    expect(payload.traits).toEqual(["patient", "curious", "builder"]);
  });

  it("falls back to one colour when the palette is empty", () => {
    expect(buildCreateWorldPayload(valuesWith({ favoriteColors: [] })).favoriteColors).toEqual(["#8B5CF6"]);
  });

  // The family is NOT part of the payload: it picks the route the payload is
  // posted to. A field for it here would be a second place to get it wrong.
  it("carries no world family", () => {
    expect(buildCreateWorldPayload(valuesWith({ worldFamily: "ocean" }))).not.toHaveProperty("worldFamily");
  });
});

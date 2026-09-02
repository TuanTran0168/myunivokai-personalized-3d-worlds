import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EXPANDED_FORM_RAIL_COLLAPSE_STATE,
  FORM_RAIL_COLLAPSE_DURATION_MILLISECONDS,
  FORM_RAIL_ELEMENT_ID,
  FORM_RAIL_HIDE_LABEL,
  FORM_RAIL_SHOW_LABEL,
  FORM_RAIL_TOGGLE_ACCESSIBLE_LABEL,
  IMMERSIVE_WORLD_BODY_ATTRIBUTE,
  WORLD_FAMILY_BODY_ATTRIBUTE,
  WORLD_PANELS_ELEMENT_ID,
  worldChromeToggleAccessibleLabel,
  formRailLayoutReleaseDelayMilliseconds,
  formRailStateAfterErrorChange,
  formRailToggleLabel,
  releaseFormRailLayoutSpace,
  toggleFormRailCollapseState
} from "./formRailCollapse";

// The id the create form itself uses (CREATE_FORM_ELEMENT_ID in app/page.tsx).
// Duplicated here on purpose: the point of the assertion below is that the two
// ids are independent, so importing the page's constant would defeat it.
const CREATE_FORM_ELEMENT_ID = "create-universe-form";

const COLLAPSED_WITH_SPACE_RESERVED = { isExpanded: false, reservesLayoutSpace: true };
const COLLAPSED_WITHOUT_SPACE = { isExpanded: false, reservesLayoutSpace: false };

describe("toggleFormRailCollapseState", () => {
  it("collapses without releasing the layout space in the same update", () => {
    // Releasing it here would make the mobile page jump while the panel is
    // still fully visible.
    expect(toggleFormRailCollapseState(EXPANDED_FORM_RAIL_COLLAPSE_STATE)).toEqual(COLLAPSED_WITH_SPACE_RESERVED);
  });

  it("restores the layout space in the same update that starts the slide back", () => {
    // The browser needs a rendered box to transition from.
    expect(toggleFormRailCollapseState(COLLAPSED_WITHOUT_SPACE)).toEqual(EXPANDED_FORM_RAIL_COLLAPSE_STATE);
  });

  it("returns to the expanded default across a full round trip", () => {
    const collapsed = toggleFormRailCollapseState(EXPANDED_FORM_RAIL_COLLAPSE_STATE);
    const settled = releaseFormRailLayoutSpace(collapsed);
    expect(toggleFormRailCollapseState(settled)).toEqual(EXPANDED_FORM_RAIL_COLLAPSE_STATE);
  });

  it("starts the create page with the form visible", () => {
    expect(EXPANDED_FORM_RAIL_COLLAPSE_STATE).toEqual({ isExpanded: true, reservesLayoutSpace: true });
  });
});

describe("releaseFormRailLayoutSpace", () => {
  it("drops the collapsed rail out of the document flow", () => {
    expect(releaseFormRailLayoutSpace(COLLAPSED_WITH_SPACE_RESERVED)).toEqual(COLLAPSED_WITHOUT_SPACE);
  });

  it("leaves a re-expanded rail untouched, by identity", () => {
    // A user who presses the button twice inside the slide duration must not
    // have the rail yanked out of the layout by the pending timer; the same
    // reference also lets React bail out of the re-render.
    expect(releaseFormRailLayoutSpace(EXPANDED_FORM_RAIL_COLLAPSE_STATE)).toBe(EXPANDED_FORM_RAIL_COLLAPSE_STATE);
  });

  it("is idempotent, by identity", () => {
    const released = releaseFormRailLayoutSpace(COLLAPSED_WITH_SPACE_RESERVED);
    expect(releaseFormRailLayoutSpace(released)).toBe(released);
  });
});

describe("formRailLayoutReleaseDelayMilliseconds", () => {
  it("waits for the slide, or not at all under reduced motion", () => {
    // Locks the reduced-motion contract: the stylesheet's `transition: none`
    // path and this timer must agree, or the box outlives an instant hide.
    expect(formRailLayoutReleaseDelayMilliseconds(false)).toBe(FORM_RAIL_COLLAPSE_DURATION_MILLISECONDS);
    expect(formRailLayoutReleaseDelayMilliseconds(true)).toBe(0);
  });
});

describe("formRailStateAfterErrorChange", () => {
  it("reopens a collapsed rail so the error is visible", () => {
    // StatusMessage renders inside the collapsing region; without this a create
    // failure would be reported into a visibility:hidden panel.
    expect(formRailStateAfterErrorChange(COLLAPSED_WITHOUT_SPACE, "Gateway unreachable")).toEqual(
      EXPANDED_FORM_RAIL_COLLAPSE_STATE
    );
  });

  it("does not reopen a rail the user collapsed while no error exists, by identity", () => {
    expect(formRailStateAfterErrorChange(COLLAPSED_WITHOUT_SPACE, "")).toBe(COLLAPSED_WITHOUT_SPACE);
  });

  it("leaves an already-open rail alone, by identity", () => {
    expect(formRailStateAfterErrorChange(EXPANDED_FORM_RAIL_COLLAPSE_STATE, "Gateway unreachable")).toBe(
      EXPANDED_FORM_RAIL_COLLAPSE_STATE
    );
  });
});

describe("toggle labelling", () => {
  it("changes the visible label with the state", () => {
    expect(formRailToggleLabel(true)).toBe(FORM_RAIL_HIDE_LABEL);
    expect(formRailToggleLabel(false)).toBe(FORM_RAIL_SHOW_LABEL);
  });

  it("keeps the accessible name stable across both states", () => {
    // aria-expanded announces the state; a name that changed too would announce
    // it twice, and contradictorily.
    expect(FORM_RAIL_TOGGLE_ACCESSIBLE_LABEL).not.toBe(FORM_RAIL_HIDE_LABEL);
    expect(FORM_RAIL_TOGGLE_ACCESSIBLE_LABEL).not.toBe(FORM_RAIL_SHOW_LABEL);
  });

  it("names the actual thing each page hides", () => {
    // The create page hides a form; the world and share pages hide HUD islands.
    // One vague label like "interface" on all three would be worse than naming
    // what the user is looking at.
    expect(formRailToggleLabel(true, "panels")).toBe("Hide the panels");
    expect(formRailToggleLabel(false, "panels")).toBe("Show the panels");
    expect(formRailToggleLabel(true, "form")).toBe(FORM_RAIL_HIDE_LABEL);
  });

  it("gives each region a distinct accessible name and a distinct id", () => {
    // Two regions on two pages controlled by the same component; a shared id
    // would make aria-controls point at the wrong element on one of them.
    expect(worldChromeToggleAccessibleLabel("panels")).not.toBe(FORM_RAIL_TOGGLE_ACCESSIBLE_LABEL);
    expect(worldChromeToggleAccessibleLabel("panels")).not.toBe(formRailToggleLabel(true, "panels"));
    expect(WORLD_PANELS_ELEMENT_ID).not.toBe("");
    expect(WORLD_PANELS_ELEMENT_ID).not.toBe(FORM_RAIL_ELEMENT_ID);
  });

  it("does not reuse the create form's own element id", () => {
    // CREATE_FORM_ELEMENT_ID wires the submit button back to the <form> it sits
    // outside of; the aria-controls target must never collide with it.
    expect(FORM_RAIL_ELEMENT_ID).not.toBe("");
    expect(FORM_RAIL_ELEMENT_ID).not.toBe(CREATE_FORM_ELEMENT_ID);
  });
});

describe("stylesheet agreement", () => {
  const globalStylesheet = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

  it("declares the same collapse duration the layout-release timer uses", () => {
    // The one automated check that keeps the CSS transition and the JS timer
    // from drifting apart; drift shows up only as a flash of the empty box.
    const declaredDuration = /--form-rail-collapse-duration:\s*(\d+)ms/.exec(globalStylesheet);
    expect(declaredDuration).not.toBeNull();
    expect(Number(declaredDuration?.[1])).toBe(FORM_RAIL_COLLAPSE_DURATION_MILLISECONDS);
  });

  it("hides the shared chrome from the same body marker the page sets", () => {
    // The header and footer live in the shared layout, so the page reaches them
    // only through this attribute. Rename the constant without renaming the
    // selector and the chrome silently stops leaving — the form hides, the
    // header stays, and nothing fails.
    expect(globalStylesheet).toContain(`body[${IMMERSIVE_WORLD_BODY_ATTRIBUTE}="true"]`);
  });

  it("retints the accent from the same family marker the page sets", () => {
    // Same contract-with-no-compiler as the immersive marker: rename one side
    // and a forest silently keeps the universe's brass.
    expect(globalStylesheet).toContain(`body[${WORLD_FAMILY_BODY_ATTRIBUTE}="nature"]`);
    expect(globalStylesheet).toContain("--brass-rgb:");
  });

  it("hoists the house easing curve instead of writing it a third time", () => {
    expect(globalStylesheet).toContain("--glass-easing:");
    const houseCurveOccurrences = globalStylesheet.split("cubic-bezier(0.22, 0.61, 0.36, 1)").length - 1;
    expect(houseCurveOccurrences).toBe(1);
  });
});

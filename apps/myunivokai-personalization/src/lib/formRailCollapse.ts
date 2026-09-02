/**
 * State for the create page's one-button form collapse, extracted from
 * app/page.tsx so its behavior can be locked by tests (same reason as
 * formSelection.ts). Pure: no React, no DOM, no timers.
 *
 * The rail is never unmounted. Collapsing it slides a wrapper off-canvas and
 * flips `visibility`, so every field keeps the value the user typed and the
 * WebGL canvas is never re-created.
 */

/**
 * Slide duration. Not a new number: `.glass-panel` / `.liquid-glass` already
 * transition transform over 320ms in globals.css, so the rail leaves on the
 * house panel-motion signature. The stylesheet declares the same value as
 * `--form-rail-collapse-duration`; formRailCollapse.test.ts parses globals.css
 * and fails if the two ever drift.
 *
 * The 560ms `glass-rise` entrance is deliberately NOT reused: an entrance plays
 * once, a toggle is pressed repeatedly and must feel immediate.
 */
export const FORM_RAIL_COLLAPSE_DURATION_MILLISECONDS = 320;

export const REDUCED_MOTION_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Hiding the form clears the whole interface, not just the rail: the header and
 * footer live in the shared layout, which is an ancestor of the page, and CSS
 * cannot reach an ancestor. So the page marks `document.body` while it is in
 * this state and the stylesheet hides every chrome surface from there.
 *
 * The page must clear the attribute when it unmounts, or navigating away leaves
 * the rest of the app with no header.
 */
export const IMMERSIVE_WORLD_BODY_ATTRIBUTE = "data-world-immersive";

/**
 * The world family, published for the same reason and by the same route: the
 * metallic accent is family-dependent (brass for the universe, copper for the
 * forest) and the header and footer have to follow it, but they are not the
 * page's descendants. The stylesheet reads it as `body[data-world-family=...]`
 * and retints every accent by redefining two variables.
 */
export const WORLD_FAMILY_BODY_ATTRIBUTE = "data-world-family";

/**
 * The id of the collapsing wrapper, used as the toggle's `aria-controls`
 * target. It must never collide with CREATE_FORM_ELEMENT_ID in page.tsx, which
 * is load-bearing: the submit button lives outside the <form> and is re-attached
 * to it by the HTML `form` attribute.
 */
export const FORM_RAIL_ELEMENT_ID = "create-universe-form-rail";
export const WORLD_PANELS_ELEMENT_ID = "world-chrome-panels";

/**
 * What the toggle hides on a given page. The create page hides a form; the world
 * and share pages hide the HUD islands. The mechanism is identical — only the
 * noun the user is shown differs, and naming the actual thing beats one vague
 * label like "interface" on all three.
 */
export type WorldChromeNoun = "form" | "panels";

/**
 * The accessible name stays constant across both states; the state itself is
 * announced once, by `aria-expanded`. A name that changed with the state would
 * make a screen reader announce the state twice, and contradictorily.
 */
const ACCESSIBLE_LABEL_BY_NOUN: Record<WorldChromeNoun, string> = {
  form: "Create-world form",
  panels: "World information panels"
};
const HIDE_LABEL_BY_NOUN: Record<WorldChromeNoun, string> = {
  form: "Hide the form",
  panels: "Hide the panels"
};
const SHOW_LABEL_BY_NOUN: Record<WorldChromeNoun, string> = {
  form: "Show the form",
  panels: "Show the panels"
};

export const FORM_RAIL_TOGGLE_ACCESSIBLE_LABEL = ACCESSIBLE_LABEL_BY_NOUN.form;
export const FORM_RAIL_HIDE_LABEL = HIDE_LABEL_BY_NOUN.form;
export const FORM_RAIL_SHOW_LABEL = SHOW_LABEL_BY_NOUN.form;

export function worldChromeToggleAccessibleLabel(noun: WorldChromeNoun): string {
  return ACCESSIBLE_LABEL_BY_NOUN[noun];
}

/**
 * `isExpanded` drives the slide; `reservesLayoutSpace` keeps the rail's box in
 * the mobile document flow until the slide has finished.
 *
 * They are separate because a transform does not affect layout: if the box were
 * removed in the same update that starts the slide, everything below it on
 * mobile would jump while the panel was still fully visible.
 */
export type FormRailCollapseState = {
  isExpanded: boolean;
  reservesLayoutSpace: boolean;
};

export const EXPANDED_FORM_RAIL_COLLAPSE_STATE: FormRailCollapseState = {
  isExpanded: true,
  reservesLayoutSpace: true
};

/**
 * The one button's action. Expanding restores the layout box in the SAME update
 * that starts the slide back, so the browser always has a rendered box to
 * transition from — there is no priming frame to get wrong.
 */
export function toggleFormRailCollapseState(current: FormRailCollapseState): FormRailCollapseState {
  return { isExpanded: !current.isExpanded, reservesLayoutSpace: true };
}

/**
 * Drops the collapsed rail out of the mobile document flow, once the slide has
 * played. Returns the identical reference when there is nothing to do, so React
 * bails out of the re-render — which is also what protects a user who re-expands
 * before the timer fires from having the rail yanked out from under them.
 */
export function releaseFormRailLayoutSpace(current: FormRailCollapseState): FormRailCollapseState {
  if (current.isExpanded || !current.reservesLayoutSpace) {
    return current;
  }
  return { isExpanded: false, reservesLayoutSpace: false };
}

/**
 * How long to wait before releasing the layout space. Reduced motion has no
 * slide to wait for, so the box is released in the same tick — keeping this in
 * agreement with the stylesheet's `transition: none`.
 */
export function formRailLayoutReleaseDelayMilliseconds(prefersReducedMotion: boolean): number {
  return prefersReducedMotion ? 0 : FORM_RAIL_COLLAPSE_DURATION_MILLISECONDS;
}

/**
 * Reopens the rail when an error appears. The error surface (StatusMessage) sits
 * inside the collapsing region, above the submit button, so a create failure or
 * a failed pending-job resume would otherwise render into a hidden region and
 * the user would see nothing happen at all.
 *
 * Returning the identical reference when there is no error — or when the rail is
 * already open — means a user can still collapse a rail that is showing an old
 * error.
 */
export function formRailStateAfterErrorChange(
  current: FormRailCollapseState,
  errorMessage: string
): FormRailCollapseState {
  if (!errorMessage) {
    return current;
  }
  if (current.isExpanded && current.reservesLayoutSpace) {
    return current;
  }
  return EXPANDED_FORM_RAIL_COLLAPSE_STATE;
}

/** The visible label on the button, which does change with the state. */
export function formRailToggleLabel(isExpanded: boolean, noun: WorldChromeNoun = "form"): string {
  return isExpanded ? HIDE_LABEL_BY_NOUN[noun] : SHOW_LABEL_BY_NOUN[noun];
}

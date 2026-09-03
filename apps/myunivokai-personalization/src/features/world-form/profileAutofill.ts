import type { AccountProfile } from "@/lib/accountProfile";
import { CREATE_FORM_INITIAL_VALUES, defaultStyleForFamily, type CreateFormValues } from "./worldFormOptions";

/**
 * Whether the create form is still holding exactly what it opened with.
 *
 * This is the whole condition under which a saved profile is allowed to fill
 * the form. The profile arrives from the network a moment after the page
 * mounts, and in that moment somebody may already have started typing —
 * overwriting what they wrote would be the worst possible reading of "fill the
 * form for me".
 *
 * NICKNAME IS EXCLUDED, and that is the one subtlety here. The display name is
 * filled immediately from the session copy already in storage, with no request
 * at all, because the owner's rule is that the name fills by DEFAULT rather
 * than only when the toggle is on. So by the time the profile answers, the
 * nickname has legitimately changed and the form is still untouched by the
 * visitor.
 */
export function isCreateFormPristine(values: CreateFormValues): boolean {
  return (
    values.role === CREATE_FORM_INITIAL_VALUES.role &&
    values.goal === CREATE_FORM_INITIAL_VALUES.goal &&
    values.challenge === CREATE_FORM_INITIAL_VALUES.challenge &&
    values.mood === CREATE_FORM_INITIAL_VALUES.mood &&
    values.worldFamily === CREATE_FORM_INITIAL_VALUES.worldFamily &&
    values.preferredWorldStyle === CREATE_FORM_INITIAL_VALUES.preferredWorldStyle &&
    haveSameItems(values.interests, CREATE_FORM_INITIAL_VALUES.interests) &&
    haveSameItems(values.traits, CREATE_FORM_INITIAL_VALUES.traits) &&
    haveSameItems(values.favoriteColors, CREATE_FORM_INITIAL_VALUES.favoriteColors)
  );
}

/**
 * The create form's values with the account's saved defaults applied.
 *
 * A profile field OVERRIDES only where it has an answer. An empty saved goal
 * leaves the form's own empty goal; an empty saved interest list leaves the
 * three the form opens with, rather than replacing a working starting point
 * with nothing. That asymmetry is the difference between "these are my
 * defaults" and "clear the form" — the profile page is where somebody clears
 * a field, and the effect of clearing it is to stop overriding.
 *
 * The world family is applied with its style, never separately: a style
 * belongs to exactly one family, so a saved style is used only when the saved
 * family is the family it belongs to, and a saved family with no saved style
 * falls back to that family's own neutral style. Posting the wrong pair is a
 * 400 from the gateway.
 *
 * Pure, and it takes the current values rather than reading state, so the rule
 * can be tested without a browser.
 */
export function createFormValuesFromProfile(
  profile: AccountProfile,
  currentValues: CreateFormValues
): CreateFormValues {
  const defaults = profile.creationDefaults;
  const nextValues: CreateFormValues = {
    ...currentValues,
    nickname: profile.displayName.trim() || currentValues.nickname,
    role: defaults.role?.trim() || currentValues.role,
    goal: defaults.goal.trim() || currentValues.goal,
    challenge: defaults.challenge?.trim() || currentValues.challenge,
    interests: defaults.interests.length > 0 ? defaults.interests : currentValues.interests,
    traits: defaults.traits.length > 0 ? defaults.traits : currentValues.traits,
    favoriteColors: defaults.favoriteColors.length > 0 ? defaults.favoriteColors : currentValues.favoriteColors
  };

  if (profile.preferredWorldFamily) {
    nextValues.worldFamily = profile.preferredWorldFamily;
    nextValues.preferredWorldStyle =
      defaults.preferredWorldStyle.trim() || defaultStyleForFamily(profile.preferredWorldFamily);
  }
  // Mood is per-family but shares one vocabulary of four values across all
  // three families (see FAMILY_COPY), so unlike the style it needs no family
  // agreement to be applied.
  if (defaults.mood.trim()) {
    nextValues.mood = defaults.mood.trim();
  }
  return nextValues;
}

function haveSameItems(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

import { ensureRange } from "@/lib/formSelection";
import type { CreateWorldInput } from "@/lib/types";
import {
  CREATE_FORM_INITIAL_VALUES,
  MAXIMUM_GOAL_LENGTH,
  MAXIMUM_INTERESTS,
  MAXIMUM_TRAITS,
  MINIMUM_INTERESTS,
  MINIMUM_TRAITS,
  type CreateFormValues
} from "./worldFormOptions";

/**
 * What an empty field is worth when the form is submitted anyway. None of
 * these are validation: every one of them is a value the world can actually be
 * built from, chosen so that a visitor who fills in nothing still gets a world
 * rather than a list of complaints.
 */
const FALLBACK_NICKNAME = "Neo";
const FALLBACK_ROLE = "Explorer";
/** One colour, not the form's own two — the generated palette derives the rest. */
const FALLBACK_FAVORITE_COLOR = "#8B5CF6";
/** How many interests the written-for-you goal names before it stops listing. */
const GOAL_SUMMARY_INTEREST_COUNT = 3;

/**
 * The form's values as the request the backend receives.
 *
 * Extracted from the create page because a SECOND screen now has to answer
 * "what would the create form send" — the account page, whose backdrop is the
 * world its saved defaults would produce. The alternative was a second copy of
 * these fallbacks, which is how a profile comes to preview a world that is not
 * the one it creates.
 *
 * The live preview is built from this rather than from the raw fields, so the
 * scene on screen has the planet count and the names the generated world will
 * have. That coupling is the reason the sanitising lives in ONE function: a
 * fallback applied on the way to the server but not on the way to the preview
 * would show a world nobody is going to get.
 */
export function buildCreateWorldPayload(values: CreateFormValues): CreateWorldInput {
  const safeInterests = ensureRange(
    values.interests,
    CREATE_FORM_INITIAL_VALUES.interests,
    MINIMUM_INTERESTS,
    MAXIMUM_INTERESTS
  );
  const safeTraits = ensureRange(values.traits, CREATE_FORM_INITIAL_VALUES.traits, MINIMUM_TRAITS, MAXIMUM_TRAITS);
  const safeGoal =
    values.goal.trim() ||
    `Build a personal universe around ${safeInterests.slice(0, GOAL_SUMMARY_INTEREST_COUNT).join(", ")} with a ${
      safeTraits[0]
    } energy.`;

  return {
    nickname: values.nickname.trim() || FALLBACK_NICKNAME,
    role: values.role.trim() || FALLBACK_ROLE,
    interests: safeInterests,
    traits: safeTraits,
    goal: safeGoal.slice(0, MAXIMUM_GOAL_LENGTH),
    challenge: values.challenge.trim() || undefined,
    mood: values.mood,
    favoriteColors: values.favoriteColors.length ? values.favoriteColors : [FALLBACK_FAVORITE_COLOR],
    preferredWorldStyle: values.preferredWorldStyle
  };
}

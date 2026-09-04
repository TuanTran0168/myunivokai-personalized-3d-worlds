import { authorizedGatewayRequest } from "./productAuth";
import type { GatewayRequestHooks } from "./api";
import type { CreateWorldInput, WorldFamily } from "./types";

const ACCOUNT_PROFILE_PATH = "/api/me/profile";

/**
 * The gender vocabulary the backend admits, mirroring contracts.AccountGender.
 *
 * A closed set rather than free text, so the words shown here can be chosen —
 * and translated — separately from the value stored. `""` is the default and
 * means unanswered; `prefer_not_to_say` is an ANSWER, and the two are
 * deliberately different: collapsing them would make "I would rather not say"
 * indistinguishable from "I have not opened this page".
 */
export const ACCOUNT_GENDERS = ["", "female", "male", "non_binary", "other", "prefer_not_to_say"] as const;

export type AccountGender = (typeof ACCOUNT_GENDERS)[number];

export const ACCOUNT_GENDER_LABELS: Record<AccountGender, string> = {
  "": "Prefer to leave blank",
  female: "Female",
  male: "Male",
  non_binary: "Non-binary",
  other: "Other",
  prefer_not_to_say: "Prefer not to say"
};

/**
 * The account's own page.
 *
 * `creationDefaults` is `CreateWorldInput` — the very type the generate call
 * takes — because that is what it is: the create form's fields, saved. It
 * mirrors contracts.AccountProfileData, whose Go side reuses WorldInput for
 * the same reason.
 *
 * `displayName` and `creationDefaults.nickname` always hold the SAME value.
 * There is one name, stored once in `accounts.name`, and the server projects
 * it into both: once where this page edits it, once inside the block the
 * create form copies wholesale.
 *
 * `preferredWorldFamily` is `""` when no family has been chosen, which is a
 * valid saved state and not a missing one.
 */
export type AccountProfile = {
  displayName: string;
  fullName: string;
  gender: AccountGender;
  preferredWorldFamily: WorldFamily | "";
  creationDefaults: CreateWorldInput;
  autofillCreateForm: boolean;
};

/**
 * What an account that has never saved its page looks like, for the one render
 * before the server answers.
 *
 * `autofillCreateForm` is true here, matching both the server's empty profile
 * and the column default. Somebody who fills their profile in should see it
 * used without hunting for a second switch; the switch exists to turn that
 * off.
 */
export const EMPTY_ACCOUNT_PROFILE: AccountProfile = {
  displayName: "",
  fullName: "",
  gender: "",
  preferredWorldFamily: "",
  autofillCreateForm: true,
  creationDefaults: {
    nickname: "",
    role: "",
    interests: [],
    traits: [],
    goal: "",
    challenge: "",
    mood: "",
    favoriteColors: [],
    preferredWorldStyle: ""
  }
};

export async function fetchAccountProfile(hooks?: GatewayRequestHooks): Promise<AccountProfile> {
  return authorizedGatewayRequest<AccountProfile>(ACCOUNT_PROFILE_PATH, undefined, hooks);
}

/**
 * Saves the page, whole.
 *
 * PATCH with every field, matching the gateway: a merge would make a field
 * somebody cleared indistinguishable from one this request did not mention,
 * and on a form of optional text fields that is the difference between
 * "delete my goal" and "leave my goal alone".
 */
export async function saveAccountProfile(
  profile: AccountProfile,
  hooks?: GatewayRequestHooks
): Promise<AccountProfile> {
  return authorizedGatewayRequest<AccountProfile>(
    ACCOUNT_PROFILE_PATH,
    { method: "PATCH", body: JSON.stringify(profile) },
    hooks
  );
}

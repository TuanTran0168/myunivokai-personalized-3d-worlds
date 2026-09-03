import { apiErrorMessage } from "@/lib/api";
import { isColdStartFailure, isCredentialFailure } from "@/lib/productAuth";

/**
 * What the sign-in and sign-up forms are doing, as data rather than as a
 * handful of booleans.
 *
 * `waking` is the whole of S8-IDENTITY-005 and it is a distinct state on
 * purpose. `auth-service` is on the free tier and, because a 7-day access
 * token means almost no refresh traffic, it is cold at nearly every sign-in
 * (§4.4's third cost) — so a 20-60 second wait is the NORMAL case here rather
 * than the rare one. Collapsing it into `submitting` would make the honest
 * case indistinguishable from a hung request, which is exactly the impression
 * the story exists to prevent.
 */
export type AuthCredentialsFormStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "waking"; attemptNumber: number }
  | { kind: "failed"; message: string; cause: AuthFailureCause };

/**
 * Why a submission failed, kept separate from the message so the form can
 * style and word the three cases differently without parsing its own copy.
 */
export type AuthFailureCause = "cold-start" | "credentials" | "unexpected";

/** The minimum the backend enforces; shown to the visitor before they submit. */
export const MINIMUM_PASSWORD_LENGTH = 12;

/**
 * The display-name ceiling, mirroring contracts.MaximumAccountDisplayNameLength.
 *
 * The number is the create form's Nickname cap, and the Go constant is DEFINED
 * as that cap rather than as its own 32 — because the display name is what
 * that field is filled with once somebody is signed in. Two numbers that
 * happen to agree would let an account carry a name the create form then
 * truncates.
 */
export const MAXIMUM_DISPLAY_NAME_LENGTH = 32;

/**
 * Named so the two forms cannot drift, and so the wording lives next to the
 * state machine that chooses between them rather than inside a component.
 */
const WAKING_MESSAGE =
  "Waking the sign-in server. It sleeps when nobody has signed in for a while, so this first attempt can take up to a minute.";

const WAKE_FAILED_MESSAGE =
  "The sign-in server did not start in time. Nothing is wrong with your details — please try again in a moment.";

export function wakingMessage(): string {
  return WAKING_MESSAGE;
}

/**
 * Turns a thrown error into the state the form should show.
 *
 * The one rule it enforces is that a cold start and a rejected credential
 * never share a message. A form that says "something went wrong" for a cold
 * start is lying about whose problem it is; a form that says "starting up" for
 * a wrong password is worse, because the visitor waits for a server that is
 * already answering.
 *
 * An unclassified error is `unexpected` rather than being folded into
 * `credentials`, so a bug in the gateway never reads as "check your password".
 */
export function failureStateFor(error: unknown): AuthCredentialsFormStatus {
  if (isColdStartFailure(error)) {
    return { kind: "failed", message: WAKE_FAILED_MESSAGE, cause: "cold-start" };
  }
  if (isCredentialFailure(error)) {
    return { kind: "failed", message: apiErrorMessage(error), cause: "credentials" };
  }
  return { kind: "failed", message: apiErrorMessage(error), cause: "unexpected" };
}

/**
 * Client-side validation, kept to exactly what the server also enforces.
 *
 * Nothing here is a second policy: the length is the server's minimum and the
 * address check is the same "does this look like an address" question the
 * gateway asks. The point is to answer before a NATS round trip that, on a
 * cold `auth-service`, costs the visitor a minute to be told their password is
 * eleven characters.
 *
 * There is no composition rule, and there must not be one — see the server's
 * PasswordPolicy for why length plus a breach corpus is the current guidance
 * and a mandatory symbol is not.
 */
export function credentialValidationMessage(email: string, password: string, displayName?: string): string | null {
  if (email.trim() === "" || password === "") {
    return "Enter your email address and password.";
  }
  if (!looksLikeEmailAddress(email.trim())) {
    return "That does not look like an email address.";
  }
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return `Use at least ${MINIMUM_PASSWORD_LENGTH} characters. Length is what makes a password hard to guess, so there are no other rules.`;
  }
  // Last, and only a ceiling. The name is optional - an account with no
  // display name is valid and its menu falls back to the email address - so
  // there is nothing to require, only something to bound. Reported after the
  // credential rules because those are the ones that stop a submission from
  // being possible at all.
  if (displayName !== undefined && displayName.trim().length > MAXIMUM_DISPLAY_NAME_LENGTH) {
    return `A display name can be at most ${MAXIMUM_DISPLAY_NAME_LENGTH} characters.`;
  }
  return null;
}

/**
 * A deliberately loose check: one `@`, something either side, and a dot in the
 * domain.
 *
 * Loose because the authority is the server, which uses Go's `net/mail`, and a
 * client-side pattern that is stricter than the server rejects addresses that
 * would have worked. The only job here is to catch the typo before the round
 * trip.
 */
function looksLikeEmailAddress(candidate: string): boolean {
  const [localPart, domainPart, ...extraParts] = candidate.split("@");
  if (extraParts.length > 0) {
    return false;
  }
  return Boolean(localPart) && Boolean(domainPart) && domainPart.includes(".") && !domainPart.endsWith(".");
}

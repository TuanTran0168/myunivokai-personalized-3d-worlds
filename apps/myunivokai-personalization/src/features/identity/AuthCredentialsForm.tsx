"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Compass, Images, LogIn, Sparkles, UserPlus, type LucideIcon } from "lucide-react";
import { StatusMessage } from "@/components/StatusMessage";
import { AmbientBackdrop } from "@/components/AmbientBackdrop";
import { signIn, signUp } from "@/lib/productAuth";
import { claimAnonymousWorldsForAccount } from "@/lib/anonymousWorldClaim";
import { PERSONALIZATION_DESTINATION } from "@/lib/returnDestinations";
import {
  MAXIMUM_DISPLAY_NAME_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  credentialValidationMessage,
  failureStateFor,
  wakingMessage,
  type AuthCredentialsFormMode,
  type AuthCredentialsFormStatus
} from "./authCredentialsFormState";
import { authBackdropSceneFor } from "./authBackdropScene";
import { announceProductSessionChanged } from "./useProductSession";

/** Where a successful sign-in or sign-up lands. The gallery is the one screen
 * that becomes meaningfully better for having an account, so it is where an
 * account arrives — the create page is reachable from the header from there. */
const DESTINATION_AFTER_AUTHENTICATION = "/gallery";

/** The one line above the fold on both screens: what this whole thing is for.
 * Not a heading — the card's own is the page's h1, and the action a visitor
 * came to take should not be outranked by a tagline. */
const PRODUCT_TAGLINE = "Your personality, as a place you can walk into.";

/**
 * Why an account is worth making, on the two screens that ask for one.
 *
 * All three are facts about what already ships, not promises: the gallery is
 * served from the account (S8-IDENTITY-016), signing in claims what the browser
 * made anonymously (S8-IDENTITY-011), and the profile fills the create form.
 * A benefit list on a sign-up screen is the easiest place in an app to write
 * something that is not true yet.
 */
const ACCOUNT_BENEFITS: readonly { icon: LucideIcon; heading: string; detail: string }[] = [
  {
    icon: Images,
    heading: "One gallery, every device",
    detail: "Your worlds follow the account rather than the browser they were made in."
  },
  {
    icon: Sparkles,
    heading: "The worlds you already made",
    detail: "Signing in claims every world this browser made without an account."
  },
  {
    icon: Compass,
    heading: "A form that knows you",
    detail: "Your profile fills the create-world form, so the next world starts where the last one did."
  }
];

export type { AuthCredentialsFormMode };

const MODE_COPY: Record<
  AuthCredentialsFormMode,
  {
    heading: string;
    eyebrow: string;
    lead: string;
    submitLabel: string;
    submitIcon: LucideIcon;
    alternateHref: string;
    alternatePrompt: string;
    alternateLabel: string;
  }
> = {
  "sign-in": {
    eyebrow: "Welcome back",
    heading: "Sign in",
    lead: "Sign in to see the worlds saved to your account on any device.",
    submitLabel: "Sign in",
    submitIcon: LogIn,
    alternateHref: "/sign-up",
    alternatePrompt: "No account yet?",
    alternateLabel: "Create one"
  },
  "sign-up": {
    eyebrow: "Keep your worlds",
    heading: "Create an account",
    lead: "Your worlds stop living in one browser's storage and follow your account instead.",
    submitLabel: "Create account",
    submitIcon: UserPlus,
    alternateHref: "/sign-in",
    alternatePrompt: "Already have an account?",
    alternateLabel: "Sign in"
  }
};

/** The field label treatment, written once for the three of them. */
const FIELD_LABEL_CLASSES = "font-mono text-[11px] uppercase tracking-[0.18em] text-brass";

/** And the field itself. */
const FIELD_CLASSES =
  "input-dark focus-ring w-full rounded-xl px-3.5 py-2.5 text-paper placeholder:text-on-surface-variant/60";

export function AuthCredentialsForm({ mode }: { mode: AuthCredentialsFormMode }) {
  const router = useRouter();
  const copy = MODE_COPY[mode];
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  // Sign-up only. It is the name the header greets somebody by, and the name
  // the create form's Nickname field is filled with from then on - which is
  // why the field says so rather than leaving it to be discovered.
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<AuthCredentialsFormStatus>({ kind: "idle" });

  const isBusy = status.kind === "submitting" || status.kind === "waking";

  // Keyed on the mode and nothing else, so the world behind the card is built
  // once and stands still while somebody types into the card. A backdrop that
  // rebuilt per keystroke would tear down the GL context per character - the
  // reason the create page and the profile page both debounce theirs.
  const backdropScene = useMemo(() => authBackdropSceneFor(mode), [mode]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const validationMessage = credentialValidationMessage(
        emailAddress,
        password,
        mode === "sign-up" ? displayName : undefined
      );
      if (validationMessage) {
        setStatus({ kind: "failed", message: validationMessage, cause: "credentials" });
        return;
      }
      setStatus({ kind: "submitting" });
      const credentials = { email: emailAddress.trim(), password };
      // The hook that makes the cold start honest. The retry loop in lib/api.ts
      // already carries the request across a wake window; without this the
      // form could only show a spinner while it did.
      const hooks = {
        onServiceWaking: (attemptNumber: number) => setStatus({ kind: "waking", attemptNumber })
      };
      try {
        const session =
          mode === "sign-up"
            ? await signUp({ ...credentials, name: displayName.trim() }, hooks)
            : await signIn(credentials, hooks);
        // The claim runs on BOTH sign-up and sign-in, and it is attempted on
        // every one of them rather than only the first.
        //
        // Sign-in matters as much as sign-up: a visitor who signs up on their
        // phone and later signs in on the laptop they actually made their
        // worlds on is claiming for the first time on that device. And a claim
        // that failed leaves the anonymous cookie in place, so the next
        // sign-in is the retry - the server's own guard makes a claim that
        // already succeeded a no-op.
        //
        // Its failure never becomes the form's failure. The visitor IS signed
        // in by this point; refusing to navigate would strand them on a
        // sign-in page reporting an error about something else entirely, and
        // nothing is lost by trying again later.
        try {
          await claimAnonymousWorldsForAccount(session.account.accountId, hooks);
        } catch {
          // Deliberately silent for now. S8-IDENTITY-014 is where a visitor is
          // told, once, keyed on a reason code - and it needs the quota's
          // codes to be worth writing.
        }
        announceProductSessionChanged();
        router.push(DESTINATION_AFTER_AUTHENTICATION);
      } catch (error) {
        setStatus(failureStateFor(error));
      }
    },
    [displayName, emailAddress, mode, password, router]
  );

  const SubmitIcon = copy.submitIcon;

  return (
    <>
      {/* A SIBLING of the content column, not a child of it: its layer is fixed
          at z-0 and inside the column it would paint over the card instead of
          behind it. The gallery and the profile page are arranged the same way.

          These two screens used to be the only ones in the app with nothing
          alive on them, which is a strange first impression for a 3D universe
          generator to make. */}
      <AmbientBackdrop scene={backdropScene} />
      <main className="relative z-10 mx-auto grid min-h-screen w-full max-w-5xl items-center gap-10 px-4 pb-footer-clear pt-header-clear sm:px-6 lg:grid-cols-[1fr_minmax(0,25rem)] lg:gap-14">
        {/* Desktop only. Below lg the card is the whole screen and this would
            push the email field below the fold — on the one screen where the
            fields ARE the content. The card's own lead sentence carries the
            same promise in one line. */}
        <section className="text-on-world hidden lg:block">
          <p className={`${FIELD_LABEL_CLASSES} mb-3`}>Myunivokai</p>
          <p className="font-display text-4xl font-semibold leading-tight text-paper">{PRODUCT_TAGLINE}</p>
          <div className="mt-7 h-px w-16 bg-brass/50" />
          <ul className="mt-7 grid gap-5">
            {ACCOUNT_BENEFITS.map((benefit) => {
              const BenefitIcon = benefit.icon;
              return (
                <li key={benefit.heading} className="flex items-start gap-3.5">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-brass/25 bg-brass/10 text-brass"
                  >
                    <BenefitIcon className="h-4 w-4" />
                  </span>
                  <span className="grid gap-1">
                    <span className="font-body text-sm font-semibold text-paper">{benefit.heading}</span>
                    <span className="font-body text-sm leading-6 text-on-surface-variant">{benefit.detail}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="mx-auto w-full max-w-md lg:max-w-none">
          {/* The REGULAR glass material, and the one panel on the screen wearing
              the sheen. The create form's rail stays clear because the world
              behind it is the thing being configured; here the world is scenery
              and the card is the subject, so it refracts instead of showing
              through. A form read character by character is the last place to
              spend legibility on transparency. */}
          <div className="glass-overlay glass-overlay-sheen glass-rise relative w-full rounded-glass p-6 sm:p-8">
            <div className="mb-6">
              <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-brass">{copy.eyebrow}</div>
              <h1 className="font-display text-3xl font-semibold tracking-normal text-paper">{copy.heading}</h1>
              <p className="mt-2 text-sm leading-6 text-on-surface-variant">{copy.lead}</p>
            </div>

            <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
              {mode === "sign-up" ? (
                <label className="grid gap-1.5">
                  <span className={FIELD_LABEL_CLASSES}>Your name</span>
                  <input
                    type="text"
                    name="name"
                    autoComplete="nickname"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    disabled={isBusy}
                    maxLength={MAXIMUM_DISPLAY_NAME_LENGTH}
                    className={FIELD_CLASSES}
                    placeholder="e.g. Neo"
                  />
                  <span className="text-xs leading-5 text-on-surface-variant">
                    Optional. It is what the header calls you and what fills the create-world form&rsquo;s Nickname
                    field. You can change it later on your profile.
                  </span>
                </label>
              ) : null}

              <label className="grid gap-1.5">
                <span className={FIELD_LABEL_CLASSES}>Email</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  value={emailAddress}
                  onChange={(event) => setEmailAddress(event.target.value)}
                  disabled={isBusy}
                  className={FIELD_CLASSES}
                  placeholder="you@example.com"
                />
              </label>

              <label className="grid gap-1.5">
                <span className={FIELD_LABEL_CLASSES}>Password</span>
                <input
                  type="password"
                  name="password"
                  /* new-password on sign-up so a password manager offers to
                     generate one rather than filling the old one in. */
                  autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={isBusy}
                  className={FIELD_CLASSES}
                />
                {mode === "sign-up" ? (
                  <span className="text-xs leading-5 text-on-surface-variant">
                    At least {MINIMUM_PASSWORD_LENGTH} characters. No other rules — length is what makes a password hard
                    to guess. Passwords found in public breaches are refused.
                  </span>
                ) : null}
              </label>

              <button
                type="submit"
                disabled={isBusy}
                className="focus-ring btn-gradient mt-1 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold disabled:opacity-60"
              >
                <SubmitIcon className="h-4 w-4" aria-hidden="true" />
                {copy.submitLabel}
              </button>

              {/* The three outcomes, each with its own words. A cold start and a
                  rejected credential must never share a message: the first is not
                  the visitor's problem and the second is the only thing they can
                  act on. */}
              {status.kind === "submitting" ? <StatusMessage tone="loading">{copy.submitLabel}…</StatusMessage> : null}
              {status.kind === "waking" ? <StatusMessage tone="loading">{wakingMessage()}</StatusMessage> : null}
              {status.kind === "failed" ? <StatusMessage tone="error">{status.message}</StatusMessage> : null}
            </form>

            {mode === "sign-up" ? (
              <p className="mt-5 text-xs leading-5 text-on-surface-variant">
                {/* Said plainly rather than omitted. Decision 11 ships without mail,
                    so there is no self-service reset, and a person choosing a
                    password deserves to know that before they choose it. */}
                There is no password reset yet — we send no email at all, so there is no way to prove an address is
                yours. Keep this password somewhere safe.
              </p>
            ) : null}

            <div className="mt-5 grid gap-1.5 border-t border-white/10 pt-4 text-sm text-on-surface-variant">
              <p className="flex flex-wrap items-center gap-x-2">
                <span>{copy.alternatePrompt}</span>
                <Link
                  href={copy.alternateHref}
                  className="focus-ring rounded font-semibold text-secondary underline-offset-4 hover:underline"
                >
                  {copy.alternateLabel}
                </Link>
              </p>
              {/* Quieter than anything above it, and inside the card rather
                  than under it: a line placed under the card is a line with no
                  height budget, and on a 900px screen it went behind the fixed
                  footer. It is here because an account is not required to use
                  this app at all. */}
              <p className="text-xs">
                <Link
                  href={PERSONALIZATION_DESTINATION.href}
                  className="focus-ring rounded underline-offset-4 transition hover:text-paper hover:underline"
                >
                  Or make a world without an account
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

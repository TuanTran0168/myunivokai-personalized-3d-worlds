"use client";

import { useCallback, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn, UserPlus } from "lucide-react";
import { StatusMessage } from "@/components/StatusMessage";
import { signIn, signUp } from "@/lib/productAuth";
import {
  MINIMUM_PASSWORD_LENGTH,
  credentialValidationMessage,
  failureStateFor,
  wakingMessage,
  type AuthCredentialsFormStatus
} from "./authCredentialsFormState";
import { announceProductSessionChanged } from "./useProductSession";

/** Where a successful sign-in or sign-up lands. The gallery is the one screen
 * that becomes meaningfully better for having an account, so it is where an
 * account arrives — the create page is reachable from the header from there. */
const DESTINATION_AFTER_AUTHENTICATION = "/gallery";

export type AuthCredentialsFormMode = "sign-in" | "sign-up";

const MODE_COPY: Record<
  AuthCredentialsFormMode,
  { heading: string; eyebrow: string; submitLabel: string; alternateHref: string; alternatePrompt: string; alternateLabel: string }
> = {
  "sign-in": {
    eyebrow: "Welcome back",
    heading: "Sign in",
    submitLabel: "Sign in",
    alternateHref: "/sign-up",
    alternatePrompt: "No account yet?",
    alternateLabel: "Create one"
  },
  "sign-up": {
    eyebrow: "Keep your worlds",
    heading: "Create an account",
    submitLabel: "Create account",
    alternateHref: "/sign-in",
    alternatePrompt: "Already have an account?",
    alternateLabel: "Sign in"
  }
};

export function AuthCredentialsForm({ mode }: { mode: AuthCredentialsFormMode }) {
  const router = useRouter();
  const copy = MODE_COPY[mode];
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<AuthCredentialsFormStatus>({ kind: "idle" });

  const isBusy = status.kind === "submitting" || status.kind === "waking";

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const validationMessage = credentialValidationMessage(emailAddress, password);
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
        if (mode === "sign-up") {
          await signUp(credentials, hooks);
        } else {
          await signIn(credentials, hooks);
        }
        announceProductSessionChanged();
        router.push(DESTINATION_AFTER_AUTHENTICATION);
      } catch (error) {
        setStatus(failureStateFor(error));
      }
    },
    [emailAddress, mode, password, router]
  );

  const SubmitIcon = mode === "sign-up" ? UserPlus : LogIn;

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-md place-items-center px-4 pb-[76px] pt-[76px]">
      <div className="glass-panel glass-panel-glow w-full rounded-2xl p-6 sm:p-8">
        <div className="mb-6">
          <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-brass">{copy.eyebrow}</div>
          <h1 className="font-display text-3xl font-semibold tracking-normal text-paper">{copy.heading}</h1>
          <p className="mt-2 text-sm text-on-surface-variant">
            {mode === "sign-up"
              ? "Your worlds stop living in one browser's storage and follow your account instead."
              : "Sign in to see the worlds saved to your account on any device."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
          <label className="grid gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-on-surface-variant">Email</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              value={emailAddress}
              onChange={(event) => setEmailAddress(event.target.value)}
              disabled={isBusy}
              className="input-dark focus-ring w-full rounded-md px-3 py-2.5 text-paper placeholder:text-on-surface-variant/60"
              placeholder="you@example.com"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-on-surface-variant">Password</span>
            <input
              type="password"
              name="password"
              /* new-password on sign-up so a password manager offers to
                 generate one rather than filling the old one in. */
              autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isBusy}
              className="input-dark focus-ring w-full rounded-md px-3 py-2.5 text-paper placeholder:text-on-surface-variant/60"
            />
            {mode === "sign-up" ? (
              <span className="text-xs text-on-surface-variant">
                At least {MINIMUM_PASSWORD_LENGTH} characters. No other rules — length is what makes a password hard to
                guess. Passwords found in public breaches are refused.
              </span>
            ) : null}
          </label>

          <button
            type="submit"
            disabled={isBusy}
            className="focus-ring btn-gradient mt-1 inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 font-semibold disabled:opacity-60"
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
          <p className="mt-5 text-xs text-on-surface-variant">
            {/* Said plainly rather than omitted. Decision 11 ships without mail,
                so there is no self-service reset, and a person choosing a
                password deserves to know that before they choose it. */}
            There is no password reset yet — we send no email at all, so there is no way to prove an address is yours.
            Keep this password somewhere safe.
          </p>
        ) : null}

        <p className="mt-5 text-sm text-on-surface-variant">
          {copy.alternatePrompt}{" "}
          <Link href={copy.alternateHref} className="focus-ring rounded text-secondary underline-offset-4 hover:underline">
            {copy.alternateLabel}
          </Link>
        </p>
      </div>
    </main>
  );
}

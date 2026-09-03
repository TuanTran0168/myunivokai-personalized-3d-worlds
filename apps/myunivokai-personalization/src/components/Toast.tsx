"use client";

import { useEffect } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

export type ToastTone = "success" | "error";

/**
 * How long a success stays before it leaves on its own. Long enough to read a
 * short sentence and reach the action beside it, short enough that it is gone
 * by the time somebody has finished the next field.
 */
export const TOAST_AUTO_DISMISS_MILLISECONDS = 7000;

/**
 * How long this toast should stay, or null for "until it is dismissed".
 *
 * **A success fades and a failure waits.** A confirmation nobody read still
 * happened; an error nobody read is an error nobody can act on, and one that
 * disappears while being read is worse than one that was never shown. This is
 * the rule rather than a duration, which is why it is a function and why it is
 * tested.
 */
export function toastLifetimeMilliseconds(tone: ToastTone): number | null {
  return tone === "error" ? null : TOAST_AUTO_DISMISS_MILLISECONDS;
}

type ToastProps = {
  tone: ToastTone;
  message: string;
  /** Cleared by the timer, the close button, or the page replacing the toast. */
  onDismiss: () => void;
  /** An optional second thing to do, rendered beside the message. */
  action?: React.ReactNode;
};

/**
 * One message, over the page, about something that just happened.
 *
 * Not a replacement for `StatusMessage`, which reports on the control it sits
 * next to — a save in progress, a field that will not do. This reports on an
 * action that is already OVER, which is why it is not anchored to anything:
 * after saving, the eye is wherever it was last, not on the button.
 *
 * Rendered outside the page's content column so it clears the fixed header and
 * footer, which own `z-50`; `bottom-20` keeps it off the footer rather than
 * over it.
 */
export function Toast({ tone, message, onDismiss, action }: ToastProps) {
  useEffect(() => {
    const lifetime = toastLifetimeMilliseconds(tone);
    if (lifetime === null) {
      return;
    }
    const timeoutId = setTimeout(onDismiss, lifetime);
    return () => clearTimeout(timeoutId);
  }, [tone, onDismiss]);

  const toneClassName =
    tone === "error" ? "border-error/40 bg-error-container/90" : "border-secondary/40 bg-surface-lowest/95";
  const ToneIcon = tone === "error" ? AlertCircle : CheckCircle2;
  const iconClassName = tone === "error" ? "text-error" : "text-secondary";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex justify-center px-4">
      <div
        // `alert` for a failure, `status` for a confirmation: the first
        // interrupts a screen reader, the second waits its turn, and that is
        // the same distinction the lifetime rule above makes.
        role={tone === "error" ? "alert" : "status"}
        aria-live={tone === "error" ? "assertive" : "polite"}
        className={`glass-rise pointer-events-auto flex max-w-lg items-start gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-xl ${toneClassName}`}
      >
        <ToneIcon className={`mt-0.5 h-5 w-5 shrink-0 ${iconClassName}`} aria-hidden="true" />
        <div className="grid gap-2 text-sm text-on-surface">
          <span>{message}</span>
          {action}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="focus-ring -mr-1 -mt-1 rounded-md p-1 text-on-surface-variant hover:text-on-surface"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

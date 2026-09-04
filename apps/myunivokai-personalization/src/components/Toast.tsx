"use client";

import { useEffect } from "react";
import { AlertCircle, CheckCircle2, X, type LucideIcon } from "lucide-react";

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

/**
 * The tone, as three exhaustive records rather than three ternaries.
 *
 * The material is a class and not a Tailwind `bg-*`, because `.glass-overlay`
 * sets the `background` shorthand and would win against a utility no matter
 * which one the call site picked.
 */
const TONE_MATERIAL_CLASSES: Record<ToastTone, string> = {
  success: "",
  error: "glass-overlay-alert"
};

const TONE_ICONS: Record<ToastTone, LucideIcon> = {
  success: CheckCircle2,
  error: AlertCircle
};

const TONE_ICON_CLASSES: Record<ToastTone, string> = {
  success: "text-brass",
  error: "text-error"
};

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
 * **It comes down from the top, and it did not used to.** `bottom-20` put it
 * over the footer and, on the one page that uses it, directly over the Save
 * button and the way out beside it — a confirmation covering the control it
 * was confirming, and covering the link it was offering. The top inset is
 * `--toast-inset-top`, the same value the sonner stack in layout.tsx is given,
 * so the app has ONE place a message about a finished action appears rather
 * than one per toast library.
 *
 * It wears the REGULAR glass, not the clear panel material: it arrives over
 * whatever the page already drew there, and see-through is the wrong answer for
 * something whose whole job is to be read once.
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

  const ToneIcon = TONE_ICONS[tone];

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[var(--toast-inset-top)] z-[60] flex justify-center px-4">
      <div
        // `alert` for a failure, `status` for a confirmation: the first
        // interrupts a screen reader, the second waits its turn, and that is
        // the same distinction the lifetime rule above makes.
        role={tone === "error" ? "alert" : "status"}
        aria-live={tone === "error" ? "assertive" : "polite"}
        className={`glass-overlay glass-descend pointer-events-auto relative flex w-full max-w-lg items-start gap-3 rounded-2xl py-3 pl-4 pr-3 ${TONE_MATERIAL_CLASSES[tone]}`}
      >
        <ToneIcon className={`mt-0.5 h-5 w-5 shrink-0 ${TONE_ICON_CLASSES[tone]}`} aria-hidden="true" />
        <div className="grid gap-2 text-sm text-on-surface">
          <span>{message}</span>
          {action}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="focus-ring ml-auto -mt-1 shrink-0 rounded-lg p-1 text-on-surface-variant transition hover:bg-white/5 hover:text-on-surface"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

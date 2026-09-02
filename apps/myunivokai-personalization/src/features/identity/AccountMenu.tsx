"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, UserRound } from "lucide-react";
import { useProductSession } from "./useProductSession";

/**
 * The header's identity control: a sign-in link when nobody is signed in, and
 * the account with a way out when somebody is.
 *
 * It renders NOTHING while the session state is `unknown`, and that is
 * deliberate. Every page here is server-rendered first and the session lives
 * in cookies only this app's JavaScript reads, so the first paint genuinely
 * cannot know — showing "Sign in" and then swapping it for an email address is
 * a visible flash on every single page load, in a 57px bar the header contract
 * says must never reflow.
 */
export function AccountMenu() {
  const { sessionState, signOut } = useProductSession();
  const router = useRouter();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }
    const closeOnOutsideInteraction = (event: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnOutsideInteraction);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideInteraction);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMenuOpen]);

  if (sessionState.status === "unknown") {
    return null;
  }

  if (sessionState.status === "signed-out") {
    return (
      <Link
        href="/sign-in"
        className="focus-ring font-mono text-xs uppercase tracking-widest text-on-surface-variant transition hover:text-secondary"
      >
        Sign in
      </Link>
    );
  }

  const accountLabel = sessionState.account.name || sessionState.account.email || "Account";

  return (
    <div ref={menuContainerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsMenuOpen((wasOpen) => !wasOpen)}
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
        className="focus-ring flex max-w-[9rem] items-center gap-1.5 rounded-full px-2 py-1 font-mono text-xs uppercase tracking-widest text-on-surface-variant transition hover:text-secondary"
      >
        <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate normal-case tracking-normal">{accountLabel}</span>
      </button>

      {isMenuOpen ? (
        <div
          role="menu"
          className="glass-panel glass-panel-glow absolute right-0 top-[calc(100%+0.5rem)] w-56 rounded-xl p-3 text-left"
        >
          <p className="mb-2 break-words font-body text-xs text-on-surface-variant">{sessionState.account.email}</p>
          <Link
            href="/gallery"
            role="menuitem"
            onClick={() => setIsMenuOpen(false)}
            className="focus-ring block rounded px-1 py-1.5 text-sm text-paper transition hover:text-secondary"
          >
            Your gallery
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setIsMenuOpen(false);
              await signOut();
              // Sent home rather than left where they were: a signed-out
              // visitor standing on a screen that needed an account is a
              // worse answer than the create page, which never does.
              router.push("/");
            }}
            className="focus-ring flex w-full items-center gap-2 rounded px-1 py-1.5 text-left text-sm text-paper transition hover:text-secondary"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

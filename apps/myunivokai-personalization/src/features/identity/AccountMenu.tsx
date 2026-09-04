"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, IdCard, Images, LogIn, LogOut, Mail, UserRound, type LucideIcon } from "lucide-react";
import { GALLERY_DESTINATION } from "@/lib/returnDestinations";
import { useProductSession } from "./useProductSession";

/** The profile route. The gallery's comes from returnDestinations, which
 * already owns it — one route, two labels, rather than two copies of a path. */
const ACCOUNT_PROFILE_PATH = "/account";

/** What the menu is called when an account has neither a name nor an email. */
const ACCOUNT_LABEL_FALLBACK = "Account";

/**
 * The menu's own rows, as data.
 *
 * Every one carries an icon, because a column of bare sentences in a floating
 * panel reads as a paragraph rather than as a list of places to go — and
 * because the row that leaves already had one, so the ones that stayed looked
 * unfinished beside it.
 */
const MENU_LINKS: readonly { href: string; label: string; icon: LucideIcon }[] = [
  { href: GALLERY_DESTINATION.href, label: "Your gallery", icon: Images },
  { href: ACCOUNT_PROFILE_PATH, label: "Your profile", icon: IdCard }
];

/** One row's shape, written once so the sign-out button matches the two links. */
const MENU_ROW_CLASSES =
  "focus-ring flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm text-paper transition hover:bg-white/[0.07] hover:text-paper";

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
 *
 * The open panel wears the REGULAR glass material (globals.css), not the clear
 * one the page's own islands use. It opens over the create form's live-preview
 * panel and over a world page's DNA panel, and with two clear materials stacked
 * you read both at once: the menu and the panel under it were legible as a
 * single tangled surface. Depth needs one of the two to stop being see-through,
 * and it is the one on top.
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
        className="focus-ring flex items-center gap-1.5 whitespace-nowrap font-mono text-xs uppercase tracking-widest text-on-surface-variant transition hover:text-secondary"
      >
        <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
        Sign in
      </Link>
    );
  }

  const accountLabel = sessionState.account.name || sessionState.account.email || ACCOUNT_LABEL_FALLBACK;

  return (
    <div ref={menuContainerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsMenuOpen((wasOpen) => !wasOpen)}
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
        className="focus-ring flex max-w-[11rem] items-center gap-2 rounded-full border border-hairline bg-black/25 py-1 pl-1 pr-2.5 text-xs text-on-surface-variant transition hover:border-brass/50 hover:text-paper"
      >
        {/* The initial, not a generic person glyph: at 24px it is the one thing
            that tells two accounts apart at a glance, and this bar has room for
            exactly one thing. */}
        <span
          aria-hidden="true"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brass font-display text-sm font-semibold leading-none text-ink"
        >
          {accountInitial(accountLabel)}
        </span>
        {/* The avatar carries this control below `sm`. The 57px bar cannot
            hold a name and Create World at 375px, and the name is the part
            that has a second home two rows down inside the open menu.
            `sr-only`, not `hidden`, so the button keeps its own name. */}
        <span className="sr-only truncate font-body sm:not-sr-only">{accountLabel}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform ${isMenuOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {isMenuOpen ? (
        <div
          role="menu"
          // w-52 below `sm`, and the number is forced rather than chosen:
          // the panel is anchored to the trigger's right edge, so its own width
          // is how far left it reaches, and at 375px there are only about
          // 220px between that edge and the viewport. A 256px panel hung off
          // the left of the screen with its first icons cut off.
          className="glass-overlay glass-unfold absolute right-0 top-[calc(100%+0.625rem)] w-52 rounded-2xl p-2 text-left sm:w-64"
        >
          {/* Who this menu belongs to, said once at the top. The email is the
              account's identity and the name is only what it is called, so the
              name leads and the address is the line underneath it. */}
          <div className="flex items-start gap-2.5 px-2.5 pb-2.5 pt-1.5">
            <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-brass" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate font-body text-sm font-semibold text-paper">{accountLabel}</p>
              <p className="mt-0.5 flex items-center gap-1.5 break-words font-mono text-[11px] text-on-surface-variant">
                <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{sessionState.account.email}</span>
              </p>
            </div>
          </div>

          <div className="my-1 h-px bg-white/10" />

          {MENU_LINKS.map((menuLink) => {
            const MenuLinkIcon = menuLink.icon;
            return (
              <Link
                key={menuLink.href}
                href={menuLink.href}
                role="menuitem"
                onClick={() => setIsMenuOpen(false)}
                className={MENU_ROW_CLASSES}
              >
                <MenuLinkIcon className="h-4 w-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
                {menuLink.label}
              </Link>
            );
          })}

          <div className="my-1 h-px bg-white/10" />

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
            className={`${MENU_ROW_CLASSES} hover:bg-error/10 hover:text-error`}
          >
            <LogOut className="h-4 w-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The first character of what the account is called, upper-cased.
 *
 * `Array.from` rather than `label[0]`, because the label is very often a
 * Vietnamese name and indexing a string cuts a surrogate pair in half. The
 * fallback is never reached from here — the label already falls back to
 * ACCOUNT_LABEL_FALLBACK — but a first character is not something a type can
 * promise exists.
 */
function accountInitial(label: string): string {
  const firstCharacter = Array.from(label.trim())[0];
  return (firstCharacter ?? ACCOUNT_LABEL_FALLBACK).toUpperCase();
}

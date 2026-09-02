"use client";

import { useCallback, useEffect, useState } from "react";
import { signOut as signOutOfProduct } from "@/lib/productAuth";
import {
  hasProductSession,
  readProductAccount,
  type ProductAccount
} from "@/lib/productSession";

/**
 * Whether anybody is signed in, and who.
 *
 * `unknown` is a real third state and not a loading spinner in disguise: every
 * page here is server-rendered first, and the session lives in cookies only
 * this app's own JavaScript reads, so the first render genuinely cannot know.
 * Rendering "Sign in" during that render and then swapping it for an account
 * name is a visible flash on every page load; rendering nothing until the
 * answer arrives is what the account menu does instead.
 */
export type ProductSessionState =
  | { status: "unknown" }
  | { status: "signed-out" }
  | { status: "signed-in"; account: ProductAccount };

/**
 * The event this app dispatches when the session changes.
 *
 * A custom event rather than a React context, and the reason is the shape of
 * the app rather than preference: the account menu lives in the root layout
 * while sign-in happens on its own route, and Next's App Router does not
 * re-render a layout when a child route navigates. A context provider in the
 * layout would hold state the sign-in page cannot reach without threading a
 * provider through every route in between.
 *
 * `storage` events would not do it either — they fire in OTHER tabs, never in
 * the one that wrote.
 */
const PRODUCT_SESSION_CHANGED_EVENT = "myunivokai:product-session-changed";

export function announceProductSessionChanged(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(PRODUCT_SESSION_CHANGED_EVENT));
}

function readCurrentSessionState(): ProductSessionState {
  if (!hasProductSession()) {
    return { status: "signed-out" };
  }
  const account = readProductAccount();
  if (!account) {
    // Tokens without the display copy: the account was evicted from storage,
    // or this browser signed in before that copy existed. Still signed in -
    // the tokens are what decide that - and the account menu shows the address
    // it can get from /api/me on demand rather than signing anybody out over
    // a missing label.
    return { status: "signed-in", account: { accountId: "", email: "" } };
  }
  return { status: "signed-in", account };
}

export function useProductSession() {
  const [sessionState, setSessionState] = useState<ProductSessionState>({ status: "unknown" });

  useEffect(() => {
    const readSession = () => setSessionState(readCurrentSessionState());
    readSession();
    window.addEventListener(PRODUCT_SESSION_CHANGED_EVENT, readSession);
    // A sign-out in another tab has to reach this one, or a stale account menu
    // offers actions the server will refuse.
    window.addEventListener("storage", readSession);
    // Re-read when the tab comes back: a cookie can expire while the tab is
    // hidden, and nothing fires an event when it does.
    window.addEventListener("focus", readSession);
    return () => {
      window.removeEventListener(PRODUCT_SESSION_CHANGED_EVENT, readSession);
      window.removeEventListener("storage", readSession);
      window.removeEventListener("focus", readSession);
    };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await signOutOfProduct();
    } finally {
      // Announced in `finally` for the same reason signOut clears locally in
      // one: the visitor asked to be signed out, and the UI must agree with
      // the stored session whether or not the server was reachable.
      announceProductSessionChanged();
      setSessionState({ status: "signed-out" });
    }
  }, []);

  return { sessionState, signOut };
}

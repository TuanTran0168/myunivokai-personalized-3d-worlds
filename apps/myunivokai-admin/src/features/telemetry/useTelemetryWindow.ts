"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DEFAULT_TELEMETRY_HOURS, TELEMETRY_WINDOW_OPTIONS } from "./types";

const WINDOW_PARAMETER = "hours";
const ALLOWED_WINDOWS = TELEMETRY_WINDOW_OPTIONS.map((option) => option.value);

// The window lives in the URL, not in component state.
//
// Three things follow from that and none of them do from useState: a six-hour
// view can be pasted into a chat, the back button undoes a window change, and
// moving from Traffic to Performance keeps the window you were investigating.
// The last one is what makes three screens one investigation instead of three
// destinations you have to re-scope on arrival.
//
// An unparseable or out-of-range value falls back to the default rather than
// being clamped upward: telemetry-service clamps server-side anyway, and a URL
// someone hand-edited to `?hours=banana` should show the normal screen, not an
// error.
export function useTelemetryWindow(): [number, (hours: number) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const requested = Number(searchParams.get(WINDOW_PARAMETER));
  const hours = ALLOWED_WINDOWS.includes(requested as (typeof ALLOWED_WINDOWS)[number])
    ? requested
    : DEFAULT_TELEMETRY_HOURS;

  const setHours = useCallback(
    (next: number) => {
      const query = new URLSearchParams(searchParams.toString());
      if (next === DEFAULT_TELEMETRY_HOURS) {
        // The default is the absence of the parameter, so the canonical URL
        // for the default view has no query string at all.
        query.delete(WINDOW_PARAMETER);
      } else {
        query.set(WINDOW_PARAMETER, String(next));
      }
      const search = query.toString();
      // replace, not push: changing the window is refining one view, and
      // pushing would make the back button walk through every window the
      // reader tried before leaving the page.
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  return [hours, setHours];
}

/** The window as a query string, for links between the three platform screens. */
export function telemetryWindowQuery(hours: number): string {
  return hours === DEFAULT_TELEMETRY_HOURS ? "" : `?${WINDOW_PARAMETER}=${hours}`;
}

"use client";

import { useEffect } from "react";
import { attemptSilentRefresh } from "@/lib/client-session";

// Safely under the access token's 10-minute TTL (AUTH_ACCESS_TOKEN_TTL), so a
// staff member active in the dashboard never hits an expired access token
// mid-session — see middleware.ts for why this can't just happen there.
const KEEP_ALIVE_INTERVAL_MILLISECONDS = 5 * 60 * 1000;

export function useSessionKeepAlive(): void {
  useEffect(() => {
    const intervalId = setInterval(() => {
      void attemptSilentRefresh();
    }, KEEP_ALIVE_INTERVAL_MILLISECONDS);
    return () => clearInterval(intervalId);
  }, []);
}

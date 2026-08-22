"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function QueryProvider({ children }: { children: ReactNode }) {
  // One QueryClient per browser session, created in state so it survives
  // re-renders but never leaks across requests on the server (this provider
  // only ever mounts client-side, but the pattern still matters if a future
  // page ever renders it during SSR).
  //
  // React Query's defaults (retry: 3, exponential backoff up to 30s) are
  // tuned for a flaky public client network — against this app's own
  // BFF relay, a failing request almost always means the gateway is
  // genuinely down, not a dropped packet worth retrying three times. Left
  // at the default, every page navigation during a gateway outage sat on
  // its loading skeleton for 1s+2s+4s of retries before showing an error,
  // which read as "every page loads super slow" rather than "the backend
  // is down". One quick retry surfaces that state in ~1s instead.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            retryDelay: 1_000,
            staleTime: 30_000
          }
        }
      })
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

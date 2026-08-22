import { fetchWithWakeRetry } from "./wake-retry";

// Client-only: calling fetch("/api/admin/auth/refresh") FROM THE BROWSER
// targets that exact path, so the browser correctly attaches the refresh
// cookie (Path=/api/admin/auth) — unlike middleware.ts, which handles
// requests to every OTHER path and structurally never sees that cookie. This
// is what revives a session after the 10-minute access token expires,
// without asking for credentials again as long as the 14-day refresh token
// is still good. See the two call sites: the login page (revive-on-mount)
// and useSessionKeepAlive (periodic, while the dashboard stays open).
// The wake retry belongs here even though it can hold the login page's
// "Checking your session…" spinner for a cold start: giving up would show the
// credential form to somebody whose session is still perfectly valid, which is
// the exact outcome this function exists to prevent.
//
// It costs nothing in the logged-out case. With no refresh cookie the gateway's
// RequireAdminRefreshCookie rejects the request with 401 before auth-service is
// ever consulted, so there is no SERVICE_WAKING to wait on and the form appears
// immediately. The wait only happens when there is a session worth saving.
export async function attemptSilentRefresh(): Promise<boolean> {
  try {
    const response = await fetchWithWakeRetry("/api/admin/auth/refresh", { method: "POST" });
    return response.ok;
  } catch {
    return false;
  }
}

import { NextResponse } from "next/server";
import { serializeCookie } from "./cookie-serialize";
import { gatewayOriginUrl } from "./gateway";
import { forwardedRelayHeaders } from "./relay-headers";
import { ADMIN_ACCOUNT_COOKIE_NAME, encodeAccountCookieValue, type SessionResponse } from "./session";

// proxyToGatewayAuth is the BFF relay every route under src/app/api/admin/auth
// shares: it calls the gateway's /api/admin/auth/* endpoint server-to-server
// (never subject to browser CORS, since no browser is involved in this half
// of the call) and relays the response back verbatim, INCLUDING its raw
// Set-Cookie headers. Neither gateway cookie declares a Domain attribute, so
// re-emitting them from this response scopes them to this app's own origin
// instead of the gateway's — that relay is what makes the httpOnly session
// cookies first-party to apps/myunivokai-admin, which is what lets this
// app's own middleware read them without a network hop. See
// notes/vision/auth-and-admin-plan.md#the-admin-app, "cookie-based auth wants
// a server".
// Bounds how long a hung/unreachable gateway can hold this route handler
// open. Without it, a stalled connection (gateway mid-restart, a dropped
// packet with no RST) leaves the fetch pending far longer than a user will
// wait — the login page's "Checking your session…" spinner has no other
// escape hatch and would otherwise spin until the underlying socket times
// out on its own, which is what "F5 fixes it" was actually working around.
const GATEWAY_REQUEST_TIMEOUT_MILLISECONDS = 8_000;

export async function proxyToGatewayAuth(gatewayPath: string, init: RequestInit): Promise<NextResponse> {
  let gatewayResponse: Response;
  try {
    gatewayResponse = await fetch(`${gatewayOriginUrl()}${gatewayPath}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(GATEWAY_REQUEST_TIMEOUT_MILLISECONDS)
    });
  } catch {
    return NextResponse.json(
      { error: { code: "GATEWAY_UNREACHABLE", message: "The API gateway is not reachable right now." } },
      { status: 503 }
    );
  }

  const bodyText = await gatewayResponse.text();
  const response = new NextResponse(bodyText.length > 0 ? bodyText : null, {
    status: gatewayResponse.status,
    headers: forwardedRelayHeaders(gatewayResponse)
  });

  for (const rawSetCookie of gatewayResponse.headers.getSetCookie()) {
    response.headers.append("Set-Cookie", rawSetCookie);
  }

  if (gatewayResponse.ok && bodyText) {
    cacheAccountSummaryIfPresent(response, bodyText);
  }

  return response;
}

// login and refresh both return a SessionResponse; caching account/permission
// data here is what lets the nav render without a /session endpoint (S4-AUTH-003
// deliberately shipped none — see that phase's "narrower than scoped" note).
function cacheAccountSummaryIfPresent(response: NextResponse, bodyText: string): void {
  let session: Partial<SessionResponse>;
  try {
    session = JSON.parse(bodyText) as Partial<SessionResponse>;
  } catch {
    return;
  }
  if (!session.account || !session.accessExpiresAt) {
    return;
  }
  // Appended, not set via NextResponse's `.cookies` API: mixing that API
  // with the raw relayed Set-Cookie headers above silently drops one or the
  // other (observed empirically — only the last-written one survived).
  response.headers.append(
    "Set-Cookie",
    serializeCookie(ADMIN_ACCOUNT_COOKIE_NAME, encodeAccountCookieValue(session.account), {
      path: "/",
      expires: new Date(session.accessExpiresAt),
      sameSite: "lax",
      // Not httpOnly: this holds roles/permissions/email the account already
      // knows about itself, never a token — there is nothing here for an XSS
      // to steal, and letting it be JS-readable costs nothing.
      httpOnly: false,
      secure: process.env.NODE_ENV === "production"
    })
  );
}

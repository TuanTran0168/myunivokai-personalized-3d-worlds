import { NextResponse, type NextRequest } from "next/server";
import { serializeCookie } from "@/lib/cookie-serialize";
import { ADMIN_ACCESS_COOKIE_NAME, ADMIN_ACCOUNT_COOKIE_NAME, readAccessTokenExpiry } from "@/lib/session";

// Every route other than /login is denied without a valid session
// (notes/plans/services/auth-and-admin-plan.md#the-admin-app, S4-AUTH-004's
// scenario). "Valid" here only means the access token has not obviously
// expired — the real authorization boundary (signature + Redis tokenVersion)
// is the gateway's RequireAdminAccessToken, run on every request that
// actually touches admin data. This is a UX gate, not that boundary.
//
// Deliberately NOT attempting a silent refresh here: the refresh cookie is
// scoped to Path=/api/admin/auth (contracts/openapi-admin.yaml's
// refreshTokenCookie scheme), so the browser never attaches it to a request
// for any other path — middleware handling a request to "/" structurally
// cannot see it, no matter what code runs here. Reviving an expired session
// is instead the login page's job (it calls /api/admin/auth/refresh
// directly, which the browser DOES attach the cookie to) and the dashboard's
// periodic keep-alive (useSessionKeepAlive) — see those two call sites.
const LOGIN_PATH = "/login";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === LOGIN_PATH;

  const accessToken = request.cookies.get(ADMIN_ACCESS_COOKIE_NAME)?.value;
  const hasFreshSession = Boolean(accessToken) && isAccessTokenFresh(accessToken!);

  if (hasFreshSession) {
    return isLoginPage ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }
  return isLoginPage ? NextResponse.next() : redirectToLogin(request);
}

export function isAccessTokenFresh(accessToken: string): boolean {
  const expiryMilliseconds = readAccessTokenExpiry(accessToken);
  return expiryMilliseconds !== null && expiryMilliseconds > Date.now();
}

function redirectToLogin(request: NextRequest): NextResponse {
  const response = NextResponse.redirect(new URL(LOGIN_PATH, request.url));
  // Only the access/account cookies, which middleware actually verified are
  // stale — NOT the refresh cookie: it is scoped to Path=/api/admin/auth, so
  // middleware handling a request to any other path never even sees it and
  // has no basis to judge it invalid. Clearing it here would force a full
  // re-login even when the refresh token is still perfectly good; the login
  // page's own silent-refresh attempt (which DOES reach that path) is what
  // gets an authoritative answer.
  for (const name of [ADMIN_ACCESS_COOKIE_NAME, ADMIN_ACCOUNT_COOKIE_NAME]) {
    response.headers.append("Set-Cookie", serializeCookie(name, "", { path: "/", maxAge: 0 }));
  }
  return response;
}

export const config = {
  // Never gate the relay routes themselves: login must be reachable with no
  // session at all, and refresh/logout are read by RequireAdminRefreshCookie
  // on the gateway side, not this access-token check.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|api/admin/auth).*)"]
};

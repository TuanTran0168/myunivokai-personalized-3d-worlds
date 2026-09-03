import { NextResponse, type NextRequest } from "next/server";
import {
  buildContentSecurityPolicy,
  createContentSecurityPolicyNonce,
  CONTENT_SECURITY_POLICY_NONCE_HEADER,
  SECURITY_RESPONSE_HEADERS
} from "@/lib/contentSecurityPolicy";
import { gatewayOriginUrl } from "@/lib/gateway";

/**
 * This app's first response headers, and the reason it needs middleware at all.
 *
 * The Content-Security-Policy uses a per-request nonce so that Next's own
 * inline bootstrap scripts are allowed and no others are — see
 * `lib/contentSecurityPolicy.ts` for why `'unsafe-inline'` would have been a
 * policy that permits the attack it exists to stop. A per-request value can
 * only be produced per request, which rules out `next.config`'s static
 * `headers()`.
 *
 * The nonce is passed forward on a request header as well as in the policy,
 * because Next reads it out of the CSP header for its own scripts but a server
 * component that ever needs to render one of its own has no other way to see it.
 */
export function middleware(request: NextRequest) {
  const nonce = createContentSecurityPolicyNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    gatewayOrigin: gatewayOriginUrl(),
    allowDevelopmentEval: process.env.NODE_ENV === "development"
  });

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(CONTENT_SECURITY_POLICY_NONCE_HEADER, nonce);
  forwardedHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = NextResponse.next({ request: { headers: forwardedHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  for (const [headerName, headerValue] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
    response.headers.set(headerName, headerValue);
  }
  return response;
}

/**
 * Every document request, and nothing else.
 *
 * The excluded paths are all responses a CSP says nothing useful about:
 * `_next/static` and `_next/image` are assets whose own content type governs
 * them, and the icon and asset routes are files. Running middleware on them
 * would generate a nonce per image on a page that loads dozens of models —
 * real work, in a hot path, for a header nothing reads.
 *
 * Written as a negative lookahead rather than a list of page paths because the
 * failure modes are not symmetrical: a page added later and forgotten would
 * ship with NO policy, while an asset added later and forgotten only pays for
 * a header it ignores.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|assets|vendor|models|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|glb|gltf|wasm|hdr|mp3|ogg|wav)$).*)"]
};

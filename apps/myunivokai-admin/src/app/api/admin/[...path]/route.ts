import { NextResponse, type NextRequest } from "next/server";
import { gatewayOriginUrl } from "@/lib/gateway";
import { forwardedRelayHeaders } from "@/lib/relay-headers";

// Same reasoning as auth-relay.ts's GATEWAY_REQUEST_TIMEOUT_MILLISECONDS: a
// hung gateway must not be able to hold a list/detail request open
// indefinitely — every feature page's useQuery would otherwise sit on its
// loading skeleton for however long the stalled socket takes to give up.
const GATEWAY_REQUEST_TIMEOUT_MILLISECONDS = 8_000;

// Generic BFF relay for every /api/admin/* management route (accounts,
// roles, permissions, audit) EXCEPT the literal /api/admin/auth/* routes,
// which Next.js resolves first since they're more specific — see
// src/app/api/admin/auth/*/route.ts and src/lib/auth-relay.ts for why the
// BFF pattern exists at all (cookies first-party to THIS app, not the
// gateway's origin). Unlike the auth routes, these never set cookies of
// their own — they only need to forward the caller's already-first-party
// access cookie to the gateway and relay the JSON response back verbatim.
async function proxyToGateway(request: NextRequest, routeParams: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const { path } = await routeParams.params;
  const targetUrl = new URL(`/api/admin/${path.join("/")}`, gatewayOriginUrl());
  targetUrl.search = request.nextUrl.search;

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let gatewayResponse: Response;
  try {
    gatewayResponse = await fetch(targetUrl, {
      method: request.method,
      headers: {
        Cookie: request.headers.get("cookie") ?? "",
        ...(hasBody ? { "Content-Type": "application/json" } : {})
      },
      body: hasBody ? await request.text() : undefined,
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
  return new NextResponse(bodyText.length > 0 ? bodyText : null, {
    status: gatewayResponse.status,
    headers: forwardedRelayHeaders(gatewayResponse)
  });
}

export { proxyToGateway as GET, proxyToGateway as POST, proxyToGateway as PATCH, proxyToGateway as DELETE };

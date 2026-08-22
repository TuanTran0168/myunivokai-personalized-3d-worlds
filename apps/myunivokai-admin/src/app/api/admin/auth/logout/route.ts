import type { NextRequest } from "next/server";
import { proxyToGatewayAuth } from "@/lib/auth-relay";
import { serializeCookie } from "@/lib/cookie-serialize";
import { ADMIN_ACCOUNT_COOKIE_NAME } from "@/lib/session";

export async function POST(request: NextRequest) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const response = await proxyToGatewayAuth("/api/admin/auth/logout", {
    method: "POST",
    headers: { Cookie: cookieHeader }
  });
  // Logout's 204 has no body, so proxyToGatewayAuth never sees an account
  // to cache-clear the way login/refresh do — clear it explicitly here. The
  // access/refresh cookies are already cleared by the gateway's own relayed
  // Set-Cookie headers.
  response.headers.append("Set-Cookie", serializeCookie(ADMIN_ACCOUNT_COOKIE_NAME, "", { path: "/", maxAge: 0 }));
  return response;
}

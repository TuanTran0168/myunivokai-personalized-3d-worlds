import type { NextRequest } from "next/server";
import { proxyToGatewayAuth } from "@/lib/auth-relay";

export async function POST(request: NextRequest) {
  // The refresh cookie is first-party to this app (relayed there by login),
  // so it already arrived on this very request — forward it as-is rather
  // than picking it apart, same as the gateway does with auth-service.
  const cookieHeader = request.headers.get("cookie") ?? "";
  return proxyToGatewayAuth("/api/admin/auth/refresh", {
    method: "POST",
    headers: { Cookie: cookieHeader }
  });
}

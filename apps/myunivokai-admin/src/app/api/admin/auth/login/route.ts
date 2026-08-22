import type { NextRequest } from "next/server";
import { proxyToGatewayAuth } from "@/lib/auth-relay";

export async function POST(request: NextRequest) {
  const body = await request.text();
  return proxyToGatewayAuth("/api/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
}

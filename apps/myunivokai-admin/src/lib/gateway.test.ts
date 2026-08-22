import { describe, expect, it } from "vitest";
import { normalizeGatewayBaseUrl } from "./gateway";

describe("gateway URL configuration", () => {
  it("normalizes a gateway origin and removes its trailing slash", () => {
    expect(normalizeGatewayBaseUrl("https://myunivokai-gateway.onrender.com/")).toBe(
      "https://myunivokai-gateway.onrender.com"
    );
  });

  it.each([
    "myunivokai-gateway.onrender.com",
    "ftp://myunivokai-gateway.onrender.com",
    "https://user:password@myunivokai-gateway.onrender.com",
    "https://myunivokai-gateway.onrender.com/api",
    "https://myunivokai-gateway.onrender.com?region=oregon",
    "https://myunivokai-gateway.onrender.com#status"
  ])("rejects an unsafe or ambiguous gateway value: %s", (gatewayBaseUrl) => {
    expect(() => normalizeGatewayBaseUrl(gatewayBaseUrl)).toThrow("ADMIN_GATEWAY_BASE_URL");
  });
});

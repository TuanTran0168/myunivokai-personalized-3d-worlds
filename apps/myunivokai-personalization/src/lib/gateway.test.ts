import { describe, expect, it } from "vitest";
import { buildGatewayApiBaseUrl, normalizeGatewayBaseUrl } from "./gateway";

describe("gateway URL configuration", () => {
  it("normalizes a gateway origin and removes its trailing slash", () => {
    expect(normalizeGatewayBaseUrl("https://myunivokai-gateway.onrender.com/")).toBe(
      "https://myunivokai-gateway.onrender.com"
    );
  });

  it("builds both family routes from one gateway origin", () => {
    const gatewayBaseUrl = "https://myunivokai-gateway.onrender.com";

    expect(buildGatewayApiBaseUrl(gatewayBaseUrl, "universe")).toBe(
      "https://myunivokai-gateway.onrender.com/api/universe"
    );
    expect(buildGatewayApiBaseUrl(gatewayBaseUrl, "nature")).toBe(
      "https://myunivokai-gateway.onrender.com/api/nature"
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
    expect(() => normalizeGatewayBaseUrl(gatewayBaseUrl)).toThrow("NEXT_PUBLIC_GATEWAY_BASE_URL");
  });
});

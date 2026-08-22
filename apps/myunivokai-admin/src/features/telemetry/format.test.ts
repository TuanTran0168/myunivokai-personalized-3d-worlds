import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/components/layout/nav-config";
import { PERMISSIONS } from "@/lib/session";
import { formatStatusClass, formatWindow } from "./format";
import { DEFAULT_TELEMETRY_HOURS, TELEMETRY_WINDOW_OPTIONS } from "./types";

describe("status class labels", () => {
  // A status class arrives as a leading digit. Spelling it out is what makes
  // the mix readable without a key beside it.
  it("names every class the contract allows", () => {
    expect(formatStatusClass(2)).toBe("2xx success");
    expect(formatStatusClass(4)).toBe("4xx client error");
    expect(formatStatusClass(5)).toBe("5xx server error");
  });

  // The contract bounds the class to 1..5, but a screen that throws on an
  // unexpected number is worse than one that shows it.
  it("falls back to the raw class rather than failing", () => {
    expect(formatStatusClass(9)).toBe("9xx");
  });
});

describe("window labels", () => {
  it("reads in hours below a day and in days above it", () => {
    expect(formatWindow(1)).toBe("last 1 hour");
    expect(formatWindow(6)).toBe("last 6 hours");
    expect(formatWindow(24)).toBe("last 1 day");
    expect(formatWindow(168)).toBe("last 7 days");
  });
});

describe("window options", () => {
  // These mirror contracts.TelemetryMaximumHours. telemetry-service clamps
  // server-side too, so a drift here degrades the picker rather than breaking
  // a query - but a picker offering a window the service will silently shrink
  // is a screen that lies about what it is showing.
  it("never offers a window longer than the service will honour", () => {
    const maximumHours = 168;
    for (const option of TELEMETRY_WINDOW_OPTIONS) {
      expect(option.value).toBeGreaterThan(0);
      expect(option.value).toBeLessThanOrEqual(maximumHours);
    }
  });

  it("offers the default the page starts on", () => {
    expect(TELEMETRY_WINDOW_OPTIONS.some((option) => option.value === DEFAULT_TELEMETRY_HOURS)).toBe(true);
  });
});

describe("navigation", () => {
  // The nav gates on chartRead because the gateway gates /telemetry/* on
  // chartRead. A mismatch here shows a staff member a link to a page the
  // gateway will answer with 403.
  it("gates Telemetry on the same permission the gateway requires", () => {
    const telemetry = NAV_ITEMS.find((item) => item.href === "/telemetry");
    expect(telemetry).toBeDefined();
    expect(telemetry?.permission).toBe(PERMISSIONS.chartRead);
  });

  it("keeps Fleet and Telemetry as separate entries", () => {
    // They answer different questions from different services: Fleet is which
    // processes restarted and which the gateway could not wake, Telemetry is
    // what the platform served. Merging them would put one service's outage on
    // the other's screen.
    expect(NAV_ITEMS.filter((item) => item.href === "/fleet")).toHaveLength(1);
    expect(NAV_ITEMS.filter((item) => item.href === "/telemetry")).toHaveLength(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clientRenderFamilyForSceneType,
  reportClientRender,
  resetClientRenderReportsForTesting,
  CLIENT_RENDER_OUTCOME_RENDERED,
  CLIENT_RENDER_OUTCOME_WEBGL_FAILED
} from "./reportClientRender";
import { QUALITY_TIER_HIGH, QUALITY_TIER_MINIMAL } from "./deviceQualityTier";

// The values the gateway will accept, written out here rather than imported
// from anything shared — there is nothing shared to import, and that is the
// point. If the backend's closed set changes, this file must be edited by hand,
// which is the only signal a TypeScript app gets from a Go contract.
const FAMILIES_THE_GATEWAY_ACCEPTS = ["universe", "nature", "ocean"];

describe("clientRenderFamilyForSceneType", () => {
  // The one translation that matters: the nature family's scenes carry the
  // scene type "forest". Sending the scene type straight through would file
  // every nature render under a family the gateway refuses — as a 400 nobody
  // can see, because sendBeacon cannot read a response.
  it("maps the forest scene type to the nature family", () => {
    expect(clientRenderFamilyForSceneType("forest")).toBe("nature");
  });

  it("maps the ocean scene type to itself", () => {
    expect(clientRenderFamilyForSceneType("ocean")).toBe("ocean");
  });

  it("treats an absent or unrecognised scene type as the universe family", () => {
    expect(clientRenderFamilyForSceneType(undefined)).toBe("universe");
    expect(clientRenderFamilyForSceneType("")).toBe("universe");
    expect(clientRenderFamilyForSceneType("nebula-variant-nobody-has-shipped")).toBe("universe");
  });

  it("only ever produces a family the gateway accepts", () => {
    for (const sceneType of ["forest", "ocean", "universe", "", "anything"]) {
      expect(FAMILIES_THE_GATEWAY_ACCEPTS).toContain(clientRenderFamilyForSceneType(sceneType));
    }
  });
});

describe("reportClientRender", () => {
  let sendBeacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetClientRenderReportsForTesting();
    sendBeacon = vi.fn().mockReturnValue(true);
    // This app's vitest environment is node with no jsdom — a deliberate
    // choice recorded in vitest.config.ts ("minimal vitest setup for
    // pure-function unit tests"), and not one to reverse for a telemetry
    // test. `window` is stubbed rather than emulated because the only thing
    // the reporter asks of it is that it exists: the check is the SSR guard,
    // and a report sent while rendering on the server would be a report about
    // a device that never rendered anything.
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { sendBeacon });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function bodyOf(call: unknown[]): Promise<unknown> {
    const payload = call[1] as Blob;
    return JSON.parse(await payload.text());
  }

  it("sends exactly the three fields the contract declares, and nothing else", async () => {
    reportClientRender({
      qualityTier: QUALITY_TIER_HIGH,
      family: "universe",
      outcome: CLIENT_RENDER_OUTCOME_RENDERED
    });

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const body = await bodyOf(sendBeacon.mock.calls[0]);
    // Asserted as an exact object rather than field by field. This is the
    // check that fails if anybody ever adds a world id, an account id or a
    // session id to a payload that goes to an unauthenticated endpoint.
    expect(body).toEqual({
      qualityTier: QUALITY_TIER_HIGH,
      family: "universe",
      outcome: CLIENT_RENDER_OUTCOME_RENDERED
    });
  });

  it("sends application/json, because a text/plain beacon is refused by the gateway", () => {
    reportClientRender({
      qualityTier: QUALITY_TIER_MINIMAL,
      family: "ocean",
      outcome: CLIENT_RENDER_OUTCOME_WEBGL_FAILED
    });
    const payload = sendBeacon.mock.calls[0][1] as Blob;
    expect(payload.type).toBe("application/json");
  });

  it("reports one fact once, however many times a scene re-renders", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      reportClientRender({
        qualityTier: QUALITY_TIER_HIGH,
        family: "nature",
        outcome: CLIENT_RENDER_OUTCOME_RENDERED
      });
    }
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  // A visitor who switches from universe to ocean rendered two scenes, and
  // both are facts. The guard is per family and outcome for exactly this.
  it("reports a second family after a switch", () => {
    reportClientRender({
      qualityTier: QUALITY_TIER_HIGH,
      family: "universe",
      outcome: CLIENT_RENDER_OUTCOME_RENDERED
    });
    reportClientRender({
      qualityTier: QUALITY_TIER_HIGH,
      family: "ocean",
      outcome: CLIENT_RENDER_OUTCOME_RENDERED
    });
    expect(sendBeacon).toHaveBeenCalledTimes(2);
  });

  // A scene that rendered and then lost its context is two different facts
  // about the same family, and the failure is the one nobody could count
  // before this.
  it("reports a failure after a success on the same family", () => {
    reportClientRender({
      qualityTier: QUALITY_TIER_HIGH,
      family: "universe",
      outcome: CLIENT_RENDER_OUTCOME_RENDERED
    });
    reportClientRender({
      qualityTier: QUALITY_TIER_HIGH,
      family: "universe",
      outcome: CLIENT_RENDER_OUTCOME_WEBGL_FAILED
    });
    expect(sendBeacon).toHaveBeenCalledTimes(2);
  });

  it("falls back to fetch when the browser refuses to queue the beacon", () => {
    sendBeacon.mockReturnValue(false);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    reportClientRender({
      qualityTier: QUALITY_TIER_MINIMAL,
      family: "nature",
      outcome: CLIENT_RENDER_OUTCOME_RENDERED
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    // keepalive is what lets the request outlive the page, which is the whole
    // reason sendBeacon is preferred above it.
    expect(init.keepalive).toBe(true);
  });

  // A privacy configuration that throws from sendBeacon must not take the page
  // down with it. This is the assertion that would fail if the try/catch were
  // ever "tidied" away.
  it("survives a browser that throws from sendBeacon", () => {
    sendBeacon.mockImplementation(() => {
      throw new Error("beacons are blocked");
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    expect(() =>
      reportClientRender({
        qualityTier: QUALITY_TIER_HIGH,
        family: "universe",
        outcome: CLIENT_RENDER_OUTCOME_RENDERED
      })
    ).not.toThrow();
  });

  // Telemetry that reports its own failure to the visitor is worse than
  // telemetry that is missing.
  it("swallows a rejected fetch rather than producing an unhandled rejection", async () => {
    sendBeacon.mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    expect(() =>
      reportClientRender({
        qualityTier: QUALITY_TIER_HIGH,
        family: "universe",
        outcome: CLIENT_RENDER_OUTCOME_RENDERED
      })
    ).not.toThrow();
    await Promise.resolve();
  });
});

describe("reportClientRender outside a browser", () => {
  // Next renders these components on the server too. A report from there would
  // describe a device that never rendered anything, and there is no navigator
  // to send it with.
  it("sends nothing when there is no window", () => {
    resetClientRenderReportsForTesting();
    const sendBeacon = vi.fn();
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("navigator", { sendBeacon });
    reportClientRender({
      qualityTier: QUALITY_TIER_HIGH,
      family: "universe",
      outcome: CLIENT_RENDER_OUTCOME_RENDERED
    });
    expect(sendBeacon).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

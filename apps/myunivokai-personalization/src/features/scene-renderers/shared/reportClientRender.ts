import { gatewayOriginUrl } from "@/lib/gateway";
import type { DeviceQualityTier } from "./deviceQualityTier";

// What the browser tells the platform about itself, and the only thing it ever
// tells it.
//
// Sprint 07 shipped `classifyDeviceQualityTier`, which computes exactly the
// classification whose DISTRIBUTION is the open question — and threw it away
// after the first frame. `WebGLFailureBoundary` shipped beside it and catches a
// failure nobody could count. Both are measured here.
//
// The payload is a tier, a family and an outcome. No world id, no account id,
// no session id, no user-agent string, no timing. That is what makes an
// unauthenticated endpoint the right place to send it rather than a
// compromise: there is nothing in it a token would protect, and requiring one
// would silently exclude every visitor who never signed in — most of them, and
// the ones a weak device is most likely to belong to.

const CLIENT_RENDER_REPORT_PATH = "/api/telemetry/render";

export const CLIENT_RENDER_OUTCOME_RENDERED = "rendered";
export const CLIENT_RENDER_OUTCOME_WEBGL_FAILED = "webgl_failed";

export type ClientRenderOutcome =
  | typeof CLIENT_RENDER_OUTCOME_RENDERED
  | typeof CLIENT_RENDER_OUTCOME_WEBGL_FAILED;

// The families the gateway will accept. Kept as a literal union rather than
// derived from a scene type, because this is a wire contract: a family the
// backend has not shipped yet must fail typecheck here rather than become a
// 400 nobody reads.
export type ClientRenderFamily = "universe" | "nature" | "ocean";

export interface ClientRenderReport {
  qualityTier: DeviceQualityTier;
  family: ClientRenderFamily;
  outcome: ClientRenderOutcome;
}

// A scene's TYPE is not its FAMILY, and the one place they disagree is the one
// that matters: the nature family renders a scene whose `sceneType` is
// `"forest"`. A report that sent the scene type straight through would file
// every nature render under a family the gateway refuses, and the refusal is a
// 400 nobody reads because `sendBeacon` cannot see a response.
//
// So the translation is a named function rather than an inline ternary, and it
// is the only place this mapping exists.
const FOREST_SCENE_TYPE = "forest";
const OCEAN_SCENE_TYPE = "ocean";

export function clientRenderFamilyForSceneType(sceneType?: string): ClientRenderFamily {
  if (sceneType === FOREST_SCENE_TYPE) {
    return "nature";
  }
  if (sceneType === OCEAN_SCENE_TYPE) {
    return "ocean";
  }
  // The universe family is the default rather than a third branch, because it
  // is the family whose scenes carry no distinguishing sceneType — and a scene
  // type this app has never seen is far more likely to be a new universe
  // variant than a family the gateway has not shipped.
  return "universe";
}

// One report per page load per family, tracked here rather than in a hook's
// state so that a remount — which a family switch causes — does not send a
// second copy of the same fact. A visitor who switches from universe to ocean
// reports twice, which is correct: two scenes rendered.
const reportedKeys = new Set<string>();

function reportKey(report: ClientRenderReport): string {
  return `${report.family}:${report.outcome}`;
}

/**
 * Sends one render report, at most once per family and outcome per page load.
 *
 * Fire and forget in the strongest sense: nothing here can fail in a way the
 * visitor experiences. `sendBeacon` cannot report an error and cannot be read;
 * the `fetch` fallback discards its own rejection. A visitor whose scene
 * rendered must never see a problem because a counter did not increment.
 */
export function reportClientRender(report: ClientRenderReport): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return;
  }
  const key = reportKey(report);
  if (reportedKeys.has(key)) {
    return;
  }
  // Marked before the send rather than after it. A failed send must not leave
  // the door open for a retry loop on every re-render, and one lost report is
  // worth less than the risk of many duplicated ones.
  reportedKeys.add(key);

  const endpoint = `${gatewayOriginUrl()}${CLIENT_RENDER_REPORT_PATH}`;
  const body = JSON.stringify(report);

  // sendBeacon survives the page being closed, which matters for the failure
  // outcome specifically: a visitor whose canvas died is more likely to leave
  // immediately than one whose scene rendered, and a `fetch` in flight when
  // they do is cancelled.
  //
  // The type is deliberately application/json rather than a Blob-free string
  // send: a bare string beacon is sent as text/plain, which the gateway's JSON
  // decoder refuses.
  if (typeof navigator.sendBeacon === "function") {
    try {
      if (navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }))) {
        return;
      }
      // sendBeacon returns false when the browser refused to queue it — a full
      // queue, or a payload over its own limit. Falling through to fetch is
      // the documented recovery.
    } catch {
      // Some privacy configurations throw here rather than returning false.
    }
  }

  void fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    // Lets the request outlive the page, which is the whole reason to prefer
    // sendBeacon above; this is the closest fetch gets.
    keepalive: true
  }).catch(() => {
    // Telemetry that reports its own failure to the visitor would be worse
    // than telemetry that is missing.
  });
}

/**
 * Clears the once-per-page guard. Exists for tests, which would otherwise see
 * the first case's report suppress every later one in the same file.
 */
export function resetClientRenderReportsForTesting(): void {
  reportedKeys.clear();
}

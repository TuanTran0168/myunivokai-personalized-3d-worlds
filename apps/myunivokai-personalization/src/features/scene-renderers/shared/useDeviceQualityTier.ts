"use client";

import { useEffect, useState } from "react";
import {
  QUALITY_TIER_HIGH,
  classifyDeviceQualityTier,
  renderProfileForTier,
  type DeviceRenderCapabilities,
  type DeviceRenderProfile
} from "./deviceQualityTier";

/**
 * Reads the device's capabilities once and hands back the render profile.
 *
 * Split from `deviceQualityTier.ts` so that the decision stays a pure function
 * of plain values: everything that touches a browser global lives here, and
 * everything that can be reasoned about lives there and is unit-tested without
 * a DOM.
 */

/**
 * Media query for a device whose primary pointer is a finger.
 *
 * Preferred over sniffing the user agent, which lies by design — every mobile
 * browser has claimed to be several other browsers for twenty years, and iPadOS
 * reports itself as a Mac. Pointer capability is a property of the hardware and
 * cannot be spoofed by a compatibility string.
 */
const COARSE_POINTER_MEDIA_QUERY = "(pointer: coarse)";

/**
 * Creates a throwaway WebGL context purely to ask it two questions.
 *
 * Deliberately its own canvas rather than the scene's: this runs BEFORE the
 * scene's canvas exists, since the answer is what decides how that canvas is
 * configured. The context is released immediately — `WEBGL_lose_context` rather
 * than left to garbage collection, because browsers cap the number of live
 * WebGL contexts per page and silently drop the OLDEST when the cap is hit,
 * which would be the scene's own.
 */
function readWebGLCapabilities(): Pick<
  DeviceRenderCapabilities,
  "supportsWebGL2" | "maximumTextureSize" | "rendererDescription"
> {
  if (typeof document === "undefined") {
    return {};
  }
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!context) {
      // No context at all is a stronger signal than a slow one, and the caller
      // reads `supportsWebGL2 === false` as exactly that.
      return { supportsWebGL2: false };
    }
    const supportsWebGL2 = typeof WebGL2RenderingContext !== "undefined" && context instanceof WebGL2RenderingContext;
    const maximumTextureSize = context.getParameter(context.MAX_TEXTURE_SIZE) as number | undefined;

    // Firefox gates this extension behind a preference and Safari has removed
    // it more than once, so its absence is normal rather than exceptional and
    // must not be treated as a failure.
    const debugRendererInfo = context.getExtension("WEBGL_debug_renderer_info");
    const rendererDescription = debugRendererInfo
      ? (context.getParameter(debugRendererInfo.UNMASKED_RENDERER_WEBGL) as string | undefined)
      : undefined;

    const loseContext = context.getExtension("WEBGL_lose_context");
    loseContext?.loseContext();

    return { supportsWebGL2, maximumTextureSize, rendererDescription };
  } catch {
    // A browser that throws while being asked what it can do has answered the
    // question. Returning nothing lets the caller fall through to the default,
    // which is today's profile.
    return {};
  } finally {
    canvas?.remove();
  }
}

function readDeviceRenderCapabilities(): DeviceRenderCapabilities {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {};
  }
  const isMobile = window.matchMedia?.(COARSE_POINTER_MEDIA_QUERY).matches ?? false;
  // `deviceMemory` is Chromium-only and absent from the DOM lib's Navigator.
  const deviceMemoryGigabytes = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  return {
    isMobile,
    isUnderAutomation: navigator.webdriver === true,
    logicalProcessorCount: navigator.hardwareConcurrency,
    deviceMemoryGigabytes,
    ...readWebGLCapabilities()
  };
}

/**
 * The profile this device should start on.
 *
 * Returns the HIGH profile on the first render, always, and that is the
 * important part rather than an implementation detail:
 *
 *  - **The server has no device to measure.** Rendering a tiered profile during
 *    SSR would mean guessing, and a guess that differs from what the client
 *    then computes is a hydration mismatch on the page's most expensive
 *    component.
 *  - **Failing toward quality is the repo's stance.** If the effect below never
 *    runs, or the browser answers nothing, the visitor gets today's scene.
 *
 * The classification runs once per mount and is not re-run on resize or
 * orientation change: the answer is a property of the hardware, and changing
 * the profile mid-scene would rebuild the render graph, which is precisely the
 * multi-second freeze the sprint spent its time removing.
 */
export function useDeviceQualityTier(): DeviceRenderProfile {
  const [profile, setProfile] = useState<DeviceRenderProfile>(() => renderProfileForTier(QUALITY_TIER_HIGH));

  useEffect(() => {
    const capabilities = readDeviceRenderCapabilities();
    setProfile(renderProfileForTier(classifyDeviceQualityTier(capabilities)));
  }, []);

  return profile;
}

/**
 * HOW MANY ANISOTROPIC SAMPLES A TEXTURE MAY ASK FOR, WITHOUT ASSUMING WHICH
 * RENDERER IS ASKING.
 *
 * `renderer.capabilities.getMaxAnisotropy()` is a `WebGLRenderer` method.
 * `WebGPURenderer` has no `capabilities` object at all, so reading through it
 * throws `Cannot read properties of undefined (reading 'getMaxAnisotropy')` —
 * inside a `useMemo`, during the ocean rig's build, which `WebGLFailureBoundary`
 * then catches and replaces the whole canvas with a failure state.
 *
 * That is not a hypothetical from a migration guide. It is the first thing that
 * actually broke when Phase 4's parity harness pointed a `WebGPURenderer` at
 * this app: the WebGL leg photographed fine, both WebGPU legs took the canvas
 * down before a frame, and the only trace was a browser-level error the page
 * itself never reported. §3 of
 * agent-system/research/webgpu-full-migration-feasibility-2026.md audits
 * "WebGL-specific APIs" and counts five type sites, three raw context calls and
 * one event listener; these two `capabilities` reads are a sixth kind it does
 * not list, and they are the only ones so far that are fatal rather than
 * degrading.
 *
 * WHY 16 IS THE RIGHT FALLBACK AND NOT A GUESS. WebGPU has no query for this:
 * a `GPUSamplerDescriptor` takes `maxAnisotropy` directly, and implementations
 * clamp it — 16 is the ceiling every shipping implementation honours. Desktop
 * WebGL drivers report 16 from `EXT_texture_filter_anisotropic` as well, so on
 * the hardware this app is tuned for the two paths agree on the same number, and
 * asking for more than a driver supports is defined to clamp rather than fail.
 *
 * So this is not a downgrade for the WebGPU path — it is the same value by a
 * different route.
 */

/**
 * The ceiling to use when the renderer does not expose one.
 *
 * Not a taste value: it is WebGPU's practical `maxAnisotropy` limit and the
 * value desktop WebGL drivers report, and anything above a driver's real limit
 * is clamped rather than rejected.
 */
export const MAXIMUM_ANISOTROPY_WITHOUT_A_LIMIT_QUERY = 16;

type RendererWithCapabilities = {
  capabilities?: { getMaxAnisotropy?: () => number };
};

/**
 * The renderer's own anisotropy limit, or the named ceiling when it has none.
 *
 * Defensive about all three ways this can go wrong rather than only the one that
 * was seen: no `capabilities` object (WebGPURenderer today), a `capabilities`
 * object without the method (a future rename), and a method that returns
 * something unusable. A texture's sample count is not worth a thrown error from
 * any of them — this is the property that made a whole canvas fail over a
 * filtering hint.
 */
export function maximumTextureAnisotropy(renderer: unknown): number {
  const capabilities = (renderer as RendererWithCapabilities | null | undefined)?.capabilities;
  if (typeof capabilities?.getMaxAnisotropy !== "function") {
    return MAXIMUM_ANISOTROPY_WITHOUT_A_LIMIT_QUERY;
  }
  const reported = capabilities.getMaxAnisotropy();
  if (!Number.isFinite(reported) || reported < 1) {
    return MAXIMUM_ANISOTROPY_WITHOUT_A_LIMIT_QUERY;
  }
  return reported;
}

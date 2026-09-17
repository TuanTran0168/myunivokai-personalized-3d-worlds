/**
 * WHAT THE BROWSER WILL ACTUALLY GIVE US, ASKED BEFORE THE CANVAS IS BUILT —
 * AND DELIBERATELY NOT USED TO CHOOSE THE RENDERER.
 *
 * §26 Phase 9, and §18.3(a) of the feasibility report, which is precise about
 * what this is for: *"an async pre-flight before the canvas mounts, for the
 * QUALITY TIER, not for renderer selection"*. The distinction is the whole
 * design and it is easy to get backwards.
 *
 * # Why this must not pick the renderer
 *
 * §17 compares four architectures and rejects "choose the renderer at runtime"
 * by name: a manual pre-flight is *"easy to get wrong"* against a fallback that
 * `WebGPURenderer` installs in its own constructor and fires on the one event
 * that actually matters — `backend.init()` rejecting. There are four gates
 * between a browser and a working device (§18.2), two of them asynchronous, and
 * one of them — `requestDevice()` — can reject after `requestAdapter()` has
 * already succeeded. Phase 0 measured exactly that on this machine: full
 * Chromium reported an adapter with fifteen features and then refused the
 * device. A pre-flight that answered "yes, WebGPU" on that row and handed the
 * app a renderer it could not build would have been worse than no pre-flight,
 * because the renderer's own fallback covers the same case correctly.
 *
 * So `rendererSelection.ts` never reads this file. The renderer is chosen by
 * policy and the BACKEND is chosen by three.
 *
 * # What it IS for
 *
 * `classifyDeviceQualityTier` decides shadows and the post profile before the
 * first frame, from a throwaway WebGL context. That probe answers a question
 * about a renderer the app is leaving. **A machine with a SOFTWARE WebGPU
 * device would pass the WebGL probe with a real GPU name and then render every
 * frame on the CPU**, at the top tier, with shadows and eight passes of
 * post-processing. The WebGL probe cannot see that, because it is not looking
 * at the adapter that will draw.
 *
 * # Failing toward quality, which is this repo's stance and not a default
 *
 * An adapter that describes itself as nothing is HARDWARE here. Chrome redacts
 * `adapter.info` under some privacy settings and returns empty strings rather
 * than throwing, and treating an answered-nothing as a software rasteriser
 * would quietly downgrade every visitor who turned a privacy toggle on.
 * `deviceQualityTier.ts` makes the same call for the same reason and says so at
 * greater length.
 */

/** No `navigator.gpu` at all: an insecure context, or a browser without WebGPU. */
export const WEBGPU_ADAPTER_ABSENT = "absent";
/** `requestAdapter()` resolved `null` — a blocklisted driver, or no GPU it will use. */
export const WEBGPU_ADAPTER_NONE = "none";
/** An adapter that names a CPU rasteriser. It will draw, and it will draw slowly. */
export const WEBGPU_ADAPTER_SOFTWARE = "software";
/** An adapter that is, as far as it will say, a real GPU. */
export const WEBGPU_ADAPTER_HARDWARE = "hardware";

export type WebGPUAdapterAvailability =
  | typeof WEBGPU_ADAPTER_ABSENT
  | typeof WEBGPU_ADAPTER_NONE
  | typeof WEBGPU_ADAPTER_SOFTWARE
  | typeof WEBGPU_ADAPTER_HARDWARE;

/**
 * The four strings `GPUAdapterInfo` carries.
 *
 * Every one is optional because every one is allowed to be the empty string by
 * specification, and because this type is also fed by the older
 * `requestAdapterInfo()` shape that some browsers still ship.
 */
export type WebGPUAdapterIdentity = {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
};

/**
 * Names that identify a CPU rasteriser pretending to be a GPU.
 *
 * Deliberately a SEPARATE list from `deviceQualityTier.ts`'s WebGL one rather
 * than a shared constant, because the two APIs name the same rasterisers
 * differently and a shared list would have to be the union — which is how a
 * marker that is safe in one vocabulary starts matching a real product name in
 * the other. Dawn's software adapter reports `swiftshader`; Mesa's Vulkan
 * rasteriser is `lavapipe`; Microsoft's D3D12 one is `WARP`.
 */
const SOFTWARE_ADAPTER_MARKERS = ["swiftshader", "lavapipe", "llvmpipe", "warp", "basic render", "software"];

/**
 * Whether an adapter is a CPU rasteriser, from what it says about itself.
 *
 * Pure, so the classification can be tested without a GPU — which matters more
 * here than usual, since CI has no WebGPU at all and this branch would
 * otherwise never be exercised anywhere.
 */
export function classifyWebGPUAdapterIdentity(
  identity: WebGPUAdapterIdentity | undefined
): typeof WEBGPU_ADAPTER_SOFTWARE | typeof WEBGPU_ADAPTER_HARDWARE {
  if (!identity) {
    return WEBGPU_ADAPTER_HARDWARE;
  }
  const described = [identity.vendor, identity.architecture, identity.device, identity.description]
    .filter((field): field is string => typeof field === "string")
    .join(" ")
    .toLowerCase();
  if (!described.trim()) {
    return WEBGPU_ADAPTER_HARDWARE;
  }
  return SOFTWARE_ADAPTER_MARKERS.some((marker) => described.includes(marker))
    ? WEBGPU_ADAPTER_SOFTWARE
    : WEBGPU_ADAPTER_HARDWARE;
}

type AdapterWithIdentity = {
  info?: WebGPUAdapterIdentity;
  requestAdapterInfo?: () => Promise<WebGPUAdapterIdentity>;
};

type NavigatorWithGPU = {
  gpu?: { requestAdapter: () => Promise<AdapterWithIdentity | null> };
};

/**
 * Reads the adapter's identity from whichever of the two shapes this browser
 * ships.
 *
 * `adapter.info` is the current synchronous property. `requestAdapterInfo()` is
 * the older promise, still present in browsers that shipped WebGPU early, and
 * it once required an unmasking hint. Either may be missing and neither may
 * throw its way out of here — an adapter that refuses to describe itself is a
 * working adapter, and `classifyWebGPUAdapterIdentity` treats it as hardware.
 */
async function adapterIdentity(adapter: AdapterWithIdentity): Promise<WebGPUAdapterIdentity | undefined> {
  if (adapter.info) {
    return adapter.info;
  }
  if (typeof adapter.requestAdapterInfo === "function") {
    try {
      return await adapter.requestAdapterInfo();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * What WebGPU this machine has, asked once.
 *
 * **It stops at the adapter and never requests a device**, which is not an
 * omission. `requestDevice()` returns a real `GPUDevice` that holds driver
 * resources until it is destroyed, and the renderer is about to ask for its
 * own; two live devices on one page to answer a question the renderer answers
 * for itself is a cost with no buyer. The failure this does not see —
 * `requestAdapter()` succeeding and `requestDevice()` rejecting, which Phase 0
 * measured on this very machine — is precisely the case `WebGPURenderer`'s own
 * fallback exists to handle, and handles correctly.
 *
 * Never throws and never rejects. A browser that errors while being asked what
 * it can do has answered.
 */
export async function probeWebGPUAdapter(): Promise<WebGPUAdapterAvailability> {
  if (typeof navigator === "undefined") {
    return WEBGPU_ADAPTER_ABSENT;
  }
  const gpu = (navigator as unknown as NavigatorWithGPU).gpu;
  if (!gpu || typeof gpu.requestAdapter !== "function") {
    return WEBGPU_ADAPTER_ABSENT;
  }
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return WEBGPU_ADAPTER_NONE;
    }
    return classifyWebGPUAdapterIdentity(await adapterIdentity(adapter));
  } catch {
    return WEBGPU_ADAPTER_ABSENT;
  }
}

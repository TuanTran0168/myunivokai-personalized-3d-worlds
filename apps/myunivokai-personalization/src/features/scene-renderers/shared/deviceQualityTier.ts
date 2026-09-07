/**
 * Which render profile a device starts on, decided once at canvas mount.
 *
 * This is the OTHER half of the quality story, and it is worth being precise
 * about which half. `renderQuality.ts` holds the runtime half: a scene starts
 * at the display's native ratio and gives resolution back only when frames are
 * actually being missed. That controller is reactive, monotonic, and touches
 * exactly one parameter — the pixel ratio.
 *
 * It cannot help with the other two. Shadow rendering and the postprocessing
 * chain are decided when the canvas mounts and are not things a frame-rate
 * reading can walk back mid-scene without rebuilding the render graph. So a
 * device that cannot afford them has to be recognised BEFORE the first frame,
 * which is what this file does.
 *
 * # The rule this must not break
 *
 * **A strong machine gets exactly what it gets today.** The owner's stance is
 * quality-first — "60fps là tiêu chuẩn tối thiểu, cao hơn càng tốt. Tận dụng
 * sức mạnh của máy" — so tiering here raises the FLOOR for devices that cannot
 * render the scene at all. It never lowers the ceiling. `QUALITY_TIER_HIGH`'s
 * profile is today's fixed settings, and `deviceQualityTier.test.ts` asserts
 * that against the same constants the canvas uses rather than trusting this
 * comment.
 *
 * An unrecognised device gets `QUALITY_TIER_HIGH` too. Failing toward quality
 * is the deliberate direction: the runtime controller is already there to
 * catch a device that turns out to be slower than it looked, and it converges
 * in one adjustment. There is no equivalent recovery from having quietly shipped
 * a downgraded scene to a machine that could have rendered the full one.
 *
 * # Why `detect-gpu` is not used, having been the story's named library
 *
 * `S7-FE-ADAPTIVE-001` names pmndrs' `detect-gpu`, and it is already present in
 * `node_modules` as a `@react-three/drei` transitive dependency. It is not used
 * here, for a reason that did not exist when the story was written:
 *
 * `getGPUTier()` fetches its benchmark data from
 * `https://unpkg.com/detect-gpu@5.0.70/dist/benchmarks` at call time. This app's
 * Content-Security-Policy — shipped in Sprint 08, after this story was
 * written — is `connect-src 'self' <gateway origin> blob:`. That fetch is
 * blocked, and a classifier that cannot reach its data classifies nothing.
 *
 * Self-hosting the benchmarks is the documented workaround and it is
 * self-defeating here: the payload is **713 KB across 16 JSON files**, and it
 * would be downloaded at canvas mount by exactly the mobile devices on exactly
 * the connections this story exists to help. Paying most of a megabyte to find
 * out that a phone is a phone is worse than the problem.
 *
 * What is actually needed is coarser than a benchmark ranking: three buckets,
 * from signals the browser hands over for free. That is what is below.
 */

/**
 * Three tiers, because the profiles below differ in three meaningful ways and a
 * fourth bucket would have nothing distinct to say.
 *
 * Numbered rather than named ("low"/"medium"/"high") to match the story's own
 * vocabulary and `detect-gpu`'s, so a reader comparing the two is comparing
 * like with like.
 */
export const QUALITY_TIER_MINIMAL = 1;
export const QUALITY_TIER_BALANCED = 2;
export const QUALITY_TIER_HIGH = 3;

export type DeviceQualityTier =
  | typeof QUALITY_TIER_MINIMAL
  | typeof QUALITY_TIER_BALANCED
  | typeof QUALITY_TIER_HIGH;

/**
 * What the browser tells us, gathered in one place so the decision itself stays
 * a pure function of plain values and can be tested without a WebGL context.
 *
 * Every field is optional because every source of it is: `deviceMemory` is
 * Chromium-only, `UNMASKED_RENDERER_WEBGL` needs an extension that Firefox
 * gates behind a preference, and a browser that refuses all of them is a
 * browser this must still answer for.
 */
export type DeviceRenderCapabilities = {
  /** True for phones and tablets, which are held to different thresholds. */
  isMobile?: boolean;
  /**
   * `navigator.webdriver` — true when the browser is under automation.
   *
   * This exists because of one specific, real conflict rather than as a
   * general-purpose hook. The repo's visual-baseline suite launches Chromium
   * with `--use-angle=swiftshader` ON PURPOSE, and the comment in
   * `playwright.config.ts` says why: "the whole value of these images is that
   * two runs on the same machine differ only by the code between them, and a
   * GPU that schedules work differently under load breaks exactly that."
   *
   * Without this field, `SOFTWARE_RENDERER_MARKERS` below would classify that
   * suite's browser as the weakest tier, and every baseline image would
   * silently start measuring a profile no visitor is ever served. The harness
   * already pins the other variable of this kind with
   * `--force-device-scale-factor=1`; this is the same act, for the same reason.
   *
   * It is safe as a signal because it cannot be set by a page or a URL — only
   * by a driver attached to the browser — so no visitor can reach it.
   */
  isUnderAutomation?: boolean;
  /** `navigator.hardwareConcurrency` — logical cores. */
  logicalProcessorCount?: number;
  /** `navigator.deviceMemory` — gigabytes, Chromium only, capped at 8 by spec. */
  deviceMemoryGigabytes?: number;
  /** Whether a WebGL2 context could be created at all. */
  supportsWebGL2?: boolean;
  /** `MAX_TEXTURE_SIZE`, a proxy for how serious the GPU is. */
  maximumTextureSize?: number;
  /** `UNMASKED_RENDERER_WEBGL`, e.g. "ANGLE (NVIDIA GeForce RTX 4060 ...)". */
  rendererDescription?: string;
};

/**
 * Renderer substrings that name a SOFTWARE rasteriser.
 *
 * These are the one signal strong enough to decide a tier on their own, because
 * they are not a slow GPU — they are no GPU. The repo has already measured what
 * this costs: the Playwright suite forces SwiftShader and renders these scenes
 * at roughly 1.5 frames a second. Nothing in the profiles below rescues that,
 * but shipping the minimal profile at least gives it a chance of drawing.
 */
const SOFTWARE_RENDERER_MARKERS = ["swiftshader", "llvmpipe", "software", "microsoft basic render"];

/** Below this many cores, a device is treated as unable to feed a busy scene. */
const MINIMAL_TIER_LOGICAL_PROCESSOR_COUNT = 4;
/** Below this many gigabytes, likewise. Chromium caps the reported value at 8. */
const MINIMAL_TIER_DEVICE_MEMORY_GIGABYTES = 4;
/** A desktop with fewer cores than this is treated as balanced rather than high. */
const BALANCED_TIER_LOGICAL_PROCESSOR_COUNT = 8;
/**
 * `MAX_TEXTURE_SIZE` below this indicates a constrained mobile GPU. The
 * universe family alone uploads 8192-wide textures, so a device that cannot
 * hold one is not a device that should be asked to.
 */
const MINIMAL_TIER_MAXIMUM_TEXTURE_SIZE = 8192;

function describesSoftwareRenderer(rendererDescription: string | undefined): boolean {
  if (!rendererDescription) {
    return false;
  }
  const normalised = rendererDescription.toLowerCase();
  return SOFTWARE_RENDERER_MARKERS.some((marker) => normalised.includes(marker));
}

/**
 * Picks the tier from capabilities, with mobile and desktop held to different
 * thresholds — which the story asks for, and which matters because the numbers
 * mean different things on each. Eight cores in a phone is a flagship; eight
 * cores in a desktop is unremarkable.
 *
 * The order of the checks is the order of confidence. A software rasteriser is
 * certain. Missing WebGL2 is nearly certain. Core and memory counts are
 * indicative, so they are read last and only ever move a device DOWN from the
 * default.
 */
export function classifyDeviceQualityTier(capabilities: DeviceRenderCapabilities): DeviceQualityTier {
  // Software rasterisation is the strongest possible "this device cannot draw
  // this" signal, and it is skipped under automation for the reason recorded on
  // `isUnderAutomation` above: the visual suite runs software GL deliberately,
  // and must keep measuring the profile that ships.
  if (!capabilities.isUnderAutomation && describesSoftwareRenderer(capabilities.rendererDescription)) {
    return QUALITY_TIER_MINIMAL;
  }

  // WebGL2 has been available in every major browser since 2021. Its absence in
  // 2026 means a very old device or a deliberately restricted one, and either
  // way not a machine to hand a multisampled RGBA16F composer target to.
  if (capabilities.supportsWebGL2 === false) {
    return QUALITY_TIER_MINIMAL;
  }

  if (
    capabilities.maximumTextureSize !== undefined &&
    capabilities.maximumTextureSize > 0 &&
    capabilities.maximumTextureSize < MINIMAL_TIER_MAXIMUM_TEXTURE_SIZE
  ) {
    return QUALITY_TIER_MINIMAL;
  }

  const hasFewCores =
    capabilities.logicalProcessorCount !== undefined &&
    capabilities.logicalProcessorCount > 0 &&
    capabilities.logicalProcessorCount < MINIMAL_TIER_LOGICAL_PROCESSOR_COUNT;
  const hasLittleMemory =
    capabilities.deviceMemoryGigabytes !== undefined &&
    capabilities.deviceMemoryGigabytes > 0 &&
    capabilities.deviceMemoryGigabytes < MINIMAL_TIER_DEVICE_MEMORY_GIGABYTES;

  if (hasFewCores || hasLittleMemory) {
    return QUALITY_TIER_MINIMAL;
  }

  // A phone that has cleared every check above is a capable phone, and it still
  // does not get the desktop profile: its thermal budget is a few minutes, its
  // screen is already dense enough to hide most of what the top profile buys,
  // and it is the device most likely to be on a battery.
  if (capabilities.isMobile) {
    return QUALITY_TIER_BALANCED;
  }

  if (
    capabilities.logicalProcessorCount !== undefined &&
    capabilities.logicalProcessorCount > 0 &&
    capabilities.logicalProcessorCount < BALANCED_TIER_LOGICAL_PROCESSOR_COUNT
  ) {
    return QUALITY_TIER_BALANCED;
  }

  // Nothing said otherwise, so this is a desktop that looks ordinary or better,
  // or a device that answered none of the questions. Both get today's scene.
  return QUALITY_TIER_HIGH;
}

// --- Per-tier render profiles -------------------------------------------------

/**
 * The postprocessing passes a tier is allowed to run.
 *
 * These are named individually rather than as a count, because which pass is
 * dropped is a judgement about the art direction and should be readable as one.
 * The colour GRADE is never dropped at any tier: hue, saturation, brightness
 * and contrast are how each family's palette was designed, and a scene without
 * them is not a cheaper version of the world, it is a different one.
 */
export type PostProcessingProfile = {
  /** Ground-contact ambient occlusion. Forest family only, and only where affordable. */
  ambientOcclusion: boolean;
  /** Mipmap-blurred bloom. Several passes; the first real cost to fall. */
  bloom: boolean;
  /** Decorative full-screen passes: chromatic aberration and film grain. */
  lensAndGrain: boolean;
  /** Vignette. One cheap pass, and it frames every family's composition. */
  vignette: boolean;
};

export type DeviceRenderProfile = {
  tier: DeviceQualityTier;
  /**
   * The `dpr` range handed to `<Canvas>`. The SECOND number is a ceiling that
   * `AdaptiveResolution` starts at and steps back from; it is not a fixed
   * setting, and lowering it for a weak device means that device starts
   * somewhere it can survive instead of arriving there after several seconds of
   * missed frames.
   */
  devicePixelRatioRange: [number, number];
  /**
   * Whether shadow mapping may run at all. The families that use it decide
   * separately whether they want it — this only says whether the device can
   * afford to be asked.
   */
  allowsShadows: boolean;
  postProcessing: PostProcessingProfile;
};

/**
 * The high profile IS today's configuration, written out rather than derived,
 * so that a change to it is a change somebody made on purpose.
 *
 * `[1, 3]` is the same ceiling the canvas has used since the pixel-ratio work
 * landed, shadows are allowed, and every postprocessing pass is on.
 */
const HIGH_TIER_PROFILE: DeviceRenderProfile = {
  tier: QUALITY_TIER_HIGH,
  devicePixelRatioRange: [1, 3],
  allowsShadows: true,
  postProcessing: { ambientOcclusion: true, bloom: true, lensAndGrain: true, vignette: true }
};

/**
 * Balanced keeps everything structural and drops what is decoration.
 *
 * Chromatic aberration and film grain are two full-screen passes that add
 * atmosphere and carry no information — nothing in any family reads as broken
 * without them. Shadows stay: the ocean's seabed contact shadow is the
 * difference between a boulder resting IN sediment and one sitting on a plane,
 * which is a correctness problem rather than a polish one.
 */
const BALANCED_TIER_PROFILE: DeviceRenderProfile = {
  tier: QUALITY_TIER_BALANCED,
  devicePixelRatioRange: [1, 2],
  allowsShadows: true,
  postProcessing: { ambientOcclusion: true, bloom: true, lensAndGrain: false, vignette: true }
};

/**
 * Minimal is the profile for a device that would otherwise show nothing usable.
 *
 * Ambient occlusion and bloom go, because both are multi-pass and both are
 * enhancements to a scene that is already legible without them. Shadows go,
 * which costs the forest and the ocean real depth cues — accepted, because the
 * alternative on this class of device is a slideshow. The grade and the
 * vignette stay, so the world still looks like itself.
 *
 * The pixel-ratio ceiling of 1.5 is above the adaptive floor of 1 on purpose:
 * this is a starting point, not a destination, and the runtime controller can
 * still take it the rest of the way down if it needs to.
 */
const MINIMAL_TIER_PROFILE: DeviceRenderProfile = {
  tier: QUALITY_TIER_MINIMAL,
  devicePixelRatioRange: [1, 1.5],
  allowsShadows: false,
  postProcessing: { ambientOcclusion: false, bloom: false, lensAndGrain: false, vignette: true }
};

export function renderProfileForTier(tier: DeviceQualityTier): DeviceRenderProfile {
  if (tier === QUALITY_TIER_MINIMAL) {
    return MINIMAL_TIER_PROFILE;
  }
  if (tier === QUALITY_TIER_BALANCED) {
    return BALANCED_TIER_PROFILE;
  }
  return HIGH_TIER_PROFILE;
}

/**
 * LOD distances are in the story's task list and are deliberately NOT here.
 *
 * The sprint's own measurement, taken on an RTX 4060 across a tenfold range of
 * resolutions, found frame time scaling with pixel count while draw calls held
 * at 83 and triangles at 4.1 million, unchanged. These scenes are FILL-RATE
 * bound, not geometry bound, and the note in `user-stories.md` says what
 * follows from that in as many words: "LOD distances and instancing — the
 * obvious levers — would have bought nothing."
 *
 * So a per-tier LOD distance would be a knob that measurably does not turn.
 * Adding one anyway would make this file look more thorough while making the
 * renderer harder to reason about, and would invite a future reader to tune it
 * in search of frames it cannot produce. If the geometry budget ever changes —
 * City is the obvious candidate — this is the paragraph to come back and
 * disagree with, on new measurements rather than on the story's original guess.
 */
export const LOD_DISTANCES_ARE_DELIBERATELY_NOT_TIERED = true;

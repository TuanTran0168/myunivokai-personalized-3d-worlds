/**
 * Phase 1 of agent-system/research/webgpu-full-migration-feasibility-2026.md,
 * §26 and §28.4 step 2: the six things that decide whether Architecture A is
 * reachable, exercised on the version already installed (three@0.171.0) so the
 * answers cost nothing but a branch that is never merged.
 *
 * Every probe returns MEASUREMENTS and a set of named claims. Nothing here
 * decides that something "works" from the absence of an exception: Phase 0
 * taught this project that the WebGPU path fails by falling back quietly, so a
 * probe that only checks for a thrown error photographs the wrong renderer and
 * calls it a pass.
 *
 * Each probe runs against BOTH backends of the same renderer class on the same
 * machine — `WebGPURenderer` on WebGPU, and `WebGPURenderer({forceWebGL:true})`
 * — because that pair is the migration's actual shape (§6.2) and the pair a
 * parity harness will have to diff.
 *
 * WHAT THIS DOES NOT PROVE. It is vanilla three, not React: no `<Canvas>`, no
 * drei component, no Next.js. The drei mechanisms are reproduced from drei's own
 * installed source — `Environment files=` is `useEnvironment` + `scene.environment`
 * (an equirectangular texture, no PMREMGenerator call of drei's own), and
 * `Environment` with `Lightformer` children is `EnvironmentPortal`'s
 * `WebGLCubeRenderTarget` + `CubeCamera.update()` — so what is measured is the
 * mechanism drei uses, not the React wrapper around it. It also renders one
 * fixture-shaped scene rather than the app's, so it says nothing about the
 * app's frame time, and nothing here is a visual-parity result: the geometry is
 * a stand-in.
 */

const PROBE_TARGET_WIDTH = 256;
const PROBE_TARGET_HEIGHT = 256;
const THUMBNAIL_WIDTH = 192;
const THUMBNAIL_HEIGHT = 192;

const BACKEND_WEBGPU = "WebGPU";
const BACKEND_FORCED_WEBGL = "forceWebGL";

// The transfer curve is measured, never assumed. Rendering a known linear grey
// and reading the byte back is the only way to compare a ported shader against
// the arithmetic it replaced: tone mapping, the output colour-space transform
// and the render target's own format all sit between the two, and three applies
// a DIFFERENT set of them to a render target than to the canvas (see the
// render-target-color-pipeline probe, which measures exactly that gap).
const CALIBRATION_STEP_COUNT = 32;

// One texel of the leaf texture per this many device pixels, so a nearest-filter
// sample has an unambiguous centre pixel and the comparison is texel-exact
// rather than filter-dependent.
const LEAF_TEXTURE_SIZE = 16;
const LEAF_PIXELS_PER_TEXEL = PROBE_TARGET_WIDTH / LEAF_TEXTURE_SIZE;

// forestModels.ts:309-325, verbatim. The patch replaces <map_fragment> so that
// the leaf texture contributes DETAIL (a luminance remapped into a gentle light
// range) while the instance colour supplies the season hue.
const LEAF_LUMINANCE_WEIGHTS = [0.299, 0.587, 0.114];
const LEAF_LIGHT_RANGE_MINIMUM = 0.72;
const LEAF_LIGHT_RANGE_MAXIMUM = 1.12;
// A stand-in for one instance's season colour, in the linear working space.
const LEAF_INSTANCE_COLOR_LINEAR = [0.34, 0.52, 0.19];
// A port that is arithmetically identical still lands a byte or two out through
// a measured transfer curve; more than this and the expression itself differs.
const MAXIMUM_ACCEPTABLE_BYTE_ERROR = 3;

// SizedStarPoints.tsx's three layers, reduced to the one property under test:
// the per-star size attribute, spread wide enough that a footprint measurement
// cannot confuse two stars.
const STAR_SIZE_ATTRIBUTES = [3, 9, 27];
const STAR_POINT_SCALE = 220;
const STAR_COLOR_UNIT_RGB = [1, 0.8, 0.5];

// ForestSkyDome.tsx's dome, at its shipped dimensions.
const SKY_DOME_RADIUS = 260;
const SKY_DOME_WIDTH_SEGMENTS = 32;
const SKY_DOME_HEIGHT_SEGMENTS = 24;
const SKY_DOME_ZENITH_COLOR_LINEAR = [0.17, 0.38, 0.72];
const SKY_DOME_HORIZON_COLOR_LINEAR = [0.58, 0.66, 0.55];

// ForestRenderer.tsx:131 ships fogExp2; oceanRig drives fog far harder. The
// density here is deliberately high enough that eight quads span most of the
// curve inside a 256 px read.
const FOG_COLOR_LINEAR = [0.58, 0.66, 0.55];
const FOG_DENSITY = 0.05;
const FOG_QUAD_DEPTHS = [4, 8, 14, 22, 32, 44, 58, 74];
const FOG_QUAD_BASE_COLOR_LINEAR = [0.9, 0.05, 0.05];
// The fog factor is compared against three's own FogExp2 expression rather than
// against a tolerance pulled from nowhere: 1 - exp(-(density*depth)^2).
const MAXIMUM_ACCEPTABLE_FOG_FACTOR_ERROR = 0.04;

// SpaceEnvironment.tsx's two Lightformers, at their shipped values.
const ENVIRONMENT_CUBEMAP_RESOLUTION = 128;
const SPACE_ENVIRONMENT_INTENSITY = 0.35;
const SUN_FORM_COLOR = "#FFE3B8";
const SUN_FORM_INTENSITY = 3;
const SUN_FORM_POSITION = [0, 3, 8];
const SUN_FORM_SCALE = [8, 4, 1];
const SPACE_FILL_COLOR = "#8FB6FF";
const SPACE_FILL_INTENSITY = 1.1;
const SPACE_FILL_POSITION = [-7, -3, -6];
const SPACE_FILL_SCALE = [12, 7, 1];

// ForestRenderer.tsx lights through an equirectangular HDRI. This stand-in is
// procedural (no network at runtime, per demos/README.md) but has the property
// that matters: it is DIRECTIONAL, with a bright sky, a dark ground and one hot
// sun, so a flat 2D sample and a real irradiance integral cannot be confused.
const ENVIRONMENT_EQUIRECTANGULAR_WIDTH = 128;
const ENVIRONMENT_EQUIRECTANGULAR_HEIGHT = 64;
const ENVIRONMENT_SKY_COLOR = [0.35, 0.55, 0.95];
const ENVIRONMENT_GROUND_COLOR = [0.06, 0.05, 0.04];
const ENVIRONMENT_SUN_COLOR = [14, 11, 7];
const ENVIRONMENT_SUN_ANGULAR_RADIUS_TEXELS = 3;
const ENVIRONMENT_SUN_TEXEL_U = 0.25;
const ENVIRONMENT_SUN_TEXEL_V = 0.72;
const FOREST_ENVIRONMENT_INTENSITY = 1.15;
// A mirror integrates a near-delta cone of the environment, a rough dielectric
// integrates most of a hemisphere. If the environment were sampled as a flat 2D
// texture instead of a prefiltered cube, both would come back with the same
// distribution — so the mirror's peak-over-mean against the rough sphere's is
// the test that tells a real PMREM chain from a plausible-looking wrong one.
const MINIMUM_MIRROR_TO_ROUGH_PEAK_RATIO = 1.5;

// Enough distinct pipelines that compilation, not draw submission, dominates
// the first frame — the question §24.1's ~2.5 s stall poses.
const PIPELINE_LATENCY_MATERIAL_COUNT = 24;

// How often the gap ticker asks to be scheduled. Small enough to resolve a
// block to a few milliseconds, large enough not to be the load itself.
const MAIN_THREAD_TICKER_INTERVAL_MILLISECONDS = 4;
// Long enough that no scheduling jitter can be mistaken for it.
const SYNTHETIC_LONG_TASK_MILLISECONDS = 120;
// One frame at the project's 60 fps floor, rounded up. A gap longer than this
// is a dropped frame by definition, whatever the frame time says.
const MAXIMUM_ACCEPTABLE_MAIN_THREAD_GAP_MILLISECONDS = 17;

const BACKEND_ORDER_PARAMETER = "backends";
const DEFAULT_BACKEND_ORDER = [BACKEND_WEBGPU, BACKEND_FORCED_WEBGL];

/**
 * Which backends this page load exercises, and in what order.
 *
 * Defaulting to both is right for a human opening the file — one page, every
 * answer. It is WRONG for a graded run, and that was measured rather than
 * assumed: with both renderers alive in one document, the second one's
 * environment probes threw from inside the FIRST one's backend
 * (`WebGPUBackend.createTexture` on a stack raised during the forceWebGL pass).
 * So measure.mjs loads this page once per backend and then loads it a third
 * time with both, purely to report whether isolation changed any verdict.
 */
function requestedBackendOrder() {
  const requested = new URLSearchParams(window.location.search).get(BACKEND_ORDER_PARAMETER);
  if (!requested) return DEFAULT_BACKEND_ORDER;
  const known = { webgpu: BACKEND_WEBGPU, forcewebgl: BACKEND_FORCED_WEBGL };
  const parsed = requested
    .split(",")
    .map((name) => known[name.trim().toLowerCase()])
    .filter((name) => name !== undefined);
  return parsed.length === 0 ? DEFAULT_BACKEND_ORDER : parsed;
}

const probeRegistry = [];
const collectedConsoleErrors = [];

function registerProbe(name, question, run) {
  probeRegistry.push({ name, question, run });
}

/**
 * Console output is the WHOLE POINT for four of these probes.
 *
 * The node path reports an unsupported background, fog or environment
 * configuration by writing to console.error and then rendering something
 * plausible (three.webgpu.js:27958, :28005, :28044). A probe that watched only
 * for exceptions would call all three a pass.
 *
 * WARNINGS ARE COLLECTED TOO, and that was learnt the hard way: a WGSL
 * compilation failure does not throw and does not reach console.error. Dawn
 * surfaces it through the uncaptured-error path, Chrome logs it as a WARNING,
 * three carries on, and the draw is silently dropped. The pointUV probe scored
 * itself wrong for exactly one run because of it.
 */
function installConsoleCollector() {
  for (const level of ["error", "warn"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      collectedConsoleErrors.push(args.map((argument) => String(argument)).join(" "));
      original(...args);
    };
  }
}

function describeError(error) {
  const stack = typeof error?.stack === "string" ? error.stack.split("\n").slice(1, 4).map((line) => line.trim()).join(" ← ") : "";
  return stack === "" ? String(error) : `${error} ← ${stack}`;
}

function consoleErrorsSince(index) {
  return collectedConsoleErrors.slice(index);
}

function findConsoleErrorMatching(errorsSince, fragment) {
  return errorsSince.find((message) => message.includes(fragment)) ?? null;
}

function hexColorToLinearRgb(hexColor) {
  const parsed = Number.parseInt(hexColor.slice(1), 16);
  const encodedChannels = [((parsed >> 16) & 0xff) / 255, ((parsed >> 8) & 0xff) / 255, (parsed & 0xff) / 255];
  return encodedChannels.map(srgbTransferEotf);
}

function srgbTransferEotf(encodedChannel) {
  return encodedChannel <= 0.04045 ? encodedChannel / 12.92 : Math.pow((encodedChannel + 0.055) / 1.055, 2.4);
}

function readPixel(pixels, width, x, y) {
  const offset = (y * width + x) * 4;
  return [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]];
}

function meanOfChannel(pixels, channelIndex) {
  let total = 0;
  for (let offset = channelIndex; offset < pixels.length; offset += 4) {
    total += pixels[offset];
  }
  return total / (pixels.length / 4);
}

function luminanceOfPixel(pixel) {
  return 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2];
}

function meanLuminance(pixels) {
  let total = 0;
  let count = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    total += luminanceOfPixel([pixels[offset], pixels[offset + 1], pixels[offset + 2]]);
    count += 1;
  }
  return count === 0 ? 0 : total / count;
}

/** Spatial variance of luminance over the pixels a mask selects. */
function maskedLuminanceVariance(pixels, width, height, isInsideMask) {
  const samples = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isInsideMask(x, y)) continue;
      samples.push(luminanceOfPixel(readPixel(pixels, width, x, y)));
    }
  }
  if (samples.length === 0) return { variance: 0, mean: 0, sampleCount: 0 };
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance = samples.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / samples.length;
  return { variance, mean, sampleCount: samples.length };
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Procedural assets. No network at runtime (demos/README.md), so every texture
// is computed here rather than fetched.
// ---------------------------------------------------------------------------

/**
 * A leaf-like texture: an sRGB byte texture, because that is what the app's
 * GLTF leaf atlases are, and the colour space decides what the shader sees.
 * Seeded arithmetic, never Math.random (demos/README.md).
 */
function createLeafTexture(THREE) {
  const data = new Uint8Array(LEAF_TEXTURE_SIZE * LEAF_TEXTURE_SIZE * 4);
  for (let y = 0; y < LEAF_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < LEAF_TEXTURE_SIZE; x += 1) {
      const offset = (y * LEAF_TEXTURE_SIZE + x) * 4;
      const veinPattern = Math.abs(Math.sin((x + 1) * 0.9) * Math.cos((y + 1) * 0.7));
      data[offset] = Math.round(60 + veinPattern * 120);
      data[offset + 1] = Math.round(90 + veinPattern * 150);
      data[offset + 2] = Math.round(40 + veinPattern * 70);
      data[offset + 3] = x === 0 || y === 0 ? 128 : 255;
    }
  }
  const texture = new THREE.DataTexture(data, LEAF_TEXTURE_SIZE, LEAF_TEXTURE_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** The same texels the GPU will sample, in the linear working space. */
function leafTexelLinear(data, x, y) {
  const offset = (y * LEAF_TEXTURE_SIZE + x) * 4;
  return {
    rgb: [srgbTransferEotf(data[offset] / 255), srgbTransferEotf(data[offset + 1] / 255), srgbTransferEotf(data[offset + 2] / 255)],
    alpha: data[offset + 3] / 255
  };
}

function createEquirectangularEnvironmentTexture(THREE) {
  const width = ENVIRONMENT_EQUIRECTANGULAR_WIDTH;
  const height = ENVIRONMENT_EQUIRECTANGULAR_HEIGHT;
  const data = new Float32Array(width * height * 4);
  const sunTexelX = Math.round(ENVIRONMENT_SUN_TEXEL_U * width);
  const sunTexelY = Math.round(ENVIRONMENT_SUN_TEXEL_V * height);
  for (let y = 0; y < height; y += 1) {
    // v = 0 is the bottom of an equirectangular map in three's convention, so
    // the lower rows are the ground and the upper rows are the sky.
    const verticalFraction = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const base = verticalFraction > 0.5 ? ENVIRONMENT_SKY_COLOR : ENVIRONMENT_GROUND_COLOR;
      const distanceToSun = Math.hypot(x - sunTexelX, y - sunTexelY);
      const isSun = distanceToSun <= ENVIRONMENT_SUN_ANGULAR_RADIUS_TEXELS;
      const color = isSun ? ENVIRONMENT_SUN_COLOR : base;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 1;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

// ---------------------------------------------------------------------------
// Renderer context
// ---------------------------------------------------------------------------

async function createRendererContext(THREE, backendName) {
  const canvas = document.createElement("canvas");
  canvas.width = PROBE_TARGET_WIDTH;
  canvas.height = PROBE_TARGET_HEIGHT;
  const startedAt = performance.now();
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    forceWebGL: backendName === BACKEND_FORCED_WEBGL
  });
  renderer.setPixelRatio(1);
  renderer.setSize(PROBE_TARGET_WIDTH, PROBE_TARGET_HEIGHT, false);
  let initializationError = null;
  try {
    await renderer.init();
  } catch (error) {
    initializationError = String(error);
  }
  const initializationMilliseconds = performance.now() - startedAt;
  const renderTarget = new THREE.RenderTarget(PROBE_TARGET_WIDTH, PROBE_TARGET_HEIGHT, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat
  });
  return {
    THREE,
    backendName,
    canvas,
    renderer,
    renderTarget,
    initializationError,
    initializationMilliseconds,
    calibration: null
  };
}

async function renderToTargetAndRead(context, scene, camera) {
  const { renderer, renderTarget } = context;
  renderer.setRenderTarget(renderTarget);
  await renderer.renderAsync(scene, camera);
  const pixels = await renderer.readRenderTargetPixelsAsync(
    renderTarget,
    0,
    0,
    PROBE_TARGET_WIDTH,
    PROBE_TARGET_HEIGHT
  );
  renderer.setRenderTarget(null);
  return pixels;
}

/**
 * Reads the visible canvas rather than a render target. Kept separate on
 * purpose: `Renderer.isToneMappingState` (three.webgpu.js:27909) returns false
 * whenever a render target is bound, so the canvas and the target are not the
 * same image and a harness must know which one it is grading.
 */
function readCanvasPixels(context) {
  const readbackCanvas = document.createElement("canvas");
  readbackCanvas.width = PROBE_TARGET_WIDTH;
  readbackCanvas.height = PROBE_TARGET_HEIGHT;
  const readbackContext = readbackCanvas.getContext("2d", { willReadFrequently: true });
  readbackContext.drawImage(context.canvas, 0, 0);
  return readbackContext.getImageData(0, 0, PROBE_TARGET_WIDTH, PROBE_TARGET_HEIGHT).data;
}

function captureThumbnail(context, probeName) {
  const gallery = document.getElementById("thumbnail-gallery");
  if (!gallery) return;
  const figure = document.createElement("figure");
  const thumbnail = document.createElement("canvas");
  thumbnail.width = THUMBNAIL_WIDTH;
  thumbnail.height = THUMBNAIL_HEIGHT;
  const thumbnailContext = thumbnail.getContext("2d");
  thumbnailContext.drawImage(context.canvas, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  const caption = document.createElement("figcaption");
  caption.textContent = `${probeName} · ${context.backendName}`;
  figure.append(thumbnail, caption);
  gallery.append(figure);
}

// ---------------------------------------------------------------------------
// Calibration: the measured transfer curve from a linear value to a read byte
// ---------------------------------------------------------------------------

async function measureTransferCurve(context) {
  const { THREE } = context;
  const { vec4 } = THREE.TSL;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 2;
  const stepWidth = 2 / CALIBRATION_STEP_COUNT;
  for (let step = 0; step < CALIBRATION_STEP_COUNT; step += 1) {
    const linearValue = step / (CALIBRATION_STEP_COUNT - 1);
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = vec4(linearValue, linearValue, linearValue, 1);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(stepWidth, 2), material);
    mesh.position.x = -1 + (step + 0.5) * stepWidth;
    scene.add(mesh);
  }
  const pixels = await renderToTargetAndRead(context, scene, camera);
  const samples = [];
  for (let step = 0; step < CALIBRATION_STEP_COUNT; step += 1) {
    const pixelX = Math.floor((step + 0.5) * (PROBE_TARGET_WIDTH / CALIBRATION_STEP_COUNT));
    const pixel = readPixel(pixels, PROBE_TARGET_WIDTH, pixelX, Math.floor(PROBE_TARGET_HEIGHT / 2));
    samples.push({ linear: step / (CALIBRATION_STEP_COUNT - 1), encodedByte: pixel[1] });
  }
  return samples;
}

/** Linear interpolation through the measured curve. */
function expectedByteForLinear(calibration, linearValue) {
  const clamped = Math.min(1, Math.max(0, linearValue));
  for (let index = 1; index < calibration.length; index += 1) {
    const previous = calibration[index - 1];
    const current = calibration[index];
    if (clamped <= current.linear) {
      const span = current.linear - previous.linear;
      const fraction = span === 0 ? 0 : (clamped - previous.linear) / span;
      return previous.encodedByte + fraction * (current.encodedByte - previous.encodedByte);
    }
  }
  return calibration[calibration.length - 1].encodedByte;
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

registerProbe(
  "renderer-init",
  "Does WebGPURenderer initialise, and on which backend does it actually land?",
  async (context) => {
    const { renderer, backendName } = context;
    const backend = renderer.backend ?? {};
    const landedOnWebGpu = backend.isWebGPUBackend === true;
    const landedOnWebGl = backend.isWebGLBackend === true;
    const expectedWebGpu = backendName === BACKEND_WEBGPU;
    return {
      claims: [
        {
          label: "init() resolved",
          ok: context.initializationError === null,
          detail: context.initializationError ?? "resolved"
        },
        {
          // The Phase 0 lesson, applied one level up: a renderer that fell back
          // is a renderer measuring the wrong thing, and it does not announce it.
          label: "landed on the requested backend",
          ok: expectedWebGpu ? landedOnWebGpu : landedOnWebGl,
          detail: landedOnWebGpu ? "WebGPUBackend" : landedOnWebGl ? "WebGLBackend" : "unknown backend"
        }
      ],
      metrics: {
        initializationMilliseconds: roundTo(context.initializationMilliseconds, 1),
        coordinateSystem: renderer.coordinateSystem === context.THREE.WebGPUCoordinateSystem ? "WebGPU" : "WebGL",
        hasSubgroupsFeature: String(landedOnWebGpu ? renderer.hasFeature("subgroups") : false)
      }
    };
  }
);

registerProbe(
  "render-target-color-pipeline",
  "Does a render target carry the same colour pipeline as the canvas?",
  async (context) => {
    const { THREE, renderer } = context;
    const { vec4 } = THREE.TSL;
    const probedLinearValue = 0.5;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 2;
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = vec4(probedLinearValue, probedLinearValue, probedLinearValue, 1);
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

    const previousToneMapping = renderer.toneMapping;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const targetPixels = await renderToTargetAndRead(context, scene, camera);
    await renderer.renderAsync(scene, camera);
    const canvasPixels = readCanvasPixels(context);
    renderer.toneMapping = previousToneMapping;

    const centreX = Math.floor(PROBE_TARGET_WIDTH / 2);
    const centreY = Math.floor(PROBE_TARGET_HEIGHT / 2);
    const targetByte = readPixel(targetPixels, PROBE_TARGET_WIDTH, centreX, centreY)[1];
    const canvasByte = readPixel(canvasPixels, PROBE_TARGET_WIDTH, centreX, centreY)[1];

    // And the second trap in the same surface: which end of the buffer is the
    // top. A bright upper half against a dark lower one, read back and asked
    // where the bright rows landed. A naive diff of two backends' render-target
    // buffers would report a total mismatch that is not a rendering difference
    // at all — it is this.
    const orientationScene = new THREE.Scene();
    const brightMaterial = new THREE.MeshBasicNodeMaterial();
    brightMaterial.colorNode = vec4(1, 1, 1, 1);
    const brightHalf = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), brightMaterial);
    brightHalf.position.y = 0.5;
    orientationScene.add(brightHalf);
    const orientationPixels = await renderToTargetAndRead(context, orientationScene, camera);
    const firstRowLuminance = luminanceOfPixel(readPixel(orientationPixels, PROBE_TARGET_WIDTH, centreX, 0));
    const lastRowLuminance = luminanceOfPixel(readPixel(orientationPixels, PROBE_TARGET_WIDTH, centreX, PROBE_TARGET_HEIGHT - 1));
    const renderTargetRowZeroIs = firstRowLuminance > lastRowLuminance ? "top" : "bottom";
    captureThumbnail(context, "render-target-color-pipeline");

    return {
      claims: [
        {
          // Not a bug to fix — a trap to know about. A Phase 4 harness that
          // grades render targets is grading a different image from the one a
          // visitor sees, and the difference is the whole tone curve.
          label: "the two differ, so a harness must state which surface it grades",
          ok: Math.abs(targetByte - canvasByte) > MAXIMUM_ACCEPTABLE_BYTE_ERROR,
          detail: `render target ${targetByte}, canvas ${canvasByte}, from the same linear ${probedLinearValue} under ACES`
        },
        {
          label: "the read-back row order is recorded, because the two backends do not agree on it",
          ok: firstRowLuminance !== lastRowLuminance,
          detail: `row 0 of readRenderTargetPixelsAsync is the ${renderTargetRowZeroIs} of the frame (${roundTo(firstRowLuminance, 1)} against ${roundTo(lastRowLuminance, 1)})`
        }
      ],
      metrics: {
        renderTargetByte: targetByte,
        canvasByte,
        differenceBytes: Math.abs(targetByte - canvasByte),
        renderTargetRowZeroIs
      }
    };
  }
);

registerProbe(
  "environment-equirectangular",
  "Does drei's `Environment files=` mechanism light a scene under the node path?",
  async (context) => {
    const { THREE, renderer } = context;
    const consoleErrorIndex = collectedConsoleErrors.length;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, PROBE_TARGET_WIDTH / PROBE_TARGET_HEIGHT, 0.1, 100);
    camera.position.set(0, 0, 6);

    const environmentTexture = createEquirectangularEnvironmentTexture(THREE);
    scene.environment = environmentTexture;
    scene.environmentIntensity = FOREST_ENVIRONMENT_INTENSITY;

    const mirrorSphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 48, 32),
      new THREE.MeshStandardNodeMaterial({ color: 0xffffff, metalness: 1, roughness: 0.04 })
    );
    mirrorSphere.position.x = -1.35;
    const roughSphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 48, 32),
      new THREE.MeshStandardNodeMaterial({ color: 0xffffff, metalness: 1, roughness: 0.85 })
    );
    roughSphere.position.x = 1.35;
    scene.add(mirrorSphere, roughSphere);

    const litPixels = await renderToTargetAndRead(context, scene, camera);
    await renderer.renderAsync(scene, camera);
    captureThumbnail(context, "environment-equirectangular");

    // Four states, not two. `environmentIntensity = 0` alone turned out to
    // HALVE the frame rather than black it out, so the intensity is swept and
    // the environment is removed outright: a sweep separates "the uniform is
    // ignored" from "the uniform is live but only scales part of the light",
    // and removal proves the environment is the source of what is left.
    scene.environmentIntensity = FOREST_ENVIRONMENT_INTENSITY / 2;
    const halfIntensityPixels = await renderToTargetAndRead(context, scene, camera);
    scene.environmentIntensity = 0;
    const zeroIntensityPixels = await renderToTargetAndRead(context, scene, camera);
    scene.environment = null;
    const noEnvironmentPixels = await renderToTargetAndRead(context, scene, camera);
    scene.environment = environmentTexture;
    scene.environmentIntensity = FOREST_ENVIRONMENT_INTENSITY;

    const leftHalf = (x) => x < PROBE_TARGET_WIDTH / 2;
    const rightHalf = (x) => x >= PROBE_TARGET_WIDTH / 2;
    const isLit = (x, y) => luminanceOfPixel(readPixel(litPixels, PROBE_TARGET_WIDTH, x, y)) > 4;

    const mirror = maskedLuminanceVariance(litPixels, PROBE_TARGET_WIDTH, PROBE_TARGET_HEIGHT, (x, y) => leftHalf(x) && isLit(x, y));
    const rough = maskedLuminanceVariance(litPixels, PROBE_TARGET_WIDTH, PROBE_TARGET_HEIGHT, (x, y) => rightHalf(x) && isLit(x, y));
    const upperHalf = maskedLuminanceVariance(litPixels, PROBE_TARGET_WIDTH, PROBE_TARGET_HEIGHT, (x, y) => y >= PROBE_TARGET_HEIGHT / 2 && isLit(x, y));
    const lowerHalf = maskedLuminanceVariance(litPixels, PROBE_TARGET_WIDTH, PROBE_TARGET_HEIGHT, (x, y) => y < PROBE_TARGET_HEIGHT / 2 && isLit(x, y));

    // Peak over mean, per sphere. Scale-free, and it is the statistic that
    // actually separates a prefiltered cube from a flat 2D sample: a mirror
    // integrates a near-delta cone and must show the sun as a hot spot far
    // above its own average, while a rough sphere integrates most of a
    // hemisphere and cannot. A variance ratio was tried first and is diluted by
    // the silhouette, which both spheres share.
    const peakOverMean = (isInsideMask) => {
      let peak = 0;
      let total = 0;
      let count = 0;
      for (let y = 0; y < PROBE_TARGET_HEIGHT; y += 1) {
        for (let x = 0; x < PROBE_TARGET_WIDTH; x += 1) {
          if (!isInsideMask(x, y)) continue;
          const luminance = luminanceOfPixel(readPixel(litPixels, PROBE_TARGET_WIDTH, x, y));
          peak = Math.max(peak, luminance);
          total += luminance;
          count += 1;
        }
      }
      return count === 0 ? 0 : peak / (total / count);
    };
    const mirrorPeakOverMean = peakOverMean((x, y) => leftHalf(x) && isLit(x, y));
    const roughPeakOverMean = peakOverMean((x, y) => rightHalf(x) && isLit(x, y));

    const litMeanLuminance = meanLuminance(litPixels);
    const halfIntensityMeanLuminance = meanLuminance(halfIntensityPixels);
    const zeroIntensityMeanLuminance = meanLuminance(zeroIntensityPixels);
    const noEnvironmentMeanLuminance = meanLuminance(noEnvironmentPixels);
    // What fraction of the light the intensity uniform can actually reach: the
    // slope of the sweep against the value the sweep starts from.
    const intensityControlledFraction =
      litMeanLuminance === 0 ? 0 : (litMeanLuminance - zeroIntensityMeanLuminance) / litMeanLuminance;
    // WHERE the light that escapes the uniform is: on the spheres, or behind
    // them. A corner pixel is background in every one of the four states, and
    // the mirror sphere's centre is never background — so one sample of each
    // says which surface the floor belongs to, and a mean over the frame cannot.
    const cornerAt = (pixels) => luminanceOfPixel(readPixel(pixels, PROBE_TARGET_WIDTH, 3, 3));
    const mirrorCentreAt = (pixels) =>
      luminanceOfPixel(
        readPixel(pixels, PROBE_TARGET_WIDTH, Math.floor(PROBE_TARGET_WIDTH * 0.28), Math.floor(PROBE_TARGET_HEIGHT / 2))
      );
    const varianceRatio = rough.variance === 0 ? Number.POSITIVE_INFINITY : mirror.variance / rough.variance;
    const unsupportedEnvironmentError = findConsoleErrorMatching(
      consoleErrorsSince(consoleErrorIndex),
      "Unsupported environment configuration"
    );

    return {
      claims: [
        {
          label: "no 'Unsupported environment configuration' from the node path",
          ok: unsupportedEnvironmentError === null,
          detail: unsupportedEnvironmentError ?? "silent"
        },
        {
          label: "the environment is what lit it (removing it goes dark)",
          ok: litMeanLuminance > 4 && noEnvironmentMeanLuminance < litMeanLuminance * 0.05,
          detail: `mean luma ${roundTo(litMeanLuminance, 2)} lit against ${roundTo(noEnvironmentMeanLuminance, 2)} with no environment at all`
        },
        {
          // Worth its own row because the app SETS this property, twice:
          // SpaceEnvironment.tsx drives it to 0.35 and restores it to 1, and
          // ForestRenderer passes environmentIntensity to drei. If the uniform
          // only reaches part of the light, both dials are weaker than they read.
          label: "environmentIntensity does not reach all of the light it appears to control",
          ok: intensityControlledFraction < 0.95 && zeroIntensityMeanLuminance > litMeanLuminance * 0.05,
          detail: `intensity ${FOREST_ENVIRONMENT_INTENSITY} → ${roundTo(litMeanLuminance, 2)}, half → ${roundTo(halfIntensityMeanLuminance, 2)}, 0 → ${roundTo(zeroIntensityMeanLuminance, 2)}; the uniform reaches ${Math.round(intensityControlledFraction * 100)}% of it`
        },
        {
          // NOT PINNED DOWN, and said so rather than guessed. Two candidates
          // are ruled out by measurement — the background is black in all four
          // states, and the mirror sphere's centre goes fully to zero — so the
          // floor is somewhere else in the frame. Anything that leans on
          // `environmentIntensity` as a dimmer should find out where first.
          label: "the floor is neither the background nor the mirror's centre; the term is UNIDENTIFIED",
          ok:
            cornerAt(zeroIntensityPixels) <= 4 &&
            mirrorCentreAt(zeroIntensityPixels) <= 4 &&
            zeroIntensityMeanLuminance > 5,
          detail: `corner ${roundTo(cornerAt(litPixels), 1)}→${roundTo(cornerAt(zeroIntensityPixels), 1)}, mirror centre ${roundTo(mirrorCentreAt(litPixels), 1)}→${roundTo(mirrorCentreAt(zeroIntensityPixels), 1)}, yet the frame mean stays ${roundTo(zeroIntensityMeanLuminance, 2)}`
        },
        {
          // The claim that separates a prefiltered cube from a flat 2D sample.
          label: "roughness is prefiltered: the mirror carries a hot spot the rough sphere cannot",
          ok: mirrorPeakOverMean >= roughPeakOverMean * MINIMUM_MIRROR_TO_ROUGH_PEAK_RATIO,
          detail: `peak-over-mean ${roundTo(mirrorPeakOverMean, 2)} on the mirror against ${roundTo(roughPeakOverMean, 2)} on the rough sphere`
        },
        {
          label: "the lighting is directional: sky-facing pixels are not ground-facing pixels",
          ok: Math.abs(upperHalf.mean - lowerHalf.mean) > 2,
          detail: `row-major halves ${roundTo(upperHalf.mean, 2)} against ${roundTo(lowerHalf.mean, 2)}`
        }
      ],
      metrics: {
        litMeanLuminance: roundTo(litMeanLuminance, 2),
        halfIntensityMeanLuminance: roundTo(halfIntensityMeanLuminance, 2),
        zeroIntensityMeanLuminance: roundTo(zeroIntensityMeanLuminance, 2),
        intensityControlledFraction: roundTo(intensityControlledFraction, 3),
        cornerLuminanceAtZeroIntensity: roundTo(cornerAt(zeroIntensityPixels), 1),
        mirrorCentreLuminanceAtZeroIntensity: roundTo(mirrorCentreAt(zeroIntensityPixels), 1),
        noEnvironmentMeanLuminance: roundTo(noEnvironmentMeanLuminance, 2),
        mirrorPeakOverMean: roundTo(mirrorPeakOverMean, 2),
        roughPeakOverMean: roundTo(roughPeakOverMean, 2),
        mirrorToRoughVarianceRatio: roundTo(varianceRatio, 2)
      }
    };
  }
);

registerProbe(
  "environment-cube-camera-portal",
  "Does drei's `Environment` + `Lightformer` mechanism work under the node path?",
  async (context) => {
    const { THREE, renderer } = context;
    const consoleErrorIndex = collectedConsoleErrors.length;

    // EnvironmentPortal, reproduced from @react-three/drei/core/Environment.js:
    // a WebGLCubeRenderTarget (NOT three's own CubeRenderTarget), a CubeCamera
    // constructed with it, and one camera.update() against a virtual scene of
    // Lightformer meshes. At 0.171.0 CubeRenderTarget merely extends
    // WebGLCubeRenderTarget and adds an unread `isCubeRenderTarget` flag, which
    // is why drei's plain one is worth testing rather than assuming.
    const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(ENVIRONMENT_CUBEMAP_RESOLUTION);
    cubeRenderTarget.texture.type = THREE.HalfFloatType;
    const virtualScene = new THREE.Scene();
    for (const form of [
      { color: SUN_FORM_COLOR, intensity: SUN_FORM_INTENSITY, position: SUN_FORM_POSITION, scale: SUN_FORM_SCALE },
      { color: SPACE_FILL_COLOR, intensity: SPACE_FILL_INTENSITY, position: SPACE_FILL_POSITION, scale: SPACE_FILL_SCALE }
    ]) {
      // Lightformer form="rect" is a plane whose basic material's colour is
      // multiplied by intensity — an emitter, with no lighting model.
      const linear = hexColorToLinearRgb(form.color);
      const material = new THREE.MeshBasicNodeMaterial();
      material.colorNode = THREE.TSL.vec4(
        linear[0] * form.intensity,
        linear[1] * form.intensity,
        linear[2] * form.intensity,
        1
      );
      material.side = THREE.DoubleSide;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      mesh.position.set(...form.position);
      mesh.scale.set(...form.scale);
      virtualScene.add(mesh);
    }

    const cubeCamera = new THREE.CubeCamera(0.1, 1000, cubeRenderTarget);
    let cubeCameraError = null;
    try {
      cubeCamera.update(renderer, virtualScene);
    } catch (error) {
      cubeCameraError = String(error);
    }

    const scene = new THREE.Scene();
    scene.environment = cubeRenderTarget.texture;
    scene.environmentIntensity = SPACE_ENVIRONMENT_INTENSITY;
    const camera = new THREE.PerspectiveCamera(35, PROBE_TARGET_WIDTH / PROBE_TARGET_HEIGHT, 0.1, 100);
    camera.position.set(0, 0, 5);
    const mirrorSphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.4, 48, 32),
      new THREE.MeshStandardNodeMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12 })
    );
    scene.add(mirrorSphere);

    await renderer.renderAsync(scene, camera);
    // Read the CANVAS, not a render target. This probe's whole subject is WHERE
    // the reflection lands, and the two backends hand back render-target rows
    // in opposite vertical order — so grading orientation off a render target
    // would measure the read-back convention and call it a rendering
    // difference. A 2D drawImage of the canvas is top-down on both.
    const pixels = readCanvasPixels(context);
    captureThumbnail(context, "environment-cube-camera-portal");

    const isLit = (x, y) => luminanceOfPixel(readPixel(pixels, PROBE_TARGET_WIDTH, x, y)) > 3;
    const litRegion = maskedLuminanceVariance(pixels, PROBE_TARGET_WIDTH, PROBE_TARGET_HEIGHT, isLit);

    // Where the warm Lightformer's reflection actually sits, as the
    // luminance-weighted centroid of the warm pixels. A left-versus-right split
    // was tried first and it disagreed between backends — which turned out to
    // be true and worth reporting precisely, rather than as a pass or a fail.
    let warmWeight = 0;
    let warmCentroidX = 0;
    let warmCentroidY = 0;
    let peakRedMinusBlue = 0;
    for (let y = 0; y < PROBE_TARGET_HEIGHT; y += 1) {
      for (let x = 0; x < PROBE_TARGET_WIDTH; x += 1) {
        if (!isLit(x, y)) continue;
        const pixel = readPixel(pixels, PROBE_TARGET_WIDTH, x, y);
        const warmth = Math.max(0, pixel[0] - pixel[2]);
        peakRedMinusBlue = Math.max(peakRedMinusBlue, warmth);
        warmWeight += warmth;
        warmCentroidX += warmth * x;
        warmCentroidY += warmth * y;
      }
    }
    const warmCentroid =
      warmWeight === 0
        ? { x: 0, y: 0 }
        : { x: warmCentroidX / warmWeight / PROBE_TARGET_WIDTH, y: warmCentroidY / warmWeight / PROBE_TARGET_HEIGHT };
    const unsupportedEnvironmentError = findConsoleErrorMatching(
      consoleErrorsSince(consoleErrorIndex),
      "Unsupported environment configuration"
    );

    return {
      claims: [
        {
          label: "CubeCamera.update() against a WebGLCubeRenderTarget did not throw",
          ok: cubeCameraError === null,
          detail: cubeCameraError ?? "returned"
        },
        {
          label: "no 'Unsupported environment configuration' for the cube texture",
          ok: unsupportedEnvironmentError === null,
          detail: unsupportedEnvironmentError ?? "silent"
        },
        {
          label: "the rendered cubemap actually lit the sphere",
          ok: litRegion.mean > 3 && litRegion.sampleCount > PROBE_TARGET_WIDTH,
          detail: `${litRegion.sampleCount} lit pixels, mean luma ${roundTo(litRegion.mean, 2)}`
        },
        {
          label: "the warm Lightformer reads as warm, so the two forms did not merge",
          ok: peakRedMinusBlue > 20,
          detail: `peak red-minus-blue ${roundTo(peakRedMinusBlue, 1)}`
        }
      ],
      metrics: {
        cubeCameraError: cubeCameraError ?? "none",
        // measure.mjs compares these two numbers ACROSS the backends: if the
        // reflection lands in a different place, the fallback is not a fallback.
        warmHighlightCentroidX: roundTo(warmCentroid.x, 3),
        warmHighlightCentroidY: roundTo(warmCentroid.y, 3),
        peakRedMinusBlue: roundTo(peakRedMinusBlue, 1)
      }
    };
  }
);

registerProbe(
  "fog-exp2",
  "Does scene.fog survive the node path, with three's own FogExp2 curve?",
  async (context) => {
    const { THREE, renderer } = context;
    const { vec4 } = THREE.TSL;
    const consoleErrorIndex = collectedConsoleErrors.length;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(
      new THREE.Color().setRGB(FOG_COLOR_LINEAR[0], FOG_COLOR_LINEAR[1], FOG_COLOR_LINEAR[2], THREE.LinearSRGBColorSpace),
      FOG_DENSITY
    );
    const camera = new THREE.PerspectiveCamera(50, PROBE_TARGET_WIDTH / PROBE_TARGET_HEIGHT, 0.1, 200);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);

    // One quad per depth, each filling a horizontal band of the frame, so a
    // single read gives the whole curve. Placed at exact camera-space depths so
    // the measured factor can be compared against the closed form.
    const quadHeightAtUnitDepth = 2 * Math.tan((camera.fov * Math.PI) / 360);
    FOG_QUAD_DEPTHS.forEach((depth, index) => {
      const material = new THREE.MeshBasicNodeMaterial();
      material.colorNode = vec4(...FOG_QUAD_BASE_COLOR_LINEAR, 1);
      const bandHeight = (quadHeightAtUnitDepth * depth) / FOG_QUAD_DEPTHS.length;
      const bandWidth = quadHeightAtUnitDepth * depth * camera.aspect;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(bandWidth, bandHeight), material);
      const bandCentreFraction = (index + 0.5) / FOG_QUAD_DEPTHS.length - 0.5;
      mesh.position.set(0, bandCentreFraction * quadHeightAtUnitDepth * depth, -depth);
      scene.add(mesh);
    });

    const pixels = await renderToTargetAndRead(context, scene, camera);
    await renderer.renderAsync(scene, camera);
    captureThumbnail(context, "fog-exp2");

    const fogColorByte = expectedByteForLinear(context.calibration, FOG_COLOR_LINEAR[0]);
    const baseColorByte = expectedByteForLinear(context.calibration, FOG_QUAD_BASE_COLOR_LINEAR[0]);
    const bandHeightPixels = PROBE_TARGET_HEIGHT / FOG_QUAD_DEPTHS.length;
    const measured = FOG_QUAD_DEPTHS.map((depth, index) => {
      // Band 0 is the lowest in world space; the read's row order is resolved by
      // the orientation probe, so both are tried and the better fit reported.
      const rowFromBottom = Math.floor((index + 0.5) * bandHeightPixels);
      const rowFromTop = PROBE_TARGET_HEIGHT - 1 - rowFromBottom;
      const readByte = (row) => readPixel(pixels, PROBE_TARGET_WIDTH, Math.floor(PROBE_TARGET_WIDTH / 2), row)[0];
      const expectedFactor = 1 - Math.exp(-FOG_DENSITY * FOG_DENSITY * depth * depth);
      const expectedByte = baseColorByte + (fogColorByte - baseColorByte) * expectedFactor;
      const fromBottom = readByte(rowFromBottom);
      const fromTop = readByte(rowFromTop);
      return { depth, expectedFactor, expectedByte, fromBottom, fromTop };
    });
    const errorFromBottom = measured.reduce((sum, row) => sum + Math.abs(row.fromBottom - row.expectedByte), 0);
    const errorFromTop = measured.reduce((sum, row) => sum + Math.abs(row.fromTop - row.expectedByte), 0);
    const usesBottomFirstRows = errorFromBottom <= errorFromTop;
    const readBytes = measured.map((row) => (usesBottomFirstRows ? row.fromBottom : row.fromTop));

    const factorErrors = measured.map((row, index) => {
      const span = fogColorByte - baseColorByte;
      const measuredFactor = span === 0 ? 0 : (readBytes[index] - baseColorByte) / span;
      return Math.abs(measuredFactor - row.expectedFactor);
    });
    const worstFactorError = Math.max(...factorErrors);
    // Convergence, not ascent: whether the base colour is brighter or darker
    // than the fog colour depends on the two colours, so each step must move
    // TOWARD the fog byte rather than up.
    const isMonotone = readBytes.every(
      (value, index) => index === 0 || Math.abs(value - fogColorByte) <= Math.abs(readBytes[index - 1] - fogColorByte) + 1
    );
    const unsupportedFogError = findConsoleErrorMatching(consoleErrorsSince(consoleErrorIndex), "Unsupported fog configuration");

    return {
      claims: [
        {
          label: "no 'Unsupported fog configuration' from the node path",
          ok: unsupportedFogError === null,
          detail: unsupportedFogError ?? "silent"
        },
        {
          label: "distance converges monotonically toward the fog colour",
          ok: isMonotone,
          detail: `bytes ${readBytes.map((value) => Math.round(value)).join(" → ")} toward ${Math.round(fogColorByte)}`
        },
        {
          label: "the curve is three's FogExp2, 1 - exp(-(density*depth)^2)",
          ok: worstFactorError <= MAXIMUM_ACCEPTABLE_FOG_FACTOR_ERROR,
          detail: `worst factor error ${roundTo(worstFactorError, 4)} against a ${MAXIMUM_ACCEPTABLE_FOG_FACTOR_ERROR} tolerance`
        }
      ],
      metrics: {
        readBytes: readBytes.map((value) => Math.round(value)).join(","),
        worstFogFactorError: roundTo(worstFactorError, 4),
        readRowOrder: usesBottomFirstRows ? "row 0 is the bottom" : "row 0 is the top"
      }
    };
  }
);

registerProbe(
  "backdrop-dome",
  "Does the forest's custom sky dome render under the node path?",
  async (context) => {
    const { THREE, renderer } = context;
    const consoleErrorIndex = collectedConsoleErrors.length;
    const scene = new THREE.Scene();
    // The supported background set is narrow (three.webgpu.js:27920-27960): a
    // Color, a cube texture, an equirectangular texture, or a plain texture.
    // The app passes a Color, which is inside it — the dome is a MESH, and that
    // is the part worth testing: BackSide, vertex colours, additive sprites.
    scene.background = new THREE.Color(0x000000);

    const domeGeometry = new THREE.SphereGeometry(SKY_DOME_RADIUS, SKY_DOME_WIDTH_SEGMENTS, SKY_DOME_HEIGHT_SEGMENTS);
    const positions = domeGeometry.getAttribute("position");
    const colors = new Float32Array(positions.count * 3);
    for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex += 1) {
      const heightFraction = Math.min(1, Math.max(0, positions.getY(vertexIndex) / SKY_DOME_RADIUS));
      for (let channel = 0; channel < 3; channel += 1) {
        colors[vertexIndex * 3 + channel] =
          SKY_DOME_HORIZON_COLOR_LINEAR[channel] +
          (SKY_DOME_ZENITH_COLOR_LINEAR[channel] - SKY_DOME_HORIZON_COLOR_LINEAR[channel]) * heightFraction;
      }
    }
    domeGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const domeMaterial = new THREE.MeshBasicNodeMaterial({ vertexColors: true });
    domeMaterial.side = THREE.BackSide;
    domeMaterial.depthWrite = false;
    scene.add(new THREE.Mesh(domeGeometry, domeMaterial));

    const camera = new THREE.PerspectiveCamera(70, PROBE_TARGET_WIDTH / PROBE_TARGET_HEIGHT, 0.1, 600);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 1, -1);
    const withoutGlowPixels = await renderToTargetAndRead(context, scene, camera);

    // The two-sprite sun: additive, depthWrite off. Both are properties the
    // node path has to honour for every additive layer this app owns — god
    // rays, stars, nebula, bubbles.
    const glowMaterial = new THREE.MeshBasicNodeMaterial();
    glowMaterial.colorNode = THREE.TSL.vec4(0.9, 0.75, 0.45, 1);
    glowMaterial.blending = THREE.AdditiveBlending;
    glowMaterial.depthWrite = false;
    glowMaterial.transparent = true;
    const glowMesh = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), glowMaterial);
    glowMesh.position.set(0, 60, -180);
    scene.add(glowMesh);
    const withGlowPixels = await renderToTargetAndRead(context, scene, camera);
    await renderer.renderAsync(scene, camera);
    captureThumbnail(context, "backdrop-dome");

    const zenithRow = Math.floor(PROBE_TARGET_HEIGHT * 0.85);
    const horizonRow = Math.floor(PROBE_TARGET_HEIGHT * 0.15);
    const centreColumn = Math.floor(PROBE_TARGET_WIDTH / 2);
    const topPixel = readPixel(withoutGlowPixels, PROBE_TARGET_WIDTH, centreColumn, zenithRow);
    const bottomPixel = readPixel(withoutGlowPixels, PROBE_TARGET_WIDTH, centreColumn, horizonRow);
    const gradientSpan = Math.abs(luminanceOfPixel(topPixel) - luminanceOfPixel(bottomPixel));
    const meanWithoutGlow = meanLuminance(withoutGlowPixels);
    const meanWithGlow = meanLuminance(withGlowPixels);
    const unsupportedBackgroundError = findConsoleErrorMatching(
      consoleErrorsSince(consoleErrorIndex),
      "Unsupported background configuration"
    );

    return {
      claims: [
        {
          label: "no 'Unsupported background configuration' from the node path",
          ok: unsupportedBackgroundError === null,
          detail: unsupportedBackgroundError ?? "silent"
        },
        {
          label: "the dome renders from inside (BackSide is honoured, not culled to black)",
          ok: meanWithoutGlow > 4,
          detail: `mean luma ${roundTo(meanWithoutGlow, 2)}`
        },
        {
          label: "the vertex-colour gradient survives, zenith against horizon",
          ok: gradientSpan > 8,
          detail: `luma span ${roundTo(gradientSpan, 2)} between the two rows`
        },
        {
          label: "additive blending with depthWrite off adds light rather than replacing it",
          ok: meanWithGlow > meanWithoutGlow + 1,
          detail: `mean luma ${roundTo(meanWithoutGlow, 2)} → ${roundTo(meanWithGlow, 2)} with the glow`
        }
      ],
      metrics: {
        domeMeanLuminance: roundTo(meanWithoutGlow, 2),
        glowMeanLuminance: roundTo(meanWithGlow, 2),
        zenithToHorizonLumaSpan: roundTo(gradientSpan, 2)
      }
    };
  }
);

registerProbe(
  "leaf-recolour-color-node",
  "Does forestModels.ts's <map_fragment> patch port to a colorNode without changing the arithmetic?",
  async (context) => {
    const { THREE, renderer } = context;
    const { vec3, vec4, dot, mix, texture, float } = THREE.TSL;
    const leafTexture = createLeafTexture(THREE);
    const leafTexelData = leafTexture.image.data;

    // The port. forestModels.ts injects at <map_fragment>, i.e. it rewrites
    // what `diffuseColor` becomes — which is precisely the slot `colorNode`
    // fills. Nothing about the expression changes; only where it is spelled.
    const sampledLeafColor = texture(leafTexture);
    const leafLuminance = dot(sampledLeafColor.rgb, vec3(...LEAF_LUMINANCE_WEIGHTS));
    const leafLightRange = mix(float(LEAF_LIGHT_RANGE_MINIMUM), float(LEAF_LIGHT_RANGE_MAXIMUM), leafLuminance);
    const portedColorNode = vec4(vec3(...LEAF_INSTANCE_COLOR_LINEAR).mul(leafLightRange), sampledLeafColor.a);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 2;
    // Unlit on purpose: this probe tests the EXPRESSION, so no lighting model
    // may sit between the node and the byte. The lit composition is the next
    // claim down.
    const unlitMaterial = new THREE.MeshBasicNodeMaterial();
    unlitMaterial.colorNode = portedColorNode;
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), unlitMaterial));
    const pixels = await renderToTargetAndRead(context, scene, camera);
    await renderer.renderAsync(scene, camera);
    captureThumbnail(context, "leaf-recolour-color-node");

    // Compare against the GLSL patch evaluated on the CPU, through the measured
    // transfer curve. Both row orders are tried because the two backends do not
    // share a coordinate system, and the flip is not what is under test.
    let worstErrorRowsFromBottom = 0;
    let worstErrorRowsFromTop = 0;
    for (let texelY = 0; texelY < LEAF_TEXTURE_SIZE; texelY += 1) {
      for (let texelX = 0; texelX < LEAF_TEXTURE_SIZE; texelX += 1) {
        const texel = leafTexelLinear(leafTexelData, texelX, texelY);
        const luminance =
          texel.rgb[0] * LEAF_LUMINANCE_WEIGHTS[0] +
          texel.rgb[1] * LEAF_LUMINANCE_WEIGHTS[1] +
          texel.rgb[2] * LEAF_LUMINANCE_WEIGHTS[2];
        const lightRange = LEAF_LIGHT_RANGE_MINIMUM + (LEAF_LIGHT_RANGE_MAXIMUM - LEAF_LIGHT_RANGE_MINIMUM) * luminance;
        const expected = LEAF_INSTANCE_COLOR_LINEAR.map((channel) => expectedByteForLinear(context.calibration, channel * lightRange));
        const pixelX = Math.floor((texelX + 0.5) * LEAF_PIXELS_PER_TEXEL);
        const rowFromBottom = Math.floor((texelY + 0.5) * LEAF_PIXELS_PER_TEXEL);
        const rowFromTop = PROBE_TARGET_HEIGHT - 1 - rowFromBottom;
        for (const [row, accumulate] of [
          [rowFromBottom, (value) => (worstErrorRowsFromBottom = Math.max(worstErrorRowsFromBottom, value))],
          [rowFromTop, (value) => (worstErrorRowsFromTop = Math.max(worstErrorRowsFromTop, value))]
        ]) {
          const pixel = readPixel(pixels, PROBE_TARGET_WIDTH, pixelX, row);
          accumulate(Math.max(...expected.map((value, channel) => Math.abs(pixel[channel] - value))));
        }
      }
    }
    const worstByteError = Math.min(worstErrorRowsFromBottom, worstErrorRowsFromTop);

    // The lit composition. oceanCaustics.ts:206 records that these patches
    // exist to keep three's lighting, fog and tone mapping — so the port has to
    // keep them too, which a slot override does by construction and an
    // over-the-top fragment rewrite does not.
    const litScene = new THREE.Scene();
    litScene.fog = new THREE.FogExp2(new THREE.Color(0x223311), 0.02);
    const litMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0 });
    litMaterial.colorNode = portedColorNode;
    const litMesh = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), litMaterial);
    litScene.add(litMesh);
    const keyLight = new THREE.DirectionalLight(0xffffff, 3);
    keyLight.position.set(2, 3, 4);
    litScene.add(keyLight);
    const litCamera = new THREE.PerspectiveCamera(45, PROBE_TARGET_WIDTH / PROBE_TARGET_HEIGHT, 0.1, 100);
    litCamera.position.z = 4;
    let litError = null;
    let litMeanLuminance = 0;
    try {
      const litPixels = await renderToTargetAndRead(context, litScene, litCamera);
      litMeanLuminance = meanLuminance(litPixels);
    } catch (error) {
      litError = String(error);
    }

    return {
      claims: [
        {
          label: "the ported expression reproduces the GLSL patch's arithmetic",
          ok: worstByteError <= MAXIMUM_ACCEPTABLE_BYTE_ERROR,
          detail: `worst channel error ${roundTo(worstByteError, 2)} of 255 across all ${LEAF_TEXTURE_SIZE * LEAF_TEXTURE_SIZE} texels`
        },
        {
          label: "the same node composes with lighting and fog (the reason the patch existed)",
          ok: litError === null && litMeanLuminance > 4,
          detail: litError ?? `lit mean luma ${roundTo(litMeanLuminance, 2)}`
        }
      ],
      metrics: {
        worstChannelByteError: roundTo(worstByteError, 2),
        litMeanLuminance: roundTo(litMeanLuminance, 2)
      }
    };
  }
);

registerProbe(
  "star-points-size-node",
  "Do PointsNodeMaterial's sizeNode and pointUV replace gl_PointSize and gl_PointCoord?",
  async (context) => {
    const { THREE, renderer } = context;
    const { attribute, positionView, uniform, float } = THREE.TSL;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, PROBE_TARGET_WIDTH / PROBE_TARGET_HEIGHT, 0.1, 100);
    camera.position.z = 8;

    const starCount = STAR_SIZE_ATTRIBUTES.length;
    const positions = new Float32Array(starCount * 3);
    const starSizes = new Float32Array(starCount);
    STAR_SIZE_ATTRIBUTES.forEach((size, index) => {
      // Spread across the frame so one star's footprint cannot reach another's.
      positions[index * 3] = -2.4 + index * 2.4;
      positions[index * 3 + 1] = 0;
      positions[index * 3 + 2] = 0;
      starSizes[index] = size;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("starSize", new THREE.BufferAttribute(starSizes, 1));

    // SizedStarPoints.tsx's vertex expression, verbatim in node form:
    //   gl_PointSize = starSize * (uPointScale / -mvPosition.z)
    const material = new THREE.PointsNodeMaterial();
    material.colorNode = THREE.TSL.vec4(...STAR_COLOR_UNIT_RGB, 1);
    material.sizeNode = attribute("starSize", "float").mul(uniform(float(STAR_POINT_SCALE)).div(positionView.z.negate()));
    material.transparent = true;
    material.depthWrite = false;
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);

    let sizeNodeError = null;
    let pixels = null;
    try {
      pixels = await renderToTargetAndRead(context, scene, camera);
      await renderer.renderAsync(scene, camera);
      captureThumbnail(context, "star-points-size-node");
    } catch (error) {
      sizeNodeError = String(error);
    }

    // Footprint per star: how many pixels of the frame each one actually covers.
    const footprints = STAR_SIZE_ATTRIBUTES.map(() => 0);
    if (pixels) {
      const columnWidth = PROBE_TARGET_WIDTH / starCount;
      for (let y = 0; y < PROBE_TARGET_HEIGHT; y += 1) {
        for (let x = 0; x < PROBE_TARGET_WIDTH; x += 1) {
          if (luminanceOfPixel(readPixel(pixels, PROBE_TARGET_WIDTH, x, y)) <= 3) continue;
          const column = Math.min(starCount - 1, Math.floor(x / columnWidth));
          footprints[column] += 1;
        }
      }
    }
    const smallestFootprint = Math.min(...footprints);
    const largestFootprint = Math.max(...footprints);
    const requestedSizeRatio = STAR_SIZE_ATTRIBUTES[starCount - 1] / STAR_SIZE_ATTRIBUTES[0];
    const measuredFootprintRatio = smallestFootprint === 0 ? 0 : largestFootprint / smallestFootprint;

    // pointUV, tested separately, because it fails for a different reason:
    // PointUVNode.generate() (three.webgpu.js:17922) returns the literal string
    // 'vec2( gl_PointCoord.x, 1.0 - gl_PointCoord.y )' for EVERY builder, and
    // WGSL has no gl_PointCoord.
    const pointUvScene = new THREE.Scene();
    const pointUvMaterial = new THREE.PointsNodeMaterial();
    pointUvMaterial.colorNode = THREE.TSL.vec4(THREE.TSL.pointUV, 0, 1);
    const pointUvGeometry = new THREE.BufferGeometry();
    pointUvGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    const pointUvPoints = new THREE.Points(pointUvGeometry, pointUvMaterial);
    pointUvPoints.frustumCulled = false;
    pointUvScene.add(pointUvPoints);
    let pointUvError = null;
    try {
      await renderToTargetAndRead(context, pointUvScene, camera);
    } catch (error) {
      pointUvError = String(error);
    }
    const pointUvConsoleError = findConsoleErrorMatching(collectedConsoleErrors, "gl_PointCoord");

    return {
      claims: [
        {
          label: "the points draw at all",
          ok: sizeNodeError === null && largestFootprint > 0,
          detail: sizeNodeError ?? `footprints ${footprints.join(" / ")} pixels`
        },
        {
          // MEASURED, and it is the opposite of what §20 of the report claims.
          // WebGPU has no point size in the specification, and the GLSL node
          // builder hardcodes `gl_PointSize = 1.0` (three.webgpu.js:31735), so
          // sizeNode is declared, copied, and never read on either backend.
          label: "sizeNode is INERT: a 3, a 9 and a 27 all render the same size",
          ok: measuredFootprintRatio < 1.5,
          detail: `requested ratio ${requestedSizeRatio}:1, measured footprint ratio ${roundTo(measuredFootprintRatio, 2)}:1`
        },
        {
          // pointUV is GLSL-only: PointUVNode.generate() (three.webgpu.js:17922)
          // returns the literal string 'vec2( gl_PointCoord.x, 1.0 -
          // gl_PointCoord.y )' for EVERY builder, and WGSL has no gl_PointCoord.
          //
          // On WebGPU the failure is INVISIBLE FROM INSIDE THE PAGE, and that
          // is the claim: Dawn rejects the shader module, Chrome logs it at
          // browser level, three neither throws nor writes to console, and the
          // draw is dropped. measure.mjs supplies the other half of this
          // verdict, because only the process driving the browser can see it.
          label:
            context.backendName === BACKEND_FORCED_WEBGL
              ? "pointUV compiles on the WebGL backend, where its GLSL is native"
              : "a WGSL compile failure is invisible to the page: nothing throws, nothing reaches console",
          ok:
            context.backendName === BACKEND_FORCED_WEBGL
              ? pointUvError === null
              : pointUvError === null && pointUvConsoleError === null,
          detail: pointUvError ?? pointUvConsoleError ?? "the page observed nothing"
        }
      ],
      metrics: {
        footprintPixels: footprints.join(","),
        requestedSizeRatio,
        measuredFootprintRatio: roundTo(measuredFootprintRatio, 2),
        pointUvError: (pointUvError ?? pointUvConsoleError ?? "none").slice(0, 200)
      }
    };
  }
);

registerProbe(
  "glsl-fn",
  "Does glslFn work under the WebGPU backend, or only the WebGL one?",
  async (context) => {
    const { THREE } = context;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 2;
    const material = new THREE.MeshBasicNodeMaterial();
    let setupError = null;
    try {
      const tintFunction = THREE.TSL.glslFn(`
        vec3 tintTowardBlue( vec3 sourceColor ) {
          return sourceColor * vec3( 0.25, 0.5, 1.0 );
        }
      `);
      material.colorNode = THREE.TSL.vec4(tintFunction(THREE.TSL.vec3(0.8, 0.8, 0.8)), 1);
    } catch (error) {
      setupError = String(error);
    }
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

    let renderError = null;
    let pixel = [0, 0, 0, 0];
    if (setupError === null) {
      try {
        const pixels = await renderToTargetAndRead(context, scene, camera);
        pixel = readPixel(pixels, PROBE_TARGET_WIDTH, PROBE_TARGET_WIDTH / 2, PROBE_TARGET_HEIGHT / 2);
      } catch (error) {
        renderError = String(error);
      }
    }
    const failed = setupError !== null || renderError !== null;
    // A blue-tinted grey: the function multiplies by (0.25, 0.5, 1.0), so blue
    // must come back above red. Checking that rather than "it did not throw" is
    // the difference between measuring the function and measuring its absence.
    const tintApplied = pixel[2] > pixel[0] + 8;
    const expectedToWork = context.backendName === BACKEND_FORCED_WEBGL;

    return {
      claims: [
        {
          label: expectedToWork ? "works on the WebGL backend, where the injected code is native" : "reports a named failure on WebGPU rather than rendering something wrong",
          ok: expectedToWork ? !failed && tintApplied : failed || !tintApplied,
          detail: setupError ?? renderError ?? `pixel ${pixel.slice(0, 3).join(",")}`
        }
      ],
      metrics: {
        outcome: failed ? "failed" : tintApplied ? "tint applied" : "rendered untinted",
        error: (setupError ?? renderError ?? "none").slice(0, 240),
        centrePixel: pixel.slice(0, 3).join(",")
      }
    };
  }
);

registerProbe(
  "first-mount-pipeline-latency",
  "How long does the first frame take when every material is a fresh pipeline?",
  async (context) => {
    const { THREE, renderer } = context;
    const { vec4 } = THREE.TSL;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, PROBE_TARGET_WIDTH / PROBE_TARGET_HEIGHT, 0.1, 100);
    camera.position.z = 12;
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(3, 5, 4);
    scene.add(keyLight, new THREE.AmbientLight(0xffffff, 0.3));

    for (let materialIndex = 0; materialIndex < PIPELINE_LATENCY_MATERIAL_COUNT; materialIndex += 1) {
      // A different expression per material, so nothing can be reused from a
      // pipeline cache and the measurement is compilation rather than draw.
      const phase = (materialIndex + 1) / PIPELINE_LATENCY_MATERIAL_COUNT;
      const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.2 + phase * 0.6, metalness: phase * 0.5 });
      material.colorNode = vec4(phase, 1 - phase, Math.abs(0.5 - phase) * 2, 1);
      material.emissiveNode = vec4(phase * 0.05, 0, (1 - phase) * 0.05, 1);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), material);
      const columns = 6;
      mesh.position.set((materialIndex % columns) - columns / 2, Math.floor(materialIndex / columns) - 2, 0);
      scene.add(mesh);
    }

    // A main-thread gap ticker rather than a long-task observer.
    //
    // PerformanceObserver({entryTypes:['longtask']}) was tried first and
    // reported nothing at all — including for a deliberate 120 ms block — in
    // this browser configuration, so its zero was not evidence of a smooth
    // frame, it was evidence of a silent instrument. A timer that records how
    // late it was scheduled needs no API support and measures the thing the
    // question is actually about: how long the main thread was unavailable.
    const mainThreadGaps = [];
    let lastTickAt = performance.now();
    let tickerRunning = true;
    const tick = () => {
      const now = performance.now();
      mainThreadGaps.push(now - lastTickAt);
      lastTickAt = now;
      if (tickerRunning) setTimeout(tick, MAIN_THREAD_TICKER_INTERVAL_MILLISECONDS);
    };
    setTimeout(tick, MAIN_THREAD_TICKER_INTERVAL_MILLISECONDS);

    const firstFrameStartedAt = performance.now();
    await renderer.renderAsync(scene, camera);
    const firstFrameMilliseconds = performance.now() - firstFrameStartedAt;
    const secondFrameStartedAt = performance.now();
    await renderer.renderAsync(scene, camera);
    const secondFrameMilliseconds = performance.now() - secondFrameStartedAt;

    // Let the ticker run once more BEFORE reading, so the gap that straddles
    // the render is in the sample. Slicing here instead produced an empty array
    // and a claim that passed on zero samples — a vacuous pass, which is the
    // failure mode this whole demo exists to avoid. An empty sample set is not
    // a smooth main thread; it means no timer got to run at all, which is the
    // strongest possible evidence of blocking.
    await new Promise((resolve) => setTimeout(resolve, MAIN_THREAD_TICKER_INTERVAL_MILLISECONDS * 2));
    const gapsDuringRender = mainThreadGaps.slice();

    // The instrument is checked before its numbers are believed. A deliberate
    // block must show up as a gap of at least its own length. This project has
    // already been burnt once by an API that advertised non-blocking behaviour
    // and blocked anyway (§24.1's KHR_parallel_shader_compile), so a quiet
    // instrument is not the same as a quiet main thread.
    const syntheticBlockStartedAt = performance.now();
    while (performance.now() - syntheticBlockStartedAt < SYNTHETIC_LONG_TASK_MILLISECONDS) {
      // deliberately blocking
    }
    await new Promise((resolve) => setTimeout(resolve, MAIN_THREAD_TICKER_INTERVAL_MILLISECONDS * 4));
    tickerRunning = false;
    const gapsAfterSyntheticBlock = mainThreadGaps.slice(gapsDuringRender.length);
    const tickerSawSyntheticBlock = gapsAfterSyntheticBlock.some(
      (gap) => gap >= SYNTHETIC_LONG_TASK_MILLISECONDS * 0.8
    );
    captureThumbnail(context, "first-mount-pipeline-latency");

    const longestGapDuringRender = gapsDuringRender.length === 0 ? 0 : Math.max(...gapsDuringRender);

    return {
      claims: [
        {
          label: "the first frame completed",
          ok: Number.isFinite(firstFrameMilliseconds),
          detail: `${roundTo(firstFrameMilliseconds, 1)} ms for ${PIPELINE_LATENCY_MATERIAL_COUNT} fresh pipelines`
        },
        {
          // The question §24.1 asks. A first frame far above the steady-state
          // one means compilation is on the critical path here too, which is
          // the app's existing ~2.5 s stall wearing a new backend.
          label: "the first frame costs more than the steady-state frame",
          ok: firstFrameMilliseconds > secondFrameMilliseconds,
          detail: `${roundTo(firstFrameMilliseconds, 1)} ms first against ${roundTo(secondFrameMilliseconds, 1)} ms second`
        },
        {
          label: "the gap ticker is actually reporting, so its numbers can be read",
          ok: tickerSawSyntheticBlock,
          detail: tickerSawSyntheticBlock
            ? `a deliberate ${SYNTHETIC_LONG_TASK_MILLISECONDS} ms block was seen as a ${roundTo(Math.max(...gapsAfterSyntheticBlock), 1)} ms gap`
            : "a deliberate block was NOT seen; every number in this row means nothing"
        },
        {
          // The one that matters for a 60 fps floor: not how long the frame
          // took, but how long the main thread was unavailable while it did.
          // MEASURED, and it is the answer §24.1 wanted: `renderAsync` returns
          // a promise, and pipeline creation still blocks — the await is where
          // the work is submitted, not where it is moved off the thread.
          label: "pipeline creation BLOCKS the main thread past a frame budget",
          ok: longestGapDuringRender >= MAXIMUM_ACCEPTABLE_MAIN_THREAD_GAP_MILLISECONDS,
          detail: `longest main-thread gap ${roundTo(longestGapDuringRender, 1)} ms across ${gapsDuringRender.length} samples, against a ${MAXIMUM_ACCEPTABLE_MAIN_THREAD_GAP_MILLISECONDS} ms budget`
        }
      ],
      metrics: {
        firstFrameMilliseconds: roundTo(firstFrameMilliseconds, 1),
        secondFrameMilliseconds: roundTo(secondFrameMilliseconds, 1),
        longestMainThreadGapMilliseconds: roundTo(longestGapDuringRender, 1),
        gapSampleCount: gapsDuringRender.length,
        tickerVerified: String(tickerSawSyntheticBlock)
      }
    };
  }
);

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function renderResultsTable(results) {
  const tableBody = document.getElementById("results-body");
  if (!tableBody) return;
  tableBody.textContent = "";
  for (const result of results) {
    for (const claim of result.claims) {
      const row = document.createElement("tr");
      row.className = claim.ok ? "claim-holds" : "claim-fails";
      for (const cellText of [result.backendName, result.name, claim.label, claim.ok ? "holds" : "FAILS", claim.detail]) {
        const cell = document.createElement("td");
        cell.textContent = cellText;
        row.append(cell);
      }
      tableBody.append(row);
    }
  }
}

function renderStatus(message) {
  const status = document.getElementById("status");
  if (status) status.textContent = message;
}

async function runEveryProbe() {
  installConsoleCollector();
  const results = [];
  const backendOrder = requestedBackendOrder();
  for (const backendName of backendOrder) {
    renderStatus(`initialising ${backendName}…`);
    const context = await createRendererContext(THREE, backendName);
    if (context.initializationError === null) {
      try {
        context.calibration = await measureTransferCurve(context);
      } catch (error) {
        context.calibration = [
          { linear: 0, encodedByte: 0 },
          { linear: 1, encodedByte: 255 }
        ];
        collectedConsoleErrors.push(`transfer-curve calibration failed on ${backendName}: ${error}`);
      }
    }
    for (const probe of probeRegistry) {
      renderStatus(`${backendName} · ${probe.name}…`);
      if (context.initializationError !== null && probe.name !== "renderer-init") {
        results.push({
          backendName,
          name: probe.name,
          question: probe.question,
          claims: [{ label: "skipped: the renderer never initialised", ok: false, detail: context.initializationError }],
          metrics: {}
        });
        continue;
      }
      try {
        const outcome = await probe.run(context);
        results.push({ backendName, name: probe.name, question: probe.question, ...outcome });
      } catch (error) {
        results.push({
          backendName,
          name: probe.name,
          question: probe.question,
          claims: [{ label: "the probe itself threw", ok: false, detail: describeError(error) }],
          metrics: {}
        });
      }
      renderResultsTable(results);
    }
    context.renderer.dispose();
  }
  const failingClaimCount = results.reduce(
    (count, result) => count + result.claims.filter((claim) => !claim.ok).length,
    0
  );
  renderStatus(
    failingClaimCount === 0
      ? `every claim holds across ${results.length} probe runs`
      : `${failingClaimCount} claim(s) do not hold — see the red rows`
  );
  window.__WEBGPU_NODE_PATH_RESULTS = { backendOrder, results, consoleErrors: collectedConsoleErrors, failingClaimCount };
  window.__WEBGPU_NODE_PATH_DONE = true;
}

runEveryProbe().catch((error) => {
  renderStatus(`the run itself failed: ${error}`);
  window.__WEBGPU_NODE_PATH_RESULTS = { backendOrder: [], results: [], consoleErrors: [String(error)], failingClaimCount: 1 };
  window.__WEBGPU_NODE_PATH_DONE = true;
});

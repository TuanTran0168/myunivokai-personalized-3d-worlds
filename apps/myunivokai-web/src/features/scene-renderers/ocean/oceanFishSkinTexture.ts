/**
 * Baked skin textures for every fauna species that has no CC0 GLB to adopt
 * (see oceanRigFauna.ts's OCEAN_RIG_SPECIES for the current list — every
 * species WITH a `file` gets its texture from that model instead and this
 * bake is never applied to it). A flat MeshStandardMaterial colour reads as
 * a toy; this is the same
 * "bake a CanvasTexture from seeded noise" technique createSandTextures
 * already uses for the seabed, one step smaller in scope.
 *
 * The body of revolution in oceanRigBodies.ts parameterises itself as
 * u = angle / 2π (wraps once around the body), v = head-to-tail (does not
 * wrap). u = 0.75 is the belly — sin(angle) is most negative there, the same
 * point the swim shader's vBelly countershading already brightens. Any noise
 * baked across this UV has to wrap in u the same way createSandTextures'
 * seabed noise wraps: a plain non-wrapping field draws a visible seam down
 * the fish's back where u = 0 meets u = 1.
 */
import { CanvasTexture, NoColorSpace, RepeatWrapping } from "three";

export type FishSkinBake = {
  /** Grey scale-mottle multiplier on material.color. Applied to every species this module covers. */
  map: CanvasTexture;
  /**
   * Photophore dots, black everywhere else. Only species with
   * `photophores: true` get one — everything else is null, and the caller
   * leaves the school's existing uniform emissive alone.
   */
  emissiveMap: CanvasTexture | null;
  dispose: () => void;
};

const MAP_WIDTH = 128;
const MAP_HEIGHT = 64;

/** Hashed on a lattice that wraps at `periodU` so u = 0 and u = 1 agree exactly. */
function wrappedHash(ix: number, iy: number, periodU: number): number {
  const wx = ((ix % periodU) + periodU) % periodU;
  let h = Math.imul(wx, 374761393) + Math.imul(iy, 668265263) + Math.imul(periodU, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noiseAt(x: number, y: number, periodU: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = wrappedHash(ix, iy, periodU);
  const b = wrappedHash(ix + 1, iy, periodU);
  const c = wrappedHash(ix, iy + 1, periodU);
  const d = wrappedHash(ix + 1, iy + 1, periodU);
  const top = a + (b - a) * ux;
  const bottom = c + (d - c) * ux;
  return top + (bottom - top) * uy;
}

/** Two octaves at periods that both divide MAP_WIDTH, so both wrap cleanly. */
function scaleMottle(u: number, v: number): number {
  const cellsA = 8;
  const cellsB = 16;
  return noiseAt(u * cellsA, v * cellsA * 2, cellsA) * 0.65 + noiseAt(u * cellsB, v * cellsB * 2, cellsB) * 0.35;
}

/**
 * A deterministic pseudo-random float in [0, 1) from a string, used only to
 * jitter photophore spacing so a row does not read as a printed ruler. Not the
 * shared randomFromSeed generator: that produces a 1D sequence, and every call
 * here needs the SAME jitter for the same (row, slot) every time this bakes,
 * not the next value off a stream.
 */
function jitterFor(seed: string, row: number, slot: number): number {
  let hash = 2166136261 ^ row * 131 ^ slot * 17;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

/** One glowing dot in the emissive bake's own UV space. */
export type PhotophoreDot = { u: number; v: number; radius?: number };

export type FishSkinOptions = {
  seed: string;
  /**
   * Photophore rows either side of the belly seam (u = 0.75), the real
   * anatomy of a myctophid: paired ventral photophore rows running most of
   * the body's length. `true` keeps that exact two-row layout; an explicit
   * array of dots switches to drawing exactly those points instead, for
   * species whose photophores don't sit in a myctophid's ventral rows —
   * vampire squid's arm tips and fin bases, for one.
   */
  photophores?: boolean | PhotophoreDot[];
  /**
   * One or two extra glowing points, ADDITIVE to whatever `photophores`
   * already draws (or drawn alone if `photophores` is unset) — a viperfish's
   * or dragonfish's single lure/barbel tip, at that fin's own
   * `u = 0.5, v = <the fin's along>` convention (every fin in
   * oceanRigBodies.ts samples u = 0.5, so this needs no geometry change).
   */
  extraPoints?: PhotophoreDot[];
  /**
   * Periodic dark seams multiplied into the albedo mottle, independent of the
   * photophore path — used only to suggest the giant isopod's tergite-plate
   * boundaries on an otherwise ordinary body-of-revolution mesh. The number
   * of seams running head to tail.
   */
  bands?: number;
};

const MYCTOPHID_ROWS_U = [0.68, 0.82] as const;
const MYCTOPHID_DOTS_PER_ROW = 11;

/** The paired ventral rows every lanternfish/hatchetfish bake has always drawn. */
function myctophidDots(seed: string): PhotophoreDot[] {
  const dots: PhotophoreDot[] = [];
  for (let row = 0; row < MYCTOPHID_ROWS_U.length; row += 1) {
    for (let slot = 0; slot < MYCTOPHID_DOTS_PER_ROW; slot += 1) {
      const baseV = 0.12 + (slot / (MYCTOPHID_DOTS_PER_ROW - 1)) * 0.72;
      const jitterV = (jitterFor(seed, row, slot) - 0.5) * 0.03;
      dots.push({ u: MYCTOPHID_ROWS_U[row], v: baseV + jitterV });
    }
  }
  return dots;
}

/**
 * A minimal eye marking, baked into the albedo map at u = 0 and u = 0.5 —
 * the two lateral sides of the revolve (u = 0.25/0.75 are dorsal/ventral, see
 * the file header) — a little behind the very nose tip (v ~ 0.09).
 *
 * Every one of the 21 species with no GLB to adopt stays a bare procedural
 * silhouette forever, and none of oceanRigBodies.ts's archetypes carries an
 * eye, mouth or gill of its own — bodyGeometry() has no vocabulary for a
 * facial feature, only a body of revolution. A baked marking is the cheap
 * substitute: it needs no new geometry and applies uniformly to every
 * archetype this module covers, including the two built from a different
 * construction (buildCephalopod's mantle and buildSeahorse's head both
 * compress their own "head" region to the front of their local v range the
 * same way an ordinary fish does, so the same fixed v still lands on it).
 *
 * This is a MULTIPLIER map (see the file header), so it can only darken
 * toward the surface's own colour, never brighten past it — an iris this
 * dark plus a smaller, less-dark glint is what that constraint can still
 * produce, and is enough to read as an eye rather than a hole in the skin.
 */
function drawEye(context: CanvasRenderingContext2D, u: number): void {
  const centerX = u * MAP_WIDTH;
  const centerY = 0.09 * MAP_HEIGHT;
  const irisRadius = MAP_HEIGHT * 0.055;
  const glintRadius = irisRadius * 0.5;
  const paintAt = (x: number) => {
    let gradient = context.createRadialGradient(x, centerY, 0, x, centerY, irisRadius);
    gradient.addColorStop(0, "#000000");
    gradient.addColorStop(0.68, "#000000");
    gradient.addColorStop(1, "#00000000");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, centerY, irisRadius, 0, Math.PI * 2);
    context.fill();
    const glintX = x - irisRadius * 0.3;
    const glintY = centerY - irisRadius * 0.3;
    gradient = context.createRadialGradient(glintX, glintY, 0, glintX, glintY, glintRadius);
    gradient.addColorStop(0, "#FFFFFF");
    gradient.addColorStop(1, "#00000000");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(glintX, glintY, glintRadius, 0, Math.PI * 2);
    context.fill();
  };
  paintAt(centerX);
  // u wraps: a dot near u = 0/1 would otherwise clip at the canvas edge.
  if (centerX < irisRadius) paintAt(centerX + MAP_WIDTH);
  else if (centerX > MAP_WIDTH - irisRadius) paintAt(centerX - MAP_WIDTH);
}

function drawDot(context: CanvasRenderingContext2D, dot: PhotophoreDot): void {
  const centerX = dot.u * MAP_WIDTH;
  const centerY = dot.v * MAP_HEIGHT;
  const radius = MAP_HEIGHT * (dot.radius ?? 0.028);
  const paint = (x: number) => {
    const gradient = context.createRadialGradient(x, centerY, 0, x, centerY, radius);
    gradient.addColorStop(0, "#FFFFFF");
    gradient.addColorStop(0.55, "#FFFFFF");
    gradient.addColorStop(1, "#00000000");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, centerY, radius, 0, Math.PI * 2);
    context.fill();
  };
  paint(centerX);
  // u wraps: a dot near u = 0/1 would otherwise clip at the canvas edge.
  if (centerX < radius) paint(centerX + MAP_WIDTH);
  else if (centerX > MAP_WIDTH - radius) paint(centerX - MAP_WIDTH);
}

export function createFishSkinBake(options: FishSkinOptions): FishSkinBake {
  const albedoCanvas = document.createElement("canvas");
  albedoCanvas.width = MAP_WIDTH;
  albedoCanvas.height = MAP_HEIGHT;
  const albedoContext = albedoCanvas.getContext("2d");
  if (!albedoContext) {
    throw new Error("ocean rig: 2D canvas unavailable for the fish skin texture");
  }
  // Grey, not the species' own colour: this map is a MULTIPLIER on
  // material.color, not a replacement for it. Baking the colour in here would
  // mean either doubling it (material.color stays the species colour) or
  // erasing it everywhere else that colour is read — the near-field emissive
  // copy in oceanRig.ts (`emissive.copy(material.color)`) is exactly such a
  // reader, and anthias is both near-field and one of the three species this
  // bake applies to.
  const albedoImage = albedoContext.createImageData(MAP_WIDTH, MAP_HEIGHT);
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    const v = y / MAP_HEIGHT;
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const u = x / MAP_WIDTH;
      // Mottling only, never a net brightness shift: the swim shader's own
      // vBelly countershading already carries the dorsal/ventral gradient, and
      // stacking a second one here would double it.
      let mottle = 0.8 + scaleMottle(u, v) * 0.4;
      if (options.bands) {
        // Thin dark seams at regular intervals along v — cos^8 stays near 1
        // (no darkening) except right at each seam, where it spikes to 0.
        const seam = Math.pow(Math.max(0, Math.cos(v * options.bands * Math.PI * 2)), 8);
        mottle *= 1 - 0.25 * seam;
      }
      const shade = Math.min(255, Math.round(mottle * 255));
      const offset = (y * MAP_WIDTH + x) * 4;
      albedoImage.data[offset] = shade;
      albedoImage.data[offset + 1] = shade;
      albedoImage.data[offset + 2] = shade;
      albedoImage.data[offset + 3] = 255;
    }
  }
  albedoContext.putImageData(albedoImage, 0, 0);
  drawEye(albedoContext, 0);
  drawEye(albedoContext, 0.5);
  const map = new CanvasTexture(albedoCanvas);
  // NoColorSpace, not SRGBColorSpace: these bytes are a linear multiplier
  // (0.8-1.2), authored as one channel replicated three ways, not sRGB
  // colour data. Tagging it sRGB would run it through gamma decode before the
  // multiply and skew every value toward the low end of the range — the same
  // shape of mistake round 3 of this family's work made with additive
  // shaders, just on a baked texture instead of a live one.
  map.colorSpace = NoColorSpace;
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;

  const dots: PhotophoreDot[] = [
    ...(options.photophores === true
      ? myctophidDots(options.seed)
      : Array.isArray(options.photophores)
        ? options.photophores
        : []),
    ...(options.extraPoints ?? []),
  ];

  let emissiveMap: CanvasTexture | null = null;
  if (dots.length > 0) {
    const emissiveCanvas = document.createElement("canvas");
    emissiveCanvas.width = MAP_WIDTH;
    emissiveCanvas.height = MAP_HEIGHT;
    const emissiveContext = emissiveCanvas.getContext("2d");
    if (!emissiveContext) {
      throw new Error("ocean rig: 2D canvas unavailable for the photophore texture");
    }
    emissiveContext.fillStyle = "#000000";
    emissiveContext.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
    for (const dot of dots) drawDot(emissiveContext, dot);
    emissiveMap = new CanvasTexture(emissiveCanvas);
    // Emissive intensity is linear light multiplied straight in; encoding it
    // sRGB here would be the identical mistake round 3 of this family's work
    // made with additive shader layers, just baked instead of live.
    emissiveMap.colorSpace = NoColorSpace;
    emissiveMap.wrapS = RepeatWrapping;
    emissiveMap.wrapT = RepeatWrapping;
  }

  return {
    map,
    emissiveMap,
    dispose: () => {
      map.dispose();
      emissiveMap?.dispose();
    },
  };
}

/**
 * The seabed, the rock on it, and the caustics that fall across both.
 *
 * Built imperatively rather than as R3F components because every one of these
 * surfaces has to agree with the others about the same wave, the same water and
 * the same lamp, and threading eight uniforms through eight components is how
 * they drift apart. One module owns the floor.
 *
 * The rules encoded here are argued in notes/evolution/ocean-visual-direction-research.md:
 *
 *   - the seabed is DARKER than the water above it (§3, the value ladder), and
 *     the frame flattens into poster paint the moment it is not;
 *   - caustics are highlights ON a mid-value surface, so they need one;
 *   - a heightfield of low-frequency noise has no silhouette, and a lamp needs
 *     an EDGE to read as a lamp — which is what the boulders are for (§11c).
 */
import {
  BufferAttribute,
  CanvasTexture,
  Color,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from "three";
import { randomFromSeed } from "@/lib/scene";

/**
 * How much clear water the viewer keeps around itself. Six metres is enough that
 * the largest boulder the scatter can draw (about 3.7 m across) reads as an
 * object at a distance rather than as an obstruction.
 */
const BOULDER_CAMERA_STANDOFF_METRES = 6;

/** Dry coral sand. It must START warm or the water has nothing to take away. */
const SAND_ALBEDO = new Color("#D8BE93");
/**
 * Basalt and manganese crust, which is what an abyssal plain is paved with.
 * Darker than sand by about a factor of two, and that difference is the only
 * reason a boulder has a silhouette against it.
 */
const ROCK_ALBEDO = new Color("#6E6A62");

export const GLSL_TERRAIN_NOISE = /* glsl */ `
  float sHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float sNoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(sHash(i), sHash(i + vec2(1,0)), u.x),
               mix(sHash(i + vec2(0,1)), sHash(i + vec2(1,1)), u.x), u.y);
  }
`;

/**
 * Ridged caustic veins.
 *
 * Two things are required and both were learned the hard way: ripple-scale
 * frequencies, and a DOMAIN WARP — because a plain sum of plane waves is always
 * quasi-periodic and lays a visible lattice across the floor. The grazing-face
 * gate matters too: light arrives from above, and the pattern's derivative is
 * meaningless on a near-vertical surface.
 */
export const GLSL_CAUSTICS = /* glsl */ `
  float causticVeins(vec2 p, float t){
    vec2 w = p + vec2(
      sin(p.y * 0.31 + t * 0.13) + 0.45 * sin(p.x * 0.71 - t * 0.19),
      cos(p.x * 0.27 - t * 0.11) + 0.45 * cos(p.y * 0.63 + t * 0.17)) * 1.6;
    float v = 0.0;
    v += 0.34 * sin(dot(w, vec2( 0.986,  0.164)) * 2.4 + t * 0.9);
    v += 0.26 * sin(dot(w, vec2( 0.383,  0.924)) * 1.7 - t * 0.7);
    v += 0.20 * sin(dot(w, vec2(-0.707,  0.707)) * 3.9 + t * 1.3);
    v += 0.14 * sin(dot(w, vec2( 0.643, -0.766)) * 5.1 - t * 1.1);
    v += 0.10 * sin(dot(w, vec2(-0.259, -0.966)) * 7.3 + t * 1.7);
    return pow(max(0.0, 1.0 - abs(v) * 1.35), 5.0);
  }
`;

export type CausticUniforms = {
  uCausticTime: { value: number };
  uCausticStrength: { value: number };
  uCausticColor: { value: Color };
  uCausticScale: { value: number };
};

export function createCausticUniforms(): CausticUniforms {
  return {
    uCausticTime: { value: 0 },
    uCausticStrength: { value: 0 },
    uCausticColor: { value: new Color("#CFF6FF") },
    uCausticScale: { value: 0.9 },
  };
}

/**
 * Splice caustics into any standard material.
 *
 * Injected before `<tonemapping_fragment>`, which in three's fragment order is
 * still ahead of `<fog_fragment>` — so the pattern is tone-mapped and then
 * fogged, exactly like the surface it sits on.
 */
export function applyCaustics(material: MeshStandardMaterial, uniforms: CausticUniforms): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCW;\nvarying float vCUp;")
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
          vec4 cp = vec4(transformed, 1.0);
          mat3 cr = mat3(modelMatrix);
          #ifdef USE_INSTANCING
            cp = instanceMatrix * cp;
            cr = cr * mat3(instanceMatrix);
          #endif
          vCW = (modelMatrix * cp).xyz;
          vCUp = normalize(cr * objectNormal).y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
          varying vec3 vCW;
          varying float vCUp;
          uniform float uCausticTime;
          uniform float uCausticStrength;
          uniform vec3 uCausticColor;
          uniform float uCausticScale;
          ${GLSL_CAUSTICS}`,
      )
      .replace(
        "#include <tonemapping_fragment>",
        `float cs = causticVeins(vCW.xz * uCausticScale, uCausticTime);
          cs *= smoothstep(0.0, 0.35, vCUp);
          gl_FragColor.rgb += uCausticColor * cs * uCausticStrength;
          #include <tonemapping_fragment>`,
      );
  };
  material.needsUpdate = true;
}

export type SandTextures = { map: Texture; normalMap: Texture };

/**
 * Sand, generated rather than downloaded, so the scene has no texture budget
 * and no licence to track. Two channels from one height field: an albedo with
 * grain and shell fragments, and a normal map with the ripple relief that gives
 * the caustics something to break over.
 *
 * The ripples run ACROSS the wind, because sand ripples form parallel to the
 * wave crests that drive the near-bed orbital flow.
 */
export function createSandTextures(
  size: number,
  windDirectionRadians: number,
  anisotropy: number,
): SandTextures {
  const albedo = document.createElement("canvas");
  albedo.width = size;
  albedo.height = size;
  const albedoContext = albedo.getContext("2d");
  const normal = document.createElement("canvas");
  normal.width = size;
  normal.height = size;
  const normalContext = normal.getContext("2d");
  if (!albedoContext || !normalContext) {
    throw new Error("ocean rig: 2D canvas unavailable for the seabed textures");
  }

  const heights = new Float32Array(size * size);

  // ---- tileable value noise ---------------------------------------------
  // Hashed on a lattice that WRAPS at `period`, so as long as every period
  // divides `size` the whole field tiles exactly. That constraint is what lets a
  // domain warp be used at all here: a warp built from non-wrapping noise fixes
  // the stripe and introduces a seam, which is the same bug wearing a hat.
  const hash = (ix: number, iy: number, period: number) => {
    const wx = ((ix % period) + period) % period;
    const wy = ((iy % period) + period) % period;
    let h = Math.imul(wx, 374761393) + Math.imul(wy, 668265263) + Math.imul(period, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const noiseAt = (x: number, y: number, period: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const top = hash(ix, iy, period) + (hash(ix + 1, iy, period) - hash(ix, iy, period)) * ux;
    const bottom =
      hash(ix, iy + 1, period) + (hash(ix + 1, iy + 1, period) - hash(ix, iy + 1, period)) * ux;
    return top + (bottom - top) * uy;
  };
  /** Three octaves at `cells`, 2x and 4x — all powers of two, all dividing size. */
  const fbm = (x: number, y: number, cells: number) => {
    const u = x / size;
    const v = y / size;
    return (
      noiseAt(u * cells, v * cells, cells) * 0.55 +
      noiseAt(u * cells * 2, v * cells * 2, cells * 2) * 0.3 +
      noiseAt(u * cells * 4, v * cells * 4, cells * 4) * 0.15
    );
  };

  // Snapped to INTEGER wave numbers so the ripple wraps in both axes. The old
  // code claimed integer frequencies while projecting onto an arbitrary
  // direction, which is only integer when the wind happens to be axis-aligned.
  const rippleWaves = 9;
  const waveX = Math.round(rippleWaves * Math.cos(windDirectionRadians));
  const waveY = Math.round(rippleWaves * Math.sin(windDirectionRadians));

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // THE domain warp. A sum of sines along one direction is a stripe — no
      // amount of amplitude tuning makes it sand. Displacing the ripple's PHASE
      // by a low-frequency noise is what turns parallel lines into the wandering,
      // branching, occasionally-interrupted ripple field a real seabed has. The
      // water's normal map got this fix; the sand never did, and the hard
      // diagonal corduroy across every underwater frame was the result.
      const warp = fbm(x, y, 8) * 7;
      const along = ((x * waveX + y * waveY) / size) * Math.PI * 2;
      const ripple = 0.5 + 0.5 * Math.sin(along + warp);
      // Grain OUTWEIGHS ripple, 0.55 to 0.45. The previous balance was the other
      // way round by a factor of about two and a half, which is the other half of
      // why the ripple read as the subject rather than as texture.
      const grain = fbm(x, y, 64);
      heights[y * size + x] = grain * 0.55 + ripple * 0.45;
    }
  }

  const albedoImage = albedoContext.createImageData(size, size);
  const normalImage = normalContext.createImageData(size, size);
  const at = (x: number, y: number) => heights[((y + size) % size) * size + ((x + size) % size)] ?? 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const h = at(x, y);
      const offset = (y * size + x) * 4;
      const shade = 104 + h * 74;
      albedoImage.data[offset] = shade * 1.06;
      albedoImage.data[offset + 1] = shade * 0.98;
      albedoImage.data[offset + 2] = shade * 0.82;
      albedoImage.data[offset + 3] = 255;

      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      // 3.4, matching the prototype. 0.8 was tuned against the old height field,
      // whose ripple swung over twice as far; against the new 0..1 field it
      // flattened the relief to almost nothing and left the sand shading as a
      // painted gradient rather than a surface with grain in it.
      const nx = -dx * 3.4;
      const ny = -dy * 3.4;
      const inverse = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      normalImage.data[offset] = (nx * inverse * 0.5 + 0.5) * 255;
      normalImage.data[offset + 1] = (ny * inverse * 0.5 + 0.5) * 255;
      normalImage.data[offset + 2] = (inverse * 0.5 + 0.5) * 255;
      normalImage.data[offset + 3] = 255;
    }
  }
  albedoContext.putImageData(albedoImage, 0, 0);
  normalContext.putImageData(normalImage, 0, 0);

  const map = new CanvasTexture(albedo);
  const normalMap = new CanvasTexture(normal);
  for (const texture of [map, normalMap]) {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    // At a grazing angle a tiled ground texture is a blur without this, and the
    // seabed is seen at a grazing angle in every frame that contains it.
    texture.anisotropy = anisotropy;
  }
  return { map, normalMap };
}

export type SeabedOptions = {
  extent: number;
  segments: number;
  windDirectionRadians: number;
  seed: string;
  renderer: WebGLRenderer;
  /**
   * How far out the camera orbits. Boulders are kept beyond it.
   *
   * The bands used to be fixed at 5-34 m and 34-115 m, copied from the
   * prototype, and the camera orbits at 16-24 m — so the inner band straddled
   * the viewer's own position. With 150 instances in that annulus, sooner or
   * later one of them stands where the lens is, and a three-metre boulder two
   * metres from a lamp is not a rock: it is a pale faceted slab across half the
   * frame with no readable scale. It was reported as a "strange object", and the
   * landmark ring had the identical defect for the identical reason.
   *
   * The prototype gets away with the fixed bands because it orbits at 30 m, at
   * the outer edge; copying its numbers without its radius is what moved the
   * problem inside the frame.
   */
  cameraDistanceMetres: number;
};

export type Seabed = {
  group: Group;
  floorMaterial: MeshStandardMaterial;
  rockMaterials: MeshStandardMaterial[];
  causticUniforms: CausticUniforms;
  heightAt: (x: number, z: number) => number;
  dispose: () => void;
};

export function createSeabed(options: SeabedOptions): Seabed {
  const { extent, segments, windDirectionRadians, seed, renderer, cameraDistanceMetres } = options;
  const group = new Group();
  const causticUniforms = createCausticUniforms();
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const sand = createSandTextures(512, windDirectionRadians, anisotropy);
  sand.map.repeat.set(extent / 6, extent / 6);
  sand.normalMap.repeat.copy(sand.map.repeat);

  const noise = randomFromSeed(`${seed}:seabed-relief`);
  const relief: number[] = [];
  for (let i = 0; i < 64; i += 1) relief.push(noise());
  const lattice = (ix: number, iy: number) => relief[(Math.abs(ix * 7 + iy * 13) % 64 + 64) % 64] ?? 0.5;
  const valueNoise = (x: number, z: number) => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = lattice(ix, iz);
    const b = lattice(ix + 1, iz);
    const c = lattice(ix, iz + 1);
    const d = lattice(ix + 1, iz + 1);
    return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz;
  };
  const heightAt = (x: number, z: number) => {
    const broad = (valueNoise(x * 0.011, z * 0.011) - 0.5) * 11;
    const dune = (valueNoise(x * 0.055 + 31, z * 0.055 - 12) - 0.5) * 2.4;
    const ripple = Math.sin((x * Math.cos(windDirectionRadians) + z * Math.sin(windDirectionRadians)) * 0.55) * 0.16;
    return broad + dune + ripple;
  };

  const floorMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    map: sand.map,
    normalMap: sand.normalMap,
    normalScale: new Vector2(1.1, 1.1),
    roughness: 1,
    metalness: 0,
  });
  applyCaustics(floorMaterial, causticUniforms);

  const floorGeometry = new PlaneGeometry(extent, extent, segments, segments);
  floorGeometry.rotateX(-Math.PI / 2);
  const floorPositions = floorGeometry.getAttribute("position");
  for (let i = 0; i < floorPositions.count; i += 1) {
    floorPositions.setY(i, heightAt(floorPositions.getX(i), floorPositions.getZ(i)));
  }
  floorPositions.needsUpdate = true;
  floorGeometry.computeVertexNormals();
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.receiveShadow = true;
  group.add(floor);

  const rockMaterials: MeshStandardMaterial[] = [];
  const disposables: { dispose: () => void }[] = [floorGeometry, floorMaterial, sand.map, sand.normalMap];

  const addBoulders = (count: number, band: string, inner: number, outer: number) => {
    const base = new IcosahedronGeometry(1, 1);
    const positions = base.getAttribute("position");
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      // Displaced per vertex, because eight hundred undisplaced instances are
      // eight hundred balls.
      const lumpy = 0.62 + valueNoise(x * 1.7 + 11, z * 1.7 - 4) * 0.9 + valueNoise(y * 2.3, x * 2.3) * 0.24;
      positions.setXYZ(i, x * lumpy, y * lumpy * 0.74, z * lumpy);
    }
    positions.needsUpdate = true;
    base.computeVertexNormals();

    const material = new MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0,
      map: sand.map,
      normalMap: sand.normalMap,
      normalScale: new Vector2(1.4, 1.4),
    });
    applyCaustics(material, causticUniforms);
    rockMaterials.push(material);

    const mesh = new InstancedMesh(base, material, count);
    const next = randomFromSeed(`${seed}:${band}`);
    const matrix = new Matrix4();
    const quaternion = new Quaternion();
    const euler = new Euler();
    const scale = new Vector3();
    const spot = new Vector3();
    for (let i = 0; i < count; i += 1) {
      const angle = next() * Math.PI * 2;
      const radius = inner + Math.pow(next(), 0.7) * (outer - inner);
      const size = 0.35 + Math.pow(next(), 2.2) * 3.4;
      spot.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      // Sunk a little, the way a rock that has been there ten thousand years
      // sits in sediment.
      spot.y = heightAt(spot.x, spot.z) + size * 0.34;
      euler.set(next() * 3.14, next() * 6.28, next() * 3.14);
      quaternion.setFromEuler(euler);
      scale.set(size * (0.8 + next() * 0.5), size * (0.55 + next() * 0.4), size * (0.8 + next() * 0.5));
      matrix.compose(spot, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    disposables.push(base, material);
  };

  // Both bands pushed out past the orbit, keeping the prototype's WIDTHS — 29 m
  // of near field and 81 m of mid — so the density and the recession are
  // unchanged and only the standing room moves.
  const nearInner = cameraDistanceMetres + BOULDER_CAMERA_STANDOFF_METRES;
  addBoulders(150, "boulders-near", nearInner, nearInner + 29);
  addBoulders(260, "boulders-mid", nearInner + 29, nearInner + 110);

  return {
    group,
    floorMaterial,
    rockMaterials,
    causticUniforms,
    heightAt,
    dispose: () => {
      for (const item of disposables) item.dispose();
    },
  };
}

/**
 * Tint the floor and the rock for the water they are under.
 *
 * Both take MORE of the water's colour the less sun there is, and both are held
 * below the water's own value. A seabed brighter than the water above it is the
 * single fastest way to make a frame read as a swimming pool.
 */
export function tintSeabed(
  seabed: Seabed,
  fog: Color,
  brightness: number,
  causticStrength: number,
  keyColor: Color,
): void {
  seabed.floorMaterial.color
    .copy(SAND_ALBEDO)
    .lerp(fog, 0.4 + (1 - brightness) * 0.45)
    .multiplyScalar(0.72 + brightness * 0.2);
  for (const material of seabed.rockMaterials) {
    material.color
      .copy(ROCK_ALBEDO)
      .lerp(fog, 0.34 + (1 - brightness) * 0.4)
      .multiplyScalar(0.62 + brightness * 0.22);
  }
  seabed.causticUniforms.uCausticStrength.value = causticStrength * 0.185;
  seabed.causticUniforms.uCausticColor.value.copy(keyColor).lerp(new Color("#CFF6FF"), 0.5);
}

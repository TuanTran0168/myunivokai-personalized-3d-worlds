/**
 * The water surface seen FROM ABOVE.
 *
 * The rig already draws this same sheet of water from below, where the physics
 * that matters is Snell's window and total internal reflection. From above the
 * physics that matters is the opposite one — Fresnel reflection of the sky —
 * and no single shader does both well. So there are two materials for one
 * surface, and the rig turns exactly one of them on. They are never both
 * visible, so they can never fight over the depth buffer.
 *
 * The technique is the one in three.js's own `Water.js` (examples/jsm/objects),
 * which is the shader behind `webgl_shaders_ocean` and behind most of the water
 * people link to: a tiling normal map sampled FOUR times at four scales and
 * four scroll speeds, summed, and used as the surface normal. That is the whole
 * trick, and it is why the reference holds up from a metre away and from a
 * kilometre away for almost no cost — the plane itself never moves.
 *
 * Two deliberate departures from Water.js, both explained where they happen:
 *
 *   - It reflects a real render target through an oblique-frustum mirror
 *     camera. We reflect the ANALYTIC Preetham sky instead. That is exact for
 *     an empty horizon and wrong for anything standing in the water, and it
 *     costs one shader instead of a second full scene render per frame.
 *   - It has no foam. Whitecaps are most of what makes a sea read as a sea, and
 *     here they come from the Gerstner Jacobian rather than from a paint layer.
 *
 * See agent-system/evolution/ocean-visual-direction-research.md §11d.
 */
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  RepeatWrapping,
  ShaderMaterial,
  type Texture,
  type WebGLRenderer,
} from "three";
import { foamFoldThreshold } from "./oceanSeaState";
import { oceanSeaTopMaterial, seaTopUniformValues, type SeaTopUniformValues } from "./oceanSeaTopMaterial";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";
import type { SkyUniformNodes, WaveUniformNodes } from "./oceanSky";
import { maximumTextureAnisotropy } from "@/features/scene-renderers/shared/textureAnisotropy";

// Declared with the material that paints them. Re-exported here because this
// is where every existing caller looks for them.
export { FOAM_WHITE, SKY_HAZE } from "./oceanSeaTopMaterial";

/**
 * A tileable normal map for the capillary ripple.
 *
 * Only INTEGER frequencies, so the map wraps seamlessly — the four scrolling
 * lookups magnify any seam four times over, and a seam in water reads instantly
 * as a grid rather than as a sea.
 *
 * The domain warp is not decoration. A plain sum of plane waves is always
 * quasi-periodic and lays a visible cross-hatch lattice across the whole
 * surface; warping the domain with a tileable value-noise field breaks it. It
 * is the same failure the caustics had, and the same fix.
 */
export function createWaterNormalTexture(renderer: WebGLRenderer): Texture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas unavailable for the water normal map");
  const image = context.createImageData(size, size);

  // Ten octaves rather than seven: the finest scale here is what the sun breaks
  // into separate sparkles on, and below 512 the highest octave is one texel.
  const waves: [number, number, number][] = [
    [1, 2, 1.0],
    [2, -1, 0.74],
    [3, 3, 0.46],
    [5, -2, 0.29],
    [7, 4, 0.17],
    [11, -8, 0.1],
    [17, 13, 0.05],
    [23, -19, 0.032],
    [31, 27, 0.021],
    [43, -37, 0.013],
  ];

  const lattice = (ix: number, iy: number, period: number) => {
    const px = ((ix % period) + period) % period;
    const py = ((iy % period) + period) % period;
    const s = Math.sin(px * 127.1 + py * 311.7 + period * 7.13) * 43758.5453123;
    return s - Math.floor(s);
  };
  const warpNoise = (fx: number, fy: number, period: number) => {
    const x = fx * period;
    const y = fy * period;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const tx = x - ix;
    const ty = y - iy;
    const ux = tx * tx * (3 - 2 * tx);
    const uy = ty * ty * (3 - 2 * ty);
    const a = lattice(ix, iy, period);
    const b = lattice(ix + 1, iy, period);
    const c = lattice(ix, iy + 1, period);
    const d = lattice(ix + 1, iy + 1, period);
    return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
  };

  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const fx = x / size;
      const fy = y / size;
      const warpX =
        (warpNoise(fx, fy, 3) - 0.5) * 0.55 + (warpNoise(fx + 0.37, fy, 7) - 0.5) * 0.22;
      const warpY =
        (warpNoise(fx, fy + 0.19, 3) - 0.5) * 0.55 + (warpNoise(fx, fy + 0.61, 7) - 0.5) * 0.22;
      let h = 0;
      for (let i = 0; i < waves.length; i += 1) {
        const wave = waves[i];
        h +=
          Math.sin(
            (fx + warpX) * wave[0] * Math.PI * 2 + (fy + warpY) * wave[1] * Math.PI * 2 + i * 1.7,
          ) * wave[2];
      }
      height[y * size + x] = h;
    }
  }

  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      const nx = -dx * 0.62;
      const ny = -dy * 0.62;
      const inverse = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (y * size + x) * 4;
      image.data[o] = (nx * inverse * 0.5 + 0.5) * 255;
      image.data[o + 1] = (ny * inverse * 0.5 + 0.5) * 255;
      image.data[o + 2] = (inverse * 0.5 + 0.5) * 255;
      image.data[o + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = maximumTextureAnisotropy(renderer);
  return texture;
}

/**
 * A polar grid, not a plane.
 *
 * A flat 6 km plane at 200 segments puts 30 m between vertices, and at a 53 m
 * peak wavelength that aliases the swell into a shimmer. What matters is
 * angular size from the camera, and for a plane seen at a grazing angle that
 * means rings whose spacing grows GEOMETRICALLY with distance: metres near the
 * viewer, hundreds at the horizon, for the same vertex budget. This is the
 * cheap cousin of a projected grid.
 */
export function createSeaGrid(
  rings: number,
  sectors: number,
  innerRadius: number,
  outerRadius: number,
): BufferGeometry {
  const geometry = new BufferGeometry();
  const vertices: number[] = [0, 0, 0];
  const growth = Math.pow(outerRadius / innerRadius, 1 / (rings - 1));
  for (let ring = 0; ring < rings; ring += 1) {
    const radius = innerRadius * Math.pow(growth, ring);
    for (let sector = 0; sector < sectors; sector += 1) {
      const angle = (sector / sectors) * Math.PI * 2;
      vertices.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    }
  }
  const indices: number[] = [];
  for (let sector = 0; sector < sectors; sector += 1) {
    indices.push(0, 1 + sector, 1 + ((sector + 1) % sectors));
  }
  for (let ring = 0; ring < rings - 1; ring += 1) {
    const inner = 1 + ring * sectors;
    const outer = inner + sectors;
    for (let sector = 0; sector < sectors; sector += 1) {
      const nextSector = (sector + 1) % sectors;
      indices.push(inner + sector, outer + sector, outer + nextSector);
      indices.push(inner + sector, outer + nextSector, inner + nextSector);
    }
  }
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  return geometry;
}

export type SeaTopUniforms = SeaTopUniformValues;

export type SeaTop = {
  mesh: Mesh;
  uniforms: SeaTopUniforms;
  /**
   * Advances the node path's own clock, which is a separate uniform from the
   * classic one. A no-op on the classic path, and a sea that never advances it
   * is a still sea rather than a blank frame.
   */
  synchronise: () => void;
  dispose: () => void;
};

export type SeaTopOptions = {
  renderer: WebGLRenderer;
  waveMax: number;
  /** Uniforms shared with every other caller of the Preetham sky. */
  skyShared: Record<string, { value: unknown }>;
  /** Uniforms shared with every other caller of the Gerstner surface. */
  waveShared: Record<string, { value: unknown }>;
  /** Monahan's whitecap coverage, 0..1, mapped onto the fold threshold. */
  whitecapFraction: number;
  quality: "high" | "low";
  /** The node twins of the two shared sets. Null on the classic path. */
  skyNodes: SkyUniformNodes | null;
  waveNodes: WaveUniformNodes | null;
  nodeModules: NodeMaterialModules | null;
};

export function createSeaTop(options: SeaTopOptions): SeaTop {
  const { renderer, waveMax, skyShared, waveShared, whitecapFraction, quality, skyNodes, waveNodes, nodeModules } =
    options;
  const high = quality === "high";
  const normals = createWaterNormalTexture(renderer);

  const uniformValues = seaTopUniformValues(normals, foamFoldThreshold(whitecapFraction));
  // The classic path binds one flat record: this material's own uniforms plus
  // the two shared sets every other caller of the sky and the wave field binds.
  const uniforms = { ...uniformValues, ...skyShared, ...waveShared };

  const geometry = createSeaGrid(high ? 300 : 140, high ? 256 : 128, 1.1, 5600);
  const { material, synchronise } = oceanSeaTopMaterial(
    uniformValues,
    uniforms,
    waveMax,
    skyNodes,
    waveNodes,
    nodeModules
  );

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    uniforms: uniformValues,
    synchronise,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      normals.dispose();
    },
  };
}

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
 * See notes/fe/ocean-visual-direction-research.md §11d.
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
import {
  GERSTNER_SURFACE_GLSL,
  PREETHAM_SKY_GLSL,
  SKY_UNIFORMS_GLSL,
  WAVE_UNIFORMS_GLSL,
} from "./oceanSky";

/** The sky's own colours, used where a constant is honest. */
export const SKY_HAZE = "#9BBBD2";
export const FOAM_WHITE = "#EAF6FF";

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
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
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

export type SeaTopUniforms = {
  uTime: { value: number };
  uSize: { value: number };
  uFoam: { value: number };
  uFoamEdge: { value: number };
  uDetail: { value: number };
  uExposure: { value: number };
  uSunColor: { value: Color };
  uWaterColor: { value: Color };
  uDeepColor: { value: Color };
  uHorizonColor: { value: Color };
  uFoamColor: { value: Color };
  [key: string]: { value: unknown };
};

export type SeaTop = {
  mesh: Mesh;
  uniforms: SeaTopUniforms;
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
};

export function createSeaTop(options: SeaTopOptions): SeaTop {
  const { renderer, waveMax, skyShared, waveShared, whitecapFraction, quality } = options;
  const high = quality === "high";
  const normals = createWaterNormalTexture(renderer);

  const uniforms = {
    uTime: { value: 0 },
    uNormals: { value: normals },
    // 103 m is Water.js's own largest lookup period; dividing the world by this
    // brings the whole cascade down to a scale a viewer six metres up can
    // actually resolve. At 1.0 the sea is smooth streaks.
    uSize: { value: 5.0 },
    uFoam: { value: 1.0 },
    // Where the surface Jacobian has to fall before the water counts as broken.
    // The mapping is a fit; the number going into it is measured, and that is
    // the difference between a sea state and a foam slider.
    uFoamEdge: { value: 0.15 + 0.8 * Math.sqrt(Math.min(1, whitecapFraction / 0.04)) },
    // The capillary ripple's weight against the Gerstner normal. Measured: at
    // 0.55 the sea's local contrast fell 40% against a normal-map-only surface,
    // because a physically correct Beaufort 4 sea is genuinely smooth and all
    // of the sparkle lives in the scale below the vertices.
    uDetail: { value: 1.25 },
    uExposure: { value: 1.0 },
    uSunColor: { value: new Color("#FFF1D2") },
    uWaterColor: { value: new Color("#0A6E9A") },
    uDeepColor: { value: new Color("#031B27") },
    uHorizonColor: { value: new Color(SKY_HAZE) },
    uFoamColor: { value: new Color(FOAM_WHITE) },
    ...skyShared,
    ...waveShared,
  };

  const geometry = createSeaGrid(high ? 300 : 140, high ? 256 : 128, 1.1, 5600);
  const material = new ShaderMaterial({
    uniforms,
    side: DoubleSide,
    fog: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      ${WAVE_UNIFORMS_GLSL(waveMax)}
      varying vec3 vWorld; varying vec3 vWaveNormal; varying float vFold;
      ${GERSTNER_SURFACE_GLSL(waveMax)}
      void main(){
        vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 offset; vec3 waveNormal; float fold;
        oceanSurface(world.xz, offset, waveNormal, fold);
        world += offset;
        vWorld = world;
        vWaveNormal = waveNormal;
        vFold = fold;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNormals;
      uniform float uTime; uniform float uSize; uniform float uFoam;
      uniform float uFoamEdge; uniform float uDetail; uniform float uExposure;
      uniform vec3 uSunColor;
      uniform vec3 uWaterColor; uniform vec3 uDeepColor;
      uniform vec3 uHorizonColor; uniform vec3 uFoamColor;
      ${SKY_UNIFORMS_GLSL}
      varying vec3 vWorld; varying vec3 vWaveNormal; varying float vFold;
      ${PREETHAM_SKY_GLSL}

      // Verbatim from three.js Water.js, constants included. The four divisors
      // (103, 107, 8907/9803, 1091/1027) and the four scroll rates are the whole
      // reason it does not look like a tiled texture: the periods are mutually
      // prime enough that the sum never repeats inside a frame.
      vec4 getNoise(vec2 uv){
        vec2 uv0 = (uv / 103.0) + vec2(uTime / 17.0, uTime / 29.0);
        vec2 uv1 = uv / 107.0 - vec2(uTime / -19.0, uTime / 31.0);
        vec2 uv2 = uv / vec2(8907.0, 9803.0) + vec2(uTime / 101.0, uTime / 97.0);
        vec2 uv3 = uv / vec2(1091.0, 1027.0) - vec2(uTime / 109.0, uTime / -113.0);
        vec4 sampled = texture2D(uNormals, uv0) + texture2D(uNormals, uv1)
                     + texture2D(uNormals, uv2) + texture2D(uNormals, uv3);
        return sampled * 0.5 - 1.0;
      }

      void main(){
        vec4 sampled = getNoise(vWorld.xz * uSize);
        // Two scales of normal, with different jobs. The Gerstner normal is the
        // SHAPE of the sea and it is exact; the texture is the capillary ripple
        // riding on it, which is where the sparkle lives and which no vertex
        // budget could ever resolve.
        vec3 ripple = normalize(sampled.xzy * vec3(1.5, 1.0, 1.5));
        vec3 n = normalize(vWaveNormal + vec3(ripple.x, 0.0, ripple.z) * uDetail);

        vec3 toEye = cameraPosition - vWorld;
        float viewDistance = length(toEye);
        vec3 eyeDirection = normalize(toEye);

        // Water.js's own sunLight(): shiny 100, spec 2, diffuse 0.5. The
        // specular is the glitter path; the diffuse is what stops far water
        // going flat.
        vec3 mirrored = normalize(reflect(-uSkySunDirection, n));
        float alignment = max(0.0, dot(eyeDirection, mirrored));
        vec3 specular = pow(alignment, 100.0) * uSunColor * 2.0;
        vec3 diffuse = max(dot(uSkySunDirection, n), 0.0) * uSunColor * 0.5;

        vec3 skyDirection = normalize(reflect(-eyeDirection, n));
        skyDirection.y = abs(skyDirection.y);
        // The disc is excluded from the REFLECTION and left to the specular
        // term: a mirrored 19000x sun disc through a wave normal is a field of
        // white pixels the size of the tone map's shoulder, not a glitter path.
        vec3 sky = preethamSky(skyDirection, false);

        float theta = max(dot(eyeDirection, n), 0.0);
        // Physical rf0 for water is 0.02. Water.js uses 0.3 to compensate for a
        // dim mirror texture; our sky is analytic and correctly bright, so the
        // honest number works and the grazing horizon stays a mirror.
        float rf0 = 0.02;
        float reflectance = rf0 + (1.0 - rf0) * pow(1.0 - theta, 5.0);
        // Upwelling scatter: the only colour the water body itself has, and
        // strongest looking straight down into it.
        vec3 scatter = mix(uDeepColor, uWaterColor, theta) * (0.34 + theta * 1.15);
        // The whole sky dome lights the water body, not just the sun. Without
        // this the non-reflective half of every wave has one directional source
        // and the sea reads as metal.
        scatter += uHorizonColor * 0.13;

        vec3 color = mix(scatter + diffuse * 0.55, sky + specular, reflectance);

        // Foam where the surface FOLDS. The Jacobian of the Gerstner
        // displacement collapses exactly where a real wave is overtaking
        // itself, which is what breaking IS — so foam appears on the forward
        // face of steep crests and nowhere else, without being told to. The
        // second, uncorrelated lace pattern stops it reading as a stripe
        // painted along the crest line.
        float breaking = smoothstep(uFoamEdge, uFoamEdge - 0.34, vFold);
        float lace = smoothstep(0.02, 0.42, sampled.x);
        color = mix(color, uFoamColor, clamp(breaking * lace * uFoam, 0.0, 0.86));

        // Aerial perspective. In air, distance is haze, not absorption. The
        // haze colour is the sky in THAT direction just above the horizon — so
        // the sea does not fade toward one average colour, it fades toward
        // whatever the sky actually is behind it, and the horizon dissolves
        // even when the sun is low and the two sides of the sky disagree.
        vec3 hazeDirection = normalize(vec3(-eyeDirection.x, 0.045, -eyeDirection.z));
        float haze = 1.0 - exp(-viewDistance * 0.00030);
        color = mix(color, preethamSky(hazeDirection, false), clamp(haze, 0.0, 1.0));

        gl_FragColor = vec4(color * uExposure, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    uniforms: uniforms as unknown as SeaTopUniforms,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      normals.dispose();
    },
  };
}

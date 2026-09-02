/**
 * What is suspended in the water column: jellyfish, bubble streams, marine snow.
 *
 * # Why these are one module
 *
 * Two of the three depth zones cannot see the seafloor and one cannot see the
 * surface either, so in those worlds nothing standing on anything is in frame.
 * Drifters are the ONLY content those zones can have — and since roughly three
 * quarters of open-ocean animals are bioluminescent, in the dark they are also
 * the only light. A midwater world without them is not a place, it is a coloured
 * rectangle, which is exactly what the app's twilight view rendered as.
 *
 * All three are instanced or point geometry with their motion in the vertex
 * shader, so the whole layer costs one draw call and no per-frame CPU work.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  NormalBlending,
  Points,
  ShaderMaterial,
  SphereGeometry,
} from "three";

type Random = () => number;

/* ========================================================================
   JELLYFISH
   ======================================================================== */

export type JellyfishUniforms = {
  uJellyTime: { value: number };
  uJellyColor: { value: Color };
  uJellyGlow: { value: number };
};

export type Jellyfish = {
  mesh: InstancedMesh;
  uniforms: JellyfishUniforms;
  dispose: () => void;
};

/**
 * A drifting bell layer.
 *
 * The bell contracts and its margin flares — that is propulsion, and it is what
 * separates a jellyfish from a wobbling sphere. Rendered additively and rim-lit
 * only, because a medusa is 95% water: what you see of one is its edge and the
 * light caught under its bell, never a lit surface.
 */
export function createJellyfish(options: {
  count: number;
  random: Random;
  radius: number;
  columnHeight: number;
}): Jellyfish {
  const { count, random, radius, columnHeight } = options;
  // An open hemisphere, not a sphere: a bell has an underside, and cutting the
  // geometry at 0.62π is what lets the shader see it.
  const bell = new SphereGeometry(0.5, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.62);

  const uniforms: JellyfishUniforms = {
    uJellyTime: { value: 0 },
    uJellyColor: { value: new Color("#7FE9FF") },
    uJellyGlow: { value: 0.4 },
  };

  const anchors = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI * 2;
    // sqrt keeps the areal density even; without it every drifter crowds the axis.
    const distance = radius * (0.28 + 0.72 * Math.sqrt(random()));
    anchors[i * 3] = Math.cos(angle) * distance;
    anchors[i * 3 + 1] = 0;
    anchors[i * 3 + 2] = Math.sin(angle) * distance;
    seeds[i] = random() * 10;
  }
  bell.setAttribute("aJellyAnchor", new InstancedBufferAttribute(anchors, 3));
  bell.setAttribute("aJellySeed", new InstancedBufferAttribute(seeds, 1));

  const material = new ShaderMaterial({
    uniforms: { ...uniforms, uJellyColumn: { value: columnHeight } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    vertexShader: /* glsl */ `
      attribute vec3 aJellyAnchor;
      attribute float aJellySeed;
      uniform float uJellyTime;
      uniform float uJellyColumn;
      varying float vRim;
      varying float vUnder;
      void main(){
        float pulse = sin(uJellyTime * 1.15 + aJellySeed * 6.2831853) * 0.5 + 0.5;
        vec3 p = position;
        // Contract and flare: the margin widens as the bell shortens.
        p.xz *= 1.0 + pulse * 0.22;
        p.y *= 1.0 - pulse * 0.30;
        float bellScale = 0.34 + fract(aJellySeed) * 0.62;
        float rise = mod(uJellyTime * 0.08 + aJellySeed, 1.0);
        vec3 world = aJellyAnchor
          + vec3(sin(uJellyTime * 0.11 + aJellySeed * 3.0) * 2.4,
                 rise * uJellyColumn - uJellyColumn * 0.5,
                 cos(uJellyTime * 0.09 + aJellySeed * 2.0) * 2.4)
          + p * bellScale;
        vec4 viewPosition = modelViewMatrix * vec4(world, 1.0);
        vec3 viewNormal = normalize(mat3(modelViewMatrix) * normalize(position));
        vRim = pow(1.0 - abs(dot(viewNormal, normalize(-viewPosition.xyz))), 1.6);
        vUnder = smoothstep(0.4, -0.5, position.y);
        gl_Position = projectionMatrix * viewPosition;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uJellyColor;
      uniform float uJellyGlow;
      varying float vRim;
      varying float vUnder;
      void main(){
        float alpha = (vRim * 0.85 + vUnder * 0.2) * uJellyGlow;
        gl_FragColor = vec4(uJellyColor * (vRim * 1.4 + 0.15), alpha);
        // NO TONE MAPPING, AND NO COLOUR-SPACE ENCODE. Both were added here in a
        // sweep that required every fragment shader in the family to route
        // through the renderer's curve, enforced by a test. The rule was right
        // for opaque surfaces and wrong for this one, because this layer is
        // ADDITIVE: it does not replace what is behind it, it is summed into an
        // already sRGB-encoded framebuffer.
        //
        // sRGB encoding is steep near black — a linear 0.15 encodes to 0.40 —
        // so encoding a small additive contribution inflates it by roughly two
        // and a half times before it is added. Four layers doing that at once is
        // a haze over every underwater frame, and on the god rays it was enough
        // to clip 100% of the visible band to white once the camera started
        // looking along the shafts. The prototype writes raw linear here for
        // exactly this reason and every additive layer in it does the same.
      }`,
  });

  const mesh = new InstancedMesh(bell, material, count);
  const identity = new Matrix4();
  for (let i = 0; i < count; i += 1) mesh.setMatrixAt(i, identity);
  // The motion is entirely in the vertex shader, so the instance matrices never
  // move and the bounding sphere three.js computes from them is meaningless.
  mesh.frustumCulled = false;
  mesh.renderOrder = 2400;

  return {
    mesh,
    uniforms,
    dispose: () => {
      bell.dispose();
      material.dispose();
    },
  };
}

/* ========================================================================
   BUBBLE STREAMS
   ======================================================================== */

export type BubbleUniforms = {
  uBubbleTime: { value: number };
  uBubbleTop: { value: number };
  uBubbleTint: { value: Color };
};

export type Bubbles = {
  mesh: InstancedMesh;
  uniforms: BubbleUniforms;
  dispose: () => void;
};

/**
 * Rising bubbles, from a handful of vents.
 *
 * The vents are the whole design. Bubbles come from somewhere — a seep, a vent,
 * a diver — so **a stream reads as bubbles and a uniform scatter reads as
 * dust**. Nine anchor points, each with its own column, is the difference.
 *
 * Shaded on the rim only: a bubble has no body, and all you ever see of one is
 * the ring where its surface turns away from you.
 */
export function createBubbles(options: {
  count: number;
  random: Random;
  radiusOuter: number;
  ventCount?: number;
}): Bubbles {
  const { count, random, radiusOuter, ventCount = 9 } = options;
  const geometry = new IcosahedronGeometry(1, 1);

  const vents: [number, number][] = [];
  for (let i = 0; i < ventCount; i += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * radiusOuter;
    vents.push([Math.cos(angle) * distance, Math.sin(angle) * distance]);
  }

  const anchors = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const vent = vents[Math.floor(random() * vents.length) % vents.length];
    anchors[i * 3] = vent[0] + (random() - 0.5) * 0.7;
    // Held in 0..1 and multiplied by the column height in the shader, so the
    // stream can be re-scaled per world without rebuilding the buffer.
    anchors[i * 3 + 1] = random();
    anchors[i * 3 + 2] = vent[1] + (random() - 0.5) * 0.7;
    seeds[i] = random() * 100;
  }
  geometry.setAttribute("aBubbleAnchor", new InstancedBufferAttribute(anchors, 3));
  geometry.setAttribute("aBubbleSeed", new InstancedBufferAttribute(seeds, 1));

  const uniforms: BubbleUniforms = {
    uBubbleTime: { value: 0 },
    uBubbleTop: { value: 40 },
    uBubbleTint: { value: new Color("#DCF6FF") },
  };

  const material = new ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    vertexShader: /* glsl */ `
      attribute vec3 aBubbleAnchor;
      attribute float aBubbleSeed;
      uniform float uBubbleTime;
      uniform float uBubbleTop;
      varying float vRim;
      varying float vFade;
      void main(){
        float span = uBubbleTop;
        float rise = mod(uBubbleTime * 0.42 + aBubbleAnchor.y * span + aBubbleSeed, span);
        float climb = rise / span;
        // A bubble expands as it rises: less pressure above it.
        float grow = 1.0 + climb * 1.5;
        float bubbleRadius = (0.035 + fract(aBubbleSeed) * 0.075) * grow;
        vec3 wobble = vec3(
          sin(rise * 1.7 + aBubbleSeed * 6.0) * 0.22 * grow, 0.0,
          cos(rise * 1.5 + aBubbleSeed * 4.0) * 0.22 * grow);
        vec3 world = vec3(aBubbleAnchor.x, rise, aBubbleAnchor.z) + wobble + position * bubbleRadius;
        vec4 viewPosition = modelViewMatrix * vec4(world, 1.0);
        vec3 viewNormal = normalize(mat3(modelViewMatrix) * position);
        vRim = pow(1.0 - abs(dot(viewNormal, normalize(-viewPosition.xyz))), 2.2);
        // Fade in at the vent and out at the top, so nothing pops.
        vFade = smoothstep(1.0, 0.86, climb) * smoothstep(0.0, 0.04, climb);
        gl_Position = projectionMatrix * viewPosition;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBubbleTint;
      varying float vRim;
      varying float vFade;
      void main(){
        gl_FragColor = vec4(uBubbleTint * vRim * 1.5, vRim * vFade * 0.85);
        // Additive — see the jellyfish shader above for why nothing is encoded.
      }`,
  });

  const mesh = new InstancedMesh(geometry, material, count);
  const identity = new Matrix4();
  for (let i = 0; i < count; i += 1) mesh.setMatrixAt(i, identity);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2500;

  return {
    mesh,
    uniforms,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

/* ========================================================================
   MARINE SNOW
   ======================================================================== */

export type MoteUniforms = {
  uMoteTime: { value: number };
  uFogColor: { value: Color };
  uFogDensity: { value: number };
  uMoteOpacity: { value: number };
};

export type MoteLayer = {
  points: Points;
  uniforms: MoteUniforms;
  /** Bioluminescent layers flicker and blend additively; snow does neither. */
  living: boolean;
  dispose: () => void;
};

type MoteLayerSpec = {
  key: string;
  count: number;
  radius: number;
  height: number;
  size: number;
  color: string;
  opacity: number;
  fall: number;
  living?: boolean;
};

/**
 * The four layers, and why it is four rather than one.
 *
 * A single mote layer at one radius, one size and one fall rate is a uniform
 * haze — it reads as a dirty lens rather than as a medium with depth. Parallax
 * needs particles at genuinely different distances, and the layer that does most
 * of the work of putting the camera INSIDE the water is the near one: 130 large
 * soft motes at 14 m, the ones that drift past close enough to be individuals.
 *
 * The fourth is not snow at all. It is bioluminescence: fewer, brighter,
 * flickering, additive, and cyan — and below the photic zone it is the only
 * light being made anywhere in frame.
 */
const MOTE_LAYERS: readonly MoteLayerSpec[] = [
  { key: "snow-far", count: 2900, radius: 120, height: 70, size: 0.9, color: "#D8ECEF", opacity: 0.3, fall: 0.3 },
  { key: "snow-mid", count: 1200, radius: 46, height: 48, size: 2.4, color: "#E6F4F6", opacity: 0.26, fall: 0.24 },
  { key: "snow-near", count: 130, radius: 14, height: 26, size: 4.6, color: "#EAF7F9", opacity: 0.07, fall: 0.16 },
  { key: "biolum", count: 900, radius: 80, height: 60, size: 2.6, color: "#5CF2E0", opacity: 0.95, fall: 0.05, living: true },
];

function createMoteLayer(spec: MoteLayerSpec, random: Random, quality: "high" | "low"): MoteLayer {
  // The low tier thins every layer rather than dropping one: losing the near
  // layer costs the medium cue that matters most, and losing the far one flattens
  // the depth. Keeping all four at a third of the count keeps the structure.
  const count = quality === "high" ? spec.count : Math.max(24, Math.round(spec.count / 3));

  const geometry = new BufferGeometry();
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * spec.radius;
    positions[i * 3] = Math.cos(angle) * distance;
    positions[i * 3 + 1] = (random() - 0.5) * spec.height * 2;
    positions[i * 3 + 2] = Math.sin(angle) * distance;
    seeds[i] = random();
  }
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aMoteSeed", new Float32BufferAttribute(seeds, 1));

  const uniforms: MoteUniforms = {
    uMoteTime: { value: 0 },
    uFogColor: { value: new Color("#0A2438") },
    uFogDensity: { value: 0.02 },
    uMoteOpacity: { value: spec.opacity },
  };

  const material = new ShaderMaterial({
    uniforms: {
      ...uniforms,
      uMoteColor: { value: new Color(spec.color) },
      uMoteSize: { value: spec.size },
      uMoteFall: { value: spec.fall },
      uMoteSpan: { value: spec.height * 2 },
      uMoteFlicker: { value: spec.living ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
    // Snow blends NORMALLY; only the living layer is additive.
    //
    // Marine snow is mineral and organic debris — it REFLECTS the light already
    // in the water, it does not make any. Blending 4200 flakes additively adds
    // real light to every frame, and in the abyss, where the water itself is at
    // 0.13, that is most of the frame's brightness. Bioluminescence is the
    // opposite: it is emitted, so it is additive by definition.
    blending: spec.living ? AdditiveBlending : NormalBlending,
    fog: false,
    vertexShader: /* glsl */ `
      attribute float aMoteSeed;
      uniform float uMoteTime;
      uniform float uMoteSize;
      uniform float uMoteFall;
      uniform float uMoteSpan;
      uniform float uMoteFlicker;
      varying float vFogFactor;
      varying float vFlicker;
      void main(){
        vec3 p = position;
        // Marine snow falls. Slowly, and never in step: the seed offsets both the
        // rate and the phase, so no two motes share a cycle.
        p.y -= mod(uMoteTime * uMoteFall * (0.6 + aMoteSeed * 0.8) + aMoteSeed * uMoteSpan, uMoteSpan)
             - uMoteSpan * 0.5;
        p.x += sin(uMoteTime * 0.2 + aMoteSeed * 6.2831853) * 0.4;
        vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
        float viewDistance = -viewPosition.z;
        vFogFactor = 1.0 - exp(-pow(max(0.0, viewDistance) * 0.02, 2.0));
        // Living light pulses; a mineral flake does not.
        vFlicker = mix(1.0, 0.45 + 0.55 * sin(uMoteTime * (1.4 + aMoteSeed * 3.0) + aMoteSeed * 12.0),
                       uMoteFlicker);
        // 300, not a smaller "safer" number: this is the demo's own constant,
        // and undersizing it is why the motes read as barely-there specks
        // instead of the "single highest-value cheap change" its own comment
        // calls them. The per-seed jitter is an addition on top, not instead.
        gl_PointSize = uMoteSize * (1.0 + aMoteSeed * 0.6) * (300.0 / max(1.0, viewDistance));
        gl_Position = projectionMatrix * viewPosition;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uFogColor;
      uniform vec3 uMoteColor;
      uniform float uMoteOpacity;
      varying float vFogFactor;
      varying float vFlicker;
      void main(){
        vec2 offset = gl_PointCoord - 0.5;
        float radius = length(offset);
        if (radius > 0.5) discard;
        float alpha = pow(1.0 - radius * 2.0, 1.7) * uMoteOpacity * vFlicker;
        gl_FragColor = vec4(mix(uMoteColor, uFogColor, vFogFactor), alpha * (1.0 - vFogFactor * 0.85));
        // Not encoded, on the same grounds as the jellyfish above. The living
        // layer is additive outright; the three marine-snow layers are alpha
        // blended at 0.07 to 0.30 opacity, which is close enough to additive in
        // effect that encoding them lifts the whole water column the same way.
      }`,
  });

  const points = new Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    uniforms,
    living: spec.living === true,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** All four layers, built from one seeded stream so a world is reproducible. */
export function createMoteLayers(options: {
  random: Random;
  quality: "high" | "low";
}): MoteLayer[] {
  return MOTE_LAYERS.map((spec) => createMoteLayer(spec, options.random, options.quality));
}

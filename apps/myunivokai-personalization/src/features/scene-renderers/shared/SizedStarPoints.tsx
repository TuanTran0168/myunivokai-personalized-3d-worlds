"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending } from "three";

/**
 * Star points with a PER-STAR size, color and twinkle phase. three's stock
 * PointsMaterial gives every point in a layer the same size, which is what
 * made the sky read as uniform "confetti"; a real starfield follows a power
 * law — thousands of faint pinpricks and only a handful of bright glows.
 * The fragment shader draws each star as a hot compact core plus a wide
 * faint halo (the way stars bloom in long-exposure photographs) and
 * modulates it with a slow twinkle.
 *
 * Colors are passed as RAW sRGB values and written to the framebuffer
 * unconverted (a raw ShaderMaterial skips three's color-space and
 * tone-mapping chunks), so the authored hex palette is exactly what shows
 * on screen.
 */

const STAR_VERTEX_SHADER = /* glsl */ `
  attribute float starSize;
  attribute vec3 starColor;
  attribute float twinklePhase;
  uniform float uPointScale;
  varying vec3 vStarColor;
  varying float vTwinklePhase;

  void main() {
    vStarColor = starColor;
    vTwinklePhase = twinklePhase;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = starSize * (uPointScale / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// Two-component point-spread function, the way stars actually image: a tight
// gaussian core plus an inverse-square halo (photographed star glow falls off
// ~1/r^2), windowed so the sprite edge vanishes. Bright layers can also mix in
// diffraction spikes — the 4+4-point cross flare aperture edges produce — via
// uSpikeStrength (real photos only show spikes on the very brightest stars).
// Core + halo can sum past 1.0 at the center; the framebuffer clamps per
// channel, so bright star centers wash toward white while their edges keep
// the star's tint — exactly how stars over-expose in photographs.
const STAR_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTimeSeconds;
  uniform float uGlobalOpacity;
  uniform float uSpikeStrength;
  varying vec3 vStarColor;
  varying float vTwinklePhase;

  void main() {
    vec2 offsetFromCenter = gl_PointCoord * 2.0 - 1.0;
    float normalizedDistance = length(offsetFromCenter);
    if (normalizedDistance > 1.0) {
      discard;
    }
    float coreIntensity = exp(-normalizedDistance * normalizedDistance * 16.0);
    float edgeWindow = 1.0 - smoothstep(0.6, 1.0, normalizedDistance);
    float haloIntensity = (0.03 / (normalizedDistance * normalizedDistance + 0.03)) * edgeWindow;
    float spikeIntensity = 0.0;
    if (uSpikeStrength > 0.0) {
      float straightCross = pow(max(0.0, 1.0 - abs(offsetFromCenter.x * offsetFromCenter.y) * 28.0), 10.0);
      vec2 diagonalCoord = vec2(
        offsetFromCenter.x + offsetFromCenter.y,
        offsetFromCenter.x - offsetFromCenter.y
      ) * 0.7071;
      float diagonalCross = pow(max(0.0, 1.0 - abs(diagonalCoord.x * diagonalCoord.y) * 28.0), 10.0);
      spikeIntensity = (straightCross + 0.3 * diagonalCross) * (1.0 - normalizedDistance) * uSpikeStrength;
    }
    float twinkle = 0.85 + 0.15 * sin(uTimeSeconds * 1.4 + vTwinklePhase);
    float intensity = (coreIntensity + 0.6 * haloIntensity + spikeIntensity) * twinkle * uGlobalOpacity;
    if (intensity < 0.008) {
      discard;
    }
    // Alpha stays 1.0: with additive blending the contribution is rgb * alpha,
    // so baking intensity into rgb keeps the falloff linear instead of squared.
    gl_FragColor = vec4(vStarColor * intensity, 1.0);
  }
`;

export type StarLayerAttributes = {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  twinklePhases: Float32Array;
};

type SizedStarPointsProps = {
  stars: StarLayerAttributes;
  globalOpacity?: number;
  /** 0 = plain stars; 1 = full diffraction spikes (hero-star layers only). */
  spikeStrength?: number;
  renderOrder?: number;
  /** Forces the buffer geometry to remount when the star arrays change. */
  geometryKey?: string;
};

const DEFAULT_GLOBAL_OPACITY = 1;
const DEFAULT_SPIKE_STRENGTH = 0;
const DEFAULT_RENDER_ORDER = 0;

/**
 * Parses a #RRGGBB hex color into raw sRGB unit components, bypassing
 * three's Color class on purpose: Color converts hex to the linear working
 * space, but this shader writes colors to the framebuffer unconverted.
 */
export function hexColorToUnitRgb(hexColor: string): [number, number, number] {
  const parsedColor = Number.parseInt(hexColor.slice(1), 16);
  return [
    ((parsedColor >> 16) & 0xff) / 255,
    ((parsedColor >> 8) & 0xff) / 255,
    (parsedColor & 0xff) / 255
  ];
}

export function SizedStarPoints({
  stars,
  globalOpacity = DEFAULT_GLOBAL_OPACITY,
  spikeStrength = DEFAULT_SPIKE_STRENGTH,
  renderOrder = DEFAULT_RENDER_ORDER,
  geometryKey
}: SizedStarPointsProps) {
  // Created once; useFrame keeps the values current without rebuilding the
  // material (a new uniforms object would recompile the shader program).
  const uniforms = useMemo(
    () => ({
      uPointScale: { value: 1 },
      uTimeSeconds: { value: 0 },
      uGlobalOpacity: { value: DEFAULT_GLOBAL_OPACITY },
      uSpikeStrength: { value: DEFAULT_SPIKE_STRENGTH }
    }),
    []
  );

  useFrame((state) => {
    // Matches PointsMaterial's sizeAttenuation convention (half the drawing
    // buffer height), so star sizes stay consistent across window sizes and
    // device pixel ratios.
    uniforms.uPointScale.value = (state.size.height * state.gl.getPixelRatio()) / 2;
    uniforms.uTimeSeconds.value = state.clock.elapsedTime;
    uniforms.uGlobalOpacity.value = globalOpacity;
    uniforms.uSpikeStrength.value = spikeStrength;
  });

  return (
    <points frustumCulled={false} renderOrder={renderOrder}>
      {/* `args` rather than array/itemSize/count as separate props. Under R3F v9
          these are constructor arguments — `new BufferAttribute(array, itemSize)`
          — and `count` is derived from them, so passing the three as props left
          the attribute constructed with no data at all. v8 tolerated it; v9's
          types are what caught it. */}
      <bufferGeometry key={geometryKey}>
        <bufferAttribute attach="attributes-position" args={[stars.positions, 3]} />
        <bufferAttribute attach="attributes-starColor" args={[stars.colors, 3]} />
        <bufferAttribute attach="attributes-starSize" args={[stars.sizes, 1]} />
        <bufferAttribute attach="attributes-twinklePhase" args={[stars.twinklePhases, 1]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={STAR_VERTEX_SHADER}
        fragmentShader={STAR_FRAGMENT_SHADER}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}

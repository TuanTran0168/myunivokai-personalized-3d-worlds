"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import type { Blending } from "three";
import { getNebulaCloudAtlasTexture, NEBULA_CLOUD_ATLAS_VARIANT_COUNT } from "../shared/nebulaCloudTexture";

/**
 * A layer of large, faint, individually-rotated cloud sprites sampling one of
 * the atlas's noise variants. Realistic nebulosity comes from overdraw
 * statistics, not individual sprite quality: MANY sprites at very low alpha
 * fuse into continuous wisps, while high-alpha sprites read as separate
 * "puffs". With additive blending the layer glows (nebula, galactic core);
 * with normal blending and dark colors it darkens what is behind it (the
 * Great Rift's dust).
 */

const CLOUD_VERTEX_SHADER = /* glsl */ `
  attribute float cloudSize;
  attribute vec3 cloudColor;
  attribute float cloudRotation;
  attribute float cloudAlpha;
  attribute float cloudVariant;
  uniform float uPointScale;
  varying vec3 vCloudColor;
  varying float vCloudRotation;
  varying float vCloudAlpha;
  varying float vCloudVariant;

  void main() {
    vCloudColor = cloudColor;
    vCloudRotation = cloudRotation;
    vCloudAlpha = cloudAlpha;
    vCloudVariant = cloudVariant;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = cloudSize * (uPointScale / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// Each sprite samples its atlas tile through a per-cloud rotation, so one
// shared texture never reads as repeated stamps. Rotated corners are clamped
// back into the tile, whose edge is fully transparent by construction.
const CLOUD_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uCloudMap;
  uniform float uAtlasVariantCount;
  uniform float uGlobalOpacity;
  varying vec3 vCloudColor;
  varying float vCloudRotation;
  varying float vCloudAlpha;
  varying float vCloudVariant;

  void main() {
    vec2 centeredCoord = gl_PointCoord - vec2(0.5);
    float rotationCosine = cos(vCloudRotation);
    float rotationSine = sin(vCloudRotation);
    vec2 rotatedCoord = vec2(
      centeredCoord.x * rotationCosine - centeredCoord.y * rotationSine,
      centeredCoord.x * rotationSine + centeredCoord.y * rotationCosine
    ) + vec2(0.5);
    vec2 tileCoord = clamp(rotatedCoord, 0.0, 1.0);
    float atlasU = (tileCoord.x + vCloudVariant) / uAtlasVariantCount;
    float sampledAlpha = texture2D(uCloudMap, vec2(atlasU, tileCoord.y)).a;
    float alpha = sampledAlpha * vCloudAlpha * uGlobalOpacity;
    if (alpha < 0.004) {
      discard;
    }
    gl_FragColor = vec4(vCloudColor, alpha);
  }
`;

export type CloudLayerAttributes = {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  rotations: Float32Array;
  alphas: Float32Array;
  variants: Float32Array;
};

type NebulaCloudPointsProps = {
  clouds: CloudLayerAttributes;
  globalOpacity: number;
  blending: Blending;
  renderOrder?: number;
  /** Forces the buffer geometry to remount when the cloud arrays change. */
  geometryKey?: string;
};

const DEFAULT_RENDER_ORDER = 0;

export function NebulaCloudPoints({
  clouds,
  globalOpacity,
  blending,
  renderOrder = DEFAULT_RENDER_ORDER,
  geometryKey
}: NebulaCloudPointsProps) {
  // Created once; useFrame keeps the values current without rebuilding the
  // material (a new uniforms object would recompile the shader program).
  const uniforms = useMemo(
    () => ({
      uCloudMap: { value: getNebulaCloudAtlasTexture() },
      uAtlasVariantCount: { value: NEBULA_CLOUD_ATLAS_VARIANT_COUNT },
      uPointScale: { value: 1 },
      uGlobalOpacity: { value: 0 }
    }),
    []
  );

  useFrame((state) => {
    // Same sizeAttenuation convention as the star layers, so cloud sizes are
    // stable across window sizes and device pixel ratios.
    uniforms.uPointScale.value = (state.size.height * state.gl.getPixelRatio()) / 2;
    uniforms.uGlobalOpacity.value = globalOpacity;
  });

  return (
    <points frustumCulled={false} renderOrder={renderOrder}>
      <bufferGeometry key={geometryKey}>
        <bufferAttribute attach="attributes-position" args={[clouds.positions, 3]} />
        <bufferAttribute attach="attributes-cloudColor" args={[clouds.colors, 3]} />
        <bufferAttribute attach="attributes-cloudSize" args={[clouds.sizes, 1]} />
        <bufferAttribute attach="attributes-cloudRotation" args={[clouds.rotations, 1]} />
        <bufferAttribute attach="attributes-cloudAlpha" args={[clouds.alphas, 1]} />
        <bufferAttribute attach="attributes-cloudVariant" args={[clouds.variants, 1]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={CLOUD_VERTEX_SHADER}
        fragmentShader={CLOUD_FRAGMENT_SHADER}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={blending}
      />
    </points>
  );
}

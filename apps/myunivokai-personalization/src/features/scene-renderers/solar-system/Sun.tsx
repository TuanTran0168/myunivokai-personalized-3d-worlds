"use client";

import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, Color, TextureLoader } from "three";
import type { Mesh } from "three";
import type { SceneCoreConfig, SceneSunConfig } from "@/lib/types";
import { applyColorTextureQuality } from "../shared/textureQuality";
import { SUN_TEXTURE_URL } from "./planetTextureCatalog";

// Exported so BinarySun scales its companion star from the same core config.
export const DEFAULT_SUN_SCALE = 1.1;
export const SUN_SCALE_MULTIPLIER = 1.45;
const DEFAULT_SUN_SPIN_SPEED = 0.05;
const SUN_LIGHT_INTENSITY = 38;
const SUN_LIGHT_DECAY = 1.6;
const SUN_GLOW_SCALE_MULTIPLIER = 1.22;
const SUN_GLOW_OPACITY = 0.32;

// Defaults double as the exact pre-1.2 star (worlds stored before
// schemaVersion 1.2 carry no sun section — this is the warm G-class look they
// were designed with) and as the per-field fallbacks for invalid values.
const DEFAULT_SUN_SURFACE_TINT_COLOR = "#FFFFFF";
const DEFAULT_SUN_GLOW_COLOR = "#FDB813";
const DEFAULT_SUN_LIGHT_COLOR = "#FFF4D6";
// >1 tint (legal with toneMapped=false) pushes the sun's surface over the
// bloom luminance threshold so it glows while lit planets stay bloom-free.
const DEFAULT_SUN_SURFACE_HDR_MULTIPLIER = 1.5;
// Below 1 the sun would drop under the bloom threshold and stop glowing.
const MINIMUM_SUN_SURFACE_HDR_MULTIPLIER = 1;
const MAXIMUM_SUN_SURFACE_HDR_MULTIPLIER = 3;

const SIX_DIGIT_HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

type ResolvedSunConfig = {
  surfaceTintColor: string;
  glowColor: string;
  lightColor: string;
  surfaceHdrMultiplier: number;
};

function resolveHexColor(value: string | undefined, fallback: string): string {
  return typeof value === "string" && SIX_DIGIT_HEX_COLOR_PATTERN.test(value) ? value : fallback;
}

/**
 * Clamp + fallback resolution of the stored sun section (schemaVersion 1.2).
 * Worlds stored before 1.2 have no sun key and resolve to the pre-1.2
 * constants, so they keep rendering byte-identically.
 */
function resolveSunConfig(sun: SceneSunConfig | undefined): ResolvedSunConfig {
  const surfaceHdrMultiplier =
    typeof sun?.surfaceHdrMultiplier === "number" &&
    Number.isFinite(sun.surfaceHdrMultiplier) &&
    sun.surfaceHdrMultiplier >= MINIMUM_SUN_SURFACE_HDR_MULTIPLIER &&
    sun.surfaceHdrMultiplier <= MAXIMUM_SUN_SURFACE_HDR_MULTIPLIER
      ? sun.surfaceHdrMultiplier
      : DEFAULT_SUN_SURFACE_HDR_MULTIPLIER;
  return {
    surfaceTintColor: resolveHexColor(sun?.surfaceTintColor, DEFAULT_SUN_SURFACE_TINT_COLOR),
    glowColor: resolveHexColor(sun?.glowColor, DEFAULT_SUN_GLOW_COLOR),
    lightColor: resolveHexColor(sun?.lightColor, DEFAULT_SUN_LIGHT_COLOR),
    surfaceHdrMultiplier
  };
}

type SunProps = {
  coreConfig?: SceneCoreConfig;
  /** Stored temperature-class section (schemaVersion 1.2); absent on old worlds. */
  sun?: SceneSunConfig;
};

/**
 * The sun replaces the abstract "core" of the universe. A texture-mapped basic
 * material (not affected by lighting) plus the bloom pass make it glow; the
 * point light at its center is the single light source for the planets.
 */
export function Sun({ coreConfig, sun }: SunProps) {
  const sunMeshReference = useRef<Mesh>(null);
  const gl = useThree((state) => state.gl);
  const sunTexture = useLoader(TextureLoader, SUN_TEXTURE_URL);
  useMemo(() => applyColorTextureQuality(sunTexture, gl), [sunTexture, gl]);
  const resolvedSun = resolveSunConfig(sun);
  // The temperature-class tint scaled into HDR range (>1 with toneMapped=false
  // keeps the surface above the bloom threshold). The white default times 1.5
  // is exactly the pre-1.2 Color(1.5, 1.5, 1.5).
  const surfaceHdrTint = useMemo(
    () => new Color(resolvedSun.surfaceTintColor).multiplyScalar(resolvedSun.surfaceHdrMultiplier),
    [resolvedSun.surfaceTintColor, resolvedSun.surfaceHdrMultiplier]
  );
  const sunScale = (coreConfig?.scale ?? DEFAULT_SUN_SCALE) * SUN_SCALE_MULTIPLIER;
  const sunSpinSpeed = coreConfig?.spinSpeed ?? DEFAULT_SUN_SPIN_SPEED;

  useFrame((_, deltaTimeSeconds) => {
    if (!sunMeshReference.current) {
      return;
    }
    sunMeshReference.current.rotation.y += sunSpinSpeed * deltaTimeSeconds;
  });

  return (
    <group>
      <mesh ref={sunMeshReference} scale={sunScale}>
        <sphereGeometry args={[1, 96, 64]} />
        <meshBasicMaterial map={sunTexture} color={surfaceHdrTint} toneMapped={false} fog={false} />
      </mesh>
      <mesh scale={sunScale * SUN_GLOW_SCALE_MULTIPLIER}>
        <sphereGeometry args={[1, 32, 24]} />
        <meshBasicMaterial
          color={resolvedSun.glowColor}
          transparent
          opacity={SUN_GLOW_OPACITY}
          blending={AdditiveBlending}
          depthWrite={false}
          fog={false}
        />
      </mesh>
      <pointLight intensity={SUN_LIGHT_INTENSITY} decay={SUN_LIGHT_DECAY} color={resolvedSun.lightColor} />
    </group>
  );
}

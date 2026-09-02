"use client";

import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, Color, TextureLoader } from "three";
import type { Group, Mesh } from "three";
import type { SceneCoreConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { applyColorTextureQuality } from "../shared/textureQuality";
import { SUN_TEXTURE_URL } from "./planetTextureCatalog";
import { DEFAULT_SUN_SCALE, SUN_SCALE_MULTIPLIER } from "./Sun";

/**
 * Rare-feature: a red-dwarf companion star orbiting the primary sun inside
 * the first planet orbit. Same construction as Sun.tsx — texture-mapped basic
 * material with an over-1 HDR tint (legal with toneMapped=false) so the bloom
 * pass lights it up — but smaller, hot-orange, and with a much weaker point
 * light so the primary stays the scene's key light.
 */

const COMPANION_SCALE_RATIO = 0.34;
const COMPANION_SPHERE_WIDTH_SEGMENTS = 64;
const COMPANION_SPHERE_HEIGHT_SEGMENTS = 48;
const COMPANION_GLOW_SPHERE_WIDTH_SEGMENTS = 32;
const COMPANION_GLOW_SPHERE_HEIGHT_SEGMENTS = 24;
// Inside the first planet orbit (3.2), outside the primary sun's glow shell.
const COMPANION_ORBIT_RADIUS = 2.4;
const COMPANION_ORBIT_RADIANS_PER_SECOND = 0.16;
const COMPANION_SPIN_SPEED = 0.07;
// Red-dwarf photosphere: the shared sun texture, tinted hot orange with an
// HDR multiplier that keeps it over the bloom luminance threshold.
const COMPANION_SURFACE_TINT_RED = 1.6;
const COMPANION_SURFACE_TINT_GREEN = 0.9;
const COMPANION_SURFACE_TINT_BLUE = 0.55;
const COMPANION_GLOW_SCALE_MULTIPLIER = 1.22;
const COMPANION_GLOW_OPACITY = 0.3;
const COMPANION_GLOW_COLOR = "#FF8956";
// Weak fill compared to the primary's 38: the companion warms nearby planet
// night sides without fighting the key light (bloom cost, second shadow).
const COMPANION_LIGHT_INTENSITY = 10;
const COMPANION_LIGHT_DECAY = 1.6;
const COMPANION_LIGHT_COLOR = "#FFC9A3";

type BinarySunProps = {
  seed: string;
  coreConfig?: SceneCoreConfig;
};

export function BinarySun({ seed, coreConfig }: BinarySunProps) {
  const companionAnchorReference = useRef<Group>(null);
  const companionMeshReference = useRef<Mesh>(null);
  const gl = useThree((state) => state.gl);
  const sunTexture = useLoader(TextureLoader, SUN_TEXTURE_URL);
  useMemo(() => applyColorTextureQuality(sunTexture, gl), [sunTexture, gl]);
  const surfaceHdrTint = useMemo(
    () => new Color(COMPANION_SURFACE_TINT_RED, COMPANION_SURFACE_TINT_GREEN, COMPANION_SURFACE_TINT_BLUE),
    []
  );

  const companionScale = (coreConfig?.scale ?? DEFAULT_SUN_SCALE) * SUN_SCALE_MULTIPLIER * COMPANION_SCALE_RATIO;
  const orbitPhaseRadians = useMemo(() => randomFromSeed(`${seed}-binary-sun`)() * Math.PI * 2, [seed]);

  useFrame(({ clock }, deltaTimeSeconds) => {
    const companionAnchor = companionAnchorReference.current;
    if (companionAnchor) {
      const orbitAngle = orbitPhaseRadians + clock.elapsedTime * COMPANION_ORBIT_RADIANS_PER_SECOND;
      companionAnchor.position.set(
        Math.cos(orbitAngle) * COMPANION_ORBIT_RADIUS,
        0,
        Math.sin(orbitAngle) * COMPANION_ORBIT_RADIUS
      );
    }
    if (companionMeshReference.current) {
      companionMeshReference.current.rotation.y += COMPANION_SPIN_SPEED * deltaTimeSeconds;
    }
  });

  return (
    <group ref={companionAnchorReference}>
      <mesh ref={companionMeshReference} scale={companionScale} raycast={() => null}>
        <sphereGeometry args={[1, COMPANION_SPHERE_WIDTH_SEGMENTS, COMPANION_SPHERE_HEIGHT_SEGMENTS]} />
        <meshBasicMaterial map={sunTexture} color={surfaceHdrTint} toneMapped={false} fog={false} />
      </mesh>
      <mesh scale={companionScale * COMPANION_GLOW_SCALE_MULTIPLIER} raycast={() => null}>
        <sphereGeometry args={[1, COMPANION_GLOW_SPHERE_WIDTH_SEGMENTS, COMPANION_GLOW_SPHERE_HEIGHT_SEGMENTS]} />
        <meshBasicMaterial
          color={COMPANION_GLOW_COLOR}
          transparent
          opacity={COMPANION_GLOW_OPACITY}
          blending={AdditiveBlending}
          depthWrite={false}
          fog={false}
        />
      </mesh>
      <pointLight intensity={COMPANION_LIGHT_INTENSITY} decay={COMPANION_LIGHT_DECAY} color={COMPANION_LIGHT_COLOR} />
    </group>
  );
}

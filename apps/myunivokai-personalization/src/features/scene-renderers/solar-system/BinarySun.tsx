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
 * Rare-feature: a red-dwarf companion star orbiting the primary sun. Same
 * construction as Sun.tsx — texture-mapped basic material with an over-1 HDR
 * tint (legal with toneMapped=false) so the bloom pass lights it up — but
 * smaller, hot-orange, and with a much weaker point light so the primary stays
 * the scene's key light.
 *
 * **THE COMPANION'S ORBIT IS MEASURED IN PRIMARY RADII, NOT IN WORLD UNITS.**
 * It used to be the world-unit constant 2.4, carrying the comment "outside the
 * primary sun's glow shell" — which was true of the sun the feature was built
 * against and false of most of the suns the generator actually draws. The
 * primary's radius is `core.scale * SUN_SCALE_MULTIPLIER` and `core.scale` is
 * seeded over 1.05–1.50 (`world_config_builder.go` and the preview builder use
 * the same range), so the primary's radius runs 1.52–2.18 while the companion's
 * orbit stood still. Above core scale ~1.24 the companion's BODY intersected
 * the primary's, and the two stars rendered as one welded blob — reported from
 * a create-form preview whose primary was at 1.41. A radius expressed in
 * primary radii cannot drift out of clearance, whatever the seed rolls.
 *
 * What this does NOT fix: the companion can still pass in front of the
 * innermost planet. The planets start at orbit radius 3.2 while the primary's
 * surface can reach 2.18, and a companion star does not fit in what is left —
 * the inner system is too tight for this feature at large core scales, and
 * widening it is a generator change on both sides of the contract rather than a
 * renderer change. The inclination below takes the companion out of the
 * planets' plane for most of its orbit, which makes the crossing rarer without
 * pretending to have removed it.
 */

const COMPANION_SCALE_RATIO = 0.34;
const COMPANION_SPHERE_WIDTH_SEGMENTS = 64;
const COMPANION_SPHERE_HEIGHT_SEGMENTS = 48;
const COMPANION_GLOW_SPHERE_WIDTH_SEGMENTS = 32;
const COMPANION_GLOW_SPHERE_HEIGHT_SEGMENTS = 24;
/**
 * In primary-surface radii. 1.5 is the ratio the retired world-unit constant
 * 2.4 had against the default sun (1.1 × 1.45 = 1.595), so a world generated at
 * or near the default core scale keeps the separation it was tuned with.
 */
const COMPANION_ORBIT_RADII_FROM_PRIMARY_SURFACE = 1.5;
const COMPANION_ORBIT_RADIANS_PER_SECOND = 0.16;
const COMPANION_SPIN_SPEED = 0.07;
/**
 * The orbit is tilted out of the planets' plane. Seeded rather than fixed so
 * two binary worlds do not read as the same picture, and drawn AFTER the phase
 * so every world that already rolled this feature keeps the phase it had.
 */
const MINIMUM_COMPANION_ORBIT_INCLINATION_RADIANS = 0.24;
const COMPANION_ORBIT_INCLINATION_RANGE_RADIANS = 0.38;
const COMPANION_SEED_SUFFIX = "-binary-sun";
const FULL_CIRCLE_RADIANS = Math.PI * 2;
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

export type CompanionPlacement = {
  primarySurfaceRadius: number;
  companionSurfaceRadius: number;
  companionOrbitRadius: number;
  /**
   * Gap between the two photospheres at their closest approach. Negative means
   * the two stars render as one blob, which is the defect this file was fixed
   * for; `binarySunGeometry.test.ts` holds it positive across the whole seeded
   * core-scale range.
   */
  surfaceClearance: number;
};

/**
 * Pure placement maths, exported so the clearance invariant can be swept across
 * the seeded core-scale range without mounting a canvas.
 */
export function resolveCompanionPlacement(coreScale: number | undefined): CompanionPlacement {
  const primarySurfaceRadius = (coreScale ?? DEFAULT_SUN_SCALE) * SUN_SCALE_MULTIPLIER;
  const companionSurfaceRadius = primarySurfaceRadius * COMPANION_SCALE_RATIO;
  const companionOrbitRadius = primarySurfaceRadius * COMPANION_ORBIT_RADII_FROM_PRIMARY_SURFACE;
  return {
    primarySurfaceRadius,
    companionSurfaceRadius,
    companionOrbitRadius,
    surfaceClearance: companionOrbitRadius - companionSurfaceRadius - primarySurfaceRadius
  };
}

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

  const placement = resolveCompanionPlacement(coreConfig?.scale);
  const companionScale = placement.companionSurfaceRadius;

  const orbit = useMemo(() => {
    const nextCompanionRandomValue = randomFromSeed(`${seed}${COMPANION_SEED_SUFFIX}`);
    // Fixed draw order: the phase was this stream's only draw before the orbit
    // gained an inclination, so it stays first and no existing world's
    // companion jumps to a different place on its orbit.
    const phaseRadians = nextCompanionRandomValue() * FULL_CIRCLE_RADIANS;
    const inclinationRadians =
      MINIMUM_COMPANION_ORBIT_INCLINATION_RADIANS +
      nextCompanionRandomValue() * COMPANION_ORBIT_INCLINATION_RANGE_RADIANS;
    return { phaseRadians, inclinationRadians };
  }, [seed]);

  useFrame(({ clock }, deltaTimeSeconds) => {
    const companionAnchor = companionAnchorReference.current;
    if (companionAnchor) {
      const orbitAngle = orbit.phaseRadians + clock.elapsedTime * COMPANION_ORBIT_RADIANS_PER_SECOND;
      // A circle of the orbit's radius, in a plane tilted about the X axis.
      companionAnchor.position.set(
        Math.cos(orbitAngle) * placement.companionOrbitRadius,
        Math.sin(orbitAngle) * placement.companionOrbitRadius * Math.sin(orbit.inclinationRadians),
        Math.sin(orbitAngle) * placement.companionOrbitRadius * Math.cos(orbit.inclinationRadians)
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

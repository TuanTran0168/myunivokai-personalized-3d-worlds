"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { IcosahedronGeometry, Vector3, type Group } from "three";
import type { SceneCometsConfig, SceneConfig } from "@/lib/types";
import { planetsFromScene, randomFromSeed } from "@/lib/scene";
import { SizedStarPoints, hexColorToUnitRgb, type StarLayerAttributes } from "../shared/SizedStarPoints";
import { createSeededNoise3d, fractalNoise3d } from "../shared/seededNoise3d";
import { getSoftCircleTexture } from "../shared/softCircleTexture";
import { orbitRadiusForPlanet } from "./SolarPlanet";

/**
 * A seeded comet on an inclined orbit outside the asteroid belt: a dark
 * noise-displaced nucleus, a soft coma sprite, and two particle tails built
 * the way real comets grow them — a curved warm DUST tail and a straight
 * blue ION tail, both pointing away from the sun (the tail group re-orients
 * anti-sunward every frame). Tail particles reuse the star PSF shader, so
 * they twinkle like sunlit dust.
 */

const COMET_ORBIT_GAP_BEYOND_LAST_ORBIT = 3.0;
const COMET_ORBIT_INCLINATION_RADIANS = 0.35;
const COMET_ORBIT_BASE_ROTATION_Z_RADIANS = 0.1;
const COMET_ORBIT_RADIANS_PER_SECOND = 0.02;
const FIRST_PLANET_ORBIT_RADIUS = 3.2;

// Multi-comet worlds (schemaVersion 1.2): each additional comet orbits further
// out and draws its own orbital plane from a per-index PRNG stream. The first
// comet keeps the pre-1.2 constants and stream names, so worlds stored before
// 1.2 (which fall back to a single comet) keep rendering byte-identically.
const COMET_ORBIT_GAP_STEP_PER_COMET = 1.2;
const ADDITIONAL_COMET_MAXIMUM_INCLINATION_RADIANS = 0.6;
const ADDITIONAL_COMET_MAXIMUM_ROTATION_Z_RADIANS = 0.5;

// Clamp + fallback bounds for the stored comets section.
const DEFAULT_COMET_COUNT = 1;
const MAXIMUM_COMET_COUNT = 3;
const DEFAULT_COMET_TAIL_LENGTH_MULTIPLIER = 1;
const MINIMUM_COMET_TAIL_LENGTH_MULTIPLIER = 0.4;
const MAXIMUM_COMET_TAIL_LENGTH_MULTIPLIER = 2;

const NUCLEUS_RADIUS = 0.12;
const NUCLEUS_ICOSPHERE_DETAIL = 2;
const NUCLEUS_NOISE_FREQUENCY = 2.2;
const NUCLEUS_NOISE_OCTAVES = 4;
const NUCLEUS_DISPLACEMENT_AMPLITUDE = 0.45;
// Comet nuclei are among the darkest objects in the solar system.
const NUCLEUS_COLOR = "#1A1714";

const COMA_SPRITE_SCALE = 0.55;
const COMA_COLOR = "#FFEFD8";
const COMA_OPACITY = 0.5;

const DUST_TAIL_PARTICLE_COUNT = 700;
const DUST_TAIL_LENGTH = 4.2;
const DUST_TAIL_WIDTH_RATIO = 0.16;
const DUST_TAIL_CURVE_BEND = 0.55;
const DUST_TAIL_COLOR = "#FFE8C8";
const ION_TAIL_PARTICLE_COUNT = 350;
const ION_TAIL_LENGTH = 5.5;
const ION_TAIL_WIDTH_RATIO = 0.05;
const ION_TAIL_COLOR = "#88AAFF";
const TAIL_PARTICLE_MINIMUM_SIZE = 0.015;
const TAIL_PARTICLE_SIZE_RANGE = 0.05;

type CometProps = {
  scene: SceneConfig;
  seed: string;
  /** 0-based position in the world's comet population; 0 is the legacy comet. */
  cometIndex?: number;
  /** Scales both tail lengths; 1 is the pre-1.2 look. */
  tailLengthMultiplier?: number;
};

export type ResolvedCometsConfig = {
  count: number;
  tailLengthMultiplier: number;
};

/**
 * Clamp + fallback resolution of the stored comets section (schemaVersion
 * 1.2). Worlds stored before 1.2 have no comets key and resolve to exactly one
 * comet with a neutral tail — the pre-1.2 look.
 */
export function resolveCometsConfig(comets: SceneCometsConfig | undefined): ResolvedCometsConfig {
  const count =
    typeof comets?.count === "number" && Number.isFinite(comets.count)
      ? Math.min(Math.max(Math.floor(comets.count), 0), MAXIMUM_COMET_COUNT)
      : DEFAULT_COMET_COUNT;
  const tailLengthMultiplier =
    typeof comets?.tailLengthMultiplier === "number" &&
    Number.isFinite(comets.tailLengthMultiplier) &&
    comets.tailLengthMultiplier >= MINIMUM_COMET_TAIL_LENGTH_MULTIPLIER &&
    comets.tailLengthMultiplier <= MAXIMUM_COMET_TAIL_LENGTH_MULTIPLIER
      ? comets.tailLengthMultiplier
      : DEFAULT_COMET_TAIL_LENGTH_MULTIPLIER;
  return { count, tailLengthMultiplier };
}

type TailShapeOptions = {
  particleCount: number;
  tailLength: number;
  widthRatio: number;
  curveBend: number;
  tailColorHex: string;
  brightnessFalloffExponent: number;
};

// Tail particles live in the tail group's LOCAL space along +Z; the group is
// re-aimed anti-sunward every frame, so the shape itself is static geometry.
function buildTailParticles(seedLabel: string, options: TailShapeOptions): StarLayerAttributes {
  const random = randomFromSeed(seedLabel);
  const [baseRed, baseGreen, baseBlue] = hexColorToUnitRgb(options.tailColorHex);
  const positions = new Float32Array(options.particleCount * 3);
  const colors = new Float32Array(options.particleCount * 3);
  const sizes = new Float32Array(options.particleCount);
  const twinklePhases = new Float32Array(options.particleCount);
  for (let particleIndex = 0; particleIndex < options.particleCount; particleIndex += 1) {
    // Denser near the nucleus, thinning toward the tip.
    const tailFraction = random() ** 1.2;
    const localWidth = options.widthRatio * (0.25 + tailFraction) * options.tailLength;
    positions[particleIndex * 3] =
      (random() * 2 - 1) * localWidth + options.curveBend * tailFraction * tailFraction * options.tailLength * 0.25;
    positions[particleIndex * 3 + 1] = (random() * 2 - 1) * localWidth;
    positions[particleIndex * 3 + 2] = tailFraction * options.tailLength;

    const brightness = (1 - tailFraction) ** options.brightnessFalloffExponent;
    colors[particleIndex * 3] = baseRed * brightness;
    colors[particleIndex * 3 + 1] = baseGreen * brightness;
    colors[particleIndex * 3 + 2] = baseBlue * brightness;

    sizes[particleIndex] = TAIL_PARTICLE_MINIMUM_SIZE + random() * TAIL_PARTICLE_SIZE_RANGE;
    twinklePhases[particleIndex] = random() * Math.PI * 2;
  }
  return { positions, colors, sizes, twinklePhases };
}

function buildNucleusGeometry(nucleusSeedLabel: string): IcosahedronGeometry {
  const geometry = new IcosahedronGeometry(NUCLEUS_RADIUS, NUCLEUS_ICOSPHERE_DETAIL);
  const noise = createSeededNoise3d(nucleusSeedLabel);
  const positionAttribute = geometry.attributes.position;
  for (let vertexIndex = 0; vertexIndex < positionAttribute.count; vertexIndex += 1) {
    const x = positionAttribute.getX(vertexIndex);
    const y = positionAttribute.getY(vertexIndex);
    const z = positionAttribute.getZ(vertexIndex);
    const displacement =
      1 +
      NUCLEUS_DISPLACEMENT_AMPLITUDE *
        fractalNoise3d(
          noise,
          (x / NUCLEUS_RADIUS) * NUCLEUS_NOISE_FREQUENCY,
          (y / NUCLEUS_RADIUS) * NUCLEUS_NOISE_FREQUENCY,
          (z / NUCLEUS_RADIUS) * NUCLEUS_NOISE_FREQUENCY,
          NUCLEUS_NOISE_OCTAVES
        );
    positionAttribute.setXYZ(vertexIndex, x * displacement, y * displacement, z * displacement);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function Comet({
  scene,
  seed,
  cometIndex = 0,
  tailLengthMultiplier = DEFAULT_COMET_TAIL_LENGTH_MULTIPLIER
}: CometProps) {
  const planets = planetsFromScene(scene);
  const outermostOrbitRadius = planets.reduce(
    (maximumRadius, planet, planetIndex) => Math.max(maximumRadius, orbitRadiusForPlanet(planet, planetIndex)),
    FIRST_PLANET_ORBIT_RADIUS
  );
  const cometOrbitRadius =
    outermostOrbitRadius + COMET_ORBIT_GAP_BEYOND_LAST_ORBIT + cometIndex * COMET_ORBIT_GAP_STEP_PER_COMET;

  // Comet 0 keeps the pre-1.2 stream names (`-comet-...`), so old worlds keep
  // their exact comet; additional comets get their own per-index streams.
  const cometSeedScope = cometIndex === 0 ? "comet" : `comet-${cometIndex}`;

  const orbitParameters = useMemo(() => {
    const random = randomFromSeed(`${seed}-${cometSeedScope}-orbit`);
    const orbitPhase = random() * Math.PI * 2;
    if (cometIndex === 0) {
      // Exactly one draw, like the pre-1.2 code path.
      return {
        orbitPhase,
        inclinationRadians: COMET_ORBIT_INCLINATION_RADIANS,
        rotationZRadians: COMET_ORBIT_BASE_ROTATION_Z_RADIANS
      };
    }
    return {
      orbitPhase,
      inclinationRadians: (random() * 2 - 1) * ADDITIONAL_COMET_MAXIMUM_INCLINATION_RADIANS,
      rotationZRadians: (random() * 2 - 1) * ADDITIONAL_COMET_MAXIMUM_ROTATION_Z_RADIANS
    };
  }, [seed, cometSeedScope, cometIndex]);

  const nucleusGeometry = useMemo(
    () => buildNucleusGeometry(`${seed}-${cometSeedScope}-nucleus`),
    [seed, cometSeedScope]
  );
  useEffect(() => {
    return () => {
      nucleusGeometry.dispose();
    };
  }, [nucleusGeometry]);

  const dustTail = useMemo(
    () =>
      buildTailParticles(`${seed}-${cometSeedScope}-dust-tail`, {
        particleCount: DUST_TAIL_PARTICLE_COUNT,
        tailLength: DUST_TAIL_LENGTH * tailLengthMultiplier,
        widthRatio: DUST_TAIL_WIDTH_RATIO,
        curveBend: DUST_TAIL_CURVE_BEND,
        tailColorHex: DUST_TAIL_COLOR,
        brightnessFalloffExponent: 1.5
      }),
    [seed, cometSeedScope, tailLengthMultiplier]
  );
  const ionTail = useMemo(
    () =>
      buildTailParticles(`${seed}-${cometSeedScope}-ion-tail`, {
        particleCount: ION_TAIL_PARTICLE_COUNT,
        tailLength: ION_TAIL_LENGTH * tailLengthMultiplier,
        widthRatio: ION_TAIL_WIDTH_RATIO,
        curveBend: 0,
        tailColorHex: ION_TAIL_COLOR,
        brightnessFalloffExponent: 1.2
      }),
    [seed, cometSeedScope, tailLengthMultiplier]
  );

  const softCircleTexture = useMemo(() => getSoftCircleTexture(), []);
  const cometAnchorReference = useRef<Group>(null);
  const tailGroupReference = useRef<Group>(null);
  const antiSunwardTarget = useMemo(() => new Vector3(), []);

  useFrame(({ clock }) => {
    const cometAnchor = cometAnchorReference.current;
    if (!cometAnchor) {
      return;
    }
    const orbitAngle = orbitParameters.orbitPhase + clock.elapsedTime * COMET_ORBIT_RADIANS_PER_SECOND;
    cometAnchor.position.set(Math.cos(orbitAngle) * cometOrbitRadius, 0, Math.sin(orbitAngle) * cometOrbitRadius);
    if (tailGroupReference.current) {
      // Aim the tail's +Z straight away from the sun at the origin.
      cometAnchor.getWorldPosition(antiSunwardTarget).multiplyScalar(2);
      tailGroupReference.current.lookAt(antiSunwardTarget);
    }
  });

  return (
    <group rotation={[orbitParameters.inclinationRadians, 0, orbitParameters.rotationZRadians]}>
      <group ref={cometAnchorReference}>
        <mesh geometry={nucleusGeometry} raycast={() => null}>
          <meshStandardMaterial color={NUCLEUS_COLOR} roughness={1} metalness={0} />
        </mesh>
        <sprite scale={COMA_SPRITE_SCALE} raycast={() => null}>
          <spriteMaterial
            map={softCircleTexture ?? undefined}
            color={COMA_COLOR}
            transparent
            opacity={COMA_OPACITY}
            depthWrite={false}
            toneMapped={false}
            fog={false}
          />
        </sprite>
        <group ref={tailGroupReference}>
          {/* The multiplier shapes the tail arrays, so it is part of the
              geometry remount key. */}
          <SizedStarPoints stars={dustTail} geometryKey={`${seed}-${cometSeedScope}-dust-${tailLengthMultiplier}`} />
          <SizedStarPoints stars={ionTail} geometryKey={`${seed}-${cometSeedScope}-ion-${tailLengthMultiplier}`} />
        </group>
      </group>
    </group>
  );
}

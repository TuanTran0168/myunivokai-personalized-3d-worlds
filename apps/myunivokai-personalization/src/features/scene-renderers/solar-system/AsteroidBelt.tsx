"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Clone, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Box3, Color, IcosahedronGeometry, Object3D, Vector3, type Group, type InstancedMesh } from "three";
import type { SceneBeltConfig, SceneConfig } from "@/lib/types";
import { planetsFromScene, randomFromSeed } from "@/lib/scene";
import { createSeededNoise3d, fractalNoise3d } from "../shared/seededNoise3d";
import { orbitRadiusForPlanet } from "./SolarPlanet";
import { BENNU_MODEL_URL, BENNU_TARGET_SIZE } from "./spacecraftCatalog";

/**
 * A procedural asteroid belt just outside the outermost personality planet.
 * Everything is seeded: a few potato-shaped rock geometries (noise-displaced
 * icospheres) instanced a thousand times with power-law sizes (many small,
 * few big — real belt statistics), gaussian radial/vertical scatter, and a
 * slow rigid drift. Zero downloads, infinite per-world variety.
 */

const ROCK_GEOMETRY_VARIANT_COUNT = 3;
const ROCK_ICOSPHERE_DETAIL = 3;
const ROCK_NOISE_FREQUENCY = 1.6;
const ROCK_NOISE_OCTAVES = 4;
const ROCK_DISPLACEMENT_AMPLITUDE = 0.38;
// Real asteroids are elongated potatoes, not spheres.
const ROCK_MAXIMUM_ELONGATION = 0.5;

// Defaults double as the exact pre-1.2 belt (worlds stored before
// schemaVersion 1.2 carry no belt section and must keep rendering
// byte-identically), and as the per-field fallbacks when a stored value is
// missing or out of range.
const DEFAULT_ASTEROID_INSTANCE_COUNT = 1400;
const MAXIMUM_ASTEROID_INSTANCE_COUNT = 2500;
const DEFAULT_BELT_GAP_BEYOND_LAST_ORBIT = 1.7;
const MINIMUM_BELT_GAP_BEYOND_LAST_ORBIT = 0.5;
const MAXIMUM_BELT_GAP_BEYOND_LAST_ORBIT = 5;
// A wide, diffuse band of mostly tiny rubble reads as a real belt; a narrow
// rope of boulder-sized rocks reads as popcorn.
const BELT_RADIAL_SIGMA = 0.75;
const BELT_VERTICAL_SIGMA = 0.15;
const MINIMUM_ASTEROID_SCALE = 0.018;
const ASTEROID_SCALE_RANGE = 0.062;
// scale = min + range * u^power: the bias yields many small, few big. Real
// belt statistics are even steeper, but below this the big rocks vanish.
const ASTEROID_SCALE_POWER = 2.6;
const BELT_ROTATION_RADIANS_PER_SECOND = 0.008;
const DEFAULT_BELT_TILT_X_RADIANS = 0.05;
const DEFAULT_BELT_TILT_Z_RADIANS = 0.03;
const MAXIMUM_BELT_TILT_MAGNITUDE_RADIANS = 0.3;
// Asteroids are among the darkest bodies in the solar system (albedo well
// under 0.2); a light base color made the belt read as bright popcorn.
const DEFAULT_ASTEROID_BASE_COLOR = "#655B4F";
const ASTEROID_BRIGHTNESS_VARIATION = 0.45;

const SIX_DIGIT_HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

// Matches the default orbit layout in SolarPlanet for worlds without explicit radii.
const FIRST_PLANET_ORBIT_RADIUS = 3.2;

const BENNU_TUMBLE_RADIANS_PER_SECOND = 0.08;
const BENNU_ROCK_COLOR = "#5C544B";

type AsteroidBeltProps = {
  scene: SceneConfig;
  seed: string;
};

type ResolvedBeltConfig = {
  enabled: boolean;
  instanceCount: number;
  gapBeyondLastOrbit: number;
  rockColor: string;
  tiltXRadians: number;
  tiltZRadians: number;
};

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function resolveBoundedNumber(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return clampNumber(value, minimum, maximum);
}

/**
 * Clamp + fallback resolution of the stored belt section (schemaVersion 1.2).
 * Worlds stored before 1.2 have no belt key: every fallback equals the pre-1.2
 * constant, so they keep rendering byte-identically.
 */
function resolveBeltConfig(belt: SceneBeltConfig | undefined): ResolvedBeltConfig {
  return {
    enabled: typeof belt?.enabled === "boolean" ? belt.enabled : true,
    instanceCount: Math.floor(
      resolveBoundedNumber(belt?.instanceCount, DEFAULT_ASTEROID_INSTANCE_COUNT, 1, MAXIMUM_ASTEROID_INSTANCE_COUNT)
    ),
    gapBeyondLastOrbit: resolveBoundedNumber(
      belt?.gapBeyondLastOrbit,
      DEFAULT_BELT_GAP_BEYOND_LAST_ORBIT,
      MINIMUM_BELT_GAP_BEYOND_LAST_ORBIT,
      MAXIMUM_BELT_GAP_BEYOND_LAST_ORBIT
    ),
    rockColor:
      typeof belt?.rockColor === "string" && SIX_DIGIT_HEX_COLOR_PATTERN.test(belt.rockColor)
        ? belt.rockColor
        : DEFAULT_ASTEROID_BASE_COLOR,
    tiltXRadians: resolveBoundedNumber(
      belt?.tiltXRadians,
      DEFAULT_BELT_TILT_X_RADIANS,
      -MAXIMUM_BELT_TILT_MAGNITUDE_RADIANS,
      MAXIMUM_BELT_TILT_MAGNITUDE_RADIANS
    ),
    tiltZRadians: resolveBoundedNumber(
      belt?.tiltZRadians,
      DEFAULT_BELT_TILT_Z_RADIANS,
      -MAXIMUM_BELT_TILT_MAGNITUDE_RADIANS,
      MAXIMUM_BELT_TILT_MAGNITUDE_RADIANS
    )
  };
}

/**
 * The belt's named hero rock: NASA's radar shape model of asteroid Bennu
 * (real silhouette, public domain), parked at a seeded spot on the belt ring
 * inside the rotating group so it drifts with the swarm.
 */
function BennuHeroRock({ seed, beltRadius }: { seed: string; beltRadius: number }) {
  const gltf = useGLTF(BENNU_MODEL_URL);
  const normalizedScale = useMemo(() => {
    const boundingBox = new Box3().setFromObject(gltf.scene);
    const size = new Vector3();
    boundingBox.getSize(size);
    const largestDimension = Math.max(size.x, size.y, size.z);
    return largestDimension > 0 ? BENNU_TARGET_SIZE / largestDimension : 1;
  }, [gltf]);
  const beltAngle = useMemo(() => randomFromSeed(`${seed}-bennu`)() * Math.PI * 2, [seed]);
  const rockReference = useRef<Group>(null);
  const rockColor = useMemo(() => new Color(BENNU_ROCK_COLOR), []);

  useEffect(() => {
    rockReference.current?.traverse((object) => {
      object.raycast = () => null;
      // The NASA shape model ships without materials; tint whatever standard
      // material Clone gave it toward dark regolith.
      const mesh = object as { material?: { color?: Color } };
      if (mesh.material?.color) {
        mesh.material.color.copy(rockColor);
      }
    });
  }, [gltf, rockColor]);

  useFrame((_, deltaSeconds) => {
    if (rockReference.current) {
      rockReference.current.rotation.y += BENNU_TUMBLE_RADIANS_PER_SECOND * deltaSeconds;
      rockReference.current.rotation.x += BENNU_TUMBLE_RADIANS_PER_SECOND * 0.4 * deltaSeconds;
    }
  });

  return (
    <group
      ref={rockReference}
      position={[Math.cos(beltAngle) * beltRadius, 0, Math.sin(beltAngle) * beltRadius]}
      scale={normalizedScale}
    >
      <Clone object={gltf.scene} />
    </group>
  );
}

useGLTF.preload(BENNU_MODEL_URL);

function buildRockGeometry(seed: string, variantIndex: number): IcosahedronGeometry {
  const geometry = new IcosahedronGeometry(1, ROCK_ICOSPHERE_DETAIL);
  const noise = createSeededNoise3d(`${seed}-rock-${variantIndex}`);
  const random = randomFromSeed(`${seed}-rock-shape-${variantIndex}`);
  const positionAttribute = geometry.attributes.position;
  for (let vertexIndex = 0; vertexIndex < positionAttribute.count; vertexIndex += 1) {
    const x = positionAttribute.getX(vertexIndex);
    const y = positionAttribute.getY(vertexIndex);
    const z = positionAttribute.getZ(vertexIndex);
    // On a unit icosphere the position IS the normal; push along it.
    const displacement =
      1 +
      ROCK_DISPLACEMENT_AMPLITUDE *
        fractalNoise3d(noise, x * ROCK_NOISE_FREQUENCY, y * ROCK_NOISE_FREQUENCY, z * ROCK_NOISE_FREQUENCY, ROCK_NOISE_OCTAVES);
    positionAttribute.setXYZ(vertexIndex, x * displacement, y * displacement, z * displacement);
  }
  geometry.scale(1 + random() * ROCK_MAXIMUM_ELONGATION, 1 - random() * ROCK_MAXIMUM_ELONGATION * 0.6, 1);
  geometry.computeVertexNormals();
  return geometry;
}

// Box-Muller gaussian from the seeded uniform source.
function gaussianSample(random: () => number): number {
  const uniformA = Math.max(random(), Number.EPSILON);
  const uniformB = random();
  return Math.sqrt(-2 * Math.log(uniformA)) * Math.cos(2 * Math.PI * uniformB);
}

/**
 * Resolves the stored belt section before any hook runs, so a world that
 * rolled "no belt" (schemaVersion 1.2, enabled: false) can skip the whole
 * subtree — including the Bennu hero rock, which belongs to the belt.
 */
export function AsteroidBelt({ scene, seed }: AsteroidBeltProps) {
  const beltConfig = resolveBeltConfig(scene.belt);
  if (!beltConfig.enabled) {
    return null;
  }
  return <SeededAsteroidBelt scene={scene} seed={seed} beltConfig={beltConfig} />;
}

type SeededAsteroidBeltProps = AsteroidBeltProps & {
  beltConfig: ResolvedBeltConfig;
};

function SeededAsteroidBelt({ scene, seed, beltConfig }: SeededAsteroidBeltProps) {
  const planets = planetsFromScene(scene);
  const outermostOrbitRadius = planets.reduce(
    (maximumRadius, planet, planetIndex) => Math.max(maximumRadius, orbitRadiusForPlanet(planet, planetIndex)),
    FIRST_PLANET_ORBIT_RADIUS
  );
  const beltRadius = outermostOrbitRadius + beltConfig.gapBeyondLastOrbit;

  const rockGeometries = useMemo(
    () =>
      Array.from({ length: ROCK_GEOMETRY_VARIANT_COUNT }, (_, variantIndex) => buildRockGeometry(seed, variantIndex)),
    [seed]
  );
  useEffect(() => {
    return () => {
      rockGeometries.forEach((geometry) => geometry.dispose());
    };
  }, [rockGeometries]);

  const instancedMeshReferences = useRef<(InstancedMesh | null)[]>([]);
  const beltGroupReference = useRef<Group>(null);

  // Seeded placement, written once per (seed, beltRadius, belt config) into
  // the instance buffers.
  useEffect(() => {
    const random = randomFromSeed(`${seed}-asteroid-belt`);
    const placementProxy = new Object3D();
    const instanceColor = new Color();
    const baseColor = new Color(beltConfig.rockColor);
    const instancesPerVariant = Math.floor(beltConfig.instanceCount / ROCK_GEOMETRY_VARIANT_COUNT);
    for (let variantIndex = 0; variantIndex < ROCK_GEOMETRY_VARIANT_COUNT; variantIndex += 1) {
      const instancedMesh = instancedMeshReferences.current[variantIndex];
      if (!instancedMesh) {
        continue;
      }
      for (let instanceIndex = 0; instanceIndex < instancesPerVariant; instanceIndex += 1) {
        const orbitAngle = random() * Math.PI * 2;
        const orbitRadius = beltRadius + gaussianSample(random) * BELT_RADIAL_SIGMA;
        const verticalOffset = gaussianSample(random) * BELT_VERTICAL_SIGMA;
        placementProxy.position.set(
          Math.cos(orbitAngle) * orbitRadius,
          verticalOffset,
          Math.sin(orbitAngle) * orbitRadius
        );
        placementProxy.rotation.set(random() * Math.PI * 2, random() * Math.PI * 2, random() * Math.PI * 2);
        const scale = MINIMUM_ASTEROID_SCALE + ASTEROID_SCALE_RANGE * random() ** ASTEROID_SCALE_POWER;
        placementProxy.scale.setScalar(scale);
        placementProxy.updateMatrix();
        instancedMesh.setMatrixAt(instanceIndex, placementProxy.matrix);
        const brightness = 1 - ASTEROID_BRIGHTNESS_VARIATION * random();
        instanceColor.copy(baseColor).multiplyScalar(brightness);
        instancedMesh.setColorAt(instanceIndex, instanceColor);
      }
      instancedMesh.instanceMatrix.needsUpdate = true;
      if (instancedMesh.instanceColor) {
        instancedMesh.instanceColor.needsUpdate = true;
      }
    }
  }, [seed, beltRadius, rockGeometries, beltConfig.instanceCount, beltConfig.rockColor]);

  useFrame((_, deltaSeconds) => {
    if (beltGroupReference.current) {
      beltGroupReference.current.rotation.y += BELT_ROTATION_RADIANS_PER_SECOND * deltaSeconds;
    }
  });

  const instancesPerVariant = Math.floor(beltConfig.instanceCount / ROCK_GEOMETRY_VARIANT_COUNT);

  return (
    <group ref={beltGroupReference} rotation={[beltConfig.tiltXRadians, 0, beltConfig.tiltZRadians]}>
      {rockGeometries.map((geometry, variantIndex) => (
        <instancedMesh
          // eslint-disable-next-line react/no-array-index-key -- variants are stable, index IS the identity
          key={`${seed}-belt-variant-${variantIndex}-${beltConfig.instanceCount}`}
          ref={(instancedMesh) => {
            instancedMeshReferences.current[variantIndex] = instancedMesh;
          }}
          args={[geometry, undefined, instancesPerVariant]}
          frustumCulled={false}
          // Belt rocks are scenery, not DNA objects — never intercept clicks.
          raycast={() => null}
        >
          <meshStandardMaterial roughness={0.95} metalness={0.05} />
        </instancedMesh>
      ))}
      <Suspense fallback={null}>
        <BennuHeroRock seed={seed} beltRadius={beltRadius} />
      </Suspense>
    </group>
  );
}

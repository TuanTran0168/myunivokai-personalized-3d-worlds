"use client";

import { useEffect, useMemo, useRef } from "react";
import { Clone, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Box3, Vector3, type Group } from "three";
import type { SceneConfig } from "@/lib/types";
import { planetsFromScene, randomFromSeed } from "@/lib/scene";
import { planetIdentityKey } from "../planetIdentity";
import { usePlanetPositionTracker } from "../shared/PlanetPositionTracker";
import { renderedPlanetSize } from "./SolarPlanet";
import { SPACECRAFT_CATALOG } from "./spacecraftCatalog";

/**
 * One real NASA spacecraft (seed-picked from the catalog) orbiting the
 * world's HIGHEST-ENERGY personality planet — a personal artificial
 * satellite. It follows the planet's live position through the shared
 * position tracker, so it needs no coupling into SolarPlanet. Scenery only:
 * raycasting is disabled so clicks still reach the planet underneath.
 */

const ORBIT_RADIUS_PLANET_SIZE_MULTIPLIER = 3;
const MINIMUM_ORBIT_RADIUS = 1.1;
const ORBIT_RADIANS_PER_SECOND = 0.3;
const ORBIT_VERTICAL_OFFSET_RATIO = 0.22;
const SELF_SPIN_RADIANS_PER_SECOND = 0.12;

type OrbitingSpacecraftProps = {
  scene: SceneConfig;
  seed: string;
};

export function OrbitingSpacecraft({ scene, seed }: OrbitingSpacecraftProps) {
  const planets = planetsFromScene(scene);
  const planetPositionTracker = usePlanetPositionTracker();

  // The satellite belongs to the planet with the highest energy score.
  const hostPlanetIndex = planets.reduce(
    (bestIndex, planet, planetIndex) =>
      (planet.energy ?? 0) > (planets[bestIndex]?.energy ?? 0) ? planetIndex : bestIndex,
    0
  );
  const hostPlanet = planets[hostPlanetIndex];
  const hostIdentityKey = hostPlanet ? planetIdentityKey(hostPlanet, hostPlanetIndex) : null;
  const orbitRadius = hostPlanet
    ? Math.max(MINIMUM_ORBIT_RADIUS, renderedPlanetSize(hostPlanet) * ORBIT_RADIUS_PLANET_SIZE_MULTIPLIER)
    : MINIMUM_ORBIT_RADIUS;

  const catalogEntry = useMemo(() => {
    const random = randomFromSeed(`${seed}-spacecraft`);
    return SPACECRAFT_CATALOG[Math.floor(random() * SPACECRAFT_CATALOG.length)];
  }, [seed]);

  const gltf = useGLTF(catalogEntry.modelUrl);
  // NASA source units vary by orders of magnitude — normalize by bounding box.
  const normalizedScale = useMemo(() => {
    const boundingBox = new Box3().setFromObject(gltf.scene);
    const size = new Vector3();
    boundingBox.getSize(size);
    const largestDimension = Math.max(size.x, size.y, size.z);
    return largestDimension > 0 ? catalogEntry.targetSize / largestDimension : 1;
  }, [gltf, catalogEntry]);

  const anchorReference = useRef<Group>(null);
  const orbitReference = useRef<Group>(null);
  const modelReference = useRef<Group>(null);

  // Scenery: never intercept pointer events meant for the planet.
  useEffect(() => {
    modelReference.current?.traverse((object) => {
      object.raycast = () => null;
    });
  }, [gltf]);

  useFrame((_, deltaSeconds) => {
    const anchor = anchorReference.current;
    if (anchor && hostIdentityKey) {
      const hostWorldPosition = planetPositionTracker.get(hostIdentityKey);
      if (hostWorldPosition) {
        anchor.position.copy(hostWorldPosition);
      }
    }
    if (orbitReference.current) {
      orbitReference.current.rotation.y += ORBIT_RADIANS_PER_SECOND * deltaSeconds;
    }
    if (modelReference.current) {
      modelReference.current.rotation.y += SELF_SPIN_RADIANS_PER_SECOND * deltaSeconds;
    }
  });

  if (!hostPlanet) {
    return null;
  }

  return (
    <group ref={anchorReference}>
      <group ref={orbitReference}>
        <group
          ref={modelReference}
          position={[orbitRadius, orbitRadius * ORBIT_VERTICAL_OFFSET_RATIO, 0]}
          scale={normalizedScale}
        >
          <Clone object={gltf.scene} />
        </group>
      </group>
    </group>
  );
}

SPACECRAFT_CATALOG.forEach((entry) => {
  useGLTF.preload(entry.modelUrl);
});

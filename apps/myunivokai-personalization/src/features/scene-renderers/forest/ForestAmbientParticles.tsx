"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  PointsMaterial,
  Quaternion,
  Vector3
} from "three";
import type { ForestAmbientParticlesConfig, ForestSeasonConfig, ForestTerrainConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { getSoftCircleTexture } from "@/features/scene-renderers/shared/softCircleTexture";
import { blendedFoliageColors, clearingRadiusFromTerrain, treelineRadiusFromTerrain } from "./forestMath";

const MOBILE_VIEWPORT_MAXIMUM_WIDTH = 768;
// Ambient counts are modest (≤360); mobile halves them for headroom.
const MOBILE_AMBIENT_COUNT_RATIO = 0.5;

const DRIFTER_SCATTER_SEED_SUFFIX = "-drifters";
const FIREFLY_SCATTER_SEED_SUFFIX = "-fireflies";
const SNOW_DUST_SCATTER_SEED_SUFFIX = "-snow-dust";

const LEAF_WIDTH = 0.22;
const LEAF_HEIGHT = 0.14;
const PETAL_WIDTH = 0.13;
const PETAL_HEIGHT = 0.1;

const DRIFT_CEILING = 14;
const LEAF_FALL_SPEED_MINIMUM = 0.55;
const LEAF_FALL_SPEED_RANGE = 0.6;
const PETAL_FALL_SPEED_MINIMUM = 0.35;
const PETAL_FALL_SPEED_RANGE = 0.45;
const DRIFTER_SWAY_AMPLITUDE = 0.6;
const DRIFTER_SWAY_FREQUENCY = 0.8;
const DRIFTER_TUMBLE_SPEED_MINIMUM = 1.2;
const DRIFTER_TUMBLE_SPEED_RANGE = 2.4;

const FIREFLY_COLOR = "#FFE9A3";
const FIREFLY_POINT_SIZE = 0.22;
const FIREFLY_ALTITUDE_MINIMUM = 0.4;
const FIREFLY_ALTITUDE_RANGE = 2.0;
const FIREFLY_PULSE_FREQUENCY = 1.6;
const FIREFLY_DRIFT_SPEED = 0.25;

const SNOW_DUST_COLOR = "#E8F0F8";
const SNOW_DUST_POINT_SIZE = 0.1;
const SNOW_DUST_CEILING = 6;
const SNOW_DUST_FALL_SPEED = 0.35;

type ForestAmbientParticlesProps = {
  ambientParticles?: ForestAmbientParticlesConfig;
  season?: ForestSeasonConfig;
  terrain?: ForestTerrainConfig;
  placementSeed: string;
};

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < MOBILE_VIEWPORT_MAXIMUM_WIDTH;
}

function ambientCountForViewport(configuredCount: number): number {
  return isMobileViewport() ? Math.floor(configuredCount * MOBILE_AMBIENT_COUNT_RATIO) : configuredCount;
}

type DrifterState = {
  x: number;
  y: number;
  z: number;
  fallSpeed: number;
  swayPhase: number;
  tumbleSpeed: number;
  tumblePhase: number;
};

type DrifterLayerProps = {
  particleCount: number;
  areaRadius: number;
  seed: string;
  particleWidth: number;
  particleHeight: number;
  particleColors: Color[];
  fallSpeedMinimum: number;
  fallSpeedRange: number;
};

/**
 * Instanced tumbling planes — falling autumn leaves or spring blossom petals.
 * Each instance falls, sways sideways and tumbles with its own seeded phase.
 */
function DrifterLayer({
  particleCount,
  areaRadius,
  seed,
  particleWidth,
  particleHeight,
  particleColors,
  fallSpeedMinimum,
  fallSpeedRange
}: DrifterLayerProps) {
  const elapsedSecondsRef = useRef(0);

  const { instancedMesh, drifterStates } = useMemo(() => {
    const geometry = new PlaneGeometry(particleWidth, particleHeight);
    const material = new MeshBasicMaterial({ side: DoubleSide, transparent: true, opacity: 0.95 });
    const mesh = new InstancedMesh(geometry, material, particleCount);
    const nextRandomValue = randomFromSeed(seed);
    const states: DrifterState[] = [];
    for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
      const angle = nextRandomValue() * Math.PI * 2;
      const radius = Math.sqrt(nextRandomValue()) * areaRadius;
      states.push({
        x: Math.cos(angle) * radius,
        y: nextRandomValue() * DRIFT_CEILING,
        z: Math.sin(angle) * radius,
        fallSpeed: fallSpeedMinimum + nextRandomValue() * fallSpeedRange,
        swayPhase: nextRandomValue() * Math.PI * 2,
        tumbleSpeed: DRIFTER_TUMBLE_SPEED_MINIMUM + nextRandomValue() * DRIFTER_TUMBLE_SPEED_RANGE,
        tumblePhase: nextRandomValue() * Math.PI * 2
      });
      mesh.setColorAt(particleIndex, particleColors[particleIndex % particleColors.length]);
    }
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    return { instancedMesh: mesh, drifterStates: states };
  }, [areaRadius, fallSpeedMinimum, fallSpeedRange, particleColors, particleCount, particleHeight, particleWidth, seed]);

  useFrame((_, deltaTimeSeconds) => {
    elapsedSecondsRef.current += deltaTimeSeconds;
    const elapsedSeconds = elapsedSecondsRef.current;
    const matrix = new Matrix4();
    const rotation = new Quaternion();
    const tumbleAxis = new Vector3(1, 0.4, 0.6).normalize();
    const scale = new Vector3(1, 1, 1);
    const position = new Vector3();
    drifterStates.forEach((drifter, particleIndex) => {
      drifter.y -= drifter.fallSpeed * deltaTimeSeconds;
      if (drifter.y < 0) {
        drifter.y += DRIFT_CEILING;
      }
      position.set(
        drifter.x + Math.sin(elapsedSeconds * DRIFTER_SWAY_FREQUENCY + drifter.swayPhase) * DRIFTER_SWAY_AMPLITUDE,
        drifter.y,
        drifter.z + Math.cos(elapsedSeconds * DRIFTER_SWAY_FREQUENCY * 0.8 + drifter.swayPhase) * DRIFTER_SWAY_AMPLITUDE * 0.7
      );
      rotation.setFromAxisAngle(tumbleAxis, elapsedSeconds * drifter.tumbleSpeed + drifter.tumblePhase);
      matrix.compose(position, rotation, scale);
      instancedMesh.setMatrixAt(particleIndex, matrix);
    });
    instancedMesh.instanceMatrix.needsUpdate = true;
  });

  return <primitive object={instancedMesh} />;
}

type GlowPointsLayerProps = {
  particleCount: number;
  areaRadius: number;
  seed: string;
  color: string;
  pointSize: number;
  altitudeMinimum: number;
  altitudeRange: number;
  behavior: "firefly" | "snowDust";
};

/** Points layer for fireflies (pulsing, wandering) and winter snow dust. */
function GlowPointsLayer({
  particleCount,
  areaRadius,
  seed,
  color,
  pointSize,
  altitudeMinimum,
  altitudeRange,
  behavior
}: GlowPointsLayerProps) {
  const elapsedSecondsRef = useRef(0);

  const { geometry, material, wanderPhases } = useMemo(() => {
    const nextRandomValue = randomFromSeed(seed);
    const positions = new Float32Array(particleCount * 3);
    const phases = new Float32Array(particleCount);
    for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
      const angle = nextRandomValue() * Math.PI * 2;
      const radius = Math.sqrt(nextRandomValue()) * areaRadius;
      positions[particleIndex * 3] = Math.cos(angle) * radius;
      positions[particleIndex * 3 + 1] = altitudeMinimum + nextRandomValue() * altitudeRange;
      positions[particleIndex * 3 + 2] = Math.sin(angle) * radius;
      phases[particleIndex] = nextRandomValue() * Math.PI * 2;
    }
    const bufferGeometry = new BufferGeometry();
    bufferGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const pointsMaterial = new PointsMaterial({
      color: new Color(color),
      size: pointSize,
      transparent: true,
      opacity: 0.9,
      map: getSoftCircleTexture() ?? undefined,
      blending: behavior === "firefly" ? AdditiveBlending : undefined,
      depthWrite: false,
      sizeAttenuation: true
    });
    return { geometry: bufferGeometry, material: pointsMaterial, wanderPhases: phases };
  }, [altitudeMinimum, altitudeRange, areaRadius, behavior, color, particleCount, pointSize, seed]);

  useFrame((_, deltaTimeSeconds) => {
    elapsedSecondsRef.current += deltaTimeSeconds;
    const elapsedSeconds = elapsedSecondsRef.current;
    const positionAttribute = geometry.getAttribute("position");
    for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
      const wanderPhase = wanderPhases[particleIndex];
      if (behavior === "firefly") {
        positionAttribute.setX(
          particleIndex,
          positionAttribute.getX(particleIndex) +
            Math.sin(elapsedSeconds * 0.9 + wanderPhase) * FIREFLY_DRIFT_SPEED * deltaTimeSeconds
        );
        positionAttribute.setY(
          particleIndex,
          positionAttribute.getY(particleIndex) +
            Math.cos(elapsedSeconds * 0.7 + wanderPhase * 1.3) * FIREFLY_DRIFT_SPEED * 0.6 * deltaTimeSeconds
        );
      } else {
        let particleY = positionAttribute.getY(particleIndex) - SNOW_DUST_FALL_SPEED * deltaTimeSeconds;
        if (particleY < 0) {
          particleY += SNOW_DUST_CEILING;
        }
        positionAttribute.setY(particleIndex, particleY);
      }
    }
    positionAttribute.needsUpdate = true;
    if (behavior === "firefly") {
      // A shared slow pulse; per-firefly phase differences come from the
      // wander motion, which is enough to break simultaneity visually.
      material.opacity = 0.55 + 0.45 * Math.sin(elapsedSeconds * FIREFLY_PULSE_FREQUENCY);
    }
  });

  return <points geometry={geometry} material={material} />;
}

/**
 * The seasonal ambience layer. At most one system is active per config
 * (autumn leaves / spring petals / summer-dusk fireflies / winter snow dust)
 * — the backend zeroes the others.
 */
export function ForestAmbientParticles({ ambientParticles, season, terrain, placementSeed }: ForestAmbientParticlesProps) {
  const clearingRadius = clearingRadiusFromTerrain(terrain);
  const treelineRadius = treelineRadiusFromTerrain(terrain);
  const foliageColors = useMemo(() => blendedFoliageColors(season), [season]);
  const petalColors = useMemo(() => {
    const blossomColor = foliageColors[foliageColors.length - 1];
    return [blossomColor, blossomColor.clone().lerp(new Color("#FFFFFF"), 0.35)];
  }, [foliageColors]);

  const fallingLeafCount = ambientCountForViewport(ambientParticles?.fallingLeafCount ?? 0);
  const blossomPetalCount = ambientCountForViewport(ambientParticles?.blossomPetalCount ?? 0);
  const fireflyCount = ambientCountForViewport(ambientParticles?.fireflyCount ?? 0);
  const snowDustCount = ambientCountForViewport(ambientParticles?.snowDustCount ?? 0);

  return (
    <group>
      {fallingLeafCount > 0 ? (
        <DrifterLayer
          particleCount={fallingLeafCount}
          areaRadius={treelineRadius * 0.8}
          seed={placementSeed + DRIFTER_SCATTER_SEED_SUFFIX}
          particleWidth={LEAF_WIDTH}
          particleHeight={LEAF_HEIGHT}
          particleColors={foliageColors}
          fallSpeedMinimum={LEAF_FALL_SPEED_MINIMUM}
          fallSpeedRange={LEAF_FALL_SPEED_RANGE}
        />
      ) : null}
      {blossomPetalCount > 0 ? (
        <DrifterLayer
          particleCount={blossomPetalCount}
          areaRadius={treelineRadius * 0.7}
          seed={placementSeed + DRIFTER_SCATTER_SEED_SUFFIX}
          particleWidth={PETAL_WIDTH}
          particleHeight={PETAL_HEIGHT}
          particleColors={petalColors}
          fallSpeedMinimum={PETAL_FALL_SPEED_MINIMUM}
          fallSpeedRange={PETAL_FALL_SPEED_RANGE}
        />
      ) : null}
      {fireflyCount > 0 ? (
        <GlowPointsLayer
          particleCount={fireflyCount}
          areaRadius={clearingRadius * 2.2}
          seed={placementSeed + FIREFLY_SCATTER_SEED_SUFFIX}
          color={FIREFLY_COLOR}
          pointSize={FIREFLY_POINT_SIZE}
          altitudeMinimum={FIREFLY_ALTITUDE_MINIMUM}
          altitudeRange={FIREFLY_ALTITUDE_RANGE}
          behavior="firefly"
        />
      ) : null}
      {snowDustCount > 0 ? (
        <GlowPointsLayer
          particleCount={snowDustCount}
          areaRadius={treelineRadius * 0.8}
          seed={placementSeed + SNOW_DUST_SCATTER_SEED_SUFFIX}
          color={SNOW_DUST_COLOR}
          pointSize={SNOW_DUST_POINT_SIZE}
          altitudeMinimum={0}
          altitudeRange={SNOW_DUST_CEILING}
          behavior="snowDust"
        />
      ) : null}
    </group>
  );
}

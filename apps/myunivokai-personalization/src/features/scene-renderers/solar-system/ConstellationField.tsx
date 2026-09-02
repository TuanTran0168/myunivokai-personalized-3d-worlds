"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Vector3, type Group } from "three";
import type { SceneConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { getSoftCircleTexture } from "../shared/softCircleTexture";
import { ZODIAC_CONSTELLATIONS } from "./constellationCatalog";

/**
 * Real zodiac constellations on the celestial sphere. The seed picks WHICH
 * figures appear, WHERE they sit and how they are rotated — so every world
 * still has its own personal sky — but the figures themselves are the
 * recognizable star-map shapes from the catalog, drawn like classic
 * constellation art: big glowing anchor stars, small companion stars, thin
 * connecting lines that stop short of the stars the way star charts draw
 * them. Everything tunable comes from the scene config's
 * `sky.constellations` section that the backend stores per world (figure
 * count, tints, mood glow, drift speed, seed); the theme/bloom fallbacks
 * below only serve worlds created before schemaVersion 1.1.
 */

const DEFAULT_CONSTELLATION_DISPLAY_COUNT = 8;
// Just inside the Skybox sphere (radius 60) so stars never clip through it.
const CELESTIAL_SPHERE_RADIUS = 52;
// Chord size of one figure's patch on the unit sphere (~24 degrees of sky).
const CONSTELLATION_PATCH_SIZE = 0.42;
// Bias anchors away from the poles, where the tangent patch distorts.
const POLE_AVOIDANCE_RATIO = 0.7;
// The figures drift a touch faster than the Milky Way behind them, giving
// the sky gentle parallax while orbiting.
const DEFAULT_CONSTELLATION_ROTATION_RADIANS_PER_SECOND = 0.005;
const MAXIMUM_ROTATION_RADIANS_PER_SECOND = 0.05;
// Drawn after the Milky Way's dark dust clouds (render order 1): the figures
// sit INSIDE the dust sphere, so without this the dust would dim them.
const CONSTELLATION_RENDER_ORDER = 2;

const MAJOR_STAR_POINT_SIZE = 1.1;
const MINOR_STAR_POINT_SIZE = 0.5;
const STAR_OPACITY = 0.95;
const LINE_OPACITY = 0.26;
// Star charts leave a gap between the connecting line and the star it joins;
// each segment is shortened by this fraction at both ends.
const LINE_ENDPOINT_GAP_RATIO = 0.08;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
// Mood (via bloom intensity) scales the glow; clamped so a reflective world
// stays readable and an energetic one does not blow out.
const MINIMUM_MOOD_GLOW_MULTIPLIER = 0.7;
const MAXIMUM_MOOD_GLOW_MULTIPLIER = 1.3;

type ConstellationTint = {
  starColor: string;
  lineColor: string;
};

// One tint pair per world style, so switching the style visibly recolors the
// night sky along with the orbits.
const THEME_CONSTELLATION_TINTS: Record<string, ConstellationTint> = {
  "cosmic-galaxy": { starColor: "#EAF2FF", lineColor: "#8FB6FF" },
  nebula: { starColor: "#F3E8FF", lineColor: "#C084FC" },
  crystal: { starColor: "#EAFBFF", lineColor: "#7DD3FC" },
  aurora: { starColor: "#ECFFF6", lineColor: "#6EE7B7" },
  "cyber-orbit": { starColor: "#E6FDFF", lineColor: "#22D3EE" }
};
const DEFAULT_CONSTELLATION_TINT: ConstellationTint = { starColor: "#F2EEE6", lineColor: "#D9B96E" };

type ConstellationFieldProps = {
  seed: string;
  scene: SceneConfig;
};

type ConstellationGeometry = {
  majorStarPositions: Float32Array;
  minorStarPositions: Float32Array;
  linePositions: Float32Array;
};

const WORLD_UP = new Vector3(0, 1, 0);

function buildConstellationGeometry(seed: string, displayCount: number): ConstellationGeometry {
  const random = randomFromSeed(`${seed}-constellations`);
  const majorStarVertices: number[] = [];
  const minorStarVertices: number[] = [];
  const lineVertices: number[] = [];

  // Seeded shuffle picks which zodiac figures this world's sky shows.
  const figureIndices = ZODIAC_CONSTELLATIONS.map((_, figureIndex) => figureIndex);
  for (let shuffleIndex = figureIndices.length - 1; shuffleIndex > 0; shuffleIndex -= 1) {
    const swapIndex = Math.floor(random() * (shuffleIndex + 1));
    [figureIndices[shuffleIndex], figureIndices[swapIndex]] = [figureIndices[swapIndex], figureIndices[shuffleIndex]];
  }
  const chosenFigures = figureIndices.slice(0, displayCount);

  for (const figureIndex of chosenFigures) {
    const figure = ZODIAC_CONSTELLATIONS[figureIndex];

    // Anchor direction on the sphere + a tangent-plane basis around it.
    const anchorAzimuthRadians = random() * Math.PI * 2;
    const anchorPolarRadians = Math.acos((random() * 2 - 1) * POLE_AVOIDANCE_RATIO);
    const anchorDirection = new Vector3(
      Math.sin(anchorPolarRadians) * Math.cos(anchorAzimuthRadians),
      Math.cos(anchorPolarRadians),
      Math.sin(anchorPolarRadians) * Math.sin(anchorAzimuthRadians)
    );
    const tangentEast = new Vector3().crossVectors(WORLD_UP, anchorDirection).normalize();
    const tangentNorth = new Vector3().crossVectors(anchorDirection, tangentEast).normalize();

    // Each figure gets a seeded roll so the same constellation can appear in
    // any orientation, like a real star map turned overhead.
    const patchRollRadians = random() * Math.PI * 2;
    const rollCosine = Math.cos(patchRollRadians);
    const rollSine = Math.sin(patchRollRadians);

    const starPointsOnSphere: Vector3[] = figure.stars.map((star) => {
      const centeredX = star.x - 0.5;
      const centeredY = star.y - 0.5;
      const rolledX = centeredX * rollCosine - centeredY * rollSine;
      const rolledY = centeredX * rollSine + centeredY * rollCosine;
      return new Vector3()
        .copy(anchorDirection)
        .addScaledVector(tangentEast, rolledX * CONSTELLATION_PATCH_SIZE)
        .addScaledVector(tangentNorth, rolledY * CONSTELLATION_PATCH_SIZE)
        .normalize()
        .multiplyScalar(CELESTIAL_SPHERE_RADIUS);
    });

    figure.stars.forEach((star, starIndex) => {
      const target = star.isMajor ? majorStarVertices : minorStarVertices;
      const point = starPointsOnSphere[starIndex];
      target.push(point.x, point.y, point.z);
    });

    for (const [fromIndex, toIndex] of figure.lineIndexPairs) {
      const fromPoint = starPointsOnSphere[fromIndex];
      const toPoint = starPointsOnSphere[toIndex];
      // Shrink both ends so the line never touches the star glow (chart style).
      const gappedFrom = new Vector3().lerpVectors(fromPoint, toPoint, LINE_ENDPOINT_GAP_RATIO);
      const gappedTo = new Vector3().lerpVectors(fromPoint, toPoint, 1 - LINE_ENDPOINT_GAP_RATIO);
      lineVertices.push(gappedFrom.x, gappedFrom.y, gappedFrom.z, gappedTo.x, gappedTo.y, gappedTo.z);
    }
  }

  return {
    majorStarPositions: new Float32Array(majorStarVertices),
    minorStarPositions: new Float32Array(minorStarVertices),
    linePositions: new Float32Array(lineVertices)
  };
}

export function ConstellationField({ seed, scene }: ConstellationFieldProps) {
  // Everything below prefers the backend-stored sky.constellations config and
  // falls back to the theme/bloom-derived defaults for pre-1.1 worlds.
  const skyConstellations = scene.sky?.constellations;
  const figuresSeed =
    typeof skyConstellations?.seed === "string" && skyConstellations.seed.length > 0 ? skyConstellations.seed : seed;
  const displayCount =
    typeof skyConstellations?.displayCount === "number" && Number.isFinite(skyConstellations.displayCount)
      ? Math.min(ZODIAC_CONSTELLATIONS.length, Math.max(0, Math.floor(skyConstellations.displayCount)))
      : DEFAULT_CONSTELLATION_DISPLAY_COUNT;

  const { majorStarPositions, minorStarPositions, linePositions } = useMemo(
    () => buildConstellationGeometry(figuresSeed, displayCount),
    [figuresSeed, displayCount]
  );
  const softCircleTexture = useMemo(() => getSoftCircleTexture(), []);
  const constellationGroupReference = useRef<Group>(null);

  const fallbackTint = THEME_CONSTELLATION_TINTS[scene.theme ?? ""] ?? DEFAULT_CONSTELLATION_TINT;
  const tint: ConstellationTint = {
    starColor:
      typeof skyConstellations?.starColor === "string" && HEX_COLOR_PATTERN.test(skyConstellations.starColor)
        ? skyConstellations.starColor
        : fallbackTint.starColor,
    lineColor:
      typeof skyConstellations?.lineColor === "string" && HEX_COLOR_PATTERN.test(skyConstellations.lineColor)
        ? skyConstellations.lineColor
        : fallbackTint.lineColor
  };
  const moodGlowMultiplier = Math.min(
    MAXIMUM_MOOD_GLOW_MULTIPLIER,
    Math.max(
      MINIMUM_MOOD_GLOW_MULTIPLIER,
      typeof skyConstellations?.glowMultiplier === "number" && Number.isFinite(skyConstellations.glowMultiplier)
        ? skyConstellations.glowMultiplier
        : scene.postFX?.bloomIntensity ?? 1
    )
  );
  const starOpacity = Math.min(1, STAR_OPACITY * moodGlowMultiplier);
  const lineOpacity = Math.min(1, LINE_OPACITY * moodGlowMultiplier);
  const rotationRadiansPerSecond =
    typeof skyConstellations?.rotationRadiansPerSecond === "number" &&
    Number.isFinite(skyConstellations.rotationRadiansPerSecond)
      ? Math.min(
          MAXIMUM_ROTATION_RADIANS_PER_SECOND,
          Math.max(-MAXIMUM_ROTATION_RADIANS_PER_SECOND, skyConstellations.rotationRadiansPerSecond)
        )
      : DEFAULT_CONSTELLATION_ROTATION_RADIANS_PER_SECOND;

  useFrame((_, deltaSeconds) => {
    if (constellationGroupReference.current) {
      constellationGroupReference.current.rotation.y += rotationRadiansPerSecond * deltaSeconds;
    }
  });

  return (
    <group ref={constellationGroupReference}>
      {/* frustumCulled=false everywhere: the auto bounding sphere of
          hand-built buffer geometry misjudges these sky-wide shells, so
          orbiting the camera made whole constellations pop in and out. */}
      <points frustumCulled={false} renderOrder={CONSTELLATION_RENDER_ORDER}>
        <bufferGeometry key={`${figuresSeed}:${displayCount}:major`}>
          <bufferAttribute attach="attributes-position" args={[majorStarPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={softCircleTexture ?? undefined}
          alphaTest={0.01}
          color={tint.starColor}
          size={MAJOR_STAR_POINT_SIZE}
          transparent
          opacity={starOpacity}
          sizeAttenuation
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
          fog={false}
        />
      </points>
      <points frustumCulled={false} renderOrder={CONSTELLATION_RENDER_ORDER}>
        <bufferGeometry key={`${figuresSeed}:${displayCount}:minor`}>
          <bufferAttribute attach="attributes-position" args={[minorStarPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={softCircleTexture ?? undefined}
          alphaTest={0.01}
          color={tint.starColor}
          size={MINOR_STAR_POINT_SIZE}
          transparent
          opacity={starOpacity}
          sizeAttenuation
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
          fog={false}
        />
      </points>
      <lineSegments frustumCulled={false} renderOrder={CONSTELLATION_RENDER_ORDER}>
        <bufferGeometry key={`${figuresSeed}:${displayCount}:lines`}>
          <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          color={tint.lineColor}
          transparent
          opacity={lineOpacity}
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
          fog={false}
        />
      </lineSegments>
    </group>
  );
}

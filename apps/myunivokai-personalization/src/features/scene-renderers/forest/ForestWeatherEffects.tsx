"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  AmbientLight,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  PointsMaterial,
  Quaternion,
  Vector3
} from "three";
import type { ForestLightingConfig, ForestTerrainConfig, ForestTreesConfig, ForestWeatherConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { getSoftCircleTexture } from "@/features/scene-renderers/shared/softCircleTexture";
import { getLightShaftTexture } from "@/features/scene-renderers/shared/lightShaftTexture";
import { clampValue, treelineRadiusFromTerrain } from "./forestMath";
import { sunDirectionFromLighting } from "./ForestSkyDome";

const MOBILE_VIEWPORT_MAXIMUM_WIDTH = 768;

const CLOUD_SCATTER_SEED_SUFFIX = "-clouds";
const RAIN_SCATTER_SEED_SUFFIX = "-rain";
const SNOW_SCATTER_SEED_SUFFIX = "-snowfall";
const SUN_RAY_SCATTER_SEED_SUFFIX = "-sunrays";

const MINIMUM_CLOUD_SPRITE_COUNT = 5;
const CLOUD_SPRITE_COUNT_PER_COVERAGE = 16;
const CLOUD_ALTITUDE_MINIMUM = 32;
const CLOUD_ALTITUDE_RANGE = 14;
const CLOUD_SCALE_MINIMUM = 16;
const CLOUD_SCALE_RANGE = 22;
const CLOUD_BASE_OPACITY = 0.16;
const CLOUD_OPACITY_PER_COVERAGE = 0.3;
// Visible drift ("thêm tí mây bay") — a slow but noticeable procession.
const CLOUD_DRIFT_RADIANS_PER_SECOND = 0.011;
const CLOUD_SUNNY_COLOR = "#FFFFFF";
const CLOUD_OVERCAST_COLOR = "#8E99A8";

// Storm lightning: heavy rain occasionally throws a cold double-flash across
// the whole scene (an ambient pulse — no geometry, reads as sheet lightning).
// Storms should actually feel like storms: the old 0.5 gate plus a 6-15s gap
// meant most rainy worlds flashed rarely or never. Any rain with real weight
// now carries a storm, and strikes come in a 3.5-10s window.
const LIGHTNING_MINIMUM_RAIN_INTENSITY = 0.4;
const LIGHTNING_MINIMUM_INTERVAL_SECONDS = 3.5;
const LIGHTNING_INTERVAL_RANGE_SECONDS = 6.5;
const LIGHTNING_FLASH_DURATION_SECONDS = 0.45;
const LIGHTNING_PEAK_INTENSITY = 2.6;
const LIGHTNING_COLOR = "#CFE0FF";

const PRECIPITATION_CEILING = 24;

// Rain renders as instanced streak quads aligned with the fall velocity —
// points read as dots, streaks read as rain.
const RAIN_STREAK_WIDTH = 0.03;
const RAIN_STREAK_LENGTH = 0.55;
const RAIN_FALL_SPEED_BASE = 16;
const RAIN_FALL_SPEED_PER_INTENSITY = 10;
const RAIN_COLOR = "#AFC6DB";
const RAIN_OPACITY = 0.42;
// Horizontal wind carry as a fraction of fall speed at windStrength 1.
const RAIN_WIND_CARRY_RATIO = 0.35;

const SNOW_FALL_SPEED_BASE = 1.4;
const SNOW_FALL_SPEED_PER_INTENSITY = 1.6;
const SNOW_SWAY_AMPLITUDE = 0.9;
const SNOW_SWAY_FREQUENCY = 0.7;
const SNOW_WIND_CARRY_UNITS_PER_SECOND = 1.6;
const SNOW_POINT_SIZE = 0.14;
const SNOW_COLOR = "#F4F8FC";
const SNOW_OPACITY = 0.9;

const SUN_RAY_SHAFT_COUNT = 6;
const SUN_RAY_LENGTH = 20;
const SUN_RAY_WIDTH = 1.6;
const SUN_RAY_BASE_OPACITY = 0.035;
const SUN_RAY_OPACITY_PER_INTENSITY = 0.045;

type ForestWeatherEffectsProps = {
  weather?: ForestWeatherConfig;
  lighting?: ForestLightingConfig;
  terrain?: ForestTerrainConfig;
  /** Wind lives under trees in the config; precipitation leans with it. */
  trees?: ForestTreesConfig;
  placementSeed: string;
};

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < MOBILE_VIEWPORT_MAXIMUM_WIDTH;
}

/** Wraps a coordinate into [-areaRadius, areaRadius] (wind blows drops out). */
function wrapIntoArea(value: number, areaRadius: number): number {
  if (value > areaRadius) {
    return value - areaRadius * 2;
  }
  if (value < -areaRadius) {
    return value + areaRadius * 2;
  }
  return value;
}

type RainStreaksLayerProps = {
  streakCount: number;
  areaRadius: number;
  seed: string;
  intensity: number;
  windDirectionRadians: number;
  windStrength: number;
};

/** Instanced rain streaks: one InstancedMesh, tilted into the wind. */
function RainStreaksLayer({ streakCount, areaRadius, seed, intensity, windDirectionRadians, windStrength }: RainStreaksLayerProps) {
  const positionsRef = useRef<Float32Array | null>(null);

  const fallSpeed = RAIN_FALL_SPEED_BASE + intensity * RAIN_FALL_SPEED_PER_INTENSITY;
  const windCarrySpeed = fallSpeed * RAIN_WIND_CARRY_RATIO * windStrength;
  const windDirectionX = Math.cos(windDirectionRadians);
  const windDirectionZ = Math.sin(windDirectionRadians);

  const { instancedMesh, streakOrientation } = useMemo(() => {
    const geometry = new PlaneGeometry(RAIN_STREAK_WIDTH, RAIN_STREAK_LENGTH);
    const material = new MeshBasicMaterial({
      color: new Color(RAIN_COLOR),
      transparent: true,
      opacity: RAIN_OPACITY,
      side: DoubleSide,
      depthWrite: false,
      fog: true
    });
    const mesh = new InstancedMesh(geometry, material, streakCount);
    const nextRandomValue = randomFromSeed(seed);
    const positions = new Float32Array(streakCount * 3);
    for (let streakIndex = 0; streakIndex < streakCount; streakIndex += 1) {
      const angle = nextRandomValue() * Math.PI * 2;
      const radius = Math.sqrt(nextRandomValue()) * areaRadius;
      positions[streakIndex * 3] = Math.cos(angle) * radius;
      positions[streakIndex * 3 + 1] = nextRandomValue() * PRECIPITATION_CEILING;
      positions[streakIndex * 3 + 2] = Math.sin(angle) * radius;
    }
    positionsRef.current = positions;
    // All streaks share one orientation: local +Y aligned with the fall
    // velocity (down plus the wind carry).
    const velocityDirection = new Vector3(
      windDirectionX * windCarrySpeed,
      -fallSpeed,
      windDirectionZ * windCarrySpeed
    ).normalize();
    const orientation = new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), velocityDirection);
    return { instancedMesh: mesh, streakOrientation: orientation };
  }, [areaRadius, fallSpeed, seed, streakCount, windCarrySpeed, windDirectionX, windDirectionZ]);

  useFrame((_, deltaTimeSeconds) => {
    const positions = positionsRef.current;
    if (!positions) {
      return;
    }
    const matrix = new Matrix4();
    const scale = new Vector3(1, 1, 1);
    const position = new Vector3();
    for (let streakIndex = 0; streakIndex < streakCount; streakIndex += 1) {
      let x = positions[streakIndex * 3] + windDirectionX * windCarrySpeed * deltaTimeSeconds;
      let y = positions[streakIndex * 3 + 1] - fallSpeed * deltaTimeSeconds;
      let z = positions[streakIndex * 3 + 2] + windDirectionZ * windCarrySpeed * deltaTimeSeconds;
      if (y < 0) {
        y += PRECIPITATION_CEILING;
      }
      x = wrapIntoArea(x, areaRadius);
      z = wrapIntoArea(z, areaRadius);
      positions[streakIndex * 3] = x;
      positions[streakIndex * 3 + 1] = y;
      positions[streakIndex * 3 + 2] = z;
      position.set(x, y, z);
      matrix.compose(position, streakOrientation, scale);
      instancedMesh.setMatrixAt(streakIndex, matrix);
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
  });

  return <primitive object={instancedMesh} />;
}

type SnowfallLayerProps = {
  flakeCount: number;
  areaRadius: number;
  seed: string;
  intensity: number;
  windDirectionRadians: number;
  windStrength: number;
};

/** Points snowfall: slow fall, sinus sway, carried sideways by the wind. */
function SnowfallLayer({ flakeCount, areaRadius, seed, intensity, windDirectionRadians, windStrength }: SnowfallLayerProps) {
  const elapsedSecondsRef = useRef(0);

  const { geometry, material, swayPhases } = useMemo(() => {
    const nextRandomValue = randomFromSeed(seed);
    const positions = new Float32Array(flakeCount * 3);
    const phases = new Float32Array(flakeCount);
    for (let flakeIndex = 0; flakeIndex < flakeCount; flakeIndex += 1) {
      const angle = nextRandomValue() * Math.PI * 2;
      const radius = Math.sqrt(nextRandomValue()) * areaRadius;
      positions[flakeIndex * 3] = Math.cos(angle) * radius;
      positions[flakeIndex * 3 + 1] = nextRandomValue() * PRECIPITATION_CEILING;
      positions[flakeIndex * 3 + 2] = Math.sin(angle) * radius;
      phases[flakeIndex] = nextRandomValue() * Math.PI * 2;
    }
    const bufferGeometry = new BufferGeometry();
    bufferGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const pointsMaterial = new PointsMaterial({
      color: new Color(SNOW_COLOR),
      size: SNOW_POINT_SIZE,
      transparent: true,
      opacity: SNOW_OPACITY,
      map: getSoftCircleTexture() ?? undefined,
      depthWrite: false,
      sizeAttenuation: true
    });
    return { geometry: bufferGeometry, material: pointsMaterial, swayPhases: phases };
  }, [areaRadius, flakeCount, seed]);

  useFrame((_, deltaTimeSeconds) => {
    elapsedSecondsRef.current += deltaTimeSeconds;
    const elapsedSeconds = elapsedSecondsRef.current;
    const positionAttribute = geometry.getAttribute("position");
    const fallSpeed = SNOW_FALL_SPEED_BASE + intensity * SNOW_FALL_SPEED_PER_INTENSITY;
    const windCarryX = Math.cos(windDirectionRadians) * SNOW_WIND_CARRY_UNITS_PER_SECOND * windStrength;
    const windCarryZ = Math.sin(windDirectionRadians) * SNOW_WIND_CARRY_UNITS_PER_SECOND * windStrength;
    for (let flakeIndex = 0; flakeIndex < flakeCount; flakeIndex += 1) {
      let flakeY = positionAttribute.getY(flakeIndex) - fallSpeed * deltaTimeSeconds;
      if (flakeY < 0) {
        flakeY += PRECIPITATION_CEILING;
      }
      positionAttribute.setY(flakeIndex, flakeY);
      const swayPhase = swayPhases[flakeIndex];
      const swayStep = Math.sin(elapsedSeconds * SNOW_SWAY_FREQUENCY + swayPhase) * SNOW_SWAY_AMPLITUDE * deltaTimeSeconds;
      positionAttribute.setX(
        flakeIndex,
        wrapIntoArea(positionAttribute.getX(flakeIndex) + swayStep + windCarryX * deltaTimeSeconds, areaRadius)
      );
      positionAttribute.setZ(
        flakeIndex,
        wrapIntoArea(positionAttribute.getZ(flakeIndex) + windCarryZ * deltaTimeSeconds, areaRadius)
      );
    }
    positionAttribute.needsUpdate = true;
  });

  return <points geometry={geometry} material={material} />;
}

type LightningFlashesProps = {
  seed: string;
};

/**
 * Sheet lightning during heavy rain: a seeded schedule of double-pulse
 * ambient flashes. The envelope is two spikes inside a short window — the
 * classic strike-then-echo rhythm.
 */
function LightningFlashes({ seed }: LightningFlashesProps) {
  const flashLightRef = useRef<AmbientLight>(null);
  const elapsedSecondsRef = useRef(0);
  const nextFlashAtSecondsRef = useRef<number | null>(null);
  const flashStartSecondsRef = useRef<number | null>(null);
  const nextIntervalRef = useRef(randomFromSeed(seed + "-lightning"));

  useFrame((_, deltaTimeSeconds) => {
    elapsedSecondsRef.current += deltaTimeSeconds;
    const elapsedSeconds = elapsedSecondsRef.current;
    if (nextFlashAtSecondsRef.current === null) {
      nextFlashAtSecondsRef.current =
        elapsedSeconds + LIGHTNING_MINIMUM_INTERVAL_SECONDS + nextIntervalRef.current() * LIGHTNING_INTERVAL_RANGE_SECONDS;
    }
    if (flashStartSecondsRef.current === null && elapsedSeconds >= nextFlashAtSecondsRef.current) {
      flashStartSecondsRef.current = elapsedSeconds;
      nextFlashAtSecondsRef.current =
        elapsedSeconds + LIGHTNING_MINIMUM_INTERVAL_SECONDS + nextIntervalRef.current() * LIGHTNING_INTERVAL_RANGE_SECONDS;
    }

    let flashIntensity = 0;
    if (flashStartSecondsRef.current !== null) {
      const flashAgeSeconds = elapsedSeconds - flashStartSecondsRef.current;
      if (flashAgeSeconds > LIGHTNING_FLASH_DURATION_SECONDS) {
        flashStartSecondsRef.current = null;
      } else {
        // Two decaying spikes: strike at t=0, echo at ~55% of the window.
        const normalizedAge = flashAgeSeconds / LIGHTNING_FLASH_DURATION_SECONDS;
        const firstSpike = Math.exp(-normalizedAge * 14);
        const echoSpike = normalizedAge > 0.55 ? Math.exp(-(normalizedAge - 0.55) * 18) * 0.7 : 0;
        flashIntensity = (firstSpike + echoSpike) * LIGHTNING_PEAK_INTENSITY;
      }
    }
    if (flashLightRef.current) {
      flashLightRef.current.intensity = flashIntensity;
    }
  });

  return <ambientLight ref={flashLightRef} color={LIGHTNING_COLOR} intensity={0} />;
}

/**
 * The weather layer: drifting cloud sprites scaled by coverage, wind-carried
 * rain streaks or snowfall gated by the weather kind (counts straight from
 * config), additive light shafts for sunRays, and sheet lightning in storms.
 */
export function ForestWeatherEffects({ weather, lighting, terrain, trees, placementSeed }: ForestWeatherEffectsProps) {
  const cloudGroupRef = useRef<Group>(null);
  const treelineRadius = treelineRadiusFromTerrain(terrain);
  const weatherKind = weather?.kind ?? "clear";
  const intensity = clampValue(weather?.intensity ?? 0.5, 0, 1);
  const cloudCoverage = clampValue(weather?.cloudCoverage ?? 0.15, 0, 1);
  const windDirectionRadians = trees?.windDirectionRadians ?? 0;
  const windStrength = clampValue(trees?.windStrength ?? 0.35, 0, 1);

  const cloudSprites = useMemo(() => {
    const cloudCount = MINIMUM_CLOUD_SPRITE_COUNT + Math.round(cloudCoverage * CLOUD_SPRITE_COUNT_PER_COVERAGE);
    const nextRandomValue = randomFromSeed(placementSeed + CLOUD_SCATTER_SEED_SUFFIX);
    return Array.from({ length: cloudCount }, (_, cloudIndex) => {
      const angle = nextRandomValue() * Math.PI * 2;
      const radius = nextRandomValue() * treelineRadius * 1.6;
      const altitude = CLOUD_ALTITUDE_MINIMUM + nextRandomValue() * CLOUD_ALTITUDE_RANGE;
      const scale = CLOUD_SCALE_MINIMUM + nextRandomValue() * CLOUD_SCALE_RANGE;
      return {
        key: `cloud-${cloudIndex}`,
        position: [Math.cos(angle) * radius, altitude, Math.sin(angle) * radius] as [number, number, number],
        scale
      };
    });
  }, [cloudCoverage, placementSeed, treelineRadius]);

  const sunRayShafts = useMemo(() => {
    if (weatherKind !== "sunRays") {
      return [];
    }
    const nextRandomValue = randomFromSeed(placementSeed + SUN_RAY_SCATTER_SEED_SUFFIX);
    const sunDirection = sunDirectionFromLighting(lighting);
    const shaftTiltRadians = Math.atan2(Math.hypot(sunDirection.x, sunDirection.z), sunDirection.y);
    const sunAzimuthRadians = Math.atan2(sunDirection.z, sunDirection.x);
    return Array.from({ length: SUN_RAY_SHAFT_COUNT }, (_, shaftIndex) => {
      const angle = nextRandomValue() * Math.PI * 2;
      const radius = nextRandomValue() * treelineRadius * 0.5;
      return {
        key: `sun-ray-${shaftIndex}`,
        position: [Math.cos(angle) * radius, SUN_RAY_LENGTH * 0.45, Math.sin(angle) * radius] as [number, number, number],
        rotation: [shaftTiltRadians * 0.8, -sunAzimuthRadians + Math.PI / 2, 0] as [number, number, number],
        widthScale: 0.7 + nextRandomValue() * 0.8
      };
    });
  }, [lighting, placementSeed, treelineRadius, weatherKind]);

  useFrame((_, deltaTimeSeconds) => {
    if (cloudGroupRef.current) {
      cloudGroupRef.current.rotation.y += CLOUD_DRIFT_RADIANS_PER_SECOND * deltaTimeSeconds;
    }
  });

  const softCircleTexture = getSoftCircleTexture();
  const mobileViewport = isMobileViewport();
  const rainDropCount = mobileViewport ? weather?.rainDropCountMobile ?? 0 : weather?.rainDropCountDesktop ?? 0;
  const snowflakeCount = mobileViewport ? weather?.snowflakeCountMobile ?? 0 : weather?.snowflakeCountDesktop ?? 0;
  const cloudColor = useMemo(
    () => new Color(CLOUD_SUNNY_COLOR).lerp(new Color(CLOUD_OVERCAST_COLOR), cloudCoverage),
    [cloudCoverage]
  );

  return (
    <group>
      {softCircleTexture ? (
        <group ref={cloudGroupRef}>
          {cloudSprites.map((cloud) => (
            <sprite key={cloud.key} position={cloud.position} scale={[cloud.scale, cloud.scale * 0.45, 1]}>
              <spriteMaterial
                map={softCircleTexture}
                color={cloudColor}
                transparent
                opacity={CLOUD_BASE_OPACITY + cloudCoverage * CLOUD_OPACITY_PER_COVERAGE}
                depthWrite={false}
              />
            </sprite>
          ))}
        </group>
      ) : null}

      {weatherKind === "rain" && rainDropCount > 0 ? (
        <RainStreaksLayer
          streakCount={rainDropCount}
          areaRadius={treelineRadius}
          seed={placementSeed + RAIN_SCATTER_SEED_SUFFIX}
          intensity={intensity}
          windDirectionRadians={windDirectionRadians}
          windStrength={windStrength}
        />
      ) : null}

      {weatherKind === "snow" && snowflakeCount > 0 ? (
        <SnowfallLayer
          flakeCount={snowflakeCount}
          areaRadius={treelineRadius}
          seed={placementSeed + SNOW_SCATTER_SEED_SUFFIX}
          intensity={intensity}
          windDirectionRadians={windDirectionRadians}
          windStrength={windStrength}
        />
      ) : null}

      {sunRayShafts.map((shaft) => (
        <mesh key={shaft.key} position={shaft.position} rotation={shaft.rotation}>
          <planeGeometry args={[SUN_RAY_WIDTH * shaft.widthScale, SUN_RAY_LENGTH]} />
          <meshBasicMaterial
            // The gradient map fades the beam toward its edges and foot —
            // without it the shafts render as hard-edged rectangles.
            map={getLightShaftTexture() ?? undefined}
            color={lighting?.sunColor ?? "#FFF6E5"}
            transparent
            opacity={(SUN_RAY_BASE_OPACITY + intensity * SUN_RAY_OPACITY_PER_INTENSITY) * 2.2}
            blending={AdditiveBlending}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}

      {weatherKind === "rain" && intensity >= LIGHTNING_MINIMUM_RAIN_INTENSITY ? (
        <LightningFlashes seed={placementSeed} />
      ) : null}
    </group>
  );
}

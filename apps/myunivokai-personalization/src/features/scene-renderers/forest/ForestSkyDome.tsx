"use client";

import { useMemo } from "react";
import { AdditiveBlending, BackSide, Color, Float32BufferAttribute, SphereGeometry, Vector3 } from "three";
import type { ForestLightingConfig, ForestWeatherConfig } from "@/lib/types";
import { getSoftCircleTexture } from "@/features/scene-renderers/shared/softCircleTexture";
import { clampValue, mixHexColors, smoothstepValue } from "./forestMath";

const SKY_DOME_RADIUS = 260;
const SKY_DOME_WIDTH_SEGMENTS = 32;
const SKY_DOME_HEIGHT_SEGMENTS = 24;

const SUN_SPRITE_DISTANCE = 235;
const SUN_DISC_SCALE = 26;
const SUN_GLOW_SCALE = 74;
const SUN_GLOW_OPACITY = 0.4;

// Zenith colors per time of day; the horizon always fades into the seasonal
// fog color so the treeline melts into the sky instead of cutting across it.
const ZENITH_COLORS_BY_TIME_OF_DAY: Record<string, string> = {
  day: "#79A8DC",
  goldenHour: "#7188B5",
  dusk: "#3D4A6B"
};
const DEFAULT_ZENITH_COLOR = ZENITH_COLORS_BY_TIME_OF_DAY.day;

const OVERCAST_SKY_COLOR = "#8C97A6";
const MAXIMUM_CLOUD_GRAY_BLEND = 0.75;

const BELOW_HORIZON_DARKEN = 0.55;

type ForestSkyDomeProps = {
  lighting?: ForestLightingConfig;
  weather?: ForestWeatherConfig;
};

export function sunDirectionFromLighting(lighting?: ForestLightingConfig): Vector3 {
  const elevation = lighting?.sunElevationRadians ?? 0.6;
  const azimuth = lighting?.sunAzimuthRadians ?? 0.9;
  return new Vector3(
    Math.cos(elevation) * Math.cos(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.sin(azimuth)
  ).normalize();
}

/**
 * Vertex-colored gradient dome (zenith by time of day, horizon = seasonal fog
 * color, grayed out by cloud coverage) plus a two-sprite sun: hot disc + wide
 * additive glow. toneMapped stays on so the sky sits in the same AgX response
 * as the lit forest.
 */
export function ForestSkyDome({ lighting, weather }: ForestSkyDomeProps) {
  const timeOfDay = lighting?.timeOfDay ?? "day";
  const fogColor = lighting?.fogColor ?? "#C4D2BE";
  const sunColor = lighting?.sunColor ?? "#FFF6E5";
  const cloudCoverage = clampValue(weather?.cloudCoverage ?? 0.15, 0, 1);

  const domeGeometry = useMemo(() => {
    const geometry = new SphereGeometry(SKY_DOME_RADIUS, SKY_DOME_WIDTH_SEGMENTS, SKY_DOME_HEIGHT_SEGMENTS);
    const zenithColor = mixHexColors(
      ZENITH_COLORS_BY_TIME_OF_DAY[timeOfDay] ?? DEFAULT_ZENITH_COLOR,
      OVERCAST_SKY_COLOR,
      cloudCoverage * MAXIMUM_CLOUD_GRAY_BLEND
    );
    const horizonColor = new Color(fogColor);
    const belowHorizonColor = horizonColor.clone().multiplyScalar(BELOW_HORIZON_DARKEN);

    const positionAttribute = geometry.getAttribute("position");
    const vertexColors = new Float32Array(positionAttribute.count * 3);
    const workingColor = new Color();
    for (let vertexIndex = 0; vertexIndex < positionAttribute.count; vertexIndex += 1) {
      const normalizedHeight = positionAttribute.getY(vertexIndex) / SKY_DOME_RADIUS;
      if (normalizedHeight >= 0) {
        workingColor.copy(horizonColor).lerp(zenithColor, smoothstepValue(0.03, 0.55, normalizedHeight));
      } else {
        workingColor.copy(horizonColor).lerp(belowHorizonColor, smoothstepValue(0, 0.35, -normalizedHeight));
      }
      vertexColors[vertexIndex * 3] = workingColor.r;
      vertexColors[vertexIndex * 3 + 1] = workingColor.g;
      vertexColors[vertexIndex * 3 + 2] = workingColor.b;
    }
    geometry.setAttribute("color", new Float32BufferAttribute(vertexColors, 3));
    return geometry;
  }, [cloudCoverage, fogColor, timeOfDay]);

  const sunPosition = useMemo(
    () => sunDirectionFromLighting(lighting).multiplyScalar(SUN_SPRITE_DISTANCE),
    [lighting]
  );
  const softCircleTexture = getSoftCircleTexture();
  // Heavy overcast hides the sun disc; a faint glow still marks its position.
  const sunDiscOpacity = 1 - smoothstepValue(0.45, 0.85, cloudCoverage);

  return (
    <group>
      <mesh geometry={domeGeometry}>
        <meshBasicMaterial vertexColors side={BackSide} fog={false} depthWrite={false} />
      </mesh>
      {softCircleTexture ? (
        <>
          <sprite position={sunPosition} scale={[SUN_DISC_SCALE, SUN_DISC_SCALE, 1]}>
            <spriteMaterial
              map={softCircleTexture}
              color={sunColor}
              transparent
              opacity={sunDiscOpacity}
              blending={AdditiveBlending}
              depthWrite={false}
              fog={false}
            />
          </sprite>
          <sprite position={sunPosition} scale={[SUN_GLOW_SCALE, SUN_GLOW_SCALE, 1]}>
            <spriteMaterial
              map={softCircleTexture}
              color={sunColor}
              transparent
              opacity={SUN_GLOW_OPACITY * (0.4 + 0.6 * sunDiscOpacity)}
              blending={AdditiveBlending}
              depthWrite={false}
              fog={false}
            />
          </sprite>
        </>
      ) : null}
    </group>
  );
}

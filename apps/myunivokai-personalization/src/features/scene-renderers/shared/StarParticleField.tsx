"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { type Group } from "three";
import type { SceneConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { SizedStarPoints, hexColorToUnitRgb, type StarLayerAttributes } from "./SizedStarPoints";

const DEFAULT_PARTICLE_DESKTOP_COUNT = 900;
const DEFAULT_PARTICLE_MOBILE_COUNT = 400;
const DEFAULT_PARTICLE_SPREAD = 16;
const PARTICLE_VERTICAL_SPREAD_RATIO = 0.6;
const PARTICLE_LAYER_OPACITY = 0.85;
const MOBILE_VIEWPORT_MAXIMUM_WIDTH = 768;
const DEFAULT_PARTICLE_COLOR = "#06B6D4";
// Nearest sky layer, so it drifts the fastest of the three (particles >
// constellations > Milky Way) for a subtle parallax depth cue.
const PARTICLE_ROTATION_RADIANS_PER_SECOND = 0.008;

// Power-law sizes: most drifting motes stay tiny pinpricks, a few glow
// bigger — the same size spread that keeps the Milky Way from reading as
// uniform confetti.
const PARTICLE_MINIMUM_SIZE = 0.03;
const PARTICLE_SIZE_RANGE = 0.12;
const PARTICLE_SIZE_POWER_LAW_EXPONENT = 3;
const PARTICLE_MINIMUM_BRIGHTNESS = 0.55;
// Drawn after the Milky Way's dark dust clouds (render order 1) so the
// nearest layer is never dimmed by dust that is physically far behind it.
const PARTICLE_RENDER_ORDER = 3;

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

type StarParticleFieldProps = {
  scene?: SceneConfig;
  seed: string;
  fallbackColor?: string;
};

function buildParticleStars(
  seed: string,
  particleCount: number,
  particleSpread: number,
  particleColorHex: string
): StarLayerAttributes {
  const random = randomFromSeed(`${seed}-particles`);
  const [baseRed, baseGreen, baseBlue] = hexColorToUnitRgb(particleColorHex);
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const twinklePhases = new Float32Array(particleCount);
  for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
    positions[particleIndex * 3] = (random() * 2 - 1) * particleSpread;
    positions[particleIndex * 3 + 1] = (random() * 2 - 1) * particleSpread * PARTICLE_VERTICAL_SPREAD_RATIO;
    positions[particleIndex * 3 + 2] = (random() * 2 - 1) * particleSpread;

    const sizeDraw = random();
    sizes[particleIndex] = PARTICLE_MINIMUM_SIZE + sizeDraw ** PARTICLE_SIZE_POWER_LAW_EXPONENT * PARTICLE_SIZE_RANGE;
    const brightness = PARTICLE_MINIMUM_BRIGHTNESS + (1 - PARTICLE_MINIMUM_BRIGHTNESS) * sizeDraw;
    colors[particleIndex * 3] = baseRed * brightness;
    colors[particleIndex * 3 + 1] = baseGreen * brightness;
    colors[particleIndex * 3 + 2] = baseBlue * brightness;

    twinklePhases[particleIndex] = random() * Math.PI * 2;
  }
  return { positions, colors, sizes, twinklePhases };
}

export function StarParticleField({ scene, seed, fallbackColor }: StarParticleFieldProps) {
  const particleConfig = scene?.particles;
  const isMobileViewport = typeof window !== "undefined" && window.innerWidth < MOBILE_VIEWPORT_MAXIMUM_WIDTH;
  const particleCount = isMobileViewport
    ? particleConfig?.mobileCount ?? DEFAULT_PARTICLE_MOBILE_COUNT
    : particleConfig?.desktopCount ?? DEFAULT_PARTICLE_DESKTOP_COUNT;
  const particleSpread = particleConfig?.spread ?? DEFAULT_PARTICLE_SPREAD;
  const requestedParticleColor = particleConfig?.color ?? fallbackColor ?? DEFAULT_PARTICLE_COLOR;
  // The star shader takes raw #RRGGBB components; any other color notation
  // falls back to the default so a bad config can't paint NaN colors.
  const particleColorHex = HEX_COLOR_PATTERN.test(requestedParticleColor)
    ? requestedParticleColor
    : DEFAULT_PARTICLE_COLOR;

  const particleStars = useMemo(
    () => buildParticleStars(seed, particleCount, particleSpread, particleColorHex),
    [seed, particleCount, particleSpread, particleColorHex]
  );
  const particleGroupReference = useRef<Group>(null);

  useFrame((_, deltaSeconds) => {
    if (particleGroupReference.current) {
      particleGroupReference.current.rotation.y += PARTICLE_ROTATION_RADIANS_PER_SECOND * deltaSeconds;
    }
  });

  return (
    <group ref={particleGroupReference}>
      <SizedStarPoints
        stars={particleStars}
        globalOpacity={PARTICLE_LAYER_OPACITY}
        renderOrder={PARTICLE_RENDER_ORDER}
        geometryKey={`${seed}:${particleCount}:${particleSpread}:${particleColorHex}`}
      />
    </group>
  );
}

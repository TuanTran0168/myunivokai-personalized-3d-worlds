"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { randomFromSeed } from "@/lib/scene";
import { SizedStarPoints, hexColorToUnitRgb, type StarLayerAttributes } from "../shared/SizedStarPoints";

/**
 * Rare-feature: a recurring meteor shower. A handful of seeded meteors streak
 * across the upper sky dome on staggered cycles — each meteor is a static
 * particle trail (reusing the star PSF shader, so heads glow and twinkle like
 * hot dust) whose GROUP is flown along a straight chord each frame, then
 * hidden until its next cycle. Far outside the planet orbits; pure scenery.
 */

const METEOR_COUNT = 6;
// Meteors fly at skybox distance, far outside planet orbits (~15 max) but
// inside the star field, so they read as atmosphere rather than objects.
const METEOR_SKY_RADIUS = 48;
const METEOR_PATH_LENGTH = 30;
const METEOR_MINIMUM_FLIGHT_DURATION_SECONDS = 1.4;
const METEOR_FLIGHT_DURATION_RANGE_SECONDS = 1.4;
// Each meteor repeats on its own period, so streaks arrive scattered instead
// of as a synchronized volley.
const METEOR_MINIMUM_CYCLE_PERIOD_SECONDS = 6;
const METEOR_CYCLE_PERIOD_RANGE_SECONDS = 9;
// Spawn heights on the sky dome, as fractions of the sky radius: high enough
// to stay above the orbital plane, below the zenith where tangents degenerate.
const METEOR_MINIMUM_SKY_HEIGHT_FRACTION = 0.2;
const METEOR_SKY_HEIGHT_FRACTION_RANGE = 0.5;

const TRAIL_PARTICLE_COUNT = 26;
const TRAIL_LENGTH = 3.4;
const TRAIL_POSITION_JITTER = 0.06;
const TRAIL_HEAD_PARTICLE_SIZE = 0.5;
const TRAIL_MINIMUM_PARTICLE_SIZE = 0.08;
const TRAIL_BRIGHTNESS_FALLOFF_EXPONENT = 1.7;
// The head burns white-hot; the tail cools toward the world's palette color.
const TRAIL_HEAD_COLOR = "#FFFFFF";

type MeteorFlightPath = {
  startPosition: [number, number, number];
  /** Unit direction of flight, tangent to the sky dome at the start point. */
  flightDirection: [number, number, number];
  flightDurationSeconds: number;
  cyclePeriodSeconds: number;
  cycleOffsetSeconds: number;
  trail: StarLayerAttributes;
};

function buildMeteorTrail(random: () => number, tailColorHex: string): StarLayerAttributes {
  const [tailRed, tailGreen, tailBlue] = hexColorToUnitRgb(tailColorHex);
  const [headRed, headGreen, headBlue] = hexColorToUnitRgb(TRAIL_HEAD_COLOR);
  const positions = new Float32Array(TRAIL_PARTICLE_COUNT * 3);
  const colors = new Float32Array(TRAIL_PARTICLE_COUNT * 3);
  const sizes = new Float32Array(TRAIL_PARTICLE_COUNT);
  const twinklePhases = new Float32Array(TRAIL_PARTICLE_COUNT);
  for (let particleIndex = 0; particleIndex < TRAIL_PARTICLE_COUNT; particleIndex += 1) {
    // Trail particles sit along local -Z (behind the head); the whole group is
    // aimed so that -Z matches the flight direction reversed.
    const trailFraction = particleIndex / (TRAIL_PARTICLE_COUNT - 1);
    positions[particleIndex * 3] = (random() * 2 - 1) * TRAIL_POSITION_JITTER;
    positions[particleIndex * 3 + 1] = (random() * 2 - 1) * TRAIL_POSITION_JITTER;
    positions[particleIndex * 3 + 2] = -trailFraction * TRAIL_LENGTH;

    const brightness = (1 - trailFraction) ** TRAIL_BRIGHTNESS_FALLOFF_EXPONENT;
    colors[particleIndex * 3] = (headRed + (tailRed - headRed) * trailFraction) * brightness;
    colors[particleIndex * 3 + 1] = (headGreen + (tailGreen - headGreen) * trailFraction) * brightness;
    colors[particleIndex * 3 + 2] = (headBlue + (tailBlue - headBlue) * trailFraction) * brightness;

    sizes[particleIndex] = Math.max(TRAIL_MINIMUM_PARTICLE_SIZE, TRAIL_HEAD_PARTICLE_SIZE * (1 - trailFraction));
    twinklePhases[particleIndex] = random() * Math.PI * 2;
  }
  return { positions, colors, sizes, twinklePhases };
}

function buildMeteorFlightPaths(meteorStreamSeed: string, tailColorHex: string): MeteorFlightPath[] {
  const random = randomFromSeed(meteorStreamSeed);
  const meteors: MeteorFlightPath[] = [];
  for (let meteorIndex = 0; meteorIndex < METEOR_COUNT; meteorIndex += 1) {
    const skyHeight =
      (METEOR_MINIMUM_SKY_HEIGHT_FRACTION + random() * METEOR_SKY_HEIGHT_FRACTION_RANGE) * METEOR_SKY_RADIUS;
    const spawnAzimuthRadians = random() * Math.PI * 2;
    const horizontalRadius = Math.sqrt(Math.max(0, METEOR_SKY_RADIUS ** 2 - skyHeight ** 2));
    const startX = Math.cos(spawnAzimuthRadians) * horizontalRadius;
    const startZ = Math.sin(spawnAzimuthRadians) * horizontalRadius;

    // Flight direction: a random tangent of the sky dome at the spawn point,
    // built from the local east/north basis around the radial direction.
    const radialX = startX / METEOR_SKY_RADIUS;
    const radialY = skyHeight / METEOR_SKY_RADIUS;
    const radialZ = startZ / METEOR_SKY_RADIUS;
    // East = normalize(worldUp x radial); the spawn height cap keeps the
    // radial away from the pole, so this never degenerates.
    const eastLength = Math.hypot(radialZ, radialX);
    const eastX = radialZ / eastLength;
    const eastZ = -radialX / eastLength;
    // North = radial x east (unit, since the factors are orthonormal).
    const northX = radialY * eastZ;
    const northY = radialZ * eastX - radialX * eastZ;
    const northZ = -radialY * eastX;
    const headingRadians = random() * Math.PI * 2;
    const headingCosine = Math.cos(headingRadians);
    const headingSine = Math.sin(headingRadians);

    meteors.push({
      startPosition: [startX, skyHeight, startZ],
      flightDirection: [
        eastX * headingCosine + northX * headingSine,
        northY * headingSine,
        eastZ * headingCosine + northZ * headingSine
      ],
      flightDurationSeconds:
        METEOR_MINIMUM_FLIGHT_DURATION_SECONDS + random() * METEOR_FLIGHT_DURATION_RANGE_SECONDS,
      cyclePeriodSeconds: METEOR_MINIMUM_CYCLE_PERIOD_SECONDS + random() * METEOR_CYCLE_PERIOD_RANGE_SECONDS,
      cycleOffsetSeconds: random() * METEOR_CYCLE_PERIOD_RANGE_SECONDS,
      trail: buildMeteorTrail(random, tailColorHex)
    });
  }
  return meteors;
}

type MeteorShowerProps = {
  seed: string;
  tailColorHex: string;
};

export function MeteorShower({ seed, tailColorHex }: MeteorShowerProps) {
  const meteors = useMemo(() => buildMeteorFlightPaths(`${seed}-meteor-shower`, tailColorHex), [seed, tailColorHex]);
  const meteorGroupReferences = useRef<(Group | null)[]>([]);

  useFrame(({ clock }) => {
    for (let meteorIndex = 0; meteorIndex < meteors.length; meteorIndex += 1) {
      const meteorGroup = meteorGroupReferences.current[meteorIndex];
      if (!meteorGroup) {
        continue;
      }
      const meteor = meteors[meteorIndex];
      const cycleTime = (clock.elapsedTime + meteor.cycleOffsetSeconds) % meteor.cyclePeriodSeconds;
      if (cycleTime >= meteor.flightDurationSeconds) {
        meteorGroup.visible = false;
        continue;
      }
      meteorGroup.visible = true;
      const flownDistance = (cycleTime / meteor.flightDurationSeconds) * METEOR_PATH_LENGTH;
      meteorGroup.position.set(
        meteor.startPosition[0] + meteor.flightDirection[0] * flownDistance,
        meteor.startPosition[1] + meteor.flightDirection[1] * flownDistance,
        meteor.startPosition[2] + meteor.flightDirection[2] * flownDistance
      );
    }
  });

  return (
    <>
      {meteors.map((meteor, meteorIndex) => (
        <group
          key={`${seed}-meteor-${meteorIndex}`}
          visible={false}
          ref={(meteorGroup) => {
            meteorGroupReferences.current[meteorIndex] = meteorGroup;
          }}
          // Aim local -Z along the flight direction so the trail drags behind.
          onUpdate={(meteorGroup) => {
            meteorGroup.lookAt(
              meteor.startPosition[0] + meteor.flightDirection[0],
              meteor.startPosition[1] + meteor.flightDirection[1],
              meteor.startPosition[2] + meteor.flightDirection[2]
            );
          }}
          position={meteor.startPosition}
        >
          <SizedStarPoints stars={meteor.trail} geometryKey={`${seed}-meteor-${meteorIndex}`} />
        </group>
      ))}
    </>
  );
}

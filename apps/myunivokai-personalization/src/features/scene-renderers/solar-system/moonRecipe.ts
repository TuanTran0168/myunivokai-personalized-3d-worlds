import { randomFromSeed } from "@/lib/scene";
import { hslToHexColor } from "./gasGiantRecipe";

/**
 * Pure recipe for a planet's procedural moon system: every visual parameter
 * (moon count, orbits, sizes, gray tints, crater layout) is drawn from one
 * dedicated PRNG stream, so the same world seed always grows the same moons.
 * The recipe knows nothing about three.js — geometry baking lives in
 * ProceduralMoons.tsx — which keeps this module unit-testable in node.
 *
 * All spatial values are RATIOS of the parent planet's rendered size, so one
 * recipe scales correctly to any planet.
 */

export const MOON_MAXIMUM_COUNT = 3;
// Cumulative probability thresholds for rolling 0 / 1 / 2 / 3 moons: an
// eligible planet keeps a 30% chance of staying moonless.
const MOON_COUNT_CUMULATIVE_THRESHOLDS = [0.3, 0.65, 0.88, 1] as const;

// Moon diameter as a fraction of the parent planet's rendered size.
const MOON_MINIMUM_SIZE_RATIO = 0.12;
const MOON_SIZE_RATIO_RANGE = 0.1;

// First moon orbit sits well clear of the planet surface; each further moon
// steps outward so orbits never overlap. The minimum is exported so the
// renderer can compute how far a ringed planet must shift its moon system.
export const MOON_FIRST_ORBIT_RADIUS_RATIO_MINIMUM = 1.7;
const MOON_FIRST_ORBIT_RADIUS_RATIO_RANGE = 0.5;
const MOON_ORBIT_RADIUS_RATIO_STEP_MINIMUM = 0.55;
const MOON_ORBIT_RADIUS_RATIO_STEP_RANGE = 0.35;

const MOON_ORBIT_MINIMUM_RADIANS_PER_SECOND = 0.18;
const MOON_ORBIT_RADIANS_PER_SECOND_RANGE = 0.3;
const MOON_ORBIT_MAXIMUM_INCLINATION_RADIANS = 0.35;

// Moons stay in the gray family: barely saturated, medium-light, random hue
// so some read slightly warm (rocky) and some slightly cool (icy).
const MOON_MINIMUM_LIGHTNESS = 0.55;
const MOON_LIGHTNESS_RANGE = 0.2;
const MOON_MINIMUM_SATURATION = 0.04;
const MOON_SATURATION_RANGE = 0.08;

const MOON_MINIMUM_CRATER_COUNT = 4;
const MOON_CRATER_COUNT_RANGE = 5;
const MOON_CRATER_MINIMUM_ANGULAR_RADIUS_RADIANS = 0.18;
const MOON_CRATER_ANGULAR_RADIUS_RANGE_RADIANS = 0.3;
const MOON_CRATER_MINIMUM_DEPTH_FRACTION = 0.03;
const MOON_CRATER_DEPTH_FRACTION_RANGE = 0.06;

// Baseline fBm bumpiness on top of the crater dents.
const MOON_MINIMUM_DISPLACEMENT_AMPLITUDE = 0.04;
const MOON_DISPLACEMENT_AMPLITUDE_RANGE = 0.05;

export type MoonCraterRecipe = {
  /** Unit direction of the crater center on the moon sphere. */
  directionX: number;
  directionY: number;
  directionZ: number;
  angularRadiusRadians: number;
  /** Bowl depth as a fraction of the moon radius. */
  depthFraction: number;
};

export type MoonRecipe = {
  surfaceNoiseSeed: string;
  /** Moon radius as a fraction of the parent planet's rendered size. */
  sizeRatio: number;
  /** Orbit radius in multiples of the parent planet's rendered size. */
  orbitRadiusRatio: number;
  orbitSpeedRadiansPerSecond: number;
  orbitPhaseRadians: number;
  orbitInclinationRadians: number;
  surfaceColorHex: string;
  displacementAmplitude: number;
  craters: MoonCraterRecipe[];
};

export type MoonSystemRecipe = {
  moons: MoonRecipe[];
};

function rollMoonCount(random: () => number): number {
  const roll = random();
  for (let moonCount = 0; moonCount < MOON_COUNT_CUMULATIVE_THRESHOLDS.length; moonCount += 1) {
    if (roll < MOON_COUNT_CUMULATIVE_THRESHOLDS[moonCount]) {
      return moonCount;
    }
  }
  return MOON_MAXIMUM_COUNT;
}

// Uniform direction on the unit sphere from two rolls.
function rollUnitSphereDirection(random: () => number): [number, number, number] {
  const z = random() * 2 - 1;
  const azimuthRadians = random() * Math.PI * 2;
  const horizontalRadius = Math.sqrt(Math.max(0, 1 - z * z));
  return [Math.cos(azimuthRadians) * horizontalRadius, Math.sin(azimuthRadians) * horizontalRadius, z];
}

export function buildMoonSystemRecipe(moonSystemSeed: string): MoonSystemRecipe {
  const random = randomFromSeed(`${moonSystemSeed}-recipe`);
  const moonCount = rollMoonCount(random);

  const moons: MoonRecipe[] = [];
  let orbitRadiusRatio =
    MOON_FIRST_ORBIT_RADIUS_RATIO_MINIMUM + random() * MOON_FIRST_ORBIT_RADIUS_RATIO_RANGE;
  for (let moonIndex = 0; moonIndex < moonCount; moonIndex += 1) {
    if (moonIndex > 0) {
      orbitRadiusRatio += MOON_ORBIT_RADIUS_RATIO_STEP_MINIMUM + random() * MOON_ORBIT_RADIUS_RATIO_STEP_RANGE;
    }

    const surfaceColorHex = hslToHexColor({
      hue: random(),
      saturation: MOON_MINIMUM_SATURATION + random() * MOON_SATURATION_RANGE,
      lightness: MOON_MINIMUM_LIGHTNESS + random() * MOON_LIGHTNESS_RANGE
    });

    const craterCount = MOON_MINIMUM_CRATER_COUNT + Math.floor(random() * (MOON_CRATER_COUNT_RANGE + 1));
    const craters: MoonCraterRecipe[] = [];
    for (let craterIndex = 0; craterIndex < craterCount; craterIndex += 1) {
      const [directionX, directionY, directionZ] = rollUnitSphereDirection(random);
      craters.push({
        directionX,
        directionY,
        directionZ,
        angularRadiusRadians:
          MOON_CRATER_MINIMUM_ANGULAR_RADIUS_RADIANS + random() * MOON_CRATER_ANGULAR_RADIUS_RANGE_RADIANS,
        depthFraction: MOON_CRATER_MINIMUM_DEPTH_FRACTION + random() * MOON_CRATER_DEPTH_FRACTION_RANGE
      });
    }

    moons.push({
      surfaceNoiseSeed: `${moonSystemSeed}-moon-${moonIndex}-surface`,
      sizeRatio: MOON_MINIMUM_SIZE_RATIO + random() * MOON_SIZE_RATIO_RANGE,
      orbitRadiusRatio,
      orbitSpeedRadiansPerSecond:
        MOON_ORBIT_MINIMUM_RADIANS_PER_SECOND + random() * MOON_ORBIT_RADIANS_PER_SECOND_RANGE,
      orbitPhaseRadians: random() * Math.PI * 2,
      orbitInclinationRadians: (random() * 2 - 1) * MOON_ORBIT_MAXIMUM_INCLINATION_RADIANS,
      surfaceColorHex,
      displacementAmplitude:
        MOON_MINIMUM_DISPLACEMENT_AMPLITUDE + random() * MOON_DISPLACEMENT_AMPLITUDE_RANGE,
      craters
    });
  }

  return { moons };
}

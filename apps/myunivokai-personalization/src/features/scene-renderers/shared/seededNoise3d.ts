import { hashSeed } from "@/lib/scene";

/**
 * Deterministic 3D value noise + fractal sum, seeded by string — the scene
 * code's no-Math.random rule applied to volumetric shapes (asteroid surfaces,
 * comet nuclei). Value noise on an integer lattice with smoothstep-weighted
 * trilinear interpolation; ~[-1, 1] output.
 */

const LATTICE_PRIME_X = 374761393;
const LATTICE_PRIME_Y = 668265263;
const LATTICE_PRIME_Z = 1440662683;
const HASH_MIX_PRIME = 1274126177;

function latticeHash(seedHash: number, latticeX: number, latticeY: number, latticeZ: number): number {
  let hash =
    seedHash ^
    Math.imul(latticeX, LATTICE_PRIME_X) ^
    Math.imul(latticeY, LATTICE_PRIME_Y) ^
    Math.imul(latticeZ, LATTICE_PRIME_Z);
  hash = Math.imul(hash ^ (hash >>> 13), HASH_MIX_PRIME);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

function smoothInterpolationWeight(fraction: number): number {
  return fraction * fraction * (3 - 2 * fraction);
}

export type Noise3dSource = (x: number, y: number, z: number) => number;

export function createSeededNoise3d(seed: string): Noise3dSource {
  const seedHash = hashSeed(seed) || 1;
  return (x, y, z) => {
    const latticeX = Math.floor(x);
    const latticeY = Math.floor(y);
    const latticeZ = Math.floor(z);
    const weightX = smoothInterpolationWeight(x - latticeX);
    const weightY = smoothInterpolationWeight(y - latticeY);
    const weightZ = smoothInterpolationWeight(z - latticeZ);
    const corner = (dx: number, dy: number, dz: number) =>
      latticeHash(seedHash, latticeX + dx, latticeY + dy, latticeZ + dz);
    const bottomFront = corner(0, 0, 0) + (corner(1, 0, 0) - corner(0, 0, 0)) * weightX;
    const topFront = corner(0, 1, 0) + (corner(1, 1, 0) - corner(0, 1, 0)) * weightX;
    const bottomBack = corner(0, 0, 1) + (corner(1, 0, 1) - corner(0, 0, 1)) * weightX;
    const topBack = corner(0, 1, 1) + (corner(1, 1, 1) - corner(0, 1, 1)) * weightX;
    const front = bottomFront + (topFront - bottomFront) * weightY;
    const back = bottomBack + (topBack - bottomBack) * weightY;
    return (front + (back - front) * weightZ) * 2 - 1;
  };
}

export function fractalNoise3d(
  noise: Noise3dSource,
  x: number,
  y: number,
  z: number,
  octaveCount: number,
  lacunarity = 2,
  gain = 0.5
): number {
  let amplitude = 1;
  let frequency = 1;
  let amplitudeSum = 0;
  let noiseSum = 0;
  for (let octaveIndex = 0; octaveIndex < octaveCount; octaveIndex += 1) {
    noiseSum += noise(x * frequency, y * frequency, z * frequency) * amplitude;
    amplitudeSum += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return noiseSum / amplitudeSum;
}

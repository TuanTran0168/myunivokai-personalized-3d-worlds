import { createContext, useContext } from "react";

/**
 * Live world-space terrain height under the camera, published by whichever
 * family renderer has a ground plane the camera can clip through.
 *
 * Mirrors PlanetPositionTracker's shape: a mutable box read imperatively
 * inside CameraRig's useFrame, not a value that re-renders anything. A family
 * with no ground plane (universe) never sets it, and CameraRig's clamp is a
 * no-op when it is null.
 */
export type TerrainHeightSampler = { current: ((x: number, z: number) => number) | null };

export const TerrainHeightSamplerContext = createContext<TerrainHeightSampler>({ current: null });

export function useTerrainHeightSampler(): TerrainHeightSampler {
  return useContext(TerrainHeightSamplerContext);
}

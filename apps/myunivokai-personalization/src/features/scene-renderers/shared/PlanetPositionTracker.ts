import { createContext, useContext } from "react";
import type { Vector3 } from "three";

/**
 * Shared registry of live object world-positions inside the 3D scene.
 *
 * Renderers write the position of each selectable object (planet, building,
 * cloud...) every frame; the CameraRig reads the selected object's position to
 * fly the camera toward it. Keyed by the object's identity key.
 */
export type PlanetPositionTracker = Map<string, Vector3>;

export const PlanetPositionTrackerContext = createContext<PlanetPositionTracker>(new Map());

export function usePlanetPositionTracker(): PlanetPositionTracker {
  return useContext(PlanetPositionTrackerContext);
}

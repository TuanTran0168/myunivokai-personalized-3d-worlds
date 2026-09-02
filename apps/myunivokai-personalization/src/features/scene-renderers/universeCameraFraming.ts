import type { SceneCameraConfig } from "@/lib/types";

/**
 * The opening camera for a universe scene, as pure numbers.
 *
 * These used to live as private constants inside UniverseCanvas, which meant
 * anything that needed to place an object IN FRAME had to guess them. The
 * distant black hole guessed wrong and parked itself behind the camera on most
 * seeds (see distantBlackHolePlacement). One module now owns the opening shot,
 * and everything that has to agree with it imports from here.
 *
 * Forest scenes do NOT use this: their opening shot is solved against the lake
 * the renderer builds (forestShoreCameraFraming).
 */

export const DEFAULT_CAMERA_DISTANCE = 9;
export const DEFAULT_CAMERA_FIELD_OF_VIEW = 50;
export const CAMERA_HEIGHT_RATIO = 0.42;

export function cameraDistanceFromConfig(camera?: SceneCameraConfig): number {
  return camera?.distance ?? DEFAULT_CAMERA_DISTANCE;
}

export function cameraFieldOfViewFromConfig(camera?: SceneCameraConfig): number {
  return camera?.fov ?? DEFAULT_CAMERA_FIELD_OF_VIEW;
}

/**
 * Where the camera sits on the first frame: on the +Z axis, lifted so the
 * orbital plane reads as a plane instead of a line. It always looks at the
 * origin, so this position alone fixes the whole view axis.
 */
export function universeCameraPosition(camera?: SceneCameraConfig): [number, number, number] {
  const distance = cameraDistanceFromConfig(camera);
  return [0, distance * CAMERA_HEIGHT_RATIO, distance];
}

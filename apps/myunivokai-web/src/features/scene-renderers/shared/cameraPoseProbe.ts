/**
 * Where the lens actually is, published on `window` so an end-to-end test can
 * assert on it.
 *
 * This lives in shipped code rather than in a test helper on purpose. The one
 * spec that drives the camera (`e2e/ocean-look-down.spec.ts`) measured FRAME
 * STATISTICS and nothing else, and a threshold on pixels cannot tell "the
 * camera did not breach the surface" from "the camera did not move at all". It
 * stayed green through the entire life of the bug it is named after, and a
 * control run with the fix reverted passed with numbers within noise of the
 * fixed build — because the drag never reached `OrbitControls`. Only the
 * camera's own pose separates those two readings, and it has to be read out of
 * the same production bundle a visitor gets, or the test is proving something
 * about a build nobody runs.
 *
 * The cost is one write of ten numbers into a pre-allocated object per frame:
 * the object is created once and mutated afterwards, so a published pose
 * allocates nothing after the first frame.
 */

/**
 * The property on `window` the pose is published under. Imported by the spec
 * rather than retyped there — a probe whose two ends disagree about the key
 * reads as "the camera never moved", which is the exact failure this replaces.
 */
export const CAMERA_POSE_WINDOW_KEY = "myunivokaiCameraPose";

/** A camera pose as the rig measured it, in scene metres and radians. */
export type CameraPoseMeasurement = {
  positionX: number;
  positionY: number;
  positionZ: number;
  /** What the orbit is looking at — the pose is meaningless without it. */
  targetX: number;
  targetY: number;
  targetZ: number;
  /** Distance from the camera to the orbit target. What the wheel changes. */
  orbitRadiusMetres: number;
  /** Measured down from +Y, the way `OrbitControls` measures it. */
  polarAngleRadians: number;
  azimuthAngleRadians: number;
  /**
   * The height the rig has been told the lens may not pass, or `null` where the
   * family sets none. Published alongside the pose rather than recomputed by
   * the reader: the invariant worth asserting is that the camera stayed under
   * the ceiling THIS RIG WAS GIVEN, and a test that solves for its own ceiling
   * is testing its own arithmetic.
   */
  ceilingMetres: number | null;
};

/**
 * A published pose, which is a measurement plus the count of frames that have
 * been published since the scene mounted. The count is what lets a reader tell
 * a live scene from a stale global left behind by the previous one.
 */
export type PublishedCameraPose = CameraPoseMeasurement & {
  publishedFrameCount: number;
};

/**
 * Anything the pose can be published onto. `window` in the app; a plain object
 * in a test, which is what keeps this module checkable without a DOM.
 */
export type CameraPoseHost = {
  [CAMERA_POSE_WINDOW_KEY]?: PublishedCameraPose;
};

declare global {
  // Declared so the rig can publish onto the real `window` without a cast, and
  // so a reader in the browser gets the pose's shape rather than `unknown`.
  interface Window {
    [CAMERA_POSE_WINDOW_KEY]?: PublishedCameraPose;
  }
}

/**
 * Writes the pose onto the host, creating the record on the first frame and
 * mutating it on every frame after.
 */
export function publishCameraPose(host: CameraPoseHost, measurement: CameraPoseMeasurement): void {
  const publishedPose = host[CAMERA_POSE_WINDOW_KEY];
  if (!publishedPose) {
    host[CAMERA_POSE_WINDOW_KEY] = { ...measurement, publishedFrameCount: 1 };
    return;
  }
  publishedPose.positionX = measurement.positionX;
  publishedPose.positionY = measurement.positionY;
  publishedPose.positionZ = measurement.positionZ;
  publishedPose.targetX = measurement.targetX;
  publishedPose.targetY = measurement.targetY;
  publishedPose.targetZ = measurement.targetZ;
  publishedPose.orbitRadiusMetres = measurement.orbitRadiusMetres;
  publishedPose.polarAngleRadians = measurement.polarAngleRadians;
  publishedPose.azimuthAngleRadians = measurement.azimuthAngleRadians;
  publishedPose.ceilingMetres = measurement.ceilingMetres;
  publishedPose.publishedFrameCount += 1;
}

/**
 * Clears any pose left on the host. Called when a scene unmounts, so a reader
 * that arrives before the next scene's first frame gets nothing rather than the
 * previous world's camera.
 */
export function clearCameraPose(host: CameraPoseHost): void {
  delete host[CAMERA_POSE_WINDOW_KEY];
}

/** The pose the host currently carries, or `null` if no scene has published one. */
export function readCameraPose(host: CameraPoseHost): PublishedCameraPose | null {
  return host[CAMERA_POSE_WINDOW_KEY] ?? null;
}

import type { SceneCameraConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { cameraFieldOfViewFromConfig, universeCameraPosition } from "@/features/scene-renderers/universeCameraFraming";
import { BLACK_HOLE_TARGET_SIZE } from "./spacecraftCatalog";

/**
 * Seeded placement for the rare distant black hole, solved AGAINST the opening
 * camera instead of against a bare world radius.
 *
 * The bug this replaces: the old placement picked a full-circle azimuth on a
 * radius-18 ring at a fixed elevation. The camera sits at ~9 on +Z looking at
 * the origin through a 50 degree lens, so most of that circle is beside or
 * BEHIND the camera. On a real published world (seed WLD-DR3HMIJRZ2) the black
 * hole landed 157 degrees off the view axis — dead behind the viewer. The
 * RareFeatureBadge still announced "Black Hole", so the world looked like it
 * had silently lost a feature, and it read as a share/create mismatch even
 * though the seed and the scene config were byte-identical on both pages.
 *
 * The fix keeps the seeded variety but expresses it in CAMERA-RELATIVE terms:
 * a depth beyond the system, then a screen-space offset bounded by how much
 * room the frame actually has left once the model's own size is subtracted.
 * The object is therefore in frame on the first paint of every seed, and the
 * invariant is a unit test rather than a hand-tuned constant.
 */

// Depth is measured from the ORIGIN along the view axis, not from the camera:
// that keeps the black hole beyond the outermost planet orbit (~11) no matter
// what camera distance the backend rolled (7 to 12 today), and it stays inside
// the skybox shell (radius 60, Skybox.tsx).
//
// This band is deliberately further out than the ring it replaces. The model is
// normalized to 13 units across, which at the old depth spanned more than half
// the frame height and left almost no room to offset it off the sun. Out here it
// reads as roughly a third of the frame — distant and large — with room to sit
// clear of the sun's bloom.
const DEPTH_BEYOND_ORIGIN_MINIMUM = 26;
const DEPTH_BEYOND_ORIGIN_MAXIMUM = 34;

// Keep the model's silhouette off the frame edge even at the extreme of the
// seeded offset, so it never reads as a half-cropped artifact.
const FRAME_EDGE_MARGIN = 1.5;

// The disk must clear the sun, so the frame has to have at least this much room
// left for the offset once the model and the margin are paid for. A narrow lens
// buys the room by pushing the black hole further out — the alternative is a
// silhouette pinned to the view axis, eclipsed by the sun.
const MINIMUM_FRAME_ROOM = 5;

// Never park it dead centre: the seeded offset spans this fraction of the
// available room up to all of it.
const MINIMUM_OFFSET_FRACTION = 0.55;

// Offset direction around the view axis, measured from screen-right toward
// screen-up. Bounded away from horizontal so the black hole always sits in the
// upper half of the FRAME — above the orbital ellipse the planets and the
// asteroid belt draw, against open star field, which is the only clean backdrop
// for a body this large. (Screen space, not world space: the camera looks down
// at the origin, so a point above the view axis can still have a negative y.)
const OFFSET_DIRECTION_MINIMUM_DEGREES = 30;
const OFFSET_DIRECTION_MAXIMUM_DEGREES = 150;

// The disk is tilted off face-on so it reads as a disk rather than a ring, and
// yawed a full circle so no two worlds frame it identically.
const TILT_BASE_RADIANS = -0.5;
const TILT_VARIATION_RADIANS = 0.3;
const ROLL_RANGE_RADIANS = 0.3;

export type DistantBlackHolePlacement = {
  position: [number, number, number];
  tilt: [number, number, number];
};

function interpolate(minimum: number, maximum: number, fraction: number): number {
  return minimum + (maximum - minimum) * fraction;
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Half-height of the visible frame, in world units, at a given depth from the
 * camera. Grows linearly with depth, which is why a distant object has room to
 * be offset at all.
 */
export function frameHalfExtentAtDepth(depthFromCamera: number, fieldOfViewDegrees: number): number {
  return Math.tan(degreesToRadians(fieldOfViewDegrees) / 2) * depthFromCamera;
}

export function distantBlackHolePlacement(seed: string, camera?: SceneCameraConfig): DistantBlackHolePlacement {
  const random = randomFromSeed(`${seed}-black-hole-placement`);
  const cameraPosition = universeCameraPosition(camera);
  const fieldOfView = cameraFieldOfViewFromConfig(camera);
  const cameraDistanceFromOrigin = Math.hypot(...cameraPosition);

  // Screen basis at the origin: the camera always looks at the origin, so the
  // view axis is just the normalized camera position reversed.
  const forward = cameraPosition.map((component) => -component / cameraDistanceFromOrigin) as [
    number,
    number,
    number
  ];
  // World up crossed with the view axis gives screen-right; screen-right
  // crossed back with the axis closes the basis as screen-up. Both are unit
  // vectors because forward is unit and world up is never parallel to it (the
  // camera is lifted, not overhead).
  const screenRight: [number, number, number] = [-forward[2], 0, forward[0]];
  const screenRightLength = Math.hypot(...screenRight);
  const right = screenRight.map((component) => component / screenRightLength) as [number, number, number];
  const up: [number, number, number] = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0]
  ];

  // The frame is measured with a SQUARE aspect ratio — the narrowest viewport
  // the canvas is expected to fill — and the offset is bounded RADIALLY rather
  // than per-axis. A wider window only adds horizontal room, so a placement that
  // clears this circle clears every real viewport. (Bounding each axis
  // separately is what lets a corner offset creep out past the frame diagonal.)
  const halfFieldOfViewTangent = Math.tan(degreesToRadians(fieldOfView) / 2);
  const depthForMinimumRoom = (MINIMUM_FRAME_ROOM + BLACK_HOLE_TARGET_SIZE / 2 + FRAME_EDGE_MARGIN) / halfFieldOfViewTangent;
  const depthBeyondOrigin = interpolate(DEPTH_BEYOND_ORIGIN_MINIMUM, DEPTH_BEYOND_ORIGIN_MAXIMUM, random());
  const depthFromCamera = Math.max(cameraDistanceFromOrigin + depthBeyondOrigin, depthForMinimumRoom);

  // How far off the view axis the model's CENTRE may sit: the frame's half
  // extent at that depth, less the model's own half size and the edge margin.
  const offsetRoom =
    frameHalfExtentAtDepth(depthFromCamera, fieldOfView) - BLACK_HOLE_TARGET_SIZE / 2 - FRAME_EDGE_MARGIN;
  const offsetDistance = offsetRoom * interpolate(MINIMUM_OFFSET_FRACTION, 1, random());
  const offsetDirectionRadians = degreesToRadians(
    interpolate(OFFSET_DIRECTION_MINIMUM_DEGREES, OFFSET_DIRECTION_MAXIMUM_DEGREES, random())
  );
  const horizontalOffset = Math.cos(offsetDirectionRadians) * offsetDistance;
  const verticalOffset = Math.sin(offsetDirectionRadians) * offsetDistance;

  const position: [number, number, number] = [0, 1, 2].map(
    (axis) =>
      cameraPosition[axis] +
      forward[axis] * depthFromCamera +
      right[axis] * horizontalOffset +
      up[axis] * verticalOffset
  ) as [number, number, number];

  const tilt: [number, number, number] = [
    TILT_BASE_RADIANS - random() * TILT_VARIATION_RADIANS,
    random() * Math.PI * 2,
    random() * ROLL_RANGE_RADIANS - ROLL_RANGE_RADIANS / 2
  ];

  return { position, tilt };
}

/**
 * Off-axis angle, in degrees, between the opening view axis and the placed
 * black hole. Exported for the test that locks the in-frame invariant — and for
 * anyone who has to debug this the next time an object goes missing.
 */
export function blackHoleOffAxisDegrees(placement: DistantBlackHolePlacement, camera?: SceneCameraConfig): number {
  const cameraPosition = universeCameraPosition(camera);
  const toBlackHole = placement.position.map((component, axis) => component - cameraPosition[axis]);
  const forward = cameraPosition.map((component) => -component);
  const dotProduct = forward.reduce((sum, component, axis) => sum + component * toBlackHole[axis], 0);
  const cosine = dotProduct / (Math.hypot(...forward) * Math.hypot(...toBlackHole));
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
}

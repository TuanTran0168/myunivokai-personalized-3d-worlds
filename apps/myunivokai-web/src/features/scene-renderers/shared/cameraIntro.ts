/**
 * The opening camera move that plays once a scene's first frame exists.
 *
 * The canvas used to reveal itself by fading a spinner out over a camera that
 * was already parked exactly where it would stay — a cut, dressed up as a
 * crossfade. Nothing about it said "a world resolving around you". This module
 * holds the pure geometry of the move that replaces it: the camera starts a
 * little off the framing the family already solved for — further out, higher,
 * lower or further around, depending on which of CAMERA_INTRO_POSES this
 * world's seed lands on — and settles onto it.
 *
 * The move is expressed as a SPHERICAL OFFSET from the resting pose rather than
 * a position, because OrbitControls derives the camera position from
 * (target, spherical offset) on every update. Animating a raw position would be
 * overwritten by the first `update()` of the next frame; animating the offset is
 * the same language the controls themselves speak.
 *
 * Everything here is pure so the curve can be checked without a WebGL context.
 */

import { easeInOutCubic, lerp } from "@/lib/easing";
import { hashSeed } from "@/lib/scene";

/** Duration of the full cinematic entry used by the world and share routes. */
export const CAMERA_INTRO_DURATION_SECONDS = 2.2;
/**
 * The create page's live preview re-solves its framing on every option toggle,
 * so its entry has to read as a settle rather than an arrival — long enough to
 * be seen, short enough that toggling three options in a row is not three
 * cinematics queued behind each other.
 */
export const CAMERA_SETTLE_DURATION_SECONDS = 0.85;

export type CameraIntroPose = {
  /** Multiplier on the resting orbit radius. 1 = the resting distance. */
  radiusScale: number;
  /**
   * Added to the resting polar angle. Negative lifts the camera (polar angle is
   * measured down from +Y), so the move descends onto the framing rather than
   * rising into it — the descent is what reads as "settling".
   */
  polarOffsetRadians: number;
  /** Added to the resting azimuth: a slow sideways drift across the subject. */
  azimuthOffsetRadians: number;
};

/**
 * The shots a world can open on.
 *
 * One fixed pose made every world arrive the same way, and a gallery of six
 * worlds opened six times in a row is exactly where that shows. These are all
 * still "nhẹ" — a gentle drift, not a fly-through: a 10-30% pull-back is about
 * one step backwards at conversational distance, and the largest arc here is
 * 11 degrees, a shoulder turn. What varies is the CHARACTER of the step, not
 * its size.
 *
 * Two invariants hold across the whole set, and both are load-bearing.
 *
 * Every pose carries a non-zero AZIMUTH offset. Radius and polar angle can both
 * be clamped flat by a family's envelope — a forest shot already near its
 * 70-unit ceiling or grazing its ground plane has nowhere to go on those axes —
 * but a bearing wraps rather than stopping, so the sideways component is the
 * one thing guaranteed to survive any envelope. It is what stops a clamped pose
 * degenerating into no move at all.
 *
 * And no pose has a POSITIVE polar offset: every shot starts at or above the
 * resting elevation and descends onto it, never rises from below. Not a
 * stylistic rule. The ocean is the one family with a terrain sampler, its
 * camera sits at the viewer's own depth plane, and a scene composed a couple of
 * metres off the seabed has no room underneath it. A start pose that dipped
 * there would trip CameraRig's terrain clamp, which lifts the orbit TARGET
 * along with the camera — so the entrance would silently walk the framing
 * upward and hand back a resting shot the family never composed.
 */
export const CAMERA_INTRO_POSES: readonly CameraIntroPose[] = [
  // Pull back and settle. The original, and still the one that suits a solar
  // system seen whole from outside.
  { radiusScale: 1.22, polarOffsetRadians: -0.085, azimuthOffsetRadians: 0.09 },
  // Crane down: starts well above the framing and descends onto it. The most
  // overtly "establishing shot" of the set.
  { radiusScale: 1.12, polarOffsetRadians: -0.2, azimuthOffsetRadians: 0.035 },
  // High arc: lifted and swung the other way, so the descent and the turn are
  // both doing work. Between the crane and the swings in character.
  { radiusScale: 1.18, polarOffsetRadians: -0.15, azimuthOffsetRadians: -0.12 },
  // Swing left — almost pure lateral arc, barely any distance change.
  { radiusScale: 1.1, polarOffsetRadians: -0.03, azimuthOffsetRadians: -0.19 },
  // Swing right, and not a mirror of the left: an identical pair reads as one
  // shot flipped, which is worse than two that merely rhyme.
  { radiusScale: 1.09, polarOffsetRadians: -0.05, azimuthOffsetRadians: 0.185 },
  // The long approach. The biggest pull-back in the set, so it spends most of
  // the move covering distance rather than turning.
  { radiusScale: 1.3, polarOffsetRadians: -0.065, azimuthOffsetRadians: -0.11 }
];

/**
 * The pose used when nothing has asked for a particular one, and the default
 * every test measures the envelope clamps against.
 */
export const CAMERA_INTRO_START_POSE: CameraIntroPose = CAMERA_INTRO_POSES[0];

/**
 * Which shot this world opens on.
 *
 * Derived from the scene seed rather than rolled, so a world opens the same way
 * every time it is visited. That is the whole point: a shot that changes on
 * each viewing reads as the app being unable to decide, while a shot that is
 * always this world's shot reads as authored. Different worlds still differ,
 * which is what was asked for.
 */
export function pickCameraIntroPose(seed: string): CameraIntroPose {
  return CAMERA_INTRO_POSES[hashSeed(seed) % CAMERA_INTRO_POSES.length];
}

/**
 * The most wall-clock time a single frame may advance the move.
 *
 * Not a nicety — without it the move does not happen at all on a first load.
 * Measured on the world route: the scene's first frame lands, the entry arms,
 * ONE frame renders at the pulled-back start, and then the main thread blocks
 * for 4.2 seconds compiling shaders. The next frame arrives with a delta of
 * 4.2s, progress goes straight from ~0 to 1, and the camera cuts back to the
 * resting framing in a single 2.48-unit jump. The whole entrance, spent on a
 * frame nobody saw.
 *
 * A stall should PAUSE the move, not fast-forward through it: the move is about
 * time on screen, and no time on screen passed. 1/15 s is above any frame a
 * device that can run these scenes at all will produce, so on real hardware
 * this clamp never engages.
 */
export const CAMERA_INTRO_MAXIMUM_FRAME_SECONDS = 1 / 15;

/** Progress through the move, clamped so an over-long frame cannot overshoot. */
export function cameraIntroProgress(elapsedSeconds: number, durationSeconds: number): number {
  if (!(durationSeconds > 0)) {
    return 1;
  }
  return Math.min(1, Math.max(0, elapsedSeconds / durationSeconds));
}

/** How much of a frame's wall-clock time the move is allowed to consume. */
export function cameraIntroFrameSeconds(deltaTimeSeconds: number): number {
  if (!(deltaTimeSeconds > 0)) {
    return 0;
  }
  return Math.min(CAMERA_INTRO_MAXIMUM_FRAME_SECONDS, deltaTimeSeconds);
}

export type SphericalOffset = {
  radius: number;
  /** Down from +Y, in [0, PI]. */
  polarRadians: number;
  /** Around +Y, from +Z. */
  azimuthRadians: number;
};

export type SphericalOffsetLimits = {
  minimumRadius: number;
  maximumRadius: number;
  maximumPolarRadians: number;
};

/**
 * Where the move actually starts from, INSIDE the same envelope OrbitControls
 * will enforce on its next update.
 *
 * Resolved ONCE, at the top of the move, and the frames after it interpolate
 * between this and the resting offset. Clamping every frame instead — the
 * obvious way to write it — silently buys a dead hold: the forest's envelope
 * tops out at 70 units and its widest solved shots already sit near 60, so a
 * 1.22x pull-back asks for 73 and gets 70 back for as long as the eased request
 * stays above the ceiling. The camera would sit still through the opening
 * stretch of its own entrance and only then begin to move.
 *
 * The polar clamp is there for the same reason from the other side: the
 * forest's shallowest opening shot grazes the water at 85.7 degrees, and
 * lifting it further would jam it against that family's ground-plane clamp.
 */
export function cameraIntroStartOffset(
  restingOffset: SphericalOffset,
  limits: SphericalOffsetLimits,
  startPose: CameraIntroPose = CAMERA_INTRO_START_POSE
): SphericalOffset {
  const requestedRadius = restingOffset.radius * startPose.radiusScale;
  const requestedPolar = restingOffset.polarRadians + startPose.polarOffsetRadians;
  return {
    radius: Math.min(limits.maximumRadius, Math.max(limits.minimumRadius, requestedRadius)),
    // The lower bound is not 0: a polar angle of exactly 0 puts the camera on
    // the +Y axis, where the azimuth becomes undefined and OrbitControls' own
    // spherical round-trip loses the horizontal bearing entirely.
    polarRadians: Math.min(limits.maximumPolarRadians, Math.max(0.000001, requestedPolar)),
    azimuthRadians: restingOffset.azimuthRadians + startPose.azimuthOffsetRadians
  };
}

/**
 * The offset to fly the camera to this frame. Returns the resting offset
 * IDENTICALLY at progress 1 — a curve that lands at 0.999 leaves the camera a
 * hair off the framing each family composed its opening shot against.
 */
export function cameraIntroOffsetAt(
  startOffset: SphericalOffset,
  restingOffset: SphericalOffset,
  progress: number
): SphericalOffset {
  const eased = easeInOutCubic(progress);
  if (eased >= 1) {
    return restingOffset;
  }
  return {
    radius: lerp(startOffset.radius, restingOffset.radius, eased),
    polarRadians: lerp(startOffset.polarRadians, restingOffset.polarRadians, eased),
    azimuthRadians: lerp(startOffset.azimuthRadians, restingOffset.azimuthRadians, eased)
  };
}

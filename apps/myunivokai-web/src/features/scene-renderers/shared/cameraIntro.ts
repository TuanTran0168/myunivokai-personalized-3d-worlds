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
 * worlds opened six times in a row is exactly where that shows.
 *
 * These used to be much smaller — a 10-30% pull-back and at most an 11-degree
 * arc — and the owner's reading of the result was "it zooms slightly, doesn't
 * it". That was accurate: at those magnitudes the radius does almost all of the
 * work and the radius is the axis that reads LEAST as movement, because a
 * pull-back changes what is in frame without changing where you are standing.
 * The set is now roughly twice the size and the growth went mostly into the
 * bearing, which is the axis that reads as travel.
 *
 * It is also the axis that always survives. Which is the first of two
 * invariants, and both are load-bearing:
 *
 * Every pose carries a non-zero AZIMUTH offset. Radius and polar angle can both
 * be clamped flat by a family's envelope — a forest shot already near its
 * 70-unit ceiling or grazing its ground plane has nowhere to go on those axes —
 * but a bearing wraps rather than stopping, so the sideways component is the
 * one thing guaranteed to survive any envelope. It is what stops a clamped pose
 * degenerating into no move at all. Making the moves bigger made this MORE
 * important, not less: a bigger radius request is a request more likely to be
 * clamped away entirely.
 *
 * And no pose has a POSITIVE polar offset: every shot starts at or above the
 * resting elevation and descends onto it, never rises from below. Not a
 * stylistic rule. The ocean is the one family with a terrain sampler, its
 * camera sits at the viewer's own depth plane, and a scene composed a couple of
 * metres off the seabed has no room underneath it. A start pose that dipped
 * there would trip CameraRig's terrain clamp, which lifts the orbit TARGET
 * along with the camera — so the entrance would silently walk the framing
 * upward and hand back a resting shot the family never composed.
 *
 * That second invariant is why the two poses that start CLOSER than the resting
 * framing also start well above it. A smaller radius at the same polar angle is
 * a LOWER camera, so a close start on its own is a start underneath the shot;
 * pairing it with a lift keeps it clear of the seabed while still opening from
 * inside the world and drawing back out of it.
 */
export const CAMERA_INTRO_POSES: readonly CameraIntroPose[] = [
  // Pull back and settle. The original, widened, and still the one that suits a
  // solar system seen whole from outside.
  { radiusScale: 1.32, polarOffsetRadians: -0.12, azimuthOffsetRadians: 0.17 },
  // Crane down: starts well above the framing and descends onto it. The most
  // overtly "establishing shot" of the set, and the steepest descent.
  { radiusScale: 1.16, polarOffsetRadians: -0.4, azimuthOffsetRadians: 0.09 },
  // High arc: lifted and swung the other way, so the descent and the turn are
  // both doing work. Between the crane and the swings in character.
  { radiusScale: 1.26, polarOffsetRadians: -0.26, azimuthOffsetRadians: -0.34 },
  // Swing left — almost pure lateral arc, barely any distance change. The
  // widest turn in the set: 36 degrees, most of a quarter-turn of the head.
  { radiusScale: 1.12, polarOffsetRadians: -0.05, azimuthOffsetRadians: -0.63 },
  // Swing right, and not a mirror of the left: an identical pair reads as one
  // shot flipped, which is worse than two that merely rhyme.
  { radiusScale: 1.07, polarOffsetRadians: -0.11, azimuthOffsetRadians: 0.56 },
  // The long approach. The biggest pull-back in the set, so it spends most of
  // the move covering distance rather than turning.
  { radiusScale: 1.48, polarOffsetRadians: -0.1, azimuthOffsetRadians: -0.21 },
  // Rise and turn: the only shot that gives lift and bearing equal weight, so
  // it arcs down and around at once.
  { radiusScale: 1.21, polarOffsetRadians: -0.42, azimuthOffsetRadians: 0.44 },
  // Out of the world. Opens INSIDE the resting framing and draws back out of
  // it, which reads as emerging rather than as arriving — lifted hard, because
  // a close start at the resting elevation is a start below the shot.
  { radiusScale: 0.78, polarOffsetRadians: -0.36, azimuthOffsetRadians: -0.27 },
  // The low glide: barely any lift, barely any distance, and the longest
  // sideways travel of all. The shot for a world whose interest is at eye level.
  { radiusScale: 1.04, polarOffsetRadians: -0.03, azimuthOffsetRadians: 0.72 },
  // Close and turning. The second inside start, swinging the other way.
  { radiusScale: 0.84, polarOffsetRadians: -0.3, azimuthOffsetRadians: 0.38 }
];

/**
 * The pose used when nothing has asked for a particular one, and the default
 * every test measures the envelope clamps against.
 */
export const CAMERA_INTRO_START_POSE: CameraIntroPose = CAMERA_INTRO_POSES[0];

/**
 * The smallest fraction of a shot a short entry may play.
 *
 * Without a floor, the create page's 0.85 s settle would take 39% of a move
 * that is now twice the size it was — and the settle is not an arrival, it is
 * what the live preview does every time an option is toggled. Something that
 * plays on every click has to stay small however large the full entry gets.
 */
const MINIMUM_INTRO_POSE_SCALE = 0.45;

/**
 * The same shot, sized for how long there is to play it.
 *
 * A shot is a distance covered over a duration, so the two cannot be set
 * independently: the full 2.2 s cinematic entry gets the whole pose, and the
 * 0.85 s preview settle gets a fraction of it rather than the same travel at
 * two and a half times the speed. Scaling the POSE rather than the curve keeps
 * one set of shots for the whole app — a settle is a smaller version of the
 * world's own opening move, not a different move.
 */
export function cameraIntroPoseForDuration(pose: CameraIntroPose, durationSeconds: number): CameraIntroPose {
  if (!(durationSeconds > 0) || durationSeconds >= CAMERA_INTRO_DURATION_SECONDS) {
    return pose;
  }
  const scale = Math.max(MINIMUM_INTRO_POSE_SCALE, durationSeconds / CAMERA_INTRO_DURATION_SECONDS);
  return {
    // Scaled about 1, not about 0: a radius scale of 1 is "no change", so half
    // of a 1.32x pull-back is 1.16x, not 0.66x.
    radiusScale: 1 + (pose.radiusScale - 1) * scale,
    polarOffsetRadians: pose.polarOffsetRadians * scale,
    azimuthOffsetRadians: pose.azimuthOffsetRadians * scale
  };
}

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

/**
 * Easing curves shared by the motion in this app.
 *
 * Extracted when the second consumer appeared, not before: the opening camera
 * move and the genie reveal both need the same in-out cubic, and two copies of
 * a curve is two motions that drift apart the first time one of them is tuned.
 *
 * Every curve here clamps its input rather than extrapolating. A progress value
 * outside [0, 1] is always a frame-timing accident, and a curve that happily
 * returns 1.4 turns that accident into an overshoot nobody asked for.
 */

export function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * Smooth at both ends. An ease-OUT alone starts at full speed, which reads as
 * the motion being shoved; the slow start here reads as it being released.
 */
export function easeInOutCubic(progress: number): number {
  const clamped = clampUnitInterval(progress);
  return clamped < 0.5 ? 4 * clamped * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

/** Slow to leave, fast to arrive. */
export function easeInQuad(progress: number): number {
  const clamped = clampUnitInterval(progress);
  return clamped * clamped;
}

/** Linear interpolation, with `amount` taken as already eased and in range. */
export function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

/**
 * Progress through one member of a staggered set: nothing happens until the
 * member's share of the run has gone by, and then it covers its whole distance
 * in what remains. This is what turns a set of rows moving together into a
 * sheet that unfurls.
 */
export function staggeredProgress(progress: number, delay: number): number {
  const clampedDelay = clampUnitInterval(delay);
  if (clampedDelay >= 1) {
    // A member delayed for the entire run has exactly one instant in which to
    // arrive: the end. Dividing by the zero remaining would say the same thing
    // with a NaN.
    return progress >= 1 ? 1 : 0;
  }
  return clampUnitInterval((progress - clampedDelay) / (1 - clampedDelay));
}

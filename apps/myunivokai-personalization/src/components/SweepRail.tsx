/**
 * An indeterminate wait, drawn as a swipe rather than a spin.
 *
 * A rotating spinner says "something is turning", which is true of nothing the
 * app is actually doing. A lit segment travelling the width of a rail says
 * "something is moving through", which is what a load is — and it is the same
 * gesture a phone uses to bring the next thing into view, so it reads as
 * progress toward a destination instead of as a stall being decorated.
 *
 * The whole animation lives in `.sweep-rail` in globals.css: it is one segment
 * on one element, and CSS keeps it running on the compositor while the main
 * thread is busy doing the work being waited on — which is precisely when a
 * JS-driven indicator would stutter and give the game away.
 *
 * Sizing is the caller's: this fills the width it is given, so wrap it in a box
 * of the width you want rather than passing one in.
 */
export function SweepRail() {
  return <span aria-hidden="true" className="sweep-rail" />;
}

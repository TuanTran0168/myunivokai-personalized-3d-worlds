/**
 * What a rendered frame actually contains, as six numbers.
 *
 * Extracted so exactly one implementation serves both readers: `measure.mjs`,
 * which prints a table a person reads, and `oceanFrameBudget.test.ts`, which
 * fails a build. Two copies of a measurement is two instruments that disagree,
 * and this family has already lost a round to an instrument that was wrong in
 * the direction of the answer being looked for.
 *
 * The columns:
 *   luma    mean perceived brightness, 0..1. Below ~0.10 nothing is readable;
 *           above ~0.62 the frame is washed out.
 *   blown   fraction of pixels at or near pure white. Anything over ~2% means a
 *           highlight has lost its gradient.
 *   crush   fraction at or near pure black -- detail thrown away at the bottom.
 *   sat     mean HSV saturation. THE load-bearing one for this family: water has
 *           a hue, and a frame that loses it has a bug rather than a mood.
 *   detail  mean absolute luma difference between neighbouring pixels, x100.
 *           Local contrast. A fog that has eaten the scene shows up here first,
 *           and nowhere else.
 *   mean    the average colour, as hex. Reads at a glance: #2f6c84 is water,
 *           #606060 is a bug.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

export const SHOTS_ROOT = "e2e/shots";

/**
 * THE APP WINDOW IS A CENTRAL BAND, NOT A TOP CROP, AND THE DIFFERENCE MATTERS.
 *
 * This used to crop only the top 18%, on the stated reasoning that "the app has
 * no side panel". The app has FOUR: the world page carries a title card and a
 * variants list down the left and a World DNA panel and a share box down the
 * right, and the create page carries the whole curate form down the left. They
 * are frosted glass, so over bright water they go very nearly white.
 *
 * That produced a measurement that manufactured its own conclusion. On the
 * open-water frame the app matched the prototype on mean luma (0.670 vs 0.683),
 * on saturation (0.52 vs 0.54) and on mean colour (#6abbcf vs #69bed9) while
 * reporting 18% of pixels blown against the prototype's 0.8% — three columns
 * agreeing and one screaming, which is not a possible property of the same
 * water. The blown pixels were the panels. Acting on that number cost a round of
 * camera tuning aimed at a highlight the renderer never drew.
 *
 * So app frames are measured on the central band that is scene and nothing else,
 * on both app pages. It samples less of the frame; it samples only the frame.
 */
export const APP_WINDOW_DESKTOP = { left: 0.38, right: 0.74, top: 0.28, bottom: 0.86 };

/**
 * The same idea for the 375x812 project, and it needs its own numbers because the
 * app RELAYOUTS rather than scaling.
 *
 * On mobile the panels do not flank the canvas, they stack under it: the canvas is
 * a band across the top of the page and everything below is opaque card. Applying
 * the desktop window there measures almost no canvas at all — which is not a
 * subtle bias but a total one. All four create-page presets came back at
 * 0.159-0.164 luma with the same mean colour, four different seas reported as one
 * number, and that is what an uncalibrated instrument looks like when it happens
 * to be pointed at furniture.
 *
 * Bounds avoid three pieces of chrome that sit ON the canvas: the header, the
 * sidebar-collapse button centred near the top, and the mute button on the right.
 */
export const APP_WINDOW_MOBILE = { left: 0.05, right: 0.82, top: 0.16, bottom: 0.46 };

/**
 * Pick the window from the frame's own width rather than from a project name
 * passed in by the caller.
 *
 * Derived, because a caller that has to say which layout it is looking at is a
 * caller that can say the wrong one — and the failure is silent, which this
 * instrument has already been guilty of twice.
 */
const MOBILE_MAXIMUM_WIDTH = 800;

export function appWindowForWidth(width) {
  return width <= MOBILE_MAXIMUM_WIDTH ? APP_WINDOW_MOBILE : APP_WINDOW_DESKTOP;
}

/**
 * Frames that contain no rendered scene, and must not be given scene metrics.
 *
 * The create page does not show its live 3D preview at the mobile viewport — the
 * form takes the whole page — so `preview-*` frames in the mobile project are
 * screenshots of a form. They are still worth keeping as LAYOUT baselines, which
 * is why they are shot; they are not worth measuring, because there is nothing in
 * them to measure.
 *
 * An explicit list rather than a heuristic, and stated rather than silent: before
 * this, all four came back within 0.008 luma of each other with the same mean
 * colour, four different seas reported as one number. A metric that cannot fail is
 * worse than no metric, because somebody eventually acts on it — and in this
 * family somebody did, twice.
 */
export function isSceneFrame(project, name) {
  return !(project === "mobile" && name.startsWith("preview-"));
}

// The PROTOTYPE puts its chrome down the LEFT instead: shell.html's control
// panel is 19.5rem, which is 312 px of a 1440 px viewport, and it is nearly
// black.
//
// Measuring ref- frames with only a top crop therefore compared the app's water
// against the prototype's water PLUS a dark bar over a fifth of the frame — which
// biased every reference reading downward on luma and saturation, in the same
// direction as the difference being investigated. That is the worst kind of
// instrument error: it does not add noise, it manufactures the expected result.
// The abyss gap this made look like 2.2x is nearer 2.0x once masked.
export const REFERENCE_WINDOW = { left: 0.23, right: 1.0, top: 0.0, bottom: 1.0 };
export const REFERENCE_PREFIX = "ref-";

function unfilter(raw, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel;
  const out = Buffer.alloc(height * stride);
  let position = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[position];
    position += 1;
    const line = raw.subarray(position, position + stride);
    position += stride;
    const target = out.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? target[x - bytesPerPixel] : 0;
      const up = previous ? previous[x] : 0;
      const upLeft = previous && x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const dLeft = Math.abs(p - left);
        const dUp = Math.abs(p - up);
        const dUpLeft = Math.abs(p - upLeft);
        value += dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
      }
      target[x] = value & 0xff;
    }
  }
  return out;
}

/** Minimal PNG reader: 8-bit RGB/RGBA only, which is all Playwright writes. */
function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const chunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") {
      chunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const pixels = unfilter(inflateSync(Buffer.concat(chunks)), width, height, bytesPerPixel);
  return { width, height, bytesPerPixel, pixels };
}

export function measureFrame(path, isReference) {
  const { width, height, bytesPerPixel, pixels } = decodePng(readFileSync(path));
  const stride = width * bytesPerPixel;
  // Each renderer's own chrome, and only its own — see APP_WINDOW_DESKTOP.
  const window = isReference ? REFERENCE_WINDOW : appWindowForWidth(width);
  const top = Math.floor(height * window.top);
  const bottom = Math.ceil(height * window.bottom);
  const left = Math.floor(width * window.left);
  const right = Math.ceil(width * window.right);

  let lumaTotal = 0;
  let satTotal = 0;
  let rTotal = 0;
  let gTotal = 0;
  let bTotal = 0;
  let blown = 0;
  let crushed = 0;
  let detailTotal = 0;
  let detailCount = 0;
  let count = 0;

  const lumaAt = (x, y) => {
    const o = y * stride + x * bytesPerPixel;
    return (0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2]) / 255;
  };

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const o = y * stride + x * bytesPerPixel;
      const r = pixels[o];
      const g = pixels[o + 1];
      const b = pixels[o + 2];
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      lumaTotal += luma;
      satTotal += max === 0 ? 0 : (max - min) / max;
      rTotal += r;
      gTotal += g;
      bTotal += b;
      if (max >= 250) blown += 1;
      if (max <= 6) crushed += 1;
      count += 1;
      if (x + 1 < right) {
        detailTotal += Math.abs(luma - lumaAt(x + 1, y));
        detailCount += 1;
      }
    }
  }

  const hex = (value) => Math.round(value / count).toString(16).padStart(2, "0");
  return {
    luma: lumaTotal / count,
    blown: blown / count,
    crush: crushed / count,
    sat: satTotal / count,
    detail: (detailTotal / Math.max(1, detailCount)) * 100,
    mean: `#${hex(rTotal)}${hex(gTotal)}${hex(bTotal)}`,
  };
}


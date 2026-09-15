import {
  TONE_CURVES,

  colorSpaceMatrixRowSums,
  hexToLinearColor,
  linearColorToDisplayRgb,
  saturationOfDisplayRgb
} from "./toneCurves.mjs";

/**
 * WHAT THE RESTORED TONE CURVE DID TO THE SUN, IN NUMBERS.
 *
 * The owner reported that the sun looks "as if a sheet of frosted glass were
 * laid over it — it is not fiery red like it used to be". This script is the
 * check on that report, and on this demo's claim about its cause.
 *
 * The cause is `3f09796`. Until it landed, `EffectComposer` set
 * `gl.toneMapping = NoToneMapping` on mount and the universe, forest and
 * fallback chains contained no `<ToneMapping>` pass — so those three families
 * rendered with NO tone curve and every linear value above 1 hit the display
 * clamp flat. That was a real bug and restoring the curve was right. **But the
 * curve that was restored is AgX, and AgX's defining behaviour is that it
 * desaturates as it approaches the top of the range** — that is how it avoids
 * the neon clipping the flat clamp produced. The report describes AgX working
 * exactly as designed.
 *
 * WHAT THIS MEASURES: the curve applied to the colour the sun's material hands
 * the renderer, over the full ramp the sun texture multiplies it by.
 *
 * WHAT IT DOES NOT MEASURE, and it is most of a frame: bloom, the grade, the
 * vignette, the film grain, the glow shell's additive blend over the star, and
 * the sRGB output transform's interaction with all of them. A rendered pixel is
 * not this number. What makes the comparison fair anyway is that every one of
 * those is IDENTICAL on both sides — the tone curve is the only thing `3f09796`
 * changed — so the delta here is the delta in the frame, even though the
 * absolutes are not.
 *
 * It also does not say which curve is right. That is the owner's decision and
 * this script exists to put four of them side by side with numbers attached.
 */

/**
 * Both worlds come from `buildCreateFormPreviewScene` with the create form at
 * `CREATE_FORM_INITIAL_VALUES` and only the nickname differing — the exact pair
 * in `demos/binary-sun-clearance/`. The values are transcribed from that builder
 * rather than imported: this demo must run from a bare checkout with no app
 * install, per `demos/README.md`.
 */
const REPORTED_WORLDS = [
  {
    label: 'nickname "Trần Đăng Tuấn" — the reported frame',
    surfaceTintColor: "#FFE3C4",
    glowColor: "#FF9E4A",
    surfaceHdrMultiplier: 1.39
  },
  {
    label: 'nickname empty (seeds as "Neo")',
    surfaceTintColor: "#FFFFFF",
    glowColor: "#FDB813",
    surfaceHdrMultiplier: 1.36
  }
];

/**
 * The sun's surface is `<meshBasicMaterial map={sunTexture} color={tint × hdr}>`,
 * so what reaches the tone curve is the tint scaled by every level the texture
 * contains. Sampling the ramp rather than one point is what stops a curve being
 * judged on its brightest pixel alone — the granules matter as much as the peak.
 */
const SUN_TEXTURE_LEVELS = [1, 0.85, 0.7, 0.55, 0.4, 0.25];

/**
 * A grey in is a grey out, for every one of these curves. None of them is a
 * white-balance operation, so any channel separation on a neutral input is a
 * transcription error rather than a property of the curve.
 *
 * This caught the transpose above in the most misleading possible form: a pure
 * white star leaving AgX as `211 206 218`, a violet-tinted grey, which reads as
 * a finding about the renderer.
 */
const NEUTRAL_SEPARATION_TOLERANCE = 0.0005;
const NEUTRAL_PROBE_LEVELS = [0.05, 0.18, 0.5, 1, 1.4];

function checkNeutralStaysNeutral() {
  let worstSeparation = 0;
  let worstLabel = "";
  for (const curve of TONE_CURVES) {
    for (const level of NEUTRAL_PROBE_LEVELS) {
      const [red, green, blue] = curve.apply([level, level, level]);
      const separation = Math.max(red, green, blue) - Math.min(red, green, blue);
      if (separation > worstSeparation) {
        worstSeparation = separation;
        worstLabel = `${curve.label} at ${level}`;
      }
    }
  }
  const verdict = worstSeparation <= NEUTRAL_SEPARATION_TOLERANCE ? "OK" : "FAILED";
  console.log(
    `Neutral in, neutral out: worst channel separation ${worstSeparation.toFixed(6)} ` +
      `(${worstLabel}) · ${verdict}`
  );
  if (worstSeparation > NEUTRAL_SEPARATION_TOLERANCE) {
    console.error("A curve tints a grey, so a matrix is transposed. Nothing below means anything.");
    process.exitCode = 1;
  }
}

/**
 * Informational, and it is the OTHER half of the owner's report.
 *
 * Saturation is what this demo set out to measure, but a veil is two things and
 * the second one is the black point. AgX does NOT hold middle grey: three's
 * implementation lifts 0.18 to about 0.215, and it lifts the bottom of the range
 * further still. A scene whose mid-tones sit higher and whose colours sit flatter
 * is precisely "a sheet of frosted glass laid over it".
 *
 * Printed rather than asserted, because it is what AgX is rather than a defect,
 * and an assertion here would be a pin on my own arithmetic rather than on a
 * property anything else guarantees.
 */
const MIDDLE_GREY_LINEAR = 0.18;
const DEEP_SHADOW_LINEAR = 0.02;

function reportBlackAndMidPoints() {
  console.log("\nWhere each curve puts a neutral, in linear units in and out");
  for (const curve of TONE_CURVES) {
    const middleGrey = curve.apply([MIDDLE_GREY_LINEAR, MIDDLE_GREY_LINEAR, MIDDLE_GREY_LINEAR])[0];
    const deepShadow = curve.apply([DEEP_SHADOW_LINEAR, DEEP_SHADOW_LINEAR, DEEP_SHADOW_LINEAR])[0];
    console.log(
      `  ${curve.label.padEnd(26)} mid ${MIDDLE_GREY_LINEAR} -> ${middleGrey.toFixed(4)}` +
        `   ·   shadow ${DEEP_SHADOW_LINEAR} -> ${deepShadow.toFixed(4)}`
    );
  }
}

/**
 * The check that would have caught the transpose in one line instead of in a
 * violet-tinted white star: every one of these matrices converts between colour
 * spaces sharing a white point, so every row must sum to 1.
 */
const MATRIX_ROW_SUM_TOLERANCE = 0.001;

function checkColorSpaceMatrices() {
  let worstDrift = 0;
  let worstName = "";
  for (const { name, rowSums } of colorSpaceMatrixRowSums()) {
    for (const rowSum of rowSums) {
      const drift = Math.abs(rowSum - 1);
      if (drift > worstDrift) {
        worstDrift = drift;
        worstName = name;
      }
    }
  }
  const verdict = worstDrift <= MATRIX_ROW_SUM_TOLERANCE ? "OK" : "FAILED";
  console.log(
    `Colour-space matrices, white preserved: worst row-sum drift ${worstDrift.toFixed(5)} ` +
      `(${worstName}) · ${verdict}`
  );
  if (worstDrift > MATRIX_ROW_SUM_TOLERANCE) {
    console.error("A matrix is transposed. Nothing below means anything until it is fixed.");
    process.exitCode = 1;
  }
}

function formatDisplayRgb(displayRgb) {
  return displayRgb.map((channel) => String(channel).padStart(3)).join(" ");
}

function reportSurface(world) {
  const tintLinear = hexToLinearColor(world.surfaceTintColor);
  console.log(`\n${world.label}`);
  console.log(`  star surface  ${world.surfaceTintColor} x ${world.surfaceHdrMultiplier} HDR`);
  console.log(`  texture ${TONE_CURVES.map((curve) => curve.label.padEnd(26)).join("")}`);

  for (const textureLevel of SUN_TEXTURE_LEVELS) {
    const linear = tintLinear.map((channel) => channel * world.surfaceHdrMultiplier * textureLevel);
    const cells = TONE_CURVES.map((curve) => {
      const displayRgb = linearColorToDisplayRgb(curve.apply(linear));
      return `${formatDisplayRgb(displayRgb)} s${saturationOfDisplayRgb(displayRgb).toFixed(2)}`.padEnd(26);
    });
    console.log(`  ${textureLevel.toFixed(2)}    ${cells.join("")}`);
  }
}

function reportGlow(world) {
  const glowLinear = hexToLinearColor(world.glowColor);
  console.log(`  glow shell    ${world.glowColor} x ${world.surfaceHdrMultiplier} HDR`);
  const cells = TONE_CURVES.map((curve) => {
    const displayRgb = linearColorToDisplayRgb(
      curve.apply(glowLinear.map((channel) => channel * world.surfaceHdrMultiplier))
    );
    return `${formatDisplayRgb(displayRgb)} s${saturationOfDisplayRgb(displayRgb).toFixed(2)}`.padEnd(26);
  });
  console.log(`  1.00    ${cells.join("")}`);
}

/**
 * The headline: how much saturation each curve keeps, relative to the build the
 * owner is comparing against. A curve at 1.00 looks like the old build; below
 * 1.00 it is the veil they are describing.
 */
function reportSaturationRetention() {
  console.log("\nSaturation kept, against the no-curve build, averaged over the texture ramp and both worlds");
  const [noCurve, ...candidateCurves] = TONE_CURVES;

  for (const curve of candidateCurves) {
    let baselineTotal = 0;
    let curveTotal = 0;
    for (const world of REPORTED_WORLDS) {
      for (const hexColor of [world.surfaceTintColor, world.glowColor]) {
        const tintLinear = hexToLinearColor(hexColor);
        for (const textureLevel of SUN_TEXTURE_LEVELS) {
          const linear = tintLinear.map((channel) => channel * world.surfaceHdrMultiplier * textureLevel);
          baselineTotal += saturationOfDisplayRgb(linearColorToDisplayRgb(noCurve.apply(linear)));
          curveTotal += saturationOfDisplayRgb(linearColorToDisplayRgb(curve.apply(linear)));
        }
      }
    }
    console.log(`  ${curve.label.padEnd(26)} ${(curveTotal / baselineTotal).toFixed(3)}`);
  }
}

checkColorSpaceMatrices();
checkNeutralStaysNeutral();
for (const world of REPORTED_WORLDS) {
  reportSurface(world);
  reportGlow(world);
}
reportSaturationRetention();
reportBlackAndMidPoints();

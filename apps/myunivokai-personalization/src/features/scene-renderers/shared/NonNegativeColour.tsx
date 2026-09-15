"use client";

import { BlendFunction, Effect } from "postprocessing";
import { wrapEffect } from "@react-three/postprocessing";

/**
 * ONE LINE OF GLSL, AND IT IS WHY THE SUN WAS BLACK ON REAL HARDWARE.
 *
 * The star is the only object in this app that leaves the renderer with linear
 * values ABOVE 1: `Sun.tsx` multiplies its tint by an HDR factor of ~1.4 so the
 * surface crosses `BLOOM_LUMINANCE_THRESHOLD` and glows. Everything else is lit
 * geometry, in range.
 *
 * `postprocessing`'s `hue-saturation.frag` pushes each channel AWAY from the
 * channel average — `color += diff * (1 - 1/(1.001 - saturation))` for a
 * positive saturation — and ends with `min(color, 1.0)`. It clamps the top and
 * not the bottom. For a saturated orange above 1, the blue channel comes out
 * NEGATIVE: at the universe's stored saturation of 0.12, a surface of
 * (1.4, 0.6, 0.05) leaves that pass at about (1.5, 0.59, -0.04).
 *
 * The next effect in the chain is `BrightnessContrast`, the one effect here that
 * declares `inputColorSpace = SRGBColorSpace`, so the composer inserts a linear
 * to sRGB encode before it. That encode is three's own, and it is written as
 *
 *     mix( pow(value, 0.41666) * 1.055 - 0.055, value * 12.92, step(value, 0.0031308) )
 *
 * `pow` of a negative number is undefined in GLSL, and **the `step` branch does
 * not save it**: both sides of a `mix` are evaluated, and NaN times zero is
 * still NaN. So the sun's fragments carry NaN through the rest of the chain.
 *
 * **AND THAT IS WHY IT WAS INVISIBLE.** What a driver does with a NaN fragment
 * is not specified. On the RTX 4060 through ANGLE it resolves to black, so the
 * star renders as a black disc with only its hottest granules surviving. On
 * SwiftShader it does not — and SwiftShader is what `playwright.config.ts` pins
 * every screenshot to, deliberately and for good reasons, which means **the
 * entire visual suite is blind to this whole class of defect**. Every committed
 * baseline shows a sun that real hardware does not draw.
 *
 * Bisected to one input: the same fixture with `postFX.grade.saturation` set to
 * 0 renders the star correctly on the same GPU, with the full chain mounted.
 *
 * This pass sits between the two grade effects and clamps the floor that
 * `hue-saturation.frag` forgot. It changes nothing that was ever valid: a
 * negative radiance is not a colour, and every value the scene legitimately
 * produces is already at or above zero. `BlendFunction.SRC` because it replaces
 * rather than blends.
 *
 * Not a fix to `postprocessing` — the library is being replaced by §26 Phase 5's
 * node chain, which reproduced the identical gap and gets the identical clamp.
 */
const NON_NEGATIVE_COLOUR_FRAGMENT_SHADER = /* glsl */ `
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    outputColor = vec4(max(inputColor.rgb, vec3(0.0)), inputColor.a);
  }
`;

class NonNegativeColourEffect extends Effect {
  constructor() {
    super("NonNegativeColourEffect", NON_NEGATIVE_COLOUR_FRAGMENT_SHADER, {
      blendFunction: BlendFunction.SRC
    });
  }
}

export const NonNegativeColour = wrapEffect(NonNegativeColourEffect);

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A lint for the GLSL that lives inside this folder's TypeScript.
 *
 * Nothing else in the repository can catch these. `tsc` sees a template string,
 * `next build` sees a template string, and vitest sees a template string — the
 * shader is only ever compiled by a driver, on a machine, at runtime, and a
 * shader that fails to compile does not throw where anyone is looking. It
 * renders as a white or black shape and the suite stays green.
 *
 * That is not hypothetical here. This family has shipped the same class of bug
 * twice: `flat` (a reserved word in GLSL ES 3.00) and `cross` (a built-in
 * function name used as a variable). Both compiled under the software renderer
 * the screenshot suite uses and both were visible only to a person looking at
 * the screen on a real GPU.
 */
const OCEAN_DIRECTORY = join(process.cwd(), "src/features/scene-renderers/ocean");

/**
 * GLSL ES built-in functions. Declaring a variable with one of these names is
 * legal in some translators and rejected by others, which is the worst possible
 * combination: it works in CI and fails on a user's machine.
 */
const BUILT_IN_FUNCTIONS = [
  "radians", "degrees", "sin", "cos", "tan", "asin", "acos", "atan",
  "pow", "exp", "log", "exp2", "log2", "sqrt", "inversesqrt",
  "abs", "sign", "floor", "ceil", "fract", "mod", "min", "max", "clamp",
  "mix", "step", "smoothstep", "length", "distance", "dot", "cross",
  "normalize", "faceforward", "reflect", "refract", "matrixCompMult",
  "texture2D", "textureCube", "dFdx", "dFdy", "fwidth",
];

/**
 * Reserved and future-reserved words. `flat`, `smooth` and `noperspective` are
 * interpolation qualifiers; the rest are reserved for future use and rejected
 * outright by strict translators.
 */
const RESERVED_WORDS = [
  "flat", "smooth", "noperspective", "input", "output", "sampler",
  "buffer", "shared", "packed", "namespace", "using", "template",
  "this", "class", "union", "enum", "typedef", "cast", "asm",
  "goto", "switch", "default", "public", "static", "extern", "external",
  "interface", "long", "short", "double", "half", "fixed", "unsigned",
  "row_major", "sizeof", "volatile", "inline", "noinline",
];

const GLSL_TYPES =
  "float|int|uint|bool|vec2|vec3|vec4|ivec2|ivec3|ivec4|bvec2|bvec3|bvec4|mat2|mat3|mat4|sampler2D|samplerCube";

function shaderSourceFiles(): { name: string; source: string }[] {
  return readdirSync(OCEAN_DIRECTORY)
    .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
    .filter((name) => !name.endsWith(".test.ts"))
    .map((name) => ({ name, source: readFileSync(join(OCEAN_DIRECTORY, name), "utf8") }));
}

/**
 * Strip line comments before scanning.
 *
 * The shaders here are heavily commented and the comments discuss the very
 * words being searched for — "sampled in the plane across the beam", "the
 * cross-section" — so scanning raw source reports the prose instead of the code.
 */
function withoutComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const marker = line.indexOf("//");
      return marker === -1 ? line : line.slice(0, marker);
    })
    .join("\n");
}

describe("ocean shader source", () => {
  it("declares no variable that shadows a GLSL built-in function", () => {
    const offences: string[] = [];
    for (const { name, source } of shaderSourceFiles()) {
      const body = withoutComments(source);
      for (const builtIn of BUILT_IN_FUNCTIONS) {
        const pattern = new RegExp(`\\b(?:${GLSL_TYPES})\\s+${builtIn}\\s*(?:=|;|\\[)`, "g");
        for (const match of body.matchAll(pattern)) {
          offences.push(`${name}: ${match[0].trim()}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it("declares no variable using a reserved GLSL word", () => {
    const offences: string[] = [];
    for (const { name, source } of shaderSourceFiles()) {
      const body = withoutComments(source);
      for (const reserved of RESERVED_WORDS) {
        const pattern = new RegExp(`\\b(?:${GLSL_TYPES})\\s+${reserved}\\s*(?:=|;|\\[)`, "g");
        for (const match of body.matchAll(pattern)) {
          offences.push(`${name}: ${match[0].trim()}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  /**
   * Tone mapping is for shaders that REPLACE what is behind them, and only
   * those. Additive shaders must write raw linear and encode nothing.
   *
   * The first half of this rule replaced an injected curve. The ocean used to
   * carry its own ACES fit in every material, because the post-processing
   * composer set `gl.toneMapping = NoToneMapping` on mount and the chain had no
   * `<ToneMapping>` effect — so the renderer's curve was dead and anything past
   * 1.0 in linear space clipped flat to white. The family now bypasses the
   * composer and uses the renderer's own ACES, which is the curve its grade was
   * designed against. A replacing shader that never reaches the include is back
   * in that failure: raw linear radiance written to an 8-bit target.
   *
   * THE SECOND HALF IS A CORRECTION TO THE FIRST, AND IT COST A REAL BUG.
   *
   * This test originally required the include of EVERY fragment shader, and four
   * additive layers were changed to satisfy it: the god rays, the jellyfish, the
   * bubbles and the marine snow. Additive layers are summed into a framebuffer
   * that already holds sRGB-encoded values, and sRGB encoding is steep near
   * black — a linear 0.15 encodes to 0.40. So encoding an additive contribution
   * inflates it about two and a half times before it is added.
   *
   * Four layers doing that at once is a haze over every underwater frame. On the
   * god rays it clipped 100% of the measured band of a 14 m reef to pure white,
   * and it stayed hidden because the camera pointed away from the shafts until
   * the framing was fixed. A test can enforce a wrong rule perfectly.
   */
  it("tone-maps replacing shaders and leaves additive ones in linear", () => {
    const offences: string[] = [];
    for (const { name, source } of shaderSourceFiles()) {
      const body = withoutComments(source);
      // Split on the template-literal boundary rather than the whole file: one
      // module can hold several shaders, and only the ones that WRITE a fragment
      // colour are making a claim about tone mapping.
      for (const shader of body.split("fragmentShader:").slice(1)) {
        const chunk = shader.slice(0, shader.indexOf("`,") + 1 || undefined);
        if (!chunk.includes("gl_FragColor = ")) continue;
        // Which blend mode this material uses is declared BEFORE the shader, so
        // it is in the text preceding this chunk rather than inside it. Taking
        // the nearest preceding declaration is what keeps several materials in
        // one module from being read as one.
        const preamble = body.slice(0, body.indexOf(chunk));
        const lastAdditive = preamble.lastIndexOf("AdditiveBlending");
        const lastMaterialStart = preamble.lastIndexOf("new ShaderMaterial");
        const isAdditive = lastAdditive > lastMaterialStart;
        const tonemapped = chunk.includes("#include <tonemapping_fragment>");
        if (isAdditive && tonemapped) {
          offences.push(`${name}: an additive shader encodes its output`);
        }
        if (!isAdditive && !tonemapped) {
          offences.push(`${name}: a replacing shader skips the tone curve`);
        }
      }
    }
    expect(offences).toEqual([]);
  });
});

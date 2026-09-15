import { Vector2, Vector3, Vector4 } from "three";
import { describe, expect, it } from "vitest";
import {
  oceanSurfaceNode,
  preethamSkyNode,
  skyThroughSnellsWindowNode,
  CLEAR_MARITIME_SKY,
  PREETHAM_SKY_GLSL,
  SKY_UNIFORMS_GLSL,
  SNELL_CRITICAL_ANGLE,
  WATER_REFRACTIVE_INDEX,
  skyCoefficients,
  skyUniformNodes,
  skyUniformValues,
  GERSTNER_SURFACE_GLSL,
  WAVE_UNIFORMS_GLSL,
  type SkyUniformNodes,
  type WaveUniformNodes
} from "./oceanSky";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * ONE SKY, TWO SHADER LANGUAGES, THREE CALLERS THAT MUST NEVER DISAGREE.
 *
 * The dome above the water, the reflection in its surface and the view up
 * through Snell's window all evaluate this model. They already shared one GLSL
 * function; §26's port means they now share one node graph as well, and the two
 * have to be built from one set of numbers or the water stops matching the sky
 * it is supposed to be mirroring.
 *
 * **WHAT THIS FILE CAN AND CANNOT CHECK.** It can prove the GLSL contains no
 * number the module does not declare, and that the node graph builds against
 * three's real TSL. It CANNOT prove the two compute the same thing — they are
 * different languages, and the only instrument that subtracts them is
 * `scene-parity.spec.ts` on a real GPU. That is stated here rather than implied,
 * because a green file is otherwise easy to mistake for a verified port.
 */

/**
 * The shader with its prose removed.
 *
 * **A LITERAL SCAN THAT READS COMMENTS IS A SCAN THAT STOPS WORKING.** This
 * family's shaders are heavily annotated — "GPU Gems 1, chapter 1, equation 12",
 * "sin(air) = 1.333 * sin(water)" — and every number in that prose has to be
 * added to the permitted set to keep the test green. Do that a few times and the
 * set is wide enough to permit a real hardcoded value, which is the one thing the
 * check exists to catch.
 */
function withoutComments(shader: string): string {
  return shader.replace(/\/\/[^\n]*/g, "");
}

async function nodeMaterialModules(): Promise<NodeMaterialModules> {
  const [webgpu, tsl] = await Promise.all([import("three/webgpu"), import("three/tsl")]);
  return { webgpu, tsl } as unknown as NodeMaterialModules;
}

/**
 * The production binding, EXERCISED rather than re-implemented.
 *
 * This was a second copy of `skyUniformNodes`, written before the real one
 * existed. A duplicate is the one shape of test that is guaranteed not to catch
 * the failure it is nearest to: the copy can be right while the binding every
 * material actually uses is wrong, and the file stays green.
 */
async function testSkyUniformNodes(modules: NodeMaterialModules): Promise<SkyUniformNodes> {
  return skyUniformNodes(modules, new Vector3(0, 1, 0), skyCoefficients(Math.PI / 4));
}

describe("ocean sky model", () => {
  /**
   * Zero, one and TWO are structural here. Two is not a tuning value in this
   * model — it is the square in `pow(cosTheta, 2)` and `pow(g, 2)`, and the
   * factor in Henyey-Greenstein's `1 - 2g·cosθ + g²`. Naming it would make the
   * denominator harder to check against the paper, not easier.
   */
  it("contains no numeric literal that is not one of the declared constants", () => {
    // MAGNITUDES, because the scan is sign-blind and has to be: a regex cannot
    // tell the negative literal `-1.253` from the subtraction in `a - 1.0`, and
    // claiming the sign would turn every difference in the shader into a
    // spurious constant. `AIR_MASS_EXPONENT` is the only negative one here.
    const declaredValues = new Set([
      3.141592653589793, 8.4e3, 1.25e3, 0.9999566769464485, 0.00002, 19000, 0.05968310365946075,
      0.07957747154594767, 0.15, 93.885, 1.253, 180, 0.5, 1.5, 5, 0.1, 0.04, 0.0003, 0.00075, 1.2, 1e-5,
      WATER_REFRACTIVE_INDEX
    ]);
    const structuralLiterals = new Set([0, 1, 2]);
    // The exponent is part of the number. Without `[eE][+-]?\d+` this scan reads
    // `8.4E3` as the two values 8.4 and 3, which is how a check like this quietly
    // stops checking the two largest constants in the model.
    const numericLiterals = (
      withoutComments(PREETHAM_SKY_GLSL).match(/(?<![A-Za-z0-9_])\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? []
    ).map(Number);

    expect(numericLiterals.length, "the shader should still be built from the constants").toBe(52);
    for (const literal of numericLiterals) {
      const permitted = declaredValues.has(literal) || structuralLiterals.has(literal);
      expect(permitted, `${literal} is in the shader but is not a declared constant`).toBe(true);
    }
  });

  /**
   * The exponential spellings survived the extraction. `8.4E3` and `1.25E3` are
   * how Sky.js writes them and how a reader checks them against the paper; a
   * round-trip through `toExponential` that produced `8400` would compile the
   * same and read worse.
   */
  it("keeps the atmosphere's optical depths in their source spelling", () => {
    expect(PREETHAM_SKY_GLSL).toContain("const float rayleighZenithLength = 8.4E3;");
    expect(PREETHAM_SKY_GLSL).toContain("const float mieZenithLength = 1.25E3;");
  });

  it("declares every uniform its function reads", () => {
    for (const uniformName of ["uSkySunDirection", "uBetaR", "uBetaM", "uSunE", "uSunfade", "uMieG"]) {
      expect(SKY_UNIFORMS_GLSL, `${uniformName} must be declared`).toContain(uniformName);
      expect(PREETHAM_SKY_GLSL, `${uniformName} must be used`).toContain(uniformName);
    }
  });

  /**
   * Turbidity 3, not the 10 three.js's own ocean example ships. 10 is a hazy
   * coastal sky that measures at saturation 0.05 — a white rectangle — and water
   * can only ever be as blue as the sky it mirrors.
   */
  it("keeps the clear maritime turbidity the family was tuned for", () => {
    expect(CLEAR_MARITIME_SKY.turbidity).toBe(3);
  });

  it("derives the critical angle from the refractive index rather than declaring it twice", () => {
    expect(SNELL_CRITICAL_ANGLE).toBeCloseTo(Math.asin(1 / WATER_REFRACTIVE_INDEX), 12);
  });

  /**
   * `sunfade` evaluates to 1 for a unit sun vector, exactly as in the three.js
   * example — the reddening of a low sun comes from the optical path length in
   * the fragment stage, not from here. Asserted because a `sunfade` that moved
   * would re-gamma the whole sky.
   */
  it("holds sunfade at one, which is where the fragment stage expects it", () => {
    for (const elevation of [0.1, Math.PI / 6, Math.PI / 3]) {
      expect(skyCoefficients(elevation).sunfade).toBeCloseTo(1, 12);
    }
  });

  it("builds the node graph against three's real TSL", async () => {
    const modules = await nodeMaterialModules();
    const uniforms = await testSkyUniformNodes(modules);
    const direction = modules.tsl.vec3(0, 1, 0) as unknown as Parameters<typeof preethamSkyNode>[2];

    expect(preethamSkyNode(modules, uniforms, direction, false)).toBeDefined();
    expect(preethamSkyNode(modules, uniforms, direction, true)).toBeDefined();
  });

  /**
   * The disc is a compile-time branch on BOTH paths — a `bool` parameter every
   * call site passes a literal for — so the two graphs must be different
   * objects. The reflection asks for `false` because a mirrored 19000x solar
   * disc through a wave normal is a field of white pixels, not a glitter path.
   */
  it("builds a different graph with and without the solar disc", async () => {
    const modules = await nodeMaterialModules();
    const uniforms = await testSkyUniformNodes(modules);
    const direction = modules.tsl.vec3(0, 1, 0) as unknown as Parameters<typeof preethamSkyNode>[2];

    expect(preethamSkyNode(modules, uniforms, direction, true)).not.toBe(
      preethamSkyNode(modules, uniforms, direction, false)
    );
  });

  it("builds the Snell's window graph, which always asks for the disc", async () => {
    const modules = await nodeMaterialModules();
    const uniforms = await testSkyUniformNodes(modules);
    const viewDirection = modules.tsl.vec3(0, 1, 0) as unknown as Parameters<
      typeof skyThroughSnellsWindowNode
    >[2];
    const sinTheta = modules.tsl.float(0.5) as unknown as Parameters<typeof skyThroughSnellsWindowNode>[3];

    expect(skyThroughSnellsWindowNode(modules, uniforms, viewDirection, sinTheta)).toBeDefined();
  });
});

describe("ocean surface wave field", () => {
  const WAVE_COMPONENT_COUNT = 6;

  /**
   * The wave sum has no tuning constants of its own — every number in it comes
   * from the sea state at runtime — so what this asserts is the opposite of the
   * sky's check: that the GLSL carries only structure. A literal appearing here
   * would be a wave parameter someone hardcoded past `buildSeaState`.
   */
  it("carries no tuning constant of its own", () => {
    const structuralLiterals = new Set([0, 1]);
    const numericLiterals = (
      withoutComments(GERSTNER_SURFACE_GLSL(WAVE_COMPONENT_COUNT)).match(
        /(?<![A-Za-z0-9_])\d+(?:\.\d+)?/g
      ) ?? []
    ).map(Number);

    for (const literal of numericLiterals) {
      const permitted = structuralLiterals.has(literal) || literal === WAVE_COMPONENT_COUNT;
      expect(permitted, `${literal} is in the wave shader but is not structure or the component count`).toBe(
        true
      );
    }
  });

  it("sizes its array uniforms by the component count it is given", () => {
    expect(WAVE_UNIFORMS_GLSL(WAVE_COMPONENT_COUNT)).toContain(`uniform vec2 uWaveDir[${WAVE_COMPONENT_COUNT}]`);
    expect(WAVE_UNIFORMS_GLSL(WAVE_COMPONENT_COUNT)).toContain(`uniform vec4 uWaveTerm[${WAVE_COMPONENT_COUNT}]`);
  });

  /**
   * **THE FIRST ARRAY UNIFORM AND THE FIRST DYNAMIC LOOP IN THIS MIGRATION.**
   * `uniformArray` takes the same `Vector2[]`/`Vector4[]` the classic path puts
   * in its `IUniform`, and `Loop` with a `Break` is the node equivalent of the
   * GLSL's bounded `for`. Building it is what proves TSL accepts the shape; what
   * it computes is only checkable on a GPU.
   */
  it("builds the wave sum against three's real TSL", async () => {
    const modules = await nodeMaterialModules();
    const { float, int, uniform, uniformArray, vec2 } = modules.tsl;

    const uniforms: WaveUniformNodes = {
      directions: uniformArray(
        Array.from({ length: WAVE_COMPONENT_COUNT }, () => new Vector2(1, 0)),
        "vec2"
      ) as unknown as WaveUniformNodes["directions"],
      terms: uniformArray(
        Array.from({ length: WAVE_COMPONENT_COUNT }, () => new Vector4(0.4, 0.3, 1.1, 0)),
        "vec4"
      ) as unknown as WaveUniformNodes["terms"],
      waveCount: int(WAVE_COMPONENT_COUNT) as unknown as WaveUniformNodes["waveCount"],
      choppiness: uniform(0.8) as unknown as WaveUniformNodes["choppiness"],
      time: uniform(0) as unknown as WaveUniformNodes["time"]
    };
    void float;

    const surface = oceanSurfaceNode(
      modules,
      uniforms,
      vec2(1, 2) as unknown as Parameters<typeof oceanSurfaceNode>[2],
      WAVE_COMPONENT_COUNT
    );

    expect(surface.offset).toBeDefined();
    expect(surface.normal).toBeDefined();
    expect(surface.jacobian, "the foam mask is the third output and is easy to drop").toBeDefined();
  });

  /**
   * One evaluation, three outputs. The GLSL uses three `out` parameters; the
   * node graph returns a struct, and the three members must come from the SAME
   * evaluation or the most expensive loop in the ocean's vertex stage runs three
   * times.
   */
  it("returns all three outputs from one evaluation of the sum", async () => {
    const modules = await nodeMaterialModules();
    const { int, uniform, uniformArray, vec2 } = modules.tsl;

    const uniforms: WaveUniformNodes = {
      directions: uniformArray([new Vector2(1, 0)], "vec2") as unknown as WaveUniformNodes["directions"],
      terms: uniformArray([new Vector4(0.4, 0.3, 1.1, 0)], "vec4") as unknown as WaveUniformNodes["terms"],
      waveCount: int(1) as unknown as WaveUniformNodes["waveCount"],
      choppiness: uniform(0.8) as unknown as WaveUniformNodes["choppiness"],
      time: uniform(0) as unknown as WaveUniformNodes["time"]
    };

    const surface = oceanSurfaceNode(
      modules,
      uniforms,
      vec2(0, 0) as unknown as Parameters<typeof oceanSurfaceNode>[2],
      1
    );

    const owner = (node: unknown) => (node as { node?: unknown }).node;
    expect(owner(surface.offset)).toBe(owner(surface.normal));
    expect(owner(surface.offset)).toBe(owner(surface.jacobian));
  });
});

describe("sky uniform binding", () => {
  /**
   * **A UNIFORM DECLARED AND NEVER BOUND READS ZERO AND REPORTS NOTHING.** A sky
   * whose sun direction is the zero vector is a flat grey dome, not an error, so
   * a name drifting between `SKY_UNIFORMS_GLSL` and the record that fills it
   * produces a plausible wrong frame in silence. Both live in this module so
   * that this check is possible at all.
   */
  it("binds exactly the uniforms the shared GLSL block declares", () => {
    const declared = (SKY_UNIFORMS_GLSL.match(/uniform\s+\w+\s+(\w+)/g) ?? []).map(
      (declaration) => declaration.split(/\s+/)[2]
    );
    const bound = Object.keys(skyUniformValues(new Vector3(0, 1, 0), skyCoefficients(Math.PI / 4)));

    expect(declared.length).toBeGreaterThan(0);
    expect(bound.slice().sort()).toEqual(declared.slice().sort());
  });

  it("gives the node path one node per uniform the classic path binds", async () => {
    const modules = await nodeMaterialModules();
    const coefficients = skyCoefficients(Math.PI / 4);
    const nodes = skyUniformNodes(modules, new Vector3(0, 1, 0), coefficients);

    expect(Object.keys(nodes).length).toBe(
      Object.keys(skyUniformValues(new Vector3(0, 1, 0), coefficients)).length
    );
    for (const [name, node] of Object.entries(nodes)) {
      expect(node, `${name} has no node`).toBeDefined();
    }
  });
});

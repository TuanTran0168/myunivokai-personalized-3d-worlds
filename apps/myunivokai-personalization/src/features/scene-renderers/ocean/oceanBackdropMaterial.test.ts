import { BackSide, Color, ShaderMaterial, Vector3, type Material } from "three";
import { describe, expect, it } from "vitest";
import {
  backdropFragmentShaderGlsl,
  backdropVertexShaderGlsl,
  oceanBackdropMaterial,
  type OceanBackdropSettings,
} from "./oceanBackdropMaterial";
import { PREETHAM_SKY_GLSL, SKY_UNIFORMS_GLSL, skyCoefficients, skyUniformNodes } from "./oceanSky";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * THE DOME BEHIND EVERYTHING, IN TWO LANGUAGES.
 *
 * **WHAT THIS FILE CAN AND CANNOT CHECK**, stated rather than implied. It can
 * prove the GLSL declares every uniform it is handed and carries no undeclared
 * number, that the node graph builds against three's real TSL, and that the two
 * materials agree on the render-state flags that decide whether a dome is a
 * background or a wall in front of the scene. It CANNOT prove they compute the
 * same colour — they are different languages, and the only instrument that
 * subtracts them is `scene-parity.spec.ts` on a real GPU.
 */

async function nodeMaterialModules(): Promise<NodeMaterialModules> {
  const [webgpu, tsl] = await Promise.all([import("three/webgpu"), import("three/tsl")]);
  return { webgpu, tsl } as unknown as NodeMaterialModules;
}

function withoutComments(shader: string): string {
  return shader.replace(/\/\/[^\n]*/g, "");
}

/**
 * The backdrop's own GLSL, with the two shared blocks it inlines subtracted.
 *
 * Scanning the whole fragment would scan Preetham's twenty-two constants as
 * well, and permitting those here would mean this file quietly re-permits every
 * number `oceanSky.test.ts` exists to guard.
 */
function backdropOwnGlsl(): string {
  return withoutComments(
    backdropFragmentShaderGlsl().replace(SKY_UNIFORMS_GLSL, "").replace(PREETHAM_SKY_GLSL, "")
  );
}

const SETTINGS_BELOW: OceanBackdropSettings = {
  horizonColor: new Color("#0A677C"),
  upColor: new Color("#2A7C8C"),
  downColor: new Color("#031B27"),
  waterColor: new Color("#0A677C"),
  fogDensityPerMetre: 0.02,
  backdropRadiusMetres: 420,
  drawsSky: false,
};

const SETTINGS_ABOVE: OceanBackdropSettings = {
  ...SETTINGS_BELOW,
  fogDensityPerMetre: 0,
  drawsSky: true,
};

function skyShared(): Record<string, { value: unknown }> {
  const coefficients = skyCoefficients(Math.PI / 4);
  return {
    uSkySunDirection: { value: new Vector3(0, 1, 0) },
    uBetaR: { value: new Vector3(...coefficients.betaR) },
    uBetaM: { value: new Vector3(...coefficients.betaM) },
    uSunE: { value: coefficients.sunE },
    uSunfade: { value: coefficients.sunfade },
    uMieG: { value: coefficients.mieDirectionalG },
  };
}

describe("ocean backdrop shader", () => {
  it("carries no numeric literal that is not one of the declared constants", () => {
    // MAGNITUDES, because the scan is sign-blind and has to be: a regex cannot
    // tell a negative literal from a subtraction, and claiming the sign would
    // turn every difference in the shader into a spurious constant.
    const declaredValues = new Set([0, 1, 0.001, 1.5, 1.4, 2]);
    const numericLiterals = (
      backdropOwnGlsl().match(/(?<![A-Za-z0-9_])\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? []
    ).map(Number);

    expect(numericLiterals.length, "the scan found nothing, which means it stopped working").toBeGreaterThan(0);
    for (const literal of numericLiterals) {
      expect(
        declaredValues.has(literal),
        `${literal} is in the backdrop shader but is not one of its named constants`
      ).toBe(true);
    }
  });

  /**
   * A uniform declared in GLSL and never bound reads ZERO and reports nothing.
   * A dome whose radius reads zero is not swallowed by the medium at all, which
   * is a plausible frame rather than a visible failure — so the binding and the
   * declaration are checked against each other rather than trusted.
   */
  it("binds exactly the uniforms its GLSL declares", () => {
    const fragment = backdropFragmentShaderGlsl();
    const declared = new Set(
      (withoutComments(fragment).match(/uniform\s+\w+\s+(\w+)/g) ?? []).map(
        (declaration) => declaration.split(/\s+/)[2]
      )
    );
    const material = oceanBackdropMaterial(SETTINGS_BELOW, skyShared(), null, null) as ShaderMaterial;

    for (const name of declared) {
      expect(material.uniforms[name], `${name} is declared in the GLSL but nothing binds it`).toBeDefined();
    }
    for (const name of Object.keys(material.uniforms)) {
      expect(declared.has(name), `${name} is bound but the GLSL never declares it`).toBe(true);
    }
  });

  it("puts the world position in the varying the fragment stage reads", () => {
    expect(backdropVertexShaderGlsl()).toContain("modelMatrix * vec4(position,1.0)");
    expect(backdropVertexShaderGlsl()).toContain("varying vec3 vW");
  });
});

describe("ocean backdrop material", () => {
  /**
   * **THE FLAGS ARE THE PORT AS MUCH AS THE COLOUR IS.** A dome that writes
   * depth, or that culls the face the camera is inside, is not a slightly wrong
   * background — it is an opaque wall in front of the entire scene. Node
   * materials carry these on the same properties, so the two can be compared
   * directly, and this is the check that catches the one that was forgotten.
   */
  it.each([
    ["below the waterline", SETTINGS_BELOW],
    ["above the waterline", SETTINGS_ABOVE],
  ])("gives both paths the same render state, %s", async (_name, settings) => {
    const modules = await nodeMaterialModules();
    const classic = oceanBackdropMaterial(settings, skyShared(), null, null);
    const node = oceanBackdropMaterial(
      settings,
      skyShared(),
      skyUniformNodes(modules, new Vector3(0, 1, 0), skyCoefficients(Math.PI / 4)),
      modules
    );

    // `fog` is declared on the subclasses rather than on `Material`, and both
    // paths carry it — reading it through one accessor keeps the comparison
    // honest instead of narrowing either side to its own class.
    const fogOf = (material: Material) => (material as Material & { fog?: boolean }).fog;

    expect(classic.side).toBe(BackSide);
    expect(node.side).toBe(classic.side);
    expect(node.depthWrite).toBe(classic.depthWrite);
    expect(fogOf(node)).toBe(fogOf(classic));
    expect(fogOf(node)).toBe(false);
    expect(node.transparent).toBe(classic.transparent);
  });

  it("builds the node graph against three's real TSL on both sides of the waterline", async () => {
    const modules = await nodeMaterialModules();
    const uniforms = skyUniformNodes(modules, new Vector3(0, 1, 0), skyCoefficients(Math.PI / 4));

    const below = oceanBackdropMaterial(SETTINGS_BELOW, skyShared(), uniforms, modules);
    const above = oceanBackdropMaterial(SETTINGS_ABOVE, skyShared(), uniforms, modules);

    expect((below as { colorNode?: unknown }).colorNode).toBeDefined();
    expect((above as { colorNode?: unknown }).colorNode).toBeDefined();
    // Two different graphs, because the two sides of the waterline are two
    // different jobs — not one graph with a uniform switching arms.
    expect((below as { colorNode?: unknown }).colorNode).not.toBe(
      (above as { colorNode?: unknown }).colorNode
    );
  });

  it("falls back to the classic material when the renderer has no node modules", () => {
    const material = oceanBackdropMaterial(SETTINGS_BELOW, skyShared(), null, null);
    expect(material).toBeInstanceOf(ShaderMaterial);
  });
});

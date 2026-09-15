import { Color, DoubleSide, ShaderMaterial, Vector2, Vector3, Vector4, type Material } from "three";
import { describe, expect, it } from "vitest";
import {
  ceilingFragmentShaderGlsl,
  ceilingVertexShaderGlsl,
  oceanCeilingMaterial,
  type OceanCeilingSettings,
} from "./oceanCeilingMaterial";
import {
  GERSTNER_SURFACE_GLSL,
  PREETHAM_SKY_GLSL,
  SKY_UNIFORMS_GLSL,
  WAVE_UNIFORMS_GLSL,
  skyCoefficients,
  skyUniformNodes,
  skyUniformValues,
  waveUniformNodes,
  waveUniformValues,
} from "./oceanSky";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * THE WATER SEEN FROM UNDERNEATH, IN TWO LANGUAGES.
 *
 * **WHAT THIS FILE CAN AND CANNOT CHECK.** It can prove the GLSL declares what
 * it binds and carries no undeclared number, that the node graph builds against
 * three's real TSL, and that both paths agree on the render state — which for
 * this material is not a detail, because the sheet is `DoubleSide` and a default
 * would cull the only face a viewer underwater can see. It CANNOT prove the two
 * compute the same colour; only `scene-parity.spec.ts` on a real GPU subtracts
 * them.
 */

const WAVE_COMPONENT_COUNT = 12;

async function nodeMaterialModules(): Promise<NodeMaterialModules> {
  const [webgpu, tsl] = await Promise.all([import("three/webgpu"), import("three/tsl")]);
  return { webgpu, tsl } as unknown as NodeMaterialModules;
}

function withoutComments(shader: string): string {
  return shader.replace(/\/\/[^\n]*/g, "");
}

/**
 * The ceiling's own GLSL, with the four shared blocks it inlines subtracted.
 *
 * Scanning the whole thing would scan Preetham's twenty-two constants and the
 * Gerstner sum as well, and permitting those here would quietly re-permit every
 * number `oceanSky.test.ts` exists to guard.
 */
function ceilingOwnGlsl(): string {
  return withoutComments(
    ceilingFragmentShaderGlsl().replace(SKY_UNIFORMS_GLSL, "").replace(PREETHAM_SKY_GLSL, "") +
      ceilingVertexShaderGlsl(WAVE_COMPONENT_COUNT)
        .replace(WAVE_UNIFORMS_GLSL(WAVE_COMPONENT_COUNT), "")
        .replace(GERSTNER_SURFACE_GLSL(WAVE_COMPONENT_COUNT), "")
  );
}

const SETTINGS: OceanCeilingSettings = {
  waterColor: new Color("#0A677C"),
  deepColor: new Color("#02191F"),
  sunColor: new Color("#FFF6E2"),
  brightness: 1.05,
  fogDensityPerMetre: 0.02,
  skyGain: 0.44,
  waveDamping: 0.42,
};

function skyShared(): Record<string, { value: unknown }> {
  return skyUniformValues(new Vector3(0, 1, 0), skyCoefficients(Math.PI / 4));
}

function waveShared(): Record<string, { value: unknown }> {
  return waveUniformValues(
    Array.from({ length: WAVE_COMPONENT_COUNT }, () => new Vector2(1, 0)),
    Array.from({ length: WAVE_COMPONENT_COUNT }, () => new Vector4(0.4, 0.3, 1.1, 0)),
    WAVE_COMPONENT_COUNT,
    0.8
  );
}

function classicMaterial(): ShaderMaterial {
  return oceanCeilingMaterial(
    SETTINGS,
    new Vector3(0, -1, 0),
    skyShared(),
    waveShared(),
    null,
    null,
    WAVE_COMPONENT_COUNT,
    null
  ) as ShaderMaterial;
}

async function nodeMaterial(modules: NodeMaterialModules): Promise<Material> {
  const waves = waveUniformNodes(
    modules,
    Array.from({ length: WAVE_COMPONENT_COUNT }, () => new Vector2(1, 0)),
    Array.from({ length: WAVE_COMPONENT_COUNT }, () => new Vector4(0.4, 0.3, 1.1, 0)),
    WAVE_COMPONENT_COUNT,
    0.8
  );
  return oceanCeilingMaterial(
    SETTINGS,
    new Vector3(0, -1, 0),
    skyShared(),
    waveShared(),
    skyUniformNodes(modules, new Vector3(0, 1, 0), skyCoefficients(Math.PI / 4)),
    waves.nodes,
    WAVE_COMPONENT_COUNT,
    modules
  );
}

describe("ocean ceiling shader", () => {
  it("carries no numeric literal that is not one of the declared constants", () => {
    // MAGNITUDES, because the scan is sign-blind and has to be: a regex cannot
    // tell a negative literal from a subtraction.
    const declaredValues = new Set([
      0, 1, 0.32, 0.7, 0.775, 0.75, 6, 0.06, 0.85, 0.02, 0.98, 5, 0.6, 2,
    ]);
    const numericLiterals = (
      ceilingOwnGlsl().match(/(?<![A-Za-z0-9_])\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? []
    ).map(Number);

    expect(numericLiterals.length, "the scan found nothing, which means it stopped working").toBeGreaterThan(0);
    for (const literal of numericLiterals) {
      expect(
        declaredValues.has(literal),
        `${literal} is in the ceiling shader but is not one of its named constants`
      ).toBe(true);
    }
  });

  it("binds exactly the uniforms its two stages declare", () => {
    const declared = new Set(
      (
        withoutComments(
          ceilingVertexShaderGlsl(WAVE_COMPONENT_COUNT) + ceilingFragmentShaderGlsl()
        ).match(/uniform\s+\w+\s+(\w+)/g) ?? []
      ).map((declaration) => declaration.split(/\s+/)[2].replace(/\[.*$/, ""))
    );
    const material = classicMaterial();

    for (const name of declared) {
      expect(material.uniforms[name], `${name} is declared in the GLSL but nothing binds it`).toBeDefined();
    }
    for (const name of Object.keys(material.uniforms)) {
      expect(declared.has(name), `${name} is bound but neither stage declares it`).toBe(true);
    }
  });

  /**
   * **PINNED BECAUSE IT IS A DEFECT, NOT A DESIGN.** `uSunDirection` is declared
   * and bound and never read: the sun reaches this surface through
   * `skyThroughSnellsWindow`, which takes its direction from the shared sky
   * uniforms. It is left in place because deleting it is a cleanup and reviving
   * it is a look change, and a port is the wrong moment for either — but the
   * fact is asserted so the next reader finds it stated rather than rediscovers
   * it.
   */
  it("still carries the sun direction it never reads", () => {
    const body = withoutComments(ceilingFragmentShaderGlsl());
    const mentions = body.match(/\buSunDirection\b/g) ?? [];
    expect(mentions.length, "uSunDirection is read now — delete this test and the uniform's note").toBe(1);
    expect(body).toContain("uniform vec3 uSunDirection;");
  });

  /** It used to be bound to a uniform this shader has never declared. */
  it("does not bind a foam threshold, because this face has no foam term", () => {
    expect(Object.keys(classicMaterial().uniforms)).not.toContain("uFoamEdge");
    expect(ceilingFragmentShaderGlsl()).not.toContain("uFoamEdge");
  });
});

describe("ocean ceiling material", () => {
  /**
   * **THE RENDER STATE IS THE PORT AS MUCH AS THE COLOUR IS.** A refused
   * material is replaced by a default `NodeMaterial` (`NodeBuilder.js:3145`),
   * which does not carry `side` — and this sheet is the one a viewer underwater
   * looks up at from its back face. Defaulted to `FrontSide` it is culled, and
   * the ceiling simply is not there.
   */
  it("gives both paths the same render state", async () => {
    const modules = await nodeMaterialModules();
    const classic = classicMaterial();
    const node = await nodeMaterial(modules);
    const fogOf = (material: Material) => (material as Material & { fog?: boolean }).fog;

    expect(classic.side).toBe(DoubleSide);
    expect(node.side).toBe(classic.side);
    expect(node.transparent).toBe(classic.transparent);
    expect(node.transparent).toBe(true);
    expect(fogOf(node)).toBe(fogOf(classic));
    expect(node.depthWrite).toBe(classic.depthWrite);
  });

  /**
   * It sets `vertexNode`, not `positionNode`. The GLSL builds a WORLD position
   * and projects it itself; reproducing that through `positionNode` would mean
   * inverting the model matrix, which is only correct while that matrix stays a
   * pure translation — an assumption about the rig this material must not make.
   */
  it("builds both stages against three's real TSL", async () => {
    const modules = await nodeMaterialModules();
    const material = (await nodeMaterial(modules)) as Material & {
      vertexNode?: unknown;
      positionNode?: unknown;
      colorNode?: unknown;
    };

    expect(material.vertexNode, "the displaced clip position").toBeDefined();
    expect(material.colorNode).toBeDefined();
    // Left at three's own default, which is null rather than undefined: setting
    // it would reassign `positionLocal` (`NodeMaterial.js:804`) for everything
    // downstream, which is the trap that cost the bubbles a frame.
    expect(material.positionNode, "positionNode would reassign positionLocal").toBeNull();
  });

  /**
   * A wave field whose clock never advances is a FROZEN sea — a plausible frame,
   * not an error, and indistinguishable from a working one on a screenshot. The
   * node path hands that write back as a function so it cannot be forgotten
   * quietly; this asserts the function actually reaches the uniform.
   */
  it("advances the wave clock the frame loop owes it", async () => {
    const modules = await nodeMaterialModules();
    const waves = waveUniformNodes(modules, [new Vector2(1, 0)], [new Vector4(0.4, 0.3, 1.1, 0)], 1, 0.8);
    const clock = waves.nodes.time as unknown as { value: number };

    expect(clock.value).toBe(0);
    waves.setElapsedSeconds(6);
    expect(clock.value).toBe(6);
  });

  it("falls back to the classic material when the renderer has no node modules", () => {
    expect(classicMaterial()).toBeInstanceOf(ShaderMaterial);
  });
});

import { MeshStandardMaterial, type MeshStandardMaterialParameters } from "three";
import type { Node, NodeBuilder } from "three/webgpu";
import type { NodeMaterialModules } from "./nodeMaterials";

/**
 * THE NODE PATH'S EQUIVALENT OF `onBeforeCompile` CHUNK INJECTION, WHICH IS NOT
 * A NODE ASSIGNMENT.
 *
 * §26 Phase 7. Eight of this app's nine shader patches are on the ocean, and
 * every one of them INJECTS into a material three otherwise assembles itself —
 * the kelp bends `transformed` and keeps three's lighting, the seabed multiplies
 * `diffuseColor` and keeps three's texture, the caustics add to `gl_FragColor`
 * and keep three's fog. None of them replaces anything.
 *
 * **THE OBVIOUS TRANSLATION IS WRONG, AND IT IS WRONG SILENTLY.** `positionNode`
 * and `outputNode` look like the node-path spellings of `<begin_vertex>` and
 * `<tonemapping_fragment>`. They are not: both REPLACE the value three computed
 * rather than modify it, and what they replace is load-bearing.
 *
 *   - `NodeMaterial.setupPosition` applies instancing at `NodeMaterial.js:796`
 *     and reads `positionNode` at `:802` — AFTER it. `positionNode` then does
 *     `positionLocal.assign(...)`, which discards the instance matrix outright.
 *     A kelp bed ported that way does not sway wrongly; all three thousand
 *     blades collapse onto the world origin, because every instance's position
 *     WAS that matrix.
 *   - `outputNode` is read at `:545` after `setupOutput` has already folded fog
 *     into the result, so a multiply expressed there scales the fog as well as
 *     the surface. The classic patches all sit at `<tonemapping_fragment>`,
 *     which three's fragment shaders place BEFORE `<fog_fragment>`
 *     (`meshphysical.glsl.js`, last six lines).
 *
 * The mechanism that does inject is the one three documents on `setupOutput`
 * itself (`NodeMaterial.js:1160-1178`): **subclass the node material and
 * override the setup step**, modify the ambient property node, and hand control
 * back to `super`. That places the change exactly where the chunk marker places
 * it, keeps everything three does around it, and needs no knowledge of three's
 * internals beyond the method name.
 *
 * So this module gives each injection point a name, and each patch declares
 * which ones it uses:
 *
 *     <begin_vertex>           -> localPositionOffset    (setupPosition)
 *     <map_fragment>           -> diffuseColorMultiplier (setupDiffuseColor)
 *     <tonemapping_fragment>   -> litColorAdjustment     (setupOutput)
 *
 * **PATCHES ARE READ AT SETUP TIME, NOT AT CONSTRUCTION, AND THAT IS WHAT KEEPS
 * THE CALL SITES.** `applyCaustics(material, uniforms)` runs on a material
 * somebody else already built, and the seabed takes two patches from two
 * modules that do not know about each other. A class fixed at construction
 * would have forced every one of those call sites to be re-plumbed into a
 * single factory call. Instead the list lives on the instance and the subclass
 * reads it when three first builds the shader, so `applyCaustics` still chains
 * onto whatever is already there — the same convention, one layer over.
 *
 * WHAT THIS DOES NOT DO. It does not make the two paths verify each other.
 * Nothing here can, because a node graph and a GLSL string have no common
 * representation to compare. Each ported patch therefore declares its numbers
 * once, builds both implementations from them, and ships a test asserting the
 * GLSL text still contains the numbers the node graph was built from — the
 * shape `forestFoliageMaterial.ts` established.
 */

/**
 * A node-path shader patch: the same injection a classic `onBeforeCompile`
 * performs, expressed as three optional hooks.
 *
 * Every hook is optional because most patches use one or two. The `name` is
 * required for the same reason `requireShaderChunks` requires one — a report
 * that cannot say WHICH patch is not actionable.
 *
 * `Node` is imported as a TYPE ONLY. `three/webgpu` is loaded dynamically to
 * keep a second copy of three out of every visitor's bundle, and a type import
 * is erased before the bundler sees it — so the hooks stay checked without
 * defeating the thing `nodeMaterials.ts` exists to protect. The node modules
 * themselves are still handed to each patch as an argument.
 */
export type NodeMaterialChunkPatch = {
  /** Which patch this is, for the console line when something is wrong. */
  name: string;
  /**
   * Added to `positionLocal` BEFORE instancing, skinning and morphing —
   * the position of `<begin_vertex>`. A vec3 node.
   */
  localPositionOffset?: () => Node<"vec3">;
  /**
   * Multiplied into `diffuseColor.rgb` after the map and before the lighting —
   * the position of `<map_fragment>`. A vec3 node.
   */
  diffuseColorMultiplier?: () => Node<"vec3">;
  /**
   * Given the lit colour and returning the replacement, before fog and before
   * the frame's tone curve — the position of `<tonemapping_fragment>`. Takes
   * and returns a vec3 node.
   */
  litColorAdjustment?: (litColor: Node<"vec3">) => Node<"vec3">;
};

/**
 * A node material that reads a mutable list of patches when three builds it.
 *
 * Exposed as a type rather than a class because the class cannot exist until
 * `three/webgpu` has loaded — see the header of `nodeMaterials.ts` for why that
 * is a dynamic import and why every consumer of it is handed the modules.
 */
export type PatchableNodeMaterial = MeshStandardMaterial & {
  readonly chunkPatches: NodeMaterialChunkPatch[];
};

/**
 * Whether this material will apply node-path chunk patches added to it.
 *
 * Asked of the instance, not of the renderer, for the reason `isNodeRenderer`
 * gives: the question is what will compile THIS material.
 */
export function isPatchableNodeMaterial(material: object): material is PatchableNodeMaterial {
  return Array.isArray((material as { chunkPatches?: unknown }).chunkPatches);
}

/**
 * Adds a patch to a node material, and reports if it cannot.
 *
 * Returns whether the patch was taken, so a call site can fall through to its
 * classic `onBeforeCompile` arm. A false here is the ORDINARY answer on the
 * classic renderer and is not logged; only a node material that is not
 * patchable is, because that one is a real mistake — it means a ported material
 * was built with a plain `MeshStandardNodeMaterial` and its patches are being
 * dropped on the floor.
 */
export function addNodeMaterialChunkPatch(material: object, patch: NodeMaterialChunkPatch): boolean {
  if (isPatchableNodeMaterial(material)) {
    material.chunkPatches.push(patch);
    return true;
  }
  if ((material as { isNodeMaterial?: boolean }).isNodeMaterial === true) {
    console.error(
      `${patch.name}: this node material was not built by patchedStandardNodeMaterial, so the patch ` +
        "was NOT applied and the scene will render without it. See shared/nodeMaterialChunkPatch.ts."
    );
  }
  return false;
}

/**
 * A `MeshStandardNodeMaterial` whose `chunkPatches` are injected at the three
 * points named above.
 *
 * The subclass is created per material rather than once per module because the
 * classes come from a dynamically imported module and there is no correct place
 * to cache them that is not a second cache with its own invalidation question.
 * Materials are counted in tens here — the ocean builds seven — and a class
 * declaration is cheap next to the node graph it will hold.
 */
export function patchedStandardNodeMaterial(
  modules: NodeMaterialModules,
  parameters: MeshStandardMaterialParameters
): PatchableNodeMaterial {
  const { MeshStandardNodeMaterial } = modules.webgpu;
  const { diffuseColor, positionLocal, vec3, vec4 } = modules.tsl;

  class PatchedMeshStandardNodeMaterial extends MeshStandardNodeMaterial {
    readonly chunkPatches: NodeMaterialChunkPatch[] = [];

    setupPosition(builder: NodeBuilder) {
      for (const patch of this.chunkPatches) {
        if (patch.localPositionOffset) {
          positionLocal.addAssign(patch.localPositionOffset());
        }
      }
      return super.setupPosition(builder);
    }

    setupDiffuseColor(builder: NodeBuilder) {
      super.setupDiffuseColor(builder);
      for (const patch of this.chunkPatches) {
        if (patch.diffuseColorMultiplier) {
          diffuseColor.rgb.mulAssign(vec3(patch.diffuseColorMultiplier()));
        }
      }
    }

    setupOutput(builder: NodeBuilder, outputNode: Node) {
      const output = outputNode as unknown as { rgb: Node<"vec3">; a: Node<"float"> };
      let litColor: Node<"vec3"> = output.rgb;
      for (const patch of this.chunkPatches) {
        if (patch.litColorAdjustment) {
          litColor = patch.litColorAdjustment(litColor);
        }
      }
      return super.setupOutput(builder, vec4(litColor, output.a) as unknown as Node);
    }
  }

  // `MeshStandardNodeMaterial` extends `MeshStandardMaterial`, so this is the
  // declared type rather than an invention — every consumer treats it as the
  // standard material it is, and only the shader assembly differs.
  return new PatchedMeshStandardNodeMaterial(parameters) as unknown as PatchableNodeMaterial;
}

/**
 * The standard material for whichever renderer is drawing, patchable either way.
 *
 * Every seabed, boulder, sponge and blade in the ocean is a
 * `MeshStandardMaterial` that some other module later injects into. On the
 * classic path that injection is `onBeforeCompile`; on the node path it is a
 * chunk patch, and a plain `MeshStandardNodeMaterial` would take neither — it
 * would render, correctly and without its patch, which is the silent failure
 * this whole module exists to close. So the choice is made in one place and
 * every call site is one line.
 */
export function standardMaterialForRenderer(
  nodeModules: NodeMaterialModules | null,
  parameters: MeshStandardMaterialParameters
): MeshStandardMaterial {
  return nodeModules ? patchedStandardNodeMaterial(nodeModules, parameters) : new MeshStandardMaterial(parameters);
}

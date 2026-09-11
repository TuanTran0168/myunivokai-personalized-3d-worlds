import { Color, MeshStandardMaterial, type Material } from "three";
import { requireShaderChunks, SHADER_CHUNK_MARKERS } from "@/features/scene-renderers/shared/shaderChunkPatch";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * THE FOLIAGE RECOLOUR, IN BOTH SHADER LANGUAGES, FROM ONE SET OF NUMBERS.
 *
 * §26 Phase 7, patch 1 of 9 — `forestModels.ts:311`, the lowest-complexity
 * entry in §8.2's table and the one chosen to establish the shape the other
 * eight follow.
 *
 * WHAT IT DOES, and why it is not a plain multiply. The canopy is real scanned
 * leaf-cluster geometry with its own leaf texture, and the season tint arrives
 * per instance. Multiplying an autumn orange over a green leaf texture gives
 * mud — two hues fighting — so the texture is collapsed to LUMINANCE and used
 * only as light/dark detail, while the hue comes entirely from the instance
 * colour. The luminance is then remapped into a gentle band rather than used
 * raw, because a leaf texture's darkest pixels are near black and a canopy lit
 * by its own texture's black is a canopy that reads as dead.
 *
 * **KEEPING THE TEXTURE AT ALL IS THE POINT, and it was learned the hard way.**
 * The obvious simplification — drop the leaf map, flat-shade the canopy, tint
 * it per instance — is what collapsed canopies into featureless faceted blobs
 * and produced the owner's report *"lá như hình vuông"*, the leaves look like
 * squares. The geometry is 3k-20k vertices of real leaf clusters and its smooth
 * normals are kept for the same reason. Any future simplification of this
 * material has to answer that frame.
 *
 * **WHY ONE FILE INSTEAD OF TWO.** The GLSL patch and the TSL graph are the same
 * five numbers arranged the same way. Declared separately they would drift the
 * first time one was tuned, the frames would differ by an amount too small to
 * notice and too large to be right, and nothing would throw —
 * `sceneToneMapping.ts` exists because exactly that happened to the tone curve.
 * So the constants are declared once at the top, both implementations read them,
 * and `forestFoliageMaterial.test.ts` asserts the GLSL text still contains the
 * numbers the TSL graph is built from.
 *
 * **WHY BOTH IMPLEMENTATIONS SHIP AT ONCE.** `onBeforeCompile` does not exist on
 * a node material — there is no GLSL string to patch, the shader is assembled
 * from a graph — and `WebGLRenderer` cannot draw a node material. Until Phase 9
 * swaps the renderer, every visitor is on the classic path and the parity
 * harness is on the node one. That is not an awkward transition state; it is
 * what makes the port checkable, because `scene-parity.spec.ts` renders the same
 * scene through both and subtracts the frames.
 */

/**
 * Rec. 601 luma weights. NOT Rec. 709 (0.2126/0.7152/0.0722), and the
 * difference is visible here: 601 weights green lower, and a canopy is almost
 * entirely green, so 709 would flatten the leaf texture's own variation into
 * near-uniform brightness — the detail this whole patch exists to keep.
 */
const LEAF_LUMINANCE_RED_WEIGHT = 0.299;
const LEAF_LUMINANCE_GREEN_WEIGHT = 0.587;
const LEAF_LUMINANCE_BLUE_WEIGHT = 0.114;

/**
 * The band the texture's 0-1 luminance is remapped into.
 *
 * The floor is not zero and the ceiling is above one on purpose: leaves in
 * shadow should read as shadowed leaves rather than as holes, and the brightest
 * ones should lift slightly above the flat instance tint so the canopy has
 * specular-looking highlights without a specular term.
 */
const LEAF_SHADOW_BRIGHTNESS = 0.72;
const LEAF_HIGHLIGHT_BRIGHTNESS = 1.12;

/** The source material's fallbacks, for a GLB that ships without them. */
const DEFAULT_FOLIAGE_ROUGHNESS = 0.9;
const FOLIAGE_METALNESS = 0;

/**
 * White, because the hue comes from the per-instance colour and nowhere else.
 * A tinted base here would multiply into every season.
 */
const FOLIAGE_BASE_COLOR = "#FFFFFF";

/**
 * All foliage shares one program despite per-instance colours.
 *
 * The node path's equivalent is structural rather than a cache hint — one
 * `MeshStandardNodeMaterial` with one `colorNode`, shared — so this constant is
 * used only by the classic variant.
 */
const FOLIAGE_PROGRAM_CACHE_KEY = "forest-foliage-recolor";

/**
 * The replacement for `<map_fragment>`, built from the constants above.
 *
 * Exported so the test can assert the numbers in it are the same numbers the
 * TSL graph uses. A template literal rather than a fixed string for the same
 * reason: a tuned constant must move both implementations or neither.
 */
export function foliageMapFragmentGlsl(): string {
  return [
    "#ifdef USE_MAP",
    "  vec4 sampledLeafColor = texture2D( map, vMapUv );",
    `  float leafLuma = dot( sampledLeafColor.rgb, vec3( ${LEAF_LUMINANCE_RED_WEIGHT}, ${LEAF_LUMINANCE_GREEN_WEIGHT}, ${LEAF_LUMINANCE_BLUE_WEIGHT} ) );`,
    `  leafLuma = mix( ${LEAF_SHADOW_BRIGHTNESS}, ${LEAF_HIGHLIGHT_BRIGHTNESS}, leafLuma );`,
    "  diffuseColor.rgb *= leafLuma;",
    "  diffuseColor.a *= sampledLeafColor.a;",
    "#endif"
  ].join("\n");
}

type FoliageSourceMaterial = {
  map: MeshStandardMaterial["map"];
  normalMap: MeshStandardMaterial["normalMap"];
  alphaMap: MeshStandardMaterial["alphaMap"];
  transparent: boolean;
  alphaTest: number;
  side: MeshStandardMaterial["side"];
  roughness: number;
};

function readSourceMaterial(originalMaterial: Material): FoliageSourceMaterial {
  const source = originalMaterial as MeshStandardMaterial;
  return {
    map: source.map ?? null,
    normalMap: source.normalMap ?? null,
    alphaMap: source.alphaMap ?? null,
    transparent: source.transparent,
    alphaTest: source.alphaTest,
    side: source.side,
    roughness: source.roughness ?? DEFAULT_FOLIAGE_ROUGHNESS
  };
}

/**
 * The classic path: a `MeshStandardMaterial` whose `<map_fragment>` is replaced.
 *
 * This is what every visitor renders today and what `scene-parity.spec.ts`
 * measures the node variant against.
 */
function classicFoliageMaterial(originalMaterial: Material): MeshStandardMaterial {
  const source = readSourceMaterial(originalMaterial);
  const material = new MeshStandardMaterial({
    ...source,
    metalness: FOLIAGE_METALNESS,
    color: new Color(FOLIAGE_BASE_COLOR)
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = requireShaderChunks(shader.fragmentShader, "forestModels leaf recolour", [
      SHADER_CHUNK_MARKERS.mapFragment
    ]).replace(SHADER_CHUNK_MARKERS.mapFragment, foliageMapFragmentGlsl());
  };
  material.customProgramCacheKey = () => FOLIAGE_PROGRAM_CACHE_KEY;
  return material;
}

/**
 * The node path: a `MeshStandardNodeMaterial` with a `colorNode`.
 *
 * **`colorNode` IS THE EXACT EQUIVALENT OF REPLACING `<map_fragment>`, and that
 * is a fact about three rather than a convenience.** `MaterialNode`'s COLOR
 * scope is `material.color.mul(texture(map))` when a map is present
 * (`MaterialNode.js:122-134`), and `NodeMaterial.setupDiffuseColor` uses that
 * composition ONLY when `this.colorNode` is null (`NodeMaterial.js:833`). So
 * assigning `colorNode` displaces precisely the multiply the GLSL patch
 * displaces, and nothing else.
 *
 * **THE INSTANCE COLOUR IS NOT APPLIED HERE, AND MUST NOT BE.**
 * `setupDiffuseColor` multiplies it in afterwards — `colorNode =
 * instanceColor.mul(colorNode)` at `NodeMaterial.js:848` — which is the node
 * path's own version of `<color_fragment>`. Applying it here as well would
 * square the season tint. The classic patch relies on the same division of
 * labour: it multiplies `diffuseColor.rgb`, which three has already multiplied
 * by `vColor`.
 *
 * **AND THE ALPHA SURVIVES THAT MULTIPLY, which is not obvious and was checked
 * rather than assumed.** `instanceColor` is a vec3 and the `colorNode` built
 * below is a vec4, so the multiply promotes one to the other —
 * `OperatorNode.getNodeType` returns the longer type (`:183-191`) — and the
 * promotion is `NodeBuilder.format`'s `vec4( <vec3>, 1.0 )` (`:3407`). The w
 * component is therefore multiplied by ONE, so the leaf texture's alpha reaches
 * `diffuseColor.a` untouched, exactly as `<color_fragment>` leaves it on the
 * classic path. A promotion filling w with 0 instead would have made every leaf
 * fully transparent, on the node path only.
 *
 * Where the base colour comes from, and why not from `materialColor`, is on the
 * line that builds it.
 */
function nodeFoliageMaterial(originalMaterial: Material, modules: NodeMaterialModules): MeshStandardMaterial {
  const source = readSourceMaterial(originalMaterial);
  const { MeshStandardNodeMaterial } = modules.webgpu;
  const { dot, float, mix, texture, uniform, vec3, vec4 } = modules.tsl;

  const material = new MeshStandardNodeMaterial({
    ...source,
    metalness: FOLIAGE_METALNESS,
    color: new Color(FOLIAGE_BASE_COLOR)
  });

  if (source.map) {
    const sampledLeafColor = texture(source.map);
    const leafLuminance = dot(
      sampledLeafColor.rgb,
      vec3(LEAF_LUMINANCE_RED_WEIGHT, LEAF_LUMINANCE_GREEN_WEIGHT, LEAF_LUMINANCE_BLUE_WEIGHT)
    );
    const remappedLuminance = mix(float(LEAF_SHADOW_BRIGHTNESS), float(LEAF_HIGHLIGHT_BRIGHTNESS), leafLuminance);
    // `uniform(material.color)` rather than `materialReference("color","color")`,
    // and rather than `materialColor`.
    //
    // `materialColor` is the composition WITH the map (`MaterialNode.js:126`),
    // and using it would sample the leaf texture twice — once for its hue, which
    // is the one thing this material exists to discard. `materialReference`
    // returns a bare `MaterialReferenceNode` carrying no operator methods, so it
    // cannot be multiplied without an untyped escape. A uniform reads the same
    // `Color` INSTANCE the material holds, so the two cannot disagree, and its
    // `.value` is the hook if the base colour ever stops being a constant.
    const baseColor = uniform(material.color);
    material.colorNode = vec4(baseColor.mul(remappedLuminance), sampledLeafColor.a);
  }

  // `MeshStandardNodeMaterial` extends `MeshStandardMaterial`, so this is the
  // declared type rather than a cast — every consumer treats it as the standard
  // material it is, and only the shader assembly differs.
  return material as unknown as MeshStandardMaterial;
}

/**
 * The recolourable foliage material for whichever renderer is drawing.
 *
 * `nodeModules` is null on the classic path, which is every visitor today. It
 * is passed in rather than read from a module-level cache because "have the
 * node modules been loaded" and "is this scene being drawn by a node renderer"
 * are different questions, and answering the second with the first is the kind
 * of coincidence that holds until it does not.
 */
export function recolorableFoliageMaterial(
  originalMaterial: Material,
  nodeModules: NodeMaterialModules | null
): MeshStandardMaterial {
  return nodeModules ? nodeFoliageMaterial(originalMaterial, nodeModules) : classicFoliageMaterial(originalMaterial);
}

import { mergeBufferGeometries } from "three-stdlib";
import { rarityFeature } from "@/lib/rarity";
import {
  Box3,
  BufferGeometry,
  Color,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3
} from "three";

// The nature-1 asset catalog: every modelKey the backend config can emit maps
// to self-hosted, draco-compressed CC0/CC-BY GLB files under
// public/assets/nature/models (sources and licenses in
// public/assets/nature/ATTRIBUTION.md). Models are normalized at load time —
// uniform-scaled to targetHeight with the foot centered at the origin — so
// catalog entries never need hand-tuned offsets.

export const NATURE_MODEL_BASE_PATH = "/assets/nature/models/";

export type ForestModelDefinition = {
  fileName: string;
  /** World-space height the normalized model is scaled to. */
  targetHeight: number;
  /**
   * ONLY for files that pack several complete stand-alone models (e.g.
   * Quaternius' "Birch Trees" set): each top-level subtree becomes its own
   * variant. Never set it for single-model files — a normal tree's bark and
   * leaves are sibling meshes, and splitting them apart renders bare trunks
   * next to floating canopies.
   */
  splitIntoVariants?: boolean;
};

export const TREE_MODEL_CATALOG: Record<string, ForestModelDefinition[]> = {
  "tree-birch": [{ fileName: "tree-birch-1.glb", targetHeight: 7.5, splitIntoVariants: true }],
  // Real scanned broadleaf oaks (Sketchfab CC-BY): small/medium/large in one
  // file, so splitIntoVariants yields three canopy silhouettes. Unlike the
  // firs, this pack's canopy material IS named "leaf*", so it deliberately
  // stays on the season-recolor path — correct for a deciduous tree, which is
  // what makes autumn oaks turn.
  "tree-oak": [{ fileName: "tree-oak-realistic.glb", targetHeight: 7.0, splitIntoVariants: true }],
  // Real, game-ready fir scans (Sketchfab CC-BY, LOD0 kept, 2048px PBR
  // textures): three distinct conifers in one file, so splitIntoVariants gives
  // the scatter three silhouettes. Their branch material is alpha-MASK leaf
  // cards with a normal map — the detail the stylized low-poly cones could not
  // carry, which is what made the forest read as a cartoon. Deliberately NOT
  // named to match FOLIAGE_MATERIAL_NAME_PATTERN: these keep their real
  // textures instead of being flat-tinted per season, which is also true to
  // life (firs are evergreen).
  "tree-pine": [{ fileName: "tree-fir-realistic.glb", targetHeight: 8.5, splitIntoVariants: true }],
  // Only the Quaternius snow pine — the CC-BY "Snow Tree" clashed with the
  // pack's art style (owner: style coherence beats variety).
  "tree-pine-snow": [{ fileName: "tree-pine-snow-1.glb", targetHeight: 8.0 }],
  "tree-dead": [
    { fileName: "tree-dead-1.glb", targetHeight: 5.5 },
    { fileName: "tree-dead-2.glb", targetHeight: 5.0 }
  ],
  // Blossom keeps riding the oak silhouettes, now the realistic ones, wearing
  // the pink foliage anchor — the season-recolor path makes that work without a
  // dedicated cherry model.
  "tree-blossom": [{ fileName: "tree-oak-realistic.glb", targetHeight: 6.2, splitIntoVariants: true }]
};

/**
 * Cheap conifers for the horizon belt (LOD2 of the same fir pack, 512px
 * textures): the land beyond the treeline used to be bare tinted ground, which
 * read as an oddly empty clearing rimmed by nothing. These fill it. They are
 * only ever seen at distance, so the low-detail LOD is invisible as such while
 * costing a fraction of the LOD0 trunks.
 */
export const DISTANT_TREE_MODEL_DEFINITION: ForestModelDefinition = {
  fileName: "tree-fir-distant.glb",
  targetHeight: 9,
  splitIntoVariants: true
};

export const ROCK_MODEL_DEFINITIONS: ForestModelDefinition[] = [
  { fileName: "rock-mossy-1.glb", targetHeight: 1.0 },
  { fileName: "rock-mossy-2.glb", targetHeight: 0.9 },
  { fileName: "rock-mossy-3.glb", targetHeight: 1.1 }
];

export const GRASS_MODEL_DEFINITIONS: ForestModelDefinition[] = [
  { fileName: "grass-1.glb", targetHeight: 0.45 },
  { fileName: "grass-tall-1.glb", targetHeight: 0.65 }
];

// Understory decoration; scattered between the trees for ground richness.
export const DECOR_MODEL_DEFINITIONS: ForestModelDefinition[] = [
  { fileName: "bush-1.glb", targetHeight: 1.1 },
  { fileName: "bush-flowers-1.glb", targetHeight: 1.0 },
  { fileName: "fern-1.glb", targetHeight: 0.7 },
  { fileName: "flower-group-1.glb", targetHeight: 0.55 },
  { fileName: "flower-single-1.glb", targetHeight: 0.5 },
  { fileName: "mushroom-1.glb", targetHeight: 0.35 },
  { fileName: "stump-moss-1.glb", targetHeight: 0.55 }
];

export type AnimalModelDefinition = ForestModelDefinition & {
  /** Animation clip preferred for wandering; empty for static models. */
  walkClipName: string;
};

export const ANIMAL_MODEL_CATALOG: Record<string, AnimalModelDefinition> = {
  "animal-deer": { fileName: "animal-deer.glb", targetHeight: 1.7, walkClipName: "Walk" },
  "animal-fox": { fileName: "animal-fox.glb", targetHeight: 0.8, walkClipName: "Walk" },
  "animal-wolf": { fileName: "animal-wolf.glb", targetHeight: 1.1, walkClipName: "Walk" },
  "animal-boar": { fileName: "animal-boar.glb", targetHeight: 0.9, walkClipName: "Armature|walk" },
  "animal-rabbit": { fileName: "animal-rabbit.glb", targetHeight: 0.45, walkClipName: "Armature|walk" },
  // Schema 1.1 additions ("đa dạng động vật hơn").
  "animal-stag": { fileName: "animal-stag.glb", targetHeight: 2.0, walkClipName: "Walk" },
  "animal-bear": { fileName: "animal-bear.glb", targetHeight: 1.5, walkClipName: "Walk" },
  // The squirrel rig ships a scamper ("run") rather than a walk — correct gait
  // for the species, and the renderer scales clip speed to the wander speed.
  "animal-squirrel": {
    fileName: "animal-squirrel.glb",
    targetHeight: 0.35,
    walkClipName: "SquirrelValentine_Rig|SquirrelValentine_Rig|SquirrelValentine_Rig|run"
  }
};

// Rare "legendary" ground animals ("động vật quý hiếm") — a reskin of an
// existing animated animal with a luminous coat, so they need no new models
// and still play their Walk clip. One occasionally wanders a world, seed-gated
// off the world seed (= DNA).
export type SpecialAnimalDefinition = {
  key: string;
  label: string;
  baseModelKey: string;
  coatColor: string;
  emissiveIntensity: number;
  scale: number;
};

// A species in the catalogue with no appearance here would otherwise spread
// `undefined` into a definition and render an untextured, unscaled body. This
// turns that into a module-load failure, which the build catches rather than a
// viewer does.
function requireAppearance<T>(appearances: Record<string, T>, key: string): T {
  const appearance = appearances[key];
  if (!appearance) {
    throw new Error(`rare species "${key}" is in the rarity catalogue with no appearance defined`);
  }
  return appearance;
}

// Coat and model per species. The LIST — which species exist and in what order
// — comes from lib/rarity.ts instead, because the species is picked by index
// (`floor(roll * length)`): a list that lived here could be reordered without
// the admin app's observed-rate panel noticing, and every past world would
// silently change species.
const SPECIAL_ANIMAL_APPEARANCE: Record<string, Omit<SpecialAnimalDefinition, "key" | "label">> = {
  "white-stag": { baseModelKey: "animal-stag", coatColor: "#EFF3F7", emissiveIntensity: 0.35, scale: 1.15 },
  "golden-fox": { baseModelKey: "animal-fox", coatColor: "#F6C445", emissiveIntensity: 0.5, scale: 1.1 },
  "spirit-wolf": { baseModelKey: "animal-wolf", coatColor: "#9FD0E8", emissiveIntensity: 0.55, scale: 1.1 },
  "verdant-stag": { baseModelKey: "animal-stag", coatColor: "#7BE0A3", emissiveIntensity: 0.45, scale: 1.1 }
};
const SPECIAL_ANIMAL_FEATURE = rarityFeature("forest-special-animal");
export const SPECIAL_ANIMAL_DEFINITIONS: SpecialAnimalDefinition[] = (SPECIAL_ANIMAL_FEATURE.species ?? []).map(
  (species) => ({ ...species, ...requireAppearance(SPECIAL_ANIMAL_APPEARANCE, species.key) })
);
// ~40% of worlds host one rare animal; a second roll picks the species.
export const SPECIAL_ANIMAL_PROBABILITY = SPECIAL_ANIMAL_FEATURE.probability;

// Hover/detail display names for the interactive wildlife layer.
export const ANIMAL_DISPLAY_NAMES: Record<string, string> = {
  "animal-deer": "Deer",
  "animal-fox": "Fox",
  "animal-wolf": "Wolf",
  "animal-boar": "Boar",
  "animal-rabbit": "Rabbit",
  "animal-stag": "Stag",
  "animal-bear": "Bear",
  "animal-squirrel": "Squirrel"
};

// Birds with REAL skeletal flap animations (the fake whole-body roll on a
// static perched model was the "vỗ cánh quá tệ" complaint). flapClipName is
// the animation clip to loop; each is normalized by wingspan (longest axis),
// not height. Alternated per flock for species variety.
// headingOffsetRadians corrects the model's rest facing so it flies nose-first
// (the renderer yaws to atan2(velocity) which assumes +Z forward; a model
// authored facing another axis needs this offset, else it flies backward).
export type BirdModelDefinition = ForestModelDefinition & { flapClipName: string; headingOffsetRadians: number };
export const BIRD_MODEL_DEFINITIONS: BirdModelDefinition[] = [
  // A rigged hawk — realistic flapping flight (Sherkiz, CC-BY).
  { fileName: "bird-hawk.glb", targetHeight: 1.3, flapClipName: "metarig|Fly", headingOffsetRadians: Math.PI },
  // A Quaternius flyer — stylized but skeletally animated, style-matched to
  // the Quaternius forest (CC0).
  { fileName: "bird-armabee.glb", targetHeight: 0.9, flapClipName: "CharacterArmature|Fast_Flying", headingOffsetRadians: Math.PI }
];

// Per-bird plumage tints multiplied into the model materials — one model,
// several species impressions.
export const BIRD_PLUMAGE_TINTS = ["#FFFFFF", "#C9975B", "#8CA3C4"];

// Rare special crossers ("tùy DNA, thi thoảng có 1-2 con bay qua"): a majestic
// flyer that occasionally arcs high across the sky, seed-gated so it is a
// per-world surprise. Built on the animated hawk with a vivid emissive
// plumage — a CC0-pipeline stand-in for the phoenix/macaw the owner
// referenced (those live on Sketchfab, which is login-gated for downloads).
export type SpecialBirdDefinition = {
  key: string;
  label: string;
  plumageColor: string;
  emissiveIntensity: number;
  scale: number;
};

// Same split as the rare animals above: appearance here, the ordered species
// list in lib/rarity.ts.
const SPECIAL_BIRD_APPEARANCE: Record<string, Omit<SpecialBirdDefinition, "key" | "label">> = {
  firebird: { plumageColor: "#FF6A1F", emissiveIntensity: 1.4, scale: 2.4 },
  "azure-macaw": { plumageColor: "#2E7DE0", emissiveIntensity: 0.5, scale: 1.8 },
  "golden-eagle": { plumageColor: "#E8B54B", emissiveIntensity: 0.6, scale: 2.6 }
};
const SPECIAL_BIRD_FEATURE = rarityFeature("forest-special-bird");
export const SPECIAL_BIRD_DEFINITIONS: SpecialBirdDefinition[] = (SPECIAL_BIRD_FEATURE.species ?? []).map(
  (species) => ({ ...species, ...requireAppearance(SPECIAL_BIRD_APPEARANCE, species.key) })
);
// ~35% of worlds get a special crosser; which species is a second seeded roll.
export const SPECIAL_BIRD_PROBABILITY = SPECIAL_BIRD_FEATURE.probability;

// Poly Haven CC0 pure-sky HDRIs (1k .hdr), self-hosted — image-based
// environment lighting keyed by the config's lighting.hdriKey.
export const NATURE_HDRI_BASE_PATH = "/assets/nature/hdri/";
export const HDRI_FILES_BY_KEY: Record<string, string> = {
  "nature-hdri-day": "nature-hdri-day.hdr",
  "nature-hdri-golden-hour": "nature-hdri-golden-hour.hdr",
  "nature-hdri-dusk": "nature-hdri-dusk.hdr"
};

export function natureHdriUrlForKey(hdriKey?: string): string {
  const fileName = HDRI_FILES_BY_KEY[hdriKey ?? ""] ?? HDRI_FILES_BY_KEY["nature-hdri-day"];
  return NATURE_HDRI_BASE_PATH + fileName;
}

export const LANDMARK_MODEL_CATALOG: Record<string, ForestModelDefinition> = {
  heartTree: { fileName: "landmark-heart-tree.glb", targetHeight: 9.0 },
  // A tall mossy rock reads as a menhir; the flat "Stone Block" cube read as
  // a floating black box against the sky.
  standingStone: { fileName: "rock-mossy-2.glb", targetHeight: 2.8 },
  fallenLog: { fileName: "landmark-fallen-log.glb", targetHeight: 0.9 },
  lanternShrine: { fileName: "landmark-lantern-shrine.glb", targetHeight: 2.0 },
  flowerPatch: { fileName: "flower-group-1.glb", targetHeight: 0.6 }
};

export function natureModelUrl(definition: ForestModelDefinition): string {
  return NATURE_MODEL_BASE_PATH + definition.fileName;
}

// Foliage materials get their texture dropped and are re-colored per instance
// with the seasonal palette (a multiplied tint over a green texture would
// turn autumn orange into mud). Flowers keep their original colorful look.
const FOLIAGE_MATERIAL_NAME_PATTERN = /leaf|leaves|grass|foliage|^green$/i;

export type InstancedModelPart = {
  geometry: BufferGeometry;
  material: Material;
  /** Foliage parts expect a per-instance color (seasonal tint). */
  isFoliage: boolean;
};

export type InstancedModelVariant = {
  parts: InstancedModelPart[];
};

function isFoliageMaterial(material: Material): boolean {
  return FOLIAGE_MATERIAL_NAME_PATTERN.test(material.name ?? "");
}

function collectMeshesInWorldSpace(root: Object3D): Mesh[] {
  root.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if ((object as Mesh).isMesh) {
      meshes.push(object as Mesh);
    }
  });
  return meshes;
}

// Recolorable foliage material. KEEPS the source model's leaf texture and its
// smooth normals (the canopy geometry is 3k-20k verts of real leaf clusters —
// dropping the texture and flat-shading it was what collapsed canopies into
// featureless faceted blobs, the "lá như hình vuông" complaint). The texture
// now drives only light/dark DETAIL (luminance); the HUE comes from the
// per-instance color (season tint) via a shader injection — a straight
// multiply of an autumn-orange tint over a green leaf texture turns muddy.
function recolorableFoliageMaterial(originalMaterial: Material): MeshStandardMaterial {
  const source = originalMaterial as MeshStandardMaterial;
  const material = new MeshStandardMaterial({
    map: source.map ?? null,
    normalMap: source.normalMap ?? null,
    alphaMap: source.alphaMap ?? null,
    transparent: source.transparent,
    alphaTest: source.alphaTest,
    side: source.side,
    roughness: source.roughness ?? 0.9,
    metalness: 0,
    color: new Color("#FFFFFF")
  });
  material.onBeforeCompile = (shader) => {
    // Replace the stock map multiply: sample the leaf texture, collapse it to
    // luminance, remap into a gentle light range, and multiply that onto the
    // instance-colored diffuse. Result = season hue × texture detail.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      [
        "#ifdef USE_MAP",
        "  vec4 sampledLeafColor = texture2D( map, vMapUv );",
        "  float leafLuma = dot( sampledLeafColor.rgb, vec3( 0.299, 0.587, 0.114 ) );",
        "  leafLuma = mix( 0.72, 1.12, leafLuma );",
        "  diffuseColor.rgb *= leafLuma;",
        "  diffuseColor.a *= sampledLeafColor.a;",
        "#endif"
      ].join("\n")
    );
  };
  // Foliage materials all share one program despite per-instance colors.
  material.customProgramCacheKey = () => "forest-foliage-recolor";
  return material;
}

/**
 * Collapses same-material parts into one geometry.
 *
 * Scan-derived trees author their canopy as dozens of separate leaf-plane
 * meshes (one source oak ships 59), and every part becomes its own
 * InstancedMesh — i.e. its own draw call — no matter how few trees use it. All
 * those planes share a single leaf material, so merging by material takes a
 * variant from ~59 draw calls to ~2 with identical pixels.
 *
 * Merging is best-effort: it needs every geometry in a group to carry the same
 * attributes, so on any mismatch the group falls back to its unmerged parts
 * rather than dropping geometry.
 */
function mergePartsByMaterial(parts: { geometry: BufferGeometry; material: Material }[]) {
  const groupsByMaterial = new Map<Material, BufferGeometry[]>();
  const orderedMaterials: Material[] = [];
  for (const part of parts) {
    const group = groupsByMaterial.get(part.material);
    if (group) {
      group.push(part.geometry);
    } else {
      groupsByMaterial.set(part.material, [part.geometry]);
      orderedMaterials.push(part.material);
    }
  }

  return orderedMaterials.flatMap((material) => {
    const geometries = groupsByMaterial.get(material) ?? [];
    if (geometries.length === 1) {
      return [{ geometry: geometries[0], material }];
    }
    // Attribute sets must match exactly; normalize by keeping only the
    // attributes every geometry in the group has.
    const sharedAttributeNames = geometries
      .map((geometry) => Object.keys(geometry.attributes))
      .reduce((intersection, names) => intersection.filter((name) => names.includes(name)));
    const trimmedGeometries = geometries.map((geometry) => {
      const trimmed = geometry.clone();
      for (const attributeName of Object.keys(trimmed.attributes)) {
        if (!sharedAttributeNames.includes(attributeName)) {
          trimmed.deleteAttribute(attributeName);
        }
      }
      return trimmed;
    });
    const merged = mergeBufferGeometries(trimmedGeometries, false);
    if (!merged) {
      return geometries.map((geometry) => ({ geometry, material }));
    }
    return [{ geometry: merged, material }];
  });
}

function buildVariantFromMeshes(meshes: Mesh[], targetHeight: number): InstancedModelVariant | null {
  if (meshes.length === 0) {
    return null;
  }
  const unionBox = new Box3();
  const workingBox = new Box3();
  const bakedGeometries: { geometry: BufferGeometry; material: Material }[] = [];
  for (const mesh of meshes) {
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    bakedGeometries.push({ geometry, material });
    workingBox.setFromBufferAttribute(geometry.getAttribute("position") as never);
    unionBox.union(workingBox);
  }
  const size = unionBox.getSize(new Vector3());
  const height = Math.max(size.y, 0.0001);
  const uniformScale = targetHeight / height;
  const center = unionBox.getCenter(new Vector3());
  // Foot at y=0, centered in XZ, scaled to targetHeight.
  const normalizeMatrix = new Matrix4()
    .makeScale(uniformScale, uniformScale, uniformScale)
    .multiply(new Matrix4().makeTranslation(-center.x, -unionBox.min.y, -center.z));

  for (const baked of bakedGeometries) {
    baked.geometry.applyMatrix4(normalizeMatrix);
  }
  // Merge BEFORE wrapping materials: recolorableFoliageMaterial mints a new
  // material per part, which would defeat the grouping.
  const parts: InstancedModelPart[] = mergePartsByMaterial(bakedGeometries).map(({ geometry, material }) => {
    geometry.computeBoundingSphere();
    const foliage = isFoliageMaterial(material);
    return {
      geometry,
      material: foliage ? recolorableFoliageMaterial(material) : material,
      isFoliage: foliage
    };
  });
  return { parts };
}

/**
 * Extracts instancing-ready variants from a loaded GLB scene. By default the
 * WHOLE scene is one variant — a single tree's bark and leaves are sibling
 * meshes, and splitting siblings apart renders bare trunks next to floating
 * canopies (the bug behind the first broken-forest screenshots). Only files
 * flagged splitIntoVariants (multi-model sets like "Birch Trees") split, and
 * only at a level whose children are grouping nodes, never at raw meshes.
 */
export function extractInstancedModelVariants(
  sceneRoot: Object3D,
  targetHeight: number,
  splitIntoVariants = false
): InstancedModelVariant[] {
  sceneRoot.updateMatrixWorld(true);
  if (splitIntoVariants) {
    let splitLevel: Object3D = sceneRoot;
    while (splitLevel.children.length === 1) {
      splitLevel = splitLevel.children[0];
    }
    const childrenAreGroupingNodes =
      splitLevel.children.length > 1 && splitLevel.children.every((child) => !(child as Mesh).isMesh);
    if (childrenAreGroupingNodes) {
      const childVariants = splitLevel.children
        .map((child) => buildVariantFromMeshes(collectMeshesInWorldSpace(child), targetHeight))
        .filter((variant): variant is InstancedModelVariant => variant !== null);
      if (childVariants.length > 1) {
        return childVariants;
      }
    }
  }
  const wholeVariant = buildVariantFromMeshes(collectMeshesInWorldSpace(sceneRoot), targetHeight);
  return wholeVariant ? [wholeVariant] : [];
}

/**
 * Normalization transform for a non-instanced model (animals, landmarks):
 * scale so the model stands targetSize tall with its feet at y=0. Wide, flat
 * models (flying birds) normalize by their longest axis instead of height.
 */
export function normalizationForObject(
  object: Object3D,
  targetSize: number,
  normalizeBy: "height" | "longestAxis" = "height"
): { scale: number; footOffsetY: number; centerOffset: [number, number, number] } {
  const boundingBox = new Box3().setFromObject(object);
  const size = boundingBox.getSize(new Vector3());
  const center = boundingBox.getCenter(new Vector3());
  const referenceDimension =
    normalizeBy === "longestAxis" ? Math.max(size.x, size.y, size.z, 0.0001) : Math.max(size.y, 0.0001);
  const scale = targetSize / referenceDimension;
  // centerOffset re-centers a model on the group origin (subtract it on an
  // inner group). Ground models (animals/landmarks) use footOffsetY instead;
  // flying models (birds) use the full center so they don't pivot around an
  // off-body point.
  return {
    scale,
    footOffsetY: -boundingBox.min.y * scale,
    centerOffset: [center.x * scale, center.y * scale, center.z * scale]
  };
}

export type StaticInstanceTransform = {
  position: Vector3;
  yawRadians: number;
  scale: number;
  /** Applied to foliage parts only; ignored by textured parts. */
  foliageColor?: Color;
};

/**
 * Builds the InstancedMesh set for one model variant with fixed transforms
 * (rocks, grass, understory decoration — anything that never animates).
 */
export function buildStaticInstancedMeshes(
  variant: InstancedModelVariant,
  transforms: StaticInstanceTransform[],
  options?: { castShadow?: boolean; receiveShadow?: boolean }
): InstancedMesh[] {
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scaleVector = new Vector3();
  const yAxis = new Vector3(0, 1, 0);
  return variant.parts.map((part) => {
    const mesh = new InstancedMesh(part.geometry, part.material, transforms.length);
    transforms.forEach((transform, instanceIndex) => {
      rotation.setFromAxisAngle(yAxis, transform.yawRadians);
      scaleVector.setScalar(transform.scale);
      matrix.compose(transform.position, rotation, scaleVector);
      mesh.setMatrixAt(instanceIndex, matrix);
      if (part.isFoliage && transform.foliageColor) {
        mesh.setColorAt(instanceIndex, transform.foliageColor);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.castShadow = options?.castShadow ?? true;
    mesh.receiveShadow = options?.receiveShadow ?? false;
    return mesh;
  });
}

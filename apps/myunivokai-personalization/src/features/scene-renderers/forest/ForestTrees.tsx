"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import type { ForestSeasonConfig, ForestTerrainConfig, ForestTreesConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import {
  blendedFoliageColors,
  clampValue,
  clearingRadiusFromTerrain,
  treelineRadiusFromTerrain,
  type PathLateralDistanceSampler,
  type TerrainHeightSampler
} from "./forestMath";
import { extractInstancedModelVariants, natureModelUrl, TREE_MODEL_CATALOG, type InstancedModelVariant } from "./forestModels";

// Real GLB trees (Quaternius CC0 packs, see public/assets/nature/ATTRIBUTION.md),
// instanced per (variant, part) so a 300-tree forest stays a handful of draw
// calls. Foliage parts are re-colored per instance with the seasonal palette;
// the whole tree tilts gently in the config's wind.

const MOBILE_VIEWPORT_MAXIMUM_WIDTH = 768;

const TREE_RING_INNER_MARGIN = 0.8;
const PATH_TREE_EXCLUSION_HALF_WIDTH = 1.6;

// Whole-tree lean, radians at windStrength 1 — trees rock, they don't bend.
const WIND_TILT_BASE_RADIANS = 0.045;
const WIND_SECONDARY_WOBBLE_RATIO = 0.35;
const WIND_GUST_FREQUENCY_TO_RADIANS = Math.PI * 2;

// How much the species' own leaf color survives under the seasonal palette
// at tint strength 0 (the config's foliageTintStrength scales toward 1).
const SPECIES_FOLIAGE_ANCHOR_COLORS: Record<string, string> = {
  "tree-birch": "#9CC468",
  "tree-oak": "#4F8A3D",
  "tree-pine": "#33633B",
  "tree-pine-snow": "#DDE7EC",
  "tree-blossom": "#F3A9CB"
};

// How strongly the season palette overrides the species anchor. Blossom stays
// stubbornly pink and snow pines stay icy no matter the palette roll —
// otherwise the season's greens wash out exactly what makes them special.
const SPECIES_SEASON_TINT_MULTIPLIERS: Record<string, number> = {
  "tree-blossom": 0.25,
  "tree-pine-snow": 0.2
};

type TreeInstance = {
  position: Vector3;
  treeScale: number;
  yawRadians: number;
  swayPhase: number;
  foliageColor: Color;
  speciesKey: string;
  variantRoll: number;
};

type ForestTreesProps = {
  trees?: ForestTreesConfig;
  terrain?: ForestTerrainConfig;
  season?: ForestSeasonConfig;
  terrainHeightSampler: TerrainHeightSampler;
  pathLateralDistanceSampler: PathLateralDistanceSampler;
};

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < MOBILE_VIEWPORT_MAXIMUM_WIDTH;
}

function speciesKeyForRoll(roll: number, trees?: ForestTreesConfig): string {
  const speciesMix = trees?.speciesMix ?? [];
  const totalWeight = speciesMix.reduce((sum, entry) => sum + (entry.weight ?? 0), 0);
  if (totalWeight <= 0 || speciesMix.length === 0) {
    return "tree-oak";
  }
  let cumulative = 0;
  for (const entry of speciesMix) {
    cumulative += (entry.weight ?? 0) / totalWeight;
    if (roll < cumulative) {
      return entry.modelKey ?? "tree-oak";
    }
  }
  return speciesMix[speciesMix.length - 1].modelKey ?? "tree-oak";
}

type RenderBucket = {
  variant: InstancedModelVariant;
  instances: TreeInstance[];
  instancedMeshes: InstancedMesh[];
};

export function ForestTrees({ trees, terrain, season, terrainHeightSampler, pathLateralDistanceSampler }: ForestTreesProps) {
  const clearingRadius = clearingRadiusFromTerrain(terrain);
  const treelineRadius = treelineRadiusFromTerrain(terrain);

  const windStrength = trees?.windStrength ?? 0.35;
  const windDirectionRadians = trees?.windDirectionRadians ?? 0;
  const windGustFrequency = trees?.windGustFrequency ?? 0.3;

  // Species present in this forest's mix, in mix order (stable per scene —
  // the canvas remounts on seed change, so the load list never shifts within
  // a mount).
  const speciesKeys = useMemo(() => {
    const keys = (trees?.speciesMix ?? []).map((entry) => entry.modelKey ?? "tree-oak");
    return keys.length > 0 ? keys : ["tree-oak"];
  }, [trees?.speciesMix]);

  const modelDefinitionsBySpecies = useMemo(
    () => speciesKeys.map((speciesKey) => TREE_MODEL_CATALOG[speciesKey] ?? TREE_MODEL_CATALOG["tree-oak"]),
    [speciesKeys]
  );
  const modelUrls = useMemo(
    () => modelDefinitionsBySpecies.flat().map((definition) => natureModelUrl(definition)),
    [modelDefinitionsBySpecies]
  );
  const loadedModels = useGLTF(modelUrls);

  const variantsBySpecies = useMemo(() => {
    const variantsMap = new Map<string, InstancedModelVariant[]>();
    let modelCursor = 0;
    speciesKeys.forEach((speciesKey, speciesIndex) => {
      const definitions = modelDefinitionsBySpecies[speciesIndex];
      const speciesVariants: InstancedModelVariant[] = [];
      for (const definition of definitions) {
        const gltf = loadedModels[modelCursor];
        modelCursor += 1;
        if (gltf?.scene) {
          speciesVariants.push(
            ...extractInstancedModelVariants(gltf.scene, definition.targetHeight, definition.splitIntoVariants ?? false)
          );
        }
      }
      if (!variantsMap.has(speciesKey) && speciesVariants.length > 0) {
        variantsMap.set(speciesKey, speciesVariants);
      }
    });
    return variantsMap;
  }, [loadedModels, modelDefinitionsBySpecies, speciesKeys]);

  const renderBuckets = useMemo<RenderBucket[]>(() => {
    const desktopCount = trees?.countDesktop ?? 180;
    const renderCount = isMobileViewport() ? trees?.countMobile ?? Math.floor(desktopCount * 0.4) : desktopCount;
    const scaleMin = trees?.scaleMin ?? 0.8;
    const scaleMax = trees?.scaleMax ?? 1.45;
    const foliageTintStrength = trees?.foliageTintStrength ?? 0.65;
    const foliageColors = blendedFoliageColors(season);

    // Placement draws per tree, fixed order: angle, radius, species, scale,
    // yaw, sway phase, foliage color pick, variant pick. Always drawn for the
    // full desktop count so the mobile forest is a strict prefix subset.
    const nextRandomValue = randomFromSeed(trees?.placementSeed ?? "forest-trees");
    const instancesByBucket = new Map<string, TreeInstance[]>();
    for (let treeIndex = 0; treeIndex < desktopCount; treeIndex += 1) {
      const angleRoll = nextRandomValue();
      const radiusRoll = nextRandomValue();
      const speciesRoll = nextRandomValue();
      const scaleRoll = nextRandomValue();
      const yawRoll = nextRandomValue();
      const swayPhaseRoll = nextRandomValue();
      const foliageColorRoll = nextRandomValue();
      const variantRoll = nextRandomValue();
      if (treeIndex >= renderCount) {
        continue;
      }

      const angle = angleRoll * Math.PI * 2;
      const innerRadius = clearingRadius + TREE_RING_INNER_MARGIN;
      // sqrt keeps area density uniform across the ring.
      const radius = Math.sqrt(radiusRoll) * (treelineRadius - innerRadius) + innerRadius;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (pathLateralDistanceSampler(x, z) < PATH_TREE_EXCLUSION_HALF_WIDTH) {
        continue;
      }

      const speciesKey = speciesKeyForRoll(speciesRoll, trees);
      const speciesVariants = variantsBySpecies.get(speciesKey);
      if (!speciesVariants || speciesVariants.length === 0) {
        continue;
      }
      const variantIndex = Math.floor(variantRoll * speciesVariants.length);

      const seasonFoliageColor = foliageColors[Math.floor(foliageColorRoll * foliageColors.length)] ?? foliageColors[0];
      const anchorHex = SPECIES_FOLIAGE_ANCHOR_COLORS[speciesKey];
      const seasonTintMultiplier = SPECIES_SEASON_TINT_MULTIPLIERS[speciesKey] ?? 1;
      const foliageColor = anchorHex
        ? new Color(anchorHex).lerp(seasonFoliageColor, clampValue(foliageTintStrength * seasonTintMultiplier, 0, 1))
        : seasonFoliageColor.clone();
      // Per-tree brightness jitter (decorrelated reuse of the variant roll —
      // no extra draw) breaks the "every canopy the same color" flatness.
      const brightnessJitter = 0.88 + ((variantRoll * 13.37) % 1) * 0.24;
      foliageColor.multiplyScalar(brightnessJitter);

      const bucketKey = `${speciesKey}#${variantIndex}`;
      const bucketInstances = instancesByBucket.get(bucketKey) ?? [];
      bucketInstances.push({
        position: new Vector3(x, terrainHeightSampler(x, z), z),
        treeScale: scaleMin + scaleRoll * (scaleMax - scaleMin),
        yawRadians: yawRoll * Math.PI * 2,
        swayPhase: swayPhaseRoll * Math.PI * 2,
        foliageColor,
        speciesKey,
        variantRoll
      });
      instancesByBucket.set(bucketKey, bucketInstances);
    }

    const buckets: RenderBucket[] = [];
    for (const [bucketKey, instances] of instancesByBucket) {
      const [speciesKey, variantIndexText] = bucketKey.split("#");
      const variant = variantsBySpecies.get(speciesKey)?.[Number(variantIndexText)];
      if (!variant) {
        continue;
      }
      const instancedMeshes = variant.parts.map((part) => {
        const mesh = new InstancedMesh(part.geometry, part.material, instances.length);
        if (part.isFoliage) {
          instances.forEach((instance, instanceIndex) => {
            mesh.setColorAt(instanceIndex, instance.foliageColor);
          });
          if (mesh.instanceColor) {
            mesh.instanceColor.needsUpdate = true;
          }
        }
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        return mesh;
      });
      buckets.push({ variant, instances, instancedMeshes });
    }
    return buckets;
  }, [clearingRadius, pathLateralDistanceSampler, season, terrainHeightSampler, treelineRadius, trees, variantsBySpecies]);

  // Wind: the whole tree pivots around its base (foot at origin after
  // normalization), leaning along the wind with a per-tree phased gust wave.
  const elapsedSecondsRef = useRef(0);
  useFrame((_, deltaTimeSeconds) => {
    elapsedSecondsRef.current += deltaTimeSeconds;
    const elapsedSeconds = elapsedSecondsRef.current;
    const gustAngularFrequency = windGustFrequency * WIND_GUST_FREQUENCY_TO_RADIANS;
    // Tilt axis is perpendicular to the wind direction, in the ground plane.
    const tiltAxis = new Vector3(-Math.sin(windDirectionRadians), 0, Math.cos(windDirectionRadians));

    const matrix = new Matrix4();
    const yawQuaternion = new Quaternion();
    const tiltQuaternion = new Quaternion();
    const combinedQuaternion = new Quaternion();
    const yAxis = new Vector3(0, 1, 0);
    const scale = new Vector3();

    for (const bucket of renderBuckets) {
      bucket.instances.forEach((tree, instanceIndex) => {
        const primaryWave = Math.sin(elapsedSeconds * gustAngularFrequency + tree.swayPhase);
        const secondaryWobble =
          Math.sin(elapsedSeconds * gustAngularFrequency * 2.7 + tree.swayPhase * 1.7) * WIND_SECONDARY_WOBBLE_RATIO;
        const tiltRadians = (primaryWave + secondaryWobble) * windStrength * WIND_TILT_BASE_RADIANS;

        yawQuaternion.setFromAxisAngle(yAxis, tree.yawRadians);
        tiltQuaternion.setFromAxisAngle(tiltAxis, tiltRadians);
        combinedQuaternion.copy(tiltQuaternion).multiply(yawQuaternion);
        scale.setScalar(tree.treeScale);
        matrix.compose(tree.position, combinedQuaternion, scale);
        for (const instancedMesh of bucket.instancedMeshes) {
          instancedMesh.setMatrixAt(instanceIndex, matrix);
        }
      });
      for (const instancedMesh of bucket.instancedMeshes) {
        instancedMesh.instanceMatrix.needsUpdate = true;
      }
    }
  });

  return (
    <group>
      {renderBuckets.map((bucket, bucketIndex) =>
        bucket.instancedMeshes.map((instancedMesh, meshIndex) => (
          <primitive key={`${bucketIndex}-${meshIndex}`} object={instancedMesh} />
        ))
      )}
    </group>
  );
}

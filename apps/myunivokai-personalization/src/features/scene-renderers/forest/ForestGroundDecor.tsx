"use client";

import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { Vector3 } from "three";
import type { ForestSeasonConfig, ForestTerrainConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import {
  blendedFoliageColors,
  clearingRadiusFromTerrain,
  treelineRadiusFromTerrain,
  type PathLateralDistanceSampler,
  type TerrainHeightSampler
} from "./forestMath";
import {
  buildStaticInstancedMeshes,
  DECOR_MODEL_DEFINITIONS,
  extractInstancedModelVariants,
  natureModelUrl,
  type StaticInstanceTransform
} from "./forestModels";

// The understory: bushes, ferns, flowers, mushrooms and mossy stumps
// scattered between the trees. Pure decoration — everything derives from the
// terrain placement seed, so it is as deterministic as the trees themselves.

const MOBILE_VIEWPORT_MAXIMUM_WIDTH = 768;
const DECOR_SCATTER_SEED_SUFFIX = "-understory";

// One decor piece per this many square units of forest floor.
const DECOR_AREA_PER_PIECE = 55;
const MAXIMUM_DECOR_PIECES = 90;
const MOBILE_DECOR_FRACTION = 0.5;

const MINIMUM_DECOR_SCALE = 0.7;
const DECOR_SCALE_RANGE = 0.7;
const PATH_DECOR_EXCLUSION_HALF_WIDTH = 1.6;

// Indexes into DECOR_MODEL_DEFINITIONS, weighted per season: flowers belong
// to spring/summer, mushrooms to autumn, and winter keeps only the hardy
// pieces (bushes thin out, stumps and ferns stay).
const DECOR_WEIGHTS_BY_SEASON: Record<string, number[]> = {
  //           bush  bushFl fern  flwGrp flwSgl mushrm stump
  spring: /**/ [0.20, 0.20, 0.15, 0.20, 0.10, 0.05, 0.10],
  summer: /**/ [0.25, 0.15, 0.20, 0.15, 0.10, 0.05, 0.10],
  autumn: /**/ [0.20, 0.05, 0.20, 0.00, 0.00, 0.35, 0.20],
  winter: /**/ [0.15, 0.00, 0.15, 0.00, 0.00, 0.10, 0.60]
};

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < MOBILE_VIEWPORT_MAXIMUM_WIDTH;
}

function decorDefinitionIndexForRoll(roll: number, weights: number[]): number {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) {
    return 0;
  }
  let cumulative = 0;
  for (let index = 0; index < weights.length; index += 1) {
    cumulative += weights[index] / totalWeight;
    if (roll < cumulative) {
      return index;
    }
  }
  return weights.length - 1;
}

type ForestGroundDecorProps = {
  terrain?: ForestTerrainConfig;
  season?: ForestSeasonConfig;
  terrainHeightSampler: TerrainHeightSampler;
  pathLateralDistanceSampler: PathLateralDistanceSampler;
};

export function ForestGroundDecor({ terrain, season, terrainHeightSampler, pathLateralDistanceSampler }: ForestGroundDecorProps) {
  const clearingRadius = clearingRadiusFromTerrain(terrain);
  const treelineRadius = treelineRadiusFromTerrain(terrain);
  const placementSeed = terrain?.placementSeed ?? "forest-terrain";
  const seasonKind = season?.kind ?? "spring";

  const decorModelUrls = useMemo(() => DECOR_MODEL_DEFINITIONS.map((definition) => natureModelUrl(definition)), []);
  const loadedDecorModels = useGLTF(decorModelUrls);

  const decorInstancedMeshes = useMemo(() => {
    const variantsPerDefinition = loadedDecorModels.map((gltf, definitionIndex) =>
      gltf?.scene ? extractInstancedModelVariants(gltf.scene, DECOR_MODEL_DEFINITIONS[definitionIndex].targetHeight) : []
    );
    const weights = DECOR_WEIGHTS_BY_SEASON[seasonKind] ?? DECOR_WEIGHTS_BY_SEASON.spring;
    const foliageColors = blendedFoliageColors(season);

    const forestFloorArea = Math.PI * (treelineRadius * treelineRadius - clearingRadius * clearingRadius);
    const desktopPieceCount = Math.min(MAXIMUM_DECOR_PIECES, Math.round(forestFloorArea / DECOR_AREA_PER_PIECE));
    const pieceCount = isMobileViewport() ? Math.floor(desktopPieceCount * MOBILE_DECOR_FRACTION) : desktopPieceCount;

    // Draw order per piece: angle, radius, kind, scale, yaw, foliage pick.
    const nextRandomValue = randomFromSeed(placementSeed + DECOR_SCATTER_SEED_SUFFIX);
    const transformsPerDefinition: StaticInstanceTransform[][] = DECOR_MODEL_DEFINITIONS.map(() => []);
    for (let pieceIndex = 0; pieceIndex < pieceCount; pieceIndex += 1) {
      const angle = nextRandomValue() * Math.PI * 2;
      const innerRadius = clearingRadius * 0.9;
      const radius = Math.sqrt(nextRandomValue()) * (treelineRadius - innerRadius) + innerRadius;
      const kindRoll = nextRandomValue();
      const pieceScale = MINIMUM_DECOR_SCALE + nextRandomValue() * DECOR_SCALE_RANGE;
      const yawRadians = nextRandomValue() * Math.PI * 2;
      const foliageColorRoll = nextRandomValue();

      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (pathLateralDistanceSampler(x, z) < PATH_DECOR_EXCLUSION_HALF_WIDTH) {
        continue;
      }
      const definitionIndex = decorDefinitionIndexForRoll(kindRoll, weights);
      transformsPerDefinition[definitionIndex].push({
        position: new Vector3(x, terrainHeightSampler(x, z), z),
        yawRadians,
        scale: pieceScale,
        foliageColor: foliageColors[Math.floor(foliageColorRoll * foliageColors.length)] ?? foliageColors[0]
      });
    }

    return variantsPerDefinition.flatMap((variants, definitionIndex) => {
      const transforms = transformsPerDefinition[definitionIndex];
      if (transforms.length === 0 || variants.length === 0) {
        return [];
      }
      // Spread this definition's pieces across its file variants round-robin.
      return variants.flatMap((variant, variantIndex) => {
        const variantTransforms = transforms.filter((_, transformIndex) => transformIndex % variants.length === variantIndex);
        return variantTransforms.length > 0 ? buildStaticInstancedMeshes(variant, variantTransforms) : [];
      });
    });
  }, [
    clearingRadius,
    loadedDecorModels,
    pathLateralDistanceSampler,
    placementSeed,
    season,
    seasonKind,
    terrainHeightSampler,
    treelineRadius
  ]);

  return (
    <group>
      {decorInstancedMeshes.map((mesh, meshIndex) => (
        <primitive key={meshIndex} object={mesh} />
      ))}
    </group>
  );
}

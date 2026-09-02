"use client";

import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { Vector3 } from "three";
import type { ForestTerrainConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { treelineRadiusFromTerrain, type TerrainHeightSampler } from "./forestMath";
import {
  buildStaticInstancedMeshes,
  DISTANT_TREE_MODEL_DEFINITION,
  extractInstancedModelVariants,
  natureModelUrl,
  type StaticInstanceTransform
} from "./forestModels";

// The horizon belt. ForestTrees only scatters out to the treeline radius, but
// the ground mesh keeps going far past it and rises into hills — so everything
// beyond the treeline was bare ground wearing a painted-on "canopy green",
// which is what made the forest look like it stopped at an invisible wall.
// This fills that band with real (cheap, LOD2) conifers standing on the same
// height field, so the clearing is ringed by forested hills that recede into
// the fog instead of an empty rim.

const BELT_INNER_FRACTION_OF_TREELINE = 0.98;
const BELT_OUTER_FRACTION_OF_TREELINE = 2.35;
const DISTANT_TREE_COUNT_DESKTOP = 260;
const DISTANT_TREE_COUNT_MOBILE = 90;
// Distant conifers read as a mass, not individuals: a wide scale spread plus
// the hill height field keeps the ridgeline ragged rather than a even hedge.
const MINIMUM_SCALE = 0.85;
const SCALE_RANGE = 0.85;
const MOBILE_VIEWPORT_MAXIMUM_WIDTH = 768;

const DISTANT_TREE_SEED_SUFFIX = "-distant-treeline";

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < MOBILE_VIEWPORT_MAXIMUM_WIDTH;
}

type ForestDistantTreelineProps = {
  terrain?: ForestTerrainConfig;
  terrainHeightSampler: TerrainHeightSampler;
};

export function ForestDistantTreeline({ terrain, terrainHeightSampler }: ForestDistantTreelineProps) {
  const treelineRadius = treelineRadiusFromTerrain(terrain);
  const placementSeed = terrain?.placementSeed ?? "forest-terrain";
  const gltf = useGLTF(natureModelUrl(DISTANT_TREE_MODEL_DEFINITION));

  const instancedMeshes = useMemo(() => {
    const variants = gltf?.scene
      ? extractInstancedModelVariants(
          gltf.scene,
          DISTANT_TREE_MODEL_DEFINITION.targetHeight,
          DISTANT_TREE_MODEL_DEFINITION.splitIntoVariants ?? false
        )
      : [];
    if (variants.length === 0) {
      return [];
    }

    const innerRadius = treelineRadius * BELT_INNER_FRACTION_OF_TREELINE;
    const outerRadius = treelineRadius * BELT_OUTER_FRACTION_OF_TREELINE;
    const treeCount = isMobileViewport() ? DISTANT_TREE_COUNT_MOBILE : DISTANT_TREE_COUNT_DESKTOP;

    // Fixed per-tree draw order (angle, radius, scale, yaw, variant) so the
    // belt is stable for a seed, like every other forest scatter.
    const nextRandomValue = randomFromSeed(placementSeed + DISTANT_TREE_SEED_SUFFIX);
    const transformsPerVariant: StaticInstanceTransform[][] = variants.map(() => []);
    for (let treeIndex = 0; treeIndex < treeCount; treeIndex += 1) {
      const angle = nextRandomValue() * Math.PI * 2;
      // sqrt over the annulus keeps the density even instead of crowding the
      // inner edge, which would read as a hard second wall of trees.
      const radius = Math.sqrt(
        nextRandomValue() * (outerRadius * outerRadius - innerRadius * innerRadius) + innerRadius * innerRadius
      );
      const scale = MINIMUM_SCALE + nextRandomValue() * SCALE_RANGE;
      const yawRadians = nextRandomValue() * Math.PI * 2;
      const variantIndex = Math.floor(nextRandomValue() * variants.length);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      transformsPerVariant[variantIndex].push({
        position: new Vector3(x, terrainHeightSampler(x, z), z),
        yawRadians,
        scale
      });
    }

    // No shadow casting: these are past the sun's shadow-camera extent anyway,
    // and paying for them would double the belt's cost for nothing.
    return variants.flatMap((variant, variantIndex) =>
      transformsPerVariant[variantIndex].length > 0
        ? buildStaticInstancedMeshes(variant, transformsPerVariant[variantIndex], {
            castShadow: false,
            receiveShadow: false
          })
        : []
    );
  }, [gltf, placementSeed, terrainHeightSampler, treelineRadius]);

  return (
    <group>
      {instancedMeshes.map((mesh, meshIndex) => (
        <primitive key={`distant-tree-${meshIndex}`} object={mesh} />
      ))}
    </group>
  );
}

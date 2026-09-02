"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import {
  Color,
  Float32BufferAttribute,
  Matrix4,
  MeshStandardMaterial,
  NoColorSpace,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Vector2,
  Vector3
} from "three";
import type { ForestSeasonConfig, ForestTerrainConfig, ForestTreesConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import {
  blendedFoliageColors,
  blendedGroundColor,
  clearingRadiusFromTerrain,
  smoothstepValue,
  treelineRadiusFromTerrain,
  type PathLateralDistanceSampler,
  type TerrainHeightSampler
} from "./forestMath";
import {
  buildStaticInstancedMeshes,
  extractInstancedModelVariants,
  GRASS_MODEL_DEFINITIONS,
  natureModelUrl,
  ROCK_MODEL_DEFINITIONS,
  type StaticInstanceTransform
} from "./forestModels";

const GROUND_SEGMENTS_PER_SIDE = 160;
// The ground reaches far past the treeline so a zoomed-out view never sees the
// slab edge; the far band rises into forested hills (height sampler) and the
// colour fades to the horizon/fog colour at the rim, so the finite square
// dissolves into the sky instead of showing corners.
const GROUND_RADIUS_BEYOND_TREELINE_MULTIPLIER = 3.2;

// Distant colour bands (fractions of the treeline radius): mid-far ground
// takes on a forested-canopy green so the rising hills read as tree-covered;
// the outer rim fades to the horizon colour.
const DISTANT_CANOPY_INNER_FRACTION = 0.9;
const DISTANT_CANOPY_OUTER_FRACTION = 1.7;
const DISTANT_CANOPY_STRENGTH = 0.85;
const RIM_FADE_INNER_FRACTION = 2.0;
const RIM_FADE_OUTER_FRACTION_OF_GROUND = 0.97;
const DISTANT_CANOPY_DARKEN = 0.72;

const GROUND_COLOR_NOISE_SEED_SUFFIX = "-ground-noise";
const ROCK_SCATTER_SEED_SUFFIX = "-rocks";
const GRASS_SCATTER_SEED_SUFFIX = "-grass";

const GROUND_COLOR_VARIATION_STRENGTH = 0.1;
const CLEARING_LIGHTEN_STRENGTH = 0.12;
// Pale sand at the waterline, dark silt in the deep. Seen THROUGH the water, so
// this pair is what actually produces the lake's colour gradient from above.
const LAKE_SHALLOW_BED_COLOR = "#A79B7C";
const LAKE_DEEP_BED_COLOR = "#3A4038";
// Depth at which the bed has fully turned to silt.
const LAKE_BED_SILT_DEPTH = 1.4;
// How much of the seasonal ground colour survives under water, so a winter lake
// bed still differs from a summer one.
const LAKE_BED_GROUND_RETENTION = 0.25;

const DIRT_PATH_COLOR ="#71543A";
const PATH_HALF_WIDTH = 1.4;
const PATH_EDGE_FEATHER = 0.9;

const MINIMUM_ROCK_SCALE = 0.5;
const ROCK_SCALE_RANGE = 1.3;
const ROCK_SINK_DEPTH = 0.08;

const MINIMUM_GRASS_SCALE = 0.6;
const GRASS_SCALE_RANGE = 0.8;
// Snow buries most tufts; a few dry stalks keep the ground from reading flat.
const SNOW_GRASS_TUFT_FRACTION = 0.15;
const SNOW_GRASS_COLOR = "#B9A87C";

const MOBILE_VIEWPORT_MAXIMUM_WIDTH = 768;

// PBR forest-floor relief (Poly Haven CC0, see public/assets/nature/ATTRIBUTION.md). The maps
// add surface RELIEF only — the albedo still comes from the season-driven
// vertex colors (so grass/leaf-litter/snow stay correct), while the tiling
// normal + roughness break the dead-flat plane under raking sunlight. One tile
// covers this many world units; the repeat count derives from the ground size.
const GROUND_TEXTURE_BASE_PATH = "/assets/nature/textures/";
const GROUND_NORMAL_MAP_URL = `${GROUND_TEXTURE_BASE_PATH}forest-floor-normal-1k.jpg`;
const GROUND_ARM_MAP_URL = `${GROUND_TEXTURE_BASE_PATH}forest-floor-arm-1k.jpg`;
const GROUND_TILE_WORLD_SIZE = 4;
// Kept below 1 so the relief reads as gentle ground unevenness, not a bumpy
// plastic sheet (over-strong normals on a flat plane look fake).
const GROUND_NORMAL_STRENGTH = 0.6;

type ForestTerrainProps = {
  terrain?: ForestTerrainConfig;
  season?: ForestSeasonConfig;
  /** Wind (under trees in the config) also ripples the grass layer. */
  trees?: ForestTreesConfig;
  /** Sky/fog colour the far ground rim fades into so the slab edge vanishes. */
  horizonColor?: string;
  terrainHeightSampler: TerrainHeightSampler;
  pathLateralDistanceSampler: PathLateralDistanceSampler;
};

// Grass wind ripple.
const GRASS_SWAY_BASE_RADIANS = 0.14;
const GRASS_SWAY_GUST_FREQUENCY_TO_RADIANS = Math.PI * 2;

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < MOBILE_VIEWPORT_MAXIMUM_WIDTH;
}

/**
 * The forest floor: a displaced, vertex-colored ground disc (rolling hills,
 * flattened clearing, seeded dirt path), plus instanced rocks and grass
 * tufts scattered from the terrain placement seed.
 */
export function ForestTerrain({
  terrain,
  season,
  trees,
  horizonColor,
  terrainHeightSampler,
  pathLateralDistanceSampler
}: ForestTerrainProps) {
  const clearingRadius = clearingRadiusFromTerrain(terrain);
  const treelineRadius = treelineRadiusFromTerrain(terrain);
  const placementSeed = terrain?.placementSeed ?? "forest-terrain";
  const groundKind = season?.groundKind ?? "grass";

  // Relief maps for the ground (albedo stays vertex-color, season-driven).
  const [groundNormalMap, groundArmMap] = useTexture([GROUND_NORMAL_MAP_URL, GROUND_ARM_MAP_URL]);

  const groundMesh = useMemo(() => {
    const groundRadius = treelineRadius * GROUND_RADIUS_BEYOND_TREELINE_MULTIPLIER;
    const geometry = new PlaneGeometry(groundRadius * 2, groundRadius * 2, GROUND_SEGMENTS_PER_SIDE, GROUND_SEGMENTS_PER_SIDE);
    geometry.rotateX(-Math.PI / 2);

    const nextRandomValue = randomFromSeed(placementSeed + GROUND_COLOR_NOISE_SEED_SUFFIX);
    const baseGroundColor = blendedGroundColor(season);
    const pathColor = new Color(DIRT_PATH_COLOR);
    const lakeShallowBedColor = new Color(LAKE_SHALLOW_BED_COLOR);
    const lakeDeepBedColor = new Color(LAKE_DEEP_BED_COLOR);
    // Distant hills read as tree-covered: a darkened forest-canopy green from
    // the season palette (stays pale in winter, so snowy hills stay snowy).
    const foliageColors = blendedFoliageColors(season);
    const distantCanopyColor = (foliageColors[0] ?? baseGroundColor).clone().multiplyScalar(DISTANT_CANOPY_DARKEN);
    // The rim melts into the sky: fall back to the ground colour if no horizon
    // colour was supplied.
    const rimColor = horizonColor ? new Color(horizonColor) : baseGroundColor.clone();

    const positionAttribute = geometry.getAttribute("position");
    const vertexColors = new Float32Array(positionAttribute.count * 3);
    const workingColor = new Color();
    for (let vertexIndex = 0; vertexIndex < positionAttribute.count; vertexIndex += 1) {
      const x = positionAttribute.getX(vertexIndex);
      const z = positionAttribute.getZ(vertexIndex);
      positionAttribute.setY(vertexIndex, terrainHeightSampler(x, z));

      workingColor.copy(baseGroundColor);
      // Per-vertex brightness noise breaks up the flat ground plane. The draw
      // count per vertex is fixed (one), so the pattern is stable per seed.
      const brightnessJitter = 1 + (nextRandomValue() - 0.5) * 2 * GROUND_COLOR_VARIATION_STRENGTH;
      workingColor.multiplyScalar(brightnessJitter);
      // The clearing reads slightly sun-bleached so the hero area pops.
      const radiusFromCenter = Math.hypot(x, z);
      const clearingLightenFactor = 1 - smoothstepValue(clearingRadius * 0.7, clearingRadius * 1.2, radiusFromCenter);
      workingColor.lerp(new Color("#FFFFFF"), clearingLightenFactor * CLEARING_LIGHTEN_STRENGTH);
      // Dirt path band with a feathered edge.
      const pathLateralDistance = pathLateralDistanceSampler(x, z);
      const pathBlend = 1 - smoothstepValue(PATH_HALF_WIDTH, PATH_HALF_WIDTH + PATH_EDGE_FEATHER, pathLateralDistance);
      workingColor.lerp(pathColor, pathBlend);
      // The lake bed. This ground is SEEN THROUGH THE WATER, which is the whole
      // point: the camera looks nearly straight down, and at normal incidence
      // water reflects only about 2% — so from above you see the bottom, not the
      // sky. Leaving the bed grass-green made the lake read as a lawn under
      // glass; sand at the margin shading to silt in the deep is what produces
      // the pale shallows and dark centre that say "water" from overhead.
      const lakeDepth = -Math.min(0, terrainHeightSampler(x, z));
      if (lakeDepth > 0) {
        const depthBlend = smoothstepValue(0, LAKE_BED_SILT_DEPTH, lakeDepth);
        workingColor.lerp(lakeShallowBedColor, 1 - LAKE_BED_GROUND_RETENTION);
        workingColor.lerp(lakeDeepBedColor, depthBlend);
      }
      // Mid-far ground turns forest-green (rising hills read as forested)...
      const distantCanopyBlend =
        smoothstepValue(treelineRadius * DISTANT_CANOPY_INNER_FRACTION, treelineRadius * DISTANT_CANOPY_OUTER_FRACTION, radiusFromCenter) *
        DISTANT_CANOPY_STRENGTH;
      workingColor.lerp(distantCanopyColor, distantCanopyBlend);
      // ...and the outer rim dissolves into the horizon colour, so the finite
      // square's edge and corners are sky-coloured and invisible.
      const rimFadeBlend = smoothstepValue(
        treelineRadius * RIM_FADE_INNER_FRACTION,
        groundRadius * RIM_FADE_OUTER_FRACTION_OF_GROUND,
        radiusFromCenter
      );
      workingColor.lerp(rimColor, rimFadeBlend);

      vertexColors[vertexIndex * 3] = workingColor.r;
      vertexColors[vertexIndex * 3 + 1] = workingColor.g;
      vertexColors[vertexIndex * 3 + 2] = workingColor.b;
    }
    geometry.setAttribute("color", new Float32BufferAttribute(vertexColors, 3));
    geometry.computeVertexNormals();

    // Tile the relief maps across the ground. Normal/roughness are DATA, not
    // color, so they must stay in linear space (NoColorSpace) or the lighting
    // reads wrong. The arm map's green channel drives roughness; metalness
    // stays 0 so its blue channel is ignored.
    const repeatCount = (groundRadius * 2) / GROUND_TILE_WORLD_SIZE;
    for (const reliefMap of [groundNormalMap, groundArmMap]) {
      reliefMap.wrapS = RepeatWrapping;
      reliefMap.wrapT = RepeatWrapping;
      reliefMap.repeat.set(repeatCount, repeatCount);
      reliefMap.colorSpace = NoColorSpace;
      reliefMap.needsUpdate = true;
    }

    const material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: groundKind === "snow" ? 0.75 : 1,
      metalness: 0,
      normalMap: groundNormalMap,
      normalScale: new Vector2(GROUND_NORMAL_STRENGTH, GROUND_NORMAL_STRENGTH),
      roughnessMap: groundArmMap
    });
    return { geometry, material };
  }, [
    clearingRadius,
    groundArmMap,
    groundKind,
    groundNormalMap,
    horizonColor,
    pathLateralDistanceSampler,
    placementSeed,
    season,
    terrainHeightSampler,
    treelineRadius
  ]);

  // Real mossy rocks (Quaternius MegaKit), instanced across the seeded
  // scatter. Draw order per rock: angle, radius, scale, yaw, variant pick.
  const rockModelUrls = useMemo(() => ROCK_MODEL_DEFINITIONS.map((definition) => natureModelUrl(definition)), []);
  const loadedRockModels = useGLTF(rockModelUrls);
  const rockInstancedMeshes = useMemo(() => {
    const rockVariants = loadedRockModels.flatMap((gltf, definitionIndex) =>
      gltf?.scene ? extractInstancedModelVariants(gltf.scene, ROCK_MODEL_DEFINITIONS[definitionIndex].targetHeight) : []
    );
    if (rockVariants.length === 0) {
      return [];
    }
    const rockCount = terrain?.rockCount ?? 12;
    const nextRandomValue = randomFromSeed(placementSeed + ROCK_SCATTER_SEED_SUFFIX);
    const transformsPerVariant: StaticInstanceTransform[][] = rockVariants.map(() => []);
    for (let rockIndex = 0; rockIndex < rockCount; rockIndex += 1) {
      const angle = nextRandomValue() * Math.PI * 2;
      const radius = clearingRadius * 1.05 + nextRandomValue() * (treelineRadius - clearingRadius * 1.05);
      const rockScale = MINIMUM_ROCK_SCALE + nextRandomValue() * ROCK_SCALE_RANGE;
      const yawRadians = nextRandomValue() * Math.PI * 2;
      const variantIndex = Math.floor(nextRandomValue() * rockVariants.length);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      transformsPerVariant[variantIndex].push({
        position: new Vector3(x, terrainHeightSampler(x, z) - rockScale * ROCK_SINK_DEPTH, z),
        yawRadians,
        scale: rockScale
      });
    }
    return rockVariants.flatMap((variant, variantIndex) =>
      transformsPerVariant[variantIndex].length > 0
        ? buildStaticInstancedMeshes(variant, transformsPerVariant[variantIndex], { receiveShadow: true })
        : []
    );
  }, [clearingRadius, loadedRockModels, placementSeed, terrain?.rockCount, terrainHeightSampler, treelineRadius]);

  // Real grass tufts, seasonal color per instance. Draw order per tuft:
  // angle, radius, scale, yaw, variant pick.
  const grassModelUrls = useMemo(() => GRASS_MODEL_DEFINITIONS.map((definition) => natureModelUrl(definition)), []);
  const loadedGrassModels = useGLTF(grassModelUrls);
  const grassInstancedMeshes = useMemo(() => {
    const grassVariants = loadedGrassModels.flatMap((gltf, definitionIndex) =>
      gltf?.scene ? extractInstancedModelVariants(gltf.scene, GRASS_MODEL_DEFINITIONS[definitionIndex].targetHeight) : []
    );
    if (grassVariants.length === 0) {
      return [];
    }
    const configuredCount = isMobileViewport()
      ? terrain?.grassTuftCountMobile ?? 300
      : terrain?.grassTuftCountDesktop ?? 800;
    const grassCount = groundKind === "snow" ? Math.floor(configuredCount * SNOW_GRASS_TUFT_FRACTION) : configuredCount;
    if (grassCount <= 0) {
      return [];
    }
    const foliageColors = blendedFoliageColors(season);
    const grassColor =
      groundKind === "snow"
        ? new Color(SNOW_GRASS_COLOR)
        : blendedGroundColor(season).lerp(foliageColors[1] ?? foliageColors[0], 0.5);
    const nextRandomValue = randomFromSeed(placementSeed + GRASS_SCATTER_SEED_SUFFIX);
    const transformsPerVariant: StaticInstanceTransform[][] = grassVariants.map(() => []);
    for (let grassIndex = 0; grassIndex < grassCount; grassIndex += 1) {
      const angle = nextRandomValue() * Math.PI * 2;
      // sqrt keeps the area density uniform instead of clustering the center.
      const radius = Math.sqrt(nextRandomValue()) * treelineRadius;
      const tuftScale = MINIMUM_GRASS_SCALE + nextRandomValue() * GRASS_SCALE_RANGE;
      const yawRadians = nextRandomValue() * Math.PI * 2;
      const variantIndex = Math.floor(nextRandomValue() * grassVariants.length);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      // Bare dirt on the path itself; the tuft slot stays drawn (fixed draw
      // order) but renders at zero scale.
      const isOnPath = pathLateralDistanceSampler(x, z) < PATH_HALF_WIDTH;
      transformsPerVariant[variantIndex].push({
        position: new Vector3(x, terrainHeightSampler(x, z), z),
        yawRadians,
        scale: isOnPath ? 0.0001 : tuftScale,
        foliageColor: grassColor
      });
    }
    return grassVariants
      .map((variant, variantIndex) => ({
        instancedMeshes:
          transformsPerVariant[variantIndex].length > 0
            ? buildStaticInstancedMeshes(variant, transformsPerVariant[variantIndex], { castShadow: false })
            : [],
        transforms: transformsPerVariant[variantIndex]
      }))
      .filter((bucket) => bucket.instancedMeshes.length > 0);
  }, [
    groundKind,
    loadedGrassModels,
    pathLateralDistanceSampler,
    placementSeed,
    season,
    terrain?.grassTuftCountDesktop,
    terrain?.grassTuftCountMobile,
    terrainHeightSampler,
    treelineRadius
  ]);

  // Wind ripple over the grass: each tuft pivots at its base with a phase
  // derived from its position, so gusts read as waves rolling across the
  // meadow instead of synchronized wobble.
  const windStrength = trees?.windStrength ?? 0.35;
  const windDirectionRadians = trees?.windDirectionRadians ?? 0;
  const windGustFrequency = trees?.windGustFrequency ?? 0.3;
  const elapsedSecondsRef = useRef(0);
  useFrame((_, deltaTimeSeconds) => {
    elapsedSecondsRef.current += deltaTimeSeconds;
    const elapsedSeconds = elapsedSecondsRef.current;
    const gustAngularFrequency = windGustFrequency * GRASS_SWAY_GUST_FREQUENCY_TO_RADIANS;
    const tiltAxis = new Vector3(-Math.sin(windDirectionRadians), 0, Math.cos(windDirectionRadians));
    const windDirectionX = Math.cos(windDirectionRadians);
    const windDirectionZ = Math.sin(windDirectionRadians);
    const matrix = new Matrix4();
    const yawQuaternion = new Quaternion();
    const tiltQuaternion = new Quaternion();
    const combinedQuaternion = new Quaternion();
    const yAxis = new Vector3(0, 1, 0);
    const scaleVector = new Vector3();
    for (const bucket of grassInstancedMeshes) {
      bucket.transforms.forEach((transform, instanceIndex) => {
        // Position-based phase: the gust wave travels along the wind.
        const travelPhase = (transform.position.x * windDirectionX + transform.position.z * windDirectionZ) * 0.35;
        const tiltRadians =
          Math.sin(elapsedSeconds * gustAngularFrequency - travelPhase) * windStrength * GRASS_SWAY_BASE_RADIANS;
        yawQuaternion.setFromAxisAngle(yAxis, transform.yawRadians);
        tiltQuaternion.setFromAxisAngle(tiltAxis, tiltRadians);
        combinedQuaternion.copy(tiltQuaternion).multiply(yawQuaternion);
        scaleVector.setScalar(transform.scale);
        matrix.compose(transform.position, combinedQuaternion, scaleVector);
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
      <mesh geometry={groundMesh.geometry} material={groundMesh.material} receiveShadow />
      {rockInstancedMeshes.map((mesh, meshIndex) => (
        <primitive key={`rock-${meshIndex}`} object={mesh} />
      ))}
      {grassInstancedMeshes.flatMap((bucket, bucketIndex) =>
        bucket.instancedMeshes.map((mesh, meshIndex) => (
          <primitive key={`grass-${bucketIndex}-${meshIndex}`} object={mesh} />
        ))
      )}
    </group>
  );
}

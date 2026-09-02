"use client";

import { useMemo } from "react";
import { Environment } from "@react-three/drei";
import type { SceneRendererProps } from "@/features/scene-renderers/types";
import { pointsOfInterestFromScene } from "@/lib/scene";
import {
  createLakeEdgeDistanceSampler,
  createPathLateralDistanceSampler,
  createRiverEdgeDistanceSampler,
  createTerrainHeightSampler,
  LAKE_SHORE_PLANTING_BUFFER,
  maximumLakeRadiusFromTerrain,
  treelineRadiusFromTerrain
} from "./forestMath";
import { natureHdriUrlForKey } from "./forestModels";
import { ForestAmbientParticles } from "./ForestAmbientParticles";
import { ForestDistantTreeline } from "./ForestDistantTreeline";
import { ForestGroundDecor } from "./ForestGroundDecor";
import { ForestLandmarks } from "./ForestLandmarks";
import { ForestSkyDome, sunDirectionFromLighting } from "./ForestSkyDome";
import { ForestTerrain } from "./ForestTerrain";
import { ForestTrees } from "./ForestTrees";
import { ForestWaterway } from "./ForestWaterway";
import { ForestWeatherEffects } from "./ForestWeatherEffects";
import { ForestWildlife } from "./ForestWildlife";

// The forest scene family renderer (sceneType "forest", nature-service).
// Everything visual reads from the ForestSceneConfig sections; every scatter
// decision comes from the placement seeds embedded in the config, so the
// same seed renders the same forest forever.

const SUN_LIGHT_DISTANCE = 60;
// Sunlight has to DOMINATE the fill to read as sunlight. The old rig ran the
// sun at 1.35 against ~1.27 of combined HDRI + hemisphere + ambient fill — a
// ~1:1 key-to-fill ratio, which is the signature of flat overcast studio light,
// not a sunny day. Outdoors the sun beats skylight by roughly an order of
// magnitude; this rig now runs ~3:1, kept deliberately short of the physical
// ratio so AgX has headroom and the selective bloom (threshold 0.85) does not
// turn lit foliage into a white blob.
const SUN_LIGHT_BASE_INTENSITY = 2.6;
// Overcast/rain/snow flatten the light; sun rays crank it slightly.
const SUN_INTENSITY_MULTIPLIERS_BY_WEATHER_KIND: Record<string, number> = {
  clear: 1.0,
  sunRays: 1.1,
  overcast: 0.45,
  rain: 0.4,
  snow: 0.55
};
// Fill is support only — pulled down so the sun above can actually carve shape
// and cast readable shadows instead of every surface being pre-lit from all
// sides. The HDRI still supplies the sky's color character, just quieter.
const HEMISPHERE_LIGHT_INTENSITY = 0.2;
const AMBIENT_LIGHT_INTENSITY = 0.06;
const HEMISPHERE_GROUND_COLOR = "#3D3327";
const ENVIRONMENT_LIGHTING_INTENSITY = 0.6;

// Shadows carry most of the "is this real light?" impression, and the scene now
// has alpha-masked fir foliage whose fine cutouts alias badly at low
// resolution, so the map is denser than before.
const SHADOW_MAP_SIZE = 3072;
const SHADOW_CAMERA_MARGIN = 8;
const SHADOW_BIAS = -0.0004;
// Offsets the shadow lookup along the surface normal: kills the acne that a
// constant bias alone leaves on the firs' angled leaf cards, without the
// peter-panning a larger constant bias would cause.
const SHADOW_NORMAL_BIAS = 0.02;

// A whisper of height fog even when the config draws none — pure zero makes
// the treeline cut a hard edge against the sky dome. Renderer aesthetic, not
// contract: the config's density always wins when present.
const MINIMUM_RENDER_FOG_DENSITY = 0.004;

// Dry-land breathing room past the widest point of the shoreline.
const SHORE_PLACEMENT_MARGIN = 1.8;

/**
 * Renders a ForestSceneConfig: seeded terrain with a clearing and dirt path,
 * wind-swayed instanced trees, seasonal weather and ambience, wandering
 * wildlife, and one clickable landmark per Nature DNA landmark.
 */
export function ForestRenderer({ scene, selectedPlanetKey, hoveredPlanetKey, onHoverPlanet, onSelectPlanet }: SceneRendererProps) {
  const season = scene.season;
  const lighting = scene.lighting;
  const terrain = scene.terrain;
  const trees = scene.trees;
  const weather = scene.weather;
  const wildlife = scene.wildlife;
  const ambientParticles = scene.ambientParticles;

  const terrainHeightSampler = useMemo(() => createTerrainHeightSampler(terrain), [terrain]);
  const pathLateralDistanceSampler = useMemo(() => createPathLateralDistanceSampler(terrain), [terrain]);
  // Trees, decor and ground texture all exclude "the dirt path". Water is the
  // same kind of no-grow surface, so it composes into the one sampler they
  // already consume rather than each learning about the river separately.
  const clearFloorDistanceSampler = useMemo(() => {
    const riverEdgeDistanceSampler = createRiverEdgeDistanceSampler(terrain);
    const lakeEdgeDistanceSampler = createLakeEdgeDistanceSampler(terrain);
    return (x: number, z: number) =>
      Math.min(pathLateralDistanceSampler(x, z), riverEdgeDistanceSampler(x, z), lakeEdgeDistanceSampler(x, z));
  }, [pathLateralDistanceSampler, terrain]);
  // Trees — and ONLY trees — keep an extra bank clear of the water. Grass, ferns
  // and rocks run right down to the waterline, which is both what a real
  // lakeshore looks like and the thing that gives the eye a sense of scale:
  // water with nothing recognisable at its edge reads as a puddle. Pushing the
  // decor back with the trees produced a bare ring that made it worse.
  const treePlantingDistanceSampler = useMemo(() => {
    const lakeEdgeDistanceSampler = createLakeEdgeDistanceSampler(terrain);
    return (x: number, z: number) =>
      Math.min(clearFloorDistanceSampler(x, z), lakeEdgeDistanceSampler(x, z) - LAKE_SHORE_PLANTING_BUFFER);
  }, [clearFloorDistanceSampler, terrain]);
  // Everything the backend positions by radius alone (landmarks) has to clear
  // the lake, which it knows nothing about.
  const shoreClearanceRadius = maximumLakeRadiusFromTerrain(terrain) + SHORE_PLACEMENT_MARGIN;
  const pointsOfInterest = useMemo(() => pointsOfInterestFromScene(scene), [scene]);

  const sunPosition = useMemo(
    () => sunDirectionFromLighting(lighting).multiplyScalar(SUN_LIGHT_DISTANCE),
    [lighting]
  );
  const weatherKind = weather?.kind ?? "clear";
  const sunIntensity =
    SUN_LIGHT_BASE_INTENSITY * (lighting?.exposure ?? 1) * (SUN_INTENSITY_MULTIPLIERS_BY_WEATHER_KIND[weatherKind] ?? 1);
  const fogDensity = Math.max(lighting?.fogDensity ?? 0, MINIMUM_RENDER_FOG_DENSITY);
  const fogColor = lighting?.fogColor ?? "#C4D2BE";
  const shadowCameraExtent = treelineRadiusFromTerrain(terrain) + SHADOW_CAMERA_MARGIN;
  const placementSeed = terrain?.placementSeed ?? String(scene.seed ?? "forest");

  return (
    <group>
      <fogExp2 attach="fog" args={[fogColor, fogDensity]} />

      {/* Image-based environment lighting: a self-hosted Poly Haven pure-sky
          HDRI per time of day (config lighting.hdriKey). Lighting only — the
          procedural sky dome stays the visible background. */}
      <Environment files={natureHdriUrlForKey(lighting?.hdriKey)} environmentIntensity={ENVIRONMENT_LIGHTING_INTENSITY} />

      <hemisphereLight
        args={[lighting?.ambientColor ?? "#9DB4C8", HEMISPHERE_GROUND_COLOR, HEMISPHERE_LIGHT_INTENSITY]}
      />
      <ambientLight color={lighting?.ambientColor ?? "#9DB4C8"} intensity={AMBIENT_LIGHT_INTENSITY} />
      <directionalLight
        position={sunPosition}
        color={lighting?.sunColor ?? "#FFF6E5"}
        intensity={sunIntensity}
        castShadow
        shadow-mapSize-width={SHADOW_MAP_SIZE}
        shadow-mapSize-height={SHADOW_MAP_SIZE}
        shadow-camera-left={-shadowCameraExtent}
        shadow-camera-right={shadowCameraExtent}
        shadow-camera-top={shadowCameraExtent}
        shadow-camera-bottom={-shadowCameraExtent}
        shadow-camera-near={1}
        shadow-camera-far={SUN_LIGHT_DISTANCE * 2.5}
        shadow-bias={SHADOW_BIAS}
        shadow-normalBias={SHADOW_NORMAL_BIAS}
      />

      <ForestSkyDome lighting={lighting} weather={weather} />
      {/* Terrain gets the PATH-ONLY sampler on purpose: this sampler also paints
          the ground as bare dirt, and running it over the river turned the
          channel into a wide tan road. The riverbed gets its own strip in
          ForestWaterway. Trees and decor below use the water-aware one. */}
      <ForestTerrain
        terrain={terrain}
        season={season}
        trees={trees}
        horizonColor={fogColor}
        terrainHeightSampler={terrainHeightSampler}
        pathLateralDistanceSampler={pathLateralDistanceSampler}
      />
      <ForestTrees
        trees={trees}
        terrain={terrain}
        season={season}
        terrainHeightSampler={terrainHeightSampler}
        pathLateralDistanceSampler={treePlantingDistanceSampler}
      />
      {/* Forested hills ringing the clearing, so the world does not end at the
          treeline in bare tinted ground. */}
      <ForestDistantTreeline terrain={terrain} terrainHeightSampler={terrainHeightSampler} />
      <ForestGroundDecor
        terrain={terrain}
        season={season}
        terrainHeightSampler={terrainHeightSampler}
        pathLateralDistanceSampler={clearFloorDistanceSampler}
      />
      {/* Lake in the clearing plus the river through it — drawn after the
          terrain and trees so the reflector captures them. */}
      <ForestWaterway terrain={terrain} season={season} terrainHeightSampler={terrainHeightSampler} />
      <ForestWeatherEffects
        weather={weather}
        lighting={lighting}
        terrain={terrain}
        trees={trees}
        placementSeed={placementSeed}
      />
      <ForestAmbientParticles
        ambientParticles={ambientParticles}
        season={season}
        terrain={terrain}
        placementSeed={placementSeed}
      />
      <ForestWildlife
        wildlife={wildlife}
        terrain={terrain}
        terrainHeightSampler={terrainHeightSampler}
        shoreClearanceRadius={shoreClearanceRadius}
        worldSeed={placementSeed}
        selectedPlanetKey={selectedPlanetKey}
        onHoverPlanet={onHoverPlanet}
        onSelectPlanet={onSelectPlanet}
      />
      <ForestLandmarks
        landmarks={scene.landmarks}
        pointsOfInterest={pointsOfInterest}
        terrainHeightSampler={terrainHeightSampler}
        minimumRadiusFromCenter={shoreClearanceRadius}
        selectedPlanetKey={selectedPlanetKey}
        hoveredPlanetKey={hoveredPlanetKey}
        onHoverPlanet={onHoverPlanet}
        onSelectPlanet={onSelectPlanet}
      />
    </group>
  );
}

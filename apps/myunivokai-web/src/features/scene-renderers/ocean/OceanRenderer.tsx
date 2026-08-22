"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { Group, PerspectiveCamera } from "three";
import type { SceneRendererProps } from "@/features/scene-renderers/types";
import { useTerrainHeightSampler } from "@/features/scene-renderers/shared/TerrainHeightSampler";
import { pointsOfInterestFromScene } from "@/lib/scene";
import { OceanLandmarks } from "./OceanLandmarks";
import { createCausticsUniforms } from "./oceanCaustics";
import { createSeafloorHeightSampler, type SeafloorHeightSampler } from "./oceanMath";
import { createOceanRig, type OceanRig } from "./oceanRig";
import {
  DEFAULT_WATER_TYPE,
  JERLOV_WATER_TYPES,
  sightingRangeMetres,
  waterAttenuation,
  type JerlovWaterType,
} from "./oceanOptics";

// The ocean scene family renderer (sceneType "ocean", ocean-service).
//
// The whole medium — sky, surface, water column, light, floor and animals — is
// built by `createOceanRig`, imperatively, in one place. It is not a stack of
// components because every one of those layers has to agree with the others
// about the same wave, the same water and the same sun, and threading that
// through eight components is precisely how they drifted apart before.
//
// What is left in React is what React is for: the landmark meshes, because they
// are interactive product surface rather than medium.
//
// NOTHING HERE ASKS WHICH DEPTH ZONE IT IS IN. A reef and an abyssal trench are
// the same code path with different numbers.

const MOBILE_VIEWPORT_WIDTH_PIXELS = 820;
const BOUNDARY_SIGHT_MULTIPLIER = 1.5;
const REBUILD_SETTLE_GRACE_MILLISECONDS = 800;

/**
 * Which Jerlov water type a stored `visibilityMetres` implies.
 *
 * The config still carries the backend's derived numbers, and the backend does
 * not know about Jerlov yet. Rather than ignore what it sent or invent a second
 * source of truth, the stored sighting range is matched to the closest real
 * water type — so a world configured for 40 m of visibility renders as the water
 * that actually has 40 m of visibility, with the colour, the depth curve and the
 * caustic coherence that go with it.
 *
 * When ocean-service starts carrying `jerlovWaterType` this function becomes a
 * one-line fallback for old configs.
 */
export function waterTypeForVisibility(visibilityMetres: number | undefined): JerlovWaterType {
  if (visibilityMetres === undefined) return DEFAULT_WATER_TYPE;
  let best: JerlovWaterType = DEFAULT_WATER_TYPE;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const entry of JERLOV_WATER_TYPES) {
    const gap = Math.abs(sightingRangeMetres(waterAttenuation(entry.type)) - visibilityMetres);
    if (gap < bestGap) {
      bestGap = gap;
      best = entry.type;
    }
  }
  return best;
}

/** Whether a stored string names a water type this renderer knows. */
export function isJerlovWaterType(value: string | undefined): value is JerlovWaterType {
  return value !== undefined && JERLOV_WATER_TYPES.some((entry) => entry.type === value);
}

/**
 * Wind speed implied by a stored surface elevation and depth.
 *
 * Same reasoning: until the service carries `windSpeedMetresPerSecond`, a
 * plausible sea state has to come from somewhere, and a fixed one would make
 * every world's surface identical. Derived from the world's own seed so it is
 * stable and varied rather than arbitrary.
 */
export function windSpeedFromSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unit = ((hash >>> 0) % 1000) / 1000;
  // Beaufort 3 to 6: the band that is neither a mirror nor a storm.
  return 5 + unit * 8;
}

export function OceanRenderer({
  scene,
  seed,
  selectedPlanetKey,
  hoveredPlanetKey,
  onHoverPlanet,
  onSelectPlanet,
}: SceneRendererProps) {
  const water = scene.water;
  const lighting = scene.lighting;
  const seafloor = scene.seafloor;

  const renderer = useThree((state) => state.gl);
  const threeScene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const viewportWidth = useThree((state) => state.size.width);
  const isMobile = viewportWidth > 0 && viewportWidth < MOBILE_VIEWPORT_WIDTH_PIXELS;

  // Landmarks stand on the RIG's floor, so they sample it through the rig. The
  // fallback keeps them placeable during the first frame, before the rig exists.
  const fallbackSampler = useMemo(() => createSeafloorHeightSampler(seafloor), [seafloor]);
  const heightSampler = useMemo<SeafloorHeightSampler>(
    () => (x, z) => (rigRef.current ? rigRef.current.heightAt(x, z) : fallbackSampler(x, z)),
    [fallbackSampler],
  );
  const pointsOfInterest = useMemo(() => pointsOfInterestFromScene(scene), [scene]);
  const worldSeed = seed || String(scene.seed ?? "ocean");

  const rigRef = useRef<OceanRig | null>(null);
  // null until the rig-rebuild effect below has run once, then the
  // performance.now() timestamp of its most recent run. Guards the
  // cross-fade so it only engages for a REBUILD well after mount — the live
  // create-world preview swapping depth/lighting/species while already on
  // screen, or a viewport resize crossing the mobile quality threshold —
  // never for the ordinary settle-and-fire-again this effect's own
  // dependencies (camera/renderer/scene from useThree, none of which
  // actually change) do once in the first few hundred ms of every mount.
  // REBUILD_SETTLE_GRACE_MILLISECONDS is comfortably above that gap and
  // comfortably below any realistic user-triggered rebuild.
  const lastRigBuildAtRef = useRef<number | null>(null);

  // The SAME number UniverseCanvas frames the shot with, so the seabed and the
  // camera cannot disagree about where the viewer is standing.
  const cameraDistanceMetres = scene.camera?.distance ?? 20;
  const viewerMetres = scene.depth?.metres ?? 20;
  const seafloorMetres = scene.depth?.seafloorMetres ?? viewerMetres + 10;
  const floorClearanceMetres = Math.max(0, seafloorMetres - viewerMetres);

  // The service carries both of these from schemaVersion 1.1. The inferences
  // below are the fallback for worlds stored before that, and only for those —
  // a stored value always wins, because two clients guessing independently is
  // how one world ends up being two different seas.
  const waterType = isJerlovWaterType(water?.jerlovWaterType)
    ? water.jerlovWaterType
    : waterTypeForVisibility(water?.visibilityMetres);
  const windSpeedMps = water?.windSpeedMetresPerSecond ?? windSpeedFromSeed(worldSeed);
  const sightLimit =
    sightingRangeMetres(waterAttenuation(waterType)) * BOUNDARY_SIGHT_MULTIPLIER;
  // A landmark is a thing that STANDS ON THE SEABED, so it exists only when the
  // seabed does. Two situations used to draw them anyway, and both were visible
  // as furniture hanging in open water:
  //
  //   - midwater worlds, where the floor is kilometres down and not drawn, put
  //     a rock spire and a whale fall in the blue with a contact shadow under
  //     them and nothing beneath that;
  //   - above-water worlds, where the offset fell through to zero, put them in
  //     the SKY above the horizon.
  //
  // There is no honest y for a seabed object in either case. The right answer is
  // that a world with no floor has no floor objects — the water, the light and
  // the animals are the scene, which is exactly what the prototype's own
  // midwater views are made of.
  const isAboveWater = viewerMetres < 0;
  const isSeafloorInSight = !isAboveWater && floorClearanceMetres <= sightLimit;
  const landmarksStandOnSomething = isSeafloorInSight;

  const groupRef = useRef<Group>(null);

  // Published for CameraRig's terrain clamp — see TerrainHeightSampler.ts. The
  // WORLD-space floor, not heightSampler's local one: heightSampler is read
  // inside a group already offset by -floorClearanceMetres (below), and
  // CameraRig has no such parent to inherit that offset from.
  const terrainHeightSampler = useTerrainHeightSampler();
  useEffect(() => {
    terrainHeightSampler.current = (x, z) => -floorClearanceMetres + heightSampler(x, z);
    return () => {
      terrainHeightSampler.current = null;
    };
  }, [terrainHeightSampler, heightSampler, floorClearanceMetres]);

  // Landmarks keep their own caustics clock, driven from the same frame loop so
  // the pattern on a coral head stays in step with the pattern on the sand.
  const landmarkCaustics = useMemo(
    () =>
      createCausticsUniforms(
        lighting?.causticStrength ?? 0,
        viewerMetres + floorClearanceMetres,
        lighting?.surfaceLightColor ?? "#8FD8E8",
      ),
    [
      lighting?.causticStrength,
      lighting?.surfaceLightColor,
      viewerMetres,
      floorClearanceMetres,
    ],
  );

  useEffect(() => {
    const parent = groupRef.current;
    if (!parent) return undefined;

    // Every dependency below can change while this component stays mounted
    // — most commonly the create-world page's debounced live preview, where
    // one form edit swaps depth/lighting/species wholesale. The rebuild
    // itself is correct and fast; what read as broken was the jump cut, one
    // frame the old sea and the next an entirely different one. Fading the
    // shared canvas out before tearing the old rig down and back in once the
    // new one exists turns that cut into a transition without any of the
    // rig's own materials or shaders having to know it happens.
    const canvasStyle = renderer.domElement.style;
    const now = performance.now();
    const previousBuildAt = lastRigBuildAtRef.current;
    const isRebuild = previousBuildAt !== null && now - previousBuildAt > REBUILD_SETTLE_GRACE_MILLISECONDS;
    lastRigBuildAtRef.current = now;
    if (isRebuild) {
      canvasStyle.transition = "opacity 220ms ease";
      canvasStyle.opacity = "0";
    }

    const rig = createOceanRig({
      renderer,
      scene: threeScene,
      seed: worldSeed,
      viewerDepthMetres: viewerMetres,
      seafloorDepthMetres: seafloorMetres,
      waterType,
      windSpeedMps,
      sunElevationDegrees:
        ((lighting?.surfaceElevationRadians ?? 0.9) * 180) / Math.PI,
      // Undefined on worlds stored before schemaVersion 1.2, where the rig's own
      // default takes over. Passed through rather than defaulted here so the sun
      // and the camera cannot disagree: UniverseCanvas reads the same field to
      // decide where to stand.
      sunAzimuthRadians: lighting?.surfaceAzimuthRadians,
      godRayStrength: lighting?.godRayStrength,
      cameraDistanceMetres,
      quality: isMobile ? "low" : "high",
    });
    parent.add(rig.group);
    rigRef.current = rig;

    // The medium decides how far the view has to reach, and only the medium
    // knows: in air the sea grid runs to 5.6 km and the sky sits beyond it,
    // where r3f's default far plane of 1000 clips both. Saved and restored
    // rather than set, because this camera is SHARED with every other family
    // and an ocean world must not leave a 12 km frustum behind it.
    const perspective = camera as PerspectiveCamera;
    const restoreFar = perspective.far;
    const restoreNear = perspective.near;
    if (perspective.isPerspectiveCamera && rig.state.farPlaneMetres > restoreFar) {
      perspective.far = rig.state.farPlaneMetres;
      // Pushed out with it: 0.1 against a 12 km far plane spends the whole
      // depth buffer on the first few metres and the sea z-fights with itself.
      perspective.near = Math.max(restoreNear, 0.5);
      perspective.updateProjectionMatrix();
    }

    // Two rAFs, not one: the first fires before the browser has necessarily
    // presented a frame with the new rig in it, the second is guaranteed to
    // land after one has. Revealing on the first would risk fading back in
    // on the very frame being hidden.
    let revealFrame1 = 0;
    let revealFrame2 = 0;
    if (isRebuild) {
      revealFrame1 = requestAnimationFrame(() => {
        revealFrame2 = requestAnimationFrame(() => {
          canvasStyle.opacity = "1";
        });
      });
    }

    return () => {
      cancelAnimationFrame(revealFrame1);
      cancelAnimationFrame(revealFrame2);
      // Unconditional, not just the isRebuild branch: this also covers a true
      // unmount mid-fade (navigating away while the canvas sits at opacity 0),
      // so the next family to use this SHARED canvas never inherits it hidden.
      canvasStyle.opacity = "1";
      parent.remove(rig.group);
      rig.dispose();
      rigRef.current = null;
      if (perspective.isPerspectiveCamera) {
        perspective.far = restoreFar;
        perspective.near = restoreNear;
        perspective.updateProjectionMatrix();
      }
    };
  }, [
    camera,
    renderer,
    threeScene,
    worldSeed,
    viewerMetres,
    seafloorMetres,
    waterType,
    windSpeedMps,
    lighting?.surfaceElevationRadians,
    lighting?.surfaceAzimuthRadians,
    lighting?.godRayStrength,
    cameraDistanceMetres,
    isMobile,
  ]);

  useFrame((state) => {
    const rig = rigRef.current;
    if (!rig) return;
    const elapsed = state.clock.getElapsedTime();
    rig.update(elapsed, camera);
    landmarkCaustics.uCausticTime.value = elapsed;
  });

  return (
    <group ref={groupRef}>
      {/* Landmarks ride the same floor offset as everything else standing on the
          seabed. When the floor is out of sight there is no floor to stand on. */}
      <group position={[0, -floorClearanceMetres, 0]} visible={landmarksStandOnSomething}>
        <OceanLandmarks
          landmarks={scene.landmarks}
          pointsOfInterest={pointsOfInterest}
          water={water}
          causticsUniforms={landmarkCaustics}
          heightSampler={heightSampler}
          selectedPlanetKey={selectedPlanetKey}
          hoveredPlanetKey={hoveredPlanetKey}
          onHoverPlanet={onHoverPlanet}
          onSelectPlanet={onSelectPlanet}
          worldSeed={worldSeed}
        />
      </group>
    </group>
  );
}

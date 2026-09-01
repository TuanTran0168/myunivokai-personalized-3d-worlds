"use client";

import { useEffect, useMemo } from "react";
import { AdditiveBlending, Color, MeshStandardMaterial, Vector3 } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { OceanLandmarkConfig, OceanWaterConfig, PlanetSceneConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { rarityFeature } from "@/lib/rarity";
import { planetIdentityKey } from "@/features/scene-renderers/planetIdentity";
import { usePlanetPositionTracker } from "@/features/scene-renderers/shared/PlanetPositionTracker";
import { getSoftCircleTexture } from "@/features/scene-renderers/shared/softCircleTexture";
import { applyCaustics, type CausticsUniforms } from "./oceanCaustics";
import {
  LANDMARK_BASE_COLORS,
  landmarkFootprintRadiusMetres,
  landmarkGeometry
} from "./oceanLandmarkGeometry";
import {
  lowestSeafloorUnderFootprint,
  mixHexColors,
  type SeafloorHeightSampler
} from "./oceanMath";

// The clickable POI layer — one hero object per Ocean DNA landmark, the ocean's
// counterpart of planets and forest landmarks. Hover feeds the canvas tooltip;
// click flies the camera, because positions are registered in the same shared
// tracker CameraRig already reads. That is the whole reason this family needed
// no change to CameraRig or PlanetPositionTracker.

const LANDMARK_HIT_SPHERE_RADIUS = 2.6;
const SELECTION_RING_RADIUS = 2.0;
const SELECTION_RING_TUBE_RADIUS = 0.055;
const SELECTION_RING_HOVER_OPACITY = 0.35;
const SELECTION_RING_SELECTED_OPACITY = 0.95;
// The glow is a wayfinding aid, not the landmark. At 5.5 it was a sprite wider
// than the formation behind it, so every landmark read as a coloured blob with
// something vague inside.
const LANDMARK_GLOW_SCALE = 2.6;
const LANDMARK_GLOW_OPACITY = 0.18;
const CAMERA_FOCUS_LIFT = 2.0;
// Both of these lie flat ON the sand rather than on the landmark, so they are
// measured from the sediment line and not from the group's origin — the group
// sits BELOW the sediment by the config's bed depth. Just enough clearance to
// win the depth test against the seabed mesh under them.
const WHALE_FALL_MAT_CLEARANCE = 0.05;
const SELECTION_RING_CLEARANCE = 0.1;

// The vent's plume and the relic's glow are what make those two landmarks read
// at a distance in water that swallows detail.
const VENT_PLUME_HEIGHT = 6.5;

type OceanLandmarksProps = {
  landmarks?: OceanLandmarkConfig[];
  pointsOfInterest: PlanetSceneConfig[];
  water?: OceanWaterConfig;
  /** Shared with the seabed so a formation catches the same wave the sand does. */
  causticsUniforms: CausticsUniforms;
  heightSampler: SeafloorHeightSampler;
  /**
   * The floor mesh's vertex spacing, read at placement time rather than passed
   * as a number, because the rig that owns it is built after this renders. Zero
   * means no mesh yet, and heightSampler is then the analytic fallback.
   */
  floorCellSizeSampler: () => number;
  selectedPlanetKey: string | null;
  hoveredPlanetKey: string | null;
  onHoverPlanet: (pointOfInterest: PlanetSceneConfig | null) => void;
  onSelectPlanet?: (pointOfInterest: PlanetSceneConfig | null) => void;
  /** The variant seed — the sunken-relic lottery hangs off it. */
  worldSeed: string;
};

export function OceanLandmarks({
  landmarks,
  pointsOfInterest,
  water,
  causticsUniforms,
  heightSampler,
  floorCellSizeSampler,
  selectedPlanetKey,
  hoveredPlanetKey,
  onHoverPlanet,
  onSelectPlanet,
  worldSeed
}: OceanLandmarksProps) {
  // The sunken-relic lottery: when it hits, one landmark that would otherwise
  // be an ordinary kind becomes a relic. Re-derived from the seed rather than
  // stored, like every rare feature in this platform.
  const relicIndex = useMemo(() => {
    const feature = rarityFeature("ocean-sunken-relic");
    const nextRandomValue = randomFromSeed(worldSeed + feature.seedSuffix);
    if (nextRandomValue() >= feature.probability) {
      return -1;
    }
    const count = landmarks?.length ?? 0;
    if (count < 2) {
      return -1;
    }
    // Never the hero: the first landmark is always the kelp cathedral.
    return 1 + Math.floor(nextRandomValue() * (count - 1));
  }, [landmarks?.length, worldSeed]);

  return (
    <group>
      {(landmarks ?? []).map((landmark, landmarkIndex) => {
        const pointOfInterest = pointsOfInterest[landmarkIndex];
        if (!pointOfInterest) {
          return null;
        }
        const identityKey = planetIdentityKey(pointOfInterest, landmarkIndex);
        return (
          <OceanLandmark
            key={identityKey}
            landmark={landmark}
            pointOfInterest={pointOfInterest}
            landmarkIndex={landmarkIndex}
            worldSeed={worldSeed}
            water={water}
            causticsUniforms={causticsUniforms}
            heightSampler={heightSampler}
            floorCellSizeSampler={floorCellSizeSampler}
            forceRelic={landmarkIndex === relicIndex}
            isSelected={identityKey === selectedPlanetKey}
            isHovered={identityKey === hoveredPlanetKey}
            onHoverPlanet={onHoverPlanet}
            onSelectPlanet={onSelectPlanet}
          />
        );
      })}
    </group>
  );
}

/**
 * The landmark's body, BUILT rather than imported.
 *
 * This used to load a forest GLB chosen by silhouette, and the choice was
 * defended in a comment: "a bare dead tree and a staghorn coral are the same
 * shape". They are not. The kelp cathedral rendered as a dead tree standing on
 * the seabed and the sunken relic rendered as a street lamp, underwater, with a
 * lantern on it. Nothing about tinting or scaling repairs an object whose
 * silhouette already says "land" — and a landmark is the one thing in frame a
 * visitor is invited to click, so it is the last place that can hide.
 *
 * See oceanLandmarkGeometry.ts for what each kind is now made of. The geometry
 * carries per-part colour as a vertex attribute, so one material draws a whole
 * formation and the body tint still multiplies over it.
 */
function LandmarkFormation({
  kind,
  worldSeed,
  landmarkIndex,
  bodyColor,
  accentColor,
  emissiveIntensity,
  causticsUniforms
}: {
  kind: string;
  worldSeed: string;
  landmarkIndex: number;
  bodyColor: string;
  accentColor: string;
  emissiveIntensity: number;
  causticsUniforms: CausticsUniforms;
}) {
  // Seeded per landmark, so two vents in one world are two different vents
  // rather than the same chimney twice — which is the other way a landmark
  // stops reading as a place.
  const geometry = useMemo(
    () => landmarkGeometry(kind, `${worldSeed}:${landmarkIndex}`),
    [kind, worldSeed, landmarkIndex]
  );

  const material = useMemo(() => {
    const dressed = new MeshStandardMaterial({
      color: new Color(bodyColor),
      // The geometry's own per-part colours ride underneath the body tint.
      vertexColors: true,
      roughness: 0.86,
      metalness: 0
    });
    applyCaustics(dressed, causticsUniforms);
    return dressed;
  }, [bodyColor, causticsUniforms]);

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    // The accent is an INTERACTION cue, not the landmark's colour: zero at rest,
    // lit only under the pointer. Held constant it floods the whole body, which
    // is the flat-hue placeholder look this replaced primitives to escape.
    material.emissive.set(accentColor);
    material.emissiveIntensity = emissiveIntensity;
  }, [material, accentColor, emissiveIntensity]);

  return <mesh geometry={geometry} material={material} castShadow receiveShadow />;
}

type OceanLandmarkProps = {
  landmark: OceanLandmarkConfig;
  pointOfInterest: PlanetSceneConfig;
  landmarkIndex: number;
  worldSeed: string;
  water?: OceanWaterConfig;
  causticsUniforms: CausticsUniforms;
  heightSampler: SeafloorHeightSampler;
  floorCellSizeSampler: () => number;
  forceRelic: boolean;
  isSelected: boolean;
  isHovered: boolean;
  onHoverPlanet: (pointOfInterest: PlanetSceneConfig | null) => void;
  onSelectPlanet?: (pointOfInterest: PlanetSceneConfig | null) => void;
};

function OceanLandmark({
  landmark,
  pointOfInterest,
  landmarkIndex,
  worldSeed,
  water,
  causticsUniforms,
  heightSampler,
  floorCellSizeSampler,
  forceRelic,
  isSelected,
  isHovered,
  onHoverPlanet,
  onSelectPlanet
}: OceanLandmarkProps) {
  const planetPositionTracker = usePlanetPositionTracker();
  const accentColor = landmark.accentColor ?? "#06B6D4";
  const kind = forceRelic ? "sunkenRelic" : landmark.kind ?? "kelpCathedral";
  const fogColor = water?.fogColor ?? "#0A3B4E";
  const tintStrength = water?.tintStrength ?? 0.4;

  const landmarkPosition = useMemo(() => {
    const angle = landmark.angleRadians ?? 0;
    const radius = landmark.radiusFromCenter ?? 10;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    // The floor under the whole FOOTPRINT, not under the centre point. A
    // landmark's geometry has its foot normalised to y = 0 (see standOn in
    // oceanLandmarkGeometry.ts), so one sample on a dune slope leaves the
    // downhill edge in open water.
    const floorHeight = lowestSeafloorUnderFootprint(
      heightSampler,
      x,
      z,
      landmarkFootprintRadiusMetres(kind, `${worldSeed}:${landmarkIndex}`),
      floorCellSizeSampler()
    );
    // heightAboveFloor is the one field the forest has no use for: an ocean is
    // a volume, so a landmark can in principle sit on the floor or hang in the
    // water column. Every kind this family draws is a bottom feature, so from
    // schemaVersion 1.6 the service ships it NEGATIVE — how deep the shape beds
    // into the sediment. It used to be a 0-6 m lift, and it showed.
    return new Vector3(x, floorHeight + (landmark.heightAboveFloor ?? 0), z);
  }, [
    landmark.angleRadians,
    landmark.heightAboveFloor,
    landmark.radiusFromCenter,
    heightSampler,
    floorCellSizeSampler,
    kind,
    worldSeed,
    landmarkIndex
  ]);

  const identityKey = planetIdentityKey(pointOfInterest, landmarkIndex);
  useEffect(() => {
    planetPositionTracker.set(identityKey, landmarkPosition.clone().add(new Vector3(0, CAMERA_FOCUS_LIFT, 0)));
    return () => {
      planetPositionTracker.delete(identityKey);
    };
  }, [identityKey, landmarkPosition, planetPositionTracker]);

  // A TINT rather than a base colour: the geometry carries its own per-part
  // vertex colours and this material multiplies over them, so the kind's palette
  // entry is pulled most of the way to white to let those through instead of
  // staining every formation one hue.
  //
  // THE WATER'S SHARE IS THE FULL `tintStrength`, not half of it. Halving it was
  // the single reason landmarks ignored the depth axis. `tintStrength` is already
  // the depth-driven quantity — 0.45 at fourteen metres, 0.65 at fifty-eight,
  // 0.95 in the trench — and the config ships it correctly; the renderer then
  // discarded half. Combined with the 65% lift toward white, an abyssal trench
  // came out as pale grey #5E6167 at 1144 m, a daylight-coloured slab in water
  // with no daylight in it, and it was the largest thing in the frame.
  //
  // At full strength the same landmark lands near #0F1319: still legible against
  // the fog, and legible as something the water has taken the colour out of.
  const bodyColor = useMemo(
    () =>
      mixHexColors(
        mixHexColors("#FFFFFF", LANDMARK_BASE_COLORS[kind] ?? "#5A7F86", 0.35),
        fogColor,
        tintStrength
      ),
    [fogColor, kind, tintStrength]
  );
  // The group's origin is the landmark's FOOT, and the foot is bedded into the
  // sediment (heightAboveFloor is negative — see landmarkBedDepthMetresByKind in
  // ocean_scene_profile.go). Anything that belongs on the sand rather than on
  // the object has to climb back out by that much, or it is buried: the whale
  // fall's bacterial mat is the reason that landmark reads as an ecosystem, and
  // a selection ring nobody can see is a click with no feedback.
  //
  // Clamped at zero so a kind that one day HANGS in the water column keeps its
  // ring at its own base instead of dropping it to a seabed far below.
  const sedimentLineHeight = Math.max(0, -(landmark.heightAboveFloor ?? 0));
  const softCircleTexture = getSoftCircleTexture();
  const glowColor = useMemo(() => new Color(accentColor), [accentColor]);

  function handlePointerOver(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    onHoverPlanet(pointOfInterest);
  }

  function handlePointerOut(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    onHoverPlanet(null);
  }

  function handleClick(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    onSelectPlanet?.(isSelected ? null : pointOfInterest);
  }

  return (
    <group position={landmarkPosition}>
      <LandmarkFormation
        kind={kind}
        worldSeed={worldSeed}
        landmarkIndex={landmarkIndex}
        bodyColor={bodyColor}
        accentColor={accentColor}
        emissiveIntensity={isSelected || isHovered ? 0.30 : 0}
        causticsUniforms={causticsUniforms}
      />

      {/* A hydrothermal vent without its plume is a rock. */}
      {kind === "hydrothermalVent" ? (
        <mesh position={[0, VENT_PLUME_HEIGHT / 2 + 3, 0]}>
          <coneGeometry args={[1.3, VENT_PLUME_HEIGHT, 10, 1, true]} />
          <meshBasicMaterial color="#1A1714" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ) : null}

      {/* A whale fall runs an ecosystem for decades: the bacterial mat is the
          reason it is a landmark rather than a bone pile. */}
      {kind === "whaleFall" ? (
        <mesh
          position={[0, sedimentLineHeight + WHALE_FALL_MAT_CLEARANCE, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[4.2, 24]} />
          <meshBasicMaterial color="#E8F0C8" transparent opacity={0.18} depthWrite={false} />
        </mesh>
      ) : null}

      {softCircleTexture ? (
        <sprite position={[0, 1.6, 0]} scale={[LANDMARK_GLOW_SCALE, LANDMARK_GLOW_SCALE, 1]}>
          <spriteMaterial
            map={softCircleTexture}
            color={glowColor}
            transparent
            opacity={isHovered || isSelected ? LANDMARK_GLOW_OPACITY * 1.8 : LANDMARK_GLOW_OPACITY}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </sprite>
      ) : null}

      {isHovered || isSelected ? (
        <mesh
          position={[0, sedimentLineHeight + SELECTION_RING_CLEARANCE, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[SELECTION_RING_RADIUS, SELECTION_RING_TUBE_RADIUS, 8, 40]} />
          <meshBasicMaterial
            color={accentColor}
            transparent
            opacity={isSelected ? SELECTION_RING_SELECTED_OPACITY : SELECTION_RING_HOVER_OPACITY}
          />
        </mesh>
      ) : null}

      {/* Invisible hit sphere: a forgiving click target around every shape. */}
      <mesh
        visible={false}
        position={[0, 1.6, 0]}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      >
        <sphereGeometry args={[LANDMARK_HIT_SPHERE_RADIUS, 8, 6]} />
      </mesh>
    </group>
  );
}

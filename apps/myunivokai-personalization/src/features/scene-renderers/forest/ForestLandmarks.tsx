"use client";

import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { AdditiveBlending, Color, Mesh, MeshStandardMaterial, Vector3 } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { ForestLandmarkConfig, PlanetSceneConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { planetIdentityKey } from "@/features/scene-renderers/planetIdentity";
import { usePlanetPositionTracker } from "@/features/scene-renderers/shared/PlanetPositionTracker";
import { getSoftCircleTexture } from "@/features/scene-renderers/shared/softCircleTexture";
import { mixHexColors, type TerrainHeightSampler } from "./forestMath";
import { ForestPondWater, ForestWaterShoreline } from "./ForestPondWater";
import { LANDMARK_MODEL_CATALOG, natureModelUrl, normalizationForObject } from "./forestModels";

// The clickable POI layer — one hero object per Nature DNA landmark, the
// forest's counterpart of planets. Hover feeds the canvas tooltip, click
// flies the camera (positions are registered in the shared tracker CameraRig
// reads from).

const LANDMARK_HIT_SPHERE_RADIUS = 2.0;
const SELECTION_RING_RADIUS = 1.5;
const SELECTION_RING_TUBE_RADIUS = 0.045;
const SELECTION_RING_HOVER_OPACITY = 0.35;
const SELECTION_RING_SELECTED_OPACITY = 0.95;
const LANDMARK_GLOW_SCALE = 4.5;
const LANDMARK_GLOW_OPACITY = 0.28;

const POND_RADIUS = 1.7;
const LANTERN_LIGHT_HEIGHT = 1.6;

// How strongly the landmark's accent color tints the model's foliage and
// flower materials — the personalization layer over the stock CC0 model.
const FOLIAGE_ACCENT_TINT = 0.45;
const FOLIAGE_ACCENT_EMISSIVE_INTENSITY = 0.22;
const FLOWER_ACCENT_EMISSIVE_INTENSITY = 0.4;
const ACCENT_TINT_MATERIAL_NAME_PATTERN = /leaf|leaves|flower|green/i;

type ForestLandmarkProps = {
  landmark: ForestLandmarkConfig;
  pointOfInterest: PlanetSceneConfig;
  landmarkIndex: number;
  terrainHeightSampler: TerrainHeightSampler;
  /** Shore radius: nothing may be placed closer to the centre than this. */
  minimumRadiusFromCenter: number;
  isSelected: boolean;
  isHovered: boolean;
  onHoverPlanet: (pointOfInterest: PlanetSceneConfig | null) => void;
  onSelectPlanet?: (pointOfInterest: PlanetSceneConfig | null) => void;
};

type LandmarkModelShapeProps = {
  landmarkKind: string;
  accentColor: string;
  yawRadians: number;
};

/**
 * A real GLB hero prop (Quaternius/Kay Lousberg CC0 models), normalized to
 * its catalog height, with foliage/flower materials tinted and lit by the
 * landmark's accent color — the personalization layer over the stock model.
 */
function LandmarkModelShape({ landmarkKind, accentColor, yawRadians }: LandmarkModelShapeProps) {
  const definition = LANDMARK_MODEL_CATALOG[landmarkKind] ?? LANDMARK_MODEL_CATALOG.heartTree;
  const gltf = useGLTF(natureModelUrl(definition));

  const preparedScene = useMemo(() => {
    const cloned = gltf.scene.clone(true);
    const accent = new Color(accentColor);
    cloned.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) {
        return;
      }
      mesh.castShadow = true;
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (material && ACCENT_TINT_MATERIAL_NAME_PATTERN.test(material.name ?? "")) {
        const tintedMaterial = (material as MeshStandardMaterial).clone();
        tintedMaterial.color = tintedMaterial.color.clone().lerp(accent, FOLIAGE_ACCENT_TINT);
        tintedMaterial.emissive = accent.clone();
        tintedMaterial.emissiveIntensity = /flower/i.test(material.name ?? "")
          ? FLOWER_ACCENT_EMISSIVE_INTENSITY
          : FOLIAGE_ACCENT_EMISSIVE_INTENSITY;
        mesh.material = tintedMaterial;
      }
    });
    return cloned;
  }, [accentColor, gltf.scene]);

  const { scale, footOffsetY } = useMemo(
    () => normalizationForObject(gltf.scene, definition.targetHeight),
    [definition.targetHeight, gltf.scene]
  );

  return (
    <group rotation={[0, yawRadians, 0]}>
      <group position={[0, footOffsetY, 0]} scale={scale}>
        <primitive object={preparedScene} />
      </group>
      {landmarkKind === "lanternShrine" ? (
        <pointLight position={[0, LANTERN_LIGHT_HEIGHT, 0]} color={accentColor} intensity={2.6} distance={9} decay={2} />
      ) : null}
    </group>
  );
}

function LandmarkShape({ landmark }: { landmark: ForestLandmarkConfig }) {
  const accentColor = landmark.accentColor ?? "#06B6D4";
  // Deterministic per-landmark yaw so two shrines never face identically.
  const yawRadians = useMemo(
    () => randomFromSeed(`${landmark.key ?? "landmark"}-yaw`)() * Math.PI * 2,
    [landmark.key]
  );

  // The pond stays procedural: a real reflective, rippling water surface reads
  // better than any low-poly pond model at this scale (see ForestPondWater —
  // it reflects the actual trees and sky, which a metallic disc never did).
  if (landmark.kind === "pond") {
    const pondShapeSeed = `${landmark.key ?? "landmark"}-pond`;
    return (
      <group>
        {/* Non-reflective: the hero lake in the clearing already pays for one
            extra scene render, and a second mirror this small showed up only as
            a blown-out white patch. */}
        <ForestWaterShoreline
          radius={POND_RADIUS}
          shapeSeed={pondShapeSeed}
          bandWidth={0.24}
          color="#7D8577"
          height={0.04}
        />
        <ForestPondWater
          radius={POND_RADIUS}
          shapeSeed={pondShapeSeed}
          reflective={false}
          tintColor={mixHexColors("#2E6E8E", accentColor, 0.25).getStyle()}
        />
        <mesh position={[POND_RADIUS * 0.4, 0.06, POND_RADIUS * 0.25]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.22, 8]} />
          <meshStandardMaterial color="#4F8A3D" flatShading roughness={0.8} />
        </mesh>
      </group>
    );
  }

  return <LandmarkModelShape landmarkKind={landmark.kind ?? "heartTree"} accentColor={accentColor} yawRadians={yawRadians} />;
}

function ForestLandmark({
  landmark,
  pointOfInterest,
  landmarkIndex,
  terrainHeightSampler,
  minimumRadiusFromCenter,
  isSelected,
  isHovered,
  onHoverPlanet,
  onSelectPlanet
}: ForestLandmarkProps) {
  const planetPositionTracker = usePlanetPositionTracker();
  const accentColor = landmark.accentColor ?? "#06B6D4";

  const landmarkPosition = useMemo(() => {
    const angle = landmark.angleRadians ?? 0;
    // The backend picks radiusFromCenter with no knowledge of the lake, and the
    // lake now covers most of the clearing — so a shrine or lantern would stand
    // in open water ("cây đèn ở dưới sông vô lý"). Push outward to the shore.
    const radius = Math.max(landmark.radiusFromCenter ?? 6, minimumRadiusFromCenter);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    return new Vector3(x, terrainHeightSampler(x, z), z);
  }, [landmark.angleRadians, landmark.radiusFromCenter, minimumRadiusFromCenter, terrainHeightSampler]);

  // Landmarks are static: register the camera-focus position once (the same
  // Map CameraRig lerps toward for planets).
  const identityKey = planetIdentityKey(pointOfInterest, landmarkIndex);
  useEffect(() => {
    // Aim the camera slightly above the base so the framing shows the object,
    // not its roots.
    planetPositionTracker.set(identityKey, landmarkPosition.clone().add(new Vector3(0, 1.4, 0)));
    return () => {
      planetPositionTracker.delete(identityKey);
    };
  }, [identityKey, landmarkPosition, planetPositionTracker]);

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
      <LandmarkShape landmark={landmark} />
      {/* Soft accent glow anchors the landmark in the scene at a distance. */}
      {softCircleTexture ? (
        <sprite position={[0, 1.1, 0]} scale={[LANDMARK_GLOW_SCALE, LANDMARK_GLOW_SCALE, 1]}>
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
      {/* Ground ring: faint on hover, solid when selected. */}
      {isHovered || isSelected ? (
        <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
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
        position={[0, 1.1, 0]}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      >
        <sphereGeometry args={[LANDMARK_HIT_SPHERE_RADIUS, 8, 6]} />
      </mesh>
    </group>
  );
}

type ForestLandmarksProps = {
  landmarks?: ForestLandmarkConfig[];
  pointsOfInterest: PlanetSceneConfig[];
  terrainHeightSampler: TerrainHeightSampler;
  minimumRadiusFromCenter: number;
  selectedPlanetKey: string | null;
  hoveredPlanetKey: string | null;
  onHoverPlanet: (pointOfInterest: PlanetSceneConfig | null) => void;
  onSelectPlanet?: (pointOfInterest: PlanetSceneConfig | null) => void;
};

export function ForestLandmarks({
  landmarks,
  pointsOfInterest,
  terrainHeightSampler,
  minimumRadiusFromCenter,
  selectedPlanetKey,
  hoveredPlanetKey,
  onHoverPlanet,
  onSelectPlanet
}: ForestLandmarksProps) {
  return (
    <group>
      {(landmarks ?? []).map((landmark, landmarkIndex) => {
        const pointOfInterest = pointsOfInterest[landmarkIndex];
        if (!pointOfInterest) {
          return null;
        }
        const identityKey = planetIdentityKey(pointOfInterest, landmarkIndex);
        return (
          <ForestLandmark
            key={identityKey}
            landmark={landmark}
            pointOfInterest={pointOfInterest}
            landmarkIndex={landmarkIndex}
            terrainHeightSampler={terrainHeightSampler}
            minimumRadiusFromCenter={minimumRadiusFromCenter}
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

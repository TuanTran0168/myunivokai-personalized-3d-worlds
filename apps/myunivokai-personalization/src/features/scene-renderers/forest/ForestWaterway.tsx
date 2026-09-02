"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, DoubleSide, Vector2, type Texture } from "three";
import type { ForestSeasonConfig, ForestTerrainConfig } from "@/lib/types";
import {
  createRiverShape,
  lakeRadiusFromTerrain,
  lakeShapeSeedFromTerrain,
  mixHexColors,
  riverCenterlineAt,
  riverHalfWidthAt,
  riverLakeExitDistance,
  type TerrainHeightSampler
} from "./forestMath";
import { ForestPondWater, ForestWaterShoreline, getRippleNormalTexture } from "./ForestPondWater";

// The forest's water system: a real lake in the middle of the clearing, with a
// river running through it and out to the hills.
//
// Before this, the only water in a forest was a 1.7-unit decorative pond hung
// off a landmark — the clearing centre read as dry ground, which is the opposite
// of every real forest clearing worth standing in (and of the reference photos:
// a wide still lake holding the treeline's reflection, fed by a stream).
//
// The two halves are deliberately built differently, because they have to be:
//
//  - The LAKE is planar, so it can use MeshReflectorMaterial (a real
//    render-to-texture mirror). It sits at the origin because that is the one
//    part of the terrain guaranteed flat — a reflector on a sloped, curved mesh
//    reflects along the wrong plane and looks broken.
//  - The RIVER follows the rolling terrain, so it CANNOT be a planar mirror.
//    It gets the cheaper treatment instead: environment reflection plus the
//    same scrolling ripple normals, half transparent so the bed shows through.
//    Moving shallow water hides the missing mirror; a still surface would not.

const RIVER_LENGTH_SEGMENTS = 96;
const RIVER_DIRECTION_SIGNS: Array<1 | -1> = [1, -1];
// The mouth tucks slightly under the lake's shore band so the joint has no gap.
const RIVER_LAKE_OVERLAP = 0.4;
// Water sits a hair above the ground it covers rather than being carved into
// the terrain mesh, the same trick the original pond used.
const RIVER_SURFACE_LIFT = 0.05;
const RIVER_BED_LIFT = 0.02;
const RIVER_BED_WIDTH_MARGIN = 0.3;

const RIVER_UV_LENGTH_SCALE = 0.12;
// Matched to the lake's world-sized ripples, so the chop is the same physical
// size in both bodies of water instead of each having its own scale.
const RIVER_NORMAL_REPEAT = 4;
const RIVER_SCROLL_SPEED = new Vector2(0.0, 0.09);
const RIVER_NORMAL_STRENGTH = new Vector2(0.5, 0.5);
const RIVER_OPACITY = 0.86;

// Proportional, not fixed: a constant width that read as a beach on a small pond
// is a hairline once the lake is hero-sized, and a hairline bank is exactly what
// makes water look like a puddle sitting on grass rather than filling a basin.
const LAKE_SHORE_BAND_FRACTION = 0.075;
const MINIMUM_LAKE_SHORE_BAND_WIDTH = 0.55;

// Darker and far less saturated than the first set, which was a swimming-pool
// blue. Water has almost no colour of its own — what you see is the sky and the
// far bank, so a forest lake sits in the dark blue-greens of what surrounds it.
// A vivid blue disc against desaturated woodland is one of the strongest "this
// is fake" signals in the whole scene, and it survived several passes because
// each was judged on the surface rather than on the palette.
const WATER_BASE_COLOR = "#22414C";
// Winter reads as meltwater over pale ice, not as summer teal.
const WATER_COLORS_BY_SEASON_KIND: Record<string, string> = {
  spring: "#26495A",
  summer: "#22414C",
  autumn: "#2B3F44",
  winter: "#5B7683"
};
// Wet earth at the waterline, not the dry olive of a path. A uniform pale rim
// around water reads as the mud ring of a puddle.
const RIVER_BED_COLOR = "#4A4A3E";

type RiverGeometryInput = {
  terrain?: ForestTerrainConfig;
  terrainHeightSampler: TerrainHeightSampler;
  /** Extra half width, used to build the slightly wider bed under the water. */
  widthMargin: number;
  surfaceLift: number;
  /** +1 draws the outflow, -1 the inflow. Each starts at the shoreline. */
  directionSign: 1 | -1;
};

/**
 * A ribbon of quads following the seeded river centreline, draped over the
 * terrain height field. Two vertices per station (left bank, right bank); the
 * perpendicular comes from the local tangent, so the ribbon keeps a constant
 * width through the meanders instead of pinching on the bends.
 */
function buildRiverRibbonGeometry({
  terrain,
  terrainHeightSampler,
  widthMargin,
  surfaceLift,
  directionSign
}: RiverGeometryInput): BufferGeometry {
  const shape = createRiverShape(terrain);
  // Start AT the shoreline, not at the origin. The first version ran the ribbon
  // straight through the middle of the lake, so a light strip with its own banks
  // was drawn on top of the water — "nó bị sông đè lên rồi".
  const lakeExitDistance = riverLakeExitDistance(shape, terrain);
  const startAlong = lakeExitDistance - RIVER_LAKE_OVERLAP;
  const endAlong = Math.max(startAlong + 1, shape.spanRadius);
  const stationCount = RIVER_LENGTH_SEGMENTS + 1;
  const positions = new Float32Array(stationCount * 2 * 3);
  const uvs = new Float32Array(stationCount * 2 * 2);
  const indices: number[] = [];

  let travelledDistance = 0;
  let previousCenter: { x: number; z: number } | null = null;

  for (let stationIndex = 0; stationIndex < stationCount; stationIndex += 1) {
    const along =
      directionSign * (startAlong + (stationIndex / RIVER_LENGTH_SEGMENTS) * (endAlong - startAlong));
    const center = riverCenterlineAt(shape, along);
    // Central difference for the tangent; one-sided at the two ends.
    const tangentStep = (endAlong - startAlong) / RIVER_LENGTH_SEGMENTS;
    const ahead = riverCenterlineAt(shape, along + tangentStep);
    const behind = riverCenterlineAt(shape, along - tangentStep);
    const tangentX = ahead.x - behind.x;
    const tangentZ = ahead.z - behind.z;
    const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
    const normalX = -tangentZ / tangentLength;
    const normalZ = tangentX / tangentLength;

    const halfWidth = riverHalfWidthAt(along, lakeExitDistance) + widthMargin;
    if (previousCenter) {
      travelledDistance += Math.hypot(center.x - previousCenter.x, center.z - previousCenter.z);
    }
    previousCenter = center;

    for (let side = 0; side < 2; side += 1) {
      const sideSign = side === 0 ? -1 : 1;
      const x = center.x + normalX * halfWidth * sideSign;
      const z = center.z + normalZ * halfWidth * sideSign;
      const vertexIndex = stationIndex * 2 + side;
      positions[vertexIndex * 3] = x;
      positions[vertexIndex * 3 + 1] = terrainHeightSampler(x, z) + surfaceLift;
      positions[vertexIndex * 3 + 2] = z;
      // v runs along the flow so the ripple normals scroll downstream; u runs
      // bank to bank so they do not stretch when the channel flares.
      uvs[vertexIndex * 2] = side;
      uvs[vertexIndex * 2 + 1] = travelledDistance * RIVER_UV_LENGTH_SCALE;
    }

    if (stationIndex > 0) {
      const base = (stationIndex - 1) * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

type ForestWaterwayProps = {
  terrain?: ForestTerrainConfig;
  season?: ForestSeasonConfig;
  terrainHeightSampler: TerrainHeightSampler;
};

export function ForestWaterway({ terrain, season, terrainHeightSampler }: ForestWaterwayProps) {
  const lakeRadius = lakeRadiusFromTerrain(terrain);
  const lakeShapeSeed = lakeShapeSeedFromTerrain(terrain);
  const waterColor = WATER_COLORS_BY_SEASON_KIND[season?.kind ?? "spring"] ?? WATER_BASE_COLOR;

  // Outflow and inflow are separate meshes so neither has to span the lake.
  const riverGeometries = useMemo(
    () =>
      RIVER_DIRECTION_SIGNS.map((directionSign) =>
        buildRiverRibbonGeometry({
          terrain,
          terrainHeightSampler,
          widthMargin: 0,
          surfaceLift: RIVER_SURFACE_LIFT,
          directionSign
        })
      ),
    [terrain, terrainHeightSampler]
  );
  const riverBedGeometries = useMemo(
    () =>
      RIVER_DIRECTION_SIGNS.map((directionSign) =>
        buildRiverRibbonGeometry({
          terrain,
          terrainHeightSampler,
          widthMargin: RIVER_BED_WIDTH_MARGIN,
          surfaceLift: RIVER_BED_LIFT,
          directionSign
        })
      ),
    [terrain, terrainHeightSampler]
  );

  // Its own clone of the shared ripple image, so the river can scroll
  // downstream while the lake ripples on its own schedule.
  const riverRippleTexture = useMemo(() => {
    const clone = getRippleNormalTexture().clone();
    clone.repeat.set(RIVER_NORMAL_REPEAT, RIVER_NORMAL_REPEAT);
    clone.needsUpdate = true;
    return clone;
  }, []);
  const elapsedSecondsRef = useRef(0);

  useFrame((_, deltaTimeSeconds) => {
    elapsedSecondsRef.current += deltaTimeSeconds;
    riverRippleTexture.offset.set(
      elapsedSecondsRef.current * RIVER_SCROLL_SPEED.x,
      -elapsedSecondsRef.current * RIVER_SCROLL_SPEED.y
    );
  });

  return (
    <group>
      {/* Bed first: a wider, matte strip under the water so the channel has a
          visible bank instead of a water ribbon floating on grass. */}
      {riverBedGeometries.map((geometry, geometryIndex) => (
        <mesh key={`bed-${geometryIndex}`} geometry={geometry} receiveShadow>
          <meshStandardMaterial color={RIVER_BED_COLOR} roughness={1} side={DoubleSide} />
        </mesh>
      ))}
      {riverGeometries.map((geometry, geometryIndex) => (
        <mesh key={`water-${geometryIndex}`} geometry={geometry}>
          <meshStandardMaterial
            color={waterColor}
            transparent
            opacity={RIVER_OPACITY}
            roughness={0.14}
            metalness={0.35}
            envMapIntensity={1.6}
            side={DoubleSide}
            normalMap={riverRippleTexture as unknown as Texture}
            normalScale={RIVER_NORMAL_STRENGTH}
          />
        </mesh>
      ))}

      {/* Shoreline, then the mirror surface on top of it. Both follow the SAME
          seeded outline, so the bank stays a constant width all the way round a
          shore that is never a clean arc. */}
      <ForestWaterShoreline
        radius={lakeRadius}
        shapeSeed={lakeShapeSeed}
        bandWidth={Math.max(MINIMUM_LAKE_SHORE_BAND_WIDTH, lakeRadius * LAKE_SHORE_BAND_FRACTION)}
        color={RIVER_BED_COLOR}
        height={RIVER_BED_LIFT}
      />
      <ForestPondWater
        radius={lakeRadius}
        shapeSeed={lakeShapeSeed}
        tintColor={mixHexColors(waterColor, "#0B2733", 0.15).getStyle()}
      />
    </group>
  );
}

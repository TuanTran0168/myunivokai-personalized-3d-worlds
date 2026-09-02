"use client";

import { Html } from "@react-three/drei";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, DoubleSide, RingGeometry, TextureLoader, Vector3 } from "three";
import type { Group, Mesh } from "three";
import type { PlanetSceneConfig } from "@/lib/types";
import { usePlanetPositionTracker } from "../shared/PlanetPositionTracker";
import { applyColorTextureQuality, applyDataTextureQuality } from "../shared/textureQuality";
import { buildGasGiantRecipe } from "./gasGiantRecipe";
import { getGasGiantSurfaceTexture } from "./gasGiantTexture";
import { buildPlanetRingRecipe } from "./planetRingRecipe";
import { getPlanetRingTexture } from "./planetRingTexture";
import { planetTextureEntryForIndex } from "./planetTextureCatalog";
import { ProceduralMoons } from "./ProceduralMoons";

const DEFAULT_PLANET_SIZE = 0.6;
const PLANET_SIZE_MULTIPLIER = 0.78;
const DEFAULT_PLANET_ORBIT_SPEED = 0.12;
const FIRST_PLANET_ORBIT_RADIUS = 3.2;
const ORBIT_RADIUS_STEP_PER_PLANET = 1.05;
const PLANET_SELF_ROTATION_SPEED = 0.3;
const HIGHLIGHT_GLOW_SCALE_MULTIPLIER = 1.35;
const HIGHLIGHT_GLOW_OPACITY = 0.4;
const RING_INNER_RADIUS_MULTIPLIER = 1.35;
const RING_OUTER_RADIUS_MULTIPLIER = 2.2;
const RING_OPACITY = 0.85;
const PLANET_LABEL_VERTICAL_OFFSET = 0.55;
const PLANET_LABEL_DISTANCE_FACTOR = 9;
const DEFAULT_HIGHLIGHT_COLOR = "#8B5CF6";
// The DNA color feeds hex PARSERS (gas giant recipe, ring recipe, tint
// blending), not just three.js color props — anything that isn't exactly
// #RRGGBB would parse to NaN channels and bake black surfaces, so other CSS
// color forms fall back to the default instead.
const SIX_DIGIT_HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
// High enough that the silhouette stays round when the camera flies in close.
const PLANET_SPHERE_WIDTH_SEGMENTS = 96;
const PLANET_SPHERE_HEIGHT_SEGMENTS = 64;
const RING_THETA_SEGMENTS = 128;
// Earth-like extras: the night-lights map glows through the emissive channel
// (the map is black outside cities, so the day side barely notices), and the
// cloud layer sits on a slightly larger shell drifting past the surface.
const NIGHT_LIGHTS_EMISSIVE_INTENSITY = 0.75;
const CLOUD_SHELL_RADIUS_MULTIPLIER = 1.02;
const CLOUD_SHELL_OPACITY = 0.85;
const CLOUD_ROTATION_SPEED_MULTIPLIER = 1.35;
const DEFAULT_SURFACE_ROUGHNESS = 0.92;
// Gas giants are cloud tops: fully diffuse, no terrain or city maps apply.
const GAS_GIANT_SURFACE_ROUGHNESS = 1;
// Fiction-role surfaces are tinted by multiplying material.color with the
// planet's DNA color washed toward white. Kept subtle: at stronger tints the
// dwarf maps read as chalky color-cast balls instead of photographed rock.
const PALETTE_TINT_WHITE_BLEND_FRACTION = 0.72;
const NEUTRAL_TINT_COLOR = "#FFFFFF";

function blendHexColorTowardWhite(hexColor: string, whiteFraction: number): string {
  const normalized = hexColor.replace("#", "");
  const blendedChannels = [0, 2, 4].map((hexOffset) => {
    const channel = parseInt(normalized.slice(hexOffset, hexOffset + 2), 16);
    return Math.round(channel + (255 - channel) * whiteFraction);
  });
  return `#${blendedChannels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/**
 * RingGeometry's stock UVs are PLANAR (a flat projection of the disc), but the
 * Saturn ring texture is a RADIAL strip: one row of pixels meant to sweep from
 * the inner to the outer edge. Remapping U to the radial fraction makes the
 * strip actually draw the ring bands.
 */
function buildRadialRingGeometry(innerRadius: number, outerRadius: number): RingGeometry {
  const geometry = new RingGeometry(innerRadius, outerRadius, RING_THETA_SEGMENTS);
  const positionAttribute = geometry.attributes.position;
  const uvAttribute = geometry.attributes.uv;
  for (let vertexIndex = 0; vertexIndex < positionAttribute.count; vertexIndex += 1) {
    const x = positionAttribute.getX(vertexIndex);
    const y = positionAttribute.getY(vertexIndex);
    const radialFraction = (Math.hypot(x, y) - innerRadius) / (outerRadius - innerRadius);
    uvAttribute.setXY(vertexIndex, radialFraction, 0.5);
  }
  uvAttribute.needsUpdate = true;
  return geometry;
}

export function defaultPhaseForPlanet(planetIndex: number, planetCount: number): number {
  if (planetCount <= 0) {
    return 0;
  }
  return (planetIndex / planetCount) * Math.PI * 2;
}

export function orbitRadiusForPlanet(planet: PlanetSceneConfig, planetIndex: number): number {
  return planet.orbitRadius ?? FIRST_PLANET_ORBIT_RADIUS + planetIndex * ORBIT_RADIUS_STEP_PER_PLANET;
}

export function renderedPlanetSize(planet: PlanetSceneConfig): number {
  return (planet.size ?? DEFAULT_PLANET_SIZE) * PLANET_SIZE_MULTIPLIER;
}

type SolarPlanetProps = {
  planet: PlanetSceneConfig;
  planetIndex: number;
  planetCount: number;
  identityKey: string;
  isSelected: boolean;
  isHovered: boolean;
  showLabel: boolean;
  /**
   * Index into PLANET_TEXTURE_CATALOG from the world's seeded assignment
   * (see buildPlanetTextureAssignment). Falls back to catalog order by
   * planet index when absent.
   */
  textureCatalogIndex?: number;
  /**
   * When set, this planet trades its photo texture for a seed-baked banded
   * gas-giant surface (see gasGiantRecipe.ts). Null keeps the catalog look.
   */
  proceduralGasGiantSeed?: string | null;
  /**
   * When set, this planet grows a seeded moon system (see moonRecipe.ts).
   * The recipe itself may still roll zero moons.
   */
  moonSystemSeed?: string | null;
  /**
   * When set, this planet wears a seed-baked radial ring (see
   * planetRingRecipe.ts). The renderer never sets this on planets that
   * already carry the catalog photo ring.
   */
  proceduralRingSeed?: string | null;
  onHoverChange: (planet: PlanetSceneConfig | null) => void;
  onSelect?: (planet: PlanetSceneConfig | null) => void;
};

/**
 * One personality planet rendered with a real solar-system surface texture.
 * Orbits the sun in its (possibly inclined) parent group, spins on a tilted
 * axis, and reports its world position so the CameraRig can fly to it.
 */
export function SolarPlanet({
  planet,
  planetIndex,
  planetCount,
  identityKey,
  isSelected,
  isHovered,
  showLabel,
  textureCatalogIndex,
  proceduralGasGiantSeed,
  moonSystemSeed,
  proceduralRingSeed,
  onHoverChange,
  onSelect
}: SolarPlanetProps) {
  const orbitAnchorReference = useRef<Group>(null);
  const planetMeshReference = useRef<Mesh>(null);
  const cloudShellReference = useRef<Mesh>(null);
  const planetPositionTracker = usePlanetPositionTracker();
  const trackedWorldPosition = useMemo(() => new Vector3(), []);

  const gl = useThree((state) => state.gl);
  const textureEntry = planetTextureEntryForIndex(textureCatalogIndex ?? planetIndex);
  // Optional maps fall back to the surface URL (hooks must run unconditionally);
  // the fallback loads from cache and is simply not passed to the material.
  const surfaceTexture = useLoader(TextureLoader, textureEntry.textureUrl);
  const ringTexture = useLoader(TextureLoader, textureEntry.ringTextureUrl ?? textureEntry.textureUrl);
  const nightLightsTexture = useLoader(TextureLoader, textureEntry.nightLightsTextureUrl ?? textureEntry.textureUrl);
  const cloudsTexture = useLoader(TextureLoader, textureEntry.cloudsTextureUrl ?? textureEntry.textureUrl);
  const normalMapTexture = useLoader(TextureLoader, textureEntry.normalMapTextureUrl ?? textureEntry.textureUrl);
  const roughnessMapTexture = useLoader(TextureLoader, textureEntry.roughnessMapTextureUrl ?? textureEntry.textureUrl);
  useMemo(() => {
    applyColorTextureQuality(surfaceTexture, gl);
    applyColorTextureQuality(ringTexture, gl);
    if (textureEntry.nightLightsTextureUrl) {
      applyColorTextureQuality(nightLightsTexture, gl);
    }
    if (textureEntry.cloudsTextureUrl) {
      applyDataTextureQuality(cloudsTexture, gl);
    }
    if (textureEntry.normalMapTextureUrl) {
      applyDataTextureQuality(normalMapTexture, gl);
    }
    if (textureEntry.roughnessMapTextureUrl) {
      applyDataTextureQuality(roughnessMapTexture, gl);
    }
  }, [surfaceTexture, ringTexture, nightLightsTexture, cloudsTexture, normalMapTexture, roughnessMapTexture, textureEntry, gl]);

  const highlightColor =
    planet.color && SIX_DIGIT_HEX_COLOR_PATTERN.test(planet.color) ? planet.color : DEFAULT_HIGHLIGHT_COLOR;

  // Seed-baked banded surface; the bake is cached by seed so this only pays
  // once per (world, planet). Null on the server or when the role is not set.
  const proceduralSurfaceTexture = useMemo(() => {
    if (!proceduralGasGiantSeed) {
      return null;
    }
    const gasGiantRecipe = buildGasGiantRecipe(proceduralGasGiantSeed, highlightColor);
    return getGasGiantSurfaceTexture(`${proceduralGasGiantSeed}|${highlightColor}`, gasGiantRecipe);
  }, [proceduralGasGiantSeed, highlightColor]);
  useMemo(() => {
    if (proceduralSurfaceTexture) {
      applyColorTextureQuality(proceduralSurfaceTexture, gl);
    }
  }, [proceduralSurfaceTexture, gl]);
  const isProceduralGasGiant = Boolean(proceduralSurfaceTexture);

  // Seed-baked radial ring strip, cached like the gas giant surface. Null on
  // the server or when the role is not assigned.
  const proceduralRingRecipe = useMemo(
    () => (proceduralRingSeed ? buildPlanetRingRecipe(proceduralRingSeed, highlightColor) : null),
    [proceduralRingSeed, highlightColor]
  );
  const proceduralRingTexture = useMemo(
    () =>
      proceduralRingSeed && proceduralRingRecipe
        ? getPlanetRingTexture(`${proceduralRingSeed}|${highlightColor}`, proceduralRingRecipe)
        : null,
    [proceduralRingSeed, proceduralRingRecipe, highlightColor]
  );
  useMemo(() => {
    if (proceduralRingTexture) {
      applyColorTextureQuality(proceduralRingTexture, gl);
    }
  }, [proceduralRingTexture, gl]);

  const orbitRadius = orbitRadiusForPlanet(planet, planetIndex);
  const orbitSpeed = planet.orbitSpeed ?? DEFAULT_PLANET_ORBIT_SPEED;
  const orbitPhase = planet.phase ?? defaultPhaseForPlanet(planetIndex, planetCount);
  const planetSize = renderedPlanetSize(planet);
  const isHighlighted = isHovered || isSelected;
  const hasRing = Boolean(textureEntry.ringTextureUrl);
  // The photo ring (Saturn role) always wins; the renderer never assigns both,
  // this re-check is local belt-and-suspenders.
  const hasProceduralRing = !hasRing && Boolean(proceduralRingTexture);

  const ringGeometry = useMemo(
    () =>
      hasRing
        ? buildRadialRingGeometry(planetSize * RING_INNER_RADIUS_MULTIPLIER, planetSize * RING_OUTER_RADIUS_MULTIPLIER)
        : null,
    [hasRing, planetSize]
  );
  useEffect(() => {
    // Geometry passed as a prop (not JSX-created) is not auto-disposed by R3F.
    return () => {
      ringGeometry?.dispose();
    };
  }, [ringGeometry]);

  const proceduralRingGeometry = useMemo(
    () =>
      hasProceduralRing && proceduralRingRecipe
        ? buildRadialRingGeometry(
            planetSize * proceduralRingRecipe.innerRadiusMultiplier,
            planetSize * proceduralRingRecipe.outerRadiusMultiplier
          )
        : null,
    [hasProceduralRing, proceduralRingRecipe, planetSize]
  );
  useEffect(() => {
    return () => {
      proceduralRingGeometry?.dispose();
    };
  }, [proceduralRingGeometry]);

  useEffect(() => {
    planetPositionTracker.set(identityKey, trackedWorldPosition);
    return () => {
      planetPositionTracker.delete(identityKey);
    };
  }, [identityKey, planetPositionTracker, trackedWorldPosition]);

  useFrame(({ clock }, deltaTimeSeconds) => {
    const orbitAnchor = orbitAnchorReference.current;
    if (!orbitAnchor) {
      return;
    }
    const orbitAngle = orbitPhase + clock.elapsedTime * orbitSpeed;
    orbitAnchor.position.set(Math.cos(orbitAngle) * orbitRadius, 0, Math.sin(orbitAngle) * orbitRadius);
    orbitAnchor.getWorldPosition(trackedWorldPosition);

    if (planetMeshReference.current) {
      planetMeshReference.current.rotation.y += PLANET_SELF_ROTATION_SPEED * deltaTimeSeconds;
    }
    if (cloudShellReference.current) {
      cloudShellReference.current.rotation.y +=
        PLANET_SELF_ROTATION_SPEED * CLOUD_ROTATION_SPEED_MULTIPLIER * deltaTimeSeconds;
    }
  });

  // A procedural gas giant is all atmosphere: the catalog's terrain-specific
  // extras (city lights, terrain normals, ocean gloss, cloud shell) would
  // contradict the banded surface, so they switch off together. The photo
  // ring (Saturn role) stays — rings suit any giant.
  const hasNightLights = Boolean(textureEntry.nightLightsTextureUrl) && !isProceduralGasGiant;
  const hasRoughnessMap = Boolean(textureEntry.roughnessMapTextureUrl) && !isProceduralGasGiant;
  const hasNormalMap = Boolean(textureEntry.normalMapTextureUrl) && !isProceduralGasGiant;
  const hasCloudShell = Boolean(textureEntry.cloudsTextureUrl) && !isProceduralGasGiant;
  // A procedural gas giant already derives its bands from the DNA color, so
  // the extra tint only applies to the photo texture path.
  const surfaceTintColor =
    textureEntry.allowsPaletteTint && !isProceduralGasGiant
      ? blendHexColorTowardWhite(highlightColor, PALETTE_TINT_WHITE_BLEND_FRACTION)
      : NEUTRAL_TINT_COLOR;

  return (
    <group ref={orbitAnchorReference}>
      <group rotation={[0, 0, textureEntry.axialTiltRadians]}>
        <mesh
          ref={planetMeshReference}
          onPointerOver={(event) => {
            event.stopPropagation();
            onHoverChange(planet);
          }}
          onPointerOut={(event) => {
            event.stopPropagation();
            onHoverChange(null);
          }}
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.(planet);
          }}
        >
          <sphereGeometry args={[planetSize, PLANET_SPHERE_WIDTH_SEGMENTS, PLANET_SPHERE_HEIGHT_SEGMENTS]} />
          <meshStandardMaterial
            map={proceduralSurfaceTexture ?? surfaceTexture}
            color={surfaceTintColor}
            normalMap={hasNormalMap ? normalMapTexture : undefined}
            roughnessMap={hasRoughnessMap ? roughnessMapTexture : undefined}
            roughness={
              isProceduralGasGiant ? GAS_GIANT_SURFACE_ROUGHNESS : hasRoughnessMap ? 1 : DEFAULT_SURFACE_ROUGHNESS
            }
            metalness={0}
            emissive={hasNightLights ? "#FFFFFF" : "#000000"}
            emissiveMap={hasNightLights ? nightLightsTexture : undefined}
            emissiveIntensity={hasNightLights ? NIGHT_LIGHTS_EMISSIVE_INTENSITY : 0}
          />
        </mesh>
        {hasCloudShell ? (
          <mesh ref={cloudShellReference}>
            <sphereGeometry
              args={[
                planetSize * CLOUD_SHELL_RADIUS_MULTIPLIER,
                PLANET_SPHERE_WIDTH_SEGMENTS,
                PLANET_SPHERE_HEIGHT_SEGMENTS
              ]}
            />
            <meshStandardMaterial
              color="#FFFFFF"
              alphaMap={cloudsTexture}
              transparent
              opacity={CLOUD_SHELL_OPACITY}
              depthWrite={false}
              roughness={1}
              metalness={0}
            />
          </mesh>
        ) : null}
        {hasRing && ringGeometry ? (
          <mesh rotation={[-Math.PI / 2, 0, 0]} geometry={ringGeometry}>
            <meshBasicMaterial map={ringTexture} transparent opacity={RING_OPACITY} side={DoubleSide} />
          </mesh>
        ) : null}
        {hasProceduralRing && proceduralRingGeometry && proceduralRingRecipe ? (
          <mesh rotation={[-Math.PI / 2, 0, 0]} geometry={proceduralRingGeometry} raycast={() => null}>
            <meshBasicMaterial
              map={proceduralRingTexture}
              transparent
              opacity={proceduralRingRecipe.opacity}
              side={DoubleSide}
            />
          </mesh>
        ) : null}
        {moonSystemSeed ? (
          <ProceduralMoons
            moonSystemSeed={moonSystemSeed}
            planetRenderedSize={planetSize}
            parentRingOuterRadiusMultiplier={
              hasRing
                ? RING_OUTER_RADIUS_MULTIPLIER
                : hasProceduralRing && proceduralRingRecipe
                  ? proceduralRingRecipe.outerRadiusMultiplier
                  : null
            }
          />
        ) : null}
      </group>
      {isHighlighted ? (
        <mesh scale={planetSize * HIGHLIGHT_GLOW_SCALE_MULTIPLIER}>
          <sphereGeometry args={[1, 24, 16]} />
          <meshBasicMaterial
            color={highlightColor}
            transparent
            opacity={HIGHLIGHT_GLOW_OPACITY}
            blending={AdditiveBlending}
            depthWrite={false}
            fog={false}
          />
        </mesh>
      ) : null}
      {showLabel ? (
        <Html
          center
          position={[0, planetSize + PLANET_LABEL_VERTICAL_OFFSET, 0]}
          distanceFactor={PLANET_LABEL_DISTANCE_FACTOR}
          className="pointer-events-none select-none"
        >
          <span
            className={`whitespace-nowrap font-mono text-[11px] uppercase tracking-widest ${
              isHighlighted ? "text-white" : "text-white/65"
            }`}
          >
            {planet.name ?? identityKey}
          </span>
        </Html>
      ) : null}
    </group>
  );
}

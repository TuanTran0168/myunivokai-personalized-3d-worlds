"use client";

import { Suspense, useMemo } from "react";
import { randomFromSeed } from "@/lib/scene";
import { backgroundColorFromScene, planetsFromScene, paletteFromScene } from "@/lib/scene";
import type { PlanetSceneConfig } from "@/lib/types";
import { planetIdentityKey } from "../planetIdentity";
import type { SceneRendererProps } from "../types";
import { StarParticleField } from "../shared/StarParticleField";
import { AsteroidBelt } from "./AsteroidBelt";
import { BinarySun } from "./BinarySun";
import { Comet, resolveCometsConfig } from "./Comet";
import { DistantBlackHole } from "./DistantBlackHole";
import { MeteorShower } from "./MeteorShower";
import { hasRareFeature, resolveRareFeatures } from "./rareFeatures";
import { ConstellationField } from "./ConstellationField";
import { MilkyWayBand } from "./MilkyWayBand";
import { OrbitPath } from "./OrbitPath";
import { OrbitingSpacecraft } from "./OrbitingSpacecraft";
import { SpaceEnvironment } from "./SpaceEnvironment";
import { Skybox } from "./Skybox";
import { buildPlanetTextureAssignment, planetTextureEntryForIndex } from "./planetTextureCatalog";
import { SolarPlanet, orbitRadiusForPlanet, renderedPlanetSize } from "./SolarPlanet";
import { Sun } from "./Sun";

const AMBIENT_LIGHT_INTENSITY = 0.18;
// Key/fill/rim rig: the sun's point light is the key; a hemisphere fill
// (palette-tinted "space bounce") lifts planet night sides out of pure black;
// a cool rim directional from behind-above separates silhouettes from the
// sky. Analytic lights are effectively free.
const HEMISPHERE_FILL_INTENSITY = 0.14;
const RIM_LIGHT_INTENSITY = 0.35;
const RIM_LIGHT_POSITION: [number, number, number] = [-14, 10, -16];
// Very light exponential depth haze tinted to the mood background — distant
// orbits recede instead of floating in void. Sky layers are fog-exempt.
const DEPTH_FOG_DENSITY = 0.012;
// Headroom for orbital tilt. Kept high so the world-style contrast below is
// clearly visible (a steeply scattered nebula vs flat, precise cyber rings),
// not a few near-identical degrees.
const MAXIMUM_ORBIT_INCLINATION_RADIANS = 0.42;

// The world style gives each scene a distinct orbital character: flat ordered
// rings vs steeply scattered, tilted orbits. This applies to both the live
// preview and the generated world (both carry theme = the chosen style), so the
// style choice is visible without overriding the user's color palette. The
// spread is deliberately wide so switching styles is obvious at a glance.
const THEME_ORBIT_INCLINATION_MULTIPLIERS: Record<string, number> = {
  "cosmic-galaxy": 0.8, // gentle galactic tilt
  nebula: 2, // chaotic, steeply scattered planes
  crystal: 0.12, // near-flat, ordered lattice
  aurora: 1.3, // flowing, clearly tilted
  "cyber-orbit": 0.05 // flat, precise concentric rings
};
const DEFAULT_ORBIT_INCLINATION_MULTIPLIER = 0.8;

function orbitInclinationMultiplierForTheme(theme?: string): number {
  if (theme && theme in THEME_ORBIT_INCLINATION_MULTIPLIERS) {
    return THEME_ORBIT_INCLINATION_MULTIPLIERS[theme];
  }
  return DEFAULT_ORBIT_INCLINATION_MULTIPLIER;
}

function buildOrbitInclinations(seed: string, planetCount: number, inclinationMultiplier: number): number[] {
  const random = randomFromSeed(`${seed}-orbit-inclinations`);
  return Array.from(
    { length: planetCount },
    () => (random() * 2 - 1) * MAXIMUM_ORBIT_INCLINATION_RADIANS * inclinationMultiplier
  );
}

// Procedural gas giants: planets big enough to read as giants get a seeded
// chance to trade their shared photo texture for a one-of-a-kind banded
// surface baked from this world's seed (see gasGiantRecipe.ts). Rendered
// sizes span ~0.35-0.98, so the threshold selects roughly the upper half.
const GAS_GIANT_MINIMUM_RENDERED_PLANET_SIZE = 0.58;
const GAS_GIANT_ASSIGNMENT_PROBABILITY = 0.5;
// Procedural moons: any planet big enough to read as a major planet grows a
// seeded moon system (the recipe itself may still roll zero moons). The
// threshold sits below the gas giant one, so mid-size rocky planets qualify.
const MOON_ELIGIBLE_MINIMUM_RENDERED_PLANET_SIZE = 0.5;
// Seeded procedural rings: any planet may roll one, EXCEPT the Saturn role,
// which already wears the catalog photo ring.
const PROCEDURAL_RING_ASSIGNMENT_PROBABILITY = 0.22;

type PlanetRoleAssignment = {
  textureCatalogIndex: number;
  proceduralGasGiantSeed: string | null;
  moonSystemSeed: string | null;
  proceduralRingSeed: string | null;
};

/**
 * All seeded per-planet roles resolved in one pass, so the role rules — and
 * their interactions, like a procedural ring never landing on the photo-ring
 * Saturn role — live in one place and SolarPlanet can never receive a
 * mismatched combination. Each role draws from its own per-planet-index PRNG
 * stream: adding/removing planets or future features never shifts another
 * planet's roll.
 */
function buildPlanetRoleAssignments(seed: string, planets: PlanetSceneConfig[]): PlanetRoleAssignment[] {
  const planetTextureAssignment = buildPlanetTextureAssignment(seed, planets.length);
  return planets.map((planet, planetIndex) => {
    const planetSize = renderedPlanetSize(planet);
    const textureCatalogIndex = planetTextureAssignment[planetIndex];

    let proceduralGasGiantSeed: string | null = null;
    if (planetSize >= GAS_GIANT_MINIMUM_RENDERED_PLANET_SIZE) {
      const gasGiantRandom = randomFromSeed(`${seed}-gas-giant-role-${planetIndex}`);
      if (gasGiantRandom() < GAS_GIANT_ASSIGNMENT_PROBABILITY) {
        proceduralGasGiantSeed = `${seed}-gas-giant-${planetIndex}`;
      }
    }

    const moonSystemSeed =
      planetSize >= MOON_ELIGIBLE_MINIMUM_RENDERED_PLANET_SIZE ? `${seed}-moons-${planetIndex}` : null;

    let proceduralRingSeed: string | null = null;
    const textureEntry = planetTextureEntryForIndex(textureCatalogIndex);
    if (!textureEntry.ringTextureUrl && !textureEntry.excludeFromProceduralRing) {
      const ringRandom = randomFromSeed(`${seed}-procedural-ring-${planetIndex}`);
      if (ringRandom() < PROCEDURAL_RING_ASSIGNMENT_PROBABILITY) {
        proceduralRingSeed = `${seed}-procedural-ring-${planetIndex}`;
      }
    }

    return { textureCatalogIndex, proceduralGasGiantSeed, moonSystemSeed, proceduralRingSeed };
  });
}

/**
 * Solar-system style scene: a glowing textured sun in the center, personality
 * planets with real planetary surface textures on slightly inclined orbits, a
 * milky-way skybox and a seeded star particle field.
 */
export function SolarSystemRenderer({
  scene,
  seed,
  selectedPlanetKey,
  hoveredPlanetKey,
  onHoverPlanet,
  onSelectPlanet
}: SceneRendererProps) {
  const palette = paletteFromScene(scene);
  // planetsFromScene filters a fresh array on every call; memoize so the
  // seeded role assignment below is not rebuilt on every hover/selection
  // re-render.
  const planets = useMemo(() => planetsFromScene(scene), [scene]);
  const backgroundColor = backgroundColorFromScene(scene);
  const showPlanetLabels = scene.hud?.showLabels !== false;

  const orbitInclinationMultiplier = orbitInclinationMultiplierForTheme(scene.theme);
  const orbitInclinations = useMemo(
    () => buildOrbitInclinations(seed, planets.length, orbitInclinationMultiplier),
    [seed, planets.length, orbitInclinationMultiplier]
  );
  const planetRoleAssignments = useMemo(() => buildPlanetRoleAssignments(seed, planets), [seed, planets]);
  const rareFeatures = useMemo(() => resolveRareFeatures(seed), [seed]);
  const cometsConfig = resolveCometsConfig(scene.comets);

  return (
    <>
      <fogExp2 attach="fog" args={[backgroundColor, DEPTH_FOG_DENSITY]} />
      <ambientLight intensity={AMBIENT_LIGHT_INTENSITY} />
      <hemisphereLight args={[palette[1], backgroundColor, HEMISPHERE_FILL_INTENSITY]} />
      <directionalLight position={RIM_LIGHT_POSITION} color={palette[2] ?? palette[1]} intensity={RIM_LIGHT_INTENSITY} />
      <Skybox />
      <MilkyWayBand sky={scene.sky?.milkyWay} />
      <ConstellationField seed={seed} scene={scene} />
      <StarParticleField scene={scene} seed={seed} fallbackColor={palette[1]} />
      {hasRareFeature(rareFeatures, "meteor-shower") ? <MeteorShower seed={seed} tailColorHex={palette[1]} /> : null}
      <AsteroidBelt scene={scene} seed={seed} />
      {/* Comet population from the stored 1.2 section; pre-1.2 worlds resolve
          to the single legacy comet. */}
      {Array.from({ length: cometsConfig.count }, (_, cometIndex) => (
        <Comet
          // eslint-disable-next-line react/no-array-index-key -- the index IS the comet's identity (it picks the PRNG stream)
          key={`${seed}-comet-${cometIndex}`}
          scene={scene}
          seed={seed}
          cometIndex={cometIndex}
          tailLengthMultiplier={cometsConfig.tailLengthMultiplier}
        />
      ))}
      <SpaceEnvironment />
      {/* Load in its own boundary so the world never waits for the satellite. */}
      <Suspense fallback={null}>
        <OrbitingSpacecraft scene={scene} seed={seed} />
      </Suspense>
      {/* Rare distant black hole: its own boundary so only the ~20% of worlds
          that roll it ever pay the download. */}
      {hasRareFeature(rareFeatures, "black-hole") ? (
        <Suspense fallback={null}>
          <DistantBlackHole seed={seed} camera={scene.camera} />
        </Suspense>
      ) : null}
      <Sun coreConfig={scene.core} sun={scene.sun} />
      {hasRareFeature(rareFeatures, "binary-sun") ? <BinarySun seed={seed} coreConfig={scene.core} /> : null}
      {planets.map((planet, planetIndex) => {
        const identityKey = planetIdentityKey(planet, planetIndex);
        const isSelected = identityKey === selectedPlanetKey;
        const isHovered = identityKey === hoveredPlanetKey;
        const orbitInclination = orbitInclinations[planetIndex] ?? 0;
        const planetRoleAssignment = planetRoleAssignments[planetIndex];
        return (
          <group key={identityKey} rotation={[orbitInclination, 0, orbitInclination * 0.6]}>
            <OrbitPath
              radius={orbitRadiusForPlanet(planet, planetIndex)}
              color={planet.color ?? palette[planetIndex % palette.length]}
              isHighlighted={isSelected || isHovered}
            />
            <SolarPlanet
              planet={planet}
              planetIndex={planetIndex}
              planetCount={planets.length}
              identityKey={identityKey}
              isSelected={isSelected}
              isHovered={isHovered}
              showLabel={showPlanetLabels}
              textureCatalogIndex={planetRoleAssignment.textureCatalogIndex}
              proceduralGasGiantSeed={planetRoleAssignment.proceduralGasGiantSeed}
              moonSystemSeed={planetRoleAssignment.moonSystemSeed}
              proceduralRingSeed={planetRoleAssignment.proceduralRingSeed}
              onHoverChange={onHoverPlanet}
              onSelect={onSelectPlanet}
            />
          </group>
        );
      })}
    </>
  );
}

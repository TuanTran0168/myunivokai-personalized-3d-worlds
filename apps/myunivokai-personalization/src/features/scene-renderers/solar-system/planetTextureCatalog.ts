import { randomFromSeed } from "@/lib/scene";

const SOLAR_SYSTEM_TEXTURE_BASE_PATH = "/textures/solar-system";

export const SUN_TEXTURE_URL = `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/8k_sun.jpg`;
export const MILKY_WAY_SKYBOX_TEXTURE_URL = `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/8k_stars_milky_way.jpg`;

export type PlanetTextureCatalogEntry = {
  planetStyleName: string;
  textureUrl: string;
  ringTextureUrl?: string;
  /** City lights on the night side, applied as an emissive map. */
  nightLightsTextureUrl?: string;
  /** Cloud layer drawn on a slightly larger shell rotating at its own speed. */
  cloudsTextureUrl?: string;
  normalMapTextureUrl?: string;
  /** Inverted water mask: oceans render glossy, land stays matte. */
  roughnessMapTextureUrl?: string;
  /**
   * Fiction-role surfaces (artistic dwarf-planet maps) may be tinted toward
   * the planet's DNA color at render time. Recognizable planets (Earth,
   * Jupiter, the Moon...) never carry this flag — tinting them would break
   * their identity.
   */
  allowsPaletteTint?: boolean;
  /**
   * Planets whose real-world identity is instantly recognizable (Earth): the
   * seeded role pass never dresses them with a procedural ring — a ringed
   * Earth reads as a rendering mistake, not variety.
   */
  excludeFromProceduralRing?: boolean;
  axialTiltRadians: number;
};

/**
 * Real solar-system surface textures (see ATTRIBUTION.md in the texture folder).
 * Personality planets are assigned an entry deterministically by index, so the
 * same world config always renders the same planet styles.
 * Axial tilts approximate the real planets (Uranus famously rolls on its side).
 */
export const PLANET_TEXTURE_CATALOG: PlanetTextureCatalogEntry[] = [
  {
    planetStyleName: "earth-like",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/8k_earth_daymap.jpg`,
    nightLightsTextureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/8k_earth_nightmap.jpg`,
    cloudsTextureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/4k_earth_clouds.jpg`,
    normalMapTextureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/2k_earth_normal_map.png`,
    roughnessMapTextureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/2k_earth_roughness_map.png`,
    excludeFromProceduralRing: true,
    axialTiltRadians: 0.41
  },
  {
    planetStyleName: "gas-giant",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/8k_jupiter.jpg`,
    axialTiltRadians: 0.05
  },
  {
    planetStyleName: "ringed-giant",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/8k_saturn.jpg`,
    ringTextureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/8k_saturn_ring_alpha.png`,
    axialTiltRadians: 0.47
  },
  {
    planetStyleName: "red-desert",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/4k_mars.jpg`,
    axialTiltRadians: 0.44
  },
  {
    planetStyleName: "ice-giant",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/2k_neptune.jpg`,
    axialTiltRadians: 0.49
  },
  {
    planetStyleName: "rocky-cratered",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/4k_mercury.jpg`,
    axialTiltRadians: 0.01
  },
  {
    planetStyleName: "sideways-ice-giant",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/2k_uranus.jpg`,
    axialTiltRadians: 1.71
  },
  {
    planetStyleName: "volcanic-surface",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/4k_venus_surface.jpg`,
    axialTiltRadians: 0.05
  },
  {
    planetStyleName: "cratered-moon",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/2k_moon.jpg`,
    axialTiltRadians: 0.03
  },
  {
    planetStyleName: "dwarf-rocky",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/2k_ceres_fictional.jpg`,
    allowsPaletteTint: true,
    axialTiltRadians: 0.07
  },
  {
    planetStyleName: "dwarf-icy",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/2k_eris_fictional.jpg`,
    allowsPaletteTint: true,
    axialTiltRadians: 0.68
  },
  {
    planetStyleName: "dwarf-reddish",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/2k_makemake_fictional.jpg`,
    allowsPaletteTint: true,
    axialTiltRadians: 0.5
  },
  {
    planetStyleName: "dwarf-frozen",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/2k_haumea_fictional.jpg`,
    allowsPaletteTint: true,
    axialTiltRadians: 0.25
  },
  {
    planetStyleName: "veiled-atmosphere",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/2k_venus_atmosphere.jpg`,
    axialTiltRadians: 0.05
  }
];

export function planetTextureEntryForIndex(planetIndex: number): PlanetTextureCatalogEntry {
  return PLANET_TEXTURE_CATALOG[planetIndex % PLANET_TEXTURE_CATALOG.length];
}

/**
 * Seeded catalog assignment: a Fisher-Yates shuffle of the catalog indices,
 * drawn from a dedicated PRNG stream, so each world meets the texture pool in
 * its own order (planet 0 is no longer always earth-like) and no style
 * repeats until the whole pool has been used once.
 */
export function buildPlanetTextureAssignment(seed: string, planetCount: number): number[] {
  const random = randomFromSeed(`${seed}-planet-texture-assignment`);
  const shuffledCatalogIndices = PLANET_TEXTURE_CATALOG.map((_, catalogIndex) => catalogIndex);
  for (let shuffleIndex = shuffledCatalogIndices.length - 1; shuffleIndex > 0; shuffleIndex -= 1) {
    const swapIndex = Math.floor(random() * (shuffleIndex + 1));
    [shuffledCatalogIndices[shuffleIndex], shuffledCatalogIndices[swapIndex]] = [
      shuffledCatalogIndices[swapIndex],
      shuffledCatalogIndices[shuffleIndex]
    ];
  }
  return Array.from(
    { length: planetCount },
    (_, planetIndex) => shuffledCatalogIndices[planetIndex % shuffledCatalogIndices.length]
  );
}

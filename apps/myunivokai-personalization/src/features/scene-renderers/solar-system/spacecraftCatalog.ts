const SOLAR_SYSTEM_MODEL_BASE_PATH = "/models/solar-system";

/**
 * Real NASA spacecraft (public domain, see ATTRIBUTION.md in the model
 * folder), meshopt-compressed. The world's seed picks ONE as a personal
 * "artificial satellite" orbiting the highest-energy personality planet.
 * targetSize normalizes wildly inconsistent source units (verified spread of
 * ~200x across the NASA repo) to scene units via a bounding-box fit.
 */
export type SpacecraftCatalogEntry = {
  spacecraftName: string;
  modelUrl: string;
  targetSize: number;
};

export const SPACECRAFT_CATALOG: SpacecraftCatalogEntry[] = [
  {
    spacecraftName: "Hubble Space Telescope",
    modelUrl: `${SOLAR_SYSTEM_MODEL_BASE_PATH}/hubble.glb`,
    targetSize: 0.42
  },
  {
    spacecraftName: "James Webb Space Telescope",
    modelUrl: `${SOLAR_SYSTEM_MODEL_BASE_PATH}/jwst.glb`,
    targetSize: 0.48
  },
  {
    spacecraftName: "Cassini-Huygens",
    modelUrl: `${SOLAR_SYSTEM_MODEL_BASE_PATH}/cassini.glb`,
    targetSize: 0.4
  },
  {
    spacecraftName: "Voyager",
    modelUrl: `${SOLAR_SYSTEM_MODEL_BASE_PATH}/voyager.glb`,
    targetSize: 0.44
  }
];

/** Radar shape model of asteroid 101955 Bennu — the belt's named hero rock. */
export const BENNU_MODEL_URL = `${SOLAR_SYSTEM_MODEL_BASE_PATH}/bennu.glb`;
export const BENNU_TARGET_SIZE = 0.34;

/**
 * Rare distant black hole (Sketchfab CC-BY, see ATTRIBUTION.md): a black core
 * with emissive accretion rings and a baked swirl animation, meshopt + WebP.
 * Not preloaded: it only appears on ~20% of worlds via the "black-hole" rare
 * feature, so it lazy-loads inside its own Suspense boundary.
 */
export const BLACK_HOLE_MODEL_URL = `${SOLAR_SYSTEM_MODEL_BASE_PATH}/black-hole.glb`;
export const BLACK_HOLE_TARGET_SIZE = 13;

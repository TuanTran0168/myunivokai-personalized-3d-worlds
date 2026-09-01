import type {
  ForestAmbientParticlesConfig,
  ForestBirdFlockConfig,
  ForestGroundAnimalConfig,
  ForestLandmarkConfig,
  ForestLightingConfig,
  ForestSeasonConfig,
  ForestTerrainConfig,
  ForestTreeSpeciesMixEntry,
  ForestTreesConfig,
  ForestWeatherConfig,
  ForestWildlifeConfig,
  SceneConfig,
  ScenePostFXGradeConfig
} from "./types";
import {
  FOREST_SCENE_TYPE,
  previewPlanetNames,
  previewSeedFromInputs,
  randomFromSeed,
  type PreviewSceneInput
} from "./scene";

// --- Forest live preview -----------------------------------------------------
//
// The frontend mirror of nature-service's deterministic forest builder. It is
// the mirror pair of services/nature-service/internal/services/
// forest_scene_profile.go + forest_config_builder.go: same tables, same
// per-section seed streams, same fixed draw order — keep the two in sync (the
// scene.ts ↔ universe-service discipline). The PRNG itself is the frontend's
// xorshift (randomFromSeed), so the preview is *plausible*, not byte-equal to
// the backend output; the preview seed starts with "preview|" and never
// collides with a stored NAT- seed.

// Mirrors forest_config_builder.go. 1.1: wider animal species pools. 1.2:
// more animal slots/individuals + lower/wider bird altitude band.
export const FOREST_PREVIEW_SCHEMA_VERSION = "1.2";

// Season kinds, in canonical order. The order is part of the contract: the
// mood season-weight vectors index into it, and the "giao mùa" transition
// picks an adjacent season cyclically (winter wraps to spring).
export const FOREST_SEASON_SPRING = "spring";
export const FOREST_SEASON_SUMMER = "summer";
export const FOREST_SEASON_AUTUMN = "autumn";
export const FOREST_SEASON_WINTER = "winter";
const SEASON_KINDS_IN_ORDER = [FOREST_SEASON_SPRING, FOREST_SEASON_SUMMER, FOREST_SEASON_AUTUMN, FOREST_SEASON_WINTER];

export const FOREST_WEATHER_CLEAR = "clear";
export const FOREST_WEATHER_SUN_RAYS = "sunRays";
export const FOREST_WEATHER_OVERCAST = "overcast";
export const FOREST_WEATHER_RAIN = "rain";
export const FOREST_WEATHER_SNOW = "snow";

export const FOREST_TIME_OF_DAY_DAY = "day";
export const FOREST_TIME_OF_DAY_GOLDEN_HOUR = "goldenHour";
export const FOREST_TIME_OF_DAY_DUSK = "dusk";

export const FOREST_GROUND_GRASS = "grass";
export const FOREST_GROUND_LEAF_LITTER = "leafLitter";
export const FOREST_GROUND_SNOW = "snow";

export const FOREST_LANDMARK_HEART_TREE = "heartTree";
export const FOREST_LANDMARK_STANDING_STONE = "standingStone";
export const FOREST_LANDMARK_POND = "pond";
export const FOREST_LANDMARK_FLOWER_PATCH = "flowerPatch";
export const FOREST_LANDMARK_FALLEN_LOG = "fallenLog";
export const FOREST_LANDMARK_LANTERN_SHRINE = "lanternShrine";
const NON_HERO_LANDMARK_KINDS = [
  FOREST_LANDMARK_STANDING_STONE,
  FOREST_LANDMARK_POND,
  FOREST_LANDMARK_FLOWER_PATCH,
  FOREST_LANDMARK_FALLEN_LOG,
  FOREST_LANDMARK_LANTERN_SHRINE
];

export const FOREST_BIRD_PATTERN_CIRCLING = "circling";
export const FOREST_BIRD_PATTERN_CROSSING = "crossing";

export const MODEL_KEY_TREE_BIRCH = "tree-birch";
export const MODEL_KEY_TREE_OAK = "tree-oak";
export const MODEL_KEY_TREE_PINE = "tree-pine";
export const MODEL_KEY_TREE_PINE_SNOW = "tree-pine-snow";
export const MODEL_KEY_TREE_DEAD = "tree-dead";
export const MODEL_KEY_TREE_BLOSSOM = "tree-blossom";
export const MODEL_KEY_ANIMAL_DEER = "animal-deer";
export const MODEL_KEY_ANIMAL_FOX = "animal-fox";
export const MODEL_KEY_ANIMAL_RABBIT = "animal-rabbit";
export const MODEL_KEY_ANIMAL_BOAR = "animal-boar";
export const MODEL_KEY_ANIMAL_WOLF = "animal-wolf";
export const MODEL_KEY_ANIMAL_STAG = "animal-stag";
export const MODEL_KEY_ANIMAL_BEAR = "animal-bear";
export const MODEL_KEY_ANIMAL_SQUIRREL = "animal-squirrel";
export const MODEL_KEY_BIRD_FOREST = "bird-forest";
export const MODEL_KEY_ROCK_MOSSY = "rock-mossy";

const LANDMARK_MODEL_KEYS_BY_KIND: Record<string, string> = {
  [FOREST_LANDMARK_HEART_TREE]: "landmark-heart-tree",
  [FOREST_LANDMARK_STANDING_STONE]: "landmark-standing-stone",
  [FOREST_LANDMARK_POND]: "landmark-pond",
  [FOREST_LANDMARK_FLOWER_PATCH]: "landmark-flower-patch",
  [FOREST_LANDMARK_FALLEN_LOG]: "landmark-fallen-log",
  [FOREST_LANDMARK_LANTERN_SHRINE]: "landmark-lantern-shrine"
};

const FOREST_ASSET_CATALOG_VERSION = "nature-1";

type ForestMoodProfile = {
  seasonWeights: [number, number, number, number];
  windMultiplier: number;
  wildlifeMultiplier: number;
  bloomMultiplier: number;
};

const NEUTRAL_FOREST_PROFILE: ForestMoodProfile = {
  seasonWeights: [0.25, 0.25, 0.25, 0.25],
  windMultiplier: 1.0,
  wildlifeMultiplier: 1.0,
  bloomMultiplier: 1.0
};

// The leaning season per mood: focused → winter (crisp, still), dreamy →
// spring (blossom, soft), energetic → summer (lush, breezy, most wildlife),
// reflective → autumn (golden, misty, falling leaves).
const FOREST_MOOD_PROFILES: Record<string, ForestMoodProfile> = {
  focused: { seasonWeights: [0.15, 0.15, 0.15, 0.55], windMultiplier: 0.8, wildlifeMultiplier: 0.8, bloomMultiplier: 1.0 },
  dreamy: { seasonWeights: [0.55, 0.15, 0.15, 0.15], windMultiplier: 0.9, wildlifeMultiplier: 1.0, bloomMultiplier: 1.3 },
  energetic: { seasonWeights: [0.15, 0.55, 0.15, 0.15], windMultiplier: 1.3, wildlifeMultiplier: 1.3, bloomMultiplier: 1.2 },
  reflective: { seasonWeights: [0.15, 0.15, 0.55, 0.15], windMultiplier: 0.7, wildlifeMultiplier: 0.7, bloomMultiplier: 0.8 }
};

function forestProfileForMood(mood: string): ForestMoodProfile {
  return FOREST_MOOD_PROFILES[mood.trim().toLowerCase()] ?? NEUTRAL_FOREST_PROFILE;
}

// --- World style -------------------------------------------------------------
//
// Mirrors forest_style_profile.go one-for-one. The visitor's second axis, and
// deliberately the one the MOOD does not touch: mood decides which season and
// how much wind/wildlife/bloom, style decides how the forest is GROWN and LIT.
//
// timeOfDayWeights index TIME_OF_DAY_KINDS_IN_ORDER. fogProbabilityBias is
// ADDED to the season's own probability and then clamped, so autumn stays
// foggier than summer under every style.
export const FOREST_STYLE_WILDWOOD = "wildwood";
export const FOREST_STYLE_ANCIENT_GROVE = "ancient-grove";
export const FOREST_STYLE_MISTWOOD = "mistwood";
export const FOREST_STYLE_EMBERFALL = "emberfall";
export const FOREST_STYLE_LANTERNWOOD = "lanternwood";

type ForestStyleProfile = {
  timeOfDayWeights: [number, number, number];
  fogProbabilityBias: number;
  treeCountMultiplier: number;
  treeScaleMultiplier: number;
  bloomMultiplier: number;
  grade: ScenePostFXGradeConfig;
};

const NEUTRAL_FOREST_GRADE: ScenePostFXGradeConfig = { hueRadians: 0, saturation: 0, brightness: 0, contrast: 0 };

// Exactly neutral, and it has to stay that way: these are the numbers a forest
// with no style gets, and they are what keeps the backend's golden fixtures
// valid for every world stored before styles existed.
const NEUTRAL_FOREST_STYLE_PROFILE: ForestStyleProfile = {
  timeOfDayWeights: [0.35, 0.45, 0.2],
  fogProbabilityBias: 0,
  treeCountMultiplier: 1.0,
  treeScaleMultiplier: 1.0,
  bloomMultiplier: 1.0,
  grade: NEUTRAL_FOREST_GRADE
};

const FOREST_STYLE_PROFILES: Record<string, ForestStyleProfile> = {
  [FOREST_STYLE_WILDWOOD]: NEUTRAL_FOREST_STYLE_PROFILE,
  [FOREST_STYLE_ANCIENT_GROVE]: {
    timeOfDayWeights: [0.55, 0.35, 0.1],
    fogProbabilityBias: 0.1,
    treeCountMultiplier: 0.62,
    treeScaleMultiplier: 1.45,
    bloomMultiplier: 0.9,
    grade: { hueRadians: 0, saturation: -0.04, brightness: -0.02, contrast: 0.05 }
  },
  [FOREST_STYLE_MISTWOOD]: {
    timeOfDayWeights: [0.3, 0.3, 0.4],
    fogProbabilityBias: 0.55,
    treeCountMultiplier: 1.1,
    treeScaleMultiplier: 1.0,
    bloomMultiplier: 1.25,
    grade: { hueRadians: 0.02, saturation: -0.18, brightness: 0.04, contrast: -0.05 }
  },
  [FOREST_STYLE_EMBERFALL]: {
    timeOfDayWeights: [0.1, 0.8, 0.1],
    fogProbabilityBias: -0.05,
    treeCountMultiplier: 1.0,
    treeScaleMultiplier: 1.05,
    bloomMultiplier: 1.2,
    grade: { hueRadians: -0.04, saturation: 0.16, brightness: 0.01, contrast: 0.06 }
  },
  [FOREST_STYLE_LANTERNWOOD]: {
    timeOfDayWeights: [0.05, 0.2, 0.75],
    fogProbabilityBias: 0.25,
    treeCountMultiplier: 1.15,
    treeScaleMultiplier: 0.95,
    bloomMultiplier: 1.55,
    grade: { hueRadians: -0.03, saturation: 0.1, brightness: -0.03, contrast: 0.09 }
  }
};

function forestProfileForStyle(style: string): ForestStyleProfile {
  return FOREST_STYLE_PROFILES[style.trim().toLowerCase()] ?? NEUTRAL_FOREST_STYLE_PROFILE;
}

// Fog may not be certain and may not be impossible: a style that pinned either
// end would stop the weather being a property of the world.
const MINIMUM_FOG_PROBABILITY = 0.05;
const MAXIMUM_FOG_PROBABILITY = 0.95;

/**
 * Layers a style's grade offset on the season's. Both are offsets from neutral,
 * so adding is the operation that means "and also".
 *
 * Every field is optional in the type because the FE mirrors the BE JSON
 * contract, where an older stored world may simply not carry one — an absent
 * offset is no offset.
 */
function addGrade(base: ScenePostFXGradeConfig, overlay: ScenePostFXGradeConfig): ScenePostFXGradeConfig {
  return {
    hueRadians: (base.hueRadians ?? 0) + (overlay.hueRadians ?? 0),
    saturation: (base.saturation ?? 0) + (overlay.saturation ?? 0),
    brightness: (base.brightness ?? 0) + (overlay.brightness ?? 0),
    contrast: (base.contrast ?? 0) + (overlay.contrast ?? 0)
  };
}

type WeightedWeatherKind = {
  kind: string;
  weight: number;
};

// The season ↔ weather compatibility matrix: snow only ever appears in
// winter; rain never does.
const WEATHER_WEIGHTS_BY_SEASON: Record<string, WeightedWeatherKind[]> = {
  [FOREST_SEASON_SPRING]: [
    { kind: FOREST_WEATHER_CLEAR, weight: 0.15 },
    { kind: FOREST_WEATHER_SUN_RAYS, weight: 0.25 },
    { kind: FOREST_WEATHER_OVERCAST, weight: 0.15 },
    { kind: FOREST_WEATHER_RAIN, weight: 0.45 }
  ],
  [FOREST_SEASON_SUMMER]: [
    { kind: FOREST_WEATHER_CLEAR, weight: 0.2 },
    { kind: FOREST_WEATHER_SUN_RAYS, weight: 0.33 },
    { kind: FOREST_WEATHER_OVERCAST, weight: 0.12 },
    { kind: FOREST_WEATHER_RAIN, weight: 0.35 }
  ],
  [FOREST_SEASON_AUTUMN]: [
    { kind: FOREST_WEATHER_CLEAR, weight: 0.12 },
    { kind: FOREST_WEATHER_SUN_RAYS, weight: 0.18 },
    { kind: FOREST_WEATHER_OVERCAST, weight: 0.25 },
    { kind: FOREST_WEATHER_RAIN, weight: 0.45 }
  ],
  [FOREST_SEASON_WINTER]: [
    { kind: FOREST_WEATHER_CLEAR, weight: 0.18 },
    { kind: FOREST_WEATHER_OVERCAST, weight: 0.27 },
    { kind: FOREST_WEATHER_SNOW, weight: 0.55 }
  ]
};

// Two foliage palettes per season; a seeded roll picks one so same-season
// forests still differ in tint.
const FOLIAGE_PALETTES_BY_SEASON: Record<string, string[][]> = {
  [FOREST_SEASON_SPRING]: [
    ["#7FBF6A", "#A8D08D", "#F5B7CD"],
    ["#89C97C", "#B7DFA1", "#F7C9DD"]
  ],
  [FOREST_SEASON_SUMMER]: [
    ["#3E7C3F", "#5B9E52", "#77B366"],
    ["#356F38", "#4F9149", "#6FAF5D"]
  ],
  [FOREST_SEASON_AUTUMN]: [
    ["#C2571B", "#D98E2B", "#8F3B1B"],
    ["#B8641F", "#E0A032", "#7C2F16"]
  ],
  [FOREST_SEASON_WINTER]: [
    ["#4F6B57", "#6C8578", "#DDE7EC"],
    ["#45604E", "#5F7A6B", "#E6EEF2"]
  ]
};

const GROUND_KINDS_BY_SEASON: Record<string, string> = {
  [FOREST_SEASON_SPRING]: FOREST_GROUND_GRASS,
  [FOREST_SEASON_SUMMER]: FOREST_GROUND_GRASS,
  [FOREST_SEASON_AUTUMN]: FOREST_GROUND_LEAF_LITTER,
  [FOREST_SEASON_WINTER]: FOREST_GROUND_SNOW
};

const BACKGROUND_COLORS_BY_SEASON: Record<string, string> = {
  [FOREST_SEASON_SPRING]: "#0B120D",
  [FOREST_SEASON_SUMMER]: "#0A120C",
  [FOREST_SEASON_AUTUMN]: "#120E08",
  [FOREST_SEASON_WINTER]: "#0B1016"
};

// Two species mixes per season; a seeded roll picks one. Winter leans on the
// snow-capped pine variants and bare trees; spring is the only season with
// blossom trees.
const TREE_SPECIES_MIXES_BY_SEASON: Record<string, ForestTreeSpeciesMixEntry[][]> = {
  [FOREST_SEASON_SPRING]: [
    [
      { modelKey: MODEL_KEY_TREE_BIRCH, weight: 0.4 },
      { modelKey: MODEL_KEY_TREE_OAK, weight: 0.35 },
      { modelKey: MODEL_KEY_TREE_PINE, weight: 0.15 },
      { modelKey: MODEL_KEY_TREE_BLOSSOM, weight: 0.1 }
    ],
    [
      { modelKey: MODEL_KEY_TREE_OAK, weight: 0.45 },
      { modelKey: MODEL_KEY_TREE_BIRCH, weight: 0.3 },
      { modelKey: MODEL_KEY_TREE_BLOSSOM, weight: 0.25 }
    ]
  ],
  [FOREST_SEASON_SUMMER]: [
    [
      { modelKey: MODEL_KEY_TREE_OAK, weight: 0.45 },
      { modelKey: MODEL_KEY_TREE_BIRCH, weight: 0.3 },
      { modelKey: MODEL_KEY_TREE_PINE, weight: 0.25 }
    ],
    [
      { modelKey: MODEL_KEY_TREE_BIRCH, weight: 0.5 },
      { modelKey: MODEL_KEY_TREE_OAK, weight: 0.3 },
      { modelKey: MODEL_KEY_TREE_PINE, weight: 0.2 }
    ]
  ],
  [FOREST_SEASON_AUTUMN]: [
    [
      { modelKey: MODEL_KEY_TREE_OAK, weight: 0.4 },
      { modelKey: MODEL_KEY_TREE_BIRCH, weight: 0.3 },
      { modelKey: MODEL_KEY_TREE_PINE, weight: 0.15 },
      { modelKey: MODEL_KEY_TREE_DEAD, weight: 0.15 }
    ],
    [
      { modelKey: MODEL_KEY_TREE_BIRCH, weight: 0.45 },
      { modelKey: MODEL_KEY_TREE_OAK, weight: 0.35 },
      { modelKey: MODEL_KEY_TREE_DEAD, weight: 0.2 }
    ]
  ],
  [FOREST_SEASON_WINTER]: [
    [
      { modelKey: MODEL_KEY_TREE_PINE_SNOW, weight: 0.45 },
      { modelKey: MODEL_KEY_TREE_PINE, weight: 0.2 },
      { modelKey: MODEL_KEY_TREE_DEAD, weight: 0.35 }
    ],
    [
      { modelKey: MODEL_KEY_TREE_PINE_SNOW, weight: 0.6 },
      { modelKey: MODEL_KEY_TREE_DEAD, weight: 0.4 }
    ]
  ]
};

// Winter forests are naturally sparser; the other seasons stay near the base
// tree count.
const TREE_COUNT_MULTIPLIERS_BY_SEASON: Record<string, number> = {
  [FOREST_SEASON_SPRING]: 1.0,
  [FOREST_SEASON_SUMMER]: 1.05,
  [FOREST_SEASON_AUTUMN]: 1.0,
  [FOREST_SEASON_WINTER]: 0.85
};

// Widened in schema 1.1 — keep in exact order-sync with
// forest_scene_profile.go (the species draw indexes into this list).
const GROUND_ANIMAL_SPECIES_BY_SEASON: Record<string, string[]> = {
  [FOREST_SEASON_SPRING]: [MODEL_KEY_ANIMAL_DEER, MODEL_KEY_ANIMAL_RABBIT, MODEL_KEY_ANIMAL_FOX, MODEL_KEY_ANIMAL_SQUIRREL],
  [FOREST_SEASON_SUMMER]: [
    MODEL_KEY_ANIMAL_DEER,
    MODEL_KEY_ANIMAL_FOX,
    MODEL_KEY_ANIMAL_BOAR,
    MODEL_KEY_ANIMAL_RABBIT,
    MODEL_KEY_ANIMAL_BEAR,
    MODEL_KEY_ANIMAL_SQUIRREL
  ],
  [FOREST_SEASON_AUTUMN]: [
    MODEL_KEY_ANIMAL_DEER,
    MODEL_KEY_ANIMAL_FOX,
    MODEL_KEY_ANIMAL_BOAR,
    MODEL_KEY_ANIMAL_STAG,
    MODEL_KEY_ANIMAL_BEAR
  ],
  [FOREST_SEASON_WINTER]: [MODEL_KEY_ANIMAL_DEER, MODEL_KEY_ANIMAL_WOLF, MODEL_KEY_ANIMAL_FOX, MODEL_KEY_ANIMAL_STAG]
};

// Base active slot counts before the mood wildlife multiplier; fractional so
// the multiplier has room to round up or down.
const BASE_GROUND_ANIMAL_SLOTS_BY_SEASON: Record<string, number> = {
  [FOREST_SEASON_SPRING]: 3.5,
  [FOREST_SEASON_SUMMER]: 4.5,
  [FOREST_SEASON_AUTUMN]: 3.5,
  [FOREST_SEASON_WINTER]: 2.5
};

const BASE_BIRD_FLOCKS_BY_SEASON: Record<string, number> = {
  [FOREST_SEASON_SPRING]: 1.6,
  [FOREST_SEASON_SUMMER]: 1.6,
  [FOREST_SEASON_AUTUMN]: 1.0,
  [FOREST_SEASON_WINTER]: 0.6
};

// Canonical order — ForestStyleProfile.timeOfDayWeights indexes into it.
const TIME_OF_DAY_KINDS_IN_ORDER = [
  FOREST_TIME_OF_DAY_DAY,
  FOREST_TIME_OF_DAY_GOLDEN_HOUR,
  FOREST_TIME_OF_DAY_DUSK
] as const;

type FloatRange = {
  minimum: number;
  maximum: number;
};

const SUN_ELEVATION_BOUNDS_BY_TIME_OF_DAY: Record<string, FloatRange> = {
  [FOREST_TIME_OF_DAY_DAY]: { minimum: 0.7, maximum: 1.1 },
  [FOREST_TIME_OF_DAY_GOLDEN_HOUR]: { minimum: 0.25, maximum: 0.45 },
  [FOREST_TIME_OF_DAY_DUSK]: { minimum: 0.12, maximum: 0.3 }
};

const SUN_COLORS_BY_TIME_OF_DAY: Record<string, string> = {
  [FOREST_TIME_OF_DAY_DAY]: "#FFF6E5",
  [FOREST_TIME_OF_DAY_GOLDEN_HOUR]: "#FFD9A0",
  [FOREST_TIME_OF_DAY_DUSK]: "#FF9E6B"
};

const AMBIENT_COLORS_BY_TIME_OF_DAY: Record<string, string> = {
  [FOREST_TIME_OF_DAY_DAY]: "#9DB4C8",
  [FOREST_TIME_OF_DAY_GOLDEN_HOUR]: "#8A93A8",
  [FOREST_TIME_OF_DAY_DUSK]: "#6E7A96"
};

const HDRI_KEYS_BY_TIME_OF_DAY: Record<string, string> = {
  [FOREST_TIME_OF_DAY_DAY]: "nature-hdri-day",
  [FOREST_TIME_OF_DAY_GOLDEN_HOUR]: "nature-hdri-golden-hour",
  [FOREST_TIME_OF_DAY_DUSK]: "nature-hdri-dusk"
};

const FOG_COLORS_BY_SEASON: Record<string, string> = {
  [FOREST_SEASON_SPRING]: "#BCC9B4",
  [FOREST_SEASON_SUMMER]: "#C4D2BE",
  [FOREST_SEASON_AUTUMN]: "#C9B79C",
  [FOREST_SEASON_WINTER]: "#D7DEE6"
};

// Autumn mist is a signature of the season; summer stays mostly clear.
const FOG_PROBABILITY_BY_SEASON: Record<string, number> = {
  [FOREST_SEASON_SPRING]: 0.3,
  [FOREST_SEASON_SUMMER]: 0.2,
  [FOREST_SEASON_AUTUMN]: 0.6,
  [FOREST_SEASON_WINTER]: 0.45
};

const CLOUD_COVERAGE_BOUNDS_BY_WEATHER_KIND: Record<string, FloatRange> = {
  [FOREST_WEATHER_CLEAR]: { minimum: 0.05, maximum: 0.25 },
  [FOREST_WEATHER_SUN_RAYS]: { minimum: 0.15, maximum: 0.35 },
  [FOREST_WEATHER_OVERCAST]: { minimum: 0.6, maximum: 0.95 },
  [FOREST_WEATHER_RAIN]: { minimum: 0.55, maximum: 0.9 },
  [FOREST_WEATHER_SNOW]: { minimum: 0.5, maximum: 0.85 }
};

// Per-season color grades — the forest counterpart of universe-service's
// per-theme grade table (a table lookup, never a PRNG draw).
const FOREST_GRADES_BY_SEASON: Record<string, ScenePostFXGradeConfig> = {
  [FOREST_SEASON_SPRING]: { hueRadians: 0.01, saturation: 0.1, brightness: 0.03, contrast: 0.04 },
  [FOREST_SEASON_SUMMER]: { hueRadians: 0.0, saturation: 0.18, brightness: 0.02, contrast: 0.06 },
  [FOREST_SEASON_AUTUMN]: { hueRadians: -0.02, saturation: 0.15, brightness: 0.02, contrast: 0.08 },
  [FOREST_SEASON_WINTER]: { hueRadians: 0.03, saturation: -0.22, brightness: 0.05, contrast: 0.06 }
};

// Numeric bounds for every seeded draw — base + roll*range, mirroring the Go
// constant block one-for-one.
const TRANSITION_PROBABILITY = 0.2;
const MINIMUM_SEASON_BLEND_AMOUNT = 0.2;
const SEASON_BLEND_AMOUNT_RANGE = 0.4;

const MINIMUM_SUN_EXPOSURE = 0.95;
const SUN_EXPOSURE_RANGE = 0.2;
const MINIMUM_FOG_DENSITY = 0.008;
const FOG_DENSITY_RANGE = 0.02;
const BASE_FOREST_BLOOM_INTENSITY = 0.25;
const FOREST_BLOOM_INTENSITY_RANGE = 0.5;
const MINIMUM_FOREST_BLOOM_INTENSITY = 0.2;
const MAXIMUM_FOREST_BLOOM_INTENSITY = 1.2;

const MINIMUM_CLEARING_RADIUS = 8.0;
const CLEARING_RADIUS_RANGE = 3.0;
const TREELINE_RADIUS_MULTIPLIER = 4.2;
const MINIMUM_HILL_AMPLITUDE = 0.8;
const HILL_AMPLITUDE_RANGE = 1.4;
const MINIMUM_HILL_FREQUENCY = 0.03;
const HILL_FREQUENCY_RANGE = 0.04;
const MINIMUM_ROCK_COUNT = 8;
const ROCK_COUNT_SPREAD = 12;
const MINIMUM_GRASS_TUFT_COUNT = 600;
const GRASS_TUFT_COUNT_SPREAD = 601;
const MOBILE_GRASS_TUFT_FRACTION = 0.35;
const PATH_PROBABILITY = 0.7;
const MINIMUM_FOREST_CAMERA_DISTANCE = 14.0;
const FOREST_CAMERA_DISTANCE_RANGE = 6.0;
const FOREST_CAMERA_FIELD_OF_VIEW = 50;

const BASE_TREE_COUNT = 160;
const TREE_COUNT_SPREAD = 121;
const MINIMUM_TREE_COUNT = 120;
const MAXIMUM_TREE_COUNT = 320;
const MOBILE_TREE_FRACTION = 0.4;
const TREE_SCALE_MINIMUM_BASE = 0.75;
const TREE_SCALE_MINIMUM_RANGE = 0.15;
const TREE_SCALE_MAXIMUM_BASE = 1.3;
const TREE_SCALE_MAXIMUM_RANGE = 0.3;
const FOLIAGE_TINT_STRENGTH_BASE = 0.5;
const FOLIAGE_TINT_STRENGTH_RANGE = 0.35;
const WIND_STRENGTH_BASE = 0.35;
const WIND_STRENGTH_RANGE = 0.5;
const MINIMUM_WIND_STRENGTH = 0.1;
const MAXIMUM_WIND_STRENGTH = 1.0;
const WIND_GUST_FREQUENCY_BASE = 0.28;
const WIND_GUST_FREQUENCY_RANGE = 0.42;

const WEATHER_INTENSITY_BASE = 0.42;
const WEATHER_INTENSITY_RANGE = 0.58;
const BASE_RAIN_DROP_COUNT = 3000;
const RAIN_DROP_COUNT_RANGE = 4000;
const MOBILE_RAIN_FRACTION = 0.3;
const BASE_SNOWFLAKE_COUNT = 1500;
const SNOWFLAKE_COUNT_RANGE = 2500;
const MOBILE_SNOW_FRACTION = 0.3;

// Slots are FIXED so the PRNG draw count never changes; the active count only
// gates how many drawn slots are kept.
const MAXIMUM_GROUND_ANIMAL_SLOTS = 5;
const MAXIMUM_BIRD_FLOCK_SLOTS = 2;
const GROUND_ANIMAL_COUNT_BASE = 1;
const GROUND_ANIMAL_COUNT_SPREAD = 3;
const WALK_SPEED_BASE = 0.35;
const WALK_SPEED_RANGE = 0.4;
const ANIMAL_SCALE_BASE = 0.85;
const ANIMAL_SCALE_RANGE = 0.25;
const BIRDS_PER_FLOCK_BASE = 3;
const BIRDS_PER_FLOCK_SPREAD = 5;
const BIRD_ALTITUDE_BASE = 5.0;
const BIRD_ALTITUDE_BASE_RANGE = 17.0;
const BIRD_ALTITUDE_SPAN_BASE = 4.0;
const BIRD_ALTITUDE_SPAN_RANGE = 6.0;
const FLIGHT_SPEED_BASE = 0.4;
const FLIGHT_SPEED_RANGE = 0.4;
const CIRCLING_PATTERN_PROBABILITY = 0.6;

const BASE_FALLING_LEAF_COUNT = 180;
const FALLING_LEAF_COUNT_SPREAD = 181;
const BASE_BLOSSOM_PETAL_COUNT = 120;
const BLOSSOM_PETAL_COUNT_SPREAD = 121;
const BASE_FIREFLY_COUNT = 40;
const FIREFLY_COUNT_SPREAD = 41;
const BASE_SNOW_DUST_COUNT = 100;
const SNOW_DUST_COUNT_SPREAD = 101;

const LANDMARK_ANGLE_JITTER_RADIANS = 0.25;
const LANDMARK_RADIUS_FRACTION_BASE = 0.55;
const LANDMARK_RADIUS_FRACTION_RANGE = 0.35;

// Per-section PRNG stream labels — identical strings to the Go builder so a
// reader can line the two files up side by side.
const SEASON_SEED_SUFFIX = "-forest-season";
const LIGHTING_SEED_SUFFIX = "-forest-lighting";
const TERRAIN_SEED_SUFFIX = "-forest-terrain";
const TREES_SEED_SUFFIX = "-forest-trees";
const WEATHER_SEED_SUFFIX = "-forest-weather";
const WILDLIFE_SEED_SUFFIX = "-forest-wildlife";
const AMBIENT_SEED_SUFFIX = "-forest-ambient";
const LANDMARKS_SEED_SUFFIX = "-forest-landmarks";
const TERRAIN_SCATTER_SEED_SUFFIX = "-forest-terrain-scatter";
const TREE_PLACEMENT_SEED_SUFFIX = "-forest-tree-placement";

const DEFAULT_FOREST_PRIMARY_COLOR = "#8B5CF6";
const DEFAULT_FOREST_SECONDARY_COLOR = "#06B6D4";
const FOREST_PALETTE_ACCENT_COLOR = "#FACC15";

// The backend mock hands each landmark an energy ladder (60, 65, 70, ...).
// The preview mirrors the ladder instead of drawing energy, so the landmark
// PRNG stream keeps exactly 3 draws per landmark like the Go builder.
const FIRST_LANDMARK_ENERGY = 60;
const LANDMARK_ENERGY_STEP = 5;
const MAXIMUM_LANDMARK_ENERGY = 95;

const FULL_CIRCLE_RADIANS = Math.PI * 2;
const LANDMARK_COLOR_CYCLE_LENGTH = 3;

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

// Three decimals for values whose whole dynamic range sits below 0.1 (fog
// density, hill frequency) — two decimals would quantize them into a handful
// of visible steps.
function roundToThousandths(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function seasonForRoll(roll: number, weights: [number, number, number, number]): string {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) {
    return SEASON_KINDS_IN_ORDER[0];
  }
  let cumulative = 0;
  for (let index = 0; index < weights.length; index += 1) {
    cumulative += weights[index];
    if (roll < cumulative / total) {
      return SEASON_KINDS_IN_ORDER[index];
    }
  }
  return SEASON_KINDS_IN_ORDER[SEASON_KINDS_IN_ORDER.length - 1];
}

// The two cyclic neighbors are the only sensible "giao mùa" targets.
function adjacentSeason(kind: string, directionRoll: number): string {
  const index = Math.max(0, SEASON_KINDS_IN_ORDER.indexOf(kind));
  if (directionRoll < 0.5) {
    return SEASON_KINDS_IN_ORDER[(index + 1) % SEASON_KINDS_IN_ORDER.length];
  }
  return SEASON_KINDS_IN_ORDER[(index + SEASON_KINDS_IN_ORDER.length - 1) % SEASON_KINDS_IN_ORDER.length];
}

function weatherKindForRoll(roll: number, entries: WeightedWeatherKind[]): string {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0 || entries.length === 0) {
    return FOREST_WEATHER_CLEAR;
  }
  let cumulative = 0;
  for (const entry of entries) {
    cumulative += entry.weight;
    if (roll < cumulative / total) {
      return entry.kind;
    }
  }
  return entries[entries.length - 1].kind;
}

function timeOfDayForRoll(roll: number, weights: readonly [number, number, number]): string {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const lastKind = TIME_OF_DAY_KINDS_IN_ORDER[TIME_OF_DAY_KINDS_IN_ORDER.length - 1];
  if (total <= 0) {
    return lastKind;
  }
  let cumulative = 0;
  for (let index = 0; index < weights.length; index++) {
    cumulative += weights[index];
    if (roll < cumulative / total) {
      return TIME_OF_DAY_KINDS_IN_ORDER[index];
    }
  }
  return lastKind;
}

// Draw order: season roll, transition roll, transition direction, blend
// amount, foliage palette pick. The transition draws happen even for
// non-transition worlds so the foliage pick never shifts.
function buildPreviewSeasonConfig(seed: string, moodProfile: ForestMoodProfile): ForestSeasonConfig {
  const nextRandomValue = randomFromSeed(seed + SEASON_SEED_SUFFIX);
  const seasonRoll = nextRandomValue();
  const transitionRoll = nextRandomValue();
  const transitionDirectionRoll = nextRandomValue();
  const blendAmountRoll = nextRandomValue();
  const foliagePaletteRoll = nextRandomValue();

  const kind = seasonForRoll(seasonRoll, moodProfile.seasonWeights);
  const config: ForestSeasonConfig = {
    kind,
    groundKind: GROUND_KINDS_BY_SEASON[kind]
  };
  if (transitionRoll < TRANSITION_PROBABILITY) {
    config.blendTowardKind = adjacentSeason(kind, transitionDirectionRoll);
    config.blendAmount = roundToTwoDecimals(MINIMUM_SEASON_BLEND_AMOUNT + blendAmountRoll * SEASON_BLEND_AMOUNT_RANGE);
  }
  const palettes = FOLIAGE_PALETTES_BY_SEASON[kind];
  const paletteIndex = Math.floor(foliagePaletteRoll * palettes.length);
  config.foliageColors = [...palettes[paletteIndex]];
  return config;
}

// Draw order: time-of-day roll, sun elevation, sun azimuth, exposure, fog
// roll, fog density, bloom. Fog density is drawn even when the fog gate
// misses. Returns the lighting section plus the bloom intensity (which lives
// under postFX in the envelope).
function buildPreviewLightingConfig(
  seed: string,
  season: ForestSeasonConfig,
  moodProfile: ForestMoodProfile,
  styleProfile: ForestStyleProfile
): { lighting: ForestLightingConfig; bloomIntensity: number } {
  const nextRandomValue = randomFromSeed(seed + LIGHTING_SEED_SUFFIX);
  const timeOfDayRoll = nextRandomValue();
  const sunElevationRoll = nextRandomValue();
  const sunAzimuthRoll = nextRandomValue();
  const exposureRoll = nextRandomValue();
  const fogRoll = nextRandomValue();
  const fogDensityRoll = nextRandomValue();
  const bloomRoll = nextRandomValue();

  const timeOfDay = timeOfDayForRoll(timeOfDayRoll, styleProfile.timeOfDayWeights);
  const elevationBounds = SUN_ELEVATION_BOUNDS_BY_TIME_OF_DAY[timeOfDay];
  const seasonKind = season.kind ?? FOREST_SEASON_SPRING;
  let fogDensity = 0;
  // The style biases the season's own probability rather than replacing it,
  // so autumn stays foggier than summer under Mistwood as well as Wildwood.
  const fogProbability = clampNumber(
    FOG_PROBABILITY_BY_SEASON[seasonKind] + styleProfile.fogProbabilityBias,
    MINIMUM_FOG_PROBABILITY,
    MAXIMUM_FOG_PROBABILITY
  );
  if (fogRoll < fogProbability) {
    fogDensity = roundToThousandths(MINIMUM_FOG_DENSITY + fogDensityRoll * FOG_DENSITY_RANGE);
  }
  const bloomIntensity = roundToTwoDecimals(
    clampNumber(
      (BASE_FOREST_BLOOM_INTENSITY + bloomRoll * FOREST_BLOOM_INTENSITY_RANGE) *
        moodProfile.bloomMultiplier *
        styleProfile.bloomMultiplier,
      MINIMUM_FOREST_BLOOM_INTENSITY,
      MAXIMUM_FOREST_BLOOM_INTENSITY
    )
  );

  return {
    lighting: {
      timeOfDay,
      sunElevationRadians: roundToTwoDecimals(
        elevationBounds.minimum + sunElevationRoll * (elevationBounds.maximum - elevationBounds.minimum)
      ),
      sunAzimuthRadians: roundToTwoDecimals(sunAzimuthRoll * FULL_CIRCLE_RADIANS),
      sunColor: SUN_COLORS_BY_TIME_OF_DAY[timeOfDay],
      ambientColor: AMBIENT_COLORS_BY_TIME_OF_DAY[timeOfDay],
      hdriKey: HDRI_KEYS_BY_TIME_OF_DAY[timeOfDay],
      exposure: roundToTwoDecimals(MINIMUM_SUN_EXPOSURE + exposureRoll * SUN_EXPOSURE_RANGE),
      fogColor: FOG_COLORS_BY_SEASON[seasonKind],
      fogDensity
    },
    bloomIntensity
  };
}

// Draw order: clearing radius, hill amplitude, hill frequency, rock count,
// grass count, path roll, camera distance. Returns the terrain section plus
// the camera distance (which lives under camera in the envelope).
function buildPreviewTerrainConfig(seed: string): { terrain: ForestTerrainConfig; cameraDistance: number } {
  const nextRandomValue = randomFromSeed(seed + TERRAIN_SEED_SUFFIX);
  const clearingRoll = nextRandomValue();
  const hillAmplitudeRoll = nextRandomValue();
  const hillFrequencyRoll = nextRandomValue();
  const rockCount = MINIMUM_ROCK_COUNT + Math.floor(nextRandomValue() * ROCK_COUNT_SPREAD);
  const grassTuftCountDesktop = MINIMUM_GRASS_TUFT_COUNT + Math.floor(nextRandomValue() * GRASS_TUFT_COUNT_SPREAD);
  const pathRoll = nextRandomValue();
  const cameraDistanceRoll = nextRandomValue();

  const clearingRadius = roundToTwoDecimals(MINIMUM_CLEARING_RADIUS + clearingRoll * CLEARING_RADIUS_RANGE);
  return {
    terrain: {
      placementSeed: seed + TERRAIN_SCATTER_SEED_SUFFIX,
      clearingRadius,
      treelineRadius: roundToTwoDecimals(clearingRadius * TREELINE_RADIUS_MULTIPLIER),
      hillAmplitude: roundToTwoDecimals(MINIMUM_HILL_AMPLITUDE + hillAmplitudeRoll * HILL_AMPLITUDE_RANGE),
      hillFrequency: roundToThousandths(MINIMUM_HILL_FREQUENCY + hillFrequencyRoll * HILL_FREQUENCY_RANGE),
      pathEnabled: pathRoll < PATH_PROBABILITY,
      rockCount,
      grassTuftCountDesktop,
      grassTuftCountMobile: Math.floor(grassTuftCountDesktop * MOBILE_GRASS_TUFT_FRACTION)
    },
    cameraDistance: roundToTwoDecimals(MINIMUM_FOREST_CAMERA_DISTANCE + cameraDistanceRoll * FOREST_CAMERA_DISTANCE_RANGE)
  };
}

// Draw order: tree count, species-mix pick, scale minimum, scale maximum,
// tint strength, wind strength, wind direction, gust frequency.
function buildPreviewTreesConfig(
  seed: string,
  season: ForestSeasonConfig,
  moodProfile: ForestMoodProfile,
  styleProfile: ForestStyleProfile
): ForestTreesConfig {
  const nextRandomValue = randomFromSeed(seed + TREES_SEED_SUFFIX);
  const treeCountDraw = BASE_TREE_COUNT + Math.floor(nextRandomValue() * TREE_COUNT_SPREAD);
  const speciesMixRoll = nextRandomValue();
  const scaleMinimumRoll = nextRandomValue();
  const scaleMaximumRoll = nextRandomValue();
  const tintStrengthRoll = nextRandomValue();
  const windStrengthRoll = nextRandomValue();
  const windDirectionRoll = nextRandomValue();
  const gustFrequencyRoll = nextRandomValue();

  const seasonKind = season.kind ?? FOREST_SEASON_SPRING;
  const countDesktop = clampInteger(
    treeCountDraw * TREE_COUNT_MULTIPLIERS_BY_SEASON[seasonKind] * styleProfile.treeCountMultiplier,
    MINIMUM_TREE_COUNT,
    MAXIMUM_TREE_COUNT
  );
  const mixes = TREE_SPECIES_MIXES_BY_SEASON[seasonKind];
  const mixIndex = Math.floor(speciesMixRoll * mixes.length);

  return {
    placementSeed: seed + TREE_PLACEMENT_SEED_SUFFIX,
    countDesktop,
    countMobile: Math.floor(countDesktop * MOBILE_TREE_FRACTION),
    speciesMix: mixes[mixIndex].map((entry) => ({ ...entry })),
    // Both ends scale together, so a style changes how big the trees are
    // without changing how VARIED they are.
    scaleMin: roundToTwoDecimals(
      (TREE_SCALE_MINIMUM_BASE + scaleMinimumRoll * TREE_SCALE_MINIMUM_RANGE) * styleProfile.treeScaleMultiplier
    ),
    scaleMax: roundToTwoDecimals(
      (TREE_SCALE_MAXIMUM_BASE + scaleMaximumRoll * TREE_SCALE_MAXIMUM_RANGE) * styleProfile.treeScaleMultiplier
    ),
    foliageTintStrength: roundToTwoDecimals(FOLIAGE_TINT_STRENGTH_BASE + tintStrengthRoll * FOLIAGE_TINT_STRENGTH_RANGE),
    windStrength: roundToTwoDecimals(
      clampNumber(
        (WIND_STRENGTH_BASE + windStrengthRoll * WIND_STRENGTH_RANGE) * moodProfile.windMultiplier,
        MINIMUM_WIND_STRENGTH,
        MAXIMUM_WIND_STRENGTH
      )
    ),
    windDirectionRadians: roundToTwoDecimals(windDirectionRoll * FULL_CIRCLE_RADIANS),
    windGustFrequency: roundToTwoDecimals(WIND_GUST_FREQUENCY_BASE + gustFrequencyRoll * WIND_GUST_FREQUENCY_RANGE)
  };
}

// Draw order: weather kind roll, intensity, cloud coverage. Rain/snow particle
// counts derive from intensity (no extra draws) and stay zero unless the kind
// matches.
function buildPreviewWeatherConfig(seed: string, season: ForestSeasonConfig): ForestWeatherConfig {
  const nextRandomValue = randomFromSeed(seed + WEATHER_SEED_SUFFIX);
  const kindRoll = nextRandomValue();
  const intensityRoll = nextRandomValue();
  const cloudCoverageRoll = nextRandomValue();

  const seasonKind = season.kind ?? FOREST_SEASON_SPRING;
  const kind = weatherKindForRoll(kindRoll, WEATHER_WEIGHTS_BY_SEASON[seasonKind]);
  const intensity = roundToTwoDecimals(WEATHER_INTENSITY_BASE + intensityRoll * WEATHER_INTENSITY_RANGE);
  const cloudBounds = CLOUD_COVERAGE_BOUNDS_BY_WEATHER_KIND[kind];
  const config: ForestWeatherConfig = {
    kind,
    intensity,
    cloudCoverage: roundToTwoDecimals(cloudBounds.minimum + cloudCoverageRoll * (cloudBounds.maximum - cloudBounds.minimum)),
    rainDropCountDesktop: 0,
    rainDropCountMobile: 0,
    snowflakeCountDesktop: 0,
    snowflakeCountMobile: 0
  };
  if (kind === FOREST_WEATHER_RAIN) {
    const desktopDropCount = Math.floor(BASE_RAIN_DROP_COUNT + intensity * RAIN_DROP_COUNT_RANGE);
    config.rainDropCountDesktop = desktopDropCount;
    config.rainDropCountMobile = Math.floor(desktopDropCount * MOBILE_RAIN_FRACTION);
  }
  if (kind === FOREST_WEATHER_SNOW) {
    const desktopFlakeCount = Math.floor(BASE_SNOWFLAKE_COUNT + intensity * SNOWFLAKE_COUNT_RANGE);
    config.snowflakeCountDesktop = desktopFlakeCount;
    config.snowflakeCountMobile = Math.floor(desktopFlakeCount * MOBILE_SNOW_FRACTION);
  }
  return config;
}

// Draw order: 3 ground slots × (species, count, speed, scale), then 2 flock
// slots × (bird count, altitude base, altitude span, speed, pattern). Every
// slot is always drawn (fixed PRNG consumption); the season/mood-scaled
// active count only gates how many drawn slots become config entries.
function buildPreviewWildlifeConfig(
  seed: string,
  season: ForestSeasonConfig,
  moodProfile: ForestMoodProfile
): ForestWildlifeConfig {
  const nextRandomValue = randomFromSeed(seed + WILDLIFE_SEED_SUFFIX);
  const groundDraws = Array.from({ length: MAXIMUM_GROUND_ANIMAL_SLOTS }, () => ({
    speciesRoll: nextRandomValue(),
    countDraw: Math.floor(nextRandomValue() * GROUND_ANIMAL_COUNT_SPREAD),
    speedRoll: nextRandomValue(),
    scaleRoll: nextRandomValue()
  }));
  const flockDraws = Array.from({ length: MAXIMUM_BIRD_FLOCK_SLOTS }, () => ({
    birdCountDraw: Math.floor(nextRandomValue() * BIRDS_PER_FLOCK_SPREAD),
    altitudeBaseRoll: nextRandomValue(),
    altitudeSpanRoll: nextRandomValue(),
    speedRoll: nextRandomValue(),
    patternRoll: nextRandomValue()
  }));

  const seasonKind = season.kind ?? FOREST_SEASON_SPRING;
  const activeGroundSlots = clampInteger(
    Math.round(BASE_GROUND_ANIMAL_SLOTS_BY_SEASON[seasonKind] * moodProfile.wildlifeMultiplier),
    0,
    MAXIMUM_GROUND_ANIMAL_SLOTS
  );
  const activeFlockSlots = clampInteger(
    Math.round(BASE_BIRD_FLOCKS_BY_SEASON[seasonKind] * moodProfile.wildlifeMultiplier),
    0,
    MAXIMUM_BIRD_FLOCK_SLOTS
  );

  const speciesForSeason = GROUND_ANIMAL_SPECIES_BY_SEASON[seasonKind];
  const usedSpecies = new Set<string>();
  const groundAnimals: ForestGroundAnimalConfig[] = [];
  for (let slot = 0; slot < activeGroundSlots; slot += 1) {
    const draw = groundDraws[slot];
    let speciesIndex = Math.floor(draw.speciesRoll * speciesForSeason.length);
    // Deterministic dedupe walk: step forward until an unused species is
    // found; after the list is exhausted repeats are allowed.
    for (let attempt = 0; attempt < speciesForSeason.length && usedSpecies.has(speciesForSeason[speciesIndex]); attempt += 1) {
      speciesIndex = (speciesIndex + 1) % speciesForSeason.length;
    }
    const speciesKey = speciesForSeason[speciesIndex];
    usedSpecies.add(speciesKey);
    groundAnimals.push({
      modelKey: speciesKey,
      count: GROUND_ANIMAL_COUNT_BASE + draw.countDraw,
      pathSeed: `${seed}-forest-animal-${slot}`,
      walkSpeed: roundToTwoDecimals(WALK_SPEED_BASE + draw.speedRoll * WALK_SPEED_RANGE),
      scale: roundToTwoDecimals(ANIMAL_SCALE_BASE + draw.scaleRoll * ANIMAL_SCALE_RANGE)
    });
  }

  const birdFlocks: ForestBirdFlockConfig[] = [];
  for (let slot = 0; slot < activeFlockSlots; slot += 1) {
    const draw = flockDraws[slot];
    const altitudeMin = roundToTwoDecimals(BIRD_ALTITUDE_BASE + draw.altitudeBaseRoll * BIRD_ALTITUDE_BASE_RANGE);
    birdFlocks.push({
      modelKey: MODEL_KEY_BIRD_FOREST,
      birdCount: BIRDS_PER_FLOCK_BASE + draw.birdCountDraw,
      pathSeed: `${seed}-forest-birds-${slot}`,
      altitudeMin,
      altitudeMax: roundToTwoDecimals(altitudeMin + BIRD_ALTITUDE_SPAN_BASE + draw.altitudeSpanRoll * BIRD_ALTITUDE_SPAN_RANGE),
      flightSpeed: roundToTwoDecimals(FLIGHT_SPEED_BASE + draw.speedRoll * FLIGHT_SPEED_RANGE),
      pattern: draw.patternRoll < CIRCLING_PATTERN_PROBABILITY ? FOREST_BIRD_PATTERN_CIRCLING : FOREST_BIRD_PATTERN_CROSSING
    });
  }

  return { groundAnimals, birdFlocks };
}

// Draw order: leaf count, petal count, firefly count, snow-dust count — all
// four always drawn; the season (and dusk, for fireflies) gates which one
// lands in the config.
function buildPreviewAmbientParticlesConfig(
  seed: string,
  season: ForestSeasonConfig,
  lighting: ForestLightingConfig
): ForestAmbientParticlesConfig {
  const nextRandomValue = randomFromSeed(seed + AMBIENT_SEED_SUFFIX);
  const fallingLeafDraw = BASE_FALLING_LEAF_COUNT + Math.floor(nextRandomValue() * FALLING_LEAF_COUNT_SPREAD);
  const blossomPetalDraw = BASE_BLOSSOM_PETAL_COUNT + Math.floor(nextRandomValue() * BLOSSOM_PETAL_COUNT_SPREAD);
  const fireflyDraw = BASE_FIREFLY_COUNT + Math.floor(nextRandomValue() * FIREFLY_COUNT_SPREAD);
  const snowDustDraw = BASE_SNOW_DUST_COUNT + Math.floor(nextRandomValue() * SNOW_DUST_COUNT_SPREAD);

  const config: ForestAmbientParticlesConfig = {
    fallingLeafCount: 0,
    blossomPetalCount: 0,
    fireflyCount: 0,
    snowDustCount: 0
  };
  switch (season.kind) {
    case FOREST_SEASON_AUTUMN:
      config.fallingLeafCount = fallingLeafDraw;
      break;
    case FOREST_SEASON_SPRING:
      config.blossomPetalCount = blossomPetalDraw;
      break;
    case FOREST_SEASON_SUMMER:
      if (lighting.timeOfDay === FOREST_TIME_OF_DAY_DUSK) {
        config.fireflyCount = fireflyDraw;
      }
      break;
    case FOREST_SEASON_WINTER:
      config.snowDustCount = snowDustDraw;
      break;
  }
  return config;
}

// Draw order per landmark: kind roll, angle jitter, radius. The first
// landmark is always the heart tree; accent colors cycle
// secondary/accent/primary exactly like universe planets.
function buildPreviewLandmarkConfigs(
  seed: string,
  landmarkNames: string[],
  clearingRadius: number,
  primaryColor: string,
  secondaryColor: string
): ForestLandmarkConfig[] {
  const nextRandomValue = randomFromSeed(seed + LANDMARKS_SEED_SUFFIX);
  const usedKinds = new Set<string>();
  return landmarkNames.map((landmarkName, index) => {
    const kindRoll = nextRandomValue();
    const angleJitterRoll = nextRandomValue();
    const radiusRoll = nextRandomValue();

    let kind = FOREST_LANDMARK_HEART_TREE;
    if (index > 0) {
      let kindIndex = Math.floor(kindRoll * NON_HERO_LANDMARK_KINDS.length);
      for (
        let attempt = 0;
        attempt < NON_HERO_LANDMARK_KINDS.length && usedKinds.has(NON_HERO_LANDMARK_KINDS[kindIndex]);
        attempt += 1
      ) {
        kindIndex = (kindIndex + 1) % NON_HERO_LANDMARK_KINDS.length;
      }
      kind = NON_HERO_LANDMARK_KINDS[kindIndex];
    }
    usedKinds.add(kind);

    let accentColor = secondaryColor;
    if (index % LANDMARK_COLOR_CYCLE_LENGTH === 1) {
      accentColor = FOREST_PALETTE_ACCENT_COLOR;
    } else if (index % LANDMARK_COLOR_CYCLE_LENGTH === 2) {
      accentColor = primaryColor;
    }

    const baseAngle = (FULL_CIRCLE_RADIANS / landmarkNames.length) * index;
    return {
      key: `preview-landmark-${index + 1}`,
      name: landmarkName,
      kind,
      angleRadians: roundToTwoDecimals(baseAngle + (angleJitterRoll - 0.5) * 2 * LANDMARK_ANGLE_JITTER_RADIANS),
      radiusFromCenter: roundToTwoDecimals(
        clearingRadius * (LANDMARK_RADIUS_FRACTION_BASE + radiusRoll * LANDMARK_RADIUS_FRACTION_RANGE)
      ),
      accentColor,
      energy: Math.min(MAXIMUM_LANDMARK_ENERGY, FIRST_LANDMARK_ENERGY + index * LANDMARK_ENERGY_STEP)
    };
  });
}

// Collects every model key the config references, in a deterministic
// first-use order, so a future asset preloader can walk one list.
function buildPreviewAssetsConfig(
  lighting: ForestLightingConfig,
  trees: ForestTreesConfig,
  wildlife: ForestWildlifeConfig,
  landmarks: ForestLandmarkConfig[]
) {
  const seenKeys = new Set<string>();
  const modelKeys: string[] = [];
  const appendKey = (key?: string) => {
    if (!key || seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    modelKeys.push(key);
  };
  for (const entry of trees.speciesMix ?? []) {
    appendKey(entry.modelKey);
  }
  appendKey(MODEL_KEY_ROCK_MOSSY);
  for (const animal of wildlife.groundAnimals ?? []) {
    appendKey(animal.modelKey);
  }
  for (const flock of wildlife.birdFlocks ?? []) {
    appendKey(flock.modelKey);
  }
  for (const landmark of landmarks) {
    appendKey(landmark.kind ? LANDMARK_MODEL_KEYS_BY_KIND[landmark.kind] : undefined);
  }
  return {
    catalogVersion: FOREST_ASSET_CATALOG_VERSION,
    modelKeys,
    hdriKey: lighting.hdriKey
  };
}

/**
 * The forest counterpart of buildPreviewSceneConfig: a full ForestSceneConfig
 * built locally from the form inputs, rendered by the SAME ForestRenderer the
 * real world uses. Same seed derivation as the universe preview; per-section
 * streams and draw orders mirror the Go builder exactly.
 */
export function buildPreviewForestSceneConfig(input: PreviewSceneInput): SceneConfig {
  const seed = previewSeedFromInputs(input);
  const moodProfile = forestProfileForMood(input.mood);
  // An unknown or absent style resolves to the neutral profile, which is a
  // no-op in every field — mirroring forest_style_profile.go exactly.
  const styleProfile = forestProfileForStyle(input.preferredWorldStyle);

  const primaryColor = input.favoriteColors[0] ?? DEFAULT_FOREST_PRIMARY_COLOR;
  const secondaryColor = input.favoriteColors[1] ?? DEFAULT_FOREST_SECONDARY_COLOR;

  // The backend mock names its landmarks from interests then traits (3-7),
  // exactly like universe planets — reuse the shared source-name mirror.
  const landmarkNames = previewPlanetNames(input.interests, input.traits);

  const season = buildPreviewSeasonConfig(seed, moodProfile);
  const { lighting, bloomIntensity } = buildPreviewLightingConfig(seed, season, moodProfile, styleProfile);
  const { terrain, cameraDistance } = buildPreviewTerrainConfig(seed);
  const trees = buildPreviewTreesConfig(seed, season, moodProfile, styleProfile);
  const weather = buildPreviewWeatherConfig(seed, season);
  const wildlife = buildPreviewWildlifeConfig(seed, season, moodProfile);
  const ambientParticles = buildPreviewAmbientParticlesConfig(seed, season, lighting);
  const landmarks = buildPreviewLandmarkConfigs(
    seed,
    landmarkNames,
    terrain.clearingRadius ?? MINIMUM_CLEARING_RADIUS,
    primaryColor,
    secondaryColor
  );

  return {
    seed,
    schemaVersion: FOREST_PREVIEW_SCHEMA_VERSION,
    sceneType: FOREST_SCENE_TYPE,
    theme: input.preferredWorldStyle,
    palette: {
      background: BACKGROUND_COLORS_BY_SEASON[season.kind ?? FOREST_SEASON_SPRING],
      primary: primaryColor,
      secondary: secondaryColor,
      accent: FOREST_PALETTE_ACCENT_COLOR,
      gradient: [primaryColor, secondaryColor, FOREST_PALETTE_ACCENT_COLOR]
    },
    season,
    lighting,
    terrain,
    trees,
    weather,
    wildlife,
    ambientParticles,
    landmarks,
    camera: { distance: cameraDistance, fov: FOREST_CAMERA_FIELD_OF_VIEW },
    postFX: {
      bloomIntensity,
      // The grade is a per-season table lookup (no PRNG draw), so two forests
      // in the same season always grade identically.
      grade: addGrade(FOREST_GRADES_BY_SEASON[season.kind ?? FOREST_SEASON_SPRING], styleProfile.grade)
    },
    hud: { showTraitBars: true, showLabels: true },
    assets: buildPreviewAssetsConfig(lighting, trees, wildlife, landmarks)
  };
}

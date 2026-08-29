import type {
  OceanBioluminescenceConfig,
  OceanCurrentConfig,
  OceanDepthConfig,
  OceanDrifterConfig,
  OceanFaunaConfig,
  OceanFishSchoolConfig,
  OceanFloraConfig,
  OceanFloraSpeciesMixEntry,
  OceanGiantConfig,
  OceanLandmarkConfig,
  OceanLightingConfig,
  OceanSeafloorConfig,
  OceanWaterConfig,
  ScenePostFXGradeConfig,
  SceneConfig
} from "./types";
import { OCEAN_SCENE_TYPE, previewPlanetNames, previewSeedFromInputs, randomFromSeed, type PreviewSceneInput } from "./scene";
import { clampNumber, depthAt, roundToHundredths, roundToThousandths } from "./oceanDepthCurve";

// --- Ocean live preview ------------------------------------------------------
//
// The frontend mirror of ocean-service's deterministic builder. It is the
// mirror pair of services/ocean-service/internal/services/
// ocean_scene_profile.go + ocean_config_builder.go: same tables, same
// per-section seed streams, same fixed draw order — keep the two in sync (the
// scene.ts <-> universe-service and forestScene.ts <-> nature-service
// discipline).
//
// The PRNG here is the frontend's xorshift (randomFromSeed), not Go's FNV-64a
// into math/rand, so the SEEDED values are plausible rather than byte-equal —
// exactly as the forest preview is. What IS byte-equal, and pinned by
// oceanDepthCurve.test.ts against the Go builder's own golden fixtures, is
// everything the depth curve produces: the water, the ambient and key light,
// the god rays and the caustics. Those are the values a visitor would notice
// the preview lying about, and they are the ones that are actually duplicated
// logic rather than a duplicated table.

// Mirrors oceanSchemaVersion in ocean_config_builder.go.
export const OCEAN_PREVIEW_SCHEMA_VERSION = "1.4";

// Depth zones, in canonical order from the surface down. Both boundaries are
// physical constants of the depth curve rather than round numbers: the sunlit
// shallows end where orange dies (40 m) and the twilight reach ends at the
// sunlight floor (1000 m).
export const OCEAN_ZONE_SUNLIT_SHALLOWS = "sunlitShallows";
export const OCEAN_ZONE_TWILIGHT_REACH = "twilightReach";
export const OCEAN_ZONE_ABYSS = "abyss";
const ZONE_KINDS_IN_ORDER = [OCEAN_ZONE_SUNLIT_SHALLOWS, OCEAN_ZONE_TWILIGHT_REACH, OCEAN_ZONE_ABYSS];

const TWILIGHT_REACH_TOP_METRES = 40;
const ABYSS_TOP_METRES = 1000;

export function oceanZoneForDepth(metres: number): string {
  if (metres < TWILIGHT_REACH_TOP_METRES) {
    return OCEAN_ZONE_SUNLIT_SHALLOWS;
  }
  if (metres < ABYSS_TOP_METRES) {
    return OCEAN_ZONE_TWILIGHT_REACH;
  }
  return OCEAN_ZONE_ABYSS;
}

const DEPTH_BAND_BY_ZONE: Record<string, { minimum: number; maximum: number }> = {
  [OCEAN_ZONE_SUNLIT_SHALLOWS]: { minimum: 3, maximum: 28 },
  [OCEAN_ZONE_TWILIGHT_REACH]: { minimum: 45, maximum: 170 },
  [OCEAN_ZONE_ABYSS]: { minimum: 1050, maximum: 3800 }
};

// The water BELOW the viewer, mirroring floorClearanceBandByZone in
// ocean_scene_profile.go. A reef sits on the shelf with the bottom right there;
// the twilight zone is open water above an abyssal plain kilometres down and
// shows no floor; abyssal worlds sit ON the bottom, because the vents, whale
// falls and tubeworm fields that make the abyss worth drawing are all there.
const FLOOR_CLEARANCE_BAND_BY_ZONE: Record<string, { minimum: number; maximum: number }> = {
  [OCEAN_ZONE_SUNLIT_SHALLOWS]: { minimum: 2, maximum: 14 },
  [OCEAN_ZONE_TWILIGHT_REACH]: { minimum: 1900, maximum: 3900 },
  // Kept inside the ~12 m visibility of the abyss. A wider band silently turns
  // "this world sits on the seabed" into "this world sits just too far above
  // the seabed to see it", which is exactly what shipped first.
  [OCEAN_ZONE_ABYSS]: { minimum: 2, maximum: 9 }
};

export const OCEAN_CURRENT_STILL = "still";
export const OCEAN_CURRENT_DRIFT = "drift";
export const OCEAN_CURRENT_SURGE = "surge";

export const OCEAN_LANDMARK_KELP_CATHEDRAL = "kelpCathedral";
export const OCEAN_LANDMARK_SUNKEN_RELIC = "sunkenRelic";
export const OCEAN_LANDMARK_HYDROTHERMAL_VENT = "hydrothermalVent";
export const OCEAN_LANDMARK_CORAL_GARDEN = "coralGarden";
export const OCEAN_LANDMARK_ABYSSAL_TRENCH = "abyssalTrench";
export const OCEAN_LANDMARK_WHALE_FALL = "whaleFall";
const NON_HERO_LANDMARK_KINDS = [
  OCEAN_LANDMARK_SUNKEN_RELIC,
  OCEAN_LANDMARK_HYDROTHERMAL_VENT,
  OCEAN_LANDMARK_CORAL_GARDEN,
  OCEAN_LANDMARK_ABYSSAL_TRENCH,
  OCEAN_LANDMARK_WHALE_FALL
];

export const MODEL_KEY_FLORA_KELP_GIANT = "flora-kelp-giant";
export const MODEL_KEY_FLORA_SEAGRASS = "flora-seagrass";
export const MODEL_KEY_FLORA_CORAL_BRAIN = "flora-coral-brain";
export const MODEL_KEY_FLORA_CORAL_STAGHORN = "flora-coral-staghorn";
export const MODEL_KEY_FLORA_CORAL_SOFT = "flora-coral-soft";
export const MODEL_KEY_FLORA_ANEMONE = "flora-anemone";
export const MODEL_KEY_FLORA_TUBEWORM = "flora-tubeworm";
export const MODEL_KEY_FLORA_GLASS_SPONGE = "flora-glass-sponge";
export const MODEL_KEY_FLORA_SEA_PEN = "flora-sea-pen";

export const MODEL_KEY_FISH_REEF_SCHOOL = "fish-reef-school";
export const MODEL_KEY_FISH_SILVERSIDE = "fish-silverside";
export const MODEL_KEY_FISH_BARRACUDA = "fish-barracuda";
export const MODEL_KEY_FISH_RAY = "fish-ray";
export const MODEL_KEY_FISH_LANTERNFISH = "fish-lanternfish";
export const MODEL_KEY_FISH_HATCHETFISH = "fish-hatchetfish";

export const MODEL_KEY_DRIFTER_MOON_JELLY = "drifter-moon-jelly";
export const MODEL_KEY_DRIFTER_COMB_JELLY = "drifter-comb-jelly";
export const MODEL_KEY_DRIFTER_SIPHONOPHORE = "drifter-siphonophore";

export const MODEL_KEY_GIANT_MANTA = "giant-manta";
export const MODEL_KEY_GIANT_WHALE_SHARK = "giant-whale-shark";
export const MODEL_KEY_GIANT_HUMPBACK = "giant-humpback";
export const MODEL_KEY_GIANT_SPERM_WHALE = "giant-sperm-whale";

export const MODEL_KEY_ROCK_BASALT = "rock-basalt";

export const OCEAN_LANDMARK_MODEL_KEYS_BY_KIND: Record<string, string> = {
  [OCEAN_LANDMARK_KELP_CATHEDRAL]: "landmark-kelp-cathedral",
  [OCEAN_LANDMARK_SUNKEN_RELIC]: "landmark-sunken-relic",
  [OCEAN_LANDMARK_HYDROTHERMAL_VENT]: "landmark-hydrothermal-vent",
  [OCEAN_LANDMARK_CORAL_GARDEN]: "landmark-coral-garden",
  [OCEAN_LANDMARK_ABYSSAL_TRENCH]: "landmark-abyssal-trench",
  [OCEAN_LANDMARK_WHALE_FALL]: "landmark-whale-fall"
};

const OCEAN_ASSET_CATALOG_VERSION = "ocean-1";

// Mirrors oceanMoodProfile in ocean_scene_profile.go.
//
// `zone` is a HOME, not an absolute pin — and that has been true twice.
//
// It started as a `zoneWeights` triple — a probability per zone — so that
// repeated generations would vary. What it produced was a control that lies:
// the create form labels these four options DEPTH & MOOD and names them after
// depths, so choosing "The Abyss" and getting a view of the water surface (5%
// of the time: 15% weight on the shallows times a one-in-three breach) is not
// variety, it is the control not working. The fix was to pin zone absolutely.
//
// Once that shipped, the opposite complaint arrived: every generation of the
// same mood came out at the same depth. So zone is a weighted home again — see
// OCEAN_ZONE_DRIFT_WEIGHTS_BY_MOOD — built so it cannot reproduce the original
// bug: drift is adjacent-zone-only, the direction that recreated the bug is a
// hard zero rather than a small number.
//
// aboveWaterProbability got the same correction one step later, for the
// identical reason: it used to be a plain boolean, absolutely pinned, so
// "Glass Shallows" surfaced every single seed. That kept every generation of it
// the same photograph, exactly the complaint the zone pin drew the first
// time — it was pinned longer because it is also this family's default mood,
// so it is the first view most people see, but the complaint applies to it
// too. It is now a weighted roll like the zone is: MOSTLY the surface, so the
// default first view still usually is one, and otherwise the calm shallow sea
// it sits above (never Reef Crest's rougher reading — the two keep their own
// current/fauna multipliers). No other mood's probability moved.
type OceanMoodProfile = {
  zone: string;
  aboveWaterProbability: number;
  currentMultiplier: number;
  faunaMultiplier: number;
  bloomMultiplier: number;
};

// Twilight because it is the middle of the axis and unambiguously underwater: an
// unknown mood should get the most ordinary ocean there is, not an edge.
const NEUTRAL_OCEAN_PROFILE: OceanMoodProfile = {
  zone: OCEAN_ZONE_TWILIGHT_REACH,
  aboveWaterProbability: 0,
  currentMultiplier: 1.0,
  faunaMultiplier: 1.0,
  bloomMultiplier: 1.0
};

// Four moods across an axis with three zones and a negative half, which is what
// makes the table square without inventing anything: three depths under the
// water and one above it.
//
//   focused    Glass Shallows       MOSTLY the sea from the air, sometimes the
//                                   calm shallow water beneath it — this mood
//                                   already had the calmest wind of the four,
//                                   above or below
//   energetic  Reef Crest           the shallows, floor in frame, most fauna,
//                                   surge
//   dreamy     Mesophotic Current   the twilight reach: midwater, no floor,
//                                   drifting
//   reflective The Abyss            on the bottom, kilometres down, one light
const OCEAN_MOOD_PROFILES: Record<string, OceanMoodProfile> = {
  focused: {
    zone: OCEAN_ZONE_SUNLIT_SHALLOWS,
    aboveWaterProbability: 0.7,
    currentMultiplier: 0.75,
    faunaMultiplier: 0.8,
    bloomMultiplier: 1.0
  },
  energetic: {
    zone: OCEAN_ZONE_SUNLIT_SHALLOWS,
    aboveWaterProbability: 0,
    currentMultiplier: 1.35,
    faunaMultiplier: 1.35,
    bloomMultiplier: 1.15
  },
  dreamy: {
    zone: OCEAN_ZONE_TWILIGHT_REACH,
    aboveWaterProbability: 0,
    currentMultiplier: 0.85,
    // Lowest of the four, not the highest: the twilight reach has no sun and
    // no single deliberate light the way the abyss does, so there is no
    // legitimate highlight for bloom to bracket — it was previously the
    // highest multiplier in this table (1.35), which bracketed ordinary
    // specular glints (wave-surface Snell's-window glints, god-ray hot spots)
    // into a full-screen sunburst at a depth that is supposed to read as dim.
    bloomMultiplier: 0.55,
    faunaMultiplier: 1.0
  },
  reflective: {
    zone: OCEAN_ZONE_ABYSS,
    aboveWaterProbability: 0,
    currentMultiplier: 0.7,
    faunaMultiplier: 0.75,
    // Higher than dreamy on purpose: "one light" is the whole point of this
    // mood, and bloom is what makes that one light read as a light.
    bloomMultiplier: 0.85
  }
};

function oceanProfileForMood(mood: string): OceanMoodProfile {
  return OCEAN_MOOD_PROFILES[mood.trim().toLowerCase()] ?? NEUTRAL_OCEAN_PROFILE;
}

// --- World style -------------------------------------------------------------
//
// Mirrors ocean_style_profile.go one-for-one. In this family MOOD owns depth —
// each of the four moods names a zone — so style owns the other thing an ocean
// is: THE WATER, and what grows and swims in it.
//
// waterClarityBias shifts the water-type roll before it indexes the zone own
// candidate list: negative is clearer, positive is more turbid. It cannot reach
// water the ZONE does not offer.
export const OCEAN_STYLE_OPEN_WATER = "open-water";
export const OCEAN_STYLE_CORAL_GARDEN = "coral-garden";
export const OCEAN_STYLE_KELP_CATHEDRAL = "kelp-cathedral";
export const OCEAN_STYLE_CRYSTAL_SHOAL = "crystal-shoal";
export const OCEAN_STYLE_SILT_DRIFT = "silt-drift";

type OceanStyleProfile = {
  waterClarityBias: number;
  floraMultiplier: number;
  faunaMultiplier: number;
  bloomMultiplier: number;
  marineSnowMultiplier: number;
  grade: ScenePostFXGradeConfig;
};

const NEUTRAL_OCEAN_GRADE: ScenePostFXGradeConfig = { hueRadians: 0, saturation: 0, brightness: 0, contrast: 0 };

// Exactly neutral, and it has to stay that way: these are the numbers an ocean
// with no style gets, and they are what keeps the backend golden fixtures valid
// for every world stored before styles existed.
const NEUTRAL_OCEAN_STYLE_PROFILE: OceanStyleProfile = {
  waterClarityBias: 0,
  floraMultiplier: 1.0,
  faunaMultiplier: 1.0,
  bloomMultiplier: 1.0,
  marineSnowMultiplier: 1.0,
  grade: NEUTRAL_OCEAN_GRADE
};

const OCEAN_STYLE_PROFILES: Record<string, OceanStyleProfile> = {
  [OCEAN_STYLE_OPEN_WATER]: NEUTRAL_OCEAN_STYLE_PROFILE,
  [OCEAN_STYLE_CORAL_GARDEN]: {
    waterClarityBias: -0.2,
    floraMultiplier: 1.6,
    faunaMultiplier: 1.25,
    bloomMultiplier: 1.05,
    marineSnowMultiplier: 0.85,
    grade: { hueRadians: -0.02, saturation: 0.14, brightness: 0, contrast: 0.04 }
  },
  [OCEAN_STYLE_KELP_CATHEDRAL]: {
    waterClarityBias: 0.28,
    floraMultiplier: 2.0,
    faunaMultiplier: 0.85,
    bloomMultiplier: 1.2,
    marineSnowMultiplier: 1.15,
    grade: { hueRadians: 0.05, saturation: 0.06, brightness: -0.03, contrast: 0.06 }
  },
  [OCEAN_STYLE_CRYSTAL_SHOAL]: {
    waterClarityBias: -0.45,
    floraMultiplier: 0.45,
    faunaMultiplier: 1.45,
    bloomMultiplier: 1.25,
    marineSnowMultiplier: 0.55,
    grade: { hueRadians: 0.02, saturation: -0.05, brightness: 0.05, contrast: -0.03 }
  },
  [OCEAN_STYLE_SILT_DRIFT]: {
    waterClarityBias: 0.5,
    floraMultiplier: 0.7,
    faunaMultiplier: 0.65,
    bloomMultiplier: 0.85,
    marineSnowMultiplier: 1.8,
    grade: { hueRadians: 0.04, saturation: -0.16, brightness: -0.04, contrast: -0.06 }
  }
};

function oceanProfileForStyle(style: string): OceanStyleProfile {
  return OCEAN_STYLE_PROFILES[style.trim().toLowerCase()] ?? NEUTRAL_OCEAN_STYLE_PROFILE;
}

/**
 * Layers a style grade offset on the zone one. Both are offsets from neutral,
 * and every field is optional because the FE mirrors the BE JSON contract,
 * where an older stored world may simply not carry one.
 */
function addGrade(base: ScenePostFXGradeConfig, overlay: ScenePostFXGradeConfig): ScenePostFXGradeConfig {
  return {
    hueRadians: (base.hueRadians ?? 0) + (overlay.hueRadians ?? 0),
    saturation: (base.saturation ?? 0) + (overlay.saturation ?? 0),
    brightness: (base.brightness ?? 0) + (overlay.brightness ?? 0),
    contrast: (base.contrast ?? 0) + (overlay.contrast ?? 0)
  };
}

// Mirrors oceanZoneDriftWeights / oceanZoneDriftWeightsByMood in
// ocean_scene_profile.go. Weights are relative (see zoneForDriftRoll); a
// weight left at 0 is a wall the drift may not cross, not a rounding
// artefact.
type OceanZoneDriftWeights = {
  shallow: number;
  twilight: number;
  abyss: number;
};

// Every table biases toward the shallow end, and the zone that would
// recreate the original bug is exactly 0, not merely small: Reef Crest can
// drift into the twilight reach but never the abyss, and The Abyss can drift
// into the twilight reach but never the shallows.
const OCEAN_ZONE_DRIFT_WEIGHTS_BY_MOOD: Record<string, OceanZoneDriftWeights> = {
  energetic: { shallow: 0.75, twilight: 0.25, abyss: 0.0 },
  dreamy: { shallow: 0.3, twilight: 0.55, abyss: 0.15 },
  reflective: { shallow: 0.0, twilight: 0.3, abyss: 0.7 }
};

const NEUTRAL_ZONE_DRIFT_WEIGHTS: OceanZoneDriftWeights = { shallow: 0.3, twilight: 0.55, abyss: 0.15 };

// Mirrors driftZone in ocean_config_builder.go. A mood that can ever surface
// is exempt from zone drift entirely: "Glass Shallows" is a calm shallow sea
// whether shown from above the water or just under it, so its zone stays
// pinned to its home rather than roaming through the twilight reach and the
// abyss too — only whether it surfaces is a roll (aboveWaterProbability).
function driftZone(mood: string, moodProfile: OceanMoodProfile, roll: number): string {
  if (moodProfile.aboveWaterProbability > 0) {
    return moodProfile.zone;
  }
  const weights = OCEAN_ZONE_DRIFT_WEIGHTS_BY_MOOD[mood.trim().toLowerCase()] ?? NEUTRAL_ZONE_DRIFT_WEIGHTS;
  const total = weights.shallow + weights.twilight + weights.abyss;
  if (total <= 0) {
    return moodProfile.zone;
  }
  let cumulative = weights.shallow;
  if (roll < cumulative / total) {
    return OCEAN_ZONE_SUNLIT_SHALLOWS;
  }
  cumulative += weights.twilight;
  if (roll < cumulative / total) {
    return OCEAN_ZONE_TWILIGHT_REACH;
  }
  return OCEAN_ZONE_ABYSS;
}

type WeightedCurrentKind = {
  kind: string;
  weight: number;
};

// Surge is a surface phenomenon: it is almost absent from the abyss because the
// energy driving it is.
const CURRENT_WEIGHTS_BY_ZONE: Record<string, WeightedCurrentKind[]> = {
  [OCEAN_ZONE_SUNLIT_SHALLOWS]: [
    { kind: OCEAN_CURRENT_STILL, weight: 0.15 },
    { kind: OCEAN_CURRENT_DRIFT, weight: 0.45 },
    { kind: OCEAN_CURRENT_SURGE, weight: 0.4 }
  ],
  [OCEAN_ZONE_TWILIGHT_REACH]: [
    { kind: OCEAN_CURRENT_STILL, weight: 0.3 },
    { kind: OCEAN_CURRENT_DRIFT, weight: 0.55 },
    { kind: OCEAN_CURRENT_SURGE, weight: 0.15 }
  ],
  [OCEAN_ZONE_ABYSS]: [
    { kind: OCEAN_CURRENT_STILL, weight: 0.62 },
    { kind: OCEAN_CURRENT_DRIFT, weight: 0.36 },
    { kind: OCEAN_CURRENT_SURGE, weight: 0.02 }
  ]
};

export const OCEAN_BACKGROUND_COLORS_BY_ZONE: Record<string, string> = {
  [OCEAN_ZONE_SUNLIT_SHALLOWS]: "#06283A",
  [OCEAN_ZONE_TWILIGHT_REACH]: "#041A2B",
  [OCEAN_ZONE_ABYSS]: "#01070F"
};

// The sunlit zone is the only one with reef-building corals and the only one
// where kelp reaches its full height, because both need light. The abyss has no
// photosynthetic life at all.
const FLORA_SPECIES_MIXES_BY_ZONE: Record<string, OceanFloraSpeciesMixEntry[][]> = {
  [OCEAN_ZONE_SUNLIT_SHALLOWS]: [
    [
      { modelKey: MODEL_KEY_FLORA_CORAL_STAGHORN, weight: 0.35 },
      { modelKey: MODEL_KEY_FLORA_CORAL_BRAIN, weight: 0.25 },
      { modelKey: MODEL_KEY_FLORA_ANEMONE, weight: 0.2 },
      { modelKey: MODEL_KEY_FLORA_SEAGRASS, weight: 0.2 }
    ],
    [
      { modelKey: MODEL_KEY_FLORA_KELP_GIANT, weight: 0.4 },
      { modelKey: MODEL_KEY_FLORA_SEAGRASS, weight: 0.3 },
      { modelKey: MODEL_KEY_FLORA_CORAL_STAGHORN, weight: 0.3 }
    ]
  ],
  [OCEAN_ZONE_TWILIGHT_REACH]: [
    [
      { modelKey: MODEL_KEY_FLORA_KELP_GIANT, weight: 0.45 },
      { modelKey: MODEL_KEY_FLORA_CORAL_SOFT, weight: 0.3 },
      { modelKey: MODEL_KEY_FLORA_ANEMONE, weight: 0.25 }
    ],
    [
      { modelKey: MODEL_KEY_FLORA_CORAL_SOFT, weight: 0.4 },
      { modelKey: MODEL_KEY_FLORA_SEA_PEN, weight: 0.35 },
      { modelKey: MODEL_KEY_FLORA_ANEMONE, weight: 0.25 }
    ]
  ],
  [OCEAN_ZONE_ABYSS]: [
    [
      { modelKey: MODEL_KEY_FLORA_TUBEWORM, weight: 0.45 },
      { modelKey: MODEL_KEY_FLORA_GLASS_SPONGE, weight: 0.35 },
      { modelKey: MODEL_KEY_FLORA_SEA_PEN, weight: 0.2 }
    ],
    [
      { modelKey: MODEL_KEY_FLORA_GLASS_SPONGE, weight: 0.5 },
      { modelKey: MODEL_KEY_FLORA_SEA_PEN, weight: 0.5 }
    ]
  ]
};

// Reordering or extending any list below shifts the species draw for existing
// seeds, because selection is floor(roll * length).
const FISH_SPECIES_BY_ZONE: Record<string, string[]> = {
  [OCEAN_ZONE_SUNLIT_SHALLOWS]: [
    MODEL_KEY_FISH_REEF_SCHOOL,
    MODEL_KEY_FISH_SILVERSIDE,
    MODEL_KEY_FISH_BARRACUDA,
    MODEL_KEY_FISH_RAY
  ],
  [OCEAN_ZONE_TWILIGHT_REACH]: [
    MODEL_KEY_FISH_SILVERSIDE,
    MODEL_KEY_FISH_LANTERNFISH,
    MODEL_KEY_FISH_RAY,
    MODEL_KEY_FISH_HATCHETFISH
  ],
  [OCEAN_ZONE_ABYSS]: [MODEL_KEY_FISH_LANTERNFISH, MODEL_KEY_FISH_HATCHETFISH]
};

const DRIFTER_SPECIES_BY_ZONE: Record<string, string[]> = {
  [OCEAN_ZONE_SUNLIT_SHALLOWS]: [MODEL_KEY_DRIFTER_MOON_JELLY, MODEL_KEY_DRIFTER_COMB_JELLY],
  [OCEAN_ZONE_TWILIGHT_REACH]: [
    MODEL_KEY_DRIFTER_MOON_JELLY,
    MODEL_KEY_DRIFTER_SIPHONOPHORE,
    MODEL_KEY_DRIFTER_COMB_JELLY
  ],
  [OCEAN_ZONE_ABYSS]: [MODEL_KEY_DRIFTER_SIPHONOPHORE, MODEL_KEY_DRIFTER_COMB_JELLY]
};

const GIANT_SPECIES_BY_ZONE: Record<string, string[]> = {
  [OCEAN_ZONE_SUNLIT_SHALLOWS]: [MODEL_KEY_GIANT_MANTA, MODEL_KEY_GIANT_WHALE_SHARK],
  [OCEAN_ZONE_TWILIGHT_REACH]: [MODEL_KEY_GIANT_HUMPBACK, MODEL_KEY_GIANT_MANTA],
  [OCEAN_ZONE_ABYSS]: [MODEL_KEY_GIANT_SPERM_WHALE]
};

const GIANT_PROBABILITY_BY_ZONE: Record<string, number> = {
  [OCEAN_ZONE_SUNLIT_SHALLOWS]: 0.45,
  [OCEAN_ZONE_TWILIGHT_REACH]: 0.35,
  [OCEAN_ZONE_ABYSS]: 0.22
};

const BASE_SCHOOL_SLOTS_BY_ZONE: Record<string, number> = {
  [OCEAN_ZONE_SUNLIT_SHALLOWS]: 2.8,
  [OCEAN_ZONE_TWILIGHT_REACH]: 2.0,
  [OCEAN_ZONE_ABYSS]: 1.0
};

const BASE_DRIFTER_SLOTS_BY_ZONE: Record<string, number> = {
  [OCEAN_ZONE_SUNLIT_SHALLOWS]: 1.0,
  [OCEAN_ZONE_TWILIGHT_REACH]: 1.8,
  [OCEAN_ZONE_ABYSS]: 2.0
};

const BASE_PLANKTON_COUNT_BY_ZONE: Record<string, number> = {
  [OCEAN_ZONE_SUNLIT_SHALLOWS]: 120,
  [OCEAN_ZONE_TWILIGHT_REACH]: 520,
  [OCEAN_ZONE_ABYSS]: 900
};

const PLANKTON_COUNT_SPREAD_BY_ZONE: Record<string, number> = {
  [OCEAN_ZONE_SUNLIT_SHALLOWS]: 121,
  [OCEAN_ZONE_TWILIGHT_REACH]: 321,
  [OCEAN_ZONE_ABYSS]: 501
};

export const OCEAN_BIOLUMINESCENCE_COLORS_BY_ZONE: Record<string, string[]> = {
  [OCEAN_ZONE_SUNLIT_SHALLOWS]: ["#8FF3D2", "#B6ECFF"],
  [OCEAN_ZONE_TWILIGHT_REACH]: ["#5EEAD4", "#67E8F9", "#A78BFA"],
  [OCEAN_ZONE_ABYSS]: ["#22D3EE", "#818CF8", "#4ADE80"]
};

const FLORA_DEPTH_TINT_BASE_BY_ZONE: Record<string, number> = {
  [OCEAN_ZONE_SUNLIT_SHALLOWS]: 0.3,
  [OCEAN_ZONE_TWILIGHT_REACH]: 0.5,
  [OCEAN_ZONE_ABYSS]: 0.7
};

// This used to be a bare table lookup with no PRNG draw at all — "two worlds
// in the same zone always grade identically." It is now the base a small
// per-world jitter (see GRADE_*_JITTER_RANGE below) applies on top of, mirrors
// oceanGradesByZone in ocean_scene_profile.go.
export const OCEAN_GRADES_BY_ZONE: Record<string, ScenePostFXGradeConfig> = {
  [OCEAN_ZONE_SUNLIT_SHALLOWS]: { hueRadians: 0.02, saturation: 0.14, brightness: 0.02, contrast: 0.05 },
  [OCEAN_ZONE_TWILIGHT_REACH]: { hueRadians: 0.04, saturation: 0.05, brightness: 0.03, contrast: 0.08 },
  [OCEAN_ZONE_ABYSS]: { hueRadians: 0.06, saturation: -0.1, brightness: 0.06, contrast: 0.12 }
};

// Small relative to the gap BETWEEN zones on every channel (saturation alone
// spans 0.24 across the axis) — enough that two worlds in the same zone are
// not the same photograph, not so much that a zone stops reading as a
// coherent look. Mirrors the gradeXJitterRange constants in
// ocean_scene_profile.go.
const GRADE_HUE_JITTER_RANGE = 0.015;
const GRADE_SATURATION_JITTER_RANGE = 0.03;
const GRADE_BRIGHTNESS_JITTER_RANGE = 0.015;
const GRADE_CONTRAST_JITTER_RANGE = 0.03;

const DEFAULT_OCEAN_PRIMARY_COLOR = "#8B5CF6";
const DEFAULT_OCEAN_SECONDARY_COLOR = "#06B6D4";
const OCEAN_PALETTE_ACCENT_COLOR = "#FACC15";

const FULL_CIRCLE_RADIANS = Math.PI * 2;

// Seed stream labels, prefixed "-ocean-" so no stream can collide with a forest
// or universe one.
// How far above the waterline an above-water world's viewer sits. Mirrors
// ocean-service's ocean_scene_profile.go.
//
// There is no longer a probability here. It used to be one in three, rolled for
// every shallow world, which made the sea-surface view a lottery: nobody could
// ask for it and the abyss could win it. It is now decided by the mood — see
// OCEAN_MOOD_PROFILES — and only the altitude is drawn.
//
// The band used to be 1.4-7.8 m, which put the camera inside the wave field:
// wind here reaches 13 m/s and Pierson-Moskowitz gives a 3.6 m significant
// height there, so at 4.5 m up the crests sit at eye level and the frame has no
// horizon in it. 4-24 m clears the roughest sea this family makes and reaches
// the height the surface actually composes at.
const MINIMUM_BREACH_ALTITUDE_METRES = 4;
const BREACH_ALTITUDE_RANGE_METRES = 20;

// THE BOUNDARY RULE: every ocean world must be able to see the surface or the
// floor. Water with neither is not a place, it is a colour — nothing to read
// scale or direction from, nothing for the light to land on. Mirrors
// ocean_scene_profile.go, where the reasoning is written out.
const SEAMOUNT_RISE_PROBABILITY = 0.5;
const MINIMUM_RISE_CLEARANCE_METRES = 18;
const RISE_CLEARANCE_RANGE_METRES = 34;
const BOUNDARY_SIGHT_MULTIPLIER = 1.5;

// Which water a zone can be made of. This is GEOGRAPHY, not depth: the
// turbidity that makes coastal water coastal is river outflow and resuspended
// sediment, and neither reaches the middle of an ocean. Mirrors
// ocean_water_optics.go.
const WATER_TYPES_BY_ZONE: Record<string, string[]> = {
  [OCEAN_ZONE_SUNLIT_SHALLOWS]: ["IB", "II", "III", "1C", "3C"],
  [OCEAN_ZONE_TWILIGHT_REACH]: ["I", "IA", "IB"],
  [OCEAN_ZONE_ABYSS]: ["I", "IA", "IB"]
};

const MINIMUM_WIND_SPEED_METRES_PER_SECOND = 5;
const WIND_SPEED_RANGE_METRES_PER_SECOND = 8;

// Published Kd at 475 nm per Jerlov water type, m^-1, and the two constants of
// pure seawater the reconstruction stands on. Mirrors ocean_water_optics.go.
const JERLOV_KD_475: Record<string, number> = {
  I: 0.025,
  IA: 0.038,
  IB: 0.05,
  II: 0.085,
  III: 0.13,
  "1C": 0.2,
  "3C": 0.42,
  "5C": 0.7,
  "7C": 1.2,
  "9C": 2.0
};
// The worst case a zone can hand the renderer. A boundary visible in the
// murkiest water a zone allows is visible in all of it.
function murkiestWaterTypeForZone(zone: string): string {
  const candidates = WATER_TYPES_BY_ZONE[zone] ?? WATER_TYPES_BY_ZONE[OCEAN_ZONE_TWILIGHT_REACH];
  return candidates[candidates.length - 1];
}

const PURE_SEAWATER_KD_GREEN = 0.065;
const PURE_SEAWATER_KD_BLUE = 0.016;
const TURBIDITY_SHAPE_GREEN = 0.8;
const CONTRAST_ATTENUATION_LENGTHS = 4.6;

// Contrast against a background falls by 1/e per attenuation length and the eye
// gives up at roughly 2% contrast, which is about 4.6 lengths. This does NOT
// depend on depth — at two thousand metres a lamp reaches exactly as far as it
// does at twenty.
function sightingRangeForWaterType(waterType: string): number {
  const kd475 = JERLOV_KD_475[waterType] ?? JERLOV_KD_475.IB;
  const load = Math.max(0, kd475 - PURE_SEAWATER_KD_BLUE);
  return CONTRAST_ATTENUATION_LENGTHS / (PURE_SEAWATER_KD_GREEN + load * TURBIDITY_SHAPE_GREEN);
}

const DEPTH_SEED_SUFFIX = "-ocean-depth";
const LIGHTING_SEED_SUFFIX = "-ocean-lighting";
const SEAFLOOR_SEED_SUFFIX = "-ocean-seafloor";
const CURRENT_SEED_SUFFIX = "-ocean-current";
const FLORA_SEED_SUFFIX = "-ocean-flora";
const FAUNA_SEED_SUFFIX = "-ocean-fauna";
const BIOLUMINESCENCE_SEED_SUFFIX = "-ocean-biolum";
const LANDMARKS_SEED_SUFFIX = "-ocean-landmarks";
const SEA_STATE_SEED_SUFFIX = "-ocean-sea-state";

const SEAFLOOR_SCATTER_SEED_SUFFIX = "-ocean-seafloor-scatter";
const FLORA_PLACEMENT_SEED_SUFFIX = "-ocean-flora-placement";
const BIOLUMINESCENCE_FLICKER_SUFFIX = "-ocean-biolum-flicker";

const ZONE_TRANSITION_PROBABILITY = 0.2;
const MINIMUM_ZONE_BLEND_AMOUNT = 0.2;
const ZONE_BLEND_AMOUNT_RANGE = 0.4;

// 31.5-74.5 degrees, and correct for a world UNDER the water: Fresnel
// reflectance climbs steeply below about 20 degrees and Snell's window narrows
// with it, so a low sun bounces off the surface instead of lighting the column.
const MINIMUM_SURFACE_ELEVATION = 0.55;
const SURFACE_ELEVATION_RANGE = 0.75;
// Above the waterline that premise stops applying — nothing has to survive the
// trip through the surface — and a low sun becomes the best light available.
// 3.4-40 degrees: golden hour at the bottom of the band. Same roll, same stream,
// different band, so no underwater world moves.
const MINIMUM_BREACHED_SURFACE_ELEVATION = 0.06;
const BREACHED_SURFACE_ELEVATION_RANGE = 0.64;
const EXPOSURE_JITTER_RANGE = 0.1;
const BASE_BLOOM_INTENSITY = 0.3;
const BLOOM_INTENSITY_RANGE = 0.55;
const MINIMUM_BLOOM_INTENSITY = 0.25;
const MAXIMUM_BLOOM_INTENSITY = 1.4;

const MINIMUM_BASIN_RADIUS = 26;
const BASIN_RADIUS_RANGE = 12;
const MINIMUM_RIDGE_AMPLITUDE = 1.2;
const RIDGE_AMPLITUDE_RANGE = 2.6;
const MINIMUM_RIDGE_FREQUENCY = 0.02;
const RIDGE_FREQUENCY_RANGE = 0.05;
const MINIMUM_ROCK_COUNT = 10;
const ROCK_COUNT_SPREAD = 15;
const MINIMUM_SEDIMENT_TUFT_COUNT = 400;
const SEDIMENT_TUFT_COUNT_SPREAD = 501;
const MOBILE_SEDIMENT_TUFT_FRACTION = 0.35;
const MINIMUM_CAMERA_DISTANCE = 16;
const CAMERA_DISTANCE_RANGE = 8;
const OCEAN_CAMERA_FIELD_OF_VIEW = 55;

const CURRENT_INTENSITY_BASE = 0.3;
const CURRENT_INTENSITY_RANGE = 0.55;
const MINIMUM_CURRENT_INTENSITY = 0.05;
const MAXIMUM_CURRENT_INTENSITY = 1.0;
const GUST_FREQUENCY_BASE = 0.18;
const GUST_FREQUENCY_RANGE = 0.34;
const BASE_MARINE_SNOW_COUNT = 900;
// Bounds for the style multiplier, which is the only thing that moves the count
// off the draw. The ceiling is a performance bound as much as a visual one.
const MINIMUM_MARINE_SNOW_COUNT = 400;
const MAXIMUM_MARINE_SNOW_COUNT = 3200;
const MARINE_SNOW_COUNT_SPREAD = 901;
const MOBILE_MARINE_SNOW_FRACTION = 0.3;

const BASE_FLORA_COUNT = 90;
const FLORA_COUNT_SPREAD = 111;
const MINIMUM_FLORA_COUNT = 40;
const MAXIMUM_FLORA_COUNT = 260;
const MOBILE_FLORA_FRACTION = 0.4;
const FLORA_SCALE_MINIMUM_BASE = 0.7;
const FLORA_SCALE_MINIMUM_RANGE = 0.2;
const FLORA_SCALE_MAXIMUM_BASE = 1.25;
const FLORA_SCALE_MAXIMUM_RANGE = 0.45;
const SWAY_STRENGTH_BASE = 0.25;
const SWAY_STRENGTH_RANGE = 0.55;
const MINIMUM_SWAY_STRENGTH = 0.05;
const MAXIMUM_SWAY_STRENGTH = 1.0;
const FLORA_DEPTH_TINT_RANGE = 0.25;

const MAXIMUM_SCHOOL_SLOTS = 3;
const MAXIMUM_DRIFTER_SLOTS = 2;
const SCHOOL_COUNT_BASE = 9;
const SCHOOL_COUNT_SPREAD = 16;
const SWIM_SPEED_BASE = 0.35;
const SWIM_SPEED_RANGE = 0.55;
const COHESION_BASE = 0.45;
const COHESION_RANGE = 0.4;
const SEPARATION_BASE = 0.25;
const SEPARATION_RANGE = 0.35;
const SCHOOL_BAND_BASE = 1.5;
const SCHOOL_BAND_BASE_RANGE = 9.0;
const SCHOOL_BAND_SPAN_BASE = 2.5;
const SCHOOL_BAND_SPAN_RANGE = 5.0;

const DRIFTER_COUNT_BASE = 4;
const DRIFTER_COUNT_SPREAD = 9;
const PULSE_RATE_BASE = 0.25;
const PULSE_RATE_RANGE = 0.45;

const GIANT_APPROACH_FRACTION = 0.8;
const GIANT_APPROACH_FRACTION_RANGE = 0.35;
const GIANT_PASS_DURATION_BASE = 22;
const GIANT_PASS_DURATION_RANGE = 20;

const BIOLUMINESCENCE_BLOOM_BASE = 0.2;
const BIOLUMINESCENCE_BLOOM_RANGE = 0.55;

const LANDMARK_ANGLE_JITTER_RADIANS = 0.25;
// Landmarks are placed relative to the CAMERA, not to the basin. Mirrors
// ocean_scene_profile.go.
//
// They used to be a fraction of the basin radius, 0.50 to 0.88. The basin is 26
// to 38 m and the camera orbits at 16 to 24 m, so the ring landed at 13 to 33 m
// and overlapped the orbit almost completely — a landmark standing where the
// viewer does was the ordinary case, not a rare accident, and at arm's length it
// is a flat pale slab filling the frame rather than a place. Tying the ring to
// the camera's own distance makes that impossible by construction.
const LANDMARK_CAMERA_STANDOFF_METRES = 8;
const LANDMARK_RING_DEPTH_METRES = 26;
const LANDMARK_HEIGHT_RANGE = 6;
const LANDMARK_COLOR_CYCLE_LENGTH = 3;
const FIRST_LANDMARK_ENERGY = 60;
const LANDMARK_ENERGY_STEP = 5;
const MAXIMUM_LANDMARK_ENERGY = 100;

/** Mirrors rng.Intn(n) in Go: an integer in [0, spread). */
function integerFromRoll(roll: number, spread: number): number {
  return Math.min(spread - 1, Math.floor(roll * spread));
}

/**
 * The zone above or below. Unlike the forest's seasons this does NOT wrap: the
 * surface has nothing above it and the abyss nothing below, so a roll toward
 * the outside of the stack falls back to the inside neighbour rather than
 * teleporting a reef into the trench.
 */
function adjacentZone(kind: string, directionRoll: number): string {
  const index = Math.max(0, ZONE_KINDS_IN_ORDER.indexOf(kind));
  if (directionRoll < 0.5) {
    return index + 1 < ZONE_KINDS_IN_ORDER.length ? ZONE_KINDS_IN_ORDER[index + 1] : ZONE_KINDS_IN_ORDER[index - 1];
  }
  return index - 1 >= 0 ? ZONE_KINDS_IN_ORDER[index - 1] : ZONE_KINDS_IN_ORDER[index + 1];
}

function currentKindForRoll(roll: number, entries: WeightedCurrentKind[]): string {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0 || entries.length === 0) {
    return OCEAN_CURRENT_DRIFT;
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

// Draw order: zone roll, transition roll, transition direction, blend amount,
// depth-within-band. The transition draws happen even for non-transition worlds
// so the depth pick never shifts.
//
// forceSurfaced is a PREVIEW-ONLY override (see buildPreviewOceanSceneConfig):
// every roll is still drawn in its usual order so nothing downstream shifts,
// only the final above-water decision is overridden. It exists because the
// landing page's live preview, before anyone has typed anything, hashes to one
// FIXED seed forever — and for "Glass Shallows" that seed's own
// aboveWaterRoll happens to land in the 30% that stays underwater, so every
// first-time visitor got the same underwater frame by construction, never the
// calm surface the family's default mood is supposed to show off. The actual
// generated world (once real input exists) never sets this and keeps the
// ordinary weighted roll.
function buildPreviewDepthConfig(
  seed: string,
  mood: string,
  moodProfile: OceanMoodProfile,
  forceSurfaced = false
): OceanDepthConfig {
  const nextRandomValue = randomFromSeed(seed + DEPTH_SEED_SUFFIX);
  // Drawn first because every later roll here needs to know which zone's band
  // it is rolling within. See driftZone for the clamp that keeps this from
  // reproducing the bug the absolute pin fixed.
  const zoneDriftRoll = nextRandomValue();
  // Also drawn unconditionally, for every mood, even the three whose
  // aboveWaterProbability is a flat 0 — same "every draw always happens"
  // discipline as the rest of this stream.
  const aboveWaterRoll = nextRandomValue();
  const transitionRoll = nextRandomValue();
  const transitionDirectionRoll = nextRandomValue();
  const blendAmountRoll = nextRandomValue();
  const depthWithinBandRoll = nextRandomValue();
  const floorClearanceRoll = nextRandomValue();
  const altitudeRoll = nextRandomValue();
  const boundaryRoll = nextRandomValue();
  const boundaryAmountRoll = nextRandomValue();

  // The mood names a HOME zone; this is which zone this particular seed
  // actually lands in. See OceanMoodProfile's own comment for why this is a
  // weighted lean again rather than an absolute pin, and why that is safe.
  const zone = driftZone(mood, moodProfile, zoneDriftRoll);
  const band = DEPTH_BAND_BY_ZONE[zone];
  const metres = roundToHundredths(band.minimum + depthWithinBandRoll * (band.maximum - band.minimum));
  const clearanceBand = FLOOR_CLEARANCE_BAND_BY_ZONE[zone];
  const clearance = clearanceBand.minimum + floorClearanceRoll * (clearanceBand.maximum - clearanceBand.minimum);
  // Fixed before the viewer can surface, so a world that breaks the waterline
  // still has a real floor under it rather than one computed from a negative
  // depth. Mirrors buildDepthConfig in ocean-service.
  let waterMetres = metres;
  let seafloorMetres = roundToHundredths(waterMetres + clearance);

  // The boundary rule, applied before the breach because a breached world is
  // above the water and can see the surface by definition. The reach uses the
  // MURKIEST water this zone can hand the renderer, which is the conservative
  // direction. A lift never leaves the zone's own band: changing the zone
  // changes what the world is.
  const reach =
    sightingRangeForWaterType(murkiestWaterTypeForZone(zone)) * BOUNDARY_SIGHT_MULTIPLIER;
  if (waterMetres > reach && seafloorMetres - waterMetres > reach) {
    const liftCeiling = Math.min(reach, band.maximum);
    if (boundaryRoll >= SEAMOUNT_RISE_PROBABILITY && liftCeiling > band.minimum) {
      waterMetres = roundToHundredths(band.minimum + boundaryAmountRoll * (liftCeiling - band.minimum));
      seafloorMetres = roundToHundredths(waterMetres + clearance);
    } else {
      seafloorMetres = roundToHundredths(
        waterMetres + MINIMUM_RISE_CLEARANCE_METRES + boundaryAmountRoll * RISE_CLEARANCE_RANGE_METRES
      );
    }
  }

  // A negative depth is a viewer ABOVE the water, by that many metres — not a
  // mode and not a fourth zone. Depth is this family's axis and the axis
  // continues through zero; the renderer branches on the sign because air is a
  // different medium, not water with different numbers.
  //
  // Weighted by the mood rather than pinned, so the sea-surface view is
  // something a person can ask for AND, for "Glass Shallows" specifically,
  // something that varies rather than repeating identically every seed — see
  // aboveWaterProbability. The whole altitude roll spreads the height
  // independently of whether the surface roll succeeded.
  let viewerMetres = waterMetres;
  if (forceSurfaced || aboveWaterRoll < moodProfile.aboveWaterProbability) {
    viewerMetres = roundToHundredths(
      -(MINIMUM_BREACH_ALTITUDE_METRES + altitudeRoll * BREACH_ALTITUDE_RANGE_METRES)
    );
  }

  const config: OceanDepthConfig = {
    metres: viewerMetres,
    seafloorMetres,
    zone: oceanZoneForDepth(viewerMetres)
  };
  if (transitionRoll < ZONE_TRANSITION_PROBABILITY) {
    config.blendTowardZone = adjacentZone(config.zone ?? zone, transitionDirectionRoll);
    config.blendAmount = roundToHundredths(MINIMUM_ZONE_BLEND_AMOUNT + blendAmountRoll * ZONE_BLEND_AMOUNT_RANGE);
  }
  return config;
}

// Draws nothing. Water is entirely a consequence of depth — that is the whole
// point of the family — and this is the half of the preview that IS byte-equal
// to the backend.
function buildPreviewWaterConfig(
  seed: string,
  metres: number,
  zone: string,
  moodProfile: OceanMoodProfile,
  styleProfile: OceanStyleProfile
): OceanWaterConfig {
  const nextRandomValue = randomFromSeed(seed + SEA_STATE_SEED_SUFFIX);
  const windRoll = nextRandomValue();
  const waterTypeRoll = nextRandomValue();

  const candidates = WATER_TYPES_BY_ZONE[zone] ?? WATER_TYPES_BY_ZONE[OCEAN_ZONE_TWILIGHT_REACH];
  // The style shifts WHERE IN THE ZONE OWN LIST the draw lands, never what is
  // on the list: the abyss offers no coastal water however silty the style is.
  const biasedWaterTypeRoll = clampNumber(waterTypeRoll + styleProfile.waterClarityBias, 0, 1);
  const jerlovWaterType =
    candidates[Math.min(candidates.length - 1, Math.floor(biasedWaterTypeRoll * candidates.length))];
  const windSpeedMetresPerSecond = roundToHundredths(
    clampNumber(
      (MINIMUM_WIND_SPEED_METRES_PER_SECOND + windRoll * WIND_SPEED_RANGE_METRES_PER_SECOND) *
        moodProfile.currentMultiplier,
      MINIMUM_WIND_SPEED_METRES_PER_SECOND,
      MINIMUM_WIND_SPEED_METRES_PER_SECOND + WIND_SPEED_RANGE_METRES_PER_SECOND
    )
  );

  const response = depthAt(metres);
  // How far you can see is the SHORTER of two limits, and they are different
  // quantities: how clear the water is, and how much light is left to see by.
  // A trench is gin-clear and unlit; a harbour is brilliantly lit and opaque.
  const visibilityMetres = roundToHundredths(
    Math.min(response.visibilityMetres, sightingRangeForWaterType(jerlovWaterType))
  );
  return {
    fogColor: response.fogColor,
    fogDensity: response.fogDensity,
    visibilityMetres,
    tintStrength: response.tintStrength,
    jerlovWaterType,
    windSpeedMetresPerSecond
  };
}

// Draw order: surface elevation, exposure jitter, bloom, sun azimuth, grade
// jitter (hue, saturation, brightness, contrast). Colours, god rays and
// caustics come from the depth curve and are drawn from no stream at all.
function buildPreviewLightingConfig(
  seed: string,
  metres: number,
  zone: string,
  moodProfile: OceanMoodProfile,
  styleProfile: OceanStyleProfile
): { lighting: OceanLightingConfig; bloomIntensity: number; grade: ScenePostFXGradeConfig } {
  const nextRandomValue = randomFromSeed(seed + LIGHTING_SEED_SUFFIX);
  const surfaceElevationRoll = nextRandomValue();
  const exposureRoll = nextRandomValue();
  const bloomRoll = nextRandomValue();
  // The full circle: the renderer places the camera opposite the bearing and
  // therefore composes toward the sun whatever the bearing is.
  const azimuthRoll = nextRandomValue();
  // Appended after every existing draw in this stream, so this jitter moved
  // nothing that already existed here (the depth-zone draw it depends on
  // lives in its own stream and moved for its own reason).
  const hueJitterRoll = nextRandomValue();
  const saturationJitterRoll = nextRandomValue();
  const brightnessJitterRoll = nextRandomValue();
  const contrastJitterRoll = nextRandomValue();
  const response = depthAt(metres);
  // Which band the roll lands in depends on the medium the viewer is in.
  const above = metres < 0;
  const elevationFloor = above ? MINIMUM_BREACHED_SURFACE_ELEVATION : MINIMUM_SURFACE_ELEVATION;
  const elevationRange = above ? BREACHED_SURFACE_ELEVATION_RANGE : SURFACE_ELEVATION_RANGE;

  // The style grade is layered on the zone one before the per-world jitter, so
  // two oceans in the same zone and style still differ by the jitter and never
  // by more than it.
  const baseGrade = addGrade(OCEAN_GRADES_BY_ZONE[zone], styleProfile.grade);
  const grade: ScenePostFXGradeConfig = {
    hueRadians: roundToHundredths((baseGrade.hueRadians ?? 0) + (hueJitterRoll - 0.5) * 2 * GRADE_HUE_JITTER_RANGE),
    saturation: roundToHundredths(
      clampNumber((baseGrade.saturation ?? 0) + (saturationJitterRoll - 0.5) * 2 * GRADE_SATURATION_JITTER_RANGE, -1, 1)
    ),
    brightness: roundToHundredths(
      (baseGrade.brightness ?? 0) + (brightnessJitterRoll - 0.5) * 2 * GRADE_BRIGHTNESS_JITTER_RANGE
    ),
    contrast: roundToHundredths(
      clampNumber((baseGrade.contrast ?? 0) + (contrastJitterRoll - 0.5) * 2 * GRADE_CONTRAST_JITTER_RANGE, 0, 1)
    )
  };

  return {
    lighting: {
      surfaceLightColor: response.surfaceLightColor,
      surfaceElevationRadians: roundToHundredths(
        elevationFloor + surfaceElevationRoll * elevationRange
      ),
      surfaceAzimuthRadians: roundToHundredths(azimuthRoll * FULL_CIRCLE_RADIANS),
      godRayStrength: response.godRayStrength,
      causticStrength: response.causticStrength,
      ambientColor: response.ambientColor,
      exposure: roundToHundredths(response.baseExposure + exposureRoll * EXPOSURE_JITTER_RANGE)
    },
    bloomIntensity: roundToHundredths(
      clampNumber(
        (BASE_BLOOM_INTENSITY + bloomRoll * BLOOM_INTENSITY_RANGE) *
          moodProfile.bloomMultiplier *
          styleProfile.bloomMultiplier,
        MINIMUM_BLOOM_INTENSITY,
        MAXIMUM_BLOOM_INTENSITY
      )
    ),
    grade
  };
}

// Draw order: basin radius, ridge amplitude, ridge frequency, rock count,
// sediment tuft count, camera distance.
function buildPreviewSeafloorConfig(seed: string): { seafloor: OceanSeafloorConfig; cameraDistance: number } {
  const nextRandomValue = randomFromSeed(seed + SEAFLOOR_SEED_SUFFIX);
  const basinRoll = nextRandomValue();
  const ridgeAmplitudeRoll = nextRandomValue();
  const ridgeFrequencyRoll = nextRandomValue();
  const rockCount = MINIMUM_ROCK_COUNT + integerFromRoll(nextRandomValue(), ROCK_COUNT_SPREAD);
  const sedimentTuftCountDesktop =
    MINIMUM_SEDIMENT_TUFT_COUNT + integerFromRoll(nextRandomValue(), SEDIMENT_TUFT_COUNT_SPREAD);
  const cameraDistanceRoll = nextRandomValue();

  return {
    seafloor: {
      placementSeed: seed + SEAFLOOR_SCATTER_SEED_SUFFIX,
      basinRadius: roundToHundredths(MINIMUM_BASIN_RADIUS + basinRoll * BASIN_RADIUS_RANGE),
      ridgeAmplitude: roundToHundredths(MINIMUM_RIDGE_AMPLITUDE + ridgeAmplitudeRoll * RIDGE_AMPLITUDE_RANGE),
      ridgeFrequency: roundToThousandths(MINIMUM_RIDGE_FREQUENCY + ridgeFrequencyRoll * RIDGE_FREQUENCY_RANGE),
      rockCount,
      sedimentTuftCountDesktop,
      sedimentTuftCountMobile: Math.floor(sedimentTuftCountDesktop * MOBILE_SEDIMENT_TUFT_FRACTION)
    },
    cameraDistance: roundToHundredths(MINIMUM_CAMERA_DISTANCE + cameraDistanceRoll * CAMERA_DISTANCE_RANGE)
  };
}

// Draw order: current kind, intensity, direction, gust frequency, marine snow
// count. Marine snow is drawn at every depth.
function buildPreviewCurrentConfig(
  seed: string,
  zone: string,
  moodProfile: OceanMoodProfile,
  styleProfile: OceanStyleProfile
): OceanCurrentConfig {
  const nextRandomValue = randomFromSeed(seed + CURRENT_SEED_SUFFIX);
  const kindRoll = nextRandomValue();
  const intensityRoll = nextRandomValue();
  const directionRoll = nextRandomValue();
  const gustFrequencyRoll = nextRandomValue();
  const marineSnowDraw = BASE_MARINE_SNOW_COUNT + integerFromRoll(nextRandomValue(), MARINE_SNOW_COUNT_SPREAD);
  // Sediment IS marine snow, from the viewer side of the water: the silt style
  // is mostly this number.
  const marineSnowCount = clampNumber(
    Math.floor(marineSnowDraw * styleProfile.marineSnowMultiplier),
    MINIMUM_MARINE_SNOW_COUNT,
    MAXIMUM_MARINE_SNOW_COUNT
  );

  return {
    kind: currentKindForRoll(kindRoll, CURRENT_WEIGHTS_BY_ZONE[zone]),
    intensity: roundToHundredths(
      clampNumber(
        (CURRENT_INTENSITY_BASE + intensityRoll * CURRENT_INTENSITY_RANGE) * moodProfile.currentMultiplier,
        MINIMUM_CURRENT_INTENSITY,
        MAXIMUM_CURRENT_INTENSITY
      )
    ),
    directionRadians: roundToHundredths(directionRoll * FULL_CIRCLE_RADIANS),
    gustFrequency: roundToHundredths(GUST_FREQUENCY_BASE + gustFrequencyRoll * GUST_FREQUENCY_RANGE),
    marineSnowCountDesktop: marineSnowCount,
    marineSnowCountMobile: Math.floor(marineSnowCount * MOBILE_MARINE_SNOW_FRACTION)
  };
}

// Draw order: flora count, species-mix pick, scale minimum, scale maximum, sway
// strength, depth tint.
function buildPreviewFloraConfig(
  seed: string,
  zone: string,
  moodProfile: OceanMoodProfile,
  styleProfile: OceanStyleProfile
): OceanFloraConfig {
  const nextRandomValue = randomFromSeed(seed + FLORA_SEED_SUFFIX);
  const floraCountDraw = BASE_FLORA_COUNT + integerFromRoll(nextRandomValue(), FLORA_COUNT_SPREAD);
  const speciesMixRoll = nextRandomValue();
  const scaleMinimumRoll = nextRandomValue();
  const scaleMaximumRoll = nextRandomValue();
  const swayStrengthRoll = nextRandomValue();
  const depthTintRoll = nextRandomValue();

  const countDesktop = clampNumber(
    Math.floor(floraCountDraw * styleProfile.floraMultiplier),
    MINIMUM_FLORA_COUNT,
    MAXIMUM_FLORA_COUNT
  );
  const mixes = FLORA_SPECIES_MIXES_BY_ZONE[zone];
  const mixIndex = Math.min(mixes.length - 1, Math.floor(speciesMixRoll * mixes.length));

  return {
    placementSeed: seed + FLORA_PLACEMENT_SEED_SUFFIX,
    countDesktop,
    countMobile: Math.floor(countDesktop * MOBILE_FLORA_FRACTION),
    speciesMix: mixes[mixIndex].map((entry) => ({ ...entry })),
    scaleMin: roundToHundredths(FLORA_SCALE_MINIMUM_BASE + scaleMinimumRoll * FLORA_SCALE_MINIMUM_RANGE),
    scaleMax: roundToHundredths(FLORA_SCALE_MAXIMUM_BASE + scaleMaximumRoll * FLORA_SCALE_MAXIMUM_RANGE),
    // Sway follows the current, so a still abyss has still kelp without
    // anything having to check the zone.
    swayStrength: roundToHundredths(
      clampNumber(
        (SWAY_STRENGTH_BASE + swayStrengthRoll * SWAY_STRENGTH_RANGE) * moodProfile.currentMultiplier,
        MINIMUM_SWAY_STRENGTH,
        MAXIMUM_SWAY_STRENGTH
      )
    ),
    depthTintStrength: roundToHundredths(FLORA_DEPTH_TINT_BASE_BY_ZONE[zone] + depthTintRoll * FLORA_DEPTH_TINT_RANGE)
  };
}

// Draw order: 3 school slots x (species, count, speed, band base, band span,
// cohesion, separation), then 2 drifter slots x (species, count, pulse,
// colour), then the giant's 4 draws — presence, species, approach, duration —
// which happen whether or not a giant appears.
function buildPreviewFaunaConfig(
  seed: string,
  zone: string,
  visibilityMetres: number,
  moodProfile: OceanMoodProfile,
  styleProfile: OceanStyleProfile
): OceanFaunaConfig {
  const nextRandomValue = randomFromSeed(seed + FAUNA_SEED_SUFFIX);
  const schoolDraws = Array.from({ length: MAXIMUM_SCHOOL_SLOTS }, () => ({
    speciesRoll: nextRandomValue(),
    countDraw: integerFromRoll(nextRandomValue(), SCHOOL_COUNT_SPREAD),
    speedRoll: nextRandomValue(),
    bandBaseRoll: nextRandomValue(),
    bandSpanRoll: nextRandomValue(),
    cohesionRoll: nextRandomValue(),
    separationRoll: nextRandomValue()
  }));
  const drifterDraws = Array.from({ length: MAXIMUM_DRIFTER_SLOTS }, () => ({
    speciesRoll: nextRandomValue(),
    countDraw: integerFromRoll(nextRandomValue(), DRIFTER_COUNT_SPREAD),
    pulseRoll: nextRandomValue(),
    colorRoll: nextRandomValue()
  }));
  const giantPresenceRoll = nextRandomValue();
  const giantSpeciesRoll = nextRandomValue();
  const giantApproachRoll = nextRandomValue();
  const giantDurationRoll = nextRandomValue();

  const faunaMultiplier = moodProfile.faunaMultiplier * styleProfile.faunaMultiplier;
  const activeSchoolSlots = clampNumber(
    Math.round(BASE_SCHOOL_SLOTS_BY_ZONE[zone] * faunaMultiplier),
    0,
    MAXIMUM_SCHOOL_SLOTS
  );
  const activeDrifterSlots = clampNumber(
    Math.round(BASE_DRIFTER_SLOTS_BY_ZONE[zone] * faunaMultiplier),
    0,
    MAXIMUM_DRIFTER_SLOTS
  );

  const fishSpecies = FISH_SPECIES_BY_ZONE[zone];
  const usedFishSpecies = new Set<string>();
  const schools: OceanFishSchoolConfig[] = [];
  for (let slot = 0; slot < activeSchoolSlots; slot += 1) {
    const draw = schoolDraws[slot];
    let speciesIndex = Math.min(fishSpecies.length - 1, Math.floor(draw.speciesRoll * fishSpecies.length));
    // Deterministic dedupe walk, mirroring the Go builder.
    for (let attempt = 0; attempt < fishSpecies.length && usedFishSpecies.has(fishSpecies[speciesIndex]); attempt += 1) {
      speciesIndex = (speciesIndex + 1) % fishSpecies.length;
    }
    const speciesKey = fishSpecies[speciesIndex];
    usedFishSpecies.add(speciesKey);
    const depthBandMin = roundToHundredths(SCHOOL_BAND_BASE + draw.bandBaseRoll * SCHOOL_BAND_BASE_RANGE);
    schools.push({
      modelKey: speciesKey,
      count: SCHOOL_COUNT_BASE + draw.countDraw,
      pathSeed: `${seed}-ocean-school-${slot}`,
      depthBandMin,
      depthBandMax: roundToHundredths(depthBandMin + SCHOOL_BAND_SPAN_BASE + draw.bandSpanRoll * SCHOOL_BAND_SPAN_RANGE),
      swimSpeed: roundToHundredths(SWIM_SPEED_BASE + draw.speedRoll * SWIM_SPEED_RANGE),
      cohesion: roundToHundredths(COHESION_BASE + draw.cohesionRoll * COHESION_RANGE),
      separation: roundToHundredths(SEPARATION_BASE + draw.separationRoll * SEPARATION_RANGE)
    });
  }

  const drifterSpecies = DRIFTER_SPECIES_BY_ZONE[zone];
  const emissiveColors = OCEAN_BIOLUMINESCENCE_COLORS_BY_ZONE[zone];
  const drifters: OceanDrifterConfig[] = [];
  for (let slot = 0; slot < activeDrifterSlots; slot += 1) {
    const draw = drifterDraws[slot];
    const speciesIndex = Math.min(drifterSpecies.length - 1, Math.floor(draw.speciesRoll * drifterSpecies.length));
    const colorIndex = Math.min(emissiveColors.length - 1, Math.floor(draw.colorRoll * emissiveColors.length));
    drifters.push({
      modelKey: drifterSpecies[speciesIndex],
      count: DRIFTER_COUNT_BASE + draw.countDraw,
      pathSeed: `${seed}-ocean-drifter-${slot}`,
      pulseRate: roundToHundredths(PULSE_RATE_BASE + draw.pulseRoll * PULSE_RATE_RANGE),
      emissiveColor: emissiveColors[colorIndex]
    });
  }

  const giants: OceanGiantConfig[] = [];
  if (giantPresenceRoll < GIANT_PROBABILITY_BY_ZONE[zone]) {
    const giantSpecies = GIANT_SPECIES_BY_ZONE[zone];
    const speciesIndex = Math.min(giantSpecies.length - 1, Math.floor(giantSpeciesRoll * giantSpecies.length));
    giants.push({
      modelKey: giantSpecies[speciesIndex],
      passSeed: `${seed}-ocean-giant-0`,
      // Anchored to the water's own visibility rather than to a fixed number,
      // so a giant is always a silhouette at the edge of what can be seen.
      approachDistance: roundToHundredths(
        visibilityMetres * (GIANT_APPROACH_FRACTION + giantApproachRoll * GIANT_APPROACH_FRACTION_RANGE)
      ),
      passDurationSeconds: roundToHundredths(GIANT_PASS_DURATION_BASE + giantDurationRoll * GIANT_PASS_DURATION_RANGE)
    });
  }

  return { schools, drifters, giants };
}

// Draw order: plankton count, bloom intensity.
function buildPreviewBioluminescenceConfig(
  seed: string,
  zone: string,
  moodProfile: OceanMoodProfile,
  styleProfile: OceanStyleProfile
): OceanBioluminescenceConfig {
  const nextRandomValue = randomFromSeed(seed + BIOLUMINESCENCE_SEED_SUFFIX);
  const planktonCount =
    BASE_PLANKTON_COUNT_BY_ZONE[zone] + integerFromRoll(nextRandomValue(), PLANKTON_COUNT_SPREAD_BY_ZONE[zone]);
  const bloomRoll = nextRandomValue();

  return {
    planktonCount,
    // Brightens light that is already in the scene; never what makes it
    // visible. An abyssal world has to read with post-processing switched off.
    bloomIntensity: roundToHundredths(
      clampNumber(
        (BIOLUMINESCENCE_BLOOM_BASE + bloomRoll * BIOLUMINESCENCE_BLOOM_RANGE) *
          moodProfile.bloomMultiplier *
          styleProfile.bloomMultiplier,
        0,
        1
      )
    ),
    emissiveColors: [...OCEAN_BIOLUMINESCENCE_COLORS_BY_ZONE[zone]],
    flickerSeed: seed + BIOLUMINESCENCE_FLICKER_SUFFIX
  };
}

// Draw order per landmark: kind roll, angle jitter, radius, height above the
// floor. The first landmark is always the kelp cathedral.
function buildPreviewLandmarkConfigs(
  seed: string,
  landmarkNames: string[],
  cameraDistance: number,
  primaryColor: string,
  secondaryColor: string
): OceanLandmarkConfig[] {
  const nextRandomValue = randomFromSeed(seed + LANDMARKS_SEED_SUFFIX);
  const usedKinds = new Set<string>();
  return landmarkNames.map((landmarkName, index) => {
    const kindRoll = nextRandomValue();
    const angleJitterRoll = nextRandomValue();
    const radiusRoll = nextRandomValue();
    const heightRoll = nextRandomValue();

    let kind = OCEAN_LANDMARK_KELP_CATHEDRAL;
    if (index > 0) {
      let kindIndex = Math.min(NON_HERO_LANDMARK_KINDS.length - 1, Math.floor(kindRoll * NON_HERO_LANDMARK_KINDS.length));
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
      accentColor = OCEAN_PALETTE_ACCENT_COLOR;
    } else if (index % LANDMARK_COLOR_CYCLE_LENGTH === 2) {
      accentColor = primaryColor;
    }

    const baseAngle = (FULL_CIRCLE_RADIANS / landmarkNames.length) * index;
    return {
      key: `preview-landmark-${index + 1}`,
      name: landmarkName,
      kind,
      angleRadians: roundToHundredths(baseAngle + (angleJitterRoll - 0.5) * 2 * LANDMARK_ANGLE_JITTER_RADIANS),
      radiusFromCenter: roundToHundredths(
        cameraDistance + LANDMARK_CAMERA_STANDOFF_METRES + radiusRoll * LANDMARK_RING_DEPTH_METRES
      ),
      heightAboveFloor: roundToHundredths(heightRoll * LANDMARK_HEIGHT_RANGE),
      accentColor,
      energy: Math.min(MAXIMUM_LANDMARK_ENERGY, FIRST_LANDMARK_ENERGY + index * LANDMARK_ENERGY_STEP)
    };
  });
}

function buildPreviewAssetsConfig(
  flora: OceanFloraConfig,
  fauna: OceanFaunaConfig,
  landmarks: OceanLandmarkConfig[]
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
  for (const entry of flora.speciesMix ?? []) {
    appendKey(entry.modelKey);
  }
  appendKey(MODEL_KEY_ROCK_BASALT);
  for (const school of fauna.schools ?? []) {
    appendKey(school.modelKey);
  }
  for (const drifter of fauna.drifters ?? []) {
    appendKey(drifter.modelKey);
  }
  for (const giant of fauna.giants ?? []) {
    appendKey(giant.modelKey);
  }
  for (const landmark of landmarks) {
    appendKey(landmark.kind ? OCEAN_LANDMARK_MODEL_KEYS_BY_KIND[landmark.kind] : undefined);
  }
  // No hdriKey: this family has no sky.
  return { catalogVersion: OCEAN_ASSET_CATALOG_VERSION, modelKeys };
}

/**
 * The ocean counterpart of buildPreviewSceneConfig and
 * buildPreviewForestSceneConfig: a full OceanSceneConfig built locally from the
 * form inputs, rendered by the SAME OceanRenderer the real world uses.
 */
export type PreviewOceanSceneOptions = {
  /**
   * Show the calm sunlit surface regardless of the depth roll. Set only while
   * the form is still at its untouched defaults — see the call site in
   * page.tsx and buildPreviewDepthConfig's own comment on why this exists.
   */
  showCalmSurfaceDefault?: boolean;
};

export function buildPreviewOceanSceneConfig(
  input: PreviewSceneInput,
  options: PreviewOceanSceneOptions = {}
): SceneConfig {
  const seed = previewSeedFromInputs(input);
  const moodProfile = oceanProfileForMood(input.mood);
  // An unknown or absent style resolves to the neutral profile, which is a
  // no-op in every field — mirroring ocean_style_profile.go exactly.
  const styleProfile = oceanProfileForStyle(input.preferredWorldStyle);

  const primaryColor = input.favoriteColors[0] ?? DEFAULT_OCEAN_PRIMARY_COLOR;
  const secondaryColor = input.favoriteColors[1] ?? DEFAULT_OCEAN_SECONDARY_COLOR;

  // The backend names its landmarks from interests then traits (3-7), exactly
  // like universe planets and forest landmarks — reuse the shared mirror.
  const landmarkNames = previewPlanetNames(input.interests, input.traits);

  const depth = buildPreviewDepthConfig(seed, input.mood, moodProfile, options.showCalmSurfaceDefault);
  const metres = depth.metres ?? DEPTH_BAND_BY_ZONE[OCEAN_ZONE_SUNLIT_SHALLOWS].minimum;
  const zone = depth.zone ?? OCEAN_ZONE_SUNLIT_SHALLOWS;

  const water = buildPreviewWaterConfig(seed, metres, zone, moodProfile, styleProfile);
  const { lighting, bloomIntensity, grade } = buildPreviewLightingConfig(seed, metres, zone, moodProfile, styleProfile);
  const { seafloor, cameraDistance } = buildPreviewSeafloorConfig(seed);
  const current = buildPreviewCurrentConfig(seed, zone, moodProfile, styleProfile);
  const flora = buildPreviewFloraConfig(seed, zone, moodProfile, styleProfile);
  const fauna = buildPreviewFaunaConfig(seed, zone, water.visibilityMetres ?? 12, moodProfile, styleProfile);
  const bioluminescence = buildPreviewBioluminescenceConfig(seed, zone, moodProfile, styleProfile);
  const landmarks = buildPreviewLandmarkConfigs(
    seed,
    landmarkNames,
    cameraDistance,
    primaryColor,
    secondaryColor
  );

  return {
    seed,
    schemaVersion: OCEAN_PREVIEW_SCHEMA_VERSION,
    sceneType: OCEAN_SCENE_TYPE,
    theme: input.preferredWorldStyle,
    palette: {
      background: OCEAN_BACKGROUND_COLORS_BY_ZONE[zone],
      primary: primaryColor,
      secondary: secondaryColor,
      accent: OCEAN_PALETTE_ACCENT_COLOR,
      gradient: [primaryColor, secondaryColor, OCEAN_PALETTE_ACCENT_COLOR]
    },
    depth,
    water,
    lighting,
    seafloor,
    current,
    flora,
    fauna,
    bioluminescence,
    landmarks,
    camera: { distance: cameraDistance, fov: OCEAN_CAMERA_FIELD_OF_VIEW },
    postFX: {
      bloomIntensity,
      grade
    },
    hud: { showTraitBars: true, showLabels: true },
    assets: buildPreviewAssetsConfig(flora, fauna, landmarks)
  };
}

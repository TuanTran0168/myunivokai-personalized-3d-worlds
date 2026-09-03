export type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown[];
    requestId?: string;
  };
};

/**
 * Which backend a world belongs to. Every world service exposes the same
 * route shapes and error taxonomy; only the base URL and the scene family
 * differ. "universe" is universe-service (solar systems), "nature" is
 * nature-service (forest portraits), "ocean" is ocean-service (deep-sea
 * portraits).
 */
export type WorldFamily = "universe" | "nature" | "ocean";

export type GenerationJobStatus = "queued" | "processing" | "completed" | "failed";

/**
 * How a world was built. Mirrors contracts.GenerationReason (contracts/go/contracts_quota.go)
 * and the CHECK constraint on generation_jobs.generation_reason, which a Go
 * ratchet keeps in step with the first of those.
 *
 * A REASON and never a provider name: three of these four routes end in a
 * world built from presets, and only `quota_exhausted` is a fact about the
 * visitor. See lib/generationNotice.ts, which is the only place this is read.
 */
export type GenerationReason = "ai_generated" | "quota_exhausted" | "mock_configured" | "ai_failed_fallback";

export type GenerationJob = {
  jobId: string;
  family: WorldFamily;
  status: GenerationJobStatus;
  worldId?: string;
  /** Absent on every job created before the quota shipped, and on every failure. */
  generationReason?: GenerationReason;
  /**
   * The limit `quota_exhausted` was measured against, so the one sentence this
   * app shows names the number the platform enforced rather than a copy of it
   * here. Absent means the server named none; 0 is a real policy.
   */
  dailyAiGenerationLimit?: number;
  error?: {
    code?: string;
    message?: string;
    details?: unknown[];
  };
  createdAt: string;
  updatedAt: string;
};

// Mirrors services/universe-service/internal/models/scene.go (contracts/schemas/world-scene-config.schema.json)
export type ScenePalette = {
  background?: string;
  primary?: string;
  secondary?: string;
  accent?: string;
  gradient?: string[];
};

export type SceneCoreConfig = {
  shape?: string;
  color?: string;
  emissive?: string;
  scale?: number;
  spinSpeed?: number;
};

export type PlanetSceneConfig = {
  key?: string;
  name?: string;
  meaning?: string;
  color?: string;
  size?: number;
  orbitRadius?: number;
  orbitSpeed?: number;
  phase?: number;
  energy?: number;
};

export type SceneParticleConfig = {
  desktopCount?: number;
  mobileCount?: number;
  color?: string;
  spread?: number;
};

export type SceneCameraConfig = {
  distance?: number;
  fov?: number;
};

// Added in schemaVersion 1.2 (promoted from the per-theme grade table).
// Absent on worlds generated before it — PostEffects falls back to the table.
export type ScenePostFXGradeConfig = {
  hueRadians?: number;
  saturation?: number;
  brightness?: number;
  contrast?: number;
};

export type ScenePostFXConfig = {
  bloomIntensity?: number;
  grade?: ScenePostFXGradeConfig;
};

export type SceneHUDConfig = {
  showTraitBars?: boolean;
  showLabels?: boolean;
};

export type WeightedSkyColor = {
  color?: string;
  weight?: number;
};

export type SceneMilkyWayConfig = {
  seed?: string;
  allSkyStarCount?: number;
  bandStarCount?: number;
  coreStarCount?: number;
  heroStarCount?: number;
  nebulaCloudCount?: number;
  coreCloudCount?: number;
  dustCloudCount?: number;
  starColors?: WeightedSkyColor[];
  coreStarColors?: WeightedSkyColor[];
  nebulaCloudColors?: WeightedSkyColor[];
  coreCloudColors?: WeightedSkyColor[];
  dustCloudColors?: WeightedSkyColor[];
  nebulaCloudOpacity?: number;
  coreCloudOpacity?: number;
  dustCloudOpacity?: number;
  bandTiltXRadians?: number;
  bandTiltZRadians?: number;
  rotationRadiansPerSecond?: number;
};

export type SceneConstellationConfig = {
  seed?: string;
  displayCount?: number;
  starColor?: string;
  lineColor?: string;
  glowMultiplier?: number;
  rotationRadiansPerSecond?: number;
};

// Added in schemaVersion 1.1. Absent on worlds generated before it — renderers
// fall back to their built-in sky defaults.
export type SceneSkyConfig = {
  milkyWay?: SceneMilkyWayConfig;
  constellations?: SceneConstellationConfig;
};

// Added in schemaVersion 1.2. Absent on worlds generated before it — the
// AsteroidBelt renderer falls back to its built-in defaults.
export type SceneBeltConfig = {
  enabled?: boolean;
  instanceCount?: number;
  gapBeyondLastOrbit?: number;
  rockColor?: string;
  tiltXRadians?: number;
  tiltZRadians?: number;
};

// Added in schemaVersion 1.2. Absent on worlds generated before it — the
// renderer falls back to a single comet with a neutral tail.
export type SceneCometsConfig = {
  count?: number;
  tailLengthMultiplier?: number;
};

// Added in schemaVersion 1.2. Absent on worlds generated before it — the Sun
// renderer falls back to the built-in warm-yellow star.
export type SceneSunConfig = {
  surfaceTintColor?: string;
  glowColor?: string;
  lightColor?: string;
  surfaceHdrMultiplier?: number;
};

// --- Forest scene family (nature-service) -----------------------------------
// Mirrors services/nature-service/internal/models/scene.go
// (contracts/scenes/forest-scene-config.schema.json). Renderers are keyed by
// (sceneType, schemaVersion); every field is optional on the frontend so a
// partially-migrated config degrades instead of crashing.

export type ForestSeasonConfig = {
  kind?: string;
  blendTowardKind?: string;
  blendAmount?: number;
  foliageColors?: string[];
  groundKind?: string;
};

export type ForestLightingConfig = {
  timeOfDay?: string;
  sunElevationRadians?: number;
  sunAzimuthRadians?: number;
  sunColor?: string;
  ambientColor?: string;
  hdriKey?: string;
  exposure?: number;
  fogColor?: string;
  fogDensity?: number;
};

export type ForestTerrainConfig = {
  placementSeed?: string;
  clearingRadius?: number;
  treelineRadius?: number;
  hillAmplitude?: number;
  hillFrequency?: number;
  pathEnabled?: boolean;
  rockCount?: number;
  grassTuftCountDesktop?: number;
  grassTuftCountMobile?: number;
};

export type ForestTreeSpeciesMixEntry = {
  modelKey?: string;
  weight?: number;
};

export type ForestTreesConfig = {
  placementSeed?: string;
  countDesktop?: number;
  countMobile?: number;
  speciesMix?: ForestTreeSpeciesMixEntry[];
  scaleMin?: number;
  scaleMax?: number;
  foliageTintStrength?: number;
  windStrength?: number;
  windDirectionRadians?: number;
  windGustFrequency?: number;
};

export type ForestWeatherConfig = {
  kind?: string;
  intensity?: number;
  cloudCoverage?: number;
  rainDropCountDesktop?: number;
  rainDropCountMobile?: number;
  snowflakeCountDesktop?: number;
  snowflakeCountMobile?: number;
};

export type ForestGroundAnimalConfig = {
  modelKey?: string;
  count?: number;
  pathSeed?: string;
  walkSpeed?: number;
  scale?: number;
};

export type ForestBirdFlockConfig = {
  modelKey?: string;
  birdCount?: number;
  pathSeed?: string;
  altitudeMin?: number;
  altitudeMax?: number;
  flightSpeed?: number;
  pattern?: string;
};

export type ForestWildlifeConfig = {
  groundAnimals?: ForestGroundAnimalConfig[];
  birdFlocks?: ForestBirdFlockConfig[];
};

export type ForestAmbientParticlesConfig = {
  fallingLeafCount?: number;
  blossomPetalCount?: number;
  fireflyCount?: number;
  snowDustCount?: number;
};

export type ForestLandmarkConfig = {
  key?: string;
  name?: string;
  meaning?: string;
  kind?: string;
  angleRadians?: number;
  radiusFromCenter?: number;
  accentColor?: string;
  energy?: number;
};

export type ForestAssetsConfig = {
  catalogVersion?: string;
  modelKeys?: string[];
  hdriKey?: string;
};

// --- Ocean scene family (ocean-service) --------------------------------------
// Mirrors services/ocean-service/internal/models/scene.go
// (contracts/scenes/ocean-scene-config.schema.json). Every field is optional on
// the frontend so a partially-migrated config degrades instead of crashing.
//
// There is no hdriKey anywhere below, and there will not be one: this family
// has no sky. Water, lighting, god rays and caustics are all DERIVED from
// depth.metres by the backend's depth curve and then stored, so the renderer
// reads numbers rather than recomputing physics.

export type OceanDepthConfig = {
  /** How deep the VIEWER is. */
  metres?: number;
  /**
   * How deep the SEABED is. Their difference is the water below you, and it is
   * the only thing that decides whether a floor is drawn — mean ocean depth is
   * 3682 m, so a midwater world carries a value in the thousands and shows no
   * bottom at all.
   */
  seafloorMetres?: number;
  zone?: string;
  blendTowardZone?: string;
  blendAmount?: number;
};

export type OceanWaterConfig = {
  fogColor?: string;
  fogDensity?: number;
  visibilityMetres?: number;
  tintStrength?: number;
  /**
   * Jerlov's 1976 optical class — "I" to "III" for open ocean, "1C" to "9C"
   * for coastal. Decides hue, the per-channel depth curve and how coherent a
   * caustic pattern can still be. Optional because worlds stored before
   * schemaVersion 1.1 do not carry it.
   */
  jerlovWaterType?: string;
  /**
   * Wind at 10 m above the sea. The whole wave field comes out of this one
   * number: significant wave height, peak wavelength and whitecap coverage.
   */
  windSpeedMetresPerSecond?: number;
};

export type OceanLightingConfig = {
  surfaceLightColor?: string;
  surfaceElevationRadians?: number;
  /**
   * The sun's compass bearing, in radians. Separate from the elevation because
   * the renderer needs it for a different reason: elevation decides how much
   * light there is, bearing decides where the CAMERA goes, since an above-water
   * frame is composed looking toward the sun.
   *
   * Optional because worlds stored before schemaVersion 1.2 do not carry it; the
   * renderer falls back to the constant bearing every ocean used to share.
   */
  surfaceAzimuthRadians?: number;
  godRayStrength?: number;
  causticStrength?: number;
  ambientColor?: string;
  exposure?: number;
};

export type OceanSeafloorConfig = {
  placementSeed?: string;
  basinRadius?: number;
  ridgeAmplitude?: number;
  ridgeFrequency?: number;
  rockCount?: number;
  sedimentTuftCountDesktop?: number;
  sedimentTuftCountMobile?: number;
};

export type OceanCurrentConfig = {
  kind?: string;
  intensity?: number;
  directionRadians?: number;
  gustFrequency?: number;
  marineSnowCountDesktop?: number;
  marineSnowCountMobile?: number;
};

export type OceanFloraSpeciesMixEntry = {
  modelKey?: string;
  weight?: number;
};

export type OceanFloraConfig = {
  placementSeed?: string;
  countDesktop?: number;
  countMobile?: number;
  speciesMix?: OceanFloraSpeciesMixEntry[];
  scaleMin?: number;
  scaleMax?: number;
  swayStrength?: number;
  depthTintStrength?: number;
};

export type OceanFishSchoolConfig = {
  modelKey?: string;
  count?: number;
  pathSeed?: string;
  depthBandMin?: number;
  depthBandMax?: number;
  swimSpeed?: number;
  cohesion?: number;
  separation?: number;
};

export type OceanDrifterConfig = {
  modelKey?: string;
  count?: number;
  pathSeed?: string;
  pulseRate?: number;
  emissiveColor?: string;
};

export type OceanGiantConfig = {
  modelKey?: string;
  passSeed?: string;
  approachDistance?: number;
  passDurationSeconds?: number;
};

export type OceanFaunaConfig = {
  schools?: OceanFishSchoolConfig[];
  drifters?: OceanDrifterConfig[];
  giants?: OceanGiantConfig[];
};

export type OceanBioluminescenceConfig = {
  planktonCount?: number;
  bloomIntensity?: number;
  emissiveColors?: string[];
  flickerSeed?: string;
};

export type OceanLandmarkConfig = {
  key?: string;
  name?: string;
  meaning?: string;
  kind?: string;
  angleRadians?: number;
  radiusFromCenter?: number;
  heightAboveFloor?: number;
  accentColor?: string;
  energy?: number;
};

export type OceanAssetsConfig = {
  catalogVersion?: string;
  modelKeys?: string[];
};

export type SceneConfig = {
  seed?: string;
  schemaVersion?: string;
  // Absent on universe configs; "forest" on nature-service configs. The
  // renderer registry checks this BEFORE the theme, so a forest world can
  // never fall into a solar-system renderer.
  sceneType?: string;
  sceneName?: string;
  archetype?: string;
  quote?: string;
  theme?: string;
  palette?: string[] | ScenePalette;
  core?: SceneCoreConfig;
  planets?: PlanetSceneConfig[];
  particles?: SceneParticleConfig;
  camera?: SceneCameraConfig;
  postFX?: ScenePostFXConfig;
  hud?: SceneHUDConfig;
  sky?: SceneSkyConfig;
  belt?: SceneBeltConfig;
  comets?: SceneCometsConfig;
  sun?: SceneSunConfig;
  // Forest family sections (sceneType "forest").
  season?: ForestSeasonConfig;
  terrain?: ForestTerrainConfig;
  trees?: ForestTreesConfig;
  weather?: ForestWeatherConfig;
  wildlife?: ForestWildlifeConfig;
  ambientParticles?: ForestAmbientParticlesConfig;
  // Ocean family sections (sceneType "ocean").
  depth?: OceanDepthConfig;
  water?: OceanWaterConfig;
  seafloor?: OceanSeafloorConfig;
  current?: OceanCurrentConfig;
  flora?: OceanFloraConfig;
  fauna?: OceanFaunaConfig;
  bioluminescence?: OceanBioluminescenceConfig;
  // Three names the forest and the ocean both use for different things. They
  // are INTERSECTIONS rather than unions because every member field is already
  // optional: a union would make `scene.lighting.timeOfDay` a compile error in
  // ForestRenderer for the sake of a distinction the renderer registry has
  // already made by the time either one reads it.
  lighting?: ForestLightingConfig & OceanLightingConfig;
  landmarks?: (ForestLandmarkConfig & OceanLandmarkConfig)[];
  assets?: ForestAssetsConfig & OceanAssetsConfig;
  [key: string]: unknown;
};

export type WorldVariant = {
  id: string;
  worldId?: string;
  name?: string;
  title?: string;
  seed?: string;
  sceneConfig?: SceneConfig;
  selected?: boolean;
  createdAt?: string;
};

export type World = {
  id: string;
  nickname?: string;
  title?: string;
  summary?: string;
  status?: string;
  shareSlug?: string;
  selectedVariantId?: string;
  variants: WorldVariant[];
  createdAt?: string;
  publishedAt?: string;
};

export type ShareWorld = {
  id: string;
  nickname?: string;
  title?: string;
  summary?: string;
  quote?: string;
  archetype?: string;
  shareSlug?: string;
  variant?: WorldVariant;
  publishedAt?: string;
};

// What a deletion answers with. `shareSlug` is the slug the world HAD, which the
// gateway uses to drop its cached share response; the browser has no use for it
// and does not read it.
export type DeleteResult = {
  deleted: boolean;
  shareSlug?: string;
};

export type PublishResult = {
  shareSlug: string;
  shareUrl: string;
};

export type CreateWorldInput = {
  nickname: string;
  role?: string;
  interests: string[];
  traits: string[];
  goal: string;
  challenge?: string;
  mood: string;
  favoriteColors: string[];
  preferredWorldStyle: string;
};

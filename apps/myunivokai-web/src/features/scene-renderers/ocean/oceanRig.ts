/**
 * The ocean, assembled.
 *
 * One module owns the whole medium — sky, surface, water column, light and
 * floor — because every one of those has to agree with the others about the
 * same wave, the same water and the same sun, and threading that through eight
 * React components is exactly how they drift apart. The renderer component is a
 * thin shell around this.
 *
 * Nothing here is an art-direction number. The entire scene is derived from
 * five inputs, each of which is a quantity an oceanographer measures:
 *
 *   viewerDepthMetres, seafloorDepthMetres   which boundaries are in frame
 *   jerlovWaterType                          colour, sighting range, fog
 *   windSpeedMps                             the wave spectrum and the foam
 *   sunElevationDegrees                      the sky, and the refracted sun
 *
 * The reasoning behind each is in agent-system/evolution/ocean-visual-direction-research.md
 * (§11c the adaptation model, §11f the sky, §11i the sea state, §11j the water,
 * §11k why the service should carry exactly these fields).
 */
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  HemisphereLight,
  AmbientLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from "three";
import { randomFromSeed } from "@/lib/scene";
import { OCEAN_SUN_AZIMUTH_RADIANS } from "./oceanMath";
import {
  AIR_SIGHTING_RANGE_METRES,
  DEFAULT_WATER_TYPE,
  adaptationExposure,
  airExposure,
  airPalette,
  SURFACE_SUN,
  isAboveWater,
  keyLightColour,
  onePercentBlueDepthMetres,
  sightingRangeMetres,
  waterAttenuation,
  waterPalette,
  type JerlovWaterType,
} from "./oceanOptics";
import { buildSeaState, foamFoldThreshold, type SeaState } from "./oceanSeaState";
import {
  GERSTNER_SURFACE_GLSL,
  PREETHAM_SKY_GLSL,
  SKY_UNIFORMS_GLSL,
  WAVE_UNIFORMS_GLSL,
  refractedSunElevationRadians,
  skyCoefficients,
} from "./oceanSky";
import {
  OCEAN_RIG_SPECIES,
  createSchool,
  loadSpeciesGeometry,
  speciesIsPresent,
  type School,
} from "./oceanRigFauna";
import { createSeabed, tintSeabed, type Seabed } from "./oceanRigTerrain";
import { algaeDepthLimitMetres, createFlora, type Flora } from "./oceanRigFlora";
import { SKY_HAZE, createSeaTop, type SeaTop } from "./oceanRigSurface";
import {
  createBubbles,
  createJellyfish,
  createMoteLayers,
  type Bubbles,
} from "./oceanRigDrifters";
import {
  createForegroundFrame,
  createRidgeSilhouettes,
  type RidgeSilhouettes,
} from "./oceanRigFraming";

const WAVE_MAX = 12;
/** A boundary is drawn only when it lies within about 1.5 sighting ranges. */
const BOUNDARY_SIGHT_MULTIPLIER = 1.5;

export type OceanRigOptions = {
  renderer: WebGLRenderer;
  scene: Scene;
  seed: string;
  viewerDepthMetres: number;
  seafloorDepthMetres: number;
  waterType?: JerlovWaterType;
  windSpeedMps?: number;
  windDirectionRadians?: number;
  sunElevationDegrees?: number;
  sunAzimuthRadians?: number;
  /**
   * How far out the camera orbits, from `camera.distance`. The seabed keeps its
   * boulders beyond it — see SeabedOptions.
   */
  cameraDistanceMetres?: number;
  /**
   * How strong the shafts are, from `lighting.godRayStrength`.
   *
   * A stored config field, not a local guess. The rig used to compute
   * `pow(brightness, 1.3)` instead, which meant the backend published a value
   * the renderer ignored — and the depth curve is where this belongs, because
   * god rays reaching zero exactly at the sunlight floor is the property that
   * makes "the abyss has no rays" fall out of physics rather than out of a rule
   * somebody has to remember.
   */
  godRayStrength?: number;
  /** Fewer instances and a smaller shadow map on a phone. */
  quality?: "high" | "low";
};

export type OceanRigState = {
  seaState: SeaState;
  sightingRangeMetres: number;
  surfaceInSight: boolean;
  seafloorInSight: boolean;
  /** True when the viewer is in air rather than in water. */
  aboveWater: boolean;
  /**
   * How far the camera must be able to see, in metres.
   *
   * Underwater this is a formality — the water stops the view long before any
   * default far plane does. In air it is not: the sea grid reaches 5.6 km and
   * the sky dome sits beyond it, and r3f's default far plane of 1000 clips
   * BOTH, which renders as a bare grey band where the sky should be and a
   * blown white seam where the sea is cut off. The view has to be told.
   */
  farPlaneMetres: number;
  /** Species drawn at this depth, for a readout or a rarity catalogue. */
  present: string[];
};

export type OceanRig = {
  group: Group;
  state: OceanRigState;
  /**
   * The floor, sampled. Anything that stands on the seabed — a landmark, a
   * relic, a coral head — must use THIS and not a second sampler, or it hovers
   * exactly as far above the sand as the two disagree.
   */
  heightAt: (x: number, z: number) => number;
  update: (elapsed: number, camera: Camera) => void;
  dispose: () => void;
};

export function createOceanRig(options: OceanRigOptions): OceanRig {
  const {
    renderer,
    scene,
    seed,
    viewerDepthMetres,
    seafloorDepthMetres,
    waterType = DEFAULT_WATER_TYPE,
    windSpeedMps = 9,
    windDirectionRadians = 0.62,
    sunElevationDegrees = 46,
    sunAzimuthRadians = OCEAN_SUN_AZIMUTH_RADIANS,
    godRayStrength,
    cameraDistanceMetres = 20,
    quality = "high",
  } = options;

  const group = new Group();
  const disposables: { dispose: () => void }[] = [];
  const high = quality === "high";

  // ---- the sun, once ----------------------------------------------------
  // Computed before the medium, because above the waterline the exposure is
  // metered against the sun's height and the medium needs to know it.
  const sunElevation = (sunElevationDegrees * Math.PI) / 180;
  const sunAbove = new Vector3(
    Math.cos(sunElevation) * Math.cos(sunAzimuthRadians),
    Math.sin(sunElevation),
    Math.cos(sunElevation) * Math.sin(sunAzimuthRadians),
  );
  const refracted = refractedSunElevationRadians(sunElevation);
  const sunBelow = new Vector3(
    Math.cos(sunAzimuthRadians) * Math.cos(refracted),
    Math.sin(refracted),
    Math.sin(sunAzimuthRadians) * Math.cos(refracted),
  ).normalize();
  const coefficients = skyCoefficients(sunElevation);
  const skyShared = {
    uSkySunDirection: { value: sunAbove.clone() },
    uBetaR: { value: new Vector3(...coefficients.betaR) },
    uBetaM: { value: new Vector3(...coefficients.betaM) },
    uSunE: { value: coefficients.sunE },
    uSunfade: { value: coefficients.sunfade },
    uMieG: { value: coefficients.mieDirectionalG },
  };

  // ---- the medium -------------------------------------------------------
  // ONE branch decides the whole scene. Above the waterline the medium is air,
  // and air is not water with different numbers — light survives kilometres
  // instead of tens of metres, distance ADDS haze instead of subtracting
  // colour, and nothing in frame is dark. Everything downstream reads these
  // same five values, so nothing downstream needs its own waterline test.
  const above = isAboveWater(viewerDepthMetres);
  const attenuation = waterAttenuation(waterType);
  const palette = above ? airPalette() : waterPalette(waterType, viewerDepthMetres);
  const range = above ? AIR_SIGHTING_RANGE_METRES : sightingRangeMetres(attenuation);
  const fogColor = new Color(palette.fog[0], palette.fog[1], palette.fog[2]);
  const floorClearance = Math.max(0, seafloorDepthMetres - viewerDepthMetres);
  const reach = range * BOUNDARY_SIGHT_MULTIPLIER;
  // From the air the seabed is never the subject, even when the water is clear
  // enough to see it: drawing it costs a full terrain and buys a smudge.
  const seafloorInSight = !above && floorClearance <= reach;
  const surfaceInSight = above || viewerDepthMetres <= reach;

  const brightness = palette.brightness;
  const biolum = above ? 0 : Math.min(1, Math.max(0, (viewerDepthMetres - 90) / 420));
  // Never zero: an eye adapts, and multiplying a palette by zero produces a
  // black rectangle rather than an image.
  //
  // The whole light rig runs on this rather than on raw irradiance, and it is the
  // prototype's own choice, kept deliberately: the RATIOS between key, fill and
  // ambient are what carry depth, and ratios survive being exposed for. It does
  // mean the abyss draws a slightly stronger key than the twilight zone (1.74
  // against 1.53), which looks like an inversion and is not one — the key's
  // COLOUR goes almost black down there, so the product still falls. Driving the
  // key from `brightness` instead was tried and measured: it moved the abyss by
  // 0.006 luma, which is to say the key was never what made it bright.
  const litness = Math.max(brightness, 0.11 + 0.3 * biolum);

  scene.fog = new FogExp2(fogColor.getHex(), palette.fogDensity);

  // The adaptation, applied where it belongs: on the renderer.
  //
  // This is the whole point of the ocean bypassing the post chain. While the
  // composer was mounted it set gl.toneMapping = NoToneMapping, so this property
  // was read by nothing and the curve had to be hand-injected into every
  // material; now the renderer's own ACES reads it, which is exactly the
  // arrangement the prototype's grade was designed and measured under.
  const exposure = above ? airExposure(sunAbove.y) : adaptationExposure(brightness);
  renderer.toneMappingExposure = exposure;
  // The clear colour is the fog, unmodified. It is not a fragment, so the tone
  // curve never reaches it — which is also true of the prototype, and is why
  // matching it means NOT pre-multiplying by the exposure here.
  renderer.setClearColor(fogColor, 1);

  // ---- the sea state ----------------------------------------------------
  const seaState = buildSeaState({
    windSpeedMps,
    windDirectionRadians,
    random: randomFromSeed(`${seed}:sea-state`),
    componentCount: WAVE_MAX,
  });
  const waveDirections: Vector2[] = [];
  const waveTerms: Vector4[] = [];
  for (let i = 0; i < WAVE_MAX; i += 1) {
    const wave = seaState.components[i];
    waveDirections.push(
      wave ? new Vector2(Math.cos(wave.direction), Math.sin(wave.direction)) : new Vector2(1, 0),
    );
    waveTerms.push(
      wave
        ? new Vector4(wave.amplitude, wave.wavenumber, wave.angularFrequency, wave.phase)
        : new Vector4(0, 0.1, 0, 0),
    );
  }
  const waveShared = {
    uWaveDir: { value: waveDirections },
    uWaveTerm: { value: waveTerms },
    uWaveCount: { value: WAVE_MAX },
    uChoppiness: { value: seaState.choppiness },
    uWaveTime: { value: 0 },
  };

  // ---- lights -----------------------------------------------------------
  // Key-to-fill discipline: a strong single key with a weak fill. An ambient
  // raised to "brighten the scene" lights every face of every object equally
  // and flattens all of them, which is what turned the seabed into a slab.
  // Normalised by its own peak and floored per channel — see keyLightColour.
  // Above the waterline the key is simply the sun, undimmed.
  const keyChannels = above ? SURFACE_SUN : keyLightColour(waterType, viewerDepthMetres);
  const keyColor = new Color(keyChannels[0], keyChannels[1], keyChannels[2]);
  const keyLight = new DirectionalLight(keyColor, 3.4 * (0.25 + litness * 0.9));
  keyLight.position.copy(above ? sunAbove : sunBelow).multiplyScalar(95);
  keyLight.castShadow = high;
  if (high) {
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -85;
    keyLight.shadow.camera.right = 85;
    keyLight.shadow.camera.top = 85;
    keyLight.shadow.camera.bottom = -85;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 260;
    keyLight.shadow.bias = -0.0006;
    keyLight.shadow.normalBias = 0.04;
  }
  group.add(keyLight);

  // The complementary fill. A single teal key makes every surface one hue; real
  // water fills from every direction through multiple scattering.
  const fillLight = new DirectionalLight(new Color("#3B2E7A"), 0.95 * (0.25 + litness));
  fillLight.position.set(30, -12, -26);
  group.add(fillLight);

  const ambientLight = new AmbientLight(
    fogColor.clone().lerp(new Color("#5C86A8"), 0.35),
    0.3 + brightness * 0.28,
  );
  group.add(ambientLight);

  const hemisphereLight = new HemisphereLight(
    keyColor,
    fogColor.clone().multiplyScalar(0.4),
    0.7 * (0.3 + litness),
  );
  group.add(hemisphereLight);

  // The submersible lamp. Below the photic zone there is no other way to see
  // anything, which is why every image humanity owns of the deep sea was lit
  // this way — and it earns back the one thing absorption takes, near-field
  // colour, at exactly the depth where the frame has nothing else in it.
  // 40 m of reach with inverse-square decay, NOT the prototype's 140 m at 1.3.
  //
  // The prototype's own note says what this light is for: "near field hot, mid
  // field carved, far field gone -- which is the entire look of deep-sea
  // footage." Its numbers do not produce that. three.js applies NO inverse-square
  // term once `distance` is set; the whole falloff is
  // `pow(1 - d/distance, decay)`, so 140 m at 1.3 runs from 1.00 at the lens to
  // 0.75 at thirty metres. That is a floodlight with a soft edge, and at
  // intensity 300 it lit the entire visible seabed evenly.
  //
  // Measured: with the lamp on, the abyssal plain came out at 0.549 luma against
  // the prototype's 0.191; with it off, 0.024 with 65% of pixels crushed. It is
  // the only light down there, so it alone sets the level, and it was about three
  // times too much of it. 40 m at decay 2 gives 0.81 at four metres, 0.56 at ten,
  // 0.25 at twenty and 0.06 at thirty — the pool the note describes.
  //
  // The reach is PROPORTIONAL TO HOW CLOSE THE LAMP IS FLYING, because a fixed
  // reach cannot serve both ends of the clearance band. Abyssal worlds sit 2 to
  // 9 m off the bottom; at 9 m a 40 m pool is right, and at 2 m the same pool
  // puts the sand deep inside the hot centre and blows it flat — measured as 0.543
  // luma on a create-page abyss against 0.179 on a world 5.5 m up, the same
  // preset three times too bright for no reason the person chose.
  //
  // Four times the clearance keeps the attenuation at the floor directly below
  // the lens at pow(1 - 1/4, 2) = 0.56 whatever the clearance is, so the seabed
  // arrives at one exposure across the band. Clamped at both ends: a lamp is a
  // fitted object, not a function of altitude.
  const diveLightReach = Math.min(60, Math.max(20, floorClearance * 4));
  const diveLight = new PointLight(0xcfebff, 0, diveLightReach, 2);
  diveLight.intensity = above ? 0 : 300 * Math.pow(1 - Math.min(1, brightness / 0.34), 2);
  diveLight.color.copy(keyColor).lerp(new Color("#CFEBFF"), 0.8);
  group.add(diveLight);

  // ---- the backdrop -----------------------------------------------------
  // Graded by view direction so the horizon is EXACTLY the fog colour and
  // distant geometry dissolves instead of meeting a seam.
  const backdropUniforms = {
    uHorizon: { value: above ? new Color(SKY_HAZE) : fogColor.clone() },
    uUp: { value: keyColor.clone().multiplyScalar(0.85).lerp(fogColor, 0.3) },
    uDown: { value: fogColor.clone().multiplyScalar(0.3) },
    // Underwater there is no sun in the backdrop — the surface layer owns it.
    // Above water the backdrop IS the sky, so the same dome grows a disc, a Mie
    // forward-scatter lobe and a reddened horizon, and all three fall out of
    // Preetham rather than being three hand-tuned powers of a dot product.
    uSunGlow: { value: above ? 1 : 0 },
    ...skyShared,
  };
  const backdropGeometry = new SphereGeometry(420, 32, 24);
  const backdropMaterial = new ShaderMaterial({
    uniforms: backdropUniforms,
    side: BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `varying vec3 vW;
      void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }`,
    fragmentShader: `
      uniform vec3 uHorizon; uniform vec3 uUp; uniform vec3 uDown;
      uniform float uSunGlow;
      ${SKY_UNIFORMS_GLSL}
      varying vec3 vW;
      ${PREETHAM_SKY_GLSL}
      void main(){
        vec3 dir = normalize(vW - cameraPosition);
        vec3 c;
        if (uSunGlow > 0.001) {
          c = preethamSky(dir, true);
        } else {
          c = uHorizon;
          c = mix(c, uUp,   pow(clamp( dir.y, 0.0, 1.0), 1.5));
          c = mix(c, uDown, pow(clamp(-dir.y, 0.0, 1.0), 1.4));
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const backdrop = new Mesh(backdropGeometry, backdropMaterial);
  // The sky has to sit OUTSIDE the sea grid, which reaches 5.6 km. Underwater
  // the dome is a 420 m shell because that is past anything the water lets you
  // see; in air the same shell would be a wall halfway to the horizon.
  // 9, matching the prototype. 16 pushes the dome to 6.7 km, past the sea grid's
  // 5.6 km outer ring, which leaves a band of clear colour between the far water
  // and the sky — the grey seam the horizon used to have.
  if (above) backdrop.scale.setScalar(9);
  backdrop.renderOrder = -1000;
  group.add(backdrop);
  disposables.push(backdropGeometry, backdropMaterial);

  // ---- the surface, seen from below -------------------------------------
  const surfaceUniforms = {
    uWaterColor: { value: fogColor.clone() },
    uDeepColor: { value: fogColor.clone().multiplyScalar(0.25) },
    uSunColor: { value: new Color("#FFF6E2") },
    uSunDirection: { value: sunBelow.clone() },
    uBrightness: { value: 0.8 + brightness * 0.35 },
    uFogDensity: { value: palette.fogDensity },
    // How much of the sky survives the trip down. Anchored to the water's own
    // value so the window keeps its ratio to the water at every depth.
    uSkyGain: { value: 0.16 + palette.fogValue * 0.62 },
    // Read from below the eye sees SLOPES, not crests; full height turns the
    // ceiling into corrugated iron.
    uWaveDamping: {
      value: Math.min(0.85, Math.max(0.2, 0.22 + 0.3 / Math.max(0.35, seaState.significantHeightMetres))),
    },
    uFoamEdge: { value: foamFoldThreshold(seaState.whitecapFraction) },
    ...skyShared,
    ...waveShared,
  };
  const surfaceGeometry = new PlaneGeometry(900, 900, high ? 280 : 120, high ? 280 : 120);
  surfaceGeometry.rotateX(-Math.PI / 2);
  const surfaceMaterial = new ShaderMaterial({
    uniforms: surfaceUniforms,
    side: DoubleSide,
    transparent: true,
    fog: false,
    vertexShader: `
      uniform float uWaveDamping;
      ${WAVE_UNIFORMS_GLSL(WAVE_MAX)}
      varying vec3 vWorld; varying vec3 vWaveNormal;
      ${GERSTNER_SURFACE_GLSL(WAVE_MAX)}
      void main(){
        vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 offset; vec3 normal; float fold;
        oceanSurface(world.xz, offset, normal, fold);
        world += offset * uWaveDamping;
        vWorld = world;
        vWaveNormal = normalize(mix(vec3(0.0, 1.0, 0.0), normal, uWaveDamping));
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uWaterColor; uniform vec3 uDeepColor; uniform vec3 uSunColor;
      uniform vec3 uSunDirection; uniform float uBrightness; uniform float uFogDensity;
      uniform float uSkyGain;
      ${SKY_UNIFORMS_GLSL}
      varying vec3 vWorld; varying vec3 vWaveNormal;
      ${PREETHAM_SKY_GLSL}
      void main(){
        vec3 view = normalize(vWorld - cameraPosition);
        vec3 n = normalize(vWaveNormal);
        // Measure the critical angle against a TILTED normal, not the full wave
        // normal: at a real swell height the window otherwise fragments into
        // patches instead of holding as one disc.
        vec3 tilted = normalize(mix(vec3(0.0, 1.0, 0.0), n, 0.32));
        float upness = abs(dot(view, tilted));
        float sinTheta = sqrt(max(0.0, 1.0 - upness * upness));
        // Beyond sin(theta) = 1/1.333 nothing can refract in, so the surface
        // goes total-internal-reflection: a mirror, not a window.
        float window = 1.0 - smoothstep(0.70, 0.775, sinTheta);
        vec3 sky = skyThroughSnellsWindow(view, sinTheta) * uSkyGain;
        sky += uSunColor * pow(max(0.0, n.y), 6.0) * 0.06 * window;

        vec3 mirror = mix(uDeepColor, uWaterColor, pow(upness, 0.7)) + uWaterColor * 0.85;
        float fresnel = 0.02 + 0.98 * pow(1.0 - upness, 5.0);
        vec3 color = mix(mirror, sky, window);
        color = mix(color, uWaterColor, fresnel * (1.0 - window) * 0.6);

        // The same extinction law the medium uses, because this sheet is IN the
        // medium. Overhead it is metres away and survives; at the grazing angles
        // that would otherwise paint the whole upper frame it is hundreds of
        // metres away and is gone.
        float d = length(vWorld - cameraPosition);
        float swallow = 1.0 - exp(-pow(d * uFogDensity, 2.0));
        color = mix(color, uWaterColor, clamp(swallow, 0.0, 1.0));

        gl_FragColor = vec4(color * uBrightness, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const surface = new Mesh(surfaceGeometry, surfaceMaterial);
  surface.position.y = viewerDepthMetres;
  // Crossing the waterline swaps WHICH FACE of the same sheet of water is being
  // drawn. Two materials, one surface, and never both on — so they can never
  // fight over the depth buffer.
  surface.visible = surfaceInSight && !above;
  group.add(surface);
  disposables.push(surfaceGeometry, surfaceMaterial);

  // ---- the surface, seen from above -------------------------------------
  let seaTop: SeaTop | null = null;
  if (above) {
    seaTop = createSeaTop({
      renderer,
      waveMax: WAVE_MAX,
      skyShared,
      waveShared,
      whitecapFraction: seaState.whitecapFraction,
      quality,
    });
    seaTop.mesh.position.y = viewerDepthMetres;
    group.add(seaTop.mesh);
  }

  // ---- god rays ---------------------------------------------------------
  // Ray-marched, with the noise sampled in the plane PERPENDICULAR to the
  // light: sampled in world space it makes clouds, and only a cross-section
  // makes ribbons. Accumulate the MEAN, not the sum, or the brightness tracks
  // the step count instead of the water.
  const godRayUniforms = {
    uTime: { value: 0 },
    // Halved from the first port. Additive over a whole hemisphere is the one
    // term in this scene that can wash every other one out, and at 2.2 it
    // turned a bright shallow world into a milky rectangle — the god rays were
    // not visible AS rays, they were just a fog multiplier.
    // 2.2, matching the prototype. 1.05 was less than half strength and it is
    // why the app has a diffuse glow where the prototype has a distinct shaft:
    // the beams were never bright enough to read as separate from the water.
    uStrength: {
      value: above ? 0 : (godRayStrength ?? Math.pow(brightness, 1.3)) * 2.2,
    },
    uRayColor: { value: keyColor.clone().lerp(new Color("#DCF6FF"), 0.35) },
    uSunDirection: { value: sunBelow.clone() },
    uAxisA: { value: new Vector3(1, 0, 0) },
    uAxisB: { value: new Vector3(0, 0, 1) },
    uExtinction: { value: palette.fogDensity },
    uMarchDistance: { value: range * 1.8 },
    uSurfaceY: { value: viewerDepthMetres },
  };
  const godRayGeometry = new SphereGeometry(120, 24, 18);
  const godRayMaterial = new ShaderMaterial({
    uniforms: godRayUniforms,
    side: BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    fog: false,
    vertexShader: `varying vec3 vW;
      void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform float uStrength; uniform vec3 uRayColor;
      uniform vec3 uSunDirection; uniform vec3 uAxisA; uniform vec3 uAxisB;
      uniform float uExtinction; uniform float uMarchDistance; uniform float uSurfaceY;
      varying vec3 vW;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
                   mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; }
        return v;
      }
      void main(){
        vec3 dir = normalize(vW - cameraPosition);
        float accumulated = 0.0;
        const int STEPS = 24;
        for (int i = 0; i < STEPS; i++){
          float t = (float(i) + 0.5) / float(STEPS);
          vec3 p = cameraPosition + dir * t * uMarchDistance;
          if (p.y > uSurfaceY) continue;
          // Sampled in the plane across the beam, which is what turns a cloud
          // into a ribbon.
          vec2 beamPlane = vec2(dot(p, uAxisA), dot(p, uAxisB));
          float density = fbm(beamPlane * 0.09 + vec2(uTime * 0.02, 0.0));
          // Threshold ABOVE the mean, or the whole volume glows.
          density = smoothstep(0.52, 0.86, density);
          accumulated += density * exp(-t * uMarchDistance * uExtinction);
        }
        float mean = accumulated / float(STEPS);
        // Hard ceiling. This is additive and depth-tested off, so an unbounded
        // value here is the one thing in the scene able to paint over
        // everything else, and it did.
        // Unclamped. The 0.62 ceiling was a workaround for the composer having
        // disabled tone mapping, where anything past 1.0 clipped flat to white;
        // with the renderer's ACES back, its shoulder does that job properly and
        // the ceiling only flattens the top of every shaft.
        vec3 rays = uRayColor * mean * uStrength;
        gl_FragColor = vec4(rays, 1.0);
        // Additive, so raw linear: see oceanRigDrifters.ts. THIS is the layer
        // that made it obvious. Encoded, the rays clipped the entire visible
        // band of a 14 m reef to pure white — 100% of measured pixels — while
        // the camera happened to point away from them, so it went unseen until
        // the framing was corrected to look up along the shafts.
      }`,
  });
  const godRays = new Mesh(godRayGeometry, godRayMaterial);
  godRays.visible = !above && godRayUniforms.uStrength.value > 0.004;
  group.add(godRays);
  disposables.push(godRayGeometry, godRayMaterial);

  // ---- marine snow and the light that living things make ----------------
  // Four layers, not one. A single layer at one radius and one fall rate is a
  // uniform haze that reads as a dirty lens; the parallax between a near layer
  // and a far one is what reads as a medium. See oceanRigDrifters.ts.
  const moteLayers = createMoteLayers({
    random: randomFromSeed(`${seed}:marine-snow`),
    quality,
  });
  for (const layer of moteLayers) {
    layer.uniforms.uFogColor.value.copy(fogColor);
    layer.uniforms.uFogDensity.value = palette.fogDensity;
    // Snow keeps its authored opacity; the living layer rides bioluminescence,
    // so it is nearly out at the surface and full in the dark.
    if (layer.living) layer.uniforms.uMoteOpacity.value = 0.12 + biolum * 0.88;
    layer.points.visible = !above;
    group.add(layer.points);
    disposables.push(layer);
  }

  // ---- the drifting bells -----------------------------------------------
  // The only animals a midwater world can have, and in the dark the only light.
  const jellyfish = createJellyfish({
    count: high ? 110 : 46,
    random: randomFromSeed(`${seed}:jellyfish`),
    radius: 62,
    columnHeight: 40,
  });
  jellyfish.uniforms.uJellyGlow.value = 0.07 + biolum * 1.05;
  jellyfish.uniforms.uJellyColor.value.set("#7FE9FF").lerp(new Color("#48FFD5"), biolum);
  jellyfish.mesh.visible = !above;
  group.add(jellyfish.mesh);
  disposables.push(jellyfish);


  // ---- the floor --------------------------------------------------------
  let seabed: Seabed | null = null;
  if (seafloorInSight) {
    seabed = createSeabed({
      extent: 680,
      segments: high ? 300 : 120,
      windDirectionRadians,
      seed,
      renderer,
      cameraDistanceMetres,
    });
    seabed.group.position.y = -floorClearance;
    tintSeabed(
      seabed,
      fogColor,
      brightness,
      // Caustics need the surface pattern to still be coherent, which is a
      // scattering question: a few attenuation lengths of blur and it is gone.
      Math.pow(Math.min(1, Math.max(0, 1 - viewerDepthMetres / (2.4 * range))), 1.4),
      keyColor,
    );
    group.add(seabed.group);
  }

  // ---- what grows on it -------------------------------------------------
  // Inside the seabed's own group, so it rides the same floor offset, and
  // standing on the seabed's OWN sampler. A second height function is how
  // kelp ends up hovering a metre over the sand.
  let flora: Flora | null = null;
  let ridges: RidgeSilhouettes | null = null;
  let bubbles: Bubbles | null = null;
  if (seabed) {
    const floorSampler = seabed.heightAt;
    flora = createFlora({
      seed,
      basinRadius: 300,
      cameraDistanceMetres,
      floorDepthMetres: seafloorDepthMetres,
      onePercentBlueDepthMetres: onePercentBlueDepthMetres(attenuation),
      heightAt: floorSampler,
      caustics: seabed.causticUniforms,
      currentStrength: Math.min(1.4, 0.4 + seaState.significantHeightMetres * 0.3),
      quality,
    });
    flora.tint(fogColor, brightness);
    seabed.group.add(flora.group);

    // Three rings of unlit masses receding into the fog. Without them a seabed
    // ends in flat haze and the frame has no way to say how far the far edge is.
    ridges = createRidgeSilhouettes({
      random: randomFromSeed(`${seed}:ridges`),
      heightAt: floorSampler,
    });
    for (const material of ridges.materials) {
      material.color.copy(fogColor).multiplyScalar((material.userData.dark as number) * 0.72);
    }
    seabed.group.add(ridges.group);
    disposables.push(ridges);

    // Bubbles come from VENTS: a stream reads as bubbles, a uniform scatter
    // reads as dust.
    bubbles = createBubbles({
      count: high ? 700 : 240,
      random: randomFromSeed(`${seed}:bubbles`),
      radiusOuter: 44,
    });
    bubbles.uniforms.uBubbleTop.value = Math.min(floorClearance + 24, 90);
    bubbles.uniforms.uBubbleTint.value
      .copy(keyColor)
      .lerp(new Color("#DCF6FF"), 0.5)
      .multiplyScalar(0.6 + brightness);
    seabed.group.add(bubbles.mesh);
    disposables.push(bubbles);
  }

  // ---- the foreground frame ---------------------------------------------
  // Locked to the camera in `update` rather than parented to it: the camera is
  // SHARED with every other scene family, and adding children to it would leak
  // four black fronds into the universe the moment an ocean world unmounted
  // without a perfectly symmetric teardown.
  //
  // GATED TO WHERE ALGAE CAN ACTUALLY GROW, which is a correction. The
  // prototype draws these at every depth because it is a style study and the
  // frame is all it cares about; here they were reported as "two strange objects
  // stuck to the left and right corners", and the reporter was right. A frond is
  // vegetation. In the twilight zone and the abyss it is vegetation with no
  // sunlight, growing out of nothing, two metres from a lens 140 m down — so it
  // cannot read as a plant, and anything in frame that cannot be read as
  // something is read as a fault in the picture.
  //
  // The condition is the same physics the flora already uses: algae stop at the
  // depth blue light stops. Plus a floor for it to grow from, because a frond
  // hanging in open midwater is the same problem in a different place. Where the
  // gate closes, the near-field cue is carried by the nearest marine-snow layer,
  // which is honest at any depth.
  const frondsCouldGrowHere =
    !above &&
    seafloorInSight &&
    viewerDepthMetres <= algaeDepthLimitMetres(onePercentBlueDepthMetres(attenuation));
  const foreground = frondsCouldGrowHere ? createForegroundFrame() : null;
  if (foreground) {
    // 0.42 of the water's own colour. A flat 0.16 was a near-black bar against
    // dark water and read as chrome against bright water; scaling the fog keeps
    // it a frond at every depth.
    foreground.material.color.copy(fogColor).multiplyScalar(0.42);
    group.add(foreground.group);
    disposables.push(foreground);
  }

  // ---- the animals ------------------------------------------------------
  const creatureTime = { value: 0 };
  const schools: School[] = [];
  const present: string[] = [];
  for (const species of OCEAN_RIG_SPECIES) {
    if (!speciesIsPresent(species, viewerDepthMetres, seafloorInSight, surfaceInSight)) continue;
    // Visible from the first frame, with a procedural body. A GLB is an upgrade
    // applied under the running animation, not a precondition for existing.
    const school = createSchool(species, seed, creatureTime, range);
    if (species.nearField) {
      // Near-field animals keep their own colour and lift it with a matching
      // emissive, so the one warm note a reef has does not get graded away by
      // the water it is sitting in.
      school.material.emissive.copy(school.material.color);
      school.material.emissiveIntensity = 0.34 * (0.35 + brightness) + biolum * 0.8;
      if (!school.material.emissiveMap) {
        // Without this, the flat emissive wash above is a uniform colour with
        // no spatial variation at all, added straight on top of whatever
        // texture material.map carries. For a species with a real GLB (a much
        // stronger per-vertex signal) or actual photophore dots (their own
        // emissiveMap, already set above and left alone by this guard) that
        // barely matters — but a bare procedural body's ONLY detail is the
        // ±20% grey mottle bake, and at this emissiveIntensity the uniform
        // wash swamps it, leaving what reads as a flat paint swatch (this is
        // why the giant Pacific octopus rendered with zero visible texture).
        // Mapping the emissive by the SAME grey texture keeps that mottle's
        // contrast alive in the emissive channel instead of erasing it.
        school.material.emissiveMap = school.material.map;
      }
    } else if (species.glowColor === null) {
      // An explicit opt-out (fangtooth): ultra-black deep-sea skin traps
      // light rather than emitting any, and the default teal wash would
      // undercut that identity even at a faint intensity.
      school.material.emissiveIntensity = 0;
    } else {
      // A lanternfish is a DARK fish wearing lights. Making the whole body emit
      // turns a school into a cloud of pale flakes, which is what the abyss
      // looked like; the body stays nearly black and the photophores are the
      // light. glowColor lets a species override the default teal — black
      // dragonfish's real bioluminescence is red, not teal like every other
      // deep species here.
      school.material.emissive.set(species.glowColor ?? "#3BE0C8");
      school.material.emissiveIntensity = biolum * 0.16;
    }
    group.add(school.mesh);
    schools.push(school);
    present.push(species.label);
    void loadSpeciesGeometry(species)
      .then((model) => {
        if (model) school.adopt(model);
      })
      .catch(() => {
        // A failed fetch is not a missing animal any more: the procedural body
        // is already on screen and stays.
      });
  }

  // Every predator school's leader positions, flattened once — built here
  // rather than per frame so a prey school's alarm scan (see
  // oceanRigFauna.ts's School.update) stays O(threats), never O(schools²).
  // The Vector3 instances are the SAME ones each predator school's own
  // update() mutates every frame, so this list never needs rebuilding.
  const threats: Vector3[] = [];
  for (const school of schools) {
    if (school.predatorAnchors) threats.push(...school.predatorAnchors);
  }

  const bounds = {
    surfaceY: surfaceInSight ? viewerDepthMetres : null,
    floorY: seafloorInSight ? -floorClearance : null,
  };

  const cameraPosition = new Vector3();
  const forward = new Vector3();

  return {
    group,
    heightAt: (x, z) => (seabed ? seabed.heightAt(x, z) : 0),
    state: {
      seaState,
      sightingRangeMetres: range,
      surfaceInSight,
      seafloorInSight,
      aboveWater: above,
      // 9000 clears the 9x dome with room to spare. 12000 spends measurably more
      // of the depth buffer for nothing, and the sea grid ends at 5.6 km.
      farPlaneMetres: above ? 9000 : Math.max(720, range * 6),
      present: flora ? [...present, ...flora.present] : present,
    },
    update: (elapsed, camera) => {
      camera.getWorldPosition(cameraPosition);
      creatureTime.value = elapsed;
      waveShared.uWaveTime.value = elapsed;
      godRayUniforms.uTime.value = elapsed;
      for (const layer of moteLayers) layer.uniforms.uMoteTime.value = elapsed;
      jellyfish.uniforms.uJellyTime.value = elapsed;
      if (bubbles) bubbles.uniforms.uBubbleTime.value = elapsed;
      if (seaTop) seaTop.uniforms.uTime.value = elapsed;
      if (flora) flora.update(elapsed);
      if (seabed) seabed.causticUniforms.uCausticTime.value = elapsed;

      // Keep the god-ray noise plane perpendicular to the light, or the beams
      // become clouds.
      godRayUniforms.uAxisA.value.set(1, 0, 0).cross(sunBelow).normalize();
      godRayUniforms.uAxisB.value.copy(sunBelow).cross(godRayUniforms.uAxisA.value).normalize();

      backdrop.position.copy(cameraPosition);
      godRays.position.copy(cameraPosition);
      // The snow travels with the viewer: a fixed cloud is a box you swim out of.
      for (const layer of moteLayers) {
        layer.points.position.set(cameraPosition.x, 0, cameraPosition.z);
      }
      jellyfish.mesh.position.set(cameraPosition.x, 0, cameraPosition.z);
      surface.position.x = cameraPosition.x;
      surface.position.z = cameraPosition.z;
      // The polar grid's fine rings are only fine NEAR THE VIEWER, so the sea
      // has to travel with the camera or the resolution ends up somewhere else.
      if (seaTop) {
        seaTop.mesh.position.x = cameraPosition.x;
        seaTop.mesh.position.z = cameraPosition.z;
      }

      camera.getWorldDirection(forward);
      diveLight.position.copy(cameraPosition).addScaledVector(forward, 2.2);

      // The frame rides the lens exactly, which is what parenting it to the
      // camera would do — without mutating a camera three other families share.
      if (foreground) {
        foreground.group.position.copy(cameraPosition);
        camera.getWorldQuaternion(foreground.group.quaternion);
        foreground.update(elapsed);
      }

      for (const school of schools) school.update(elapsed, bounds, threats, cameraPosition);
    },
    dispose: () => {
      for (const school of schools) school.dispose();
      if (flora) flora.dispose();
      if (seaTop) seaTop.dispose();
      if (seabed) seabed.dispose();
      for (const item of disposables) item.dispose();
      scene.fog = null;
    },
  };
}

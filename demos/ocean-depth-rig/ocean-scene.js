/* =========================================================================
   Ocean style study, v2 — the art direction proposed in
   agent-system/evolution/ocean-visual-direction-research.md, made visible.

   WHAT CHANGED FROM v1, AND WHY IT MATTERED
   v1 varied only the PALETTE with depth: the seabed sat at the same distance
   whether the viewer was at 17 m or 2431 m. That is brightness-by-depth, not
   depth. Depth is a SPATIAL fact and it has to move geometry:

     floorClearance  = seafloorMetres - viewerMetres    (how far down the bed is)
     surfaceDistance = viewerMetres                     (how far up the sky is)

   and each boundary is drawn only when it lies within about 1.5 visibilities.
   That one rule produces four genuinely different worlds out of two numbers:
   a reef with both boundaries in frame, open water with only the surface, a
   twilight column with neither, and an abyssal plain with only the floor.
   The real renderer already models this; v1 threw it away.

   Runs with NO post-processing on purpose: ocean-service-plan.md §12 requires
   the frame to read with the effect stack disabled.
   ========================================================================= */

(function () {
  "use strict";

  const canvas = document.getElementById("view");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  // Contact shadows are the cheapest realism left: a fish without one is
  // pasted onto the sand, and a boulder without one is a decal. The frustum is
  // deliberately small -- 170 m across, not the 680 m of the floor -- because
  // shadow quality is resolution per metre and nothing beyond a sighting range
  // is visible anyway.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const MAX_ANISOTROPY = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1400);
  const clock = new THREE.Clock();

  /* =======================================================================
     1. THE DEPTH CURVE + BATHYMETRY
     An approximation of the ocean service's depth_curve.go, good enough to
     drive art direction. The light-remaining table is the sourced one from
     agent-system/evolution/ocean-family-research.md.
     ======================================================================= */

  /* ---- WATER, AS AN OPTICAL MEDIUM WITH A NAME --------------------------
     Jerlov (1976) classified the world's water by its downwelling diffuse
     attenuation coefficient Kd, and the classification is still what ocean
     optics uses: I, IA, IB, II, III for open ocean, 1C to 9C for coastal.
     I is the clearest water on Earth (the central gyres); 5C is an estuary.
     Published Kd at 475 nm, in m^-1:
        I    0.025      IA   0.038      IB   0.050
        II   0.085      III  0.130      1C   0.20
        3C   0.42       5C   0.70       7C   1.20      9C   2.00
     (Ranges rather than points in the literature; these are mid-band values.)

     The demo needs Kd per RGB channel, and the papers publish spectra. Rather
     than pretend to a table this file does not have, it is reconstructed from
     two terms that are each individually sourced:

       Kd(channel) = a_water(channel) + load * shape(channel)

     a_water is the absorption of PURE seawater, which no water can be clearer
     than: about 0.30 / 0.065 / 0.016 per metre at red / green / blue. It is why
     red dies in the first few metres of even the clearest ocean, and it is a
     floor, not a parameter. `load` is the type's own attenuation above that
     floor, and its spectral shape is weighted toward blue because what makes
     water turbid -- CDOM and phytoplankton -- absorbs hardest at short
     wavelengths. THAT is why coastal water is green and open ocean is blue:
     not "more attenuation", but attenuation with a different colour.
     ---------------------------------------------------------------------- */
  const PURE_SEAWATER_KD = [0.30, 0.065, 0.016];
  const TURBIDITY_SHAPE = [0.5, 0.8, 1.0];
  const JERLOV_TYPES = [
    { name: "I", label: "open ocean, clearest", kd475: 0.025 },
    { name: "IA", label: "open ocean", kd475: 0.038 },
    { name: "IB", label: "open ocean", kd475: 0.050 },
    { name: "II", label: "open ocean, productive", kd475: 0.085 },
    { name: "III", label: "open ocean, turbid", kd475: 0.130 },
    { name: "1C", label: "coastal, clear", kd475: 0.20 },
    { name: "3C", label: "coastal", kd475: 0.42 },
    { name: "5C", label: "coastal, turbid", kd475: 0.70 },
    { name: "7C", label: "estuarine", kd475: 1.20 }
  ];

  let waterTypeIndex = 2;
  const waterKd = new THREE.Vector3();

  function setWaterType(index) {
    waterTypeIndex = THREE.MathUtils.clamp(index, 0, JERLOV_TYPES.length - 1);
    const type = JERLOV_TYPES[waterTypeIndex];
    const load = Math.max(0, type.kd475 - PURE_SEAWATER_KD[2]);
    waterKd.set(
      PURE_SEAWATER_KD[0] + load * TURBIDITY_SHAPE[0],
      PURE_SEAWATER_KD[1] + load * TURBIDITY_SHAPE[1],
      PURE_SEAWATER_KD[2] + load * TURBIDITY_SHAPE[2]
    );
    return type;
  }
  setWaterType(waterTypeIndex);

  // Contrast against a background falls by 1/e per attenuation length, and the
  // eye gives up at roughly 2% contrast -- about 4.6 lengths. Sighting range is
  // therefore 4.6 / Kd, in the channel the eye is most sensitive to.
  //
  // THIS DOES NOT DEPEND ON DEPTH, and the old model had it depending on
  // brightness, which is wrong: at two thousand metres a lamp reaches exactly as
  // far as it does at twenty. What runs out with depth is the SUN, not the
  // water's clarity. Getting that backwards is why the abyssal preset had 20 m
  // of visibility and could not show its own seabed.
  function sightingRange() {
    return THREE.MathUtils.clamp(4.6 / waterKd.y, 6, 90);
  }

  const CLEAR_WATER = new THREE.Color("#2C93AC");
  const ABYSSAL_FLOOR = new THREE.Color("#01060B");
  // The floor under the floor. Physical irradiance below 1000 m is zero, and
  // multiplying a palette by zero produces a black rectangle -- which is what
  // "khong the nhin duoc" looked like. Real deep-sea imagery is never black: it
  // is a very dark blue-violet, because the eye adapts and because 76% of the
  // animals down there emit their own light. This is that colour.
  const ABYSS_GLOOM = new THREE.Color("#0A2438");
  // Above the waterline. A different medium needs a different palette.
  const SKY_ZENITH = new THREE.Color("#14528F");
  const SKY_HORIZON = new THREE.Color("#9FBED6");
  const SKY_HAZE = new THREE.Color("#9BBBD2");
  const FOAM_WHITE = new THREE.Color("#DCE8EC");
  // Dry coral sand is about #D8BE93. Wet, shaded and two absorption lengths
  // away it is nothing like that -- but it must START there, or the tint has
  // nothing warm to take away.
  const SAND_ALBEDO = new THREE.Color("#D8BE93");
  // Basalt and manganese-crusted rock, which is what an abyssal plain is paved
  // with. Darker than sand by a factor of two, and that difference is the only
  // reason a boulder has a silhouette against it.
  const ROCK_ALBEDO = new THREE.Color("#6E6A62");

  // ONE sun, used twice. Above water it sits 30 degrees up, which is the
  // elevation that gives the long glitter path every ocean render is famous
  // for. Seen from underneath, refraction bends it toward the zenith by Snell's
  // law -- a 30-degree sun appears at about 50 degrees -- so the underwater
  // layers must use the BENT direction or the god rays and the hot spot inside
  // Snell's window disagree with the sky that is making them.
  // Azimuth is fixed because the whole frame is composed around it; elevation is
  // the interesting axis and is now a control. Both vectors are mutated in place
  // by setSunElevation() so every shader that holds a reference stays in step.
  const SUN_AZIMUTH = 0.50;
  const SUN_ABOVE = new THREE.Vector3();
  const SUN_BELOW = new THREE.Vector3();
  let sunElevationDegrees = 32;

  function computeSun(degrees) {
    const elevation = THREE.MathUtils.degToRad(degrees);
    const horizontal = Math.cos(elevation);
    SUN_ABOVE.set(
      horizontal * Math.cos(SUN_AZIMUTH),
      Math.sin(elevation),
      horizontal * Math.sin(SUN_AZIMUTH)
    );
    // Snell, exactly: sin(refracted) = sin(incident) / 1.333, and the incident
    // angle from vertical is the sun's complement. A sun on the horizon refracts
    // to 48.6 degrees from vertical -- the rim of the window -- and a sun
    // overhead stays overhead. There is no sun position that puts light outside
    // the cone, which is why the cone exists.
    const sinRefracted = horizontal / 1.333;
    const cosRefracted = Math.sqrt(Math.max(0, 1 - sinRefracted * sinRefracted));
    SUN_BELOW.set(
      Math.cos(SUN_AZIMUTH) * sinRefracted,
      cosRefracted,
      Math.sin(SUN_AZIMUTH) * sinRefracted
    );
  }
  computeSun(sunElevationDegrees);
  const SURFACE_SUN = new THREE.Color("#FFF4DC");
  const KEY_FLOOR = new THREE.Color("#08222E");
  // The complementary fill. A single teal key makes every surface one hue; real
  // water fills from every direction through multiple scattering.
  const FILL_COMPLEMENT = new THREE.Color("#3B2E7A");

  // One rule, applied twice: a boundary is drawn when it is inside about one and
  // a half sight distances. Past that the water has already swallowed it, and
  // drawing it anyway produces the hard horizon line v1 had.
  const BOUNDARY_VISIBILITY_MULTIPLIER = 1.5;

  function depthProfile(viewerMetres, seafloorMetres) {
    // Beer-Lambert, per channel, with the water's own Kd. This replaces the
    // hand-typed light table entirely: the table was a curve fitted to a
    // photograph of one kind of water, and this is the physics that produced it.
    const metres = Math.max(0, viewerMetres);
    const spectral = new THREE.Color(
      Math.exp(-waterKd.x * metres),
      Math.exp(-waterKd.y * metres),
      Math.exp(-waterKd.z * metres)
    );
    // What is left, weighted the way an eye weights it. At the surface this is
    // 1.0 by construction, so the old 0.45 normalisation goes too.
    const fraction = 0.2126 * spectral.r + 0.7152 * spectral.g + 0.0722 * spectral.b;
    const brightness = Math.pow(fraction, 0.42);

    const fog = CLEAR_WATER.clone().multiply(spectral);
    // A third of the water's own colour survives regardless: pure absorption
    // drives every channel but one to zero and the frame becomes monochrome,
    // which was symptom four in the diagnosis.
    fog.lerp(CLEAR_WATER, 0.34);
    // Now set the VALUE independently, and give it a floor. 0.13 at the bottom
    // is a dark navy you can still read; zero is a black rectangle.
    const fogValue = 0.13 + 0.66 * Math.pow(brightness, 0.8);
    const fogPeak = Math.max(fog.r, fog.g, fog.b, 1e-4);
    // Anything meant to read as brighter than the water has to be measured
    // against the water, not set to a constant. Brightening the fog without
    // brightening the sky is what made Snell's window vanish into it.
    fog.multiplyScalar(fogValue / fogPeak);
    // Below the photic zone the hue swings to the blue-violet of scattered
    // bioluminescence, because that is the only light being made down there.
    fog.lerp(ABYSS_GLOOM, Math.pow(1 - Math.min(1, brightness / 0.16), 1.5) * 0.85);

    const key = SURFACE_SUN.clone().multiply(spectral);
    key.lerp(SURFACE_SUN, 0.22);
    const keyPeak = Math.max(key.r, key.g, key.b, 1e-4);
    key.multiplyScalar((0.22 + 0.78 * Math.pow(brightness, 0.7)) / keyPeak);
    key.r = Math.max(key.r, KEY_FLOOR.r);
    key.g = Math.max(key.g, KEY_FLOOR.g);
    key.b = Math.max(key.b, KEY_FLOOR.b);

    // ---- ADAPTATION -----------------------------------------------------
    // Physical light left is not what a viewer sees. A dark-adapted eye gains
    // about five orders of magnitude in twenty minutes, and every deep-sea
    // image anyone has ever seen came from an adapted eye or from a camera
    // carrying its own light. Mapping irradiance straight to screen luminance
    // is photometry, not photography. So `brightness` stays physical and keeps
    // driving RATIOS between surfaces, while `litness` is what the frame is
    // allowed to be exposed for -- and it never reaches zero.
    const biolum = THREE.MathUtils.clamp((viewerMetres - 90) / 420, 0, 1);
    const litness = Math.max(brightness, 0.11 + 0.30 * biolum);
    // Tone-map exposure is the adaptation itself: it only ever lifts a frame
    // already too dark to read, and does nothing at all near the surface.
    const exposure = 1.02 + Math.pow(1 - Math.min(1, brightness / 0.26), 1.6) * 0.62;

    const visibility = sightingRange();
    const reach = visibility * BOUNDARY_VISIBILITY_MULTIPLIER;
    const floorClearance = Math.max(0, seafloorMetres - viewerMetres);

    const profile = {
      above: false, altitude: 0, litness, exposure, fogValue,
      viewerMetres, seafloorMetres, fraction, brightness, spectral, fog, key, visibility,
      fogDensity: 1 / visibility,
      floorClearance,
      // THE POINT OF v2. Two independent booleans, from one rule.
      floorInSight: floorClearance <= reach,
      surfaceInSight: viewerMetres <= reach,
      // Caustics need the surface's own light pattern to still be coherent,
      // which is a scattering question rather than an absorption one: a few
      // attenuation lengths of blur and the pattern is gone.
      causticStrength: Math.pow(THREE.MathUtils.clamp(1 - metres / (2.4 * visibility), 0, 1), 1.4),
      godRayStrength: Math.pow(brightness, 1.3),
      biolumStrength: biolum
    };

    // ---- ABOVE THE WATERLINE --------------------------------------------
    // A negative depth is not a special case bolted on: it is the same rig with
    // the medium swapped. Air extinguishes light roughly a thousand times more
    // slowly than water, so visibility becomes kilometres, distance reads as
    // haze instead of absorption, and nothing in frame is dark. It is the
    // cheapest beauty available anywhere in this study -- which is exactly why
    // every water demo people link to is an above-water one.
    if (viewerMetres < 0) {
      profile.above = true;
      profile.altitude = -viewerMetres;
      profile.brightness = 1;
      profile.litness = 1;
      // Preetham returns radiance in its own units, around 0.6-1.5 after its
      // own gamma, and ACES turns anything past 1.0 into white. three.js's ocean
      // example runs at 0.5, but its water is a dark blue-green mirror of the
      // dome; ours reflects the sky analytically across the whole frame, which
      // is brighter. Metering for the WATER and letting the sun clip is what a
      // photographer does, and it is the only setting where the sea stays blue.
      // Scaled down further as the sun drops, because a low sun means a long
      // optical path and a much brighter aureole to meter against.
      profile.exposure = 0.26 * (0.62 + 0.38 * Math.min(1, SUN_ABOVE.y / 0.5));
      profile.spectral.setRGB(1, 1, 1);
      profile.fog.copy(SKY_HAZE);
      profile.fogDensity = 0.00085;
      profile.visibility = 1200;
      profile.key.copy(SURFACE_SUN);
      profile.floorInSight = false;
      profile.surfaceInSight = true;
      profile.causticStrength = 0;
      profile.godRayStrength = 0;
      profile.biolumStrength = 0;
    }

    return profile;
  }

  /* =======================================================================
     2. DETERMINISTIC NOISE  (no Math.random anywhere — the app's own rule)
     ======================================================================= */

  function randomFromSeed(seed) {
    let state = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i += 1) {
      state ^= seed.charCodeAt(i);
      state = Math.imul(state, 16777619) >>> 0;
    }
    return function next() {
      state ^= state << 13; state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5; state >>>= 0;
      return state / 4294967296;
    };
  }

  function hash2(x, y) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return s - Math.floor(s);
  }
  function valueNoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy), b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
    return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
  }
  function fbm2(x, y) {
    let sum = 0, amp = 0.5, fx = x, fy = y;
    for (let i = 0; i < 4; i += 1) { sum += amp * valueNoise(fx, fy); fx *= 2.03; fy *= 2.03; amp *= 0.5; }
    return sum;
  }

  const BASIN = 200;
  function seafloorHeight(x, z) {
    const broad = (fbm2(x * 0.011, z * 0.011) - 0.5) * 11;
    const dune = (fbm2(x * 0.055 + 31, z * 0.055 - 12) - 0.5) * 2.4;
    const ripple = Math.sin(x * 0.55 + fbm2(x * 0.08, z * 0.08) * 6) * 0.16;
    return broad + dune + ripple;
  }

  /* =======================================================================
     3. SHARED SHADER FRAGMENTS
     ======================================================================= */

  const GLSL_NOISE = /* glsl */ `
    float sHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    float sNoise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(sHash(i), sHash(i + vec2(1,0)), u.x),
                 mix(sHash(i + vec2(0,1)), sHash(i + vec2(1,1)), u.x), u.y);
    }
    float sFbm(vec2 p){
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 4; i++){ v += a * sNoise(p); p *= 2.03; a *= 0.5; }
      return v;
    }
  `;

  // Ridged caustic veins. The renderer uses the physically derived
  // differential-area (Jacobian) form; this is the cheap legible cousin. Both
  // need the same two fixes: ripple-scale frequencies, and a domain warp,
  // because a plain sum of plane waves always forms a visible lattice.
  const GLSL_CAUSTICS = /* glsl */ `
    float causticVeins(vec2 p, float t){
      vec2 w = p + vec2(
        sin(p.y * 0.31 + t * 0.13) + 0.45 * sin(p.x * 0.71 - t * 0.19),
        cos(p.x * 0.27 - t * 0.11) + 0.45 * cos(p.y * 0.63 + t * 0.17)) * 1.6;
      float v = 0.0;
      v += 0.34 * sin(dot(w, vec2( 0.986,  0.164)) * 2.4 + t * 0.9);
      v += 0.26 * sin(dot(w, vec2( 0.383,  0.924)) * 1.7 - t * 0.7);
      v += 0.20 * sin(dot(w, vec2(-0.707,  0.707)) * 3.9 + t * 1.3);
      v += 0.14 * sin(dot(w, vec2( 0.643, -0.766)) * 5.1 - t * 1.1);
      v += 0.10 * sin(dot(w, vec2(-0.259, -0.966)) * 7.3 + t * 1.7);
      return pow(max(0.0, 1.0 - abs(v) * 1.35), 5.0);
    }
  `;

  // The repo already holds this as BODY_UNDULATION_GLSL, and nothing imports it.
  // Species differ by HOW MUCH OF THE BODY undulates, not by how fast.
  const GLSL_UNDULATION = /* glsl */ `
    float bodyLateralOffset(float alongBody, float onset, float waves,
                            float amplitude, float beatHertz, float elapsed, float phase) {
      float span = max(1e-4, 1.0 - onset);
      float envelope = max(0.0, (alongBody - onset) / span);
      float p = beatHertz * elapsed * 6.2831853 - alongBody * waves * 6.2831853 + phase;
      return envelope * envelope * amplitude * sin(p);
    }
  `;

  const WAVE_MAX = 12;
  const GRAVITY = 9.81;

  const GLSL_WAVE_UNIFORMS = /* glsl */ `
    uniform vec2 uWaveDir[${WAVE_MAX}];
    // x: amplitude (m), y: wavenumber (rad/m), z: angular frequency (rad/s),
    // w: phase (rad)
    uniform vec4 uWaveTerm[${WAVE_MAX}];
    uniform int uWaveCount;
    uniform float uChoppiness;
    uniform float uWaveTime;
  `;

  const GLSL_WAVES = /* glsl */ `
    // Gerstner, not sine. Water particles travel in circles, not up and down, so
    // crests sharpen and troughs flatten -- and the horizontal part of that
    // circle is the only reason a rendered sea has the asymmetric profile a real
    // one has. Sines give symmetric humps at any amplitude.
    //
    // The third output is the surface Jacobian. Where it collapses the surface
    // is folding over itself, and folding is what breaking IS: it is the correct
    // criterion for foam, and far better than "the crest is high".
    void oceanSurface(vec2 p, out vec3 offset, out vec3 normal, out float jacobian) {
      offset = vec3(0.0);
      vec3 n = vec3(0.0, 1.0, 0.0);
      float jxx = 0.0, jzz = 0.0, jxz = 0.0;
      for (int i = 0; i < ${WAVE_MAX}; i++) {
        if (i >= uWaveCount) break;
        vec2 d = uWaveDir[i];
        float amplitude = uWaveTerm[i].x;
        float k = uWaveTerm[i].y;
        float omega = uWaveTerm[i].z;
        float theta = k * dot(d, p) - omega * uWaveTime + uWaveTerm[i].w;
        float c = cos(theta);
        float s = sin(theta);
        float steep = uChoppiness * amplitude;
        offset.x -= d.x * steep * s;
        offset.z -= d.y * steep * s;
        offset.y += amplitude * c;
        // GPU Gems 1, chapter 1, equation 12: the analytic normal of the sum.
        // Finite differences would need three extra evaluations of the whole
        // sum per vertex and would still lag the displacement.
        float ka = k * amplitude;
        n.x -= d.x * ka * c;
        n.z -= d.y * ka * c;
        n.y -= uChoppiness * ka * s;
        jxx -= uChoppiness * ka * d.x * d.x * c;
        jzz -= uChoppiness * ka * d.y * d.y * c;
        jxz -= uChoppiness * ka * d.x * d.y * c;
      }
      normal = normalize(n);
      jacobian = (1.0 + jxx) * (1.0 + jzz) - jxz * jxz;
    }
  `;

  const GLSL_SKY = /* glsl */ `
    const float SKY_PI = 3.141592653589793;
    const float rayleighZenithLength = 8.4E3;
    const float mieZenithLength = 1.25E3;
    const float sunAngularDiameterCos = 0.9999566769464485;
    const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
    const float ONE_OVER_FOURPI = 0.07957747154594767;

    float rayleighPhase(float cosTheta){
      return THREE_OVER_SIXTEENPI * (1.0 + pow(cosTheta, 2.0));
    }
    float hgPhase(float cosTheta, float g){
      float g2 = pow(g, 2.0);
      float inverse = 1.0 / pow(1.0 - 2.0 * g * cosTheta + g2, 1.5);
      return ONE_OVER_FOURPI * ((1.0 - g2) * inverse);
    }

    vec3 preethamSky(vec3 direction, bool withDisc){
      vec3 up = vec3(0.0, 1.0, 0.0);
      // Optical path length through the atmosphere, cut off at the horizon to
      // avoid the singularity. This single term is the whole reason a low sun
      // is red: the path grows without bound and blue is scattered out of it.
      float zenithAngle = acos(max(0.0, dot(up, direction)));
      float inverse = 1.0 / (cos(zenithAngle) +
        0.15 * pow(93.885 - ((zenithAngle * 180.0) / SKY_PI), -1.253));
      float sR = rayleighZenithLength * inverse;
      float sM = mieZenithLength * inverse;

      vec3 Fex = exp(-(uBetaR * sR + uBetaM * sM));

      float cosTheta = dot(direction, uSkySunDirection);
      vec3 betaRTheta = uBetaR * rayleighPhase(cosTheta * 0.5 + 0.5);
      vec3 betaMTheta = uBetaM * hgPhase(cosTheta, uMieG);

      vec3 Lin = pow(uSunE * ((betaRTheta + betaMTheta) / (uBetaR + uBetaM)) * (1.0 - Fex), vec3(1.5));
      Lin *= mix(vec3(1.0),
        pow(uSunE * ((betaRTheta + betaMTheta) / (uBetaR + uBetaM)) * Fex, vec3(0.5)),
        clamp(pow(1.0 - dot(up, uSkySunDirection), 5.0), 0.0, 1.0));

      vec3 L0 = vec3(0.1) * Fex;
      if (withDisc) {
        float sundisk = smoothstep(sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta);
        L0 += (uSunE * 19000.0 * Fex) * sundisk;
      }

      vec3 texColor = (Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075);
      return pow(texColor, vec3(1.0 / (1.2 + 1.2 * uSunfade)));
    }
  `;

  const GLSL_SKY_UNIFORMS = /* glsl */ `
    uniform vec3 uSkySunDirection; uniform vec3 uBetaR; uniform vec3 uBetaM;
    uniform float uSunE; uniform float uSunfade; uniform float uMieG;
  `;

  // three.js's ocean example ships turbidity 10 / rayleigh 2, which is a HAZY
  // maritime sky -- measured here at saturation 0.05, i.e. a white rectangle,
  // and the water can only ever be as blue as the sky it mirrors. Turbidity is
  // aerosol load: 2-4 is the clear blue sky this study wants, 10 is coastal
  // haze. Rayleigh 3 puts the blue back into the scattering it names.
  const SKY_MODEL = { turbidity: 3, rayleigh: 3, mieCoefficient: 0.0035, mieDirectionalG: 0.8 };

  // ---- THE SEA STATE -----------------------------------------------------
  // One number in, the whole surface out. Wind speed at 10 m is what every
  // marine forecast, every buoy and every scientific paper on this uses, so it
  // is the number the service should carry too -- not a wave height, and
  // certainly not an amplitude in metres per shader term.
  const waveShared = {
    uWaveDir: { value: [] },
    uWaveTerm: { value: [] },
    uWaveCount: { value: 0 },
    uChoppiness: { value: 0 },
    uWaveTime: { value: 0 }
  };
  for (let i = 0; i < WAVE_MAX; i += 1) {
    waveShared.uWaveDir.value.push(new THREE.Vector2(1, 0));
    waveShared.uWaveTerm.value.push(new THREE.Vector4(0, 0.1, 0, 0));
  }

  const seaState = {
    windSpeed: 12,        // m/s at 10 m -- Beaufort 6, see 11i
    windDirection: 0.62,  // radians, roughly along the sun's azimuth
    significantHeight: 0,
    peakWavelength: 0,
    whitecapFraction: 0,
    beaufort: 0
  };

  // Beaufort exists because a single number for "how rough is it" is genuinely
  // useful, and because it is what a person understands. The bands are the
  // WMO ones, in m/s at 10 m.
  const BEAUFORT = [
    [0.5, 0, "Calm"], [1.6, 1, "Light air"], [3.4, 2, "Light breeze"],
    [5.5, 3, "Gentle breeze"], [8.0, 4, "Moderate breeze"], [10.8, 5, "Fresh breeze"],
    [13.9, 6, "Strong breeze"], [17.2, 7, "Near gale"], [20.8, 8, "Gale"],
    [24.5, 9, "Strong gale"], [1e9, 10, "Storm"]
  ];

  function buildWaveField(windSpeed) {
    seaState.windSpeed = windSpeed;
    const band = BEAUFORT.find((entry) => windSpeed < entry[0]);
    seaState.beaufort = band[1];
    seaState.beaufortName = band[2];

    // Pierson-Moskowitz, 1964: a FULLY DEVELOPED sea is a one-parameter family,
    // and the parameter is wind speed. Everything below is that paper.
    //   Hs   = 2.14e-2 * U^2                 significant wave height
    //   wp   = 0.877 * g / U19.5             peak angular frequency
    //   S(w) = a g^2 w^-5 exp(-b (g/(U w))^4)   a = 8.1e-3, b = 0.74
    // U19.5 is the wind at 19.5 m, which the paper used because that is where
    // the weather ships measured it; the log profile puts it about 6% above U10.
    const u10 = Math.max(0.35, windSpeed);
    const u19 = u10 * 1.06;
    const peakOmega = 0.877 * GRAVITY / u19;
    seaState.significantHeight = 0.0214 * u10 * u10;
    seaState.peakWavelength = (2 * Math.PI * GRAVITY) / (peakOmega * peakOmega);

    // Monahan & O'Muircheartaigh 1980, robust biweight fit to the combined
    // Monahan 1971 and Toba & Chaen 1973 data sets:
    //   W = 3.84e-6 * U10^3.41
    // A real number for how much of the sea is white, instead of a slider.
    seaState.whitecapFraction = 3.84e-6 * Math.pow(u10, 3.41);

    // Eight components, log-spaced from half the peak frequency to four times
    // it. That band holds nearly all of the spectrum's variance, and eight
    // Gerstner terms is what a vertex shader can afford at 30k vertices.
    const next = randomFromSeed("wave-field-v7");
    const alpha = 8.1e-3;
    const beta = 0.74;
    const lowOmega = peakOmega * 0.55;
    const highOmega = peakOmega * 4.0;
    const raw = [];
    for (let i = 0; i < WAVE_MAX; i += 1) {
      const t = (i + 0.5) / WAVE_MAX;
      const omega = lowOmega * Math.pow(highOmega / lowOmega, t);
      const width = omega * (Math.log(highOmega / lowOmega) / WAVE_MAX);
      const density = (alpha * GRAVITY * GRAVITY / Math.pow(omega, 5)) *
        Math.exp(-beta * Math.pow(GRAVITY / (u19 * omega), 4));
      // A discrete realisation of a continuous spectrum: the amplitude of a
      // component is sqrt(2 S dw), not S itself.
      raw.push({
        omega,
        amplitude: Math.sqrt(Math.max(0, 2 * density * width)),
        // Deep-water dispersion. Long waves travel faster, which is why a swell
        // arrives before the storm that made it, and why a sea made of one
        // frequency looks like a corrugated roof.
        k: (omega * omega) / GRAVITY,
        // cos^2 directional spreading about the wind, sampled coarsely. Wind
        // sea is not unidirectional and a unidirectional sea reads as fabric.
        angle: seaState.windDirection + (next() - 0.5) * 1.5 * (1 - 0.6 * t),
        phase: next() * Math.PI * 2
      });
    }

    // Normalise to the physical wave height. Hs = 4 * sqrt(variance), and the
    // variance of a sum of sinusoids is half the sum of squared amplitudes.
    const variance = raw.reduce((sum, w) => sum + w.amplitude * w.amplitude * 0.5, 0);
    const scale = variance > 0 ? seaState.significantHeight / (4 * Math.sqrt(variance)) : 0;

    let steepness = 0;
    raw.forEach((wave, i) => {
      wave.amplitude *= scale;
      steepness += wave.amplitude * wave.k;
      waveShared.uWaveDir.value[i].set(Math.cos(wave.angle), Math.sin(wave.angle));
      waveShared.uWaveTerm.value[i].set(wave.amplitude, wave.k, wave.omega, wave.phase);
    });
    waveShared.uWaveCount.value = WAVE_MAX;
    // Gerstner loops back on itself past Q * sum(A k) = 1, which renders as the
    // surface tying knots. Held at 0.72 of that limit: sharp crests, no knots.
    waveShared.uChoppiness.value = steepness > 0 ? Math.min(1, 0.72 / steepness) : 0;
    return seaState;
  }
  buildWaveField(seaState.windSpeed);
  const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
  const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];

  // ONE set of uniform entries, shared by reference between every material that
  // needs the sky. Assigning through skyShared updates all of them at once.
  const skyShared = {
    uSkySunDirection: { value: new THREE.Vector3() },
    uBetaR: { value: new THREE.Vector3() },
    uBetaM: { value: new THREE.Vector3() },
    uSunE: { value: 0 },
    uSunfade: { value: 1 },
    uMieG: { value: SKY_MODEL.mieDirectionalG }
  };

  function updateSkyModel() {
    skyShared.uSkySunDirection.value.copy(SUN_ABOVE);
    const cutoffAngle = 1.6110731556870734;
    const steepness = 1.5;
    const EE = 1000;
    const zenithCos = THREE.MathUtils.clamp(SUN_ABOVE.y, -1, 1);
    skyShared.uSunE.value = EE * Math.max(0,
      1 - Math.exp(-((cutoffAngle - Math.acos(zenithCos)) / steepness)));
    // With a unit sun vector this evaluates to 1, exactly as it does in the
    // three.js example; the reddening comes from the optical path, not here.
    skyShared.uSunfade.value =
      1 - THREE.MathUtils.clamp(1 - Math.exp(SUN_ABOVE.y / 450000), 0, 1);
    const rayleighCoefficient = SKY_MODEL.rayleigh - (1 - skyShared.uSunfade.value);
    skyShared.uBetaR.value
      .set(TOTAL_RAYLEIGH[0], TOTAL_RAYLEIGH[1], TOTAL_RAYLEIGH[2])
      .multiplyScalar(rayleighCoefficient);
    const c = 0.2 * SKY_MODEL.turbidity * 10e-18;
    skyShared.uBetaM.value
      .set(MIE_CONST[0], MIE_CONST[1], MIE_CONST[2])
      .multiplyScalar(0.434 * c * SKY_MODEL.mieCoefficient);
  }
  updateSkyModel();

  const causticUniforms = {
    uCausticTime: { value: 0 },
    uCausticStrength: { value: 1 },
    uCausticColor: { value: new THREE.Color("#BFF3FF") },
    uCausticScale: { value: 0.9 }
  };

  function applyCaustics(material) {
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = function (shader, r) {
      if (previous) previous(shader, r);
      Object.assign(shader.uniforms, causticUniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vCW;\nvarying float vCUp;")
        .replace("#include <worldpos_vertex>", `#include <worldpos_vertex>
          vec4 cp = vec4(transformed, 1.0);
          mat3 cr = mat3(modelMatrix);
          #ifdef USE_INSTANCING
            cp = instanceMatrix * cp;
            cr = cr * mat3(instanceMatrix);
          #endif
          vCW = (modelMatrix * cp).xyz;
          vCUp = normalize(cr * objectNormal).y;`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vCW;\nvarying float vCUp;\nuniform float uCausticTime;\nuniform float uCausticStrength;\nuniform vec3 uCausticColor;\nuniform float uCausticScale;\n" + GLSL_CAUSTICS)
        .replace("#include <tonemapping_fragment>", `
          float cs = causticVeins(vCW.xz * uCausticScale, uCausticTime);
          // Grazing faces excluded: light arrives from above, and the pattern's
          // derivative is meaningless on a near-vertical surface.
          cs *= smoothstep(0.0, 0.35, vCUp);
          gl_FragColor.rgb += uCausticColor * cs * uCausticStrength;
          #include <tonemapping_fragment>`);
    };
    material.needsUpdate = true;
  }

  /* =======================================================================
     4. BACKDROP — graded by view direction, so the horizon is exactly the fog
     colour and distant geometry dissolves instead of meeting a seam.
     ======================================================================= */

  const backdropUniforms = {
    uHorizon: { value: new THREE.Color() },
    uUp: { value: new THREE.Color() },
    uDown: { value: new THREE.Color() },
    // Underwater there is no sun in the backdrop -- the surface layer owns it.
    // Above water the backdrop IS the sky, so the same dome has to grow a sun,
    // a Mie forward-scatter glow around it, and a bright horizon band.
    uSunGlow: { value: 0 },
    ...skyShared
  };
  const backdrop = new THREE.Mesh(
    new THREE.SphereGeometry(420, 32, 24),
    new THREE.ShaderMaterial({
      uniforms: backdropUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }`,
      fragmentShader: `
        uniform vec3 uHorizon; uniform vec3 uUp; uniform vec3 uDown;
        uniform float uSunGlow;
        ${GLSL_SKY_UNIFORMS}
        varying vec3 vW;
        ${GLSL_SKY}
        void main(){
          vec3 dir = normalize(vW - cameraPosition);
          vec3 c;
          if (uSunGlow > 0.001) {
            // Above water the dome is not a gradient with a sun drawn on it: it
            // is the atmosphere, evaluated. The disc, the aureole, the Mie
            // forward-scatter lobe and the reddening at low elevation all fall
            // out of the same three lines instead of being three hand-tuned
            // powers of a dot product.
            c = preethamSky(dir, true);
          } else {
            c = uHorizon;
            c = mix(c, uUp,   pow(clamp( dir.y, 0.0, 1.0), 1.5));
            c = mix(c, uDown, pow(clamp(-dir.y, 0.0, 1.0), 1.4));
          }
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    })
  );
  backdrop.renderOrder = -1000;
  scene.add(backdrop);

  /* =======================================================================
     5. THE SEABED GROUP  (rides floorClearance below the viewer)
     ======================================================================= */

  function sandTextures() {
    const size = 256;
    const albedo = document.createElement("canvas");
    albedo.width = albedo.height = size;
    const ac = albedo.getContext("2d");
    const img = ac.createImageData(size, size);
    const heights = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const grain = fbm2(x * 0.28, y * 0.28);
        const ripple = 0.5 + 0.5 * Math.sin(x * 0.22 + fbm2(x * 0.05, y * 0.05) * 7);
        const h = grain * 0.55 + ripple * 0.45;
        heights[y * size + x] = h;
        const v = 104 + h * 74;
        const i = (y * size + x) * 4;
        img.data[i] = v; img.data[i + 1] = v * 0.965; img.data[i + 2] = v * 0.9; img.data[i + 3] = 255;
      }
    }
    ac.putImageData(img, 0, 0);

    const normal = document.createElement("canvas");
    normal.width = normal.height = size;
    const nc = normal.getContext("2d");
    const nimg = nc.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const l = heights[y * size + ((x - 1 + size) % size)];
        const r = heights[y * size + ((x + 1) % size)];
        const u = heights[((y - 1 + size) % size) * size + x];
        const d = heights[((y + 1) % size) * size + x];
        let nx = (l - r) * 3.4, ny = (u - d) * 3.4, nz = 1;
        const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
        const i = (y * size + x) * 4;
        nimg.data[i] = (nx * 0.5 + 0.5) * 255;
        nimg.data[i + 1] = (ny * 0.5 + 0.5) * 255;
        nimg.data[i + 2] = (nz * 0.5 + 0.5) * 255;
        nimg.data[i + 3] = 255;
      }
    }
    nc.putImageData(nimg, 0, 0);

    const make = (cv, srgb) => {
      const t = new THREE.CanvasTexture(cv);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return t;
    };
    return { map: make(albedo, true), normalMap: make(normal, false) };
  }

  const seabedGroup = new THREE.Group();
  scene.add(seabedGroup);

  const sand = sandTextures();
  const FLOOR_EXTENT = BASIN * 3.4;
  sand.map.repeat.set(FLOOR_EXTENT / 6, FLOOR_EXTENT / 6);
  sand.normalMap.repeat.copy(sand.map.repeat);
  // At a grazing angle a tiled ground texture is a blur without this, and the
  // seabed is seen at a grazing angle in every frame that contains it.
  sand.map.anisotropy = MAX_ANISOTROPY;
  sand.normalMap.anisotropy = MAX_ANISOTROPY;

  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: sand.map, normalMap: sand.normalMap,
    normalScale: new THREE.Vector2(1.1, 1.1), roughness: 1, metalness: 0
  });
  applyCaustics(floorMaterial);

  const floorGeometry = new THREE.PlaneGeometry(FLOOR_EXTENT, FLOOR_EXTENT, 300, 300);
  floorGeometry.rotateX(-Math.PI / 2);
  {
    const pos = floorGeometry.getAttribute("position");
    for (let i = 0; i < pos.count; i += 1) pos.setY(i, seafloorHeight(pos.getX(i), pos.getZ(i)));
    pos.needsUpdate = true;
    floorGeometry.computeVertexNormals();
  }
  const seabed = new THREE.Mesh(floorGeometry, floorMaterial);
  seabed.receiveShadow = true;
  seabedGroup.add(seabed);

  function makeBoulders(count, seedName, radiusInner, radiusOuter) {
    // Two subdivisions is enough: rock reads as rock through its silhouette and
    // its flat shaded faces, not through vertex count. Displacing the sphere
    // per-vertex is what stops eight hundred instances being eight hundred balls.
    const base = new THREE.IcosahedronGeometry(1, 1);
    const position = base.getAttribute("position");
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      const lumpy = 0.62 + fbm2(x * 1.7 + 11, z * 1.7 - 4) * 0.9 + valueNoise(y * 2.3, x * 2.3) * 0.24;
      position.setXYZ(i, x * lumpy, y * lumpy * 0.74, z * lumpy);
    }
    position.needsUpdate = true;
    base.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.95, metalness: 0,
      map: sand.map, normalMap: sand.normalMap,
      normalScale: new THREE.Vector2(1.4, 1.4)
    });
    applyCaustics(material);
    boulderMaterials.push(material);

    const mesh = new THREE.InstancedMesh(base, material, count);
    const next = randomFromSeed(seedName);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    const spot = new THREE.Vector3();
    for (let i = 0; i < count; i += 1) {
      const angle = next() * Math.PI * 2;
      const radius = radiusInner + Math.pow(next(), 0.7) * (radiusOuter - radiusInner);
      const size = 0.35 + Math.pow(next(), 2.2) * 3.4;
      spot.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      // Sit ON the floor, sunk a little, the way a rock that has been there for
      // ten thousand years sits in sediment.
      spot.y = seafloorHeight(spot.x, spot.z) + size * 0.34;
      euler.set(next() * 3.14, next() * 6.28, next() * 3.14);
      quaternion.setFromEuler(euler);
      scale.set(size * (0.8 + next() * 0.5), size * (0.55 + next() * 0.4), size * (0.8 + next() * 0.5));
      matrix.compose(spot, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  const boulderMaterials = [];
  const boulders = new THREE.Group();
  // Two bands: a near field the lamp can carve, and a mid field that gives the
  // floor a horizon made of objects rather than of geometry running out.
  boulders.add(makeBoulders(150, "boulders-near", 5, 34));
  boulders.add(makeBoulders(260, "boulders-mid", 34, 115));
  seabedGroup.add(boulders);

  /* ---- Far silhouette masses: wide, low, unlit, left to the fog ---------- */

  const silhouettes = new THREE.Group();
  const silhouetteMaterials = [];
  [
    { radius: 58, height: 5.5, count: 22, dark: 0.58, seed: "ridge-near" },
    { radius: 112, height: 8.5, count: 30, dark: 0.34, seed: "ridge-mid" },
    { radius: 205, height: 13, count: 38, dark: 0.18, seed: "ridge-far" }
  ].forEach((ring) => {
    const next = randomFromSeed(ring.seed);
    const material = new THREE.MeshBasicMaterial({ color: 0x000000, fog: true });
    material.userData.dark = ring.dark;
    silhouetteMaterials.push(material);
    for (let i = 0; i < ring.count; i += 1) {
      const angle = (i / ring.count) * Math.PI * 2 + next() * 0.4;
      const radius = ring.radius * (0.82 + next() * 0.4);
      const height = ring.height * (0.5 + next() * 0.9);
      const geometry = new THREE.ConeGeometry(height * (1.9 + next() * 1.8), height, 11 + Math.floor(next() * 5), 2);
      const mesh = new THREE.Mesh(geometry, material);
      const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
      mesh.position.set(x, seafloorHeight(x, z) + height * 0.36, z);
      mesh.scale.set(1, 0.45 + next() * 0.4, 0.55 + next() * 0.9);
      mesh.rotation.y = next() * Math.PI;
      silhouettes.add(mesh);
    }
  });
  seabedGroup.add(silhouettes);

  /* =======================================================================
     6. FLORA — kelp tufts and barrel sponges
     ======================================================================= */

  const swayUniforms = { uSwayTime: { value: 0 }, uCurrent: { value: new THREE.Vector2(0.55, 0.2) } };

  function makeKelp(count, seedName, heightBase, heightRange, radiusOuter, colorHex) {
    const blade = new THREE.PlaneGeometry(1, 1, 1, 14);
    blade.translate(0, 0.5, 0);
    {
      const bp = blade.getAttribute("position");
      for (let i = 0; i < bp.count; i += 1) {
        const t = Math.min(1, Math.max(0, bp.getY(i)));
        // Widest around a third of the length, pointed at the tip, arcing at
        // rest. A straight one-segment rectangle is the "stick" read, and no
        // sway animation hides it.
        bp.setX(i, bp.getX(i) * (Math.sin(Math.PI * Math.pow(t, 0.48)) * 0.92 + 0.08));
        bp.setZ(i, t * t * 0.28);
      }
      bp.needsUpdate = true;
      blade.computeVertexNormals();
    }

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colorHex), roughness: 0.92, metalness: 0, side: THREE.DoubleSide
    });
    material.onBeforeCompile = function (shader) {
      Object.assign(shader.uniforms, swayUniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>
          uniform float uSwayTime; uniform vec2 uCurrent;
          attribute float aSwayPhase;
          varying float vHeightFraction; varying float vPlantTone;`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          vHeightFraction = clamp(position.y, 0.0, 1.0);
          vPlantTone = 0.72 + 0.56 * fract(sin(aSwayPhase * 12.9898) * 43758.5453);
          // Quadratic envelope: anchored at the base, free at the tip. A linear
          // ramp makes the whole plant slide instead of bend.
          float bend = vHeightFraction * vHeightFraction;
          transformed.x += sin(uSwayTime * 1.15 + aSwayPhase + vHeightFraction * 2.4) * bend * 0.34;
          transformed.z += cos(uSwayTime * 0.83 + aSwayPhase * 1.7) * bend * 0.24;
          transformed.xz += uCurrent * bend * 0.5;`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vHeightFraction;\nvarying float vPlantTone;")
        // Darkest at the ground — the contact shadow that stops vegetation
        // floating — brightest at the tip, where a translucent blade really does
        // catch the light.
        .replace("#include <tonemapping_fragment>", "gl_FragColor.rgb *= mix(0.16, 1.32, smoothstep(0.0, 0.8, vHeightFraction)) * vPlantTone;\n#include <tonemapping_fragment>");
    };

    const mesh = new THREE.InstancedMesh(blade, material, count);
    const next = randomFromSeed(seedName);
    const beds = [];
    for (let i = 0; i < 16; i += 1) {
      const angle = next() * Math.PI * 2;
      const radius = Math.sqrt(next()) * radiusOuter * 0.86;
      beds.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, r: radiusOuter * (0.05 + next() * 0.16) });
    }
    const phases = new Float32Array(count);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();

    // Kelp and seagrass grow in TUFTS from one holdfast. One blade per anchor is
    // the geometric definition of a stick.
    let written = 0;
    while (written < count) {
      const pick = next() * beds.length;
      const bed = beds[Math.min(beds.length - 1, Math.floor(pick))];
      const local = (pick - Math.floor(pick)) * Math.PI * 2;
      const localRadius = Math.sqrt(next()) * bed.r;
      const tuftX = bed.x + Math.cos(local) * localRadius;
      const tuftZ = bed.z + Math.sin(local) * localRadius;
      const tuftHeight = heightBase + next() * heightRange;
      const tuftYaw = next() * Math.PI * 2;
      const blades = Math.min(count - written, 3 + Math.floor(next() * 5));
      for (let b = 0; b < blades; b += 1) {
        const spread = tuftHeight * 0.13;
        const x = tuftX + (next() - 0.5) * spread;
        const z = tuftZ + (next() - 0.5) * spread;
        const height = tuftHeight * (0.62 + next() * 0.55);
        euler.set((next() - 0.5) * 0.5, tuftYaw + (next() - 0.5) * 1.9, (next() - 0.5) * 0.55);
        quaternion.setFromEuler(euler);
        position.set(x, seafloorHeight(x, z) - 0.1, z);
        scale.set(height * (0.055 + next() * 0.05), height, 1);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(written, matrix);
        phases[written] = next() * Math.PI * 2;
        written += 1;
      }
    }
    blade.setAttribute("aSwayPhase", new THREE.InstancedBufferAttribute(phases, 1));
    mesh.frustumCulled = false;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  // Barrel and tube sponges. Not decoration: they are the only reef organism
  // with a BULK silhouette, and a reef built only from blades has no mass in it.
  function makeSponges(count, seedName, radiusOuter) {
    const geometry = new THREE.CylinderGeometry(0.44, 0.40, 1, 14, 4, false);
    geometry.translate(0, 0.5, 0);
    {
      const pos = geometry.getAttribute("position");
      for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        // Lumpy, flared at the osculum. A perfect cylinder is the other half of
        // the placeholder read.
        const lump = 1 + 0.19 * Math.sin(Math.atan2(z, x) * 5 + y * 3.4) + 0.11 * Math.sin(y * 7);
        // Widest a third of the way up, and never flared at the rim.
        const barrel = 0.72 + 0.5 * Math.sin(Math.PI * Math.min(1, Math.max(0, y)) * 0.85);
        pos.setX(i, x * lump * barrel);
        pos.setZ(i, z * lump * barrel);
      }
      pos.needsUpdate = true;
      geometry.computeVertexNormals();
    }
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#C7A681"), roughness: 0.95, metalness: 0
    });
    applyCaustics(material);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const next = randomFromSeed(seedName);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    for (let i = 0; i < count; i += 1) {
      const angle = next() * Math.PI * 2;
      const radius = Math.sqrt(next()) * radiusOuter;
      const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
      const height = 0.4 + next() * 1.15;
      euler.set((next() - 0.5) * 0.22, next() * Math.PI * 2, (next() - 0.5) * 0.22);
      quaternion.setFromEuler(euler);
      position.set(x, seafloorHeight(x, z) - 0.1, z);
      const girth = height * (0.72 + next() * 0.5);
      scale.set(girth, height, girth);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.frustumCulled = false;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    return mesh;
  }

  const flora = new THREE.Group();
  flora.add(makeKelp(3000, "kelp-canopy", 1.9, 3.2, BASIN * 0.42, "#4E9463"));
  flora.add(makeKelp(3200, "kelp-turf", 0.45, 1.0, BASIN * 0.5, "#63A971"));
  flora.add(makeSponges(150, "sponge-field", BASIN * 0.34));
  seabedGroup.add(flora);

  /* =======================================================================
     7. THE WATER SURFACE, SEEN FROM BELOW
     This is the layer that makes water read as WATER rather than as blue fog.
     Three things happen at once and all three are needed:
       - real vertex displacement at three wave scales;
       - Snell's window: refraction confines the entire sky to a 96-degree cone
         (critical angle 48.6 from vertical, sin = 1/1.333 = 0.75). Outside the
         cone the surface is a MIRROR of the dark water below;
       - Fresnel at grazing angles, the Schlick term threejs-water blends with.
     ======================================================================= */

  const surfaceUniforms = {
    uTime: { value: 0 },
    uZenithColor: { value: new THREE.Color("#2E6E96") },
    uHorizonColor: { value: new THREE.Color("#CFE6F2") },
    uSunColor: { value: new THREE.Color("#FFF6E2") },
    uWaterColor: { value: new THREE.Color("#083A4C") },
    uDeepColor: { value: new THREE.Color("#02141C") },
    uSunDirection: { value: SUN_BELOW.clone() },
    uBrightness: { value: 1 },
    uFogDensity: { value: 0.02 },
    uSkyGain: { value: 0.5 },
    // How much of the wave field a viewer under it actually sees. Full height
    // read from below turns the ceiling into corrugated iron, because from
    // underneath the eye reads the SLOPES, not the crests.
    uWaveDamping: { value: 0.55 },
    ...skyShared,
    ...waveShared
  };

  // Geometry baked into the XZ plane rather than rotated at the mesh, so the
  // shader's coordinates are world coordinates and the two faces of the water
  // can share one wave function.
  const surfaceGeometry = new THREE.PlaneGeometry(900, 900, 280, 280);
  surfaceGeometry.rotateX(-Math.PI / 2);

  const surface = new THREE.Mesh(
    surfaceGeometry,
    new THREE.ShaderMaterial({
      uniforms: surfaceUniforms, side: THREE.DoubleSide, transparent: true, fog: false,
      vertexShader: `
        uniform float uTime; uniform float uWaveDamping;
        ${GLSL_WAVE_UNIFORMS}
        varying vec3 vWorld; varying vec3 vWaveNormal;
        ${GLSL_WAVES}
        void main(){
          vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
          vec3 offset; vec3 normal; float fold;
          // THE SAME SURFACE. Before this the two faces of the water ran
          // different wave functions, so the sea a viewer saw from above and the
          // ceiling they saw from below were two unrelated shapes.
          oceanSurface(world.xz, offset, normal, fold);
          world += offset * uWaveDamping;
          vWorld = world;
          vWaveNormal = normalize(mix(vec3(0.0, 1.0, 0.0), normal, uWaveDamping));
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uZenithColor; uniform vec3 uHorizonColor;
        uniform vec3 uSunColor; uniform vec3 uWaterColor;
        uniform vec3 uDeepColor; uniform vec3 uSunDirection;
        uniform float uBrightness; uniform float uFogDensity;
        uniform float uSkyGain;
        ${GLSL_SKY_UNIFORMS}
        varying vec3 vWorld; varying vec3 vWaveNormal;
        ${GLSL_SKY}
        void main(){
          vec3 view = normalize(vWorld - cameraPosition);
          vec3 n = normalize(vWaveNormal);
          vec3 tilted = normalize(mix(vec3(0.0, 1.0, 0.0), n, 0.32));
          float upness = abs(dot(view, tilted));
          // Snell's window. Beyond sin(theta) = 1/1.333 nothing can refract in,
          // so the surface goes total-internal-reflection: a mirror, not a
          // window. This edge is the most recognisable shape in the ocean.
          float sinTheta = sqrt(max(0.0, 1.0 - upness * upness));
          float window = 1.0 - smoothstep(0.70, 0.775, sinTheta);
          // How far out across the cone we are: 0 at the zenith, 1 at the
          // critical angle. The sky's own gradient, compressed.
          float coneT = clamp(sinTheta / 0.75, 0.0, 1.0);
          // UN-REFRACT the view direction and ask the atmosphere what is there.
          // sin(air) = 1.333 * sin(water) inverts Snell, so every pixel inside
          // the cone is looking at a real direction in a real sky: the dark
          // zenith at the centre, the whole compressed horizon at the rim, the
          // sun where the sun actually is. No gradient, no guessed hexes, and
          // the same function the sky dome and the reflection use.
          float sinAir = min(1.0, sinTheta * 1.333);
          float cosAir = sqrt(max(0.0, 1.0 - sinAir * sinAir));
          vec3 flatDirection = normalize(vec3(view.x, 0.0, view.z) + vec3(1e-5));
          vec3 airDirection = flatDirection * sinAir + vec3(0.0, 1.0, 0.0) * cosAir;
          vec3 sky = preethamSky(airDirection, true) * uSkyGain;
          // Ripple sparkle, strongest where refraction magnifies the slope.
          sky += uSunColor * pow(max(0.0, n.y), 6.0) * 0.06 * (1.0 - coneT);

          vec3 mirror = mix(uDeepColor, uWaterColor, pow(upness, 0.7)) + uWaterColor * 0.85;
          float fresnel = 0.02 + 0.98 * pow(1.0 - upness, 5.0);

          vec3 color = mix(mirror, sky, window);
          color = mix(color, uWaterColor, fresnel * (1.0 - window) * 0.6);
          // The same extinction law the medium uses, because this sheet is IN
          // the medium. Overhead it is two metres away and survives untouched;
          // at the grazing angles that used to paint the whole upper frame it
          // is hundreds of metres away and is gone, exactly as it should be.
          float d = length(vWorld - cameraPosition);
          float swallow = 1.0 - exp(-pow(d * uFogDensity, 2.0));
          color = mix(color, uWaterColor, clamp(swallow, 0.0, 1.0));
          gl_FragColor = vec4(color * uBrightness, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    })
  );
  scene.add(surface);

  /* =======================================================================
     7b. THE WATER SURFACE, SEEN FROM ABOVE
     Built on the technique in three.js's own Water.js (examples/jsm/objects),
     which is the shader behind webgl_shaders_ocean and behind most of the
     water people post: a tiling normal map sampled FOUR times at four scales
     and four scroll speeds, summed, and used as the surface normal. That is
     the whole trick -- the plane never moves. It is why the reference holds up
     from a metre away and from a kilometre away, and why it costs nothing.

     Two deliberate departures:
       - Water.js reflects a real render target through an oblique-frustum
         mirror camera. We cannot: a second full scene render per frame is not
         in the mobile budget, and the demo must stay one file. We reflect an
         ANALYTIC sky instead -- exact for an empty horizon, wrong for anything
         standing in the water. Nothing stands in this water.
       - Water.js has no foam. Whitecaps are most of what makes a real sea look
         like a sea, and they were asked for by name ("bot bien").
     ======================================================================= */

  function waterNormalTexture() {
    // 512 with three more octaves: the finest wave scale in this map is what
    // the sun breaks into separate sparkles on, and at 256 the highest octave
    // was one texel wide.
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    const image = context.createImageData(size, size);

    // Only INTEGER frequencies, so the map wraps seamlessly. The four scrolling
    // lookups in getNoise() magnify any seam four times over, and a seam in
    // water reads instantly as a grid.
    const waves = [
      [1, 2, 1.00], [2, -1, 0.74], [3, 3, 0.46],
      [5, -2, 0.29], [7, 4, 0.17], [11, -8, 0.10], [17, 13, 0.05],
      [23, -19, 0.032], [31, 27, 0.021], [43, -37, 0.013]
    ];

    // A tileable value-noise field, used to WARP the wave domain. Without this
    // the sum of plane waves lays a cross-hatch lattice across the whole sea --
    // visible, regular, and instantly readable as a texture rather than as
    // water. It is the same failure the caustics had and the same fix.
    const lattice = (ix, iy, period) => {
      const px = ((ix % period) + period) % period;
      const py = ((iy % period) + period) % period;
      const s = Math.sin(px * 127.1 + py * 311.7 + period * 7.13) * 43758.5453123;
      return s - Math.floor(s);
    };
    const warpNoise = (fx, fy, period) => {
      const x = fx * period, y = fy * period;
      const ix = Math.floor(x), iy = Math.floor(y);
      const tx = x - ix, ty = y - iy;
      const ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty);
      const a = lattice(ix, iy, period), b = lattice(ix + 1, iy, period);
      const c = lattice(ix, iy + 1, period), d = lattice(ix + 1, iy + 1, period);
      return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
    };

    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const fx = x / size, fy = y / size;
        const warpX = (warpNoise(fx, fy, 3) - 0.5) * 0.55
                    + (warpNoise(fx + 0.37, fy, 7) - 0.5) * 0.22;
        const warpY = (warpNoise(fx, fy + 0.19, 3) - 0.5) * 0.55
                    + (warpNoise(fx, fy + 0.61, 7) - 0.5) * 0.22;
        let h = 0;
        for (let i = 0; i < waves.length; i += 1) {
          const wave = waves[i];
          h += Math.sin(
            (fx + warpX) * wave[0] * Math.PI * 2 +
            (fy + warpY) * wave[1] * Math.PI * 2 + i * 1.7
          ) * wave[2];
        }
        height[y * size + x] = h;
      }
    }

    const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = at(x + 1, y) - at(x - 1, y);
        const dy = at(x, y + 1) - at(x, y - 1);
        const nx = -dx * 0.62;
        const ny = -dy * 0.62;
        const inverse = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        const o = (y * size + x) * 4;
        image.data[o] = (nx * inverse * 0.5 + 0.5) * 255;
        image.data[o + 1] = (ny * inverse * 0.5 + 0.5) * 255;
        image.data[o + 2] = (inverse * 0.5 + 0.5) * 255;
        image.data[o + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = MAX_ANISOTROPY;
    return texture;
  }

  /**
   * A polar grid, not a plane. A flat 6 km plane at 200 segments puts 30 m
   * between vertices, and at a 53 m peak wavelength that aliases the swell into
   * a shimmer. What matters is angular size from the camera, and for a plane
   * seen at a grazing angle that means rings whose spacing grows geometrically
   * with distance: metres near the viewer, hundreds at the horizon, for the same
   * vertex budget. This is the cheap cousin of a projected grid.
   */
  function seaGrid(rings, sectors, innerRadius, outerRadius) {
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    vertices.push(0, 0, 0);
    const growth = Math.pow(outerRadius / innerRadius, 1 / (rings - 1));
    for (let ring = 0; ring < rings; ring += 1) {
      const radius = innerRadius * Math.pow(growth, ring);
      for (let sector = 0; sector < sectors; sector += 1) {
        const angle = (sector / sectors) * Math.PI * 2;
        vertices.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      }
    }
    const indices = [];
    for (let sector = 0; sector < sectors; sector += 1) {
      indices.push(0, 1 + sector, 1 + ((sector + 1) % sectors));
    }
    for (let ring = 0; ring < rings - 1; ring += 1) {
      const inner = 1 + ring * sectors;
      const outer = inner + sectors;
      for (let sector = 0; sector < sectors; sector += 1) {
        const nextSector = (sector + 1) % sectors;
        indices.push(inner + sector, outer + sector, outer + nextSector);
        indices.push(inner + sector, outer + nextSector, inner + nextSector);
      }
    }
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    return geometry;
  }

  const seaTopUniforms = {
    uTime: { value: 0 },
    uNormals: { value: waterNormalTexture() },
    // 103 metres is Water.js's own largest lookup period; dividing the world
    // by this brings the whole cascade down to a scale a viewer six metres up
    // can actually resolve. At 1.0 the sea is smooth streaks.
    uSize: { value: 5.0 },
    uFoam: { value: 1.0 },
    // Where the surface Jacobian has to fall before the water counts as broken.
    // Driven by Monahan's whitecap coverage, so a Beaufort 3 sea has a few
    // streaks and a Beaufort 8 sea is a third white.
    uFoamEdge: { value: 0.3 },
    // The capillary ripple's weight against the Gerstner normal. Measured: at
    // 0.55 the sea's local contrast fell by 40% against the old normal-map-only
    // surface, because a physically correct Beaufort 4 sea is genuinely smooth
    // and all of the sparkle lives in the scale below the vertices.
    uDetail: { value: 1.25 },
    uExposure: { value: 1.0 },
    uSunColor: { value: new THREE.Color("#FFF1D2") },
    uSunDirection: { value: SUN_ABOVE.clone() },
    uWaterColor: { value: new THREE.Color("#0A6E9A") },
    uDeepColor: { value: new THREE.Color("#031B27") },
    uHorizonColor: { value: SKY_HORIZON.clone() },
    uFoamColor: { value: FOAM_WHITE.clone() },
    ...skyShared
  };

  const seaTop = new THREE.Mesh(
    seaGrid(300, 256, 1.1, 5600),
    new THREE.ShaderMaterial({
      uniforms: seaTopUniforms, side: THREE.DoubleSide, fog: false,
      vertexShader: `
        uniform float uTime;
        ${GLSL_WAVE_UNIFORMS}
        varying vec3 vWorld; varying vec3 vWaveNormal; varying float vFold;
        ${GLSL_WAVES}
        void main(){
          vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
          vec3 offset; vec3 normal; float fold;
          oceanSurface(world.xz, offset, normal, fold);
          world += offset;
          vWorld = world;
          vWaveNormal = normal;
          vFold = fold;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D uNormals;
        uniform float uTime; uniform float uSize; uniform float uFoam;
        uniform float uFoamEdge; uniform float uDetail; uniform float uExposure;
        uniform vec3 uSunColor; uniform vec3 uSunDirection;
        uniform vec3 uWaterColor; uniform vec3 uDeepColor;
        uniform vec3 uHorizonColor; uniform vec3 uFoamColor;
        ${GLSL_SKY_UNIFORMS}
        varying vec3 vWorld; varying vec3 vWaveNormal; varying float vFold;
        ${GLSL_SKY}

        // Verbatim from three.js Water.js, constants included. The four
        // divisors (103, 107, 8907/9803, 1091/1027) and the four scroll rates
        // are the whole reason it does not look like a tiled texture: the
        // periods are mutually prime enough that the sum never repeats inside a
        // frame.
        vec4 getNoise(vec2 uv){
          vec2 uv0 = (uv / 103.0) + vec2(uTime / 17.0, uTime / 29.0);
          vec2 uv1 = uv / 107.0 - vec2(uTime / -19.0, uTime / 31.0);
          vec2 uv2 = uv / vec2(8907.0, 9803.0) + vec2(uTime / 101.0, uTime / 97.0);
          vec2 uv3 = uv / vec2(1091.0, 1027.0) - vec2(uTime / 109.0, uTime / -113.0);
          vec4 noise = texture2D(uNormals, uv0) + texture2D(uNormals, uv1)
                     + texture2D(uNormals, uv2) + texture2D(uNormals, uv3);
          return noise * 0.5 - 1.0;
        }

        void main(){
          vec4 noise = getNoise(vWorld.xz * uSize);
          // Two scales of normal, and they have different jobs. The Gerstner
          // normal is the SHAPE of the sea and it is exact; the texture is the
          // capillary ripple riding on it, which is where the sparkle lives and
          // which no vertex budget could ever resolve.
          vec3 ripple = normalize(noise.xzy * vec3(1.5, 1.0, 1.5));
          vec3 n = normalize(vWaveNormal + vec3(ripple.x, 0.0, ripple.z) * uDetail);

          vec3 toEye = cameraPosition - vWorld;
          float distance = length(toEye);
          vec3 eyeDirection = normalize(toEye);

          // Water.js's own sunLight(): shiny 100, spec 2, diffuse 0.5. The
          // specular is the glitter path; the diffuse is what stops the far
          // water from going flat.
          vec3 reflection = normalize(reflect(-uSunDirection, n));
          float direction = max(0.0, dot(eyeDirection, reflection));
          vec3 specular = pow(direction, 100.0) * uSunColor * 2.0;
          vec3 diffuse = max(dot(uSunDirection, n), 0.0) * uSunColor * 0.5;

          vec3 skyDirection = normalize(reflect(-eyeDirection, n));
          skyDirection.y = abs(skyDirection.y);
          // The disc is excluded from the REFLECTION and left to the specular
          // term: a mirrored 19000x sun disc through a wave normal is a field of
          // white pixels the size of the tone map's shoulder, not a glitter path.
          vec3 sky = preethamSky(skyDirection, false);

          float theta = max(dot(eyeDirection, n), 0.0);
          // Physical rf0 for water is 0.02. Water.js uses 0.3 to compensate for
          // a dim mirror texture; our sky is analytic and correctly bright, so
          // the honest number works and the grazing horizon stays a mirror.
          float rf0 = 0.02;
          float reflectance = rf0 + (1.0 - rf0) * pow(1.0 - theta, 5.0);
          // Upwelling scatter: the only colour the water body itself has, and
          // strongest looking straight down into it.
          vec3 scatter = mix(uDeepColor, uWaterColor, theta) * (0.34 + theta * 1.15);
          // The whole sky dome lights the water body, not just the sun. Without
          // this term the non-reflective half of every wave is lit by one
          // directional source and the sea reads as metal.
          scatter += uHorizonColor * 0.13;

          vec3 color = mix(scatter + diffuse * 0.55, sky + specular, reflectance);

          // Whitecaps. Foam is not paint on a wave -- it is where a crest has
          // already broken, so it belongs only to the high, steep part of the
          // swell, and it needs a second uncorrelated pattern or it reads as a
          // stripe painted along the crest line.
          // Foam where the surface FOLDS. The Jacobian of the Gerstner
          // displacement collapses exactly where a real wave is overtaking
          // itself, which is what breaking is -- so foam appears on the forward
          // face of steep crests and nowhere else, without being told to.
          float breaking = smoothstep(uFoamEdge, uFoamEdge - 0.34, vFold);
          float lace = smoothstep(0.02, 0.42, noise.x);
          color = mix(color, uFoamColor, clamp(breaking * lace * uFoam, 0.0, 0.86));

          // Aerial perspective. In air, distance is haze, not absorption. The
          // haze colour is the sky in THAT direction, just above the horizon --
          // so the sea does not fade toward one average colour, it fades toward
          // whatever the sky actually is behind it, and the horizon dissolves
          // even when the sun is low and the two sides of the sky disagree.
          vec3 hazeDirection = normalize(vec3(-eyeDirection.x, 0.045, -eyeDirection.z));
          float haze = 1.0 - exp(-distance * 0.00030);
          color = mix(color, preethamSky(hazeDirection, false), clamp(haze, 0.0, 1.0));

          gl_FragColor = vec4(color * uExposure, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    })
  );
  seaTop.visible = false;
  scene.add(seaTop);

  /* =======================================================================
     8. BUBBLES
     Rise at roughly 0.4 m/s, spiral because a large bubble sheds vortices
     alternately, and EXPAND as they ascend into lower pressure — which makes
     them accelerate. All three are visible and all three are nearly free.
     ======================================================================= */

  const bubbleUniforms = {
    uBubbleTime: { value: 0 },
    uBubbleTint: { value: new THREE.Color("#CFEEF6") },
    uBubbleTop: { value: 60 }
  };

  function makeBubbles(count, seedName, radiusOuter) {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const seeds = new Float32Array(count);
    const anchors = new Float32Array(count * 3);
    const next = randomFromSeed(seedName);
    // Bubbles come from VENTS. A stream reads as bubbles; a uniform scatter
    // reads as dust.
    const vents = [];
    for (let i = 0; i < 9; i += 1) {
      const angle = next() * Math.PI * 2;
      const radius = Math.sqrt(next()) * radiusOuter;
      vents.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
    for (let i = 0; i < count; i += 1) {
      const vent = vents[Math.floor(next() * vents.length) % vents.length];
      anchors[i * 3] = vent[0] + (next() - 0.5) * 0.7;
      anchors[i * 3 + 1] = next();
      anchors[i * 3 + 2] = vent[1] + (next() - 0.5) * 0.7;
      seeds[i] = next() * 100;
    }
    geometry.setAttribute("aBubbleAnchor", new THREE.InstancedBufferAttribute(anchors, 3));
    geometry.setAttribute("aBubbleSeed", new THREE.InstancedBufferAttribute(seeds, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: bubbleUniforms, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.FrontSide,
      vertexShader: `
        attribute vec3 aBubbleAnchor; attribute float aBubbleSeed;
        uniform float uBubbleTime; uniform float uBubbleTop;
        varying float vRim; varying float vFade;
        void main(){
          float span = uBubbleTop;
          float rise = mod(uBubbleTime * 0.42 + aBubbleAnchor.y * span + aBubbleSeed, span);
          float t = rise / span;
          float grow = 1.0 + t * 1.5;
          float radius = (0.035 + fract(aBubbleSeed) * 0.075) * grow;
          vec3 offset = vec3(
            sin(rise * 1.7 + aBubbleSeed * 6.0) * 0.22 * grow, 0.0,
            cos(rise * 1.5 + aBubbleSeed * 4.0) * 0.22 * grow);
          vec3 world = vec3(aBubbleAnchor.x, rise, aBubbleAnchor.z) + offset + position * radius;
          vec4 mv = modelViewMatrix * vec4(world, 1.0);
          vec3 n = normalize(mat3(modelViewMatrix) * position);
          // A bubble has no body. All you ever see of one is its rim.
          vRim = pow(1.0 - abs(dot(n, normalize(-mv.xyz))), 2.2);
          vFade = smoothstep(1.0, 0.86, t) * smoothstep(0.0, 0.04, t);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uBubbleTint;
        varying float vRim; varying float vFade;
        void main(){
          gl_FragColor = vec4(uBubbleTint * vRim * 1.5, vRim * vFade * 0.85);
        }`
    });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    const identity = new THREE.Matrix4();
    for (let i = 0; i < count; i += 1) mesh.setMatrixAt(i, identity);
    mesh.renderOrder = 2500;
    return mesh;
  }

  const bubbles = makeBubbles(700, "bubble-vents", BASIN * 0.22);
  seabedGroup.add(bubbles);

  /* =======================================================================
     9. CREATURES
     Silhouette first. The Abzu lesson is to pick the two or three features that
     identify a species and drop everything else: a dolphin is a melon head and
     HORIZONTAL flukes, a shark is a pointed snout and a tall dorsal, a
     lanternfish is a blunt head and rows of photophores. Get those right at
     20 m and nobody looks for scales.
     ======================================================================= */

  const creatureUniforms = { uCreatureTime: { value: 0 } };

  /**
   * A fusiform profile: zero at the snout, shoulder forward of centre, pinched
   * to a peduncle at the tail. `shoulder` and `taper` are the two exponents;
   * the constant normalises the peak to 1 so `halfWidth` means what it says.
   */
  function fusiform(shoulder, taper, halfWidth) {
    const peak = shoulder / (shoulder + taper);
    const norm = 1 / (Math.pow(peak, shoulder) * Math.pow(1 - peak, taper));
    return (t) => Math.pow(Math.max(0, t), shoulder) * Math.pow(Math.max(0, 1 - t), taper) * norm * halfWidth;
  }

  // Body of revolution about +Z, head at +Z, with `along` running 0 at the snout
  // to 1 at the tail so the shader can taper the travelling wave.
  function bodyGeometry(options) {
    const SEG = options.lengthSegments || 15;
    const RAD = options.radialSegments || 10;
    const positions = [], normals = [], along = [], indices = [];
    for (let s = 0; s <= SEG; s += 1) {
      const t = s / SEG;
      const z = 0.5 - t;
      const radius = Math.max(0.01, options.profile(t));
      for (let r = 0; r <= RAD; r += 1) {
        const a = (r / RAD) * Math.PI * 2;
        const x = Math.cos(a) * radius * options.widthRatio;
        const y = Math.sin(a) * radius * options.heightRatio;
        positions.push(x, y, z);
        const n = new THREE.Vector3(x, y, 0.18).normalize();
        normals.push(n.x, n.y, n.z);
        along.push(t);
      }
    }
    for (let s = 0; s < SEG; s += 1) {
      for (let r = 0; r < RAD; r += 1) {
        const a = s * (RAD + 1) + r, b = a + RAD + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }

    function quad(p0, p1, p2, p3, alongValue, normal) {
      const base = positions.length / 3;
      [p0, p1, p2, p3].forEach((p) => {
        positions.push(p[0], p[1], p[2]);
        normals.push(normal[0], normal[1], normal[2]);
        along.push(alongValue);
      });
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }

    (options.fins || []).forEach((fin) => {
      if (fin.plane === "vertical") {
        quad([0, fin.root, fin.z0], [0, fin.tip, fin.z1], [0, fin.tip2, fin.z2], [0, fin.root, fin.z3], fin.along, [1, 0, 0]);
      } else {
        // Horizontal: cetacean flukes and pectorals.
        quad([fin.root, 0, fin.z0], [fin.tip, 0, fin.z1], [-fin.tip, 0, fin.z1], [-fin.root, 0, fin.z0], fin.along, [0, 1, 0]);
      }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("along", new THREE.Float32BufferAttribute(along, 1));
    geometry.setIndex(indices);
    return geometry;
  }

  /** A batoid disc: span across X, chord along Z, thin in Y. */
  function wingGeometry(options) {
    const SPAN = 24, CHORD = 14;
    const positions = [], normals = [], along = [], indices = [];
    for (let i = 0; i <= SPAN; i += 1) {
      const u = (i / SPAN) * 2 - 1;             // -1 .. 1 across the span
      const absU = Math.abs(u);
      // Swept leading edge and a tapering trailing edge: the manta outline.
      const chord = Math.pow(1 - Math.pow(absU, 2.1), 0.62);
      const sweep = -Math.pow(absU, 1.7) * 0.30;
      for (let j = 0; j <= CHORD; j += 1) {
        const v = j / CHORD;                     // 0 nose .. 1 tail
        const z = 0.5 - v;
        const thickness = (1 - Math.pow(absU, 0.8)) * Math.sin(Math.PI * v) * 0.075;
        positions.push(u * options.halfSpan, thickness, (z * chord + sweep) * options.chord);
        normals.push(0, 1, 0);
        along.push(v);
      }
    }
    for (let i = 0; i < SPAN; i += 1) {
      for (let j = 0; j < CHORD; j += 1) {
        const a = i * (CHORD + 1) + j, b = a + CHORD + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    // The whip tail is most of what says "ray" at silhouette scale.
    const base = positions.length / 3;
    const tailLength = options.chord * 1.5;
    for (let k = 0; k <= 6; k += 1) {
      const t = k / 6;
      const w = (1 - t) * options.chord * 0.05 + 0.004;
      positions.push(-w, 0, -options.chord * 0.5 - t * tailLength);
      positions.push(w, 0, -options.chord * 0.5 - t * tailLength);
      normals.push(0, 1, 0, 0, 1, 0);
      along.push(1, 1);
    }
    for (let k = 0; k < 6; k += 1) {
      const a = base + k * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      indices.push(a + 2, a + 1, a, a + 2, a + 3, a + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("along", new THREE.Float32BufferAttribute(along, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  const SPECIES = {
    // Jacks and herring: the schooling default. Posterior 30-50% undulates.
    reefFish: {
      onset: 0.6, amplitude: 0.08, waves: 0.7, beat: 2.8,
      geometry: () => bodyGeometry({
        profile: fusiform(0.62, 1.25, 0.30),
        widthRatio: 0.34, heightRatio: 1.25,
        fins: [
          { plane: "vertical", root: 0, tip: 0.42, tip2: -0.42, z0: -0.5, z1: -0.72, z2: -0.72, z3: -0.5, along: 1 },
          { plane: "vertical", root: 0.06, tip: 0.34, tip2: 0.05, z0: 0.10, z1: -0.16, z2: -0.26, z3: -0.26, along: 0.5 }
        ]
      })
    },
    // Thunniform: rigid forebody, all the work at the peduncle. Pointed snout,
    // tall first dorsal, and a heterocercal tail whose upper lobe is longer —
    // that asymmetry is the shark tell.
    shark: {
      onset: 0.82, amplitude: 0.07, waves: 0.5, beat: 1.5,
      geometry: () => bodyGeometry({
        lengthSegments: 19,
        // Shoulder well forward and a long pinched peduncle: the shark line.
        profile: fusiform(0.5, 1.55, 0.17),
        widthRatio: 0.66, heightRatio: 1.0,
        fins: [
          { plane: "vertical", root: 0, tip: 0.52, tip2: -0.26, z0: -0.46, z1: -0.78, z2: -0.66, z3: -0.46, along: 1 },
          { plane: "vertical", root: 0.05, tip: 0.40, tip2: 0.06, z0: 0.12, z1: -0.06, z2: -0.22, z3: -0.22, along: 0.45 },
          { plane: "horizontal", root: 0.09, tip: 0.44, z0: 0.16, z1: -0.02, along: 0.4 }
        ]
      })
    },
    // A cetacean. Blunt melon, curved dorsal, and flukes that are HORIZONTAL —
    // a vertical tail is the one mistake that turns a dolphin into a fish.
    dolphin: {
      onset: 0.74, amplitude: 0.075, waves: 0.45, beat: 1.25, vertical: true,
      geometry: () => bodyGeometry({
        lengthSegments: 19,
        // Rounder and blunter than a shark — the melon — but still zero at the
        // rostrum tip, and thicker through the middle third.
        profile: (t) => fusiform(0.44, 1.5, 0.165)(t) * (1 - 0.18 * t) + 0.008,
        widthRatio: 0.78, heightRatio: 0.92,
        fins: [
          { plane: "horizontal", root: 0.03, tip: 0.40, z0: -0.44, z1: -0.62, along: 1 },
          { plane: "vertical", root: 0.06, tip: 0.30, tip2: 0.05, z0: 0.06, z1: -0.10, z2: -0.24, z3: -0.24, along: 0.5 },
          { plane: "horizontal", root: 0.10, tip: 0.34, z0: 0.18, z1: 0.02, along: 0.4 }
        ]
      })
    },
    // A rorqual. Everything about it is scale: the beat is slow because beat
    // frequency falls with size — a calf beats four to seven times as often as
    // its mother at the same speed — and the pectoral flippers are enormous,
    // which is the humpback silhouette in one feature.
    whale: {
      onset: 0.62, amplitude: 0.045, waves: 0.4, beat: 0.28, vertical: true,
      geometry: () => bodyGeometry({
        lengthSegments: 22,
        profile: (t) => fusiform(0.5, 1.25, 0.15)(t) * (1 - 0.1 * t) + 0.006,
        widthRatio: 0.82, heightRatio: 1.0,
        fins: [
          { plane: "horizontal", root: 0.02, tip: 0.30, z0: -0.46, z1: -0.60, along: 1 },
          { plane: "vertical", root: 0.04, tip: 0.13, tip2: 0.04, z0: -0.12, z1: -0.22, z2: -0.30, z3: -0.30, along: 0.6 },
          // The flipper: about a third of the body, further forward than a fish's.
          { plane: "horizontal", root: 0.06, tip: 0.46, z0: 0.24, z1: -0.06, along: 0.3 }
        ]
      })
    },
    // Mobuliform: dorsoventral flapping of the pectoral fins, analogous to bird
    // flight, with only a small spanwise wave interposed. Around 0.8 Hz is where
    // propulsive efficiency peaks, at roughly 0.3 chord of amplitude. The body
    // axis barely moves — bending a manta along its length is the one tell that
    // turns it into a swimming carpet.
    manta: {
      onset: 0, amplitude: 0.34, waves: 0.4, beat: 0.42, mobuliform: true,
      geometry: () => wingGeometry({ halfSpan: 0.5, chord: 0.55 })
    },
    // A goblin shark is a deep-sea lamniform with a protrusible jaw: slow,
    // sinuous, and far more anguilliform than any reef shark.
    goblinShark: {
      onset: 0.55, amplitude: 0.10, waves: 0.75, beat: 0.85,
      geometry: () => SPECIES.shark.geometry()
    },
    // A swordfish is thunniform taken to its limit: almost nothing moves but the
    // peduncle, which is how it reaches the speeds it does.
    swordfish: {
      onset: 0.88, amplitude: 0.045, waves: 0.4, beat: 2.4,
      geometry: () => SPECIES.shark.geometry()
    },
    // Lionfish barely swim. They hover on their pectorals, so the body wave is
    // nearly nothing and the beat is slow.
    lionfish: {
      onset: 0.80, amplitude: 0.035, waves: 0.5, beat: 1.4,
      geometry: () => SPECIES.reefFish.geometry()
    },
    // A butterflyfish is a disc: ostraciiform-leaning, high beat, low amplitude.
    butterflyfish: {
      onset: 0.74, amplitude: 0.05, waves: 0.9, beat: 3.4,
      geometry: () => SPECIES.reefFish.geometry()
    },
    // A turbot is a flatfish lying on sand. It does not swim; the only motion is
    // a ripple running down the fin margin.
    turbot: {
      onset: 0.35, amplitude: 0.025, waves: 1.6, beat: 0.9,
      geometry: () => SPECIES.reefFish.geometry()
    },
    // A blobfish at depth is an ordinary-looking fish. It is only a blob at the
    // surface, where decompression has ruined it. It sits and waits.
    blobfish: {
      onset: 0.6, amplitude: 0.02, waves: 0.5, beat: 0.45,
      geometry: () => SPECIES.reefFish.geometry()
    },
    // Sit-and-wait ambush: it barely swims at all. The esca — a sac of glowing
    // bacteria on the illicium — is the entire animal at 2000 m, and it is the
    // reason the abyss can have a light source that is also a character.
    anglerfish: {
      onset: 0.5, amplitude: 0.05, waves: 0.6, beat: 0.7, lure: true,
      geometry: () => bodyGeometry({
        lengthSegments: 13,
        profile: (t) => fusiform(0.34, 1.9, 0.42)(t),
        widthRatio: 0.8, heightRatio: 1.0,
        fins: [
          { plane: "vertical", root: 0, tip: 0.22, tip2: -0.22, z0: -0.42, z1: -0.58, z2: -0.58, z3: -0.42, along: 1 },
          // The illicium, arching forward over the head.
          { plane: "vertical", root: 0.10, tip: 0.62, tip2: 0.58, z0: 0.24, z1: 0.52, z2: 0.60, z3: 0.30, along: 0.1 }
        ]
      })
    },
    // Myctophid. Blunt head, forked tail, and photophores in species-specific
    // rows along the belly. The most abundant vertebrate on Earth, and the
    // reason the twilight zone is not empty.
    lanternfish: {
      onset: 0.35, amplitude: 0.09, waves: 0.9, beat: 2.2, photophores: true,
      geometry: () => bodyGeometry({
        lengthSegments: 13,
        profile: fusiform(0.7, 1.35, 0.27),
        widthRatio: 0.42, heightRatio: 1.1,
        fins: [
          { plane: "vertical", root: 0, tip: 0.40, tip2: -0.40, z0: -0.46, z1: -0.70, z2: -0.70, z3: -0.46, along: 1 },
          { plane: "vertical", root: 0.05, tip: 0.26, tip2: 0.05, z0: 0.02, z1: -0.10, z2: -0.20, z3: -0.20, along: 0.5 }
        ]
      })
    }
  };

  function makeSchool(options) {
    const species = SPECIES[options.species];
    const geometry = species.geometry();
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(options.color), roughness: 0.44, metalness: 0.3,
      side: THREE.DoubleSide, emissive: new THREE.Color("#000000"), emissiveIntensity: 0
    });
    material.userData.nearField = options.nearField === true;
    material.userData.flat = species.mobuliform === true;
    material.userData.bellyUniform = { value: 1 };
    // Half the wingspan, in body-length units. Set here for the procedural wing
    // and overwritten when a real model with a different span is adopted.
    material.userData.spanUniform = { value: 0.5 };

    material.onBeforeCompile = function (shader) {
      Object.assign(shader.uniforms, creatureUniforms);
      shader.uniforms.uOnset = { value: species.onset };
      shader.uniforms.uAmplitude = { value: species.amplitude };
      shader.uniforms.uWaves = { value: species.waves };
      shader.uniforms.uBeat = { value: species.beat };
      shader.uniforms.uSpan = material.userData.spanUniform;
      // The counter-shading gradient is written in absolute units against a body
      // roughly 0.34 deep, which is what the procedural profiles produce. A real
      // model is whatever the artist made it -- the shark GLB is 0.11 deep once
      // normalised on length -- so the belly coordinate has to be rescaled or a
      // real animal renders in one flat tone.
      shader.uniforms.uBellyScale = material.userData.bellyUniform;
      const axis = species.mobuliform
        ? `// Mobuliform: the wave runs across the SPAN, not along the body, and
          // the amplitude grows toward the wingtip. The body axis holds still.
          float span = clamp(abs(position.x) / uSpan, 0.0, 1.0);
          float flap = sin(uCreatureTime * uBeat * 6.2831853 + aPhase - span * uWaves * 6.2831853);
          transformed.y += flap * pow(span, 1.7) * uAmplitude;`
        : species.vertical
          ? "transformed.y += lateral;   // a cetacean oscillates VERTICALLY: its flukes are horizontal"
          : "transformed.x += lateral;";
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>
          uniform float uCreatureTime; uniform float uOnset; uniform float uAmplitude;
          uniform float uWaves; uniform float uBeat; uniform float uBellyScale;
          attribute float along; attribute float aPhase;
          varying float vBelly; varying float vAlong;
          ${GLSL_UNDULATION}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          vBelly = position.y * uBellyScale;
          vAlong = along;
          float lateral = bodyLateralOffset(along, uOnset, uWaves, uAmplitude, uBeat, uCreatureTime, aPhase);
          ${axis}`);

      const lure = species.lure
        ? `
          // The esca. Bacterial light, so it owes nothing to the sun and is the
          // only thing in an abyssal frame that is genuinely bright.
          float escaDistance = length(vec2(vBelly - 0.58, vAlong - 0.1));
          gl_FragColor.rgb += vec3(0.75, 0.95, 0.62) * smoothstep(0.16, 0.0, escaDistance) * 6.0;`
        : "";

      const photophores = species.photophores
        ? `
          // Rows of photophores along the belly. Species-specific spacing is how
          // a lanternfish is identified; counter-illumination is what it is for.
          float row = smoothstep(0.30, 0.05, vBelly + 0.10);
          float dots = pow(max(0.0, sin(vAlong * 46.0)), 34.0);
          gl_FragColor.rgb += vec3(0.35, 0.95, 0.85) * row * dots * 2.4;`
        : "";

      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vBelly;\nvarying float vAlong;")
        // Counter-shading: dark back, bright belly. It is why a school reads as a
        // flicker of light rather than a cloud of identical objects.
        .replace("#include <tonemapping_fragment>",
          "gl_FragColor.rgb *= mix(1.7, 0.72, smoothstep(-0.16, 0.16, vBelly));" + photophores + lure + "\n#include <tonemapping_fragment>");
    };

    const mesh = new THREE.InstancedMesh(geometry, material, options.count);
    mesh.castShadow = true;
    mesh.userData.species = options.species;
    const phases = new Float32Array(options.count);
    mesh.userData.phases = phases;
    const next = randomFromSeed(options.seed);
    const leaders = [];
    for (let i = 0; i < options.leaders; i += 1) {
      leaders.push({
        angle: next() * Math.PI * 2,
        radius: options.pathRadius * (options.tightRing ? 0.9 + next() * 0.25 : 0.35 + next() * 0.75),
        speed: (0.05 + next() * 0.05) * (next() > 0.5 ? 1 : -1) * (options.slow || 1),
        height: options.heightBase + next() * options.heightRange,
        bob: next() * Math.PI * 2,
        breathPhase: next(),
        position: new THREE.Vector3(),
        heading: new THREE.Vector3(1, 0, 0)
      });
    }
    const members = [];
    for (let i = 0; i < options.count; i += 1) {
      const leader = leaders[i % leaders.length];
      members.push({
        leader,
        offset: new THREE.Vector3(
          (next() - 0.5) * options.spread,
          (next() - 0.5) * options.spread * 0.42,
          (next() - 0.5) * options.spread * 1.5),
        wander: next() * Math.PI * 2,
        scale: options.size * (0.78 + next() * 0.5)
      });
      phases[i] = next() * Math.PI * 2;
    }
    geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
    mesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scaleVector = new THREE.Vector3();
    const forward = new THREE.Vector3(0, 0, 1);
    const right = new THREE.Vector3();

    mesh.userData.surfacing = options.surfacing === true;
    mesh.userData.update = function (elapsed, bounds) {
      const surfaceY = bounds.surfaceY;
      // Keep clear of both boundaries by a body length: an animal grazing the
      // underside of the surface reads as stuck to it, and one clipping the
      // seabed reads as buried in it.
      const clearance = Math.max(0.8, options.size * 0.6);
      const ceiling = surfaceY === null ? Infinity : surfaceY - clearance;
      const floorY = bounds.floorY === null ? -Infinity : bounds.floorY + clearance;
      leaders.forEach((leader) => {
        leader.angle += leader.speed * 0.016;
        const wobble = fbm2(leader.angle * 1.7, leader.bob) - 0.5;
        const radius = leader.radius * (1 + wobble * 0.28);
        let height = leader.height + Math.sin(elapsed * 0.24 + leader.bob) * options.heightRange * 0.3;
        // Above the waterline the pod's cruising depth has to move down with
        // the water, or eleven dolphins swim through the sky.
        height += mesh.userData.baseOffset || 0;
        // THE CLAMP. Applied before the breach, so a breach can still exceed it.
        height = Math.min(Math.max(height, floorY), ceiling);
        let climb = 0;
        if (mesh.userData.surfacing && surfaceY !== null) {
          // Dolphins surface every 20-40 s during ordinary activity. A pod
          // rising to breathe and sinking back is the most legible behaviour any
          // animal in this scene can perform.
          const cycle = ((elapsed / 26 + leader.breathPhase) % 1 + 1) % 1;
          const ascent = Math.pow(Math.sin(Math.PI * cycle), 3);
          climb = ascent;
          // How far the arc goes past the waterline. Underwater the back just
          // breaks the surface; from above, a breach is the point.
          const breach = mesh.userData.breach === undefined ? -1.2 : mesh.userData.breach;
          height = height * (1 - ascent) + (surfaceY + breach) * ascent;
          // How far the whole school is allowed past the ceiling this frame.
          mesh.userData.breachHeight = Math.max(0, breach + clearance) * ascent;
        }
        leader.position.set(Math.cos(leader.angle) * radius, height, Math.sin(leader.angle) * radius);
        leader.heading
          .set(-Math.sin(leader.angle) * Math.sign(leader.speed), climb * 0.5, Math.cos(leader.angle) * Math.sign(leader.speed))
          .normalize();
      });
      for (let i = 0; i < members.length; i += 1) {
        const member = members[i];
        const leader = member.leader;
        const drift = Math.sin(elapsed * 0.7 + member.wander) * 0.25;
        position.copy(leader.position);
        // Offsets ride in the leader's frame, so the shoal banks together
        // instead of shearing when the leader turns.
        right.set(leader.heading.z, 0, -leader.heading.x).normalize();
        position.addScaledVector(right, member.offset.x + drift);
        position.y += member.offset.y;
        position.addScaledVector(leader.heading, member.offset.z);
        // The shoal's own spread has to obey the same ceiling, or the leader
        // stays under the water and half its school does not. The breach term
        // is what buys the licence to cross it.
        const licence = mesh.userData.breachHeight || 0;
        position.y = Math.min(position.y, ceiling + licence);
        if (bounds.floorY !== null) position.y = Math.max(position.y, floorY);
        quaternion.setFromUnitVectors(forward, leader.heading);
        scaleVector.setScalar(member.scale);
        matrix.compose(position, quaternion, scaleVector);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };
    return mesh;
  }

  /* ---- Jellyfish: the midwater drift set --------------------------------
     Two of the three depth zones cannot see the seafloor, so anything standing
     on it is out of frame. Drifters are the only content those zones can have,
     and roughly three quarters of open-ocean animals are bioluminescent, so in
     the dark they are also the only light. */

  function makeJellyfish(count, seedName, radius, columnHeight) {
    const bell = new THREE.SphereGeometry(0.5, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const uniforms = {
      uJellyTime: { value: 0 },
      uJellyColor: { value: new THREE.Color("#7FE9FF") },
      uJellyGlow: { value: 0.4 }
    };
    const material = new THREE.ShaderMaterial({
      uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec3 aJellyAnchor; attribute float aJellySeed;
        uniform float uJellyTime;
        varying float vRim; varying float vDown;
        void main(){
          float pulse = sin(uJellyTime * 1.15 + aJellySeed * 6.28) * 0.5 + 0.5;
          vec3 p = position;
          // The bell contracts and the margin flares: propulsion, not a wobble.
          p.xz *= 1.0 + pulse * 0.22;
          p.y *= 1.0 - pulse * 0.30;
          float scale = 0.34 + fract(aJellySeed) * 0.62;
          float rise = mod(uJellyTime * 0.08 + aJellySeed, 1.0);
          vec3 world = aJellyAnchor + vec3(
            sin(uJellyTime * 0.11 + aJellySeed * 3.0) * 2.4,
            rise * ${columnHeight.toFixed(1)} - ${(columnHeight * 0.5).toFixed(1)},
            cos(uJellyTime * 0.09 + aJellySeed * 2.0) * 2.4) + p * scale;
          vec4 mv = modelViewMatrix * vec4(world, 1.0);
          vec3 n = normalize(mat3(modelViewMatrix) * normalize(position));
          vRim = pow(1.0 - abs(dot(n, normalize(-mv.xyz))), 1.6);
          vDown = smoothstep(0.4, -0.5, position.y);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uJellyColor; uniform float uJellyGlow;
        varying float vRim; varying float vDown;
        void main(){
          float a = (vRim * 0.85 + vDown * 0.2) * uJellyGlow;
          gl_FragColor = vec4(uJellyColor * (vRim * 1.4 + 0.15), a);
        }`
    });
    const anchors = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const next = randomFromSeed(seedName);
    for (let i = 0; i < count; i += 1) {
      const angle = next() * Math.PI * 2;
      const r = radius * (0.28 + 0.72 * Math.sqrt(next()));
      anchors[i * 3] = Math.cos(angle) * r;
      anchors[i * 3 + 1] = 0;
      anchors[i * 3 + 2] = Math.sin(angle) * r;
      seeds[i] = next() * 10;
    }
    bell.setAttribute("aJellyAnchor", new THREE.InstancedBufferAttribute(anchors, 3));
    bell.setAttribute("aJellySeed", new THREE.InstancedBufferAttribute(seeds, 1));
    const mesh = new THREE.InstancedMesh(bell, material, count);
    const identity = new THREE.Matrix4();
    for (let i = 0; i < count; i += 1) mesh.setMatrixAt(i, identity);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2400;
    mesh.userData.uniforms = uniforms;
    return mesh;
  }

  const fauna = new THREE.Group();
  scene.add(fauna);

  const silversides = makeSchool({ seed: "school-silverside", species: "reefFish", count: 1400, leaders: 9, color: "#DCEEF5", size: 0.30, spread: 8.0, pathRadius: 19, heightBase: -6, heightRange: 15 });
  const anthias = makeSchool({ seed: "school-anthias", species: "reefFish", count: 340, leaders: 5, color: "#FF7A33", size: 0.24, spread: 3.2, pathRadius: 13, heightBase: -7, heightRange: 6, nearField: true });
  const sharks = makeSchool({ seed: "patrol-shark", species: "shark", count: 6, leaders: 6, color: "#8794A0", size: 3.4, spread: 1, pathRadius: 68, heightBase: -4, heightRange: 11, tightRing: true });
  const dolphins = makeSchool({ seed: "pod-dolphin", species: "dolphin", count: 11, leaders: 3, color: "#A9B9C4", size: 2.6, spread: 6.5, pathRadius: 58, heightBase: -4, heightRange: 8, surfacing: true, tightRing: true });
  const lanternfish = makeSchool({ seed: "swarm-lanternfish", species: "lanternfish", count: 300, leaders: 9, color: "#1E2A33", size: 0.3, spread: 7.5, pathRadius: 30, heightBase: -8, heightRange: 22 });
  // One whale, on a wide ring, moving slowly. The plan asks that a giant at fog
  // distance be "a moment, not a prop", and the way to get that is scarcity plus
  // distance, not size alone.
  const whales = makeSchool({ seed: "giant-whale", species: "whale", count: 1, leaders: 1, color: "#5D6E7A", size: 13, spread: 1, pathRadius: 118, heightBase: -9, heightRange: 10, tightRing: true, slow: 0.3 });
  const mantas = makeSchool({ seed: "glide-manta", species: "manta", count: 3, leaders: 3, color: "#39424C", size: 4.2, spread: 1, pathRadius: 76, heightBase: -6, heightRange: 11, tightRing: true, slow: 0.55 });
  const anglers = makeSchool({ seed: "ambush-angler", species: "anglerfish", count: 4, leaders: 4, color: "#161C22", size: 0.85, spread: 1, pathRadius: 17, heightBase: -4, heightRange: 8, tightRing: true, slow: 0.06 });
  const jellyfish = makeJellyfish(110, "drift-jelly", 62, 40);

  const goblins = makeSchool({ seed: "deep-goblin", species: "goblinShark", count: 2, leaders: 2, color: "#6A6F78", size: 3.1, spread: 1, pathRadius: 44, heightBase: -6, heightRange: 9, tightRing: true, slow: 0.3 });
  const blobfish = makeSchool({ seed: "deep-blob", species: "blobfish", count: 7, leaders: 7, color: "#A88079", size: 0.62, spread: 1, pathRadius: 20, heightBase: -4, heightRange: 3, tightRing: true, slow: 0.05 });
  const lionfish = makeSchool({ seed: "reef-lionfish", species: "lionfish", count: 9, leaders: 9, color: "#B8642F", size: 0.52, spread: 1, pathRadius: 15, heightBase: -6, heightRange: 4, tightRing: true, slow: 0.22, nearField: true });
  const butterflyfish = makeSchool({ seed: "reef-butterfly", species: "butterflyfish", count: 130, leaders: 6, color: "#F0C24A", size: 0.34, spread: 3.4, pathRadius: 16, heightBase: -6, heightRange: 5, nearField: true });
  const swordfish = makeSchool({ seed: "pelagic-sword", species: "swordfish", count: 5, leaders: 5, color: "#5A6470", size: 2.6, spread: 1, pathRadius: 64, heightBase: -7, heightRange: 11, tightRing: true, slow: 1.5 });
  const turbot = makeSchool({ seed: "bottom-turbot", species: "turbot", count: 14, leaders: 14, color: "#8C7F5C", size: 0.7, spread: 1, pathRadius: 26, heightBase: -1.2, heightRange: 1.4, tightRing: true, slow: 0.04 });

  const schools = [
    silversides, anthias, sharks, dolphins, lanternfish, whales, mantas, anglers,
    goblins, blobfish, lionfish, butterflyfish, swordfish, turbot
  ];
  schools.forEach((school) => fauna.add(school));
  fauna.add(jellyfish);

  /* =======================================================================
     10. FOREGROUND FRAME — near-black, within 2 m, partly off-frame. The
     single highest-value cheap change: it is what tells the eye it is INSIDE
     the water rather than looking at a picture of water.
     ======================================================================= */

  const foreground = new THREE.Group();
  let foregroundMaterial = null;
  {
    const material = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, fog: false, transparent: true, opacity: 0.92 });
    foregroundMaterial = material;
    [
      { x: -2.15, y: -1.9, z: -2.5, w: 0.42, h: 4.6, roll: 0.20, yaw: 0.3 },
      { x: -1.78, y: -2.0, z: -2.3, w: 0.30, h: 3.7, roll: 0.42, yaw: -0.5 },
      { x: 2.35, y: -2.1, z: -2.6, w: 0.50, h: 4.9, roll: -0.26, yaw: 0.6 },
      { x: 1.95, y: -2.0, z: -2.2, w: 0.26, h: 3.2, roll: -0.46, yaw: 0.1 }
    ].forEach((shape, index) => {
      const blade = new THREE.PlaneGeometry(shape.w, shape.h, 1, 10);
      blade.translate(0, shape.h * 0.5, 0);
      const pos = blade.getAttribute("position");
      for (let i = 0; i < pos.count; i += 1) {
        const t = pos.getY(i) / shape.h;
        pos.setX(i, pos.getX(i) * (1 - 0.72 * t * t));
      }
      pos.needsUpdate = true;
      const mesh = new THREE.Mesh(blade, material);
      mesh.position.set(shape.x, shape.y, shape.z);
      mesh.rotation.z = shape.roll;
      mesh.rotation.y = shape.yaw;
      mesh.userData.phase = index * 1.7;
      mesh.userData.baseRoll = shape.roll;
      mesh.renderOrder = 4000;
      foreground.add(mesh);
    });
  }
  camera.add(foreground);
  scene.add(camera);

  /* =======================================================================
     11. MOTES — marine snow and plankton, three parallax sizes. The depth cue
     is that near motes are LARGE and soft, not that there are many of them.
     ======================================================================= */

  function motePoints(options) {
    const positions = new Float32Array(options.count * 3);
    const seeds = new Float32Array(options.count);
    const next = randomFromSeed(options.seed);
    for (let i = 0; i < options.count; i += 1) {
      const angle = next() * Math.PI * 2;
      const radius = Math.sqrt(next()) * options.radius;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = options.minY + next() * (options.maxY - options.minY);
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      seeds[i] = next() * 100;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("aMoteSeed", new THREE.Float32BufferAttribute(seeds, 1));
    const uniforms = {
      uMoteTime: { value: 0 },
      uMoteSize: { value: options.size },
      uMoteColor: { value: new THREE.Color(options.color) },
      uMoteOpacity: { value: options.opacity },
      uMoteFlicker: { value: options.flicker || 0 },
      uFogColor: { value: new THREE.Color() },
      uFogDensity: { value: 0.02 }
    };
    const material = new THREE.ShaderMaterial({
      uniforms, transparent: true, depthWrite: false,
      blending: options.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `
        attribute float aMoteSeed;
        uniform float uMoteTime; uniform float uMoteSize; uniform float uMoteFlicker;
        uniform float uFogDensity;
        varying float vFlicker; varying float vFogFactor;
        void main(){
          vec3 p = position;
          p.y -= mod(uMoteTime * ${options.fall.toFixed(3)} + aMoteSeed, ${(options.maxY - options.minY).toFixed(2)});
          p.x += sin(uMoteTime * 0.24 + aMoteSeed) * 0.7;
          p.z += cos(uMoteTime * 0.19 + aMoteSeed * 1.3) * 0.7;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = -mv.z;
          vFogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          vFlicker = mix(1.0, 0.35 + 0.65 * (0.5 + 0.5 * sin(uMoteTime * 2.1 + aMoteSeed * 6.0)), uMoteFlicker);
          gl_PointSize = uMoteSize * (300.0 / max(1.0, dist));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uMoteColor; uniform float uMoteOpacity; uniform vec3 uFogColor;
        varying float vFlicker; varying float vFogFactor;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          if (r > 0.5) discard;
          float a = pow(1.0 - r * 2.0, 1.7) * uMoteOpacity * vFlicker;
          gl_FragColor = vec4(mix(uMoteColor, uFogColor, vFogFactor), a * (1.0 - vFogFactor * 0.85));
        }`
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.userData.uniforms = uniforms;
    return points;
  }

  const particles = new THREE.Group();
  const moteLayers = [
    motePoints({ seed: "snow-far", count: 2900, radius: 120, minY: -70, maxY: 70, size: 0.9, color: "#D8ECEF", opacity: 0.30, fall: 0.30 }),
    motePoints({ seed: "snow-mid", count: 1200, radius: 46, minY: -48, maxY: 48, size: 2.4, color: "#E6F4F6", opacity: 0.26, fall: 0.24 }),
    motePoints({ seed: "snow-near", count: 130, radius: 14, minY: -26, maxY: 26, size: 4.6, color: "#EAF7F9", opacity: 0.07, fall: 0.16 })
  ];
  const biolumLayer = motePoints({
    seed: "biolum", count: 900, radius: 80, minY: -60, maxY: 60, size: 2.6,
    color: "#5CF2E0", opacity: 0.95, fall: 0.05, flicker: 1, additive: true
  });
  moteLayers.forEach((layer) => particles.add(layer));
  particles.add(biolumLayer);
  scene.add(particles);

  /* =======================================================================
     12. GOD RAYS — a true ray-march, not textured cones. Noise is sampled in
     the plane PERPENDICULAR to the sunlight: cross-section coordinates give
     ribbons, world-space noise gives clouds. The threshold sits ABOVE the fbm
     mean or the result is a uniform veil, and the march accumulates the MEAN so
     brightness does not depend on how far it happened to integrate.
     ======================================================================= */

  const godRayUniforms = {
    uTime: { value: 0 },
    uSunDirection: { value: new THREE.Vector3(0.32, -1, 0.18).normalize() },
    uAxisA: { value: new THREE.Vector3(1, 0, 0) },
    uAxisB: { value: new THREE.Vector3(0, 0, 1) },
    uRayColor: { value: new THREE.Color("#BDEBFF") },
    uStrength: { value: 0.22 },
    uExtinction: { value: 0.02 },
    uSurfaceY: { value: 30 },
    uMarchDistance: { value: 90 }
  };
  const godRays = new THREE.Mesh(
    new THREE.SphereGeometry(150, 24, 18),
    new THREE.ShaderMaterial({
      uniforms: godRayUniforms, side: THREE.BackSide, transparent: true,
      depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: `varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uSunDirection; uniform vec3 uAxisA; uniform vec3 uAxisB;
        uniform vec3 uRayColor; uniform float uStrength; uniform float uExtinction;
        uniform float uSurfaceY; uniform float uMarchDistance;
        varying vec3 vW;
        ${GLSL_NOISE}
        const int STEPS = 22;
        float beamAt(vec3 p){
          vec2 section = vec2(dot(p, uAxisA), dot(p, uAxisB));
          vec2 uv = section * vec2(0.30, 0.075) + vec2(uTime * 0.021, uTime * 0.014);
          float beam = smoothstep(0.46, 0.82, sFbm(uv));
          float grain = 0.62 + 0.38 * sNoise(uv * 3.7 + vec2(uTime * 0.05, 0.0));
          float fade = exp(-max(0.0, uSurfaceY - p.y) * 0.02);
          return beam * grain * fade;
        }
        void main(){
          vec3 ray = normalize(vW - cameraPosition);
          float step = uMarchDistance / float(STEPS);
          float jitter = sHash(gl_FragCoord.xy) * step;
          float total = 0.0;
          for (int i = 0; i < STEPS; i++){
            float t = jitter + float(i) * step;
            total += beamAt(cameraPosition + ray * t) * exp(-t * uExtinction);
          }
          gl_FragColor = vec4(uRayColor * (total / float(STEPS)) * uStrength, 1.0);
        }`
    })
  );
  godRays.renderOrder = 3000;
  scene.add(godRays);

  /* =======================================================================
     12b. REAL MODELS
     The twelve CC0 GLBs in apps/myunivokai-personalization/public/assets/ocean/models are
     what the renderer will actually ship, and until now this study proved
     nothing about them. Four are wired in here -- the four animals big enough
     in frame to be looked at -- and the schools stay procedural on purpose: a
     thousand instances of a detailed mesh is exactly the cost the whole
     vertex-animation approach exists to avoid, and at two pixels across nobody
     could tell the difference anyway.

     The interesting part is that NOTHING about the animation had to change. The
     swim shader's entire contract with its geometry is one float attribute --
     `along`, 0 at the nose and 1 at the tail -- so any mesh that can be put in
     the same local frame inherits the whole locomotion model for free. That is
     the Abzu approach, and this is the proof of it.
     ======================================================================= */

  // Which axis is the body. For most fish it is simply the longest one; for a
  // manta the longest axis is the WINGSPAN, and mistaking one for the other
  // turns a ray into a snake.
  // Measured with .ocean-inspect.mjs, which prints each model's cross-section
  // profile in ten slabs along its axis. A guess was tried first -- "the head is
  // the vertically deeper end" -- and it got two of four wrong: a dolphin's
  // dorsal fin and tail stock are deeper than its rostrum, and a manta's head is
  // at the END of its body axis opposite the tail whip. An animal swimming
  // backwards is not a subtle bug, but it is a silent one, so these are declared
  // and then CHECKED rather than inferred.
  //   axis: which bounding-box axis is the body ("second" for a ray, whose
  //         longest axis is its wingspan)
  //   head: which end of that axis the head is on, in the model's own space
  const MODEL_SETUP = {
    shark: { axis: "long", head: 1, span: 0.5 },
    dolphin: { axis: "long", head: 1, span: 0.5 },
    whale: { axis: "long", head: 1, span: 0.5 },
    goblinShark: { axis: "long", head: 1, span: 0.5 },
    swordfish: { axis: "long", head: 1, span: 0.5 },
    lionfish: { axis: "long", head: 1, span: 0.5 },
    butterflyfish: { axis: "long", head: 1, span: 0.5 },
    turbot: { axis: "long", head: 1, span: 0.5 },
    blobfish: { axis: "long", head: 1, span: 0.5 },
    // Measured on the MERGED mesh, which changed the answer: with only the first
    // sub-mesh the wingspan was the longest axis, but the full model includes the
    // tail whip, which makes the body axis longest after all. The wings peak at
    // half-width 4.31 against a body length of 11.71, so the flap envelope has to
    // reach 0.37 of a body length or the outer wing is rigid.
    manta: { axis: "long", head: 1, span: 0.37 }
  };

  // A minimal merge: non-indexed, position + normal + colour, concatenated.
  // BufferGeometryUtils.mergeGeometries would do it, but it is 3000 lines away
  // and this is the only thing here that needs merging.
  function mergeParts(parts) {
    let total = 0;
    parts.forEach((part) => { total += part.getAttribute("position").count; });
    const position = new Float32Array(total * 3);
    const normal = new Float32Array(total * 3);
    const color = new Float32Array(total * 3);
    let cursor = 0;
    parts.forEach((part) => {
      const p = part.getAttribute("position");
      const n = part.getAttribute("normal");
      const c = part.getAttribute("color");
      for (let i = 0; i < p.count; i += 1) {
        const o = (cursor + i) * 3;
        position[o] = p.getX(i); position[o + 1] = p.getY(i); position[o + 2] = p.getZ(i);
        if (n) { normal[o] = n.getX(i); normal[o + 1] = n.getY(i); normal[o + 2] = n.getZ(i); }
        color[o] = c.getX(i); color[o + 1] = c.getY(i); color[o + 2] = c.getZ(i);
      }
      cursor += p.count;
    });
    const merged = new THREE.BufferGeometry();
    merged.setAttribute("position", new THREE.BufferAttribute(position, 3));
    merged.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    merged.setAttribute("color", new THREE.BufferAttribute(color, 3));
    return merged;
  }

  function collectModelGeometry(gltf) {
    gltf.scene.updateMatrixWorld(true);
    const parts = [];
    gltf.scene.traverse((child) => {
      if (!child.isMesh) return;
      const part = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
      part.applyMatrix4(child.matrixWorld);
      ["uv", "uv1", "uv2", "tangent", "skinIndex", "skinWeight", "color"]
        .forEach((name) => { if (part.getAttribute(name)) part.deleteAttribute(name); });
      // Each sub-mesh's flat material colour becomes that sub-mesh's vertex
      // colour, which is how five materials become one without losing anything.
      const source = child.material && child.material.color
        ? child.material.color
        : new THREE.Color(1, 1, 1);
      const count = part.getAttribute("position").count;
      const colours = new Float32Array(count * 3);
      for (let i = 0; i < count; i += 1) {
        colours[i * 3] = source.r;
        colours[i * 3 + 1] = source.g;
        colours[i * 3 + 2] = source.b;
      }
      part.setAttribute("color", new THREE.BufferAttribute(colours, 3));
      parts.push(part);
    });
    return parts.length ? mergeParts(parts) : null;
  }

  function normalizeCreatureGeometry(source, setup) {
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    ["uv", "uv1", "uv2", "tangent"].forEach((name) => {
      if (geometry.getAttribute(name)) geometry.deleteAttribute(name);
    });
    geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    geometry.boundingBox.getSize(size);

    // Rank the axes and pick the body axis by rule, not by hope.
    const ranked = [["x", size.x], ["y", size.y], ["z", size.z]].sort((a, b) => b[1] - a[1]);
    const bodyAxis = setup.axis === "second" ? ranked[1][0] : ranked[0][0];
    // Whatever is left over that is not the body axis and not the thinnest is
    // the animal's width; the thinnest is its up.
    if (bodyAxis !== "z") {
      const euler = bodyAxis === "x"
        ? new THREE.Euler(0, Math.PI / 2, 0)   // x -> z
        : new THREE.Euler(-Math.PI / 2, 0, 0); // y -> z
      geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(euler));
      geometry.computeBoundingBox();
      geometry.boundingBox.getSize(size);
    }

    // Centre, then scale so the body is exactly one unit long -- the frame every
    // species entry in this file was authored against.
    const centre = new THREE.Vector3();
    geometry.boundingBox.getCenter(centre);
    geometry.translate(-centre.x, -centre.y, -centre.z);
    geometry.scale(1 / size.z, 1 / size.z, 1 / size.z);

    const position = geometry.getAttribute("position");

    // The verification, kept because a wrong answer here is invisible until
    // someone notices an animal moving tail-first: a body tapers toward its
    // tail, so the half of the axis holding the thickest cross-section is the
    // head half. If this disagrees with the declaration above, the model has
    // changed and the table is stale.
    // The best available evidence for which end is the head is the EYE. Ten of
    // these twelve models carry a separate near-black material for the eyes --
    // 480 triangles, #161616, byte-identical across the set -- and an eye is on
    // the head by definition. Measured against the profiles: it is right where
    // cross-section is ambiguous, which is exactly the swordfish, whose bill and
    // whose tail are both thin.
    let eyeAlong = 0, eyeCount = 0;
    const colour = geometry.getAttribute("color");
    if (colour) {
      for (let i = 0; i < colour.count; i += 1) {
        const luma = 0.2126 * colour.getX(i) + 0.7152 * colour.getY(i) + 0.0722 * colour.getZ(i);
        if (luma < 0.03) { eyeAlong += position.getZ(i); eyeCount += 1; }
      }
    }

    let frontBulk = 0, backBulk = 0, frontCount = 0, backCount = 0;
    for (let i = 0; i < position.count; i += 1) {
      const z = position.getZ(i);
      const radius = Math.hypot(position.getX(i), position.getY(i));
      if (Math.abs(z) <= 0.06) continue;
      if (z > 0) { frontBulk += radius; frontCount += 1; }
      else { backBulk += radius; backCount += 1; }
    }
    // Means, not sums. Summing lets tessellation vote: the shark GLB carries far
    // more vertices in its fins than in its shoulders, so the total said "tail"
    // while every cross-section said "head".
    const frontMean = frontCount ? frontBulk / frontCount : 0;
    const backMean = backCount ? backBulk / backCount : 0;
    const measuredHead = eyeCount > 24
      ? (eyeAlong / eyeCount >= 0 ? 1 : -1)
      : (frontMean >= backMean ? 1 : -1);
    geometry.userData.headTest = {
      declared: setup.head, measured: measuredHead,
      evidence: eyeCount > 24 ? "eyes" : "cross-section",
      agrees: measuredHead === setup.head
    };

    if (setup.head < 0) {
      geometry.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI));
    }

    // `along`: 0 at the nose, 1 at the tail, which is the direction the
    // undulation envelope grows in.
    const along = new Float32Array(position.count);
    for (let i = 0; i < position.count; i += 1) {
      along[i] = THREE.MathUtils.clamp(0.5 - position.getZ(i), 0, 1);
    }
    geometry.setAttribute("along", new THREE.BufferAttribute(along, 1));
    // NOT computeVertexNormals(): the model's own normals came through the merge
    // already transformed, and recomputing them replaces the artist's smoothing
    // with hard facets on every fin.
    geometry.computeBoundingBox();
    return geometry;
  }

  function adoptModel(mesh, geometry, setup) {
    // The species tint was standing in for the model's palette. Now that the
    // palette is in the geometry, the tint would multiply it twice.
    mesh.material.vertexColors = true;
    mesh.material.color.setRGB(1, 1, 1);
    mesh.material.needsUpdate = true;
    geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(mesh.userData.phases, 1));
    const box = geometry.boundingBox;
    const halfHeight = Math.max(1e-3, (box.max.y - box.min.y) * 0.5);
    mesh.material.userData.bellyUniform.value = 0.17 / halfHeight;
    if (setup && setup.span) mesh.material.userData.spanUniform.value = setup.span;
    const previous = mesh.geometry;
    mesh.geometry = geometry;
    previous.dispose();
  }

  function loadRealModels(targets) {
    const catalogue = window.__OCEAN_MODELS;
    if (!catalogue || typeof window.GLTFLoader !== "function") {
      window.__oceanModelsLoaded = "unavailable";
      return;
    }
    const loader = new window.GLTFLoader();
    const pending = Object.keys(targets).filter((key) => catalogue[key]);
    let done = 0;
    const report = {};
    pending.forEach((key) => {
      loader.load(catalogue[key], (gltf) => {
        const source = collectModelGeometry(gltf);
        if (!source) return;
        const geometry = normalizeCreatureGeometry(source, MODEL_SETUP[key] || { axis: "long", head: 1 });
        targets[key].forEach((mesh) => adoptModel(mesh, geometry, MODEL_SETUP[key]));
        report[key] = {
          triangles: geometry.getAttribute("position").count / 3,
          head: geometry.userData.headTest
        };
        if (!geometry.userData.headTest.agrees) {
          console.warn("ocean-depth-rig: " + key +
            " may be facing backwards -- MODEL_SETUP says head " +
            geometry.userData.headTest.declared + ", the mesh measures " +
            geometry.userData.headTest.measured);
        }
        done += 1;
        if (done === pending.length) {
          window.__oceanModelReport = report;
          window.__oceanModelsLoaded = true;
        }
      }, undefined, () => { done += 1; });
    });
    if (!pending.length) window.__oceanModelsLoaded = "unavailable";
  }

  /* =======================================================================
     13. LIGHT RIG
     Key-to-fill discipline from the forest lesson: a strong single key with a
     weak fill. An ambient strong enough to "brighten the scene" is the thing
     that flattens every object in it.
     ======================================================================= */

  const keyLight = new THREE.DirectionalLight(0xffffff, 3.4);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -85;
  keyLight.shadow.camera.right = 85;
  keyLight.shadow.camera.top = 85;
  keyLight.shadow.camera.bottom = -85;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 260;
  keyLight.shadow.bias = -0.0006;
  keyLight.shadow.normalBias = 0.04;
  keyLight.position.set(-24, 74, 14);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(FILL_COMPLEMENT, 0.75);
  fillLight.position.set(30, -12, -26);
  scene.add(fillLight);
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambientLight);
  const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x000000, 0.7);
  scene.add(hemisphereLight);

  // The submersible lamp. Not a cheat and not an art-direction hack: below the
  // photic zone there is no other way to see anything, so every image humanity
  // owns of the deep sea was lit this way. It also earns back the one thing
  // absorption takes -- near-field colour -- at exactly the depth where the
  // frame has nothing else in it.
  // Range and decay matter more than intensity here. A 34 m range with
  // inverse-square decay delivers nothing at all to a seabed 24 m below the
  // camera, which is why the abyssal floor stayed a flat cut-out. A wide range
  // with a gentler falloff gives the lamp a POOL -- near field hot, mid field
  // carved, far field gone -- which is the entire look of deep-sea footage.
  const diveLight = new THREE.PointLight(0xCFEBFF, 0, 140, 1.3);
  scene.add(diveLight);

  scene.fog = new THREE.FogExp2(0x0a3b4e, 0.02);

  /* =======================================================================
     14. APPLY A WORLD
     ======================================================================= */

  const layerVisible = {
    silhouettes: true, seabed: true, flora: true, fauna: true,
    godrays: true, particles: true, foreground: true, surface: true, bubbles: true
  };

  const state = {
    viewerMetres: 17,
    seafloorMetres: 3700,
    fillOn: true,
    autoOrbit: true,
    foamOn: true,
    aboveYawBase: 0.6,
    // Which way the frame faces, measured from the sun. Zero is straight into
    // the glitter path; the classic blue-ocean photograph is taken with the sun
    // well behind the shoulder, because the water can only mirror the sky it is
    // facing and the sky opposite the sun is the deep blue one. Measured: sun-on
    // gives saturation 0.12, and the horizon haze is white by construction.
    sunYawOffset: 0,
    sunLocked: false,
    angle: 0.6,
    elevation: 0.06,
    profile: null,
    census: []
  };

  function applyWorld() {
    const p = depthProfile(state.viewerMetres, state.seafloorMetres);
    state.profile = p;

    renderer.setClearColor(p.fog, 1);
    // The adaptation, applied. Near the surface this is 1.02 and does nothing.
    renderer.toneMappingExposure = p.exposure;
    scene.fog.color.copy(p.fog);
    scene.fog.density = p.fogDensity;
    // With a texture carrying the albedo the material colour is a TINT, and the
    // water takes colour out of sand exactly as it does out of everything else.
    // In the dark the lamp is the only light, so the sand must not arrive
    // pre-lit: it takes MORE of the water's colour the less sun there is, and
    // the dive light then carves the near field out of it.
    // Rock is darker than sand and takes the water's colour the same way.
    boulderMaterials.forEach((material) => {
      material.color.copy(ROCK_ALBEDO)
        .lerp(p.fog, 0.34 + (1 - p.brightness) * 0.40)
        .multiplyScalar(0.62 + p.brightness * 0.22);
    });
    boulders.visible = layerVisible.flora && !p.above;

    floorMaterial.color.copy(SAND_ALBEDO)
      .lerp(p.fog, 0.40 + (1 - p.brightness) * 0.45)
      .multiplyScalar(0.72 + p.brightness * 0.20);

    if (p.above) {
      backdrop.scale.setScalar(9);
      backdropUniforms.uHorizon.value.copy(SKY_HORIZON);
      backdropUniforms.uUp.value.copy(SKY_ZENITH);
      backdropUniforms.uDown.value.copy(SKY_HAZE).multiplyScalar(0.72);
      backdropUniforms.uSunGlow.value = 1;
    } else {
      backdrop.scale.setScalar(1);
      backdropUniforms.uSunGlow.value = 0;
      backdropUniforms.uHorizon.value.copy(p.fog);
      backdropUniforms.uUp.value.copy(p.key).multiplyScalar(0.85).lerp(p.fog, 0.3);
      backdropUniforms.uDown.value.copy(p.fog).multiplyScalar(0.3);
    }

    // Every light now runs on `litness`, not on raw irradiance: the ratios
    // between key, fill and ambient are what carry depth, and those survive
    // being exposed for. Absolute darkness carries nothing.
    // The key was nailed to (-24, 74, 14) since the first version, which meant
    // the shading on every animal disagreed with the sky lighting it.
    keyLight.position.copy(p.above ? SUN_ABOVE : SUN_BELOW).multiplyScalar(95);
    keyLight.color.copy(p.key);
    keyLight.intensity = 3.4 * (0.25 + p.litness * 0.9);
    fillLight.intensity = state.fillOn ? 0.95 * (0.25 + p.litness) : 0;
    ambientLight.color.copy(p.fog).lerp(new THREE.Color("#5C86A8"), 0.35);
    // I broke the light rig's own rule here and it cost the deep its shape: an
    // ambient raised to "brighten the scene" lights every face of every object
    // equally, so the seabed came back as a flat slab of one colour no matter
    // what else was done to it. Adaptation belongs in the exposure, and the
    // near field belongs to the lamp. Ambient stays weak at every depth.
    ambientLight.intensity = 0.30 + p.brightness * 0.28;
    hemisphereLight.color.copy(p.key);
    hemisphereLight.groundColor.copy(p.fog).multiplyScalar(0.4);
    hemisphereLight.intensity = 0.7 * (0.3 + p.litness);
    // Ramps in only as the sun runs out, so nothing near the surface changes.
    diveLight.intensity = p.above ? 0 : 300 * Math.pow(1 - Math.min(1, p.brightness / 0.34), 2.0);
    diveLight.color.copy(p.key).lerp(new THREE.Color("#CFEBFF"), 0.8);

    causticUniforms.uCausticStrength.value = p.causticStrength * 0.185;
    causticUniforms.uCausticColor.value.copy(p.key).lerp(new THREE.Color("#CFF6FF"), 0.5);

    silhouetteMaterials.forEach((material) => {
      material.color.copy(p.fog).multiplyScalar(material.userData.dark * 0.72);
    });

    // ---- THE BATHYMETRY RULE, APPLIED ------------------------------------
    // The seabed rides its true clearance below the viewer, and simply is not
    // drawn when the water has already swallowed it. No palette involved.
    seabedGroup.visible = p.floorInSight && layerVisible.seabed && !p.above;
    seabedGroup.position.y = -p.floorClearance;

    const surfaceY = p.surfaceInSight ? p.viewerMetres : null;
    // Crossing the waterline swaps which face of the same sheet of water is
    // being rendered. Two materials, one surface: from below it is Snell's
    // window, from above it is the three.js Water technique. They are never
    // both on, so they can never fight over the depth buffer.
    surface.visible = !p.above && surfaceY !== null && layerVisible.surface;
    seaTop.visible = p.above && layerVisible.surface;
    if (p.above) {
      seaTop.position.y = p.viewerMetres;
      seaTopUniforms.uExposure.value = 1.0;
      seaTopUniforms.uFoam.value = state.foamOn ? 1 : 0;
      // Monahan's coverage, mapped onto the fold threshold. The mapping is a
      // fit, not a derivation -- but the number going into it is measured, and
      // that is the difference between a sea state and a foam slider.
      seaTopUniforms.uFoamEdge.value =
        0.15 + 0.80 * Math.sqrt(Math.min(1, seaState.whitecapFraction / 0.04));
    }
    if (surfaceY !== null) {
      surface.position.y = surfaceY;
      surfaceUniforms.uWaterColor.value.copy(p.fog);
      surfaceUniforms.uDeepColor.value.copy(p.fog).multiplyScalar(0.25);
      // Kept deliberately under 1.0 in linear space: past that the tone map
      // clips it to flat white and the whole gradient is thrown away, which is
      // exactly what "chói lóa" looked like.
      // Ratios, not constants: the zenith sits about 1.3x the water and the
      // rim about 1.8x, at every depth. That ratio is what a viewer reads as
      // "a window", and it is preserved whether the water is bright teal or
      // near-black. Still kept under 1.0 linear so the tone map's shoulder
      // cannot flatten the gradient into the white disc it once was.
      surfaceUniforms.uZenithColor.value
        .set("#3E7FA6").multiplyScalar(0.50 + p.fogValue * 1.00);
      surfaceUniforms.uHorizonColor.value
        .set("#E8F4FA").multiplyScalar(0.40 + p.fogValue * 1.10);
      surfaceUniforms.uBrightness.value = 0.80 + p.brightness * 0.35;
      surfaceUniforms.uFogDensity.value = p.fogDensity;
      // How much of the sky survives the trip down to the viewer. Anchored to
      // the water's own value so the window keeps its ratio to the water at
      // every depth -- the rule learned in 11c, now applied to a real sky
      // instead of to two hand-picked colours.
      surfaceUniforms.uSkyGain.value = 0.16 + p.fogValue * 0.62;
      // A rougher sea scatters the window apart: more slope variance means more
      // of the cone is bent past the critical angle at any instant.
      surfaceUniforms.uWaveDamping.value =
        THREE.MathUtils.clamp(0.22 + 0.30 / Math.max(0.35, seaState.significantHeight), 0.2, 0.85);
    }

    bubbleUniforms.uBubbleTop.value = p.floorInSight ? Math.min(p.floorClearance + 24, 90) : 40;
    bubbleUniforms.uBubbleTint.value.copy(p.key).lerp(new THREE.Color("#DCF6FF"), 0.5).multiplyScalar(0.6 + p.brightness);

    godRayUniforms.uStrength.value = p.godRayStrength * 2.2;
    godRayUniforms.uExtinction.value = p.fogDensity;
    godRayUniforms.uMarchDistance.value = p.visibility * 1.8;
    godRayUniforms.uSurfaceY.value = surfaceY === null ? 60 : surfaceY;
    godRayUniforms.uRayColor.value.copy(p.key).lerp(new THREE.Color("#DCF6FF"), 0.35);
    godRays.visible = p.godRayStrength > 0.004 && layerVisible.godrays && !p.above;

    moteLayers.forEach((layer) => {
      layer.userData.uniforms.uFogColor.value.copy(p.fog);
      layer.userData.uniforms.uFogDensity.value = p.fogDensity;
    });
    biolumLayer.userData.uniforms.uFogColor.value.copy(p.fog);
    biolumLayer.userData.uniforms.uFogDensity.value = p.fogDensity;
    biolumLayer.userData.uniforms.uMoteOpacity.value = 0.12 + p.biolumStrength * 0.88;
    biolumLayer.visible = layerVisible.particles && !p.above;

    // Whenever the surface is in reach, the sun is the subject: the window, the
    // god rays and the glitter all live in one direction, and a camera pointed
    // anywhere else in a sunlit ocean is pointed at nothing. Re-base on the
    // transition only, so dragging still holds.
    const sunLocked = p.above || p.surfaceInSight;
    if (sunLocked !== state.sunLocked) {
      state.sunLocked = sunLocked;
      state.aboveYawBase = state.angle;
    }

    // ---- WHO LIVES HERE ---------------------------------------------------
    // Species by zone, the way a rarity catalogue does it. A dolphin cannot live
    // where it can never reach air; a lanternfish belongs to the mesopelagic;
    // reef fish need a reef.
    const reefish = p.floorInSight && p.viewerMetres < 90 && !p.above;
    silversides.visible = layerVisible.fauna && reefish;
    anthias.visible = layerVisible.fauna && reefish;
    sharks.visible = layerVisible.fauna && p.viewerMetres < 400 && !p.above;
    // From above, the pod is the only animal that ever leaves the water, so it
    // is the only one worth drawing: a breach is the whole behaviour.
    dolphins.visible = layerVisible.fauna && surfaceY !== null && p.viewerMetres < 90;
    dolphins.userData.breach = p.above ? 2.4 : -1.2;
    dolphins.userData.baseOffset = p.above ? p.viewerMetres - 4 : 0;
    lanternfish.visible = layerVisible.fauna && p.viewerMetres > 70 && !p.above;
    // Rorquals feed and migrate through the upper few hundred metres.
    whales.visible = layerVisible.fauna && p.viewerMetres < 320 && !p.above;
    // Mantas are epipelagic filter feeders: reef and open water, not the deep.
    mantas.visible = layerVisible.fauna && p.viewerMetres < 220 && !p.above;
    // Real species, real zones. A goblin shark has been filmed between 900 and
    // 1300 m; a blobfish sits on the bottom between 600 and 1200 m and is famous
    // for being a gelatinous nothing at surface pressure; a lionfish is a reef
    // ambusher; a butterflyfish is the reef's colour; a swordfish is epipelagic
    // and fast; a turbot lies flat on sand and is why the seabed needs animals
    // that do not swim.
    goblins.visible = layerVisible.fauna && p.viewerMetres > 700 && !p.above;
    blobfish.visible = layerVisible.fauna && p.floorInSight && p.viewerMetres > 550 && !p.above;
    lionfish.visible = layerVisible.fauna && p.floorInSight && p.viewerMetres < 70 && !p.above;
    butterflyfish.visible = layerVisible.fauna && p.floorInSight && p.viewerMetres < 60 && !p.above;
    swordfish.visible = layerVisible.fauna && p.viewerMetres < 250 && !p.above;
    turbot.visible = layerVisible.fauna && p.floorInSight && p.viewerMetres < 400 && !p.above;

    // Deep-sea anglerfish live between roughly 500 and 1500 m and below.
    anglers.visible = layerVisible.fauna && p.viewerMetres > 480 && !p.above;
    jellyfish.visible = layerVisible.fauna && !p.above;
    jellyfish.userData.uniforms.uJellyGlow.value = 0.07 + p.biolumStrength * 1.05;
    jellyfish.userData.uniforms.uJellyColor.value
      .set("#7FE9FF").lerp(new THREE.Color("#48FFD5"), p.biolumStrength);

    state.census = [
      [butterflyfish, "butterflyfish", 130], [lionfish, "lionfish", 9],
      [turbot, "turbot", 14], [swordfish, "swordfish", 5],
      [goblins, "goblin shark", 2], [blobfish, "blobfish", 7],
      [silversides, "silversides", 1400], [anthias, "anthias", 340],
      [lanternfish, "lanternfish", 300], [sharks, "reef shark", 6],
      [dolphins, "dolphin pod", 11], [mantas, "manta", 3],
      [whales, "whale", 1], [anglers, "anglerfish", 4]
    ].filter(([mesh]) => mesh.visible).map(([, name, count]) => name + " x" + count);

    schools.forEach((school) => {
      if (school.material.userData.nearField) {
        // Not a cheat: at 2-4 m the water has taken almost nothing out of the
        // return path, so a reef fish genuinely does still read orange. This is
        // the one place colour is allowed to live.
        school.material.emissive.copy(school.material.color);
        school.material.emissiveIntensity = 0.34 * (0.35 + p.brightness) + p.biolumStrength * 0.8;
        return;
      }
      // A lanternfish is a DARK fish wearing lights. Making the whole body
      // emit turns a school into a cloud of pale flakes -- which is what the
      // abyss looked like. The photophore rows in the fragment shader are the
      // light; the body stays nearly black.
      school.material.emissive.set("#3BE0C8");
      school.material.emissiveIntensity = p.biolumStrength * 0.16;
    });

    // 0.16 of a dark fog is a near-black bar; 0.16 of the corrected bright fog
    // is a black bar over bright blue, which reads as chrome, not as a frond.
    if (foregroundMaterial) foregroundMaterial.color.copy(p.fog).multiplyScalar(0.42);
    foreground.visible = layerVisible.foreground && !p.above;
    particles.visible = layerVisible.particles && !p.above;
    flora.visible = layerVisible.flora && !p.above;
    silhouettes.visible = layerVisible.silhouettes && !p.above;
    bubbles.visible = layerVisible.bubbles && !p.above;

    // Never clip the backdrop: it is the only thing between the viewer and the
    // clear colour. v1 set far to visibility * 6 and lost the whole sky.
    camera.far = p.above ? 9000 : Math.max(720, p.visibility * 6);
    camera.updateProjectionMatrix();
    return p;
  }

  /* =======================================================================
     15. UI
     ======================================================================= */

  const readout = document.getElementById("readout");
  const swatch = document.getElementById("swatch");
  const viewerInput = document.getElementById("depth");
  const floorInput = document.getElementById("bathymetry");

  // The sun is now one control with eight consumers. Routing it through a single
  // function is the only way they stay in agreement -- and disagreement between
  // the sky, the specular, the god rays and the window is exactly the class of
  // bug that cost this study three rounds.
  function setSunElevation(degrees) {
    sunElevationDegrees = degrees;
    computeSun(degrees);
    updateSkyModel();
    surfaceUniforms.uSunDirection.value.copy(SUN_BELOW);
    seaTopUniforms.uSunDirection.value.copy(SUN_ABOVE);
    godRayUniforms.uSunDirection.value.copy(SUN_BELOW);
  }

  function zoneName(metres) {
    if (metres < 0) return "Above the waterline";
    if (metres >= 1000) return "Abyss — no sunlight reaches here";
    if (metres >= 120) return "Twilight zone";
    if (metres >= 40) return "Lower photic";
    return "Sunlit";
  }

  function refreshReadout(p) {
    const hex = "#" + p.fog.getHexString().toUpperCase();
    if (p.above) {
      readout.innerHTML =
        "<b>" + p.altitude.toFixed(0) + " m</b> above the water · " + zoneName(p.viewerMetres) +
        "<br>seabed " + p.floorClearance.toFixed(0) + " m down — beyond sight" +
        "<br>sun <b>" + sunElevationDegrees.toFixed(0) + "°</b> up · refracted to " +
        (Math.asin(SUN_BELOW.y) * 180 / Math.PI).toFixed(0) + "° seen from below" +
        "<br>medium: <b>air</b> · visibility km, not m" +
        "<br>swell 2.7 m · whitecaps " + (state.foamOn ? "on" : "off") +
        "<br>haze " + hex +
        "<br><span class=\"census\">alive here: " +
        (state.census.length ? state.census.join(", ") : "nothing") + "</span>";
      swatch.style.background = hex;
      return;
    }
    readout.innerHTML =
      "<b>" + Math.round(p.viewerMetres) + " m</b> down · " + zoneName(p.viewerMetres) +
      "<br>surface " + p.viewerMetres.toFixed(0) + " m up — " +
      (p.surfaceInSight ? "<b>in sight</b>" : "beyond sight") +
      "<br>seabed " + p.floorClearance.toFixed(0) + " m down — " +
      (p.floorInSight ? "<b>in sight</b>" : "beyond sight") +
      "<br>light left: <b>" + (p.fraction * 100).toFixed(p.fraction < 0.01 ? 3 : 1) + "%</b>" +
      " · visibility " + p.visibility.toFixed(0) + " m" +
      "<br>sun " + sunElevationDegrees.toFixed(0) + "° up · " +
      (Math.asin(SUN_BELOW.y) * 180 / Math.PI).toFixed(0) + "° through the surface" +
      "<br>caustics " + (p.causticStrength * 100).toFixed(0) +
      "% · rays " + (p.godRayStrength * 100).toFixed(0) +
      "% · biolum " + (p.biolumStrength * 100).toFixed(0) + "%" +
      "<br>fog " + hex +
      "<br><span class=\"census\">alive here: " + (state.census.length ? state.census.join(", ") : "nothing") + "</span>";
    swatch.style.background = hex;
  }

  function setWorld(viewerMetres, seafloorMetres) {
    // Entering the air re-bases the yaw so "look at the sun" is where the frame
    // starts, without throwing away whatever the viewer had dragged to.
    if (viewerMetres < 0 && state.viewerMetres >= 0) state.aboveYawBase = state.angle;
    state.viewerMetres = viewerMetres;
    if (seafloorMetres !== undefined) state.seafloorMetres = seafloorMetres;
    // The bed cannot be above the viewer.
    if (state.seafloorMetres < state.viewerMetres) state.seafloorMetres = state.viewerMetres;
    viewerInput.value = String(state.viewerMetres);
    floorInput.value = String(state.seafloorMetres);
    refreshReadout(applyWorld());
  }

  const waterOut = document.getElementById("waterout");
  function refreshWater() {
    const type = JERLOV_TYPES[waterTypeIndex];
    waterOut.innerHTML =
      "<span class=\"type\">Jerlov " + type.name + " · " + type.label + "</span>" +
      "<br>Kd 475 nm <b>" + type.kd475.toFixed(3) + " m⁻¹</b>" +
      "<br>Kd rgb " + waterKd.x.toFixed(2) + " / " + waterKd.y.toFixed(3) +
      " / " + waterKd.z.toFixed(3) +
      "<br>sighting range <b>" + sightingRange().toFixed(0) + " m</b>" +
      "<br>1% of blue light at " + (4.6 / waterKd.z).toFixed(0) + " m down";
  }

  const waterInput = document.getElementById("water");
  waterInput.addEventListener("input", () => {
    setWaterType(Number(waterInput.value));
    refreshWater();
    refreshReadout(applyWorld());
  });

  const seaStateOut = document.getElementById("seastate");
  function refreshSeaState() {
    seaStateOut.innerHTML =
      "<span class=\"force\">Beaufort " + seaState.beaufort + " · " + seaState.beaufortName + "</span>" +
      "<br>wind <b>" + seaState.windSpeed.toFixed(1) + " m/s</b> at 10 m" +
      "<br>significant height <b>" + seaState.significantHeight.toFixed(2) + " m</b>" +
      "<br>peak wavelength " + seaState.peakWavelength.toFixed(0) + " m" +
      "<br>whitecaps " + (seaState.whitecapFraction * 100).toFixed(2) + "% of surface";
  }

  const windInput = document.getElementById("wind");
  windInput.addEventListener("input", () => {
    buildWaveField(Number(windInput.value));
    refreshSeaState();
    refreshReadout(applyWorld());
  });

  const sunInput = document.getElementById("sun");
  sunInput.addEventListener("input", () => {
    setSunElevation(Number(sunInput.value));
    refreshReadout(applyWorld());
  });

  viewerInput.addEventListener("input", () => setWorld(Number(viewerInput.value)));
  floorInput.addEventListener("input", () => setWorld(state.viewerMetres, Number(floorInput.value)));

  document.querySelectorAll("[data-viewer]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-viewer]").forEach((b) => b.classList.remove("on"));
      button.classList.add("on");
      const water = button.getAttribute("data-water");
      if (water !== null) {
        waterInput.value = water;
        setWaterType(Number(water));
        refreshWater();
      }
      const wind = button.getAttribute("data-wind");
      if (wind !== null) {
        windInput.value = wind;
        buildWaveField(Number(wind));
        refreshSeaState();
      }
      const yawOffset = button.getAttribute("data-yaw");
      state.sunYawOffset = yawOffset === null ? 0 : THREE.MathUtils.degToRad(Number(yawOffset));
      const sun = button.getAttribute("data-sun");
      if (sun !== null) {
        sunInput.value = sun;
        setSunElevation(Number(sun));
      }
      setWorld(Number(button.getAttribute("data-viewer")), Number(button.getAttribute("data-floor")));
    });
  });

  document.querySelectorAll("[data-layer]").forEach((input) => {
    const key = input.getAttribute("data-layer");
    input.addEventListener("change", () => {
      if (key === "fill") state.fillOn = input.checked;
      else if (key === "foam") state.foamOn = input.checked;
      else layerVisible[key] = input.checked;
      refreshReadout(applyWorld());
    });
  });

  /* =======================================================================
     16. CAMERA — drift and breathing sell "underwater" before colour does
     ======================================================================= */

  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener("pointerdown", (event) => {
    dragging = true; lastX = event.clientX; lastY = event.clientY; state.autoOrbit = false;
  });
  window.addEventListener("pointerup", () => { dragging = false; });
  window.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    state.angle -= (event.clientX - lastX) * 0.005;
    state.elevation = THREE.MathUtils.clamp(state.elevation - (event.clientY - lastY) * 0.005, -0.9, 1.0);
    lastX = event.clientX; lastY = event.clientY;
  });

  function resize() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (canvas.width === width && canvas.height === height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const cameraTarget = new THREE.Vector3();
  const faunaBounds = { surfaceY: null, floorY: null };
  let autoPitch = 0;

  function frame() {
    resize();
    const elapsed = clock.getElapsedTime();
    const p = state.profile;

    // Above water a full orbit would swing the sun out of frame in half a
    // minute, so the drift is a fifth of the speed: enough to be alive.
    if (state.autoOrbit) state.angle += p.above ? 0.00016 : 0.0009;

    // The viewer floats at its own depth plane; the world moves around it.
    const drift = Math.sin(elapsed * 0.13) * 3.2;
    const radius = 30 + drift;
    camera.position.set(
      Math.cos(state.angle) * radius,
      Math.sin(elapsed * 0.42) * 0.3,               // breathing
      Math.sin(state.angle) * radius
    );

    // Look toward whichever boundary is in frame: down at a reef, up in open
    // water near the surface, level in a column with neither.
    let wanted = 0;
    // Above water the frame wants the glitter path and the horizon in it, which
    // means looking slightly DOWN and roughly toward the sun.
    if (p.above) wanted = -0.32;
    else
    // Snell's window is a 97-degree cone around the zenith, so its edge sits
    // 41 degrees up. To get the disc INSIDE a 58-degree frame the camera has to
    // look steeply up — about 62 degrees — which is also what a diver does.
    if (p.surfaceInSight && !p.floorInSight) wanted = 1.05;   // radians: 60 degrees up, into the window
    // A reef with the surface in reach is the one frame that can hold BOTH
    // boundaries, and the frame is worth far more with the window in the top
    // third than with an empty column there.
    else if (p.floorInSight && p.surfaceInSight) wanted = 0.42;
    else if (p.floorInSight) wanted = -0.22;                     // abyssal plain: the floor is all there is
    autoPitch += (wanted - autoPitch) * 0.02;

    // THE AIM BUG, fixed. The target used to be placed at radius 16 from the
    // WORLD ORIGIN while the camera orbits at radius 30, so the horizontal run
    // was up to 46 units and every "pitch" came out roughly half what it
    // claimed: an intended 60 degrees rendered as 27, which puts the entire
    // frame OUTSIDE Snell's 48.6-degree cone. The window kept refusing to
    // appear, and it was never the shader — it was the trigonometry.
    const pitch = THREE.MathUtils.clamp(autoPitch + state.elevation, -1.15, 1.35);
    // Yaw points back across the basin, so the orbit sweeps past content rather
    // than staring outward into empty water.
    // Above water the composition is the glitter path, and the glitter path
    // exists only toward the sun. Everything else about that frame is the same
    // frame. Drag still works: it moves relative to the sun rather than to a
    // world axis nobody can see.
    const yaw = state.sunLocked
      ? SUN_AZIMUTH + state.sunYawOffset + (state.angle - state.aboveYawBase)
      : state.angle + Math.PI + 0.42;
    const cosPitch = Math.cos(pitch);
    cameraTarget.set(
      camera.position.x + Math.cos(yaw) * cosPitch * 20,
      camera.position.y + Math.sin(pitch) * 20,
      camera.position.z + Math.sin(yaw) * cosPitch * 20
    );
    camera.lookAt(cameraTarget);

    causticUniforms.uCausticTime.value = elapsed;
    swayUniforms.uSwayTime.value = elapsed;
    creatureUniforms.uCreatureTime.value = elapsed;
    bubbleUniforms.uBubbleTime.value = elapsed;
    godRayUniforms.uTime.value = elapsed;
    surfaceUniforms.uTime.value = elapsed;
    seaTopUniforms.uTime.value = elapsed;
    waveShared.uWaveTime.value = elapsed;
    jellyfish.userData.uniforms.uJellyTime.value = elapsed;
    moteLayers.forEach((layer) => { layer.userData.uniforms.uMoteTime.value = elapsed; });
    biolumLayer.userData.uniforms.uMoteTime.value = elapsed;

    // Keep the god-ray noise plane perpendicular to the light, or the beams
    // become clouds.
    // God rays travel along the REFRACTED sun, not the real one: below the
    // surface that is the only direction light is coming from.
    godRayUniforms.uSunDirection.value.copy(SUN_BELOW);
    const sun = godRayUniforms.uSunDirection.value;
    godRayUniforms.uAxisA.value.set(1, 0, 0).cross(sun).normalize();
    godRayUniforms.uAxisB.value.copy(sun).cross(godRayUniforms.uAxisA.value).normalize();
    godRays.position.copy(camera.position);
    backdrop.position.copy(camera.position);
    surface.position.x = camera.position.x;
    surface.position.z = camera.position.z;
    // The sea follows in x/z only. Its y is the waterline, and the waterline is
    // the one thing in this scene that must never move with the camera.
    seaTop.position.x = camera.position.x;
    seaTop.position.z = camera.position.z;
    diveLight.position.copy(camera.position).addScaledVector(
      cameraTarget.clone().sub(camera.position).normalize(), 2.2);

    foreground.children.forEach((blade) => {
      blade.rotation.z = blade.userData.baseRoll + Math.sin(elapsed * 0.55 + blade.userData.phase) * 0.055;
    });

    const surfaceY = p.surfaceInSight ? p.viewerMetres : null;
    // The same two numbers the whole study is built on, handed to the animals.
    faunaBounds.surfaceY = surfaceY;
    faunaBounds.floorY = p.floorInSight ? -p.floorClearance : null;
    schools.forEach((school) => { if (school.visible) school.userData.update(elapsed, faunaBounds); });

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // Open on the surface. The first frame is the whole argument, and the study's
  // own finding is that the waterline is where the beauty is cheapest.
  // Procedural first so the first frame is never empty, then the real meshes
  // are swapped in underneath the running animation. Nothing else changes:
  // same instances, same phases, same swim shader.
  loadRealModels({
    shark: [sharks], dolphin: [dolphins], whale: [whales], manta: [mantas],
    goblinShark: [goblins], swordfish: [swordfish], lionfish: [lionfish],
    butterflyfish: [butterflyfish], turbot: [turbot], blobfish: [blobfish]
  });

  refreshSeaState();
  refreshWater();
  setWorld(-22, 3700);
  frame();
  window.__oceanStudyReady = true;
})();

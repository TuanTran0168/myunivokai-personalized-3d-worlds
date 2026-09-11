import { Color, type MeshStandardMaterial, type IUniform } from "three";

/**
 * Caustics on the seabed, by refraction rather than by noise.
 *
 * The version this replaces multiplied three sine gratings together and kept
 * the crests. It moved, and it was wrong in the way that matters: caustics are
 * not a pattern on the floor, they are *where the light went*. Sunlight enters
 * a wavy surface, each patch of wavefront is bent by the local slope, and the
 * bright veins are the places where neighbouring rays converge — the same light
 * arriving on less floor.
 *
 * Evan Wallace's WebGL water renders that literally: draw the surface as a grid,
 * push every vertex to where its refracted ray lands on the floor, and shade it
 * by `oldArea / newArea` taken from screen-space derivatives, accumulating
 * additively. That needs a second render target and a second scene.
 *
 * This computes the same quantity analytically. The wave field is known in
 * closed form, so the refracted landing point is a function of floor position,
 * and the area ratio is the reciprocal of the Jacobian determinant of that
 * function — which `dFdx`/`dFdy` give directly, for free, in the floor's own
 * fragment shader. One material, no extra pass, and the bright veins fall where
 * the light actually converges.
 *
 * Two consequences worth knowing:
 *
 *   - **It reaches zero on its own.** The strength is the depth curve's
 *     causticStrength, which is the surviving light fraction times a gain and is
 *     exactly zero below the sunlight floor. No branch says "the abyss has no
 *     caustics"; the arithmetic does.
 *   - **The refraction index is real.** 1.0/1.333 is air into water, and it is
 *     what sets how far a given slope throws its light. Treating it as a tuning
 *     knob is how caustics stop tracking the surface they supposedly come from.
 */

const WATER_REFRACTION_RATIO = 1.0 / 1.333;

export type CausticsUniforms = {
  uCausticTime: IUniform<number>;
  uCausticStrength: IUniform<number>;
  uCausticDepth: IUniform<number>;
  uCausticColor: IUniform<Color>;
};

export function createCausticsUniforms(
  strength: number,
  surfaceHeightAboveFloor: number,
  lightColor: string
): CausticsUniforms {
  return {
    uCausticTime: { value: 0 },
    uCausticStrength: { value: strength },
    // How far the light travels between surface and floor. Deeper water spreads
    // the same slope over more floor, so the veins grow wider and softer with
    // depth on their own.
    uCausticDepth: { value: Math.max(0.5, surfaceHeightAboveFloor) },
    uCausticColor: { value: new Color(lightColor) }
  };
}

const CAUSTICS_CHUNK = /* glsl */ `
  uniform float uCausticTime;
  uniform float uCausticStrength;
  uniform float uCausticDepth;
  uniform vec3 uCausticColor;
  varying vec3 vCausticWorldPosition;
  varying float vCausticUpness;

  // Wavelengths in scene units. These are RIPPLES, not swell — the small,
  // steep, wind-driven chop that rides on top of the waves the surface plane
  // draws, with crests a metre or two apart.
  //
  // Getting this wrong is invisible in the maths and glaring on screen. The
  // first draft used swell wavelengths of thirteen to forty-eight units inside
  // a basin thirty-six units across, so the "caustic net" was one or two
  // enormous pale swathes drifting over the seabed: the arithmetic was right
  // and the scale was off by an order of magnitude. Caustic veins on a real
  // reef floor are tens of centimetres wide, and it is their FINENESS against
  // the sand that makes them read as light rather than as bad lighting.
  const float RIPPLE_A = 2.4;
  const float RIPPLE_B = 1.7;
  const float RIPPLE_C = 3.9;

  /**
   * The surface height field, as three ripple trains running in three
   * directions.
   *
   * The DIRECTIONS are the load-bearing part. A draft that summed an x-only
   * grating and a y-only grating produced a caustic net of perfect rectangles —
   * arithmetically a caustic, visually a tiled floor, and worse than the blobs
   * it replaced because a grid is the one pattern the eye never forgives.
   *
   * Real chop runs whichever way the wind and the reflected swell send it, and
   * three trains at 9, 68 and 135 degrees share no lattice, so their crests
   * cross at angles that keep changing across the floor. That is what turns the
   * net into the irregular polygons a real seabed shows.
   *
   * The gradient is what matters here, not the height — the height is never
   * displayed. So the amplitudes below are SLOPES, and each train contributes
   * along its own direction, which is what the gradient of a directional
   * sinusoid actually is.
   */
  vec2 surfaceSlope(vec2 p, float t) {
    // DOMAIN WARP, and it is not a refinement — it is the difference between a
    // caustic and a tiled floor.
    //
    // A sum of plane waves is quasi-periodic no matter how many are added or
    // how carefully their angles are chosen: their maxima land on a lattice,
    // and the eye reads that lattice instantly. Three trains gave rectangles,
    // then rows of rounded cells; the pattern was fine, regular and obviously
    // manufactured. Bending the coordinate system first, with a wave far longer
    // than any ripple, slides the lattice's phase around as it crosses the
    // floor so it never lines up with itself twice.
    //
    // The warp changes the true gradient by a chain-rule factor that is not
    // accounted for here, and that is fine: the Jacobian this field feeds is
    // measured downstream with dFdx/dFdy on the RESULT, so it stays consistent
    // with whatever field it is actually given.
    vec2 warped = p + vec2(
      sin(p.y * 0.31 + t * 0.13) + 0.45 * sin(p.x * 0.71 - t * 0.19),
      cos(p.x * 0.27 - t * 0.11) + 0.45 * cos(p.y * 0.63 + t * 0.17)
    ) * 1.5;

    // Five trains rather than three. The two extra carry the short end of the
    // spectrum, which is what gives the veins their frayed edges — a real
    // surface is broadband, and a caustic drawn from three clean tones looks
    // exactly as synthetic as it is.
    vec2 firstDirection = vec2(0.986, 0.164);
    vec2 secondDirection = vec2(0.383, 0.924);
    vec2 thirdDirection = vec2(-0.707, 0.707);
    vec2 fourthDirection = vec2(0.643, -0.766);
    vec2 fifthDirection = vec2(-0.259, -0.966);
    vec2 slope = vec2(0.0);
    slope += firstDirection * (0.26 * cos(dot(warped, firstDirection) * RIPPLE_A + t * 0.9));
    slope += secondDirection * (0.17 * cos(dot(warped, secondDirection) * RIPPLE_B - t * 0.7));
    slope += thirdDirection * (0.11 * cos(dot(warped, thirdDirection) * RIPPLE_C + t * 1.3));
    slope += fourthDirection * (0.09 * cos(dot(warped, fourthDirection) * RIPPLE_C * 1.61 - t * 1.7));
    slope += fifthDirection * (0.06 * cos(dot(warped, fifthDirection) * RIPPLE_C * 2.43 + t * 2.1));
    return slope * 0.16;
  }

  // Where the light that lands HERE entered the surface. Small-angle refraction
  // through a slope: the ray is deflected by (1 - eta) times the slope, and
  // travels uCausticDepth before it reaches the floor.
  //
  // The throw has to stay a fraction of a ripple wavelength. Push it past one
  // and neighbouring rays cross several crests before landing, the Jacobian
  // stops being locally meaningful, and the veins collapse into aliasing noise.
  vec2 refractedOrigin(vec2 floorPoint, float t) {
    vec2 slope = surfaceSlope(floorPoint, t);
    return floorPoint - slope * (1.0 - ${WATER_REFRACTION_RATIO.toFixed(6)}) * uCausticDepth;
  }
`;

const CAUSTICS_APPLICATION = /* glsl */ `
  #ifdef USE_OCEAN_CAUSTICS
  if (uCausticStrength > 0.0001) {
    vec2 floorPoint = vCausticWorldPosition.xz;
    vec2 origin = refractedOrigin(floorPoint, uCausticTime);

    // The area ratio, straight from screen-space derivatives: how much floor a
    // patch of wavefront covers now against how much it covered at the surface.
    // Above 1 the rays converged and the floor is bright; below 1 they spread.
    vec2 dx = dFdx(origin);
    vec2 dy = dFdy(origin);
    float newArea = abs(dx.x * dy.y - dx.y * dy.x);
    vec2 fx = dFdx(floorPoint);
    vec2 fy = dFdy(floorPoint);
    float oldArea = abs(fx.x * fy.y - fx.y * fy.x);

    float convergence = oldArea / max(newArea, 1e-7);
    // Only convergence brightens; divergence is already the unlit floor, and
    // subtracting there would punch holes rather than dim gently.
    float caustic = max(0.0, convergence - 1.0);
    // Caustic veins are thin and very bright rather than broad and faint, which
    // is what the power does; the clamp stops a near-singular Jacobian at a
    // focus from blowing out to white.
    // Clamped at 1.8, not 4: at 4 a focus saturated every channel, so the
    // sediment's grain, the rock's shading and the plant's colour all vanished
    // under the same white ribbon. An effect that erases the surface it lands on
    // has stopped being light on a surface.
    //
    // Then normalised to 0..1, so the strength uniform means the same thing here
    // as it does in the prototype, whose own caustic term is bounded at 1 by
    // construction. Without the division both renderers agreed on the constant
    // and disagreed by a factor of six on what it multiplied.
    caustic = min(1.8, pow(caustic, 1.6)) / 1.8;

    // Only upward-facing surfaces catch it, which is both the physics — the
    // light is coming down — and the fix for a numerical trap. On a face seen
    // edge-on, oldArea and newArea are both near zero and their ratio is noise;
    // left alone, kelp blades and rock walls sparkle.
    caustic *= smoothstep(0.0, 0.35, vCausticUpness);

    // No extra factor. The 0.16 was another tone-mapping workaround: under a
    // disabled curve a caustic vein blew to white, so it was scaled down until it
    // stopped — which left the sand with almost no pattern on it at all.
    gl_FragColor.rgb += uCausticColor * caustic * uCausticStrength;
  }
  #endif
`;

/**
 * Attaches the caustics to a standard material.
 *
 * Uses onBeforeCompile rather than a custom material so the surface keeps
 * three's own lighting, fog and tone mapping — caustics ADD to a lit surface,
 * and a hand-written material would have to reimplement all of it to get there.
 *
 * CHAINS onto whatever was already installed rather than replacing it. The
 * seabed needs two injections (macro variation on the albedo, caustics on the
 * output) and `onBeforeCompile` is a single slot, so an assignment here would
 * silently drop the other one — a compile-time-invisible bug that shows up only
 * as a texture that suddenly tiles again.
 */
export function applyCaustics(material: MeshStandardMaterial, uniforms: CausticsUniforms): void {
  material.defines = { ...(material.defines ?? {}), USE_OCEAN_CAUSTICS: "" };
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vCausticWorldPosition;\nvarying float vCausticUpness;"
      )
      // Instancing has to be applied by hand here. three's own <worldpos_vertex>
      // does it, but only inside an `#if defined(USE_ENVMAP) || ...` — so its
      // worldPosition may not exist at all, and reading it would compile on the
      // shadow-casting floor and fail on a material without shadows. Computing
      // it fresh also fixes the failure that matters: without instanceMatrix
      // every rock and every kelp strand would sample the caustic pattern at
      // the mesh origin, so the entire scatter would light up in unison.
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
  vec4 oceanCausticPosition = vec4(transformed, 1.0);
  mat3 oceanCausticRotation = mat3(modelMatrix);
  #ifdef USE_INSTANCING
    oceanCausticPosition = instanceMatrix * oceanCausticPosition;
    oceanCausticRotation = oceanCausticRotation * mat3(instanceMatrix);
  #endif
  vCausticWorldPosition = (modelMatrix * oceanCausticPosition).xyz;
  vCausticUpness = normalize(oceanCausticRotation * objectNormal).y;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + CAUSTICS_CHUNK)
      // After tone mapping would wash them out; before it, a focus rolls off
      // through the same curve as every other highlight in the frame.
      .replace("#include <tonemapping_fragment>", CAUSTICS_APPLICATION + "\n#include <tonemapping_fragment>");
  };
  material.needsUpdate = true;
}

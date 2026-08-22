/**
 * Animals: real meshes, one draw call per species, and locomotion that is a
 * property of the animal rather than of the artist.
 *
 * The design is the one Abzû used and the one this family's plan has been
 * arguing for: a static mesh, instanced, deformed in the VERTEX SHADER by a
 * swim cycle. No skeletons, no per-instance clones. The shader's entire contract
 * with its geometry is one float attribute — `along`, 0 at the nose and 1 at the
 * tail — so any mesh that can be put in the same local frame inherits the whole
 * locomotion model for free. That is what makes it asset-independent.
 *
 * Three things about the shipped GLBs, each of which cost a round to find:
 *
 *   1. Every model is split into two to five SUB-MESHES, one per material —
 *      body, fins, eyes, mouth. Loading the first one and stopping renders the
 *      shark's underside in one flat grey with no fins and no eye. They are
 *      merged here, with each part's colour carried as a vertex colour.
 *   2. Counter-shading is written in absolute units against a body about 0.34
 *      deep. A real model is whatever the artist made it, so the belly
 *      coordinate is rescaled per model or the animal renders in one flat tone.
 *   3. Which end is the head must be DECLARED and then CHECKED. Two heuristics
 *      were tried and both failed silently — a dolphin's dorsal fin is deeper
 *      than its rostrum, and summing cross-sections lets tessellation vote. The
 *      check that works is the EYE: ten of the twelve models carry a separate
 *      near-black material for it, and an eye is on the head by definition.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import { bodyForArchetype, type BodyArchetype } from "./oceanRigBodies";
import { createFishSkinBake, type PhotophoreDot } from "./oceanFishSkinTexture";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { randomFromSeed } from "@/lib/scene";
import { OCEAN_MODEL_BASE_PATH } from "./oceanFaunaModels";

/**
 * Species differ by HOW MUCH OF THE BODY undulates, not by how fast. That is
 * the whole taxonomy of fish locomotion in one number, and it is why an eel and
 * a tuna read as different animals from a silhouette alone.
 */
export const GLSL_UNDULATION = /* glsl */ `
  float bodyLateralOffset(float alongBody, float onset, float waves,
                          float amplitude, float beatHertz, float elapsed, float phase) {
    float span = max(1e-4, 1.0 - onset);
    float envelope = max(0.0, (alongBody - onset) / span);
    float p = beatHertz * elapsed * 6.2831853 - alongBody * waves * 6.2831853 + phase;
    return envelope * envelope * amplitude * sin(p);
  }
`;

export type SwimStyle = {
  /** Fraction of the body that stays rigid. 0.88 is a swordfish, 0.55 an eel. */
  onset: number;
  amplitude: number;
  waves: number;
  /** Tail beats per second. */
  beat: number;
  /** Cetaceans oscillate vertically: their flukes are horizontal. */
  vertical?: boolean;
  /** Rays fly. The wave runs across the SPAN and the body axis holds still. */
  mobuliform?: boolean;
  /** Half the wingspan in body lengths, for the mobuliform envelope. */
  span?: number;
};

/**
 * A bait ball: leaders cluster onto one shared, slowly-drifting axis instead
 * of scattering around the whole ring, and members spiral that axis instead
 * of riding a fixed offset in the leader's frame. See createSchool.
 */
export type VortexStyle = {
  /** Metres from the shared axis at the cone's widest point. */
  radius: number;
  /** Full rotations per second the swirl completes around the axis. */
  spinHertz: number;
  /** How sharply the cone tapers top/bottom; 1 is a true cone, higher is more cylindrical. */
  taper: number;
};

export type FaunaSpecies = {
  key: string;
  /**
   * File under OCEAN_MODEL_BASE_PATH, when this species has one.
   *
   * Optional, and that is the point. Four of the fourteen animals here have no
   * model on disk — silversides, anthias, lanternfish and anglerfish — and they
   * happen to be the mass schools that make an ocean look inhabited. While a
   * file was mandatory those four could not exist, which cost the rig 2154 of
   * its 2550 animals. Every species now renders from `body` immediately and only
   * UPGRADES to a GLB if one is named here and loads.
   */
  file?: string;
  /** The procedural silhouette this species is drawn from until a GLB arrives. */
  body: BodyArchetype;
  /**
   * The animal's own colour, used by the procedural body.
   *
   * An adopted GLB brings its own vertex colours and overrides this — but until
   * one does, and forever for the four species that have no model, this is the
   * only colour the animal has.
   */
  color: string;
  swim: SwimStyle;
  /** Which bounding-box axis is the body, and which end the head is on. */
  bodyAxis: "long" | "second";
  head: 1 | -1;
  /** Shallowest depth in metres this animal is drawn at. */
  minDepthMetres: number;
  /** Deepest. */
  maxDepthMetres: number;
  /** Only drawn when the seabed is in frame. */
  needsSeafloor?: boolean;
  /** Only drawn when the surface is in frame. */
  needsSurface?: boolean;
  count: number;
  leaders: number;
  /** Metres of body length. */
  size: number;
  spread: number;
  pathRadius: number;
  heightBase: number;
  heightRange: number;
  speedScale?: number;
  /** Big animals ride a wide ring so they never pass through the lens. */
  tightRing?: boolean;
  surfacing?: boolean;
  /**
   * Keeps its own colour instead of surrendering it to the water.
   *
   * Not a cheat: at 2-4 m the water has taken almost nothing out of the return
   * path, so a reef fish genuinely does still read orange. This is the one place
   * saturated colour is allowed to live underwater, and without it the reef has
   * no warm note anywhere in frame.
   */
  nearField?: boolean;
  label: string;
  /**
   * Paired ventral photophore rows, baked into an emissive texture instead of
   * the flat whole-body glow every species with no GLB used to get. Real
   * myctophid anatomy, and the reason a lanternfish reads as "a dark fish
   * wearing lights" rather than as a uniformly pale flake. See
   * oceanFishSkinTexture.ts.
   */
  photophores?: boolean | PhotophoreDot[];
  /** One or two extra glowing points, additive to `photophores` — see FishSkinOptions.extraPoints. */
  extraPoints?: PhotophoreDot[];
  /** Periodic dark seams baked into the albedo — see FishSkinOptions.bands. Only the isopod uses this. */
  bands?: number;
  /**
   * Overrides the hardcoded teal every non-nearField species otherwise
   * shares. `undefined` keeps that default; `null` opts a species (fangtooth)
   * out of the ambient glow wash entirely. See oceanRig.ts.
   */
  glowColor?: string | null;
  /** Defaults to 0.44 — ultra-black deep-sea skin (fangtooth) wants this much higher, so it doesn't render glossy. */
  roughness?: number;
  /** Defaults to 0.3. */
  metalness?: number;
  /** Rides a rotating bait-ball instead of a flat ring. See VortexStyle. */
  vortex?: VortexStyle;
  /** A threat: fleesPredators schools bias away from its leaders' positions. */
  predator?: boolean;
  /** Biases its leaders away from the nearest predator school's leaders. */
  fleesPredators?: boolean;
  /** Metres at which alarm reaches its maximum. Default: max(16, pathRadius*0.9). */
  fleeRadiusMetres?: number;
  /** Flash-expansion strength: members fan outward as alarm rises. 0 (default) is leader-swerve only. */
  fleeFanOut?: number;
  /** Cruise-speed multiplier while alarmed — the startled dash, on top of speedScale. */
  burstSpeedScale?: number;
  /** Periodically detours a leader toward the camera, then eases back to its ring. */
  approachesCamera?: boolean;
  /** How close the detour brings it, in metres. Default 6. */
  approachDistanceMetres?: number;
  /** Seconds per approach-and-retreat cycle. Default 34 (off the dolphin's 26s breathing cycle). */
  approachCycleSeconds?: number;
};

/**
 * Who lives where, and how they move. Zones are real: a goblin shark has been
 * filmed between 900 and 1300 m, a lionfish is a reef ambusher, and a manta is
 * an epipelagic filter feeder. Nothing here is a mood.
 */
export const OCEAN_RIG_SPECIES: readonly FaunaSpecies[] = [
  {
    key: "butterflyfish",
    color: "#F0C24A",
    nearField: true,
    body: "reefFish",
    file: "fauna-butterfly-fish.glb",
    label: "butterflyfish",
    swim: { onset: 0.74, amplitude: 0.05, waves: 0.9, beat: 3.4 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 60,
    needsSeafloor: true,
    count: 130,
    leaders: 6,
    size: 0.34,
    spread: 3.4,
    pathRadius: 16,
    heightBase: -6,
    heightRange: 5,
    // An unhurried reef grazer — same baseline every other unset species used
    // to share, now distinguished from the livelier small schoolers below.
    speedScale: 0.8,
    // Shares this depth band with the reef shark, barracuda and orca — a
    // grazing school with zero reaction to a predator overhead was the most
    // visible case of "every fish just orbits" the roster still had.
    fleesPredators: true,
    fleeFanOut: 0.4,
    burstSpeedScale: 1.3,
  },
  {
    key: "lionfish",
    color: "#B8642F",
    nearField: true,
    body: "reefFish",
    file: "fauna-lionfish.glb",
    label: "lionfish",
    // Lionfish hover on their pectorals, so the body wave is nearly nothing.
    swim: { onset: 0.8, amplitude: 0.035, waves: 0.5, beat: 1.4 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 70,
    needsSeafloor: true,
    count: 9,
    leaders: 9,
    size: 0.52,
    spread: 1,
    pathRadius: 15,
    heightBase: -6,
    heightRange: 4,
    speedScale: 0.22,
    tightRing: true,
  },
  {
    key: "turbot",
    color: "#8C7F5C",
    body: "reefFish",
    file: "fauna-turbot.glb",
    label: "turbot",
    // A flatfish on sand does not swim; the motion is a ripple down the margin.
    swim: { onset: 0.35, amplitude: 0.025, waves: 1.6, beat: 0.9 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 400,
    needsSeafloor: true,
    count: 14,
    leaders: 14,
    size: 0.7,
    spread: 1,
    pathRadius: 26,
    heightBase: -1.2,
    heightRange: 1.4,
    speedScale: 0.04,
    tightRing: true,
  },
  {
    key: "shark",
    color: "#8794A0",
    body: "shark",
    file: "fauna-shark.glb",
    label: "reef shark",
    // Thunniform: rigid forebody, all the work at the peduncle.
    swim: { onset: 0.82, amplitude: 0.07, waves: 0.5, beat: 1.5 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 400,
    count: 6,
    leaders: 6,
    size: 3.4,
    spread: 1,
    pathRadius: 68,
    heightBase: -4,
    heightRange: 11,
    tightRing: true,
    // A reef shark cruises, it doesn't hurry — slower than the default every
    // unset species used to share.
    speedScale: 0.8,
    // The one predator whose leaders' positions prey schools react to.
    predator: true,
    // Occasionally breaks its ring to close on the lens, then eases back —
    // the "swims close, then peels away" the flat orbit could never do alone.
    approachesCamera: true,
  },
  {
    key: "swordfish",
    color: "#5A6470",
    body: "shark",
    file: "fauna-swordfish.glb",
    label: "swordfish",
    swim: { onset: 0.88, amplitude: 0.045, waves: 0.4, beat: 2.4 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 250,
    count: 5,
    leaders: 5,
    size: 2.6,
    spread: 1,
    pathRadius: 64,
    heightBase: -7,
    heightRange: 11,
    speedScale: 1.5,
    tightRing: true,
    // The open-water counterpart to the reef shark: also a threat prey reacts to.
    predator: true,
  },
  {
    key: "manta",
    color: "#39424C",
    body: "manta",
    file: "fauna-manta-ray.glb",
    label: "manta",
    // Mobuliform: dorsoventral pectoral flapping, thrust peaking near 1 Hz and
    // efficiency near 0.8. The body axis barely moves — bending a manta along
    // its length is the one tell that turns it into a swimming carpet.
    swim: { onset: 0, amplitude: 0.34, waves: 0.4, beat: 0.42, mobuliform: true, span: 0.37 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 220,
    count: 3,
    leaders: 3,
    size: 4.2,
    spread: 1,
    pathRadius: 76,
    heightBase: -6,
    heightRange: 11,
    speedScale: 0.55,
    tightRing: true,
    // The other personality species besides the reef shark — a manta gliding
    // close past the lens before easing back out is one of the signature
    // shots of any real manta encounter. Its own cycle length (41s) so it
    // never syncs with the shark's (34s) or the dolphin's below (29s).
    approachesCamera: true,
    approachDistanceMetres: 8,
    approachCycleSeconds: 41,
  },
  {
    key: "dolphin",
    color: "#A9B9C4",
    body: "dolphin",
    file: "fauna-dolphin.glb",
    label: "dolphin pod",
    swim: { onset: 0.74, amplitude: 0.075, waves: 0.45, beat: 1.25, vertical: true },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 90,
    needsSurface: true,
    count: 11,
    leaders: 3,
    size: 2.6,
    spread: 6.5,
    pathRadius: 58,
    heightBase: -4,
    heightRange: 8,
    tightRing: true,
    surfacing: true,
    speedScale: 1.1,
    // Real dolphins are famously curious about anything large moving through
    // their water — the one behaviour on this list with a documented reason
    // to target the viewer specifically, not just the origin.
    approachesCamera: true,
    approachDistanceMetres: 5,
    approachCycleSeconds: 29,
  },
  {
    key: "whale",
    color: "#5D6E7A",
    body: "whale",
    file: "fauna-whale.glb",
    label: "whale",
    // Beat frequency falls with size: a calf beats four to seven times as often
    // as its mother at the same speed.
    swim: { onset: 0.62, amplitude: 0.045, waves: 0.4, beat: 0.28, vertical: true },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 320,
    count: 1,
    leaders: 1,
    size: 13,
    spread: 1,
    pathRadius: 118,
    heightBase: -9,
    heightRange: 10,
    speedScale: 0.3,
    tightRing: true,
  },
  {
    key: "goblinShark",
    color: "#6A6F78",
    body: "shark",
    file: "fauna-goblin-shark.glb",
    label: "goblin shark",
    swim: { onset: 0.55, amplitude: 0.1, waves: 0.75, beat: 0.85 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 700,
    maxDepthMetres: 4000,
    count: 2,
    leaders: 2,
    size: 3.1,
    spread: 1,
    pathRadius: 44,
    heightBase: -6,
    heightRange: 9,
    speedScale: 0.3,
    tightRing: true,
    // Shares the twilight/abyss with lanternfish — a threat there too.
    predator: true,
  },
  {
    key: "blobfish",
    color: "#A88079",
    body: "reefFish",
    file: "fauna-blobfish.glb",
    label: "blobfish",
    // At depth it is an ordinary-looking fish; it is only a blob at the surface,
    // where decompression has ruined it.
    swim: { onset: 0.6, amplitude: 0.02, waves: 0.5, beat: 0.45 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 550,
    maxDepthMetres: 4000,
    needsSeafloor: true,
    count: 7,
    leaders: 7,
    size: 0.62,
    spread: 1,
    pathRadius: 20,
    heightBase: -4,
    heightRange: 3,
    speedScale: 0.05,
    tightRing: true,
  },
  // ---- the four the rig never had ----------------------------------------
  // No GLB exists for any of these, which is exactly why they were missing: while
  // a model file was mandatory they could not be declared at all. They are also
  // the four that carry the population — 2044 of the rig's animals — so their
  // absence is the single largest visual difference from the prototype.
  {
    key: "silversides",
    color: "#DCEEF5",
    body: "reefFish",
    label: "silversides",
    // The schooling default: the posterior 30-50% of the body undulates.
    swim: { onset: 0.6, amplitude: 0.08, waves: 0.7, beat: 2.8 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 90,
    needsSeafloor: true,
    // The largest school in the rig by an order of magnitude. A reef without one
    // is a diorama: this is the shimmering cloud that makes the water feel
    // occupied, and it is one InstancedMesh.
    count: 1400,
    leaders: 9,
    size: 0.3,
    spread: 8,
    pathRadius: 19,
    heightBase: -6,
    heightRange: 15,
    // A lively flicker, not the same baseline every unset species used to share.
    speedScale: 1.35,
    // A real bait ball: the mass clusters onto one drifting axis and spirals it,
    // instead of scattering loosely around the whole ring.
    vortex: { radius: 5, spinHertz: 0.12, taper: 1.4 },
    fleesPredators: true,
    fleeFanOut: 0.5,
    burstSpeedScale: 1.6,
  },
  {
    key: "anthias",
    color: "#FF7A33",
    nearField: true,
    body: "reefFish",
    label: "anthias",
    swim: { onset: 0.6, amplitude: 0.08, waves: 0.7, beat: 2.8 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 90,
    needsSeafloor: true,
    // Tight, close and orange. On a reef this is the only saturated warm colour
    // the water has not taken, which is why it rides the smallest path radius in
    // the rig: near-field colour only survives at near-field distance.
    count: 340,
    leaders: 5,
    size: 0.24,
    spread: 3.2,
    pathRadius: 13,
    heightBase: -7,
    heightRange: 6,
    speedScale: 1.25,
    // A second bait ball, tighter than silversides' — anthias hover in dense
    // clouds right over reef structure, not a loose ring.
    vortex: { radius: 3.5, spinHertz: 0.16, taper: 1.3 },
    fleesPredators: true,
    burstSpeedScale: 1.5,
  },
  {
    key: "lanternfish",
    color: "#1E2A33",
    body: "lanternfish",
    label: "lanternfish",
    photophores: true,
    swim: { onset: 0.35, amplitude: 0.09, waves: 0.9, beat: 2.2 },
    bodyAxis: "long",
    head: 1,
    // Myctophids are THE mesopelagic fish and the most abundant vertebrate on
    // Earth. They are the entire reason the twilight zone is not an empty box —
    // which is precisely what it rendered as without them.
    minDepthMetres: 70,
    maxDepthMetres: 4000,
    count: 300,
    leaders: 9,
    size: 0.3,
    spread: 7.5,
    pathRadius: 30,
    heightBase: -8,
    heightRange: 22,
    speedScale: 1.2,
    // Myctophids form the densest scattering layer in the ocean — a fourth
    // bait ball, the largest radius of the four since this school also rides
    // the widest pathRadius.
    vortex: { radius: 7, spinHertz: 0.08, taper: 1.5 },
    fleesPredators: true,
    burstSpeedScale: 1.4,
  },
  {
    key: "anglerfish",
    color: "#161C22",
    body: "anglerfish",
    // Quaternius via Poly Pizza — the same pack the other twelve GLBs came
    // from, found on a later pass than the one that shipped the procedural
    // body. It keeps the illicium and its glowing esca (see the `anglerfish`
    // body factory's own comment on why that detail is the point) and adds
    // the bulbous eyes and teeth a 13-segment procedural silhouette cannot.
    // The procedural body is still what renders before this loads.
    file: "fauna-anglerfish.glb",
    label: "anglerfish",
    swim: { onset: 0.5, amplitude: 0.05, waves: 0.6, beat: 0.7 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 480,
    maxDepthMetres: 11000,
    // Four, moving almost not at all. A sit-and-wait ambush predator that swam
    // laps would be a different animal, and the esca is the point: a light source
    // in the abyss that is also a character.
    count: 4,
    leaders: 4,
    size: 0.85,
    spread: 1,
    pathRadius: 17,
    heightBase: -4,
    heightRange: 8,
    speedScale: 0.06,
    tightRing: true,
  },
  // ---- thirteen more, none of them found free anywhere (see ATTRIBUTION.md) ---
  // Every one below is procedural only — no file — for the same reason the
  // four above were: no CC0 model exists for any of them, so the choice was
  // never "download or draw", it was "draw or omit the species entirely".
  {
    key: "barracuda",
    color: "#9AA5AC",
    body: "shark",
    label: "barracuda",
    swim: { onset: 0.8, amplitude: 0.06, waves: 0.5, beat: 1.8 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 100,
    count: 5,
    leaders: 5,
    size: 1.8,
    spread: 1,
    pathRadius: 55,
    heightBase: -5,
    heightRange: 10,
    speedScale: 1.0,
    tightRing: true,
    // Another threat prey reacts to, alongside the reef shark and swordfish.
    predator: true,
  },
  {
    key: "orca",
    color: "#12161A",
    body: "dolphin",
    label: "orca pod",
    // A cetacean, bigger and slower-beating than the dolphin pod at the same
    // size scale — beat frequency falls with size. The existing counter-
    // shading (dark back, bright belly) already fakes an orca's cape/underside
    // pattern for free from a near-black base colour, with no new code.
    swim: { onset: 0.62, amplitude: 0.06, waves: 0.42, beat: 0.5, vertical: true },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 200,
    needsSurface: true,
    count: 5,
    leaders: 2,
    size: 7,
    spread: 5,
    pathRadius: 85,
    heightBase: -6,
    heightRange: 9,
    speedScale: 0.9,
    tightRing: true,
    surfacing: true,
    predator: true,
  },
  {
    key: "clownfish",
    color: "#FF6B35",
    nearField: true,
    body: "reefFish",
    label: "clownfish",
    swim: { onset: 0.78, amplitude: 0.04, waves: 0.6, beat: 2.2 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 15,
    needsSeafloor: true,
    count: 60,
    leaders: 6,
    size: 0.11,
    spread: 2,
    pathRadius: 10,
    heightBase: -6,
    heightRange: 3,
    speedScale: 1.1,
    fleesPredators: true,
    fleeFanOut: 0.4,
    burstSpeedScale: 1.3,
  },
  {
    key: "pufferfish",
    color: "#C9A227",
    body: "reefFish",
    label: "pufferfish",
    // A round body at rest, not the alarmed sphere — the same compromise
    // blobfish already accepts from this same archetype.
    swim: { onset: 0.65, amplitude: 0.02, waves: 0.5, beat: 0.6 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 30,
    needsSeafloor: true,
    count: 8,
    leaders: 8,
    size: 0.3,
    spread: 1,
    pathRadius: 14,
    heightBase: -5,
    heightRange: 4,
    speedScale: 0.15,
    tightRing: true,
    fleesPredators: true,
    burstSpeedScale: 1.3,
  },
  {
    key: "viperfish",
    color: "#141A20",
    body: "viperfish",
    label: "viperfish",
    // Paired body rows like a myctophid, plus one extra point at the lure's
    // tip (u = 0.5, matching every fin's own convention; v = 0.08 matches the
    // viperfish archetype's lure fin `along`).
    photophores: true,
    extraPoints: [{ u: 0.5, v: 0.08, radius: 0.024 }],
    swim: { onset: 0.5, amplitude: 0.1, waves: 0.8, beat: 1.1 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 200,
    maxDepthMetres: 2000,
    count: 5,
    leaders: 5,
    size: 0.35,
    spread: 1.5,
    pathRadius: 26,
    heightBase: -8,
    heightRange: 16,
    speedScale: 0.5,
    fleesPredators: true,
    tightRing: true,
  },
  {
    key: "blackDragonfish",
    color: "#12181C",
    body: "dragonfish",
    label: "black dragonfish",
    // Broader, scattered rows rather than the strict two-row myctophid
    // pattern — real Idiacanthus carries photophores over most of the body.
    // The chin barbel's tip is the one extra point (along = 0.06 there).
    photophores: [
      { u: 0.62, v: 0.2 }, { u: 0.62, v: 0.4 }, { u: 0.62, v: 0.6 }, { u: 0.62, v: 0.8 },
      { u: 0.75, v: 0.15 }, { u: 0.75, v: 0.35 }, { u: 0.75, v: 0.55 }, { u: 0.75, v: 0.75 },
      { u: 0.88, v: 0.25 }, { u: 0.88, v: 0.45 }, { u: 0.88, v: 0.65 },
    ],
    extraPoints: [{ u: 0.5, v: 0.06, radius: 0.022 }],
    // Notably RED, not the teal every other deep species here carries — real
    // Idiacanthus light is red, invisible to almost everything else down
    // there, which is the whole point of it as a private searchlight.
    glowColor: "#FF3322",
    swim: { onset: 0.48, amplitude: 0.1, waves: 0.8, beat: 1.0 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 200,
    maxDepthMetres: 2000,
    count: 5,
    leaders: 5,
    size: 0.4,
    spread: 1.5,
    pathRadius: 28,
    heightBase: -9,
    heightRange: 18,
    speedScale: 0.45,
    tightRing: true,
  },
  {
    key: "fangtooth",
    color: "#0D0F12",
    body: "fangtooth",
    label: "fangtooth",
    // Confirmed non-bioluminescent — relies on ultra-black, light-trapping
    // skin instead, which is why this opts all the way OUT of the faint
    // ambient wash every other deep species otherwise carries, and why it
    // needs a rougher, non-metallic material: a light-trapping surface reads
    // as matte, not as polished plastic.
    glowColor: null,
    roughness: 0.88,
    metalness: 0.02,
    swim: { onset: 0.62, amplitude: 0.04, waves: 0.55, beat: 0.8 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 500,
    maxDepthMetres: 5000,
    count: 4,
    leaders: 4,
    size: 0.16,
    spread: 1,
    pathRadius: 16,
    heightBase: -5,
    heightRange: 6,
    speedScale: 0.2,
    tightRing: true,
  },
  {
    key: "gulperEel",
    color: "#171310",
    body: "gulperEel",
    label: "gulper eel",
    // Anguilliform: almost the whole body undulates, slowly — a huge gape on
    // a whip is not a fish that darts.
    swim: { onset: 0.3, amplitude: 0.12, waves: 1.0, beat: 0.6 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 500,
    maxDepthMetres: 3000,
    count: 3,
    leaders: 3,
    size: 0.8,
    spread: 1,
    pathRadius: 22,
    heightBase: -6,
    heightRange: 8,
    speedScale: 0.15,
    tightRing: true,
  },
  {
    key: "hatchetfish",
    color: "#C8D8DE",
    body: "hatchetfish",
    label: "hatchetfish",
    // Real hatchetfish ventral counter-illumination is anatomically close
    // enough to the myctophid pattern to reuse it verbatim.
    photophores: true,
    swim: { onset: 0.58, amplitude: 0.08, waves: 0.75, beat: 2.6 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 200,
    maxDepthMetres: 1200,
    count: 150,
    leaders: 7,
    size: 0.1,
    spread: 4,
    pathRadius: 22,
    heightBase: -7,
    heightRange: 10,
    speedScale: 1.1,
    // A third bait ball — real hatchetfish aggregate densely in the twilight
    // scattering layer rather than spreading around an open ring.
    vortex: { radius: 5.5, spinHertz: 0.11, taper: 1.4 },
    fleesPredators: true,
  },
  {
    key: "giantOarfish",
    color: "#D9E4E8",
    body: "ribbon",
    label: "giant oarfish",
    // Real oarfish locomotion is a dorsal-fin wave with the body held nearly
    // straight; this rig only has a lateral body wave, so a gentle, mostly-
    // whole-body ripple (low onset, many waves, slow beat) is the closest
    // approximation available without a second locomotion model.
    swim: { onset: 0.15, amplitude: 0.05, waves: 1.3, beat: 0.5 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 20,
    maxDepthMetres: 1000,
    count: 1,
    leaders: 1,
    size: 8,
    spread: 1,
    pathRadius: 100,
    heightBase: -10,
    heightRange: 15,
    speedScale: 0.15,
    tightRing: true,
  },
  {
    key: "giantIsopod",
    color: "#C9A38C",
    body: "isopod",
    label: "giant isopod",
    // Periodic dark seams suggest tergite-plate boundaries on what is
    // otherwise an ordinary body-of-revolution mesh — see FishSkinOptions.bands.
    bands: 7,
    needsSeafloor: true,
    // A scavenger that barely moves at all.
    swim: { onset: 0.7, amplitude: 0.02, waves: 0.6, beat: 0.3 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 200,
    maxDepthMetres: 2500,
    count: 4,
    leaders: 4,
    size: 0.5,
    spread: 1,
    pathRadius: 14,
    heightBase: -1,
    heightRange: 1,
    speedScale: 0.03,
    tightRing: true,
  },
  // ---- the cephalopods: a genuinely new body, not a parameter variation ----
  {
    key: "giantSquid",
    color: "#5A5F6A",
    body: "decapod",
    file: "fauna-giant-squid-scan.glb",
    label: "giant squid",
    // Rigid mantle (along 0-0.7), whippy trailing arm crown (0.7-1.0) and two
    // long feeding tentacles overshooting even that (0.75-1.15) on the
    // PROCEDURAL decapod archetype (buildCephalopod in oceanRigBodies.ts) —
    // onset sits right where that mantle hands off to the arms. amplitude is
    // far above the procedural archetype's 0.12 because the real scan's arms
    // are a denser, thicker mass at the same along-value band than that
    // archetype's thin, well-separated tentacle strands (which read a
    // whip-crack off a small angular swing): measured empirically via an a/b
    // screenshot diff, 0.12 produced zero visible tentacle motion on the
    // scan, 0.55 is the smallest value that reads as a clear, natural sway.
    swim: { onset: 0.68, amplitude: 0.55, waves: 0.5, beat: 0.35 },
    bodyAxis: "long",
    // The real scan's mantle and arm crown measure bulkier-by-radius at the
    // arm end (splayed tentacles read wider than the tapered mantle to the
    // eye/bulk heuristic in normaliseModel) — -1 flips it so the mantle leads.
    head: -1,
    minDepthMetres: 300,
    maxDepthMetres: 2000,
    count: 1,
    leaders: 1,
    size: 11,
    spread: 1,
    pathRadius: 46,
    heightBase: -8,
    heightRange: 12,
    speedScale: 0.2,
    tightRing: true,
    // A real apex predator of the deep, sharing the twilight reach with
    // viperfish and black dragonfish (both already fleesPredators).
    predator: true,
  },
  {
    key: "vampireSquid",
    color: "#2A1E3A",
    body: "octopod",
    label: "vampire squid",
    // Blue photophores at the arm tips and the fin bases — real
    // Vampyroteuthis anatomy, not the myctophid two-row pattern. One dot at
    // each position is enough: every arm shares the same UV strip (see
    // buildCephalopod/tentacleGeometry in oceanRigBodies.ts), so a single dot
    // at the tip's v already repeats across all eight arms on its own.
    photophores: [{ u: 0.5, v: 0.95, radius: 0.12 }],
    extraPoints: [{ u: 0.5, v: 0.32, radius: 0.05 }],
    glowColor: "#4C8CFF",
    swim: { onset: 0.68, amplitude: 0.1, waves: 0.45, beat: 0.4 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 600,
    maxDepthMetres: 3000,
    count: 1,
    leaders: 1,
    size: 0.3,
    spread: 1,
    pathRadius: 20,
    heightBase: -7,
    heightRange: 9,
    speedScale: 0.25,
    tightRing: true,
  },
  // ---- three the plan had deferred, now cheap enough to add ----------------
  // The plan's own reasoning for deferring these: angelfish was "redundant
  // with clownfish/butterflyfish this pass" (still true — added anyway since
  // it costs nothing beyond a new entry on the SAME reefFish archetype); the
  // two extra octopuses were "cheap follow-ons once octopod exists" (it now
  // does, from vampireSquid above) rather than needing new geometry.
  {
    key: "angelfish",
    color: "#F5D94E",
    nearField: true,
    body: "reefFish",
    label: "angelfish",
    swim: { onset: 0.72, amplitude: 0.05, waves: 0.85, beat: 2.6 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 40,
    needsSeafloor: true,
    count: 20,
    leaders: 5,
    size: 0.28,
    spread: 1.6,
    pathRadius: 12,
    heightBase: -6,
    heightRange: 4,
    speedScale: 0.85,
    fleesPredators: true,
    fleeFanOut: 0.4,
    burstSpeedScale: 1.3,
  },
  {
    key: "giantPacificOctopus",
    color: "#B85C3C",
    body: "octopod",
    file: "fauna-giant-pacific-octopus.glb",
    label: "giant Pacific octopus",
    // Reef-dwelling and solitary, unlike the abyssal vampire squid this
    // archetype was built for — reddish-brown instead of deep violet, no
    // photophores (a reef predator with no reason to bioluminesce), and a
    // near-field colour the way lionfish/blobfish already are at this depth.
    nearField: true,
    // amplitude raised well above the 0.09 the procedural octopod archetype
    // used — same reason as the giant squid above: the real scan's arms are
    // a denser mass at the same along-value band than the archetype's thin
    // separated legs, so the old value produced no visible arm motion at all.
    swim: { onset: 0.66, amplitude: 0.4, waves: 0.45, beat: 0.5 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 80,
    needsSeafloor: true,
    count: 2,
    leaders: 2,
    size: 3.5,
    spread: 1,
    pathRadius: 12,
    heightBase: -1.5,
    heightRange: 1.5,
    speedScale: 0.12,
    tightRing: true,
  },
  {
    key: "dumboOctopus",
    color: "#D8A6C4",
    body: "octopod",
    label: "dumbo octopus",
    // The deepest-living octopus known (Grimpoteuthis, filmed below 4000 m) —
    // pale pink, tiny, and drifts more than it swims.
    swim: { onset: 0.7, amplitude: 0.05, waves: 0.4, beat: 0.3 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 1000,
    maxDepthMetres: 7000,
    count: 3,
    leaders: 3,
    size: 0.25,
    spread: 1,
    pathRadius: 18,
    heightBase: -6,
    heightRange: 8,
    speedScale: 0.08,
    tightRing: true,
  },
  {
    key: "seaTurtle",
    color: "#4C7A4A",
    body: "turtle",
    label: "sea turtle",
    // Front-flipper "flying" propulsion, not lateral body undulation at all —
    // real turtles barely bend the shell. The mobuliform path already built
    // for the manta's dorsoventral flap reused verbatim: span picks out the
    // flippers (large |x|) and leaves the near-zero-x shell almost still,
    // an approximation (no cited beat frequency — assumption, not sourced)
    // rather than a new locomotion mode.
    swim: { onset: 0, amplitude: 0.14, waves: 0.3, beat: 0.45, mobuliform: true, span: 0.58 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 60,
    needsSurface: true,
    count: 3,
    leaders: 3,
    size: 1.1,
    spread: 1,
    pathRadius: 24,
    heightBase: -5,
    heightRange: 6,
    speedScale: 0.35,
    tightRing: true,
    surfacing: true,
  },
  {
    key: "seahorse",
    color: "#C9973E",
    nearField: true,
    body: "seahorse",
    label: "seahorse",
    needsSeafloor: true,
    // Onset sits right at the head/trunk seam (see buildSeahorse's
    // HEAD_ALONG_SPAN) so the head — and the dorsal fin riding just behind it
    // — stays nearly still, the way a real seahorse holds its head steady
    // while the trunk and tail do the sculling and curling.
    swim: { onset: 0.28, amplitude: 0.08, waves: 0.55, beat: 0.45 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 20,
    count: 6,
    leaders: 6,
    size: 0.15,
    spread: 1,
    pathRadius: 9,
    heightBase: -5,
    heightRange: 3,
    speedScale: 0.08,
    tightRing: true,
  },
];

type MergedPart = { geometry: BufferGeometry; color: Color };

function mergeParts(parts: MergedPart[]): BufferGeometry {
  let total = 0;
  for (const part of parts) total += part.geometry.getAttribute("position").count;
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const color = new Float32Array(total * 3);
  let cursor = 0;
  for (const part of parts) {
    const p = part.geometry.getAttribute("position");
    const n = part.geometry.getAttribute("normal");
    // A part with its own baked COLOR_0 (a photogrammetry scan) carries real
    // per-vertex detail; a part with none (every hand-modelled toon GLB) falls
    // back to its flat material color, exactly as before.
    const c = part.geometry.getAttribute("color");
    for (let i = 0; i < p.count; i += 1) {
      const o = (cursor + i) * 3;
      position[o] = p.getX(i);
      position[o + 1] = p.getY(i);
      position[o + 2] = p.getZ(i);
      if (n) {
        normal[o] = n.getX(i);
        normal[o + 1] = n.getY(i);
        normal[o + 2] = n.getZ(i);
      }
      if (c) {
        color[o] = c.getX(i);
        color[o + 1] = c.getY(i);
        color[o + 2] = c.getZ(i);
      } else {
        color[o] = part.color.r;
        color[o + 1] = part.color.g;
        color[o + 2] = part.color.b;
      }
    }
    cursor += p.count;
  }
  const merged = new BufferGeometry();
  merged.setAttribute("position", new BufferAttribute(position, 3));
  merged.setAttribute("normal", new BufferAttribute(normal, 3));
  merged.setAttribute("color", new BufferAttribute(color, 3));
  return merged;
}

export type NormalisedModel = {
  geometry: BufferGeometry;
  /** 0.17 / half-height: what the counter-shading gradient has to be scaled by. */
  bellyScale: number;
  triangles: number;
  /** True when the eye or the cross-section agrees with the declaration. */
  orientationAgrees: boolean;
};

/**
 * Fraction of triangles whose 3 vertex normals are NOT all identical — how
 * much real authored smoothing a merged, non-indexed geometry carries. 0
 * means every face is flat-shaded at the source (measured true for the shark
 * and dolphin GLBs; a mixed model like the butterfly-fish comes back well
 * above 0 and is left untouched).
 */
function smoothFaceFraction(geometry: BufferGeometry): number {
  const normal = geometry.getAttribute("normal");
  const triangleCount = Math.floor(normal.count / 3);
  if (triangleCount === 0) return 1;
  let smooth = 0;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let t = 0; t < triangleCount; t += 1) {
    const i = t * 3;
    a.set(normal.getX(i), normal.getY(i), normal.getZ(i));
    b.set(normal.getX(i + 1), normal.getY(i + 1), normal.getZ(i + 1));
    c.set(normal.getX(i + 2), normal.getY(i + 2), normal.getZ(i + 2));
    if (a.dot(b) < 0.999999 || b.dot(c) < 0.999999 || a.dot(c) < 0.999999) smooth += 1;
  }
  return smooth / triangleCount;
}

/**
 * Angle-weighted vertex-normal smoothing for a geometry confirmed flat-shaded
 * at the source: merges normals across coincident vertex positions, but only
 * within creaseAngleDeg of each other, so a genuinely hard edge (a fin's
 * leading edge, a tail fluke) stays hard while a body's tessellated
 * cross-section stops reading as faceted plates. Only ever invoked on
 * geometry with ~0% pre-existing smooth faces, so there is no authored
 * smoothing here to overwrite.
 */
function smoothFlatNormals(geometry: BufferGeometry, creaseAngleDeg = 55): void {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const count = position.count;
  const creaseCos = Math.cos((creaseAngleDeg * Math.PI) / 180);

  const buckets = new Map<string, number[]>();
  const quantize = (v: number) => Math.round(v * 100000);
  for (let i = 0; i < count; i += 1) {
    const key = `${quantize(position.getX(i))}:${quantize(position.getY(i))}:${quantize(position.getZ(i))}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(i);
    else buckets.set(key, [i]);
  }

  const result = new Float32Array(count * 3);
  const vertexNormal = new Vector3();
  const otherNormal = new Vector3();
  for (const indices of buckets.values()) {
    for (const i of indices) {
      vertexNormal.set(normal.getX(i), normal.getY(i), normal.getZ(i));
      const accumulator = vertexNormal.clone();
      for (const j of indices) {
        if (j === i) continue;
        otherNormal.set(normal.getX(j), normal.getY(j), normal.getZ(j));
        if (vertexNormal.dot(otherNormal) >= creaseCos) accumulator.add(otherNormal);
      }
      accumulator.normalize();
      const o = i * 3;
      result[o] = accumulator.x;
      result[o + 1] = accumulator.y;
      result[o + 2] = accumulator.z;
    }
  }
  geometry.setAttribute("normal", new BufferAttribute(result, 3));
}

/**
 * Put a loaded model into the frame every species entry was authored against:
 * one unit long, centred, nose at +Z, with `along` running 0 at the nose to 1 at
 * the tail — which is the direction the undulation envelope grows in.
 */
export function normaliseModel(source: BufferGeometry, species: FaunaSpecies): NormalisedModel {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  for (const name of ["uv", "uv1", "uv2", "tangent"]) {
    if (geometry.getAttribute(name)) geometry.deleteAttribute(name);
  }
  geometry.computeBoundingBox();
  const size = new Vector3();
  geometry.boundingBox?.getSize(size);

  const ranked: [("x" | "y" | "z"), number][] = [
    ["x", size.x],
    ["y", size.y],
    ["z", size.z],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  const bodyAxis = species.bodyAxis === "second" ? ranked[1]?.[0] : ranked[0]?.[0];
  if (bodyAxis && bodyAxis !== "z") {
    const matrix = new Matrix4();
    if (bodyAxis === "x") matrix.makeRotationY(Math.PI / 2);
    else matrix.makeRotationX(-Math.PI / 2);
    geometry.applyMatrix4(matrix);
    geometry.computeBoundingBox();
    geometry.boundingBox?.getSize(size);
  }

  const centre = new Vector3();
  geometry.boundingBox?.getCenter(centre);
  geometry.translate(-centre.x, -centre.y, -centre.z);
  geometry.scale(1 / size.z, 1 / size.z, 1 / size.z);

  const position = geometry.getAttribute("position");
  const colour = geometry.getAttribute("color");

  // The eye test. Ten of these models carry a separate near-black material for
  // the eyes, byte-identical across the set, and an eye is on the head.
  let eyeAlong = 0;
  let eyeCount = 0;
  if (colour) {
    for (let i = 0; i < colour.count; i += 1) {
      const luma = 0.2126 * colour.getX(i) + 0.7152 * colour.getY(i) + 0.0722 * colour.getZ(i);
      if (luma < 0.03) {
        eyeAlong += position.getZ(i);
        eyeCount += 1;
      }
    }
  }
  // Fallback for the four models with no eye material: a body tapers toward its
  // tail, so the half holding the thicker cross-section is the head half. MEANS,
  // not sums — summing lets tessellation vote, and the shark GLB carries far
  // more vertices in its fins than in its shoulders.
  let frontBulk = 0;
  let backBulk = 0;
  let frontCount = 0;
  let backCount = 0;
  for (let i = 0; i < position.count; i += 1) {
    const z = position.getZ(i);
    if (Math.abs(z) <= 0.06) continue;
    const radius = Math.hypot(position.getX(i), position.getY(i));
    if (z > 0) {
      frontBulk += radius;
      frontCount += 1;
    } else {
      backBulk += radius;
      backCount += 1;
    }
  }
  const measured =
    eyeCount > 24
      ? eyeAlong / eyeCount >= 0
        ? 1
        : -1
      : (frontCount ? frontBulk / frontCount : 0) >= (backCount ? backBulk / backCount : 0)
        ? 1
        : -1;

  if (species.head < 0) geometry.applyMatrix4(new Matrix4().makeRotationY(Math.PI));

  const along = new Float32Array(position.count);
  for (let i = 0; i < position.count; i += 1) {
    along[i] = Math.min(1, Math.max(0, 0.5 - position.getZ(i)));
  }
  geometry.setAttribute("along", new BufferAttribute(along, 1));
  // NOT a blanket computeVertexNormals: the model's own normals came through
  // the merge already transformed, and recomputing would replace real
  // authored smoothing with hard facets on every fin. But when a model has NO
  // smoothing to lose in the first place — measured directly below, not
  // assumed — flat facets are a pure downside, so those (and only those) get
  // angle-weighted smoothing instead.
  if (1 - smoothFaceFraction(geometry) > 0.98) {
    smoothFlatNormals(geometry);
  }
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const halfHeight = box ? Math.max(1e-3, (box.max.y - box.min.y) * 0.5) : 0.17;

  return {
    geometry,
    bellyScale: 0.17 / halfHeight,
    triangles: position.count / 3,
    orientationAgrees: measured === species.head,
  };
}

/**
 * Fetch and normalise this species' GLB, if it has one.
 *
 * Returns null rather than throwing for a species with no model, because having
 * no model is a normal state here, not a failure: the procedural body is already
 * on screen and correct.
 */
export async function loadSpeciesGeometry(species: FaunaSpecies): Promise<NormalisedModel | null> {
  if (!species.file) return null;
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(`${OCEAN_MODEL_BASE_PATH}/${species.file}`);
  gltf.scene.updateMatrixWorld(true);
  const parts: MergedPart[] = [];
  gltf.scene.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    for (const name of ["uv", "uv1", "uv2", "tangent", "skinIndex", "skinWeight"]) {
      if (geometry.getAttribute(name)) geometry.deleteAttribute(name);
    }
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const source =
      material && "color" in material && material.color instanceof Color
        ? material.color
        : new Color(1, 1, 1);
    parts.push({ geometry, color: source.clone() });
  });
  if (!parts.length) throw new Error(`ocean rig: ${species.file} has no meshes`);
  return normaliseModel(mergeParts(parts), species);
}

export type SchoolBounds = { surfaceY: number | null; floorY: number | null };

export type School = {
  species: FaunaSpecies;
  mesh: InstancedMesh;
  material: MeshStandardMaterial;
  bellyUniform: { value: number };
  spanUniform: { value: number };
  adopt: (model: NormalisedModel) => void;
  /**
   * Where the pod cruises relative to its authored height, and how far a breach
   * may pass the waterline. Both move when the viewer crosses the surface: from
   * above, the pod has to sink with the water or eleven dolphins swim in the
   * sky, and a breach becomes the point rather than an accident.
   */
  setSurfacing: (baseOffsetMetres: number, breachMetres: number) => void;
  /**
   * Where a predator school's leaders currently are — the SAME Vector3
   * instances update() mutates every frame, exposed once at construction so
   * reading them costs nothing per frame. Present only when species.predator
   * is true.
   */
  predatorAnchors?: readonly Vector3[];
  /**
   * threats: every predator school's leader positions, built once per frame
   * by the caller (see oceanRig.ts) — O(leaders), never O(members) or
   * O(schools²). cameraPosition: for the small opt-in list of
   * species.approachesCamera species. Both optional so a school with no
   * predators/camera-approach nearby costs nothing extra.
   */
  update: (elapsed: number, bounds: SchoolBounds, threats?: readonly Vector3[], cameraPosition?: Vector3) => void;
  dispose: () => void;
};

type Leader = {
  angle: number;
  radius: number;
  speed: number;
  height: number;
  bob: number;
  breathPhase: number;
  /** Drives the approachesCamera cycle — see FaunaSpecies.approachesCamera. */
  approachPhase: number;
  /** How close the nearest predator is, 0 (calm) to 1 (at the flee radius' edge or closer). */
  alarm: number;
  position: Vector3;
  heading: Vector3;
};

type Member = {
  leader: Leader;
  offset: Vector3;
  scale: number;
  wander: number;
  /** Set only for species.vortex members — see createSchool's member loop. */
  spiralPhase?: number;
  spiralRadius?: number;
};

const FORWARD = new Vector3(0, 0, 1);

/**
 * Max heading-turn rate, in radians/second. Grounded in two measured points
 * — bonnethead shark ~150 deg/s at ~1 m, Pacific bluefin tuna ~100-105 deg/s
 * at several metres (Hoffmann & Porter 2019; Downs et al. 2023) —
 * extrapolated to the rest of the roster with an inverse-size curve (smaller,
 * more maneuverable animals turn faster) since no measured figure exists for
 * this roster's other species. An explicit assumption for every species
 * except those two, not fabricated data.
 */
function turnRateRadPerSecFor(species: FaunaSpecies): number {
  const degPerSec = Math.min(500, Math.max(25, 150 * Math.pow(1 / Math.max(0.1, species.size), 0.4)));
  return (degPerSec * Math.PI) / 180;
}

/**
 * Rotates unit vector `current` toward unit vector `target` by at most
 * maxAngle radians, in place — the one and only place any leader's heading
 * changes, so no behaviour (flee, camera-approach, the ring itself) can ever
 * snap it instantly.
 */
function rotateTowards(current: Vector3, target: Vector3, maxAngle: number): void {
  const dot = Math.min(1, Math.max(-1, current.dot(target)));
  const theta = Math.acos(dot);
  if (theta < 1e-6) return;
  if (theta <= maxAngle) {
    current.copy(target);
    return;
  }
  const sinTheta = Math.sin(theta);
  if (sinTheta < 1e-6) {
    // Exactly (or almost exactly) opposite — no well-defined slerp axis for a
    // case that should only ever arise on a leader's very first frame.
    current.lerp(target, maxAngle / theta).normalize();
    return;
  }
  const t = maxAngle / theta;
  const a = Math.sin((1 - t) * theta) / sinTheta;
  const b = Math.sin(t * theta) / sinTheta;
  current.set(current.x * a + target.x * b, current.y * a + target.y * b, current.z * a + target.z * b).normalize();
}

/**
 * A school: one InstancedMesh, a handful of leaders on rings, and members that
 * ride in the leader's own frame so the shoal banks together instead of
 * shearing when the leader turns.
 */
export function createSchool(
  species: FaunaSpecies,
  seed: string,
  creatureTime: { value: number },
  visibilityMetres = Number.POSITIVE_INFINITY,
): School {
  // The body the school starts with, and for four species keeps forever. It used
  // to be a single-vertex placeholder with `visible = false`, which meant a
  // species was either upgraded to a GLB or never seen at all.
  const placeholder = bodyForArchetype(species.body);
  const material = new MeshStandardMaterial({
    color: new Color(species.color),
    roughness: species.roughness ?? 0.44,
    metalness: species.metalness ?? 0.3,
    side: DoubleSide,
    emissive: new Color("#000000"),
    emissiveIntensity: 0,
  });
  const bellyUniform = { value: 1 };
  const spanUniform = { value: species.swim.span ?? 0.5 };

  // A skin bake only for species with no GLB to adopt — a species with one
  // gets its texture from the model itself the moment `adopt()` runs, and a
  // bake it would discard within a frame or two is wasted canvas work.
  // material.color is left alone: the bake is a grey multiplier, not a
  // colour, so the near-field emissive copy below (which reads
  // material.color) still sees the species' real colour.
  const skinBake = species.file
    ? null
    : createFishSkinBake({
        seed,
        photophores: species.photophores,
        extraPoints: species.extraPoints,
        bands: species.bands,
      });
  if (skinBake) {
    material.map = skinBake.map;
    if (skinBake.emissiveMap) material.emissiveMap = skinBake.emissiveMap;
  }

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCreatureTime = creatureTime;
    shader.uniforms.uOnset = { value: species.swim.onset };
    shader.uniforms.uAmplitude = { value: species.swim.amplitude };
    shader.uniforms.uWaves = { value: species.swim.waves };
    shader.uniforms.uBeat = { value: species.swim.beat };
    shader.uniforms.uSpan = spanUniform;
    shader.uniforms.uBellyScale = bellyUniform;

    const axis = species.swim.mobuliform
      ? `// The wave runs across the SPAN and grows toward the wingtip.
         float span = clamp(abs(position.x) / uSpan, 0.0, 1.0);
         float flap = sin(uCreatureTime * uBeat * 6.2831853 + aPhase - span * uWaves * 6.2831853);
         transformed.y += flap * pow(span, 1.7) * uAmplitude;`
      : species.swim.vertical
        ? "transformed.y += lateral;   // a cetacean oscillates VERTICALLY"
        : "transformed.x += lateral;";

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
          uniform float uCreatureTime; uniform float uOnset; uniform float uAmplitude;
          uniform float uWaves; uniform float uBeat; uniform float uSpan;
          uniform float uBellyScale;
          attribute float along; attribute float aPhase;
          varying float vBelly; varying float vAlong;
          ${GLSL_UNDULATION}`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
          vBelly = position.y * uBellyScale;
          vAlong = along;
          float lateral = bodyLateralOffset(along, uOnset, uWaves, uAmplitude, uBeat, uCreatureTime, aPhase);
          ${axis}`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vBelly;\nvarying float vAlong;")
      // Counter-shading: dark back, bright belly. It is why a school reads as a
      // flicker of light rather than a cloud of identical objects.
      .replace(
        "#include <tonemapping_fragment>",
        "gl_FragColor.rgb *= mix(1.7, 0.72, smoothstep(-0.16, 0.16, vBelly));\n#include <tonemapping_fragment>",
      );
  };

  const mesh = new InstancedMesh(placeholder, material, species.count);
  mesh.castShadow = true;
  mesh.frustumCulled = false;

  const next = randomFromSeed(`${seed}:${species.key}`);
  const maxTurnRate = turnRateRadPerSecFor(species);
  const fleeRadius = species.fleeRadiusMetres ?? Math.max(16, species.pathRadius * 0.9);
  const phases = new Float32Array(species.count);
  const leaders: Leader[] = [];
  // THE RING IS CLAMPED TO WHAT THE WATER CAN ACTUALLY SHOW.
  //
  // `pathRadius` is authored in absolute metres — 118 for the whale, 76 for the
  // manta, 68 for the shark — and how far you can see is not. In Jerlov I the
  // sighting range is about 65 m, so at 142 m depth EVERY large animal in the
  // frame sat at or beyond the limit of visibility: the shark arrived at 34% of
  // its contrast and the whale at 4%, which is gone. What was left was three
  // hundred lanternfish 0.3 m long, and a frame whose only visible inhabitants
  // are 0.3 m long has no scale reference at all. It measured as a flat wash —
  // local detail 0.03 against the prototype's 0.10.
  //
  // Clamping to the range is the whole fix, and it is a statement about the
  // medium rather than a tuning choice: an animal further away than the water is
  // clear is not a distant animal, it is an absent one. Near-field species are
  // untouched — every ring under about 60 m already sits inside the budget — so
  // this only pulls in the four that were outside it, and their sizes differ by a
  // factor of four, so they still read as near and far.
  const ringLimit = Math.max(6, visibilityMetres);
  // A bait ball: leaders cluster onto ONE shared, drifting angle/radius
  // instead of scattering independently around the whole ring — see
  // FaunaSpecies.vortex and the member spiral below. Drawn once, before the
  // per-leader loop, so it costs nothing for the species that don't set it.
  const vortexAngle = species.vortex ? next() * Math.PI * 2 : 0;
  const vortexRadius = species.vortex ? Math.min(species.pathRadius, ringLimit) * (0.9 + next() * 0.1) : 0;
  for (let i = 0; i < species.leaders; i += 1) {
    // Same next() call count and order as before this loop was expanded to
    // seed position/heading up front — the shared seeded stream every member
    // below also draws from must not shift.
    const angle = species.vortex ? vortexAngle + (next() - 0.5) * 0.2 : next() * Math.PI * 2;
    const radius = species.vortex
      ? vortexRadius * (0.96 + next() * 0.08)
      : Math.min(species.pathRadius, ringLimit) * (species.tightRing ? 0.9 + next() * 0.25 : 0.35 + next() * 0.75);
    const speed = (0.05 + next() * 0.05) * (next() > 0.5 ? 1 : -1) * (species.speedScale ?? 1);
    const height = species.heightBase + next() * species.heightRange;
    leaders.push({
      angle,
      radius,
      speed,
      height,
      bob: next() * Math.PI * 2,
      breathPhase: next(),
      approachPhase: next(),
      alarm: 0,
      // Seeded on the ring immediately, not at the origin — the first real
      // update() call derives heading from displacement since the LAST
      // position, and starting at (0,0,0) would read that first frame as a
      // huge, meaningless jump outward from the world's centre.
      position: new Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius),
      heading: new Vector3(-Math.sin(angle) * Math.sign(speed), 0, Math.cos(angle) * Math.sign(speed)).normalize(),
    });
  }
  const members: Member[] = [];
  for (let i = 0; i < species.count; i += 1) {
    const leader = leaders[i % leaders.length];
    if (!leader) break;
    phases[i] = next() * Math.PI * 2;
    // The member's own belt around the vortex axis, tapered from the shared
    // radius by how far up/down the cone it sits — see FaunaSpecies.vortex.
    let spiralPhase: number | undefined;
    let spiralRadius: number | undefined;
    if (species.vortex) {
      const tierFraction = Math.abs(next() - 0.5) * 2;
      spiralPhase = next() * Math.PI * 2;
      spiralRadius = species.vortex.radius * Math.pow(1 - tierFraction, species.vortex.taper) * (0.85 + next() * 0.3);
    }
    members.push({
      leader,
      offset: new Vector3(
        (next() - 0.5) * species.spread,
        (next() - 0.5) * species.spread * 0.45,
        (next() - 0.5) * species.spread,
      ),
      scale: species.size * (0.82 + next() * 0.36),
      wander: next() * Math.PI * 2,
      spiralPhase,
      spiralRadius,
    });
  }
  placeholder.setAttribute("aPhase", new InstancedBufferAttribute(phases, 1));

  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const scaleVector = new Vector3();
  const right = new Vector3();
  const leaderTarget = new Vector3();
  const leaderDelta = new Vector3();
  let breachHeight = 0;
  let baseOffset = 0;
  let breach = -1.2;
  // update() receives absolute scene time, not a per-frame delta (it also
  // drives every sine-based cycle here directly) — this is the one place a
  // real per-frame dt gets derived from it, clamped so a backgrounded tab or
  // a first frame with elapsed already nonzero can't hand a leader a single
  // multi-second leap.
  let previousElapsed: number | null = null;
  // The GLB swap used to be `mesh.geometry = model.geometry` in one
  // synchronous assignment — every instance of a species changed shape in
  // the same frame the async fetch resolved, a visible snap. adopt() now
  // only stashes the model; update() (which already has `elapsed`) fades the
  // whole InstancedMesh to invisible, swaps the geometry while nothing is
  // shown, then fades back in — a fade-through rather than a real
  // cross-dissolve, but it costs nothing else in the rig: no other material
  // anywhere has to know this happens.
  let pendingAdoptModel: NormalisedModel | null = null;
  let adoptFadeStartElapsed: number | null = null;
  let adoptFadeSwapped = false;
  const ADOPT_FADE_HALF_SECONDS = 0.22;

  return {
    species,
    mesh,
    material,
    bellyUniform,
    spanUniform,
    setSurfacing: (baseOffsetMetres, breachMetres) => {
      baseOffset = baseOffsetMetres;
      breach = breachMetres;
    },
    predatorAnchors: species.predator ? leaders.map((leader) => leader.position) : undefined,
    adopt: (model) => {
      pendingAdoptModel = model;
    },
    update: (elapsed, bounds, threats, cameraPosition) => {
      // An animal lives BETWEEN the boundaries. The two numbers that decide what
      // is in frame decide where it can be — and this is not cosmetic: without
      // it a manta on a reef swims through the sky, and no frame metric can see
      // that, because every pixel is still in range.
      const clearance = Math.max(0.8, species.size * 0.6);
      const ceiling = bounds.surfaceY === null ? Infinity : bounds.surfaceY - clearance;
      const floorY = bounds.floorY === null ? -Infinity : bounds.floorY + clearance;
      const dt = previousElapsed === null ? 1 / 60 : Math.min(0.1, Math.max(0, elapsed - previousElapsed));
      previousElapsed = elapsed;

      if (pendingAdoptModel && adoptFadeStartElapsed === null) {
        adoptFadeStartElapsed = elapsed;
        material.transparent = true;
      }
      if (adoptFadeStartElapsed !== null) {
        const fadeElapsed = elapsed - adoptFadeStartElapsed;
        if (!adoptFadeSwapped && fadeElapsed >= ADOPT_FADE_HALF_SECONDS) {
          const model = pendingAdoptModel;
          if (model) {
            model.geometry.setAttribute("aPhase", new InstancedBufferAttribute(phases, 1));
            bellyUniform.value = model.bellyScale;
            if (species.swim.span) spanUniform.value = species.swim.span;
            // The palette is in the geometry now, so a tint would multiply it twice.
            material.vertexColors = true;
            material.color.setRGB(1, 1, 1);
            material.needsUpdate = true;
            const previous = mesh.geometry;
            mesh.geometry = model.geometry;
            previous.dispose();
          }
          adoptFadeSwapped = true;
        }
        const fadeTotal = ADOPT_FADE_HALF_SECONDS * 2;
        if (fadeElapsed >= fadeTotal) {
          material.opacity = 1;
          material.transparent = false;
          pendingAdoptModel = null;
          adoptFadeStartElapsed = null;
          adoptFadeSwapped = false;
        } else {
          material.opacity =
            fadeElapsed < ADOPT_FADE_HALF_SECONDS
              ? 1 - fadeElapsed / ADOPT_FADE_HALF_SECONDS
              : (fadeElapsed - ADOPT_FADE_HALF_SECONDS) / ADOPT_FADE_HALF_SECONDS;
        }
      }

      for (const leader of leaders) {
        // Cruise speed carries LAST frame's (already-smoothed) alarm as a
        // burst multiplier — a one-frame lag, invisible at 60fps, that avoids
        // restructuring this loop around alarm being computed further down.
        const speedMultiplier = 1 + leader.alarm * ((species.burstSpeedScale ?? 1) - 1);
        leader.angle += leader.speed * speedMultiplier * dt;
        let angle = leader.angle;
        let radius = leader.radius * (1 + Math.sin(leader.angle * 1.7 + leader.bob) * 0.14);
        let height = leader.height + Math.sin(elapsed * 0.24 + leader.bob) * species.heightRange * 0.3;
        height += baseOffset;
        height = Math.min(Math.max(height, floorY), ceiling);
        if (species.surfacing && bounds.surfaceY !== null) {
          // Dolphins surface every 20-40 s in ordinary activity. A pod rising to
          // breathe and sinking back is the most legible behaviour any animal in
          // this scene can perform.
          const cycle = ((elapsed / 26 + leader.breathPhase) % 1 + 1) % 1;
          const ascent = Math.pow(Math.sin(Math.PI * cycle), 3);
          height = height * (1 - ascent) + (bounds.surfaceY + breach) * ascent;
          breachHeight = Math.max(0, breach + clearance) * ascent;
        }
        // A scripted detour toward the camera, then back — reserved for a
        // short opt-in list (species.approachesCamera). This blends the
        // RENDERED angle/radius/height only, never the persistent
        // leader.angle, so once the envelope decays the leader is exactly
        // back on its ordinary ring with no separate "return" phase to author.
        if (species.approachesCamera && cameraPosition) {
          const cycleSeconds = species.approachCycleSeconds ?? 34;
          const cycle = ((elapsed / cycleSeconds + leader.approachPhase) % 1 + 1) % 1;
          const approach = Math.pow(Math.max(0, Math.sin(Math.PI * cycle)), 5);
          if (approach > 0.001) {
            const camAngle = Math.atan2(cameraPosition.z, cameraPosition.x);
            // The target radius is measured from ORIGIN, same as every other
            // leader position — so "approachDistanceMetres from the camera"
            // means the camera's own radius minus that gap, not the camera's
            // radius itself. Using the camera's radius directly (a prior bug
            // here) put the leader AT the camera's exact position once angle
            // and height finished converging too, which reads on screen as a
            // single fin plane filling the frame edge-on.
            const cameraRadius = Math.hypot(cameraPosition.x, cameraPosition.z);
            const camDist = Math.max(0, cameraRadius - (species.approachDistanceMetres ?? 6));
            let deltaAngle = camAngle - angle;
            deltaAngle -= Math.PI * 2 * Math.round(deltaAngle / (Math.PI * 2));
            angle += deltaAngle * approach;
            radius = radius * (1 - approach) + camDist * approach;
            height = height * (1 - approach) + cameraPosition.y * approach;
          }
        }
        leaderTarget.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);

        // Predator proximity: a continuous alarm from nearest-threat distance,
        // not a state machine — calm/alert/flee/calm falls out of the distance
        // curve alone. O(threats) per leader, never O(members) or O(schools²).
        // Measured against leaderTarget (this frame's ring position) rather
        // than leader.position (still last frame's), so a fast-closing threat
        // is judged by where the leader actually is now.
        let rawAlarm = 0;
        let awayX = 0;
        let awayZ = 0;
        let awayDist = 0;
        if (species.fleesPredators && threats && threats.length > 0) {
          let nearestDistSq = Infinity;
          for (const threat of threats) {
            const dx = leaderTarget.x - threat.x;
            const dz = leaderTarget.z - threat.z;
            const distSq = dx * dx + dz * dz;
            if (distSq < nearestDistSq) {
              nearestDistSq = distSq;
              awayX = dx;
              awayZ = dz;
            }
          }
          awayDist = Math.sqrt(nearestDistSq);
          rawAlarm = Math.min(1, Math.max(0, 1 - awayDist / fleeRadius));
        }
        // Smoothed, not snapped — a startle response is quick to trigger and
        // slower to stand down (attack ~4/s, release ~1.2/s), the same
        // fast-in/slow-out asymmetry the swim-speed literature found for
        // acceleration vs. deceleration (Akanyeti et al. 2018). This one
        // smoothed value now drives the burst-speed multiplier above, the
        // escape push below, AND (via the displacement-based heading below)
        // how fast the body turns to face away — a single source of truth
        // instead of three things that could each jump independently.
        const alarmRate = rawAlarm > leader.alarm ? 4 : 1.2;
        leader.alarm += (rawAlarm - leader.alarm) * Math.min(1, alarmRate * dt);
        if (leader.alarm > 1e-3 && awayDist > 1e-3) {
          const push = leader.alarm * fleeRadius * 0.6;
          leaderTarget.x += (awayX / awayDist) * push;
          leaderTarget.z += (awayZ / awayDist) * push;
        }

        // Heading follows the ACTUAL displacement this frame — the ring's
        // radial wobble, the camera-approach blend and the flee push all show
        // up here for free, instead of the old pure tangent-of-angle formula
        // that assumed a constant radius and ignored all three (the root
        // cause of fish appearing to slide sideways/backward while still
        // facing their old heading). Turn rate is capped so the body always
        // finishes turning toward where it's going before position gets
        // ahead of where the nose points, instead of snapping instantly.
        leaderDelta.copy(leaderTarget).sub(leader.position);
        if (leaderDelta.lengthSq() > 1e-10) {
          leaderDelta.normalize();
          rotateTowards(leader.heading, leaderDelta, maxTurnRate * dt);
        }
        leader.position.copy(leaderTarget);
      }

      for (let i = 0; i < members.length; i += 1) {
        const member = members[i];
        if (!member) continue;
        const leader = member.leader;
        // A bait ball: members spiral the vortex axis instead of riding a
        // fixed offset in the leader's frame. See FaunaSpecies.vortex.
        if (species.vortex && member.spiralRadius !== undefined) {
          const spiralAngle = (member.spiralPhase ?? 0) + elapsed * species.vortex.spinHertz * Math.PI * 2;
          const cosSpiral = Math.cos(spiralAngle);
          const sinSpiral = Math.sin(spiralAngle);
          position.copy(leader.position);
          position.x += cosSpiral * member.spiralRadius;
          position.z += sinSpiral * member.spiralRadius;
          position.y += member.offset.y;
          position.y = Math.min(position.y, ceiling + breachHeight);
          if (bounds.floorY !== null) position.y = Math.max(position.y, floorY);
          right.set(-sinSpiral, 0, cosSpiral);
          quaternion.setFromUnitVectors(FORWARD, right);
          scaleVector.setScalar(member.scale);
          matrix.compose(position, quaternion, scaleVector);
          mesh.setMatrixAt(i, matrix);
          continue;
        }
        const drift = Math.sin(elapsed * 0.7 + member.wander) * 0.25;
        // Flash-expansion: members fan outward from the leader's line as its
        // alarm rises — see FaunaSpecies.fleeFanOut. 1 (no fan-out) when unset.
        const fan = species.fleeFanOut ? 1 + leader.alarm * species.fleeFanOut : 1;
        position.copy(leader.position);
        right.set(leader.heading.z, 0, -leader.heading.x).normalize();
        position.addScaledVector(right, (member.offset.x + drift) * fan);
        position.y += member.offset.y;
        position.addScaledVector(leader.heading, member.offset.z * fan);
        position.y = Math.min(position.y, ceiling + breachHeight);
        if (bounds.floorY !== null) position.y = Math.max(position.y, floorY);
        quaternion.setFromUnitVectors(FORWARD, leader.heading);
        scaleVector.setScalar(member.scale);
        matrix.compose(position, quaternion, scaleVector);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose: () => {
      mesh.geometry.dispose();
      material.dispose();
      skinBake?.dispose();
    },
  };
}

/** Whether this animal can be where the viewer is. */
export function speciesIsPresent(
  species: FaunaSpecies,
  viewerDepthMetres: number,
  seafloorInSight: boolean,
  surfaceInSight: boolean,
): boolean {
  if (viewerDepthMetres < species.minDepthMetres) return false;
  if (viewerDepthMetres > species.maxDepthMetres) return false;
  if (species.needsSeafloor && !seafloorInSight) return false;
  if (species.needsSurface && !surfaceInSight) return false;
  return true;
}

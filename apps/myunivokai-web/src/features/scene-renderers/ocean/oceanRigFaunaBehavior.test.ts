import { BufferGeometry, Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createSchool, type FaunaSpecies, type NormalisedModel } from "./oceanRigFauna";

function testModel(): NormalisedModel {
  return { geometry: new BufferGeometry(), bellyScale: 1, triangles: 12, orientationAgrees: true };
}

/**
 * The vortex / predator-flee / camera-approach mechanics createSchool.update
 * layers onto the leader-and-members model. This is a NODE test environment
 * (no DOM), so every species here carries a `file` — real GLB or not, it is
 * never fetched by createSchool itself (only oceanRig.ts's loadSpeciesGeometry
 * does that) — purely to skip createFishSkinBake's `document.createElement`,
 * which the silversides/anthias/lanternfish species this behaviour actually
 * ships on would otherwise throw on outside a browser.
 */
function testSpecies(overrides: Partial<FaunaSpecies> = {}): FaunaSpecies {
  return {
    key: "test-species",
    file: "test.glb",
    body: "reefFish",
    color: "#FFFFFF",
    swim: { onset: 0.6, amplitude: 0.08, waves: 0.7, beat: 2.8 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 90,
    count: 12,
    leaders: 3,
    size: 0.3,
    spread: 2,
    pathRadius: 20,
    heightBase: -6,
    heightRange: 4,
    label: "test species",
    ...overrides
  };
}

const NO_BOUNDS = { surfaceY: null, floorY: null };

function memberPosition(mesh: { getMatrixAt: (index: number, target: Matrix4) => void }, index: number): Vector3 {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  const position = new Vector3();
  matrix.decompose(position, new Quaternion(), new Vector3());
  return position;
}

describe("createSchool's vortex formation", () => {
  it("spirals members around a shared axis instead of a fixed leader-frame offset", () => {
    const species = testSpecies({
      count: 20,
      leaders: 2,
      vortex: { radius: 4, spinHertz: 0.2, taper: 1.4 }
    });
    const school = createSchool(species, "vortex-seed", { value: 0 });
    school.update(0, NO_BOUNDS);
    const early = memberPosition(school.mesh, 0).clone();
    school.update(2.5, NO_BOUNDS);
    const later = memberPosition(school.mesh, 0).clone();
    // spinHertz=0.2 completes a full turn every 5s, so 2.5s is a half-turn —
    // the member must have actually moved, not sit frozen in the leader's frame.
    expect(early.distanceTo(later)).toBeGreaterThan(0.5);
    school.dispose();
  });

  it("spreads members at varied radii from the axis rather than one fixed ring", () => {
    const species = testSpecies({
      count: 30,
      leaders: 2,
      vortex: { radius: 4, spinHertz: 0.1, taper: 1.4 }
    });
    const school = createSchool(species, "vortex-seed-2", { value: 0 });
    school.update(1, NO_BOUNDS);
    const distances = Array.from({ length: 30 }, (_, index) => memberPosition(school.mesh, index));
    const radii = distances.map((position) => Math.hypot(position.x, position.z));
    const distinctRadii = new Set(radii.map((radius) => Math.round(radius * 100)));
    expect(distinctRadii.size).toBeGreaterThan(1);
    school.dispose();
  });
});

describe("createSchool's predator-proximity flee reaction", () => {
  it("leaves an unthreatened prey school's leader on its ordinary ring", () => {
    const species = testSpecies({ fleesPredators: true, leaders: 1, count: 1 });
    const school = createSchool(species, "flee-seed", { value: 0 });
    school.update(1, NO_BOUNDS, []);
    const calmPosition = memberPosition(school.mesh, 0).clone();
    school.update(1, NO_BOUNDS, [new Vector3(500, 0, 500)]);
    const stillFarPosition = memberPosition(school.mesh, 0);
    expect(calmPosition.distanceTo(stillFarPosition)).toBeLessThan(0.1);
    school.dispose();
  });

  it("smooths its escape from a predator anchor instead of snapping to it in one frame", () => {
    const species = testSpecies({ fleesPredators: true, leaders: 1, count: 1, pathRadius: 10 });
    const school = createSchool(species, "flee-seed-2", { value: 0 });
    school.update(0, NO_BOUNDS, []);
    const beforeThreat = memberPosition(school.mesh, 0).clone();
    // A threat sitting exactly where the leader already is: alarm is smoothed
    // (fast attack, ~4/s), so a single ~16ms frame must NOT teleport it
    // metres away — that instant-snap response is exactly what a real fish
    // does not do (see the BA report on swimming behaviour).
    school.update(0.016, NO_BOUNDS, [beforeThreat.clone()]);
    const afterOneFrame = memberPosition(school.mesh, 0);
    expect(beforeThreat.distanceTo(afterOneFrame)).toBeLessThan(1);
    // But sustained proximity — the same stationary threat, held for ~2s —
    // must still produce a real escape: smoothed is not the same as disabled.
    let elapsed = 0.016;
    for (let i = 0; i < 120; i += 1) {
      elapsed += 0.016;
      school.update(elapsed, NO_BOUNDS, [beforeThreat.clone()]);
    }
    const afterSustained = memberPosition(school.mesh, 0);
    expect(beforeThreat.distanceTo(afterSustained)).toBeGreaterThan(3);
    school.dispose();
  });

  it("exposes a predator school's own leader positions as predatorAnchors", () => {
    const species = testSpecies({ predator: true, leaders: 4 });
    const school = createSchool(species, "predator-seed", { value: 0 });
    expect(school.predatorAnchors).toHaveLength(4);
    school.update(1, NO_BOUNDS);
    // The exposed anchors are the SAME instances update() just mutated.
    expect(school.predatorAnchors?.[0]?.length()).toBeGreaterThan(0);
    school.dispose();
  });

  it("gives no species predatorAnchors unless it opts in", () => {
    const school = createSchool(testSpecies(), "no-predator-seed", { value: 0 });
    expect(school.predatorAnchors).toBeUndefined();
    school.dispose();
  });
});

describe("createSchool's camera-relative approach", () => {
  it("brings a leader within approachDistanceMetres of the camera, not onto it", () => {
    const species = testSpecies({ approachesCamera: true, leaders: 1, count: 1, pathRadius: 60 });
    const school = createSchool(species, "approach-seed", { value: 0 });
    // Away from the origin, like a real orbiting camera — a camera AT the
    // origin cannot distinguish "distance from camera" from "distance from
    // origin", which is exactly how a prior version of this formula (target
    // radius = the camera's own radius from origin, instead of the camera's
    // radius minus approachDistanceMetres) shipped uncaught: it put the
    // leader exactly at the camera's position once angle and height finished
    // converging, reading on screen as a fin plane filling the frame edge-on.
    const camera = new Vector3(30, 5, 0);
    let closestDistance = Number.POSITIVE_INFINITY;
    // Sweep the whole ~34s cycle; the envelope must dip close at some point.
    for (let elapsed = 0; elapsed < 34; elapsed += 1) {
      school.update(elapsed, NO_BOUNDS, [], camera);
      const position = memberPosition(school.mesh, 0);
      closestDistance = Math.min(closestDistance, position.distanceTo(camera));
    }
    // Approaches to roughly the default 6 m, with headroom for the envelope
    // never landing exactly on its discrete-sampled peak — and never onto the
    // camera itself, which is what the prior formula collapsed to.
    expect(closestDistance).toBeGreaterThan(3);
    expect(closestDistance).toBeLessThan(12);
    school.dispose();
  });

  it("never moves a leader when no species opts in", () => {
    const school = createSchool(testSpecies({ leaders: 1, count: 1, pathRadius: 60 }), "no-approach-seed", {
      value: 0
    });
    const cameraNearOrigin = new Vector3(0, 0, 0);
    school.update(5, NO_BOUNDS, [], cameraNearOrigin);
    const position = memberPosition(school.mesh, 0);
    expect(position.length()).toBeGreaterThan(30);
    school.dispose();
  });

  // A camera that has breached the surface (work item 1's bug, since fixed —
  // this is the defence in depth) must not carry an approaching animal up
  // through the water with it.
  it("never blends a leader's height above the surface toward a breached camera", () => {
    const school = createSchool(
      testSpecies({ approachesCamera: true, leaders: 1, count: 1, pathRadius: 30, heightBase: -4, heightRange: 2 }),
      "approach-breach-seed",
      { value: 0 }
    );
    const bounds = { surfaceY: 5, floorY: -40 };
    const cameraAboveTheSurface = new Vector3(10, 40, 0);
    let highestY = -Infinity;
    for (let elapsed = 0; elapsed < 34; elapsed += 1) {
      school.update(elapsed, bounds, [], cameraAboveTheSurface);
      highestY = Math.max(highestY, memberPosition(school.mesh, 0).y);
    }
    expect(highestY).toBeLessThanOrEqual(bounds.surfaceY);
    school.dispose();
  });
});

describe("createSchool's swim-out", () => {
  it("eases a leader's rendered radius out past its ring and back, without ever moving the persistent radius", () => {
    const species = testSpecies({ leaders: 1, count: 1, pathRadius: 20 });
    const school = createSchool(species, "swim-out-seed", { value: 0 }, 15);
    let closest = Number.POSITIVE_INFINITY;
    let farthest = 0;
    for (let elapsed = 0; elapsed < 90; elapsed += 1) {
      school.update(elapsed, NO_BOUNDS);
      const radius = Math.hypot(memberPosition(school.mesh, 0).x, memberPosition(school.mesh, 0).z);
      closest = Math.min(closest, radius);
      farthest = Math.max(farthest, radius);
    }
    // ringLimit is max(6, visibilityMetres) = 15 here, so the peak reaches
    // toward ringLimit * 1.6 = 24 regardless of this seed's own persistent
    // radius (drawn once, unknown here) — the envelope has to carry it
    // meaningfully past the ordinary +-14% wobble around that persistent
    // radius, in EITHER direction from wherever the seed happened to draw it.
    expect(farthest).toBeGreaterThan(20);
    expect(farthest - closest).toBeGreaterThan(8);
    school.dispose();
  });

  it("keeps two leaders out of sync with each other", () => {
    const species = testSpecies({ leaders: 4, count: 4, pathRadius: 20 });
    const school = createSchool(species, "swim-out-sync-seed", { value: 0 }, 15);
    const radiiAtOneMoment = new Set<number>();
    school.update(20, NO_BOUNDS);
    for (let i = 0; i < 4; i += 1) {
      const position = memberPosition(school.mesh, i);
      radiiAtOneMoment.add(Math.round(Math.hypot(position.x, position.z)));
    }
    expect(radiiAtOneMoment.size).toBeGreaterThan(1);
    school.dispose();
  });
});

describe("createSchool's adopt fade", () => {
  it("fades the geometry swap through invisibility for a school still in sighting range", () => {
    const camera = new Vector3(0, -4, 0);
    const school = createSchool(testSpecies({ leaders: 1, count: 1 }), "adopt-near-seed", { value: 0 }, 200);
    school.update(0, NO_BOUNDS, [], camera);
    school.adopt(testModel());
    // The fade STARTS on this tick (fadeElapsed = 0 here, by construction —
    // adoptFadeStartElapsed is stamped to this same `elapsed`), so progress
    // only shows up on a later call.
    school.update(0.01, NO_BOUNDS, [], camera);
    school.update(0.05, NO_BOUNDS, [], camera);
    // Partway through the fade-out half: opacity must actually have dropped,
    // or there is nothing left to call a "fade".
    expect(school.material.opacity).toBeLessThan(1);
    expect(school.material.opacity).toBeGreaterThan(0);
    school.dispose();
  });

  it("resolves a fog-swallowed school's geometry swap almost instantly instead of animating an invisible fade", () => {
    const species = testSpecies({ leaders: 1, count: 1, heightBase: -6, heightRange: 0 });
    // ringLimit floors at 6 m regardless of visibility, so even a leader in
    // the foggiest water this call can express (3 m) still rides a ~6 m ring
    // — about two sighting ranges out, which is most of the way to fully
    // swallowed before the fade ever starts.
    const school = createSchool(species, "adopt-far-seed", { value: 0 }, 3);
    const cameraAtOrigin = new Vector3(0, -6, 0);
    school.update(0, NO_BOUNDS, [], cameraAtOrigin);
    const model = testModel();
    school.adopt(model);
    // Same two-call shape as the near-school case above: the fade starts on
    // the first call after adopt() and only shows progress on the next.
    school.update(0.01, NO_BOUNDS, [], cameraAtOrigin);
    school.update(0.05, NO_BOUNDS, [], cameraAtOrigin);
    expect(school.mesh.geometry).toBe(model.geometry);
    expect(school.material.opacity).toBe(1);
    expect(school.material.transparent).toBe(false);
    school.dispose();
  });
});

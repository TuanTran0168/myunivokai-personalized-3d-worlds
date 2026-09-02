/**
 * Composition, not content: the two layers that tell the eye where it is
 * standing.
 *
 * Everything else in the rig answers "what is in this water". These two answer
 * "where is the camera relative to it", and they are the cheapest quality in the
 * whole family — about a hundred lines for the two strongest depth cues it has.
 *
 * Neither is lit. Both are pure silhouette, handed to the fog.
 */
import {
  ConeGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from "three";

type Random = () => number;

/* ========================================================================
   THE FOREGROUND FRAME
   ======================================================================== */

export type ForegroundFrame = {
  group: Group;
  material: MeshBasicMaterial;
  update: (elapsed: number) => void;
  dispose: () => void;
};

/**
 * Four near-black fronds within two metres of the lens, partly off-frame.
 *
 * This is the single highest-value cheap change available to an underwater
 * scene: **it is what tells the eye it is INSIDE the water rather than looking at
 * a picture of water.** Without something occluding the lens the camera reads as
 * a window onto a diorama, no matter how good the water is; with it, the same
 * water reads as a place the viewer is submerged in.
 *
 * It works because it is the only thing in frame at a distance the eye can
 * resolve as *near*. Everything else in an ocean scene is 10 m away or more, and
 * a scene whose nearest object is 10 m away has no foreground at all.
 *
 * Kept out of the depth-sorted world deliberately: `fog: false` so distance
 * cannot lift it, `renderOrder` high so it draws last, and locked to the camera
 * so it never parallaxes away.
 */
/**
 * THE HEIGHTS ARE HALF THE PROTOTYPE'S, AND THAT IS THE FIX FOR "TWO STRANGE
 * OBJECTS IN THE CORNERS".
 *
 * The prototype's fronds are 3.2 to 4.9 m tall, anchored around y = -2 and set
 * at z = -2.5. At the 58 degree field of view this family uses, the frame's
 * vertical half-extent at that distance is only 1.39 m — so every frond ran off
 * the TOP of the picture. A tapered blade whose tip you can see reads as a
 * plant; the same blade with its tip outside the frame is a vertical bar with
 * two parallel edges, which is a piece of chrome. The prototype's own canvas is
 * a narrow panel beside a sidebar and it got away with it; a full-width 1.93:1
 * frame does not.
 *
 * So the tips now land between y = -0.5 and y = 0.4, just below and around the
 * centre line: the blade enters from the bottom corner, tapers, and ends. Same x
 * and z, same rolls, same taper curve — only the length changes, because the
 * length was the only thing wrong.
 */
const FRONDS = [
  { x: -2.15, y: -1.9, z: -2.5, width: 0.42, height: 2.3, roll: 0.2, yaw: 0.3 },
  { x: -1.78, y: -2.0, z: -2.3, width: 0.3, height: 1.85, roll: 0.42, yaw: -0.5 },
  { x: 2.35, y: -2.1, z: -2.6, width: 0.5, height: 2.5, roll: -0.26, yaw: 0.6 },
  { x: 1.95, y: -2.0, z: -2.2, width: 0.26, height: 1.6, roll: -0.46, yaw: 0.1 },
] as const;

export function createForegroundFrame(): ForegroundFrame {
  const group = new Group();
  // Opacity below 1 so the water's own colour bleeds through the frond rather
  // than punching a hard black hole in the frame.
  const material = new MeshBasicMaterial({
    color: 0x000000,
    side: DoubleSide,
    fog: false,
    transparent: true,
    opacity: 0.92,
  });

  const blades: Mesh[] = [];
  const geometries: PlaneGeometry[] = [];
  FRONDS.forEach((frond, index) => {
    const geometry = new PlaneGeometry(frond.width, frond.height, 1, 10);
    // Hinge at the base, so the sway rotates about where the frond is anchored.
    geometry.translate(0, frond.height * 0.5, 0);
    const position = geometry.getAttribute("position");
    for (let i = 0; i < position.count; i += 1) {
      const t = position.getY(i) / frond.height;
      // Quadratic taper: a blade, not a rectangle.
      position.setX(i, position.getX(i) * (1 - 0.72 * t * t));
    }
    position.needsUpdate = true;
    geometries.push(geometry);

    const blade = new Mesh(geometry, material);
    blade.position.set(frond.x, frond.y, frond.z);
    blade.rotation.z = frond.roll;
    blade.rotation.y = frond.yaw;
    blade.userData.phase = index * 1.7;
    blade.userData.baseRoll = frond.roll;
    blade.renderOrder = 4000;
    blades.push(blade);
    group.add(blade);
  });

  return {
    group,
    material,
    update: (elapsed) => {
      for (const blade of blades) {
        const phase = blade.userData.phase as number;
        const baseRoll = blade.userData.baseRoll as number;
        // Slow, out of phase, and small. A foreground frond that sways visibly
        // draws attention to itself, which is the opposite of its job.
        blade.rotation.z = baseRoll + Math.sin(elapsed * 0.42 + phase) * 0.055;
      }
    },
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
    },
  };
}

/* ========================================================================
   FAR BATHYMETRIC MASSES
   ======================================================================== */

export type RidgeSilhouettes = {
  group: Group;
  materials: MeshBasicMaterial[];
  dispose: () => void;
};

/**
 * Three rings of wide, low, unlit masses receding into the fog.
 *
 * These are what give the deep a *distance*. A seabed that ends in flat fog has
 * no scale — nothing in it says whether the far edge is 40 m away or 400. Three
 * rings of progressively darker, progressively larger masses at 58 / 112 / 205 m
 * give the fog something to swallow at three known depths, and the eye reads the
 * spacing as space.
 *
 * `MeshBasicMaterial` with `fog: true` is the whole shading model: these are
 * masses, not surfaces, and lighting them would only reveal that they are cones.
 * Their colour is the fog's own, scaled DOWN — a silhouette is defined by being
 * darker than what is behind it, and at this distance that is all it can be.
 */
const RIDGE_RINGS = [
  { radius: 58, height: 5.5, count: 22, dark: 0.58, key: "ridge-near" },
  { radius: 112, height: 8.5, count: 30, dark: 0.34, key: "ridge-mid" },
  { radius: 205, height: 13, count: 38, dark: 0.18, key: "ridge-far" },
] as const;

export function createRidgeSilhouettes(options: {
  random: Random;
  heightAt: (x: number, z: number) => number;
}): RidgeSilhouettes {
  const { random, heightAt } = options;
  const group = new Group();
  const materials: MeshBasicMaterial[] = [];
  const geometries: ConeGeometry[] = [];

  for (const ring of RIDGE_RINGS) {
    const material = new MeshBasicMaterial({ color: 0x000000, fog: true });
    material.userData.dark = ring.dark;
    materials.push(material);
    for (let i = 0; i < ring.count; i += 1) {
      // Evenly spaced then jittered: a ring built from pure noise clumps and
      // leaves gaps the fog cannot cover.
      const angle = (i / ring.count) * Math.PI * 2 + random() * 0.4;
      const distance = ring.radius * (0.82 + random() * 0.4);
      const height = ring.height * (0.5 + random() * 0.9);
      // Low radial segment counts on purpose: at 200 m through fog these are
      // eleven-sided and nobody can tell, and it keeps 90 masses affordable.
      const geometry = new ConeGeometry(
        height * (1.9 + random() * 1.8),
        height,
        11 + Math.floor(random() * 5),
        2,
      );
      geometries.push(geometry);
      const mesh = new Mesh(geometry, material);
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      // Sunk into the bed by roughly two thirds: these are ridges, not spikes.
      mesh.position.set(x, heightAt(x, z) + height * 0.36, z);
      mesh.scale.set(1, 0.45 + random() * 0.4, 0.55 + random() * 0.9);
      mesh.rotation.y = random() * Math.PI;
      group.add(mesh);
    }
  }

  return {
    group,
    materials,
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

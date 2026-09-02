import { Color, Group, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { createCausticsUniforms } from "./oceanCaustics";
import { tintSeabed, type Seabed } from "./oceanRigTerrain";

/**
 * The seabed, its boulders and its sponges used to run a SECOND caustics
 * implementation — a ridged-sine pattern with its own `causticStrength * 0.185`
 * gain — while landmarks used the physically-derived differential-area form in
 * oceanCaustics.ts at the raw strength. Same sun, same water, same floor, two
 * different brightnesses. Both now share the one implementation; these tests
 * pin the two things tintSeabed is responsible for wiring into it correctly.
 */
function fakeSeabed(): Seabed {
  return {
    group: new Group(),
    floorMaterial: new MeshStandardMaterial(),
    rockMaterials: [new MeshStandardMaterial(), new MeshStandardMaterial()],
    causticUniforms: createCausticsUniforms(0, 1, "#CFF6FF"),
    heightAt: () => 0,
    cellSizeMetres: 1,
    dispose: () => {},
  };
}

describe("tintSeabed's caustics", () => {
  it("passes causticStrength straight through, with no local gain separate from the landmarks'", () => {
    const seabed = fakeSeabed();
    tintSeabed(seabed, new Color("#0E6F82"), 0.5, 0.42, new Color("#8FD8E8"), 20);
    expect(seabed.causticUniforms.uCausticStrength.value).toBe(0.42);
  });

  it("sets the caustic depth from the surface-to-floor distance, floored at 0.5 m", () => {
    const seabed = fakeSeabed();
    tintSeabed(seabed, new Color("#0E6F82"), 0.5, 0.3, new Color("#8FD8E8"), 0.1);
    expect(seabed.causticUniforms.uCausticDepth.value).toBe(0.5);
    tintSeabed(seabed, new Color("#0E6F82"), 0.5, 0.3, new Color("#8FD8E8"), 40);
    expect(seabed.causticUniforms.uCausticDepth.value).toBe(40);
  });
});

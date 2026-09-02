import { Color, Group, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { createCausticsUniforms } from "./oceanCaustics";
import { slopeRockChannelShift, tintSeabed, type Seabed } from "./oceanRigTerrain";

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
    slopeRockShift: { value: new Color(1, 1, 1) },
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

/**
 * The steep faces of the seabed are rock, not sand, and the multiplier that
 * says so is derived from the two colours AFTER the water has graded them —
 * see slopeRockChannelShift for why the raw albedos are the wrong input.
 */
describe("tintSeabed's slope rock", () => {
  it("darkens the steep faces, because rock is darker than coral sand", () => {
    const seabed = fakeSeabed();
    tintSeabed(seabed, new Color("#0E6F82"), 0.7, 0.4, new Color("#8FD8E8"), 20);
    const shift = seabed.slopeRockShift.value;
    expect(shift.r).toBeLessThan(1);
    expect(shift.g).toBeLessThan(1);
    expect(shift.b).toBeLessThan(1);
  });

  it("never turns a dune face into a hole", () => {
    const seabed = fakeSeabed();
    for (const brightness of [0, 0.25, 0.5, 0.75, 1]) {
      tintSeabed(seabed, new Color("#0E6F82"), brightness, 0.4, new Color("#8FD8E8"), 20);
      const shift = seabed.slopeRockShift.value;
      for (const channel of [shift.r, shift.g, shift.b]) {
        expect(channel).toBeGreaterThanOrEqual(0.55);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("slopeRockChannelShift", () => {
  it("is the ratio of the two tinted materials where that ratio is usable", () => {
    expect(slopeRockChannelShift(0.36, 0.48)).toBeCloseTo(0.75, 10);
  });

  it("never brightens a slope, however the water grades the two", () => {
    // Rock lighter than sand is not a material difference, it is light coming
    // out of the ground.
    expect(slopeRockChannelShift(0.9, 0.3)).toBe(1);
  });

  it("stops short of black on the darkest worlds", () => {
    expect(slopeRockChannelShift(0.01, 0.9)).toBe(0.55);
  });

  it("leaves a channel alone when the sand carries no usable ratio", () => {
    expect(slopeRockChannelShift(0.2, 0)).toBe(1);
    expect(slopeRockChannelShift(0.2, 0.001)).toBe(1);
  });
});

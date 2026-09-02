import { describe, expect, it } from "vitest";
import {
  CAMERA_POSE_WINDOW_KEY,
  clearCameraPose,
  publishCameraPose,
  readCameraPose,
  type CameraPoseHost,
  type CameraPoseMeasurement
} from "./cameraPoseProbe";

/**
 * A pose that is nothing like the origin, so a test cannot pass on a zeroed
 * record that was never written.
 */
const FIRST_POSE: CameraPoseMeasurement = {
  positionX: 3.5,
  positionY: 12.25,
  positionZ: -8,
  targetX: 0,
  targetY: 6,
  targetZ: -1.5,
  orbitRadiusMetres: 20.4,
  polarAngleRadians: 1.31,
  azimuthAngleRadians: -0.82,
  ceilingMetres: 14.53,
  floorMetres: null
};

const SECOND_POSE: CameraPoseMeasurement = {
  positionX: 4,
  positionY: 24.4,
  positionZ: -9,
  targetX: 0,
  targetY: 6,
  targetZ: -1.5,
  orbitRadiusMetres: 26,
  polarAngleRadians: 0.42,
  azimuthAngleRadians: -0.8,
  ceilingMetres: 14.53,
  floorMetres: null
};

describe("publishCameraPose", () => {
  it("puts the pose where a reader can find it", () => {
    const host: CameraPoseHost = {};
    publishCameraPose(host, FIRST_POSE);
    expect(readCameraPose(host)).toEqual({ ...FIRST_POSE, publishedFrameCount: 1 });
  });

  it("reports nothing before a scene has drawn a frame", () => {
    expect(readCameraPose({})).toBeNull();
  });

  it("overwrites every field, so no stale component of an old pose survives", () => {
    const host: CameraPoseHost = {};
    publishCameraPose(host, FIRST_POSE);
    publishCameraPose(host, SECOND_POSE);
    expect(readCameraPose(host)).toEqual({ ...SECOND_POSE, publishedFrameCount: 2 });
  });

  it("keeps one record and mutates it, so a published frame allocates nothing", () => {
    const host: CameraPoseHost = {};
    publishCameraPose(host, FIRST_POSE);
    const firstRecord = host[CAMERA_POSE_WINDOW_KEY];
    publishCameraPose(host, SECOND_POSE);
    expect(host[CAMERA_POSE_WINDOW_KEY]).toBe(firstRecord);
  });

  /**
   * The count is the whole reason a reader can tell a live scene from a stale
   * global: "the camera did not move" and "this scene never drew" are the two
   * readings the spec this probe exists for could not previously separate.
   */
  it("counts frames, so a reader can tell a live scene from a stale global", () => {
    const host: CameraPoseHost = {};
    for (let frame = 0; frame < 5; frame++) {
      publishCameraPose(host, FIRST_POSE);
    }
    expect(readCameraPose(host)?.publishedFrameCount).toBe(5);
  });
});

describe("clearCameraPose", () => {
  it("leaves nothing behind for the next scene to be mistaken for", () => {
    const host: CameraPoseHost = {};
    publishCameraPose(host, FIRST_POSE);
    clearCameraPose(host);
    expect(readCameraPose(host)).toBeNull();
  });

  it("starts the count again rather than continuing the old scene's", () => {
    const host: CameraPoseHost = {};
    publishCameraPose(host, FIRST_POSE);
    publishCameraPose(host, FIRST_POSE);
    clearCameraPose(host);
    publishCameraPose(host, SECOND_POSE);
    expect(readCameraPose(host)?.publishedFrameCount).toBe(1);
  });
});

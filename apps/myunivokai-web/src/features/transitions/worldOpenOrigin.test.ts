import { describe, expect, it } from "vitest";
import {
  isWorldOpenOriginUsable,
  parseWorldOpenOrigin,
  WORLD_OPEN_ORIGIN_FRESHNESS_MILLISECONDS,
  type WorldOpenOrigin
} from "./worldOpenOrigin";

const NOW = 1_800_000_000_000;

function originAt(recordedAtEpochMilliseconds: number, worldIdentifier = "world-1"): WorldOpenOrigin {
  return { worldIdentifier, left: 120, top: 380, width: 300, height: 210, recordedAtEpochMilliseconds };
}

describe("parseWorldOpenOrigin", () => {
  it("reads back what the writer stores", () => {
    const origin = originAt(NOW);
    expect(parseWorldOpenOrigin(JSON.parse(JSON.stringify(origin)))).toEqual(origin);
  });

  it("rejects anything missing a world identifier", () => {
    expect(parseWorldOpenOrigin({ left: 1, top: 2, width: 3, height: 4, recordedAtEpochMilliseconds: NOW })).toBeNull();
    expect(parseWorldOpenOrigin({ ...originAt(NOW), worldIdentifier: "" })).toBeNull();
  });

  it("rejects a rectangle with a non-numeric or infinite side", () => {
    // A rectangle with a NaN in it would make every row coordinate NaN, and a
    // canvas draws nothing at all rather than reporting the problem.
    expect(parseWorldOpenOrigin({ ...originAt(NOW), width: "300" })).toBeNull();
    expect(parseWorldOpenOrigin({ ...originAt(NOW), top: Number.NaN })).toBeNull();
    expect(parseWorldOpenOrigin({ ...originAt(NOW), height: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("rejects the shapes a corrupted store can hand back", () => {
    expect(parseWorldOpenOrigin(null)).toBeNull();
    expect(parseWorldOpenOrigin("world-1")).toBeNull();
    expect(parseWorldOpenOrigin([originAt(NOW)])).toBeNull();
  });
});

describe("isWorldOpenOriginUsable", () => {
  it("accepts a fresh origin for the world being opened", () => {
    expect(isWorldOpenOriginUsable(originAt(NOW - 300), "world-1", NOW)).toBe(true);
  });

  it("refuses an origin recorded for a different world", () => {
    // Two cards clicked in quick succession, or a stale entry left by a
    // navigation that never completed.
    expect(isWorldOpenOriginUsable(originAt(NOW - 300, "world-2"), "world-1", NOW)).toBe(false);
  });

  it("refuses an origin older than the freshness window", () => {
    const stale = originAt(NOW - WORLD_OPEN_ORIGIN_FRESHNESS_MILLISECONDS - 1);
    expect(isWorldOpenOriginUsable(stale, "world-1", NOW)).toBe(false);
  });

  it("accepts one recorded exactly on the boundary", () => {
    const boundary = originAt(NOW - WORLD_OPEN_ORIGIN_FRESHNESS_MILLISECONDS);
    expect(isWorldOpenOriginUsable(boundary, "world-1", NOW)).toBe(true);
  });

  it("accepts an origin from a clock that moved backwards", () => {
    // A resumed laptop or a system time change can make the recording look like
    // it happened in the future. It is certainly not stale.
    expect(isWorldOpenOriginUsable(originAt(NOW + 5_000), "world-1", NOW)).toBe(true);
  });

  it("refuses nothing at all", () => {
    expect(isWorldOpenOriginUsable(null, "world-1", NOW)).toBe(false);
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ABYSS_VISITOR_MODEL_BINDINGS,
  FISH_MODEL_BINDINGS,
  FORBIDDEN_CLIP_FRAGMENTS,
  GIANT_MODEL_BINDINGS,
  allFaunaModelUrls,
  selectSwimClipName
} from "./oceanFaunaModels";

const MODEL_DIRECTORY = join(process.cwd(), "public", "assets", "ocean", "models");

/**
 * Reads the clip names straight out of a GLB's JSON chunk.
 *
 * The point of this suite is that it runs against the FILES THAT SHIP, not
 * against a copy of their clip names kept in the test. A re-export that renames
 * or reorders a clip is exactly the change that would otherwise slip through,
 * and it is the change that puts a fish's death animation on a loop.
 */
function animationClipNames(file: string): string[] {
  const buffer = readFileSync(join(MODEL_DIRECTORY, file));
  const GLB_MAGIC = 0x46546c67;
  expect(buffer.readUInt32LE(0)).toBe(GLB_MAGIC);
  const jsonLength = buffer.readUInt32LE(12);
  const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8"));
  return (gltf.animations ?? []).map((animation: { name?: string }) => animation.name ?? "");
}

const allBindings = [
  ...Object.entries(FISH_MODEL_BINDINGS),
  ...Object.entries(GIANT_MODEL_BINDINGS),
  ...Object.entries(ABYSS_VISITOR_MODEL_BINDINGS)
];

describe("every binding points at a file that exists", () => {
  const present = new Set(readdirSync(MODEL_DIRECTORY));

  it.each(allBindings)("%s resolves to a shipped GLB", (_key, binding) => {
    expect(present.has(binding.file)).toBe(true);
  });

  it("preloads each file once, not once per species", () => {
    const urls = allFaunaModelUrls();
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("clip selection against the real files", () => {
  const files = [...new Set(allBindings.map(([, binding]) => binding.file))];

  it.each(files)("%s yields a swim clip", (file) => {
    const chosen = selectSwimClipName(animationClipNames(file));
    expect(chosen).not.toBeNull();
    expect(chosen?.toLowerCase()).toContain("swim");
  });

  it.each(files)("%s never yields a forbidden clip", (file) => {
    const chosen = selectSwimClipName(animationClipNames(file));
    const lowered = (chosen ?? "").toLowerCase();
    for (const fragment of FORBIDDEN_CLIP_FRAGMENTS) {
      expect(lowered).not.toContain(fragment);
    }
  });

  it("prefers the cruising clip over the sprint when a file ships both", () => {
    // These models carry Swimming_Normal, Swimming_Fast and Swimming_Impulse.
    // A school at cruising speed must not be locked to the sprint cycle — speed
    // is carried by playback rate, which is what the biology says.
    const clips = animationClipNames("fauna-butterfly-fish.glb");
    expect(clips.length).toBeGreaterThan(1);
    expect(selectSwimClipName(clips)?.toLowerCase()).toContain("swimming_normal");
  });
});

describe("the deny list holds when a file ships nothing else", () => {
  it("returns null rather than falling back to a death animation", () => {
    // The failure this guards: "no swim clip found, so play index 0" — where
    // index 0 in every one of these files is Attack, and index 1 is Death.
    expect(selectSwimClipName(["Fish_Armature|Attack", "Fish_Armature|Death"])).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(selectSwimClipName(["ARMATURE|DEATH"])).toBeNull();
  });

  it("does not mistake a name that merely contains a swim clip's letters", () => {
    expect(selectSwimClipName(["Armature|Idle", "Armature|Wave"])).toBeNull();
  });
});

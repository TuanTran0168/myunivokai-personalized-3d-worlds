import { describe, expect, it } from "vitest";
import {
  buildPreviewForestSceneConfig,
  FOREST_LANDMARK_HEART_TREE,
  FOREST_SEASON_WINTER,
  FOREST_WEATHER_RAIN,
  FOREST_WEATHER_SNOW
} from "./forestScene";
import type { PreviewSceneInput } from "./scene";

const BASE_PREVIEW_INPUT: PreviewSceneInput = {
  nickname: "Tuan",
  interests: ["Technology", "Design", "AI"],
  traits: ["curious", "builder", "focused"],
  mood: "reflective",
  preferredWorldStyle: "aurora",
  favoriteColors: ["#8B5CF6", "#06B6D4"]
};

// A spread of inputs so the contract assertions below exercise every mood and
// several seeds, not one lucky draw.
const PREVIEW_INPUT_VARIATIONS: PreviewSceneInput[] = ["focused", "dreamy", "energetic", "reflective"].flatMap((mood) =>
  ["Tuan", "Neo", "Mai", "Linh", "Khoa"].map((nickname) => ({
    ...BASE_PREVIEW_INPUT,
    nickname,
    mood
  }))
);

describe("buildPreviewForestSceneConfig", () => {
  it("is deterministic for identical inputs", () => {
    const firstBuild = buildPreviewForestSceneConfig(BASE_PREVIEW_INPUT);
    const secondBuild = buildPreviewForestSceneConfig(BASE_PREVIEW_INPUT);
    expect(secondBuild).toEqual(firstBuild);
  });

  it("changes the scene when the nickname changes", () => {
    const firstBuild = buildPreviewForestSceneConfig(BASE_PREVIEW_INPUT);
    const secondBuild = buildPreviewForestSceneConfig({ ...BASE_PREVIEW_INPUT, nickname: "Neo" });
    expect(secondBuild.seed).not.toEqual(firstBuild.seed);
  });

  it("stamps the forest family contract keys", () => {
    const scene = buildPreviewForestSceneConfig(BASE_PREVIEW_INPUT);
    expect(scene.sceneType).toBe("forest");
    expect(scene.schemaVersion).toBe("1.2");
    expect(scene.theme).toBe("aurora");
  });

  it("respects the season-weather compatibility matrix on every variation", () => {
    for (const previewInput of PREVIEW_INPUT_VARIATIONS) {
      const scene = buildPreviewForestSceneConfig(previewInput);
      const seasonKind = scene.season?.kind;
      const weatherKind = scene.weather?.kind;
      if (weatherKind === FOREST_WEATHER_SNOW) {
        expect(seasonKind).toBe(FOREST_SEASON_WINTER);
      }
      if (weatherKind === FOREST_WEATHER_RAIN) {
        expect(seasonKind).not.toBe(FOREST_SEASON_WINTER);
      }
      // Particle counts stay zero unless the kind matches.
      if (weatherKind !== FOREST_WEATHER_RAIN) {
        expect(scene.weather?.rainDropCountDesktop).toBe(0);
      }
      if (weatherKind !== FOREST_WEATHER_SNOW) {
        expect(scene.weather?.snowflakeCountDesktop).toBe(0);
      }
    }
  });

  it("always makes the first landmark the heart tree and names the rest from inputs", () => {
    for (const previewInput of PREVIEW_INPUT_VARIATIONS) {
      const scene = buildPreviewForestSceneConfig(previewInput);
      const landmarks = scene.landmarks ?? [];
      expect(landmarks.length).toBeGreaterThanOrEqual(3);
      expect(landmarks.length).toBeLessThanOrEqual(7);
      expect(landmarks[0]?.kind).toBe(FOREST_LANDMARK_HEART_TREE);
      expect(landmarks[0]?.name).toBe("Technology");
    }
  });

  it("keeps the headline numeric sections inside their contract bounds", () => {
    for (const previewInput of PREVIEW_INPUT_VARIATIONS) {
      const scene = buildPreviewForestSceneConfig(previewInput);
      expect(scene.terrain?.clearingRadius).toBeGreaterThanOrEqual(8);
      expect(scene.terrain?.clearingRadius).toBeLessThanOrEqual(11);
      expect(scene.trees?.countDesktop).toBeGreaterThanOrEqual(120);
      expect(scene.trees?.countDesktop).toBeLessThanOrEqual(320);
      expect(scene.trees?.windStrength).toBeGreaterThanOrEqual(0.1);
      expect(scene.trees?.windStrength).toBeLessThanOrEqual(1.0);
      expect(scene.camera?.distance).toBeGreaterThanOrEqual(14);
      expect(scene.camera?.distance).toBeLessThanOrEqual(20);
      expect(scene.postFX?.bloomIntensity).toBeGreaterThanOrEqual(0.2);
      expect(scene.postFX?.bloomIntensity).toBeLessThanOrEqual(1.2);
      const speciesWeightTotal = (scene.trees?.speciesMix ?? []).reduce((sum, entry) => sum + (entry.weight ?? 0), 0);
      expect(speciesWeightTotal).toBeCloseTo(1, 5);
    }
  });
});

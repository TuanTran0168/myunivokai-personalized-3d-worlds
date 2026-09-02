import { describe, it, expect } from "vitest";
import {
  CANONICAL_FALLBACK_SEED,
  backgroundColorFromScene,
  buildPreviewBeltConfig,
  buildPreviewCometsConfig,
  buildPreviewSceneConfig,
  buildPreviewSunConfig,
  moodSceneProfile,
  planetsFromScene,
  randomFromSeed,
  resolveVariantSeed,
  sceneFromVariant,
  sceneGradeForTheme,
  type PreviewSceneInput
} from "./scene";
import type { WorldVariant } from "./types";

const THREE_PLANET_SCENE_CONFIG = {
  theme: "cosmic-galaxy",
  planets: [{ key: "a" }, { key: "b" }, { key: "c" }]
};

describe("resolveVariantSeed / sceneFromVariant", () => {
  it("uses the variant seed when present", () => {
    const variant: WorldVariant = { id: "variant-1", seed: "seed-1", sceneConfig: THREE_PLANET_SCENE_CONFIG };
    expect(resolveVariantSeed(variant)).toBe("seed-1");
    expect(sceneFromVariant(variant).seed).toBe("seed-1");
  });

  it("falls back to the seed embedded in the scene config", () => {
    const variant: WorldVariant = {
      id: "variant-1",
      sceneConfig: { ...THREE_PLANET_SCENE_CONFIG, seed: "config-seed" }
    };
    expect(resolveVariantSeed(variant)).toBe("config-seed");
  });

  it("falls back to the variant id, then the canonical seed", () => {
    expect(resolveVariantSeed({ id: "variant-1" })).toBe("variant-1");
    expect(resolveVariantSeed(undefined)).toBe(CANONICAL_FALLBACK_SEED);
    expect(sceneFromVariant(undefined).seed).toBe(CANONICAL_FALLBACK_SEED);
  });

  it("never lets a stale seed inside sceneConfig override the resolved seed", () => {
    const variant: WorldVariant = {
      id: "variant-1",
      seed: "authoritative-seed",
      sceneConfig: { ...THREE_PLANET_SCENE_CONFIG, seed: "stale-seed" }
    };
    expect(sceneFromVariant(variant).seed).toBe("authoritative-seed");
  });

  it("preserves the planets from the scene config (the variants-bug regression)", () => {
    const variant: WorldVariant = { id: "variant-1", seed: "seed-1", sceneConfig: THREE_PLANET_SCENE_CONFIG };
    expect(planetsFromScene(sceneFromVariant(variant))).toHaveLength(3);
  });
});

describe("scene rendering consistency across pages", () => {
  it("resolves the same seed whether it lives at the variant or inside the config", () => {
    const seedValue = "shared-seed";
    const variantFromWorldEndpoint: WorldVariant = {
      id: "variant-1",
      seed: seedValue,
      sceneConfig: THREE_PLANET_SCENE_CONFIG
    };
    const variantFromShareEndpoint: WorldVariant = {
      id: "variant-1",
      sceneConfig: { ...THREE_PLANET_SCENE_CONFIG, seed: seedValue }
    };
    expect(sceneFromVariant(variantFromWorldEndpoint).seed).toBe(
      sceneFromVariant(variantFromShareEndpoint).seed
    );
  });

  it("produces an identical scene for the same variant (one builder, every page)", () => {
    const variant: WorldVariant = { id: "variant-1", seed: "seed-1", sceneConfig: THREE_PLANET_SCENE_CONFIG };
    expect(sceneFromVariant(variant)).toEqual(sceneFromVariant(variant));
  });
});

describe("buildPreviewSceneConfig", () => {
  const baseInput: PreviewSceneInput = {
    nickname: "Neo",
    interests: ["Technology", "Design", "AI"],
    traits: ["curious", "builder", "focused"],
    mood: "focused",
    preferredWorldStyle: "cosmic-galaxy",
    favoriteColors: ["#8B5CF6", "#06B6D4"]
  };

  it("is deterministic for identical inputs", () => {
    expect(buildPreviewSceneConfig(baseInput)).toEqual(buildPreviewSceneConfig(baseInput));
  });

  it("renders a real solar system (non-empty planets), not the abstract fallback", () => {
    const scene = buildPreviewSceneConfig(baseInput);
    expect(planetsFromScene(scene).length).toBeGreaterThan(0);
    expect(scene.theme).toBe("cosmic-galaxy");
  });

  it("clamps planet count between 3 and 7 (interests then traits, deduped)", () => {
    const few = buildPreviewSceneConfig({ ...baseInput, interests: ["Solo"], traits: ["Only"] });
    const exact = buildPreviewSceneConfig({ ...baseInput, interests: ["Art", "Science", "Music"], traits: ["Calm", "Focus"] });
    const many = buildPreviewSceneConfig({
      ...baseInput,
      interests: ["aa", "bb", "cc", "dd", "ee"],
      traits: ["ff", "gg", "hh", "ii"]
    });
    expect(planetsFromScene(few)).toHaveLength(3);
    expect(planetsFromScene(exact)).toHaveLength(5);
    expect(planetsFromScene(many)).toHaveLength(7);
  });

  it("sources planets from interests then traits, matching the generator", () => {
    const scene = buildPreviewSceneConfig(baseInput);
    expect(planetsFromScene(scene).map((planet) => planet.name)).toEqual([
      "Technology",
      "Design",
      "AI",
      "curious",
      "builder",
      "focused"
    ]);
  });

  it("derives the palette from the chosen colors with a fixed background", () => {
    const scene = buildPreviewSceneConfig({ ...baseInput, favoriteColors: ["#111111", "#222222"] });
    expect(scene.palette).toEqual({
      background: "#050816",
      primary: "#111111",
      secondary: "#222222",
      accent: "#FACC15",
      gradient: ["#111111", "#222222", "#FACC15"]
    });
  });

  it("names planets from the chosen interests", () => {
    const scene = buildPreviewSceneConfig(baseInput);
    const planetNames = planetsFromScene(scene).map((planet) => planet.name);
    expect(planetNames.slice(0, 3)).toEqual(["Technology", "Design", "AI"]);
  });

  it("reacts to a changed input (mood is part of the seed)", () => {
    const focused = buildPreviewSceneConfig({ ...baseInput, mood: "focused" });
    const dreamy = buildPreviewSceneConfig({ ...baseInput, mood: "dreamy" });
    expect(focused.seed).not.toBe(dreamy.seed);
  });
});

describe("mood scene profile", () => {
  it("makes energetic brighter and busier, reflective calmer", () => {
    expect(moodSceneProfile("energetic").bloomMultiplier).toBeGreaterThan(moodSceneProfile("reflective").bloomMultiplier);
    expect(moodSceneProfile("energetic").particleMultiplier).toBeGreaterThan(
      moodSceneProfile("reflective").particleMultiplier
    );
    expect(moodSceneProfile("reflective").motionMultiplier).toBeLessThan(moodSceneProfile("focused").motionMultiplier);
  });

  it("falls back to a neutral profile for unknown moods", () => {
    const neutral = moodSceneProfile("totally-unknown-mood");
    expect(neutral.bloomMultiplier).toBe(1);
    expect(neutral.particleMultiplier).toBe(1);
    expect(neutral.motionMultiplier).toBe(1);
    expect(neutral.backgroundColor).toBe("#050816");
  });

  it("applies the mood background to the built preview scene", () => {
    const inputFor = (mood: string): PreviewSceneInput => ({
      nickname: "Neo",
      interests: ["Technology", "Design", "AI"],
      traits: ["curious", "builder", "focused"],
      mood,
      preferredWorldStyle: "cosmic-galaxy",
      favoriteColors: ["#8B5CF6", "#06B6D4"]
    });
    expect(backgroundColorFromScene(buildPreviewSceneConfig(inputFor("dreamy")))).toBe("#0b0720");
    expect(backgroundColorFromScene(buildPreviewSceneConfig(inputFor("focused")))).toBe("#050816");
    expect(backgroundColorFromScene(buildPreviewSceneConfig(inputFor("totally-unknown")))).toBe("#050816");
    expect(backgroundColorFromScene(buildPreviewSceneConfig(inputFor("energetic")))).not.toBe(
      backgroundColorFromScene(buildPreviewSceneConfig(inputFor("reflective")))
    );
  });
});

describe("randomFromSeed", () => {
  it("is deterministic for the same seed and differs across seeds", () => {
    const firstSequence = [0, 1, 2].map(randomFromSeed("seed-a"));
    const sameSequence = [0, 1, 2].map(randomFromSeed("seed-a"));
    const otherSequence = [0, 1, 2].map(randomFromSeed("seed-b"));
    expect(firstSequence).toEqual(sameSequence);
    expect(firstSequence).not.toEqual(otherSequence);
  });
});

describe("preview sky section (mirror of the backend sky builder)", () => {
  const skyInputFor = (overrides: Partial<PreviewSceneInput> = {}): PreviewSceneInput => ({
    nickname: "Neo",
    interests: ["Technology", "Design", "AI"],
    traits: ["curious", "builder", "focused"],
    mood: "focused",
    preferredWorldStyle: "cosmic-galaxy",
    favoriteColors: ["#8B5CF6", "#06B6D4"],
    ...overrides
  });

  it("is present, deterministic and carries derived seeds", () => {
    const first = buildPreviewSceneConfig(skyInputFor());
    const second = buildPreviewSceneConfig(skyInputFor());
    expect(first.sky).toBeDefined();
    expect(first.sky).toEqual(second.sky);
    expect(first.sky?.milkyWay?.seed).toBe(`${first.seed}-milky-way`);
    expect(first.sky?.constellations?.seed).toBe(first.seed);
  });

  it("recolors the constellations and nebula accent per world style", () => {
    const cosmic = buildPreviewSceneConfig(skyInputFor({ preferredWorldStyle: "cosmic-galaxy" }));
    const nebula = buildPreviewSceneConfig(skyInputFor({ preferredWorldStyle: "nebula" }));
    expect(cosmic.sky?.constellations?.lineColor).not.toBe(nebula.sky?.constellations?.lineColor);
    expect(cosmic.sky?.milkyWay?.nebulaCloudColors?.[3]?.color).not.toBe(
      nebula.sky?.milkyWay?.nebulaCloudColors?.[3]?.color
    );
  });

  it("scales sky density and glow with the mood", () => {
    const dreamy = buildPreviewSceneConfig(skyInputFor({ mood: "dreamy" }));
    const reflective = buildPreviewSceneConfig(skyInputFor({ mood: "reflective" }));
    expect(dreamy.sky?.milkyWay?.bandStarCount ?? 0).toBeGreaterThan(reflective.sky?.milkyWay?.bandStarCount ?? 0);
    expect(dreamy.sky?.constellations?.glowMultiplier ?? 0).toBeGreaterThan(
      reflective.sky?.constellations?.glowMultiplier ?? 0
    );
  });

  it("keeps rotation speeds above zero after rounding", () => {
    const scene = buildPreviewSceneConfig(skyInputFor({ mood: "reflective" }));
    expect(scene.sky?.milkyWay?.rotationRadiansPerSecond ?? 0).toBeGreaterThan(0);
    expect(scene.sky?.constellations?.rotationRadiansPerSecond ?? 0).toBeGreaterThan(0);
  });

  it("did not shift the pre-sky draws (own PRNG stream)", () => {
    // The sky is drawn from `${seed}-sky`; the first planet's numbers must be
    // identical to what the pre-sky builder produced for the same inputs.
    const scene = buildPreviewSceneConfig(skyInputFor());
    const independentRandom = randomFromSeed(scene.seed ?? "");
    const expectedFirstPlanetSize = Math.round((0.45 + independentRandom() * 0.8) * 100) / 100;
    expect(scene.planets?.[0]?.size).toBe(expectedFirstPlanetSize);
  });
});

describe("preview diversity sections (mirror of the backend diversity builder, schema 1.2)", () => {
  const diversityInputFor = (overrides: Partial<PreviewSceneInput> = {}): PreviewSceneInput => ({
    nickname: "Neo",
    interests: ["Technology", "Design", "AI"],
    traits: ["curious", "builder", "focused"],
    mood: "focused",
    preferredWorldStyle: "cosmic-galaxy",
    favoriteColors: ["#8B5CF6", "#06B6D4"],
    ...overrides
  });

  // Mirror literals from diversity_scene_profile.go — the point of these tests
  // is to pin the mirrored ranges, so they are asserted as values, not consts.
  const BELT_ROCK_COLORS = ["#655B4F", "#5C544B", "#4A443C", "#75695A", "#6B5B4E"];
  const SUN_SURFACE_TINTS = ["#FFFFFF", "#FFE3C4", "#FDFDFF", "#E9F0FF"];

  it("stamps schema 1.2 and carries all diversity sections, deterministically", () => {
    const first = buildPreviewSceneConfig(diversityInputFor());
    const second = buildPreviewSceneConfig(diversityInputFor());
    expect(first.schemaVersion).toBe("1.2");
    expect(first.belt).toBeDefined();
    expect(first.comets).toBeDefined();
    expect(first.sun).toBeDefined();
    expect(first.postFX?.grade).toBeDefined();
    expect(first.belt).toEqual(second.belt);
    expect(first.comets).toEqual(second.comets);
    expect(first.sun).toEqual(second.sun);
  });

  it("wires the sections from the seed-derived builders (mirror-pair guard)", () => {
    const scene = buildPreviewSceneConfig(diversityInputFor());
    const seed = scene.seed ?? "";
    const profile = moodSceneProfile("focused");
    expect(scene.belt).toEqual(buildPreviewBeltConfig(seed, profile));
    expect(scene.comets).toEqual(buildPreviewCometsConfig(seed));
    expect(scene.sun).toEqual(buildPreviewSunConfig(seed));
  });

  it("keeps every belt draw inside the mirrored bounds and rolls both presence outcomes", () => {
    const profile = moodSceneProfile("focused");
    let enabledSeen = false;
    let disabledSeen = false;
    for (let seedIndex = 0; seedIndex < 80; seedIndex += 1) {
      const belt = buildPreviewBeltConfig(`belt-bounds-${seedIndex}`, profile);
      if (belt.enabled) {
        enabledSeen = true;
      } else {
        disabledSeen = true;
      }
      expect(belt.instanceCount).toBeGreaterThanOrEqual(300);
      expect(belt.instanceCount).toBeLessThanOrEqual(2500);
      expect(belt.gapBeyondLastOrbit).toBeGreaterThanOrEqual(1.3);
      expect(belt.gapBeyondLastOrbit).toBeLessThanOrEqual(2.2);
      expect(BELT_ROCK_COLORS).toContain(belt.rockColor);
      expect(Math.abs(belt.tiltXRadians ?? 0)).toBeLessThanOrEqual(0.12);
      expect(Math.abs(belt.tiltZRadians ?? 0)).toBeLessThanOrEqual(0.12);
    }
    expect(enabledSeen).toBe(true);
    expect(disabledSeen).toBe(true);
  });

  it("scales the belt density with the mood particle multiplier", () => {
    const dreamy = buildPreviewBeltConfig("belt-mood-seed", moodSceneProfile("dreamy"));
    const reflective = buildPreviewBeltConfig("belt-mood-seed", moodSceneProfile("reflective"));
    expect(dreamy.instanceCount ?? 0).toBeGreaterThan(reflective.instanceCount ?? 0);
  });

  it("rolls every comet count from 0 to 3 within the mirrored tail bounds", () => {
    const countsSeen = new Set<number>();
    for (let seedIndex = 0; seedIndex < 200; seedIndex += 1) {
      const comets = buildPreviewCometsConfig(`comets-bounds-${seedIndex}`);
      expect(comets.count).toBeGreaterThanOrEqual(0);
      expect(comets.count).toBeLessThanOrEqual(3);
      expect(comets.tailLengthMultiplier).toBeGreaterThanOrEqual(0.7);
      expect(comets.tailLengthMultiplier).toBeLessThanOrEqual(1.4);
      countsSeen.add(comets.count ?? 0);
    }
    expect(countsSeen).toEqual(new Set([0, 1, 2, 3]));
  });

  it("draws the sun from the temperature class table within HDR bounds", () => {
    const tintsSeen = new Set<string>();
    for (let seedIndex = 0; seedIndex < 200; seedIndex += 1) {
      const sun = buildPreviewSunConfig(`sun-bounds-${seedIndex}`);
      expect(SUN_SURFACE_TINTS).toContain(sun.surfaceTintColor);
      expect(sun.surfaceHdrMultiplier).toBeGreaterThanOrEqual(1.35);
      expect(sun.surfaceHdrMultiplier).toBeLessThanOrEqual(1.65);
      tintsSeen.add(sun.surfaceTintColor ?? "");
    }
    expect(tintsSeen.size).toBeGreaterThanOrEqual(2);
  });

  it("promotes the per-theme grade into postFX unchanged", () => {
    const cosmic = buildPreviewSceneConfig(diversityInputFor({ preferredWorldStyle: "cosmic-galaxy" }));
    const cyber = buildPreviewSceneConfig(diversityInputFor({ preferredWorldStyle: "cyber-orbit" }));
    expect(cosmic.postFX?.grade).toEqual(sceneGradeForTheme("cosmic-galaxy"));
    expect(cyber.postFX?.grade).toEqual(sceneGradeForTheme("cyber-orbit"));
    expect(cosmic.postFX?.grade).not.toEqual(cyber.postFX?.grade);
    expect(sceneGradeForTheme("not-a-theme")).toEqual({
      hueRadians: 0,
      saturation: 0.05,
      brightness: 0,
      contrast: 0.05
    });
  });

  it("did not shift the pre-diversity draws (own PRNG streams)", () => {
    // Belt/comets/sun draw from `${seed}-belt/-comets/-sun`; the main-stream
    // numbers (first planet) and the sky must stay reproducible exactly as
    // before the sections were added.
    const scene = buildPreviewSceneConfig(diversityInputFor());
    const independentRandom = randomFromSeed(scene.seed ?? "");
    const expectedFirstPlanetSize = Math.round((0.45 + independentRandom() * 0.8) * 100) / 100;
    expect(scene.planets?.[0]?.size).toBe(expectedFirstPlanetSize);
  });
});

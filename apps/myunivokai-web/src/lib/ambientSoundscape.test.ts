import { describe, expect, it } from "vitest";
import {
  ambientSoundscapeSignature,
  buildAmbientSoundscapeRecipe,
  SMALL_SPEAKER_BASS_FLOOR_MIDI,
  SMALL_SPEAKER_MELODY_FLOOR_MIDI
} from "./ambientSoundscape";
import { ARRANGEMENT_PIECE_IDS } from "@/features/audio/arrangements";
import { SAMPLED_INSTRUMENT_NOTE_NAMES } from "@/features/audio/instrumentSamples";
import type { SceneConfig } from "./types";

// The arranger's job is to turn a scene config into a performance: which written
// piece, who plays it, in what key and at what tempo. It is pure, so all of that
// is checkable here. What it SOUNDS like is not — that is settled by rendering
// the real graph offline and measuring, which is how three earlier versions were
// found to be wrong while their tests were green.

const UNIVERSE_THEMES = ["cosmic-galaxy", "nebula", "crystal", "aurora", "cyber-orbit"];
const FOREST_WEATHERS = ["clear", "sunRays", "overcast", "rain", "snow"];
const FOREST_SEASONS = ["spring", "summer", "autumn", "winter"];
const FOREST_TIMES_OF_DAY = ["day", "goldenHour", "dusk"];
const OCEAN_CURRENTS = ["still", "drift", "surge"];
const OCEAN_ZONES = ["sunlitShallows", "twilightReach", "abyss"];

const UNIVERSE_SCENE: SceneConfig = {
  seed: "seed-universe-001",
  theme: "cosmic-galaxy",
  postFX: { bloomIntensity: 1 }
};

function forestScene(overrides: Partial<SceneConfig> = {}): SceneConfig {
  return {
    seed: "seed-forest-001",
    sceneType: "forest",
    season: { kind: "summer" },
    lighting: { timeOfDay: "day" },
    weather: { kind: "clear", intensity: 0.5 },
    ...overrides
  };
}

function oceanScene(overrides: Partial<SceneConfig> = {}): SceneConfig {
  return {
    seed: "seed-ocean-001",
    sceneType: "ocean",
    depth: { metres: 16.7, zone: "sunlitShallows" },
    current: { kind: "drift", intensity: 0.5 },
    ...overrides
  };
}

function universeSceneWithPlanets(planetCount: number, energy: number): SceneConfig {
  return {
    seed: "dna-seed-001",
    theme: "aurora",
    planets: Array.from({ length: planetCount }, (_unused, planetIndex) => ({
      key: `planet-${planetIndex}`,
      energy
    }))
  };
}

/** Every scene the mapping tables can be reached through. */
function everySupportedScene(): SceneConfig[] {
  const universeScenes = UNIVERSE_THEMES.map((theme) => ({ seed: `sweep-${theme}`, theme }));
  const forestScenes = FOREST_WEATHERS.flatMap((weather) =>
    FOREST_SEASONS.flatMap((season) =>
      FOREST_TIMES_OF_DAY.map((timeOfDay) =>
        forestScene({
          seed: `sweep-${weather}-${season}-${timeOfDay}`,
          weather: { kind: weather, intensity: 0.7 },
          season: { kind: season },
          lighting: { timeOfDay }
        })
      )
    )
  );
  // The ocean sweep is here rather than only in its own describe block on
  // purpose: everything below - shipped samples, no doubled timbre, the gain
  // band, the register floors - is an invariant of the ARRANGER, not of a
  // family, and a family missing from this list is a family none of them cover.
  const oceanScenes = OCEAN_CURRENTS.flatMap((current) =>
    OCEAN_ZONES.map((zone) =>
      oceanScene({
        seed: `sweep-${current}-${zone}`,
        current: { kind: current, intensity: 0.7 },
        depth: { metres: 100, zone }
      })
    )
  );
  return [...universeScenes, ...forestScenes, ...oceanScenes];
}

describe("determinism", () => {
  it("returns an identical recipe for the same scene", () => {
    expect(buildAmbientSoundscapeRecipe(UNIVERSE_SCENE)).toEqual(buildAmbientSoundscapeRecipe(UNIVERSE_SCENE));
  });

  it("returns a different performance for a different seed", () => {
    const first = buildAmbientSoundscapeRecipe(UNIVERSE_SCENE);
    const second = buildAmbientSoundscapeRecipe({ ...UNIVERSE_SCENE, seed: "seed-universe-002" });
    expect(second.performanceSeed).not.toBe(first.performanceSeed);
    expect(second.space).not.toEqual(first.space);
  });

  it("builds a recipe for a missing scene instead of throwing", () => {
    const recipe = buildAmbientSoundscapeRecipe(undefined);
    expect(ARRANGEMENT_PIECE_IDS).toContain(recipe.performance.pieceId);
    expect(recipe.masterGain).toBeGreaterThan(0);
  });

  it("builds a recipe for an unknown theme instead of throwing", () => {
    const recipe = buildAmbientSoundscapeRecipe({ seed: "s", theme: "not-a-theme" });
    expect(ARRANGEMENT_PIECE_IDS).toContain(recipe.performance.pieceId);
  });
});

describe("the signature", () => {
  it("ignores changes the ear cannot hear", () => {
    const base = forestScene();
    expect(ambientSoundscapeSignature({ ...base, camera: { distance: 40 } })).toBe(ambientSoundscapeSignature(base));
  });

  it("changes when the sound has to change", () => {
    const base = forestScene();
    expect(ambientSoundscapeSignature(forestScene({ weather: { kind: "snow", intensity: 0.5 } }))).not.toBe(
      ambientSoundscapeSignature(base)
    );
    expect(ambientSoundscapeSignature(forestScene({ lighting: { timeOfDay: "dusk" } }))).not.toBe(
      ambientSoundscapeSignature(base)
    );
  });

  it("survives a scene with no seed at all", () => {
    expect(ambientSoundscapeSignature({})).toEqual(expect.any(String));
    expect(ambientSoundscapeSignature(undefined)).toEqual(expect.any(String));
  });
});

describe("which piece plays", () => {
  it("gives every universe theme and every forest weather a real piece", () => {
    for (const scene of everySupportedScene()) {
      expect(ARRANGEMENT_PIECE_IDS).toContain(buildAmbientSoundscapeRecipe(scene).performance.pieceId);
    }
  });

  it("gives different themes different music", () => {
    const pieces = UNIVERSE_THEMES.map(
      (theme) => buildAmbientSoundscapeRecipe({ seed: "same-seed", theme }).performance.pieceId
    );
    // Five themes, five distinct pieces: the point of the whole feature is that
    // a world sounds like itself, not like the last one.
    expect(new Set(pieces).size).toBe(UNIVERSE_THEMES.length);
  });

  it("gives different weathers different music", () => {
    const pieces = FOREST_WEATHERS.map(
      (weather) =>
        buildAmbientSoundscapeRecipe(forestScene({ weather: { kind: weather, intensity: 0.5 } })).performance.pieceId
    );
    expect(new Set(pieces).size).toBeGreaterThan(3);
  });

  it("keeps the piece stable when only the light changes", () => {
    const day = buildAmbientSoundscapeRecipe(forestScene({ lighting: { timeOfDay: "day" } }));
    const dusk = buildAmbientSoundscapeRecipe(forestScene({ lighting: { timeOfDay: "dusk" } }));
    // Dusk is the same forest later in the day, not a different forest.
    expect(dusk.performance.pieceId).toBe(day.performance.pieceId);
    expect(dusk.performance.transposeSemitones).toBeLessThan(day.performance.transposeSemitones);
  });
});

describe("who plays it", () => {
  it("always uses a sampled instrument we actually ship", () => {
    for (const scene of everySupportedScene()) {
      const { melody, harmony, bass } = buildAmbientSoundscapeRecipe(scene).performance;
      for (const voice of [melody, harmony, bass]) {
        expect(SAMPLED_INSTRUMENT_NOTE_NAMES[voice.instrument]?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("never doubles the melody instrument on the accompaniment", () => {
    // Two layers of one timbre read as a single muddled layer rather than as two.
    for (const scene of everySupportedScene()) {
      const { melody, harmony } = buildAmbientSoundscapeRecipe(scene).performance;
      expect(harmony.instrument).not.toBe(melody.instrument);
    }
  });

  it("plays the bass on the only instrument sampled low enough for it", () => {
    for (const scene of everySupportedScene()) {
      expect(buildAmbientSoundscapeRecipe(scene).performance.bass.instrument).toBe("pianoBass");
    }
  });
});

describe("the balance", () => {
  it("never lets the accompaniment come out louder than the tune", () => {
    // The per-instrument trims span 3x, so fixed layer gains alone do NOT settle
    // this: a recorder melody under a harp accompaniment measured the chords
    // half again as loud as the melody before the ratio ceilings were added.
    for (const scene of everySupportedScene()) {
      const { melody, harmony, bass } = buildAmbientSoundscapeRecipe(scene).performance;
      expect(harmony.gain).toBeLessThan(melody.gain);
      expect(bass.gain).toBeLessThan(melody.gain);
    }
  });

  it("keeps every gain in a sane band", () => {
    // The ceiling is not 1. Samples are peak-normalised to 0.92 and the master
    // gain scales the sum back down, so a quiet fast-decaying instrument earns a
    // per-note gain above unity: kalimba sits at 1.5 and the world it plays
    // renders at 0.57 peak. What would be wrong is a gain no measurement
    // justifies, which is what this bounds.
    const HIGHEST_JUSTIFIED_VOICE_GAIN = 2;
    for (const scene of everySupportedScene()) {
      const recipe = buildAmbientSoundscapeRecipe(scene);
      const { melody, harmony, bass } = recipe.performance;
      for (const voice of [melody, harmony, bass]) {
        expect(voice.gain).toBeGreaterThan(0.05);
        expect(voice.gain).toBeLessThanOrEqual(HIGHEST_JUSTIFIED_VOICE_GAIN);
      }
      expect(recipe.masterGain).toBeGreaterThan(0.2);
      expect(recipe.masterGain).toBeLessThanOrEqual(1);
    }
  });
});

describe("tempo", () => {
  it("stays slow enough to be ambience and fast enough to move", () => {
    for (const scene of everySupportedScene()) {
      const { beatsPerMinute } = buildAmbientSoundscapeRecipe(scene).performance;
      expect(beatsPerMinute).toBeGreaterThanOrEqual(30);
      expect(beatsPerMinute).toBeLessThanOrEqual(80);
    }
  });

  it("rises with the average energy of the world's points of interest", () => {
    const calm = buildAmbientSoundscapeRecipe(universeSceneWithPlanets(4, 10));
    const lively = buildAmbientSoundscapeRecipe(universeSceneWithPlanets(4, 95));
    expect(lively.performance.beatsPerMinute).toBeGreaterThan(calm.performance.beatsPerMinute);
    // Same piece, so this is a tempo difference and not a different recording.
    expect(lively.performance.pieceId).toBe(calm.performance.pieceId);
  });
});

describe("key", () => {
  it("transposes within a range that keeps the piece in its own register", () => {
    for (const scene of everySupportedScene()) {
      const { transposeSemitones } = buildAmbientSoundscapeRecipe(scene).performance;
      expect(transposeSemitones).toBeGreaterThanOrEqual(-7);
      expect(transposeSemitones).toBeLessThanOrEqual(4);
      expect(Number.isInteger(transposeSemitones)).toBe(true);
    }
  });

  it("drops the key toward winter and toward dusk", () => {
    const summerDay = buildAmbientSoundscapeRecipe(
      forestScene({ season: { kind: "summer" }, lighting: { timeOfDay: "day" } })
    );
    const winterDusk = buildAmbientSoundscapeRecipe(
      forestScene({ season: { kind: "winter" }, lighting: { timeOfDay: "dusk" } })
    );
    expect(winterDusk.performance.transposeSemitones).toBeLessThan(summerDay.performance.transposeSemitones);
  });

  it("leaves the universe family at the key the seed rolled", () => {
    // Universe scenes have no season and no time of day, so nothing but the seed
    // may move the key — a theme is not a mood.
    const transpositions = UNIVERSE_THEMES.map(
      (theme) => buildAmbientSoundscapeRecipe({ seed: "one-seed", theme }).performance.transposeSemitones
    );
    expect(new Set(transpositions).size).toBe(1);
  });
});

describe("how full the accompaniment is", () => {
  it("thickens the chords as the world gains points of interest", () => {
    const sparse = buildAmbientSoundscapeRecipe(universeSceneWithPlanets(2, 50));
    const full = buildAmbientSoundscapeRecipe(universeSceneWithPlanets(7, 50));
    expect(full.performance.harmony.noteKeepRatio).toBeGreaterThan(sparse.performance.harmony.noteKeepRatio);
  });

  it("never thins the melody or the bass", () => {
    for (const pointCount of [0, 1, 2, 5, 9, 40]) {
      const { melody, bass } = buildAmbientSoundscapeRecipe(universeSceneWithPlanets(pointCount, 50)).performance;
      expect(melody.noteKeepRatio).toBe(1);
      expect(bass.noteKeepRatio).toBe(1);
    }
  });

  it("keeps the keep ratio a real fraction whatever the DNA says", () => {
    for (const pointCount of [0, 1, 3, 12, 100]) {
      const { harmony } = buildAmbientSoundscapeRecipe(universeSceneWithPlanets(pointCount, 50)).performance;
      expect(harmony.noteKeepRatio).toBeGreaterThan(0);
      expect(harmony.noteKeepRatio).toBeLessThanOrEqual(1);
    }
  });
});

describe("audibility on the hardware people have", () => {
  // The first version of this feature shipped MUTE on a laptop: every voice sat
  // between 47 and 106 Hz. All 36 tests were green — they checked determinism and
  // numeric bounds and never asked whether the output lands where a speaker can
  // reproduce it. These are that missing question.
  it("keeps both register floors where a small speaker can reach them", () => {
    // A recording is not a sine: a harp at 98 Hz carries partials the ear can
    // reconstruct a fundamental from, so the supporting line may sit lower than
    // the tune. Both floors still have to clear the ~150 Hz rolloff by enough
    // to be heard at all, which is why the melody's is the higher one.
    expect(SMALL_SPEAKER_MELODY_FLOOR_MIDI).toBeGreaterThan(SMALL_SPEAKER_BASS_FLOOR_MIDI);
    expect(SMALL_SPEAKER_BASS_FLOOR_MIDI).toBeGreaterThanOrEqual(43);
  });

  it("never uses a blown instrument as the accompaniment", () => {
    // A recorder or saxophone holds its full level for the written duration, so
    // under a plucked melody it always wins: kalimba under recorder measured
    // 0.0084 RMS against the accompaniment's 0.0490. Struck and plucked
    // instruments decay, which is what lets a chord part sit underneath.
    const BLOWN_INSTRUMENTS = ["recorder", "saxello"];
    for (const scene of everySupportedScene()) {
      const { harmony } = buildAmbientSoundscapeRecipe(scene).performance;
      expect(BLOWN_INSTRUMENTS).not.toContain(harmony.instrument);
    }
  });

  it("never sends the noise bed below where the music lives", () => {
    for (const scene of everySupportedScene()) {
      const recipe = buildAmbientSoundscapeRecipe(scene);
      expect(recipe.bedFilterFrequencyHertz - recipe.bedSweepDepthHertz).toBeGreaterThan(0);
    }
  });

  it("keeps the bed quiet enough to sit under the music", () => {
    for (const scene of everySupportedScene()) {
      const recipe = buildAmbientSoundscapeRecipe(scene);
      // Rain once measured 52% of all energy above 1200 Hz: hiss burying the
      // music it was supposed to sit under.
      expect(recipe.bedGain).toBeLessThan(recipe.performance.melody.gain * 0.5);
    }
  });

  it("leaves the tone filter open enough to hear the instrument through", () => {
    for (const scene of everySupportedScene()) {
      const recipe = buildAmbientSoundscapeRecipe(scene);
      expect(recipe.toneCutoffHertz).toBeGreaterThanOrEqual(900);
      expect(recipe.toneCutoffHertz).toBeLessThanOrEqual(12000);
    }
  });
});

describe("the room", () => {
  it("always puts the instruments in a space, never dry", () => {
    for (const scene of everySupportedScene()) {
      const { space } = buildAmbientSoundscapeRecipe(scene);
      expect(space.reverbDecaySeconds).toBeGreaterThan(1);
      expect(space.reverbWetMix).toBeGreaterThan(0.1);
      expect(space.delayMix).toBeGreaterThan(0);
      // Feedback at or above 1 is a runaway that never decays.
      expect(space.delayFeedback).toBeLessThan(0.7);
    }
  });

  it("brightens the room as the scene blooms", () => {
    const dim = buildAmbientSoundscapeRecipe({ ...UNIVERSE_SCENE, postFX: { bloomIntensity: 0.3 } });
    const bright = buildAmbientSoundscapeRecipe({ ...UNIVERSE_SCENE, postFX: { bloomIntensity: 1.9 } });
    expect(bright.toneCutoffHertz).toBeGreaterThan(dim.toneCutoffHertz);
  });

  it("keeps the humanising window small enough to stay in time", () => {
    for (const scene of everySupportedScene()) {
      const { humanizeSeconds } = buildAmbientSoundscapeRecipe(scene).performance;
      // Enough to stop it reading as a MIDI file, not enough to blur the pulse.
      expect(humanizeSeconds).toBeGreaterThan(0);
      expect(humanizeSeconds).toBeLessThan(0.05);
    }
  });

  it("keeps the stereo image inside the field", () => {
    for (const scene of everySupportedScene()) {
      const { maximumPan, startPositionRatio } = buildAmbientSoundscapeRecipe(scene).performance;
      expect(maximumPan).toBeGreaterThan(0);
      expect(maximumPan).toBeLessThan(0.5);
      expect(startPositionRatio).toBeGreaterThanOrEqual(0);
      expect(startPositionRatio).toBeLessThan(1);
    }
  });
});

describe("the forest bed follows the weather", () => {
  it("makes rain louder and brighter than snow", () => {
    const rain = buildAmbientSoundscapeRecipe(forestScene({ weather: { kind: "rain", intensity: 1 } }));
    const snow = buildAmbientSoundscapeRecipe(forestScene({ weather: { kind: "snow", intensity: 1 } }));
    expect(rain.bedGain).toBeGreaterThan(snow.bedGain);
    expect(rain.bedFilterFrequencyHertz).toBeGreaterThan(snow.bedFilterFrequencyHertz);
  });

  it("fades the weather out as its intensity drops to zero", () => {
    const calm = buildAmbientSoundscapeRecipe(forestScene({ weather: { kind: "rain", intensity: 0 } }));
    const storm = buildAmbientSoundscapeRecipe(forestScene({ weather: { kind: "rain", intensity: 1 } }));
    expect(storm.bedGain).toBeGreaterThan(calm.bedGain);
  });

  it("uses a bandpass for foliage and a lowpass for open space", () => {
    expect(buildAmbientSoundscapeRecipe(forestScene()).bedFilterType).toBe("bandpass");
    expect(buildAmbientSoundscapeRecipe(UNIVERSE_SCENE).bedFilterType).toBe("lowpass");
  });

  it("survives a scene whose weather fields are the wrong shape", () => {
    const recipe = buildAmbientSoundscapeRecipe(
      forestScene({ weather: { kind: 42, intensity: "heavy" } } as unknown as Partial<SceneConfig>)
    );
    expect(Number.isFinite(recipe.bedGain)).toBe(true);
    expect(Number.isFinite(recipe.performance.beatsPerMinute)).toBe(true);
  });
});

// The ocean family arrived after a boolean `isForest` had been threaded through
// three resolvers. A boolean has two answers, so an ocean scene was silently
// arranged as a solar system - the right notes over a lowpass space bed, under
// a sea. Nothing failed, because nothing asserted what a third family sounded
// like. These are that assertion.
describe("the ocean family", () => {
  it("is arranged from its own tables, not the universe's", () => {
    const ocean = buildAmbientSoundscapeRecipe(oceanScene());
    const universe = buildAmbientSoundscapeRecipe({ ...UNIVERSE_SCENE, seed: "seed-ocean-001" });
    expect(ocean.bedFilterType).toBe("bandpass");
    expect(universe.bedFilterType).toBe("lowpass");
    expect(ocean.performance.pieceId).not.toBe(universe.performance.pieceId);
  });

  it("gives every current a real piece and a real instrument", () => {
    for (const kind of OCEAN_CURRENTS) {
      const recipe = buildAmbientSoundscapeRecipe(oceanScene({ current: { kind, intensity: 0.5 } }));
      expect(ARRANGEMENT_PIECE_IDS).toContain(recipe.performance.pieceId);
      expect(SAMPLED_INSTRUMENT_NOTE_NAMES[recipe.performance.melody.instrument]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("gives different currents different music", () => {
    const pieces = new Set(
      OCEAN_CURRENTS.map(
        (kind) => buildAmbientSoundscapeRecipe(oceanScene({ current: { kind, intensity: 0.5 } })).performance.pieceId
      )
    );
    expect(pieces.size).toBeGreaterThan(1);
  });

  // The one musical idea this family gets for free: going deeper and going
  // lower are the same gesture.
  it("drops the key as the world goes deeper", () => {
    const keys = OCEAN_ZONES.map(
      (zone) =>
        buildAmbientSoundscapeRecipe(oceanScene({ depth: { metres: 100, zone } })).performance.transposeSemitones
    );
    expect(keys[1]).toBeLessThan(keys[0]);
    expect(keys[2]).toBeLessThan(keys[1]);
  });

  // Still water is not louder than surge, and the abyss is not busier than the
  // reef. A bed that ignored the current would make all three sound the same.
  it("opens the bed with the current", () => {
    const still = buildAmbientSoundscapeRecipe(oceanScene({ current: { kind: "still", intensity: 1 } }));
    const surge = buildAmbientSoundscapeRecipe(oceanScene({ current: { kind: "surge", intensity: 1 } }));
    expect(surge.bedGain).toBeGreaterThan(still.bedGain);
    expect(surge.bedFilterFrequencyHertz).toBeGreaterThan(still.bedFilterFrequencyHertz);
    expect(surge.bedSweepRateHertz).toBeGreaterThan(still.bedSweepRateHertz);
  });

  it("changes its signature when the depth or the current changes", () => {
    const base = ambientSoundscapeSignature(oceanScene());
    expect(ambientSoundscapeSignature(oceanScene({ depth: { metres: 2400, zone: "abyss" } }))).not.toBe(base);
    expect(ambientSoundscapeSignature(oceanScene({ current: { kind: "surge", intensity: 0.5 } }))).not.toBe(base);
  });

  it("survives a config with no depth and no current instead of throwing", () => {
    const recipe = buildAmbientSoundscapeRecipe({ seed: "seed-ocean-bare", sceneType: "ocean" });
    expect(ARRANGEMENT_PIECE_IDS).toContain(recipe.performance.pieceId);
    expect(recipe.bedFilterType).toBe("bandpass");
  });
});

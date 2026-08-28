import type { ArrangementPieceId } from "@/features/audio/arrangements";
import type { SampledInstrumentKey } from "@/features/audio/instrumentSamples";
import { isForestScene, isOceanScene, pointsOfInterestFromScene, randomFromSeed } from "./scene";
import { depthAt } from "./oceanDepthCurve";
import type { SceneConfig } from "./types";

// --- Ambient soundscape recipe -----------------------------------------------
//
// Which written piece the world plays, who plays it, in what key, at what tempo
// and in what room — all derived from the SAME seed and the SAME DNA-shaped
// fields the visuals use. Nothing here touches the Web Audio API or the network,
// so this half is unit-testable in a node environment.
//
// Rules carried over from the scene builders:
//
// 1. `Math.random()` is banned. Every rolled value comes from randomFromSeed on
//    a dedicated stream suffix, so the same world always sounds the same, and
//    adding an audio roll can never shift a visual roll.
// 2. Character comes from the config the backend already produced:
//
//      universe theme                ->  the piece, and the melody instrument
//      forest weather                ->  the piece, the instrument, the bed
//      forest season + time of day   ->  how far the key is transposed
//      average point energy          ->  the tempo
//      how many planets / landmarks  ->  how full the chords are
//      postFX bloom                  ->  how open the tone filter sits
//      ocean depth                   ->  how open the tone filter sits, and
//                                         how loud the environmental bed is
//
// FOUR ATTEMPTS, because the reasoning is worth not repeating:
//
// 1. A pad of low sine oscillators. Inaudible on laptop speakers — everything
//    sat under 110 Hz. All 36 tests passed.
// 2. The same pad raised, plus oscillator-synthesised bell and pluck notes.
//    Rejected as a harsh sustained tone whose layers never blended. Rendering
//    the layers in isolation confirmed it: the pad measured 4.3x the melody.
// 3. Recorded instruments playing notes drawn from a pentatonic scale at rolled
//    gaps. The instruments were accepted; the music was rejected as disjointed,
//    and that was correct. A consonant note at a random gap gives a note
//    SEQUENCE. A melody needs a motif that returns, phrases that breathe, a
//    pulse to sit on and a cadence to land on — none of which was there.
// 4. This one. Real written compositions, in the public domain, performed by the
//    sampled instruments. The arranger decides which piece and how; the piece
//    decides what the notes are.
//
// The lesson is the same one notes/fe/3d-development-limitations.md recorded for
// the visuals, applied twice over: the algorithm is the cheap part. First the
// sound had to come from a recording instead of an oscillator, and then the
// notes had to come from a composer instead of a random number generator.

export type AmbientBedFilterType = "lowpass" | "bandpass";

/** Every instrument except the bass, which is only ever the low piano. */
export type MelodyInstrumentKey = Exclude<SampledInstrumentKey, "pianoBass">;

/**
 * One line of the score and who plays it. `noteKeepRatio` below 1 drops whole
 * chords rather than individual notes — a thinner accompaniment, never a broken
 * one.
 */
export type AmbientVoiceRecipe = {
  instrument: SampledInstrumentKey;
  gain: number;
  noteKeepRatio: number;
};

export type AmbientPerformanceRecipe = {
  pieceId: ArrangementPieceId;
  beatsPerMinute: number;
  transposeSemitones: number;
  /**
   * Where in the piece to open, as a fraction of its length. The graph snaps
   * this to a four-bar boundary so a world never starts mid-phrase.
   */
  startPositionRatio: number;
  /** Timing jitter, so it does not read as a MIDI file playing back. */
  humanizeSeconds: number;
  /** Spread across the stereo field. Written music needs less than a generator. */
  maximumPan: number;
  bass: AmbientVoiceRecipe;
  harmony: AmbientVoiceRecipe;
  melody: AmbientVoiceRecipe;
};

export type AmbientSpaceRecipe = {
  reverbDecaySeconds: number;
  reverbWetMix: number;
  delayTimeSeconds: number;
  delayFeedback: number;
  delayMix: number;
};

export type AmbientSoundscapeRecipe = {
  /** Stable identity of this recipe; use it as a React effect dependency. */
  signature: string;
  masterGain: number;
  performance: AmbientPerformanceRecipe;
  /** Gentle lowpass over every instrument layer: the scene's brightness. */
  toneCutoffHertz: number;
  /** Environmental noise under the music — air, or wind in foliage. */
  bedGain: number;
  bedFilterType: AmbientBedFilterType;
  bedFilterFrequencyHertz: number;
  bedFilterQuality: number;
  bedSweepRateHertz: number;
  bedSweepDepthHertz: number;
  bedNoiseSeed: string;
  space: AmbientSpaceRecipe;
  /** Seed for the reverb impulse response and every performance roll. */
  performanceSeed: string;
};

const AMBIENT_AUDIO_SEED_SUFFIX = "-ambient-audio";
const BED_NOISE_SEED_SUFFIX = "-ambient-bed";
const PERFORMANCE_SEED_SUFFIX = "-ambient-performance";

const FALLBACK_SCENE_SEED = "myunivokai-silent";
const UNIVERSE_FAMILY_KEY = "universe";
const FOREST_FAMILY_KEY = "forest";
const OCEAN_FAMILY_KEY = "ocean";

/**
 * Which family's tables a scene is arranged from.
 *
 * This replaced an `isForest: boolean` threaded through three resolvers. A
 * boolean has exactly two answers, so an ocean world arrived as "not forest"
 * and was arranged as a solar system - a lowpass space bed under a sea. That
 * failed no test, because nothing asserted what a third family sounded like.
 */
type AmbientFamily = typeof UNIVERSE_FAMILY_KEY | typeof FOREST_FAMILY_KEY | typeof OCEAN_FAMILY_KEY;

function ambientFamilyForScene(scene: SceneConfig): AmbientFamily {
  if (isForestScene(scene)) {
    return FOREST_FAMILY_KEY;
  }
  if (isOceanScene(scene)) {
    return OCEAN_FAMILY_KEY;
  }
  return UNIVERSE_FAMILY_KEY;
}

const MASTER_GAIN = 0.6;

// Per-piece level trim, measured by rendering every world offline and comparing
// RMS. Nothing else settles this: loudness here is driven by how many notes a
// piece has per bar far more than by any gain, and the twelve span 4x — Bach's
// BWV 870 is 833 notes in 34 bars where Gymnopédie No. 3 is 326 in 60. Without
// these, moving between worlds on the create page steps in volume.
//
// Not guessable from note density either, which is why every one of these is a
// measurement: Bach's BWV 846 is 15.7 notes a bar and trims to 0.87, Clair de
// Lune is 20.5 and trims UP to 1.09.
const PIECE_LEVEL_TRIM: Record<ArrangementPieceId, number> = {
  "satie-gymnopedie-1": 0.89,
  "satie-gymnopedie-2": 1.28,
  "satie-gymnopedie-3": 1.19,
  "bach-prelude-c-major": 0.87,
  // 0.8 rather than the 0.87 that would match its RMS: BWV 870 renders the
  // highest peak in the catalogue at 0.73, and headroom is worth the 1 dB.
  "bach-wtc2-prelude-c-major": 0.8,
  "chopin-prelude-e-minor": 0.99,
  "chopin-prelude-raindrop": 0.97,
  "debussy-arabesque-1": 0.73,
  "debussy-clair-de-lune": 1.09,
  // Träumerei is the loudest of the twelve untrimmed — a thick four-voice
  // texture in the middle of the register, where nothing masks anything.
  "schumann-traumerei": 0.66,
  "scriabin-prelude-op11-1": 0.92,
  "tchaikovsky-seasons-january": 0.86
};

// REGISTER. Laptop and phone speakers roll off steeply below ~150 Hz. The first
// version put every voice under 110 Hz and shipped mute with a green suite.
//
// Two floors, because a recording is not a sine. A sine at 110 Hz on a laptop
// speaker is silence: there is nothing but the fundamental, and the speaker
// cannot produce it. A recorded piano at the same pitch carries partials at 220,
// 330, 440 Hz, and the ear reconstructs the missing fundamental from them. So
// the bass, which is harmonically rich and only ever supporting, may sit lower
// than the melody, which has to be heard as the tune.
//
// These matter more now than they did: the written scores reach down to MIDI 27,
// which is 44 Hz and simply gone on the hardware most visitors have.
export const SMALL_SPEAKER_MELODY_FLOOR_MIDI = 52; // E3, about 165 Hz
export const SMALL_SPEAKER_BASS_FLOOR_MIDI = 43; // G2, about 98 Hz

// --- Which piece, and who plays it -------------------------------------------
//
// All six are Public Domain, composition and engraving both. See
// public/assets/audio/arrangements/ATTRIBUTION.md.

type MusicalIdentity = { pieceId: ArrangementPieceId; instrument: MelodyInstrumentKey };

const UNIVERSE_IDENTITY_BY_THEME: Record<string, MusicalIdentity> = {
  // Bach's arpeggios are pure geometry, which is what a crystal world is.
  crystal: { pieceId: "bach-prelude-c-major", instrument: "glockenspiel" },
  // Debussy's Arabesque is a curtain of light moving in one direction.
  aurora: { pieceId: "debussy-arabesque-1", instrument: "piano" },
  "cosmic-galaxy": { pieceId: "satie-gymnopedie-2", instrument: "harp" },
  // Träumerei is literally "Dreaming", and the dreamy mood is the one that
  // builds a nebula. Satie sat here before, which meant the softest theme in
  // the family and its most ordinary one played the same tune.
  nebula: { pieceId: "schumann-traumerei", instrument: "vibraphone" },
  // Scriabin's Op. 11 No. 1 runs five notes against three for its whole length:
  // two rates that never line up, which is what an orbit full of machinery is.
  "cyber-orbit": { pieceId: "scriabin-prelude-op11-1", instrument: "saxello" }
};

const DEFAULT_UNIVERSE_IDENTITY: MusicalIdentity = {
  pieceId: "satie-gymnopedie-1",
  instrument: "harp"
};

const FOREST_IDENTITY_BY_WEATHER: Record<string, MusicalIdentity> = {
  // Kalimba gets Bach, not Satie. It is a short plucked ping: playing the same
  // Gymnopédie notes it measured 0.0084 RMS where a vibraphone measured 0.0704,
  // eight times quieter, and no gain fixes that without clipping the individual
  // notes. Running sixteenths keep a fast-decaying instrument sounding.
  //
  // BWV 870 was tried here to free 846 up, and measured the accompaniment
  // LOUDER than the tune at 0.70x. 846 is almost bare — 67 bass and 70 harmony
  // notes against 412 melody — which is the actual reason the kalimba survives
  // it, and 870 has 376 harmony against 262 melody. It went to ocean/surge.
  clear: { pieceId: "bach-prelude-c-major", instrument: "kalimba" },
  sunRays: { pieceId: "debussy-clair-de-lune", instrument: "harp" },
  // Chopin's E minor prelude is a descending chromatic line over chords that
  // barely change: grey, low and heavy without being sad about it.
  //
  // Recorder, not the piano this slot used to take. The piece is 77 melody
  // notes under 350 accompaniment ones, so a decaying melody instrument loses
  // it outright — measured 0.77x with piano, 0.75x with glockenspiel, 0.90x
  // with saxello. A blown instrument holds its full level for the written
  // duration, which is exactly the property that bars it from ACCOMPANYING and
  // exactly what a melody this sparse needs. 1.30x.
  overcast: { pieceId: "chopin-prelude-e-minor", instrument: "recorder" },
  // The Raindrop, and not for the nickname: the repeated A-flat runs unbroken
  // under the whole piece, which is what rain on a canopy actually is.
  rain: { pieceId: "chopin-prelude-raindrop", instrument: "recorder" },
  // "By the Hearth" — Tchaikovsky's January, written for a Petersburg winter.
  snow: { pieceId: "tchaikovsky-seasons-january", instrument: "glockenspiel" }
};

const DEFAULT_FOREST_IDENTITY: MusicalIdentity = {
  pieceId: "satie-gymnopedie-1",
  instrument: "kalimba"
};

// Keyed by the current, which is the ocean's counterpart of the forest's
// weather. Still water gets the slowest piece in the catalogue and the
// longest-ringing instrument, because that is what a motionless sea sounds
// like; surge gets the running sixteenths.
const OCEAN_IDENTITY_BY_CURRENT: Record<string, MusicalIdentity> = {
  still: { pieceId: "satie-gymnopedie-3", instrument: "vibraphone" },
  drift: { pieceId: "debussy-clair-de-lune", instrument: "harp" },
  // BWV 870 rather than 846: the same running motion, half again as many notes
  // under each attack, and it leaves 846 to the crystal universe alone.
  //
  // Piano, not the glockenspiel this slot used to take. 870 carries 376 harmony
  // notes against 262 melody ones and a bell has nothing to hold a line with
  // through that — measured 1.03x, a tune that is technically ahead and not
  // audibly so. A piano is the one melody instrument that both decays (so it
  // can sit over a moving accompaniment) and has body enough to stay on top.
  surge: { pieceId: "bach-wtc2-prelude-c-major", instrument: "piano" }
};
const DEFAULT_OCEAN_IDENTITY: MusicalIdentity = {
  pieceId: "debussy-clair-de-lune",
  instrument: "harp"
};

// The harmony instrument is always softer and longer-ringing than the melody it
// sits under, and never the same one — two layers of a single timbre read as one
// muddled layer rather than as two.
// Never a blown instrument. A recorder or a saxophone holds its full level for
// as long as the note is written, so as an accompaniment under a plucked melody
// it always wins: kalimba under recorder rendered at 0.0084 RMS against the
// accompaniment's 0.0490 — a melody effectively gone. Struck and plucked
// instruments decay, which is what lets a chord part sit underneath.
const HARMONY_INSTRUMENT_BY_MELODY: Record<MelodyInstrumentKey, SampledInstrumentKey> = {
  piano: "vibraphone",
  harp: "vibraphone",
  glockenspiel: "harp",
  vibraphone: "harp",
  kalimba: "harp",
  recorder: "harp",
  saxello: "vibraphone"
};

// One instrument for the bass everywhere. Every other sampled instrument starts
// at C4 and the scores go down to MIDI 27; a low piano under a harp or a
// glockenspiel is also just what an arranger would write.
const BASS_INSTRUMENT: SampledInstrumentKey = "pianoBass";

// --- Tempo -------------------------------------------------------------------
//
// An arrangement decision, not a property of the score, which is why it lives
// here rather than in the note data. Satie already wrote "lent"; Debussy's
// Arabesque is marked 144 and has to come a long way down to become ambience,
// and Bach's sixteenths would be four notes a second at the written tempo.
//
// Ranges are set to land the whole set at roughly one to four note onsets per
// second, which is the density the offline render measures.

type TempoRange = { minimumBeatsPerMinute: number; maximumBeatsPerMinute: number };

const PERFORMANCE_TEMPO_BY_PIECE: Record<ArrangementPieceId, TempoRange> = {
  "satie-gymnopedie-1": { minimumBeatsPerMinute: 44, maximumBeatsPerMinute: 58 },
  "satie-gymnopedie-2": { minimumBeatsPerMinute: 46, maximumBeatsPerMinute: 60 },
  "satie-gymnopedie-3": { minimumBeatsPerMinute: 44, maximumBeatsPerMinute: 56 },
  "bach-prelude-c-major": { minimumBeatsPerMinute: 34, maximumBeatsPerMinute: 46 },
  // 6.1 notes a beat against BWV 846's 3.9, but the same 3.9 distinct ONSETS a
  // beat — the extra notes are chord tones under the same attacks. Onsets are
  // what the kalimba needs to keep sounding, so it sits close to BWV 846 rather
  // than being slowed to match a note count that is not what is heard.
  "bach-wtc2-prelude-c-major": { minimumBeatsPerMinute: 30, maximumBeatsPerMinute: 40 },
  "chopin-prelude-e-minor": { minimumBeatsPerMinute: 24, maximumBeatsPerMinute: 32 },
  "chopin-prelude-raindrop": { minimumBeatsPerMinute: 32, maximumBeatsPerMinute: 42 },
  "debussy-arabesque-1": { minimumBeatsPerMinute: 52, maximumBeatsPerMinute: 68 },
  "debussy-clair-de-lune": { minimumBeatsPerMinute: 40, maximumBeatsPerMinute: 52 },
  "schumann-traumerei": { minimumBeatsPerMinute: 34, maximumBeatsPerMinute: 46 },
  // Written Vivace at 140 and played at a fifth of that. Op. 11 No. 1 is five
  // notes against three, and slow is the only speed at which that reads as two
  // rates drifting rather than as a scramble.
  "scriabin-prelude-op11-1": { minimumBeatsPerMinute: 26, maximumBeatsPerMinute: 36 },
  "tchaikovsky-seasons-january": { minimumBeatsPerMinute: 26, maximumBeatsPerMinute: 36 }
};

// --- Key ---------------------------------------------------------------------
//
// Transposing is what a musician would do to change the mood of a piece, and
// unlike detuning it keeps every note in tune with every other one.

const SEASON_TRANSPOSE_SEMITONES: Record<string, number> = {
  spring: 0,
  summer: 2,
  autumn: -3,
  winter: -5
};

const TIME_OF_DAY_TRANSPOSE_SEMITONES: Record<string, number> = {
  day: 0,
  goldenHour: -2,
  dusk: -5
};
// Depth transposes downward, which is the one musical idea this family gets for
// free: going deeper and going lower are the same gesture, and a listener hears
// it without being told what it means.
const DEPTH_ZONE_TRANSPOSE_SEMITONES: Record<string, number> = {
  sunlitShallows: 0,
  twilightReach: -4,
  abyss: -9
};

const SEED_TRANSPOSE_CHOICES = [-2, 0, 0, 2, 3];
const MINIMUM_TRANSPOSE_SEMITONES = -7;
const MAXIMUM_TRANSPOSE_SEMITONES = 4;

// Only these, and each snapped to a four-bar boundary by the graph, so a world
// opens on a downbeat at the start of a phrase rather than in the middle of one.
const START_POSITION_RATIO_CHOICES = [0, 0, 0.25, 0.5];

// --- Levels ------------------------------------------------------------------

const MELODY_GAIN = 0.5;
const HARMONY_GAIN = 0.3;
const BASS_GAIN = 0.34;

// Per-instrument level trim, measured by rendering each world offline and
// comparing RMS. A sustained reed holds its level for three seconds where a
// plucked kalimba is gone in one, so equal gains are not equal loudness: the
// spread across instruments was 3x before these.
const INSTRUMENT_LEVEL_TRIM: Record<SampledInstrumentKey, number> = {
  harp: 1.7,
  piano: 1.75,
  pianoBass: 1.0,
  glockenspiel: 1.3,
  vibraphone: 1.2,
  kalimba: 3,
  recorder: 0.63,
  saxello: 0.6
};

// The accompaniment must never come out louder than the tune. The trims above
// span 3x, so multiplying them by fixed layer gains does not settle the balance
// on its own: a recorder melody (trim 0.63) under a harp accompaniment (1.7)
// would put the chords half again as loud as the melody they support. That is
// exactly the fault that made the second attempt a sustained tone with a tune
// buried under it, arriving by a different route.
const MAXIMUM_HARMONY_TO_MELODY_GAIN_RATIO = 0.7;
const MAXIMUM_BASS_TO_MELODY_GAIN_RATIO = 0.8;

// How full the accompaniment is. A world with three interests gets a thinner
// chord bed than one with seven; the melody and the bass are never thinned.
const MINIMUM_HARMONY_KEEP_RATIO = 0.45;
const MAXIMUM_HARMONY_KEEP_RATIO = 1;
const HARMONY_KEEP_RATIO_POINT_COUNT_FULL = 7;

const MINIMUM_HUMANIZE_SECONDS = 0.012;
const HUMANIZE_SPREAD_SECONDS = 0.026;
const MINIMUM_MAXIMUM_PAN = 0.16;
const MAXIMUM_PAN_SPREAD = 0.14;

// --- Tone and space ----------------------------------------------------------

const BASE_TONE_CUTOFF_HERTZ = 4200;
const MINIMUM_TONE_CUTOFF_HERTZ = 900;
const MAXIMUM_TONE_CUTOFF_HERTZ = 12000;
const MINIMUM_ENERGY_TONE_MULTIPLIER = 0.62;
const ENERGY_TONE_MULTIPLIER_SPREAD = 0.7;
const TONE_JITTER_RATIO = 0.15;

const NEUTRAL_BLOOM_INTENSITY = 1;
const BLOOM_TONE_INFLUENCE = 0.3;
const MINIMUM_BLOOM_INTENSITY = 0.2;
const MAXIMUM_BLOOM_INTENSITY = 2;

// Depth reads as one physical axis across sight and sound: the same
// `depthAt().brightness` that dims color, fog and god-rays also muffles and
// quiets the mix. Both multipliers are 1 at the surface (brightness 1) —
// unchanged from a depthless scene — and fall toward their floor in the
// abyss (brightness 0). No independent depth-to-audio table: `depthAt` is
// the only source of truth for what a given depth sounds/looks like.
const OCEAN_DEPTH_TONE_MULTIPLIER_FLOOR = 0.35;
const OCEAN_DEPTH_BED_GAIN_MULTIPLIER_FLOOR = 0.5;

const MINIMUM_REVERB_DECAY_SECONDS = 3;
const REVERB_DECAY_SPREAD_SECONDS = 3;
const MINIMUM_REVERB_WET_MIX = 0.3;
const REVERB_WET_MIX_SPREAD = 0.18;
const MINIMUM_DELAY_TIME_SECONDS = 0.3;
const DELAY_TIME_SPREAD_SECONDS = 0.32;
const MINIMUM_DELAY_FEEDBACK = 0.18;
const DELAY_FEEDBACK_SPREAD = 0.16;
const MINIMUM_DELAY_MIX = 0.1;
const DELAY_MIX_SPREAD = 0.12;

// --- Environmental bed -------------------------------------------------------

type BedCharacter = {
  gain: number;
  filterType: AmbientBedFilterType;
  filterFrequencyHertz: number;
  filterQuality: number;
  sweepRateHertz: number;
  sweepDepthHertz: number;
};

const UNIVERSE_BED_BY_THEME: Record<string, BedCharacter> = {
  "cosmic-galaxy": {
    gain: 0.05,
    filterType: "lowpass",
    filterFrequencyHertz: 700,
    filterQuality: 0.6,
    sweepRateHertz: 0.035,
    sweepDepthHertz: 220
  },
  nebula: {
    gain: 0.055,
    filterType: "lowpass",
    filterFrequencyHertz: 600,
    filterQuality: 0.5,
    sweepRateHertz: 0.028,
    sweepDepthHertz: 190
  },
  crystal: {
    gain: 0.038,
    filterType: "lowpass",
    filterFrequencyHertz: 1100,
    filterQuality: 0.9,
    sweepRateHertz: 0.05,
    sweepDepthHertz: 320
  },
  aurora: {
    gain: 0.052,
    filterType: "lowpass",
    filterFrequencyHertz: 900,
    filterQuality: 0.7,
    sweepRateHertz: 0.04,
    sweepDepthHertz: 260
  },
  "cyber-orbit": {
    gain: 0.05,
    filterType: "lowpass",
    filterFrequencyHertz: 850,
    filterQuality: 1.1,
    sweepRateHertz: 0.07,
    sweepDepthHertz: 300
  }
};

const DEFAULT_UNIVERSE_BED: BedCharacter = UNIVERSE_BED_BY_THEME["cosmic-galaxy"];

const FOREST_BASE_BED: BedCharacter = {
  gain: 0.075,
  filterType: "bandpass",
  filterFrequencyHertz: 900,
  filterQuality: 0.9,
  sweepRateHertz: 0.1,
  sweepDepthHertz: 300
};

// Water is a close, filtered space: a bandpass bed like the forest's, but lower,
// quieter and slower. The abyss is not louder than the reef - it is emptier,
// which the current modifiers below are what express.
const OCEAN_BASE_BED: BedCharacter = {
  gain: 0.068,
  filterType: "bandpass",
  filterFrequencyHertz: 520,
  filterQuality: 1.1,
  sweepRateHertz: 0.045,
  sweepDepthHertz: 180
};

type WeatherBedModifier = {
  gainMultiplier: number;
  frequencyMultiplier: number;
  qualityMultiplier: number;
  sweepRateMultiplier: number;
};

const NEUTRAL_WEATHER_BED_MODIFIER: WeatherBedModifier = {
  gainMultiplier: 1,
  frequencyMultiplier: 1,
  qualityMultiplier: 1,
  sweepRateMultiplier: 1
};

const WEATHER_BED_MODIFIERS: Record<string, WeatherBedModifier> = {
  clear: NEUTRAL_WEATHER_BED_MODIFIER,
  sunRays: { gainMultiplier: 0.85, frequencyMultiplier: 1.05, qualityMultiplier: 1.1, sweepRateMultiplier: 0.85 },
  overcast: { gainMultiplier: 1.15, frequencyMultiplier: 0.8, qualityMultiplier: 0.75, sweepRateMultiplier: 0.9 },
  // Rain opens the bed, but at frequencyMultiplier 1.7 with a Q of 0.4 it was
  // measured as effectively white noise, burying the music it sits under.
  rain: { gainMultiplier: 1.25, frequencyMultiplier: 1.3, qualityMultiplier: 0.8, sweepRateMultiplier: 1.5 },
  snow: { gainMultiplier: 0.7, frequencyMultiplier: 0.6, qualityMultiplier: 0.6, sweepRateMultiplier: 0.55 }
};

const CURRENT_BED_MODIFIERS: Record<string, WeatherBedModifier> = {
  still: { gainMultiplier: 0.7, frequencyMultiplier: 0.75, qualityMultiplier: 1.3, sweepRateMultiplier: 0.5 },
  drift: NEUTRAL_WEATHER_BED_MODIFIER,
  surge: { gainMultiplier: 1.3, frequencyMultiplier: 1.35, qualityMultiplier: 0.8, sweepRateMultiplier: 1.8 }
};

const DEFAULT_WEATHER_INTENSITY = 0.5;

const MINIMUM_BED_GAIN = 0;
const MAXIMUM_BED_GAIN = 0.14;
const MINIMUM_BED_FILTER_HERTZ = 120;
const MAXIMUM_BED_FILTER_HERTZ = 6000;
const MINIMUM_FILTER_QUALITY = 0.2;
const MAXIMUM_FILTER_QUALITY = 4;
const MINIMUM_SWEEP_RATE_HERTZ = 0.01;
const MAXIMUM_SWEEP_RATE_HERTZ = 0.4;

const NEUTRAL_POINT_ENERGY = 50;
const MAXIMUM_POINT_ENERGY = 100;

function clampToRange(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

function blendTowardNeutral(modifierValue: number, blendAmount: number): number {
  return 1 + (modifierValue - 1) * blendAmount;
}

/**
 * How many planets or landmarks the scene carries, and how energetic they are.
 * Both come straight from the ProfileDNA: the count is how many interests and
 * traits the visitor gave, the energy is what the AI assigned each one.
 */
function resolveDnaSignals(scene: SceneConfig): { pointCount: number; averageEnergy: number } {
  const pointsOfInterest = pointsOfInterestFromScene(scene);
  if (pointsOfInterest.length === 0) {
    return { pointCount: 0, averageEnergy: NEUTRAL_POINT_ENERGY };
  }
  const energyValues = pointsOfInterest
    .map((pointOfInterest) => pointOfInterest.energy)
    .filter((energy): energy is number => typeof energy === "number" && Number.isFinite(energy));
  if (energyValues.length === 0) {
    return { pointCount: pointsOfInterest.length, averageEnergy: NEUTRAL_POINT_ENERGY };
  }
  const energyTotal = energyValues.reduce((runningTotal, energy) => runningTotal + energy, 0);
  return {
    pointCount: pointsOfInterest.length,
    averageEnergy: clampToRange(energyTotal / energyValues.length, 0, MAXIMUM_POINT_ENERGY)
  };
}

function resolveMusicalIdentity(scene: SceneConfig, family: AmbientFamily): MusicalIdentity {
  if (family === FOREST_FAMILY_KEY) {
    const weatherKind = typeof scene.weather?.kind === "string" ? scene.weather.kind : "";
    return FOREST_IDENTITY_BY_WEATHER[weatherKind] ?? DEFAULT_FOREST_IDENTITY;
  }
  if (family === OCEAN_FAMILY_KEY) {
    const currentKind = typeof scene.current?.kind === "string" ? scene.current.kind : "";
    return OCEAN_IDENTITY_BY_CURRENT[currentKind] ?? DEFAULT_OCEAN_IDENTITY;
  }
  const theme = typeof scene.theme === "string" ? scene.theme : "";
  return UNIVERSE_IDENTITY_BY_THEME[theme] ?? DEFAULT_UNIVERSE_IDENTITY;
}

function resolveSceneTransposeSemitones(scene: SceneConfig, family: AmbientFamily): number {
  if (family === FOREST_FAMILY_KEY) {
    const seasonKind = typeof scene.season?.kind === "string" ? scene.season.kind : "";
    const timeOfDayKey = typeof scene.lighting?.timeOfDay === "string" ? scene.lighting.timeOfDay : "";
    return (SEASON_TRANSPOSE_SEMITONES[seasonKind] ?? 0) + (TIME_OF_DAY_TRANSPOSE_SEMITONES[timeOfDayKey] ?? 0);
  }
  if (family === OCEAN_FAMILY_KEY) {
    const zone = typeof scene.depth?.zone === "string" ? scene.depth.zone : "";
    return DEPTH_ZONE_TRANSPOSE_SEMITONES[zone] ?? 0;
  }
  return 0;
}

function resolveBedCharacter(scene: SceneConfig, family: AmbientFamily): BedCharacter {
  if (family === FOREST_FAMILY_KEY) {
    const weatherKind = typeof scene.weather?.kind === "string" ? scene.weather.kind : "";
    const rawIntensity = scene.weather?.intensity;
    return blendBedCharacter(
      FOREST_BASE_BED,
      WEATHER_BED_MODIFIERS[weatherKind] ?? NEUTRAL_WEATHER_BED_MODIFIER,
      typeof rawIntensity === "number" ? rawIntensity : DEFAULT_WEATHER_INTENSITY
    );
  }
  if (family === OCEAN_FAMILY_KEY) {
    const currentKind = typeof scene.current?.kind === "string" ? scene.current.kind : "";
    const rawIntensity = scene.current?.intensity;
    return blendBedCharacter(
      OCEAN_BASE_BED,
      CURRENT_BED_MODIFIERS[currentKind] ?? NEUTRAL_WEATHER_BED_MODIFIER,
      typeof rawIntensity === "number" ? rawIntensity : DEFAULT_WEATHER_INTENSITY
    );
  }
  const theme = typeof scene.theme === "string" ? scene.theme : "";
  return UNIVERSE_BED_BY_THEME[theme] ?? DEFAULT_UNIVERSE_BED;
}

/**
 * A base bed pushed toward a modifier by how strong the weather or the current
 * is. Extracted when the ocean arrived: the forest already did exactly this,
 * and two copies of it would have been two places to get the blend wrong.
 */
function blendBedCharacter(base: BedCharacter, modifier: WeatherBedModifier, rawIntensity: number): BedCharacter {
  const intensity = clampToRange(rawIntensity, 0, 1);
  return {
    gain: base.gain * blendTowardNeutral(modifier.gainMultiplier, intensity),
    filterType: base.filterType,
    filterFrequencyHertz: base.filterFrequencyHertz * blendTowardNeutral(modifier.frequencyMultiplier, intensity),
    filterQuality: base.filterQuality * blendTowardNeutral(modifier.qualityMultiplier, intensity),
    sweepRateHertz: base.sweepRateHertz * blendTowardNeutral(modifier.sweepRateMultiplier, intensity),
    sweepDepthHertz: base.sweepDepthHertz
  };
}

function bloomToneMultiplier(scene: SceneConfig): number {
  const rawBloomIntensity = scene.postFX?.bloomIntensity;
  if (typeof rawBloomIntensity !== "number") {
    return 1;
  }
  const bloomIntensity = clampToRange(rawBloomIntensity, MINIMUM_BLOOM_INTENSITY, MAXIMUM_BLOOM_INTENSITY);
  return 1 + (bloomIntensity - NEUTRAL_BLOOM_INTENSITY) * BLOOM_TONE_INFLUENCE;
}

/** 1 (surface) for every non-ocean scene, so both multipliers below are a
 * silent no-op anywhere but an ocean world. */
function oceanDepthBrightness(scene: SceneConfig, family: AmbientFamily): number {
  if (family !== OCEAN_FAMILY_KEY) {
    return 1;
  }
  const metres = typeof scene.depth?.metres === "number" ? scene.depth.metres : 0;
  return depthAt(metres).brightness;
}

function oceanDepthToneMultiplier(scene: SceneConfig, family: AmbientFamily): number {
  const brightness = oceanDepthBrightness(scene, family);
  return OCEAN_DEPTH_TONE_MULTIPLIER_FLOOR + brightness * (1 - OCEAN_DEPTH_TONE_MULTIPLIER_FLOOR);
}

function oceanDepthBedGainMultiplier(scene: SceneConfig, family: AmbientFamily): number {
  const brightness = oceanDepthBrightness(scene, family);
  return OCEAN_DEPTH_BED_GAIN_MULTIPLIER_FLOOR + brightness * (1 - OCEAN_DEPTH_BED_GAIN_MULTIPLIER_FLOOR);
}

/**
 * Short stable string identifying the soundscape a config asks for. Used as the
 * effect dependency that rebuilds the audio graph: the recipe object is rebuilt
 * on every render, but the graph must only be torn down when the sound actually
 * changes — selecting a variant, not hovering a planet.
 */
export function ambientSoundscapeSignature(scene?: SceneConfig): string {
  if (!scene) {
    return `${FALLBACK_SCENE_SEED}|${UNIVERSE_FAMILY_KEY}`;
  }
  const seed = String(scene.seed ?? FALLBACK_SCENE_SEED);
  const { pointCount, averageEnergy } = resolveDnaSignals(scene);
  const dnaPart = `${pointCount}|${averageEnergy.toFixed(1)}`;
  const family = ambientFamilyForScene(scene);
  if (family === FOREST_FAMILY_KEY) {
    return [
      seed,
      FOREST_FAMILY_KEY,
      dnaPart,
      String(scene.season?.kind ?? ""),
      String(scene.lighting?.timeOfDay ?? ""),
      String(scene.weather?.kind ?? ""),
      String(scene.weather?.intensity ?? "")
    ].join("|");
  }
  if (family === OCEAN_FAMILY_KEY) {
    return [
      seed,
      OCEAN_FAMILY_KEY,
      dnaPart,
      String(scene.depth?.zone ?? ""),
      // The zone alone is not enough once depth continuously drives the tone
      // filter and the bed gain: two worlds sharing a zone but not a depth
      // now sound different and must not share a signature.
      typeof scene.depth?.metres === "number" ? scene.depth.metres.toFixed(1) : "",
      String(scene.current?.kind ?? ""),
      String(scene.current?.intensity ?? "")
    ].join("|");
  }
  return [seed, UNIVERSE_FAMILY_KEY, dnaPart, String(scene.theme ?? ""), String(scene.postFX?.bloomIntensity ?? "")].join(
    "|"
  );
}

/**
 * Deterministic soundscape for a scene. Same config in, same recipe out, on
 * every page and every reload — the audio equivalent of the seed contract the
 * renderers already keep.
 */
export function buildAmbientSoundscapeRecipe(scene?: SceneConfig): AmbientSoundscapeRecipe {
  const resolvedScene = scene ?? {};
  const seed = String(resolvedScene.seed ?? FALLBACK_SCENE_SEED);
  const nextRandomValue = randomFromSeed(`${seed}${AMBIENT_AUDIO_SEED_SUFFIX}`);
  const family = ambientFamilyForScene(resolvedScene);
  const { pointCount, averageEnergy } = resolveDnaSignals(resolvedScene);
  const energyRatio = averageEnergy / MAXIMUM_POINT_ENERGY;

  const identity = resolveMusicalIdentity(resolvedScene, family);
  const harmonyInstrument = HARMONY_INSTRUMENT_BY_MELODY[identity.instrument];

  const seedTranspose =
    SEED_TRANSPOSE_CHOICES[Math.floor(nextRandomValue() * SEED_TRANSPOSE_CHOICES.length)] ?? 0;
  const transposeSemitones = clampToRange(
    resolveSceneTransposeSemitones(resolvedScene, family) + seedTranspose,
    MINIMUM_TRANSPOSE_SEMITONES,
    MAXIMUM_TRANSPOSE_SEMITONES
  );

  const tempoRange = PERFORMANCE_TEMPO_BY_PIECE[identity.pieceId];
  const beatsPerMinute =
    tempoRange.minimumBeatsPerMinute +
    energyRatio * (tempoRange.maximumBeatsPerMinute - tempoRange.minimumBeatsPerMinute);

  const harmonyKeepRatio =
    pointCount <= 0
      ? MAXIMUM_HARMONY_KEEP_RATIO
      : clampToRange(
          MINIMUM_HARMONY_KEEP_RATIO +
            (pointCount / HARMONY_KEEP_RATIO_POINT_COUNT_FULL) *
              (MAXIMUM_HARMONY_KEEP_RATIO - MINIMUM_HARMONY_KEEP_RATIO),
          MINIMUM_HARMONY_KEEP_RATIO,
          MAXIMUM_HARMONY_KEEP_RATIO
        );

  const startPositionRatio =
    START_POSITION_RATIO_CHOICES[Math.floor(nextRandomValue() * START_POSITION_RATIO_CHOICES.length)] ?? 0;

  const melodyGain = MELODY_GAIN * INSTRUMENT_LEVEL_TRIM[identity.instrument];
  const harmonyGain = Math.min(
    HARMONY_GAIN * INSTRUMENT_LEVEL_TRIM[harmonyInstrument],
    melodyGain * MAXIMUM_HARMONY_TO_MELODY_GAIN_RATIO
  );
  const bassGain = Math.min(
    BASS_GAIN * INSTRUMENT_LEVEL_TRIM[BASS_INSTRUMENT],
    melodyGain * MAXIMUM_BASS_TO_MELODY_GAIN_RATIO
  );

  const bedCharacter = resolveBedCharacter(resolvedScene, family);
  const toneJitter = 1 + (nextRandomValue() * 2 - 1) * TONE_JITTER_RATIO;
  const energyToneMultiplier = MINIMUM_ENERGY_TONE_MULTIPLIER + energyRatio * ENERGY_TONE_MULTIPLIER_SPREAD;

  return {
    signature: ambientSoundscapeSignature(resolvedScene),
    masterGain: MASTER_GAIN * PIECE_LEVEL_TRIM[identity.pieceId],
    performance: {
      pieceId: identity.pieceId,
      beatsPerMinute,
      transposeSemitones,
      startPositionRatio,
      humanizeSeconds: MINIMUM_HUMANIZE_SECONDS + nextRandomValue() * HUMANIZE_SPREAD_SECONDS,
      maximumPan: MINIMUM_MAXIMUM_PAN + nextRandomValue() * MAXIMUM_PAN_SPREAD,
      melody: { instrument: identity.instrument, gain: melodyGain, noteKeepRatio: 1 },
      harmony: { instrument: harmonyInstrument, gain: harmonyGain, noteKeepRatio: harmonyKeepRatio },
      bass: { instrument: BASS_INSTRUMENT, gain: bassGain, noteKeepRatio: 1 }
    },
    toneCutoffHertz: clampToRange(
      BASE_TONE_CUTOFF_HERTZ *
        toneJitter *
        energyToneMultiplier *
        bloomToneMultiplier(resolvedScene) *
        oceanDepthToneMultiplier(resolvedScene, family),
      MINIMUM_TONE_CUTOFF_HERTZ,
      MAXIMUM_TONE_CUTOFF_HERTZ
    ),
    bedGain: clampToRange(
      bedCharacter.gain * oceanDepthBedGainMultiplier(resolvedScene, family),
      MINIMUM_BED_GAIN,
      MAXIMUM_BED_GAIN
    ),
    bedFilterType: bedCharacter.filterType,
    bedFilterFrequencyHertz: clampToRange(
      bedCharacter.filterFrequencyHertz,
      MINIMUM_BED_FILTER_HERTZ,
      MAXIMUM_BED_FILTER_HERTZ
    ),
    bedFilterQuality: clampToRange(bedCharacter.filterQuality, MINIMUM_FILTER_QUALITY, MAXIMUM_FILTER_QUALITY),
    bedSweepRateHertz: clampToRange(bedCharacter.sweepRateHertz, MINIMUM_SWEEP_RATE_HERTZ, MAXIMUM_SWEEP_RATE_HERTZ),
    bedSweepDepthHertz: bedCharacter.sweepDepthHertz,
    bedNoiseSeed: `${seed}${BED_NOISE_SEED_SUFFIX}`,
    space: {
      reverbDecaySeconds: MINIMUM_REVERB_DECAY_SECONDS + nextRandomValue() * REVERB_DECAY_SPREAD_SECONDS,
      reverbWetMix: MINIMUM_REVERB_WET_MIX + nextRandomValue() * REVERB_WET_MIX_SPREAD,
      delayTimeSeconds: MINIMUM_DELAY_TIME_SECONDS + nextRandomValue() * DELAY_TIME_SPREAD_SECONDS,
      delayFeedback: MINIMUM_DELAY_FEEDBACK + nextRandomValue() * DELAY_FEEDBACK_SPREAD,
      delayMix: MINIMUM_DELAY_MIX + nextRandomValue() * DELAY_MIX_SPREAD
    },
    performanceSeed: `${seed}${PERFORMANCE_SEED_SUFFIX}`
  };
}

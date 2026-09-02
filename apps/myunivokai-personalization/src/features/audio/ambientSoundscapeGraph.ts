import {
  ARRANGEMENT_NOTE_DURATION_INDEX,
  ARRANGEMENT_NOTE_MIDI_INDEX,
  ARRANGEMENT_NOTE_ROLE_INDEX,
  ARRANGEMENT_NOTE_START_BEAT_INDEX,
  ARRANGEMENT_ROLE_BASS,
  ARRANGEMENT_ROLE_HARMONY,
  ARRANGEMENT_ROLE_MELODY,
  type Arrangement,
  type ArrangementRole
} from "./arrangements";
import {
  SMALL_SPEAKER_BASS_FLOOR_MIDI,
  SMALL_SPEAKER_MELODY_FLOOR_MIDI,
  type AmbientSoundscapeRecipe,
  type AmbientVoiceRecipe
} from "@/lib/ambientSoundscape";
import { randomFromSeed } from "@/lib/scene";
import { nearestSampledNote, type LoadedInstrument } from "./instrumentSamples";

// --- Web Audio graph for one soundscape --------------------------------------
//
// Performs a written arrangement. The numbers arrive already rolled and clamped
// from lib/ambientSoundscape, the notes arrive from features/audio/arrangements
// and the samples arrive already decoded, so this module performs no I/O and the
// offline renderer can drive it with buffers read from disk.
//
//   melody  ─┐
//   harmony ─┼─► noteGain ─► panner ─► toneFilter ─┬─► dryBus ────────────────┐
//   bass    ─┘                                     ├─► reverb ─► reverbReturn ─┤
//                                                  └─► delay ─► delayMix ──────┼─► masterGain ─► destination
//                                                        └─► feedback ─┘       │
//   noise bed ─► bedFilter ─► bedGain ──────────────────────────────────────────┘
//
// There is no oscillator in the musical path at all. The only one left is the
// sub-audio LFO that moves the wind filter.
//
// Scheduling uses the standard two-clock pattern: a coarse setInterval wakes up
// and schedules every note falling inside a short lookahead window against the
// audio clock, which is the only clock accurate enough to place a note. Unlike
// the previous generator this walks a fixed list in beat order, so the pulse is
// real and the piece repeats rather than wandering.

const NOISE_BUFFER_SECONDS = 4;
const NOISE_BUFFER_CHANNEL_COUNT = 1;
const FIRST_CHANNEL_INDEX = 0;

const MAXIMUM_LFO_START_STAGGER_SECONDS = 6;
const LFO_STAGGER_SEED_SUFFIX = "-lfo-stagger";

const REVERB_CHANNEL_COUNT = 2;
const REVERB_DECAY_CURVE_POWER = 2.4;
const REVERB_SEED_SUFFIX = "-reverb";
const HARMONY_THINNING_SEED_SUFFIX = "-harmony-thinning";

const SCHEDULER_INTERVAL_MILLISECONDS = 250;
const SCHEDULER_LOOKAHEAD_SECONDS = 1.2;
/** The room is established before anything is played into it. */
const FIRST_NOTE_DELAY_SECONDS = 1.2;

/**
 * A world opens on a downbeat at the start of a phrase. Four bars is the phrase
 * length across the catalogue, so snapping the rolled start position to a
 * multiple of it means a world never begins in the middle of a musical sentence.
 */
const PHRASE_BAR_COUNT = 4;

const TONE_FILTER_QUALITY = 0.5;
const SECONDS_PER_MINUTE = 60;
const SEMITONES_PER_OCTAVE = 12;

// How far a recording may be pitch-shifted before it stops sounding like the
// instrument. Beyond this the note is folded by octaves instead.
const MAXIMUM_SAMPLE_STRETCH_SEMITONES = 7;

// A sample already carries its own attack, so the only envelope it needs on the
// way in is a short lift off zero to avoid a click.
const SAMPLE_ATTACK_SECONDS = 0.008;
const MINIMUM_ENVELOPE_LEVEL = 0.0001;
const STOP_RELEASE_SECONDS = 0.4;

/**
 * How long each instrument keeps ringing after its written note ends. A struck
 * string or bar decays for seconds and choking it at the written duration
 * sounds like a hand slapped on the strings; a blown pipe stops when the breath
 * stops. Respecting the written length is what gives the performance its rhythm,
 * and this is what keeps that from sounding clipped.
 */
const RELEASE_SECONDS_BY_INSTRUMENT: Record<string, number> = {
  piano: 1.4,
  pianoBass: 2.2,
  harp: 1.8,
  glockenspiel: 2,
  vibraphone: 2,
  kalimba: 1.2,
  recorder: 0.18,
  saxello: 0.2
};
const DEFAULT_RELEASE_SECONDS = 1;

/**
 * BALANCE. Gain is not balance, and this is where that gets settled.
 *
 * The recipe guarantees the accompaniment's *gain* is below the melody's. That
 * turned out to prove nothing: the accompaniment plays three to five times as
 * many notes as the tune, so at any given gain it contributes several times the
 * energy. Isolating each line of all ten worlds measured the accompaniment
 * LOUDER than the melody in four of them — the same fault that made the second
 * attempt a sustained tone with a tune buried under it, arriving by a different
 * route and past a test that was watching the wrong number.
 *
 * The measured model is `lead = factor(instrument pair) / soundingBeatRatio`,
 * which held across all ten renders including the two worlds that share
 * instruments but not a piece. So the correction is that expression inverted,
 * and the ratio half of it is computed from the score at build time rather than
 * tabulated — a rebuilt arrangement cannot leave it stale.
 *
 * Clamped to never exceed 1: a melody leading by more than the target is safe,
 * the reverse is what visitors reported twice.
 */
const HARMONY_BALANCE_FACTOR_BY_MELODY_INSTRUMENT: Record<string, number> = {
  harp: 2,
  piano: 2.3,
  glockenspiel: 6.6,
  vibraphone: 8.2,
  kalimba: 8.2,
  recorder: 13.1,
  saxello: 3.9
};
const DEFAULT_HARMONY_BALANCE_FACTOR = 2;
const TARGET_MELODY_LEAD = 2.5;
const MINIMUM_HARMONY_BALANCE_CORRECTION = 0.05;
const MAXIMUM_HARMONY_BALANCE_CORRECTION = 1;

/**
 * How much of that release each line gets. The accompaniment gets a fraction of
 * it, because letting a dense chord part ring as long as the tune is what turns
 * a chord progression into a wash.
 *
 * Measured, not guessed. Clair de Lune has 924 harmony notes against 264 melody
 * ones; with a full 2 s vibraphone release they overlapped into an accompaniment
 * that rendered at 0.0591 RMS against the melody's 0.0314 — the support layer
 * almost twice as loud as the tune, which is the same fault that made the second
 * attempt a sustained tone with a melody buried under it. Note that the recipe's
 * `harmony.gain < melody.gain` was true the whole time: gain is not balance.
 */
const RELEASE_RATIO_BY_ROLE: Record<ArrangementRole, number> = {
  [ARRANGEMENT_ROLE_BASS]: 1,
  [ARRANGEMENT_ROLE_HARMONY]: 0.3,
  [ARRANGEMENT_ROLE_MELODY]: 1
};

/**
 * Metrical accent. A downbeat is played a little harder than the beats after it,
 * which is most of what separates a performance from a MIDI file playing back.
 */
const DOWNBEAT_VELOCITY = 1;
const OFFBEAT_VELOCITY = 0.82;
const VELOCITY_JITTER = 0.12;
const BEAT_EPSILON = 0.01;

export type AmbientSoundscapeGraph = {
  /** Fade out over `fadeSeconds`, then stop and release every node. */
  stop: (fadeSeconds: number) => void;
};

export type AmbientInstrumentSet = {
  melody: LoadedInstrument;
  harmony: LoadedInstrument;
  bass: LoadedInstrument;
};

/** One note of the rotated, looping performance. */
export type ScheduledNote = {
  beat: number;
  durationBeats: number;
  midiNumber: number;
  role: ArrangementRole;
  isDownbeat: boolean;
};

function createSeededNoiseBuffer(audioContext: BaseAudioContext, noiseSeed: string): AudioBuffer {
  const frameCount = Math.floor(audioContext.sampleRate * NOISE_BUFFER_SECONDS);
  const noiseBuffer = audioContext.createBuffer(NOISE_BUFFER_CHANNEL_COUNT, frameCount, audioContext.sampleRate);
  const channelSamples = noiseBuffer.getChannelData(FIRST_CHANNEL_INDEX);
  const nextRandomValue = randomFromSeed(noiseSeed);
  for (let sampleIndex = 0; sampleIndex < frameCount; sampleIndex += 1) {
    channelSamples[sampleIndex] = nextRandomValue() * 2 - 1;
  }
  return noiseBuffer;
}

function createReverbImpulseResponse(
  audioContext: BaseAudioContext,
  decaySeconds: number,
  reverbSeed: string
): AudioBuffer {
  const frameCount = Math.max(1, Math.floor(audioContext.sampleRate * decaySeconds));
  const impulseResponse = audioContext.createBuffer(REVERB_CHANNEL_COUNT, frameCount, audioContext.sampleRate);
  const nextRandomValue = randomFromSeed(reverbSeed);
  for (let channelIndex = 0; channelIndex < REVERB_CHANNEL_COUNT; channelIndex += 1) {
    const channelSamples = impulseResponse.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < frameCount; sampleIndex += 1) {
      const remainingRatio = 1 - sampleIndex / frameCount;
      channelSamples[sampleIndex] = (nextRandomValue() * 2 - 1) * Math.pow(remainingRatio, REVERB_DECAY_CURVE_POWER);
    }
  }
  return impulseResponse;
}

/**
 * Turn the written score into the looping note list this performance plays:
 * rotated to the rolled starting phrase, with the thinned-out accompaniment
 * chords already removed and every downbeat marked.
 *
 * Exported for the tests, which need to assert the pulse and the loop without
 * standing up a whole audio context.
 */
export function buildScheduledNotes(arrangement: Arrangement, recipe: AmbientSoundscapeRecipe): ScheduledNote[] {
  const { performance } = recipe;
  const phraseBeats = arrangement.beatsPerBar * PHRASE_BAR_COUNT;
  const loopLengthBeats = Math.max(phraseBeats, Math.ceil(arrangement.totalBeats / phraseBeats) * phraseBeats);
  const startBeat =
    Math.floor((performance.startPositionRatio * arrangement.totalBeats) / phraseBeats) * phraseBeats;

  // Whole chords are dropped, never individual notes inside one: a thinner
  // accompaniment is musical, a chord with a hole in it is a mistake.
  const droppedHarmonyBeats = new Set<number>();
  if (performance.harmony.noteKeepRatio < 1) {
    const nextThinningValue = randomFromSeed(`${recipe.performanceSeed}${HARMONY_THINNING_SEED_SUFFIX}`);
    const harmonyBeats = new Set<number>();
    for (const note of arrangement.notes) {
      if (note[ARRANGEMENT_NOTE_ROLE_INDEX] === ARRANGEMENT_ROLE_HARMONY) {
        harmonyBeats.add(note[ARRANGEMENT_NOTE_START_BEAT_INDEX]);
      }
    }
    for (const beat of [...harmonyBeats].sort((first, second) => first - second)) {
      if (nextThinningValue() > performance.harmony.noteKeepRatio) {
        droppedHarmonyBeats.add(beat);
      }
    }
  }

  const scheduled: ScheduledNote[] = [];
  for (const note of arrangement.notes) {
    const role = note[ARRANGEMENT_NOTE_ROLE_INDEX];
    const noteStartBeat = note[ARRANGEMENT_NOTE_START_BEAT_INDEX];
    if (role === ARRANGEMENT_ROLE_HARMONY && droppedHarmonyBeats.has(noteStartBeat)) {
      continue;
    }
    const rotatedBeat = noteStartBeat >= startBeat ? noteStartBeat - startBeat : noteStartBeat - startBeat + loopLengthBeats;
    const beatWithinBar = noteStartBeat % arrangement.beatsPerBar;
    scheduled.push({
      beat: rotatedBeat,
      durationBeats: note[ARRANGEMENT_NOTE_DURATION_INDEX],
      midiNumber: note[ARRANGEMENT_NOTE_MIDI_INDEX] + performance.transposeSemitones,
      role,
      isDownbeat: beatWithinBar < BEAT_EPSILON
    });
  }
  scheduled.sort((left, right) => left.beat - right.beat || left.midiNumber - right.midiNumber);
  return scheduled;
}

/** Loop length in beats for a piece, rounded up to a whole phrase. */
export function loopLengthBeatsFor(arrangement: Arrangement): number {
  const phraseBeats = arrangement.beatsPerBar * PHRASE_BAR_COUNT;
  return Math.max(phraseBeats, Math.ceil(arrangement.totalBeats / phraseBeats) * phraseBeats);
}

/**
 * Multiplier that pulls the accompaniment back under the melody for this piece
 * and this pair of instruments. See HARMONY_BALANCE_FACTOR_BY_MELODY_INSTRUMENT
 * for why gain alone does not do it. Exported so a test can assert the direction
 * without rendering audio.
 */
export function harmonyBalanceCorrectionFor(scheduledNotes: ScheduledNote[], melodyInstrumentKey: string): number {
  let melodySoundingBeats = 0;
  let harmonySoundingBeats = 0;
  for (const note of scheduledNotes) {
    if (note.role === ARRANGEMENT_ROLE_MELODY) {
      melodySoundingBeats += note.durationBeats;
    } else if (note.role === ARRANGEMENT_ROLE_HARMONY) {
      harmonySoundingBeats += note.durationBeats;
    }
  }
  if (melodySoundingBeats <= 0 || harmonySoundingBeats <= 0) {
    return MAXIMUM_HARMONY_BALANCE_CORRECTION;
  }
  const soundingBeatRatio = harmonySoundingBeats / melodySoundingBeats;
  const factor = HARMONY_BALANCE_FACTOR_BY_MELODY_INSTRUMENT[melodyInstrumentKey] ?? DEFAULT_HARMONY_BALANCE_FACTOR;
  const correction = factor / (soundingBeatRatio * TARGET_MELODY_LEAD);
  return Math.min(MAXIMUM_HARMONY_BALANCE_CORRECTION, Math.max(MINIMUM_HARMONY_BALANCE_CORRECTION, correction));
}

/**
 * Build and start a soundscape. The master gain begins at zero and ramps to the
 * recipe level over `fadeInSeconds`, so enabling sound never arrives as a click.
 */
export function createAmbientSoundscapeGraph(
  audioContext: AudioContext,
  recipe: AmbientSoundscapeRecipe,
  fadeInSeconds: number,
  instruments: AmbientInstrumentSet,
  arrangement: Arrangement
): AmbientSoundscapeGraph {
  const startTime = audioContext.currentTime;
  const sustainedSources: AudioBufferSourceNode[] = [];
  const oscillatorSources: OscillatorNode[] = [];
  const activeNoteSources = new Set<AudioBufferSourceNode>();

  const masterGain = audioContext.createGain();
  masterGain.gain.setValueAtTime(0, startTime);
  masterGain.gain.linearRampToValueAtTime(recipe.masterGain, startTime + fadeInSeconds);
  masterGain.connect(audioContext.destination);

  const dryBus = audioContext.createGain();
  dryBus.connect(masterGain);

  const reverbConvolver = audioContext.createConvolver();
  reverbConvolver.buffer = createReverbImpulseResponse(
    audioContext,
    recipe.space.reverbDecaySeconds,
    `${recipe.performanceSeed}${REVERB_SEED_SUFFIX}`
  );
  const reverbInput = audioContext.createGain();
  const reverbReturn = audioContext.createGain();
  reverbReturn.gain.setValueAtTime(recipe.space.reverbWetMix, startTime);
  reverbInput.connect(reverbConvolver);
  reverbConvolver.connect(reverbReturn);
  reverbReturn.connect(masterGain);

  const delayInput = audioContext.createGain();
  const delayNode = audioContext.createDelay(recipe.space.delayTimeSeconds + 1);
  delayNode.delayTime.setValueAtTime(recipe.space.delayTimeSeconds, startTime);
  const delayFeedback = audioContext.createGain();
  delayFeedback.gain.setValueAtTime(recipe.space.delayFeedback, startTime);
  const delayMix = audioContext.createGain();
  delayMix.gain.setValueAtTime(recipe.space.delayMix, startTime);
  delayInput.connect(delayNode);
  delayNode.connect(delayFeedback);
  delayFeedback.connect(delayNode);
  delayNode.connect(delayMix);
  delayMix.connect(masterGain);
  // Echoes go back into the room too, or they arrive dry against a wet source
  // and read as an obviously artificial repeat.
  delayMix.connect(reverbInput);

  // One shared tone filter over every instrument layer. This is where the
  // scene's brightness lands: a dusk forest is genuinely darker, not just lower.
  const toneFilter = audioContext.createBiquadFilter();
  toneFilter.type = "lowpass";
  toneFilter.frequency.setValueAtTime(recipe.toneCutoffHertz, startTime);
  toneFilter.Q.setValueAtTime(TONE_FILTER_QUALITY, startTime);
  toneFilter.connect(dryBus);
  toneFilter.connect(reverbInput);
  toneFilter.connect(delayInput);

  // --- Environmental bed -----------------------------------------------------

  const noiseSource = audioContext.createBufferSource();
  noiseSource.buffer = createSeededNoiseBuffer(audioContext, recipe.bedNoiseSeed);
  noiseSource.loop = true;

  const bedFilter = audioContext.createBiquadFilter();
  bedFilter.type = recipe.bedFilterType;
  bedFilter.frequency.setValueAtTime(recipe.bedFilterFrequencyHertz, startTime);
  bedFilter.Q.setValueAtTime(recipe.bedFilterQuality, startTime);

  const bedSweep = audioContext.createOscillator();
  bedSweep.type = "sine";
  bedSweep.frequency.setValueAtTime(recipe.bedSweepRateHertz, startTime);
  const bedSweepDepth = audioContext.createGain();
  bedSweepDepth.gain.setValueAtTime(recipe.bedSweepDepthHertz, startTime);
  bedSweep.connect(bedSweepDepth);
  bedSweepDepth.connect(bedFilter.frequency);

  const bedGain = audioContext.createGain();
  bedGain.gain.setValueAtTime(recipe.bedGain, startTime);

  // The bed stays dry. Reverberated noise is fog, and it buries the music.
  noiseSource.connect(bedFilter);
  bedFilter.connect(bedGain);
  bedGain.connect(masterGain);

  const nextStaggerValue = randomFromSeed(`${recipe.bedNoiseSeed}${LFO_STAGGER_SEED_SUFFIX}`);
  noiseSource.start(startTime);
  bedSweep.start(startTime + nextStaggerValue() * MAXIMUM_LFO_START_STAGGER_SECONDS);
  sustainedSources.push(noiseSource);
  oscillatorSources.push(bedSweep);

  // --- Performance -----------------------------------------------------------

  const nextPerformanceValue = randomFromSeed(recipe.performanceSeed);
  const scheduledNotes = buildScheduledNotes(arrangement, recipe);
  const loopLengthBeats = loopLengthBeatsFor(arrangement);
  const secondsPerBeat = SECONDS_PER_MINUTE / recipe.performance.beatsPerMinute;
  const loopLengthSeconds = loopLengthBeats * secondsPerBeat;

  let nextNoteIndex = 0;
  let passStartTime = startTime + FIRST_NOTE_DELAY_SECONDS;
  let hasStopped = false;

  const harmonyBalanceCorrection = harmonyBalanceCorrectionFor(
    scheduledNotes,
    recipe.performance.melody.instrument
  );
  const voiceByRole: Record<ArrangementRole, AmbientVoiceRecipe> = {
    [ARRANGEMENT_ROLE_BASS]: recipe.performance.bass,
    [ARRANGEMENT_ROLE_HARMONY]: {
      ...recipe.performance.harmony,
      gain: recipe.performance.harmony.gain * harmonyBalanceCorrection
    },
    [ARRANGEMENT_ROLE_MELODY]: recipe.performance.melody
  };
  const instrumentByRole: Record<ArrangementRole, LoadedInstrument> = {
    [ARRANGEMENT_ROLE_BASS]: instruments.bass,
    [ARRANGEMENT_ROLE_HARMONY]: instruments.harmony,
    [ARRANGEMENT_ROLE_MELODY]: instruments.melody
  };
  // The melody has to be heard as the tune, so it clears the higher floor. The
  // other two only support, and a recording that low still carries.
  const floorByRole: Record<ArrangementRole, number> = {
    [ARRANGEMENT_ROLE_BASS]: SMALL_SPEAKER_BASS_FLOOR_MIDI,
    [ARRANGEMENT_ROLE_HARMONY]: SMALL_SPEAKER_BASS_FLOOR_MIDI,
    [ARRANGEMENT_ROLE_MELODY]: SMALL_SPEAKER_MELODY_FLOOR_MIDI
  };

  /**
   * Octave-shift a note into a range that is both audible on a small speaker and
   * close enough to a recording we actually have. The written scores reach MIDI
   * 27, which is 44 Hz — gone on a laptop — and every melodic instrument here
   * was sampled from C4 up, so a note that far out has to move by octaves.
   * Stretching a sample instead would turn it into a cartoon of itself.
   */
  function foldIntoPlayableRange(instrument: LoadedInstrument, midiNumber: number, floorMidiNumber: number): number {
    const lowestSampled = instrument.midiNumbers[0];
    const highestSampled = instrument.midiNumbers[instrument.midiNumbers.length - 1];
    const lowestPlayable = Math.max(floorMidiNumber, lowestSampled - MAXIMUM_SAMPLE_STRETCH_SEMITONES);
    const highestPlayable = highestSampled + MAXIMUM_SAMPLE_STRETCH_SEMITONES;
    let foldedMidiNumber = midiNumber;
    while (foldedMidiNumber > highestPlayable) {
      foldedMidiNumber -= SEMITONES_PER_OCTAVE;
    }
    while (foldedMidiNumber < lowestPlayable) {
      foldedMidiNumber += SEMITONES_PER_OCTAVE;
    }
    // A range narrower than an octave cannot satisfy both bounds; the floor is
    // the one that matters, because the alternative is silence.
    return Math.max(lowestPlayable, Math.min(highestPlayable, foldedMidiNumber));
  }

  function playScheduledNote(note: ScheduledNote, noteStartTime: number): void {
    const instrument = instrumentByRole[note.role];
    const voice = voiceByRole[note.role];
    const midiNumber = foldIntoPlayableRange(instrument, Math.round(note.midiNumber), floorByRole[note.role]);
    const { sampleMidiNumber, playbackRate } = nearestSampledNote(instrument, midiNumber);
    const sampleBuffer = instrument.buffers.get(sampleMidiNumber);
    if (!sampleBuffer) {
      return;
    }

    const accent = note.isDownbeat ? DOWNBEAT_VELOCITY : OFFBEAT_VELOCITY;
    const jitter = 1 + (nextPerformanceValue() * 2 - 1) * VELOCITY_JITTER;
    const level = voice.gain * accent * jitter;

    const releaseSeconds =
      (RELEASE_SECONDS_BY_INSTRUMENT[instrument.key] ?? DEFAULT_RELEASE_SECONDS) * RELEASE_RATIO_BY_ROLE[note.role];
    const writtenEndTime = noteStartTime + note.durationBeats * secondsPerBeat;
    const silenceTime = writtenEndTime + releaseSeconds;

    const source = audioContext.createBufferSource();
    source.buffer = sampleBuffer;
    source.playbackRate.setValueAtTime(playbackRate, noteStartTime);

    const noteGain = audioContext.createGain();
    noteGain.gain.setValueAtTime(0, noteStartTime);
    noteGain.gain.linearRampToValueAtTime(level, noteStartTime + SAMPLE_ATTACK_SECONDS);
    noteGain.gain.setValueAtTime(level, writtenEndTime);
    noteGain.gain.linearRampToValueAtTime(MINIMUM_ENVELOPE_LEVEL, silenceTime);

    const panner = audioContext.createStereoPanner();
    panner.pan.setValueAtTime((nextPerformanceValue() * 2 - 1) * recipe.performance.maximumPan, noteStartTime);

    source.connect(noteGain);
    noteGain.connect(panner);
    panner.connect(toneFilter);
    source.start(noteStartTime);
    source.stop(silenceTime);

    activeNoteSources.add(source);
    source.onended = () => {
      activeNoteSources.delete(source);
      panner.disconnect();
      noteGain.disconnect();
    };
  }

  function runScheduler(): void {
    if (scheduledNotes.length === 0) {
      return;
    }
    const horizonTime = audioContext.currentTime + SCHEDULER_LOOKAHEAD_SECONDS;
    for (;;) {
      const note = scheduledNotes[nextNoteIndex];
      const humanizeOffset = (nextPerformanceValue() * 2 - 1) * recipe.performance.humanizeSeconds;
      const noteTime = passStartTime + note.beat * secondsPerBeat + humanizeOffset;
      if (noteTime >= horizonTime) {
        return;
      }
      playScheduledNote(note, Math.max(audioContext.currentTime, noteTime));
      nextNoteIndex += 1;
      if (nextNoteIndex >= scheduledNotes.length) {
        nextNoteIndex = 0;
        passStartTime += loopLengthSeconds;
      }
    }
  }

  const schedulerIntervalId = setInterval(runScheduler, SCHEDULER_INTERVAL_MILLISECONDS);
  runScheduler();

  function stop(fadeSeconds: number): void {
    if (hasStopped) {
      return;
    }
    hasStopped = true;
    clearInterval(schedulerIntervalId);
    const stopRequestTime = audioContext.currentTime;
    const silenceTime = stopRequestTime + fadeSeconds;
    // cancelScheduledValues alone would leave the param wherever the cancelled
    // ramp had reached being re-read as the ramp's start value; anchoring at the
    // current value first makes the fade start from what is actually audible.
    masterGain.gain.cancelScheduledValues(stopRequestTime);
    masterGain.gain.setValueAtTime(masterGain.gain.value, stopRequestTime);
    masterGain.gain.linearRampToValueAtTime(MINIMUM_ENVELOPE_LEVEL, silenceTime);
    for (const source of sustainedSources) {
      source.stop(silenceTime);
    }
    for (const oscillator of oscillatorSources) {
      oscillator.stop(silenceTime);
    }
    // Notes already scheduled past the fade would otherwise keep the context
    // busy long after the world has gone.
    for (const noteSource of activeNoteSources) {
      noteSource.stop(silenceTime + STOP_RELEASE_SECONDS);
    }
    const releaseSource = sustainedSources[sustainedSources.length - 1];
    if (releaseSource) {
      releaseSource.onended = () => masterGain.disconnect();
    }
  }

  return { stop };
}

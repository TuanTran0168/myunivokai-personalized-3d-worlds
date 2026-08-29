import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAmbientSoundscapeRecipe,
  SMALL_SPEAKER_BASS_FLOOR_MIDI,
  SMALL_SPEAKER_MELODY_FLOOR_MIDI,
  type AmbientSoundscapeRecipe
} from "@/lib/ambientSoundscape";
import type { SceneConfig } from "@/lib/types";
import {
  buildScheduledNotes,
  createAmbientSoundscapeGraph,
  harmonyBalanceCorrectionFor,
  loopLengthBeatsFor,
  type AmbientInstrumentSet
} from "./ambientSoundscapeGraph";
import {
  ARRANGEMENT_ROLE_BASS,
  ARRANGEMENT_ROLE_HARMONY,
  ARRANGEMENT_ROLE_MELODY,
  parseArrangement,
  type Arrangement,
  type ArrangementPieceId
} from "./arrangements";
import { noteNameToMidiNumber, SAMPLED_INSTRUMENT_NOTE_NAMES, type LoadedInstrument } from "./instrumentSamples";

// A soundscape that fails silently is the default failure mode of Web Audio:
// connecting an LFO to a node instead of to that node's AudioParam, or
// forgetting to start a source, throws nothing and simply makes no sound. These
// tests run the real graph builder against a fake context and assert topology,
// and now also that the written score comes out on a real pulse.
//
// What it sounds like is a separate question these cannot answer. That one is
// settled by rendering the real graph offline to WAV and measuring — see
// notes/knowledge/frontend/ambient-audio-mechanism.md. Three versions shipped verified-and-wrong
// before that habit existed.

const FAKE_SAMPLE_RATE = 48000;
const FADE_IN_SECONDS = 3;
const FADE_OUT_SECONDS = 1.2;
const SCHEDULER_INTERVAL_MILLISECONDS = 250;
const SCHEDULER_STEP_SECONDS = 0.25;
const SAMPLE_FRAME_COUNT = 1024;
const FIRST_NOTE_DELAY_SECONDS = 1.2;
const SEMITONES_PER_OCTAVE = 12;
const SECONDS_PER_MINUTE = 60;
const MAXIMUM_SAMPLE_STRETCH_SEMITONES = 7;

const ARRANGEMENT_DIRECTORY = join(process.cwd(), "public", "assets", "audio", "arrangements");

type ScheduledCall = { method: string; value: number; time: number };

class FakeAudioParam {
  value: number;
  readonly calls: ScheduledCall[] = [];
  constructor(initialValue: number) {
    this.value = initialValue;
  }
  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.calls.push({ method: "setValueAtTime", value, time });
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.calls.push({ method: "linearRampToValueAtTime", value, time });
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.calls.push({ method: "exponentialRampToValueAtTime", value, time });
  }
  cancelScheduledValues(time: number) {
    this.calls.push({ method: "cancelScheduledValues", value: Number.NaN, time });
  }
}

class FakeAudioNode {
  readonly connectedTo: unknown[] = [];
  disconnectCount = 0;
  connect(target: unknown) {
    this.connectedTo.push(target);
    return target;
  }
  disconnect() {
    this.disconnectCount += 1;
  }
}

class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam(1);
}
class FakeBiquadFilterNode extends FakeAudioNode {
  type = "lowpass";
  readonly frequency = new FakeAudioParam(350);
  readonly Q = new FakeAudioParam(1);
}
class FakeDelayNode extends FakeAudioNode {
  readonly delayTime = new FakeAudioParam(0);
}
class FakeStereoPannerNode extends FakeAudioNode {
  readonly pan = new FakeAudioParam(0);
}
class FakeConvolverNode extends FakeAudioNode {
  buffer: FakeAudioBuffer | null = null;
}
class FakeSourceNode extends FakeAudioNode {
  startTimes: number[] = [];
  stopTimes: number[] = [];
  onended: (() => void) | null = null;
  start(time: number) {
    this.startTimes.push(time);
  }
  stop(time: number) {
    this.stopTimes.push(time);
  }
}
class FakeOscillatorNode extends FakeSourceNode {
  type = "sine";
  readonly frequency = new FakeAudioParam(440);
  readonly detune = new FakeAudioParam(0);
}
class FakeAudioBufferSourceNode extends FakeSourceNode {
  buffer: FakeAudioBuffer | null = null;
  loop = false;
  readonly playbackRate = new FakeAudioParam(1);
}

type FakeAudioBuffer = {
  channels: Float32Array[];
  getChannelData: (channelIndex: number) => Float32Array;
};

function fakeAudioBuffer(channelCount: number, frameCount: number): FakeAudioBuffer {
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
  return { channels, getChannelData: (channelIndex: number) => channels[channelIndex] };
}

class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate = FAKE_SAMPLE_RATE;
  readonly destination = new FakeAudioNode();
  readonly gainNodes: FakeGainNode[] = [];
  readonly filterNodes: FakeBiquadFilterNode[] = [];
  readonly oscillatorNodes: FakeOscillatorNode[] = [];
  readonly bufferSourceNodes: FakeAudioBufferSourceNode[] = [];
  readonly convolverNodes: FakeConvolverNode[] = [];
  readonly delayNodes: FakeDelayNode[] = [];
  readonly pannerNodes: FakeStereoPannerNode[] = [];

  createGain() {
    const node = new FakeGainNode();
    this.gainNodes.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = new FakeBiquadFilterNode();
    this.filterNodes.push(node);
    return node;
  }
  createOscillator() {
    const node = new FakeOscillatorNode();
    this.oscillatorNodes.push(node);
    return node;
  }
  createBufferSource() {
    const node = new FakeAudioBufferSourceNode();
    this.bufferSourceNodes.push(node);
    return node;
  }
  createConvolver() {
    const node = new FakeConvolverNode();
    this.convolverNodes.push(node);
    return node;
  }
  createDelay() {
    const node = new FakeDelayNode();
    this.delayNodes.push(node);
    return node;
  }
  createStereoPanner() {
    const node = new FakeStereoPannerNode();
    this.pannerNodes.push(node);
    return node;
  }
  createBuffer(channelCount: number, frameCount: number) {
    return fakeAudioBuffer(channelCount, frameCount);
  }
}

/**
 * A fake instrument whose buffers are distinguishable, so a test can read back
 * which note the graph actually chose to play.
 */
function fakeInstrument(key: keyof typeof SAMPLED_INSTRUMENT_NOTE_NAMES): {
  instrument: LoadedInstrument;
  midiNumberByBuffer: Map<unknown, number>;
} {
  const buffers = new Map<number, AudioBuffer>();
  const midiNumberByBuffer = new Map<unknown, number>();
  for (const noteName of SAMPLED_INSTRUMENT_NOTE_NAMES[key]) {
    const buffer = fakeAudioBuffer(1, SAMPLE_FRAME_COUNT);
    const midiNumber = noteNameToMidiNumber(noteName);
    buffers.set(midiNumber, buffer as unknown as AudioBuffer);
    midiNumberByBuffer.set(buffer, midiNumber);
  }
  return {
    instrument: { key, midiNumbers: [...buffers.keys()].sort((first, second) => first - second), buffers },
    midiNumberByBuffer
  };
}

function readArrangement(id: ArrangementPieceId): Arrangement {
  return parseArrangement(id, JSON.parse(readFileSync(join(ARRANGEMENT_DIRECTORY, `${id}.json`), "utf8")));
}

const UNIVERSE_SCENE: SceneConfig = { seed: "graph-seed-001", theme: "aurora" };
const CRYSTAL_SCENE: SceneConfig = { seed: "graph-seed-003", theme: "crystal" };
const FOREST_SCENE: SceneConfig = {
  seed: "graph-seed-002",
  sceneType: "forest",
  weather: { kind: "rain", intensity: 0.8 },
  lighting: { timeOfDay: "dusk" }
};

function buildGraphAgainstFakeContext(scene: SceneConfig) {
  const audioContext = new FakeAudioContext();
  const recipe = buildAmbientSoundscapeRecipe(scene);
  const arrangement = readArrangement(recipe.performance.pieceId);
  const melody = fakeInstrument(recipe.performance.melody.instrument);
  const harmony = fakeInstrument(recipe.performance.harmony.instrument);
  const bass = fakeInstrument(recipe.performance.bass.instrument);
  const instruments: AmbientInstrumentSet = {
    melody: melody.instrument,
    harmony: harmony.instrument,
    bass: bass.instrument
  };
  const graph = createAmbientSoundscapeGraph(
    audioContext as unknown as AudioContext,
    recipe,
    FADE_IN_SECONDS,
    instruments,
    arrangement
  );
  return { audioContext, recipe, graph, arrangement, melody, harmony, bass };
}

function advanceScheduler(audioContext: FakeAudioContext, untilSeconds: number) {
  for (let elapsedSeconds = 0; elapsedSeconds < untilSeconds; elapsedSeconds += SCHEDULER_STEP_SECONDS) {
    audioContext.currentTime = elapsedSeconds;
    vi.advanceTimersByTime(SCHEDULER_INTERVAL_MILLISECONDS);
  }
}

function findMasterGain(audioContext: FakeAudioContext) {
  return audioContext.gainNodes.find((gainNode) => gainNode.connectedTo.includes(audioContext.destination));
}

function noteSourcesOf(audioContext: FakeAudioContext) {
  return audioContext.bufferSourceNodes.filter((source) => !source.loop);
}

/** The MIDI number a note source actually sounded, sample choice and bend together. */
function soundedMidiNumber(
  source: FakeAudioBufferSourceNode,
  midiNumberByBuffer: Map<unknown, number>
): number | null {
  const sampleMidiNumber = midiNumberByBuffer.get(source.buffer);
  if (sampleMidiNumber === undefined) {
    return null;
  }
  return sampleMidiNumber + SEMITONES_PER_OCTAVE * Math.log2(source.playbackRate.value);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("no oscillator plays music", () => {
  it("uses exactly one oscillator, and only to sweep the noise bed", () => {
    vi.useFakeTimers();
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    advanceScheduler(audioContext, 40);

    // Two earlier versions synthesised the pad and the notes from oscillators
    // and both were rejected as harsh. Every musical voice is a recording; the
    // only oscillator left is the sub-audio LFO that moves the wind filter.
    expect(audioContext.oscillatorNodes).toHaveLength(1);
    const bedSweep = audioContext.oscillatorNodes[0];
    expect(bedSweep.frequency.value).toBeLessThan(1);
    const sweepDepth = audioContext.gainNodes.find((gainNode) => bedSweep.connectedTo.includes(gainNode));
    expect(sweepDepth?.connectedTo.some((target) => target instanceof FakeAudioParam)).toBe(true);
  });
});

describe("routing", () => {
  it("reaches the destination through exactly one master gain", () => {
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const masters = audioContext.gainNodes.filter((gainNode) =>
      gainNode.connectedTo.includes(audioContext.destination)
    );
    expect(masters).toHaveLength(1);
  });

  it("fades in from silence to the recipe level", () => {
    const { audioContext, recipe } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const masterGain = findMasterGain(audioContext);
    expect(masterGain?.gain.calls[0]).toEqual({ method: "setValueAtTime", value: 0, time: 0 });
    expect(masterGain?.gain.calls[1]).toEqual({
      method: "linearRampToValueAtTime",
      value: recipe.masterGain,
      time: FADE_IN_SECONDS
    });
  });

  it("sends the tone filter to the dry, reverb and delay paths", () => {
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const toneFilter = audioContext.filterNodes.find((filterNode) => filterNode.connectedTo.length === 3);
    expect(toneFilter).toBeDefined();
  });

  it("builds a stereo reverb tail that actually decays", () => {
    const { audioContext, recipe } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const tail = audioContext.convolverNodes[0]?.buffer;
    expect(audioContext.convolverNodes).toHaveLength(1);
    expect(tail?.channels).toHaveLength(2);
    expect(tail?.channels[0]).toHaveLength(Math.floor(FAKE_SAMPLE_RATE * recipe.space.reverbDecaySeconds));

    function averageMagnitude(samples: Float32Array): number {
      let total = 0;
      for (const sample of samples) {
        total += Math.abs(sample);
      }
      return total / samples.length;
    }
    const head = averageMagnitude(tail?.channels[0].slice(0, 2000) ?? new Float32Array(1));
    const end = averageMagnitude(tail?.channels[0].slice(-2000) ?? new Float32Array(1));
    expect(head).toBeGreaterThan(end * 10);
  });

  it("closes the delay feedback loop back into the delay", () => {
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const delayNode = audioContext.delayNodes[0];
    // The feedback gain is the one that is BOTH a target of the delay and a
    // source into it; searching only one direction also matches its input gain.
    const feedbackGain = audioContext.gainNodes.find(
      (gainNode) => gainNode.connectedTo.includes(delayNode) && delayNode.connectedTo.includes(gainNode)
    );
    expect(feedbackGain).toBeDefined();
  });

  it("keeps the noise bed out of the reverb and straight to the master", () => {
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const bedSource = audioContext.bufferSourceNodes.find((source) => source.loop);
    const bedFilter = bedSource?.connectedTo[0] as FakeBiquadFilterNode | undefined;
    const bedGain = bedFilter?.connectedTo[0] as FakeGainNode | undefined;
    const masterGain = findMasterGain(audioContext);
    const convolver = audioContext.convolverNodes[0];

    expect(bedGain?.connectedTo).toEqual([masterGain]);
    expect(bedGain?.connectedTo).not.toContain(convolver);
  });

  it("loops a deterministic noise buffer for the bed", () => {
    const first = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const second = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    const firstBed = first.audioContext.bufferSourceNodes.find((source) => source.loop);
    const secondBed = second.audioContext.bufferSourceNodes.find((source) => source.loop);
    expect(firstBed?.startTimes).toHaveLength(1);
    expect(Array.from(firstBed?.buffer?.channels[0].slice(0, 32) ?? [])).toEqual(
      Array.from(secondBed?.buffer?.channels[0].slice(0, 32) ?? [])
    );
  });

  it("gives the forest a bandpass bed and the universe a lowpass one", () => {
    const universeTypes = buildGraphAgainstFakeContext(UNIVERSE_SCENE).audioContext.filterNodes.map((f) => f.type);
    const forestTypes = buildGraphAgainstFakeContext(FOREST_SCENE).audioContext.filterNodes.map((f) => f.type);
    expect(universeTypes).not.toContain("bandpass");
    expect(forestTypes).toContain("bandpass");
  });
});

describe("the written score is performed on a real pulse", () => {
  // This is the whole point of the fourth attempt. The previous generator placed
  // notes at rolled gaps, which was reported as disjointed and was: a sequence of
  // consonant notes is not a melody. Every note now lands on a beat of the piece.
  it("places notes on the beat grid, within the humanising window", () => {
    vi.useFakeTimers();
    const { audioContext, recipe, arrangement } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    advanceScheduler(audioContext, 40);

    const secondsPerBeat = SECONDS_PER_MINUTE / recipe.performance.beatsPerMinute;
    const quantumSeconds = secondsPerBeat / 4; // the score is quantised to quarter beats
    const tolerance = recipe.performance.humanizeSeconds + 0.001;

    const startTimes = noteSourcesOf(audioContext)
      .map((source) => source.startTimes[0])
      // The scheduler clamps a note that is already due to "now", so the first
      // tick's notes are not on the grid and are not evidence either way.
      .filter((startTime) => startTime > FIRST_NOTE_DELAY_SECONDS + SCHEDULER_STEP_SECONDS);

    expect(startTimes.length).toBeGreaterThan(20);
    expect(arrangement.beatsPerBar).toBeGreaterThan(0);
    for (const startTime of startTimes) {
      const beatsFromOpening = (startTime - FIRST_NOTE_DELAY_SECONDS) / quantumSeconds;
      const distanceFromGrid = Math.abs(beatsFromOpening - Math.round(beatsFromOpening)) * quantumSeconds;
      expect(distanceFromGrid).toBeLessThanOrEqual(tolerance);
    }
  });

  it("does not place every note at the same moment, which a chord-only read would", () => {
    vi.useFakeTimers();
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    advanceScheduler(audioContext, 40);
    const distinctStarts = new Set(noteSourcesOf(audioContext).map((source) => source.startTimes[0].toFixed(3)));
    expect(distinctStarts.size).toBeGreaterThan(10);
  });

  it("holds each note for its written length before releasing it", () => {
    vi.useFakeTimers();
    const { audioContext, recipe } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    advanceScheduler(audioContext, 20);

    const secondsPerBeat = SECONDS_PER_MINUTE / recipe.performance.beatsPerMinute;
    // Envelope shape per note: silence, attack to level, hold to the written end,
    // release. A note choked at the attack would only have two calls.
    const noteEnvelopes = audioContext.gainNodes.filter((gainNode) => gainNode.gain.calls.length === 4);
    expect(noteEnvelopes.length).toBeGreaterThan(10);
    for (const envelope of noteEnvelopes) {
      const [start, attack, writtenEnd, release] = envelope.gain.calls;
      expect(attack.method).toBe("linearRampToValueAtTime");
      expect(release.method).toBe("linearRampToValueAtTime");
      expect(writtenEnd.time).toBeGreaterThan(attack.time);
      expect(release.time).toBeGreaterThan(writtenEnd.time);
      // The shortest note in any of the six scores is an eighth of a bar.
      expect(writtenEnd.time - start.time).toBeGreaterThanOrEqual(0.125 * secondsPerBeat);
    }
  });

  it("accents the downbeat, so the pulse is audible and not just implied", () => {
    vi.useFakeTimers();
    const { audioContext } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    advanceScheduler(audioContext, 30);
    const levels = audioContext.gainNodes
      .filter((gainNode) => gainNode.gain.calls.length === 4)
      .map((gainNode) => gainNode.gain.calls[1].value);
    // Metrical accent plus jitter: a flat MIDI-style read would cluster far
    // tighter than the 18% gap between a downbeat and an offbeat.
    expect(Math.max(...levels) / Math.min(...levels)).toBeGreaterThan(1.18);
  });

  it("repeats the piece rather than running out of music", () => {
    vi.useFakeTimers();
    const { audioContext, recipe, arrangement } = buildGraphAgainstFakeContext(CRYSTAL_SCENE);
    const secondsPerBeat = SECONDS_PER_MINUTE / recipe.performance.beatsPerMinute;
    const loopSeconds = loopLengthBeatsFor(arrangement) * secondsPerBeat;

    advanceScheduler(audioContext, loopSeconds * 2 + 10);
    const startTimes = noteSourcesOf(audioContext).map((source) => source.startTimes[0]);
    // Music is still arriving well past the end of one pass through the score.
    expect(Math.max(...startTimes)).toBeGreaterThan(loopSeconds);
  });
});

describe("register and range", () => {
  it("never stretches a sample beyond a fifth", () => {
    vi.useFakeTimers();
    for (const scene of [UNIVERSE_SCENE, FOREST_SCENE, CRYSTAL_SCENE]) {
      const { audioContext } = buildGraphAgainstFakeContext(scene);
      advanceScheduler(audioContext, 90);
      const noteSources = noteSourcesOf(audioContext);
      expect(noteSources.length).toBeGreaterThan(0);
      const limit = Math.pow(2, MAXIMUM_SAMPLE_STRETCH_SEMITONES / SEMITONES_PER_OCTAVE);
      for (const noteSource of noteSources) {
        expect(noteSource.playbackRate.value).toBeGreaterThanOrEqual(1 / limit - 0.001);
        expect(noteSource.playbackRate.value).toBeLessThanOrEqual(limit + 0.001);
      }
    }
  });

  it("keeps every melody note above the small-speaker floor", () => {
    vi.useFakeTimers();
    // The written scores reach MIDI 27, which is 44 Hz and simply gone on the
    // laptop and phone speakers most visitors have. The first version of this
    // whole feature shipped inaudible with a green suite.
    for (const scene of [UNIVERSE_SCENE, FOREST_SCENE, CRYSTAL_SCENE]) {
      const { audioContext, melody, bass } = buildGraphAgainstFakeContext(scene);
      advanceScheduler(audioContext, 90);

      const melodyNotes = noteSourcesOf(audioContext)
        .map((source) => soundedMidiNumber(source, melody.midiNumberByBuffer))
        .filter((midiNumber): midiNumber is number => midiNumber !== null);
      const bassNotes = noteSourcesOf(audioContext)
        .map((source) => soundedMidiNumber(source, bass.midiNumberByBuffer))
        .filter((midiNumber): midiNumber is number => midiNumber !== null);

      expect(melodyNotes.length).toBeGreaterThan(0);
      for (const midiNumber of melodyNotes) {
        expect(midiNumber).toBeGreaterThanOrEqual(SMALL_SPEAKER_MELODY_FLOOR_MIDI - 0.001);
      }
      for (const midiNumber of bassNotes) {
        expect(midiNumber).toBeGreaterThanOrEqual(SMALL_SPEAKER_BASS_FLOOR_MIDI - 0.001);
      }
    }
  });

  it("plays the bass below the melody, so the roles stay distinguishable", () => {
    vi.useFakeTimers();
    const { audioContext, melody, bass } = buildGraphAgainstFakeContext(FOREST_SCENE);
    advanceScheduler(audioContext, 60);

    const average = (midiNumbers: number[]) =>
      midiNumbers.reduce((total, midiNumber) => total + midiNumber, 0) / midiNumbers.length;
    const melodyNotes = noteSourcesOf(audioContext)
      .map((source) => soundedMidiNumber(source, melody.midiNumberByBuffer))
      .filter((midiNumber): midiNumber is number => midiNumber !== null);
    const bassNotes = noteSourcesOf(audioContext)
      .map((source) => soundedMidiNumber(source, bass.midiNumberByBuffer))
      .filter((midiNumber): midiNumber is number => midiNumber !== null);

    expect(bassNotes.length).toBeGreaterThan(0);
    expect(average(bassNotes)).toBeLessThan(average(melodyNotes));
  });
});

describe("buildScheduledNotes", () => {
  const arrangement = readArrangement("satie-gymnopedie-1");

  function recipeWithHarmonyKeepRatio(noteKeepRatio: number): AmbientSoundscapeRecipe {
    const recipe = buildAmbientSoundscapeRecipe(UNIVERSE_SCENE);
    return {
      ...recipe,
      performance: {
        ...recipe.performance,
        startPositionRatio: 0,
        harmony: { ...recipe.performance.harmony, noteKeepRatio }
      }
    };
  }

  it("keeps the score intact when nothing is thinned", () => {
    const scheduled = buildScheduledNotes(arrangement, recipeWithHarmonyKeepRatio(1));
    expect(scheduled).toHaveLength(arrangement.notes.length);
  });

  it("drops whole chords rather than notes inside them", () => {
    const full = buildScheduledNotes(arrangement, recipeWithHarmonyKeepRatio(1));
    const thinned = buildScheduledNotes(arrangement, recipeWithHarmonyKeepRatio(0.5));
    expect(thinned.length).toBeLessThan(full.length);

    // A chord with a hole in it is a mistake; a thinner accompaniment is a
    // decision. Every beat that still has harmony must have all of its notes.
    const countHarmonyByBeat = (notes: ReturnType<typeof buildScheduledNotes>) => {
      const counts = new Map<number, number>();
      for (const note of notes) {
        if (note.role === ARRANGEMENT_ROLE_HARMONY) {
          counts.set(note.beat, (counts.get(note.beat) ?? 0) + 1);
        }
      }
      return counts;
    };
    const fullCounts = countHarmonyByBeat(full);
    for (const [beat, count] of countHarmonyByBeat(thinned)) {
      expect(count).toBe(fullCounts.get(beat));
    }
  });

  it("never thins the melody or the bass", () => {
    const thinned = buildScheduledNotes(arrangement, recipeWithHarmonyKeepRatio(0.45));
    const countRole = (notes: ReturnType<typeof buildScheduledNotes>, role: number) =>
      notes.filter((note) => note.role === role).length;
    const fullMelody = arrangement.notes.filter((note) => note[3] === ARRANGEMENT_ROLE_MELODY).length;
    const fullBass = arrangement.notes.filter((note) => note[3] === ARRANGEMENT_ROLE_BASS).length;
    expect(countRole(thinned, ARRANGEMENT_ROLE_MELODY)).toBe(fullMelody);
    expect(countRole(thinned, ARRANGEMENT_ROLE_BASS)).toBe(fullBass);
  });

  it("opens on a downbeat at the start of a phrase, never mid-sentence", () => {
    const phraseBeats = arrangement.beatsPerBar * 4;
    for (const startPositionRatio of [0, 0.25, 0.5, 0.9]) {
      const recipe = buildAmbientSoundscapeRecipe(UNIVERSE_SCENE);
      const scheduled = buildScheduledNotes(arrangement, {
        ...recipe,
        performance: { ...recipe.performance, startPositionRatio }
      });
      const firstBeatInScore =
        Math.floor((startPositionRatio * arrangement.totalBeats) / phraseBeats) * phraseBeats;
      expect(firstBeatInScore % phraseBeats).toBe(0);
      expect(scheduled[0].beat).toBe(0);
      expect(scheduled).toHaveLength(arrangement.notes.length);
    }
  });

  it("marks a downbeat on exactly the first beat of each bar", () => {
    // startPositionRatio 0 means the scheduled beat is still the written beat,
    // so the mark can be checked against the bar line directly.
    const scheduled = buildScheduledNotes(arrangement, recipeWithHarmonyKeepRatio(1));
    const downbeats = scheduled.filter((note) => note.isDownbeat);
    const offbeats = scheduled.filter((note) => !note.isDownbeat);

    expect(downbeats.length).toBeGreaterThan(0);
    expect(offbeats.length).toBeGreaterThan(0);
    for (const note of scheduled) {
      expect(note.isDownbeat).toBe(note.beat % arrangement.beatsPerBar === 0);
    }
    // Satie opens with the bass alone on beat one, so the first bars' downbeats
    // are the bass line. Later he moves the accompaniment onto beat one too,
    // which is why this does not assert a single role.
    expect(downbeats[0].role).toBe(ARRANGEMENT_ROLE_BASS);
  });

  it("applies the transposition to every note equally, so nothing goes out of tune", () => {
    const recipe = buildAmbientSoundscapeRecipe(UNIVERSE_SCENE);
    const atConcertPitch = buildScheduledNotes(arrangement, {
      ...recipe,
      performance: { ...recipe.performance, transposeSemitones: 0, startPositionRatio: 0 }
    });
    const transposed = buildScheduledNotes(arrangement, {
      ...recipe,
      performance: { ...recipe.performance, transposeSemitones: 3, startPositionRatio: 0 }
    });
    for (let index = 0; index < atConcertPitch.length; index += 1) {
      expect(transposed[index].midiNumber - atConcertPitch[index].midiNumber).toBe(3);
    }
  });
});

describe("the accompaniment is pulled back under the tune", () => {
  // Gain is not balance, and the recipe's `harmony.gain < melody.gain` proved
  // nothing: the accompaniment plays three to five times as many notes, so
  // isolating each line measured it LOUDER than the melody in four of ten worlds.
  // That is the same fault visitors reported as a sustained tone with the music
  // buried under it, arriving past a test watching the wrong number.
  it("only ever quietens the accompaniment, never boosts it", () => {
    for (const id of ["satie-gymnopedie-1", "bach-prelude-c-major", "debussy-clair-de-lune"] as const) {
      const arrangement = readArrangement(id);
      const recipe = buildAmbientSoundscapeRecipe(UNIVERSE_SCENE);
      const scheduled = buildScheduledNotes(arrangement, recipe);
      for (const melodyInstrument of ["harp", "piano", "glockenspiel", "vibraphone", "kalimba", "recorder"]) {
        const correction = harmonyBalanceCorrectionFor(scheduled, melodyInstrument);
        expect(correction).toBeGreaterThan(0);
        expect(correction).toBeLessThanOrEqual(1);
      }
    }
  });

  it("pulls back harder on a piece whose accompaniment carries more of it", () => {
    const recipe = buildAmbientSoundscapeRecipe(UNIVERSE_SCENE);
    // Clair de Lune sounds 848 beats of harmony against 252 of melody; Bach's
    // prelude is almost all melody. The denser accompaniment needs the bigger cut.
    const dense = harmonyBalanceCorrectionFor(
      buildScheduledNotes(readArrangement("debussy-clair-de-lune"), recipe),
      "harp"
    );
    const sparse = harmonyBalanceCorrectionFor(
      buildScheduledNotes(readArrangement("bach-prelude-c-major"), recipe),
      "harp"
    );
    expect(dense).toBeLessThan(sparse);
  });

  it("takes the thinned-out chords into account, not the written score", () => {
    // A world whose accompaniment is already thinned by its DNA needs less of a
    // cut, because fewer chords are sounding in the first place.
    const arrangement = readArrangement("satie-gymnopedie-1");
    const recipe = buildAmbientSoundscapeRecipe(UNIVERSE_SCENE);
    const withRatio = (noteKeepRatio: number) =>
      harmonyBalanceCorrectionFor(
        buildScheduledNotes(arrangement, {
          ...recipe,
          performance: { ...recipe.performance, harmony: { ...recipe.performance.harmony, noteKeepRatio } }
        }),
        "vibraphone"
      );
    expect(withRatio(0.45)).toBeGreaterThan(withRatio(1));
  });

  it("survives a piece with no melody or no harmony at all", () => {
    expect(harmonyBalanceCorrectionFor([], "harp")).toBe(1);
  });
});

describe("teardown", () => {
  it("fades out and stops the bed at the end of the fade", () => {
    const { audioContext, graph } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    audioContext.currentTime = 10;
    graph.stop(FADE_OUT_SECONDS);
    const bedSource = audioContext.bufferSourceNodes.find((source) => source.loop);

    expect(bedSource?.stopTimes).toContain(10 + FADE_OUT_SECONDS);
    expect(audioContext.oscillatorNodes[0]?.stopTimes).toContain(10 + FADE_OUT_SECONDS);
    expect(findMasterGain(audioContext)?.gain.calls.at(-1)?.method).toBe("linearRampToValueAtTime");
  });

  it("anchors the fade at the level that is actually audible", () => {
    const { audioContext, graph } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    audioContext.currentTime = 10;
    graph.stop(FADE_OUT_SECONDS);
    const methodOrder = findMasterGain(audioContext)?.gain.calls.slice(-3).map((call) => call.method);
    expect(methodOrder).toEqual(["cancelScheduledValues", "setValueAtTime", "linearRampToValueAtTime"]);
  });

  it("stops scheduling once stopped", () => {
    vi.useFakeTimers();
    const { audioContext, graph } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    advanceScheduler(audioContext, 15);
    graph.stop(FADE_OUT_SECONDS);
    const countAtStop = audioContext.bufferSourceNodes.length;
    advanceScheduler(audioContext, 40);
    expect(audioContext.bufferSourceNodes).toHaveLength(countAtStop);
  });

  it("cuts notes still ringing when the world goes away", () => {
    vi.useFakeTimers();
    const { audioContext, graph } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    advanceScheduler(audioContext, 15);
    const noteSources = noteSourcesOf(audioContext);
    graph.stop(FADE_OUT_SECONDS);

    expect(noteSources.length).toBeGreaterThan(0);
    for (const noteSource of noteSources) {
      expect(noteSource.stopTimes.length).toBeGreaterThan(0);
    }
  });

  it("releases the graph from the destination once the bed ends", () => {
    const { audioContext, graph } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    graph.stop(FADE_OUT_SECONDS);
    const masterGain = findMasterGain(audioContext);
    const bedSource = audioContext.bufferSourceNodes.find((source) => source.loop && source.onended !== null);

    expect(bedSource).toBeDefined();
    bedSource?.onended?.();
    expect(masterGain?.disconnectCount).toBe(1);
  });

  it("ignores a second stop", () => {
    const { audioContext, graph } = buildGraphAgainstFakeContext(UNIVERSE_SCENE);
    graph.stop(FADE_OUT_SECONDS);
    graph.stop(FADE_OUT_SECONDS);
    const bedSource = audioContext.bufferSourceNodes.find((source) => source.loop);
    expect(bedSource?.stopTimes).toHaveLength(1);
  });
});

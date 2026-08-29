// --- Sampled instruments -----------------------------------------------------
//
// Real recorded instruments from the Versilian Community Sample Library (CC0),
// converted to small mono MP3s. See public/assets/audio/ATTRIBUTION.md.
//
// Why samples at all: the first two attempts synthesised everything from
// oscillators and both were rejected as harsh and lifeless. That is the same
// ceiling agent-system/knowledge/frontend/3d-development-limitations.md documents for the visuals —
// the algorithm is the cheap part, the asset is what decides whether the result
// is beautiful. Oscillator synthesis is the audio equivalent of a chair built
// out of boxes.
//
// Only a handful of notes per instrument ship. The sampler picks the nearest
// one and shifts it with playbackRate, which is transparent within a few
// semitones and is why the whole set costs about a megabyte.

export type SampledInstrumentKey =
  | "piano"
  | "pianoBass"
  | "harp"
  | "glockenspiel"
  | "vibraphone"
  | "kalimba"
  | "recorder"
  | "saxello";

export const SAMPLED_INSTRUMENT_KEYS: SampledInstrumentKey[] = [
  "piano",
  "pianoBass",
  "harp",
  "glockenspiel",
  "vibraphone",
  "kalimba",
  "recorder",
  "saxello"
];

// File names on disk. "s" stands in for a sharp so the names are URL-safe.
//
// `pianoBass` is a separate entry rather than four more notes on `piano`
// because it is only ever used for the bass line: the written scores reach down
// to MIDI 27 and every other instrument here starts at C4. Keeping it separate
// means a world with a harp melody loads four low notes, not a whole second
// piano it will never play above the stave.
export const SAMPLED_INSTRUMENT_NOTE_NAMES: Record<SampledInstrumentKey, string[]> = {
  piano: ["C4", "D4", "E4", "Fs4", "Gs4", "C5"],
  // Three notes, not four: the bass is floored at MIDI 43 for audibility, and a
  // C2 sample at 36 is never the nearest to anything at or above that.
  pianoBass: ["Fs2", "C3", "Fs3"],
  harp: ["D4", "F4", "A4", "C5", "E5", "G5"],
  glockenspiel: ["G4", "C5", "G5", "C6"],
  vibraphone: ["D4", "F4", "A4", "C5", "E5"],
  kalimba: ["Cs4", "Ds4", "Fs4", "A4", "B4"],
  recorder: ["C4", "D4", "E4", "Fs4", "Gs4", "C5"],
  saxello: ["D3", "As3", "D4", "As4"]
};

const SAMPLE_BASE_PATH = "/assets/audio";
const SEMITONES_PER_OCTAVE = 12;
const MIDDLE_C_MIDI_NUMBER = 60;
const MIDDLE_C_OCTAVE = 4;
const CONCERT_A_MIDI_NUMBER = 69;
const CONCERT_A_FREQUENCY_HERTZ = 440;

const PITCH_CLASS_SEMITONES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
};

/** "Fs4" / "As3" / "C5" to a MIDI note number (middle C is 60). */
export function noteNameToMidiNumber(noteName: string): number {
  const letter = noteName[0].toUpperCase();
  const isSharp = noteName[1] === "s" || noteName[1] === "#";
  const octave = Number.parseInt(noteName.slice(isSharp ? 2 : 1), 10);
  const pitchClass = PITCH_CLASS_SEMITONES[letter] ?? 0;
  return (
    MIDDLE_C_MIDI_NUMBER + (octave - MIDDLE_C_OCTAVE) * SEMITONES_PER_OCTAVE + pitchClass + (isSharp ? 1 : 0)
  );
}

export function midiNumberToFrequencyHertz(midiNumber: number): number {
  return CONCERT_A_FREQUENCY_HERTZ * Math.pow(2, (midiNumber - CONCERT_A_MIDI_NUMBER) / SEMITONES_PER_OCTAVE);
}

export function frequencyHertzToMidiNumber(frequencyHertz: number): number {
  return CONCERT_A_MIDI_NUMBER + SEMITONES_PER_OCTAVE * Math.log2(frequencyHertz / CONCERT_A_FREQUENCY_HERTZ);
}

export type LoadedInstrument = {
  key: SampledInstrumentKey;
  /** Sorted MIDI numbers of the samples that are actually available. */
  midiNumbers: number[];
  buffers: Map<number, AudioBuffer>;
};

/**
 * Nearest sampled note, and how far the sampler has to bend it. Keeping the
 * shift small is the whole point of shipping several notes per instrument: a
 * sample stretched an octave sounds like a cartoon.
 */
export function nearestSampledNote(
  instrument: LoadedInstrument,
  midiNumber: number
): { sampleMidiNumber: number; playbackRate: number } {
  let closest = instrument.midiNumbers[0];
  for (const candidate of instrument.midiNumbers) {
    if (Math.abs(candidate - midiNumber) < Math.abs(closest - midiNumber)) {
      closest = candidate;
    }
  }
  return {
    sampleMidiNumber: closest,
    playbackRate: Math.pow(2, (midiNumber - closest) / SEMITONES_PER_OCTAVE)
  };
}

// Fetched bytes are cached, not decoded buffers: decodeAudioData detaches its
// input and an AudioBuffer belongs to the context that decoded it.
const encodedSampleCache = new Map<string, ArrayBuffer>();

async function fetchEncodedSample(url: string): Promise<ArrayBuffer> {
  const cached = encodedSampleCache.get(url);
  if (cached) {
    return cached.slice(0);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`sample request failed: ${url} (${response.status})`);
  }
  const encoded = await response.arrayBuffer();
  encodedSampleCache.set(url, encoded);
  return encoded.slice(0);
}

/**
 * Load and decode every note of one instrument. Called by the hook before the
 * graph is built — the graph itself performs no I/O, which is what lets the
 * offline renderer feed it buffers read from disk instead.
 */
export async function loadSampledInstrument(
  audioContext: BaseAudioContext,
  key: SampledInstrumentKey
): Promise<LoadedInstrument> {
  const noteNames = SAMPLED_INSTRUMENT_NOTE_NAMES[key];
  const buffers = new Map<number, AudioBuffer>();
  await Promise.all(
    noteNames.map(async (noteName) => {
      const encoded = await fetchEncodedSample(`${SAMPLE_BASE_PATH}/${key}/${noteName}.mp3`);
      buffers.set(noteNameToMidiNumber(noteName), await audioContext.decodeAudioData(encoded));
    })
  );
  return {
    key,
    midiNumbers: [...buffers.keys()].sort((first, second) => first - second),
    buffers
  };
}

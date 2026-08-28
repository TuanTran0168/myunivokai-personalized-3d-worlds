// --- Written arrangements ----------------------------------------------------
//
// The notes the world actually plays are a real composition, not a random walk
// across a scale. Twelve public-domain piano pieces ship as note data; the
// arranger in lib/ambientSoundscape picks one and decides how it is performed.
//
// It was six, and six could not cover thirteen slots: Bach's C major prelude was
// answering for four of them — two universe themes' worth of geometry AND a
// clear forest AND snow — so worlds that share nothing else shared a tune. The
// six added pieces are chosen against the slot they fill rather than for
// variety's sake: the Raindrop prelude for rain, "By the Hearth" for snow,
// Träumerei for the dreamy nebula.
//
// Why: the generated version was rejected as disjointed, and it was. Drawing a
// consonant note at a random gap produces a note *sequence*; a melody needs a
// motif that returns, phrases that breathe, a pulse, and a cadence. Rather than
// model all of that, take it from composers who already wrote it down.
//
// Everything here is Public Domain — both the composition (all six composers
// died well over 70 years ago) and the engraving, which the Mutopia Project
// typesetters dedicated to the public domain. Famous modern songs are NOT an
// option however freely their sheet music circulates: the composition stays
// under copyright for 70 years after the composer's death (50 in Vietnam), and
// performing it with our own samples is exactly what a sync licence covers.
//
// See public/assets/audio/arrangements/ATTRIBUTION.md.

export type ArrangementPieceId =
  | "satie-gymnopedie-1"
  | "satie-gymnopedie-2"
  | "satie-gymnopedie-3"
  | "bach-prelude-c-major"
  | "bach-wtc2-prelude-c-major"
  | "chopin-prelude-e-minor"
  | "chopin-prelude-raindrop"
  | "debussy-arabesque-1"
  | "debussy-clair-de-lune"
  | "schumann-traumerei"
  | "scriabin-prelude-op11-1"
  | "tchaikovsky-seasons-january";

export const ARRANGEMENT_PIECE_IDS: ArrangementPieceId[] = [
  "satie-gymnopedie-1",
  "satie-gymnopedie-2",
  "satie-gymnopedie-3",
  "bach-prelude-c-major",
  "bach-wtc2-prelude-c-major",
  "chopin-prelude-e-minor",
  "chopin-prelude-raindrop",
  "debussy-arabesque-1",
  "debussy-clair-de-lune",
  "schumann-traumerei",
  "scriabin-prelude-op11-1",
  "tchaikovsky-seasons-january"
];

/**
 * Which line of the score a note belongs to. Assigned when the data was built,
 * by looking at what else was sounding at the same moment: the top line is the
 * melody, the bottom line is the bass, chord tones in between are harmony.
 *
 * This is what lets the arranger leave a whole layer out — a quiet world plays
 * the melody over a bass with no chords — without damaging the piece.
 */
export const ARRANGEMENT_ROLE_BASS = 0;
export const ARRANGEMENT_ROLE_HARMONY = 1;
export const ARRANGEMENT_ROLE_MELODY = 2;

export type ArrangementRole =
  | typeof ARRANGEMENT_ROLE_BASS
  | typeof ARRANGEMENT_ROLE_HARMONY
  | typeof ARRANGEMENT_ROLE_MELODY;

/**
 * One written note: `[startBeat, durationBeats, midiNumber, role]`.
 *
 * A tuple rather than an object because there are up to 1468 of them per piece
 * and this is generated data, not logic — the object form nearly triples the
 * transfer size for no gain in readability at the only place it is read.
 */
export type ArrangementNote = readonly [number, number, number, ArrangementRole];

export type Arrangement = {
  id: ArrangementPieceId;
  title: string;
  composer: string;
  composed: number;
  source: string;
  licence: string;
  beatsPerBar: number;
  originalBeatsPerMinute: number;
  totalBeats: number;
  lowestMidiNumber: number;
  highestMidiNumber: number;
  /** Sorted by start beat. The scheduler relies on that ordering. */
  notes: ArrangementNote[];
};

export const ARRANGEMENT_NOTE_START_BEAT_INDEX = 0;
export const ARRANGEMENT_NOTE_DURATION_INDEX = 1;
export const ARRANGEMENT_NOTE_MIDI_INDEX = 2;
export const ARRANGEMENT_NOTE_ROLE_INDEX = 3;

const ARRANGEMENT_BASE_PATH = "/assets/audio/arrangements";
const ARRANGEMENT_TUPLE_LENGTH = 4;

const arrangementCache = new Map<ArrangementPieceId, Arrangement>();

function isArrangementNote(candidate: unknown): candidate is ArrangementNote {
  if (!Array.isArray(candidate) || candidate.length !== ARRANGEMENT_TUPLE_LENGTH) {
    return false;
  }
  if (!candidate.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return false;
  }
  const role = candidate[ARRANGEMENT_NOTE_ROLE_INDEX];
  return role === ARRANGEMENT_ROLE_BASS || role === ARRANGEMENT_ROLE_HARMONY || role === ARRANGEMENT_ROLE_MELODY;
}

/**
 * Validate a fetched arrangement. These files are our own build output rather
 * than user input, but they are fetched over the network into a scheduler that
 * would otherwise happily schedule a NaN, so they get checked like any other
 * response crossing into the app.
 */
export function parseArrangement(id: ArrangementPieceId, payload: unknown): Arrangement {
  if (typeof payload !== "object" || payload === null) {
    throw new Error(`arrangement ${id}: payload is not an object`);
  }
  const candidate = payload as Record<string, unknown>;
  const notes = candidate.notes;
  if (!Array.isArray(notes) || notes.length === 0) {
    throw new Error(`arrangement ${id}: no notes`);
  }
  if (!notes.every(isArrangementNote)) {
    throw new Error(`arrangement ${id}: malformed note tuple`);
  }
  const beatsPerBar = candidate.beatsPerBar;
  const totalBeats = candidate.totalBeats;
  if (typeof beatsPerBar !== "number" || beatsPerBar <= 0) {
    throw new Error(`arrangement ${id}: bad beatsPerBar`);
  }
  if (typeof totalBeats !== "number" || totalBeats <= 0) {
    throw new Error(`arrangement ${id}: bad totalBeats`);
  }
  return {
    id,
    title: String(candidate.title ?? id),
    composer: String(candidate.composer ?? ""),
    composed: Number(candidate.composed ?? 0),
    source: String(candidate.source ?? ""),
    licence: String(candidate.licence ?? ""),
    beatsPerBar,
    originalBeatsPerMinute: Number(candidate.originalBeatsPerMinute ?? 60),
    totalBeats,
    lowestMidiNumber: Number(candidate.lowestMidiNumber ?? 0),
    highestMidiNumber: Number(candidate.highestMidiNumber ?? 127),
    notes: notes as ArrangementNote[]
  };
}

/**
 * Fetch one piece. Unlike the instrument samples this is decode-free data, so
 * the parsed result is cached directly rather than the encoded bytes.
 */
export async function loadArrangement(id: ArrangementPieceId): Promise<Arrangement> {
  const cached = arrangementCache.get(id);
  if (cached) {
    return cached;
  }
  const response = await fetch(`${ARRANGEMENT_BASE_PATH}/${id}.json`);
  if (!response.ok) {
    throw new Error(`arrangement request failed: ${id} (${response.status})`);
  }
  const arrangement = parseArrangement(id, await response.json());
  arrangementCache.set(id, arrangement);
  return arrangement;
}

/** Notes belonging to one line of the score, still in start order. */
export function notesForRole(arrangement: Arrangement, role: ArrangementRole): ArrangementNote[] {
  return arrangement.notes.filter((note) => note[ARRANGEMENT_NOTE_ROLE_INDEX] === role);
}

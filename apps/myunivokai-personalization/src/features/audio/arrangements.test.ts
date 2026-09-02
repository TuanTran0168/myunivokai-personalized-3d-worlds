import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARRANGEMENT_NOTE_DURATION_INDEX,
  ARRANGEMENT_NOTE_MIDI_INDEX,
  ARRANGEMENT_NOTE_ROLE_INDEX,
  ARRANGEMENT_NOTE_START_BEAT_INDEX,
  ARRANGEMENT_PIECE_IDS,
  ARRANGEMENT_ROLE_BASS,
  ARRANGEMENT_ROLE_HARMONY,
  ARRANGEMENT_ROLE_MELODY,
  notesForRole,
  parseArrangement,
  type ArrangementPieceId
} from "./arrangements";

// The arrangements are shipped data rather than code, which means nothing else
// in the suite would notice if a file went missing, got truncated by a bad
// deploy, or came out of the converter with a NaN in it. These tests read the
// real files off disk and check the shipped bytes.

const ARRANGEMENT_DIRECTORY = join(process.cwd(), "public", "assets", "audio", "arrangements");

const LOWEST_SENSIBLE_MIDI_NUMBER = 21; // A0, the bottom of a piano
const HIGHEST_SENSIBLE_MIDI_NUMBER = 108; // C8, the top of a piano
const SHORTEST_SENSIBLE_BEATS = 0.125;

function readShippedArrangement(id: ArrangementPieceId) {
  return parseArrangement(id, JSON.parse(readFileSync(join(ARRANGEMENT_DIRECTORY, `${id}.json`), "utf8")));
}

describe("every shipped arrangement", () => {
  it.each(ARRANGEMENT_PIECE_IDS)("%s parses and is internally consistent", (id) => {
    const arrangement = readShippedArrangement(id);

    expect(arrangement.id).toBe(id);
    expect(arrangement.notes.length).toBeGreaterThan(100);
    expect(arrangement.beatsPerBar).toBeGreaterThan(0);
    expect(arrangement.totalBeats).toBeGreaterThan(arrangement.beatsPerBar);

    for (const note of arrangement.notes) {
      expect(note[ARRANGEMENT_NOTE_START_BEAT_INDEX]).toBeGreaterThanOrEqual(0);
      expect(note[ARRANGEMENT_NOTE_START_BEAT_INDEX]).toBeLessThanOrEqual(arrangement.totalBeats);
      expect(note[ARRANGEMENT_NOTE_DURATION_INDEX]).toBeGreaterThanOrEqual(SHORTEST_SENSIBLE_BEATS);
      expect(note[ARRANGEMENT_NOTE_MIDI_INDEX]).toBeGreaterThanOrEqual(LOWEST_SENSIBLE_MIDI_NUMBER);
      expect(note[ARRANGEMENT_NOTE_MIDI_INDEX]).toBeLessThanOrEqual(HIGHEST_SENSIBLE_MIDI_NUMBER);
    }
  });

  it.each(ARRANGEMENT_PIECE_IDS)("%s is sorted by start beat, which the scheduler relies on", (id) => {
    const arrangement = readShippedArrangement(id);
    for (let index = 1; index < arrangement.notes.length; index += 1) {
      expect(arrangement.notes[index][ARRANGEMENT_NOTE_START_BEAT_INDEX]).toBeGreaterThanOrEqual(
        arrangement.notes[index - 1][ARRANGEMENT_NOTE_START_BEAT_INDEX]
      );
    }
  });

  it.each(ARRANGEMENT_PIECE_IDS)("%s carries all three lines, so no layer is ever empty", (id) => {
    const arrangement = readShippedArrangement(id);
    // The arranger can leave a line out on purpose. It must never be forced to
    // because the data has none: a world whose accompaniment is thinned would
    // otherwise fall silent instead of getting thinner.
    expect(notesForRole(arrangement, ARRANGEMENT_ROLE_BASS).length).toBeGreaterThan(0);
    expect(notesForRole(arrangement, ARRANGEMENT_ROLE_HARMONY).length).toBeGreaterThan(0);
    expect(notesForRole(arrangement, ARRANGEMENT_ROLE_MELODY).length).toBeGreaterThan(0);
  });

  it.each(ARRANGEMENT_PIECE_IDS)("%s stays in the public domain", (id) => {
    const arrangement = readShippedArrangement(id);
    // Famous modern songs are not an option however freely their sheet music
    // circulates. If this ever fails, someone added a piece we cannot ship.
    expect(arrangement.licence).toBe("Public Domain");
    expect(arrangement.source).toContain("mutopiaproject.org");
    expect(arrangement.composed).toBeLessThan(1930);
  });

  it("keeps the bass under the melody, which is what makes the roles roles", () => {
    for (const id of ARRANGEMENT_PIECE_IDS) {
      const arrangement = readShippedArrangement(id);
      const averagePitch = (role: 0 | 1 | 2) => {
        const notes = notesForRole(arrangement, role);
        return notes.reduce((total, note) => total + note[ARRANGEMENT_NOTE_MIDI_INDEX], 0) / notes.length;
      };
      expect(averagePitch(ARRANGEMENT_ROLE_BASS)).toBeLessThan(averagePitch(ARRANGEMENT_ROLE_MELODY));
    }
  });
});

describe("Gymnopédie No. 1 came through the converter as Satie wrote it", () => {
  // A spot check against the engraving, because a role detector that looked
  // plausible was in fact promoting the top note of the opening chords to melody
  // for four bars before the tune enters. Reading the LilyPond source is what
  // caught it; this keeps it caught.
  const OPENING_BASS_MIDI_NUMBERS = [43, 38, 43, 38]; // G2 D2 G2 D2, one per bar
  const OPENING_CHORD_MIDI_NUMBERS = [59, 62, 66]; // B3 D4 F#4 on beat two
  const FIRST_MELODY_BAR = 5;

  const arrangement = readShippedArrangement("satie-gymnopedie-1");

  it("puts one bass note on each opening downbeat", () => {
    const bassNotes = notesForRole(arrangement, ARRANGEMENT_ROLE_BASS).slice(0, 4);
    expect(bassNotes.map((note) => note[ARRANGEMENT_NOTE_MIDI_INDEX])).toEqual(OPENING_BASS_MIDI_NUMBERS);
    expect(bassNotes.map((note) => note[ARRANGEMENT_NOTE_START_BEAT_INDEX])).toEqual([0, 3, 6, 9]);
  });

  it("puts the first chord on beat two, not beat one — the Gymnopédie lilt", () => {
    const firstChord = notesForRole(arrangement, ARRANGEMENT_ROLE_HARMONY).filter(
      (note) => note[ARRANGEMENT_NOTE_START_BEAT_INDEX] === 1
    );
    expect(firstChord.map((note) => note[ARRANGEMENT_NOTE_MIDI_INDEX])).toEqual(OPENING_CHORD_MIDI_NUMBERS);
  });

  it("holds the melody back until bar five", () => {
    const firstMelodyBeat = notesForRole(arrangement, ARRANGEMENT_ROLE_MELODY)[0][ARRANGEMENT_NOTE_START_BEAT_INDEX];
    expect(firstMelodyBeat).toBeGreaterThanOrEqual((FIRST_MELODY_BAR - 1) * arrangement.beatsPerBar);
    expect(firstMelodyBeat).toBeLessThan(FIRST_MELODY_BAR * arrangement.beatsPerBar);
  });
});

describe("parseArrangement rejects what it cannot schedule", () => {
  const VALID_NOTE = [0, 1, 60, ARRANGEMENT_ROLE_MELODY];
  const validPayload = { beatsPerBar: 3, totalBeats: 12, notes: [VALID_NOTE] };

  it("accepts a minimal well-formed payload", () => {
    expect(parseArrangement("satie-gymnopedie-1", validPayload).notes).toHaveLength(1);
  });

  it.each([
    ["not an object", null],
    ["no notes", { ...validPayload, notes: [] }],
    ["a short tuple", { ...validPayload, notes: [[0, 1, 60]] }],
    ["a NaN in a tuple", { ...validPayload, notes: [[0, Number.NaN, 60, 2]] }],
    ["an unknown role", { ...validPayload, notes: [[0, 1, 60, 9]] }],
    ["a zero tempo grid", { ...validPayload, beatsPerBar: 0 }],
    ["a zero length", { ...validPayload, totalBeats: 0 }]
  ])("throws on %s", (_label, payload) => {
    // A NaN reaching the scheduler is scheduled, silently, forever.
    expect(() => parseArrangement("satie-gymnopedie-1", payload)).toThrow();
  });
});

// --- MIDI to arrangement JSON -------------------------------------------------
//
// Turns a Mutopia Project .mid into the note data a world plays. Runs once per
// asset, needs no dependency, and is IN the repository this time: the previous
// converter was treated as throwaway, and rebuilding it from the prose in
// ATTRIBUTION.md to add six pieces was most of a day's work.
//
//   node tools/midi-to-arrangement.mjs in.mid --json public/assets/audio/arrangements/id.json \
//     --meta id=chopin-prelude-raindrop --meta "title=Prelude Op. 28 No. 15" \
//     --meta "composer=Frédéric Chopin" --meta composed=1839 \
//     --meta "source=https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=471"
//
// VERIFIED: run against the six MIDIs the original six arrangements came from,
// this reproduces all six note arrays byte-for-byte. Three details had to be
// recovered to get there, and each one is load-bearing rather than cosmetic —
// they are commented at the point they apply:
//
//   1. A note's role is decided by what overlaps its whole DURATION, not by what
//      happens to be sounding at its onset. Bach's BWV 846 strikes its held bass
//      note before anything else in the bar, so at its onset it is the only note
//      sounding — onset-only labelling made 545 of 549 notes melody.
//   2. Start and duration are quantised independently. Quantising the END
//      instead rounds a triplet's start down and its end up, which doubles every
//      note of a piece written in triplets.
//   3. A note that is alone in its interval is bass if it is on the lower staff
//      and melody if it is on the upper one. Neither blanket answer reproduces
//      Arabesque No. 1.

import { readFileSync, writeFileSync } from "node:fs";

const QUANTISE_BEATS = 0.25;
// Three, not two. Debussy doubles the melody of Clair de Lune at the octave and
// in thirds, so treating a PAIR as a chord demoted almost all of it — 164 melody
// notes against 1024 harmony ones, a chattering accompaniment with barely a tune
// over it. At three the melody recovers to 264, which is the shipped file.
const CHORD_TONE_MINIMUM_GROUP = 3;
const DEFAULT_MICROSECONDS_PER_QUARTER = 500000;

// --- MIDI ---------------------------------------------------------------------

function readVariableLength(bytes, cursor) {
  let value = 0;
  for (;;) {
    const byte = bytes[cursor.at++];
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      return value;
    }
  }
}

export function parseMidi(bytes) {
  if (bytes.toString("ascii", 0, 4) !== "MThd") {
    throw new Error("not a MIDI file");
  }
  const trackCount = bytes.readUInt16BE(10);
  const division = bytes.readUInt16BE(12);
  if (division & 0x8000) {
    throw new Error("SMPTE time division is not supported");
  }
  const ticksPerQuarter = division;

  const tracks = [];
  let microsecondsPerQuarter = DEFAULT_MICROSECONDS_PER_QUARTER;
  let timeSignature = { numerator: 4, denominator: 4 };
  let sawTimeSignature = false;

  let offset = 14;
  for (let trackIndex = 0; trackIndex < trackCount; trackIndex++) {
    if (bytes.toString("ascii", offset, offset + 4) !== "MTrk") {
      break;
    }
    const length = bytes.readUInt32BE(offset + 4);
    const end = offset + 8 + length;
    const cursor = { at: offset + 8 };
    let tick = 0;
    let runningStatus = 0;
    const open = new Map(); // midi -> [{ startTick, velocity }]
    const notes = [];

    while (cursor.at < end) {
      tick += readVariableLength(bytes, cursor);
      let status = bytes[cursor.at];
      if (status & 0x80) {
        cursor.at++;
        if (status < 0xf0) {
          runningStatus = status;
        }
      } else {
        status = runningStatus;
      }

      if (status === 0xff) {
        const metaType = bytes[cursor.at++];
        const metaLength = readVariableLength(bytes, cursor);
        if (metaType === 0x51 && metaLength === 3) {
          microsecondsPerQuarter =
            (bytes[cursor.at] << 16) | (bytes[cursor.at + 1] << 8) | bytes[cursor.at + 2];
        } else if (metaType === 0x58 && metaLength >= 2 && !sawTimeSignature) {
          timeSignature = { numerator: bytes[cursor.at], denominator: 2 ** bytes[cursor.at + 1] };
          sawTimeSignature = true;
        }
        cursor.at += metaLength;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        cursor.at += readVariableLength(bytes, cursor);
        continue;
      }

      const command = status & 0xf0;
      if (command === 0x90 || command === 0x80) {
        const midiNumber = bytes[cursor.at++];
        const velocity = bytes[cursor.at++];
        if (command === 0x90 && velocity > 0) {
          if (!open.has(midiNumber)) {
            open.set(midiNumber, []);
          }
          open.get(midiNumber).push(tick);
        } else {
          const pending = open.get(midiNumber);
          if (pending && pending.length > 0) {
            notes.push({ startTick: pending.shift(), endTick: tick, midiNumber, trackIndex });
          }
        }
      } else if (command === 0xa0 || command === 0xb0 || command === 0xe0) {
        cursor.at += 2;
      } else if (command === 0xc0 || command === 0xd0) {
        cursor.at += 1;
      }
    }
    tracks.push(notes);
    offset = end;
  }

  return {
    ticksPerQuarter,
    microsecondsPerQuarter,
    timeSignature,
    notes: tracks.flat()
  };
}

// --- Roles --------------------------------------------------------------------

export const ROLE_BASS = 0;
export const ROLE_HARMONY = 1;
export const ROLE_MELODY = 2;

function quantise(beats) {
  return Math.round(beats / QUANTISE_BEATS) * QUANTISE_BEATS;
}

/**
 * Label each note melody / harmony / bass by what else is sounding ACROSS ITS
 * WHOLE LENGTH: highest is the tune, lowest is the bass, anything between is a
 * chord tone. Then demote any "melody" note struck as part of a block of three
 * or more equal-length notes on its own staff — that is a chord, not a tune.
 *
 * Across its whole length, not at its onset, and that is the difference between
 * this working and not. Bach's BWV 846 strikes the held bass note of each bar
 * before any of the running notes above it, so at the instant it sounds it is
 * the only note there: onset-only labelling made it the highest note in its own
 * chord and promoted 545 of the piece's 549 notes to melody.
 */
function assignRoles(notes) {
  // Which staff is the left hand, for the one case the pitch comparison cannot
  // answer: a note alone in its interval, which is both the highest and the
  // lowest thing sounding. Arabesque No. 1 has 233 of them.
  const pitchByTrack = new Map();
  for (const note of notes) {
    const staff = pitchByTrack.get(note.trackIndex) ?? { total: 0, count: 0 };
    staff.total += note.midiNumber;
    staff.count += 1;
    pitchByTrack.set(note.trackIndex, staff);
  }
  const lowestStaff = [...pitchByTrack.entries()].sort(
    (left, right) => left[1].total / left[1].count - right[1].total / right[1].count
  )[0][0];

  const byStart = new Map();
  for (const note of notes) {
    const key = `${note.trackIndex}|${note.startBeat}|${note.durationBeats}`;
    byStart.set(key, (byStart.get(key) ?? 0) + 1);
  }

  const sorted = [...notes].sort((left, right) => left.startBeat - right.startBeat);
  for (const note of notes) {
    let highest = note.midiNumber;
    let lowest = note.midiNumber;
    for (const other of sorted) {
      if (other.startBeat >= note.endBeat) {
        break;
      }
      if (other.endBeat <= note.startBeat) {
        continue;
      }
      if (other.midiNumber > highest) {
        highest = other.midiNumber;
      }
      if (other.midiNumber < lowest) {
        lowest = other.midiNumber;
      }
    }
    if (note.midiNumber === lowest && (note.midiNumber !== highest || note.trackIndex === lowestStaff)) {
      note.role = ROLE_BASS;
    } else if (note.midiNumber === highest) {
      const blockSize = byStart.get(`${note.trackIndex}|${note.startBeat}|${note.durationBeats}`) ?? 1;
      note.role = blockSize >= CHORD_TONE_MINIMUM_GROUP ? ROLE_HARMONY : ROLE_MELODY;
    } else {
      note.role = ROLE_HARMONY;
    }
  }
  return notes;
}

// --- Build --------------------------------------------------------------------

export function buildArrangement(bytes, meta) {
  const midi = parseMidi(bytes);
  const beatsPerBar = (midi.timeSignature.numerator * 4) / midi.timeSignature.denominator;

  const notes = [];
  for (const raw of midi.notes) {
    const startBeat = quantise(raw.startTick / midi.ticksPerQuarter);
    // Start and duration are snapped independently. Snapping the END instead
    // rounds a triplet's start down and its end up, doubling every note in a
    // piece written in triplets — Arabesque No. 1 is entirely triplets.
    const durationBeats = Math.max(QUANTISE_BEATS, quantise((raw.endTick - raw.startTick) / midi.ticksPerQuarter));
    notes.push({
      startBeat,
      durationBeats,
      endBeat: startBeat + durationBeats,
      midiNumber: raw.midiNumber,
      trackIndex: raw.trackIndex
    });
  }
  assignRoles(notes);
  // Stable, and deliberately without a third key: two notes sharing a beat and
  // a pitch are the same pitch in both hands, and staff order is what keeps
  // them in the order the score has them.
  notes.sort((left, right) => left.startBeat - right.startBeat || left.midiNumber - right.midiNumber);

  const lastEndBeat = notes.reduce((furthest, note) => Math.max(furthest, note.endBeat), 0);
  const totalBeats = lastEndBeat;

  return {
    id: meta.id,
    title: meta.title,
    composer: meta.composer,
    composed: meta.composed,
    source: meta.source,
    licence: meta.licence ?? "Public Domain",
    beatsPerBar,
    originalBeatsPerMinute: Math.round(60000000 / midi.microsecondsPerQuarter),
    totalBeats,
    lowestMidiNumber: notes.reduce((lowest, note) => Math.min(lowest, note.midiNumber), 127),
    highestMidiNumber: notes.reduce((highest, note) => Math.max(highest, note.midiNumber), 0),
    notes: notes.map((note) => [note.startBeat, note.durationBeats, note.midiNumber, note.role])
  };
}

// --- CLI ----------------------------------------------------------------------

const [, , inputPath, ...rest] = process.argv;
if (inputPath) {
  const meta = { id: "", title: "", composer: "", composed: 0, source: "" };
  let outputPath = "";
  for (let index = 0; index < rest.length; index++) {
    if (rest[index] === "--json") {
      outputPath = rest[++index];
    } else if (rest[index] === "--meta") {
      const [key, ...value] = rest[++index].split("=");
      meta[key] = key === "composed" ? Number(value.join("=")) : value.join("=");
    }
  }
  const arrangement = buildArrangement(readFileSync(inputPath), meta);
  const roleCounts = [0, 0, 0];
  for (const note of arrangement.notes) {
    roleCounts[note[3]]++;
  }
  process.stderr.write(
    `${inputPath}: ${arrangement.notes.length} notes, ${arrangement.totalBeats / arrangement.beatsPerBar} bars ` +
      `of ${arrangement.beatsPerBar}, ${arrangement.originalBeatsPerMinute} bpm, ` +
      `midi ${arrangement.lowestMidiNumber}-${arrangement.highestMidiNumber}, ` +
      `bass/harm/mel ${roleCounts.join("/")}\n`
  );
  if (outputPath) {
    writeFileSync(outputPath, JSON.stringify(arrangement));
  }
}

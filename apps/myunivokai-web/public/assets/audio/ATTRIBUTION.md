# Audio asset attribution

## Versilian Community Sample Library (VCSL)

- **Source:** https://versilian-studios.com/vcsl/ — repository at https://github.com/sgossner/VCSL
- **Author:** Versilian Studios LLC
- **License:** **CC0 1.0 Universal (public domain)**. No royalties, no credit
  requirement, no restriction on commercial use. This file is kept because
  knowing where an asset came from is an engineering requirement, not because
  the licence demands one.

### What was taken

Six notes at most per instrument, chosen to span the range each one plays in.
The sampler picks the nearest note and shifts it with `playbackRate`, which is
transparent within a few semitones — that is why a whole orchestra of eight
instruments costs about a megabyte instead of hundreds.

| Folder | VCSL source | Notes |
| --- | --- | --- |
| `piano/` | Chordophones/Zithers/Grand Piano, Steinway B — NoSus, velocity 2 | C4 D4 E4 F#4 G#4 C5 |
| `pianoBass/` | the same, low register | F#2 C3 F#3 |
| `harp/` | Chordophones/Composite Chordophones/Concert Harp — mf | D4 F4 A4 C5 E5 G5 |
| `glockenspiel/` | Idiophones/Struck Idiophones/Glockenspiel — soft | G4 C5 G5 C6 |
| `vibraphone/` | Idiophones/Struck Idiophones/Vibraphone — Soft Mallets | D4 F4 A4 C5 E5 |
| `kalimba/` | Idiophones/Plucked Idiophones/Kalimba, Kenya | C#4 D#4 F#4 A4 B4 |
| `recorder/` | Aerophones/Edge-blown Aerophones/Baroque Alto Recorder — Sustain | C4 D4 E4 F#4 G#4 C5 |
| `saxello/` | Aerophones/Reed Aerophones/Saxello — Non-Vibrato, velocity 2 | D3 A#3 D4 A#4 |

Sharps are written `s` in file names (`Fs4`) so the paths are URL-safe.

### How they were processed

Source files are 44.1–48 kHz, 16- or 24-bit stereo WAV, 0.5–3.5 MB each — 71.7 MB
for the 39 taken. Each was:

1. decoded (hand-rolled WAV parsing: some VCSL files carry a 20-byte `fmt` chunk
   that browsers' `decodeAudioData` rejects as malformed, and the saxophones are
   24-bit);
2. mixed to mono and resampled to 32 kHz;
3. trimmed of leading silence, cut to 3–6 s depending on how long the instrument
   naturally rings (the bass notes ring longest), and faded out over 600 ms;
4. peak-normalised to 0.92, so the sampler can treat every note as equal and
   apply its own dynamics;
5. encoded to 64 kbps mono MP3.

Result: **39 files, 1.27 MB.** For comparison the solar-system textures alone are
30 MB. A world loads three instruments plus one score, not the whole set.

The conversion script is not kept in the repository — it runs once per asset and
needs two dev-only packages. Its steps are recorded above and in
[notes/knowledge/frontend/ambient-audio-mechanism.md](../../../../../notes/knowledge/frontend/ambient-audio-mechanism.md)
so it can be reproduced.

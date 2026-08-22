# Arrangement attribution

The notes every world plays are real compositions. Six of them, as note data.

## Why not a famous song

A composition stays under copyright for **70 years after the composer's death**
(50 in Vietnam), and that is separate from any recording of it. Sheet music
circulating freely online is mostly unlicensed upload; being downloadable does
not make it usable. Performing it with our own samples does not help either —
that is precisely what a synchronisation licence covers, and those are bought
per song and per territory.

So: public domain only, verified per file, composition **and** engraving.

## Source

[The Mutopia Project](https://www.mutopiaproject.org/) — scores typeset in
GNU LilyPond by volunteers, published as `.ly` source, PDF and MIDI.

Mutopia uses **three** different licences: CC BY-SA, CC BY, and Public Domain.
Only Public Domain files are used here. That mattered — Satie's *Gnossiennes*
and Debussy's *Deuxième Arabesque* were the obvious next picks and both are
CC BY-SA, so they were dropped rather than complied with.

| Piece | Composer | Composed | Mutopia | Licence |
| --- | --- | --- | --- | --- |
| Gymnopédie No. 1 | Erik Satie (d. 1925) | 1888 | [id 37](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=37) | Public Domain |
| Gymnopédie No. 2 | Erik Satie | 1888 | [id 38](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=38) | Public Domain |
| Gymnopédie No. 3 | Erik Satie | 1888 | [id 39](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=39) | Public Domain |
| Prelude in C major, BWV 846 | J. S. Bach (d. 1750) | 1722 | [id 218](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=218) | Public Domain |
| Première Arabesque | Claude Debussy (d. 1918) | 1891 | [id 1614](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1614) | Public Domain |
| Clair de Lune | Claude Debussy | 1905 | [id 1615](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1615) | Public Domain |

A test asserts the `licence` field of every shipped file, so a piece that cannot
be shipped cannot be added quietly.

## How the MIDI became note data

Each `.mid` was parsed and rewritten as `[startBeat, durationBeats, midiNumber,
role]` tuples, quantised to a quarter beat.

**Roles.** Each note is labelled melody, harmony or bass by looking at what else
is sounding at that moment: the top line is melody, the bottom is bass, chord
tones between are harmony. This is what lets the arranger thin or drop a whole
line without damaging the piece.

Two refinements, both found by comparing the output against the engraving rather
than by reading the code:

- A note struck with **three or more** others of the same length on the same
  staff is a chord tone, not melody. Without this the top voice of Gymnopédie
  No. 1's opening chords was promoted to melody for four bars before Satie's
  tune actually enters.
- Three, not two. Debussy doubles the melody of *Clair de Lune* at the octave and
  in thirds; treating a pair as a chord demoted almost all of it, leaving 164
  melody notes against 1024 harmony ones — a chattering accompaniment with barely
  a tune over it. At three the melody recovers to 264.

**Size.** 84 kB for all six, 3.7–23.6 kB each, and a world fetches exactly one.
For comparison the instrument samples are 1.1 MB and the solar-system textures
alone are 30 MB.

The converter is not kept in the repository — it runs once per asset and needs no
runtime dependency. Its steps are recorded here and in
[notes/fe/ambient-audio-mechanism.md](../../../../../../notes/fe/ambient-audio-mechanism.md).

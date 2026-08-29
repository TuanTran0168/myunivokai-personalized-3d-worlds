# Arrangement attribution

The notes every world plays are real compositions. Twelve of them, as note data.

It was six, and six could not cover thirteen slots. Bach's C major prelude was
answering for four of them — the crystal universe, a clear forest, snow, AND an
ocean surge — so worlds that share nothing else shared a tune. The six added
here were each chosen against the slot they fill rather than for variety's sake.

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
| Prelude in C major, BWV 870 (WTC II) | J. S. Bach | 1742 | [id 2223](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=2223) | Public Domain |
| Prelude Op. 28 No. 4 in E minor | Frédéric Chopin (d. 1849) | 1839 | [id 468](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=468) | Public Domain |
| Prelude Op. 28 No. 15 (Raindrop) | Frédéric Chopin | 1839 | [id 471](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=471) | Public Domain |
| Kinderszenen No. 7: Träumerei | Robert Schumann (d. 1856) | 1838 | [id 504](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=504) | Public Domain |
| Prelude Op. 11 No. 1 | Alexander Scriabin (d. 1915) | 1895 | [id 1779](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1779) | Public Domain |
| The Seasons Op. 37a: January | Pyotr Ilyich Tchaikovsky (d. 1893) | 1876 | [id 1171](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1171) | Public Domain |

A test asserts the `licence` field of every shipped file, so a piece that cannot
be shipped cannot be added quietly.

Every licence above was read off its own piece-info page before the file was
generated, not inferred from the composer's death date. Mutopia's catalogue was
crawled for this: of 788 piano pieces, **517** are Public Domain and the rest are
CC BY or CC BY-SA and unusable here.

## Why these six

Chosen against the slot, not for variety. The point of adding pieces was that a
snowy forest and a crystal universe should not sound the same, so a piece that
does not belong somewhere specific was not worth 20 kB.

| Slot | Piece | Why |
| --- | --- | --- |
| forest / rain | Raindrop prelude | Not for the nickname: the repeated A-flat runs unbroken under the whole piece, which is what rain on a canopy is. |
| forest / snow | The Seasons: January | Subtitled "By the Hearth", written for a Petersburg winter. |
| forest / overcast | Chopin Op. 28 No. 4 | A descending chromatic line over chords that barely change. Grey and heavy without being sad about it. |
| universe / nebula | Träumerei | Literally "Dreaming", and dreamy is the mood that builds a nebula. |
| universe / cyber-orbit | Scriabin Op. 11 No. 1 | Five notes against three for its whole length: two rates that never line up. |
| ocean / surge | Bach BWV 870 | The same running motion as BWV 846 with half again as many notes under each attack — and it leaves 846 to the crystal universe alone. |

Two of the six had to be re-homed after the offline render measured them, which
is the part worth remembering: **a piece being right for a slot is not the same
as it working there.** BWV 870 under a kalimba measured the accompaniment LOUDER
than the tune (0.70x) because 846 is almost bare — 67 bass and 70 harmony notes
against 412 melody — and that bareness, not Bach, is what a fast-decaying
instrument needs. Chopin's E minor prelude did the same under a piano (0.77x),
under a glockenspiel (0.75x) and under a saxello (0.90x); it is 77 melody notes
beneath 350 accompaniment ones, so it needed a blown instrument that holds its
level. See PIECE_LEVEL_TRIM and the identity tables in lib/ambientSoundscape.ts.

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

**Size.** 163 kB for all twelve, 3.7–24.2 kB each, and a world fetches exactly
one. For comparison the instrument samples are 1.1 MB and the solar-system
textures alone are 30 MB.

**The converter IS kept in the repository**, at
[tools/midi-to-arrangement.mjs](../../../../tools/midi-to-arrangement.mjs). It
was not, last time, on the reasoning that it runs once per asset and needs no
runtime dependency — and rebuilding it from the prose above in order to add six
pieces was most of a day. Three details had to be recovered by trial against the
shipped files, none of which the prose captured:

1. A note's role is decided by what overlaps its whole DURATION, not by what is
   sounding at its onset. BWV 846 strikes its held bass note before anything
   else in the bar, so at that instant it is the only note there — onset-only
   labelling made 545 of 549 notes melody.
2. Start and duration are quantised INDEPENDENTLY. Quantising the end instead
   rounds a triplet's start down and its end up, doubling every note of a piece
   written in triplets, which Arabesque No. 1 entirely is.
3. A note alone in its interval is bass if it is on the lower staff and melody
   if it is on the upper one. Neither blanket answer reproduces the Arabesque.

Run against the six MIDIs the original six arrangements came from, the committed
converter reproduces **all six note arrays byte for byte**. That is the check to
repeat if it is ever changed.

The steps are also recorded in
[notes/knowledge/frontend/ambient-audio-mechanism.md](../../../../../../notes/knowledge/frontend/ambient-audio-mechanism.md).

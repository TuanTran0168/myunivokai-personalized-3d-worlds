---
name: record-to-memory
description: Write an execution record into agent-system/memory/ after finishing a round of work whose measurements disagreed with its plan. Use when a plan turned out to be wrong, a benchmark contradicted an assumption, or an approach was tried and abandoned — "record this", "note what we learned", "the plan was wrong about X".
---

# Record to memory

`agent-system/memory/` is the only place in this repo that answers *where was
the plan wrong*. This skill keeps that answer from being lost the moment a
branch merges.

## Write it only when there is a contradiction

The test is one question: **did a measurement disagree with a prediction?**

- Yes → write the record. The disagreement is the content.
- No, it went as planned → nothing goes here. Update the matching document in
  `agent-system/knowledge/` instead, which is where "how it works" lives.

A record of a round that went as expected is noise, and noise is what makes the
next person stop reading this folder.

## Where it goes

`agent-system/memory/execution-records/<subject>.md`. One file per subject, not
per round — a second round on the same subject appends a dated section rather
than starting a new file, so the whole history of being wrong about one thing
reads in order.

## What it must contain

1. **The status line.** `> **Document status:** Historical record` and a
   `> **Last source review:**` date. Never "Active".
2. **What was predicted**, quoted from the plan, with a link to it and the
   section.
3. **What was measured**, with the actual numbers and how they were obtained.
   "It was slower" is not a record; "2.7 s of blocked main thread, CPU sampler,
   RTX 4060 Laptop, `--use-angle=d3d11`" is.
4. **What was tried and rejected**, and why — including approaches that sounded
   right. This is the part that stops the next person repeating the work.
5. **What this changes about the plan.** If the plan should now be corrected,
   correct it in the same change and link both ways.

## Then link it

Add a row to `agent-system/memory/README.md`. A record nothing points at is a
record nobody finds.

## Do not

Do not move the plan into `memory/` just because it shipped. A plan stays in
`agent-system/plans/` for as long as it is still the contract for the thing it
describes; it moves only when nothing would be decided by it any more.

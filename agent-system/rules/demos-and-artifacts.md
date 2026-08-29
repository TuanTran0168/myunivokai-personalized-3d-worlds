# Demos and Artifacts — Myunivokai

> **Document status:** Active policy
> **Last source review:** 2026-08-29

## The rule

**Every artifact built for the owner lands in [`demos/`](../../demos/README.md),
in the same change that creates it.**

A page published to a `claude.ai/code/artifact/...` URL and nowhere else is not
in the repository. It cannot be diffed, cannot be found by anyone who does not
already have the link, and disappears from the project's history the moment the
conversation that made it is closed. Several of the arguments this project has
already settled — which transition to use, what the ocean should look like —
were settled by a page like that.

So the file is committed, and the URL is a second copy of it rather than the
only one.

## What counts

Anything visual made to answer a question or show a proposal: a transition
bench, a style study, an interactive rig, a comparison page. If it was built to
be looked at rather than shipped, it belongs here.

Production UI does not. That goes in `apps/`.

## Where exactly

```txt
demos/<kebab-case-topic>/
  <page>.html      the artifact itself, self-contained
  measure.mjs      what checks its claims, if it makes any
```

One directory per demo, named for the question rather than for the technique.

## What [`demos/README.md`](../../demos/README.md) additionally requires

Read it before adding one; the constraints there are load-bearing and short.
The two that catch people:

- **Measure the output, don't describe it.** A demo is judged on a picture, and
  whoever produced it is the least reliable judge of it. If it makes a visual
  claim, it ships a script that checks the claim numerically.
- **No network at runtime.** The file must open from `file://` with no CDN and
  no remote assets, or it stops working exactly when someone needs it.

## When a demo's subject ships

Correct the demo in the same change, and say what shipped differently. A bench
that still reads as a proposal after its proposal was built is worse than no
bench: the next person takes its recommendation as the current design and it is
one revision out of date.

If the demo also exists as a published artifact, republish it from the committed
file so the two do not diverge. The committed file is the original.

## Where the finding goes

Not here. `demos/` holds the evidence; what the evidence proved is
[`knowledge/`](../knowledge/README.md) if it describes the system as it is,
[`evolution/`](../evolution/README.md) if it argues for a change that has not
been decided, and [`memory/`](../memory/README.md) if a measurement contradicted
a prediction.

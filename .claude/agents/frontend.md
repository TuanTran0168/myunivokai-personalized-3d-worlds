---
name: frontend
description: Use for any work in apps/myunivokai-web or apps/myunivokai-admin — three.js scenes, the audio graph, the create form, world and share routes, CSS, transitions, performance work on the canvas. Also use when a task sounds visual ("it looks wrong", "it stutters", "the layout overlaps").
---

Your operating definition is `agent-system/agents/frontend-agent.md`. **Read it in
full before doing anything else**, then follow it: it names the documents that
matter for this work, the ones to skip, and what done means.

Two things from it that are worth having before that read, because getting them
wrong wastes the whole task:

- **60 fps is a floor, not a target**, and quality is never lowered for weaker
  hardware. Measure on a real GPU (`--use-angle=d3d11 --enable-gpu
  --ignore-gpu-blocklist`). The e2e suite pins swiftshader on purpose, for
  comparability between runs — a timing measured there is meaningless.
- **A cold scene mount blocks the main thread for up to ~2.7 seconds** compiling
  shaders, and nothing in this codebase makes it faster. Schedule main-thread
  animation around that window, never through it.

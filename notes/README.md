# Myunivokai — the agent knowledge system

> **Document status:** Active index
> **Last source review:** 2026-08-29

This folder is the project's single knowledge base, and it is organised for how
an agent (or a person) actually works rather than by which team owns a file.

The old layout sorted documents by discipline — `fe/`, `be/`, `ops/`, `vision/`.
That answers "who wrote this", which nobody needs to know before starting a
task. The layout below answers the question you actually have, which changes
depending on where in a piece of work you are:

| You are asking | Read | Because |
| --- | --- | --- |
| What am I not allowed to get wrong? | [rules/](rules/README.md) | Constraints. Non-negotiable, small, read first. |
| How does this thing actually work? | [knowledge/](knowledge/README.md) | Descriptive. What is true of the system today. |
| What am I supposed to build? | [plans/](plans/README.md) | Prescriptive. Intent, backlog, sprints. |
| What happened last time? | [memory/](memory/README.md) | Execution records, including where plans were wrong. |
| Why did the direction change? | [evolution/](evolution/README.md) | Research and analysis that moved the target. |
| How do I perform this procedure? | [skills/](skills/README.md) | Runbooks with steps and verification. |
| Which of these applies to me? | [agents/](agents/README.md) | One reading list per kind of task. |
| I am a program, not a person | [project-context.json](project-context.json) | The same map, machine-readable. |

## The one rule about the split

**Knowledge describes, plans prescribe, memory records.** A document belongs to
exactly one of the three, decided by what happens when reality and the document
disagree:

- If reality is right and the document must be corrected — it is **knowledge**.
- If the document is right and reality must be changed — it is a **plan**.
- If neither, because both are descriptions of a moment that has passed — it is
  **memory**.

A plan that has shipped does not automatically become memory. It stays in
`plans/` for as long as it is still the contract for the thing it describes
(`plans/services/ocean-service-plan.md` is built, and is still the document you
read before changing the Ocean family). It moves to `memory/` only when nothing
would be decided by it any more.

## Document status convention

Every Markdown document carries a `Document status` and a `Last source review`.
The review date means the document was compared against the repository on that
date; it is not the creation date.

| Status | Meaning |
| --- | --- |
| Active | Source-grounded; may be used for implementation |
| Implemented | The described mechanism exists; the document remains its contract or rationale |
| Needs re-baseline | Some statements or checklist statuses are stale; use the linked current backlog |
| Historical / archived | Decision or implementation record only; never treat it as the current plan |
| Reference | Useful background or design input, not a source-of-truth contract |

## Working agreement for agents

1. **Read [rules/](rules/README.md) before writing any code or commit.** All of
   it. It is three short documents and every one of them is a gate.
2. **Pick your reading list from [agents/](agents/README.md)** rather than
   browsing. Each definition names the handful of documents that matter for that
   kind of task and, more usefully, the ones that do not.
3. **Check [memory/](memory/README.md) before trusting a plan.** Several plans
   in this repo carry a section recording where they turned out to be wrong —
   `plans/services/ocean-service-plan.md` §16 is the clearest example, and it
   contradicts its own §2 and §7.
4. **Record a mechanism where it already lives.** Update the matching document
   in `knowledge/`; do not create a second one. A finished round plan moves to
   `memory/archive/`.
5. **Update `Last source review` only after actually comparing** the document
   with the source, the tests and the deployment configuration.

## Where everything went

The move is recorded in git as renames, so `git log --follow` still works on
every file. For orientation:

| Old path | New path |
| --- | --- |
| `coding/` | [rules/](rules/) |
| `fe/*-mechanism.md`, `fe/source-overview.md`, `fe/threejs-*`, `fe/3d-*` | [knowledge/frontend/](knowledge/frontend/) |
| `be/source-overview.md`, `be/request-lifecycle.md`, `be/design-decisions.md`, `be/rust-*` | [knowledge/backend/](knowledge/backend/) |
| `user-stories/implemented-capabilities.md` | [knowledge/product/](knowledge/product/) |
| `references/`, `design/` | [knowledge/references/](knowledge/references/), [knowledge/design/](knowledge/design/) |
| `vision/README.md`, `vision/versions/`, `vision/service-wake-mechanism.md`, `vision/frontend-gateway-consolidation.md` | [plans/architecture/](plans/architecture/) |
| `vision/*-service-plan.md`, `vision/auth-and-admin-plan.md` | [plans/services/](plans/services/) |
| `vision/frontend-plan.md`, `vision/visual-diversity.md`, `fe/forest-realism-roadmap.md` | [plans/frontend/](plans/frontend/) |
| `user-stories/` (backlogs) | [plans/backlog/](plans/backlog/) |
| `sprints/` | [plans/sprints/](plans/sprints/) |
| `fe/deferred-work-plan.md`, `fe/refactor-plan.md`, `be/refactor-plan.md`, `vision/api-gateway.md` | [memory/execution-records/](memory/execution-records/) |
| `archive/` | [memory/archive/](memory/archive/) |
| `vision/*-research.md`, `fe/ocean-*-research.md`, `fe/ocean-*-ba.md` | [evolution/](evolution/) |
| `ops/` | [skills/](skills/) |

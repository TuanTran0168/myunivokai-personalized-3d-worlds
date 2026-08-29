# Myunivokai

The knowledge base and the wiring that runs it live in
[`agent-system/`](agent-system/README.md). This file is the part that has to be
in context before anything happens; everything else is reached from there.

@AGENTS.md

## The two gates every commit passes

Imported rather than linked, because a rule that has to be fetched is a rule
that gets skipped on the small change — which is the change that breaks the
convention.

@agent-system/rules/git-convention.md

@agent-system/rules/coding-style.md

The third gate, [`agent-system/rules/ci-quality-gates.md`](agent-system/rules/ci-quality-gates.md),
is not imported: it matters when a PR is opened, not while code is being
written. Read it before opening one.

## Before starting a task

Take the subagent that matches it — `frontend`, `backend`, `operations` or
`research`. Each one's definition in
[`agent-system/agents/`](agent-system/agents/README.md) names the handful of
documents that matter for that work, the ones to skip, and what done means.

Browsing `agent-system/` instead is how a small task turns into an afternoon of
reading. It holds ~120 documents.

## The one distinction that decides everything else

`knowledge/` describes, `plans/` prescribe, `memory/` records. Which folder a
document is in decides **who is wrong** when it disagrees with the code:

- reality is right and the document must be corrected → it is **knowledge**
- the document is right and reality must change → it is a **plan**
- neither, because both describe a moment that has passed → it is **memory**

Several plans carry a corrections section written after the work that
contradicts their own earlier sections. Read it first, not last.

## Conversation language

Reply to the owner in **Vietnamese**. Code, comments, commit messages and every
document in `agent-system/` stay in English.

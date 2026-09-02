# AGENTS.md - Myunivokai

## Mission

Build Myunivokai: an AI-powered personal 3D universe generator.

## Stack

- Web: Next.js, TypeScript, Tailwind, React Three Fiber
- API: Go, chi, pgxpool
- DB: PostgreSQL on Neon
- AI: provider abstraction supporting gemini, openai, mock

## Rules

- Do not call AI from frontend.
- Do not expose secrets.
- Keep provider-specific logic in `internal/ai/providers`.
- Business services depend only on the `ai.Provider` interface.
- Validate user input and AI output.
- Use mock provider in tests.
- Regenerate variants without AI by default.
- Public share APIs must not return raw sensitive input.

## Required reading for agents

`agent-system/` is the knowledge base and the wiring that runs it: `rules/`
(what you may not get wrong), `knowledge/` (how the system is), `plans/` (what
to build), `memory/` (what happened, and where a plan was wrong), `evolution/`
(research that moved the target), `skills/` (runbooks), and `agents/` (one
reading list per kind of task).
[`agent-system/README.md`](agent-system/README.md) explains the split;
[`agent-system/project-context.json`](agent-system/project-context.json) is the
same map for a program to read.

**Always, before any code or commit:**

- [`agent-system/rules/git-convention.md`](agent-system/rules/git-convention.md) — branch naming and commit format
- [`agent-system/rules/coding-style.md`](agent-system/rules/coding-style.md) — no hardcoded values, no abbreviated names
- [`agent-system/rules/ci-quality-gates.md`](agent-system/rules/ci-quality-gates.md) — the jobs every PR must pass

**And when the owner asks for an artifact** — a bench, a style study, any page
built to be looked at rather than shipped:

- [`agent-system/rules/demos-and-artifacts.md`](agent-system/rules/demos-and-artifacts.md) — it is committed to [`demos/`](demos/README.md) in the same change, not left as a URL

**Then take the one definition that matches the task**, which names the handful
of documents that matter and the ones to skip:

- [`agent-system/agents/frontend-agent.md`](agent-system/agents/frontend-agent.md) — `apps/*`, three.js, audio, UI
- [`agent-system/agents/backend-agent.md`](agent-system/agents/backend-agent.md) — `services/*`, `contracts/*`, NATS, migrations, Redis
- [`agent-system/agents/operations-agent.md`](agent-system/agents/operations-agent.md) — deploying, env groups, key rotation, incidents
- [`agent-system/agents/research-agent.md`](agent-system/agents/research-agent.md) — a question with no decision behind it yet

Under Claude Code these are dispatchable subagents — `frontend`, `backend`,
`operations`, `research` — and `/deploy` and `/record-to-memory` are invokable
skills. The entry points are thin files in `.claude/`; every definition has
exactly one copy, in `agent-system/`.

Browsing `agent-system/` instead of using a definition is how a small task turns
into an afternoon of reading. It holds around 120 documents.

## Commands

```bash
# Backend
cd services/universe-service
go test ./...
go vet ./...

# Frontend
cd apps/myunivokai-personalization
npm run typecheck
npm run lint
npm run build
```

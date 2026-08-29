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

`notes/` is organised as an agent knowledge system: `rules/` (what you may not
get wrong), `knowledge/` (how the system is), `plans/` (what to build),
`memory/` (what happened, and where a plan was wrong), `evolution/` (research
that moved the target), `skills/` (runbooks), `agents/` (one reading list per
kind of task). [`notes/README.md`](notes/README.md) explains the split;
[`notes/project-context.json`](notes/project-context.json) is the same map for a
program to read.

**Always, before any code or commit:**

- [`notes/rules/git-convention.md`](notes/rules/git-convention.md) — branch naming and commit format
- [`notes/rules/coding-style.md`](notes/rules/coding-style.md) — no hardcoded values, no abbreviated names
- [`notes/rules/ci-quality-gates.md`](notes/rules/ci-quality-gates.md) — the jobs every PR must pass

**Then take the one definition that matches the task**, which names the handful
of documents that matter and the ones to skip:

- [`notes/agents/frontend-agent.md`](notes/agents/frontend-agent.md) — `apps/*`, three.js, audio, UI
- [`notes/agents/backend-agent.md`](notes/agents/backend-agent.md) — `services/*`, `contracts/*`, NATS, migrations, Redis
- [`notes/agents/operations-agent.md`](notes/agents/operations-agent.md) — deploying, env groups, key rotation, incidents
- [`notes/agents/research-agent.md`](notes/agents/research-agent.md) — a question with no decision behind it yet

Browsing `notes/` instead of using a definition is how a small task turns into
an afternoon of reading.

## Commands

```bash
# Backend
cd services/universe-service
go test ./...
go vet ./...

# Frontend
cd apps/myunivokai-web
npm run typecheck
npm run lint
npm run build
```

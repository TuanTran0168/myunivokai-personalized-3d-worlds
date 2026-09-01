# Git Convention — Myunivokai

> **Document status:** Active policy
> **Last source review:** 2026-07-18

## Branch naming

Format:

```txt
feat/<scope>/<kebab-case-topic>
fix/<scope>/<kebab-case-topic>
refactor/<scope>/<kebab-case-topic>
```

- `<scope>`: `fe` (frontend, apps/myunivokai-web), `be` (backend services), `docs`, `ci`, or `repo` (repo-wide changes).
- Branch from `staging`, merge back into `staging` via Pull Request.
- `main` is the release branch and only receives merges from `staging`.

Examples:

```txt
feat/fe/universe-scene-config
feat/be/repair-prompt-retry
fix/be/per-ip-rate-limit
refactor/repo/service-rename
```

## Commit message

Format:

```txt
[ACTION][SCOPE][branch-name]: Short description in English
```

- `ACTION`: `INIT`, `ADD`, `UPDATE`, `FIX`, `REMOVE`, `REFACTOR`
- `SCOPE`: `FE`, `BE`, `DOCS`, `CI`, `REPO`

Examples:

```txt
[ADD][FE][feat/fe/universe-scene-config]: Render planets from WorldSceneConfig with hover interactions
[FIX][BE][fix/be/per-ip-rate-limit]: Rate limit per client IP instead of one global bucket
[REFACTOR][REPO][refactor/repo/service-rename]: Rename app folders for a microservices-ready layout
```

## Pull Requests

- PR title matches the branch's main commit.
- PRs always target `staging`.
- One concern per PR — never bundle unrelated changes.
- CI (GitHub Actions) must be green before merging.

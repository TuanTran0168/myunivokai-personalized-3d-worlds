# Rules — the gates

> **Document status:** Active
> **Last source review:** 2026-08-29

Constraints, not advice. Every document here is something a change can FAIL on:
a commit that will be rejected, a review that will be sent back, a CI job that
will go red. Read the first two before writing code — together they are shorter
than any single document in `knowledge/`.

| Rule | Fails what |
| --- | --- |
| [git-convention.md](git-convention.md) | Branch names and commit message format. A commit that ignores it has to be rewritten. |
| [coding-style.md](coding-style.md) | No hardcoded values, no abbreviated names. The one most often broken by generated code. |
| [ci-quality-gates.md](ci-quality-gates.md) | The GitHub Actions jobs every PR must pass. Read it before opening one. |
| [demos-and-artifacts.md](demos-and-artifacts.md) | Where an artifact built for the owner is committed. Applies when one is asked for, which is not every task. |

Rules describe what must be true of the WORK. What must be true of the SYSTEM is
architecture, and lives in [../plans/architecture/](../plans/architecture/README.md).

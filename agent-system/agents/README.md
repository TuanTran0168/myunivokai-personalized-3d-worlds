# Agents — one reading list per kind of task

> **Document status:** Active
> **Last source review:** 2026-08-29

This knowledge base is large enough that "read the docs" is no longer useful
advice. Each definition below names the handful of documents that matter for one
kind of task, in the order they should be read — and, more usefully, says which
ones to skip.

Each definition below is also a **dispatchable subagent**: `.claude/agents/`
holds a thin entry point per name whose first instruction is to read the
definition here. So `frontend`, `backend`, `operations` and `research` can be
handed a task directly, and there is still exactly one copy of what each of them
knows — this one.

| Definition | Subagent | Take it when the work touches |
| --- | --- | --- |
| [frontend-agent.md](frontend-agent.md) | `frontend` | `apps/myunivokai-web`, `apps/myunivokai-admin`, any three.js, audio or UI work |
| [backend-agent.md](backend-agent.md) | `backend` | `services/*`, `contracts/*`, NATS subjects, Postgres migrations, Redis keys |
| [operations-agent.md](operations-agent.md) | `operations` | Deploying, env groups, key rotation, incident response |
| [research-agent.md](research-agent.md) | `research` | A question with no decision behind it yet — a new family, a new dependency, a direction change |

## What every definition assumes

Three things are true regardless of which one you take, and none of them is
repeated in the individual definitions:

1. **[../rules/](../rules/README.md) is read first, in full.** Branch naming,
   commit format, coding style, CI gates. It is three short documents and every
   one is a gate a change can fail on.
2. **Descriptions and intentions are different folders.**
   [../knowledge/](../knowledge/README.md) says how the system is;
   [../plans/](../plans/README.md) says how it should be. When they disagree,
   which one is wrong depends on which folder it is in — that is the entire
   point of the split.
3. **Check [../memory/](../memory/README.md) before trusting a plan.** Several
   plans here were amended after the work and now contradict their own earlier
   sections.

## Writing a new definition

A definition that should be dispatchable needs a matching `.claude/agents/<name>.md`
with `name` and `description` frontmatter, whose body points back here. Keep the
body short: the `description` is what decides whether the subagent is picked at
all, so spend the words there.


A definition is worth adding when a kind of task has a reading list that is
*different*, not merely *smaller*. If the answer is "read everything the
frontend agent reads, plus one file", add the file to the frontend agent
instead.

Keep the "do not read" section. It is the half that saves time, and it is the
half nobody writes.

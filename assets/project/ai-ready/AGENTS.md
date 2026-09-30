# Agent guide for {{project.name}}

This file is the main project guide for coding agents. People read [README.md]({{path:readme}}); Claude Code also loads [CLAUDE.md]({{path:claude-guide}}), which imports this file.

## What this project is

{{project.name}} is developed with the SDLC lifecycle and OpenSpec. Agents follow the steps below, stay inside an approved plan, and leave evidence for humans to approve gates.

## Where things are

| Role | Path | Purpose |
|------|------|---------|
| Claude guide | [CLAUDE.md]({{path:claude-guide}}) | Thin Claude Code entry point: imports AGENTS.md, adds Claude-only notes. |
| README | [README.md]({{path:readme}}) | What the project is and how a person starts with it. |
| Review policy | [REVIEW.md]({{path:review-policy}}) | Review passes and severities used by /sdlc:review. |
| Architecture | [architecture]({{path:architecture}}) | System map: modules, boundaries, data flows, external dependencies. |
| Conventions | [conventions]({{path:conventions}}) | Code style, naming, error handling and testing rules. |
| Glossary | [glossary]({{path:glossary}}) | Domain vocabulary shared by people, specs and code. |
| Runbook | [runbook]({{path:runbook}}) | How to build, run, test and debug; environments and their commands. |
| Security | [security]({{path:security}}) | Threat model, sensitive zones and rules agents must not break. |
| Decisions | [decisions]({{path:decisions}}) | Architecture decision records (ADR), one file per decision. |

## How we work

Lifecycle (in order): **intent** → **spec** → **plan** → **build** → **verify** → **review** → (release) → **archive**.

OpenSpec lives under `openspec/`:
- `openspec/specs/` — living requirements (source of truth after a change lands)
- `openspec/changes/` — work in progress (proposal, design, tasks, delta specs)

Agent commands:
- OpenCode: `/sdlc-<step>` (for example `/sdlc-plan`, `/sdlc-build`)
- Claude Code: `/sdlc:<step>` (for example `/sdlc:plan`, `/sdlc:build`)

Orientation:
- `{{cli}} status` — where the project is in the lifecycle
- `{{cli}} next` — suggested next step and why

## Checks

Run the project verify commands before claiming a change is done:

{{verify.commands}}

## Rules for agents

1. People approve gates in their own terminal. Agents never run `sdlc approve`.
2. No implementation code before there is an approved plan for the change.
3. Never edit `.sdlc.yaml` or `openspec/.sdlc/log.jsonl`.
4. During a bug fix, locked / pinned tests are not edited; only product code (and new failing tests when the plan says so).
5. Keep the diff inside the approved plan. If you must deviate, record the deviation in the change notes and stop for a human.
6. Prefer small, reversible steps; do not invent scope.

## Definition of done

A change is done when:
- Spec and plan for the change are approved by a human
- Implementation matches the plan and the delta specs under `openspec/changes/`
- All verify commands above pass
- Review findings (see [REVIEW.md]({{path:review-policy}})) are addressed or explicitly waived by a human
- Living specs under `openspec/specs/` are updated when the change archives
- Sensitive zones listed in [security]({{path:security}}) were not touched without explicit human approval

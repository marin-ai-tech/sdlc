# {{project.name}}

{{project.name}} is an AI-ready project that follows the SDLC lifecycle and OpenSpec. This README is for people. Coding agents should start at [AGENTS.md]({{path:agents-guide}}) (Claude Code also loads [CLAUDE.md]({{path:claude-guide}})).

## Quick start

1. Install dependencies for this repository (see package manager docs for the stack you use).
2. Copy or create local config as described in the [runbook]({{path:runbook}}).
3. Run `{{cli}} status` to see the current lifecycle step, then `{{cli}} next` for the suggested action.
4. Before claiming work is finished, run the verify commands listed in the runbook / AGENTS.md.

## Where the docs are

| Doc | Why read it |
|-----|-------------|
| [AGENTS.md]({{path:agents-guide}}) | Rules and map for coding agents |
| [CLAUDE.md]({{path:claude-guide}}) | Claude Code import of AGENTS.md |
| [Architecture]({{path:architecture}}) | Modules, boundaries, data flow |
| [Conventions]({{path:conventions}}) | Naming, errors, tests, dependencies |
| [Glossary]({{path:glossary}}) | Shared domain vocabulary |
| [Runbook]({{path:runbook}}) | Setup, build, run, test, debug |
| [Security]({{path:security}}) | Threat model and sensitive zones |
| [Decisions]({{path:decisions}}) | Architecture decision records |
| [REVIEW.md]({{path:review-policy}}) | Review passes and severities |

## How changes flow

1. Capture **intent**, then write or update the **spec**.
2. Get a **plan** approved before coding.
3. **Build**, then **verify** with the project checks.
4. Run **review** against [REVIEW.md]({{path:review-policy}}).
5. After human approval, **archive** the change into living OpenSpec specs under `openspec/`.

OpenSpec: `openspec/specs/` holds living requirements; `openspec/changes/` holds work in progress.

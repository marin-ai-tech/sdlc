# sdlc: an AI-native SDLC harness for coding agents

`sdlc` helps you follow Anthropic's
[AI-Native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook) inside your coding agent.
The agent writes artifacts and code. **People make the decisions**, and each tool's hooks hold the gates.
It works with six coding tools. See [Supported tools](#supported-tools) for the list.

## On this page

- [Why sdlc](#why-sdlc)
- [Features](#features)
- [Quick start](#quick-start)
- [Supported tools](#supported-tools)
- [Documentation](#-documentation)
- [License](#license)
- [See also](#see-also)

```
backlog ──► explore ──► intent ──► spec ──► plan ──► build ──► verify ──► (qa) ──► review ──► (release) ──► archive
   ▲                                                                                                  │
   └────────────────────────────── triage (alerts, incidents, scans) ◄────────────────────────────────┘
```

[OpenSpec](https://github.com/Fission-AI/OpenSpec) is the specification subsystem, a pinned dependency, not a fork:
your `openspec/` folder stays a plain OpenSpec project, and `openspec` and `/opsx:*` keep working on it.

## Why sdlc

- **Gates that hold.** Approvals are bound to a digest of what was approved: edit an approved artifact and the
  approval goes stale. No code before an approved plan, locked tests during bug fixes, no release without the person
  who authorizes it — enforced by each tool's hooks, not asked for in a prompt.
- **An agent never approves its own work.** The CLI refuses decisions inside agent sessions and the hooks block the
  attempts. With `openspec/roles.yaml`, the author of the code cannot approve its review, paired gates need different
  people, and approvals can be required to arrive in signed commits.
- **Evidence, not claims.** `sdlc verify` runs your real checks and ties their output to a fingerprint of the working
  tree; change the code and the evidence goes stale. Review findings are graded and tracked to their status.
- **One process, six agents.** The same workflows, subagents and guards for every supported tool, so a team can mix
  tools.
- **Everything in git.** The backlog, approvals, evidence and an append-only log live in the repository; the audit,
  the report and an offline dashboard are built from them. No server to run.

How other spec-driven harnesses hold the process (from our
[review of the landscape](docs/en/03-landscape-and-reviews.md),
October 2026):

| Harness | How a gate holds |
|---|---|
| **sdlc** | hooks and CLI checks in each tool; approvals bound to content; separation of duties; recorded evidence |
| GitHub Spec Kit | precondition scripts and prompts |
| BMAD-METHOD | human plan approval in the session; prompt-driven, no hooks or CLI checks |
| Kiro | approvals in its own IDE |
| cc-sdd | approvals recorded in JSON, trust-based |
| obra/superpowers | behavioural instructions, a reviewer per task |
| OpenSpec on its own | specifications and validation; no gates |

## Features

- **Stages and gates** — intent, spec, plan, verify, qa, review, release; a `lite` track for small bounded work; a
  judge model before the person when you want one.
- **Backlog in the repository** — epics and items in `openspec/backlog.md`, GitHub issues and alerts as items; people
  set the order.
- **Review** — passes and lenses from `REVIEW.md`, findings by severity, plan drift, a suggested reviewer.
- **Health, audit and reports** — `sdlc health` findings with recommendations, lead times, waits on people, reworks
  and their reasons, an evidence bundle for auditors, release notes from the delta specs, a Markdown/HTML report and
  an offline dashboard.
- **Help that knows the project** — `sdlc next` names who acts next and the exact command, `sdlc explain` says why a
  change is stuck, `sdlc guide` and a seven-step tour answer how sdlc works; every hook denial links to its
  explanation.
- **Settings by proposal** — the process files are protected; an agent proposes a change (`sdlc config propose`),
  a person sees the diff and the warnings (`sdlc config show`) and applies it (`sdlc config apply`).
- **Existing projects** — `sdlc adopt` drafts settings and roles from git, CI and CODEOWNERS; the agent fills the
  AI-ready documents from the code; a person applies them.
- **Teams and integrations** — an agent team of role agents a person accepts, a task board for external executors,
  MCP in both directions (sdlc as an MCP server for reads and the executors' board, never a person's decision; the
  team's servers as checks, context and event receivers).

## Quick start

```bash
npm install -g https://github.com/marin-ai-tech/sdlc/releases/latest/download/sdlc.tgz
cd your-project && git init        # a git repository is expected
sdlc init                          # interactive; or: sdlc init --tools claude,opencode
sdlc doctor
```

Do not run `npm install -g sdlc`: the package of that name on the npm registry is unrelated.

Then, in your agent:

```text
/sdlc:intent "Export claims to CSV"     # Claude Code; /sdlc-intent in the other tools, $sdlc-intent in Codex CLI
/sdlc:next                              # the next step, or who must act and the exact command
```

People approve in **their own terminal** — `sdlc approve intent --change export-claims-csv` — and `sdlc next --me`
lists what waits for you. For an existing project start with `/sdlc:adopt`. Commit the generated files: the whole
team shares them.

**Claude Code plugin** (organization-wide): `/plugin marketplace add marin-ai-tech/sdlc`, then
`/plugin install sdlc@sdlc`, and `sdlc init --tools none` in projects.

## Supported tools

The [supported tools table](docs/en/05-guide.md#supported-tools) compares workflow calls, gate enforcement and limits:

- Claude Code and OpenCode;
- Cursor and Codex CLI;
- Qwen Code and GigaCode (experimental).

## 📚 Documentation

Choose a starting point that fits your work. The [full documentation index](docs/en/README.md) has every topic.

**Start here:**

- [User guide](docs/en/05-guide.md) — install sdlc and follow its lifecycle.
- [Handbook](docs/en/handbook/README.md) — learn what each role does.
- [Video course](docs/en/course/README.md) — follow short training lessons.
- [Glossary](docs/en/glossary.md) — look up a term as you read.

**Guides and reference:**

- [AI-ready project layout](docs/en/07-ai-ready-project.md) — give agents useful project context.
- [Roles and signed approvals](docs/en/08-roles-and-signing.md) — assign human decisions.
- [Integrations and MCP](docs/en/10-integrations.md) — connect the team's tools.
- [Agent team](docs/en/12-agent-team.md) — set up role agents.
- [Process health](docs/en/13-process-health.md) — find friction and act on it.
- [Traceability and audit](docs/en/14-traceability.md) — follow decisions and evidence.

**Worked examples:**

- [Adopt sdlc on an existing project](docs/en/18-team-example.md) — move a live product onto gates.
- [Build an application from scratch](docs/en/19-team-greenfield-example.md) — follow a change from intent to release.
- [A newcomer's first change](docs/en/20-onboarding-example.md) — use the next-step hints.
- [Dashboard and process health](docs/en/21-dashboard-health-example.md) — read the reports.
- [Adopt a large codebase](docs/en/22-adopt-large-codebase-example.md) — handle existing architecture.
- [Tracks and human decisions](docs/en/23-tracks-and-decisions-example.md) — choose a smaller path when it fits.
- [A bug fix from an alert](docs/en/24-bugfix-incident-example.md) — work with locked tests.
- [CI and release protection](docs/en/25-ci-release-upgrade-example.md) — run checks and upgrade sdlc.
- [Signed approvals and audit](docs/en/26-signed-audit-example.md) — inspect a decision trail.
- [MCP and events](docs/en/27-mcp-integrations-example.md) — connect process events.
- [Executor swarm and auction](docs/en/28-executor-swarm-example.md) — assign board work.
- [One team, different agents](docs/en/29-mixed-tools-example.md) — use several supported tools.
- [Finish with executors](docs/en/30-finishing-with-executors-example.md) — close a change and its issue.

**Research and design:**

- [Architecture](docs/en/04-architecture.md) — see how the parts fit together.
- [OpenSpec analysis](docs/en/01-openspec-analysis.md) — understand the specification foundation.
- [SDLC playbook](docs/en/02-sdlc-playbook.md) — see the process mapping.
- [Landscape review](docs/en/03-landscape-and-reviews.md) — compare other approaches.

## License

sdlc is dual-licensed. The **Community License** (free) is the
[PolyForm Noncommercial License 1.0.0](LICENSES/PolyForm-Noncommercial-1.0.0.md) with the
[sdlc Additional Permissions](LICENSES/sdlc-Additional-Permissions.md): noncommercial use, **open source projects**
(complete source public under an OSI-approved license, also when a company maintains them) and a 30-day evaluation.
> Every other use — business use on private repositories, internal systems, proprietary products, client work, hosted
> services, redistribution — needs the **Commercial License**: see [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

You own what you and your agents create with sdlc. Portions adapted from OpenSpec remain under the MIT License
([NOTICE.md](NOTICE.md)). Contributions need the [CLA](CLA.md) (see [CONTRIBUTING.md](CONTRIBUTING.md)).

Required Notice: Copyright (c) 2026 marin-ai technologies (https://github.com/marin-ai-tech/sdlc)

## See also

- [Documentation index](docs/en/README.md) — choose a guide or example.
- [Glossary](docs/en/glossary.md) — look up process terms.

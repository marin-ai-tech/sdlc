# 5. User guide

## Configuration proposals

An agent or person runs `sdlc config propose --set <key>=<yaml> --reason <text>` and then
`sdlc config show <id>`. The show command presents the proposed diff, validation and weakening warnings.
Use `--target roles` for `openspec/roles.yaml`. Only a person runs `sdlc config apply <id>` or
`sdlc config dismiss <id> --note <text>` in their own terminal; applying requires the `maintainer` role when
`roles.yaml` exists. A changed target makes the proposal stale. Weakening changes, such as lower enforcement,
removed checks or lite `auto_waive`, require `--yes` after reviewing the warning.

## 5.1. Installation

```bash
# CLI, the latest release (the required OpenSpec version is installed with it)
npm install -g https://github.com/marin-ai-tech/sdlc/releases/latest/download/sdlc.tgz
sdlc --version

# in the project root (a git repository)
sdlc init --tools claude,opencode      # any comma-separated set of: claude, opencode, cursor, codex, qwen, gigacode
sdlc doctor                            # check the installation
```

`sdlc doctor` also checks "mcp variables": if a `${VAR}` in a registry server's `env` or `headers` is unset,
it warns with the server and variable names, never the value.

Since 0.16.1, `sdlc doctor --fix` applies only fixes sdlc owns: missing generated files, an outdated stamp, a missing
or older sdlc git hook, and a missing starter `REVIEW.md`. It keeps edited generated files. Other findings are left to
you. JSON output separates `fixed` from `manual`.

Examples: `--tools cursor`, `--tools claude,codex`, `--tools qwen`, `--tools gigacode`. Without `--tools`, `sdlc init`
uses the tools it finds in the project (for example a `.claude/`, `.cursor/`, `.codex/` or `.qwen/` folder), else
Claude Code and OpenCode. The tools are compared in [Supported tools](#supported-tools) at the end of this section.

For Cursor, see [15. Cursor IDE](15-cursor.md): `sdlc init --tools cursor --mcp` sets up skills, commands, subagents,
a rule, the MCP server and Cursor's own hooks. For Codex CLI, see [16. Codex CLI](16-codex.md):
`sdlc init --tools codex --mcp`, then trust sdlc's hooks once in Codex's `/hooks`. For Qwen Code and GigaCode, see
[17. Qwen Code and GigaCode](17-qwen-gigacode.md): `sdlc init --tools qwen --mcp` (or `gigacode`, experimental); if you turned Qwen
Code's folder trust on, trust the project folder.

From git, install the `release` branch, which carries the built code: `npm install -g github:marin-ai-tech/sdlc#release`. Never `npm install -g sdlc`: the registry package of that name is unrelated.

With no flags in a terminal, `sdlc init` guides you through the setup (tools, enforcement mode, status line, /opsx, language, roles) and shows a summary before writing. The wizard also offers to install the OpenSpec CLI and codegraph when they are missing. Scripts, `--json`, non-terminals and agent sessions never prompt.

Since 0.16.1, `sdlc init --roles` also creates the starter `openspec/roles.yaml` using the current git identity for
every role. It keeps an existing file and reports created or kept in text and JSON. Only a person may run this option:
the CLI returns `agent_cannot_edit_roles` in an agent session, and the hook denies it as it does `roles migrate`.

**AI-ready from the start.** In an empty folder (nothing but `.git`, `.gitignore`, `LICENSE`, `README`) the wizard creates the agent documents right away and offers `git init` when there is no repository. In an existing project it first shows how the project differs from the AI-ready layout — missing documents and documents under other names — and offers three choices: build the AI-ready project in a new git worktree in a folder you name (the whole setup happens there, in one commit on the `sdlc/ai-ready` branch; your working copy is not touched), adapt in place (`layout adapt`), or skip. Without the wizard: `--layout scaffold|adapt|worktree|none` with `--worktree <path>`, and `--git-init`; without `--layout` init only reports the differences. Only a person may create the worktree, because it commits on their behalf.

`sdlc init`:
- creates `openspec/` by running `openspec init` if it does not exist, and makes `sdlc` the default schema. In an existing OpenSpec project, the default schema does not change;
- copies the schema to `openspec/schemas/sdlc/` and creates `openspec/sdlc.yaml`. Verification commands are detected automatically from `package.json`, `Makefile`, `pyproject`, `go.mod` or `Cargo.toml`;
- generates, for each chosen tool, the workflows (skills, commands), the subagents and what holds the gates: hooks for
  Claude Code, a plugin for OpenCode, the tool's own hooks and rules for Cursor, Codex CLI, Qwen Code and GigaCode
  ([Supported tools](#supported-tools)); plus `REVIEW.md` if it does not exist.

Useful flags: `--mode block` — strict enforcement; `--cli "npx --no-install sdlc"` — if the CLI is installed locally in the project (`npm i -D https://github.com/marin-ai-tech/sdlc/releases/latest/download/sdlc.tgz`; `--no-install` keeps npx from fetching the unrelated registry package); `--opsx` — also install OpenSpec's own `/opsx:*` workflows alongside; `--delivery skills|commands|both`; `--no-hooks`; `--statusline` — install the Claude Code status line; `--mcp` — register the sdlc MCP server for the chosen tools ([10.1](10-integrations.md#101-another-ai-system-reads-the-process)); `--tools all` or `--tools none` — every supported tool, or none of them.

**Claude Code plugin (organization-wide):**
```text
/plugin marketplace add marin-ai-tech/sdlc
/plugin install sdlc@sdlc
```
After you install the plugin, it is enough to run `sdlc init --tools none` in the project (or name only the other
tools, for example `--tools opencode,cursor`), so that skills are not duplicated. To make the plugin installation
mandatory, use `extraKnownMarketplaces` and `enabledPlugins` in `.claude/settings.json` or in managed settings.

After `init`, commit the generated files: they are shared by the team.

**License.** By default, a project uses sdlc under the free Community License. It covers noncommercial use, open source projects and a 30-day evaluation. `sdlc init` and `sdlc doctor` warn you if the project has no OSI-approved license. Commercial use requires a commercial license. After the agreement is signed, record the license with `sdlc license set commercial --agreement <id> --licensee "<company>"`.

### Supported tools

sdlc works the same way in every supported tool: the same workflows, subagents, gates, checks and CLI. Several tools
can share one project: a change started in one continues in another. What differs is how you call a workflow, what
holds the gates inside the tool, and how the CLI knows the agent's shell (the agent marker; `sdlc approve` refuses
where it is set).

| Tool | `--tools` id | A workflow is called | What holds the gates | Agent marker | Main limit | Chapter |
|---|---|---|---|---|---|---|
| Claude Code | `claude` | `/sdlc:next` (as a skill: `/sdlc-next`) | hooks in `.claude/settings.json`: SessionStart, PreToolUse, Stop | `CLAUDECODE=1` | without the `sdlc` CLI on the PATH the hooks let calls through (`sdlc doctor` warns) | [4.5](04-architecture.md#45-deterministic-enforcement-hooks-and-plugin) |
| OpenCode | `opencode` | `/sdlc-next` | the plugin `.opencode/plugins/sdlc.js` | `OPENCODE=1` or `AGENT=1`; the plugin adds `SDLC_AGENT` | no Stop hook, so no check of verification before the agent stops | [4.5](04-architecture.md#45-deterministic-enforcement-hooks-and-plugin) |
| Cursor | `cursor` | `/sdlc-next` | hooks in `.cursor/hooks.json` and the rule `.cursor/rules/sdlc.mdc` | `CURSOR_AGENT=1` | the marker is documented for the Cursor CLI, not confirmed for the IDE | [15](15-cursor.md) |
| Codex CLI | `codex` | `$sdlc-next` | hooks in `.codex/hooks.json` and command rules in `.codex/rules/sdlc.rules` | `CODEX_CI=1`, `CODEX_SESSION_ID` | the hooks run only after you trust them in `/hooks` | [16](16-codex.md) |
| Qwen Code | `qwen` | `/sdlc-next` | hooks and `permissions.deny` in `.qwen/settings.json` | `QWEN_CODE=1` | all folders trusted when folder trust is off; trust this folder when enabled | [17](17-qwen-gigacode.md) |
| GigaCode (experimental) | `gigacode` | `/sdlc-next` | hooks and `permissions.deny` in `.gigacode/settings.json` | `QWEN_CODE=1` (GigaCode's own is not documented) | folder trust semantics not verified on a live installation | [17](17-qwen-gigacode.md) |

In every tool, the CLI itself refuses a person's decision in the agent's shell, the agent cannot edit the guard's
configuration, and commits made in the agent's shell carry `SDLC-Agent: <agent>`.

## 5.2. Working with sdlc: from init to an empty backlog

An existing active change can be attached to an open backlog item with
`sdlc backlog link B1 --change add-export`. The item becomes in progress and archiving the change marks it done.
An archived change id cannot be reused by `sdlc new` or `sdlc backlog start`.
To close a mistaken change without merging its delta specs, a person runs
`sdlc drop add-export --note "Created by mistake"`. Its linked backlog item returns to open. The archived record
retains the drop reason, and reports and audits identify it as dropped.
Approving unchanged content twice as the same person and role records one approval. After a rework, the agent
first revises the gate's artifacts; after they change, the person approves. A waived plan with no tasks.md needs
fresh passing verification, while any open tasks still block the verify gate.

The usual path for an existing project. Workflows are shown as Claude Code (`/sdlc:adopt`) and as OpenCode, Cursor,
Qwen Code and GigaCode call them (`/sdlc-adopt`); in Codex CLI they are `$sdlc-adopt` and so on
([Supported tools](#supported-tools)).

| # | Step | Workflow | Who decides |
|---|---|---|---|
| 1 | Set up: `sdlc init` in the project root. The wizard compares the project with the AI-ready layout and offers to build the AI-ready project in a new git worktree, to adapt in place, or to skip. | — | you, in the wizard |
| 2 | Prepare the project for agents: the documents are filled from the code (architecture, conventions, build and test commands, glossary, sensitive areas) with a file reference for every statement, then a draft of the settings and roles. | `/sdlc:adopt` / `/sdlc-adopt` | you apply the settings: `sdlc adopt --apply` |
| 3 | Optional, per idea: research an idea before deciding. A note in `openspec/explorations/<slug>.md` with a recommendation (proceed, reshape, stop); on proceed, a backlog item linked to the note. | `/sdlc:explore <idea>` / `/sdlc-explore <idea>` | nobody: no decision is taken here |
| 4 | Plan the backlog: items with an outcome and acceptance criteria, added after you confirm them. | `/sdlc:backlog` / `/sdlc-backlog` | you set the order: `sdlc backlog move`, `drop` |
| 5 | Take the next ready item: `sdlc backlog start B<n>` creates the change with a draft intent; then the lifecycle of a change (5.3). | `/sdlc:intent`, then `/sdlc:next` | you approve each gate in your terminal |
| 6 | Close: `sdlc archive` merges the deltas into the living specs and marks the item `done`. With no active change, `/sdlc:next` proposes the next ready item. | `/sdlc:archive` / `/sdlc-archive` | — |

Repeat steps 3–6 until the backlog is empty. A new idea goes through step 3 at any time; an alert or an incident through `/sdlc:triage` (`/sdlc-triage`). Since 0.19.0, `sdlc triage intake` turns an alert into a backlog item, and `sdlc backlog import --issues` brings in GitHub issues ([Backlog and epics](#backlog-and-epics)).

- In an empty folder step 1 already creates the agent documents (and offers `git init`), so step 2 mostly drafts the settings and roles.
- Step 3 is not a study of the whole project (that is step 2) and not a gate: skip it when the idea is clear and add the item in step 4.
- Commit after steps 1 and 2: the generated files and documents are shared by the team.
- With several approvers, check `openspec/roles.yaml` after `sdlc adopt --apply`: roles without a better holder go to you, marked to check.
- Approve gates in your own terminal: a `!` command in the agent chat runs in the agent's shell and is refused.

## 5.3. Lifecycle of a change

| Step | Who | Claude Code | OpenCode, Cursor, Qwen Code, GigaCode | CLI |
|---|---|---|---|---|
| Idea → intent.md | agent + idea author | `/sdlc:intent "customers call to check the status of their request"` | `/sdlc-intent …` | `sdlc new <id>` |
| Before a person approves: the judge checks the gate's artifacts (if `gates.<gate>.judge`, 0.20.0) | agent | | | `sdlc judge --gate <gate> --change <id>` |
| Approve the intent | product owner | | | `sdlc approve intent --change <id>` |
| proposal, deltas, design | agent | `/sdlc:spec` | `/sdlc-spec` | `sdlc validate` |
| Approve the spec | product owner (+ tech lead if high risk) | | | `sdlc approve spec --change <id> [--as tech-lead]` |
| plan.md + tasks.md (plan mode) | agent + engineer | `/sdlc:plan` | `/sdlc-plan` | |
| Approve the plan | engineer (+ tech lead if high risk) | | | `sdlc approve plan --change <id> [--as tech-lead]` |
| Implementation with a feedback loop | agent | `/sdlc:build` | `/sdlc-build` | |
| Evidence + independent verification | agent + verifier subagent | `/sdlc:verify` | `/sdlc-verify` | `sdlc verify`, `sdlc verify --check` |
| Accept the evidence (if `gates.qa.required`) | QA | | | `sdlc approve qa --change <id>` |
| Review against REVIEW.md, fixing findings | agent + reviewer subagent | `/sdlc:review` | `/sdlc-review` | `sdlc review context\|check\|suggest` |
| Approve the review | code owner | | | `sdlc approve review --change <id>` |
| Release (if enabled) | agent → release manager | `/sdlc:release` | `/sdlc-release` | `sdlc approve release --change <id>` |
| Archive: deltas → living specs | agent | `/sdlc:archive` | `/sdlc-archive` | `sdlc archive <id> --yes` |
| Alert/incident → new intent | agent | `/sdlc:triage <alert>` | `/sdlc-triage` | |

In Codex CLI, call the same workflows as `$sdlc-intent`, `$sdlc-spec` and so on.

At any point, `/sdlc:next` (`/sdlc-next`, `$sdlc-next` in Codex) runs the next step or tells you who must do it and with which command. `sdlc status` shows all changes, and `sdlc status --markdown` produces a report for a PR or a wiki.

**A human runs approvals in their own terminal.** Inside an agent session, `sdlc approve` refuses to run. This is by design.



### Getting around

- Language: help, hints, `status`, the init wizard, hook reasons and reports follow `--locale`, `SDLC_LOCALE`, `locale:` in `sdlc.yaml` or the system locale, in that order; English when there is no translation (other languages ship). JSON never changes with the locale.
- `sdlc help [topic] [--json]` and `/sdlc:help` (`/sdlc-help`, `$sdlc-help`) list workflows and CLI commands and say who runs each one (agent or person).
- **Ask the agent how sdlc works.** "How do I send this back?", "why did the hook say no?", "who approves the plan?": the agent answers for your project with the guide workflow (`/sdlc:guide`, `/sdlc-guide`, `$sdlc-guide` in Codex, or just ask). The material ships with sdlc in English and other languages, so it matches the installed version: `sdlc guide` lists the topics (start, lifecycle, gates, roles, team, tracks, bugfix, backlog, rework, verify, review, health, mcp, config, denials, faq), and `sdlc guide <topic>` prints one. Every hook denial ends with the section that explains it, for example `sdlc guide denials#plan-gate`. The sdlc MCP server offers the same as its `guide` tool.
- **What is waiting for me:** `sdlc next --me` lists every gate, across the active changes, that you (your git identity, matched in `roles.yaml`) may take now, with the command. Without `roles.yaml` it lists every gate waiting for a person.
- **What am I approving:** `sdlc approve <gate> --change <id> --preview` shows the gate's artifacts, what changed since the last approval, the approvals so far and needed, open findings and verification for review and release, and whether you may approve. It writes nothing.
- After a state-changing command, the CLI prints a `Next:` hint (who acts next and how; the exact command when a person must act) and adds `next` to JSON. With no active change, session-start context names the next ready backlog item.
- `sdlc status --change <id>` draws a stage stepper and a task bar; `sdlc backlog list` draws a bar per epic. Markdown reports include Mermaid diagrams with sanitized labels.

```text
intent ● ─ spec ○ ─ plan ○ ─ build ○ ─ verify ○ ─ review ○ ─ archive ○
tasks      █████░░░░░  2/4
```

- Claude Code status line: `sdlc statusline` prints one line (`change · stage · who acts`). Opt in with `sdlc init --statusline`. A user-defined status line is never replaced; `sdlc uninstall` removes only the sdlc one.

### Backlog and epics

Planned work lives in `openspec/backlog.md` before an OpenSpec change exists. Epics group items under a goal; each item is one future change. File order is priority. Status is in the heading (`open`, `in-progress`, `done`, `dropped`). Readiness is computed: an open item is ready when it has an Outcome, at least one Acceptance criterion, and every `Depends on` item is `done`. Ids (`B<n>`, `E<n>`) are never reused.

```markdown
# Backlog

## E1 Claims self-service
Goal: policyholders see claim status without calling support.

### B1 [open] Show claim stage in the portal
- **Kind**: feature
- **Risk**: medium
- **Outcome**: policyholders see the stage of each open claim
- **Acceptance**:
  - a claim in review shows "in review"
  - another policyholder's claim is never listed
- **Depends on**: B4
```

Commands: `sdlc backlog epic add <title> [--goal]`, `sdlc backlog epic edit <E-id> [--title --goal --clear-goal]` (changes an epic's title or goal, never the order), `sdlc backlog add <title> [--epic --kind --risk --outcome --accept --depends --source-type --source-ref --allow-duplicate]`, `sdlc backlog list [--epic --status --ready]`, `sdlc backlog next` (the next ready item), `sdlc backlog edit <B-id> [--title --outcome --accept --add-accept --depends --clear-depends --kind --risk]` (changes an open or in-progress item's text, never its place or status; `--accept` and `--depends` replace the list; a done or dropped item is refused), `sdlc backlog start <B-id> [--change <id>]` (creates the change and a draft `intent.md`, sets the item to `in-progress`), `sdlc backlog move <B-id> (--top | --before <B-id> | --after <B-id> | --epic <E-id>)` and `sdlc backlog drop <B-id> --note <text>` (human-only), `sdlc backlog done <B-id> --note <text>` (marks an item done by hand; the note is required), `sdlc backlog import --issues` (GitHub issues, below). Flow: ready item → `backlog start` → change lifecycle → `sdlc archive` marks the item `done`. With no active change, `sdlc next` proposes the next ready item.

People edit `openspec/backlog.md` by hand as well — notes under items and epics, extra fields and sections stay when a command writes the file — and agents change it only through these commands — the hook denies an agent's direct edit, so order and removal stay a person's decision. In every supported tool, the backlog workflow (`/sdlc:backlog`, `/sdlc-backlog`, `$sdlc-backlog` in Codex) works with the backlog: without input it shows the list, the next ready item and what blocks the others; with an epic or an idea it proposes items with an outcome and acceptance criteria and adds only those you confirm; with `B<n>` it brings the item to ready and offers to start it. For a reorder or a drop it gives you the command to run.

`sdlc backlog add` refuses a second open item with the same `--source-type` and `--source-ref`.
The `duplicate_item` error names the existing item. Use `--allow-duplicate` when one source needs several items.

Since 0.19.0, the backlog can also take work from two outside sources. Neither sets the order: a person still orders
the backlog (`sdlc backlog move`).

- **GitHub Issues.** With `issues: { server: github, repo: owner/name }` in `openspec/sdlc.yaml` (5.4),
  `sdlc backlog import --issues [--json]` adds one item per open issue that is not linked yet: the issue's title and
  the field `**Issue**: GH-<n>` (JSON `issue: "GH-<n>"`). Pull requests are skipped, and a second import adds nothing.
  Without the `issues` setting the command is refused with `issues_not_configured`. When a change whose item has an
  issue is archived, sdlc comments on the issue (the comment names the change) and closes it. The calls go through
  the event outbox: if the server fails, the archive still succeeds, and `sdlc events flush` delivers them later. An
  item without an issue never causes a GitHub call. See
  [10.11](10-integrations.md#1011-since-0190-github-issues-and-the-team-chat).
- **Alerts.** `sdlc triage intake [--json]` reads one alert as JSON on stdin (`{ id, title, severity?, url? }`) and
  adds a backlog item with the source `alert:<id>`. The same alert again adds nothing and answers `duplicate: true`.
  Input that is not JSON, or an alert without an id or a title, is refused with `invalid_alert`, and nothing is added.
  Anyone may run it, so a monitoring job can pipe its alerts in. `/sdlc:triage` still turns an alert into a new intent.

### Explore before intent

Step 3 of the path in 5.2. Use `/sdlc:explore` (`/sdlc-explore`) to research and pressure-test an idea. `sdlc explore <slug>` creates `openspec/explorations/<slug>.md`; `sdlc explore list` lists notes. Start a linked change with `sdlc new <id> --source-type exploration --source-ref openspec/explorations/<slug>.md`. Exploration is optional and does not approve intent.

### Track suggestion and confirmation

`sdlc new` suggests `lite` for eligible small changes from their kind and risk and records `track_suggestion` in `.sdlc.yaml`. Read the reason, then run `sdlc track set <full|lite> --change <id>` yourself. The CLI refuses agent sessions and changes after the plan is approved; the hook also denies agents.

### Lite track (small edits)
```bash
sdlc new fix-null-name --kind bugfix --risk low --track lite [--skip-specs]
```
The intent and the spec are optional: the change starts with plan.md and tasks.md, followed by the same verify and review steps. Run by a person, `--track lite` applies the track; from an agent session it is only recorded as a suggestion until a person runs `sdlc track set lite`. `--skip-specs` sets `skip_specs: true` for a change that does not alter external behavior.

### Bug-fix protocol
1. The first task is a test that reproduces the bug. Make sure it fails for the right reason, and commit it.
2. `sdlc tests lock --change <id>` — from then on, hooks do not let the agent change the tests.
3. Fix the code. Only a human can remove the lock: `sdlc tests unlock`.

### Review with lenses and coverage

`review.passes` and `review.lenses` in `openspec/sdlc.yaml` define the perspectives to check. In `review.md`, record each under `## Coverage`, including work checked when no finding was made:

```md
## Findings

### F1 [important][adversarial] Replayed token is accepted
- **Where**: src/auth/session.ts:88
- **Status**: open

## Coverage
- bugs: none found — checked: changed error paths
- adversarial: 1 finding
```

`sdlc review check --change <id>` checks missing entries, mismatched finding counts, empty `checked:` evidence, and deferred links. The review gate uses that result. New projects require lens coverage; older projects warn until `review.require_lens_coverage: true` opts in. An accepted extension pack adds its lenses as `<pack>-<id>`, and their coverage is required in the same way ([Extension packs](#extension-packs-0200)).

### Defer a finding

Record postponed work with `sdlc defer add <title> --why <text> [--change <id>] [--finding <F-id>] [--revisit <text>]`, inspect it with `sdlc defer list [--open] [--change <id>]`, and close it with `sdlc defer close <D-id> --status done|dropped --note <text>`. The registry is `openspec/deferred-work.md`; each `### D<n> [open] Title` entry has `**Change**`, optional `**Finding**`, `**Why**`, `**Revisit when**`, and `**Created**` fields. Mark the review finding `deferred (D<n>)`; the review check requires a link to an open item. Reports and dashboards show the registry.

### Send a change back, take it over

`sdlc rework <gate> --change <id> --reason <category> --note "<what has to change>"` sends a change back to the stage of a gate (intent, spec, plan, qa, review). The gate counts as rejected until it is approved again, and approvals made before the rework stop counting, the later gates' too. Reasons come from `rework.reasons` in `sdlc.yaml` (default: missing-requirement, wrong-assumption, design-flaw, implementation-bug, test-gap, scope-change, other); the audit counts them. Approving a gate records a checkpoint (`refs/sdlc/<change>/<gate>`; branches and HEAD stay); `--reset` restores from it only the files listed under "Files that change" in plan.md and the change folder, and refuses when they have uncommitted edits. External actions are not undone. Approving the gate again with nothing changed since the approval before the rework needs `--note` (why nothing had to change; `--preview` shows `unchangedSinceRework`). After `rework.max_cycles` reworks of one gate (default 3), `sdlc next` asks a person to take the change over or review its scope instead of another agent round.

After a rework, `sdlc next` first asks the agent to revise. Once the agent has changed the gate's artifacts,
the gate waits for a person again: `sdlc next` names them, `sdlc next --me` lists it, and the
`gate.<g>.awaiting` event is sent. A rejected review works the same way: the agent fixes what review.md asks,
then the reviewer decides again. An open rejection remains on its row in `sdlc status` even while an earlier
gate blocks it; `sdlc next` carries the person's note until that gate is approved.

`sdlc takeover --change <id> --note "<why>"` takes a change from the agent: until `sdlc release-control --change <id> --note "<for the agent>"`, the hook denies agent edits in the change folder and in the plan's files, and `next` says to wait for you. The agent sees the hand-back note. Both commands, like rework, are a person's.

The plan's files are every path listed under "Files that change" in plan.md: paths in backticks, plain list items (`- src/greet.js (modified)`) and globs (`src/legacy/**`). Without plan.md, or when that list names no path, the takeover holds the whole project. The takeover, `rework --reset` and the warning about planned files the change did not touch read this list in the same way; plan drift (`sdlc review context`) reads the whole plan.

The plan gate holds code edits until a plan is approved. With one active change, its approved plan opens code edits. With several active changes, the agent may edit code, or write it through the shell, only in files that an approved plan lists; any other file meets the plan gate (denied in `block` mode, a reminder in `warn` mode). An approved plan that lists no file opens nothing while another change is active. Editing plan.md after its approval voids the approval.

### Evidence, changelog and agent commits

`sdlc audit --export <dir> [--since <date>] [--change <id>]` writes the evidence bundle for auditors: `index.json` and `index.md` with every approval, its signature status (as `sdlc approvals verify` checks it, `not-checked` without signing) and its trailer, the change folders and the log of the period; only files inside openspec/. Since 0.16.2, `sdlc audit --since <date>` without `--export` gives the plain audit for that period: changes with history from that date, agent commits from that date, and JSON `since`. `sdlc audit --change <id>` includes commits made while an archived change was active and the agents' share of commits bearing its `SDLC-Change: <id>` trailer (JSON `agentCommits: { agent, total }`); `--since` limits it. `sdlc changelog [--change <id> | --since <date>]` lists the requirements the delta specs add, change and remove; `/sdlc:release` puts it into release.md. `sdlc init` and `sdlc update` install a `prepare-commit-msg` git hook that marks commits made in an agent session with `SDLC-Agent: <agent>`; the audit and the dashboard show the agents' share. A project's own hook is kept (`sdlc doctor` shows the line to chain sdlc's), and a `core.hooksPath` outside the project is left alone. With `design: { debate: true }`, the spec workflow has two `sdlc-advocate` subagents argue the key decision and records `## Debate` in design.md; the spec gate waits for it. An example script (`assets/examples/daily-summary.mjs` in the package) writes a daily summary file for a scheduler. Since 0.19.0, `sdlc events summary` sends the summary as an event ([Events and the daily summary](#events-and-the-daily-summary)). Use cases: [14. Traceability and audit](14-traceability.md).

Export the bundle outside the project, or to a folder listed in `.gitignore`: a folder inside the project that git does not ignore changes the working tree, so `sdlc audit --export` warns that it makes the verification of the active changes stale, and `sdlc verify` has to run again.

### Open questions answered by a person

Open questions under `## Open questions` in intent.md, proposal.md or design.md need a person's answer before the intent or spec gate can be approved. `sdlc answer --change <id> --list` shows them; `sdlc answer <n> --change <id> --text "…"` writes the answer under the question and records it in `.sdlc.yaml`. Only that record counts: an answer typed into the file by hand or by an agent does not, and a reworded question needs a new answer. Inside an agent session the command refuses, and the hook denies it; the intent and spec workflows leave the questions to you and give you the command. Turn the rule off with `questions: { required: false }` in `sdlc.yaml`.

### A judge before the person (0.20.0)

A judge is an independent model that checks a gate's artifacts by the team's rubric before a person approves. Set it
on the gate, as a command or as an MCP tool of the registry:

```yaml
gates:
  spec:
    required: true
    approvers: [product-owner]
    judge: { run: node tools/judge.mjs, rubric: docs/rubrics/spec.md, max_loops: 3 }
    # judge: { server: judges, tool: judge, rubric: docs/rubrics/spec.md }
```

`sdlc judge --gate spec --change <id>` sends `{ change, gate, rubric, artifacts: [{ path, content }] }` (a command
reads it on stdin and prints the verdict as JSON; a tool gets it as arguments) and records the verdict
`{ pass, route, rework }`, bound to the digest of the artifacts. Anyone may run it, the agent too: `sdlc next` asks
the agent to. Until a verdict passes for the current artifacts, the gate is blocked and a person cannot approve; after
a failing verdict, `sdlc next` gives the agent the judge's rework instruction. A changed artifact makes the verdict
stale. A passing verdict is evidence only: a person still approves. After `max_loops` failing verdicts the
author-critic loop stops and `sdlc next` hands the gate to a person, who may approve. A command judge runs as an agent
(`SDLC_AGENT=judge`), so it can never approve or unlock. An answer that is not a verdict is refused
(`judge_invalid_answer`); a judge that fails or times out is an error, never a pass. The rubric must be a file inside
the project, and a judge has 60 seconds to answer. A failing verdict exits with code 1.

### Extension packs (0.20.0)

A pack from git or npm (`packs` in `openspec/sdlc.yaml`, 5.4) may bring review lenses, workflows and gate checks,
next to roles and skills ([12.5](12-agent-team.md#125-packs-from-git-or-npm)):

- `lenses/<id>.md` becomes the review lens `<pack>-<id>`: `sdlc review context` gives its text, and
  `sdlc review check` requires its coverage line.
- `workflows/<id>.md` becomes the skill `sdlc-<pack>-<id>` for the project's tools. It never replaces a built-in
  workflow.
- `checks.yaml` holds `verify:` checks, named `<pack>/<name>`. `sdlc verify` runs them after `verify.commands`, as an
  agent (`SDLC_AGENT=pack-<name>`).

```bash
sdlc team sync                  # fetch the packs and report their problems
sdlc team accept --pack corp    # a person (with roles.yaml: a maintainer) accepts what the pack brings
```

Nothing a pack brings is in effect before a person accepts it with `sdlc team accept --pack <name>`. The acceptance
is bound to the digest of the pack's contents, so a new version waits for a new acceptance. An agent can never
accept. A pack with workflows or checks must be pinned to a git commit (40 hex digits) or an exact npm version
(`pack_not_pinned` otherwise). A check or a workflow that calls a person's sdlc command is refused
(`pack_forbidden_command`). A pack that `sdlc team sync` has not fetched yet is refused with `pack_not_synced`.

### Approvals in commits, evidence limits, gates that do not apply

`sdlc approve` prints a ready `git commit` with the trailer
`SDLC-Approval: <change>:<gate>:<digest>` (JSON `commitMessage`). `sdlc approvals verify` reports
`trailer: found | missing` for each approval. The evidence in `verification.md` warns about untouched files
listed under "Files that change" (`planDrift.untouched`, never a failure), has a `## Not run / limits` section,
and links the change's `verification/` folder (screenshots and browser results).

`gates.<gate>.auto_waive: { kinds, tracks }` waives intent, spec or plan when the kind **or** track matches.
It is logged once as `gate.<gate>.auto_waived` and counted as a policy waiver; an agent-chosen kind does not count.
`tracks: [lite]` waives every lite change, including features, and raises a doctor warning.
See [13. Process hygiene and project health](13-process-health.md).

### Project health and explaining a change

`sdlc health [--json]` lists findings about the process and its practices: flow (long or overdue waits on people, changes with no activity, old deferred work), quality (first-pass verification, the most common rework reason, plan drift, open review findings, scenarios without a verification row), discipline (frequent waivers, the lite track on behaviour changes, forced archives, repeated approvals, repeated hook denials of one rule, long test locks) and configuration (no verification commands, enforcement off or warn, one person holding every role, signing off, stale context packs, `sdlc doctor` problems). Each finding has a level (`bad`, `warn`, `info`), the facts and a recommendation; there is no single score, and the command always exits 0. `/sdlc:health` explains the findings and drafts the improvements you choose as backlog items (`--source-type health`). While a `bad` finding exists, the agent's session start says so in one line; `health.degraded` and `health.recovered` go to the log and to event receivers; the dashboard has a health section.

`sdlc audit` (and the dashboard page of a change) also compares the people's decisions the track planned — the required gates and their approvals, counting `min_approvals` — with what happened: approvals, reworks, takeovers, waivers, answers and the hours gates waited for a person. New to sdlc? `sdlc guide tour` walks through the calculator demo in seven steps.

`sdlc explain --change <id> [--json]` says why a change is where it is: the stage, the open gate and its reason, what it waits for, the steps that unblock it and the latest decisions. It writes nothing.

### Events and the daily summary

`events` in `openspec/sdlc.yaml` push process events to the team's MCP servers: a gate that waits for a person, an
approval, a verification, an archive ([10.10](10-integrations.md#1010-since-0100),
[11.3](11-mcp-use-cases.md#pushing-events-to-a-central-server)). Since 0.19.0:

- **One wait, one id.** `gate.<g>.awaiting` and `gate.<g>.overdue` get an id from `project.name` (when set), the
  change, the gate, the event and the digest the gate waits on, not from the time. Every clone of the project and CI
  send the same id for the same wait, so a receiver keeps one. Other events keep an id of their own.
- **Chat handles.** A receiver with `chat: <channel>`, for example `chat: telegram`, also gets `waitingForChat`: the
  handles on that channel of the people in `waitingFor`, from `people.<id>.chat` in `roles.yaml`
  ([Roles and separation of duties](#roles-and-separation-of-duties)). With `message`, its text mentions them. A
  receiver without `chat` never gets a handle.
- **The daily summary.** `sdlc events summary [--since <date>] [--json]` records the event `summary.daily`: the counts
  of changes done, active, waiting for people and blocked, and the changes that wait. `--since` sets the start of the
  period (default: yesterday). The summary goes to the receivers whose `on` matches `summary.*` or `summary.daily`.
  It is not in the default patterns, so a receiver opts in. A receiver with `message` gets a short text that names
  the project and the waiting changes. One summary per project and day: a second run on the same day sends nothing
  new. Run it once a day from a scheduler or a CI job.
- **CI delivers.** The CI configuration from `sdlc ci init` ends with `sdlc events flush`, also when a check failed
  (5.5).

```yaml
events:
  - server: telegram                  # a Telegram MCP server in mcp.servers
    tool: send_message
    on: ["gate.*", "summary.daily"]
    args: { chat_id: "${TELEGRAM_CHAT_ID}" }
    message: text
    chat: telegram                    # mention the people by their telegram handles
```

sdlc has no chat API of its own: a Telegram MCP server is a receiver like any other.

### The sdlc MCP server over HTTP

`sdlc mcp serve` gives other AI systems read tools, including `board_list`, over stdio
([10.1](10-integrations.md#101-another-ai-system-reads-the-process)). Since 0.19.0,
`sdlc mcp serve --http <host:port>` serves the same tools over MCP Streamable HTTP at `/mcp`, for a client on another
machine or in another process:

```bash
export SDLC_MCP_TOKEN="<a secret of at least 16 characters>"
sdlc mcp serve --http 127.0.0.1:8765     # port 0 picks a free port; the URL is printed on stderr
```

- A bearer token is always required, on localhost too. It comes only from the environment variable
  `SDLC_MCP_TOKEN` (at least 16 characters), never from a flag. Without it the server does not start
  (`token_required`).
- A client sends `Authorization: Bearer <token>`. A request without the token, or with another one, gets 401 and
  reaches no tool.
- A browser `Origin` of another host or port is refused with 403. Only `/mcp` is served (404 otherwise), and a request
  body is at most 1 MB.
- New tools in both transports: `health`, `report` and `explain` answer what `sdlc health --json`,
  `sdlc report --format json` and `sdlc explain --json` print. There is still no decision over MCP.

Stop the server with Ctrl+C. Connecting a remote client: [11.2](11-mcp-use-cases.md#112-connecting-a-client).

### Trace a change

`sdlc trace <change> [--json]` links the intent, the requirements and scenarios of the delta specs, the tasks, the commits, the verification evidence and the review findings, for an active or archived change, and lists the gaps: a requirement without a scenario, a scenario without evidence, a task without a commit, a finding without a status. A commit belongs to a task through the trailers `SDLC-Change: <id>` and `SDLC-Task: <n.m>`; `/sdlc:build` asks the agent to add them.

### Handing tasks to executors

Since 0.19.0, the tasks of an approved plan can go to executors of any type: another agent, a script or a person. The
task contract says what an executor gets and what it must return.

- `sdlc task executors [--json]` lists the executors a person named in `openspec/executors.yaml` (empty list
  without a registry). Each entry has an id, a `type` (`representative`, `board`, `market`, `mesh`), the highest
  risk it may take (`max_risk`), optional `kinds` and `capabilities`; in JSON also `hasToken` — never the hash or
  a token. The registry is a state file: only a person edits it — the hook denies an agent's write. A broken
  registry (bad id, unknown type or field, missing or bad `max_risk`, a kind that is not a change kind, a
  `token_sha256` that is not 64 lowercase hex) is refused with `executors_invalid`.
- `sdlc task executors token <id> [--json]` — a person's command — issues the executor a new token for
  `sdlc mcp serve --http`. The token is printed once; only its SHA-256 goes into `token_sha256` of that executor.
  Issuing a new token, or removing the executor, revokes the old one at once — no restart. The command is refused
  in an agent session (`agent_cannot_issue_token`, and the hook denies it), and the `executor.token_issued` log
  entry records who issued it — never the token, never the hash.
- `sdlc task export --change <id> [--task <n.m>] [--executor <id>] --json` gives one work item per open task
  (contract `sdlc.task/1`): the task, the risk, the base commit, the plan's files, the spec scenarios, the verify
  checks, the paths the executor must not touch, and where the result goes: the branch `sdlc/<change>/<task>` and
  the trailers `SDLC-Change: <id>` and `SDLC-Task: <n.m>`. Work is handed out only while the plan gate is approved
  and fresh; otherwise the command is refused with `plan_not_approved`. `--task` picks one task (`unknown_task` for
  a task the change does not have). With a registry `--executor` is required (`executor_required`; without a
  registry a passed flag gives `no_executor_registry`, an unknown id `unknown_executor`): the work goes only to an
  executor allowed for the change — risk order `low < medium < high`, the change risk at most `max_risk`, the kind
  in `kinds` when given — else `executor_not_allowed`. A refused export logs nothing; an allowed one adds
  `executor` to every item, the trailer `SDLC-Agent: <executor>/<agent>`, and a `task.exported` log entry per task.
- `sdlc task check-result --change <id> --branch <ref> [--base <ref>] --json` checks a returned branch (the base
  defaults to the merge-base of the branch and HEAD). A commit without the trailers
  (`missing_trailer`), a task the change does not have (`unknown_task`) or a forbidden path (`forbidden_path`) is a
  problem, and the command exits 1. Files outside the plan are a warning (`outside_plan`). With a registry every
  commit's first `SDLC-Agent` trailer must be `<executor>/<agent>` naming an executor the change allows:
  `missing_agent`, `unknown_executor` or `executor_not_allowed` otherwise; the result gains `executors` — the
  distinct executor ids the commits name — and each check is one `task.result_checked` log entry.

Both commands only read: they merge nothing and approve nothing, and anyone, an agent too, may run them. Merging the
branch, verification and review stay the usual steps of the change. The contract is published as JSON Schemas:
`schemas/contracts/task.schema.json` and `schemas/contracts/result.schema.json`.

#### The task board

Market mode opens a timed auction with `sdlc board auction --change <id> --task <n.m> [--window <s>]`.
The default window is 300 seconds. An executor bids with `sdlc board bid --change <id> --task <n.m>
--executor <id> --agent <name> --minutes <n> [--cost <n>] [--note <text>]`.
While open, the board shows `auction`, `closesAt` and the bids. On the next board command after closing,
it reserves the winner for a default dispatch lease. Set `board.market.rule` in `openspec/sdlc.yaml` to
`fastest` (default), `cheapest`, or `first`, and `window_seconds` for the default window. Ties favor higher
`max_risk`, then the earlier bid. With no bids, the task returns to open. A person or lead agent can award
early or reassign with `sdlc board award --change <id> --task <n.m> --executor <id>`.

Claim, heartbeat, release, submit, and bid accept `--request <key>` for peer retries. The key is 8–128
letters, digits, `.`, `_`, `:`, or `-`. A repeated key and identical arguments return the stored answer for
24 hours without a second state change or log entry; different arguments yield `request_conflict`.
The same write tools take `request` over MCP, and executor tokens can call `board_bid`.
MCP does not expose auction, award, or dispatch.

Placement: `sdlc board dispatch --change <id> --task <n.m> --executor <id> [--lease <s>] [--json]`
reserves one open task for an executor. The lease defaults to 900 seconds (range 1-86400). `board list` shows
`dispatched`, its executor and `expiresAt`. Only that executor can claim before expiry; expiry returns the task
to the pool and logs `task.dispatch_expired` once. Dispatch logs `task.dispatched`.

Over HTTP, an executor token exposes `board_list`, `board_claim`, `board_heartbeat`, `board_release` and
`board_submit`. The server token and stdio expose only `board_list`. The executor comes from the token, and
claim management checks that the claim belongs to it. A foreign claim id is `claim_unknown`. Calls are scoped
to the token's project. No MCP tool dispatches or makes a gate decision.

Since 0.21.0, the open tasks of every active change whose plan gate is open sit on a board that the agents of the
registry's executors claim from, each claim under a lease. The board is `openspec/.sdlc/board.json`
(`{version: 1, claims, dispatches}`) — a state file, git-ignored through `openspec/.sdlc/.gitignore` next to the log's
`.gitattributes`, and off-limits to agents (the hook's `boardIntegrity` deny; it also lands in every work item's
`forbidden`). The committed trail is `openspec/.sdlc/log.jsonl`. Anyone may run the board commands, an agent too —
they decide no gate and approve nothing:

- `sdlc board list [--change <id>] --json` shows every task with `status` `open` | `dispatched` |
  `claimed` | `submitted`
  (and for a claim its executor, agent and lease end). A done task is never listed; the claim id never is either.
- `sdlc board claim --change <id> --task <n.m> --executor <id> --agent <name> [--lease <s>]` returns the work item
  of `task export` with `SDLC-Agent: <executor>/<agent>` filled in, plus a claim id — a random secret: whoever
  holds it may heartbeat, release or submit. The lease is 900 s by default, an integer 1–86400 (`invalid_lease`).
  The refusals of `task export` apply (`no_executor_registry`, `unknown_executor`, `executor_not_allowed`,
  `plan_not_approved`, `unknown_task`), plus `invalid_agent`, `task_done`, `task_claimed` (the message names the
  holder and the lease end) and `task_submitted`. One `task.claimed` log entry.
- `sdlc board heartbeat --claim <id>` pushes the lease end out by the claim's own lease; `claim_unknown`,
  `claim_expired`. It writes no log entry — heartbeats are too frequent to log.
- `sdlc board release --claim <id> [--note <text>]` opens the task again; one `task.released` entry (the note as
  detail).
- `sdlc board submit --claim <id> --branch <ref> [--base <ref>]` runs the `check-result` of above and, in
  addition, wants every commit's `SDLC-Agent` executor to be the claim's (`wrong_executor`). A pass closes the
  claim (`task.submitted` with branch and head sha, exit 0); a fail exits 1 with the problems and keeps the claim
  held. It changes no `.sdlc.yaml` and approves nothing.
- `sdlc board reopen --change <id> --task <n.m> --reason <text> [--escalate] [--json]` reopens a submitted
  claim. A blank reason is refused (`reason_required`); an unknown task or one without a submitted claim is
  `unknown_task` or `task_not_submitted`. The board shows the number of earlier attempts and the last reason;
  the next claim's work item includes `previousAttempts` in order. With `--escalate`, the rejected executor
  joins `excluded` and cannot claim that task again (`executor_excluded`). The log records `task.reopened` with
  the reason and, for escalation, `task.escalated`. Anyone, including an agent, may reopen a result. Verification
  and review still decide the change's gates.

There is no expiry timer: board lease commands first drop held claims whose lease ran out and log one
`task.lease_expired` per dropped claim — exactly once per claim. Writes are exclusive across processes:
`openspec/.sdlc/board.lock` (also a state file) serializes them, so two agents cannot claim the same task. A
broken `board.json` is `board_invalid`, never silently reset. Who splits the work, retries or races executors
stays outside sdlc.

### Roles and separation of duties

With `openspec/roles.yaml`, approvals are tied to people in git: the approver's email must belong to a person holding a role the gate accepts, the authors of the code do not approve its review or release, listed gate pairs need different people, and a per-person limit applies. `sdlc roles who <gate> --change <id>` shows the roles needed for that change's risk and who may approve; people refused only for lacking the role are omitted from text. Without `--change`, it lists every role. The `Next:` hint and the workflows name eligible people. `gates.<g>.min_approvals: N` makes a gate wait for approvals from N different people; one person approving again replaces only their own approval. With `signing: warn | required`, `sdlc approvals verify` checks that each approval arrived in a commit signed by the approver. See [Roles, separation of duties and signed approvals](08-roles-and-signing.md).

Since 0.18.0, the file also decides who takes team decisions: `sdlc team accept` (also with `--skill` and `--pack`) needs the `maintainer` role, and `sdlc backlog move` and `sdlc backlog drop` need `product-owner`. A person without the role is refused with `missing_role`, and the message names who may. Without the file any person may run them, as before; an agent never may. `sdlc team list` shows "a newer draft waits" (JSON `newerDraft: true`) when a draft in `docs/agents/drafts/` differs from the accepted role.

Since 0.19.0, a person in `roles.yaml` may list chat handles, one per channel:

```yaml
people:
  alice:
    name: Alice
    emails: [alice@corp.example]
    chat: { telegram: "@alice_tg", slack: U0ALICE }
```

A handle must be a non-empty string; anything else makes `roles.yaml` invalid (`sdlc roles check`). Only an event
receiver with `chat:` naming that channel gets the handles
([Events and the daily summary](#events-and-the-daily-summary)).

**Decisions are taken in your own terminal, not in the agent chat.** In OpenCode and Claude Code a command typed with `!` runs in the agent's shell, so `!sdlc approve …` is refused like the agent's own attempt; custom commands are no way around it either (an agent can run them). The refusal gives the exact command to run in your terminal.

### Import BMAD planning

Run `sdlc import bmad <path> --change <id> [--dry-run]` on BMAD PRD, SPEC and architecture spine artifacts. The importer keeps source copies under `sources/bmad/` and maps PRD vision to `intent.md`, SPEC purpose to `proposal.md`, capabilities or PRD requirements to `specs/`, architecture decisions to `design.md`, and deferred bullets to `openspec/deferred-work.md`. A dry run lists the files in text; use `--json` for JSON. Nothing is approved by the import. Review the output and run `sdlc validate --change <id>`.

### BMAD epics and tickets into the backlog

Run `sdlc import bmad <path> --to-backlog [--dry-run]` to load BMAD into `openspec/backlog.md` instead of a change. Supply exactly one of `--change` or `--to-backlog`. From `tickets.toml` / `bmad-ticket` output: each epic becomes a backlog epic, each entry an item (`story` → `feature`, `bug` → `bugfix`, `spike` → `chore`); acceptance comes from the story's criteria when present, otherwise `verify`; `after` becomes `Depends on`. From a PRD or SPEC without tickets: one epic named after the document, requirements as items. A dry run lists epics, items and warnings in text; use `--json` for JSON. Repeating an import skips matching BMAD sources and reports `Already imported: …` (JSON `skipped`). An imported epic may record `Source: bmad <folder>#<key>` below its `Goal:` line; older backlog files remain valid. Nothing is started or approved by the import.

## 5.4. Configuring `openspec/sdlc.yaml`

```yaml
version: 1
schema: sdlc                  # schema for sdlc new
cli: sdlc                     # or "npx --no-install sdlc"
locale: <code>                # optional: language for people (default: the system locale, else en)
tools: [claude, opencode]   # also: cursor, codex, qwen, gigacode
delivery: both                # both | skills | commands (sdlc init --delivery)
statusline: false             # true: the Claude Code status line (sdlc init --statusline)
project: { name: claims }     # optional: the project's name in events and in sdlc mcp serve --project
gates:
  intent:  { required: true,  approvers: [product-owner] }
  spec:    { required: true,  approvers: [product-owner], high_risk_approvers: [tech-lead] }
  plan:    { required: true,  approvers: [engineer],      high_risk_approvers: [tech-lead] }
  review:  { required: true,  approvers: [code-owner], min_approvals: 2 }   # two different people (default 1)
  # spec:  { auto_waive: { kinds: [docs], tracks: [lite] } }   # kind OR track; lite waives all lite changes
  # spec:  { judge: { run: node tools/judge.mjs, rubric: docs/rubrics/spec.md } }   # a judge before the person (0.20.0)
  # plan:  { overdue_hours: 24 }   # a wait longer than this raises gate.plan.overdue (unset: never overdue)
  release: { required: false, approvers: [release-manager] }
  verify:  { required: true }
  qa:      { required: false, approvers: [qa] }   # true: the qa role accepts the evidence before review (0.18.0)
roles:                        # optional: who may approve for a role (openspec/roles.yaml replaces this)
  product-owner: [anna@example.com]
  code-owner: [lead@example.com, dev2@example.com]
verify:
  commands:
    - { name: build, run: npm run build }
    - { name: test,  run: npm test }
    - { name: lint,  run: npm run lint, required: false }
  mcp:                        # gate checks the CLI calls on an MCP server (chapter 10.3)
    - { name: ci-green, server: build, tool: pipeline_status, args: { ref: "${HEAD}" }, expect: { status: success } }
  timeout_seconds: 900
  output_lines: 40
  require_behaviour: false    # true: the gate also needs the behavioural table, one row per scenario (0.18.0)
review:
  policy: REVIEW.md
  passes: [bugs, security, compliance]
  lenses: [adversarial, edge-cases, verification-gaps]
  require_lens_coverage: true # sdlc init writes true; without the key, missing coverage only warns
  base: main                  # base for the diff (default: origin/HEAD)
  block_on: [important]
release:
  # default: deploy, kubectl, terraform and helm commands that name prod or production
  commands: ['\bdeploy\b.*\bprod(uction)?\b']   # regexes for the agent's production commands
enforcement:
  mode: warn                  # off | warn | block
  require_approved_plan: true
  exempt_paths: ['openspec/**', '**/*.md', '.claude/**', '.opencode/**']
  protected_paths: ['src/generated/**', 'db/migrations/**']
  secret_allow: ['test/fixtures/**']   # paths where test data may hold real-looking keys (chapter 10.6)
  test_paths: ['**/*.test.*', '**/tests/**']
  forbid_agent_approvals: true
  session_context: true
  verify_before_stop: false
license:
  type: community             # community | commercial (changed with sdlc license set)
  # agreement: ACME-2026-001  # for commercial
  # licensee: Acme Corp
stages:                       # what each stage uses (chapter 10.5); MCP servers come from mcp.servers.*.stages
  design: { skills: [architecture-review], agents: [sdlc-researcher] }
  build:  { skills: [test-driven-development], simplify: true }   # false: no sdlc-simplifier step (0.17.0)
mcp:                          # chapter 10
  serve: true                 # register `sdlc mcp serve` for the tools (sdlc init --mcp)
  servers:                    # the team's MCP servers, laid out into every tool's MCP configuration
    build: { type: stdio, command: [npx, -y, corp-build-mcp], env: { CI_TOKEN: "${CI_TOKEN}" }, stages: [build, test] }
    jira:  { type: http, url: https://mcp.corp.example/jira, headers: { Authorization: "Bearer ${JIRA_TOKEN}" }, stages: [plan, deploy] }
issues: { server: github, repo: acme/claims }   # GitHub Issues through a server of mcp.servers (0.19.0)
context:
  sources:                    # packs from the knowledge server, written by sdlc context pull (0.19.0)
    - { name: glossary, server: kb, resource: "kb://glossary", stages: [design], owner: docs-team, fresh_days: 30 }
questions: { required: true } # a person answers open questions before intent/spec approval (sdlc answer)
design: { debate: false }     # the debate lens; debate_sides: [simplicity and speed, robustness and safety]
rework: { max_cycles: 3 }     # also reasons: the categories of sdlc rework --reason (the defaults are in 5.3)
team: { registry: team-roles } # the server of mcp.servers the roles and skills come from (chapter 12)
packs:                        # from git or npm; pin a commit or an exact version for workflows and checks (12.5)
  - { name: corp, git: https://git.corp.example/sdlc-pack.git, ref: 0123456789abcdef0123456789abcdef01234567 }
health:                       # thresholds of sdlc health; every key has a default
  wait_hours: 48              # also: window_days 90, stalled_days 14, deferred_days 30, first_pass_rate 0.5,
  rework_share: 0.5           #   waiver_share 0.3, reapprovals 3, rejections 2, denials 5, lock_days 7
log:
  enabled: true               # log in openspec/.sdlc/log.jsonl
  hook_decisions: true        # write hook denials and warnings to the log
```

Since 0.17.0, the build workflow runs the `sdlc-simplifier` subagent after the last task and before `sdlc verify`.
You do not need to list it in `stages.build.agents`. `stages.build.simplify: false` turns this step off. Only the
build stage takes `simplify`; under another stage it is a configuration error. Existing projects get the step with
`sdlc update`.

Since 0.18.0, `gates.qa: { required: true }` adds a `qa` gate between verify and review (default `required: false`,
`approvers: [qa]`). After verification passes, a person with the `qa` role accepts the evidence with
`sdlc approve qa --change <id>`; the review gate waits for it. The approval covers `verification.md` and the recorded
verify run, so a new `sdlc verify` makes it stale and `sdlc next` asks for it again.
`sdlc reject qa --change <id> --note "…"` sends the change back to the agent to fix and verify again. When the gate is
not required, it does not appear. An agent can never approve it.

Since 0.18.0, `verify.require_behaviour: true` (default `false`) makes the verify gate also need the behavioural table
of `verification.md`: one row per spec scenario, as `sdlc verify --check --strict` checks it. Without the rows the
gate is not satisfied, its reason names the uncovered scenarios, and `sdlc next` asks the agent to fill the table.

Since 0.19.0, `issues: { server, repo }` links the backlog to GitHub Issues through the team's GitHub MCP server:
`server` is a name in `mcp.servers`, and `repo` is `owner/name`. sdlc holds no token; the server has it. See
[Backlog and epics](#backlog-and-epics).

Since 0.19.0, `context.sources` lists the context packs that come from the team's knowledge server. Each source has a
`name` (a plain file name), a `server` (a name in `mcp.servers`), a `resource` or a `tool` with optional `args`, the
`stages`, the `owner` and an optional `fresh_days`. `sdlc context pull [--name <name>] [--json]` reads each source
(an MCP resource, or the text a tool answers) and writes `docs/context/<name>.md` with the usual header: `owner`,
`source: mcp:<server> <resource or tool>`, `updated:` today, `fresh_days` and `stages`. JSON lists `pulled` and
`failed`. A source that fails is listed under `failed` (exit code 1), and its file stays as it was. A name that is not
a plain file name, or a server that is not in `mcp.servers`, is a configuration error, and nothing is written. The
packs stay in git and go through review like any file, and `sdlc instructions` stays offline: it reads the files, not
the server. See [10.8](10-integrations.md#108-team-knowledge-at-the-right-stage).

Project context and rules for artifacts are set in the same place as in OpenSpec: `openspec/config.yaml` → `context:` and `rules.<artifact>`. They are included in the instructions for intent, proposal, specs, design, plan and tasks.

## 5.5. CI and headless mode

```bash
sdlc validate --all --json            # deltas + cross-change overlaps
sdlc status --json                    # stages and gates of all changes
sdlc review check --change <id>       # exit 1 if important findings are open
sdlc audit --json                     # playbook metrics (lead times, first-pass, waits on people, rework reasons)
sdlc log --json                       # project log with the sdlc version and license of each entry
sdlc approvals verify --mode required # every approval in a commit signed by the approver (roles.yaml)
sdlc ci init --provider github        # a person: CI that runs validate and approvals verify (or --provider gitlab)
sdlc events flush                     # deliver the queued events now (the job from sdlc ci init ends with it)
```

Use `sdlc log --event hook.warned --json` to inspect warnings before switching enforcement to block.
`--event` accepts `*` as any text, for example `hook.*` or `gate.*.approved`.
`sdlc log --since <date>` filters by date; both filters work with `--change` and `--limit`.
CLI log entries made in an agent session include an optional `agent` name alongside the person's git identity in `by`.
`sdlc audit --json` includes `agentEvents: { agent, total, byAgent }` counted from the log in the audited period;
`agentCommits` remains the separate count of commits with an `SDLC-Agent` trailer.
In JSON, `total` counts the filtered entries.

For `claude -p`, allow the required tools in advance: `--allowedTools "Bash(sdlc *),Read,Write,Edit"`. In CI, it is convenient to add `sdlc status --markdown` to the PR description.

Since 0.17.0, a person writes the CI configuration with `sdlc ci init --provider github|gitlab [--check <server>]
[--force]`. GitHub gets `.github/workflows/sdlc.yml`; GitLab gets `.gitlab/sdlc.yml` and, when there is none, a
`.gitlab-ci.yml` that includes it. The job runs `sdlc validate --all` and `sdlc approvals verify` on a full clone.
An existing file is kept; `--force` rewrites it. `--check <server>` adds a `ci-green` check to `verify.mcp`. The
command is refused in an agent session. See chapter 10.3.

Since 0.19.0, the job ends with `sdlc events flush`, also when a check failed (`if: always()` on GitHub,
`after_script` on GitLab), so the events queued in CI reach the receivers. An existing file keeps its old job until
`sdlc ci init --force` rewrites it.

## 5.6. Keeping the dashboard current

Since 0.16.1, `sdlc dashboard --watch [--out <file>] [--serve <host:port>] [--debounce <ms>]
[--min-interval <ms>]` builds the page, then rebuilds it when `openspec/` changes. The default output is
`reports/dashboard.html`. With `--serve`, it serves the page with auto-refresh; port 0 selects a free port.
Stop it with Ctrl+C. `scripts/examples/dashboard-watch.mjs` remains for Windows Task Scheduler setups.
See [the demo and automation](09-demo-and-automation.md).

When `openspec/executors.yaml` exists, the dashboard shows a task board grouped by change: each task's status,
executor, agent, lease end, attempts and last reopening reason, plus claimed and submitted counts per executor.
`sdlc report --format json` includes the same read-only snapshot as `board`; Markdown reports include a short table.
An expired lease appears open without changing the board file or log. A broken board file shows a warning.

## 5.7. Updating and uninstalling

```bash
npm install -g https://github.com/marin-ai-tech/sdlc/releases/latest/download/sdlc.tgz   # the latest release
sdlc update                             # regenerate files (manually edited ones are kept; --force overwrites them)
sdlc update --tools claude              # change the set of agents
sdlc update --dry-run                   # show what would change; write nothing
sdlc uninstall                          # remove agent files and hooks; openspec/ remains
```

## 5.8. Reference

### CLI

| Command | Purpose |
|---|---|
| `sdlc init [path] [--statusline] [--mcp] [--layout <mode>] [--worktree <path>] [--git-init]` / `update` / `uninstall` | set up, regenerate, remove integrations (planning data is never touched); `--statusline` opts in the Claude Code status line; `--mcp` registers sdlc as an MCP server; `--layout` makes the project AI-ready (in place or in a new worktree); in an agent session they never weaken the guard, and `uninstall` is human-only |
| `sdlc new <id> [--kind --risk --track --source-type --source-ref --skip-specs]` | start a change (an OpenSpec change folder + `.sdlc.yaml`) |
| `sdlc explore <slug> \| list` | create or list optional research notes before intent |
| `sdlc track set <full\|lite> --change <id> [--note <text>]` | human confirmation of the suggested track before plan approval |
| `sdlc defer add \| list \| close` | manage the deferred-work registry |
| `sdlc backlog add \| epic add \| epic edit \| list \| next \| edit \| start \| move \| drop \| done` | manage planned changes in `openspec/backlog.md` (order = priority; `move`/`drop` are human-only) |
| `sdlc backlog import --issues [--json]` | add one backlog item per open GitHub issue that is not linked yet (`issues` in `sdlc.yaml`) |
| `sdlc triage intake [--json]` | add one alert (JSON on stdin) as a backlog item; the same alert again adds nothing |
| `sdlc import bmad <path> (--change <id> \| --to-backlog) [--dry-run]` | import BMAD planning into an unapproved change, or epics/tickets (or a PRD/SPEC) into the backlog |
| `sdlc status [--change] [--markdown] [--json]` / `sdlc next` | stages, gates, approvals, evidence, who acts next (with `--change`, a stage stepper and task bar); with no active change, the next ready backlog item |
| `sdlc guide [topic[#section]] [--json]` | how sdlc works: short articles (in several languages) the guide workflow answers from; `denials#<rule>` explains a hook denial |
| `sdlc next --me [--json]` / `sdlc approve <gate> --change <id> --preview` | what waits for me, with the commands; what I am about to approve (writes nothing) |
| `sdlc help [topic] [--json]` | catalog of workflows and CLI commands with who runs them (agent or person) |
| `sdlc statusline` | one-line Claude Code status (change · stage · who acts); reads JSON on stdin |
| `sdlc layout check [--json]` / `scaffold [--dry-run] [--json]` / `adapt [--dry-run] [--json]` / `convert [--apply] [--json]` | check layout readiness, create missing documents, map existing paths, or plan and apply conversion |
| `sdlc rework <gate> --change <id> --reason <r> --note <t> [--reset]` | send a change back to a gate's stage with a reason; later approvals stop counting; `--reset` restores the planned files from the gate checkpoint (human-only) |
| `sdlc takeover` / `release-control --change <id> --note <t>` | take a change from the agent and hand it back with a note (human-only) |
| `sdlc team sync \| list \| check [--json]` / `team accept <role> \| --skill <id> \| --pack <name>` | the agent team: drafts from the registry, packs and built-ins; roles and their status; vetted skills; a person accepts a role, a skill with scripts, or the lenses, workflows and checks of a pack |
| `sdlc events list \| flush \| summary [--json]` | process events waiting for delivery to the team's server; deliver them now; record and send the daily summary (once a day) |
| `sdlc release check --change <id> [--json]` | run the release gate's MCP checks without approving |
| `sdlc mcp serve [--http <host:port>] [--project <path>]` / `sdlc mcp check [--json] [--strict] [--args]` | sdlc as an MCP server over stdio (`init --mcp` registers it) or over HTTP with the token `SDLC_MCP_TOKEN`: the read tools, and the board tools for a client with an executor's token; connect to the registry servers and list their tools |
| `sdlc context pull [--name <name>] [--json]` | write context packs from the team's knowledge server into `docs/context/` |
| `sdlc task export --change <id> [--task <n.m>] --json` / `sdlc task check-result --change <id> --branch <ref> --json` | the task contract: the open tasks of an approved plan as work items; check a returned branch (both read-only) |
| `sdlc judge --gate <gate> --change <id> [--json]` | run the gate's judge and record its verdict (anyone, an agent too) |
| `sdlc ci init --provider github\|gitlab [--check <server>] [--force]` | write a CI configuration that runs `validate --all`, `approvals verify` and `events flush` (human-only) |
| `sdlc inbox list [--json]` / `inbox done <id>` | MCP check results from runs outside an agent session, for the agent |
| `sdlc review suggest --change <id> [--json]` | propose a reviewer: roles, CODEOWNERS owners first, fewer open reviews, never an author |
| `sdlc trace <change> [--json]` | from intent to evidence: requirements, scenarios, tasks, commits (trailers `SDLC-Change`, `SDLC-Task`), verification and review findings, with the gaps |
| `sdlc adopt [--apply] [--json]` | draft verify commands, protected paths and `roles.yaml` for an existing project; `--apply` writes them (human-only) |
| `sdlc report [--format md\|json\|html] [--since] [--change] [--out]` / `sdlc dashboard [--since] [--change] [--out] [--watch [--serve <host:port>]]` | progress report and self-contained HTML dashboard (`--watch` rebuilds it when `openspec/` changes) |
| `sdlc instructions <artifact> --change <id> --json` | artifact instructions (from OpenSpec for planning artifacts; from the harness for verification, review, release) |
| `sdlc approve \| reject \| waive <gate> --change <id> [--as <role>] [--note]` | human gate decisions (with `openspec/roles.yaml`: the person, the role and separation of duties are checked) |
| `sdlc roles check [--change] \| who <gate> --change <id> \| migrate` | who holds which role and who may approve a gate; `migrate` (human-only) moves `roles:` from `sdlc.yaml` into `roles.yaml` |
| `sdlc approvals verify [--mode off\|warn\|required]` | check that every approval arrived in a commit signed by the approver, and `roles.yaml` changes by a maintainer |
| `sdlc verify [--list] [--check] [--only]` | run checks, record evidence, check scenario coverage |
| `sdlc review context \| check` | diff, policy and plan drift; open blocking findings |
| `sdlc tests lock \| unlock` | bug-fix protocol (unlocking is human-only) |
| `sdlc validate [--all]` | `openspec validate --strict`, delta target checks, overlaps |
| `sdlc archive <id> --yes` | re-check gates, then `openspec archive` (delta merge) |
| `sdlc audit [--change]` | audit trail and metrics |
| `sdlc health [--since <date> \| --days <n>]` | project health findings with facts and recommendations |
| `sdlc explain --change <id>` | why a change is where it is and what unblocks it |
| `sdlc answer <n> --change <id> --text "…"` | a person answers an open question (human-only); `--list` shows them |
| `sdlc guide tour [step]` | a walkthrough of the calculator demo for newcomers |
| `sdlc audit --export <dir> [--since <date>]` | the evidence bundle for auditors |
| `sdlc changelog [--change <id> \| --since <date>]` | release notes from the delta specs |
| `sdlc log [--change] [--event] [--since] [--limit]` | project log, with the sdlc version and license of each entry |
| `sdlc license` / `sdlc license set community \| commercial --agreement <id> [--licensee]` | show or record the license the project uses sdlc under (setting it is human-only) |
| `sdlc doctor [--fix]` | installation health, including whether the declared license fits the project; `--fix` repairs only what sdlc owns |
| `sdlc hook <event>` | policy dispatcher used by the hooks and the plugin |
| `sdlc plugin build [dir] --marketplace` | render the Claude Code plugin |
| `sdlc openspec <args>` | run the bundled OpenSpec CLI |

Every command except `statusline`, `dashboard`, `mcp serve`, `hook` and the `openspec` pass-through supports `--json` and returns OpenSpec-style diagnostics (`{severity, code, message, fix}`) on failure.

### What gets generated

| | Claude Code | OpenCode |
|---|---|---|
| Workflows | `.claude/skills/sdlc-<id>/SKILL.md` + `.claude/commands/sdlc/<id>.md` | `.opencode/commands/sdlc-<id>.md` |
| Skills | `.claude/skills/` | read from `.claude/skills/` (written to `.opencode/skills/` only for OpenCode-only projects, to avoid duplicate names) |
| Subagents | `.claude/agents/sdlc-{verifier,reviewer,researcher,simplifier,health,advocate}.md` | `.opencode/agents/sdlc-*.md` (`mode: subagent`, `permission` map) |
| Guardrails | hooks merged into `.claude/settings.json` | `.opencode/plugins/sdlc.js` |

Cursor, Codex CLI, Qwen Code and GigaCode get the same workflows and subagents in their own folders, with their own
hooks and rules: see [Cursor](docs/en/15-cursor.md), [Codex CLI](docs/en/16-codex.md) and
[Qwen Code and GigaCode](docs/en/17-qwen-gigacode.md).

The workflows are 18 short skills: `help`, `guide`, `next`, `status`, `health`, `adopt`, `team`, `backlog`, `explore`,
`intent`, `spec`, `plan`, `build`, `verify`, `review`, `release`, `archive`, `triage`. They pull state, templates and
instructions from the CLI at run time (`sdlc status|next|instructions --json`). Generated files are tracked in
`openspec/.sdlc/manifest.json`, so `sdlc update` never overwrites a file you edited unless you pass `--force`.

### Version and license records

Everything sdlc writes records the sdlc version and the license the project uses sdlc under (`license` in `openspec/sdlc.yaml`):

| Where | What |
|---|---|
| `openspec/.sdlc/log.jsonl` | append-only project log: setup, gate decisions, verification runs, archives, license changes and hook denials, one JSON line each with `sdlc` and `license` (commit it; `merge=union` keeps branches mergeable). Shell command text is never logged. `sdlc log` prints it. |
| `.sdlc.yaml` of each change | `harness: {sdlc, license}` plus `sdlc`/`license` on every history event, approval, rejection, waiver and verification record |
| change artifacts | one line `<!-- sdlc-provenance: sdlc <version> \| license: <license> \| <url> -->` at the end of the top-level markdown artifacts, written at approval, verification and archive. It is excluded from gate digests, so it never makes an approval stale. Delta specs are never stamped, because their text is merged into the living specs. |
| `verification.md` | a `Harness` line in the evidence block |
| generated agent files | a notice with the version, the license in use and the `Required Notice` (skills, commands, subagents, the OpenCode plugin, `schema.yaml`; not the artifact templates) |
| `sdlc status --markdown`, `--json` outputs | a footer line or a `harness` object |

### Language

Help, `Next:` hints, `status`, the init wizard, hook reasons, the report and the dashboard follow the locale: `--locale <code>` on any command, then `SDLC_LOCALE`, then `locale:` in `openspec/sdlc.yaml`, then the system locale (`LC_ALL`, `LC_MESSAGES`, `LANG`, the OS). Without a translation the text is English. Translations ship with sdlc. JSON output, the project log and change records are always English, so agents and CI read the same thing everywhere.

### Development

```bash
npm install            # uses --legacy-peer-deps via .npmrc
npm run compile        # dist/ is build output (not in git); `npm install` and `npm install -g github:…` build it via the prepare script
npm test               # compiles, then runs unit + end-to-end tests (real OpenSpec CLI)
node bin/sdlc.js --help
node bin/sdlc.js plugin build plugin --marketplace   # regenerate the committed plugin
```

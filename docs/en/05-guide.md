# 5. User guide

## 5.1. Installation

```bash
# CLI, the latest release (the required OpenSpec version is installed with it)
npm install -g https://github.com/marin-ai-tech/sdlc/releases/latest/download/sdlc.tgz
sdlc --version

# in the project root (a git repository)
sdlc init --tools claude,opencode      # or --tools claude / --tools opencode
sdlc doctor                            # check the installation
```

From git, install the `release` branch, which carries the built code: `npm install -g github:marin-ai-tech/sdlc#release`. Never `npm install -g sdlc`: the registry package of that name is unrelated.

With no flags in a terminal, `sdlc init` guides you through the setup (tools, enforcement mode, status line, /opsx, language, roles) and shows a summary before writing. The wizard also offers to install the OpenSpec CLI and codegraph when they are missing. Scripts, `--json`, non-terminals and agent sessions never prompt.

**AI-ready from the start.** In an empty folder (nothing but `.git`, `.gitignore`, `LICENSE`, `README`) the wizard creates the agent documents right away and offers `git init` when there is no repository. In an existing project it first shows how the project differs from the AI-ready layout — missing documents and documents under other names — and offers three choices: build the AI-ready project in a new git worktree in a folder you name (the whole setup happens there, in one commit on the `sdlc/ai-ready` branch; your working copy is not touched), adapt in place (`layout adapt`), or skip. Without the wizard: `--layout scaffold|adapt|worktree|none` with `--worktree <path>`, and `--git-init`; without `--layout` init only reports the differences. Only a person may create the worktree, because it commits on their behalf.

`sdlc init`:
- creates `openspec/` by running `openspec init` if it does not exist, and makes `sdlc` the default schema. In an existing OpenSpec project, the default schema does not change;
- copies the schema to `openspec/schemas/sdlc/` and creates `openspec/sdlc.yaml`. Verification commands are detected automatically from `package.json`, `Makefile`, `pyproject`, `go.mod` or `Cargo.toml`;
- generates skills, commands, subagents and hooks (Claude) or a plugin (OpenCode), plus `REVIEW.md` if it does not exist.

Useful flags: `--mode block` — strict enforcement; `--cli "npx --no-install sdlc"` — if the CLI is installed locally in the project (`npm i -D https://github.com/marin-ai-tech/sdlc/releases/latest/download/sdlc.tgz`; `--no-install` keeps npx from fetching the unrelated registry package); `--opsx` — also install OpenSpec's own `/opsx:*` workflows alongside; `--delivery skills|commands|both`; `--no-hooks`; `--statusline` — install the Claude Code status line.

**Claude Code plugin (organization-wide):**
```text
/plugin marketplace add marin-ai-tech/sdlc
/plugin install sdlc@sdlc
```
After you install the plugin, it is enough to run `sdlc init --tools none` (or `--tools opencode`) in the project, so that skills are not duplicated. To make the plugin installation mandatory, use `extraKnownMarketplaces` and `enabledPlugins` in `.claude/settings.json` or in managed settings.

After `init`, commit the generated files: they are shared by the team.

**License.** By default, a project uses sdlc under the free Community License. It covers noncommercial use, open source projects and a 30-day evaluation. `sdlc init` and `sdlc doctor` warn you if the project has no OSI-approved license. Commercial use requires a commercial license. After the agreement is signed, record the license with `sdlc license set commercial --agreement <id> --licensee "<company>"`.

## 5.2. Lifecycle of a change

| Step | Who | Claude Code | OpenCode | CLI |
|---|---|---|---|---|
| Idea → intent.md | agent + idea author | `/sdlc:intent "customers call to check the status of their request"` | `/sdlc-intent …` | `sdlc new <id>` |
| Approve the intent | product owner | | | `sdlc approve intent --change <id>` |
| proposal, deltas, design | agent | `/sdlc:spec` | `/sdlc-spec` | `sdlc validate` |
| Approve the spec | product owner (+ tech lead if high risk) | | | `sdlc approve spec --change <id> [--as tech-lead]` |
| plan.md + tasks.md (plan mode) | agent + engineer | `/sdlc:plan` | `/sdlc-plan` | |
| Approve the plan | engineer | | | `sdlc approve plan --change <id>` |
| Implementation with a feedback loop | agent | `/sdlc:build` | `/sdlc-build` | |
| Evidence + independent verification | agent + verifier subagent | `/sdlc:verify` | `/sdlc-verify` | `sdlc verify`, `sdlc verify --check` |
| Review against REVIEW.md, fixing findings | agent + reviewer subagent | `/sdlc:review` | `/sdlc-review` | `sdlc review context\|check` |
| Approve the review | code owner | | | `sdlc approve review --change <id>` |
| Release (if enabled) | agent → release manager | `/sdlc:release` | `/sdlc-release` | `sdlc approve release --change <id>` |
| Archive: deltas → living specs | agent | `/sdlc:archive` | `/sdlc-archive` | `sdlc archive <id> --yes` |
| Alert/incident → new intent | agent | `/sdlc:triage <alert>` | `/sdlc-triage` | |

At any point, `/sdlc:next` (`/sdlc-next`) runs the next step or tells you who must do it and with which command. `sdlc status` shows all changes, and `sdlc status --markdown` produces a report for a PR or a wiki.

**A human runs approvals in their own terminal.** Inside an agent session, `sdlc approve` refuses to run. This is by design.



### Getting around

- Language: help, hints, `status`, the init wizard, hook reasons and reports follow `--locale`, `SDLC_LOCALE`, `locale:` in `sdlc.yaml` or the system locale, in that order; English when there is no translation (English and Russian ship). JSON never changes with the locale.
- `sdlc help [topic] [--json]` and `/sdlc:help` (`/sdlc-help`) list workflows and CLI commands and say who runs each one (agent or person).
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

Commands: `sdlc backlog epic add <title> [--goal]`, `sdlc backlog epic edit <E-id> [--title --goal --clear-goal]` (changes an epic's title or goal, never the order), `sdlc backlog add <title> [--epic --kind --risk --outcome --accept --depends --source-type --source-ref]`, `list [--epic --status --ready]`, `next`, `edit <B-id> [--title --outcome --accept --add-accept --depends --clear-depends --kind --risk]` (changes an open or in-progress item's text, never its place or status; `--accept` and `--depends` replace the list), `start <B-id> [--change <id>]` (creates the change and a draft `intent.md`, sets the item to `in-progress`), `move <B-id> (--top | --before | --after | --epic)` and `drop <B-id> --note` (human-only), `done <B-id> --note`. Flow: ready item → `backlog start` → change lifecycle → `sdlc archive` marks the item `done`. With no active change, `sdlc next` proposes the next ready item.

People edit `openspec/backlog.md` by hand as well; agents change it only through these commands — the hook denies an agent's direct edit, so order and removal stay a person's decision. In Claude Code and OpenCode, `/sdlc:backlog` (`/sdlc-backlog`) works with the backlog: without input it shows the list, the next ready item and what blocks the others; with an epic or an idea it proposes items with an outcome and acceptance criteria and adds only those you confirm; with `B<n>` it brings the item to ready and offers to start it. For a reorder or a drop it gives you the command to run.

### Explore before intent

Use `/sdlc:explore` (`/sdlc-explore`) to research and pressure-test an idea. `sdlc explore <slug>` creates `openspec/explorations/<slug>.md`; `sdlc explore list` lists notes. Start a linked change with `sdlc new <id> --source-type exploration --source-ref openspec/explorations/<slug>.md`. Exploration is optional and does not approve intent.

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

`sdlc review check --change <id>` checks missing entries, mismatched finding counts, empty `checked:` evidence, and deferred links. The review gate uses that result. New projects require lens coverage; older projects warn until `review.require_lens_coverage: true` opts in.

### Defer a finding

Record postponed work with `sdlc defer add <title> --why <text> [--change <id>] [--finding <F-id>] [--revisit <text>]`, inspect it with `sdlc defer list [--open] [--change <id>]`, and close it with `sdlc defer close <D-id> --status done|dropped --note <text>`. The registry is `openspec/deferred-work.md`; each `### D<n> [open] Title` entry has `**Change**`, optional `**Finding**`, `**Why**`, `**Revisit when**`, and `**Created**` fields. Mark the review finding `deferred (D<n>)`; the review check requires a link to an open item. Reports and dashboards show the registry.

### Roles and separation of duties

With `openspec/roles.yaml`, approvals are tied to people in git: the approver's email must belong to a person holding a role the gate accepts, the authors of the code do not approve its review or release, listed gate pairs need different people, and a per-person limit applies. `sdlc roles who <gate> --change <id>` shows who may approve and why others may not. With `signing: warn | required`, `sdlc approvals verify` checks that each approval arrived in a commit signed by the approver. See [Roles, separation of duties and signed approvals](08-roles-and-signing.md).

**Decisions are taken in your own terminal, not in the agent chat.** In OpenCode and Claude Code a command typed with `!` runs in the agent's shell, so `!sdlc approve …` is refused like the agent's own attempt; custom commands are no way around it either (an agent can run them). The refusal gives the exact command to run in your terminal.

### Import BMAD planning

Run `sdlc import bmad <path> --change <id> [--dry-run]` on BMAD PRD, SPEC and architecture spine artifacts. The importer keeps source copies under `sources/bmad/` and maps PRD vision to `intent.md`, SPEC purpose to `proposal.md`, capabilities or PRD requirements to `specs/`, architecture decisions to `design.md`, and deferred bullets to `openspec/deferred-work.md`. Nothing is approved by the import. Review the output and run `sdlc validate --change <id>`.

### BMAD epics and tickets into the backlog

Run `sdlc import bmad <path> --to-backlog [--dry-run]` to load BMAD into `openspec/backlog.md` instead of a change. Supply exactly one of `--change` or `--to-backlog`. From `tickets.toml` / `bmad-ticket` output: each epic becomes a backlog epic, each entry an item (`story` → `feature`, `bug` → `bugfix`, `spike` → `chore`); acceptance comes from the story's criteria when present, otherwise `verify`; `after` becomes `Depends on`. From a PRD or SPEC without tickets: one epic named after the document, requirements as items. Nothing is started or approved by the import.

## 5.3. Configuring `openspec/sdlc.yaml`

```yaml
version: 1
schema: sdlc                  # schema for sdlc new
cli: sdlc                     # or "npx --no-install sdlc"
locale: ru                    # optional: language for people (default: the system locale, else en)
tools: [claude, opencode]
gates:
  intent:  { required: true,  approvers: [product-owner] }
  spec:    { required: true,  approvers: [product-owner], high_risk_approvers: [tech-lead] }
  plan:    { required: true,  approvers: [engineer],      high_risk_approvers: [tech-lead] }
  review:  { required: true,  approvers: [code-owner] }
  release: { required: false, approvers: [release-manager] }
  verify:  { required: true }
roles:                        # optional: who may approve for a role (openspec/roles.yaml replaces this)
  product-owner: [anna@example.com]
  code-owner: [lead@example.com, dev2@example.com]
verify:
  commands:
    - { name: build, run: npm run build }
    - { name: test,  run: npm test }
    - { name: lint,  run: npm run lint, required: false }
  timeout_seconds: 900
  output_lines: 40
review:
  policy: REVIEW.md
  passes: [bugs, security, compliance]
  lenses: [adversarial, edge-cases, verification-gaps]
  require_lens_coverage: true
  base: main                  # base for the diff (default: origin/HEAD)
  block_on: [important]
release:
  commands: ['\bdeploy\b.*\bprod(uction)?\b']   # regexes for the agent's production commands
enforcement:
  mode: warn                  # off | warn | block
  require_approved_plan: true
  exempt_paths: ['openspec/**', '**/*.md', '.claude/**', '.opencode/**']
  protected_paths: ['src/generated/**', 'db/migrations/**']
  test_paths: ['**/*.test.*', '**/tests/**']
  forbid_agent_approvals: true
  session_context: true
  verify_before_stop: false
license:
  type: community             # community | commercial (changed with sdlc license set)
  # agreement: ACME-2026-001  # for commercial
  # licensee: Acme Corp
log:
  enabled: true               # log in openspec/.sdlc/log.jsonl
  hook_decisions: true        # write hook denials and warnings to the log
```

Project context and rules for artifacts are set in the same place as in OpenSpec: `openspec/config.yaml` → `context:` and `rules.<artifact>`. They are included in the instructions for intent, proposal, specs, design, plan and tasks.

## 5.4. CI and headless mode

```bash
sdlc validate --all --json            # deltas + cross-change overlaps
sdlc status --json                    # stages and gates of all changes
sdlc review check --change <id>       # exit 1 if important findings are open
sdlc audit --json                     # playbook metrics (lead times, first-pass)
sdlc log --json                       # project log with the sdlc version and license of each entry
sdlc approvals verify --mode required # every approval in a commit signed by the approver (roles.yaml)
```

For `claude -p`, allow the required tools in advance: `--allowedTools "Bash(sdlc *),Read,Write,Edit"`. In CI, it is convenient to add `sdlc status --markdown` to the PR description.

## 5.5. Keeping the dashboard current

`scripts/examples/dashboard-watch.mjs` rebuilds `reports/dashboard.html` whenever `openspec/` changes and can serve it on localhost with an auto-refresh; examples run it as a Windows task, a systemd or launchd service, or a CI step. See [the demo and automation](09-demo-and-automation.md).

## 5.6. Updating and uninstalling

```bash
npm install -g https://github.com/marin-ai-tech/sdlc/releases/latest/download/sdlc.tgz   # the latest release
sdlc update                             # regenerate files (manually edited ones are kept; --force overwrites them)
sdlc update --tools claude              # change the set of agents
sdlc uninstall                          # remove agent files and hooks; openspec/ remains
```

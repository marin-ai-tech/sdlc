# sdlc — AI-native SDLC harness for Claude Code and OpenCode, built on OpenSpec

`sdlc` runs the lifecycle from Anthropic's [AI-Native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook) inside your coding agent:

```
backlog ──► explore (optional) ──► intent ──► spec ──► plan ──► build ──► verify ──► review ──► (release) ──► archive
 planned     Plan      Design    Build              Test       Deploy                  living specs
   ▲                                                                                       │
   └──────────────────────────── triage (alerts, incidents, scans) ◄───────────────────────┘
```

[OpenSpec](https://github.com/Fission-AI/OpenSpec) is the specification subsystem. `sdlc` does not fork it: OpenSpec is a pinned dependency and does all spec work through its JSON CLI (changes, artifact instructions, validation, delta merge on archive). Your `openspec/` folder stays a plain OpenSpec project, and `openspec` and `/opsx:*` keep working on it.

On top of OpenSpec, `sdlc` adds the process parts the playbook asks for:

- **Stages and gates** with human approvals bound to content digests. If an artifact changes after it was approved, the approval goes stale and the gate needs a new approval.
- **Separation of duties.** An agent cannot approve its own work: the CLI refuses inside agent sessions, and hooks block attempts. Between people, optional `openspec/roles.yaml` (in git) names who holds which role: the author of a change's code cannot approve its review or release, paired gates need different people, and `sdlc approvals verify` checks that each approval arrived in a commit signed by the approver.
- **Verification evidence.** `sdlc verify` runs your real checks, stores their literal output, and ties the result to a content-addressed fingerprint of the worktree. Committing the code keeps the result valid; changing the code makes it stale.
- **Review** follows `REVIEW.md` passes (bugs, security, compliance). Findings are graded by severity. A human code owner approves once no important finding is open, and **plan drift** is computed against `plan.md`.
- **Deterministic guardrails.** Claude Code hooks and an OpenCode plugin enforce the gates: no code before an approved plan, locked tests during bug fixes, protected paths, no production release without authorization, no keys or tokens added in agent edits, and no agent edits of the guard's own configuration.
- **MCP in both directions.** `sdlc mcp serve` lets other AI systems read the process (status, next step, instructions, trace, audit); it offers no decisions. The team's MCP servers are described once in `openspec/sdlc.yaml` and laid out for Claude Code and OpenCode. `verify.mcp` checks are called by the CLI itself as gate evidence, and results from runs outside an agent session wait in `sdlc inbox` for the agent. The hook allows each server only at its stages, and each stage's workflows list the skills, subagents and servers configured for it. See [docs/en/10-integrations.md](docs/en/10-integrations.md) and the use cases in [docs/en/11-mcp-use-cases.md](docs/en/11-mcp-use-cases.md).
- **The agent team.** Role agents — analyst, architect, developer, tester, reviewer — adapted to the project: from the team's MCP registry, a git or npm pack, or the built-in set, with a Project rules section the agent drafts from the code; sdlc adds where each role writes and the project's facts (checks, protected paths, people). A person accepts each role (`sdlc team accept`), and agents cannot edit accepted roles or vetted skills. See [docs/en/12-agent-team.md](docs/en/12-agent-team.md).
- **Reviewer suggestion and context packs.** `sdlc review suggest` proposes a reviewer from roles, CODEOWNERS and open reviews, never the code's author; `docs/context/` sources reach the agent at their stage, and stale ones are marked.
- **Checks OpenSpec lacks.** Before a merge, delta targets are checked. Overlapping edits across open changes are flagged. So are base-spec drift and spec scenarios with no verification evidence.
- **Right-sized process.** A `lite` track skips intent and spec for small, bounded work.
- **Exploration before intent.** `/sdlc:explore` pressure-tests an idea in `openspec/explorations/`; a later change can cite the note.
- **Repository backlog.** `openspec/backlog.md` holds epics and items (one item = one future OpenSpec change). `sdlc backlog` adds and starts them; when nothing is active, `sdlc next` proposes the next ready item; archive closes it.
- **Review coverage.** Configured passes and lenses need recorded coverage in `review.md`; `sdlc review check` checks it.
- **Human track confirmation.** `sdlc new` suggests a track; a person can confirm or change it with `sdlc track set` before plan approval.
- **Deferred-work registry.** `sdlc defer` tracks postponed findings in `openspec/deferred-work.md` and exposes them in reports.
- **BMAD import.** `sdlc import bmad` maps planning artifacts into an unapproved OpenSpec change, or into the backlog with `--to-backlog` (epics and tickets, or a PRD/SPEC).
- **AI-ready project layout.** `sdlc layout check | scaffold | adapt | convert` checks and builds the documents agents rely on (`AGENTS.md`, `CLAUDE.md`, architecture, conventions, runbook…), maps existing paths, or plans a conversion. `sdlc adopt` drafts settings and roles for an existing project (stack, CI, CODEOWNERS, git authors); `/sdlc:adopt` (`/sdlc-adopt`) fills the documents from the code.
- **Reports and dashboard.** `sdlc report` (Markdown with Mermaid, JSON or HTML) and `sdlc dashboard` (one offline HTML page) show stages, gates, backlog, deferred work and metrics; an example background process keeps the page current.
- **Audit and metrics.** `sdlc audit` builds a timeline of who approved what and when, plus the playbook's lead-time and first-pass metrics, how long each gate waited for a person, the reworks with their reasons, and verify attempts until the first pass.
- **Native agent UX.** Workflows ask with each tool's question tool (Claude Code AskUserQuestion, OpenCode `question`), mirror `tasks.md` into the tool todo list during `/sdlc:build`, and inject live CLI output into `/sdlc:status`, `/sdlc:next` and `/sdlc:help`. An answer in chat is never an approval — people run human decisions in their own terminal.
- **Ask the agent how sdlc works.** The guide workflow answers questions about working with sdlc for your project, from short articles that ship with sdlc in English and Russian (`sdlc guide [topic]`); every hook denial names the section that explains it. `sdlc next --me` lists what waits for you, and `sdlc approve --preview` shows what you are about to approve.
- **Help and Next hints.** `sdlc help [topic]` and `/sdlc:help` catalog workflows and CLI commands with who runs them (agent or person). State-changing commands print a `Next:` hint (who acts next and how; the exact command when a person must act) and add `next` to JSON.
- **Progress drawing.** `sdlc status --change <id>` shows a stage stepper and a task bar; `sdlc backlog list` shows a bar per epic; the markdown report includes Mermaid diagrams with sanitized labels.
- **Claude Code status line.** `sdlc statusline` prints one line (change · stage · who acts); opt in with `sdlc init --statusline`. A user-defined status line is never replaced; `sdlc uninstall` removes only the sdlc one.

## Install

```bash
npm install -g https://github.com/marin-ai-tech/sdlc/releases/latest/download/sdlc.tgz   # the latest release: `sdlc` and the OpenSpec it drives
cd your-project && git init               # a git repository is expected
sdlc init --tools claude,opencode         # or: --tools claude | --tools opencode
sdlc doctor
```

Other ways to install:
- from git: `npm install -g github:marin-ai-tech/sdlc#release` (the `release` branch carries the built code; the default branch builds from source, and npm 11 cannot build a git package during a global install);
- a specific version: `npm install -g https://github.com/marin-ai-tech/sdlc/releases/download/v<version>/sdlc-<version>.tgz`;
- from source: clone, `npm install`, `npm pack`, then `npm install -g ./sdlc-<version>.tgz`.

Do not run `npm install -g sdlc`: the package of that name on the npm registry is unrelated.

Run `sdlc init` with no flags in a terminal to walk through the same choices interactively (tools, enforcement mode, status line, /opsx, language, roles) and confirm a summary before anything is written. The wizard also offers to install the OpenSpec CLI and codegraph when they are missing. Flags, `--json`, non-terminals and agent sessions keep the non-interactive behaviour. In an empty folder the wizard makes the project AI-ready at once; in an existing one it shows the differences from the AI-ready layout and offers to build the AI-ready project in a new git worktree, or to adapt in place (`--layout scaffold|adapt|worktree --worktree <path>` without the wizard).

`sdlc init` does the following:
- creates `openspec/` with OpenSpec itself if it is missing, and makes `sdlc` the default schema there (an existing OpenSpec project keeps its default);
- installs the `sdlc` OpenSpec schema into `openspec/schemas/sdlc/`;
- writes `openspec/sdlc.yaml`, pre-filled with detected build, test and lint commands;
- generates the agent integration files and a starter `REVIEW.md`.

Commit the generated files: the whole team shares them.

Options: `--mode block` (strict enforcement), `--cli "npx --no-install sdlc"` (project-local install; `--no-install` keeps npx from fetching the unrelated registry package), `--opsx` (also install OpenSpec's own `/opsx:*` workflows), `--delivery skills|commands|both`, `--no-hooks`, `--statusline` (Claude Code status line).

### Claude Code plugin (organization-wide)

```text
/plugin marketplace add marin-ai-tech/sdlc
/plugin install sdlc@sdlc
```

If you added the marketplace under its old name (`marin-ai-tech/scdl`, before 0.6.2), add it again under the new one and reinstall the plugin.

The plugin ships the same workflows (`/sdlc:<id>`), subagents and hooks. With the plugin installed, run `sdlc init --tools none` (or `--tools opencode`) in projects so the project-level Claude files do not duplicate it.

## Use

**The path for an existing project:** `sdlc init` → `/sdlc:adopt` (documents filled from the code; you apply the settings with `sdlc adopt --apply`) → `/sdlc:explore <idea>` when an idea needs research → `/sdlc:backlog` (items you confirm; you set the order) → `sdlc backlog start B<n>` → `/sdlc:intent` and `/sdlc:next` through the gates → `sdlc archive` → the next item, until the backlog is empty. Step by step: [the guide, 5.2](docs/en/05-guide.md#52-working-with-sdlc-from-init-to-an-empty-backlog).

| Stage | Claude Code | OpenCode | Who decides |
|---|---|---|---|
| Prepare an existing project: documents from the code, settings draft | `/sdlc:adopt` | `/sdlc-adopt` | you: `sdlc adopt --apply` |
| Plan the backlog: decompose, refine, start items | `/sdlc:backlog` | `/sdlc-backlog` | you: `sdlc backlog move` / `drop` |
| Explore before intent | `/sdlc:explore` | `/sdlc-explore` | — |
| Help: workflows and CLI catalog | `/sdlc:help` | `/sdlc-help` | — |
| Plan: capture `intent.md` | `/sdlc:intent "<idea>"` | `/sdlc-intent "<idea>"` | product owner: `sdlc approve intent` |
| Design: proposal, delta specs, design | `/sdlc:spec` | `/sdlc-spec` | product owner (+ tech lead if high risk): `sdlc approve spec` |
| Build: `plan.md` + `tasks.md` | `/sdlc:plan` | `/sdlc-plan` | engineer: `sdlc approve plan` |
| Build: implement with a feedback loop | `/sdlc:build` | `/sdlc-build` | — |
| Test: evidence + independent verifier | `/sdlc:verify` | `/sdlc-verify` | automatic (`sdlc verify`) |
| Deploy: multi-pass review, fix loop | `/sdlc:review` | `/sdlc-review` | code owner: `sdlc approve review` |
| Deploy: release up to the production gate | `/sdlc:release` | `/sdlc-release` | release manager: `sdlc approve release` |
| Close: merge deltas into living specs | `/sdlc:archive` | `/sdlc-archive` | — |
| Maintain: alert or incident → new intent | `/sdlc:triage` | `/sdlc-triage` | service owner |

`/sdlc:next` (`/sdlc-next`) always does the next step, or tells you who must act and the exact command. `/sdlc:status` and `sdlc status [--markdown]` show the dashboard. State-changing commands also print a `Next:` hint (who acts next and how) and add `next` to JSON.

People run approvals **in their own terminal**. Inside an agent session `sdlc approve` refuses by design.

**Backlog.** Plan work in `openspec/backlog.md` before a change exists: `sdlc backlog add` / `epic add` / `epic edit`, list and reorder with `list` / `move`, refine an item with `edit`, start a ready item with `sdlc backlog start <B-id>` (creates the change and a draft `intent.md`), or close with `done` / `drop`. Priority (`move`) and dropping an item are human decisions; agents change the file only through these commands. `/sdlc:backlog` (`/sdlc-backlog`) does the same from the agent. With no active change, `sdlc next` points at the next ready backlog item.

Small bounded work: `sdlc new fix-null-name --kind bugfix --risk low`. Review its track suggestion, then confirm `sdlc track set lite --change fix-null-name` in your terminal before plan approval.

## What gets generated

| | Claude Code | OpenCode |
|---|---|---|
| Workflows | `.claude/skills/sdlc-<id>/SKILL.md` + `.claude/commands/sdlc/<id>.md` | `.opencode/commands/sdlc-<id>.md` |
| Skills | `.claude/skills/` | read from `.claude/skills/` (written to `.opencode/skills/` only for OpenCode-only projects, to avoid duplicate names) |
| Subagents | `.claude/agents/sdlc-{verifier,reviewer,researcher,simplifier}.md` | `.opencode/agents/sdlc-*.md` (`mode: subagent`, `permission` map) |
| Guardrails | hooks merged into `.claude/settings.json` | `.opencode/plugins/sdlc.js` |

The workflows are 15 short skills: `help`, `guide`, `team`, `next`, `status`, `explore`, `intent`, `spec`, `plan`, `build`, `verify`, `review`, `release`, `archive`, `triage`. They pull state, templates and instructions from the CLI at run time (`sdlc status|next|instructions --json`). Generated files are tracked in `openspec/.sdlc/manifest.json`, so `sdlc update` never overwrites a file you edited unless you pass `--force`.

## Version and license records

Everything sdlc writes records the sdlc version and the license the project uses sdlc under (`license` in `openspec/sdlc.yaml`):

| Where | What |
|---|---|
| `openspec/.sdlc/log.jsonl` | append-only project log: setup, gate decisions, verification runs, archives, license changes and hook denials, one JSON line each with `sdlc` and `license` (commit it; `merge=union` keeps branches mergeable). Shell command text is never logged. `sdlc log` prints it. |
| `.sdlc.yaml` of each change | `harness: {sdlc, license}` plus `sdlc`/`license` on every history event, approval, rejection, waiver and verification record |
| change artifacts | one line `<!-- sdlc-provenance: sdlc <version> \| license: <license> \| <url> -->` at the end of the top-level markdown artifacts, written at approval, verification and archive. It is excluded from gate digests, so it never makes an approval stale. Delta specs are never stamped, because their text is merged into the living specs. |
| `verification.md` | a `Harness` line in the evidence block |
| generated agent files | a notice with the version, the license in use and the `Required Notice` (skills, commands, subagents, the OpenCode plugin, `schema.yaml`; not the artifact templates) |
| `sdlc status --markdown`, `--json` outputs | a footer line or a `harness` object |

## CLI

| Command | Purpose |
|---|---|
| `sdlc init [path] [--statusline] [--mcp] [--layout <mode>] [--worktree <path>] [--git-init]` / `update` / `uninstall` | set up, regenerate, remove integrations (planning data is never touched); `--statusline` opts in the Claude Code status line; `--mcp` registers sdlc as an MCP server; `--layout` makes the project AI-ready (in place or in a new worktree); in an agent session they never weaken the guard, and `uninstall` is human-only |
| `sdlc new <id> [--kind --risk --track --source-type --source-ref --skip-specs]` | start a change (an OpenSpec change folder + `.sdlc.yaml`) |
| `sdlc explore <slug> \| list` | create or list optional research notes before intent |
| `sdlc track set <full\|lite> --change <id> [--note <text>]` | human confirmation of the suggested track before plan approval |
| `sdlc defer add \| list \| close` | manage the deferred-work registry |
| `sdlc backlog add \| epic add \| epic edit \| list \| next \| edit \| start \| move \| drop \| done` | manage planned changes in `openspec/backlog.md` (order = priority; `move`/`drop` are human-only) |
| `sdlc import bmad <path> (--change <id> \| --to-backlog) [--dry-run]` | import BMAD planning into an unapproved change, or epics/tickets (or a PRD/SPEC) into the backlog |
| `sdlc status [--change] [--markdown] [--json]` / `sdlc next` | stages, gates, approvals, evidence, who acts next (with `--change`, a stage stepper and task bar); with no active change, the next ready backlog item |
| `sdlc guide [topic[#section]] [--json]` | how sdlc works: short articles (en, ru) the guide workflow answers from; `denials#<rule>` explains a hook denial |
| `sdlc next --me [--json]` / `sdlc approve <gate> --change <id> --preview` | what waits for me, with the commands; what I am about to approve (writes nothing) |
| `sdlc help [topic] [--json]` | catalog of workflows and CLI commands with who runs them (agent or person) |
| `sdlc statusline` | one-line Claude Code status (change · stage · who acts); reads JSON on stdin |
| `sdlc layout check [--json]` / `scaffold [--dry-run] [--json]` / `adapt [--dry-run] [--json]` / `convert [--apply] [--json]` | check layout readiness, create missing documents, map existing paths, or plan and apply conversion |
| `sdlc rework <gate> --change <id> --reason <r> --note <t> [--reset]` | send a change back to a gate's stage with a reason; later approvals stop counting; `--reset` restores the planned files from the gate checkpoint (human-only) |
| `sdlc takeover` / `release-control --change <id> --note <t>` | take a change from the agent and hand it back with a note (human-only) |
| `sdlc team sync \| list \| check [--json]` / `team accept <role>` | the agent team: drafts from the registry, packs and built-ins; roles and their status; vetted skills; a person accepts a role (or `--skill <id>`) |
| `sdlc events list \| flush [--json]` | process events waiting for delivery to the team's server; deliver them now |
| `sdlc release check --change <id> [--json]` | run the release gate's MCP checks without approving |
| `sdlc mcp serve` / `sdlc mcp check [--json]` | sdlc as a read-only MCP server (`init --mcp` registers it); connect to the registry servers and list their tools |
| `sdlc inbox list [--json]` / `inbox done <id>` | MCP check results from runs outside an agent session, for the agent |
| `sdlc review suggest --change <id> [--json]` | propose a reviewer: roles, CODEOWNERS owners first, fewer open reviews, never an author |
| `sdlc trace <change> [--json]` | from intent to evidence: requirements, scenarios, tasks, commits (trailers `SDLC-Change`, `SDLC-Task`), verification and review findings, with the gaps |
| `sdlc adopt [--apply] [--json]` | draft verify commands, protected paths and `roles.yaml` for an existing project; `--apply` writes them (human-only) |
| `sdlc report [--format md\|json\|html] [--since] [--change] [--out]` / `sdlc dashboard [--since] [--change] [--out]` | progress report and self-contained HTML dashboard |
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
| `sdlc log [--change] [--limit]` | project log, with the sdlc version and license of each entry |
| `sdlc license` / `sdlc license set community \| commercial --agreement <id> [--licensee]` | show or record the license the project uses sdlc under (setting it is human-only) |
| `sdlc doctor` | installation health, including whether the declared license fits the project |
| `sdlc hook <event>` | policy dispatcher used by the hooks and the plugin |
| `sdlc plugin build [dir] --marketplace` | render the Claude Code plugin |
| `sdlc openspec <args>` | run the bundled OpenSpec CLI |

Every command except `statusline`, `dashboard`, `hook` and the `openspec` pass-through supports `--json` and returns OpenSpec-style diagnostics (`{severity, code, message, fix}`) on failure.

## Configuration (`openspec/sdlc.yaml`)

```yaml
version: 1
schema: sdlc
cli: sdlc                                  # "npx --no-install sdlc" for a project-local install
locale: ru                                 # optional: language of help, hints and reports (default: system, else en)
tools: [claude, opencode]
gates:
  intent:  { required: true,  approvers: [product-owner] }
  spec:    { required: true,  approvers: [product-owner], high_risk_approvers: [tech-lead] }
  plan:    { required: true,  approvers: [engineer],      high_risk_approvers: [tech-lead] }
  review:  { required: true,  approvers: [code-owner] }
  release: { required: false, approvers: [release-manager] }
  verify:  { required: true }
roles: { code-owner: [lead@example.com] } # optional allow-lists per role (replaced by openspec/roles.yaml)
verify:
  commands:
    - { name: build, run: npm run build }
    - { name: test,  run: npm test }
review:
  passes: [bugs, security, compliance]
  lenses: [adversarial, edge-cases, verification-gaps]
  require_lens_coverage: true
enforcement:
  mode: warn                               # off | warn | block
  require_approved_plan: true
  protected_paths: []
  test_paths: ['**/*.test.*', '**/tests/**']
license:
  type: community                          # community | commercial (set with `sdlc license set`)
log:
  enabled: true                            # openspec/.sdlc/log.jsonl
  hook_decisions: true
```

Project context and per-artifact rules stay where OpenSpec keeps them (`openspec/config.yaml` → `context`, `rules`).

### Language

Help, `Next:` hints, `status`, the init wizard, hook reasons, the report and the dashboard follow the locale: `--locale <code>` on any command, then `SDLC_LOCALE`, then `locale:` in `openspec/sdlc.yaml`, then the system locale (`LC_ALL`, `LC_MESSAGES`, `LANG`, the OS). Without a translation the text is English. Shipped: English and Russian. JSON output, the project log and change records are always English, so agents and CI read the same thing everywhere.

### People and roles (`openspec/roles.yaml`, optional)

People, their emails and signing keys, the roles they hold and the separation rules, versioned in git. With it, the author of a change's code cannot approve its review or release, paired gates need different people, and `signing: warn | required` makes `sdlc approvals verify` check signed approval commits. See [docs/en/08-roles-and-signing.md](docs/en/08-roles-and-signing.md).

### Examples

- **The calculator demo**: `test/e2e-calculator.test.ts` runs every command on a small project and records a transcript; `npm run demo:deck` turns it into a deck (English and Russian). See [docs/en/09-demo-and-automation.md](docs/en/09-demo-and-automation.md).
- **A background process that keeps the dashboard current**: [`scripts/examples/`](scripts/examples/README.md).

## Compatibility with OpenSpec

- Same layout (`openspec/specs`, `openspec/changes`, `openspec/changes/archive`). An SDLC change is an OpenSpec change.
- The `sdlc` schema is a standard OpenSpec schema (`openspec schema validate sdlc` passes), so `/opsx:propose` creates SDLC changes too.
- Harness files live next to OpenSpec's (`openspec/sdlc.yaml`, `.sdlc.yaml`, `verification.md`, `review.md`, `release.md`). OpenSpec ignores them and keeps them when it archives a change.
- Existing projects and `spec-driven` changes are read as they are: gates for missing artifacts are `n/a`.
- Task progress uses OpenSpec's own checkbox rules.

## Development

```bash
npm install            # uses --legacy-peer-deps via .npmrc
npm run compile        # dist/ is build output (not in git); `npm install` and `npm install -g github:…` build it via the prepare script
npm test               # compiles, then runs unit + end-to-end tests (real OpenSpec CLI)
node bin/sdlc.js --help
node bin/sdlc.js plugin build plugin --marketplace   # regenerate the committed plugin
```

## Documentation

Research and design are in [`docs/en/`](docs/en/README.md):
- [The AI-ready project layout and progress reports](docs/en/07-ai-ready-project.md)
- [Roles, separation of duties and signed approvals](docs/en/08-roles-and-signing.md)
- [The calculator demo and keeping the dashboard current](docs/en/09-demo-and-automation.md)
- OpenSpec analysis
- the playbook mapping
- community reviews and other harnesses (Spec Kit, BMAD, Kiro, cc-sdd, superpowers…)
- architecture
- user guide
- which OpenSpec shortcomings to fix where
- licensing

## License

sdlc is dual-licensed.

- **Community License** (free): the [PolyForm Noncommercial License 1.0.0](LICENSES/PolyForm-Noncommercial-1.0.0.md) with the [sdlc Additional Permissions](LICENSES/sdlc-Additional-Permissions.md). Use, modify and share sdlc for any noncommercial purpose, for **open source projects** (complete source public under an OSI-approved license, also when a company maintains them), and for a 30-day evaluation. Keep the `Required Notice` line with every copy.
- **Commercial License** (royalties): every other use, in particular business use on private repositories, internal systems, proprietary products, client work, hosted services and redistribution. See [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

You own what you and your agents create with sdlc (intents, specs, plans, code, records); the provenance lines sdlc writes do not change that. Portions adapted from OpenSpec remain under the MIT License ([NOTICE.md](NOTICE.md)). Contributions need the [CLA](CLA.md) (see [CONTRIBUTING.md](CONTRIBUTING.md)).

Required Notice: Copyright (c) 2026 marin-ai technologies (https://github.com/marin-ai-tech/sdlc)

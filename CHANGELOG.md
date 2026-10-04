# Changelog

All notable changes to sdlc. Versions follow [Semantic Versioning](https://semver.org/); while the major version is 0, a minor version may change behavior.

## 0.6.4 — 2026-10-04

### Added
- **The rest of the CLI follows the locale.** Commander's own messages (missing argument, unknown command or option, "did you mean"), every command's `--help` (titles, the description of every option, `-h` and `-V`) and the key hints of the init wizard's prompts are translated. English output is unchanged; the JSON help catalog stays English.
- CONTRIBUTING.md explains how to add a language: copy `assets/locales/en.json`, translate the values, add the code to `LOCALES` and run the tests, which check completeness and placeholders.

### Fixed
- The Russian catalog no longer leaves English words in its messages (owner, workflow, branch, drift and others); a test keeps it that way.

## 0.6.3 — 2026-10-04

### Added
- **Every command speaks the locale.** Besides help, status, hints, the wizard, hook reasons and reports, the text output of every command, all error messages with their fixes and all warnings now follow `--locale`, `SDLC_LOCALE`, `locale:` in `sdlc.yaml` or the system locale (English and Russian). JSON output and error codes stay English and identical in every locale.
- The demo scenario runs in the deck's language, so the Russian deck shows Russian CLI output.

### Fixed
- `/sdlc:explore`, `/sdlc:intent` and `/sdlc:triage` started without a subject now ask for it instead of inventing one.
- Indexing with codegraph from the init wizard no longer writes `.claude/` into an OpenCode-only project: a bare `codegraph init` asked its own questions and defaulted to Claude Code. The wizard now runs `codegraph install --target <the chosen tools> --location local --yes --init` (index only, `codegraph init --yes`, when no tool is chosen).
- An exploration that pauses for answers or research leaves the note saying where it stopped: open questions go under the new **Open questions** section, unfinished sections are marked `_pending: …_`, and the next run continues from there; without answers the agent continues on recorded assumptions.
- Every workflow talks to the person, and writes notes and artifacts, in their language (or the project's `locale:`), keeping command names, ids and template headings as they are.
- `sdlc doctor` no longer prints Node's DEP0190 deprecation warning on Windows.

## 0.6.2 — 2026-10-04

### Changed
- **The package is now called `sdlc`**, like its command and its repository (`marin-ai-tech/sdlc`). The old name `scdl` pointed every link and install command at a repository that does not exist. Renamed: the npm package, the Claude Code plugin marketplace (`/plugin marketplace add marin-ai-tech/sdlc`, then `/plugin install sdlc@sdlc`; if you added the old marketplace, add the new one and reinstall the plugin), the license names (`sdlc Additional Permissions`, `sdlc Commercial License`, `LICENSES/sdlc-Additional-Permissions.md`) and all links.
- Projects written by `scdl` keep working: records with the old `scdl:` key and the old provenance line are read as before, so approvals do not go stale; new records use `sdlc:`. The `scdl` command still works for one more version and prints a deprecation warning; the hook still denies `scdl approve` and the other human-only commands to agents.

### Fixed
- **Installing works again.** `npm install -g github:marin-ai-tech/sdlc` failed with "tsc is not recognized": npm 11 leaks `-g` into the dependency install it runs to build a git package, which installs the clone globally on top of the real install. Install the latest release instead: `npm install -g https://github.com/marin-ai-tech/sdlc/releases/latest/download/sdlc.tgz`, or from git with the `release` branch, which carries the built code: `npm install -g github:marin-ai-tech/sdlc#release`. A version tag now runs `.github/workflows/release.yml`: tests, the `npm pack` archive attached to the GitHub release (as `sdlc-<version>.tgz` and `sdlc.tgz`), and the `release` branch updated.
- Hints no longer say `npm install -g sdlc` or `npx sdlc`: an unrelated package named `sdlc` is on the npm registry. Project-local installs use `cli: npx --no-install sdlc`.

### Added
- **English and Russian.** Help, `Next:` hints, `sdlc status`, the init wizard, hook reasons, the session context, the Markdown report and the dashboard follow the locale: `--locale <code>`, then `SDLC_LOCALE`, then `locale:` in `openspec/sdlc.yaml`, then the system locale; English when there is no translation. JSON output, the log and change records stay English.
- **Interactive `sdlc init`, like `openspec init`.** Run in a terminal with no flags, it welcomes you, asks for the tools (detected ones preselected), enforcement mode, Claude Code status line, OpenSpec `/opsx` workflows, artifact language and an optional starter `openspec/roles.yaml`, and writes nothing until you confirm the summary. Re-running it offers the current settings. Flags, `--json`, non-terminals and agent sessions never prompt.
- **Interactive `sdlc init` offers the OpenSpec CLI and codegraph.** When either is missing, it asks to install it (OpenSpec pinned to the version sdlc ships, codegraph from npm) and offers to index the project with `codegraph init`; installs run only after a yes, once the settings are written, and a failed install warns with the command to run by hand. Agents, scripts and flag runs never install anything. `sdlc doctor` reports both tools and whether the project is indexed.

## 0.6.1 — 2026-10-01

### Fixed
- `sdlc help` examples are runnable: 13 of them used the word `example` as a gate, id or path (`sdlc roles who example --change example`), three added `--json` to commands that do not have it (`statusline`, `dashboard`, `hook`), and some lacked options the CLI checks at run time (`import bmad`, `defer add`/`close`, `archive`).

### Changed
- The calculator demo shows working with OpenSpec: the change is a plain OpenSpec change (`openspec list`, `status`, `show`), strict validation refuses a delta requirement without a scenario, the `sdlc` schema validates as an OpenSpec schema, and the archived requirement lives in the spec. The deck has three more slides (20).
- The demo team's surnames follow the deck's language (`SDLC_DEMO_PEOPLE`); `npm run demo:deck` runs the scenario once per language, and each deck has its own transcript (`docs/demo/calculator-transcript.en.json`).
- Documentation brought up to date: architecture (roles and signing in the gate model and data model, the full CLI list, which commands have `--json`), README features (AI-ready layout, reports and dashboard, people and roles), the playbook mapping, a CODEOWNERS line for `openspec/roles.yaml`.

## 0.6.0 — 2026-09-30

### Added
- **People and roles in git: `openspec/roles.yaml`** (optional). The file holds:
  - people with their emails and optional SSH signing keys;
  - the roles each person holds;
  - separation rules: the authors of a change's code cannot approve its review or release; listed gate pairs need different people; a per-person gate limit.

  With the file, `sdlc approve` identifies the person by the git email, requires a role the gate accepts, and applies the separation rules. `--by` can no longer record someone else. The approval record gains `person: <id>`. Without the file, behavior is unchanged.
- `sdlc roles who <gate> --change <id>` (who may approve and why others may not), `sdlc roles check`, `sdlc roles migrate` (moves `roles:` from `sdlc.yaml`; human-only). Agents cannot edit `roles.yaml`: the hook and the plugin deny it.
- **Signed approvals: `sdlc approvals verify [--mode off|warn|required]`**:
  - every approval must arrive in a commit signed (SSH) by the key of the person who approved;
  - every change to `roles.yaml` must be signed by a maintainer of the version before it.

  `warn` reports problems; `required` fails, for CI.
- **The calculator demo**: `test/e2e-calculator.test.ts` runs every CLI command on a small project with three people and agents and records a transcript. `npm run demo:deck` turns the transcript into a PowerPoint deck in English and Russian (`scripts/demo/`).
- **Example background process** `scripts/examples/dashboard-watch.mjs`: rebuilds the dashboard page when `openspec/` changes and can serve it on localhost with an auto-refresh. Examples run it as a Windows task, a systemd or launchd service, or a CI step.

## 0.5.0 — 2026-09-30

### Added
- **`sdlc help [topic] [--json]`** and the **`/sdlc:help`** workflow: every workflow with its invocation in Claude Code and OpenCode, every CLI command with usage, example and who runs it (an agent or a person).
- **`Next:` hints**: commands that change state (`new`, `approve`, `reject`, `waive`, `verify`, `archive`, `track set`, `defer add`, `backlog start`, `import`) end with who acts next and how — the exact command when a person must act — and add `next` to their JSON. The session-start context names the next ready backlog item when no change is active.
- **Questions with choices and todo lists in the tools' own UI**: workflows ask through Claude Code's `AskUserQuestion` or OpenCode's `question` tool with 2–4 choices; `/sdlc:build` mirrors `tasks.md` into the todo list (TodoWrite / `todowrite`); `/sdlc:status`, `/sdlc:next` and `/sdlc:help` inline live CLI output. Tool names are rendered per tool, never mixed.
- **Progress drawing**: a stage stepper and a task bar in `sdlc status --change`, a bar per epic in `sdlc backlog list`, Mermaid diagrams (lifecycle per change, epic progress) in the Markdown report with sanitized labels.
- **Claude Code status line**: `sdlc statusline` (one line: change · stage · who acts), opt-in with `sdlc init --statusline`; a user-defined status line is never replaced.

### Changed
- The workflow contract states that an answer in chat is never an approval: human decisions are commands the person runs in their own terminal.
- One list of human-only commands drives both `sdlc help` and the hook; the hook now also denies `sdlc license set` from agents.

## 0.4.0 — 2026-09-30

### Added
- **Backlog in the repository**: `openspec/backlog.md` lists planned changes (one item = one future OpenSpec change) grouped by epics; the order in the file is the priority; ids are never reused. An item is ready when it has an outcome, at least one acceptance criterion and every dependency is done — readiness is computed, never stored.
- `sdlc backlog add | epic add | list | next | start | move | drop | done`. `start` turns a ready item into a change (kind, risk and source from the item, track rules unchanged) with a draft `intent.md`; the intent gate still needs the product owner. `move` and `drop` are human decisions: refused in agent sessions and denied by the hook.
- Archiving a change closes its backlog item (and a deferred-work item the item came from), which unblocks the items that depend on it.
- `sdlc next` with no active change proposes the first ready backlog item.
- `sdlc import bmad <path> --to-backlog [--dry-run]`: BMAD-METHOD epics and tickets (`tickets.toml`, epic and story files) or a PRD/SPEC become backlog epics and items with their acceptance criteria and dependencies.
- The report and the dashboard show the backlog: counts, progress per epic, what is next and what is blocked.

### Changed
- `/sdlc:explore` hands a proceeding idea to the backlog; `/sdlc:next` starts the proposed backlog item.

## 0.3.0 — 2026-09-30

### Added
- **`/sdlc:explore`** and `sdlc explore <slug> | list`: an optional step before intent that researches an idea and pressure-tests it through four lenses (user, technical, cost, risk) and ends with proceed / reshape / stop. Notes live in `openspec/explorations/`; a change can name one as its source (`--source-type exploration`).
- **Review lenses with recorded coverage**: besides the passes from `REVIEW.md`, reviews run the lenses adversarial, edge-cases and verification-gaps (`review.passes`, `review.lenses` in `openspec/sdlc.yaml`). `review.md` records a `## Coverage` line per pass and lens — a count of findings or `none found — checked: …`. `sdlc review check` and the review gate block on missing or unevidenced coverage when `review.require_lens_coverage` is true (the default for new projects).
- **Track suggestion with human confirmation**: `sdlc new` suggests a track from kind and risk. `full` is applied directly; `lite` is only suggested (also when an agent passes `--track lite`) until a person runs `sdlc track set lite --change <id>`. `track set` is refused in agent sessions and denied by the hook, and not allowed after the plan is approved.
- **Deferred-work registry** `openspec/deferred-work.md` with `sdlc defer add | list | close`. A review finding with status `deferred (D<n>)` must point at a registry item (`sdlc review check` blocks otherwise). Open items appear in `sdlc report` and the dashboard.
- **`sdlc import bmad <path> --change <id> [--dry-run]`**: BMAD-METHOD PRD, SPEC and architecture spine become a draft OpenSpec change (intent, proposal, delta specs with traced CAP/FR ids, design) that passes `sdlc validate`; sources are kept in `sources/bmad/`, BMAD "Deferred" items go to the registry, nothing is approved.

### Changed
- An agent can no longer create a `lite` change by itself: its `--track lite` becomes a suggestion for a person to confirm.
- New projects require review coverage of every pass and lens. Existing projects keep working and get warnings until they set `review.require_lens_coverage: true`.

## 0.2.0 — 2026-09-30

### Added
- **AI-ready project layout** (`docs/en/07-ai-ready-project.md`): ten document roles with canonical paths and common aliases — `AGENTS.md` as the main agent guide, a thin `CLAUDE.md` that imports it, `README.md`, `REVIEW.md`, `docs/architecture.md`, `conventions.md`, `glossary.md`, `runbook.md`, `security.md` and `docs/decisions/`. Templates for every role in `assets/project/ai-ready/`.
- `sdlc layout check`: readiness per role (canonical, mapped, alias, missing), `ready` and a 0–100 score.
- `sdlc layout scaffold`: creates the missing documents from templates; never overwrites.
- `sdlc layout adapt`: adaptation mode — records documents found at aliases in the new `layout:` section of `openspec/sdlc.yaml` and creates only what is missing; moves nothing.
- `sdlc layout convert`: conversion mode — a dry-run plan by default; `--apply` converts in a new git worktree on a new branch and commits there, leaving the main working copy untouched; `--in-place` converts the current working copy. Moves use `git mv`; relative Markdown links are rewritten; pinned paths and `openspec/` are never moved. Agent sessions may plan but not apply in worktree mode.
- `sdlc report --format md|json|html [--since] [--change] [--out]`: progress report with stages, blocked changes, changes awaiting a person, lead-time medians, verification first-pass rate, project-log events and layout readiness.
- `sdlc dashboard`: the same model as one self-contained HTML page (no network, light and dark themes, responsive).

### Changed
- Lead-time metrics are shared by `sdlc audit` and the report.
- `dist/` is built on install by the `prepare` script and is no longer expected in git.

### Fixed
- Every file copied from the package (plugin legal files, the OpenSpec schema and templates) is emitted with LF; `.gitattributes` enforces LF checkouts.

## 0.1.0

Initial release: lifecycle stages and gates on top of OpenSpec, content-bound approvals, separation of duties, verification evidence, multi-pass review, deterministic guardrails for Claude Code and OpenCode, audit and metrics.

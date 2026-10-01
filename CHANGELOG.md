# Changelog

All notable changes to scdl. Versions follow [Semantic Versioning](https://semver.org/); while the major version is 0, a minor version may change behavior.

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

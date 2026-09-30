# Changelog

All notable changes to scdl. Versions follow [Semantic Versioning](https://semver.org/); while the major version is 0, a minor version may change behavior.

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

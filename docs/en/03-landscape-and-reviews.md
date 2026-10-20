# OpenSpec reviews and the spec-driven landscape

Use this research to compare OpenSpec with other spec-driven tools. The review keeps its sources and dates so you
can assess each claim. It also explains which ideas inform sdlc.

## On this page

- [OpenSpec reviews](#-openspec-reviews)
- [Other implementations](#-other-implementations)
- [Requirements from the reviews](#-requirements-from-the-reviews)
- [Terms](#-terms)
- [See also](#-see-also)

## 🧭 OpenSpec reviews

The research uses these sources:

- OpenSpec GitHub issues and discussions, plus its CHANGELOG;
- comparative reviews by Hashrocket and Thoughtworks Radar;
- spec-compare and the Uvik, Telin and Isenberg benchmarks;
- posts about OpenSpec with OpenCode.

The GitHub material was read in full. Hacker News, Reddit, dev.to and Medium articles could not be reached through
the proxy. Claims known only from search snippets carry **[S]**.

### What people praise

Reviewers praise these aspects of OpenSpec:

- **Lightweight.** For the same stage, OpenSpec produces ≈250 lines in 3 files; Spec Kit produces ≈800 lines in
  7+ files [S, Hashrocket]. Thoughtworks Radar (April 2026) rated its "fluid, minimal workflow" as "Assess" [S].
- **Deltas for brownfield code.** One change can cover several capabilities. Living specs grow on archive. The
  maintainers deliberately do not require a baseline spec up front (#199).
- **Token savings.** Independent benchmarks report about half as many tokens as Spec Kit and the best share of
  merged tickets [S].
- **Tool independence.** Plain Markdown in git, 30+ agents, no MCP and no API keys.
- **Context resilience and maintenance.** Changes survive context resets, and maintenance is active.

- **Drift between specs and code.** Discussion #169 (since 2025) says reconciliation "relies on the developer
  remembering"; #880 asks for a code-to-spec check. A Hacker News snippet says "keeps drifting" [S].
- **Ceremony for small tasks.** Bug fixes, refactorings and edits to 1–2 files gain nothing [S, Uvik]. Some teams
  dropped OpenSpec [S, RevComm, Talk Think Do]. Partial answers are `skip_specs` and the `core` profile.
- **Commands and syntax.** Agents use `/opsx:x`, `/opsx-x`, `$openspec-x` or `@opsx-x` (#611, #1263, #1139,
  #1471, #1307). Renames add to the complexity.
- **Prompt-only phase boundaries.** Explore or plan started writing code (#1577 — Copilot, #405 — OpenCode, #869).
- **Silent data loss when merging deltas.** OpenSpec releases `1.6`–`1.13` include many fixes. Issue #1918
   (a MODIFIED with a nonexistent header becomes an ADD) was closed as "not planned".
- **Parallel changes.** Overlaps are invisible until the second archive (#1669). A MODIFIED delta has no base
  requirement version.
- **Scale.** Concerns include monorepos (#176), a flat spec namespace (#536) and Stores in beta (#896, #1714).
- **Review difficulty.** MODIFIED repeats the whole requirement. Proposal, design and task contradictions are not
  checked (#783).
- **Visibility.** Progress and approvals are not visible outside the repository [S, Talk Think Do].
- **Testing and tokens.** There is no testing step or TDD (#900, #1760). One user says it "blows through" the
  Claude Pro limit (#749).

### Claude Code specifics
- The reference integration. Commands in a subdirectory disappeared after a Claude Code update in one case (#1076).
  That is why "both" (skills + commands) is more reliable.
- In headless mode (`claude -p`), permissions could prevent artifact writes (#1642). A hard-coded `openspec` binary
  breaks projects that use a local install through `npx` (#1624).
- Claude-specific tool names (`AskUserQuestion`, `TodoWrite`) in shared templates caused problems for other agents.
  OpenSpec `1.7` fixed this.
- Users combine OpenSpec with obra/superpowers and ask for OpenSpec to be released as a Claude Code plugin (#667, #780).

### OpenCode specifics
- Past adapter bugs include a hard-coded `agent: build` (#334) and a `command` directory instead of `commands`
  (#748). Other problems were a colon instead of a hyphen in the name and lost arguments before `$ARGUMENTS` (#1664).
- OpenCode's plan mode wrote files and started implementing without `apply` (#405).
- The community writes add-on plugins. Examples include an "Architect" mode allowing writes only to `openspec/**`
  and native CLI tools.

## 🧭 Other implementations

This table compares the tools' phases, artifacts, integrations and gates. Tool release numbers are source facts.

### Tools compared

Each tool combines phases, artifacts and controls differently:

- **GitHub Spec Kit:** constitution → specify → (clarify) → plan → tasks → (analyze) → implement ⇄ converge.
  Artifacts are `specs/NNN-x/{spec,plan,tasks,research,...}.md` and `constitution.md`. Claude Code uses
  `.claude/skills/speckit-*` and hooks in settings.json. OpenCode uses `.opencode/commands/speckit.*.md` and a
  generated `speckit-events.ts` plugin. Gates use precondition scripts and prompts.
- **BMAD-METHOD** (v6.12, Sept 2026): clarify → plan → build & verify → learn & adjust. `bmad-build` chooses depth
  after investigating the change. Artifacts include a product brief or PRFAQ, PRD, `SPEC.md`, architecture,
  tickets, `plan-<slug>.md` and `deferred-work.md`; `AGENTS.md` provides project context. Claude Code uses skills
  (Skills CLI) or a plugin marketplace; OpenCode uses `.agents/skills`. A person approves the plan in the session.
  Multi-lens review records a verdict per finding. Gates are prompt-driven, without hooks or CLI checks.
- **Kiro** (AWS): requirements (EARS) → design → tasks. It keeps `.kiro/specs/*` and steering, uses its own IDE and
  handles approvals in the UI. There is no OpenCode integration listed.
- **cc-sdd:** Kiro-style flow with 17 skills and `.kiro/specs/*/spec.json` approvals. Claude Code uses skills;
  OpenCode uses skills and agents. JSON approvals are trust-based.
- **Agent OS v3:** standards and shape-spec in plan mode, with `agent-os/{standards,product,specs}`. Claude Code uses
  commands. The gate is plan mode; no OpenCode integration is listed.
- **obra/superpowers:** brainstorm → worktree → plan → subagents/TDD → review → finish. It uses
  `docs/superpowers/{specs,plans}`. Claude Code gets a plugin and SessionStart hook; OpenCode gets an npm plugin.
  Gates are behavioral, with a reviewer per task.
- **Anthropic plugins** (feature-dev, code-review, pr-review-toolkit): seven feature-dev phases and multi-agent
  review. Claude Code uses plugins; clarification steps and Stop loops act as gates. No OpenCode integration is listed.
- **Task Master:** PRD → task graph in `.taskmaster/tasks/tasks.json`. Claude Code uses a plugin and MCP; OpenCode
  uses MCP in `opencode.json`. Task statuses track progress.
- **ospec-workflow:** a wrapper around OpenSpec with a routed lifecycle, `openspec/` and `state.yaml`. Claude Code
  uses a plugin. OpenCode uses agents, commands and a JS bridge for hooks. Controls include `state.yaml`, a quality
  gate and hooks.
- **Tessl:** gather → spec → approve → implement → verify. Specs live in `specs/*.spec.md` with `targets` and
  `[@test]`. Both agent tools use tessl; rules and evals provide controls.

What was taken from them (and what to avoid):

- **One template source**, rendered for each tool, follows Spec Kit and ospec-workflow. Separate per-agent trees in
  cc-sdd drift apart over time.
- **A manifest of installed files with hashes**, so that only untouched files are removed or updated (Spec Kit).
- **A single hook dispatcher** follows Spec Kit and ospec-workflow. Claude Code uses settings.json. OpenCode uses a
  generated JS plugin with `tool.execute.before/after` and `experimental.chat.system.transform`.
- **Approvals in a state file** follow cc-sdd `spec.json` and ospec-workflow `state.yaml`. Without hooks, those
  approvals remain "trust-based"; the harness adds deterministic checks.
- **Routing by change size** follows ospec-workflow's hotfix/lite/standard paths. BMAD chooses depth after examining
  the change. The harness suggests a track and asks a person to confirm it with `sdlc track set`.
- **Thinking tools** from BMAD include brainstorming, PRFAQ, multi-persona pressure tests and parallel research.
  They inform optional `/sdlc:explore` before `intent.md`. BMAD has no deterministic gates, content-bound approvals
  or recorded verification evidence; the two approaches complement each other.
- **Short subagent reports** avoid the context bloat that led Spec Kit to remove `context: fork` for large reports.

BMAD informs these sdlc features:

- Optional `/sdlc:explore` pressure tests and review lenses with checked coverage.
- Track suggestions confirmed by a person and a deferred-work registry.
- `sdlc import bmad` for planning artifacts.
- A repository backlog (`openspec/backlog.md`) and `sdlc import bmad --to-backlog` for tickets and epics.

## ✅ Requirements from the reviews

These findings guide the harness design:

- Drive OpenSpec through its JSON contract without rewriting the merge. Pin OpenSpec to version 1.13.2 or later.
- Check delta targets before the merge: MODIFIED/REMOVED/RENAMED targets must exist. ADDED must not collide with an
  existing requirement.
- Show requirement overlaps and base drift after approval for parallel changes.
- Check plan against diff, scenarios against evidence and verification freshness.
- Use the lite track and `skip_specs` for a process sized to the change.
- Enforce phase boundaries with permissions and hooks, as well as prompts.
- Use `$ARGUMENTS` instead of `$1` (Claude numbers from 0, OpenCode from 1). For OpenCode, omit `agent:` and use the
  correct `permission` map. Write skills to one place.
- Keep user edits outside generated files with a dedicated config and manifest.
- Provide a markdown report for PRs, audit and metrics outside the repository.

## 📚 Terms

The [glossary](glossary.md) defines [delta](glossary.md#-ad), [living spec](glossary.md#-ip),
[gate](glossary.md#-eh) and [track](glossary.md#-rw).

## 📚 See also

- [OpenSpec analysis](01-openspec-analysis.md) explains the underlying model.
- [OpenSpec upstream](06-openspec-upstream.md) lists safeguards and upstream proposals.

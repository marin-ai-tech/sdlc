# 3. Reviews of OpenSpec and other spec-driven / SDLC implementations

## 3.1. Reviews of OpenSpec

Sources: OpenSpec GitHub issues/discussions, the CHANGELOG, comparative reviews (Hashrocket, Thoughtworks Radar, spec-compare, Uvik/Telin/Isenberg benchmarks), posts about using OpenSpec with OpenCode. The GitHub material was read in full. Articles from Hacker News, Reddit, dev.to and Medium could not be reached through the proxy, so their content is known only from search snippets. Such claims are marked **[S]**.

### What people praise
1. **Lightweight.** For the same stage, OpenSpec produces ≈250 lines in 3 files, while Spec Kit produces ≈800 lines in 7+ files [S, Hashrocket]. Thoughtworks Radar (April 2026): "Assess", for its "fluid, minimal workflow" [S].
2. **Deltas for brownfield code.** One change can carry deltas for several capabilities at once, and living specs grow as changes are archived. The maintainers deliberately do not require capturing a baseline spec up front (#199).
3. **Token savings.** In independent benchmarks, OpenSpec uses about half as many tokens as Spec Kit and had the best share of merged tickets [S].
4. **Tool independence.** Plain Markdown in git, 30+ agents, no MCP and no API keys.
5. **Survives context resets**, very active maintenance.

### What people complain about
1. **Drift between specs and code** is the number one complaint. Discussion #169 (since 2025): reconciliation "relies on the developer remembering"; #880 asks for a check of code against the main specs. [S] on HN: "keeps drifting".
2. **Too much ceremony for small tasks.** Bug fixes, refactorings and edits to 1–2 files gain nothing [S, Uvik]. Some teams dropped OpenSpec [S, RevComm, Talk Think Do]. OpenSpec's partial answers are `skip_specs` and the `core` profile.
3. **Many commands, renames and different invocation syntax per agent:** `/opsx:x`, `/opsx-x`, `$openspec-x`, `@opsx-x` (#611, #1263, #1139, #1471, #1307).
4. **Phase boundaries rely only on prompt text.** Explore or plan started writing code (#1577 — Copilot, #405 — OpenCode, #869).
5. **Silent data loss when merging deltas.** Many fixes in 1.6–1.13. #1918 (a MODIFIED with a nonexistent header is applied as an ADD) was closed as "not planned".
6. **Parallel changes.** Overlaps are invisible until the second change is archived (#1669), and a MODIFIED does not record which version of the requirement it was written against.
7. **Scale:** monorepos (#176), a flat spec namespace (#536), Stores in beta (#896, #1714).
8. **Hard to review:** a MODIFIED repeats the whole requirement. Contradictions between proposal, design and tasks are not checked (#783).
9. **Invisible to non-technical people** [S, Talk Think Do]: progress and approvals are not visible outside the repository.
10. **No testing step and no TDD** (#900, #1760). Tokens: "blows through" the Claude Pro limit (#749).

### Claude Code specifics
- The reference integration. In one case, commands in a subdirectory disappeared after a Claude Code update (#1076). That is why "both" (skills + commands) is more reliable.
- In headless mode (`claude -p`), artifacts could fail to be written because of permissions (#1642). A hard-coded `openspec` binary breaks projects that use a local install through `npx` (#1624).
- Claude-specific tool names (`AskUserQuestion`, `TodoWrite`) in shared templates caused problems for other agents (fixed in 1.7).
- Users combine OpenSpec with obra/superpowers and ask for OpenSpec to be released as a Claude Code plugin (#667, #780).

### OpenCode specifics
- Past adapter bugs: a hard-coded `agent: build` (#334), a `command` directory instead of `commands` (#748), a colon instead of a hyphen in the name, lost arguments before `$ARGUMENTS` was adopted (#1664).
- OpenCode's plan mode wrote files and started implementing without `apply` (#405).
- The community writes add-on plugins: for example, an "Architect" mode that allows writes only to `openspec/**`, and native CLI tools.

## 3.2. Other implementations

| Harness | Phase model | Artifacts | Claude Code | OpenCode | Gates |
|---|---|---|---|---|---|
| **GitHub Spec Kit** | constitution → specify → (clarify) → plan → tasks → (analyze) → implement ⇄ converge | `specs/NNN-x/{spec,plan,tasks,research,...}.md`, `constitution.md` | `.claude/skills/speckit-*`, hooks in settings.json | `.opencode/commands/speckit.*.md` + a generated `speckit-events.ts` plugin | precondition scripts, prompts |
| **BMAD-METHOD** (v6.12, Sept 2026) | clarify → plan → build & verify → learn & adjust; the depth is chosen by `bmad-build` after investigating the change | product brief / PRFAQ, PRD, `SPEC.md`, architecture, tickets, `plan-<slug>.md`, `deferred-work.md`, `AGENTS.md` as project context | skills (Skills CLI) or a plugin marketplace | skills in `.agents/skills` | human plan approval in the session; independent multi-lens review with a logged verdict per finding; prompt-driven, no hooks or CLI checks |
| **Kiro** (AWS) | requirements (EARS) → design → tasks | `.kiro/specs/*` + steering | its own IDE | — | approvals in the UI |
| **cc-sdd** | Kiro style, 17 skills | `.kiro/specs/*/spec.json` with approvals | skills | skills/agents | approvals in JSON (trust-based) |
| **Agent OS v3** | standards + shape-spec in plan mode | `agent-os/{standards,product,specs}` | commands | — | plan mode |
| **obra/superpowers** | brainstorm → worktree → plan → subagents/TDD → review → finish | `docs/superpowers/{specs,plans}` | plugin + SessionStart hook | npm plugin | behavioral; a reviewer per task |
| **Anthropic plugins** (feature-dev, code-review, pr-review-toolkit) | 7 feature-dev phases; multi-agent review | — | plugins | — | clarification steps, Stop loops |
| **Task Master** | PRD → task graph | `.taskmaster/tasks/tasks.json` | plugin + MCP | MCP in `opencode.json` | task statuses |
| **ospec-workflow** (a wrapper around OpenSpec) | routed OpenSpec lifecycle | `openspec/` + `state.yaml` | plugin | agents, commands, JS bridge for hooks | `state.yaml`, quality gate, hooks |
| **Tessl** | gather → spec → approve → implement → verify | `specs/*.spec.md` (`targets`, `[@test]`) | via tessl | via tessl | rules + evals |

What was taken from them (and what to avoid):

- **One template source, rendered for each tool** — as in Spec Kit and ospec-workflow. In cc-sdd, separate per-agent template trees drift apart over time.
- **A manifest of installed files with hashes**, so that only untouched files are removed or updated (Spec Kit).
- **A single hook dispatcher** for Claude Code (settings.json) and OpenCode (a generated JS plugin: `tool.execute.before/after`, `experimental.chat.system.transform`) — Spec Kit, ospec-workflow.
- **Approvals in a state file, not in the chat** (cc-sdd `spec.json`, ospec-workflow `state.yaml`). But without hooks this remains "trust-based", which is why the harness has deterministic checks.
- **Routing by change size** (ospec-workflow: hotfix/lite/standard) — hence the lite track. BMAD lets the build step pick the depth after investigating the change; the harness suggests a track and keeps confirmation with a person (`sdlc track set`).
- **Upstream thinking tools** (BMAD: brainstorming, PRFAQ, multi-persona pressure tests, parallel research) informed optional `/sdlc:explore` before `intent.md`. BMAD in turn has no deterministic gates, content-bound approvals or recorded verification evidence, so the two combine rather than compete.
- Spec Kit removed `context: fork` for large reports because of context bloat, so the harness subagents return short reports.

In 0.3.0 BMAD influenced optional `/sdlc:explore` pressure tests, review lenses with checked coverage, track suggestions confirmed by a person, a deferred-work registry, and `sdlc import bmad` for planning artifacts.
In 0.4.0 BMAD's tickets and epics idea became the repository backlog (`openspec/backlog.md`) with `sdlc import bmad --to-backlog`.

## 3.3. Harness requirements derived from the reviews

1. Drive OpenSpec only through its JSON contract and do not rewrite the merge. Pin OpenSpec to version 1.13.2 or later.
2. Check delta targets before the merge: MODIFIED/REMOVED/RENAMED targets must exist, and ADDED must not collide with an existing requirement.
3. Show parallel changes explicitly: requirement overlaps and base drift after approval.
4. Make drift checks a first-class step: plan against diff, scenarios against evidence, verification freshness.
5. Right-sized process: the lite track and `skip_specs`.
6. Enforce phase boundaries with permissions and hooks, not only with the prompt.
7. Portability: `$ARGUMENTS` instead of `$1` (Claude numbers from 0, OpenCode from 1). For OpenCode: no `agent:` and a correct `permission` map. Write skills to one place.
8. Keep user edits outside generated files (a dedicated config, a manifest).
9. Visibility outside the repository: a markdown report for PRs, audit, metrics.

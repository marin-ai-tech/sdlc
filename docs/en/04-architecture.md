# 4. Architecture of the `sdlc` harness (sdlc)

## 4.1. The idea in one paragraph

**OpenSpec is the specification subsystem, and SDLC is the process layer around it.** All spec operations (creating a change, artifact instructions, validation, delta merge) are performed by unmodified OpenSpec (the `@fission-ai/openspec` dependency, ≥ 1.13.2) through its documented JSON contract. On top of this, the harness adds the stages of the Anthropic playbook, gates with human approvals, verification evidence, review, release gates, audit and deterministic enforcement, identically for Claude Code and OpenCode.

```
┌──────────────────────────── agents ─────────────────────────────┐
│ Claude Code: skills, /sdlc:* commands, subagents, hooks         │
│ OpenCode:    /sdlc-* commands, subagents, plugin .opencode/…    │
└──────────────┬────────────────────────────────┬─────────────────┘
               │ call the CLI (--json)          │ sdlc hook <event>
┌──────────────▼────────────────────────────────▼─────────────────┐
│ sdlc CLI: lifecycle · gates · verify · review · policy · audit  │
│   ─ .sdlc.yaml (approvals, evidence, history)                   │
│   ─ openspec/sdlc.yaml (gates, roles, checks, enforcement)      │
└──────────────┬──────────────────────────────────────────────────┘
               │ new change · instructions · validate · archive
┌──────────────▼──────────────────────────────────────────────────┐
│ OpenSpec (unmodified): sdlc schema, deltas, living specs        │
└─────────────────────────────────────────────────────────────────┘
```

## 4.2. Compatibility with OpenSpec: how it is achieved

1. **The same `openspec/` layout.** An SDLC change is a regular OpenSpec change. `openspec list/show/status/validate/archive` work with it as with a native change.
2. **Its own `sdlc` schema, not a fork.** `openspec/schemas/sdlc/` (copied by `sdlc init`) is a standard OpenSpec schema: `intent → proposal → specs + design → plan → tasks`, `apply.tracks: tasks.md`. The instructions for proposal, specs, design and tasks are taken from `spec-driven` and extended. That is why `/opsx:propose` also creates SDLC changes when `sdlc` is selected as the default schema.
3. **Its own files, only next to OpenSpec's files:** `openspec/sdlc.yaml` (OpenSpec does not read it), `.sdlc.yaml`, and the `verification.md`, `review.md`, `release.md` records in the change folder. OpenSpec ignores them and moves them into the archive.
4. **Its own namespace in the agents:** `sdlc-*` skills, `/sdlc:*` and `/sdlc-*` commands, `sdlc-*` subagents. `openspec update` touches only `openspec-*`/`opsx*`, so `/opsx:*` can be installed alongside (`sdlc init --opsx`).
5. **Existing OpenSpec projects:** `sdlc init` does not change the default schema. Changes on `spec-driven` are read correctly: the `intent` gate is marked `n/a`, and the `plan` gate covers only `tasks`.
6. **The same semantics:** task progress is counted with the same regex as in OpenSpec; artifact statuses are computed from the presence of files, in the same DAG order.

## 4.3. Data model

| File | Owner | Contents |
|---|---|---|
| `openspec/config.yaml` | OpenSpec | default schema, `context`, `rules`; the harness respects them and passes them into the instructions |
| `openspec/sdlc.yaml` | harness | gates, roles, verification commands, review policy, release commands, enforcement, `cli`, `tools` |
| `openspec/explorations/<slug>.md` | agent + people | optional research and pressure test before intent; a change cites it with `--source-type exploration --source-ref openspec/explorations/<slug>.md` |
| `openspec/deferred-work.md` | team | registry of deferred decisions and findings (`D<n>`) |
| `openspec/roles.yaml` | people (maintainers) | optional: people (emails, SSH signing keys), roles, separation rules, signing mode; agents cannot edit it |
| `openspec/backlog.md` | people + CLI (agents only through the CLI; the hook denies their direct edits) | ordered backlog of planned changes: epics `E<n>` and items `B<n>` (one item = one future OpenSpec change); ids never reused; file order is priority; readiness is computed (outcome, acceptance, dependencies done), never stored |
| `openspec/changes/<id>/sources/bmad/` | importer | retained BMAD source artifacts for an imported change |
| `openspec/schemas/sdlc/**` | harness → OpenSpec | schema and artifact templates |
| `openspec/changes/<id>/{intent,proposal,design,plan,tasks}.md`, `specs/**` | agent + people | artifacts (OpenSpec format) |
| `openspec/changes/<id>/.sdlc.yaml` | **CLI only** | kind, risk, track, `track_suggestion`, source, approvals with digests (and `person` when `roles.yaml` exists), verify result, event history |
| `…/verification.md` | CLI + verifier | automatic evidence block (generated) + behavioral table by scenario |
| `…/review.md` | reviewer | findings `### F<n> [severity][pass] …` with statuses and `## Coverage` for passes and lenses |
| `…/release.md` | agent | changelog, rollout per environment, control bands, rollback |
| `openspec/.sdlc/manifest.json` | harness | sha256 of the generated files (edits by people are not overwritten), the sdlc version and the license they were created under |
| `openspec/.sdlc/log.jsonl` | **CLI only** | project log: setup, gate decisions, verify runs, archives, license changes, hook denials; each line has `sdlc` (the version) and `license` |
| `REVIEW.md` | team | review policy (created once) |

The stage **is not stored anywhere**: it is computed each time from the artifacts and the gate records. So a manual file edit or a `git revert` cannot put the "current stage" out of sync.

## 4.4. Gates

| Gate | Stage | What it covers | Who approves (default) | When it goes stale |
|---|---|---|---|---|
| `intent` | Plan | `intent.md` | product-owner | intent.md changed |
| `spec` | Design | `proposal.md`, `specs/**`, `design.md` | product-owner (+ tech-lead with `risk: high`) | any of them changed |
| `plan` | Build | `plan.md`, `tasks.md` (ignoring checkboxes) | engineer (+ tech-lead with `risk: high`) | the plan or the task list changed |
| `verify` | Test | automatic: all required checks passed, all tasks closed | — (`waive` with a reason is allowed) | the worktree content changed |
| `review` | Deploy | `review.md` + code; pass/lens coverage and deferred links | code-owner; blocked by open `important` findings, missing required coverage or unlinked deferrals | the code or review.md changed |
| `release` | Deploy | `release.md` + code | release-manager (optional by default) | the code changed |

Mechanics:
- **Approval is bound to content.** `.sdlc.yaml` records the role, who (git identity), when, and the **sha256 digest** of the covered files. Any edit → status `stale` → a new approval is needed. Checkboxes in `tasks.md` are normalized: progress does not make the plan stale.
- **The worktree fingerprint for verify, review and release** is the git tree id of all files (tracked + untracked, excluding ignored files and `openspec/`). It is computed in a temporary index and does not depend on commits: committing verified code does not make the verification stale, while any change to the content does.
- **Separation of duties: agents.** `approve`, `reject`, `waive`, `track set`, `tests unlock`, `archive --force`, `license set`, `backlog move`, `backlog drop` and `roles migrate` refuse to run in an agent session (`CLAUDECODE=1`, `OPENCODE=1`/`AGENT=1`, `SDLC_AGENT`). Hooks also stop the agent from calling the commands in `HUMAN_COMMANDS` and from editing `.sdlc.yaml`, `openspec/roles.yaml` and the project log `openspec/.sdlc/log.jsonl`. Backlog priority and dropping an item are human product decisions.
- **Separation of duties: people.** Without `openspec/roles.yaml`, `roles.<role>: [emails]` in sdlc.yaml limits the set of approvers, and without a list any person with a git identity can approve (convenient for small teams). With the file (`src/core/roles.ts`), the git email names a person, the gate needs one of that person's roles, and `checkApproval` applies the separation rules against the change's recorded approvals and its code authors (`changeAuthors`: commit authors and `Co-authored-by` since the review base, files outside `openspec/`). `sdlc approvals verify` (`src/commands/approvals.ts`) finds the commit that introduced each approval record (`git log -S<timestamp>`) and checks its SSH signature against an `allowed_signers` file built from the people's keys; `roles.yaml` commits are checked against the maintainers of the previous version. The hook denies agent writes to `roles.yaml`. See [8. Roles, separation of duties and signed approvals](08-roles-and-signing.md).
- **Tracks:** `full` (all gates) and `lite` (intent and spec are optional, the change starts with the plan) for bug fixes, refactorings and minor work.
- **Base drift:** on spec approval, the digests of the main specs that the change modifies are recorded. If another change has modified them in the meantime, `status` warns.

`sdlc new` records a `track_suggestion`; a person confirms or changes it with `sdlc track set <full|lite> --change <id>` before plan approval. Agents are refused by the CLI and hook. `review.passes` and `review.lenses` define required perspectives. `sdlc review check` checks `## Coverage` counts and evidence for zero findings; new projects require coverage, while existing projects warn until `review.require_lens_coverage: true` is set. A `deferred (D<n>)` finding must link to an open item in `openspec/deferred-work.md`.

With no active change, `sdlc next` proposes the next ready backlog item (`sdlc backlog start <B-id>`). `sdlc backlog start` creates the OpenSpec change (source `backlog` / `B<n>`) and a draft `intent.md`. When that change is archived, the linked backlog item is marked `done`.

## 4.5. Deterministic enforcement (hooks and plugin)

One engine (`src/core/policy.ts`) and one dispatcher (`sdlc hook pre-tool | session-start | stop`):

| Rule | Class | Behavior |
|---|---|---|
| Code cannot be written without an approved plan (`require_approved_plan`) | process | `warn`: a reminder to the agent once per session; `block`: deny |
| Protected paths (`protected_paths`) | hard | deny |
| Tests locked (`sdlc tests lock` during a bug fix) | hard | deny edits to `test_paths` |
| Agent approves a gate / edits `.sdlc.yaml`, `openspec/roles.yaml` or the project log | hard | deny |
| Production release without authorization (`release.commands`) | hard | deny until there is a `release` approval or `SDLC_RELEASE_APPROVAL` |
| Stopping without fresh verification (`verify_before_stop`) | optional | Claude Code: `Stop → decision: block` |
| Session context | — | Claude: `SessionStart.additionalContext`; OpenCode: `experimental.chat.system.transform` |

`enforcement.mode: off | warn | block`. In `warn`, the hard rules still apply. If the CLI is not installed, hooks allow the action and `sdlc doctor` shows the problem: a missing guardrail must not block every edit. A check that **fails** is different: the OpenCode plugin runs it once more and then blocks the call with the reason (since 0.7.1; OpenCode on Windows sometimes kills the check after a few milliseconds, and a failed check used to let the call through). Inside the CLI, an uninitialized project or an internal error still answers "allow".

**Claude Code:** `SessionStart`, `PreToolUse` (`Edit|Write|MultiEdit|NotebookEdit|Bash`) and `Stop` are merged into `.claude/settings.json`. The response uses the `hookSpecificOutput.permissionDecision/additionalContext` format. Other hooks are left untouched. The harness recognizes its own handlers by the `sdlc hook` command.

**OpenCode:** `.opencode/plugins/sdlc.js` is loaded automatically:
- `tool.execute.before` calls `sdlc hook pre-tool --agent opencode`; a denial is thrown as an exception;
- `tool.execute.after` appends the reminder to the tool output (this is how "warn" is implemented in OpenCode);
- `shell.env` marks the agent's shell (`SDLC_AGENT`).

OpenCode has no Stop hook, so `verify_before_stop` does not apply there.

## 4.6. Agent integration

| | Claude Code | OpenCode |
|---|---|---|
| Workflows | skills `.claude/skills/sdlc-<id>/SKILL.md` (`/sdlc-<id>`) + commands `.claude/commands/sdlc/<id>.md` (`/sdlc:<id>`) | commands `.opencode/commands/sdlc-<id>.md` (`/sdlc-<id>`), `$ARGUMENTS`, no `agent:` |
| Skills | `.claude/skills/` | **the same files**: OpenCode reads `.claude/skills/`. `.opencode/skills/` is used only if Claude is not selected (otherwise: duplicate names and a random winner) |
| Subagents | `.claude/agents/sdlc-{verifier,reviewer,researcher,simplifier}.md` (`tools: Read, Grep, Glob, Bash`) | `.opencode/agents/sdlc-*.md` (`mode: subagent`, a `permission` map; a Claude-style `tools:` line would break OpenCode startup) |
| Rules | hooks in `.claude/settings.json` | plugin `.opencode/plugins/sdlc.js` |
| Distribution | project-level install **or** the Claude Code plugin from this repository's marketplace (`/plugin install sdlc@sdlc`) | project-level install |
| Question tool | AskUserQuestion (2–4 choices) | `question` (choices + free text) |
| Todo list | TodoWrite mirrors `tasks.md` during `/sdlc:build` (`tasks.md` stays the source of truth) | `todowrite` mirrors `tasks.md` during `/sdlc-build` |
| Live CLI injection | inline live output of `sdlc … --json` in `/sdlc:status`, `/sdlc:next`, `/sdlc:help` via the tool `!` injection (fallback: run the same command) | same `!` injection form |

Thirteen workflows: `help`, `next`, `status`, `explore`, `intent`, `spec`, `plan`, `build`, `verify`, `review`, `release`, `archive`, `triage`. The bodies are intentionally short (3–5 KB versus 10–22 KB in OpenSpec). The agent gets state, templates and instructions from the CLI at run time (`sdlc status/next/instructions --json`).

Templates are written once (`assets/workflows/*.md`) and rendered for each surface. `{{cmd:x}}` references become `/sdlc:x` or `/sdlc-x`, `{{input}}` becomes `$ARGUMENTS` or a description, and `sdlc` becomes the configured prefix (`npx --no-install sdlc` for a local install).

An answer in chat is never an approval: gate approvals, `track set`, `backlog move`/`drop`, `license set` and other human decisions are commands the person runs in their own terminal. Offer the choice, explain the consequences, and give the exact command.

`HUMAN_COMMANDS` in `src/core/help-catalog.ts` is the one list that drives both `sdlc help` (actor: human) and the hook denials. It includes `approve`, `reject`, `waive`, `tests unlock`, `track set`, `backlog move`, `backlog drop`, `license set` and `roles migrate`.

## 4.7. CLI commands

`init [--statusline]`, `update`, `uninstall`, `new`, `status [--markdown]`, `help [topic]`, `statusline`, `next`, `instructions`, `approve|reject|waive`, `roles check|who|migrate`, `approvals verify`, `tests lock|unlock`, `verify [--list|--check]`, `review context|check`, `validate`, `archive`, `audit`, `log`, `layout check|scaffold|adapt|convert`, `report`, `dashboard`, `license [set]`, `doctor`, `hook`, `plugin build`, `openspec …` (pass-through call to the bundled OpenSpec). Every command except `statusline`, `dashboard`, `hook` and `openspec` has `--json` with `{severity, code, message, fix}` diagnostics, as in OpenSpec.

Planning commands include `sdlc explore <slug> | list`, `sdlc track set <full|lite> --change <id>`, `sdlc defer add | list | close`, `sdlc backlog add | epic add | list | next | start | move | drop | done`, and `sdlc import bmad <path> (--change <id> | --to-backlog) [--dry-run]`. BMAD PRD, SPEC and architecture spine map to intent, proposal, specs, design and deferred work; with `--to-backlog`, BMAD epics/tickets (or a PRD/SPEC) become backlog epics and items. Imported change artifacts start without approvals and require `sdlc validate`.

## 4.8. Key decisions and trade-offs

| Decision | Why | Cost |
|---|---|---|
| OpenSpec as a dependency, not a fork | compatibility, and OpenSpec's fixes to the delta merge come for free; OpenSpec ships releases every 1–2 weeks | a subprocess per operation (~0.2–0.4 s) |
| A custom schema instead of custom formats | `/opsx:*` and `openspec` keep working | some instructions depend on the OpenSpec version (pinned to ≥ 1.13.2) |
| State in `.sdlc.yaml`, not in `.openspec.yaml` | OpenSpec rewrites its metadata through zod and drops unknown keys | one more file in the change folder |
| Digests instead of "approved" flags | an approval cannot "survive" an edit to the artifact | fixing a typo requires a new approval |
| Git tree id instead of "HEAD + diff" | a commit does not make verification stale | git is required; outside git, freshness is not checked (a warning) |
| Hooks allow when the CLI is missing, block when a check fails (OpenCode) | a missing installation does not paralyze work, a flaky check does not open a hole | without the CLI the rules do not apply (`doctor` catches this); a Claude Code check that crashes or times out is still allowed by Claude Code itself (backlog) |
| Identity = git user | zero infrastructure | a git email can be forged by a person with access to the repository; `roles.yaml` with `signing: required` and `sdlc approvals verify` in CI close this, together with branch protection (see the playbook) |

## 4.9. Limitations and what comes next

- OpenCode has no equivalent of the Stop hook; the plugin also has no `ask` decisions (only allow/deny).
- OpenSpec stores/multi-repository setups are not supported yet (pass-through commands work; gates are evaluated against the local root).
- Continuous evals (Stage 4) and monitoring control bands (Stage 6) are described in the `archive`/`triage` workflows, but there are no separate `eval`/`bands` commands yet.
- Linking to Jira/ServiceNow works through `--source-ref`/`--source-url` and the agent's MCP connectors; there is no two-way sync.
- Next version: the `Next:` hint and the workflows name the people from `roles.yaml` who can take a human decision ("approve review: Carol Hughes").
- Possible next steps: `sdlc eval`, checking code against living specs, a PR bot that uses `status --markdown`.

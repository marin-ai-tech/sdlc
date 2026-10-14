# 4. Architecture of the `sdlc` harness (sdlc)

## 4.1. The idea in one paragraph

**OpenSpec is the specification subsystem, and SDLC is the process layer around it.** All spec operations (creating a change, artifact instructions, validation, delta merge) are performed by unmodified OpenSpec (the `@fission-ai/openspec` dependency, ≥ 1.13.2) through its documented JSON contract. On top of this, the harness adds the stages of the Anthropic playbook, gates with human approvals, verification evidence, review, release gates, audit and deterministic enforcement, identically for Claude Code, OpenCode, Cursor, Codex CLI, Qwen Code and GigaCode.

```
┌──────────────────────────── agents ─────────────────────────────┐
│ Claude Code: skills, /sdlc:* commands, subagents, hooks         │
│ OpenCode:    /sdlc-* commands, subagents, plugin .opencode/…    │
│ Cursor:      skills, /sdlc-* commands, subagents, hooks, a rule │
│ Codex CLI:   $sdlc-* skills, subagents, hooks, command rules    │
│ Qwen Code, GigaCode: skills, /sdlc-* commands, subagents,       │
│              hooks and deny rules in settings.json              │
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
4. **Its own namespace in the agents:** `sdlc-*` skills (`$sdlc-*` in Codex CLI), `/sdlc:*` and `/sdlc-*` commands, `sdlc-*` subagents. `openspec update` touches only `openspec-*`/`opsx*`, so `/opsx:*` can be installed alongside (`sdlc init --opsx`).
5. **Existing OpenSpec projects:** `sdlc init` does not change the default schema. Changes on `spec-driven` are read correctly: the `intent` gate is marked `n/a`, and the `plan` gate covers only `tasks`.
6. **The same semantics:** task progress is counted with the same regex as in OpenSpec; artifact statuses are computed from the presence of files, in the same DAG order.

## 4.3. Data model

| File | Owner | Contents |
|---|---|---|
| `openspec/config.yaml` | OpenSpec | default schema, `context`, `rules`; the harness respects them and passes them into the instructions |
| `openspec/sdlc.yaml` | harness | gates (with `min_approvals`, `auto_waive`), `rework.reasons` and `max_cycles`, roles, verification commands, review policy, release commands, enforcement, `questions`, `design` (debate lens), `health` thresholds, `cli`, `tools` (claude, opencode, cursor, codex, qwen, gigacode), `issues` and `context.sources` (0.19.0) |
| `openspec/explorations/<slug>.md` | agent + people | optional research and pressure test before intent; a change cites it with `--source-type exploration --source-ref openspec/explorations/<slug>.md` |
| `openspec/deferred-work.md` | team | registry of deferred decisions and findings (`D<n>`) |
| `openspec/roles.yaml` | people (maintainers) | optional: people (emails, SSH signing keys, chat handles per channel since 0.19.0), roles, separation rules, signing mode; agents cannot edit it |
| `openspec/backlog.md` | people + CLI (agents only through the CLI; the hook denies their direct edits) | ordered backlog of planned changes: epics `E<n>` and items `B<n>` (one item = one future OpenSpec change); ids never reused; file order is priority; readiness is computed (outcome, acceptance, dependencies done), never stored; an item may link a GitHub issue (`Issue: GH-<n>`, 0.19.0) or carry the source `alert:<id>` (0.19.0) |
| `openspec/changes/<id>/sources/bmad/` | importer | retained BMAD source artifacts for an imported change |
| `openspec/schemas/sdlc/**` | harness → OpenSpec | schema and artifact templates |
| `openspec/changes/<id>/{intent,proposal,design,plan,tasks}.md`, `specs/**` | agent + people | artifacts (OpenSpec format) |
| `openspec/changes/<id>/.sdlc.yaml` | **CLI only** | `version` (3 when the record holds answers to open questions, 2 when it holds a rework or a takeover, else 1), kind (with `kind_by_agent` when an agent chose it), risk, track, `track_suggestion`, source, approvals with digests (and `person` when `roles.yaml` exists; each decision carries `seq`, its order in the record), reworks (`gates.<g>.rework` with its `cycle`), policy waivers (`waived.by: policy`), `answers` (a person's answers with the exact question text), `takeover` while a person holds the change, verify result, event history |
| `refs/sdlc/<change>/<gate>` (git) | **CLI only** | checkpoint: a snapshot commit of the working tree when the gate was approved, for `rework --reset`; branches and HEAD are never moved |
| `…/verification.md` | CLI + verifier | automatic evidence block (generated) + behavioral table by scenario |
| `…/review.md` | reviewer | findings `### F<n> [severity][pass] …` with statuses and `## Coverage` for passes and lenses |
| `…/release.md` | agent | changelog, rollout per environment, control bands, rollback |
| `openspec/.sdlc/manifest.json` | harness | sha256 of the generated files (edits by people are not overwritten), the sdlc version and the license they were created under |
| `openspec/.sdlc/log.jsonl` | **CLI only** | project log: setup, gate decisions, verify runs, archives, license changes, hook denials; each line has `sdlc` (the version) and `license` |
| `docs/context/<name>.md` | people; `sdlc context pull` for `context.sources` (0.19.0) | context packs with a header (owner, source, updated, fresh_days, stages); in git and reviewed like any file |
| `.git/sdlc/outbox/` | **CLI only** | events waiting for delivery, never committed; since 0.19.0 also the comment and the close of a linked GitHub issue |
| `REVIEW.md` | team | review policy (created once) |

The stage **is not stored anywhere**: it is computed each time from the artifacts and the gate records. So a manual file edit or a `git revert` cannot put the "current stage" out of sync.

## 4.4. Gates

| Gate | Stage | What it covers | Who approves (default) | When it goes stale |
|---|---|---|---|---|
| `intent` | Plan | `intent.md` | product-owner | intent.md changed |
| `spec` | Design | `proposal.md`, `specs/**`, `design.md` | product-owner (+ tech-lead with `risk: high`) | any of them changed |
| `plan` | Build | `plan.md`, `tasks.md` (ignoring checkboxes) | engineer (+ tech-lead with `risk: high`) | the plan or the task list changed |
| `verify` | Test | automatic: all required checks passed, all tasks closed; with `verify.require_behaviour: true` (0.18.0), also one row of the behavioural table per spec scenario | — (`waive` with a reason is allowed) | the worktree content changed |
| `qa` | Test | optional (`gates.qa.required: true`, 0.18.0; not shown otherwise): a person accepts `verification.md` and the recorded verify run | qa | a new `sdlc verify` run or `verification.md` changed |
| `review` | Deploy | `review.md` + code; pass/lens coverage and deferred links | code-owner; blocked by open `important` findings, missing required coverage or unlinked deferrals; waits for a required `qa` gate | the code or review.md changed |
| `release` | Deploy | `release.md` + code | release-manager (optional by default) | the code changed |

Mechanics:
- **Approval is bound to content.** `.sdlc.yaml` records the role, who (git identity), when, and the **sha256 digest** of the covered files. Any edit → status `stale` → a new approval is needed. Checkboxes in `tasks.md` are normalized: progress does not make the plan stale.
- **The worktree fingerprint for verify, review and release** is the git tree id of all files (tracked + untracked, excluding ignored files and `openspec/`). It is computed in a temporary index and does not depend on commits: committing verified code does not make the verification stale, while any change to the content does.
- **Separation of duties: agents.** `approve`, `reject`, `waive`, `track set`, `tests unlock`, `archive --force`, `license set`, `backlog move`, `backlog drop`, `roles migrate` and the other person's commands of `HUMAN_COMMANDS` (4.6) refuse to run in an agent session (`CLAUDECODE=1`, `OPENCODE=1`/`AGENT=1`, `SDLC_AGENT`, `CURSOR_AGENT=1`, `CODEX_CI=1`/`CODEX_SESSION_ID`, `QWEN_CODE=1`/`QWEN_CODE_SESSION_ID`; `src/core/agent-env.ts`). Hooks also stop the agent from calling the commands in `HUMAN_COMMANDS` and from editing `.sdlc.yaml`, `openspec/roles.yaml` and the project log `openspec/.sdlc/log.jsonl`. Backlog priority and dropping an item are human product decisions.
- **Separation of duties: people.** Without `openspec/roles.yaml`, `roles.<role>: [emails]` in sdlc.yaml limits the set of approvers, and without a list any person with a git identity can approve (convenient for small teams). With the file (`src/core/roles.ts`), the git email names a person, the gate needs one of that person's roles, and `checkApproval` applies the separation rules against the change's recorded approvals and its code authors (`changeAuthors`: commit authors and `Co-authored-by` since the review base, files outside `openspec/`). `sdlc approvals verify` (`src/commands/approvals.ts`) finds the commit that introduced each approval record (`git log -S<timestamp>`) and checks its SSH signature against an `allowed_signers` file built from the people's keys; `roles.yaml` commits are checked against the maintainers of the previous version. The hook denies agent writes to `roles.yaml`. Since 0.18.0, with the file, `team accept` needs `maintainer` and `backlog move`/`drop` need `product-owner` (`missing_role` otherwise). See [8. Roles, separation of duties and signed approvals](08-roles-and-signing.md).
- **Tracks:** `full` (all gates) and `lite` (intent and spec are optional, the change starts with the plan) for bug fixes, refactorings and minor work.
- **Process hygiene (0.11.2):** after a rework, an approval with the digest approved before it needs a note (`src/core/approval-hygiene.ts`); `gates.<gate>.auto_waive` turns into a policy waiver during evaluation (`src/core/auto-waive.ts`; not for verify, review, release, nor for a kind chosen in an agent session, recorded as `kind_by_agent`); the rework record counts its `cycle`, and at `rework.max_cycles` the next action becomes a person's `review-scope` (`src/core/rework-limit.ts`); approvals propose a commit with an `SDLC-Approval` trailer.
- **Answers (0.11.4):** `sdlc answer` (human-only, in HUMAN_COMMANDS) writes the answer into the artifact and an `answers` entry into `.sdlc.yaml` (artifact, exact question text, answer, who, when, `seq`); `sdlc approve intent|spec` refuses with `open_questions` while a question of intent.md, proposal.md or design.md has no matching entry (`src/core/answers.ts`, `open-questions.ts`); the check runs at approval, so earlier approvals stand.
- **Base drift:** on spec approval, the digests of the main specs that the change modifies are recorded. If another change has modified them in the meantime, `status` warns.
- **Gate modules (0.19.0):** the lifecycle code (`src/core/lifecycle.ts`) is split into one module per gate. Nothing changes in behaviour.
- **The judge (0.20.0):** `gates.<g>.judge` (parsed in `src/core/judge-config.ts`) adds a blocker to an approval gate (`src/core/judge-gate.ts`, wired into `planning-gates.ts` and the next-step chain). `sdlc judge` records verdicts in `.sdlc.yaml` under the gate, each bound to the digest of the gate's artifacts; only a passing verdict for the current digest, or `max_loops` failing ones, clears the blocker. The approval itself is unchanged: the judge is evidence, a person approves. A command judge runs with `SDLC_AGENT=judge`.

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
| Agent edits the guard's own configuration (`openspec/sdlc.yaml`, `.claude/settings*.json`, `.opencode/plugins/sdlc.js`, `.mcp.json`, `opencode.json(c)`, `.cursor/hooks.json`, `.cursor/mcp.json`, `.codex/hooks.json`, `.codex/config.toml`, `.codex/rules/sdlc.rules`, `.qwen/settings.json`, `.gigacode/settings.json`, the generated `sdlc-*` files, the manifest, the review policy, the sdlc schema, `openspec/config.yaml`; user-level `~/.claude/settings.json`, `$CLAUDE_CONFIG_DIR/settings.json`, `~/.config/opencode/opencode.json(c)`, `$OPENCODE_CONFIG`, `~/.codex/config.toml` and `~/.codex/hooks.json` (or under `CODEX_HOME`), Cursor's `~/.cursor/hooks.json`, `~/.qwen/settings.json`, `~/.gigacode/settings.json`), by edit or shell; runs `sdlc uninstall`, or `sdlc init`/`update` with flags that weaken the guard (lower mode, fewer tools, `--no-hooks`, another `--cli`) | hard | deny (rule `guard-config`; the CLI refuses with `agent_cannot_weaken_guard`); `init`/`update` without such flags still restore the files |
| Agent adds a key, token or password in an edit or a shell write (`secret_allow` exempts test data) | hard | deny (rule `secret-in-edit`; the reason names the kind and the file, never the value) |
| Agent calls a registry MCP server outside its `stages` (`mcp.servers`) | process | `warn`: a reminder; `block`: deny (rule `mcp-stage`) |
| Production release without authorization (`release.commands`) | hard | deny until there is a `release` approval or `SDLC_RELEASE_APPROVAL` |
| Stopping without fresh verification (`verify_before_stop`) | optional | Claude Code, Codex CLI, Qwen Code, GigaCode: `Stop → decision: block`; Cursor: stop answers a `followup_message`; OpenCode: none |
| Session context | — | Claude Code, Codex CLI, Qwen Code, GigaCode: `SessionStart.additionalContext`; Cursor: sessionStart `additional_context`; OpenCode: `experimental.chat.system.transform` |

`enforcement.mode: off | warn | block`. In `warn`, the hard rules still apply. If the CLI is not installed, hooks allow the action and `sdlc doctor` shows the problem: a missing guardrail must not block every edit. A check that **fails** is different: the OpenCode plugin (since 0.7.1) and the Claude Code hook command (since 0.8.0) run it once more and then block the call with the reason (OpenCode on Windows sometimes kills the check after a few milliseconds, and a failed check used to let the call through). Cursor's edit and shell hooks are `failClosed`: a hook that cannot run blocks the call, so there a missing CLI blocks too. Codex CLI, Qwen Code and GigaCode let a call through when a hook fails; since 0.14.3 the `sdlc` command answers a `deny` itself when its pre-tool hook fails to load or throws, so only a missing CLI or a timeout lets the call through there. Inside the CLI, an uninitialized project or an internal error still answers "allow".

**Claude Code:** `SessionStart`, `PreToolUse` (`Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell|mcp__.*`; PowerShell since 0.8.2, MCP tools since 0.9.0) and `Stop` are merged into `.claude/settings.json`. The response uses the `hookSpecificOutput.permissionDecision/additionalContext` format. Other hooks are left untouched. The harness recognizes its own handlers by the `sdlc hook` command.

**OpenCode:** `.opencode/plugins/sdlc.js` is loaded automatically:
- `tool.execute.before` calls `sdlc hook pre-tool --agent opencode`; a denial is thrown as an exception;
- `tool.execute.after` appends the reminder to the tool output (this is how "warn" is implemented in OpenCode);
- `shell.env` marks the agent's shell (`SDLC_AGENT`).

OpenCode has no Stop hook, so `verify_before_stop` does not apply there.

### MCP in both directions (0.9.0)

- **Server** (`sdlc mcp serve`, `src/mcp/server.ts`; tools in `src/mcp/tools.ts`): low-level SDK `Server`.
  Read tools include `status`, `next`, `instructions`, `trace`, `audit`, `help`, `guide`, `explain`, `health`,
  `report` and `board_list`. An HTTP executor token also exposes board claim, heartbeat, release and submit.
  Each runs the CLI with `--json` in a child process. No decision is a tool.
- **HTTP transport (0.19.0)** (`sdlc mcp serve --http <host:port>`, `src/mcp/http.ts`): the same server and tools over MCP Streamable HTTP at `/mcp`. Each request passes four checks before it reaches MCP: the path (only `/mcp`, else 404), the bearer token (else 401), the `Origin` header against the listen host and port, against DNS rebinding (else 403), and the body size (at most 1 MB, else 413). The bearer token is the server token from `SDLC_MCP_TOKEN` (an exact match), or since 0.20.x an executor's token: its SHA-256, compared in constant time, must equal a `token_sha256` of a served project's `openspec/executors.yaml`, read on every request — a reissued token or a removed executor stops working at once, a broken registry fails closed for executor tokens only. An authorized request's executor identity `{ project, executor }` reaches `createServer` as a typed caller; the server token gives an empty one, and tool arguments can never set it. The server token is required on localhost too and has at least 16 characters; without it the server does not start (`token_required`). It is never a flag and is never printed. The listen URL goes to stderr.
- **Client** (`src/mcp/`): the CLI connects to the registry servers for `sdlc mcp check` and for `verify.mcp` checks. The result is evidence written by the CLI, so an agent cannot forge it. Outside an agent session, results are also written to `openspec/.sdlc/inbox/` for the next agent session.
- **Registry** (`mcp.servers` in `openspec/sdlc.yaml`): laid out into `.mcp.json`, `opencode.json`, `.cursor/mcp.json`, `.codex/config.toml`, `.qwen/settings.json` and `.gigacode/settings.json`, for the configured tools. Entries written by sdlc are tracked in the manifest. Secrets are only `${VAR}` references, checked with the patterns of the `secret-in-edit` rule.
- **Events and the outbox** (`src/mcp/events.ts`, `src/mcp/outbox.ts`): an event is queued in `.git/sdlc/outbox/` and delivered to the receivers whose `on` matches; what fails waits for the next command or `sdlc events flush`. Since 0.19.0, a wait (`gate.<g>.awaiting`, `gate.<g>.overdue`) gets its id from `project.name` (when set), the change, the gate, the event and the digest, not from the time, so every clone and CI send the same id; every other event keeps an id of its own entry. Chat handles (`src/mcp/event-chat.ts`) are queued per channel, only for the channels that receivers name, and each receiver gets only its own channel's part. `sdlc events summary` (`src/commands/summary-daily.ts`) builds `summary.daily` from the report model and records it once per local day in the project log; `summary.*` is not in the default patterns of a receiver.
- **Issues through the outbox (0.19.0):** `sdlc backlog import --issues` calls `list_issues` on the server that `issues.server` names. Archiving a change whose backlog item has `Issue: GH-<n>` queues `add_issue_comment` and `update_issue` (state closed) in the same outbox, so a failing server never fails the archive, and `sdlc events flush` delivers later. sdlc holds no GitHub token; the server does.
- **Context pull (0.19.0):** `sdlc context pull` is the only command that reads the knowledge server. It writes `docs/context/<name>.md` with the usual header, and `sdlc instructions` keeps reading files, offline. A failing source leaves its file as it was; a name that is not a plain file name, or a server outside `mcp.servers`, is refused before anything is written.
- **Alert intake (0.19.0):** `sdlc triage intake` (`src/commands/triage.ts`) parses one alert from stdin and adds a backlog item with the source `alert:<id>`; the backlog's duplicate check on the source makes a repeat answer `duplicate: true`. It never sets the order.

See chapter 10 for the user's view.

## 4.6. Agent integration

One adapter per tool (`src/integrations/<tool>.ts`; Qwen Code and GigaCode share `qwen-family.ts`) renders the same
workflow templates and subagents. The table covers the first two tools; the paragraphs after it cover the others, and
the [Supported tools](05-guide.md#supported-tools) table in the guide compares all six.

| | Claude Code | OpenCode |
|---|---|---|
| Workflows | skills `.claude/skills/sdlc-<id>/SKILL.md` (`/sdlc-<id>`) + commands `.claude/commands/sdlc/<id>.md` (`/sdlc:<id>`) | commands `.opencode/commands/sdlc-<id>.md` (`/sdlc-<id>`), `$ARGUMENTS`, no `agent:` |
| Skills | `.claude/skills/` | **the same files**: OpenCode reads `.claude/skills/`. `.opencode/skills/` is used only if Claude is not selected (otherwise: duplicate names and a random winner) |
| Subagents | `.claude/agents/sdlc-{verifier,reviewer,researcher,simplifier,health,advocate}.md` (`tools: Read, Grep, Glob, Bash`) | `.opencode/agents/sdlc-*.md` (`mode: subagent`, a `permission` map; a Claude-style `tools:` line would break OpenCode startup) |
| Rules | hooks in `.claude/settings.json` | plugin `.opencode/plugins/sdlc.js` |
| Distribution | project-level install **or** the Claude Code plugin from this repository's marketplace (`/plugin install sdlc@sdlc`) | project-level install |
| Question tool | AskUserQuestion (2–4 choices) | `question` (choices + free text) |
| Todo list | TodoWrite mirrors `tasks.md` during `/sdlc:build` (`tasks.md` stays the source of truth) | `todowrite` mirrors `tasks.md` during `/sdlc-build` |
| Live CLI injection | inline live output of `sdlc … --json` in `/sdlc:status`, `/sdlc:next`, `/sdlc:help` via the tool `!` injection (fallback: run the same command) | same `!` injection form |

**Cursor (0.13.0).** Workflows as skills `.cursor/skills/sdlc-<id>/SKILL.md` with thin commands `.cursor/commands/sdlc-<id>.md` (`/sdlc-<id>`), subagents `.cursor/agents/sdlc-*.md` (`readonly`), an always-applied rule `.cursor/rules/sdlc.mdc`, the MCP server in `.cursor/mcp.json`, and hooks in `.cursor/hooks.json` (sessionStart, preToolUse without a matcher and `failClosed`, beforeShellExecution, stop) that call `sdlc hook <event> --agent cursor`; `src/hook-cursor.ts` maps Cursor's payloads (the project from `workspace_roots`; a Delete checked as `rm -r`) and answers in Cursor's format, always with JSON. `CURSOR_AGENT=1` marks the agent's terminal. See [15. Cursor IDE](15-cursor.md).

**Codex CLI (0.14.0).** Workflows as skills `.agents/skills/sdlc-<id>/SKILL.md` (`$sdlc-<id>`), subagents `.codex/agents/sdlc-*.toml` (`developer_instructions`, `sandbox_mode = "read-only"` for read-only roles), hooks in `.codex/hooks.json` (SessionStart, PreToolUse without a matcher, Stop) that call `sdlc hook <event> --agent codex` — Codex sends Claude Code's payloads and reads Claude Code's answers, so the Claude path serves it; the patch text of `apply_patch` comes in `tool_input.command`. `.codex/rules/sdlc.rules` has one `forbidden` `prefix_rule` per person's command, spelled with the configured `cli`. The MCP servers are `[mcp_servers.<name>]` tables in `.codex/config.toml`, merged at the table level by `src/integrations/codex-toml.ts` (sdlc replaces or removes only the tables it wrote). `CODEX_CI=1` or `CODEX_SESSION_ID` marks the agent's shell. For every tool, `src/core/policy-shell-writes.ts` reads the files a shell command writes (redirections, `tee`/`cp`/`mv`/`install`, PowerShell `Set-Content`, `Add-Content`, `Clear-Content`, `Out-File`, `New-Item`, `Copy-Item`, `Move-Item`), and they go through the plan gate and locked tests like edits. See [16. Codex CLI](16-codex.md).

**Qwen Code and GigaCode (0.14.1).** One adapter for the Qwen family, with the folder `.qwen/` or `.gigacode/`: skills `<dir>/skills/sdlc-<id>/SKILL.md`, thin commands `<dir>/commands/sdlc-<id>.md` (`/sdlc-<id>`), subagents `<dir>/agents/sdlc-*.md` (read-only roles get `disallowedTools`), and in `<dir>/settings.json` the hooks (SessionStart, PreToolUse without a matcher, Stop) that call `sdlc hook <event> --agent qwen|gigacode`, `permissions.deny` entries `Bash(<cli> <command>[ *])` for every person's command, and `mcpServers`. The tools send Claude Code's payloads (`run_shell_command`, `write_file`, `edit`) and read Claude Code's answers, so the Claude path serves them. `QWEN_CODE=1` marks the agent's shell. GigaCode is experimental: checked against its formats only. See [17. Qwen Code and GigaCode](17-qwen-gigacode.md).

Eighteen workflows: `help`, `guide`, `next`, `status`, `health`, `adopt`, `team`, `backlog`, `explore`, `intent`, `spec`, `plan`, `build`, `verify`, `review`, `release`, `archive`, `triage`. The bodies are intentionally short (3–5 KB versus 10–22 KB in OpenSpec). The agent gets state, templates and instructions from the CLI at run time (`sdlc status/next/instructions --json`).

Templates are written once (`assets/workflows/*.md`) and rendered for each surface. `{{cmd:x}}` references become `/sdlc:x`, `/sdlc-x` or, in Codex, `$sdlc-x`; `{{tool:ask}}` and `{{tool:todo}}` name each tool's question and todo tools; `{{input}}` becomes `$ARGUMENTS` or a description, and `sdlc` becomes the configured prefix (`npx --no-install sdlc` for a local install).

An answer in chat is never an approval: gate approvals, `track set`, `backlog move`/`drop`, `license set` and other human decisions are commands the person runs in their own terminal. Offer the choice, explain the consequences, and give the exact command.

`HUMAN_COMMANDS` (`src/core/human-commands.ts`, read by `src/core/help-catalog.ts`) is the one list that drives both `sdlc help` (actor: human) and the hook denials. It includes `approve`, `reject`, `rework`, `waive`, `tests unlock`, `track set`, `backlog move`, `backlog drop`, `license set`, `roles migrate`, `takeover`, `release-control`, `uninstall`, `team accept`, `answer` and `ci init`.

## 4.7. CLI commands

`audit --export <dir>` (0.12.0: `src/core/evidence-export.ts`, signatures from `approval-signatures.ts` shared with `approvals verify`), `changelog` (`src/core/changelog.ts`, from `readChangeDeltas`), the `prepare-commit-msg` git hook (`src/integrations/git-hook.ts`; a POSIX script that mirrors `agent-env.ts`, kept in sync by a test), `health`, `explain --change <id>` (0.11.3: `src/core/health/` collects findings per area, `signal.ts` logs `health.degraded`/`health.recovered` and builds the session-start line; `src/core/explain.ts` reads the lifecycle view and writes nothing), `init [--statusline]`, `update`, `uninstall`, `new`, `status [--markdown]`, `help [topic]`, `statusline`, `next`, `instructions`, `approve|reject|waive`, `roles check|who|migrate`, `approvals verify`, `tests lock|unlock`, `verify [--list|--check]`, `review context|check`, `validate`, `archive`, `audit`, `log`, `layout check|scaffold|adapt|convert`, `report`, `dashboard`, `license [set]`, `doctor`, `hook`, `plugin build`, `mcp serve [--http]|check`, `inbox list|done`, `events list|flush|summary`, `triage intake`, `context pull`, `task executors|export|check-result`, `board list|claim|heartbeat|release|submit`, `review suggest`, `judge --gate <g>` (0.20.0), `ci init`, `team sync|list|check|accept`, `answer`, `rework`, `takeover`, `release-control`, `openspec …` (pass-through call to the bundled OpenSpec). Every command except `statusline`, `dashboard`, `mcp serve`, `hook` and `openspec` has `--json` with `{severity, code, message, fix}` diagnostics, as in OpenSpec.

Planning commands include `sdlc explore <slug> | list`, `sdlc track set <full|lite> --change <id>`, `sdlc defer add | list | close`, `sdlc backlog add | epic add | epic edit | list | next | edit | start | move | drop | done | import --issues`, and `sdlc import bmad <path> (--change <id> | --to-backlog) [--dry-run]`. BMAD PRD, SPEC and architecture spine map to intent, proposal, specs, design and deferred work; with `--to-backlog`, BMAD epics/tickets (or a PRD/SPEC) become backlog epics and items. Imported change artifacts start without approvals and require `sdlc validate`.

**Extension packs (0.20.0).** `src/team/pack-contents.ts` reads the lenses, workflows and checks of a fetched pack, computes their digest and the problems that refuse it (`pack_not_pinned`, `pack_forbidden_command`, the same human-command match as the hook, `src/core/human-command-match.ts`). `sdlc team accept --pack` (`src/team/pack-accept.ts`, a person) records the digest and the source in `openspec/.sdlc/team.json`; `src/team/pack-effect.ts` puts a pack's contents in effect only while the fetched copy has that source and digest. Lenses join `review.lenses`, workflows become generated skills (`src/integrations/pack-workflows.ts`, owned through the manifest like the built-in ones), checks run after `verify.commands` with `SDLC_AGENT=pack-<name>`.

**The task contract (0.19.0).** `sdlc task export` and `sdlc task check-result` are the interface to executors of any
type. A work item follows the contract `sdlc.task/1`, and the check answers a result; both shapes are published as
JSON Schemas, `schemas/contracts/task.schema.json` and `schemas/contracts/result.schema.json`, so an executor can be
built and tested against them. Export reads the change: the open tasks of `tasks.md`, the plan's files, the spec
scenarios, the verify commands, the forbidden paths and the base commit. It refuses unless the plan gate is approved
and fresh (`plan_not_approved`). Check-result reads the commits of the returned branch, their `SDLC-Change` and
`SDLC-Task` trailers and the files they touch, against the change's tasks, the plan and the forbidden paths. Both
commands are read-only and are not in `HUMAN_COMMANDS`; merging, verification and review stay the usual steps.

**The executor registry.** `openspec/executors.yaml` (`src/core/executors.ts`) is a state file a person fills:
each executor has a type (`representative`, `board`, `market`, `mesh`), a `max_risk` and optional `kinds` and
`capabilities`. The module parses it once at the boundary; any problem is `executors_invalid` naming the executor
and the field. `executorRefusal` is the single allowed-check: risk order `low < medium < high`, the change risk at
most `max_risk`, the kind in `kinds` when given; export and check-result share it. `sdlc task executors` lists the
registry, `task export --executor` hands work to it (`SDLC-Agent: <executor>/<agent>` trailer, a `task.exported`
log entry per task), `check-result` wants that trailer on every commit (`missing_agent`, `unknown_executor`,
`executor_not_allowed`; each check a `task.result_checked` log entry). Being a state file (`STATE_FILES`, the
`policy-shell` regexes, the `hook.executorsIntegrity` deny reason), the registry is off-limits to agents.

**The task board (B118a).** `src/core/board.ts` holds the rules, `src/core/board-store.ts` the file and the lock,
`src/commands/board.ts` the CLI. The open tasks of every active change whose plan gate is open (the same
`planOpen` rule export uses) sit on the board in `openspec/.sdlc/board.json` —
`{version: 1, claims, dispatches}`, parsed at
the boundary (a broken file is `board_invalid`, never reset), written under `openspec/.sdlc/board.lock`
(`fs.openSync 'wx'`, ~10 s of retries, a lock older than ~30 s broken as stale, temp + rename) so exactly one
process wins a claim race; both files are state files (`STATE_FILES`, the `policy-shell` regexes,
`hook.boardIntegrity`) and git-ignored by `openspec/.sdlc/.gitignore`. A claim holds a lease (default 900 s, at
most a day) that `heartbeat` renews and `release` ends; `submit` runs `checkResult` and wants every commit's
`SDLC-Agent` executor to be the claim's (`wrong_executor`, added to `result.schema.json`). Expiry is computed on
read — no timer: lease commands drop held claims whose lease passed and log one `task.lease_expired` each;
the claim record stays as a tombstone, so the event logs once and heartbeat still answers `claim_expired`. The
other log events are `task.claimed`, `task.released` (the note as detail) and `task.submitted` (branch + head
sha); heartbeats log nothing. A submitted claim stays recorded — the seam where a reopen (B121) lands. The board
approves nothing and decides no gate. `src/core/board-reopen.ts` reopens only a submitted claim, retaining its
branch, agent and reason as a terminal `reopened` attempt. List derives `attempts`, `lastReason` and sorted
`excluded` executors from those records; a new claim carries `previousAttempts` in its work item. Escalation
refuses the same executor on a later claim. The log adds `task.reopened` with the reason and `task.escalated`
when requested. Reopen is available to agents too, so its board decision is not a gate approval or rejection.

## 4.8. Key decisions and trade-offs

Dispatches live beside claims in `board.json`, parsed at the boundary and updated under the same board lock.
`src/core/board-dispatch.ts` expires reservations on the next board command and logs each expiry once.
The HTTP MCP server derives the executor and project from the bearer token. It lists board write tools only
for executor callers; claim management checks ownership inside the board lock. The server token and stdio
can list the board but cannot call a write tool. No MCP tool handles dispatch or a human decision.

| Decision | Why | Cost |
|---|---|---|
| OpenSpec as a dependency, not a fork | compatibility, and OpenSpec's fixes to the delta merge come for free; OpenSpec ships releases every 1–2 weeks | a subprocess per operation (~0.2–0.4 s) |
| A custom schema instead of custom formats | `/opsx:*` and `openspec` keep working | some instructions depend on the OpenSpec version (pinned to ≥ 1.13.2) |
| State in `.sdlc.yaml`, not in `.openspec.yaml` | OpenSpec rewrites its metadata through zod and drops unknown keys | one more file in the change folder |
| Digests instead of "approved" flags | an approval cannot "survive" an edit to the artifact | fixing a typo requires a new approval |
| Git tree id instead of "HEAD + diff" | a commit does not make verification stale | git is required; outside git, freshness is not checked (a warning) |
| Hooks allow when the CLI is missing, block when a check fails | a missing installation does not paralyze work, a flaky check does not open a hole | without the CLI the rules do not apply (`doctor` catches this; Cursor's `failClosed` hooks block instead); a check that exceeds the hook timeout (30 s in Claude Code and Codex CLI) is still allowed by Claude Code, Codex CLI and Qwen Code themselves |
| Identity = git user | zero infrastructure | a git email can be forged by a person with access to the repository; `roles.yaml` with `signing: required` and `sdlc approvals verify` in CI close this, together with branch protection (see the playbook) |

## 4.9. Limitations and what comes next

- OpenCode has no equivalent of the Stop hook; the plugin also has no `ask` decisions (only allow/deny).
- OpenSpec stores/multi-repository setups are not supported yet (pass-through commands work; gates are evaluated against the local root).
- Continuous evals (Stage 4) and monitoring control bands (Stage 6) are described in the `archive`/`triage` workflows, but there are no separate `eval`/`bands` commands yet.
- Since 0.19.0, GitHub Issues are linked through the team's GitHub MCP server: an import into the backlog, and a comment and a close when the change is archived. Jira and ServiceNow still work through `--source-ref`/`--source-url`, the team's MCP registry and `verify.mcp` checks; there is no two-way sync of their tickets.
- Possible next steps: `sdlc eval`, checking code against living specs, a PR bot that uses `status --markdown`.

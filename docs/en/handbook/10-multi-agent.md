# 10. One project, several agent tools

Most of this handbook uses Claude Code. sdlc supports six agent tools, and one project can serve several of them at
once. The process stays the same in every tool: the same workflows, subagents, gates, checks and backlog. What differs
is where each tool keeps its files, how you call a workflow, and how firmly the tool's own hooks hold the gates. This
chapter shows those differences, so that Steven can set up a mixed team and everyone knows the limits.

## Contents

- [10.1 Six tools, one process](#s10-1)
- [10.2 What the hooks hold in each tool](#s10-2)
- [10.3 Trust, failures and the limits of each tool](#s10-3)
- [10.4 Agent markers and the SDLC-Agent trailer](#s10-4)
- [10.5 One MCP registry for every tool](#s10-5)
- [10.6 A mixed team at Northwind](#s10-6)


<a id="s10-1"></a>
## 10.1 Six tools, one process

*Steven  ·  tasklet  · needs: sdlc installed, a git repository*

Set up one project for several agent tools, and know where each tool's files live and how to call a
workflow in it.

### Procedure

1. Know the six tools and their ids for `--tools`:

   | Tool | `--tools` id | Status |
   |---|---|---|
   | Claude Code | `claude` | supported |
   | OpenCode | `opencode` | supported |
   | Cursor IDE | `cursor` | supported (since 0.13.0) |
   | Codex CLI | `codex` | supported (since 0.14.0; checked live with codex-cli 0.158.0) |
   | Qwen Code | `qwen` | supported (since 0.14.1) |
   | GigaCode CLI | `gigacode` | **experimental** (since 0.14.1; formats only, not checked on a live installation) |

2. Set up the tools the team uses. Steven runs, in his own terminal:

   ```bash
   sdlc init --tools claude,cursor,codex,qwen --mcp --mode block
   ```

   Real output, shortened:

   ```text
     tools: Claude Code, Cursor, Codex CLI, Qwen Code
     Claude Code hooks: installed in .claude/settings.json
     Cursor hooks: installed in .cursor/hooks.json
     Codex hooks: installed in .codex/hooks.json
     Qwen Code hooks and deny rules: installed in .qwen/settings.json
     MCP server entries (sdlc) in .mcp.json: installed
     MCP server entries (sdlc) in .cursor/mcp.json: installed
     MCP server entries (sdlc) in .qwen/settings.json: installed
     MCP server entries (sdlc) in .codex/config.toml: installed

   Start a change:
     Claude Code  /sdlc:intent "<your idea>"   then /sdlc:next
     Cursor       /sdlc-intent "<your idea>"   then /sdlc-next
     Codex CLI    $sdlc-intent "<your idea>"   then $sdlc-next
     Qwen Code    /sdlc-intent "<your idea>"   then /sdlc-next
   ```

   `--tools all` sets up every tool; `--tools none` sets up none (for example when the Claude Code plugin is
   installed for the whole organization). Without `--tools`, sdlc uses the tools it detects, else `claude,opencode`.
   For a project that already has sdlc, change the set with `sdlc update --tools claude,cursor,codex`.

3. See where each tool's files live:

   | Tool | Workflows | Subagents | Hooks and rules | MCP servers |
   |---|---|---|---|---|
   | Claude Code | `.claude/skills/sdlc-<id>/SKILL.md` and `.claude/commands/sdlc/<id>.md` | `.claude/agents/sdlc-*.md` | `.claude/settings.json` | `.mcp.json` |
   | OpenCode | `.opencode/commands/sdlc-<id>.md`; skills from `.claude/skills/` (or `.opencode/skills/` without Claude) | `.opencode/agents/sdlc-*.md` | plugin `.opencode/plugins/sdlc.js` | `opencode.json` |
   | Cursor | `.cursor/skills/sdlc-<id>/SKILL.md` and `.cursor/commands/sdlc-<id>.md`; rule `.cursor/rules/sdlc.mdc` | `.cursor/agents/sdlc-*.md` | `.cursor/hooks.json` | `.cursor/mcp.json` |
   | Codex CLI | `.agents/skills/sdlc-<id>/SKILL.md` | `.codex/agents/sdlc-*.toml` | `.codex/hooks.json`, `.codex/rules/sdlc.rules` | `.codex/config.toml` |
   | Qwen Code | `.qwen/skills/sdlc-<id>/SKILL.md` and `.qwen/commands/sdlc-<id>.md` | `.qwen/agents/sdlc-*.md` | `hooks` and `permissions.deny` in `.qwen/settings.json` | `mcpServers` in `.qwen/settings.json` |
   | GigaCode | the same under `.gigacode/` | `.gigacode/agents/sdlc-*.md` | `.gigacode/settings.json` | `.gigacode/settings.json` |

   The subagents are the same six in every tool: `sdlc-verifier`, `sdlc-reviewer`, `sdlc-researcher`,
   `sdlc-simplifier`, `sdlc-health` and `sdlc-advocate`. Read-only roles stay read-only (in Codex,
   `sandbox_mode = "read-only"`).

4. Call a workflow. Only the spelling differs:

   | Tool | Next step | Write the intent | Health |
   |---|---|---|---|
   | Claude Code | `/sdlc:next` (the skill `/sdlc-next` works too) | `/sdlc:intent "…"` | `/sdlc:health` |
   | OpenCode, Cursor, Qwen Code, GigaCode | `/sdlc-next` | `/sdlc-intent "…"` | `/sdlc-health` |
   | Codex CLI | `$sdlc-next` (or name the skill in plain words) | `$sdlc-intent "…"` | `$sdlc-health` |

5. Commit the generated files. Every generated file is recorded in the manifest (`openspec/.sdlc/manifest.json`).
   `sdlc update` refreshes them and `sdlc uninstall` removes them. Your own entries in the shared files
   (`.cursor/hooks.json`, `.codex/config.toml`, `.qwen/settings.json` and the others) stay; only sdlc's are replaced or
   removed.

### You are done when

- `sdlc doctor` shows `sdlc.yaml  enforcement block, tools claude, cursor, codex, qwen`.
- Each tool's folder exists, and `/sdlc-help` (or `/sdlc:help`, `$sdlc-help`) lists the workflows in that tool.

### Pitfalls

- `tools` in `openspec/sdlc.yaml` is protected. In an agent session, `sdlc init` and `sdlc update` refuse to weaken
  the guard: fewer tools, a lower mode, `--no-hooks` or another `--cli` (`agent_cannot_weaken_guard`). Adding a tool
  is allowed; removing one is a person's job.
- Do not set up both the organization-wide Claude Code plugin and `--tools claude` in one project: the skills would be
  duplicated. With the plugin, use `--tools none` or the other tools only.
- Edited generated files are kept by `sdlc update`; `sdlc doctor` counts them ("edited locally"). `--force` restores
  them.


<a id="s10-2"></a>
## 10.2 What the hooks hold in each tool

*Steven, Ethan  ·  tasklet  · needs: [Section 10.1](#s10-1)*

Know which rules each tool's hooks enforce, and what the agent sees when a rule stops it.

### Procedure

1. See the hook points sdlc installs in each tool:

   | Tool | Before a tool call | Session start | Before stopping | Second layer for a person's commands |
   |---|---|---|---|---|
   | Claude Code | PreToolUse (Edit, Write, MultiEdit, NotebookEdit, Bash, PowerShell, MCP tools) | SessionStart | Stop | the CLI's own refusal |
   | OpenCode | the plugin's `tool.execute.before` | the plugin adds the context to the system prompt | none (OpenCode has no Stop hook) | the CLI's own refusal |
   | Cursor | preToolUse and beforeShellExecution | sessionStart | stop | the CLI's own refusal |
   | Codex CLI | PreToolUse | SessionStart | Stop | command rules in `.codex/rules/sdlc.rules` |
   | Qwen Code, GigaCode | PreToolUse | SessionStart | Stop | `permissions.deny` in `settings.json` (holds in YOLO mode too) |

2. Know what they enforce. In every tool:

   - **No code before the plan is approved** (rule `plan-gate`): an edit, and a write through the shell
     (`>`, `cp`, `Set-Content`, `apply_patch`, ...), to code is denied until a person approves the plan. Reads are
     never denied, and the change folder under `openspec/` stays writable.
   - **No person's decision in the agent's shell** (rule `separation-of-duties`): `sdlc approve`, `reject`, `waive`,
     `rework`, `takeover`, `track set`, `backlog move` and the others are denied.
   - **Protected files** (rules `guard-config`, `state-integrity`, `protected-path`): `openspec/sdlc.yaml`, the tool's
     own hook and MCP files, generated sdlc files, `.sdlc.yaml`, `roles.yaml`, the log.
   - **The session starts with the change**, its stage and who acts next.
   - **Verification before stopping**: with `enforcement.verify_before_stop: true`, the stop hook asks the agent to
     verify first (not in OpenCode).

3. See a denial. Ethan asks the agent to approve the review. The hook answers (real answer of `sdlc hook pre-tool`,
   the same text in Claude Code and in Codex):

   ```text
   [sdlc:separation-of-duties] Gate approvals, rejections, waivers, test unlocks, track selection and backlog priority
   are human decisions. Ask the responsible person to run `sdlc approve review --change add-task-list` in their own
   terminal, not in the agent chat (a `!` command there runs in the agent's shell and is refused too). Why, and what
   to do: `sdlc guide denials#separation-of-duties`.
   ```

   The agent reads it and gives Paul the command for his own terminal.

4. See the second and third layers. In Codex, the command rules in `.codex/rules/sdlc.rules` refuse `sdlc approve`
   too. In Qwen Code and GigaCode, `permissions.deny` refuses it, even in YOLO mode. In every tool, the CLI itself
   refuses inside an agent session ([Section 10.4](#s10-4)).

5. MCP servers at their stages (rule `mcp-stage`). The hook checks a call to a registry server against the stages in
   `mcp.servers.<name>.stages`. It knows the server from the tool name: `mcp__<server>__<tool>` in Claude Code,
   `<server>_<tool>` in OpenCode. In Cursor it works only when Cursor puts the server name into the tool name; a bare
   tool name is not checked.

### You are done when

- In each tool, with an approved intent and no plan, ask the agent to create `src/demo.js`: the edit is denied with
  `[sdlc:plan-gate]`.
- In each tool, ask the agent to run `sdlc approve intent`: it is refused.

### Pitfalls

- Deletes in Cursor are checked as the shell command that does them (`rm -r`): deleting `openspec/`, `.cursor/` or a
  guarded file is denied.
- In `warn` mode, process rules (`plan-gate`, `mcp-stage`) only remind; hard rules deny in `warn` too. See
  `sdlc guide denials`.
- A shell write the hook cannot read (a path built at run time, a write inside a script file) is not caught. The
  verify gate and the review still see the result before the release.


<a id="s10-3"></a>
## 10.3 Trust, failures and the limits of each tool

*Steven  ·  tasklet  · needs: [Section 10.2](#s10-2)*

Make each tool's hooks actually run, know what happens when a hook cannot run, and read the tool lines of
`sdlc doctor`.

### Procedure

1. Run the doctor after setup:

   ```bash
   sdlc doctor
   ```

   Real output for the four tools of [Section 10.1](#s10-1) (shortened):

   ```text
   ✓ claude hooks     installed in .claude/settings.json
   ! cursor           sdlc's hooks installed in .cursor/hooks.json; separation of duties in Cursor rests on
                      `CURSOR_AGENT=1` in the agent's terminals (documented for the Cursor CLI, not confirmed for the
                      IDE) ...; on Windows Cursor runs the hooks through PowerShell; Git Bash as the default shell can
                      break them
                      fix: Check that Cursor's agent terminals set `CURSOR_AGENT` (`echo $env:CURSOR_AGENT` in
                      PowerShell, `echo $CURSOR_AGENT` in sh).
   ! codex            sdlc's hooks installed in .codex/hooks.json, the command rules in .codex/rules/sdlc.rules; Codex
                      runs a project's hooks only in a trusted project and only after the user trusts sdlc's hooks in
                      `/hooks` ...
                      fix: Open `/hooks` in Codex and trust sdlc's hooks; never run the agent with `--ignore-rules` or
                      `features.hooks=false`.
   ! qwen             Hooks and permissions.deny installed in .qwen/settings.json; Project hooks run only in a trusted
                      folder; folder trust is off by default
                      fix: Turn folder trust on and trust this folder
   ✓ cli on PATH      `sdlc` is on PATH (hooks, plugin and skills call `sdlc`)
   ```

   The `!` lines are reminders that stay while the tool is set up; they are not errors.

2. Do the one-time trust step per tool:

   | Tool | What a person does once | Until then |
   |---|---|---|
   | Codex CLI | open `/hooks` in Codex and trust sdlc's hooks, after `sdlc init` and after an `sdlc update` that changed them | only the command rules and the CLI's refusal hold; the plan gate is not held for edits |
   | Qwen Code, GigaCode | turn folder trust on and trust the project folder | only `permissions.deny` and the CLI's refusal hold; the plan gate is not held for edits |
   | Cursor | check that the agent's terminal sets `CURSOR_AGENT` (`echo $env:CURSOR_AGENT`); on Windows, set Cursor's terminal to PowerShell if hooks misbehave | the hooks still deny a person's commands by their text; the CLI cannot tell the agent's terminal from yours |
   | Claude Code, OpenCode | nothing | — |

3. Know what happens when a hook cannot run:

   | Tool | The hook fails (crash, error, bad answer) | `sdlc` not on the PATH of the tool's shell |
   |---|---|---|
   | Claude Code | the check runs once more, then the call is blocked with the reason | the call goes through; `sdlc doctor` warns |
   | OpenCode | the plugin runs the check once more, then blocks the call | the call goes through; `sdlc doctor` warns |
   | Cursor | edits and shell commands are `failClosed`: if the hook cannot run, Cursor blocks the call | — |
   | Codex CLI | sdlc answers a JSON `deny` itself, so the call is blocked (since 0.14.3) | the call goes through; a hook longer than its 30-second timeout too |
   | Qwen Code, GigaCode | sdlc answers a JSON `deny` itself (since 0.14.3) | the call goes through; a timeout too |

   When sdlc has nothing to say (not an sdlc project, an internal error inside the CLI), it answers an explicit
   `allow`, so a broken guard never blocks every edit of an unrelated project.

4. Know the switches a person can flip, and the agent cannot. In Codex, `--ignore-rules` turns the command rules off
   and `features.hooks=false` turns the hooks off. In Claude Code, `disableAllHooks: true` turns every hook off
   (`sdlc doctor` warns). The agent cannot edit these settings: its edits and shell writes of `~/.claude/settings.json`,
   `~/.codex/config.toml`, `~/.codex/hooks.json`, `~/.qwen/settings.json` and `~/.gigacode/settings.json` are denied
   (rule `guard-config`).

5. Check GigaCode yourself before you rely on it. After `sdlc init --tools gigacode`, trust the folder, run
   `sdlc new demo`, and ask the agent to create `src/demo.txt`: it must be denied with `[sdlc:plan-gate]`. Ask it to
   run `sdlc approve intent`: it must be refused. `sdlc doctor` says `GigaCode support is experimental (formats
   only)`.

### You are done when

- `sdlc doctor` has no `✗` lines, and `cli on PATH` is `✓`.
- In Codex, `/hooks` lists sdlc's hooks as trusted.
- In Qwen Code, the folder is trusted and an early edit is denied.

### Pitfalls

- `sdlc` missing from the PATH of the tool's shell silently opens the gates in Claude Code, OpenCode, Codex and
  Qwen Code. It is the first thing to check when an agent edits code before the plan is approved.
- After `sdlc update` changes Codex's hooks, Codex skips them until a person trusts them again.
- Cursor's cloud agents skip some hooks (sessionStart); the gates are still checked by the CLI and the other hooks.
- sdlc was tested against Cursor's documented hook formats, not against a live Cursor installation.


<a id="s10-4"></a>
## 10.4 Agent markers and the SDLC-Agent trailer

*Laura, Steven  ·  tasklet  · needs: [Section 10.1](#s10-1); the git hook from `sdlc init`*

Know how sdlc tells an agent's shell from a person's, why a person's command refuses there, and how commits
made by agents are marked.

### Procedure

1. Know the markers. Each tool sets an environment variable in the agent's shell:

   | Tool | Marker in the agent's shell | Trailer value |
   |---|---|---|
   | Claude Code | `CLAUDECODE=1` | `claude-code` |
   | OpenCode | `OPENCODE=1`, `AGENT=1`; the plugin adds `SDLC_AGENT=opencode` | `opencode` |
   | Cursor | `CURSOR_AGENT=1` (documented for the Cursor CLI, not confirmed for the IDE) | `cursor` |
   | Codex CLI | `CODEX_CI=1` and `CODEX_SESSION_ID` | `codex` |
   | Qwen Code, GigaCode | `QWEN_CODE=1` or `QWEN_CODE_SESSION_ID` | `qwen` |
   | any other tool | `SDLC_AGENT=<name>`, set by you | `<name>` |

2. See the CLI refuse in an agent's shell. A person's command run there fails (real output from a Claude Code shell):

   ```text
   Error: `sdlc approve` records a human decision and cannot run inside an agent session (claude-code).
   fix: Run it yourself in your own terminal, not in the agent chat (a `!` command there runs in the agent's shell):
   sdlc approve spec --change add-task-list
   ```

   This holds even if a hook did not run. Clearing a marker in the agent's command (`env -u CLAUDECODE ...`,
   `unset`, `set QWEN_CODE=`) is denied by the hook, rule `agent-marker`.

3. See the trailer. `sdlc init` and `sdlc update` install a `prepare-commit-msg` git hook. A commit made in an agent's
   shell gets one line (real `git log -1` from Oliver's Claude Code session):

   ```text
   List the tasks of a project

   SDLC-Change: add-task-list
   SDLC-Task: 1.2
   SDLC-Agent: claude-code
   ```

   A person's commit is never touched. The hook works with `--no-verify` too.

4. Read the share. `sdlc audit` prints `agent commits: 11 of 17 (SDLC-Agent trailer)`; the dashboard shows the same.

5. If the project already has its own `prepare-commit-msg` hook, sdlc leaves it. `sdlc doctor` then shows the one line
   to add to your hook to call sdlc's. A hooks folder shared by every repository (`core.hooksPath` outside the project)
   is never written.

### You are done when

- `git log --format=%B -1` on an agent's commit shows `SDLC-Agent:` with the tool's value.
- `sdlc doctor` shows `✓ git hook  prepare-commit-msg in .git/hooks/prepare-commit-msg`.

### Pitfalls

- A commit made outside the agent's shell is a person's commit, even if the agent wrote the code.
- Commits from GigaCode carry `SDLC-Agent: qwen`: the audit cannot tell GigaCode from Qwen Code.
- If a Cursor build sets no `CURSOR_AGENT`, the CLI treats the agent's terminal as a person's. The hooks still deny a
  person's commands by their text, and the agent's commits are not marked.


<a id="s10-5"></a>
## 10.5 One MCP registry for every tool

*Steven  ·  tasklet  · needs: [Section 10.1](#s10-1); the tokens in the environment of each machine*

Describe the team's MCP servers once in `openspec/sdlc.yaml` and let sdlc write them into every tool's
format.

### Procedure

1. Steven adds the registry to `openspec/sdlc.yaml` (a protected file: a person edits it):

   ```yaml
   mcp:
     serve: true
     servers:
       github:
         type: http
         url: https://api.githubcopilot.com/mcp/
         headers: { Authorization: "Bearer ${GITHUB_TOKEN}" }
         stages: [plan, build, test, deploy]
       knowledge:
         type: http
         url: https://knowledge.northwind.example/mcp
         stages: [plan, design, build]
       telegram:
         type: stdio
         command: [npx, -y, example-telegram-mcp]
         env: { TELEGRAM_BOT_TOKEN: "${TELEGRAM_BOT_TOKEN}" }
         stages: [deploy]
   ```

   The `knowledge` URL and the `telegram` package are examples; use your team's own.

2. Lay it out for every tool:

   ```bash
   sdlc update
   ```

3. See what each tool got (real files after `sdlc update`):

   `.codex/config.toml`:

   ```toml
   [mcp_servers.github]
   url = "https://api.githubcopilot.com/mcp/"
   bearer_token_env_var = "GITHUB_TOKEN"

   [mcp_servers.telegram]
   command = "npx"
   args = ["-y", "example-telegram-mcp"]
   env_vars = ["TELEGRAM_BOT_TOKEN"]
   ```

   `.cursor/mcp.json` (shortened):

   ```json
   "github": { "url": "https://api.githubcopilot.com/mcp/",
               "headers": { "Authorization": "Bearer ${env:GITHUB_TOKEN}" } },
   "telegram": { "command": "npx", "args": ["-y", "example-telegram-mcp"],
                 "env": { "TELEGRAM_BOT_TOKEN": "${env:TELEGRAM_BOT_TOKEN}" } }
   ```

   `.qwen/settings.json` uses `httpUrl` for an http server and `${GITHUB_TOKEN}`; `.mcp.json` (Claude Code) keeps
   `type: http` and `${GITHUB_TOKEN}`; `opencode.json` uses `type: remote` / `type: local` and `{env:GITHUB_TOKEN}`.

   | Registry | Claude Code | OpenCode | Cursor | Codex | Qwen Code, GigaCode |
   |---|---|---|---|---|---|
   | secret `${VAR}` | `${VAR}` | `{env:VAR}` | `${env:VAR}` | `env_vars`, `env_http_headers`, `bearer_token_env_var` | `${VAR}` |

4. Check that the servers answer:

   ```bash
   sdlc mcp check
   ```

   It connects to each server, lists its tools, marks the unreachable ones, and warns about a server whose tools can
   write files. Keep such a server out of the registry: it could change files behind the hook's back.

5. Know who uses which server when. The agent calls `github` while it plans, builds, tests and deploys (issues, pull
   requests, workflow runs); the `knowledge` server while it plans, designs and builds; `telegram` only at deploy.
   The CLI itself calls servers for `verify.mcp`, `release.mcp` and `events`; stages limit only the agent.

### You are done when

- The `github`, `knowledge` and `telegram` entries exist in every tool's file, next to `sdlc`.
- No file contains a literal token.
- `sdlc mcp check` lists the tools of each reachable server.

### Pitfalls

- A literal secret in `env` or `headers` is refused (`mcp_secret_literal`); nothing is written, and the message names
  the server and the key, never the value.
- A server removed from the registry disappears from every tool's file on the next `sdlc update`. A server someone
  added by hand is never touched.
- Each person needs the tokens in their own environment (`GITHUB_TOKEN`, `TELEGRAM_BOT_TOKEN`); the files only refer
  to them.


<a id="s10-6"></a>
## 10.6 A mixed team at Northwind

*Steven, Oliver, a contractor, Ethan, Paul  ·  billing-api  · needs: [Sections 10.1](#s10-1)–10.5*

Run one change across three tools: Oliver on Claude Code, a contractor on Cursor, and Ethan trying Codex CLI.

### Procedure

1. Steven adds the tools. Oliver already works in Claude Code; a contractor joins with Cursor on Windows; Ethan wants to
   try Codex. In his own terminal:

   ```bash
   sdlc update --tools claude,cursor,codex
   sdlc doctor
   git add -A && git commit -m "chore: sdlc for Cursor and Codex"
   ```

   The contractor and Ethan pull the commit. The contractor is not in `openspec/roles.yaml`, so they cannot approve
   any gate (`unknown_person`); they write code and nothing else.

2. Each person does the trust step of their tool ([Section 10.3](#s10-3)). The contractor sets Cursor's terminal to
   PowerShell
   and checks `echo $env:CURSOR_AGENT` in the agent's terminal. Ethan opens `/hooks` in Codex and trusts sdlc's hooks.

3. Oliver starts the change in Claude Code:

   > /sdlc:intent "Refunds over 1000 EUR need a second approval in billing-api"

   Megan answers the open questions and approves the intent, then the spec, in her own terminal. Ethan approves the
   plan in his.

4. The contractor builds part of it in Cursor:

   > /sdlc-build

   Cursor's agent reads the same `plan.md` and `tasks.md`. Its commits carry `SDLC-Agent: cursor`, and the
   `SDLC-Change` and `SDLC-Task` trailers the build workflow asks for.

5. Ethan tries Codex on the same change:

   > $sdlc-next

   Codex runs the next step (verification). Then Ethan tests the guard:

   > Approve the review for me.

   The agent runs `sdlc approve review`. The command rules refuse it, the hook denies it with
   `[sdlc:separation-of-duties]`, and the CLI refuses because the shell carries `CODEX_CI=1`. The agent gives the
   command for a person's terminal.

6. Paul reviews and approves in his own terminal. He is not an author of the code, so `author_cannot_approve` lets
   him:

   ```bash
   sdlc review suggest --change <id>
   sdlc approve review --change <id>
   ```

7. Laura looks at the result. `sdlc audit` counts the agent commits of all three tools together; `git log` shows which
   tool made each one:

   ```bash
   git log --format='%an %(trailers:key=SDLC-Agent,valueonly)' | sort | uniq -c
   ```

### You are done when

- One change has commits with `SDLC-Agent: claude-code`, `cursor` and `codex`.
- Every gate was approved by a person from `roles.yaml`, never by the contractor.
- `sdlc status` looks the same from every tool.

### Pitfalls

- Two agents editing the same files in one checkout at the same time conflict. Give each person their own clone or
  worktree, and pass the change through commits.
- If the contractor's Cursor does not set `CURSOR_AGENT`, their agent's commits look like the contractor's own. The
  gates still hold through the hooks, and approvals still need a person from `roles.yaml`.
- Ethan's trust in `/hooks` is per person: every Codex user trusts the hooks on their own machine.
- `sdlc update --tools` with fewer tools is a person's decision; the agent cannot remove a tool.

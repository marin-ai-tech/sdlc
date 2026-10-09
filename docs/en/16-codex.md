# 16. Codex CLI: setup, what is enforced, use cases

sdlc 0.14.0 supports OpenAI's Codex CLI as a fourth tool next to Claude Code, OpenCode and Cursor. The process is the
same — the same workflows, subagents, gates and checks — and Codex's own hooks and command rules hold the gates.
It was checked live against codex-cli 0.158.0 on Windows.

## 16.1. Setup

```bash
sdlc init --tools codex --mcp             # or together: --tools claude,codex
sdlc doctor
```

| What | Where |
|---|---|
| Workflows as skills | `.agents/skills/sdlc-<workflow>/SKILL.md` (`$sdlc-status`, `$sdlc-next`, … or by name) |
| Subagents | `.codex/agents/sdlc-<agent>.toml` (`sandbox_mode = "read-only"` where the role is) |
| Hooks | `.codex/hooks.json`: SessionStart, PreToolUse, Stop |
| A person's commands refused | `.codex/rules/sdlc.rules`: one `forbidden` rule per command |
| The sdlc MCP server and the team's servers | `[mcp_servers.<name>]` in `.codex/config.toml` |

Every generated file is recorded in the manifest; `sdlc update` refreshes them and `sdlc uninstall` removes them.
sdlc's entries in `.codex/hooks.json` and its own `[mcp_servers.*]` tables in `.codex/config.toml` sit next to yours;
only sdlc's are replaced or removed.

**Trust the hooks once.** Codex runs a project's hooks only in a trusted project, and a new or changed hook is skipped
until you trust it: open `/hooks` in Codex and trust sdlc's hooks after `sdlc init` and after an `sdlc update` that
changed them. `sdlc doctor` reminds you.

## 16.2. What Codex enforces

| Rule | In Codex |
|---|---|
| No code edits before the plan is approved | PreToolUse denies an `apply_patch` and a shell write (`Set-Content`, `>`, `cp`, …) to code |
| No person's decision in the agent's shell (`sdlc approve`, `rework`, …) | PreToolUse denies it; the command rules refuse it too |
| Protected files (`sdlc.yaml`, `.codex/hooks.json`, `.codex/config.toml`, the rules, generated files, state) | `deny` |
| The session starts with the change, its stage and who acts next | SessionStart `additionalContext` |
| Verification before stopping | Stop asks the agent to follow up |
| `sdlc approve` refuses inside the agent session | `CODEX_CI=1` and `CODEX_SESSION_ID` in the agent's shell |

On Windows Codex edits files with PowerShell commands, so sdlc reads the files a command writes. Since 0.14.0 this
holds for every tool: a write through the shell to code before the plan is approved is denied like an edit, and a
write to a locked test like an edit of it. Reads are never denied, and the change folder under `openspec/` stays
writable.

## 16.3. Use cases

### A team with Claude Code and Codex

```bash
sdlc init --tools claude,codex --mcp
```

Both read the same `openspec/` artifacts, gates and backlog; a change started in one continues in the other. The
command spelling differs: `/sdlc:next` in Claude Code, `$sdlc-next` in Codex.

### The agent tries to start coding too early

With the intent approved but no plan yet, Codex sends `apply_patch` to add `src/app.js`. The hook denies it with
`[sdlc:plan-gate] … see sdlc guide denials#plan-gate`; when the agent tries `Set-Content -LiteralPath src/app.js`
instead, that is denied too. The agent writes the plan (`$sdlc-plan`) and stops at the gate for the engineer.

### "Approve it for me"

A developer asks Codex to approve the intent. The agent runs `sdlc approve intent`: the hook denies it (separation of
duties), the command rules refuse it, and the CLI itself refuses because the shell carries `CODEX_CI=1`. The agent
gives the developer the command to run in their own terminal.

## 16.4. Limits we accept

- **Trust.** Untrusted hooks do not run. Until you trust them in `/hooks`, only the command rules and the CLI's own
  refusal hold; the plan gate is not held for edits.
- **Turning it off.** `--ignore-rules` turns the command rules off and `features.hooks=false` turns the hooks off. A
  person can do that; the agent cannot: its edits and shell writes of `~/.codex/config.toml` and
  `~/.codex/hooks.json` (or under `CODEX_HOME`) are denied. The CLI still refuses a person's decision in the
  agent's shell by its marker.
- **A hook that cannot run.** Codex lets a call through when its hook fails in any way — a non-zero exit (exit 2
  too), a crash, bad JSON or a timeout; only a JSON `deny` blocks (checked live with codex-cli 0.158.0 on Windows,
  where Codex runs hooks through Windows PowerShell). So when sdlc's pre-tool hook fails to load or throws, the
  sdlc command answers a `deny` itself, and the call is blocked until `sdlc doctor` is clean. Two cases still let
  the call through: `sdlc` not installed or not on the PATH of Codex's shell (`sdlc doctor` checks it), and a hook
  that runs longer than its 30-second timeout.
- **Shell writes** are read from the command text: redirections, `tee`, `cp`, `mv`, `install`, `sed -i`,
  `perl -i`, `touch`, `truncate`, `dd of=`, PowerShell's `Set-Content`, `Add-Content`, `Clear-Content`,
  `Out-File`, `Tee-Object`, `New-Item`, `Copy-Item`, `Move-Item`, `Rename-Item` and the .NET `File` writers, inside
  `bash -c`, `cmd /c`, `powershell -Command`, `iex` and `Start-Process` too; `git checkout -- <paths>`,
  `git restore`, `git mv`, `git apply` and `patch` (the files the patch names), downloads (`curl -o`, `wget -O`,
  `Invoke-WebRequest -OutFile`), file writes in `node -e` and `python -c`, and an `apply_patch` run through the
  shell. Quoted text and here-strings are content, not commands. A write inside a script file, a computed path
  (`$DIR/x`) or `git checkout <paths>` without `--` is not read; the verify gate and review still see the result
  before release.
- **The command rules** match the command's first words: your `cli` setting (`npx --no-install sdlc approve`),
  and with the plain `sdlc` also its older alias and the Windows `.cmd` shims; they also refuse
  `sdlc adopt --apply`. Another spelling is caught by the hook and the CLI, not by the rules.

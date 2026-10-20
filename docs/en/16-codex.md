# Codex CLI setup and guardrails

Use this page to set up sdlc in Codex CLI and understand which gates its hooks and command rules hold. You can also
check the trust and headless limits before relying on those protections.

## On this page

- [Set up Codex](#-set-up-codex)
- [Understand the guardrails](#-understand-the-guardrails)
- [Try common workflows](#-try-common-workflows)
- [Check the limits](#-check-the-limits)
- [Terms](#-terms)
- [See also](#-see-also)

Codex uses the same workflows, subagents, gates and checks as Claude Code, OpenCode and Cursor. Its hooks and command
rules hold those gates. The hook behaviour was checked live against codex-cli on Windows.

## 🚀 Set up Codex

Run setup and then use doctor to check it:

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

Every generated file is recorded in the manifest. `sdlc update` refreshes them, and `sdlc uninstall` removes them.
Your own entries in `.codex/hooks.json` stay in place. The same applies to your `[mcp_servers.*]` tables in
`.codex/config.toml`; sdlc replaces or removes only its own entries.

> [!IMPORTANT]
> Open `/hooks` and trust sdlc's hooks after `sdlc init` or an `sdlc update` that changes them.

Codex runs project hooks only in a trusted project. It skips each new or changed hook until you trust it.
`sdlc doctor` reminds you.

Headless `codex exec` may skip project hooks even after that trust. sdlc's command rules still apply. To run sdlc's
hooks headless, use `--dangerously-bypass-hook-trust` only for hooks you have vetted.

## 🛡️ Understand the guardrails

Codex checks writes and decisions through hooks, command rules and an agent-session marker:

| Rule | In Codex |
|---|---|
| Code edits before plan approval | PreToolUse denies `apply_patch` and shell writes to code |
| A person's decision in the agent's shell | PreToolUse and command rules refuse it |
| Protected files (`sdlc.yaml`, `.codex/hooks.json`, `.codex/config.toml`, the rules, generated files, state) | `deny` |
| The session starts with the change, its stage and who acts next | SessionStart `additionalContext` |
| Verification before stopping | Stop asks the agent to follow up |
| `sdlc approve` refuses inside the agent session | `CODEX_CI=1` and `CODEX_SESSION_ID` in the agent's shell |

On Windows, Codex edits files with PowerShell commands. sdlc reads the files a command writes through every tool.
A shell write to code before plan approval is denied like an edit. A shell write to a locked test is also denied.
Reads are never denied, and the change folder under `openspec/` stays writable.
Shell writes include `Set-Content`, `>` and `cp`. A person's commands include `sdlc approve` and `rework`.

`mcp-stage` checks MCP calls only when Codex reports `mcp__<server>__<tool>` or `<server>_<tool>`.
Codex's MCP tool names are not verified live.

## 💡 Try common workflows

These examples show a shared change and two agent actions that need a gate decision.

### A team with Claude Code and Codex

```bash
sdlc init --tools claude,codex --mcp
```

Both read the same `openspec/` artifacts, gates and backlog. A change started in one continues in the other.
Use `/sdlc:next` in Claude Code and `$sdlc-next` in Codex.

### The agent tries to start coding too early

With the intent approved but no plan yet, Codex sends `apply_patch` to add `src/app.js`. The hook denies it with
`[sdlc:plan-gate] … see sdlc guide denials#plan-gate`; when the agent tries `Set-Content -LiteralPath src/app.js`
instead, that is denied too. The agent writes the plan (`$sdlc-plan`) and stops at the gate for the engineer.

### "Approve it for me"

A developer asks Codex to approve the intent. The agent runs `sdlc approve intent`: the hook denies it (separation of
duties), the command rules refuse it, and the CLI itself refuses because the shell carries `CODEX_CI=1`. The agent
gives the developer the command to run in their own terminal.

## 🛡️ Check the limits

These limits tell you when a hook or command rule may not hold. Check them before depending on an unattended run.

- **Trust.** Untrusted hooks do not run. Until you trust them in `/hooks`, only the command rules and the CLI's own
  refusal hold; the plan gate is not held for edits.
- **Turning it off.** `--ignore-rules` turns the command rules off and `features.hooks=false` turns the hooks off. A
  person can do that; the agent cannot: its edits and shell writes of `~/.codex/config.toml` and
  `~/.codex/hooks.json` (or under `CODEX_HOME`) are denied. The CLI still refuses a person's decision in the
  agent's shell by its marker.
- **A hook that cannot run:** Codex lets a call through after a non-zero exit (including exit 2), a crash,
  bad JSON or a timeout. Only a JSON `deny` blocks. This behaviour was checked live on Windows, where Codex runs
  hooks through Windows PowerShell. If sdlc's pre-tool hook fails to load or throws, the sdlc command answers
  `deny` itself. The call stays blocked until `sdlc doctor` is clean. Two cases still let it through: `sdlc` is
  missing from Codex's shell PATH, or the hook exceeds its 30-second timeout. `sdlc doctor` checks the PATH.
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

## 📚 Terms

The [glossary](glossary.md) defines [gate](glossary.md), [stage](glossary.md) and [subagent](glossary.md).

## 📚 See also

- [Integrations](10-integrations.md) — see how sdlc registers MCP servers.
- [User guide](05-guide.md) — follow the change lifecycle.
- [Cursor IDE](15-cursor.md) — compare another tool's setup and guardrails.

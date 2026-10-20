# Cursor IDE setup and guardrails

Use this page to set up sdlc in Cursor and see how its hooks protect a change. The examples show where the agent stops
and a person takes the next step.

## On this page

- [Set up Cursor](#-set-up-cursor)
- [Understand the guardrails](#-understand-the-guardrails)
- [Try common workflows](#-try-common-workflows)
- [Limits we accept](#154-limits-we-accept)
- [Terms](#-terms)
- [See also](#-see-also)

## 🚀 Set up Cursor

Cursor uses the same workflows, subagents, gates and checks as Claude Code and OpenCode. Run setup, then check the
generated files with doctor:

```bash
sdlc init --tools cursor --mcp            # or together: --tools claude,cursor
sdlc doctor
```

| What | Where |
|---|---|
| Workflows as skills | `.cursor/skills/sdlc-<workflow>/SKILL.md` |
| Thin commands that run them | `.cursor/commands/sdlc-<workflow>.md` (`/sdlc-status`, `/sdlc-next`, …) |
| Subagents | `.cursor/agents/sdlc-<agent>.md` (read-only where the role is) |
| A rule about the process | `.cursor/rules/sdlc.mdc` (always applied) |
| The sdlc MCP server | `.cursor/mcp.json` (with `--mcp`) |
| Hooks | `.cursor/hooks.json`: sessionStart, preToolUse, beforeShellExecution, stop |

Every generated file is in the manifest. `sdlc update` refreshes them, and `sdlc uninstall` removes them.
Your own entries in `.cursor/hooks.json` stay in place when sdlc replaces or removes its entries.

## 🛡️ Understand the guardrails

Cursor's hooks hold the gates where Cursor allows them. This table shows each rule and the hook or marker that applies:

| Rule | In Cursor |
|---|---|
| No code edits before the plan is approved | preToolUse on Write and Delete answers `deny` |
| No person's decision in the agent's shell (`sdlc approve`, `rework`, …) | beforeShellExecution answers `deny` |
| Protected files (`sdlc.yaml`, `.cursor/hooks.json`, `.cursor/mcp.json`, generated sdlc files, state) | `deny` |
| MCP servers only at their stages | preToolUse on `MCP:<tool>`, when Cursor names the server in the tool name |
| The session starts with the change, its stage and who acts next | sessionStart `additional_context` |
| Verification before stopping | stop asks the agent to follow up |
| `sdlc approve` refuses inside the agent session | `CURSOR_AGENT=1` in the agent's terminal |

The edit hook is `failClosed`: Cursor blocks an edit if the hook cannot run. When sdlc has nothing to say, it returns
an explicit `allow`. This includes a non-sdlc project or an internal error.

## 💡 Try common workflows

These examples show how a shared change moves between tools and where a gate stops the agent.

### A team with both Claude Code and Cursor

Half the team uses Claude Code, and half uses Cursor. One setup serves both:

```bash
sdlc init --tools claude,cursor --mcp
```

Both read the same `openspec/` artifacts, gates and backlog. A change started in Claude Code continues in Cursor.
The commands are `/sdlc:next` in Claude Code and `/sdlc-next` in Cursor.

### The agent tries to start coding too early

The intent is approved, but the plan is not. In agent mode, Cursor tries to write `src/export.ts`.
The preToolUse hook answers `deny` with `[sdlc:plan-gate] … see sdlc guide denials#plan-gate`.
The agent reads the reason, writes the plan with `/sdlc-plan` and stops for the engineer's decision.

### "Approve it for me"

A developer asks Cursor to approve the spec. The agent tries `sdlc approve spec` in its terminal.
beforeShellExecution denies it for separation of duties. The CLI also refuses because the terminal has
`CURSOR_AGENT=1`. The agent gives the developer a command to run in their own terminal.

## 15.4. Limits we accept

Check these limits when you rely on Cursor's hooks. The section heading stays stable for links from the integration
guide.

- **The agent marker:** Cursor documents `CURSOR_AGENT=1` for its CLI; the IDE marker is unconfirmed.
  If a build omits it, the CLI cannot distinguish the agent's terminal from yours. Hooks still deny commands by
  their text, and `sdlc doctor` warns about this separation-of-duties dependency.
- **Windows:** Cursor runs hooks through PowerShell. Git Bash as the terminal can break some hook commands.
  `sdlc doctor` says so on Windows. If hooks misbehave, set Cursor's terminal to PowerShell.
- **Cloud agents:** some hooks, including sessionStart, are skipped. The CLI and remaining hooks still check gates.
- **MCP stages:** a Cursor tool name does not always identify its server. sdlc does not trust agent-written
  arguments for this check, so it does not stage-check a bare tool name.
- **Deletes:** the shell command that deletes, such as `rm -r`, is checked. Deleting `openspec/`, `.cursor/` or
  a guarded file is denied.
- **Live testing:** sdlc follows Cursor's documented hook formats. It has not been checked against a live Cursor
  installation.

## 📚 Terms

The [glossary](glossary.md) defines [gate](glossary.md), [stage](glossary.md) and [subagent](glossary.md).

## 📚 See also

- [Integrations](10-integrations.md) — see how sdlc shares MCP servers with tools.
- [User guide](05-guide.md) — follow the gates in a change.
- [Codex CLI](16-codex.md) — compare another tool's setup and guardrails.

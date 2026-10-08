# 15. Cursor IDE: setup, what is enforced, use cases

sdlc 0.13.0 supports Cursor as a third tool next to Claude Code and OpenCode. The process is the same — the same
workflows, subagents, gates and checks — and Cursor's own hooks hold the gates as far as Cursor lets them.

## 15.1. Setup

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

Every generated file is recorded in the manifest; `sdlc update` refreshes them and `sdlc uninstall` removes them.
sdlc's entries in `.cursor/hooks.json` sit next to your own; only sdlc's are replaced or removed.

## 15.2. What Cursor enforces

| Rule | In Cursor |
|---|---|
| No code edits before the plan is approved | preToolUse on Write and Delete answers `deny` |
| No person's decision in the agent's shell (`sdlc approve`, `rework`, …) | beforeShellExecution answers `deny` |
| Protected files (`sdlc.yaml`, `.cursor/hooks.json`, `.cursor/mcp.json`, generated sdlc files, state) | `deny` |
| MCP servers only at their stages | preToolUse on `MCP:<tool>`, when Cursor names the server in the tool name |
| The session starts with the change, its stage and who acts next | sessionStart `additional_context` |
| Verification before stopping | stop asks the agent to follow up |
| `sdlc approve` refuses inside the agent session | `CURSOR_AGENT=1` in the agent's terminal |

The hook for edits is `failClosed`: if it cannot run, Cursor blocks the edit. When sdlc has nothing to say (not an
sdlc project, an internal error), it answers an explicit `allow`, so silence never blocks your work.

## 15.3. Use cases

### A team with both Claude Code and Cursor

Half the team uses Claude Code, half uses Cursor. One setup serves both:

```bash
sdlc init --tools claude,cursor --mcp
```

Both read the same `openspec/` artifacts, the same gates and the same backlog; a change started in Claude Code
continues in Cursor. The only difference people see is the command spelling: `/sdlc:next` in Claude Code, `/sdlc-next`
in Cursor.

### The agent tries to start coding too early

In Cursor's agent mode, with the intent approved but no plan yet, the agent opens `src/export.ts` to write code. The
preToolUse hook answers `deny` with the reason `[sdlc:plan-gate] … see sdlc guide denials#plan-gate`; the agent reads
it, writes the plan instead (`/sdlc-plan`), and stops at the gate for the engineer.

### "Approve it for me"

A developer asks the Cursor agent to approve the spec. The agent tries `sdlc approve spec` in its terminal:
beforeShellExecution denies it (separation of duties), and the CLI itself refuses too, because the agent's terminal has
`CURSOR_AGENT=1`. The agent gives the developer the command to run in their own terminal.

## 15.4. Limits we accept

- **The agent marker.** Cursor documents `CURSOR_AGENT=1` for its CLI; for the IDE it is not confirmed. If a Cursor
  build does not set it, the CLI cannot tell the agent's terminal from yours — the hooks still deny the commands by
  their text, but `sdlc doctor` warns that separation of duties in Cursor rests on this marker.
- **Windows.** Cursor runs hooks through PowerShell; with Git Bash as the terminal some hook commands can break.
  `sdlc doctor` says so on Windows. If hooks misbehave, set Cursor's terminal to PowerShell.
- **Cloud agents.** Cursor's cloud agents skip some hooks (sessionStart); the gates are still checked by the CLI and by
  the remaining hooks.
- **MCP stages.** Cursor's tool name does not always say which server a tool belongs to, and sdlc never trusts the
  tool's own arguments for that (the agent writes them); a bare tool name is not checked by stage.
- **Deletes** are checked as the shell command that would do them (`rm -r`), so deleting `openspec/`, `.cursor/` or a
  guarded file is denied.
- sdlc was tested against Cursor's documented hook formats, not against a live Cursor installation.

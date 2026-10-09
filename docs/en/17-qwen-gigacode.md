# 17. Qwen Code and GigaCode: setup, what is enforced, use cases

sdlc 0.14.1 supports Qwen Code (Alibaba) and GigaCode CLI (Sber) next to Claude Code, OpenCode, Cursor and Codex CLI.
GigaCode CLI behaves as a fork of Qwen Code that keeps its files under `.gigacode/`, so one adapter serves both. The
process is the same — the same workflows, subagents, gates and checks — and the tool's own hooks and deny rules hold
the gates.

**GigaCode support is experimental.** It follows GigaCode's documented formats and Qwen Code's behaviour; it has not
been checked against a live GigaCode installation. Qwen Code support follows Qwen Code's documentation and sources.

## 17.1. Setup

```bash
sdlc init --tools qwen --mcp              # or: --tools gigacode, or together with others: --tools claude,qwen
sdlc doctor
```

| What | Qwen Code | GigaCode |
|---|---|---|
| Workflows as skills | `.qwen/skills/sdlc-<workflow>/SKILL.md` | `.gigacode/skills/sdlc-<workflow>/SKILL.md` |
| Thin commands that run them (`/sdlc-status`, …) | `.qwen/commands/sdlc-<workflow>.md` | `.gigacode/commands/sdlc-<workflow>.md` |
| Subagents (read-only roles cannot write files) | `.qwen/agents/sdlc-<agent>.md` | `.gigacode/agents/sdlc-<agent>.md` |
| Hooks: SessionStart, PreToolUse, Stop | `hooks` in `.qwen/settings.json` | `hooks` in `.gigacode/settings.json` |
| A person's commands refused | `permissions.deny` in the same file | the same |
| The sdlc MCP server and the team's servers | `mcpServers` in the same file | the same |

Every generated file is recorded in the manifest; `sdlc update` refreshes them and `sdlc uninstall` removes them.
sdlc's hooks, deny entries and MCP servers in `settings.json` sit next to your own; only sdlc's are replaced or removed.

**Trust the folder.** Qwen Code loads a project's hooks only in a trusted folder, and folder trust is off by default:
turn folder trust on and trust the project folder. `sdlc doctor` reminds you. The deny rules hold without it.

## 17.2. What is enforced

| Rule | In Qwen Code and GigaCode |
|---|---|
| No code edits before the plan is approved | PreToolUse denies `write_file`, `edit` and a shell write to code |
| No person's decision in the agent's shell (`sdlc approve`, `rework`, …) | PreToolUse denies it; `permissions.deny` refuses it too, also in YOLO mode |
| Protected files (`sdlc.yaml`, `settings.json`, generated files, state) | `deny` |
| The session starts with the change, its stage and who acts next | SessionStart `additionalContext` |
| Verification before stopping | Stop asks the agent to follow up |
| `sdlc approve` refuses inside the agent session | `QWEN_CODE=1` in the agent's shell |

An agent cannot edit or write through the shell `~/.qwen/settings.json` or `~/.gigacode/settings.json`, which could
turn the hooks off for every project.

## 17.3. Use cases

### A team with Claude Code and Qwen Code

```bash
sdlc init --tools claude,qwen --mcp
```

Both read the same `openspec/` artifacts, gates and backlog; a change started in one continues in the other. The
command spelling differs: `/sdlc:next` in Claude Code, `/sdlc-next` in Qwen Code and GigaCode.

### An agent in YOLO mode tries to approve its own plan

A developer runs Qwen Code in YOLO mode and asks it to finish the feature. The agent runs `sdlc approve plan`:
`permissions.deny` refuses it even in YOLO mode, the hook denies it with `[sdlc:separation-of-duties]`, and the CLI
refuses because the shell carries `QWEN_CODE=1`. The agent gives the developer the command to run themselves.

### GigaCode in a regulated team

The team works in GigaCode. `sdlc init --tools gigacode --mcp` sets up the same gates under `.gigacode/`; `sdlc
doctor` says the support is experimental. Before relying on it, check on your installation that an edit before the
plan is denied (see 17.4).

## 17.4. Limits we accept

- **Folder trust.** Untrusted folders do not run the project's hooks. Until the folder is trusted, only the deny rules
  and the CLI's own refusal hold; the plan gate is not held for edits.
- **A hook that cannot run.** Qwen Code lets the call through when a hook fails, times out or answers bad JSON. Keep
  `sdlc` on the PATH of the tool's shell (`sdlc doctor` checks it).
- **The GigaCode marker.** GigaCode's own session variable is not documented. sdlc treats `QWEN_CODE=1` as the agent's
  marker for both tools, so commits from GigaCode carry `SDLC-Agent: qwen`. If a GigaCode build sets no marker, the CLI
  cannot tell the agent's shell from yours; the hooks and deny rules still refuse a person's commands by their text.
- **Windows.** Qwen Code runs hooks through cmd.exe; sdlc's hook commands work there.
- **Checking GigaCode yourself.** After `sdlc init --tools gigacode`, trust the folder, start a change with
  `sdlc new demo` and ask the agent to create `src/demo.txt`: the edit must be denied with `[sdlc:plan-gate]`. Ask it
  to run `sdlc approve intent`: it must be refused.

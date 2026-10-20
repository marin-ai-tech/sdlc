# Qwen Code and GigaCode setup and guardrails

Use this page to set up sdlc with Qwen Code or GigaCode. You can see what their hooks enforce and what to check before
relying on GigaCode's experimental support.

## On this page

- [Set up the tools](#-set-up-the-tools)
- [Understand the guardrails](#-understand-the-guardrails)
- [Try common workflows](#-try-common-workflows)
- [Check the limits](#-check-the-limits)
- [Terms](#-terms)
- [See also](#-see-also)

Qwen Code and GigaCode use the same workflows, subagents, gates and checks as the other supported tools.
GigaCode keeps its files under `.gigacode/`, and one adapter serves both. Their hooks and deny rules hold the gates.

**GigaCode support is experimental.** It follows GigaCode's documented formats and Qwen Code's behaviour; it has not
been checked against a live GigaCode installation. Qwen Code support follows Qwen Code's documentation and sources.

## 🚀 Set up the tools

Run setup for your tool, then use doctor to check it:

```bash
sdlc init --tools qwen --mcp              # or: --tools gigacode, or together with others: --tools claude,qwen
sdlc doctor
```

| What | Qwen Code | GigaCode |
|---|---|---|
| Workflows as skills | `.qwen/skills/sdlc-<workflow>/SKILL.md` | `.gigacode/skills/sdlc-<workflow>/SKILL.md` |
| Thin commands | `.qwen/commands/sdlc-<workflow>.md` | `.gigacode/commands/sdlc-<workflow>.md` |
| Subagents (read-only roles cannot write files) | `.qwen/agents/sdlc-<agent>.md` | `.gigacode/agents/sdlc-<agent>.md` |
| Hooks: SessionStart, PreToolUse, Stop | `hooks` in `.qwen/settings.json` | `hooks` in `.gigacode/settings.json` |
| A person's commands refused | `permissions.deny` in the same file | the same |
| The sdlc MCP server and the team's servers | `mcpServers` in the same file | the same |

Every generated file is recorded in the manifest. `sdlc update` refreshes them, and `sdlc uninstall` removes them.
Your hooks, deny entries and MCP servers in `settings.json` stay in place when sdlc updates its entries.

> [!IMPORTANT]
> If you enable `security.folderTrust.enabled`, trust the project folder or an ancestor before relying on hooks.

By default, every folder is trusted and project hooks and `permissions.deny` apply. An untrusted folder causes
Qwen Code to ignore `.qwen/settings.json`, including hooks and deny rules. `sdlc doctor` reads user trust settings
and warns only when the project is untrusted.

## 🛡️ Understand the guardrails

These checks apply through hooks, deny rules and an agent-session marker:

| Rule | In Qwen Code and GigaCode |
|---|---|
| No code edits before the plan is approved | PreToolUse denies `write_file`, `edit` and a shell write to code |
| A person's decision in the agent's shell | PreToolUse and `permissions.deny` refuse it, even in YOLO mode |
| Protected files (`sdlc.yaml`, `settings.json`, generated files, state) | `deny` |
| The session starts with the change, its stage and who acts next | SessionStart `additionalContext` |
| Verification before stopping | Stop asks the agent to follow up |
| `sdlc approve` refuses inside the agent session | `QWEN_CODE=1` in the agent's shell |

An agent cannot edit or write through the shell `~/.qwen/settings.json` or `~/.gigacode/settings.json`, which could
turn the hooks off for every project.
Thin commands include `/sdlc-status`. A person's commands include `sdlc approve` and `rework`.

`mcp-stage` checks MCP calls only when a tool reports `mcp__<server>__<tool>` or `<server>_<tool>`.
These MCP tool names are not verified live.

## 💡 Try common workflows

These examples show shared work, a refused agent decision and a GigaCode check.

### A team with Claude Code and Qwen Code

```bash
sdlc init --tools claude,qwen --mcp
```

Both read the same `openspec/` artifacts, gates and backlog. A change started in one continues in the other.
Use `/sdlc:next` in Claude Code and `/sdlc-next` in Qwen Code or GigaCode.

### An agent in YOLO mode tries to approve its own plan

A developer runs Qwen Code in YOLO mode and asks it to finish the feature. The agent runs `sdlc approve plan`:
`permissions.deny` refuses it even in YOLO mode, the hook denies it with `[sdlc:separation-of-duties]`, and the CLI
refuses because the shell carries `QWEN_CODE=1`. The agent gives the developer the command to run themselves.

### GigaCode in a regulated team

The team works in GigaCode. `sdlc init --tools gigacode --mcp` sets up the same gates under `.gigacode/`.
`sdlc doctor` says support is experimental. Before relying on it, check that an edit before the plan is denied.
The steps are in [checking GigaCode yourself](#-check-the-limits).

## 🛡️ Check the limits

Read these limits before relying on a hook or agent marker. GigaCode support follows documented formats and Qwen Code
behaviour, but has not been checked against a live GigaCode installation.

- **Folder trust.** With folder trust enabled, untrusted folders ignore the project's settings, including hooks and
  `permissions.deny`. The CLI's own refusal still applies in agent shells carrying `QWEN_CODE=1`.
- **A hook that cannot run.** Qwen Code lets the call through when a hook fails, times out or answers bad JSON.
  When sdlc's pre-tool hook fails to load or throws, the sdlc command answers a JSON `deny` itself, so the call is
  blocked. `sdlc` missing from the PATH of the tool's shell (`sdlc doctor` checks it) and a timeout still let the
  call through.
- **The GigaCode marker.** GigaCode's own session variable is not documented. Its shell carries `QWEN_CODE=1`.
  With `gigacode` but not `qwen` in `tools`, the git hook writes `SDLC-Agent: gigacode`. With both tools it writes
  `SDLC-Agent: qwen`; set `SDLC_AGENT=gigacode` in GigaCode's environment to tell them apart. Run `sdlc update` after
  changing `tools`; `sdlc doctor` checks the hook. If a GigaCode build sets no marker, the CLI cannot tell the agent's
  shell from yours; the hooks and deny rules still refuse a person's commands by their text.
- **Windows.** Qwen Code runs hooks through cmd.exe; sdlc's hook commands work there.
- **Checking GigaCode yourself.** After `sdlc init --tools gigacode`, trust the folder, start a change with
  `sdlc new demo` and ask the agent to create `src/demo.txt`: the edit must be denied with `[sdlc:plan-gate]`. Ask it
  to run `sdlc approve intent`: it must be refused.

## 📚 Terms

The [glossary](glossary.md) defines [gate](glossary.md), [stage](glossary.md) and [subagent](glossary.md).

## 📚 See also

- [Integrations](10-integrations.md) — see how sdlc registers MCP servers.
- [User guide](05-guide.md) — follow a change through its gates.
- [Codex CLI](16-codex.md) — compare another tool's setup and guardrails.

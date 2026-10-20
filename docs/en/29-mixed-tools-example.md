# 29. Example: one team, different agents

This example ran on October 18, 2026, on the TodoMVC project of the
[from-scratch example](19-team-greenfield-example.md).
Claude Code and Codex CLI joined Qwen Code in the same project. The team checked refusals across all three tools.
They also checked commit and log attribution, shared role agents, and what happens when one tool leaves.

## On this page

- [Set up three tools](#291-three-tools-in-one-project)
- [Check the same refusals](#292-the-same-refusals-everywhere)
- [Identify agent commits](#293-each-tool-signs-its-commits)
- [Share role agents](#294-the-teams-role-agents-reach-every-tool)
- [Remove one tool](#295-one-tool-leaves)
- [Lessons for a team](#296-what-the-team-takes-from-it)
- [Terms](#-terms)
- [See also](#-see-also)

Two people ran these checks:

| Person | Role in this example |
|---|---|
| Linda Carter | maintainer: sets up the tools, accepts the role agents |
| David Smith | engineer: his clone hosts the three agents for the checks |

## 29.1. Three tools in one project

David's clone used three agent tools:

```bash
sdlc init --tools claude,codex,qwen
sdlc doctor
```

Running `init` again with the new list adds the files of Claude Code (`.claude/`), of Codex CLI (`.agents/skills/`,
`.codex/`) and keeps Qwen Code's. `sdlc doctor` checks each tool's own conditions:

```text
✓ claude hooks     installed in .claude/settings.json
! codex            … Codex runs a project's hooks only in a trusted project and only after the user trusts
                   sdlc's hooks in `/hooks`; a new or changed hook is skipped until it is trusted …
✓ qwen             Hooks and permissions.deny installed in .qwen/settings.json; Qwen Code applies project hooks …
✓ git hook         prepare-commit-msg in .git/hooks/prepare-commit-msg: commits made in agent sessions get an SDLC-Agent trailer
```

Two things each tool needs from the machine:

- **Claude Code on Windows** runs hooks with Git Bash. Git here was installed for the user
  (`%LOCALAPPDATA%\Programs\Git`), so the path went into `CLAUDE_CODE_GIT_BASH_PATH`.
- **Codex CLI** runs a project's hooks only after they are trusted. For the headless runs of this example
  (`codex exec`), sdlc's own hooks ran with `--dangerously-bypass-hook-trust`; its command rules apply either way.

## 29.2. The same refusals everywhere

Each agent got the same two-step task in David's clone, on a change whose tests are locked:

1. `sdlc approve review --change sort-todos-alphabetically`
2. Append a line to `test/sort.test.js`.

| Tool | Step 1 | Step 2 |
|---|---|---|
| Qwen Code | `[sdlc:separation-of-duties]` | `[sdlc:tests-locked]` |
| Claude Code | refused through `AGENTS.md` | `PreToolUse:Edit hook error: [sdlc:tests-locked] …` |
| Codex CLI | refused by command rules | `[sdlc:tests-locked]` blocked `Add-Content` |

Claude Code gave "Rule 1 in this project's AGENTS.md" for step 1. Codex CLI said "rejected: a person's decision".
For step 2, Codex CLI said "Command blocked by PreToolUse hook: [sdlc:tests-locked] …".

Every refusal names the rule and points to `sdlc guide denials`. The log records each one with the tool:

```text
hook.denied  (agent qwen)   tests-locked: edit test/sort.test.js
hook.denied  (agent claude) tests-locked: Edit test/sort.test.js
hook.denied  (agent codex)  tests-locked: Bash
```

## 29.3. Each tool signs its commits

Each agent committed one note in the change folder. The git hook marked them:

```text
4ec2053 notes: from codex  | SDLC-Agent: codex
73f9b41 notes: from claude | SDLC-Agent: claude-code
d932d8e notes: from qwen   | SDLC-Agent: qwen
```

`sdlc audit` counts agent commits and the agents' log events by tool.

## 29.4. The team's role agents reach every tool

```bash
sdlc team sync
```

wrote drafts of the built-in roles into `docs/agents/drafts/`: analyst, architect, developer, tester, reviewer. Linda
asked Claude Code (the `sdlc-team` workflow) to adapt the tester and the reviewer to this project: tests on
`node:test`, data in localStorage, `REVIEW.md` as the policy, locked tests left alone. The agent gave her the commands.
When an agent ran one of them itself:

```text
error: `sdlc team accept` records a human decision and cannot run inside an agent session (claude-code).
```

Linda accepted both roles:

```bash
sdlc team accept tester
sdlc team accept reviewer
```

Each accepted role became a subagent for every tool at once: `.claude/agents/sdlc-tester.md`,
`.codex/agents/sdlc-tester.toml` (with `sandbox_mode = "read-only"`) and `.qwen/agents/sdlc-tester.md`. The reviewer
role took the place of the built-in `sdlc-reviewer` and kept its read-only tools. `sdlc team list` shows the two
roles as accepted with their subagents.

## 29.5. One tool leaves

The team removed Codex CLI from the project configuration:

```bash
sdlc init --tools claude,qwen
```

```text
files: 0 created, 0 updated, 96 unchanged, 27 removed
Codex hooks: removed in .codex/hooks.json
```

The Codex skills, subagents, hooks, command rules and its MCP entries went away; Claude Code's and Qwen Code's files
stayed as they were. After a pull, `sdlc doctor` in David's clone listed two tools.

## 29.6. What the team takes from it

The shared process gives the team these working practices:

- Let each person keep the agent they like: the process, the gates and the refusals are the same in every tool.
- Run `sdlc doctor` on every machine: it names what each tool needs (trusted hooks for Codex, the folder for Qwen).
- Read the log by tool: refusals and commits say which agent did what.
- Accept role agents once; they reach every tool the project uses.
- Add or remove a tool with `sdlc init --tools …`; the others are not touched.

## 📚 Terms

- [Hook](glossary.md) — the callback that enforces a guard in an agent session.
- [Guard](glossary.md) — a process rule around an agent action.
- [Gate](glossary.md) — the decision point shared by every tool.

## 📚 See also

- [Agent team](12-agent-team.md) — how role agents are accepted and shared.
- [Integrations](10-integrations.md) — how sdlc connects to tools.

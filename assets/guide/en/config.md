---
title: Configuration
summary: The main keys of openspec/sdlc.yaml and who may change them.
---
# Configuration

## Propose, review, apply

Run `sdlc config propose --set enforcement.mode=warn --reason "Trial week"`. Use `--target roles` for
`openspec/roles.yaml`, or `--file` for a whole file. Propose validates without applying.
Use `sdlc config show` to list them and `sdlc config show C1` for the diff and warnings.
Use one proposal per change, with several `--set` options for related keys.
Another open proposal for the file is named: applying either makes the other stale. The diff keeps
untouched lines and line endings. `signing_key` must be one OpenSSH public key line, not a path. Include
`signing_since` when enabling signing to keep earlier approvals pre-signing; otherwise `config show` warns
how many unsigned approvals will fail verification. That warning needs no `--yes`.

Only a person runs `sdlc config apply C1` or `sdlc config dismiss C1 --note "Not now"` in their own terminal.
When `roles.yaml` exists, applying requires its `maintainer` role. A change to the target since the proposal makes
it stale; propose again. A lower enforcement mode, a removed required gate or verify command, reduced protected or
test paths, lite `auto_waive`, lower approval count, weaker signing or an empty role raises a warning and requires
`--yes` to apply.

`openspec/sdlc.yaml` configures the process. **Only a person edits it**: the hook denies agent edits, since the file
also controls the guard.

`log.hook_decisions: false` disables the local hook decision queue (the ignored
`openspec/.sdlc/hook-log.jsonl`, moved to the shared log by the next CLI log write).

| Key | What it does |
|---|---|
| `gates.<gate>` | `required`, `approvers` (roles), `high_risk_approvers`, `min_approvals`, `auto_waive` (kinds, tracks; intent, spec, plan only; a kind an agent chose does not count) |
| `rework.max_cycles` | reworks of one gate before `next` asks a person (default 3) |
| `design.debate` | two advocates argue the key design decision before the spec gate (default off; `debate_sides`) |
| `verify.commands` | the project's checks: `{ name, run, required }`; `remote: true` runs one on a server |
| `verify.unstable`, `verify.reuse` | unstable test files; reuse of a passing run; adding a file or enabling reuse warns |
| `verify.mcp`, `release.mcp` | checks the CLI calls on an MCP server, for the verify and the release gate |
| `project.name` | the project's name in MCP and events (default: the folder name) |
| `events` | receivers of process events: `{ server, tool, on, args }` |
| `gates.<gate>.overdue_hours` | hours before a waiting gate raises an overdue event |
| `review` | `policy` (REVIEW.md), `passes`, `lenses`, `base`, `block_on` |
| `release.commands` | regexes for production commands the agent may not run before the release approval |
| `enforcement.mode` | `off`, `warn` (remind), `block` (deny process rules); hard rules apply in warn too |
| `enforcement.protected_paths` | paths the agent may never edit |
| `enforcement.test_paths` | what counts as a test (for locked tests) |
| `enforcement.secret_allow` | paths where test data may hold real-looking keys |
| `mcp.serve`, `mcp.servers` | sdlc's own MCP server, the team's servers |
| `stages.<stage>` | skills and subagents of a stage |
| `cli` | how agents call sdlc (`sdlc` or `npx --no-install sdlc`) |
| `tools` | claude, opencode, cursor, codex, qwen, gigacode (experimental) |

`auto_waive` matches the kind **or** the track. `tracks: [lite]` waives that gate for every lite change,
including features; `sdlc doctor` warns about this policy.

## After a change

Run `sdlc update` to regenerate the agent files and hooks. `sdlc doctor` checks the setup.

## In an agent session

`sdlc init` and `sdlc update` still restore the generated files, but refuse to weaken the guard: a lower mode, fewer
tools, `--no-hooks`, another `--cli`. `sdlc uninstall` is a person's command.

Project context and rules for artifacts live in `openspec/config.yaml` (`context:`, `rules.<artifact>`), as in OpenSpec.

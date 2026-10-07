---
title: Configuration
summary: The main keys of openspec/sdlc.yaml and who may change them.
---
# Configuration

`openspec/sdlc.yaml` configures the process. **Only a person edits it**: the hook denies agent edits, because the file
also controls the guard itself.

| Key | What it does |
|---|---|
| `gates.<gate>` | `required`, `approvers` (roles), `high_risk_approvers`, `min_approvals` |
| `verify.commands` | the project's checks: `{ name, run, required }` |
| `verify.mcp` | checks the CLI calls on an MCP server |
| `review` | `policy` (REVIEW.md), `passes`, `lenses`, `base`, `block_on` |
| `release.commands` | regexes for production commands the agent may not run before the release approval |
| `enforcement.mode` | `off`, `warn` (remind), `block` (deny process rules); hard rules apply in warn too |
| `enforcement.protected_paths` | paths the agent may never edit |
| `enforcement.test_paths` | what counts as a test (for locked tests) |
| `enforcement.secret_allow` | paths where test data may hold real-looking keys |
| `mcp.serve`, `mcp.servers` | sdlc's own MCP server, the team's servers |
| `stages.<stage>` | skills and subagents of a stage |
| `cli` | how agents call sdlc (`sdlc` or `npx --no-install sdlc`) |
| `tools` | claude, opencode |

## After a change

Run `sdlc update` to regenerate the agent files and hooks. `sdlc doctor` checks the setup.

## In an agent session

`sdlc init` and `sdlc update` still restore the generated files, but refuse to weaken the guard: a lower mode, fewer
tools, `--no-hooks`, another `--cli`. `sdlc uninstall` is a person's command.

Project context and rules for artifacts live in `openspec/config.yaml` (`context:`, `rules.<artifact>`), as in OpenSpec.

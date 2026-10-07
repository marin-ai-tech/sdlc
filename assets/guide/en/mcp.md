---
title: MCP and integrations
summary: sdlc as an MCP server, the team's MCP servers, checks and stages.
---
# MCP and integrations

sdlc works with MCP in both directions. Nothing over MCP makes a decision.

## sdlc as a server

`sdlc init --mcp` registers `sdlc mcp serve` for Claude Code (`.mcp.json`) and OpenCode (`opencode.json`). Other
systems — an orchestrator, a chat client, an IDE assistant — then read the process with the tools `status`, `next`,
`instructions`, `trace`, `audit`, `help` and `guide`. Each answers what the CLI prints with `--json`.

## The team's servers

```yaml
mcp:
  servers:
    build: { type: stdio, command: [npx, -y, corp-build-mcp], env: { CI_TOKEN: "${CI_TOKEN}" }, stages: [build, test] }
    jira:  { type: http, url: https://mcp.corp.example/jira, headers: { Authorization: "Bearer ${JIRA_TOKEN}" }, stages: [plan, deploy] }
```

- `sdlc update` writes them into `.mcp.json` and `opencode.json`; secrets only as `${VAR}`.
- `sdlc mcp check` lists each server's tools and warns about servers that can write files.
- `stages` say when the agent may call a server; outside them the hook denies (block) or reminds (warn).

## Checks and results

- `verify.mcp` checks are called by the CLI during `sdlc verify` and recorded as evidence (`sdlc guide verify`).
- Results of runs outside an agent session wait in `sdlc inbox list`.

## Per stage

`stages.<stage>.skills` and `.agents` in `openspec/sdlc.yaml` name what each stage uses; the generated workflows list
them with the stage's MCP servers.

More: docs chapter "Integrations" and "Working with sdlc over MCP".

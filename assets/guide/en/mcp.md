---
title: MCP and integrations
summary: Serve process tools, connect team servers and run checks.
---
# MCP and integrations

Nothing over MCP makes a human decision. `sdlc init --mcp` registers `sdlc mcp serve` in each selected tool's
project configuration. Other clients use `sdlc mcp serve --project <path>`; repeat it for multiple projects.

## Core tools

The 12 core read tools serve stdio and HTTP server-token clients:

- `task_export`, `board_list`, `status`, `next`;
- `instructions`, `trace`, `audit`, `help`;
- `guide`, `explain`, `health`, `report`.

An HTTP executor token adds the 5 core board write tools:

- `board_claim`, `board_heartbeat`, `board_release`, `board_submit`, `board_bid`.

A person issues a token with `sdlc task executors token <id>`. It binds the registered executor and project;
board writes have no `executor` argument. Dispatch and reopen use `sdlc board`.

Multi-project tools accept `project`: the configured project name, else its folder name. Ordinary `status`
without it reads every project. An executor token defaults to its bound project and refuses another.
Single-project core schemas omit `project`.

Read-only resources use `sdlc://context/<file>`, `sdlc://spec/<capability>`,
`sdlc://change/<id>/<artifact>` and `sdlc://doc/<path>`. They exclude state and configuration.

## Task contracts and identity

`task_export` accepts optional `change`, `task`, `executor` and `ext`, subject to plan/task eligibility.
A tokenless stdio or server-token caller supplying `executor` receives `executor_token_required` before
export, with no `task.exported` event. Identity-free exports stay unattributed; a configured executor registry
may still return `executor_required`. With an executor token, omitted `executor` uses its identity; a different
explicit value returns `invalid_arguments`. Environment flags grant no MCP identity.

`task_export` and `board_claim` use task-extension schemas; `board_bid` uses bid-extension schemas.
Their `ext` is typed JSON keyed by accepted plugin namespace, such as `{"economy":{"budget":2}}`.
Extension data cannot replace transport identity.

`board_claim` requires `change`, `task`, `agent`; `lease`, `request`, `ext` are optional.
`board_bid` also requires `minutes`, with optional `cost`, `note`, `request`, `ext`.
`lease`, `minutes`, `cost` accept strings or numbers; other core scalars are strings. Unknown fields and
empty or option-like scalar values refuse. The `project` selector is validated separately.

## Plugin tools and output

Accepted enabled plugins add tools such as `economy__read`, taking `{ "input": {} }`. Ordinary clients can
read. Executor operations require a project-bound token and stable `request`: `p1.<unix-ms>.<32hex>`.
Read plugin tools reject `request`. A person-only operation stays hidden and refused even on a person-started
server. Invocation rechecks trust and catalog compatibility.

Board, task-export and plugin calls return service values. Other core reads collect CLI-child JSON.
Server stdout carries only MCP protocol messages.

## Team servers and checks

```yaml
mcp:
  servers:
    build: { type: stdio, command: [npx, -y, corp-build-mcp], env: { CI_TOKEN: "${CI_TOKEN}" }, stages: [build, test] }
```

`sdlc update` writes team servers to selected tools; secrets remain `${VAR}` references.
`sdlc mcp check` lists tools and warns about file writers. Outside a server's `stages`, hooks deny in block
mode or remind in warn mode. `stages.<stage>.skills` and `.agents` name stage resources.

`verify.mcp` runs during `sdlc verify`; `release.mcp` runs at release approval or `sdlc release check`.
Outside-session results wait in `sdlc inbox list`. Event deliveries retry with `sdlc events flush`.

More: docs chapters "Integrations" and "Working with sdlc over MCP".

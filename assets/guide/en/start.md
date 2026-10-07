---
title: Getting started
summary: Install, init, the first change, and who does what.
---
# Getting started

sdlc runs the lifecycle of the Anthropic AI-native SDLC playbook inside your coding agent. The agent writes the
artifacts and the code. **People make the decisions**: approvals, waivers, sending work back, the release.

## First steps

1. `sdlc init` in the project, then `sdlc doctor` to check the setup.
2. Start a change: describe the work to the agent (it runs the intent workflow), or `sdlc new <name>`. With a backlog,
   `sdlc backlog start <B-id>`.
3. Ask `sdlc next` at any time: it names the next step and who takes it (the agent or a person, by name with
   `openspec/roles.yaml`).
4. When a person is needed, run the command `sdlc next` prints, in **your own terminal**.

## Who does what

| The agent | A person |
|---|---|
| writes intent, specs, design, plan, tasks, code | approves gates (`sdlc approve`) |
| runs `sdlc verify` and records the evidence | waives or rejects (`sdlc waive`, `sdlc reject`) |
| reviews in passes and records findings | sends work back (`sdlc rework`), takes a change over (`sdlc takeover`) |
| prepares the release notes | authorizes the release |

An answer in the chat is never an approval: the agent cannot approve, and a `!` command in the agent's chat runs in the
agent's shell, so it is refused too.

## Where things live

- `openspec/changes/<id>/` — the artifacts of a change and its record `.sdlc.yaml` (only the CLI writes it).
- `openspec/sdlc.yaml` — gates, checks, enforcement. Agents cannot edit it.
- `openspec/backlog.md` — planned work, `openspec/roles.yaml` — who holds which role.

Next: `sdlc guide lifecycle`.

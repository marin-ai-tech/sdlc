---
title: The agent team
summary: Role agents (analyst, architect, developer, tester, reviewer) adapted to the project, accepted by a person.
---
# The agent team

Each project can have role agents: an analyst, an architect, a developer, a tester and a reviewer. A role is a file a
person reads and edits; sdlc turns an accepted role into a subagent for Claude Code, OpenCode, Cursor, Codex, Qwen Code and GigaCode.

## Where roles come from

```bash
sdlc team sync          # drafts into docs/agents/drafts/: the team registry first, the built-in roles for the rest
sdlc team list          # roles, their source and status: draft, accepted, changed
```

- With `team: { registry: <server> }` in `openspec/sdlc.yaml`, roles and skills come from the team's MCP registry,
  with their versions and checksums. A newer version arrives as a draft; an accepted role is never replaced silently.
- The team workflow (`/sdlc:team`) drafts a **Project rules** section into each role from the code (or from the idea
  of an empty project): conventions, forbidden directories, how to run the app and the tests.

## Accepting

```bash
sdlc team accept tester           # a person's command, in your own terminal
sdlc team accept --skill lint-check
```

Accepting moves the draft to `docs/agents/<role>.md`, records it in `openspec/.sdlc/team.json` and generates the
subagent. It also says whether the draft differs from its source, so you see what an agent changed. Skills with
scripts install only after `team accept --skill`; `sdlc team check` shows every skill, its source and its scripts.

## What sdlc adds to every role

The generated subagent gets two blocks the role does not need to know: **where to write** (the artifacts of its
stages) and **this project** (its checks, protected paths, people and documents). They follow the project: change a
check and the next `sdlc update` updates the roles.

## Protection

Agents cannot edit accepted roles, the team record, installed team skills or the generated `sdlc-*` files: otherwise
an agent could make the tester pass anything. A person may edit a role; it shows as `changed` and is used again once
re-accepted. The tester and reviewer roles replace the built-in `sdlc-verifier` and `sdlc-reviewer` when accepted.

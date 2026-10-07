---
title: Verification evidence
summary: sdlc verify, fresh evidence, MCP checks and the inbox.
---
# Verification evidence

The verify gate passes on recorded evidence, not on the agent's word.

```bash
sdlc verify --change add-export           # runs every check in verify.commands and verify.mcp
sdlc verify --list                        # the configured checks
sdlc verify --check --change add-export   # spec scenarios with no behavioural evidence
```

## What is recorded

- The literal output of each command, in `verification.md`, with the exit code and the duration.
- A fingerprint of the working tree. Committing keeps the evidence fresh; changing the code makes it stale, and the gate
  waits for a new run.
- MCP checks (`verify.mcp`): the CLI itself calls a tool of the team's MCP server (for example "is CI green for this
  commit?") and records the answer.

## When a check fails

Fix the code, not the test, and run `sdlc verify` again. A required failing check fails the gate. In a bug fix the tests
are locked (`sdlc guide bugfix`).

## No checks configured

`sdlc verify` refuses. Add the project's build, test and lint commands under `verify.commands` in
`openspec/sdlc.yaml` (a person edits that file), or let `sdlc adopt` draft them.

## Results from outside the session

When a person or CI runs `sdlc verify` outside an agent session, the MCP results also wait in the inbox. The agent sees
them at its next session start:

```bash
sdlc inbox list
sdlc inbox done <id>
```

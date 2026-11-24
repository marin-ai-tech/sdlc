---
title: Verification evidence
summary: sdlc verify, fresh evidence, MCP checks and the inbox.
---
# Verification evidence

The verify gate passes on recorded evidence, not on the agent's word.

CI runs `sdlc validate --all`. A new change before its spec stage, or a change whose spec gate does not apply,
passes without delta specs. A full-track change at its spec stage needs deltas, and `sdlc approve spec` refuses
missing deltas.

```bash
sdlc verify --change add-export           # runs every check in verify.commands and verify.mcp
sdlc verify --list                        # the checks; remote ones are marked
sdlc verify --failed --change add-export  # only the failed checks
sdlc verify --check --change add-export   # spec scenarios with no behavioural evidence
```

## What is recorded

- The literal output of each command, in `verification.md`, with exit code and duration.
- A fingerprint of the working tree. Committing keeps the evidence fresh; changing the code makes it stale.
- MCP checks (`verify.mcp`): the CLI itself calls a tool of the team's MCP server (for example "is CI green for this
  commit?") and records the answer.

## Several runs, one gate

An `--only` run that leaves out a check never passes on its own.
The gate passes when every required check has a passed result on this code, from any runs.
`sdlc verify --failed` reruns only what did not pass.
It is refused with `--only`, with no record, after a code or check change, or with nothing failed.

## Unstable, remote and reused checks

- `verify.unstable` lists unstable test files, passed in `SDLC_UNSTABLE_TESTS`.
  sdlc never skips, retries or loosens a check.
- `remote: true` runs a command on the project's server and can fail with `remote_unavailable`, `remote_no_answer`
  or `remote_dirty`; its log is in `verification/remote/`.
- `verify.reuse` is off by default. It records another change's passing run on the same code.
  `sdlc verify --no-reuse` always runs the checks.
- Unnamed checks get names like `test`.

See also: `sdlc guide config`.

## What else the evidence says

- Files the plan lists under "Files that change" that nobody touched are reported as a warning.
- `## Not run / limits` in `verification.md`: what was not exercised and why (the tester fills it).
- Files in the change's `verification/` folder (screenshots, browser results) are listed as links.

## When a check fails

Fix the code, not the test, and run `sdlc verify` again. A required failing check fails the gate. In a bug fix the tests
are locked (`sdlc guide bugfix`).

## Process requirements and cancellation

Windows checks require Windows PowerShell with `Add-Type` and permission to create a kill-on-close Job Object.
The harness resolves PowerShell to an absolute path. Wrapper initialization has a separate 30000 ms bound;
the command timeout starts after the wrapper starts the real command. Startup failures identify missing
PowerShell, execution policy, Constrained Language or Add-Type/job failure; an unrun command cannot pass.

POSIX cleanup requires `ps -A -o pid=,ppid=,pgid=`. Handled `SIGINT` and `SIGTERM` are forwarded to the owned
process group, followed by bounded cleanup; cancellation does not start later checks. Known frozen descendants
are killed or resumed. A known shell exit retains its own code after bounded process and pipe cleanup, so
lingering pipes alone never create a timeout. A required cleanup failure still fails verification.

An already detached POSIX descendant reparented outside the owned group before cleanup may survive.
Reparenting-proof containment and protection against an unhandled `SIGKILL` are not provided.

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

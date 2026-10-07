---
title: Fixing a bug
summary: The failing test first, locked tests, and the fix.
---
# Fixing a bug

A bug fix follows the bug-fix protocol: reproduce, prove with a failing test, fix, then make sure the test system would
catch the same kind of bug next time.

## Steps

1. `sdlc new fix-<name> --kind bugfix` (often the lite track: `sdlc guide tracks`).
2. The agent writes a test that **fails for the right reason** and records the plan.
3. A person approves the plan: `sdlc approve plan --change <id>`.
4. Lock the tests, so the fix cannot be made by changing them:

```bash
sdlc tests lock --change fix-rounding
```

5. The agent fixes the code. While the tests are locked, the hook denies agent edits of test files
   (`enforcement.test_paths`), also in warn mode.
6. `sdlc verify --change <id>` records the evidence: the test that failed now passes.
7. A person unlocks when the work is done: `sdlc tests unlock --change <id>` (a person's command).

## Why lock the tests

The fastest way to make a red test green is to change the test. Locking takes that option away from the agent, so the
evidence means what it says.

## After the fix

Ask the agent which layer should have caught the bug and why it did not, and add that check (a scenario, a fixture, a
guard). Postponed work goes to the deferred registry: `sdlc defer add "…" --why "…" --change <id>`.

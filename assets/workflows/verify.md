---
id: verify
title: "SDLC: Verify"
description: Verify an implemented SDLC change (Stage 4, Test) - run the project's checks with `sdlc verify` to record literal evidence, then get an independent behavioral verification against the spec scenarios in a fresh context. Use after implementation, or when the user asks to test, verify, or check that a change works.
command-description: Stage 4 (Test) - record verification evidence and run an independent verifier
argument-hint: "[change-id]"
---
Verify the change - Stage 4 (Test). Evidence comes from the toolchain, and the final verdict comes from a fresh context that did not write the code.

{{contract}}

**Input**: {{input}}

**Steps**

1. **Check readiness.** `sdlc status --change <id> --json`: all tasks should be checked. If not, finish them first ({{cmd:build}}).
2. **Record the evidence**: `sdlc verify --change <id>`. It runs every configured check, writes the literal output into `verification.md`, and binds the result to the current code. If a check fails, fix the code (not the test) and re-run. If it warns that plan.md lists files the change did not touch (`planDrift.untouched`), finish them or tell the user the plan changed; it is a warning, not a failure. MCP checks (`verify.mcp`) are called by the CLI itself and listed under `mcp` in the JSON answer, with the reason when one fails. Results kept from runs outside your session are in `sdlc inbox list --json`; once you have acted on one, mark it with `sdlc inbox done <id>`. If no checks are configured, propose `verify.commands` for `openspec/sdlc.yaml` to the user instead of skipping verification.
3. **Independent verification.** Delegate to the `{{agent:verifier}}` subagent with the change id. It reads the spec scenarios and the plan's Proof section, runs the app and tests, exercises each scenario plus the nearest neighboring flows, and reports what it ran, what it saw, and any mismatch. It fixes nothing.
4. **Record the behavioral verification** in `verification.md` under `## Behavioral verification`: one row per spec scenario and Proof item (scenario, what was run, what was seen, result). Under `## Not run / limits` say what was not exercised and why ("None" if everything ran). Put screenshots and browser results in the change's `verification/` folder: the next `sdlc verify` lists them in the evidence. Never edit the block between the `sdlc:evidence` markers.
5. **Check coverage**: `sdlc verify --check --change <id>` reports spec scenarios with no row in the behavioral table. Cover them or explain why they cannot be exercised.
6. **Decide.** Any mismatch -> back to {{cmd:build}}, then verify again. All clean -> report the result and continue with {{cmd:review}}.

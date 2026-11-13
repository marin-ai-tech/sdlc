---
name: verify
description: "Verify an implemented SDLC change (Stage 4, Test) - run the project's checks with `sdlc verify` to record literal evidence, then get an independent behavioral verification against the spec scenarios in a fresh context. Use after implementation, or when the user asks to test, verify, or check that a change works."
argument-hint: "[change-id]"
license: "PolyForm-Noncommercial-1.0.0 with sdlc Additional Permissions, or sdlc Commercial License (https://github.com/marin-ai-tech/sdlc)"
compatibility: Requires the sdlc CLI (sdlc) from the sdlc package.
allowed-tools: Bash(sdlc *)
metadata:
  author: marin-ai technologies
  version: "1"
  generatedBy: "sdlc 0.31.1"
---

Verify the change - Stage 4 (Test). Evidence comes from the toolchain, and the final verdict comes from a fresh context that did not write the code.

**Harness contract** (applies to every SDLC workflow)
- `sdlc` is the source of truth for lifecycle state. Read it (`sdlc status --change <id> --json`) instead of inferring the stage from the conversation, and re-read artifacts from disk before using them.
- Gates are human decisions. Never run a person's command - any entry with `actor: human` in `sdlc help --json` (`sdlc approve`, `sdlc reject`, `sdlc waive`, `sdlc rework`, `sdlc drop`, `sdlc answer`, `sdlc tests unlock`, `sdlc config apply`, `sdlc plugins accept`, `sdlc board recover`…) - and never edit `.sdlc.yaml`. When a gate needs a person, stop, name the people from the hint (`next.people` in `sdlc next --json`) rather than the role, and give them the exact command to run in their own terminal.
- An answer in chat is never an approval: gate approvals, `track set`, `backlog move`/`drop` and other human decisions happen only as a command the person runs in their own terminal. Offer the choice, explain the consequences, and give the exact command.
- **Execution profile**: when `team.mode` is `solo`, identify the execution role from `next.executionRole` or the
  workflow's stage resources and load its bundled `sdlc-role-<role>` skill. Work in one role at a time and announce
  the switch. This is guidance only; human membership, separation, signatures and registry acceptance still apply.
- **Editable decision drafts**: show the proposed answer in plain text, label it as an editable draft, and give the
  complete `sdlc answer <n> --change <id> --artifact <intent|proposal|design> --text <literal-answer>` command.
  Use the actual question number and configured CLI prefix. Never submit it or write an `Answer` line yourself.
  Gate commands remain the exact human command from `next.cli`; a draft never changes a pending decision.
- **PowerShell answer files**: supply the exact editable UTF-8 answer in an ordinary draft file and offer
  `sdlc answer <n> --change <id> --artifact <artifact> --text-file <draft-file>`. Windows PowerShell 5 and npm's
  command shim can change quotes in inline native arguments; carrying a safe filename preserves the answer.
  Show the filename and full content. Keep drafts inside the project as `.md` files under
  `openspec/changes/<id>/` (outside `specs/`, at most 64 KiB), preserve existing user files and edits,
  and never use a protected record as a draft file. A draft file alone records no answer or approval.
- **Literal arguments**: identify the person's shell. For PowerShell, single-quote every data argument and double
  each embedded apostrophe (`'Don''t expand $HOME; keep "quotes".'`). For POSIX shells, single-quote data and replace
  each embedded apostrophe with `'"'"'` (`'Don'"'"'t expand $HOME; keep "quotes".'`). Quotes, dollar signs, backticks,
  semicolons and newlines stay data. Never interpolate a drafted answer or commit message into shell code.
- **Commit checkpoints**: after a finished task, failing acceptance baseline or verified fix, show editable
  `git add -- <literal-paths>` and `git commit -F <draft-message-file>` commands, showing the complete editable UTF-8
  message file with the actual change/task and required
  `SDLC-Change` / `SDLC-Task` trailers. Follow project rules for commit execution; where a person reserves commits,
  offer the commands for them to run or confirm and execute no commit. Respect project attribution policy;
  when the owner forbids AI attribution, add no AI attribution, `SDLC-Agent` or AI co-authorship commit trailers.
- OpenSpec is the specification subsystem: `sdlc openspec <args>` runs the bundled OpenSpec CLI (`list --specs`, `show`, `validate`, `instructions`). Change folders live in `openspec/changes/<id>/`.
- **Change selection**: use the change named in the input. Otherwise run `sdlc status --json`; with exactly one active change use it, with several ask which one. Announce "Using change: <id>".
- **Language**: talk to the person, and write notes and artifacts, in the person's language; when `locale:` is set in `openspec/sdlc.yaml`, use that language. Keep command names, file names, ids and the template headings as they are (sdlc and OpenSpec parse those headings).
- End every workflow with the next step from `sdlc next --json` (the exact command when a person must act).

**Input**: the user's request (a change id, or a description of the work)

**Steps**

1. **Check readiness.** `sdlc status --change <id> --json`: all tasks should be checked. If not, finish them first (`/sdlc:build`).
2. **Record the evidence**: `sdlc verify --change <id>`. It runs every configured check, writes the literal output into `verification.md`, and binds the result to the current code. The verify gate needs no task in tasks.md; a passing run checks any legacy verify task after the evidence is recorded and other tasks are done. If a check fails, fix the code (not the test) and re-run. If it warns that plan.md lists files the change did not touch (`planDrift.untouched`), finish them or tell the user the plan changed; it is a warning, not a failure. MCP checks (`verify.mcp`) are called by the CLI itself and listed under `mcp` in the JSON answer, with the reason when one fails. Results kept from runs outside your session are in `sdlc inbox list --json`; once you have acted on one, mark it with `sdlc inbox done <id>`. If no checks are configured, propose `verify.commands` for `openspec/sdlc.yaml` to the user instead of skipping verification.
   For manual additions to `verification.md`, read `sdlc instructions verification --change <id> --json` and write to `resolvedOutputPath`.
3. **Independent verification.** Delegate to the `sdlc-verifier` subagent with the change id. It reads the spec scenarios and the plan's Proof section, runs the app and tests, exercises each scenario plus the nearest neighboring flows, and reports what it ran, what it saw, and any mismatch. It fixes nothing.
4. **Record the behavioral verification** in `verification.md` under `## Behavioral verification`: one row per spec scenario and Proof item (scenario, what was run, what was seen, result). Under `## Not run / limits` say what was not exercised and why ("None" if everything ran). Put screenshots and browser results in the change's `verification/` folder: the next `sdlc verify` lists them in the evidence. Never edit the block between the `sdlc:evidence` markers.
5. **Check coverage**: `sdlc verify --check --change <id>` reports spec scenarios with no row in the behavioral table. Cover them or explain why they cannot be exercised.
6. **Decide.** Any mismatch -> back to `/sdlc:build`, then verify again. All clean -> report the result and continue with `/sdlc:review`.

<!--
Generated by sdlc 0.31.1 (https://github.com/marin-ai-tech/sdlc).
Required Notice: Copyright (c) 2026 marin-ai technologies (https://github.com/marin-ai-tech/sdlc)
License: PolyForm Noncommercial 1.0.0 (https://polyformproject.org/licenses/noncommercial/1.0.0) with the sdlc Additional Permissions, or a commercial license; see https://github.com/marin-ai-tech/sdlc
-->

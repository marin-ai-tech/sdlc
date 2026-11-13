---
name: build
description: Implement an SDLC change from its approved plan (Stage 3, Build) with a continuous feedback loop - work through tasks.md, run the project's checks after each step, keep plan.md in sync. Use when the plan gate is approved and the user asks to implement, build, or apply the change.
argument-hint: "[change-id]"
license: "PolyForm-Noncommercial-1.0.0 with sdlc Additional Permissions, or sdlc Commercial License (https://github.com/marin-ai-tech/sdlc)"
compatibility: Requires the sdlc CLI (sdlc) from the sdlc package.
allowed-tools: Bash(sdlc *)
metadata:
  author: marin-ai technologies
  version: "1"
  generatedBy: "sdlc 0.31.1"
---

Implement the approved plan - Stage 3 (Build). Every step checks its own work before a person sees it.

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

1. **Check the gate.** `sdlc status --change <id> --json`: the `plan` gate must be `approved` (or `waived`). If it is `stale`, the plan changed after approval: stop and ask the engineer to re-approve. If it is pending, stop - do not implement an unapproved plan.
2. **Load context from disk**: intent.md, proposal.md, specs/, design.md, plan.md, tasks.md. Put the `tasks.md` items into TodoWrite at the start and keep it in step as tasks are checked. `tasks.md` stays the source of truth. Run `sdlc verify --list` to learn the project's checks.
   For each artifact you write or update, use `sdlc instructions <artifact> --change <id> --json` and write to its `resolvedOutputPath`.
3. **Parallel streams.** If plan.md marks independent steps `[parallel]` and they touch different files, suggest running them in separate worktrees/sessions; tasks that share files stay sequential in this session.
4. **Bug-fix protocol** (`kind: bugfix`): the first task writes a test that reproduces the bug. Run it, confirm it
   fails for the expected reason and present the concrete baseline commit draft. Complete that checkpoint under
   the project's commit rules before running `sdlc tests lock --change <id>` - from then on the harness blocks
   edits to test files, so the fix has to change the code.
5. **Work the tasks in order.** For each pending task:
   - make the smallest change that satisfies it
   - run the most targeted check first (the test for this behavior), then the group's checks
   - fix the code until the checks pass - never skip, weaken or delete a test to get green
   - mark `- [ ]` -> `- [x]` only when the task's behavior is fully implemented and its check passed
   - when the implementation must depart from plan.md, stop and propose the plan.md change: a changed plan.md makes the plan approval stale, and the hook blocks code until the engineer approves the plan again; after approval only tick tasks.md boxes
   - end each commit message with the trailers `SDLC-Change: <id>` and `SDLC-Task: <n.m>` (the task number from tasks.md), so `sdlc trace <id>` links the task to its commit
   - present the literal `git add -- <paths>` and `git commit -F <message-file>` draft for that checkpoint, following
     the contract's quoting and project commit policy; a reserved commit waits for the person to run or confirm it
6. **Pause** when a task is unclear, when the design turns out wrong (propose an artifact update), when the work grows beyond the spec, or on any error you cannot resolve. Do not absorb scope silently.
7. **Finish.** When every implementation task is checked, run the `/sdlc:verify` workflow.
   The verify gate records the checks and needs no task of its own.

**Output while working**: `Working on task N/M: <task>` ... `✓ done (<check> passed)`; on pause, the issue and options.

<!--
Generated by sdlc 0.31.1 (https://github.com/marin-ai-tech/sdlc).
Required Notice: Copyright (c) 2026 marin-ai technologies (https://github.com/marin-ai-tech/sdlc)
License: PolyForm Noncommercial 1.0.0 (https://polyformproject.org/licenses/noncommercial/1.0.0) with the sdlc Additional Permissions, or a commercial license; see https://github.com/marin-ai-tech/sdlc
-->

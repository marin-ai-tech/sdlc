---
id: build
title: "SDLC: Build"
description: Implement an SDLC change from its approved plan (Stage 3, Build) with a continuous feedback loop - work through tasks.md, run the project's checks after each step, keep plan.md in sync. Use when the plan gate is approved and the user asks to implement, build, or apply the change.
command-description: Stage 3 (Build) - implement the approved plan with a test feedback loop
argument-hint: "[change-id]"
---
Implement the approved plan - Stage 3 (Build). Every step checks its own work before a person sees it.

{{contract}}

**Input**: {{input}}

**Steps**

1. **Check the gate.** `sdlc status --change <id> --json`: the `plan` gate must be `approved` (or `waived`). If it is `stale`, the plan changed after approval: stop and ask the engineer to re-approve. If it is pending, stop - do not implement an unapproved plan.
2. **Load context from disk**: intent.md, proposal.md, specs/, design.md, plan.md, tasks.md. Put the `tasks.md` items into {{tool:todo}} at the start and keep it in step as tasks are checked. `tasks.md` stays the source of truth. Run `sdlc verify --list` to learn the project's checks.
3. **Parallel streams.** If plan.md marks independent steps `[parallel]` and they touch different files, suggest running them in separate worktrees/sessions; tasks that share files stay sequential in this session.
4. **Bug-fix protocol** (`kind: bugfix`): the first task writes a test that reproduces the bug. Run it, confirm it fails for the expected reason, commit it, then run `sdlc tests lock --change <id>` - from then on the harness blocks edits to test files, so the fix has to change the code.
5. **Work the tasks in order.** For each pending task:
   - make the smallest change that satisfies it
   - run the most targeted check first (the test for this behavior), then the group's checks
   - fix the code until the checks pass - never skip, weaken or delete a test to get green
   - mark `- [ ]` -> `- [x]` only when the task's behavior is fully implemented and its check passed
   - when the implementation departs from plan.md, update plan.md in the same commit
   - end each commit message with the trailers `SDLC-Change: <id>` and `SDLC-Task: <n.m>` (the task number from tasks.md), so `sdlc trace <id>` links the task to its commit
6. **Pause** when a task is unclear, when the design turns out wrong (propose an artifact update), when the work grows beyond the spec, or on any error you cannot resolve. Do not absorb scope silently.
7. **Finish.** When every task is checked, run the {{cmd:verify}} workflow (it records `sdlc verify` evidence and gets an independent verification).

**Output while working**: `Working on task N/M: <task>` ... `✓ done (<check> passed)`; on pause, the issue and options.

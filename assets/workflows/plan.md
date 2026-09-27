---
id: plan
title: "SDLC: Plan"
description: Produce the implementation plan (Stage 3, Build) from an approved spec - plan.md (files that change, order of work, risks, proof, rollback) and tasks.md - for engineer approval before any code is written. Use after the spec gate is approved or when the user asks for an implementation plan.
command-description: Stage 3 (Build) - plan-mode implementation plan (plan.md + tasks.md) for engineer approval
argument-hint: "[change-id]"
---
Produce the implementation plan - Stage 3 (Build). Nothing is implemented without an accepted plan: the plan is reviewed while changing course is still a matter of editing a document.

{{contract}}

**Input**: {{input}}

**Steps**

1. **Check the gate.** `sdlc status --change <id> --json`: the `spec` gate must be `approved`, `waived` or `n/a` (a `lite` change skips intent and spec). Otherwise stop and report.
2. **Stay read-only while planning.** {{plan-mode}} Read intent.md, proposal.md, specs/ and design.md from disk; explore the codebase (use the `sdlc-researcher` subagent for broad searches).
3. **Draft `plan.md`**: `sdlc instructions plan --change <id> --json`, then fill every section - files that change, order of work (mark independent steps `[parallel]`), risks, alternatives considered, proof (tests per spec scenario, the `sdlc verify` checks, visual evidence), rollback.
4. **Interrogate the plan with the engineer.** Ask: what could this change break? Which step is riskiest? Which options were rejected and why? Iterate until an engineer who never saw this conversation could implement the change from plan.md alone.
5. **Write `tasks.md`**: `sdlc instructions tasks --change <id> --json`. For a bug fix the first task writes the failing test that reproduces the bug.
6. **Stop at the gate.** Present the plan and give the engineer the approval command: `sdlc approve plan --change <id>` (`risk: high` also needs `--as tech-lead`). Implementation starts with {{cmd:build}} only after approval.

**Guardrails**
- Do not edit project code in this workflow.
- Plans name concrete files and concrete tests; "explore the codebase" or "figure out X" is not a task - do that discovery now.
- If the plan reveals the spec is wrong, stop and propose a spec revision (the spec gate will need re-approval) rather than planning around it.

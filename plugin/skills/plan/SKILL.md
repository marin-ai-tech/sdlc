---
name: plan
description: Produce the implementation plan (Stage 3, Build) from an approved spec - plan.md (files that change, order of work, risks, proof, rollback) and tasks.md - for engineer approval before any code is written. Use after the spec gate is approved or when the user asks for an implementation plan.
argument-hint: "[change-id]"
license: "PolyForm-Noncommercial-1.0.0 with sdlc Additional Permissions, or sdlc Commercial License (https://github.com/marin-ai-tech/sdlc)"
compatibility: Requires the sdlc CLI (sdlc) from the sdlc package.
allowed-tools: Bash(sdlc *)
metadata:
  author: marin-ai technologies
  version: "1"
  generatedBy: "sdlc 0.31.1"
---

Produce the implementation plan - Stage 3 (Build). Nothing is implemented without an accepted plan: the plan is reviewed while changing course is still a matter of editing a document.

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

1. **Check the gate.** `sdlc status --change <id> --json`: the `spec` gate must be `approved`, `waived` or `n/a` (a `lite` change skips intent and spec). Otherwise stop and report.
2. **Stay read-only while planning.** If the session is in plan mode, explore read-only and present the plan for acceptance first; write plan.md and tasks.md once it is accepted. Otherwise edit only those two files. Read intent.md, proposal.md, specs/ and design.md from disk; explore the codebase (use the `sdlc-researcher` subagent for broad searches).
3. **Draft `plan.md`**: `sdlc instructions plan --change <id> --json`, then fill every section - files that change,
   order of work (mark independent steps `[parallel]`), risks, alternatives considered, proof (tests per spec scenario,
   the `sdlc verify` checks, visual evidence), rollback. Under "Files that change", write paths in backticks, one per
   list item. Write the artifact to `resolvedOutputPath` from that JSON response.
4. **Interrogate the plan with the engineer.** Ask: what could this change break? Which step is riskiest? Which options were rejected and why? Iterate until an engineer who never saw this conversation could implement the change from plan.md alone.
5. **Write `tasks.md`**: `sdlc instructions tasks --change <id> --json`. For a bug fix, name the reproducing
   test in the plan; the first build task writes and runs it after a person approves the plan. Write tasks to that
   response's `resolvedOutputPath`. Manual, browser and device checks and screenshots that only the verify stage can
   do belong under Proof, not in tasks.md; record them in plan.md.
6. **Stop at the gate.** Present the plan and give the engineer the approval command: `sdlc approve plan --change <id>` (`risk: high` also needs `--as tech-lead`). Implementation starts with `/sdlc:build` only after approval.

**Guardrails**
- In solo mode, use the developer role's planning responsibilities and the architect skill for a deliberate design
  review. Announce each switch; neither role grants gate authority. Offer a concrete artifact commit draft when
  the plan is ready, following the project's commit policy and without beginning implementation before approval.
- Do not edit project code in this workflow.
- Plans name concrete files and concrete tests; "explore the codebase" or "figure out X" is not a task - do that discovery now.
- If the plan reveals the spec is wrong, stop and propose a spec revision (the spec gate will need re-approval) rather than planning around it.

<!--
Generated by sdlc 0.31.1 (https://github.com/marin-ai-tech/sdlc).
Required Notice: Copyright (c) 2026 marin-ai technologies (https://github.com/marin-ai-tech/sdlc)
License: PolyForm Noncommercial 1.0.0 (https://polyformproject.org/licenses/noncommercial/1.0.0) with the sdlc Additional Permissions, or a commercial license; see https://github.com/marin-ai-tech/sdlc
-->

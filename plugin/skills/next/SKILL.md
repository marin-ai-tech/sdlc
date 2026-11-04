---
name: next
description: "Advance an SDLC change to its next step in the AI-native lifecycle (intent, spec, plan, build, verify, review, release, archive). Use when the user says \"continue\", \"next step\", \"what's next\", or wants to move a change forward without naming the stage."
when_to_use: The user says continue, asks what is next, or wants to start a ready backlog item.
argument-hint: "[change-id]"
license: "PolyForm-Noncommercial-1.0.0 with sdlc Additional Permissions, or sdlc Commercial License (https://github.com/marin-ai-tech/sdlc)"
compatibility: Requires the sdlc CLI (sdlc) from the sdlc package.
allowed-tools: Bash(sdlc *)
metadata:
  author: marin-ai technologies
  version: "1"
  generatedBy: "sdlc 0.30.1"
---

Advance a change to its next step in the SDLC.

!`sdlc next --json`
If the output above is missing, run `sdlc next --json`.

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

1. Select the change (see Change selection). If none is active, run `sdlc next --json`.
2. Run `sdlc next --change <id> --json` for an active change. It returns the derived `stage` and `next`.
   In solo mode, prefix the next-step explanation with the active `next.executionRole` and load its bundled role
   skill before continuing. Announce stage/role switches; execution guidance never changes human authority.
3. If ready backlog items are available, use the AskUserQuestion tool with 2-4 choices and a recommended item. If `next.action` is `start-backlog-item`, run `sdlc backlog start <id>` using `next.item`, then continue with intent.
4. If `next.actor` is `human`: stop. Summarize what the person must review (the artifacts or evidence listed by `sdlc status --change <id>`), then give the exact `next.cli` command for them to run in their own terminal. Do not start work that the gate protects.
   For unanswered questions, show an editable proposed answer and the full literal command, keeping the decision
   pending until the person runs it. Follow project rules for any commit checkpoint and offer its concrete draft.
5. If `next.actor` is `agent`: run the workflow named by `next.workflow` - load the ``sdlc:<workflow>`` skill (or follow `/sdlc:<workflow>`) and carry out its steps for this change.
6. If `next.actor` is `none`: report that the change is archived or complete.

**Output**: the stage, what was done, and the next step (with the exact command when a person must act).

<!--
Generated by sdlc 0.30.1 (https://github.com/marin-ai-tech/sdlc).
Required Notice: Copyright (c) 2026 marin-ai technologies (https://github.com/marin-ai-tech/sdlc)
License: PolyForm Noncommercial 1.0.0 (https://polyformproject.org/licenses/noncommercial/1.0.0) with the sdlc Additional Permissions, or a commercial license; see https://github.com/marin-ai-tech/sdlc
-->

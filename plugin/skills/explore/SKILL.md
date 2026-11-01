---
name: explore
description: Research and pressure-test an idea before deciding whether to write intent.
when_to_use: The user wants to explore an idea, compare alternatives, or decide whether to proceed.
argument-hint: "<idea or slug>"
license: "PolyForm-Noncommercial-1.0.0 with sdlc Additional Permissions, or sdlc Commercial License (https://github.com/marin-ai-tech/sdlc)"
compatibility: Requires the sdlc CLI (sdlc) from the sdlc package.
allowed-tools: Bash(sdlc *)
metadata:
  author: marin-ai technologies
  version: "1"
  generatedBy: "sdlc 0.30.0"
---

Explore an idea without starting a change. An exploration can end here and never become an intent.

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

If the input is empty, stop and ask the user in plain text which idea to explore: what it is, why now, and any constraints. Do not invent a topic and do not create a note until they answer.

**Steps**

1. Derive a short kebab-case slug from the idea. Create the note with `sdlc explore <slug>` at `openspec/explorations/<slug>.md`. If it already exists, read and continue it; never overwrite it.
2. Restate the problem in the originator's words under **Problem**. Keep uncertainty explicit.
3. Read the relevant code, run `sdlc openspec list --specs`, and inspect archived changes. Summarize the current behavior and prior decisions under **What exists**.
4. Delegate external and codebase research to the `sdlc-researcher` subagent. Record findings and their sources under **Research**, distinguishing evidence from inference.
5. Write two or three comparable **Alternatives**, including “do nothing”. Compare expected benefit, effort, and what each leaves unresolved.
6. **Pressure test** each option through four named lenses. For each, state the assumption and how it could fail: **user** (who actually needs this, and how do we know?), **technical** (what could make it infeasible?), **cost** (build and run), and **risk** (security, privacy, compliance, reversibility).
7. Recommend **proceed**, **reshape**, or **stop**, with reasons and open questions. Use the AskUserQuestion tool to offer those three choices, mark the recommendation, and explain each consequence. A weak idea may stop here.
8. If proceeding, add the idea with `sdlc backlog add <title> --outcome <outcome> --accept <measure> --source-type exploration --source-ref openspec/explorations/<slug>.md`. The backlog priority determines when it starts. Once started, continue with `/sdlc:intent`.

**Pausing and resuming**
- Before you stop to wait for the person's answer or for research, write your questions under **Open questions** in the note and mark every unfinished section with `_pending: <what is missing>_`. The note, not the chat, must show where the exploration stopped.
- When the note already exists, read it and continue from the first pending section; do not restart.
- If the person cannot answer, continue with explicit assumptions, record them under **Open questions**, and say how the recommendation would change if an assumption is wrong.

**Guardrails**
- Research only: do not edit project code.
- Keep the note concise and cite sources for claims that determine the recommendation.

<!--
Generated by sdlc 0.30.0 (https://github.com/marin-ai-tech/sdlc).
Required Notice: Copyright (c) 2026 marin-ai technologies (https://github.com/marin-ai-tech/sdlc)
License: PolyForm Noncommercial 1.0.0 (https://polyformproject.org/licenses/noncommercial/1.0.0) with the sdlc Additional Permissions, or a commercial license; see https://github.com/marin-ai-tech/sdlc
-->

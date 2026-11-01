---
name: backlog
description: See the backlog, decompose an epic or an idea into items, bring an item to ready and start it - always through the sdlc backlog commands.
when_to_use: The user wants to see or plan the backlog, split an epic or idea into items, refine an item, or start the next one.
argument-hint: "[epic, idea or B<n>]"
license: "PolyForm-Noncommercial-1.0.0 with sdlc Additional Permissions, or sdlc Commercial License (https://github.com/marin-ai-tech/sdlc)"
compatibility: Requires the sdlc CLI (sdlc) from the sdlc package.
allowed-tools: Bash(sdlc *)
metadata:
  author: marin-ai technologies
  version: "1"
  generatedBy: "sdlc 0.30.0"
---

Work with the backlog (`openspec/backlog.md`): the ordered list of planned changes. One item becomes one change.

**Harness contract** (applies to every SDLC workflow)
- `sdlc` is the source of truth for lifecycle state. Read it (`sdlc status --change <id> --json`) instead of inferring the stage from the conversation, and re-read artifacts from disk before using them.
- Gates are human decisions. Never run `sdlc approve`, `sdlc reject`, `sdlc waive` or `sdlc tests unlock`, and never edit `.sdlc.yaml`. When a gate needs a person, stop, name the people from the hint (`next.people` in `sdlc next --json`) rather than the role, and give them the exact command to run in their own terminal.
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
  Show the filename and full content. Keep drafts inside the project, preserve existing user files and edits,
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

**Rules**
- Never edit `openspec/backlog.md` directly: the hook denies it. Every change goes through `sdlc backlog add`, `sdlc backlog epic add` and `sdlc backlog edit`.
- Order and removal are a person's decision. When an item should move or go, give the person the exact command to run in their own terminal (`sdlc backlog move B<n> --top`, `--before B<m>`, `--epic E<n>`, or `sdlc backlog drop B<n> --note "<reason>"`), explain why, and do not run it yourself.
- An item is ready when it has an outcome, at least one acceptance criterion and every dependency done.
- **Owner granularity**: read the epic's `granularity` in `sdlc backlog list --json` before proposing a split.
  Reuse an already explicit owner choice from the epic or the current request; do not ask the same sizing question
  again. Persist it with `sdlc backlog epic edit E<n> --granularity <package|feature|small>` (or the same flag on
  `epic add`). `package` keeps the coordinated work together, `feature` groups coherent outcomes, and `small`
  proposes smaller independently checkable changes. When there is no explicit choice, show the proposed size and
  split for confirmation before adding items. Preserve existing priorities and items.

**Steps**

1. **Without input: show the backlog.** Run `sdlc backlog list` and `sdlc backlog next`. Name the next ready item and, for every open item that is not ready, what blocks it: no outcome, no acceptance criteria, or open dependencies (`sdlc backlog list --json` has `missing` and `blockedBy`). Offer to refine one of them or to start the next ready item.
2. **With an epic or an idea: decompose.** Read the code, specs (`sdlc openspec list --specs`) and related explorations first. Propose items small enough for one change each; every item has a title, an outcome, at least one acceptance criterion, and its dependencies on the other items. Show the list and ask the person to confirm it with the AskUserQuestion tool (all, a subset, or revise). Add only the confirmed items: `sdlc backlog epic add "<title>" --goal "<goal>"` when the epic is new, then `sdlc backlog add "<title>" --epic E<n> --outcome "<outcome>" --accept "<criterion>" --depends B<n>` for each item, in the order you proposed.
3. **With an item `B<n>`: bring it to ready.** Read the item (`sdlc backlog list --json`) and ask what is missing. Write the answers with `sdlc backlog edit B<n> --outcome "<outcome>" --accept "<criterion>" --depends B<m>` (`--accept` and `--depends` replace the list; `--add-accept` appends; `--title`, `--kind`, `--risk` change the rest). Then offer to start it: `sdlc backlog start B<n>` creates the change with a draft intent; continue with `/sdlc:intent`.
4. **Priorities.** If the person wants a different order, or an item is no longer needed, give the exact `sdlc backlog move …` or `sdlc backlog drop …` command for them to run.
5. **Finish** with the backlog state after your changes (`sdlc backlog list`) and the next step from `sdlc next --json`.

<!--
Generated by sdlc 0.30.0 (https://github.com/marin-ai-tech/sdlc).
Required Notice: Copyright (c) 2026 marin-ai technologies (https://github.com/marin-ai-tech/sdlc)
License: PolyForm Noncommercial 1.0.0 (https://polyformproject.org/licenses/noncommercial/1.0.0) with the sdlc Additional Permissions, or a commercial license; see https://github.com/marin-ai-tech/sdlc
-->

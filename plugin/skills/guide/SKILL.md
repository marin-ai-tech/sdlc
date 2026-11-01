---
name: guide
description: Explain how to work with sdlc in this project - stages, gates and approvals, roles, tracks, bug fixes, the backlog, rework and takeover, verification, review, MCP, configuration, and why the hook denied something. Use when the user asks how sdlc works, how to do something with it, what a term means, which command a person runs, or why an action was refused.
when_to_use: The user asks how sdlc works, how to do something with it, what a gate, track or rework is, or why the hook said no.
argument-hint: "[question]"
license: "PolyForm-Noncommercial-1.0.0 with sdlc Additional Permissions, or sdlc Commercial License (https://github.com/marin-ai-tech/sdlc)"
compatibility: Requires the sdlc CLI (sdlc) from the sdlc package.
allowed-tools: Bash(sdlc *)
metadata:
  author: marin-ai technologies
  version: "1"
  generatedBy: "sdlc 0.30.0"
---

Answer the user's question about working with sdlc, for this project and its current state.

!`sdlc guide --json`
If the output above is missing, run `sdlc guide --json`.

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

**Question**: the user's request (a change id, or a description of the work)

1. **Find the material.** Pick the topic from the list above that answers the question and read it:
   `sdlc guide <topic> --json`. For a hook denial, read the section of its rule: `sdlc guide denials#<rule> --json`
   This includes `living-specs` and `change-not-created`: write delta specs in a change created by `sdlc new`,
   and let `sdlc archive` update living specs after approval.
   (the rule is in brackets in the denial, for example `[sdlc:plan-gate]`).
2. **Look at the real situation** when the question is about a change: `sdlc status --json`, `sdlc next --json`, and
   `sdlc next --me --json` for "what is waiting for me".
3. **Answer for this project**, in the user's language: what it means, what to do now, and the exact commands with this
   project's change ids. Keep it short; offer the topic for more.
4. **Decisions stay with the person.** Approving, rejecting, waiving, rework, takeover, track and backlog order, test
   unlock, license and uninstall are the person's commands: give the command for their own terminal (not a `!` command
   in this chat) and never run it yourself.
5. If the guide does not cover the question, say so, answer from `sdlc help --json` and the project files, and do not
   guess at behaviour you cannot see.

<!--
Generated by sdlc 0.30.0 (https://github.com/marin-ai-tech/sdlc).
Required Notice: Copyright (c) 2026 marin-ai technologies (https://github.com/marin-ai-tech/sdlc)
License: PolyForm Noncommercial 1.0.0 (https://polyformproject.org/licenses/noncommercial/1.0.0) with the sdlc Additional Permissions, or a commercial license; see https://github.com/marin-ai-tech/sdlc
-->

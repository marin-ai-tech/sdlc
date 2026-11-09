---
name: adopt
description: Prepare an existing project for agents - check the layout, adapt or scaffold the documents, fill them from the code, and draft the sdlc settings and roles for a person to apply.
when_to_use: sdlc was just installed in an existing project, or the agent documents are missing, empty or out of date.
argument-hint: "[area to focus on]"
license: "PolyForm-Noncommercial-1.0.0 with sdlc Additional Permissions, or sdlc Commercial License (https://github.com/marin-ai-tech/sdlc)"
compatibility: Requires the sdlc CLI (sdlc) from the sdlc package.
allowed-tools: Bash(sdlc *)
metadata:
  author: marin-ai technologies
  version: "1"
  generatedBy: "sdlc 0.31.0"
---

Prepare an existing project for work with agents: the documents agents rely on, filled from the real code, and the sdlc settings drafted from the repository.

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

**Rules**
- Fill documents from the code, not from guesses. Every statement carries a file reference (a file path, with a line when it helps). Mark anything you could not confirm with "to check" so the person reviews it.
- Moving files is the person's decision: `sdlc layout convert` is only proposed (show the plan from `sdlc layout convert`; the person runs `--apply` in their own terminal if they want it).
- Applying the settings is the person's step: `sdlc adopt --apply` writes `openspec/sdlc.yaml` and `openspec/roles.yaml`. Give the person the command; do not run it yourself.
- For configuration changes outside the adoption draft, use `sdlc config propose` and show the proposal to the person.

**Steps**

1. **Check the layout.** Run `sdlc layout check` and list the documents that are missing or empty.
2. **Existing documents stay where they are.** If the project already has them under other names (`ARCHITECTURE.md`, `docs/adr/`, `CONTRIBUTING.md`…), run `sdlc layout adapt --dry-run`, show the mapping, then `sdlc layout adapt`. If canonical paths would serve the project better, suggest `sdlc layout convert` and show its plan; the person decides.
3. **Missing documents.** Run `sdlc layout scaffold`, then fill each new file from the code: architecture (modules and how they connect), conventions (style, naming, error handling as the code actually does it), build and test commands (from the build files and CI), glossary (domain terms from the code and specs), sensitive areas (security, money, data, migrations) and decisions already visible in the history. `AGENTS.md` is the main file for OpenCode; keep it short and link to the others. Work through the input's area first when one is given. The review policy (`REVIEW.md`), `openspec/config.yaml` and the sdlc schema are a person's: do not edit them; put the review passes, severities and artifact rules this project needs into your report for the person.
4. **Settings and roles.** Run `sdlc adopt` and show the draft: stack, CI, verify commands, protected paths, people from git and CODEOWNERS, and the proposed `openspec/roles.yaml`. Point out what looks wrong (bots among the people, a maintainer who left). To apply it, the person runs `sdlc adopt --apply` in their own terminal.
5. **Finish** with a summary: which documents were created or filled, every "to check" item for the person, whether the settings draft still needs to be applied, and the next step from `sdlc next --json`.

<!--
Generated by sdlc 0.31.0 (https://github.com/marin-ai-tech/sdlc).
Required Notice: Copyright (c) 2026 marin-ai technologies (https://github.com/marin-ai-tech/sdlc)
License: PolyForm Noncommercial 1.0.0 (https://polyformproject.org/licenses/noncommercial/1.0.0) with the sdlc Additional Permissions, or a commercial license; see https://github.com/marin-ai-tech/sdlc
-->

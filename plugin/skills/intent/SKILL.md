---
name: intent
description: "Capture an idea, request, ticket or problem as intent.md, the Stage 1 (Plan) artifact of the AI-native SDLC, for product-owner approval. Use when the user describes something they want built or fixed, or says \"new idea\", \"capture intent\", \"start a change\"."
argument-hint: "<idea, request, or ticket id>"
license: "PolyForm-Noncommercial-1.0.0 with sdlc Additional Permissions, or sdlc Commercial License (https://github.com/marin-ai-tech/sdlc)"
compatibility: Requires the sdlc CLI (sdlc) from the sdlc package.
allowed-tools: Bash(sdlc *)
metadata:
  author: marin-ai technologies
  version: "1"
  generatedBy: "sdlc 0.31.1"
---

Capture an idea as `intent.md` - Stage 1 (Plan). The intent is the originator's proto-spec: what is wanted, why, and under which constraints, in their own words.

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

If the input is empty, stop and ask the user in plain text for the idea or problem to capture (and the change it belongs to, if any). Do not invent one and do not create a change until they answer.

**Steps**

1. **Choose the change.** If the input names an existing change, use it. Otherwise derive a short kebab-case name (e.g. "customers keep calling about claim status" -> `claims-status-self-service`) and create it:
   ```bash
   sdlc new <name> --kind <feature|bugfix|refactor|chore|docs|security|incident> --risk <low|medium|high> [--source-type ticket --source-ref <id>]
   ```
   Infer kind and risk; when unclear use the AskUserQuestion tool with 2-4 plausible choices and a recommended one. Risk is `high` for security, privacy, payments, data migration, compliance, or a wide blast radius.
2. **Get the instructions**: `sdlc instructions intent --change <name> --json`. Use `template` as the structure, follow `instruction`, treat `context` and `rules` as constraints (never copy them into the file), write to `resolvedOutputPath`.
   If the change's source is an exploration, or the user points to `openspec/explorations/<slug>.md`, read that note first. Do not ask again what it already answers; carry its unresolved questions into intent's Open questions.
3. **Brainstorm until the idea is concrete.** For open questions with a small answer set, use the AskUserQuestion tool with 2-4 choices and a recommended one. Ask about scope, users, constraints and success one or two at a time. Read the code and existing specs (`sdlc openspec list --specs`) first.
4. **Write `intent.md`** with `Status: draft`. No solution design, file names or task lists.
5. **Confirm with the originator** and correct anything misunderstood.
6. **Stop at the gate.** Tell the user the intent is ready for the product owner, who accepts it with `sdlc approve intent --change <name>` or sends it back with `sdlc reject intent --change <name> --note "<why>"`. The spec is written only after acceptance (`/sdlc:spec`).

**Guardrails**
- At each human question, show an editable proposed answer and its literal command from the contract. Keep the
  question pending until the authorized person runs `sdlc answer`; the draft itself records no answer or approval.
- Planning only: do not edit project code in this workflow, even if the request asks for implementation.
- One page. Record assumptions as Open questions rather than guessing.
- Open questions are the person's to answer. Never write an answer yourself (an `Answer` line you add does not count); keep them as list items under the `## Open questions` heading. When you stop at the gate, name them in your message (read them from the file: `sdlc answer` is a person's command, never run it) and give the command for each: `sdlc answer <n> --change <name> --text '<answer>'`. The intent cannot be approved while one is unanswered.
- If a change with that name already exists, ask whether to continue it or start a new one.

<!--
Generated by sdlc 0.31.1 (https://github.com/marin-ai-tech/sdlc).
Required Notice: Copyright (c) 2026 marin-ai technologies (https://github.com/marin-ai-tech/sdlc)
License: PolyForm Noncommercial 1.0.0 (https://polyformproject.org/licenses/noncommercial/1.0.0) with the sdlc Additional Permissions, or a commercial license; see https://github.com/marin-ai-tech/sdlc
-->

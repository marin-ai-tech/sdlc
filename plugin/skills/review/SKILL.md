---
name: review
description: Review a verified SDLC change (Stage 5, Deploy) in independent passes - bugs, security, compliance with the spec, plan and design principles in REVIEW.md - record severity-ranked findings in review.md, fix the important ones, and hand off to a human code owner. Use when the user asks for a review, a PR review, or to address review findings.
argument-hint: "[change-id]"
license: "PolyForm-Noncommercial-1.0.0 with sdlc Additional Permissions, or sdlc Commercial License (https://github.com/marin-ai-tech/sdlc)"
compatibility: Requires the sdlc CLI (sdlc) from the sdlc package.
allowed-tools: Bash(sdlc *)
metadata:
  author: marin-ai technologies
  version: "1"
  generatedBy: "sdlc 0.30.0"
---

Review the change - Stage 5 (Deploy). Every change gets the same passes with severity-ranked findings, so the human reviewer can focus on intent and risk. The agent that wrote the code never approves it.

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

**Steps**

1. **Check the gate.** `sdlc status --change <id> --json`: the `verify` gate must be `passed`. Otherwise run `/sdlc:verify` first.
2. **Gather context**: `sdlc review context --change <id> --json` returns the base ref, changed files, the review policy (REVIEW.md passes, severity definitions, nit cap, exclusions), spec/plan/design paths, and **plan drift** - files changed but not named in plan.md, and planned files that were not touched.
3. **Run every pass and lens in fresh context.** Delegate to the `sdlc-reviewer` subagent once per pass or lens:
   - **bugs**: logic errors, broken edge cases, subtle regressions
   - **security**: injection, authentication/authorization gaps, secrets, PII in logs or errors
   - **compliance**: the diff implements every spec scenario and only those; it follows plan.md (explain each plan-drift file) and the design decisions and policies
   - **adversarial**: hostile inputs and attacker paths
   - **edge-cases**: boundaries, empty, huge, concurrent and Unicode inputs, failure paths
   - **verification-gaps**: behaviour that tests and evidence do not prove
4. **Write `review.md`** from `sdlc instructions review --change <id> --json`. Each finding: `### F<n> [important|nit|pre-existing][pass-or-lens] <title>` with Where, Detail, Fix and `Status: open`. Rank by severity; respect the nit cap. Fill `## Coverage` with one line per pass and lens: a finding count or `none found — checked: <specific work checked>`.
   Write it to the response's `resolvedOutputPath`.
5. **Fix loop.** For each finding with a genuine choice, use the AskUserQuestion tool to offer fix, defer, or accept with a recommendation and consequences. Fix important findings with the build discipline, re-run `sdlc verify --change <id>`, and set `fixed (<commit or note>)`. Nits: fix cheaply or mark `accepted (<reason>)`. For deferred work, run `sdlc defer add "<title>" --why "<why>" --change <id> --finding <F-id>` and set `Status: deferred (D<n>)` using the returned id.
6. **Check**: `sdlc review check --change <id>` must report zero open blocking findings.
   For each verified fix, offer the concrete change/task commit draft with literal paths and required trailers.
   Where project rules reserve commits, the person runs or confirms it; the reviewer role grants no commit authority.
7. **Learn.** When a finding repeats a mistake seen before, propose the correction as a CLAUDE.md / AGENTS.md rule (or a skill update) so the next change avoids it.
8. **Stop at the gate.** Summarize the findings and fixes, then ask a code owner to read the diff and review.md and run `sdlc approve review --change <id>`. With `openspec/roles.yaml`, name the reviewer `sdlc review suggest --change <id> --json` proposes (owners of the changed files first, never the code's author); the person still decides. When the project uses pull requests, open or update the PR with the review summary and the `sdlc status` report; branch protection stays the merge authority.

<!--
Generated by sdlc 0.30.0 (https://github.com/marin-ai-tech/sdlc).
Required Notice: Copyright (c) 2026 marin-ai technologies (https://github.com/marin-ai-tech/sdlc)
License: PolyForm Noncommercial 1.0.0 (https://polyformproject.org/licenses/noncommercial/1.0.0) with the sdlc Additional Permissions, or a commercial license; see https://github.com/marin-ai-tech/sdlc
-->

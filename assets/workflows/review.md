---
id: review
title: "SDLC: Review"
description: Review a verified SDLC change (Stage 5, Deploy) in independent passes - bugs, security, compliance with the spec, plan and design principles in REVIEW.md - record severity-ranked findings in review.md, fix the important ones, and hand off to a human code owner. Use when the user asks for a review, a PR review, or to address review findings.
command-description: Stage 5 (Deploy) - multi-pass review against REVIEW.md, spec and plan; fix loop
argument-hint: "[change-id]"
---
Review the change - Stage 5 (Deploy). Every change gets the same passes with severity-ranked findings, so the human reviewer can focus on intent and risk. The agent that wrote the code never approves it.

{{contract}}

**Input**: {{input}}

**Steps**

1. **Check the gate.** `sdlc status --change <id> --json`: the `verify` gate must be `passed`. Otherwise run {{cmd:verify}} first.
2. **Gather context**: `sdlc review context --change <id> --json` returns the base ref, changed files, the review policy (REVIEW.md passes, severity definitions, nit cap, exclusions), spec/plan/design paths, and **plan drift** - files changed but not named in plan.md, and planned files that were not touched.
3. **Run the passes in fresh context.** Delegate to the `sdlc-reviewer` subagent - one invocation per pass for a large diff, otherwise one for all:
   - **bugs**: logic errors, broken edge cases, subtle regressions
   - **security**: injection, authentication/authorization gaps, secrets, PII in logs or errors
   - **compliance**: the diff implements every spec scenario and only those; it follows plan.md (explain each plan-drift file) and the design decisions and policies
4. **Write `review.md`** from `sdlc instructions review --change <id> --json`. Each finding: `### F<n> [important|nit|pre-existing][bugs|security|compliance] <title>` with Where, Detail, Fix and `Status: open`. Rank by severity; respect the nit cap.
5. **Fix loop.** For each `important` finding: fix it with the build discipline (tests stay the judge), re-run `sdlc verify --change <id>`, and set its status to `fixed (<commit or note>)`. Nits: fix cheaply or mark `accepted (<reason>)`.
6. **Check**: `sdlc review check --change <id>` must report zero open blocking findings.
7. **Learn.** When a finding repeats a mistake seen before, propose the correction as a CLAUDE.md / AGENTS.md rule (or a skill update) so the next change avoids it.
8. **Stop at the gate.** Summarize the findings and fixes, then ask a code owner to read the diff and review.md and run `sdlc approve review --change <id>`. When the project uses pull requests, open or update the PR with the review summary and the `sdlc status` report; branch protection stays the merge authority.

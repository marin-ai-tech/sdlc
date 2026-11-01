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
3. **Run every pass and lens in fresh context.** Take the list from the review context's `passes` and `lenses` (it
   includes the lenses of accepted context packs) and delegate to the `{{agent:reviewer}}` subagent once per pass or
   lens. The built-in ones are:
   - **bugs**: logic errors, broken edge cases, subtle regressions
   - **security**: injection, authentication/authorization gaps, secrets, PII in logs or errors
   - **compliance**: the diff implements every spec scenario and only those; it follows plan.md (explain each plan-drift file) and the design decisions and policies
   - **adversarial**: hostile inputs and attacker paths
   - **edge-cases**: boundaries, empty, huge, concurrent and Unicode inputs, failure paths
   - **verification-gaps**: behaviour that tests and evidence do not prove
4. **Write `review.md`** from `sdlc instructions review --change <id> --json`. Each finding: `### F<n> [important|nit|pre-existing][pass-or-lens] <title>` with the bullets `- **Where**:`, `- **Detail**:`, `- **Fix**:` and `- **Status**: open` (a status outside that bold bullet is not read). Rank by severity; respect the nit cap. Fill `## Coverage` with one line per pass and lens: a finding count or `none found — checked: <specific work checked>`.
   Write it to the response's `resolvedOutputPath`.
5. **Fix loop.** For each finding with a genuine choice, use {{tool:ask}} to offer fix, defer, or accept with a recommendation and consequences. Fix important findings with the build discipline, re-run `sdlc verify --change <id>`, and set `fixed (<commit or note>)`. Nits: fix cheaply or mark `accepted (<reason>)`. For deferred work, run `sdlc defer add "<title>" --why "<why>" --change <id> --finding <F-id>` and set `- **Status**: deferred (D<n>)` using the returned id.
6. **Check**: `sdlc review check --change <id>` must report zero open blocking findings.
   For each verified fix, offer the concrete change/task commit draft with literal paths and required trailers.
   Where project rules reserve commits, the person runs or confirms it; the reviewer role grants no commit authority.
7. **Learn.** When a finding repeats a mistake seen before, propose the correction as a CLAUDE.md / AGENTS.md rule (or a skill update) so the next change avoids it.
8. **Stop at the gate.** Summarize the findings and fixes, then ask a code owner to read the diff and review.md and run `sdlc approve review --change <id>`. With `openspec/roles.yaml`, name the reviewer `sdlc review suggest --change <id> --json` proposes (owners of the changed files first, never the code's author); the person still decides. When the project uses pull requests, open or update the PR with the review summary and the `sdlc status` report; branch protection stays the merge authority.

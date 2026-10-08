---
id: spec
title: "SDLC: Spec"
description: Turn an accepted intent into the requirements and design spec (Stage 2, Design) - OpenSpec proposal.md, delta specs and design.md with policies applied and areas of concern flagged. Use after the intent gate is approved, or when the user asks to write or refine requirements or the design.
command-description: Stage 2 (Design) - write proposal, delta specs and design from the accepted intent
argument-hint: "[change-id]"
---
Write the requirements and design spec - Stage 2 (Design): `proposal.md`, delta specs under `specs/`, and `design.md`. Policy is applied while the spec is written, not discovered in a review weeks later.

{{contract}}

**Input**: {{input}}

**Steps**

1. **Check the gate.** `sdlc status --change <id> --json`: the `intent` gate must be `approved`, `waived` or `n/a`. Otherwise stop and report who must approve it.
2. **Load policy.** Read CLAUDE.md / AGENTS.md conventions and REVIEW.md. Load every available skill that encodes a relevant organizational policy (security, privacy, compliance, API design, UX, brand, data handling).
3. **Write the artifacts in dependency order.** For each of `proposal`, `specs`, `design` that is not done:
   - `sdlc instructions <artifact> --change <id> --json`
   - read its `dependencies` from disk (always re-read; people edit them)
   - inspect the relevant code, tests and configuration read-only, proportional to the change (delegate broad exploration to the `sdlc-researcher` subagent to keep this context clean)
   - write the file at `resolvedOutputPath` following `template` and `instruction`; apply `context` and `rules` as constraints without copying them
4. **Validate**: `sdlc validate --change <id>`. It runs `openspec validate --strict` plus the harness's delta checks (MODIFIED/REMOVED/RENAMED headers must exist in the main spec). Fix every error.
5. **Flag concerns.** `design.md` must list every area of concern with its owner - conflicting policies, security or privacy risk, migrations, compatibility breaks, unanswered intent questions. For design alternatives, use {{tool:ask}} with 2-4 choices and a recommended one. Never resolve a policy conflict silently.
6. **Debate the key decision (when the lens is on).** If `openspec/sdlc.yaml` has `design: { debate: true }`, pick the design decision with the most at stake and delegate it to two `{{agent:advocate}}` subagents in parallel, one per priority of `design.debate_sides` (default: simplicity and speed / robustness and safety). Write the result into design.md under `## Debate`: a `### Position: <priority>` subsection for each with its case in a few lines, then ask the person to decide with {{tool:ask}} (the two positions as choices, plus their own) and record their choice and reason under `### Decision`: the decision is theirs, not yours. The spec cannot be approved without it. With the lens off, skip this step.
7. **Stop at the gate.** Summarize: capabilities touched, requirements added/modified/removed, open concerns and who owns each. Then give the product owner the approval command: `sdlc approve spec --change <id>` (for `risk: high` a tech lead also runs `sdlc approve spec --change <id> --as tech-lead`). Planning continues with {{cmd:plan}} only after approval.

**Guardrails**
- Planning only: no code edits.
- Ask about ambiguity that changes scope, externally visible behavior, compatibility or acceptance criteria; record minor assumptions in the artifacts.
- Specs describe behavior; implementation detail goes to design.md and plan.md.
- Open questions in proposal.md or design.md are the person's to answer. Never write an answer yourself (an `Answer` line you add does not count); keep them as list items under the `## Open questions` heading, and at the gate give the command for each (never run it yourself): `sdlc answer <n> --change <id> --artifact <proposal|design> --text "<answer>"`. The spec cannot be approved while one is unanswered.

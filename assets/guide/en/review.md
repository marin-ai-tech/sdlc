---
title: Review
summary: Review passes and lenses, findings in review.md, and the code owner's approval.
---
# Review

The agent reviews a verified change in independent passes and records severity-ranked findings, so the person reviewing
can focus on intent and risk.

## What the agent does

1. `sdlc review context --change <id> --json`: base ref, changed files, the policy (`REVIEW.md`) and **plan drift**
   (files changed but not in the plan, or planned but untouched).
2. Passes: bugs, security, compliance with the spec, the plan and `REVIEW.md`; lenses: adversarial, edge cases,
   verification gaps. Each must be recorded under Coverage in `review.md`.
3. Findings: `### F1 [important][security] Replayed token is accepted`, with Where, Detail, Fix and Status.
4. Important findings are fixed (or accepted with a reason) before the person is asked.
5. `sdlc review check --change <id>` must report no open blocking finding and full coverage.

## What the person does

- `sdlc review suggest --change <id>` proposes who should review: code owners of the changed files first, never an
  author, fewer open reviews on a tie.
- The reviewer reads the diff and `review.md`, then `sdlc approve review --change <id>` in their own terminal.
- With roles, the author of the code may not approve its review.

## Deferring a finding

A finding worth doing later goes to the deferred registry:
`sdlc defer add "Rate-limit export" --why "pilot only" --change <id> --finding F2`.

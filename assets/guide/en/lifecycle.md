---
title: Lifecycle and stages
summary: The stages of a change, the artifacts of each, and how a change moves on.
---
# Lifecycle and stages

```
explore → intent → spec → plan → build → verify → review → (release) → archive
  Plan      Plan    Design  Build  Build   Test     Deploy    Deploy     Maintain
```

| Stage | What is written | Gate at the end |
|---|---|---|
| plan | `intent.md`: problem, outcome, success measures | intent (product owner) |
| design | `proposal.md`, `specs/`, `design.md` | spec (product owner; tech lead when the risk is high) |
| build | `plan.md`, `tasks.md`, then the code | plan (engineer), before any code |
| test | `verification.md` from `sdlc verify` | verify (the evidence must be fresh) |
| deploy | `review.md`, then `release.md` | review (code owner), release (release manager) |
| maintain | `sdlc archive` merges the spec deltas into the living specs | — |

## How a change moves

- The stage is computed from the gates; nobody sets it by hand. `sdlc status --change <id>` shows the stepper.
- A gate opens when its artifacts exist and the previous gates are satisfied.
- An approval is bound to the content: edit an approved artifact and the approval goes stale, so the gate needs a new
  approval. Fixing a typo counts too.
- After the review (and the release, when it is required), `sdlc archive` closes the change.

## The workflows

The agent's workflows follow the stages: explore, intent, spec, plan, build, verify, review, release, archive, and triage
for incidents. `sdlc next` always says which one comes next.

See also: `sdlc guide gates`, `sdlc guide tracks`.

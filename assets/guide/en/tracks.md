---
title: Full and lite tracks
summary: When a change may skip intent and spec, and who confirms the track.
---
# Full and lite tracks

- **full** — every gate: intent, spec, plan, verify, review (and release when it is required).
- **lite** — for small, bounded work (a fix, a docs change, a tooling tweak): the change starts at the plan; intent and
  spec do not apply.

## How the track is chosen

1. `sdlc new <name>` suggests a track from the kind and the risk (`--kind bugfix --risk low` suggests lite). You can
   also ask for one: `--track lite`.
2. A person confirms or changes it before the plan is approved:

```bash
sdlc track set lite --change fix-rounding --note "One function, covered by tests"
sdlc track set full --change fix-rounding --note "Touches the payment API after all"
```

`track set` is a person's decision; the agent offers it and gives the command.

## What does not change on lite

The plan is still approved before any code, verification evidence is still required, and the review still needs a
code owner. Lite saves the writing and approving of intent and spec, nothing else.

## When not to use lite

New behaviour that users will notice, anything touching security, data or public APIs, and any change whose scope is
still unclear — those need the spec gate.

---
id: release
title: "SDLC: Release"
description: Prepare an approved SDLC change for release (Stage 5, Deploy) - release.md with changelog, per-environment rollout, monitoring signals and a rehearsed rollback - up to the production gate, which a release manager authorizes. Use when the user asks to release, ship, or deploy a change.
command-description: Stage 5 (Deploy) - prepare the release up to the production gate
argument-hint: "[change-id]"
---
Prepare the release - Stage 5 (Deploy). The agent does everything up to the production gate and nothing past it.

{{contract}}

**Input**: {{input}}

**Steps**

1. **Check the gate.** `sdlc status --change <id> --json`: the `review` gate must be `approved`.
2. **Write `release.md`** from `sdlc instructions release --change <id> --json`: version and changelog entry (derived from proposal.md and the spec deltas), rollout steps per environment with the autonomy tier of each, monitoring signals and control bands to watch, the exact rollback command, and how rollback was rehearsed. For the changelog section run `sdlc changelog --change <id>` and put its Markdown output into release.md's changelog section (edit the wording, keep every entry).
3. **Lower environments.** Deploy to development/staging only where the project allows the agent to, and record the result in release.md.
4. **Production is gated.** The harness blocks production release commands until a release manager reviews release.md and runs `sdlc approve release --change <id>`. Ask for that; never work around the block.
5. **After release**: record the outcome in release.md and watch the listed signals. If a control band is breached, run the rollback and open a triaged intent with {{cmd:triage}}.

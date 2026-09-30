---
id: status
title: "SDLC: Status"
description: Show the SDLC dashboard - every active change with its stage (plan, design, build, test, deploy), gate states, approvals, verification and review status, and who must act next. Use when the user asks for status, progress, what is blocked, or what needs approval.
when-to-use: The user asks for status, progress, blockers, or approvals.
command-description: Show SDLC status - stages, gates, and who must act next
argument-hint: "[change-id]"
---
Show where every change stands in the SDLC and who must act next.

{{inject:status --json}}

{{contract}}

**Input**: {{input}}

**Steps**

1. Run `sdlc status` (all active changes) or `sdlc status --change <id>` when a change is named. Add `--json` when you need exact fields.
2. Summarize per change: stage, the first unsatisfied gate and its reason, stale approvals, verification freshness, open blocking review findings, overlap warnings with other changes.
3. End with the next actions grouped by actor: what the agent can do now (with the workflow to run) and what people must do (with the exact `sdlc approve ...` commands).

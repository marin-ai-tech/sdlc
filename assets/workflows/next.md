---
id: next
title: "SDLC: Next"
description: Advance an SDLC change to its next step in the AI-native lifecycle (intent, spec, plan, build, verify, review, release, archive). Use when the user says "continue", "next step", "what's next", or wants to move a change forward without naming the stage.
command-description: Advance a change to its next SDLC step (dispatches to the right stage)
argument-hint: "[change-id]"
---
Advance a change to its next step in the SDLC.

{{contract}}

**Input**: {{input}}

**Steps**

1. Select the change (see Change selection). If none is active, run `sdlc next --json`.
2. Run `sdlc next --change <id> --json` for an active change. It returns the derived `stage` and `next`.
3. If `next.action` is `start-backlog-item`, run `sdlc backlog start <id>` using `next.item`, then continue with intent.
4. If `next.actor` is `human`: stop. Summarize what the person must review (the artifacts or evidence listed by `sdlc status --change <id>`), then give the exact `next.cli` command for them to run in their own terminal. Do not start work that the gate protects.
5. If `next.actor` is `agent`: run the workflow named by `next.workflow` - load the `{{skill:<workflow>}}` skill (or follow {{cmd:<workflow>}}) and carry out its steps for this change.
6. If `next.actor` is `none`: report that the change is archived or complete.

**Output**: the stage, what was done, and the next step (with the exact command when a person must act).

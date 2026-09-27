---
id: archive
title: "SDLC: Archive"
description: Close a completed SDLC change - confirm every required gate is satisfied, merge its delta specs into the living specs via OpenSpec archive, and capture learnings (evals, CLAUDE.md/AGENTS.md rules, follow-up intents). Use when the user asks to archive, finish, or close a change.
command-description: Close a change - gate check, OpenSpec archive (spec merge), learnings
argument-hint: "[change-id]"
---
Close the change: the delta specs become the new source of truth, and what was learned feeds the next loop.

{{contract}}

**Input**: {{input}}

**Steps**

1. **Check the gates.** `sdlc status --change <id> --json`. Every required gate must be satisfied. If one is not, report which, who owns it, and stop.
2. **Archive**: `sdlc archive <id> --yes`. The harness re-checks the gates, runs its pre-merge delta checks, then delegates to `openspec archive` - ADDED/MODIFIED/REMOVED/RENAMED requirements merge into `openspec/specs/` and the folder moves to `openspec/changes/archive/YYYY-MM-DD-<id>/` with its full audit trail (intent, spec, plan, evidence, review, approvals).
3. **Report** which specs changed (the archive totals) and any warnings.
4. **Close the loop** - propose, do not silently apply:
   - a regression eval or test for a bug fix or incident, so the class of failure stays caught
   - CLAUDE.md / AGENTS.md rules for mistakes that happened twice during this change
   - follow-up intents for scope that was deferred ({{cmd:intent}})

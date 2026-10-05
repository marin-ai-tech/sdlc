---
id: backlog
title: "SDLC: Backlog"
description: See the backlog, decompose an epic or an idea into items, bring an item to ready and start it - always through the sdlc backlog commands.
when-to-use: The user wants to see or plan the backlog, split an epic or idea into items, refine an item, or start the next one.
command-description: See, decompose, refine and start backlog items
argument-hint: "[epic, idea or B<n>]"
---
Work with the backlog (`openspec/backlog.md`): the ordered list of planned changes. One item becomes one change.

{{contract}}

**Input**: {{input}}

**Rules**
- Never edit `openspec/backlog.md` directly: the hook denies it. Every change goes through `sdlc backlog add`, `sdlc backlog epic add` and `sdlc backlog edit`.
- Order and removal are a person's decision. When an item should move or go, give the person the exact command to run in their own terminal (`sdlc backlog move B<n> --top`, `--before B<m>`, `--epic E<n>`, or `sdlc backlog drop B<n> --note "<reason>"`), explain why, and do not run it yourself.
- An item is ready when it has an outcome, at least one acceptance criterion and every dependency done.

**Steps**

1. **Without input: show the backlog.** Run `sdlc backlog list` and `sdlc backlog next`. Name the next ready item and, for every open item that is not ready, what blocks it: no outcome, no acceptance criteria, or open dependencies (`sdlc backlog list --json` has `missing` and `blockedBy`). Offer to refine one of them or to start the next ready item.
2. **With an epic or an idea: decompose.** Read the code, specs (`sdlc openspec list --specs`) and related explorations first. Propose items small enough for one change each; every item has a title, an outcome, at least one acceptance criterion, and its dependencies on the other items. Show the list and ask the person to confirm it with {{tool:ask}} (all, a subset, or revise). Add only the confirmed items: `sdlc backlog epic add "<title>" --goal "<goal>"` when the epic is new, then `sdlc backlog add "<title>" --epic E<n> --outcome "<outcome>" --accept "<criterion>" --depends B<n>` for each item, in the order you proposed.
3. **With an item `B<n>`: bring it to ready.** Read the item (`sdlc backlog list --json`) and ask what is missing. Write the answers with `sdlc backlog edit B<n> --outcome "<outcome>" --accept "<criterion>" --depends B<m>` (`--accept` and `--depends` replace the list; `--add-accept` appends; `--title`, `--kind`, `--risk` change the rest). Then offer to start it: `sdlc backlog start B<n>` creates the change with a draft intent; continue with {{cmd:intent}}.
4. **Priorities.** If the person wants a different order, or an item is no longer needed, give the exact `sdlc backlog move …` or `sdlc backlog drop …` command for them to run.
5. **Finish** with the backlog state after your changes (`sdlc backlog list`) and the next step from `sdlc next --json`.

---
title: Backlog and epics
summary: Planned work in openspec/backlog.md, starting an item, order and removal.
---
# Backlog and epics

`openspec/backlog.md` holds the planned work: epics with a goal, and items, each a future change. The order of the items
is their priority.

## Commands

```bash
sdlc backlog epic add "Checkout" --goal "Customers pay without calling support"
sdlc backlog add "Card payments" --epic E1 --outcome "Customers pay by card" --accept "a declined card shows why"
sdlc backlog list
sdlc backlog next               # the next ready item (its dependencies are done)
sdlc backlog start B3           # creates the change and links it to the item
sdlc backlog edit B3 --outcome "…"
```

- The agent may add and refine items and start the next one.
- **Order and removal are a person's decisions**: `sdlc backlog move B3 --top`, `sdlc backlog drop B3 --note "…"`. The
  agent proposes them and gives the command.
- Archiving the change closes its item; an item that depended on it becomes ready.
- With no active change, `sdlc next` proposes the next ready item.

## Importing

- `sdlc import bmad <path> --to-backlog` turns BMAD epics and tickets (or a PRD/SPEC) into epics and items.
- `--source-type`/`--source-ref` on `backlog add` and `new` link an item to a ticket or an incident.

## Exploring first

Not sure the idea is worth a change? `sdlc explore <slug>` (or the explore workflow) pressure-tests it in
`openspec/explorations/`; a later change can cite the note.

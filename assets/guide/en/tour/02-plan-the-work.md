---
title: Plan the work in the backlog
---
# 2. Plan the work in the backlog

Before any change, the team writes down what it wants: epics and items in `openspec/backlog.md`. One item becomes one
OpenSpec change later.

```bash
sdlc backlog epic add "Till calculator" --goal "Cashiers add, subtract, multiply and divide at the till"
sdlc backlog add "Basic arithmetic" --epic E1 --kind feature --outcome "The four operations on the till"
sdlc backlog list
sdlc explore division-by-zero                     # optional research before the intent
```

- The agent may add items and drafts; ordering the backlog is a person's decision (`sdlc backlog move`), and so is
  dropping an item.
- An exploration (`openspec/explorations/<slug>.md`) is a place to pressure-test an idea before anyone writes an intent.
- With nothing active, `sdlc next` proposes the next ready item, and `sdlc backlog start B1` creates the change with a
  draft intent.

```bash
sdlc backlog start B1
sdlc status
```

`sdlc status` shows every active change: its stage (plan, design, build, test, deploy), its gates and who acts next.

Next: intent, spec and plan.

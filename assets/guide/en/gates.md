---
title: Gates and approvals
summary: What a gate checks, how a person approves, and why an approval can go stale.
---
# Gates and approvals

A gate is a point where a person decides that the work may go on. sdlc records the decision, who made it, under which
role, and a digest of exactly what was approved.

## Approving

```bash
sdlc approve intent --change add-export
sdlc approve plan --change add-export --note "Scope agreed"
sdlc approve review --change add-export --as code-owner
```

- Run it in your own terminal. Inside an agent session the CLI refuses, and the hook blocks it.
- Before deciding, `sdlc approve <gate> --change <id> --preview` shows what you would approve, what changed since the
  last approval, and whether you may approve.
- With `openspec/roles.yaml`, your git identity must be a person holding the gate's role, and the separation rules
  apply (for example, the author of the code may not approve its review).
- `min_approvals: 2` on a gate waits for two different people.
- `sdlc approve` proposes a commit message with the trailer `SDLC-Approval: <change>:<gate>:<digest>`; commit the
  record with it, and `sdlc approvals verify` finds the commit by it.

## Other decisions

- `sdlc reject <gate> --change <id> --note "…"` — not acceptable as it is.
- `sdlc waive <gate> --change <id> --note "…"` — this gate does not apply (for example, a docs-only change).
- `sdlc rework <gate> …` — send the change back to an earlier stage (`sdlc guide rework`).

## Stale approvals

An approval holds only for the content it saw. Edit `intent.md` after the intent approval and `sdlc status` shows the
approval as stale; approve again. Review and release approvals are bound to the code as well.

## Whose turn is it

- `sdlc next --change <id>` names the next step and, with roles, the people who may take it.
- `sdlc next --me` lists every gate waiting for you, with the command.
- `sdlc roles who <gate> --change <id>` explains who may approve and why others may not.

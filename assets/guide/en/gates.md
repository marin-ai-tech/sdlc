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
- To approve exactly the version you read, pass its digest: `--expect-digest sha256:…`. The preview prints the digest
  and suggests the command with it. If the artifacts changed in between, the approval is refused and nothing is
  recorded. Take the digest before you read the files, and read them again when it changes.
- With `openspec/roles.yaml`, your git identity must be a person holding the gate's role, and the separation rules
  apply (for example, the author of the code may not approve its review).
- `min_approvals: 2` on a gate waits for two different people.
- `sdlc approve` proposes a commit message with the trailer `SDLC-Approval: <change>:<gate>:<digest>`; commit the
  record with it, and `sdlc approvals verify` finds the commit by it.
- Open questions under `## Open questions` in intent.md, proposal.md or design.md need your answer before the intent or
  spec gate can be approved: `sdlc answer --change <id> --list`, then `sdlc answer 1 --change <id> --text "…"`. Only
  a person answers; an answer typed into the file does not count. `questions.required: false` turns this off.

## Other decisions

A judge (`gates.<gate>.judge`) runs a command or MCP tool against a rubric before a person decides. It records a
verdict and never approves. Its JSON answer requires all three fields: `pass` (boolean), `route` (who or where work
should go next, as the judge sees it), and `rework` (string, empty on a pass). `route` is recorded
as advice; `sdlc next` uses `pass` and `rework` to choose the next action, not `route`.

- `sdlc reject <gate> --change <id> --note "…"` — not acceptable as it is.
- `sdlc waive <gate> --change <id> --note "…"` — this gate does not apply (for example, a docs-only change).
- `sdlc rework <gate> …` — send the change back to an earlier stage (`sdlc guide rework`).
- `sdlc drop <change> --note "why"` closes a mistaken change without merging its delta specs. Only a person may run it.
- Approving the same digest again as the same person and role says "already approved" and records no second decision.
- When the plan gate is waived and there is no tasks.md, fresh passing verification is enough for the verify gate.

## Stale approvals

An approval holds only for the content it saw. Edit `intent.md` after the intent approval and `sdlc status` shows the
approval as stale; approve again. Review and release approvals are bound to the code as well.

## Whose turn is it

- `sdlc next --change <id>` names the next step and, with roles, the people who may take it.
- `sdlc next --me` lists every gate waiting for you, with the command.
- `sdlc roles who <gate> --change <id>` explains who may approve and why others may not.

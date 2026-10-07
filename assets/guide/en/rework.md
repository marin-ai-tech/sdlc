---
title: Sending work back, taking a change over
summary: sdlc rework with a reason, checkpoints, sdlc takeover and handing back.
---
# Sending work back, taking a change over

## Rework

A person sends a change back to the stage of a gate when something earlier was wrong:

```bash
sdlc rework spec --change add-export --reason missing-requirement --note "No empty-name case"
sdlc rework plan --change add-export --reason design-flaw --note "Use the queue" --reset
```

- `--reason` is a category from `rework.reasons`: missing-requirement, wrong-assumption, design-flaw, implementation-bug,
  test-gap, scope-change, other. The audit counts them, so the team sees where rework comes from.
- Approvals given before the rework stop counting; later gates need new approvals.
- `--reset` restores the planned files and the change folder from the checkpoint recorded at the gate's approval. It
  refuses when files are dirty or a path goes through a link.
- The agent sees the reason and the note in `sdlc next` and continues from that stage.

## Takeover

A person takes a change from the agent, for example to fix something delicate by hand:

```bash
sdlc takeover --change add-export --note "I will fix the migration myself"
sdlc release-control --change add-export --note "Migration fixed, carry on"
```

While the change is held, the hook denies the agent's edits in the change folder and in the plan's files (without a
plan, in the whole project), and `sdlc next` says to wait. The agent reads the note when the change is handed back.

Both rework and takeover are a person's commands: the agent proposes them and gives the command.

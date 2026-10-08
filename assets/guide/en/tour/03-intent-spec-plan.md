---
title: Intent, spec and plan, each approved by a person
---
# 3. Intent, spec and plan, each approved by a person

The agent writes, a person approves. Each approval is bound to the content: change the file and the approval goes
stale.

1. **Intent** (`/sdlc:intent`): the problem, the outcome, who is affected, and the open questions. The agent leaves the
   questions to people; Alice answers them herself, then approves:

   ```bash
   sdlc answer 1 --change basic-arithmetic --text "Cashiers at the till"
   sdlc approve intent --change basic-arithmetic
   ```

2. **Spec** (`/sdlc:spec`): the proposal, the delta specs with requirements and scenarios, the design. OpenSpec
   validates them strictly (`sdlc validate`). Alice approves the spec.
3. **Plan** (`/sdlc:plan`): the files that change, the order of work, the proof, the rollback, and the tasks. Bob, the
   engineer, approves it: `sdlc approve plan --change basic-arithmetic`.

When something earlier was wrong, a person sends the change back with a reason and a note:

```bash
sdlc rework spec --change basic-arithmetic --reason missing-requirement --note "Say what 10 / 0 shows"
sdlc explain --change basic-arithmetic        # why the change is here and what unblocks it
```

The later approvals stop counting; the spec has to change before it can be approved again (or the person says why not
with `--note`). Approvals always happen in the person's own terminal: inside an agent session `sdlc approve` refuses.

Next: build and verify.

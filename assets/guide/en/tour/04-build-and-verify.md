---
title: Build and verify with evidence
---
# 4. Build and verify with evidence

With the plan approved, the agent builds (`/sdlc:build`): it works through `tasks.md`, runs the checks as it goes, and
names the change and the task in its commits. Before the plan is approved, the hook denies code edits.

Verification has two parts:

```bash
sdlc verify --change basic-arithmetic          # runs verify.commands, writes the evidence into verification.md
sdlc verify --check --change basic-arithmetic  # every spec scenario has a behavioral verification row
```

- The evidence is literal: commands, exit codes, output, the commit. It is bound to the code: change a file and the
  verify gate waits for a new run.
- An independent verifier subagent exercises each scenario and reports what it saw; the agent records it under
  "Behavioral verification". What was not exercised goes under "Not run / limits"; screenshots go to the change's
  `verification/` folder.
- A failing check means fixing the code, not the test.

For a bug, the protocol is test first: the agent writes the failing test, then locks the tests so the fix has to change
the code:

```bash
sdlc tests lock --change fix-rounding
```

Unlocking is a person's decision (`sdlc tests unlock`).

Next: review.

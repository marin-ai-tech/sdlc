---
title: Review against the team's policy
---
# 5. Review against the team's policy

A reviewer subagent in a fresh context reads the diff against `REVIEW.md` (`/sdlc:review`): correctness, security, the
team's lenses. Findings go to `review.md` with a severity, a status and the passes they belong to.

```bash
sdlc review context --change basic-arithmetic   # the diff, the policy and the drift from the plan
sdlc review check --change basic-arithmetic     # open blocking findings and the coverage of passes and lenses
sdlc defer add "Division by zero shows an error" --why "The till handles it for now" --change basic-arithmetic --finding F2
```

- An open `important` finding blocks the review gate; fix it or defer it with a reason to the deferred-work registry.
- Carol, the code owner, approves the review: `sdlc approve review --change basic-arithmetic`. Bob cannot approve a
  review of code he wrote: separation of duties is checked against the commit authors.
- `sdlc approve review --preview` shows what Carol is about to approve: the files, the open findings, the verification.

After an approval, sdlc prints a ready `git commit` with an `SDLC-Approval` trailer, so the commit can be traced back to
the decision.

Next: release and archive.

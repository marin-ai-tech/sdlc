---
title: Keep an eye on the process
---
# 7. Keep an eye on the process

Everyone sees where things stand, and the team sees where the process suffers.

```bash
sdlc next --me                                  # what waits for you, with the command
sdlc explain --change basic-arithmetic          # why a change is where it is
sdlc health                                     # findings on flow, quality, discipline and configuration
sdlc report --format html --out report.html     # the dashboard page
sdlc audit                                      # lead times, waits, reworks, participation of people
sdlc log --limit 20                             # every decision with the sdlc version that recorded it
```

- `sdlc health` gives findings with facts and a recommendation, never a single score. `/sdlc:health` explains them and
  drafts improvements into the backlog for a person to order.
- When a bad finding appears (no verification commands, enforcement off, an overdue gate), the agent's session start
  says so in one line, and the team's event receivers get `health.degraded`.
- `sdlc audit` compares, per change, the decisions the track planned with what happened: approvals, reworks,
  takeovers, waivers, answers.

That is the whole loop: plan, approve, build, verify, review, release, archive, and look back. Ask the agent anything
along the way; the articles of `sdlc guide` are where its answers come from.

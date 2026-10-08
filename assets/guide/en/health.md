---
title: Project health and explaining a change
summary: sdlc health findings, thresholds, the health workflow, and sdlc explain.
---
# Project health and explaining a change

## sdlc health

`sdlc health` looks at the whole project and lists findings about the process and its practices:

```bash
sdlc health
sdlc health --json
```

- Each finding has an area (flow, quality, discipline, config), a level (`bad`, `warn`, `info`), the facts and a
  recommended improvement. There is no single score: a number hides what to do.
- Flow: gates that wait too long or are overdue, changes with no activity, deferred work that never closes.
- Quality: verification that rarely passes the first time, the most common rework reason, plan drift, open review
  findings, spec scenarios without a verification row.
- Discipline: frequent waivers, the lite track on behaviour changes, forced archives, gates approved again and again,
  repeated hook denials of one rule, long test locks.
- Configuration: no verification commands, enforcement off or warn, one person holding every role, signing off, stale
  context packs, `sdlc doctor` problems.
- It always exits 0: it advises, it never blocks.

Thresholds live under `health` in `openspec/sdlc.yaml`; every key has a default:

```yaml
health:
  window_days: 90      # how far back the log and histories count
  wait_hours: 48       # a gate waiting longer is a finding
  stalled_days: 14
  deferred_days: 30
  first_pass_rate: 0.5
  rework_share: 0.5    # one rework reason this common is a finding
  waiver_share: 0.3
  reapprovals: 3
  denials: 5           # denials of one hook rule in the window
  lock_days: 7
```

When a `bad` finding appears, the agent's session start says so in one line, `health.degraded` is logged and sent to
event receivers, and `health.recovered` follows when it is gone. The dashboard (`sdlc report --format html`) has a
health section.

## The health workflow

`/sdlc:health` explains the findings in plain words and, for the improvements you choose, drafts backlog items with
`--source-type health --source-ref <finding id>`. Ordering the backlog stays a person's decision (`sdlc backlog move`),
and configuration changes are proposed for you to make.

## sdlc explain

```bash
sdlc explain --change add-export
```

One answer to "why is this change here": the stage, the open gate and its reason, what it waits for (an artifact, a
person, a check, review findings, a rework, a takeover), the steps that unblock it with their commands, and the latest
decisions. It writes nothing; anyone may run it.

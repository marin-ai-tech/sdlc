# 13. Process hygiene and project health: capabilities and use cases

A process with gates can still be passed by form alone: a rework closed by the same "yes", a plan that names files
nobody touched, evidence that is silent about what was not run, small changes that drag gates they do not need, a
change that bounces between the agent and a person forever. sdlc 0.11.2 closes these holes in the gates themselves;
0.11.3 adds a look at the whole project — `sdlc health` — and one command that explains a single change, `sdlc
explain`.

## 13.1. What the team gets

| Need | What sdlc does | Since |
|---|---|---|
| A rework must lead to a change | approving the same content again after a rework needs `--note` | 0.11.2 |
| Endless rework loops stop | after `rework.max_cycles` reworks of a gate, `next` asks a person to take over or review the scope | 0.11.2 |
| Commits are traceable to approvals | `sdlc approve` proposes a commit with an `SDLC-Approval` trailer; `approvals verify` finds it | 0.11.2 |
| Evidence says what it does not cover | `verification.md` has "Not run / limits"; untouched planned files and attachments are listed | 0.11.2 |
| Small changes skip what does not apply | `gates.<gate>.auto_waive` waives intent, spec or plan for chosen kinds or tracks, logged as policy | 0.11.2 |
| The team sees where the process suffers | `sdlc health`: findings with facts and a recommendation, no score | 0.11.3 |
| Improvements reach the backlog | `/sdlc:health` drafts backlog items; a person orders them | 0.11.3 |
| Someone notices when it gets bad | a line at the agent's session start, `health.degraded` to the event receivers, a dashboard section | 0.11.3 |
| "Why is my change stuck?" has one answer | `sdlc explain --change <id>` | 0.11.3 |

## 13.2. Use cases

### A rework answered by the same "yes"

Alice sends the spec back: "Say what 10 / 0 shows on the till". Later she runs `sdlc approve spec` again without
anyone touching the spec. sdlc refuses with `unchanged_after_rework`: nothing the gate covers changed since the
approval before the rework. Either the author changes the spec, or Alice says why nothing had to change:

```bash
sdlc approve spec --change basic-arithmetic --preview      # unchangedSinceRework: true
sdlc approve spec --change basic-arithmetic --note "The rework was a mistake: the design already covers it"
```

Every approver who signs the unchanged content gives their own note.

### A change that bounces back and forth

The plan of `add-export` has been sent back three times. Instead of a fourth agent round, `sdlc next` now names a
person's step (`action: review-scope`): take the change over or review its scope, with the people from `roles.yaml`.

```bash
sdlc next --change add-export
sdlc takeover --change add-export --note "Splitting the export into two changes"
```

The limit is `rework.max_cycles` (default 3). It is a hint, not a ban: approving the gate moves the change on as usual.

### Which commit carries this approval?

After `sdlc approve review`, the CLI prints a ready commit command:

```text
$ git commit -m "chore(add-export): approve the review gate" -m "SDLC-Approval: add-export:review:3f2a9c41d07e"
```

Committed this way, the approval can be found by its trailer. With `roles.yaml` and signing on, `sdlc approvals
verify` reports for every approval `trailer: found | missing` next to the signature check. It is information, never a
failure.

### Evidence that says what it does not cover

The tester could not try the payment flow on a real terminal. They write it under `## Not run / limits` in
`verification.md`. Screenshots and browser results go to `openspec/changes/<id>/verification/`; the next `sdlc verify`
lists them as links in the evidence. If the plan names `src/export/csv.ts` under "Files that change" and the change
never touched it, `sdlc verify` warns (`planDrift.untouched`) — the gate still passes, and the reviewer decides.

### Documentation changes without a spec gate

The team decides that documentation changes do not need the spec gate. A person adds to the protected
`openspec/sdlc.yaml`:

```yaml
gates:
  spec:
    auto_waive: { kinds: [docs] }
```

A change created with `--kind docs` by a person has the spec gate waived; the log records `gate.spec.auto_waived` once
and the audit counts it as a policy waiver, not a person's. A kind an agent chose does not count, and verify, review
and release can never be waived by policy.

### A monthly look at the process

The team lead runs `sdlc health` before the retrospective:

```text
Project health: 0 bad, 2 warn, 0 info
! warn Gates wait for people longer than 48 h (flow.wait)
    - add-export: the plan gate waited 71.5 h for an approval
    Recommendation: Set `overdue_hours` on the gates, send the waits to a receiver with `events`, or rotate the approvers.
! warn 71% of reworks have one reason: missing-requirement (quality.rework_reason)
    - missing-requirement: 5 of 7 reworks
    - design-flaw: 2 of 7 reworks
    Recommendation: Most work comes back for a missing requirement: make the intent and the spec stronger; explore first and settle the open questions before the spec is written.
```

They ask the agent `/sdlc:health`; it explains the findings in plain words and, for the improvements they choose,
drafts backlog items (`--source-type health --source-ref quality.rework_reason`). Ordering them is their decision:

```bash
sdlc backlog move B81 --top
```

Thresholds live under `health` in `openspec/sdlc.yaml` (for example `rework_share: 0.6`, `wait_hours: 24`).

### Someone switched the checks off

A refactoring removed `verify.commands`. At the next session the agent's context starts with one extra line: a bad
finding (`config.no_verify`), run `sdlc health`. `health.degraded` is logged and sent to the team's event receivers;
when the commands are back, `health.recovered` follows. Warnings never add a line: the session start stays quiet while
nothing is bad.

### "Why is my change stuck?"

```bash
sdlc explain --change basic-arithmetic
```

The answer: the stage, the open gate and its reason (here: sent back for rework, with the reason and the note), what it
waits for (the agent, a person, a check, review findings, a takeover), the steps that unblock it with their commands,
and the five latest decisions. It writes nothing, so an agent can ask it as often as it likes.

## 13.3. What health looks at

| Area | Findings |
|---|---|
| Flow | overdue gates (bad), long waits on people, changes with no activity, old deferred work |
| Quality | first-pass verification, the dominant rework reason, plan drift, open blocking review findings, scenarios without a verification row |
| Discipline | frequent waivers, the lite track on behaviour changes, forced archives, gates approved again and again, repeated hook denials of one rule (with the guide article), long test locks |
| Configuration | no verification commands (bad), enforcement off (bad) or warn, one person holding every role, signing off, stale context packs, `sdlc doctor` problems |

The session start looks only at the findings that can be bad (cheap); the dashboard skips the expensive ones (doctor,
plan drift, trace); `sdlc health` looks at everything.

## 13.4. Commands

| Command | Who | What |
|---|---|---|
| `sdlc health [--json]` | anyone | findings; records `health.degraded` / `health.recovered` in the log |
| `/sdlc:health` (`/sdlc-health`) | agent with a person | explains the findings, drafts backlog items |
| `sdlc explain --change <id> [--json]` | anyone | why a change is where it is; writes nothing |
| `sdlc approve <gate> --note "…"` | person | a re-approval after a rework with nothing changed |
| `sdlc approvals verify` | anyone | signatures and approval trailers |
| `sdlc backlog move` | person | orders the drafted improvements |

## 13.5. Limits we accept

- The policy (`auto_waive`) and the thresholds are read from the current configuration: changing them changes what
  past changes show, the same way `required` does.
- Reworks recorded before 0.11.2 count as one cycle each gate: the rework-limit hint may come later, never too early.
- Health has no single score on purpose: a number hides what to do.
- A tool that answers `--version` very slowly is still found, but its version may stay unknown in `sdlc doctor`.

# 21. Example: the dashboard, the report and the process health

On October 16, 2026, Linda and Peter examine the TodoMVC team's process after five changes. Follow how they use the
dashboard, report, audit and health findings to choose improvements. The project log has 136 entries. Five changes
went through their gates, including rejections, a rework and a waived gate.

## On this page

- [Meet the team](#211-the-team)
- [Review the inputs](#212-what-there-is-to-analyse)
- [Open the dashboard](#213-the-dashboard)
- [Read the report and audit](#214-the-report-and-the-audit)
- [Check process health](#215-the-process-health)
- [Draft improvements](#216-from-findings-to-the-backlog)
- [Cross-check the numbers](#217-the-daily-summary-and-the-cross-check)
- [Lessons](#218-lessons-for-a-team)
- [Terms](#terms)
- [See also](#see-also)

## 21.1. The team

Linda reviews the process. Peter decides which improvements to order.

| Person | sdlc roles | Does |
|---|---|---|
| Linda Carter | tech-lead, maintainer, release-manager, code-owner | dashboard, report, audit, health with an agent |
| Peter Owen | product-owner | picks and orders the improvements |
| David Smith | engineer | the documentation change `readme-run` |
| Olivia Miller | qa | waives the qa gate of `readme-run` |

## 21.2. What there is to analyse

The evidence comes from the [from-scratch run](19-team-greenfield-example.md) and
[Evan's first change](20-onboarding-example.md).

| Situation | Where it comes from |
|---|---|
| three features of release 1.0.0 | nine substantive rejections; the footer took three qa rounds |
| hook denials | eight denials by six rules |
| title-length feature | a 19-minute intent wait; a rejected spec and later rework |
| change `readme-run` | the README only, the lite track; Olivia waived the qa gate |

The nine feature rejections covered intent, spec, plan three times and qa four times. Peter handled the 19-minute
intent wait. The spec was rejected, then sent back with `sdlc rework` for `wrong-assumption`.

The denied rules were `separation-of-duties`, `living-specs`, `change-not-created`, `state-integrity`, `agent-marker`
and `guard-config`.

Waiving a gate is a person's decision with a reason, and it goes to the log:

```bash
sdlc new readme-run --kind docs --track lite
sdlc waive qa --change readme-run --note "Documentation only: nothing to check in a browser"
```

The default `health` thresholds are meant for weeks (a wait for a person is 48 hours). Linda tuned the wait threshold
to the pace of this day in the protected `openspec/sdlc.yaml`:

```yaml
health:
  wait_hours: 0.25
```

## 21.3. The dashboard

Linda generates a local page for a quick view of the work.

```bash
sdlc dashboard --out dashboard.html
```

The file must be inside the project; sdlc warns when it is not in `.gitignore`, and Linda added it there. The result
is one 76 KB page without an external link, so it opens without a network. It shows:

- 5 archived changes and 0 awaiting a person;
- the stage pipeline and the 19-minute intent wait of `200`;
- the rework and every change's history;
- `waivers 1` on `readme-run`.

A live view for the team:

```bash
sdlc dashboard --watch --serve 127.0.0.1:5185 --debounce 500
```

Linda refined the outcome of the next backlog item; the terminal printed "rebuilt dashboard.html in 905 ms" and the open
page refreshed on its own.

## 21.4. The report and the audit

The report is for a document. The audit supplies counts and timings.

`sdlc report` is Markdown for a README or a wiki. It includes:

- stages and changes with their tasks and verification;
- the epic at 4 of 5 and the next backlog item;
- deferred work D1, median times between gates and events.

`sdlc audit --since 2026-10-16`:

```text
SDLC metrics across 5 change(s) (5 archived)
  median hours: intent→spec 0.1 · spec→plan 0.2 · plan→verified 0.1 · verified→review 0.2 · total 0.6
  verification first-pass rate: 1; rejections 11; waivers 1 (+0 by policy)
  agent commits: 0 of 108 (SDLC-Agent trailer)
  agent log events: 47 of 132
  median wait for a person (seconds): intent 153 · spec 11.5 · plan 24 · qa 117 · review 1 · release 1; rework reasons: wrong-assumption 1
  people's participation (5 changes), planned / actual: gate decisions 28; approvals 28 / 30; reworks 1, takeovers 0, waivers 1, answers 0; waits for a person 0.7 h
    readme-run: gates plan, qa, review, release; approvals 4 / 3; reworks 0, takeovers 0, waivers 1, answers 0; waits 0 h
```

`readme-run` has four planned decisions and three approvals: the fourth is the waiver. `200` has seven approvals for
six gates: the spec was approved again after the rework. `sdlc audit --json` gives the same numbers to scripts.

## 21.5. The process health

Health findings show facts and recommendations when a threshold is crossed.

```text
$ sdlc health
Project health: 0 bad, 2 warn, 1 info
! warn The installation has problems (config.doctor)
    - license: community license, but the project declares no OSI-approved license
    Recommendation: Run `sdlc doctor` and follow its fixes.
! warn Gates wait for people longer than 0.25 h (flow.wait)
    - 200: the intent gate waited 0.3 h for an approval
    Recommendation: Set `overdue_hours` on the gates, send the waits to a receiver with `events`, or rotate the approvers.
i info Approvals are not signed (config.signing)
    - openspec/roles.yaml has `signing: off`
    Recommendation: Set `signing: warn` or `signing: required` in openspec/roles.yaml.
```

There is no overall score: each finding is facts and what to do. `health` stays silent about what is within limits,
and the thresholds show why here:

| What | Value | Threshold | Finding |
|---|---|---|---|
| a wait for a person | the `200` intent, 0.3 h | `wait_hours` 0.25 | `flow.wait` |
| share of waivers | 1 of 5 changes (0.2) | `waiver_share` 0.3 | none |
| denials of one hook rule | 2 at most | `denials` 5 | none |
| rework reasons | 1 rework | 3 reworks or more | none |
| verification first pass | 1.0 | `first_pass_rate` 0.5 | none |

`sdlc health --json` returns the same findings, the counts `{info 1, warn 2, bad 0}` and the window, 90 days.

## 21.6. From findings to the backlog

Linda asks her agent to draft improvements. Peter chooses their order.

Linda ran `/sdlc-health` in her agent after the title-length release. She asked how the process went and what to
improve. She asked the agent
to add nothing yet and explain first. The agent went through the three findings and asked which improvements to
draft. Linda picked two and left the license as it is, and the agent drafted:

```text
### B6 [open] Shorten the waits for approvals
- **Kind**: chore
- **Outcome**: Approvals wait no longer than 15 minutes at every stage
- **Source**: health flow.wait

### B7 [open] Turn on approval signing
- **Kind**: chore
- **Outcome**: Approval signing is on and set up for every role
- **Source**: health config.signing
```

Each item names the finding it came from; their log entries carry `agent: qwen`. The agent left the order alone:
ordering the backlog is a person's decision. Peter put signing before the waits:

```bash
sdlc backlog move B7 --before B6
```

## 21.7. The daily summary and the cross-check

The team checks the views against the log and git history.

`sdlc events summary` wrote `summary.daily` to the log: "done 35, active 0, waiting 0, blocked 0"; 35 is 30
approvals and 5 archives. With event receivers configured, the summary goes there too.

The numbers of the dashboard, the report and the audit were checked against the log (136 entries) and the git
history:

| What | Log | Dashboard, report, audit |
|---|---|---|
| gate rejections | 11 | rejections 11 |
| approvals | 30 | approvals 30 |
| waivers | 1 | waivers 1 |
| archives | 5 | 5 archived |
| commits | 111 | Agent commits 0/111 |

## 21.8. Lessons for a team

These observations came from comparing the dashboard, report and audit.

- **The dashboard is for a glance, the report for a document, the audit for numbers.** All three read the same log,
  so the numbers agree; `--watch --serve` gives the team a live page that refreshes on its own.
- **`health` shows only what crosses a threshold.** Tune the thresholds to your pace under `health` in
  `openspec/sdlc.yaml`; silence about waivers and denials means "within limits", not "not checked".
- **Finding → backlog item with a source.** `/sdlc-health` drafts items with `Source: health <id>`; the order and the
  decision to do them belong to the product owner (`sdlc backlog move`).
- **Configuration findings are edits to protected files by people.** `signing` in `roles.yaml`, `overdue_hours` and
  the thresholds in `sdlc.yaml`: the agent only proposes them.
- **A waived gate is visible everywhere:** the waiver's reason is in the log, on the dashboard and in the audit, and a
  gate cannot be waived without a reason.

## Terms

- [Audit](glossary.md#-ad): recorded decisions and verification for a project or change.
- [Process health](glossary.md#-ip): findings about flow, quality, discipline and configuration.
- [Waiver](glossary.md#-rw): a recorded decision to skip a gate.

## See also

- [Process health and project hygiene](13-process-health.md) explains the findings.
- [Onboard a new engineer](20-onboarding-example.md) follows one of these changes.

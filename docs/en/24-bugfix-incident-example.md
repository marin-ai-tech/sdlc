# 24. Example: a bug fix from an alert, with locked tests

This example ran on October 17, 2026, on the TodoMVC project of the [from-scratch example](19-team-greenfield-example.md).
The bug was real: the "Mark all as complete" checkbox did not show that every todo was done and stayed checked after
"Clear completed", while the TodoMVC specification asks for both. The bug came in as an alert and went all the way to
the archive: a judge on the plan, locked tests, a rework, a takeover.

## 24.1. The team

| Person | sdlc roles | Does |
|---|---|---|
| Linda Carter | tech-lead, maintainer, code-owner, release-manager | the plan gate's judge, the track, the takeover |
| Peter Owen | product-owner | the criteria of the item from the alert |
| David Smith | engineer | the plan gate, the rework |
| Kate Brown | engineer, code-owner, release-manager | review and release |
| Evan Turner | engineer | the fix with an agent |
| Olivia Miller | qa | checks in a browser |

## 24.2. A judge before the person

Linda added a judge to the plan gate: a script that checks the plan against the rubric `docs/rubrics/plan.md` — a
test under `test/`, the test fails before the fix, the tests are locked before the fix.

```yaml
gates:
  plan:
    judge: { run: node tools/judge.mjs, rubric: docs/rubrics/plan.md, max_loops: 3 }
```

The judge reads the gate's artifacts on stdin and answers with a verdict `{ "pass": …, "route": …, "rework": … }`.

## 24.3. The alert becomes a backlog item

```bash
echo '{"id":"ux-1042","title":"Mark all as complete does not show that every todo is done","severity":"low"}' \
  | sdlc triage intake
```

The backlog got B9 with the source `alert:ux-1042`. The same alert again added nothing (`duplicate: true`), and input
that is not JSON was refused (`invalid_alert`). B9 was not ready — no outcome and no criteria — so Peter wrote them from
the specification:

```bash
sdlc backlog edit B9 --kind bugfix --risk low --outcome "Mark all as complete shows the state of the list" \
  --accept "When every todo is done, Mark all as complete is checked" \
  --accept "Unchecking any todo unchecks it" \
  --accept "After Clear completed it is unchecked"
```

## 24.4. The fix

| Step | Who | What happened |
|---|---|---|
| start | Evan's agent, Linda | `sdlc backlog start B9 --change fix-toggle-all`; Linda chose the lite track: `sdlc track set lite --note …` |
| plan and judge | the agent, the judge | the plan names the test and the lock; `sdlc judge --gate plan` passed; the gate still said "awaiting approval (engineer)" |
| plan gate | David | approved |
| red test | the agent | the `isAllCompleted` test in `test/store.test.js`: 27 passed, 1 failed; `sdlc tests lock` |
| an attempt to weaken the test | the agent | "adjust the expectation or delete the test" — refused by the hook `[sdlc:tests-locked]`; the file did not change |
| store fix | the agent | `TodoStore#isAllCompleted()`, 28 of 28 |
| rework | David | the judge and David had both missed it: the plan did not change `js/app.js`, without which the checkbox stays as it is. `sdlc rework plan --reason missing-requirement`; `sdlc explain` showed the reason and that the agent acts first |
| plan again | the agent, the judge, David | `js/app.js` in the plan; the judge passed; approved |
| takeover | Linda | `sdlc takeover --note "I will wire the checkbox in js/app.js myself…"`; the agent's edit of `js/app.js` was refused `[sdlc:takeover]`; Linda added one line to the rendering, checked it in the browser, `sdlc release-control --note …` |
| verify | Evan | the tasks ticked, `sdlc verify` passed |
| qa | Olivia | three todos — unchecked; "Mark all as complete" — checked; uncheck one — unchecked; on `#/completed` — checked; "Clear completed" — unchecked; after a reload the state holds |
| unlock | Evan | `sdlc tests unlock` from the agent — "records a human decision and cannot run inside an agent session"; Evan unlocked |
| review | Linda, Kate | Linda was refused — "authored code in this change. Ask one of: Kate Brown": her edit during the takeover made her an author. Kate approved review and release |
| archive | Linda | merged, `sdlc archive`; B9 `done` |

## 24.5. The result in the audit

```text
Audit trail: fix-toggle-all[bugfix · risk low · lite]
  verify runs 2, first run passed; rejections 0; waivers 0 (+0 by policy)
  reworks 1: plan (missing-requirement, …)
  people's participation, planned / actual: gates plan, qa, review, release; approvals 4 / 5; reworks 1, takeovers 1, …
```

The change's log holds both judge verdicts (`gate.plan.judged`), `tests.locked`, `tests.unlocked`, `change.takeover`
and `change.released`.

## 24.6. Lessons for a team

- **An alert becomes a backlog item at once.** `sdlc triage intake` takes the monitoring JSON and does not duplicate a
  repeat; the product owner writes the criteria.
- **A judge is evidence, not an approval.** It catches what the rubric names, but a person approves the gate; what the
  rubric does not name (here, `js/app.js`) a person finds and sends back with `rework`.
- **Locked tests close the fastest path.** The agent wanted to adjust the expectation — the hook said no, and it fixed
  the code.
- **A takeover for a fine manual edit.** While the change is with a person, the agent does not touch its files; the
  edit makes that person an author, and someone else approves the review.
- **Only a person unlocks the tests and chooses the track.**

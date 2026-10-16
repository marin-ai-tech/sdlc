# 18. Example: a team adopts sdlc on an existing project

This example ran end to end on October 15, 2026. A team of five people, two developers with Qwen Code agents on a
real model. The project is an existing vanilla JavaScript TodoMVC
([marin-ai-tech/modern-todomvc-vanillajs](https://github.com/marin-ai-tech/modern-todomvc-vanillajs)): about 220
lines, no tests, no build. In one day the team set up a backlog, built two features in parallel on two branches,
took each through every gate and released version 1.1.0 of the project.

Below: what each person did, with which commands, what the agents did and where sdlc stopped them.

## 18.1. The team

| Person | sdlc roles | Does |
|---|---|---|
| Linda Carter | tech-lead, maintainer, release-manager, code-owner | prepares the project, review, release |
| Peter Owen | product-owner | the backlog, the intent and spec gates |
| David Smith | engineer | feature 1 with an agent |
| Kate Brown | engineer | feature 2 with an agent |
| Olivia Miller | qa | checks in a browser, the qa gate |

Everyone has a folder with a clone of the shared repository and their own git identity: sdlc knows a person by the
git email and checks it against `openspec/roles.yaml`. The agents work in their developers' folders.

## 18.2. Linda (tech-lead) prepares the project

**Tests before the process.** The project had no tests, so the verify gate had nothing to run. Linda added a
harness as an ordinary commit: `"test": "node --test"` in `package.json` and two characterization tests of the todo
store.

**Setting sdlc up for Qwen Code:**

```bash
sdlc init --tools qwen
sdlc layout adapt
```

`init` created OpenSpec, `openspec/sdlc.yaml`, the skills, commands and subagents in `.qwen/`, the hooks and deny
rules in `.qwen/settings.json` and the git hook, and found the verification command itself (`npm test`).
`layout adapt` added the AI-ready documents: `AGENTS.md`, architecture, conventions, glossary, runbook, security,
the first ADR.

**Roles and separation of duties** (`openspec/roles.yaml`):

```yaml
people:
  linda:  { name: Linda Carter,  emails: [linda@todo.example] }
  peter:  { name: Peter Owen,    emails: [peter@todo.example] }
  david:  { name: David Smith,   emails: [david@todo.example] }
  kate:   { name: Kate Brown,    emails: [kate@todo.example] }
  olivia: { name: Olivia Miller, emails: [olivia@todo.example] }
roles:
  product-owner:   [peter]
  tech-lead:       [linda]
  maintainer:      [linda]
  release-manager: [linda]
  code-owner:      [linda]
  engineer:        [david, kate]
  qa:              [olivia]
separation:
  author_cannot_approve: [review, release]
  distinct_approvers: [[spec, review], [plan, review]]
  max_gates_per_person: 3
```

`sdlc roles check` listed the five people with no errors. In `openspec/sdlc.yaml` Linda made the qa and release
gates required (`required: true`) and set `enforcement.mode` to `block`: the team's agents run without confirming
each action, and only blocking keeps the gates in order. All of it is one commit to the shared repository.

## 18.3. The participants clone the project

```bash
git clone <shared repository> <folder>
sdlc doctor
sdlc update
```

Git hooks are not cloned; doctor sees it (`! git hook … fix: Run sdlc update`), and `sdlc update` installs the hook
that marks commits from agent sessions with an `SDLC-Agent` trailer.

**Qwen Code.** The agent uses an OpenAI-compatible model endpoint (each person's key in `~/.qwen/.env`, never in the
project). Qwen Code's folder trust is off by default, and then Qwen Code trusts every folder: the project's hooks and
deny rules work without any setup. If folder trust is on, trust the project folder, or Qwen Code ignores the whole
`.qwen/settings.json`; doctor checks this. The agents ran unattended:

```bash
qwen --yolo --max-wall-time 15m --max-tool-calls 60 -p "<task>"
```

`--yolo` lets the agent do everything that is not denied: sdlc's hooks and `permissions.deny` are the guard, and the
time and call limits keep it from wandering off for long.

## 18.4. Peter (product-owner) builds the backlog

Peter described an epic and two features to his agent (`/sdlc-backlog`): task titles without spaces at the ends and
never blank; undoing the last delete within 5 seconds. The agent created the epic and the items with
`sdlc backlog epic add`, `sdlc backlog add` and `sdlc backlog edit … --outcome … --accept … --risk low`; it never
edits `openspec/backlog.md` by hand, the hook denies that. Order and epic membership are a person's decision, so
Peter did that himself:

```bash
sdlc backlog move B1 --epic E1
sdlc backlog move B2 --epic E1
```

The result: epic E1 with B1 and B2, each with an outcome and three acceptance criteria, both `Ready ✓`.

## 18.5. Feature 1 from the backlog to the release

David works on the branch `feat/b1-trim-titles`. Every approval is made by a person in their own clone; sdlc prints
a ready commit message whose trailer ties the commit to the approval:

```text
✓ intent gate: Peter Owen <peter@todo.example> approved as product-owner (b67577ae40d5)
  $ git commit -m "chore(trim-todo-titles): approve the intent gate" -m "SDLC-Approval: trim-todo-titles:intent:b67577ae40d5"
```

| Step | Who | What was done |
|---|---|---|
| intent | David's agent | `sdlc backlog start B1 --change trim-todo-titles`, `intent.md` from B1's outcome and criteria |
| intent gate | Peter (product-owner) | `sdlc approve intent --change trim-todo-titles` |
| spec | David's agent | `proposal.md`, `design.md`, a delta spec with WHEN/THEN scenarios, negative ones included; `sdlc openspec validate --strict` |
| spec gate | Peter (product-owner) | `sdlc approve spec …` |
| plan | David's agent | `plan.md`, `tasks.md`: failing tests first, then the implementation, then `sdlc verify` |
| plan gate | Kate (engineer) | the second engineer approves David's plan |
| build | David's agent | tests red first (6 of 9), then `trim()` and the refusal of blank titles in the store, 9 of 9 |
| verify | David's agent | `sdlc verify --change trim-todo-titles`: the evidence in `verification.md` |
| qa gate | Olivia (qa) | a browser check against the three criteria, `sdlc approve qa … --note "…"` |
| review | Linda's agent | `review.md`: the bugs, security and compliance passes, the lenses |
| review gate | Linda (code-owner) | triaged the findings, `sdlc review check`, `sdlc approve review …` |
| release | Linda's agent and Linda (release-manager) | `release.md` (rollout, rollback, monitoring), `sdlc approve release …` |
| merge and archive | Linda | `git merge --no-ff` into `main`, `sdlc archive trim-todo-titles --yes` |

After the archive the delta spec became the living spec `openspec/specs/todo-title-normalization/`, B1 became
`done`, the epic 1 of 2.

**A person settles the review findings.** Linda's agent recorded two important findings, both false: "`update()`
does not check for null" (it never did) and "a silent refusal without an error" (exactly what the spec requires).
Linda, as code owner, marked them `wontfix` with the reason and the two minor ones `accepted` (deferred), and only
then did `sdlc review check` let the gate through.

**An agent's report is not evidence.** The agent's first `release.md` invented facts: a rollout to environments that
do not exist reported as "Success", a "rehearsed" rollback, control bands without any telemetry. Linda approved it
without reading closely, then corrected it to the facts, and sdlc showed
`release ↻ stale — content changed after approval`: an approval is bound to the content, so after the edit the
release gate is approved again.

## 18.6. Feature 2 in parallel, with a reworked plan

Kate ran B2 on the branch `feat/b2-undo-delete` at the same time as B1. The intent, spec and plan gates went the
same way; David approved Kate's plan. The agent did not finish the implementation: Qwen Code stopped it with its
loop guard, and what it had done had no Undo button, undid deletes after the 5 seconds too, and broke the ids after
a page reload.

Kate amended the plan: the button in `index.html`, a re-render after 5 seconds, `crypto.randomUUID()`, the time as a
parameter, negative tests. sdlc marked the changed plan stale at once:

```text
plan     ↻ stale              content changed after approval; re-approval needed
```

Until David approved the plan again, an agent's code edit was denied:

```text
[sdlc:plan-gate] No active change has an approved plan yet (undo-last-delete). Finish the plan and have an
engineer run `sdlc approve plan --change <id>` before editing js/store.js.
```

After the new approval Kate finished the implementation herself (a person edits code without hook limits), merged
`main` with B1 into her branch, resolved the conflict in the tests and ran `sdlc verify` again: the merge changed the
code, and verify stayed `↻ stale` until the new run. Then Olivia's qa check in the browser, Linda's review and
release, the merge and the archive; epic E1 2 of 2.

## 18.7. What sdlc stopped

The checks were made with a live agent in `--yolo` mode:

| The agent's attempt | sdlc's answer |
|---|---|
| `sdlc approve release --change trim-todo-titles` | denied `[sdlc:separation-of-duties]` |
| editing `openspec/roles.yaml` (adding itself as engineer) | denied `[sdlc:state-integrity]` |
| editing the change's `.sdlc.yaml` (`pending` → `approved`) | denied `[sdlc:state-integrity]` |
| `node -e "fs.appendFileSync('openspec/roles.yaml', …)"` | denied `[sdlc:state-integrity]` |
| `env -u QWEN_CODE -u QWEN_CODE_SESSION_ID sdlc approve release …` | denied `[sdlc:agent-marker]` |
| editing code while the plan approval is stale | denied `[sdlc:plan-gate]` |

Every denial is in the log (`hook.denied`). Separately, a late code edit after the review approval: verify became
`↻ stale`, the qa, review and release gates were blocked again, and `sdlc approve release` answered "waiting on the
verify gate".

## 18.8. The project release and the audit

There is no separate command for a project release: each change passes its own release gate. Linda committed the
archive and tagged:

```bash
git tag -a v1.1.0 -m "TodoMVC 1.1.0" -m "E1: B1 trim-todo-titles, B2 undo-last-delete"
git push origin main v1.1.0
```

`sdlc audit` over the two changes:

```text
SDLC metrics across 2 change(s) (2 archived)
  median hours: intent→spec 0.2 · spec→plan 0.2 · plan→verified 0.1 · verified→review 0.1 · total 0.7
  verification first-pass rate: 1; rejections 0; waivers 0 (+0 by policy)
  people's participation (2 changes), planned / actual: gate decisions 12; approvals 12 / 14
```

14 approvals instead of 12: two repeats, the release of feature 1 after the `release.md` edit and the plan of
feature 2 after the `plan.md` edit.

## 18.9. Lessons for a team

- **Check the result, do not read the agent's report.** In the run, agents reported success while `validate` failed,
  put files in the wrong folders and invented facts in `release.md`. People caught all of it because they looked.
- **`block` mode for a team with agents.** In `warn` sdlc only reminds; reminders do not stop an agent in `--yolo`.
- **Human decisions stay with people:** gate approvals, backlog order, review finding statuses, the merge and the
  tag. The agent is denied even when asked directly.
- **An approval is bound to the content.** Any edit of an artifact or the code after an approval needs a new
  approval; it does not get in the way, it shows what changed.
- **A weaker model means more work for people.** On `qwen3-coder-flash` and `qwen-plus` the agent often lost the
  skills' instructions; a stronger model saves rework rounds but does not replace people's checks.

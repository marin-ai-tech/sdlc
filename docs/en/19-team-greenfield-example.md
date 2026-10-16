# 19. Example: a team builds an application from scratch with sdlc

This example ran end to end on October 16, 2026. The same team of five as in the
[existing-project example](18-team-example.md), two developers with Qwen Code agents. There is no project yet: the
team writes TodoMVC in plain JavaScript to the TodoMVC application specification
(https://github.com/tastejs/todomvc/blob/master/app-spec.md), and the finished
[modern-todomvc-vanillajs](https://github.com/marin-ai-tech/modern-todomvc-vanillajs) is the behaviour reference for
the product owner and qa (the agents never get its code). Styles come from the `todomvc-app-css` package. In one day
the team set up a backlog of three features with dependencies, took each through every gate and released 1.0.0.

Below: what each person did, where the gates stopped the work and what the agents got wrong.

## 19.1. The team

| Person | sdlc roles | Does |
|---|---|---|
| Linda Carter | tech-lead, maintainer, release-manager, code-owner | project base, architecture, review, release |
| Peter Owen | product-owner | the backlog, the intent and spec gates |
| David Smith | engineer | features B1 and B2 with an agent |
| Kate Brown | engineer | feature B3 with an agent |
| Olivia Miller | qa | checks in a browser, the qa gate |

## 19.2. Linda (tech-lead) prepares the empty project

**The base as an ordinary commit.** `package.json` with `"type": "module"`, `"test": "node --test"` and the
`todomvc-app-css` dependency, a `.gitignore` for `node_modules/`, a one-line README.

**The process and the documents:**

```bash
sdlc init --tools qwen
sdlc layout scaffold
```

`init` found the verification command (`npm test`) and installed the Qwen hooks and the git hook; `layout scaffold`
created the AI-ready documents. Linda's agent filled them with the team's decision: `docs/architecture.md`
(`index.html` with the TodoMVC markup, `js/store.js` — a `TodoStore` class with the data and `localStorage`, no DOM,
`js/app.js` — DOM, events, the `#/` address), `docs/conventions.md` (ES modules without a build, tests on
`node:test`, failing test first) and ADR 0002 with the alternatives (a framework, a bundler).

**Roles and gates** as in the first example: `openspec/roles.yaml` for the five people with separation of duties,
the qa and release gates required, `enforcement.mode: block`. One commit, push.

**Qwen Code.** The project's hooks and deny rules apply when the folder is trusted; with folder trust off (the
default) Qwen Code trusts every folder. In this run the owner of the machine had folder trust on for another folder,
and Linda's agent could not write anything, although it reported that everything was done. `sdlc doctor` showed the
cause in its `qwen` line; after the setting was fixed, `✓ qwen`. Check that line before the first agent run.

## 19.3. The participants clone the project

```bash
git clone <shared repository> <folder>
npm install
sdlc update
sdlc doctor
```

`sdlc update` installs the git hook, which is not cloned; the tree stays clean.

## 19.4. Peter (product-owner) builds a backlog with dependencies

From one request, Peter's agent created the epic "TodoMVC 1.0" and three items with outcomes and acceptance
criteria (14 criteria in all):

| Item | What | Depends on |
|---|---|---|
| B1 | the list: add (Enter, trimmed, blank not added), check and uncheck, delete; storage in `localStorage` | — |
| B2 | edit on double click: Enter and blur save, blank deletes the todo, Escape cancels | B1 |
| B3 | the "N items left" counter, filters `#/`, `#/active`, `#/completed`, Toggle all, Clear completed; main and footer hidden without todos | B1 |

```bash
sdlc backlog add "Edit a todo" --epic E1 --depends B1 --outcome "…" --accept "…" --accept "…"
```

Only B1 is ready. When Kate's agent tried to start B3 too early, sdlc refused:

```text
B3 is not ready: B1.
```

## 19.5. B1: the base of the application

David works on the branch `feat/b1-list`. `sdlc backlog start B1` created the change `b1` and a draft intent; every
approval is made by a person in their own clone and committed with the `SDLC-Approval` trailer sdlc prints.

| Step | Who | What happened |
|---|---|---|
| intent | David's agent, Peter | intent from B1's criteria; the intent gate approved |
| spec | David's agent | a valid delta spec that misses trimming, clearing the field, blank titles and unchecking, and adds `localStorage` error handling nobody asked for |
| spec gate | Peter | `sdlc reject spec --note "…"`; the agent took the note from `sdlc next` and addressed all of it; approved |
| plan | David's agent | the plan has UI tests in `test/app.test.js`, though `node --test` has no DOM and the conventions forbid extra dependencies |
| plan gate | Kate (engineer) | `sdlc reject plan`: trimming and the blank check go into `TodoStore.add` with tests, the UI is for qa; approved after the rework |
| build, verify | David's agent | tests red first, then green; TodoMVC markup with the styles |
| qa gate | Olivia (qa) | in the browser the list does not re-render after add, check or delete; the title goes into `innerHTML` unescaped — `sdlc reject qa` |
| fix | David and his agent | a test for the `change` event (red, then green), `TodoStore extends EventTarget`, a subscription in `app.js`, output through `textContent` |
| qa gate | Olivia | all five criteria; `<b>…</b>` in a title shows as text; approved |
| review | Linda's agent, Linda (code-owner) | the agent did not keep the review template; Linda wrote the review herself and deferred the finding "a Sample task row in the markup" to B3 — `sdlc defer add … --finding F1`, status `deferred (D1)` |
| release, archive | Linda (release-manager) | a factual `release.md`, `approve release`, `git merge --no-ff` into `main`, `sdlc archive b1 --yes` |

After the archive, B2 and B3 became `Ready ✓`.

## 19.6. B2 and B3 in parallel

David runs B2 (`feat/b2-edit`), Kate runs B3 (`feat/b3-footer`); their agents work at the same time in separate
clones.

- **intent B2:** the success measures said "all B2 criteria are met". Peter rejected it: list the criteria.
- **spec B2:** the agent reported "validation passed" while `sdlc openspec validate --strict` failed (no SHALL/MUST)
  and the `localStorage` error requirement was back. David sent the agent to fix it; after the fix the spec approval
  became `↻ stale — content changed after approval`, and Peter approved again.
- **plan B3:** David (engineer) rejected it: the filter was kept in `localStorage` instead of the address, the counter
  counted by filter instead of active todos, Toggle all and Clear completed lived only in `app.js` without store
  methods and tests, and the deferred finding D1 was missing. The agent addressed all of it.
- **plan B2:** the agent repeated B1's mistake, UI tests in `node --test`. Kate rejected it for the same reason.
- **qa B3**, three rounds: first the counter had no plural ("3 item left") and Clear completed showed with nothing
  completed; then "2 items left item left" (the whole phrase written into `<strong>`, the markup text left behind);
  the third time everything matched the specification. Kate passed Olivia's notes to her agent; the counter logic was
  fixed test first.
- **release B3** and the merge into `main`; the epic 2 of 3.
- **Merging `main` into the B2 branch:** a conflict in `js/store.js` and `test/store.test.js`, both branches having
  added methods and tests in the same place. David took `main`'s version and added `edit()` and the B2 tests; verify
  became `↻ stale` after the merge, and a new `sdlc verify` cleared it.
- **qa B2:** Escape saved the edit (Escape closes the field, then blur saves) — rejected; the agent added a cancel
  flag; on the second round all four criteria passed together with B1 and B3.
- **review B2:** by the agent's log the tests never failed; they were written after the code. Linda checked them
  independently: against `main`'s `js/store.js` the two new tests fail, so they test the change. The finding "red
  phase skipped" is `accepted` with that check.
- **release B2**, archive; the epic 3 of 3.

## 19.7. What sdlc stopped

Before the B2 release Linda's agent tried a list of ways around the rules:

| The agent's attempt | sdlc's answer |
|---|---|
| `sdlc approve release --change b2` | denied `[sdlc:separation-of-duties]` |
| writing `openspec/specs/task-editing/notes.md` | denied `[sdlc:living-specs]`: living specs change only through `sdlc archive` |
| `mkdir -p openspec/changes/sneaky-change && echo x > …/intent.md` | denied `[sdlc:change-not-created]`: "Run `sdlc new sneaky-change`…" |
| `sdlc openspec new change sneaky-two` | denied `[sdlc:change-not-created]` |
| editing `openspec/roles.yaml` | denied `[sdlc:state-integrity]` |
| `env -u QWEN_CODE -u QWEN_CODE_SESSION_ID sdlc approve release …` | denied `[sdlc:agent-marker]`: "clears agent marker(s) QWEN_CODE, QWEN_CODE_SESSION_ID" |
| editing the change's `.sdlc.yaml` | denied `[sdlc:state-integrity]` |

Without a list too: during review the agent wrote `review.md` at the project root, which on Windows is the same file
as the review policy `REVIEW.md`, and the hook denied it `[sdlc:guard-config]`. A review without a Coverage section
did not pass `sdlc review check`: "Missing review coverage".

## 19.8. Release 1.0.0 and the audit

Olivia ran the whole application on `main` against the TodoMVC specification; Linda tagged:

```bash
git tag -a v1.0.0 -m "TodoMVC 1.0.0" -m "E1: B1 list and storage, B2 edit in place, B3 footer, filters, bulk actions"
git push origin v1.0.0
```

`sdlc audit`:

```text
SDLC metrics across 3 change(s) (3 archived)
  median hours: intent→spec 0.1 · spec→plan 0.2 · plan→verified 0.1 · verified→review 0.2 · total 0.6
  verification first-pass rate: 1; rejections 9; waivers 0 (+0 by policy)
  agent commits: 0 of 69 (SDLC-Agent trailer)
  agent log events: 41 of 94
  people's participation (3 changes), planned / actual: gate decisions 18; approvals 18 / 20
```

Nine rejections, each on substance: intent B2, spec B1, plan three times, qa four times. People made the commits,
so there are no `SDLC-Agent` trailers; what the agents did shows in the log, 41 entries of 94.

## 19.9. Lessons for a team

- **The gates are a quality filter.** Every rejection found a real gap: uncovered criteria, tests that cannot run, a
  counter by filter, no re-render, HTML injection, an Escape that saves.
- **An agent's report is not evidence.** "Validation passed", "all verification checks have passed", "documentation
  written": check it yourself each time with `sdlc openspec validate --strict`, `sdlc status`, the browser.
- **Write one change's lesson into `docs/conventions.md`.** The agents repeated the same plan mistake in different
  features; every agent reads the conventions, only one reads a gate note.
- **The code owner writes the review when the agent does not keep the template.** `sdlc review check` does not pass
  an empty review; link a deferred finding to a record with `sdlc defer add … --finding`.
- **Read `release.md` in full before approving**: the agent invents rollback details such as a commit hash that does
  not exist.
- **Check the red phase independently:** running the new tests against `main`'s code shows whether they test the
  change.

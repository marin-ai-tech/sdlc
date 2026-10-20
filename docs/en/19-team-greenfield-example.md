# 19. Example: a team builds an application from scratch with sdlc

On October 16, 2026, the team from the [existing-project example](18-team-example.md) built TodoMVC from scratch.
Two developers worked with Qwen Code agents. Follow the three dependent features from backlog to the 1.0.0 release.
You will see where people sent work back and where sdlc stopped the agents.

## On this page

- [Meet the team](#191-the-team)
- [Prepare the project](#192-linda-tech-lead-prepares-the-empty-project)
- [Clone the project](#193-the-participants-clone-the-project)
- [Build the backlog](#194-peter-product-owner-builds-a-backlog-with-dependencies)
- [Follow the first feature](#195-the-base-of-the-application)
- [Follow the parallel features](#196-edit-and-footer-in-parallel)
- [See what sdlc stopped](#197-what-sdlc-stopped)
- [Release and audit](#198-release-100-and-the-audit)
- [Lessons](#199-lessons-for-a-team)
- [Terms](#terms)
- [See also](#see-also)

## 19.1. The team

The same five people take the project from an empty repository to release.

| Person | sdlc roles | Does |
|---|---|---|
| Linda Carter | tech-lead, maintainer, release-manager, code-owner | project base, architecture, review, release |
| Peter Owen | product-owner | the backlog, the intent and spec gates |
| David Smith | engineer | the list and edit features with an agent |
| Kate Brown | engineer | the footer feature with an agent |
| Olivia Miller | qa | checks in a browser, the qa gate |

## 19.2. Linda (tech-lead) prepares the empty project

Linda prepares the project and its process before the feature work starts.

The team follows the [TodoMVC application specification](https://github.com/tastejs/todomvc/blob/master/app-spec.md).
The finished [modern-todomvc-vanillajs](https://github.com/marin-ai-tech/modern-todomvc-vanillajs) is the behaviour
reference for Peter and Olivia. The agents never get its code. Styles come from `todomvc-app-css`.

**The base as an ordinary commit.** `package.json` with `"type": "module"`, `"test": "node --test"` and the
`todomvc-app-css` dependency, a `.gitignore` for `node_modules/`, a one-line README.

**The process and the documents:**

```bash
sdlc init --tools qwen
sdlc layout scaffold
```

`init` found the verification command (`npm test`) and installed the Qwen and git hooks. `layout scaffold` created
the AI-ready documents. Linda's agent filled them with the team's decisions:

- `docs/architecture.md` describes `index.html` with the TodoMVC markup. It puts data and `localStorage` in a
  `TodoStore` class in `js/store.js`, without DOM code. It puts DOM events and the `#/` address in `js/app.js`.
- `docs/conventions.md` calls for ES modules without a build, `node:test` and failing tests first.
- ADR 0002 records the alternatives: a framework and a bundler.

**Roles and gates** as in the first example: `openspec/roles.yaml` for the five people with separation of duties,
the qa and release gates required, `enforcement.mode: block`. One commit, push.

**Qwen Code.** The project's hooks and deny rules apply when the folder is trusted; with folder trust off (the
default) Qwen Code trusts every folder. In this run the owner of the machine had folder trust on for another folder,
and Linda's agent could not write anything, although it reported that everything was done. `sdlc doctor` showed the
cause in its `qwen` line; after the setting was fixed, `✓ qwen`. Check that line before the first agent run.

> [!TIP]
> Check the `qwen` line in `sdlc doctor` before the first agent run.

## 19.3. The participants clone the project

Each participant installs dependencies and checks the local sdlc hook.

```bash
git clone <shared repository> <folder>
npm install
sdlc update
sdlc doctor
```

`sdlc update` installs the git hook, which is not cloned; the tree stays clean.

## 19.4. Peter (product-owner) builds a backlog with dependencies

Peter's agent turns one request into an epic and three dependent items.

From one request, Peter's agent created the epic "TodoMVC 1.0" and three items with outcomes and acceptance
criteria (14 criteria in all):

| Item | What | Depends on |
|---|---|---|
| List and storage | add (Enter, trimmed, blank not added), check and uncheck, delete; storage in `localStorage` | — |
| Edit | edit on double click: Enter and blur save, blank deletes the todo, Escape cancels | list and storage |
| Footer | counter, filters and bulk actions | list and storage |

The footer shows the "N items left" counter and filters `#/`, `#/active` and `#/completed`. It has Toggle all and
Clear completed. Main and footer are hidden when there are no todos.

```bash
sdlc backlog add "Edit a todo" --epic E1 --depends B1 --outcome "…" --accept "…" --accept "…"
```

Only the list item is ready. When Kate's agent tried to start the footer too early, sdlc refused:

```text
B3 is not ready: B1.
```

## 19.5. The base of the application

David builds the list first, since the other features depend on it.

David works on the branch `feat/b1-list`. `sdlc backlog start B1` created the change `b1` and a draft intent. Every
approval is made by a person in their own clone and committed with the `SDLC-Approval` trailer sdlc prints.

| Step | Who | What happened |
|---|---|---|
| intent | David's agent, Peter | intent from the list item's criteria; the intent gate approved |
| spec | David's agent | a valid delta spec with missing and extra requirements |
| spec gate | Peter | `sdlc reject spec --note "…"`; the agent revised it; approved |
| plan | David's agent | UI tests in `test/app.test.js` did not fit the conventions. |
| plan gate | Kate (engineer) | `sdlc reject plan`; approved after rework |
| build, verify | David's agent | tests red first, then green; TodoMVC markup with the styles |
| qa gate | Olivia (qa) | browser check exposed rendering and escaping errors; `sdlc reject qa` |
| fix | David and his agent | event test, store event, app subscription and safe text output |
| qa gate | Olivia | all five criteria; `<b>…</b>` in a title shows as text; approved |
| review | Linda's agent, Linda (code-owner) | Linda rewrote the review and deferred a finding to the footer feature. |
| release, archive | Linda | factual `release.md`, `approve release`, merge, `sdlc archive b1 --yes` |

The spec missed trimming, clearing the field, blank titles and unchecking. It added `localStorage` error handling
nobody asked for. Peter's note in `sdlc next` led the agent to address each issue.

The plan put UI tests in `test/app.test.js`, although `node --test` has no DOM and the conventions forbid extra
dependencies. Kate required trimming and the blank check in `TodoStore.add` with tests; the UI was for qa.

In the browser, the list did not re-render after add, check or delete. The title went into `innerHTML` unescaped.
The fix tested the `change` event red, then green. `TodoStore extends EventTarget`, `app.js` subscribed and output
went through `textContent`.

Linda was release-manager. She ran `git merge --no-ff` into `main` before archive.

The agent had not kept the review template. Linda deferred "a Sample task row in the markup" with
`sdlc defer add … --finding F1`; its status was `deferred (D1)`.

After the archive, the edit and footer items became `Ready ✓`.

## 19.6. Edit and footer in parallel

The two developers now work in separate clones. Their gates expose different gaps.

David runs the edit feature (`feat/b2-edit`). Kate runs the footer feature (`feat/b3-footer`). Their agents work
at the same time in separate clones.

- **Edit intent:** the success measures said `all B2 criteria are met`. Peter rejected it: list the criteria.
- **Edit spec:** the agent reported "validation passed" while `sdlc openspec validate --strict` failed (no SHALL/MUST)
  and the `localStorage` error requirement was back. David sent the agent to fix it; after the fix the spec approval
  became `↻ stale — content changed after approval`, and Peter approved again.
- **Footer plan:** David rejected it: the filter was kept in `localStorage` instead of the address, the counter
  counted by filter instead of active todos, Toggle all and Clear completed lived only in `app.js` without store
  methods and tests, and the deferred finding D1 was missing. The agent addressed all of it.
- **Edit plan:** the agent repeated the list plan's mistake: UI tests in `node --test`. Kate rejected it again.
- **Footer qa**, three rounds: first the counter had no plural ("3 item left") and Clear completed showed with nothing
  completed; then "2 items left item left" (the whole phrase written into `<strong>`, the markup text left behind);
  the third time everything matched the specification. Kate passed Olivia's notes to her agent; the counter logic was
  fixed test first.
- **Footer release** and the merge into `main`; the epic 2 of 3.
- **Merging `main` into the edit branch:** a conflict in `js/store.js` and `test/store.test.js`, both branches having
  added methods and tests in the same place. David took `main`'s version and added `edit()` and the edit tests; verify
  became `↻ stale` after the merge, and a new `sdlc verify` cleared it.
- **Edit qa:** Escape saved the edit (Escape closes the field, then blur saves) — rejected; the agent added a cancel
  flag; on the second round all four criteria passed together with the list and footer.
- **Edit review:** by the agent's log the tests never failed; they were written after the code. Linda checked them
  independently: against `main`'s `js/store.js` the two new tests fail, so they test the change. The finding "red
  phase skipped" is `accepted` with that check.
- **Edit release**, archive; the epic 3 of 3.

## 19.7. What sdlc stopped

Linda's agent tried these actions before release. The guards refused each attempt.

| The agent's attempt | sdlc's answer |
|---|---|
| `sdlc approve release --change b2` | denied `[sdlc:separation-of-duties]` |
| writing `openspec/specs/task-editing/notes.md` | denied `[sdlc:living-specs]` |
| `mkdir -p openspec/changes/sneaky-change && echo x > …/intent.md` | denied `[sdlc:change-not-created]` |
| `sdlc openspec new change sneaky-two` | denied `[sdlc:change-not-created]` |
| editing `openspec/roles.yaml` | denied `[sdlc:state-integrity]` |
| `env -u QWEN_CODE -u QWEN_CODE_SESSION_ID sdlc approve release …` | denied `[sdlc:agent-marker]` |
| editing the change's `.sdlc.yaml` | denied `[sdlc:state-integrity]` |

Without a list too: during review the agent wrote `review.md` at the project root, which on Windows is the same file
as the review policy `REVIEW.md`, and the hook denied it `[sdlc:guard-config]`. A review without a Coverage section
did not pass `sdlc review check`: "Missing review coverage".

Living specs change only through `sdlc archive`. For the uncreated change, the guard said:
"Run `sdlc new sneaky-change`…". The marker denial said:
"clears agent marker(s) QWEN_CODE, QWEN_CODE_SESSION_ID".

## 19.8. Release 1.0.0 and the audit

Olivia checks the whole application before Linda tags it. The audit records the gate outcomes.

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

Nine rejections were on substance: the edit intent, the list spec, plan three times and qa four times. People made
the commits,
so there are no `SDLC-Agent` trailers; what the agents did shows in the log, 41 entries of 94.

## 19.9. Lessons for a team

These lessons came from the three features and their rework.

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

## Terms

- [Delta](glossary.md#-ad): proposed requirements before archive.
- [Gate](glossary.md#-eh): a decision point before work advances.
- [Rework](glossary.md#-rw): a person's decision to send artifacts back for revision.

## See also

- [Adopt sdlc on an existing project](18-team-example.md) for this team's earlier run.
- [Onboard a new engineer](20-onboarding-example.md) for the next change on this project.

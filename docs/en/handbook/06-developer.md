# 6. The developer's day with Claude Code

Oliver is a developer at Northwind Labs. He works on `tasklet` with Claude Code in his terminal. The agent writes the
artifacts and the code. Oliver steers it, reads what it produced and runs the commands that only a person may run.

## Contents

- [6.1 Starting a session: what the agent knows](#s6-1)
- [6.2 Moving a change on: `/sdlc:next` and `/sdlc:status`](#s6-2)
- [6.3 The plan gate and how to read a denial](#s6-3)
- [6.4 The hard rules: what the agent may never do](#s6-4)
- [6.5 Why is my change stuck? `sdlc explain` and taking a change over](#s6-5)
- [6.6 Small work on the lite track](#s6-6)
- [6.7 The bug-fix protocol: locked tests](#s6-7)
- [6.8 Commits, checkpoints and going back to the plan](#s6-8)
- [6.9 From a failing build or an alert to a new change: `/sdlc:triage`](#s6-9)

### Context

This chapter follows one working day: from the first prompt in the morning to a bug fix and an alert in the afternoon.
The outputs in this chapter come from sdlc 0.14.4 on a copy of `tasklet`. In `tasklet`, Steven set `enforcement.mode:
block` and made the release gate required. In a project in `warn` mode
the process rules only remind the agent; the hard rules deny in both modes.


<a id="s6-1"></a>
## 6.1 Starting a session: what the agent knows

*Oliver (developer)  ·  tasklet  · needs: `tasklet` set up with `sdlc init` (Chapter 1), Claude Code installed, Oliver's
git identity in `openspec/roles.yaml`*

Oliver starts Claude Code and knows, before he types anything, which changes are active, who acts next and
what happened overnight. He turns on the status line.

### Procedure

1. Oliver opens a terminal in the project and starts Claude Code:

   ```bash
   cd ~/work/tasklet
   claude
   ```

   The sdlc hook `SessionStart` (installed by `sdlc init` in `.claude/settings.json`) gives the agent a short summary.
   You does not see it as a message, but the agent has it in its context. This is the real summary from the
   `tasklet` copy (the license text is shortened):

   ```text
   SDLC harness (sdlc 0.14.4, license: community (...)): active changes in openspec/changes (run `sdlc status` for details).
   - fix-due-today: stage build; next (agent): Implement the approved plan: 3 of 3 task(s) remain.
   fix-due-today was handed back by Oliver <oliver@northwind.example>: Comparison fixed in src/tasks.js; run verify
   - inbox: add-due-dates, check ci-green: ok (once read: `sdlc inbox done 20261009T203152306Z-ci-green-26d8f8`)
   - inbox: add-due-dates, check ci-green: failed (once read: `sdlc inbox done 20261009T203142906Z-ci-green-d1f43d`)
   Enforcement mode is block. Gate approvals are made by people with `sdlc approve`, never by the agent.
   The user can ask how sdlc works (stages, approvals, roles, why the hook said no): answer from `sdlc guide`.
   ```

   What each line means:

   | Line | Meaning |
   |---|---|
   | `- fix-due-today: stage build; next (agent): …` | one line per active change: its stage and who acts next |
   | `… was handed back by Oliver …` | the note a person left with `sdlc release-control` ([Section 6.5](#s6-5)) |
   | `- inbox: …` | results of MCP checks that ran outside an agent session, for example Grace's `sdlc verify` |
   | `Enforcement mode is block.` | the hooks deny actions that skip a gate |

   When `sdlc health` has a `bad` finding, one more line names it. With no active change, the summary names the next
   ready backlog item instead.

2. Oliver asks the agent what is new:

   > What happened since yesterday? Work through the inbox.

   The agent runs `sdlc inbox list`, reads each result and marks it read:

   ```bash
   sdlc inbox list
   sdlc inbox done 20261009T203142906Z-ci-green-d1f43d
   ```

   `inbox done` decides nothing, so the agent may run it. The inbox files themselves are written only by the CLI.

3. Oliver turns on the status line once. Steven can do it for the project with `sdlc init --statusline`; it adds a
   `statusLine` entry to `.claude/settings.json` that runs `sdlc statusline`. Under the prompt Oliver now sees one line:

   ```text
   add-due-dates · Build (plan + implementation) · next: person
   ```

   The line is `change · stage · who acts`. With several active changes it starts with their count. With no active
   change it shows the next ready backlog item. A status line Oliver defined himself is never replaced.

### You are done when

- Ask the agent "Which changes are active and who acts next?" It answers from the session summary or `sdlc status`.
- `sdlc inbox list` shows no unread item after the agent worked through it.
- The status line under the prompt names a change, its stage and `next: agent` or `next: person`.

### Pitfalls

- The summary is a snapshot of the session start. After a person approves a gate in another terminal, ask the agent
  to run `sdlc status` again.
- Inbox items from CI reach Oliver's checkout only after CI commits them (`openspec/.sdlc/inbox/`). Pull first.
- The agent cannot edit the inbox files or the log. A try is denied with `[sdlc:state-integrity]`
  (`sdlc guide denials#state-integrity`).
- The status line in 0.14.4 can lag behind after a review approval: it may say `next: person` while
  `sdlc next` already says the agent prepares the release. Trust `sdlc next` (see "Known limitations" in Chapter 8).


<a id="s6-2"></a>
## 6.2 Moving a change on: `/sdlc:next` and `/sdlc:status`

*Oliver (developer)  ·  tasklet  · needs: [Section 6.1](#s6-1), an active change (`add-due-dates`)*

Oliver moves a change forward with one command and stops where a person must decide. He knows how to find
what waits for him.

### Procedure

1. Oliver asks for the dashboard:

   ```text
   > /sdlc:status
   ```

   The agent runs `sdlc status` and summarizes each change: stage, the first open gate, stale approvals, verification
   and review state, and the next actions grouped by actor. The CLI view of one change looks like this:

   ```text
   add-due-dates  [feature · risk medium · full track · schema sdlc]
     stage     Plan (intent)
     artifacts intent ✓  proposal ○  specs ·  design ·  plan ·  tasks ·
     intent ● ─ spec ○ ─ plan ○ ─ build ○ ─ verify ○ ─ review ○ ─ release ○ ─ archive ○
     tasks     none yet
     gates
       intent   … pending            awaiting approval (product-owner; 0 of 1)
       spec     · blocked            missing artifacts: proposal, specs, design
       plan     · blocked            missing artifacts: plan, tasks
       verify   · blocked            waiting on the intent gate
   ```

2. Oliver moves the change on:

   ```text
   > /sdlc:next
   ```

   The agent runs `sdlc next --change <id> --json`. If the next actor is the agent, it runs the workflow that
   `next` names (spec, plan, build, verify, review, release or archive). If the next actor is a person, it stops,
   says what to read, and gives the exact command. For `add-due-dates` after the spec gate:

   ```text
   add-due-dates: Build (plan + implementation)
   person: Ethan or Oliver (engineer) must review and approve the plan gate (plan, tasks).
   $ sdlc approve plan --change add-due-dates --as engineer
   ```

   The names come from `openspec/roles.yaml`. The agent does not run this command.

3. Ethan approves the plan in **his own terminal**, not in the agent chat:

   ```bash
   sdlc approve plan --change add-due-dates
   ```

   ```text
   ✓ plan gate: Ethan <ethan@northwind.example> approved as engineer (e20c9c3960e5)
   Suggested commit message (its trailer ties the commit to this approval):
     $ git commit -m "chore(add-due-dates): approve the plan gate" -m "SDLC-Approval: add-due-dates:plan:e20c9c3960e5"
   Next: agent — Implement the approved plan: 4 of 4 task(s) remain. (/sdlc:build)
   ```

4. Oliver types `/sdlc:next` again. The agent now runs the build workflow: it works through `tasks.md`, runs the checks
   after each task and keeps `plan.md` in step with the code.

5. When Oliver wants to know what waits for **him** across all changes, he runs in his terminal:

   ```bash
   sdlc next --me
   ```

   ```text
   Nothing is waiting for you.
   ```

   For Megan, the same command lists `add-tags, gate spec: sdlc approve spec --change add-tags --as product-owner`.

### You are done when

- After `/sdlc:next`, the agent either ran a workflow or stopped with a person's command.
- `sdlc status --change add-due-dates` shows the plan gate `✓ approved` by Ethan.
- `sdlc next --me` in Oliver's terminal lists only gates his roles allow him to take.

### Pitfalls

- "Approve" typed into the chat is not an approval. The agent cannot approve: the CLI refuses with
  `agent_cannot_approve`, and the hook denies the command with `[sdlc:separation-of-duties]`.
- A `!sdlc approve …` command in the Claude Code chat runs in the agent's shell, so it is refused too.
- Editing an approved artifact makes its approval stale. Even a typo fix needs a new approval.
- With several active changes, name the change: `/sdlc:next add-due-dates`. Otherwise the agent asks which one.


<a id="s6-3"></a>
## 6.3 The plan gate and how to read a denial

*Oliver (developer)  ·  tasklet  · needs: a change whose plan is not approved yet*

Oliver understands why the agent may not write code before the plan is approved, how a shell write counts as
an edit, and how to read any denial in two steps.

### Procedure

1. Before Ethan approves the plan, Oliver asks the agent to start coding:

   > Just add the due date to `src/tasks.js`, the plan is obvious.

   The agent tries to edit the file. The hook denies the call, and Claude Code shows the reason:

   ```text
   [sdlc:plan-gate] No active change has an approved plan yet (add-due-dates). Finish the plan and have an engineer
   run `sdlc approve plan --change <id>` before editing src/tasks.js. Why, and what to do:
   `sdlc guide denials#plan-gate`.
   ```

2. A shell write is checked like an edit (since 0.14.0, in every tool). The agent tries
   `echo export const x = 1 > src/due.js` and gets the same rule for `src/due.js`. The hook also reads `tee`, `cp`,
   `mv`, `sed -i`, PowerShell `Set-Content` and `Out-File`, `git checkout -- <paths>`, `git apply`, `curl -o`,
   one-line `node -e` and `python -c`, and more. Reading a file is never denied.

3. Oliver reads the denial in two steps:
   - The rule name is in brackets: `[sdlc:plan-gate]`.
   - The section that explains it is at the end: `sdlc guide denials#plan-gate`.

   He runs the section in his terminal:

   ```bash
   sdlc guide denials#plan-gate
   ```

   ```text
   ## plan-gate

   Process rule. Code was about to be written with no approved plan. **Do:** write `plan.md` and `tasks.md` (the plan
   workflow) and have a person run `sdlc approve plan --change <id>`. Docs and `openspec/` are exempt.
   ...
   ```

   Or he asks the agent in plain words:

   ```text
   > /sdlc:guide why did the hook stop you just now?
   ```

   The guide workflow reads the same section and answers for this project, with this change's id.

4. Oliver does the right thing: `/sdlc:plan` writes `plan.md` and `tasks.md`, and Ethan approves ([Section 6.2](#s6-2)).

### You are done when

- The denial names `[sdlc:plan-gate]` and the file.
- `sdlc guide denials#plan-gate` prints the section.
- Docs (`**/*.md`) and files under `openspec/` stay writable before the plan: they are in `enforcement.exempt_paths`.
- `sdlc log` shows a `hook.denied` line with `plan-gate` and the file.

### Pitfalls

- In `warn` mode the plan gate does not deny. The agent gets a reminder once per session, for example
  `[sdlc:plan-gate] No SDLC change covers this edit (src/invoice.js). ...`, and the edit goes through.
- With no active change at all, the reason says "No SDLC change covers this edit". Start a change with
  `/sdlc:intent` or `sdlc new <name>`.
- Do not ask the agent to "find a way around" a denial. Every bypass the hook knows about is denied too, and the log
  records each try.


<a id="s6-4"></a>
## 6.4 The hard rules: what the agent may never do

*Oliver (developer)  ·  tasklet  · needs: [Section 6.3](#s6-3)*

Oliver knows the rules that deny in every mode, what each protects, and what to do instead.

### Procedure

1. Oliver goes through the hard rules with the real denials from `tasklet` and `billing-api`:

   | Rule | When the agent hits it | Real reason (shortened) | What to do |
   |---|---|---|---|
   | `protected-path` | edits a path in `enforcement.protected_paths` | `.github/workflows/ci.yml is a protected path (enforcement.protected_paths in openspec/sdlc.yaml). Change it through its owning process, not in an agent session.` | a person changes it outside the agent session |
   | `guard-config` | edits `openspec/sdlc.yaml`, `.claude/settings*.json`, `.mcp.json`, `REVIEW.md`, the generated `sdlc-*` files and the like | `openspec/sdlc.yaml configures the sdlc guard (enforcement mode, hooks, plugin, MCP servers); an agent may not change it.` | ask a person; `sdlc update` restores generated files |
   | `state-integrity` | edits `.sdlc.yaml`, `openspec/roles.yaml`, the log, the inbox or `openspec/backlog.md` | `openspec/backlog.md is changed through the CLI: refine items with sdlc backlog add or sdlc backlog edit; ...` | use the CLI commands |
   | `secret-in-edit` | adds a key, token or password | `Secret in src/github.js: GitHub token, password or token assigned in the code. ...` | read it from `process.env.X`; test data goes under `enforcement.secret_allow` (a person adds it) |
   | `separation-of-duties` | runs a person's command (`sdlc approve`, `reject`, `waive`, `rework`, `takeover`, `track set`, `tests unlock`, `backlog move`, `adopt --apply`, …) | `Gate approvals, rejections, waivers, test unlocks, track selection and backlog priority are human decisions. Ask the responsible person to run ... in their own terminal` | give the person the exact command |
   | `agent-marker` | clears `CLAUDECODE`, `AGENT`, `SDLC_AGENT` and the other markers | `... unsetting or blanking them would let an agent pass for a person, so this command is refused.` | run the command without touching them |
   | `tests-locked` | edits a test while a bug fix locked the tests | [Section 6.7](#s6-7) | fix the code |
   | `takeover` | edits files of a change a person holds | [Section 6.5](#s6-5) | wait for `sdlc release-control` |
   | `release-gate` | runs a production release command before the release approval | Chapter 7, [Section 7.7](07-qa-review-release.md#s7-7) | prepare `release.md`; Emily approves |

2. Oliver sees why `agent-marker` exists. Claude Code sets `CLAUDECODE=1` in the agent's shell, and the CLI refuses a
   person's command when it sees the marker:

   ```text
   Error: `sdlc approve` records a human decision and cannot run inside an agent session (claude-code).
   fix: Run it yourself in your own terminal, not in the agent chat (a `!` command there runs in the agent's shell):
   sdlc approve plan --change add-due-dates
   ```

   An agent that tried `env -u CLAUDECODE sdlc approve plan …` is denied by the hook with `[sdlc:agent-marker]`.

3. When an edit is really needed in a protected file, Oliver asks the agent to prepare the change as text, and the
   owner of that file makes it. For `openspec/sdlc.yaml` that is Steven; then Steven runs `sdlc update` and
   `sdlc doctor`.

### You are done when

- `sdlc guide denials` lists every rule with "Hard rule" or "Process rule".
- `sdlc log` shows each denial as `hook.denied` with the rule and the file (never the secret value).
- `sdlc health` reports a rule denied many times in its window (`denials`, default 5).

### Pitfalls

- Hard rules deny in `warn` mode too. Only `plan-gate` and `mcp-stage` are process rules.
- The secret patterns are fixed prefixes. A secret in an unusual format is not caught; keep a secret scanner in CI.
- In 0.14.4 the `state-integrity` reason for `openspec/roles.yaml` names `.sdlc.yaml` and the log, not the file
  itself. The rule is right; only the text is generic.
- A team member who wants to "just switch the hook off" is asking to change `enforcement.mode` in
  `openspec/sdlc.yaml`. That is a person's decision, recorded in git, and `sdlc health` reports it.


<a id="s6-5"></a>
## 6.5 Why is my change stuck? `sdlc explain` and taking a change over

*Oliver (developer)  ·  tasklet  · needs: an active change; Oliver holds a role in `roles.yaml`*

Oliver gets one answer to "why is this change here", and takes a change from the agent when he wants to fix
something by hand.

### Procedure

1. Oliver asks why `add-due-dates` does not move:

   ```bash
   sdlc explain --change add-due-dates
   ```

   ```text
   add-due-dates: Build (plan + implementation)
   Open gate: plan (pending): awaiting approval (engineer; 0 of 1).

   Waiting for: person (Ethan, engineer; Oliver, engineer).

   What unblocks it:
     1. person: Ethan or Oliver (engineer) must review and approve the plan gate (plan, tasks).
        $ sdlc approve plan --change add-due-dates --as engineer
     2. agent: After the approval the agent implements the plan and runs the verification.

   Latest decisions (newest last):
     2026-10-09T20:24:56.462Z  change.created  Steven <steven@northwind.example>: schema sdlc, full track
     2026-10-09T20:25:13.921Z  gate.intent.approved  Megan <megan@northwind.example>: role product-owner
     2026-10-09T20:25:27.107Z  gate.spec.approved  Megan <megan@northwind.example>: role product-owner
   ```

   `sdlc explain` writes nothing. The agent may run it as often as it likes.

2. In `fix-due-today` the date comparison is delicate. Oliver wants to fix it himself, without the agent editing the
   same files. In **his own terminal**:

   ```bash
   sdlc takeover --change fix-due-today --note "I will fix the date comparison myself"
   ```

   ```text
   fix-due-today taken over by Oliver <oliver@northwind.example>: I will fix the date comparison myself. The agent
   may not edit it until you run `sdlc release-control --change fix-due-today --note ...`.
   ```

3. While Oliver holds the change, the agent's edits of the change folder and of the plan's files are denied:

   ```text
   [sdlc:takeover] fix-due-today is taken over by Oliver <oliver@northwind.example> (I will fix the date
   comparison myself); the agent may not edit src/tasks.js until the person hands it back with
   `sdlc release-control --change fix-due-today`. Why, and what to do: `sdlc guide denials#takeover`.
   ```

   `sdlc next` tells the agent to wait. Read-only commands still work.

4. Oliver fixes the code, commits, and hands the change back with a note for the agent:

   ```bash
   sdlc release-control --change fix-due-today --note "Comparison fixed in src/tasks.js; run verify"
   ```

   ```text
   fix-due-today handed back to the agent by Oliver <oliver@northwind.example>: Comparison fixed in src/tasks.js;
   run verify
   ```

   At the next session start the agent sees the note ([Section 6.1](#s6-1)) and continues from the open gate.

### You are done when

- `sdlc explain --change fix-due-today` says "Waiting for: person" while Oliver holds the change.
- An agent edit of `src/tasks.js` is denied with `[sdlc:takeover]` until `sdlc release-control`.
- `sdlc audit --change fix-due-today` counts one takeover.

### Pitfalls

- `takeover` and `release-control` are a person's commands. The agent proposes them and gives the command.
- The takeover rule protects the files that `plan.md` lists **in backticks** under `## Files that change`, for
  example ``- `src/tasks.js` (modified)``. In 0.14.4 a path written without backticks is not covered, and the agent
  can still edit it during a takeover (plan drift reads both spellings). Ask the agent to write planned paths in
  backticks. Without a `plan.md`, the takeover covers the whole project.
- After `rework.max_cycles` reworks of one gate (default 3), `sdlc next` asks a person to take over or review the
  scope instead of another agent round.


<a id="s6-6"></a>
## 6.6 Small work on the lite track

*Oliver (developer), Ethan (tech lead)  ·  tasklet  · needs: [Section 6.2](#s6-2)*

Oliver starts a small, bounded change that skips intent and spec. He knows that only a person sets the track.

### Procedure

1. A user reports in GitHub issue 42 that a task due today is shown as overdue. Oliver asks the agent:

   > Start a bug-fix change for GitHub issue 42: a task due today is listed as overdue. Low risk.

   The agent runs:

   ```bash
   sdlc new fix-due-today --kind bugfix --risk low --track lite --source-type ticket --source-ref "GH-42"
   ```

   ```text
   Created change fix-due-today (sdlc schema, bugfix, risk low, full track)
   warning: An agent cannot select lite; ask a person to run sdlc track set lite --change fix-due-today.
   ```

   From an agent session, `--track lite` is only a suggestion. The change stays on the full track.

2. If the agent tries to set the track itself, the CLI refuses:

   ```text
   error: An agent session (claude-code) cannot set the track.
   ```

3. Ethan reads the suggestion and confirms it in his own terminal:

   ```bash
   sdlc track set lite --change fix-due-today --note "One function, covered by tests"
   ```

   ```text
   Track for fix-due-today: full → lite
   Next: agent — Write plan (plan.md) for the plan gate. (/sdlc:plan)
   ```

4. `sdlc status --change fix-due-today` now shows the intent and spec gates as `(optional)`. The plan gate, the
   verification evidence and the code owner's review stay.

### You are done when

- `sdlc status --change fix-due-today` shows `lite track` and `source ticket GH-42`.
- `sdlc log` has a `track.set` line by Ethan with his note.

### Pitfalls

- Lite saves the writing and approving of intent and spec, nothing else.
- Do not use lite for new behaviour users will notice, for security, data or public APIs, or when the scope is
  unclear. `sdlc health` reports the lite track on behaviour changes.
- `track set` is refused after the plan is approved. Decide the track before the plan.
- There is no sync with GitHub Issues: `--source-ref "GH-42"` only links the change to the issue. Closing the issue is
  done in GitHub (by a person, or by the agent through the GitHub MCP server).


<a id="s6-7"></a>
## 6.7 The bug-fix protocol: locked tests

*Oliver (developer), Ethan (tech lead)  ·  tasklet  · needs: [Section 6.6](#s6-6), the plan of `fix-due-today` approved*

Oliver fixes a bug so that the evidence means what it says: a test that failed for the right reason now
passes, and nobody changed the test to get there.

### Procedure

1. The first task in `tasks.md` is a test that reproduces the bug:

   ```text
   - [ ] 1.1 Test: a task due today is not listed as overdue (fails first)
   - [ ] 1.2 Fix the comparison
   ```

   The agent writes the test, runs it, confirms that it fails for the expected reason, and commits it.

2. The agent locks the tests (the build workflow does this for `kind: bugfix`):

   ```bash
   sdlc tests lock --change fix-due-today
   ```

   ```text
   ✓ tests locked for fix-due-today: edits to test files (enforcement.test_paths) are blocked until a person runs
   `sdlc tests unlock --change fix-due-today`.
   ```

3. From now on an edit of a test file, by an edit tool or by the shell, is denied in every mode:

   ```text
   [sdlc:tests-locked] Tests are locked for change 'fix-due-today' (fix-first protocol): the failing test is the
   proof, so fix the code, not test/tasks.test.js. A person can unlock with `sdlc tests unlock --change
   fix-due-today`. Why, and what to do: `sdlc guide denials#tests-locked`.
   ```

   The agent tried `sed -i s/notEqual/equal/ test/tasks.test.js` too; the same rule denied it.

4. The agent fixes the code and runs `sdlc verify --change fix-due-today`. The test that failed now passes.

5. When the work is done, a person unlocks the tests. The agent cannot:

   ```text
   error: `sdlc tests unlock` records a human decision and cannot run inside an agent session (claude-code).
   ```

   Ethan runs it in his terminal:

   ```bash
   sdlc tests unlock --change fix-due-today
   ```

6. Oliver asks the agent the main question of the protocol:

   > Which layer should have caught this bug, and why did it not? Propose the check that closes the gap.

   Postponed work goes to the deferred registry:
   `sdlc defer add "Tests for time zones" --why "Out of scope for this fix" --change fix-due-today`.

### You are done when

- `git log` shows the test commit before the fix commit.
- An agent edit of `test/tasks.test.js` is denied while the lock is on.
- `verification.md` of `fix-due-today` shows the test passing after the fix.

### Pitfalls

- What counts as a test comes from `enforcement.test_paths` (for example `**/*.test.*`, `**/test/**`). A test file
  outside these patterns is not locked. Steven adds the pattern.
- If the test is really wrong, do not let the agent work around the lock. Ethan unlocks, the test is fixed, and the
  tests are locked again.
- `sdlc health` reports a lock that stays on longer than `health.lock_days` (default 7).


<a id="s6-8"></a>
## 6.8 Commits, checkpoints and going back to the plan

*Oliver (developer), Ethan (tech lead)  ·  tasklet  · needs: [Sections 6.2](#s6-2) and 6.7*

Oliver knows what the agent's commits carry, how an approval leaves a checkpoint, and how a person sends a
change back to the plan.

### Procedure

1. During `/sdlc:build` the agent ends each commit message with two trailers, so `sdlc trace` can link a task to its
   commit. The `prepare-commit-msg` git hook that `sdlc init` installed adds a third one, because the commit was made
   in an agent session:

   ```text
   feat: due dates and overdue-first list

   SDLC-Change: add-due-dates
   SDLC-Task: 1.2
   SDLC-Agent: claude-code
   ```

   A commit Oliver makes in his own terminal gets no `SDLC-Agent` trailer. `sdlc audit` and the dashboard show how many
   commits came from agents.

2. Every approval records a checkpoint: a snapshot commit under `refs/sdlc/<change>/<gate>`. Branches and HEAD do not
   move.

   ```bash
   git for-each-ref refs/sdlc
   ```

   One line of the output:

   ```text
   af25ddd39cec66159d627e6cb014b1974b88a5b9 commit	refs/sdlc/fix-due-today/plan
   ```

3. Ethan reads the code and sees that the plan rests on a wrong assumption. He sends the change back to the plan, in
   his own terminal:

   ```bash
   sdlc rework plan --change fix-due-today --reason wrong-assumption \
     --note "Compare dates in the user's time zone, not UTC"
   ```

   ```text
   ↺ plan gate sent back by Ethan <ethan@northwind.example> (wrong-assumption): Compare dates in the user's time
   zone, not UTC
   Next: agent — The plan gate was sent back by Ethan <ethan@northwind.example> (wrong-assumption): Compare
   dates in the user's time zone, not UTC. Revise the plan, tasks artifact(s), then ask for approval again. (/sdlc:plan)
   ```

   With `--reset`, the command also restores the files planned under "Files that change" and the change folder from
   the checkpoint. It refuses when those files have uncommitted edits.

4. Oliver types `/sdlc:next`. The agent reads the reason and the note and revises the plan. Ethan approves it again.

### You are done when

- `git log -1 --format=%B` on an agent commit shows `SDLC-Change`, `SDLC-Task` and `SDLC-Agent`.
- `sdlc status --change fix-due-today` shows the plan gate waiting again after the rework.
- `sdlc audit` counts the rework with its reason `wrong-assumption`.

### Pitfalls

- `--reason` must be a category from `rework.reasons`: missing-requirement, wrong-assumption, design-flaw,
  implementation-bug, test-gap, scope-change, other.
- Approving again with nothing changed since the approval before the rework needs `--note` (why nothing had to
  change). `sdlc approve plan --change <id> --preview` shows it.
- `rework` is a person's command. The agent proposes it and gives the command.
- A commit by a person of code the agent wrote is a person's commit. The agent share is a floor, not an exact count.


<a id="s6-9"></a>
## 6.9 From a failing build or an alert to a new change: `/sdlc:triage`

*Oliver (developer), Megan (product owner)  ·  tasklet  · needs: the `github` and `telegram` MCP servers in
`mcp.servers` (Chapter 2)*

Oliver turns a failing build or a production alert into a diagnosed intent that a person approves or
dismisses. No fix happens before that decision.

### Procedure

1. A failing build. The CI run on `main` failed. Oliver pastes what he has:

   ```text
   > /sdlc:triage CI run 1874 on main failed: test "overdue first" times out on GitHub Actions
   ```

   The agent diagnoses read-only: the failing run (through the `github` server, with the tool your server exposes,
   e.g. `list_workflow_runs`), recent commits (`git log --since`), the related specs (`sdlc openspec list --specs`). It
   reproduces the failure when it can. It does not fix, deploy or change configuration.

2. A Telegram alert. Monitoring posts an alert into the team's Telegram channel:

   ```text
   [ALERT] tasklet prod: POST /tasks 5xx rate 7% for 10 min (band 5%)
   ```

   Oliver copies the text into `/sdlc:triage`. In `tasklet` the `telegram` server only receives events from the CLI
   ([Section 2.6](02-toolchain-mcp.md#s2-6)); the agent does not read the channel. sdlc has no built-in alert intake: the
   input is the text Oliver
   gives the agent.

3. The agent classifies the problem (a bounded fix, or wider work), then creates the change:

   ```bash
   sdlc new fix-tasks-5xx --kind incident --risk medium --source-type alert --source-ref "tg-alert-2026-10-09-1412"
   ```

   It writes `intent.md` with the anomaly and its evidence in Problem, the desired end state and the open questions.
   It recommends, but does not run, a rollback or a runbook step.

4. The agent stops at the intent gate and names Megan. Megan decides in her own terminal:

   ```bash
   sdlc approve intent --change fix-tasks-5xx                                  # fix it now
   sdlc reject intent --change fix-tasks-5xx --note "Known load test, no fix"  # dismiss it
   ```

   With `events` configured ([Section 2.6](02-toolchain-mcp.md#s2-6)), the waiting intent gate goes to the Telegram bot,
   and Megan gets the message
   with her name in `waitingFor`.

### You are done when

- `sdlc status` lists `fix-tasks-5xx` at the intent gate, with source `alert`.
- `intent.md` holds the evidence: run id, error rate, time window.
- No code changed before Megan's decision.

### Pitfalls

- With an empty input, `/sdlc:triage` stops and asks for the alert. It never invents one.
- An agent may ask for `--track lite` for a bounded fix. The change stays full until a person runs
  `sdlc track set lite`.
- A Telegram message is never an approval. Approvals happen only in a person's terminal.
- The `github` server is listed for `plan`, `build`, `test` and `deploy` ([Section 2.3](02-toolchain-mcp.md#s2-3)). While other changes are
  active, a call outside their stages is reminded (warn) or denied (block) with `[sdlc:mcp-stage]`
  (`sdlc guide denials#mcp-stage`). With no active change this is not checked.

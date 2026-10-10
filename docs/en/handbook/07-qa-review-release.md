# 7. Quality, review and release

The code of `add-due-dates` is written. Now three people take over the decisions. **Grace** (QA engineer) makes sure the
evidence is real and says what it does not cover. **Paul** (code owner) reviews the change and approves the review gate.

## Contents

- [7.1 Verification evidence: `sdlc verify` and `verification.md`](#s7-1)
- [7.2 CI results as evidence: `verify.mcp` and the inbox](#s7-2)
- [7.3 Independent verification and the trace](#s7-3)
- [7.4 The agent's review: context, passes and lenses, `review.md`](#s7-4)
- [7.5 Findings: fix, accept or defer; the debate lens](#s7-5)
- [7.6 The code owner approves the review](#s7-6)
- [7.7 Release: `release.md`, release checks and the production rule](#s7-7)
- [7.8 Archive and the changelog](#s7-8)

### Context

**Emily** (release manager) authorizes the production release. The agent does the preparation for each of them; none of
them asks the agent "is it done?", they read the records. The outputs in this chapter come from sdlc 0.14.4 on a copy of
`tasklet`. In that copy the release gate is required
(`gates.release.required: true`, [Section 2.5](02-toolchain-mcp.md#s2-5)), and the `github` MCP server answers the CI
questions ([Section 2.4](02-toolchain-mcp.md#s2-4)). The server in the copy was a small stand-in with the same tool name;
your server's tool names may differ.


<a id="s7-1"></a>
## 7.1 Verification evidence: `sdlc verify` and `verification.md`

*Grace (QA engineer), with the agent  ·  tasklet  · needs: a change whose tasks are done (`add-due-dates`),
`verify.commands` in `openspec/sdlc.yaml`*

Grace knows what the verify gate checks, where the evidence is, and why "the agent says the tests pass" is
never evidence.

### Procedure

1. Grace looks at the checks the project runs:

   ```bash
   sdlc verify --list
   ```

   ```text
   test       npm test
   ```

   `sdlc init` detected `npm test` from `package.json` of the example copy. The `tasklet` of Chapter 1 also has
   `build` and `lint`. A person adds checks under `verify.commands`.

2. The agent runs the verify workflow (`/sdlc:verify`, or `/sdlc:next` after the last task). Its first step is the
   CLI:

   ```bash
   sdlc verify --change add-due-dates
   ```

   The first run in the `tasklet` copy failed, because the test script did not find the tests:

   ```text
   running test: npm test
   ✗ test (0.9s)
       ...
       Error: Cannot find module '.../tasklet/test'
       ...
   Verification failed - fix the code (not the tests) and run `sdlc verify` again.
   Next: agent — Implement the approved plan: 1 of 4 task(s) remain. (/sdlc:build)
   ```

   After the fix:

   ```text
   running test: npm test
   ✓ test (1.2s)
   Verification passed - evidence recorded in openspec\changes\add-due-dates\verification.md
   ```

3. Grace opens `openspec/changes/add-due-dates/verification.md`. The block between the `sdlc:evidence` markers is
   written by the CLI on every run. Nobody edits it by hand:

   ```markdown
   ## Automated evidence

   Recorded by `sdlc verify --change add-due-dates`. Regenerated on every run; do not edit by hand.

   - **Result**: PASSED (1/1 required checks)
   - **Run at**: 2026-10-09T20:29:00.389Z
   - **Commit**: 891963f701d6
   - **Harness**: sdlc 0.14.4, license: community (...)

   | Check | Command | Result | Duration |
   |---|---|---|---|
   | test | `npm test` | ✅ exit 0 | 1.2s |
   ```

   Below it, a collapsed block holds the last lines of each command's output.

4. Grace fills the section that says what was **not** exercised. This is the tester's honesty section:

   ```markdown
   ## Not run / limits

   Time zones: only UTC dates were tried.
   ```

5. Grace saves the output of a manual API call in the change's `verification/` folder,
   `openspec/changes/add-due-dates/verification/get-tasks.json`. The next `sdlc verify` lists it as a link:

   ```markdown
   **Attachments**:
   - `[verification/get-tasks.json](verification/get-tasks.json)`
   ```

### You are done when

- `sdlc status --change add-due-dates` shows `verify ✓ passed`.
- `verification.md` has the evidence block, a filled "Not run / limits" section and the attachment link.
- Edit `src/tasks.js` and run `sdlc status` again: the verify gate shows `↻ stale`. Committing does not make it stale;
  changing the content does.

### Pitfalls

- "Fix the code, not the test." In a bug fix the tests are locked (Chapter 6, [Section 6.7](06-developer.md#s6-7)).
- `sdlc verify --only test` runs only the named checks. It never passes the gate.
- With no checks configured, `sdlc verify` refuses. A person adds `verify.commands` to `openspec/sdlc.yaml`; the agent
  may only propose them (`[sdlc:guard-config]` denies its edit).
- If `plan.md` lists files under "Files that change" that nobody touched, `sdlc verify` warns
  (`planDrift.untouched`). It is a warning, not a failure.


<a id="s7-2"></a>
## 7.2 CI results as evidence: `verify.mcp` and the inbox

*Grace (QA engineer), with the agent  ·  tasklet  · needs: the `ci-green` check that Steven added in [Lesson
2.4](02-toolchain-mcp.md#s2-4), `${GITHUB_TOKEN}` in the environment*

Grace reads the CI result as evidence: the verify gate passes only when the GitHub Actions run for this exact
commit is green. The CLI asks GitHub itself; the agent never reports the result.

### Procedure

1. Grace looks at the check Steven configured in [Section 2.4](02-toolchain-mcp.md#s2-4) (`verify.mcp` in
   `openspec/sdlc.yaml`):

   ```yaml
   verify:
     mcp:
       - name: ci-green
         server: github
         tool: list_workflow_runs     # the tool name your server exposes
         args: { owner: northwind-labs, repo: tasklet, workflow_id: ci.yml, head_sha: "${HEAD}", per_page: 1 }
         expect:
           workflow_runs:
             - { status: completed, conclusion: success }
   ```

   `${HEAD}` becomes the head commit. The answer must contain `expect` as a subset.

2. She confirms that the server answers:

   ```bash
   sdlc mcp check
   ```

   ```text
   ✓ github (stdio): available, 2 tool(s)
       list_workflow_runs, list_issues
   ```

   (The course copy used a small local stand-in for the GitHub server, with the same tool name.)

3. The agent runs `sdlc verify --change add-due-dates`. The CLI calls the tool and records the answer:

   ```text
   running test: npm test
   → ci-green: github/list_workflow_runs (MCP)
   ✓ test (1.0s)
   ✓ ci-green (github/list_workflow_runs, 0.5s)
   Verification passed - evidence recorded in openspec\changes\add-due-dates\verification.md
   ```

   The evidence table gets a row `| ci-green | mcp github/list_workflow_runs | ✅ ok | 0.5s |` and a collapsed block
   with the server's answer.

4. Grace runs the same command in her own terminal while the CI run is red:

   ```text
   ✓ test (1.0s)
   ✗ ci-green (github/list_workflow_runs, 0.5s)
       workflow_runs[0].conclusion: expected "success", got "failure"
   Verification failed - fix the code (not the tests) and run `sdlc verify` again.
   ```

   Because Grace ran it outside an agent session, the MCP result also goes to the inbox:

   ```bash
   sdlc inbox list
   ```

   ```text
   20261009T205005125Z-ci-green-cea962  add-due-dates  ci-green (github/list_workflow_runs)  failed
   ```

   At its next session start, the agent sees this line (Chapter 6, [Section 6.1](06-developer.md#s6-1)) and acts on it.

### You are done when

- The evidence table in `verification.md` has a `ci-green` row.
- A red CI run fails the verify gate with the key, the expected and the actual value.
- `sdlc inbox list` shows the result of Grace's run.

### Pitfalls

- `sdlc verify --list` in 0.14.4 lists only `verify.commands`, not the `verify.mcp` checks. Read `openspec/sdlc.yaml`
  to see them.
- CI writes inbox files on its own machine. They reach the developer only when CI commits them.
- A server that cannot be reached fails a required check. That is on purpose: "could not ask" is not "green".
- The CLI's own `verify.mcp` call is not an agent call, so the stage rule (`[sdlc:mcp-stage]`) does not apply to it.


<a id="s7-3"></a>
## 7.3 Independent verification and the trace

*Grace (QA engineer), with the agent  ·  tasklet  · needs: [Section 7.1](#s7-1)*

Every spec scenario has a row of behavioural evidence from a context that did not write the code. Grace can
follow a change from intent to evidence in one command.

### Procedure

1. In the verify workflow, after `sdlc verify`, the agent hands the change to the `sdlc-verifier` subagent. It is
   read-only. It reads the spec scenarios and the Proof section of `plan.md`, runs the app and the tests, exercises
   each scenario and the nearest neighbouring flows, and reports. It fixes nothing. (If the team accepted its own
   `tester` role with `sdlc team accept tester`, that role replaces `sdlc-verifier`.)

2. The agent records the report under `## Behavioral verification`, one row per scenario:

   ```markdown
   | Scenario / proof item | What was run | What was seen | Result |
   |---|---|---|---|
   | Task with a due date | addTask('b', '2026-10-20') | stored with due 2026-10-20 | pass |
   | Invalid date | addTask('c', 'tomorrow') | throws: invalid due date | pass |
   | Overdue task listed first | one overdue, one not; listTasks() | overdue first | pass |
   ```

3. Grace checks the coverage. Before the rows were written:

   ```bash
   sdlc verify --check --change add-due-dates
   ```

   ```text
   ! 3 of 3 scenario(s) have no behavioral verification row:
     - Task with a due date
     - Invalid date
     - Overdue task listed first
   ```

   After:

   ```text
   ✓ every spec scenario (3) has a row under "Behavioral verification".
   ```

   In CI, `--strict` makes the check exit non-zero when a scenario is uncovered.

4. Grace traces the change from intent to evidence:

   ```bash
   sdlc trace add-due-dates
   ```

   ```text
   Trace: add-due-dates
   Intent: Tasks have a due date
   Requirement: Due date (specs/tasks/spec.md)
     Scenario: Task with a due date — evidence: pass
     Scenario: Invalid date — evidence: pass
   Requirement: Overdue first (specs/tasks/spec.md)
     Scenario: Overdue task listed first — evidence: pass
   Tasks:
     1.1 [x] Tests for the due-date scenarios (fail first) — commits: 574c5ff
     1.2 [x] Accept and validate `due` in addTask — commits: 6c54191
     1.3 [x] Sort overdue tasks first in listTasks — commits: 891963f
     2.1 [x] Run sdlc verify and confirm every required check passes — no commit
   Review findings:
     F1 fixed — Impossible dates are accepted
     F2 accepted — package.json is not in the plan
     F3 accepted — Task titles have no length limit
   Gaps (1):
     task without a commit: 2.1
   ```

   The task-to-commit links come from the `SDLC-Change` and `SDLC-Task` trailers (Chapter 6, [Lesson
   6.8](06-developer.md#s6-8)).

### You are done when

- `sdlc verify --check --change add-due-dates` reports every scenario covered.
- `sdlc trace add-due-dates` lists each requirement with its scenarios and evidence, and a short list of gaps.

### Pitfalls

- The behavioural table is written by the agent from the verifier's report. Grace reads it against the attachments
  and her own spot checks; it is not machine evidence like the block above it.
- A task with no code (like "run sdlc verify") shows as a gap "task without a commit". Read the gaps, do not chase a
  zero.
- `sdlc trace` shows a finding with `Status: deferred (D1)` as `accepted`. The link to the deferred item is in
  `review.md` and `openspec/deferred-work.md`, not in the trace.


<a id="s7-4"></a>
## 7.4 The agent's review: context, passes and lenses, `review.md`

*Paul (code owner) read; the agent reviews  ·  tasklet  · needs: the verify gate passed*

Paul knows what the agent's review covers before he reads the diff, and where each finding stands.

### Procedure

1. Oliver (or Paul) starts the review in Claude Code:

   ```text
   > /sdlc:review add-due-dates
   ```

   The agent first collects the context:

   ```bash
   sdlc review context --change add-due-dates
   ```

   ```text
   Review context for add-due-dates (base main)
     changed files: 3
     plan drift: 1 unplanned, 0 planned but untouched
       + package.json (not in plan.md)
     policy: REVIEW.md
     diff: git diff main...HEAD && git diff HEAD
   ```

   **Plan drift** lists files changed but not named in `plan.md`, and planned files nobody touched. Here the test
   script in `package.json` changed during the build. The base is `review.base`, else `origin/HEAD`; `--base <ref>`
   overrides it.

2. The policy is `REVIEW.md` (a person owns it; the agent may not edit it). It names the **passes** and **lenses**:

   | Kind | Name | Looks for |
   |---|---|---|
   | pass | bugs | logic errors, broken edge cases, error handling, regressions |
   | pass | security | injection, authentication and authorization gaps, secrets, PII in logs |
   | pass | compliance | the diff matches the spec, the plan and the design principles |
   | lens | adversarial | how an attacker or hostile input breaks it |
   | lens | edge-cases | boundaries, empty, huge, concurrent and Unicode inputs, failure paths |
   | lens | verification-gaps | behaviour that tests and evidence do not prove |

   The same lists are in `review.passes` and `review.lenses` of `openspec/sdlc.yaml`. Paul adds the team's design
   principles to `REVIEW.md` (for example "money is always a decimal type").

3. The agent runs each pass and lens in a fresh context (the `sdlc-reviewer` subagent) and writes `review.md`:

   ```markdown
   ### F1 [important][edge-cases] Impossible dates are accepted
   - **Where**: src/tasks.js:4
   - **Detail**: `2026-02-31` matches the pattern and is stored.
   - **Fix**: parse the date and compare it with the input.
   - **Status**: open

   ## Coverage

   - bugs: none found — checked: sorting and the default for today
   - security: none found — checked: error message echoes only the date
   - compliance: 1 finding
   - adversarial: 1 finding
   - edge-cases: 1 finding
   - verification-gaps: none found — checked: each scenario has a test
   ```

   Severities: **important** (breaks behaviour, leaks data, breaches a policy), **nit** (style and naming, at most
   five), **pre-existing** (a problem the change did not introduce). Every pass and lens needs a line under
   `## Coverage`, with a count or `none found — checked: <what was checked>`.

4. The agent checks the findings:

   ```bash
   sdlc review check --change add-due-dates
   ```

   ```text
   2 finding(s), 2 open; blocking open: 1
     ✗ F1 [important][edge-cases] Impossible dates are accepted (src/tasks.js:4)
   ```

   The command exits 1 while a blocking finding is open (`review.block_on: [important]`). The review gate waits.

### You are done when

- `review.md` has a finding per problem and one Coverage line per pass and lens.
- `sdlc review check` names every open blocking finding, and exits 0 only when there is none.
- `sdlc status --change add-due-dates` shows `review 2 finding(s), important 1 open / 1`.

### Pitfalls

- An empty `checked:` after "none found" is reported by `sdlc review check`. "None found" needs evidence.
- A finding count under Coverage that does not match the findings is reported too.
- The agent that wrote the code never approves it. The review gate is Paul's.


<a id="s7-5"></a>
## 7.5 Findings: fix, accept or defer; the debate lens

*Oliver with the agent; Ethan (tech lead) for the debate lens  ·  tasklet  · needs: [Section 7.4](#s7-4)*

Every finding ends in one of four states with a reason. Ethan knows when to ask for a debate before the spec
gate instead of finding design problems in review.

### Procedure

1. For each finding with a real choice, the agent asks Oliver: fix, defer, or accept, with a recommendation and the
   consequences. The decisions in `add-due-dates`:

   | Finding | Decision | Status line in `review.md` |
   |---|---|---|
   | F1 important: impossible dates | fix, re-verify | `fixed (b1c2d3e)` |
   | F2 nit: `package.json` not in the plan | accept | `accepted (editing plan.md now would make the plan approval stale; noted in Plan drift)` |
   | F3 nit: no limit on title length | defer | `deferred (D1)` |

2. For F3 the agent records the deferred work:

   ```bash
   sdlc defer add "Limit the length of task titles" --why "Not part of due dates; needs a product decision" \
     --change add-due-dates --finding F3 --revisit "Before the public beta"
   ```

   ```text
   D1 Limit the length of task titles
   ```

   The entry lands in `openspec/deferred-work.md`:

   ```markdown
   ### D1 [open] Limit the length of task titles
   - **Change**: add-due-dates
   - **Finding**: F3
   - **Why**: Not part of due dates; needs a product decision
   - **Revisit when**: Before the public beta
   ```

   `sdlc review check` requires a `deferred (D<n>)` finding to link to an open item.

3. The agent fixes F1, commits, runs `sdlc verify` again (the fix made the evidence stale) and checks:

   ```text
   3 finding(s), 0 open; blocking open: 0
   ```

4. The debate lens. Ethan notices that design problems keep reaching review. For risky designs he asks Steven to turn
   on the debate lens in `openspec/sdlc.yaml`:

   ```yaml
   design:
     debate: true
     debate_sides: [simplicity and speed, robustness and safety]
   ```

   During `/sdlc:spec`, two read-only `sdlc-advocate` subagents argue the key decision, one per side. The agent writes
   `## Debate` into `design.md` with `### Position:` for each side and `### Decision`. Until that section exists, the
   spec approval is refused. Megan saw this on the `add-tags` change:

   ```text
   error: The debate lens is on: design.md needs a `## Debate` section with two `### Position:` subsections and a
   `### Decision`.
   fix: Run the spec workflow to hold the debate (simplicity and speed / robustness and safety) and record it in
   design.md, then approve again.
   ```

### You are done when

- `sdlc review check --change add-due-dates` exits 0.
- `sdlc defer list --open` shows D1 linked to `add-due-dates` and F3.
- With the debate lens on, `design.md` of a new change has `## Debate` before Megan approves the spec.

### Pitfalls

- Editing `plan.md` after the plan approval makes the plan gate stale. Record plan drift in `review.md` instead, or
  ask Ethan to send the change back (`sdlc rework plan`).
- A fix after `sdlc verify` makes the evidence stale. Run `sdlc verify` again before Paul approves.
- With the debate lens on, `sdlc next` and `sdlc next --me` in 0.14.4 already name Megan for the spec gate before the
  debate is written; her approval is then refused. Ask the agent to run `/sdlc:spec` first.
- The debate is recorded text. sdlc checks that both positions and the decision are there, not how good they are.


<a id="s7-6"></a>
## 7.6 The code owner approves the review

*Paul (code owner)  ·  tasklet  · needs: `sdlc review check` green, verification fresh*

Paul sees who should review, what he approves, and approves in his own terminal. He knows why the author
cannot approve.

### Procedure

1. The agent proposes a reviewer (read-only):

   ```bash
   sdlc review suggest --change add-due-dates
   ```

   ```text
   Paul (paul) - suggested: owns 0 of 3 changed files, open reviews: 0
   ```

   Owners of the changed files by CODEOWNERS come first, then the person with fewer open reviews. An author of the
   code is never suggested. (`tasklet` has no CODEOWNERS file, so Paul owns 0 files.)

2. Anyone can see who may approve and why others may not:

   ```bash
   sdlc roles who review --change add-due-dates
   ```

   ```text
   review · add-due-dates — may approve: Paul (paul)
     Megan (megan): missing_role — Megan does not hold code-owner; ask Paul.
     Ethan (ethan): missing_role — ...; distinct_approvers — Ethan already approved the paired gate plan/review.
     ...
   ```

3. Paul previews what he would approve. The preview writes nothing:

   ```bash
   sdlc approve review --change add-due-dates --preview
   ```

   ```text
   Approval preview: gate review of change add-due-dates (pending)
   Artifacts:
     review  review.md
   Changed since the last approval: nothing
   Approvals: 0 of 1
   Open blocking findings: 0
   Verification: passed 2026-10-09T20:31:52.306Z, matches the current code
   You may approve it:
   $ sdlc approve review --change add-due-dates
   ```

4. Paul reads the diff (`git diff main...HEAD`) and `review.md`, then approves:

   ```bash
   sdlc approve review --change add-due-dates
   ```

   ```text
   ✓ review gate: Paul <paul@northwind.example> approved as code-owner (3fc4c928a38e)
   Suggested commit message (its trailer ties the commit to this approval):
     $ git commit -m "chore(add-due-dates): approve the review gate" -m "SDLC-Approval: add-due-dates:review:3fc4c928a38e"
   ```

   He commits the record with the suggested message. `sdlc approvals verify` finds the commit by its trailer.

5. Oliver tried to approve first. The CLI refused, because he does not hold `code-owner`:

   ```text
   error: Oliver does not hold code-owner; ask Paul.
   ```

   Even with the role, the author of the code may not approve its review (`author_cannot_approve: [review, release]`
   in `roles.yaml`).

### You are done when

- `sdlc status --change add-due-dates` shows `review ✓ approved  Paul ... as code-owner`.
- `git log --grep "SDLC-Approval: add-due-dates:review"` finds the commit.

### Pitfalls

- In 0.14.4 the `Next:` line printed right after `sdlc approve review` (and after a later `sdlc verify`) can still
  say "Paul (code-owner) must ... approve the review gate". `sdlc status` and `sdlc next` show the truth:
  the review is approved and the agent prepares the release.
- The review approval is bound to the code and `review.md`. A change to either after the approval makes it stale.
- With `min_approvals: 2` on the review gate, two different code owners must approve.
- `review suggest` matches a CODEOWNERS entry to a person by email, or a `@handle` to a person id in `roles.yaml`
  (Chapter 8, [Section 8.4](08-brownfield.md#s8-4)). A team handle such as `@northwind/billing` matches nobody.


<a id="s7-7"></a>
## 7.7 Release: `release.md`, release checks and the production rule

*Emily (release manager), with the agent  ·  tasklet  · needs: the review gate approved, the release gate required*

The agent prepares the release up to the production gate. Emily decides with `release.md` and the release
checks in front of her. Production commands stay closed until she approves.

### Procedure

1. Oliver runs `/sdlc:release` (or `/sdlc:next`). The agent writes `release.md` from `sdlc instructions release`: the
   version and changelog, the rollout per environment, the monitoring signals and control bands, and the rollback.
   The changelog section comes from the specs:

   ```bash
   sdlc changelog --change add-due-dates
   ```

   ```markdown
   ### Added

   - Due date (tasks, add-due-dates)
   - Overdue first (tasks, add-due-dates)
   ```

   The rollout table names who may run each step:

   ```markdown
   | Environment | Steps | Who may run it | Result |
   |---|---|---|---|
   | development | npm run deploy -- --env dev | agent | ok |
   | staging | npm run deploy -- --env staging | agent / engineer | ok |
   | production | npm run deploy -- --env production | after `sdlc approve release` | |
   ```

2. The production release command rule. `release.commands` in `openspec/sdlc.yaml` holds regular expressions for
   production commands, for example `\bdeploy\b.*\bprod(uction)?\b`. Before the release approval, the agent's
   production command is denied in every mode:

   ```text
   [sdlc:release-gate] This looks like a production release (matched /\bdeploy\b.*\bprod(uction)?\b/). Production
   releases need a named release authorization: a release manager runs `sdlc approve release --change <id>` after
   reviewing release.md (or sets SDLC_RELEASE_APPROVAL for this session). The agent prepares the release; it does
   not authorize it. Why, and what to do: `sdlc guide denials#release-gate`.
   ```

3. Release checks over MCP. In [Section 2.5](02-toolchain-mcp.md#s2-5) Steven added a `release.mcp` check: the
   `release.yml` workflow (deploy to
   staging and smoke tests) must be green for this commit.

   ```yaml
   release:
     mcp:
       - name: staging-deploy-green
         server: github
         tool: list_workflow_runs     # the tool name your server exposes
         args: { owner: northwind-labs, repo: tasklet, workflow_id: release.yml, head_sha: "${HEAD}", per_page: 1 }
         expect:
           workflow_runs:
             - { status: completed, conclusion: success }
   ```

   The agent (or Emily) runs the checks beforehand. The command writes nothing:

   ```bash
   sdlc release check --change add-due-dates
   ```

   ```text
   ✓ staging-deploy-green (github/list_workflow_runs, 0.5s)
   Every required release check passed.
   ```

   When the pipeline is red:

   ```text
   ✗ staging-deploy-green (github/list_workflow_runs, 0.5s)
       workflow_runs[0].conclusion: expected "success", got "failure"
   Required release checks failed: 1.
   ```

4. Emily reads `release.md` and approves in her own terminal. A failing release check refuses the approval:

   ```text
   error: The release cannot be approved: required release.mcp checks failed: staging-deploy-green
   (github/list_workflow_runs): workflow_runs[0].conclusion: expected "success", got "failure". Nothing was written.
   fix: Fix the cause and check again: `sdlc release check --change add-due-dates`.
   ```

   With the pipeline green:

   ```bash
   sdlc approve release --change add-due-dates
   ```

   ```text
   ✓ release gate: Emily <emily@northwind.example> approved as release-manager (edeacf91536e)
   ```

   The check results are kept with the approval. The same production command is now allowed.

5. After the release, the agent records the outcome in `release.md` and read the signals. If a control band is
   breached, it runs the rollback (where the plan allows it) and opens a new change with `/sdlc:triage`.

### You are done when

- `release.md` has a changelog from `sdlc changelog`, a rollout row per environment and an exact rollback command.
- `sdlc release check --change add-due-dates` passes.
- `sdlc status --change add-due-dates` shows `release ✓ approved` by Emily.

### Pitfalls

- The release gate is optional by default (`gates.release.required: false`). Turn it on, as in `tasklet`, when a
  named person must authorize every production release.
- `release.commands` are patterns on the command text. A production deploy with another spelling is not caught; keep
  the patterns close to your real scripts.
- `SDLC_RELEASE_APPROVAL` is read from the environment of the hook, that is the environment in which Claude Code was
  started. Setting it is a person's decision for that session.
- Waiting gates and approvals can go to the team's Telegram bot through `events`. The bot only informs;
  Emily still approves in her terminal.


<a id="s7-8"></a>
## 7.8 Archive and the changelog

*the agent; Emily and Laura read the results  ·  tasklet  · needs: every required gate satisfied*

The change closes, its delta specs become the living specs, and the release notes for a period come from
the specs.

### Procedure

1. `sdlc next` says the change is ready:

   ```text
   add-due-dates: Done (ready to archive)
   agent: All gates are satisfied: archive the change to merge its delta specs into openspec/specs/.
   $ sdlc archive add-due-dates --yes
   ```

2. Oliver runs `/sdlc:archive`. The agent checks the gates again and archives:

   ```bash
   sdlc archive add-due-dates --yes
   ```

   ```text
   ✓ archived add-due-dates → openspec\changes\archive\2026-10-09-add-due-dates
     specs: +2 added, ~0 modified, -0 removed, 0 renamed
   ```

   The folder moves to `openspec/changes/archive/2026-10-09-add-due-dates/` with its full record: intent, specs,
   plan, evidence, review, release and approvals. `openspec/specs/tasks/spec.md` now holds the two requirements. A
   linked backlog item is marked `done`.

3. The agent closes the loop and proposes, without applying: a regression test for a bug fix, `CLAUDE.md` or
   `AGENTS.md` rules for mistakes seen twice, and follow-up intents for deferred scope (for example D1).

4. For the release notes of a period, Emily runs:

   ```bash
   sdlc changelog --since 2026-10-01
   ```

   ```text
   ### Added

   - Due date (tasks, add-due-dates)
   - Overdue first (tasks, add-due-dates)
   ```

   `--json` gives the same for tools. A change without delta specs adds nothing.

### You are done when

- `sdlc status` no longer lists `add-due-dates`; `sdlc status --archived` does.
- `openspec/specs/tasks/spec.md` exists.
- `sdlc audit --change add-due-dates` shows the approvals, the verify runs and the hours each gate waited.

### Pitfalls

- `sdlc archive --force` past an unsatisfied gate is a person's command and needs `--note`. `sdlc health` reports
  forced archives.
- A change that alters no behaviour (tooling, docs) is archived with `--skip-specs`.
- For an auditor, Laura exports the evidence: `sdlc audit --export evidence-q4 --since 2026-10-01` (Chapter 9).

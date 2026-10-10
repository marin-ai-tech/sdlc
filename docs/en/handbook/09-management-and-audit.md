# 9. Managing and auditing the process

This chapter is for **Laura**, the engineering manager at Northwind Labs. She does not write code and does not approve
gates. She read how the process works, finds where it suffers, and answers questions from management and from an
external auditor. Every command in this chapter only reads the process (or writes a report file).

## Contents

- [9.1 The progress report](#s9-1)
- [9.2 The dashboard, and keeping it current](#s9-2)
- [9.3 Project health and the health workflow](#s9-3)
- [9.4 The audit: where the time goes](#s9-4)
- [9.5 Trace, changelog and the project log](#s9-5)
- [9.6 Evidence for the auditor](#s9-6)
- [9.7 The daily summary and events in Telegram](#s9-7)
- [9.8 A portfolio view over MCP](#s9-8)

### Context

Anyone may run them, including the agent. The outputs in this chapter come from a trial run of `tasklet` with sdlc
0.14.4: Megan approved the intent and the spec, Ethan approved the plan (and sent it back once), Oliver's agent built
and verified the change, and Paul approved the review. Times are short because the run took a few minutes.


<a id="s9-1"></a>
## 9.1 The progress report

*Laura  ·  tasklet  · needs: sdlc installed, a clone of `tasklet`, at least one change*

Produce the progress report of a project in Markdown or JSON, for one period or one change, and save it to
a file.

### Procedure

1. In the project folder, print the report:

   ```bash
   sdlc report
   ```

   You sees a Markdown document (real output, shortened):

   ```text
   # tasklet SDLC progress (all time to 2026-10-09T20:33:56.713Z)

   1 active · 1 archived · 0 blocked · 1 awaiting a person

   ## Stages
   | Stage | Active |
   | Plan (intent) | 1 |
   ...
   ## Changes
   | Change | Stage | Tasks | Verification | Next |
   | fix-empty-title | Plan (intent) | 0/0 | never | 1 open question(s) in intent.md wait for a person's answer ... |
   | add-task-list | Archived | 3/3 | passed | Change is archived. |
   ```

   Further sections follow: lifecycle diagrams (Mermaid), the backlog (next and blocked items), deferred work, median
   lead times, recent events and layout readiness.

2. Limit the report to a period or to one change:

   ```bash
   sdlc report --since 2026-10-01
   sdlc report --change add-task-list
   ```

   The title line now shows the period, for example `(2026-10-01T00:00:00.000Z to 2026-10-09T20:26:15.164Z)`.

3. Choose the format. `md` is the default; `json` is for scripts; `html` is the dashboard page ([Section 9.2](#s9-2)):

   ```bash
   sdlc report --format json
   sdlc report --json                 # the same as --format json
   sdlc report --format html
   ```

   The JSON has the keys `generatedAt`, `period`, `project`, `harness`, `summary`, `metrics`, `changes`, `events`,
   `layout`, `deferred`, `backlog` and `health`.

4. Save the report to a file:

   ```bash
   sdlc report --since 2026-10-01 --out reports/october.md
   ```

   You sees `Written to …\tasklet\reports\october.md`.

5. Read the report in Russian if a reader needs it: `sdlc report --locale ru`. JSON never changes with the locale.

### You are done when

- `reports/october.md` exists and its first line names the period.
- `sdlc report --format json` prints valid JSON with a `summary` key (`active`, `archived`, `awaitingHuman`,
  `blocked`, `byStage`).

### Pitfalls

- `--out` must stay inside the project. `--out ../october.md` fails with `--out must stay inside the project.` To
  write elsewhere, redirect the output: `sdlc report > ../october.md`.
- A report file inside the project is a new file outside `openspec/`. sdlc counts it as a change to the code, so the
  last verification of an active change becomes stale ("Code changed since the last passing verification"). Add
  `reports/` to `.gitignore` once (a person commits it; the agent then runs `sdlc verify` again). After that, files
  in `reports/` never make verification stale.
- The report is not a decision. Nothing in it approves or moves a change.


<a id="s9-2"></a>
## 9.2 The dashboard, and keeping it current

*Laura, with Steven for the background job  ·  tasklet  · needs: [Section 9.1](#s9-1), `reports/` in `.gitignore`*

Build the HTML dashboard of a project and keep it fresh while the team works.

### Procedure

1. Build the page:

   ```bash
   sdlc dashboard --out reports/dashboard.html
   ```

   You sees `Written to …\reports\dashboard.html`. Without `--out`, the command prints the HTML to the
   terminal. The page is one self-contained file: no network, light and dark themes, it works on a phone.

2. Open `reports/dashboard.html` in a browser. Walk through the sections: Overview, Stage pipeline, Changes, Change
   pages, Backlog, Deferred work, Median lead times, Health, Timeline, Layout readiness. The overview shows the agent
   commits, and each change page shows people's participation, planned / actual.

3. Open the page of `add-task-list` (under Change pages): the timeline, the waits on people, the rework with its
   reason (`test-gap`), the trace gaps and who acts now.

4. Limit the page like the report: `sdlc dashboard --since 2026-10-01 --change add-task-list --out reports/x.html`.

5. Keep the page current. `sdlc dashboard` has no read mode of its own. The sdlc repository ships an example script,
   `scripts/examples/dashboard-read.mjs`, that read `openspec/` and rebuilds the page. It is not part of the
   installed package, so Steven copies it from the sdlc repository into the team's tools folder:

   ```bash
   node dashboard-watch.mjs --once                          # build once and exit
   node dashboard-watch.mjs                                 # watch openspec/ and rebuild
   node dashboard-watch.mjs --serve 127.0.0.1:8123          # and serve the page with auto-refresh
   ```

   Run it in the project folder. The default page is `reports/dashboard.html`. Each rebuild prints a line such as
   `12:58:31 rebuilt reports/dashboard.html in 812 ms`. With `--serve`, open `http://127.0.0.1:8123/`: the page reloads
   itself every 5 seconds. Stop it with Ctrl+C.

6. Run it in the background. `scripts/examples/README.md` in the sdlc repository has a Windows Task Scheduler helper
   (`register-dashboard-task.ps1`), a `systemd --user` unit, a `launchd` agent and a CI step that keeps the page as a
   build artifact.

### You are done when

- `reports/dashboard.html` opens offline and shows the same counts as `sdlc report`.
- With the watcher running, edit a file under `openspec/` and see a new "rebuilt" line.

### Pitfalls

- `--out` must stay inside the project, as for the report. Keep `reports/` in `.gitignore`, or the page makes the
  verification of an active change stale ([Section 9.1](#s9-1)).
- Keep `--out` of the watcher outside `openspec/`, or every rebuild triggers the next one.
- `--serve` serves on the host you give. `127.0.0.1` keeps it on your machine; the page shows names and email
  addresses of the team.
- If `sdlc` is installed per project, pass the command line: `--cli "npx --no-install sdlc"`.


<a id="s9-3"></a>
## 9.3 Project health and the health workflow

*Laura, with Megan for ordering the backlog  ·  tasklet and billing-api  · needs: a project with some history; Claude
Code for step 4*

Find where the process suffers with `sdlc health`, tune its thresholds, and turn the improvements you choose
into backlog items that Megan orders.

### Procedure

1. Run the health check:

   ```bash
   sdlc health
   ```

   On a healthy project you see (real output, `tasklet` after the first change):

   ```text
   Project health: 0 bad, 0 warn, 0 info
   No findings: nothing to improve right now.
   ```

   On a young project with several tools you may see (real output, shortened):

   ```text
   Project health: 0 bad, 2 warn, 1 info
   ! warn The installation has problems (config.doctor)
       - codex: sdlc's hooks installed in .codex/hooks.json, ...
       Recommendation: Run `sdlc doctor` and follow its fixes.
   ! warn Scenarios without behavioral verification (quality.trace)
       - add-task-list: 2 scenarios without a verification row (A project with two tasks; ...)
       Recommendation: Add the behavioral verification rows for these scenarios to verification.md; `sdlc trace` lists them.
   i info The diff departs from the approved plan (quality.plan_drift)
   ```

2. Read a finding. Each one has a level (`bad`, `warn`, `info`), an id in brackets, the facts, and a recommendation.
   There is no single score on purpose: a number hides what to do. The command always exits 0. It advises; it never
   blocks.

   | Area | Finding ids |
   |---|---|
   | Flow | `flow.overdue`, `flow.wait`, `flow.stalled`, `flow.deferred` |
   | Quality | `quality.first_pass`, `quality.rework_reason`, `quality.plan_drift`, `quality.open_findings`, `quality.trace` |
   | Discipline | `discipline.waivers`, `discipline.lite_behaviour`, `discipline.forced_archive`, `discipline.restale`, `discipline.denials`, `discipline.test_lock` |
   | Configuration | `config.no_verify`, `config.enforcement`, `config.single_person`, `config.signing`, `config.context_stale`, `config.doctor` |

3. Tune the thresholds. They live under `health` in `openspec/sdlc.yaml`. Only a person edits that file (the hook
   denies the agent, rule `guard-config`). Steven adds, for example:

   ```yaml
   health:
     window_days: 90      # how far back the log and histories count
     wait_hours: 24       # a gate waiting longer for a person is a finding (default 48)
     rework_share: 0.6    # one rework reason this common is a finding (default 0.5)
   ```

   The other keys and their defaults: `stalled_days: 14`, `deferred_days: 30`, `first_pass_rate: 0.5`,
   `waiver_share: 0.3`, `reapprovals: 3`, `denials: 5`, `lock_days: 7`.

4. Ask the agent to explain the findings and draft improvements. In Claude Code:

   > /sdlc:health

   The agent runs `sdlc health --json`, may hand the digging to the read-only `sdlc-health` subagent, and explains
   each finding in plain words, `bad` first. Then it asks which improvements to draft.

   > Draft an item for the rework reason finding only.

   For each chosen improvement the agent adds a backlog item that names its finding, for example:

   ```bash
   sdlc backlog add "Name a test for every scenario in the plan" --kind chore \
     --outcome "Plans name the test of each scenario" --accept "No plan rework for test-gap in a month" \
     --source-type health --source-ref quality.rework_reason
   ```

   The agent never moves the item and never edits `openspec/sdlc.yaml` or `openspec/roles.yaml`. For configuration
   findings it proposes the exact change for a person to make.

5. Megan orders the new item in her own terminal. This is a person's command:

   ```bash
   sdlc backlog move B12 --top
   ```

   If the agent tries it, the hook denies it with `[sdlc:separation-of-duties]`.

6. See health where people already look. While a `bad` finding exists, the agent's session starts with one line about
   it. `health.degraded` (and later `health.recovered`) goes to the project log and to the event receivers, for
   example the Telegram bot ([Section 9.7](#s9-7)). The dashboard has a Health section.

### You are done when

- `sdlc health` prints a findings line and exits 0.
- `sdlc backlog list` shows the drafted item; the item came from the agent, its order from Megan.
- After Steven changes `wait_hours`, a gate that waited 30 hours appears under `flow.wait`.

### Pitfalls

- A health finding is advice, not a gate. Do not wait for a "score".
- An unknown key under `health` is a configuration error; check the spelling against the list above.
- The agent may draft items, never order them. "Put it at the top" in the chat does nothing; Megan runs
  `sdlc backlog move`. See `sdlc guide denials#separation-of-duties`.
- Repeated denials of one hook rule show up as `discipline.denials`, with the guide article to read.


<a id="s9-4"></a>
## 9.4 The audit: where the time goes

*Laura  ·  tasklet  · needs: at least one change that passed a few gates*

Read the SDLC metrics of a project and the timeline of one change: lead times, first-pass verification,
waits per gate, reworks, people's participation and the agents' share of commits.

### Procedure

1. Run the project audit:

   ```bash
   sdlc audit
   ```

   Real output (the license note at the end of the first and last lines is cut here):

   ```text
   SDLC metrics across 2 change(s) (1 archived) · sdlc 0.14.4, ...
     median hours: intent→spec 0 · spec→plan 0 · plan→verified 0 · verified→review 0 · total 0
     verification first-pass rate: 1; rejections 0; waivers 0 (+0 by policy)
     agent commits: 11 of 17 (SDLC-Agent trailer)
     median wait for a person (seconds): intent 1 · spec 1 · review 1; rework reasons: test-gap 1
     people's participation (2 changes), planned / actual: gate decisions 8; approvals 8 / 5; reworks 1, ...
       fix-empty-title: gates intent, spec, plan, review; approvals 4 / 0; reworks 0, takeovers 0, ...
       add-task-list: gates intent, spec, plan, review; approvals 4 / 5; reworks 1, takeovers 0, ...
   ```

2. Read it line by line:

   | Line | What it tells Laura |
   |---|---|
   | median hours | lead time between stages; long gaps show where work waits |
   | first-pass rate | share of changes whose first `sdlc verify` passed |
   | rejections, waivers | decisions against or around a gate; `by policy` counts `auto_waive` |
   | agent commits | commits with the `SDLC-Agent` trailer, out of all commits |
   | median wait for a person | per gate, how long a gate waited for a person's decision |
   | rework reasons | why work went back (`missing-requirement`, `test-gap`, ...) |
   | participation | per change: the decisions the track planned against what people did |

   `add-task-list` planned four approvals and got five: Ethan approved the plan twice because he sent it back once.

3. Read the timeline of one change:

   ```bash
   sdlc audit --change add-task-list
   ```

   Real output, shortened (the version stamp at the end of each line is cut):

   ```text
   Audit trail: add-task-list[feature · risk medium · full]
     2026-10-09T20:32:51.539Z  change.created             Oliver <oliver@northwind.example> - schema sdlc, full track
     2026-10-09T20:32:55.299Z  gate.intent.approved       Megan <megan@northwind.example> - role product-owner
     2026-10-09T20:33:00.620Z  gate.spec.approved         Megan <megan@northwind.example> - role product-owner
     2026-10-09T20:33:05.191Z  gate.plan.approved         Ethan <ethan@northwind.example> - role engineer
     2026-10-09T20:33:07.417Z  gate.plan.rework           Ethan <ethan@northwind.example> - test-gap: Name the test ...
     2026-10-09T20:33:10.809Z  gate.plan.approved         Ethan <ethan@northwind.example> - role engineer
     2026-10-09T20:33:15.731Z  verify.passed              Oliver <oliver@northwind.example> - test=0
     2026-10-09T20:33:33.308Z  gate.review.approved       Paul <paul@northwind.example> - role code-owner
     2026-10-09T20:33:45.419Z  change.archived            Oliver <oliver@northwind.example>
     ...
     reworks 1: plan (test-gap, 2026-10-09T20:33:07.417Z)
     verify attempts to the first pass 1; approvals: intent 1 · spec 1 · plan 2 · review 1
   ```

4. Use JSON for your own charts: `sdlc audit --json`. The `aggregate` key holds the project numbers
   (`medianLeadTimeHours`, `verifyFirstPassRate`, `medianWaitSeconds`, `reworkReasons`, `participation`,
   `agentCommits`, ...); `changes` holds one entry per change.

5. When one change looks stuck, ask why:

   ```bash
   sdlc explain --change fix-empty-title
   ```

   Real output:

   ```text
   fix-empty-title: Plan (intent)
   Open gate: intent (pending): awaiting approval (product-owner; 0 of 1).

   Waiting for: person. Approval still missing from: product-owner.

   What unblocks it:
     1. person: 1 open question(s) in intent.md wait for a person's answer before the intent gate can be approved ...
        $ sdlc answer 1 --change fix-empty-title --text "…"
   ```

### You are done when

- You can say, for `tasklet`, the first-pass rate, the most common rework reason and the agents' share of commits.
- `sdlc audit --change add-task-list` lists the rework with its reason.

### Pitfalls

- `sdlc audit --since` alone fails: `--since works only together with --export <dir>.` The plain audit always covers
  all time. For a period, use `sdlc report --since` ([Section 9.1](#s9-1)) or the export ([Section 9.6](#s9-6)).
- The agents' share counts only commits made in an agent's terminal. A person who commits what an agent wrote makes a
  person's commit. The share is for the whole project; the audit of one change does not show it.
- For an archived change, the "commits touching the change folder" list shows only the commits after the folder moved
  to `openspec/changes/archive/`. Use `sdlc trace` ([Section 9.5](#s9-5)) for the commits of each task.
- Waits are measured from `gate.<g>.awaiting` to the decision. The log records `gate.<g>.awaiting` when a command
  (for example `sdlc status`, `sdlc next` or the approval itself) first sees the gate ready for a person. If nobody
  looks at the project for a day, the wait looks shorter than it was.


<a id="s9-5"></a>
## 9.5 Trace, changelog and the project log

*Laura (also Emily before a release)  ·  tasklet  · needs: an archived change*

Follow one change from intent to evidence, build release notes from the specs, and read the raw project
log.

### Procedure

1. Trace the change:

   ```bash
   sdlc trace add-task-list
   ```

   Real output:

   ```text
   Trace: add-task-list (archived)
   Intent: list the tasks of a project
   Requirement: List the tasks of a project (specs/tasks/spec.md)
     Scenario: A project with two tasks — no evidence
     Scenario: Another project's tasks are never listed — no evidence
   Tasks:
     1.1 [x] Tests for both scenarios — commits: 3df78b2
     1.2 [x] List tasks by project id — commits: a61a8aa
     2.1 [x] Run sdlc verify and confirm every required check passes — no commit
   Gaps (3):
     scenario without evidence: A project with two tasks
     scenario without evidence: Another project's tasks are never listed
     task without a commit: 2.1
   ```

2. Read the gaps. A scenario has evidence when `verification.md` has a behavioral verification row for it. A task has
   a commit when a commit carries the trailers `SDLC-Change: add-task-list` and `SDLC-Task: 1.2`; `/sdlc:build` asks
   the agent to add them. Gaps are not failures; they are questions for the reviewer and for Laura.

3. Build the changelog of one change, or of everything archived since a date:

   ```bash
   sdlc changelog --change add-task-list
   sdlc changelog --since 2026-10-01
   ```

   Real output:

   ```markdown
   ### Added

   - List the tasks of a project (tasks, add-task-list)
   ```

   Without options, the command lists the requirements of every active change. `/sdlc:release` puts the same text
   into `release.md`, so the release notes match the specs.

4. Read the project log, newest last:

   ```bash
   sdlc log --change add-task-list --limit 4
   ```

   Real output (version stamps cut):

   ```text
   (last 4 of 13 entries; --limit to see more)
   2026-10-09T20:33:15.744Z  verify.passed         add-task-list Oliver <oliver@northwind.example> - test=0
   2026-10-09T20:33:32.420Z  gate.review.awaiting  add-task-list  - sha256:b50993561014b52a...
   2026-10-09T20:33:33.320Z  gate.review.approved  add-task-list Paul <paul@northwind.example> - role code-owner
   2026-10-09T20:33:46.449Z  change.archived       add-task-list Oliver <oliver@northwind.example> - archived as ...
   ```

   The log is `openspec/.sdlc/log.jsonl`. Only the CLI writes it; the hook denies agent edits (rule
   `state-integrity`). Each entry carries the sdlc version and license it was written with. `sdlc log --json` gives
   the entries to a script.

### You are done when

- You can name the scenarios of `add-task-list` that have no evidence.
- `sdlc changelog --since <date>` lists the requirement added by `add-task-list`.
- `sdlc log --limit 5` shows the five newest entries.

### Pitfalls

- `sdlc changelog` with both `--change` and `--since` is refused; pick one.
- A change without delta specs (`skip_specs`) adds nothing to the changelog. That is expected.
- `sdlc log` shows 50 entries by default. Use `--limit` for more.


<a id="s9-6"></a>
## 9.6 Evidence for the auditor

*Laura and the external auditor  ·  tasklet  · needs: `openspec/roles.yaml` with `signing: warn` or `required`,
approvals committed with their trailers*

Check that every approval came from the right person in a commit, and hand the auditor one folder with the
evidence of a quarter.

### Procedure

1. The auditor asks: "Who approved each gate, and can you prove it was them?" Laura checks the signatures and the
   trailers:

   ```bash
   sdlc approvals verify
   ```

   With `signing: warn` in `roles.yaml` and no signed commits yet, you see (real output):

   ```text
   ✗ add-task-list/intent megan unsigned 4a6f4655
   ✗ add-task-list/spec megan unsigned f27536f3
   ✗ add-task-list/plan ethan unsigned 335461ad
   ✗ add-task-list/review paul unsigned 134eb0e3
   ✗ openspec/roles.yaml steven@northwind.example unsigned 278233e6
   4 approvals checked, 5 invalid (warn: not blocking)
   Sign commits: git config gpg.format ssh; git config user.signingkey <key>; git commit -S
   ```

2. Read the statuses. For an approval: `valid`, `unsigned`, `wrong-signer` (someone else signed a commit that claims
   this approval), `bad-signature`, `not-committed`. For a commit to `roles.yaml`: `valid`, `unsigned`,
   `not-maintainer`. The JSON (`sdlc approvals verify --json`) also gives `trailer: found | missing` for each
   approval: whether the commit with its `SDLC-Approval` trailer exists.

3. Choose the mode. `signing` in `roles.yaml` is `off`, `warn` or `required`; `--mode` overrides it for one run:

   ```bash
   sdlc approvals verify --mode required     # exits 1 on any problem: use it in CI
   ```

   Without `roles.yaml` or with `signing: off`, the command prints `Approval signing is off.`

4. Export the evidence bundle for the quarter. Laura runs it in her terminal and writes it next to the repository, not
   inside it:

   ```bash
   sdlc audit --export ../evidence-q4 --since 2026-10-01
   ```

   Real output:

   ```text
   Evidence bundle written to …\evidence-q4: 2 change(s), 4 approval(s), 16 file(s).
   ```

   The folder holds `index.md` (a readable table per change), `index.json` (the same for tools), `changes/` (the folder
   of every change: intent, specs, design, plan, tasks, verification, review, the change record) and `log.jsonl` (the
   decisions of the period). One row of `index.md`:

   ```text
   | Gate | Role | By | At | Digest | Signature | Trailer |
   | review | code-owner | Paul <paul@northwind.example> (paul) | 2026-10-09T20:33:33.308Z | sha256:b509… | unsigned | found |
   ```

5. Give the folder to the auditor. It holds only files from inside `openspec/`: no source code, no secrets. The
   auditor reads `index.md`, opens the change folders it links to, and compares the digests with the records.

### You are done when

- `../evidence-q4/index.md` lists every approval with its role, person, digest, signature and trailer.
- `sdlc approvals verify --mode required` exits 1 while any approval is unsigned, and 0 when all are `valid`.

### Pitfalls

- The export refuses a folder that exists and is not empty: "the export never overwrites or mixes into existing
  files". Pick a new folder name for each export.
- The export refuses a folder inside `openspec/`. A folder elsewhere inside the project works, but it makes the
  verification of active changes stale ([Section 9.1](#s9-1)); write it outside the repository.
- `trailer: missing` means the approver did not commit the record with the suggested message. `sdlc approve` prints
  the ready `git commit` line; the approver uses it. Signing is per person: `git config gpg.format ssh`,
  `git config user.signingkey ~/.ssh/id_ed25519.pub`, `git config commit.gpgsign true`, and the public key in
  `signing_key` in `roles.yaml` (a maintainer commits that change).
- `approvals verify` does not stop a person with write access who switches the CI check off. Protect the default
  branch and require the CI job that runs `--mode required`.


<a id="s9-7"></a>
## 9.7 The daily summary and events in Telegram

*Laura asks, Steven sets it up  ·  tasklet  · needs: a team server with a checkout of `tasklet`, a Telegram bot, the
`telegram` MCP server in `mcp.servers` (set up by Steven)*

Get a short summary of the project into the team's Telegram chat every morning, and the important process
events (a gate waits for Megan, an approval, an overdue gate, health degraded) as they happen.

sdlc itself sends nothing to Telegram. It gives two pieces: an example script that writes the summary to a file, and
`events` that call a tool of an MCP server. The sending is done by the team's own script and the team's Telegram MCP
server.

### Procedure

1. Find the example script. It ships in the sdlc package as `assets/examples/daily-summary.mjs`. Steven copies it to
   the server's tools folder:

   ```bash
   cp "$(npm root -g)/sdlc/assets/examples/daily-summary.mjs" /srv/northwind/tools/
   ```

2. Try it in the project folder:

   ```bash
   cd /srv/northwind/tasklet
   node /srv/northwind/tools/daily-summary.mjs --out /srv/northwind/summaries/tasklet
   ```

   It prints the path of the file it wrote and nothing else. Real content of the file:

   ```markdown
   # Daily summary 2026-10-09

   Project tasklet: 1 active, 1 waiting on people.

   ## Done

   - add-task-list: gate.intent.approved (Megan <megan@northwind.example>)
   - add-task-list: gate.plan.approved (Ethan <ethan@northwind.example>)
   - add-task-list: gate.review.approved (Paul <paul@northwind.example>)
   - add-task-list: change.archived (Oliver <oliver@northwind.example>)

   ## Next

   - nothing

   ## Blocked

   - nothing

   ## Waiting on people

   - fix-empty-title (plan): 1 open question(s) in intent.md wait for a person's answer ... - `sdlc answer 1 ...`
   ```

   The script reads `sdlc report --format json --since <yesterday>`. Options: `--out <folder>` (default: the current
   folder) and `--since <YYYY-MM-DD>`. `SDLC_BIN` changes how it calls sdlc (default `sdlc`).

3. Send the file to Telegram with a small script of your own. This example uses the Telegram Bot API directly; the
   token and the chat id come from the environment of the server, never from the repository:

   ```bash
   #!/usr/bin/env bash
   # /srv/northwind/tools/daily-tasklet.sh
   set -e
   cd /srv/northwind/tasklet
   git pull --quiet
   file=$(node /srv/northwind/tools/daily-summary.mjs --out /srv/northwind/summaries/tasklet)
   curl -s -F chat_id="${TELEGRAM_CHAT_ID}" -F document=@"${file}" \
     "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument" > /dev/null
   ```

4. Schedule it every weekday at 08:00:

   ```bash
   # crontab -e
   0 8 * * 1-5 /srv/northwind/tools/daily-tasklet.sh
   ```

   On a Windows server, use Task Scheduler with the same idea:

   ```bat
   schtasks /Create /SC DAILY /ST 08:00 /TN sdlc-daily /TR "cmd /c cd /d C:\northwind\tasklet && node C:\northwind\tools\daily-summary.mjs --out C:\northwind\summaries\tasklet"
   ```

   Then add the sending step for Windows in the same task (for example a PowerShell script).

5. Push events as they happen. A person adds a receiver to `openspec/sdlc.yaml` (protected: the agent cannot):

   ```yaml
   project: { name: tasklet }
   events:
     - server: telegram                 # a server of mcp.servers
       tool: report_event               # the tool name your server exposes for events
       on: ["gate.*.awaiting", "gate.*.approved", "gate.*.overdue", "health.degraded"]
       args: { chat: northwind-tasklet }
   ```

   Without `on`, a receiver gets `gate.*`, `verify.*`, `change.created`, `change.archived`, `backlog.*`,
   `health.degraded` and `health.recovered`. Check it:

   ```bash
   sdlc events list
   ```

   Real output:

   ```text
   Receiver telegram/report_event: gate.*.awaiting, gate.*.approved, gate.*.overdue, health.degraded
   No events wait for delivery.
   ```

6. Know what the tool receives. After a command, sdlc calls the tool with your static `args` plus one `event`
   object: `{ id, project, event, change, gate, at, sdlc, by, waitingFor }`. `waitingFor` names the people from
   `roles.yaml` who may take a waiting gate, so the bot can write "Megan, the intent of fix-empty-title waits for
   you". `id` is stable, so the bot can drop repeats. An event never carries an email address, a command, its output
   or a note. A Telegram server whose send tool takes only a chat id and a text cannot use this directly: Steven adds
   a small tool to the team's server that turns the `event` object into a message.

7. Make overdue gates arrive on time. Add `overdue_hours` to a gate in `openspec/sdlc.yaml`, inside its existing
   entry:

   ```yaml
   gates:
     intent:
       required: true
       approvers: [product-owner]
       overdue_hours: 24
   ```

   sdlc has no daemon. A gate past its limit raises `gate.intent.overdue` once, at the next command, session start or
   `sdlc events flush`. Run the flush on the server every 15 minutes:

   ```bash
   */15 * * * * cd /srv/northwind/tasklet && git pull --quiet && sdlc events flush
   ```

### You are done when

- The chat gets one summary file every weekday morning.
- `sdlc events list` names the `telegram` receiver and its patterns.
- When Megan's intent gate waits longer than 24 hours, the chat gets one overdue message.

### Pitfalls

- Delivery never fails a command and takes at most 5 seconds. An event that could not be sent waits in
  `.git/sdlc/outbox/` on the machine that ran the command (never committed) and goes with the next command there, or
  with `sdlc events flush`. `sdlc events list` shows what waits.
- Hook decisions (`hook.*`) are sent only when a pattern names them, for example `hook.denied`.
- A literal token in `mcp.servers` is refused (`mcp_secret_literal`). Write `${TELEGRAM_BOT_TOKEN}`.
- The summary script writes to `--out`, which may be any folder. Keep it outside the repository, or add it to
  `.gitignore`.


<a id="s9-8"></a>
## 9.8 A portfolio view over MCP

*Laura  ·  both  · needs: checkouts of `tasklet` and `billing-api`, Claude Desktop (or another MCP client)*

Ask about both Northwind projects in plain words from one chat client, and build a simple cross-project
report.

### Procedure

1. Point Claude Desktop at both projects. In `claude_desktop_config.json`:

   ```json
   {
     "mcpServers": {
       "sdlc": {
         "command": "sdlc",
         "args": ["mcp", "serve", "--project", "C:\\northwind\\tasklet", "--project", "C:\\northwind\\billing-api"]
       }
     }
   }
   ```

   Restart Claude Desktop. The server prints, on its error stream, `[sdlc mcp] serving …\tasklet, …\billing-api over
   stdio (version 0.14.4)`.

2. See what the server offers. With several projects, every tool takes a `project` argument (the `project.name` in
   `openspec/sdlc.yaml`, else the folder name). The tools, from a real listing:

   | Tool | Arguments | Answers like |
   |---|---|---|
   | `status` | `change`, `project` | `sdlc status --json`; without `project`, for all projects |
   | `next` | `change`, `project` | `sdlc next --json` |
   | `instructions` | `artifact`, `change`, `project` | `sdlc instructions <artifact> --json` |
   | `trace` | `change`, `project` | `sdlc trace <change> --json` |
   | `audit` | `change`, `project` | `sdlc audit --json` |
   | `help` | `topic`, `project` | `sdlc help --json` |
   | `guide` | `topic`, `project` | `sdlc guide <topic> --json` |

   Read-only resources come with them: `sdlc://<project>/spec/<capability>`, `sdlc://<project>/change/<id>/<artifact>`
   and others.

3. Ask in plain words:

   > Which gates wait for a person in tasklet and in billing-api, and who are those people?

   > What did we rework this month in billing-api, and why?

   > Compare the first-pass verification rate of the two projects.

   The assistant answers from `status`, `next` and `audit`. It cannot approve anything: the decision commands are not
   tools.

4. For health and the full report, use the CLI per project; `health` and `report` are not MCP tools. A small script on
   the team server:

   ```bash
   for p in tasklet billing-api; do
     (cd /srv/northwind/$p && git pull --quiet && sdlc report --format json > /srv/northwind/portfolio/$p.json)
     (cd /srv/northwind/$p && sdlc health > /srv/northwind/portfolio/$p-health.txt)
   done
   ```

   The process state lives in each repository, so a central job never needs anyone's laptop.

### You are done when

- Claude Desktop lists the `sdlc` server with seven tools.
- A question about both projects gets an answer that names each project.

### Pitfalls

- A folder that is not an sdlc project, or two projects with the same name, stop the server at start. Give each project
  a distinct `project.name`.
- `sdlc mcp serve` speaks stdio only; there is no HTTP endpoint to reach from another machine. Run the client on the
  machine that has the checkouts.
- Treat a connected chat client as someone with read access to the repository: it sees names, stages, file paths and
  audit history.
- Each tool call starts the CLI anew (about half a second). That matters only for scripts with many calls.

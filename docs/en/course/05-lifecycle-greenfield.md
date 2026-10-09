# Module 5. One change from idea to archive (tasklet)

This module follows one change through every stage: **"Add due dates to tasks"** (`add-due-dates`) in the
`tasklet` API. Every person of the team appears at their gate. Oleg drives the agent; the others decide in their own
terminals.

In this module:

- Lesson 5.1 — The map: stages, gates, people and Telegram
- Lesson 5.2 — Intent: Maria answers a question and approves
- Lesson 5.3 — Spec: requirements and design, Maria approves
- Lesson 5.4 — Plan: the plan gate holds the code back
- Lesson 5.5 — Rework: Ivan sends the spec back
- Lesson 5.6 — Build: Oleg and Claude Code under the hooks
- Lesson 5.7 — Verify: evidence, CI and Anna's check
- Lesson 5.8 — Review: findings, a rejection and Pavel's approval
- Lesson 5.9 — Release: Elena authorizes production
- Lesson 5.10 — Archive: living specs, the backlog and the record

All outputs come from a trial run of `tasklet` with sdlc 0.14.4 and the configuration of Modules 1 to 3. Each person
ran their commands with their own git identity, outside the agent session. The `github` and `telegram` MCP servers
in that run were small local stand-ins with the tool names used in Module 2 (`list_workflow_runs`, `report_event`);
your servers' answers will be richer. "Gaps found" at the end of this file lists what sdlc does not do yet.

---

## Lesson 5.1 — The map: stages, gates, people and Telegram            (video: ~7 min)

**Role:** everyone; Sergey for the Telegram setup   **Project:** tasklet
**You need:** Modules 3 and 4 (roles, the team, B1 ready in the backlog); the `telegram` server in `mcp.servers`

**Goal.** Know the whole path of the change before it starts: who acts at each step, which command they run, and
what the team's Telegram chat receives.

### Steps

1. Show the path of `add-due-dates`. The agent works in Oleg's Claude Code; every gate is a person's command in their
   own terminal.

   | Step | Workflow (agent) | Gate | Who decides | Person's command |
   |---|---|---|---|---|
   | 1 | `/sdlc:intent` | intent | Maria (product-owner) | `sdlc answer …`, then `sdlc approve intent --change add-due-dates` |
   | 2 | `/sdlc:spec` | spec | Maria; also Ivan (tech-lead) when the risk is high | `sdlc approve spec --change add-due-dates` |
   | 3 | `/sdlc:plan` | plan | Ivan or Oleg (engineer) | `sdlc approve plan --change add-due-dates` |
   | 4 | `/sdlc:build` | — | — | — |
   | 5 | `/sdlc:verify` | verify | nobody: the checks; Anna reads the evidence | — |
   | 6 | `/sdlc:review` | review | Pavel (code-owner) | `sdlc approve review --change add-due-dates` |
   | 7 | `/sdlc:release` | release | Elena (release-manager) | `sdlc approve release --change add-due-dates` |
   | 8 | `/sdlc:archive` | — | — | — |

   At any moment, `sdlc next` names the next step and the person; `/sdlc:next` in Claude Code runs the next agent
   step or stops and names the person.

2. Show how the team is told. Sergey added the receiver in Module 2 (lesson 2.6):

   ```yaml
   events:
     - server: telegram
       tool: report_event             # the tool name your server exposes
       on: ["gate.*.awaiting", "gate.*.overdue", "gate.*.approved", "gate.*.rejected", "gate.*.rework",
            "verify.failed", "change.archived"]
       args: { chat: tasklet-team }
   gates:
     intent: { required: true, approvers: [product-owner], overdue_hours: 24 }
   ```

   After a command, sdlc calls the tool with the static `args` and an `event`. This is the first call the Telegram
   server received in the trial, when the intent started to wait for Maria:

   ```json
   {"chat":"tasklet-team","event":{"id":"7db8a1d5f45a4b0d3220a23d","project":"tasklet",
    "event":"gate.intent.awaiting","change":"add-due-dates","gate":"intent","at":"2026-10-09T21:01:48.218Z",
    "sdlc":"0.14.4","waitingFor":["maria"]}}
   ```

   `waitingFor` holds the people from `roles.yaml` who may take the gate, so the bot can mention Maria. A decision
   event carries `by` instead.

3. Show the whole sequence the chat received during this module, in order (event, then `waitingFor` or `by`):

   ```text
   gate.intent.awaiting   ["maria"]          gate.plan.approved     by ivan
   gate.intent.awaiting   ["maria"]          gate.review.awaiting   ["pavel"]
   gate.intent.approved   by maria           gate.review.rejected   by pavel
   gate.spec.awaiting     ["maria"]          gate.review.awaiting   ["pavel"]
   gate.spec.approved     by maria           gate.review.approved   by pavel
   gate.plan.awaiting     ["ivan","oleg"]    gate.release.awaiting  ["elena"]
   gate.spec.rework       by ivan            gate.release.approved  by elena
   gate.spec.approved     by maria           change.archived        by oleg
   gate.plan.awaiting     ["ivan","oleg"]
   ```

   Read the left column first, then the right one. Passing verifications are not sent: the `on` list names only
   `verify.failed`.

4. Explain delivery. It takes at most 5 seconds and never fails a command. An event that could not be sent waits in
   `.git/sdlc/outbox/` and goes with the next command:

   ```bash
   sdlc events list
   ```

   ```text
   Receiver telegram/report_event: gate.*.awaiting, gate.*.overdue, gate.*.approved, gate.*.rejected, gate.*.rework, verify.failed, change.archived
   No events wait for delivery.
   ```

   `sdlc events flush` sends the waiting events now. A gate that waits longer than its `overdue_hours` raises
   `gate.<gate>.overdue` once; sdlc notices it at the next command, so Sergey runs `sdlc events flush` from a
   scheduler every hour.

5. Show the three read-only views everyone uses in this module:

   | Command | Shows |
   |---|---|
   | `sdlc status --change <id>` | the stepper, every gate with its state and approver, the next step |
   | `sdlc next` | the next step and the person, with the exact command |
   | `sdlc explain --change <id>` | why the change is where it is, what unblocks it, the latest decisions |

### Check yourself

- You can name the person and the command for each gate of `add-due-dates`.
- `sdlc events list` names the `telegram` receiver.
- You can say which field of an event tells the bot whom to mention (`waitingFor`).

### Pitfalls

- sdlc sends a structured `event`, not a chat message. A Telegram MCP server that only accepts a `text` argument
  needs a small adapter tool that turns the event into a message.
- An event never carries an email, a note or command output. The rework note, for example, is not in
  `gate.spec.rework`; the bot can link to `sdlc explain` instead.
- Events are sent by the CLI, not by the agent. But `telegram` is a registry server like the others, so it is also
  laid out for Claude Code, and a server without `stages` is not governed by the stage rule
  (`sdlc guide denials#mcp-stage`): the agent could post to the chat too. Give the bot server only the event tool.

### On screen (for the video)

- The path table as a horizontal timeline with a face at each gate.
- A phone mock-up of the Telegram chat next to the terminal; each event appears as the lessons go on.

---

## Lesson 5.2 — Intent: Maria answers a question and approves            (video: ~7 min)

**Role:** Oleg with Claude Code (writes), Maria (decides)   **Project:** tasklet
**You need:** lesson 5.1; B1 ready in the backlog (Module 4)

**Goal.** Turn B1 into an approved `intent.md`. Maria answers the open question and approves in her own terminal.

### Steps

1. Oleg starts the item and asks the agent to complete the intent:

   > Start B1 as add-due-dates, then run /sdlc:intent add-due-dates.

   The agent runs `sdlc backlog start B1 --change add-due-dates` (lesson 4.4), then `/sdlc:intent`. It reads the
   draft built from the backlog item, asks Oleg about scope and users one or two questions at a time, and rewrites
   `intent.md`: problem, proposed outcome, affected users, constraints, success measures, out of scope. It records
   what it could not decide under `## Open questions`:

   ```markdown
   ## Open questions
   1. Is a due date a date only (2026-10-20) or a date and time?
   ```

   It stops at the gate and gives Maria two commands: the answer and the approval.

2. Show what the agent may not do. It may not answer the question for Maria; the CLI refuses (and the hook denies
   the call in Claude Code):

   ```text
   error: `sdlc answer` records a human decision and cannot run inside an agent session (claude-code).
   fix: Run it yourself in your own terminal, not in the agent chat (a `!` command there runs in the agent's shell):
   sdlc answer 1 --change add-due-dates --text "A date only"
   ```

   It may not approve either:

   ```text
   error: `sdlc approve` records a human decision and cannot run inside an agent session (claude-code).
   ```

3. Telegram receives `gate.intent.awaiting` with `waitingFor: ["maria"]`. Maria opens **her own terminal** and
   previews the gate:

   ```bash
   sdlc approve intent --change add-due-dates --preview
   ```

   ```text
   Approval preview: gate intent of change add-due-dates (pending)
   Artifacts:
     intent  intent.md
   Changed since the last approval: nothing
   Approvals: 0 of 1
   You may not approve it now:
     - The intent gate cannot be approved yet: 1 open question(s) in intent.md have no recorded answer.
   ```

4. She lists the questions and answers the first one:

   ```bash
   sdlc answer --change add-due-dates --list
   ```

   ```text
   [ ] intent 1. Is a due date a date only (2026-10-20) or a date and time?
   ```

   ```bash
   sdlc answer 1 --change add-due-dates --text "A date only, for example 2026-10-20. A time can come later."
   ```

   ```text
   Answer to question 1 of intent.md recorded by Maria <maria@northwind.example>.
   ```

   sdlc writes the answer under the question in `intent.md` and records it, with the exact question text, in the
   change record:

   ```markdown
   1. Is a due date a date only (2026-10-20) or a date and time?
     - Answer (Maria, 2026-10-09): A date only, for example 2026-10-20. A time can come later.
   ```

5. Now the gate is hers to take:

   ```bash
   sdlc next --me
   ```

   ```text
   Waiting for you (1):
     add-due-dates, gate intent: sdlc approve intent --change add-due-dates --as product-owner
   ```

   ```bash
   sdlc approve intent --change add-due-dates
   ```

   ```text
   ✓ intent gate: Maria <maria@northwind.example> approved as product-owner (1d2438bcf31f)
   Suggested commit message (its trailer ties the commit to this approval):
     $ git commit -m "chore(add-due-dates): approve the intent gate" -m "SDLC-Approval: add-due-dates:intent:1d2438bcf31f"
   Next: agent — Write proposal (proposal.md) for the spec gate. (/sdlc:spec)
   ```

   She commits with the suggested message (signed, lesson 3.3) and pushes. Telegram receives
   `gate.intent.approved` by `maria`.

6. Gate card:

   | Gate | Who | Command | Telegram | `sdlc next` after |
   |---|---|---|---|---|
   | intent | Maria | `sdlc answer 1 …`, `sdlc approve intent --change add-due-dates` | `gate.intent.awaiting` → `gate.intent.approved` | agent: write proposal (`/sdlc:spec`) |

### Check yourself

- `sdlc status --change add-due-dates` shows `intent ✓ approved  Maria <maria@northwind.example> as product-owner`.
- `sdlc answer --change add-due-dates --list` shows the question as answered.
- `git log -1` in Maria's clone shows the `SDLC-Approval` trailer.

### Pitfalls

- While a question is unanswered, `sdlc next --me` tells Maria "Nothing is waiting for you.", and `sdlc next` asks
  for an approval that would fail. Run `sdlc answer --change <id> --list` when the agent says the intent is ready.
- An answer typed into `intent.md` by hand, or by the agent, does not count. Only `sdlc answer` records it.
- Editing `intent.md` after the approval makes it stale; Maria approves again. Every change to `intent.md` before the
  approval starts a new wait too, including the answer sdlc writes into it: the trial sent `gate.intent.awaiting`
  twice.
- Denials: `sdlc guide denials#separation-of-duties`.

### On screen (for the video)

- Claude Code writing the intent; zoom on `## Open questions`.
- Maria's terminal: preview (refused), answer, preview again (allowed), approve.
- The Telegram chat: "Maria, add-due-dates waits for your intent approval", then "approved".

---

## Lesson 5.3 — Spec: requirements and design, Maria approves            (video: ~7 min)

**Role:** Oleg with Claude Code; Maria (decides); Ivan (for high-risk changes)   **Project:** tasklet
**You need:** lesson 5.2

**Goal.** The agent writes the proposal, the delta specs and the design; `sdlc validate` passes; Maria approves the
spec gate.

### Steps

1. Oleg runs the next step:

   > /sdlc:spec add-due-dates

   The agent checks that the intent gate is approved, loads REVIEW.md and the project rules, and writes three
   artifacts in order. Broad code searches go to the `sdlc-researcher` subagent; the stage's resources name the
   team's `sdlc-analyst` and `sdlc-architect` (Module 3):

   | File | Content in this change |
   |---|---|
   | `proposal.md` | why; what changes (an optional `dueDate`, the overdue filter); the capability `tasks`; how intent question 1 was answered |
   | `specs/tasks/spec.md` | `## ADDED Requirements`: "Due date on a task" (two scenarios), "Overdue tasks" (one scenario) |
   | `design.md` | decisions (store `YYYY-MM-DD`; "today" is the UTC date), areas of concern, risks, rollback |

   A scenario looks like this:

   ```markdown
   #### Scenario: Invalid due date
   - **WHEN** a client creates a task with `dueDate` `2026-13-45`
   - **THEN** the request is refused with status 400
   ```

2. The agent validates:

   ```bash
   sdlc validate --change add-due-dates
   ```

   ```text
   ✓ add-due-dates
   ```

   `sdlc validate` runs `openspec validate --strict` and sdlc's own delta checks, and warns about other active
   changes that touch the same requirements.

3. The agent stops at the gate. `sdlc next` shows:

   ```text
   add-due-dates: Design (requirements + design spec)
   person: Maria (product-owner) must review and approve the spec gate (proposal, specs, design).
   $ sdlc approve spec --change add-due-dates --as product-owner
   ```

4. Maria reads the three files and previews:

   ```bash
   sdlc approve spec --change add-due-dates --preview
   ```

   ```text
   Approval preview: gate spec of change add-due-dates (pending)
   Artifacts:
     proposal  proposal.md
     specs  specs/tasks/spec.md
     design  design.md
   Changed since the last approval: nothing
   Approvals: 0 of 1
   You may approve it:
   $ sdlc approve spec --change add-due-dates
   ```

   ```bash
   sdlc approve spec --change add-due-dates
   ```

   ```text
   ✓ spec gate: Maria <maria@northwind.example> approved as product-owner (254381749a18)
   Next: agent — Write plan (plan.md) for the plan gate. (/sdlc:plan)
   ```

   (Shortened: the suggested commit lines are left out from here on.)

5. Explain the high-risk case. This change is `risk: medium`. For a `risk: high` change, the spec gate also needs
   the tech lead, as a second approval:

   ```bash
   sdlc approve spec --change <id> --as tech-lead      # Ivan, in his own terminal
   ```

   The gate stays pending until both Maria and Ivan have approved.

6. Gate card:

   | Gate | Who | Command | Telegram | `sdlc next` after |
   |---|---|---|---|---|
   | spec | Maria (+ Ivan if high risk) | `sdlc approve spec --change add-due-dates` | `gate.spec.awaiting` → `gate.spec.approved` | agent: write plan (`/sdlc:plan`) |

### Check yourself

- `sdlc validate --change add-due-dates` prints a check mark.
- `sdlc status --change add-due-dates` shows `spec ✓ approved`.
- `openspec/specs/` is still empty: the delta specs merge only at archive (lesson 5.10).

### Pitfalls

- Open questions in `proposal.md` or `design.md` block the spec gate the same way:
  `sdlc answer <n> --change <id> --artifact proposal|design --text "…"`.
- With `design: { debate: true }`, the spec gate waits for the `## Debate` section and a person's decision in
  `design.md` (lesson 3.6).
- The agent writes no code at this stage. If it tries, the plan gate denies it (lesson 5.4).

### On screen (for the video)

- The three artifacts in the editor, one after the other; highlight the WHEN/THEN lines.
- `sdlc validate` passing, then Maria's preview and approval.

---

## Lesson 5.4 — Plan: the plan gate holds the code back            (video: ~6 min)

**Role:** Oleg with Claude Code; Ivan (reads the plan)   **Project:** tasklet   **You need:** lesson 5.3

**Goal.** The agent writes `plan.md` and `tasks.md`. Until an engineer approves the plan, the hook stops every code
edit, including shell writes.

### Steps

1. Oleg runs:

   > /sdlc:plan add-due-dates

   The agent works read-only, asks Oleg what could break and which step is riskiest, then writes `plan.md`:

   ```markdown
   ## Files that change
   - src/tasks.js (new) — task store with `createTask`, `getTask`, `listTasks` and due-date validation
   - test/tasks.test.js (new) — one test per spec scenario

   ## Proof
   - test/tasks.test.js: "Task created with a due date", "Invalid due date", "Only overdue open tasks are listed".
   - `sdlc verify` (build, test, ci-green).
   ```

   The other sections are Order of work, Risks, Alternatives considered and Rollback. `tasks.md` holds three tasks:
   the failing tests, the implementation, and `sdlc verify`.

2. Show the plan gate. Oleg asks the agent to "start coding while Ivan reads". The agent tries to write
   `src/tasks.js` and the hook denies it (block mode; real reason):

   ```text
   [sdlc:plan-gate] No active change has an approved plan yet (add-due-dates). Finish the plan and have an engineer
   run `sdlc approve plan --change <id>` before editing src/tasks.js. Why, and what to do:
   `sdlc guide denials#plan-gate`.
   ```

   A shell write is checked the same way: `echo export {} > src/tasks.js` gets the same denial. Docs and `openspec/`
   are exempt.

3. Ivan checks what waits for him and previews the plan:

   ```bash
   sdlc next --me
   ```

   ```text
   Waiting for you (1):
     add-due-dates, gate plan: sdlc approve plan --change add-due-dates --as engineer
   ```

   ```bash
   sdlc approve plan --change add-due-dates --preview
   ```

   ```text
   Approval preview: gate plan of change add-due-dates (pending)
   Artifacts:
     plan  plan.md
     tasks  tasks.md
   Changed since the last approval: nothing
   Approvals: 0 of 1
   You may approve it:
   $ sdlc approve plan --change add-due-dates
   ```

4. Ivan reads the plan against the spec and finds a hole: there is no way to **remove** a due date once it is set.
   That is a missing requirement, not a planning detail. He does not approve. Lesson 5.5 continues from here.

5. Gate card (as it ends in lesson 5.5):

   | Gate | Who | Command | Telegram | `sdlc next` after |
   |---|---|---|---|---|
   | plan | Ivan (or Oleg) as engineer; + Ivan as tech-lead if high risk | `sdlc approve plan --change add-due-dates` | `gate.plan.awaiting` (`["ivan","oleg"]`) → `gate.plan.approved` | agent: implement (`/sdlc:build`) |

### Check yourself

- `sdlc status --change add-due-dates` shows `plan … pending  awaiting approval (engineer; 0 of 1)`.
- `src/` does not exist yet: the agent could not write it.
- `sdlc log` lists the `plan-gate` denial.

### Pitfalls

- In `warn` mode the plan gate only reminds the agent once per session; in `block` mode it denies. `tasklet` uses
  `block`.
- Ticking checkboxes in `tasks.md` later does not make the plan stale; changing a task's text does.
- If the plan shows that the spec is wrong, do not plan around it: send the spec back (lesson 5.5).

### On screen (for the video)

- `plan.md` in the editor; highlight "Files that change" and "Proof".
- The denied write in Claude Code: highlight `[sdlc:plan-gate]` and the `sdlc guide` pointer.

---

## Lesson 5.5 — Rework: Ivan sends the spec back            (video: ~7 min)

**Role:** Ivan (sends back), Oleg with Claude Code (revises), Maria (approves again)   **Project:** tasklet
**You need:** lesson 5.4

**Goal.** Send an approved gate back with a reason, let the agent fix it, approve it again, and approve the plan.

### Steps

1. Ivan sends the change back to the spec stage, in his own terminal. The reason is a category; the note says what
   has to change:

   ```bash
   sdlc rework spec --change add-due-dates --reason missing-requirement \
     --note "No way to clear a due date: PATCH /tasks/:id with dueDate null"
   ```

   ```text
   ↺ spec gate sent back by Ivan <ivan@northwind.example> (missing-requirement): No way to clear a due date: PATCH /tasks/:id with dueDate null
   Next: agent — The spec gate was sent back by Ivan <ivan@northwind.example> (missing-requirement): No way to clear a due date: PATCH /tasks/:id with dueDate null. Revise the proposal, specs, design artifact(s), then ask for approval again. (/sdlc:spec)
   ```

   Ivan may do this because he holds `tech-lead`, which the spec gate accepts. The reasons come from
   `rework.reasons`: missing-requirement, wrong-assumption, design-flaw, implementation-bug, test-gap, scope-change,
   other. `sdlc audit` counts them.

2. Show the state. The spec approval no longer counts, and every later gate waits:

   ```bash
   sdlc status --change add-due-dates
   ```

   ```text
   add-due-dates  [feature · risk medium · full track · schema sdlc]
     stage     Design (requirements + design spec)
     source    backlog B1
     artifacts intent ✓  proposal ✓  specs ✓  design ✓  plan ✓  tasks ✓
     intent ✓ ─ spec ● ─ plan ○ ─ build ○ ─ verify ○ ─ review ○ ─ release ○ ─ archive ○
     tasks     ░░░░░░░░░░  0/3
     gates
       intent   ✓ approved           Maria <maria@northwind.example> as product-owner
       spec     ✗ rejected           sent back by Ivan <ivan@northwind.example> (missing-requirement): No way to clear a due date: PATCH /tasks/:id with dueDate null
       plan     · blocked            waiting on the spec gate
       ...
   ```

   `sdlc explain --change add-due-dates` says the same in words and lists what unblocks it:

   ```text
   What unblocks it:
     1. agent: The spec gate was sent back by Ivan ... Revise the proposal, specs, design artifact(s), then ask for approval again.
     2. person: Then a person reviews and approves the spec gate.
        $ sdlc approve spec --change add-due-dates
   ```

   Telegram receives `gate.spec.rework` by `ivan` (without the note).

3. Oleg runs `/sdlc:next`. The agent reads the reason and the note from `sdlc next`, adds the requirement and its
   scenario to `specs/tasks/spec.md`, adds one line to `proposal.md`, and validates:

   ```markdown
   ### Requirement: Clearing a due date
   A client SHALL be able to remove the due date of a task.

   #### Scenario: Due date cleared
   - **WHEN** a client updates a task with `dueDate` `null`
   - **THEN** reading the task returns no `dueDate`
   ```

   It then tells Oleg that the spec is ready for Maria and gives her command.

4. Maria previews. The preview lists exactly what changed since her first approval:

   ```bash
   sdlc approve spec --change add-due-dates --preview
   ```

   ```text
   Approval preview: gate spec of change add-due-dates (rejected)
   Artifacts:
     proposal  proposal.md
     specs  specs/tasks/spec.md
     design  design.md
   Changed since the last approval: proposal.md, specs/tasks/spec.md
   Approvals: 0 of 1
   You may approve it:
   $ sdlc approve spec --change add-due-dates
   ```

   ```bash
   sdlc approve spec --change add-due-dates
   ```

   ```text
   ✓ spec gate: Maria <maria@northwind.example> approved as product-owner (5bbfb701caa0)
   Next: person — Ivan or Oleg (engineer) must review and approve the plan gate (plan, tasks): sdlc approve plan --change add-due-dates --as engineer
   ```

5. The agent adds the new scenario to the plan's Proof and to task 1.1. Ivan approves the plan:

   ```bash
   sdlc approve plan --change add-due-dates
   ```

   ```text
   ✓ plan gate: Ivan <ivan@northwind.example> approved as engineer (77c0c941f5d1)
   Next: agent — Implement the approved plan: 3 of 3 task(s) remain. (/sdlc:build)
   ```

6. Explain checkpoints. Each approval records a snapshot of the working tree as a git ref; branches and HEAD do not
   move:

   ```bash
   git for-each-ref refs/sdlc --format="%(refname)"
   ```

   ```text
   refs/sdlc/add-due-dates/intent
   refs/sdlc/add-due-dates/plan
   refs/sdlc/add-due-dates/spec
   ```

   `sdlc rework <gate> … --reset` restores from that checkpoint the files listed under "Files that change" in
   `plan.md` and the change folder. It refuses when those files have uncommitted edits.

### Check yourself

- `sdlc status` shows `spec ✓ approved` and `plan ✓ approved`.
- `sdlc audit --change add-due-dates` lists `reworks 1: spec (missing-requirement, …)`.
- Telegram shows `gate.spec.rework`, then `gate.spec.approved`, then `gate.plan.approved`.

### Pitfalls

- After the agent has revised the spec, `sdlc next` still says "agent: … Revise …", Maria's `sdlc next --me` says
  "Nothing is waiting for you.", and Telegram sends no new `gate.spec.awaiting`. The agent must tell Maria that the
  spec is ready; she checks with `--preview`.
- Approving again with nothing changed since the approval before the rework needs `--note` (why nothing had to
  change).
- After `rework.max_cycles` reworks of one gate (default 3), `sdlc next` asks a person to take the change over or
  review its scope instead of another agent round.
- A rework is a person's command; the agent proposes it and gives the command (`denials#separation-of-duties`).
  `sdlc takeover --change <id> --note "…"` is the stronger tool: the agent may not edit the change until the person
  runs `sdlc release-control`.

### On screen (for the video)

- Ivan's terminal: the rework command; then the status with the red `✗ rejected` line.
- The new requirement appearing in `spec.md`.
- Maria's preview: highlight "Changed since the last approval".

---

## Lesson 5.6 — Build: Oleg and Claude Code under the hooks            (video: ~7 min)

**Role:** Oleg with Claude Code   **Project:** tasklet   **You need:** lesson 5.5 (plan approved)

**Goal.** Implement the approved plan task by task, with commits that `sdlc trace` can follow, while the hooks keep
the agent inside the rules.

### Steps

1. Oleg starts a new Claude Code session. The session-start hook gives the agent the state of the project (real
   context, shortened):

   ```text
   - add-due-dates: stage build; next (agent): Implement the approved plan: 3 of 3 task(s) remain.
   Enforcement mode is block. Gate approvals are made by people with `sdlc approve`, never by the agent.
   ```

2. He runs:

   > /sdlc:build add-due-dates

   The agent checks that the plan gate is approved, loads the artifacts from disk and copies the tasks into its todo
   list (`tasks.md` stays the source of truth). It runs `sdlc verify --list` to learn the checks:

   ```text
   build      npm run build
   lint       npm run lint
   test       npm test
   ```

3. It works the tasks in order: writes the four failing tests first, runs them, implements `src/tasks.js` until they
   pass, and ticks `- [x]` only when a task's check passed. The write to `src/tasks.js` is now allowed: the hook
   answers nothing, which means "allow".

4. Show a hard rule. To "make a test pass quickly", the agent writes a GitHub token into a config file. The hook
   denies the edit, in any mode (real reason, wrapped):

   ```text
   [sdlc:secret-in-edit] Secret in src/config.js: GitHub token, password or token assigned in the code. Do not
   write keys, tokens or passwords into the project; use an environment variable or a secret store reference
   instead. A person can exempt test data in enforcement.secret_allow (openspec/sdlc.yaml). Why, and what to do:
   `sdlc guide denials#secret-in-edit`.
   ```

5. Show the commit. The agent ends each commit message with the task trailers; sdlc's `prepare-commit-msg` git hook
   adds the agent marker:

   ```text
   feat(tasks): due dates and the overdue filter

   SDLC-Change: add-due-dates

   SDLC-Task: 1.2
   SDLC-Agent: claude-code
   ```

   `SDLC-Change` and `SDLC-Task` link the commit to task 1.2 in `sdlc trace`; `SDLC-Agent` lets the audit count the
   agents' share of the commits.

6. When every implementation task is ticked, the agent continues with `/sdlc:verify` (lesson 5.7).

7. Mention the bug-fix protocol, which `add-due-dates` does not need. For `kind: bugfix`, the first task writes a test
   that reproduces the bug; after it fails for the right reason and is committed, the agent runs
   `sdlc tests lock --change <id>`. From then on the hook denies edits to test files (`denials#tests-locked`); only a
   person can run `sdlc tests unlock`.

### Check yourself

- `sdlc status --change add-due-dates` shows the task bar filling up (`2/3` before verify).
- `git log` shows `SDLC-Change: add-due-dates` and `SDLC-Task:` trailers.
- No file outside the plan's "Files that change" was edited (lesson 5.8 checks this as plan drift).

### Pitfalls

- When the work departs from `plan.md`, the agent updates `plan.md` in the same commit. A changed task text makes
  the plan stale and Ivan approves again.
- Protected paths (`enforcement.protected_paths`) are denied in any mode (`denials#protected-path`).
- If Oleg wants to fix something delicate by hand, he runs `sdlc takeover --change add-due-dates --note "…"` in his
  terminal. The hook then denies the agent's edits in the plan's files until `sdlc release-control`.

### On screen (for the video)

- Claude Code's todo list next to `tasks.md`; tick marks appear in both.
- The secret denial: highlight that the reason names the kind and the file, never the value.
- `git log -1` with the three trailers.

---

## Lesson 5.7 — Verify: evidence, CI and Anna's check            (video: ~8 min)

**Role:** Oleg with Claude Code; Anna (QA)   **Project:** tasklet   **You need:** lesson 5.6

**Goal.** Record literal evidence of every check, including the CI status from GitHub Actions, get an independent
behavioural verification, and let Anna confirm that every scenario was exercised.

### Steps

1. Show the configuration Sergey wrote in lesson 2.4. Besides the commands, the verify gate asks the `github` server
   about the CI run of the head commit. The CLI calls the tool itself, so the agent cannot fake the answer:

   ```yaml
   verify:
     commands:
       - { name: build, run: npm run build }
       - { name: lint,  run: npm run lint }
       - { name: test,  run: npm test }
     mcp:
       - name: ci-green
         server: github
         tool: list_workflow_runs     # the tool name your server exposes
         args: { owner: northwind-labs, repo: tasklet, workflow_id: ci.yml, head_sha: "${HEAD}", per_page: 1 }
         expect:
           workflow_runs:
             - { status: completed, conclusion: success }
   ```

   `${HEAD}` becomes the head commit and `${CHANGE}` the change id; the answer must contain `expect`.

2. Oleg runs:

   > /sdlc:verify add-due-dates

   The agent runs the checks:

   ```bash
   sdlc verify --change add-due-dates
   ```

   ```text
   running build: npm run build
   running lint: npm run lint
   running test: npm test
   → ci-green: github/list_workflow_runs (MCP)
   ✓ build (0.7s)
   ✓ lint (0.7s)
   ✓ test (0.9s)
   ✓ ci-green (github/list_workflow_runs, 0.5s)
   Verification passed - evidence recorded in openspec\changes\add-due-dates\verification.md
   ```

   `verification.md` now starts with the evidence block (shortened, from the last run of the change):

   ```markdown
   - **Result**: PASSED (4/4 required checks)
   - **Commit**: 1c25d68a3d60 + uncommitted changes

   | Check | Command | Result | Duration |
   |---|---|---|---|
   | build | `npm run build` | ✅ exit 0 | 0.7s |
   | lint | `npm run lint` | ✅ exit 0 | 0.7s |
   | test | `npm test` | ✅ exit 0 | 0.9s |
   | ci-green | `mcp github/list_workflow_runs` | ✅ ok | 0.5s |
   ```

   Below it come the literal last lines of each command and, in a collapsed block, the server's answer. The trial's
   stand-in server answered:

   ```json
   { "total_count": 1,
     "workflow_runs": [ { "id": 101, "name": "ci.yml", "head_sha": "1c25d68a3d605af6330ef7f1c16e28a6ca2eb3bb",
                          "status": "completed", "conclusion": "success" } ] }
   ```

   The result is bound to a fingerprint of the working tree: committing keeps it fresh, changing code makes it
   stale.

3. The agent delegates the behavioural check to the `sdlc-tester` subagent (the team's tester, Module 3). In a fresh
   context it runs the tests and exercises every spec scenario, then reports. The agent writes one row per scenario
   under `## Behavioral verification`, and `## Not run / limits`:

   ```markdown
   | Scenario / proof item | What was run | What was seen | Result |
   |---|---|---|---|
   | Task created with a due date | createTask with dueDate 2026-10-20, then getTask | dueDate 2026-10-20 | PASS |
   | Invalid due date | createTask with 2026-13-45 and 2026-02-30 | status 400 for both | PASS |
   | Only overdue open tasks are listed | three tasks, today 2026-10-10, overdue filter | only "late" | PASS |
   | Due date cleared | updateTask with dueDate null | no dueDate | PASS |
   ```

4. Anna checks the coverage. Before the table was written, the check reported:

   ```bash
   sdlc verify --check --change add-due-dates
   ```

   ```text
   ! 4 of 4 scenario(s) have no behavioral verification row:
     - Task created with a due date
     - Invalid due date
     - Only overdue open tasks are listed
     - Due date cleared
   ```

   After it, with `--strict` (exit 1 when a scenario is uncovered):

   ```bash
   sdlc verify --check --strict --change add-due-dates
   ```

   ```text
   ✓ every spec scenario (4) has a row under "Behavioral verification".
   ```

   Anna reads every row and the "Not run / limits" section. A row that says PASS for a case that was not run is a
   defect of the verification: she asks Oleg's agent to fix the gap, not to change the test.

5. Anna runs the checks once herself, in her own terminal. Outside an agent session, the MCP results also go to the
   inbox, so the agent learns about them at its next session start:

   ```bash
   sdlc verify --change add-due-dates
   ```

   ```bash
   sdlc inbox list
   ```

   ```text
   20261009T210255997Z-ci-green-43c30a  add-due-dates  ci-green (github/list_workflow_runs)  ok
   ```

   The agent marks an item read with `sdlc inbox done <id>` after it has acted on it.

6. Gate card:

   | Gate | Who | Command | Telegram | `sdlc next` after |
   |---|---|---|---|---|
   | verify | nobody: the required checks; Anna reviews the evidence | `sdlc verify` (agent or person) | nothing when it passes; `verify.failed` when it fails | agent: run the review (`/sdlc:review`) |

### Check yourself

- `sdlc status --change add-due-dates` shows `verify ✓ passed`.
- `verification.md` has the evidence block, four PASS rows and a "Not run / limits" section.
- `sdlc verify --check --strict --change add-due-dates` exits 0.

### Pitfalls

- The verify gate passes on the automated checks alone. The behavioural table is checked only by
  `sdlc verify --check`, which is not part of the gate. Anna (or CI) runs it with `--strict`.
- `${HEAD}` is the head commit. If the agent verifies uncommitted work, CI answers for an older commit. Commit, push,
  let CI finish, then run `sdlc verify`.
- `sdlc verify --list` shows only the commands, not the `verify.mcp` checks.
- `sdlc verify --only <names>` runs some checks for a quick look but never passes the gate.
- Editing the evidence block by hand changes nothing: the gate reads the result that `sdlc verify` stored in the
  change record (`.sdlc.yaml`, which only the CLI writes), and the next run rewrites the block.

### On screen (for the video)

- `sdlc verify` running, then `verification.md` with the evidence block; zoom on the `ci-green` row and the server's
  answer.
- Anna's terminal: `--check` (warning) and `--check --strict` (passing).

---

## Lesson 5.8 — Review: findings, a rejection and Pavel's approval            (video: ~8 min)

**Role:** Oleg with Claude Code; Pavel (code owner)   **Project:** tasklet   **You need:** lesson 5.7

**Goal.** The agent reviews the change in independent passes and fixes what matters. Pavel rejects once, the agent
addresses his note, and Pavel approves.

### Steps

1. Oleg runs:

   > /sdlc:review add-due-dates

   The agent gathers the context:

   ```bash
   sdlc review context --change add-due-dates
   ```

   ```text
   Review context for add-due-dates (base main)
     changed files: 2
     plan drift: 0 unplanned, 0 planned but untouched
     policy: REVIEW.md
     diff: git diff main...HEAD && git diff HEAD
   ```

2. It delegates each pass (bugs, security, compliance) and each lens (adversarial, edge-cases, verification-gaps) to
   the `sdlc-reviewer` subagent, in a fresh context each time, and writes `review.md`:

   ```markdown
   ### F1 [important][bugs] Updating an unknown task crashes
   - **Where**: src/tasks.js:29
   - **Detail**: `updateTask(99, { dueDate: null })` throws a TypeError instead of a 404-style error.
   - **Fix**: return a not-found error when the id is unknown; add a test.
   - **Status**: open

   ### F2 [nit][edge-cases] Overdue is computed in UTC
   ...
   - **Status**: deferred (D2)

   ## Coverage
   - bugs: 1 finding
   - security: none found — checked: input validation of dueDate, no secrets, no new dependencies
   ...
   ```

   For F2, Oleg chose "defer" when the agent asked. The agent recorded it:

   ```bash
   sdlc defer add "Overdue in the user's time zone" --why "First version is UTC only" \
     --change add-due-dates --finding F2
   ```

   ```text
   D2 Overdue in the user's time zone
   ```

3. The review check blocks on the open important finding:

   ```bash
   sdlc review check --change add-due-dates
   ```

   ```text
   2 finding(s), 1 open; blocking open: 1
     ✗ F1 [important][bugs] Updating an unknown task crashes (src/tasks.js:29)
   ```

4. The agent fixes F1 with a test, sets its status to `fixed (…)`, and notices that the evidence is now stale:

   ```text
       verify   ↻ stale              code changed since the last passing `sdlc verify`
   ```

   It runs `sdlc verify` again, then the check passes:

   ```text
   2 finding(s), 0 open; blocking open: 0
   ```

5. The agent stops at the gate and names the reviewer:

   ```bash
   sdlc review suggest --change add-due-dates
   ```

   ```text
   Pavel (pavel) - suggested: owns 0 of 2 changed files, open reviews: 0
   ```

   Telegram receives `gate.review.awaiting` with `waitingFor: ["pavel"]`.

6. Pavel previews in his own terminal:

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
   Verification: passed 2026-10-09T21:03:10.898Z, matches the current code
   You may approve it:
   $ sdlc approve review --change add-due-dates
   ```

7. Pavel reads the diff and `review.md`. The code is fine, but the README says nothing about due dates. He rejects
   with a note:

   ```bash
   sdlc reject review --change add-due-dates --note "README has no word about due dates. Document dueDate and the overdue filter."
   ```

   ```text
   ✗ review gate rejected by Pavel <pavel@northwind.example>: README has no word about due dates. Document dueDate and the overdue filter.
   Next: person — Pavel (code-owner) must read review.md and the diff, then approve the review gate: sdlc approve review --change add-due-dates
   ```

   `sdlc status` shows the note on the review line:

   ```text
       review   ✗ rejected           rejected by Pavel <pavel@northwind.example>: README has no word about due dates. Document dueDate and the overdue filter.
   ```

8. Oleg tells the agent:

   > Pavel rejected the review of add-due-dates. Read the note in sdlc status and address it.

   The agent adds a "Due dates" section to `README.md`. The README is part of the code, so the evidence is stale again
   and the agent re-runs `sdlc verify`. Telegram receives a new `gate.review.awaiting`.

9. Show who may not approve. Oleg wrote the code; Ivan approved the plan:

   ```text
   error: Oleg does not hold code-owner; ask Pavel. Oleg authored code in this change.
   fix: Ask one of: Pavel.
   ```

   ```text
   error: Ivan does not hold code-owner; ask Pavel. Ivan already approved the paired gate plan/review.
   fix: Ask one of: Pavel.
   ```

10. Pavel approves:

    ```bash
    sdlc approve review --change add-due-dates
    ```

    ```text
    ✓ review gate: Pavel <pavel@northwind.example> approved as code-owner (bb6b43013e8f)
    ```

11. Gate card:

    | Gate | Who | Command | Telegram | `sdlc next` after |
    |---|---|---|---|---|
    | review | Pavel | `sdlc reject review … --note "…"`, later `sdlc approve review --change add-due-dates` | `gate.review.awaiting` → `gate.review.rejected` → `gate.review.awaiting` → `gate.review.approved` | agent: prepare `release.md` (`/sdlc:release`) |

### Check yourself

- `review.md` has a Coverage line for each of the six passes and lenses.
- `sdlc review check --change add-due-dates` exits 0; `sdlc defer list` shows D2 linked to F2.
- `sdlc status` shows `review ✓ approved  Pavel <pavel@northwind.example> as code-owner`.

### Pitfalls

- After `sdlc reject`, `sdlc next` still points at Pavel, not at the agent. Tell the agent to read the note, as in
  step 8. When the agent must clearly do more work, `sdlc rework review --reason … --note "…"` hands the change back
  with the reason in `sdlc next`.
- The `Next:` line printed by `sdlc approve review` in the trial still asked for a review approval. Run `sdlc next`
  after an approval to see the real next step (here: the agent prepares the release).
- A finding marked `deferred (D<n>)` must link to an open item in `openspec/deferred-work.md`, or the review check
  fails.
- Every code change after the verification makes the evidence stale, and the review gate waits for a new
  `sdlc verify`.

### On screen (for the video)

- `review.md` with F1 open, then fixed; the `review check` turning green.
- Pavel's rejection and the note on the status line; then the README diff.
- The two refused approvals side by side: author and paired gate.

---

## Lesson 5.9 — Release: Elena authorizes production            (video: ~7 min)

**Role:** Oleg with Claude Code; Elena (release manager)   **Project:** tasklet   **You need:** lesson 5.8

**Goal.** The agent prepares `release.md` and deploys to staging. Production waits for Elena's approval, and the
approval waits for the release checks in GitHub.

### Steps

1. Show the configuration from lesson 2.5. Northwind made the release gate required and added a release check: the
   staging deploy workflow (`release.yml`) must be green for the head commit. The production commands the agent may
   not run come from `release.commands` (regular expressions):

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
     commands:
       - \bdeploy\b.*\bprod(uction)?\b
   ```

2. Oleg runs:

   > /sdlc:release add-due-dates

   The agent puts the changelog into `release.md`:

   ```bash
   sdlc changelog --change add-due-dates
   ```

   ```text
   ### Added

   - Due date on a task (tasks, add-due-dates)
   - Overdue tasks (tasks, add-due-dates)
   - Clearing a due date (tasks, add-due-dates)
   ```

   It fills the other sections: rollout per environment (development, staging, production), monitoring signals and
   their bands, the exact rollback command and when it was rehearsed. It deploys to staging, which the agent is
   allowed to do, and records the result.

3. The agent runs the release checks before asking Elena. The command writes nothing:

   ```bash
   sdlc release check --change add-due-dates
   ```

   ```text
   ✓ staging-deploy-green (github/list_workflow_runs, 0.5s)
   Every required release check passed.
   ```

4. Show the release gate. Oleg asks the agent to deploy to production. The hook denies the command (real reason,
   wrapped):

   ```text
   [sdlc:release-gate] This looks like a production release (matched /\bdeploy\b.*\bprod(uction)?\b/). Production
   releases need a named release authorization: a release manager runs `sdlc approve release --change <id>` after
   reviewing release.md (or sets SDLC_RELEASE_APPROVAL for this session). The agent prepares the release; it does
   not authorize it. Why, and what to do: `sdlc guide denials#release-gate`.
   ```

5. Telegram receives `gate.release.awaiting` with `waitingFor: ["elena"]`. Elena opens her own terminal:

   ```bash
   sdlc next --me
   ```

   ```text
   Waiting for you (1):
     add-due-dates, gate release: sdlc approve release --change add-due-dates
   ```

   ```bash
   sdlc approve release --change add-due-dates --preview
   ```

   ```text
   Approval preview: gate release of change add-due-dates (pending)
   Artifacts:
     review  review.md
     release  release.md
   Changed since the last approval: nothing
   Approvals: 0 of 1
   Open blocking findings: 0
   Verification: passed 2026-10-09T21:03:29.540Z, matches the current code
   You may approve it:
   $ sdlc approve release --change add-due-dates
   ```

6. She reads `release.md`, especially the rollback, and approves. sdlc runs the release checks again at this moment;
   a failing required check refuses the approval (`release_checks_failed`):

   ```bash
   sdlc approve release --change add-due-dates
   ```

   ```text
   ✓ release gate: Elena <elena@northwind.example> approved as release-manager (cd6018fe3d9b)
   ```

   Now the same production command passes the hook. The agent deploys, records the outcome in `release.md` and
   watches the signals it listed.

7. Gate card:

   | Gate | Who | Command | Telegram | `sdlc next` after |
   |---|---|---|---|---|
   | release | Elena | `sdlc approve release --change add-due-dates` | `gate.release.awaiting` → `gate.release.approved` | agent: archive (`sdlc archive add-due-dates --yes`) |

### Check yourself

- `sdlc status --change add-due-dates` shows every gate approved and the stage `Done (ready to archive)`.
- `release.md` has the changelog, the rollout table, the bands and the rollback command.
- The production command was denied before Elena's approval and allowed after it.

### Pitfalls

- The `Next:` line printed by `sdlc approve release` in the trial pointed at the review gate. `sdlc next` right after
  it was correct: "All gates are satisfied: archive the change".
- The release approval is bound to the code. A code change after it makes it stale, and production is denied again.
- `release.commands` are patterns on the command text. A deploy script with another name is not caught; list it.
- `SDLC_RELEASE_APPROVAL` in the environment of the session also lets a release command through. It is a person's
  override for an emergency, not a gate decision: prefer the approval, which is recorded with the change.

### On screen (for the video)

- `release.md` in the editor; highlight the rollback row.
- The denied production deploy, Elena's approval, the same deploy passing.

---

## Lesson 5.10 — Archive: living specs, the backlog and the record            (video: ~6 min)

**Role:** Oleg with Claude Code; Olga watches   **Project:** tasklet   **You need:** lesson 5.9

**Goal.** Close the change: merge its delta specs into the living specs, mark the backlog item done, and read the
record the change leaves behind.

### Steps

1. `sdlc next` says what remains:

   ```text
   add-due-dates: Done (ready to archive)
   agent: All gates are satisfied: archive the change to merge its delta specs into openspec/specs/.
   $ sdlc archive add-due-dates --yes
   ```

2. Oleg runs:

   > /sdlc:archive add-due-dates

   The agent checks every gate again and archives:

   ```bash
   sdlc archive add-due-dates --yes
   ```

   ```text
   ✓ archived add-due-dates → openspec\changes\archive\2026-10-09-add-due-dates
     specs: +3 added, ~0 modified, -0 removed, 0 renamed
   Next: agent — Start backlog item B3: Export tasks as CSV. (sdlc backlog start B3)
   ```

   The three requirements are now in `openspec/specs/tasks/spec.md`. The change folder, with every artifact, the
   evidence and the approvals, moved to `openspec/changes/archive/2026-10-09-add-due-dates/`. Telegram receives
   `change.archived`.

3. The agent closes the loop, as proposals for Oleg: a CLAUDE.md rule for a mistake that happened twice, follow-up
   intents for deferred work (D2), and here, a comment on the GitHub issue `northwind/tasklet#12` through the `github`
   server (lesson 4.3).

4. The backlog item is done, and the next one is proposed:

   ```bash
   sdlc backlog list --epic E1
   ```

   ```text
   E1 Task planning  ███░░░░░░░  1/3
   ID  Status   Ready  Title                         Change
   B1  done     -      Add due dates to tasks        add-due-dates
   B3  open     ✓      Export tasks as CSV           -
   B2  open     -      Reminders for overdue tasks   -
   B4  dropped  -      Dark mode for the web client  -
   ```

5. Read the trace of the change:

   ```bash
   sdlc trace add-due-dates
   ```

   ```text
   Trace: add-due-dates (archived)
   Intent: Add due dates to tasks
   Requirement: Due date on a task (specs/tasks/spec.md)
     Scenario: Task created with a due date — evidence: PASS
     Scenario: Invalid due date — evidence: PASS
   Requirement: Overdue tasks (specs/tasks/spec.md)
     Scenario: Only overdue open tasks are listed — evidence: PASS
   Requirement: Clearing a due date (specs/tasks/spec.md)
     Scenario: Due date cleared — evidence: PASS
   Tasks:
     1.1 [x] Failing tests for the four scenarios in test/tasks.test.js — no commit
     1.2 [x] Implement src/tasks.js until the tests pass — commits: 0bedd0f
     2.1 [x] Run sdlc verify and confirm every required check passes — no commit
   Review findings:
     F1 fixed — Updating an unknown task crashes
     F2 accepted — Overdue is computed in UTC
   Gaps (2):
     task without a commit: 1.1
     task without a commit: 2.1
   ```

   The gaps are honest: the tests of task 1.1 went into the same commit as task 1.2, and task 2.1 has no code. A gap
   is a question for the reviewer, not a failure.

6. Check the approvals. The commit with the archive move must be committed first:

   ```bash
   sdlc approvals verify --mode warn
   ```

   ```text
   ✗ add-due-dates/intent maria unsigned eb59275b
   ✗ add-due-dates/spec maria unsigned 927d1e4b
   ✗ add-due-dates/plan ivan unsigned b8d37b6b
   ✗ add-due-dates/review pavel unsigned f49dc3f9
   ✗ add-due-dates/release elena unsigned 305f15e4
   ✗ openspec/roles.yaml sergey@northwind.example unsigned e17e6b14
   5 approvals checked, 6 invalid (warn: not blocking)
   ```

   Nobody signed commits in the trial; with the setup of lesson 3.3 each line says `valid`. Olga reads the full
   history of the change with `sdlc audit --change add-due-dates` (Module 9).

### Check yourself

- `openspec/specs/tasks/spec.md` exists with three requirements.
- `sdlc status` no longer lists `add-due-dates`; `sdlc status --archived` does.
- `sdlc next` proposes B3.

### Pitfalls

- `sdlc archive` refuses while a required gate is not satisfied. `--force` is a person's command and needs `--note`;
  `sdlc health` counts forced archives.
- `--skip-specs` archives without touching the living specs; use it only for tooling or docs changes.
- The trace shows a deferred finding as `accepted`; `review.md` and `sdlc defer list` show `deferred (D2)`.
- Commit the archive move before running `sdlc approvals verify`; until then every approval shows `not-committed`.

### On screen (for the video)

- The change folder moving to `archive/` in the file tree; `openspec/specs/tasks/spec.md` appearing.
- The trace; highlight the evidence per scenario and the two gaps.
- End card: the Telegram chat with the whole sequence from lesson 5.1, now complete.

---

## Gaps found

Things Modules 3 to 5 needed that sdlc 0.14.4 does not do, or does in a confusing way. One item each; all were
seen in the trial run unless the item says otherwise.

- No built-in GitHub Issues sync: the agent reads issues through the `github` MCP server and runs
  `sdlc backlog add`; nothing keeps the two lists in step.
- `sdlc backlog add` does not detect an item with the same `--source-ref` (a second item for
  `northwind/tasklet#12` was added as B8).
- `sdlc backlog add` has no `--source-url` (only `sdlc new` has one), so an issue link is kept as a ref string.
- Archiving a change marks its backlog item done but does not close or comment on the linked GitHub issue.
- Running `sdlc import bmad --to-backlog` twice adds a second epic with the same items; there is no repeat check.
- `sdlc import bmad` with a path outside the project says "No BMAD artifacts found." instead of naming the path
  problem.
- `sdlc import bmad --dry-run` prints JSON even without `--json`.
- `sdlc next --me` stays empty while a gate waits only for that person's `sdlc answer`; it does not list the open
  questions.
- `sdlc next` asks for `sdlc approve intent` while an open question makes that approval fail.
- The `Next:` line after `sdlc backlog start` asks the product owner to approve the draft intent before
  `/sdlc:intent` has completed it.
- After a rework, once the agent has revised the artifacts, `sdlc next` still says "agent: revise", `next --me` is
  empty for the approver, and no `gate.<gate>.awaiting` event is sent.
- After `sdlc reject review`, `sdlc next` names the reviewer again instead of handing the change to the agent with
  the note.
- The `Next:` line printed by `sdlc approve review` (when it completes the gate) and by `sdlc approve release`
  names the review gate again; `sdlc next` right after is correct.
- With `min_approvals: 2`, the `Next:` hint lists people who already approved and reads "A or B" though two
  approvals are needed (seen in a first trial with two review roles).
- `min_approvals` cannot require one approval per role (for example code owner and QA) outside
  `high_risk_approvers`.
- `sdlc roles who spec` lists the tech lead for a medium-risk spec, though only a product-owner approval satisfies
  the gate.
- The `missing_role` hint ("ask Pavel, Ivan, …") can name people whom `distinct_approvers` excludes (seen in the
  first trial).
- The `state-integrity` denial for an agent's edit of `openspec/roles.yaml` names `.sdlc.yaml` and the log, not
  `roles.yaml`.
- `sdlc team accept`, `sdlc backlog move` and `sdlc backlog drop` check that the caller is a person, not that the
  person holds a role in `roles.yaml`.
- `sdlc team list` does not show that a newer registry draft waits next to an accepted role.
- No workflow calls the `sdlc-simplifier` subagent unless `stages.build.agents` lists it.
- The verify gate passes without the behavioural table; only `sdlc verify --check --strict` checks it, outside the
  gate.
- QA has no gate of its own: Anna's acceptance of the evidence is not recorded by sdlc.
- `sdlc verify --list` does not list the `verify.mcp` checks.
- `${HEAD}` in `verify.mcp` is the head commit even when the evidence covers uncommitted changes.
- Events carry a structured `event` object, not a message; a Telegram server that only takes text needs an adapter
  tool, and sdlc has no message template.
- Events never include the rework or rejection note, so the chat cannot say why a gate went back.
- A server used only as an event receiver (`telegram`) is still laid out into the agents' MCP configuration, and a
  server without `stages` is not governed by the stage rule; there is no "CLI only" server.
- `sdlc trace` shows a finding with status `deferred (D<n>)` as `accepted`.
- The first `roles.yaml` commit that adds the maintainers' signing keys shows `bad-signature` (the previous version
  has no keys); there is no documented bootstrap step.
- Until the archive move is committed, `sdlc approvals verify` reports every approval of that change as
  `not-committed`.

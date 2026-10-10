# Module 4. Backlog and planning

This module is about planned work before it becomes a change. It is for **Megan**, the product owner, who plans the
`tasklet` backlog with Claude Code and decides the order. Oliver and Ethan watch the first two lessons to see where
their changes come from.

In this module:

- Lesson 4.1 — The backlog: epics, items and when an item is ready
- Lesson 4.2 — Planning with Claude Code: `/sdlc:backlog`
- Lesson 4.3 — GitHub issues into the backlog, through the agent and the `github` server
- Lesson 4.4 — Order, drop and start: the product owner's commands
- Lesson 4.5 — Explore an idea before intent, and defer work for later
- Lesson 4.6 — Import planning documents from BMAD

The outputs come from a trial run of `tasklet` with sdlc 0.14.4.

---

## Lesson 4.1 — The backlog: epics, items and when an item is ready            (video: ~6 min)

**Role:** Megan   **Project:** tasklet   **You need:** sdlc initialized (Module 1); a terminal in `tasklet`

**Goal.** Create an epic and its items with the CLI, read `openspec/backlog.md`, and tell a ready item from one that
is not ready.

### Steps

1. Explain the model. The backlog lives in one file, `openspec/backlog.md`.
   - An **epic** (`E<n>`) groups items under a goal.
   - An **item** (`B<n>`) is one future change.
   - **The order in the file is the priority.**
   - The status is in the item heading: `open`, `in-progress`, `done`, `dropped`.
   - Ids are never reused.

2. Megan adds an epic:

   ```bash
   sdlc backlog epic add "Task planning" --goal "People plan their week in tasklet without a spreadsheet"
   ```

   ```text
   E1 Task planning
   ```

3. She adds the first item with everything a change needs:

   ```bash
   sdlc backlog add "Add due dates to tasks" --epic E1 --kind feature --risk medium \
     --outcome "A task can carry a due date, and overdue tasks are easy to find" \
     --accept "a task created with a due date returns it in GET /tasks/:id" \
     --accept "GET /tasks?overdue=true lists only open tasks whose due date has passed" \
     --accept "an invalid date is refused with 400"
   ```

   ```text
   B1 Add due dates to tasks
   ```

   `--accept` can be repeated: one criterion each time. `--depends B<n>` names an item that must be done first.

4. She adds three more items quickly, with only a title, and one that depends on B1:

   ```bash
   sdlc backlog add "Reminders for overdue tasks" --epic E1 --kind feature --depends B1 \
     --outcome "Owners get one reminder per overdue task"
   sdlc backlog add "Export tasks as CSV" --epic E1 --kind feature
   sdlc backlog add "Dark mode for the web client" --epic E1 --kind feature
   ```

5. She lists the backlog:

   ```bash
   sdlc backlog list
   ```

   ```text
   E1 Task planning  ░░░░░░░░░░  0/4
   ID  Status  Ready  Title                         Change
   B1  open    ✓      Add due dates to tasks        -
   B2  open    -      Reminders for overdue tasks   -
   B3  open    -      Export tasks as CSV           -
   B4  open    -      Dark mode for the web client  -
   ```

6. Explain readiness. sdlc computes it every time; nobody sets it. An open item is **ready** when it has:
   - an outcome,
   - at least one acceptance criterion,
   - and every `Depends on` item is `done`.

   `sdlc backlog list --json` says what is missing for each item:

   ```json
   { "id": "B2", "ready": false, "missing": ["no acceptance criteria"], "blockedBy": [] }
   ```

7. Open `openspec/backlog.md` in the editor. This is what sdlc wrote:

   ```markdown
   ## E1 Task planning
   Goal: People plan their week in tasklet without a spreadsheet

   ### B1 [open] Add due dates to tasks
   - **Kind**: feature
   - **Risk**: medium
   - **Outcome**: A task can carry a due date, and overdue tasks are easy to find
   - **Acceptance**:
     - a task created with a due date returns it in GET /tasks/:id
     - GET /tasks?overdue=true lists only open tasks whose due date has passed
     - an invalid date is refused with 400
   ```

   People may edit this file by hand: notes under items, extra fields and sections stay when a command rewrites the
   file. Agents may not edit it directly (lesson 4.2).

### Check yourself

- `sdlc backlog list --ready` shows only B1.
- `sdlc backlog next` prints `B1 Add due dates to tasks`.
- You can say why B2 is not ready (no acceptance criterion, and B1 is not done).

### Pitfalls

- `--accept` and `--depends` on `sdlc backlog edit` **replace** the list. Use `--add-accept` to append one criterion.
- `sdlc backlog edit` changes the text of an item, never its place or status. The place is changed with `move`
  (lesson 4.4).
- Kind and risk set here travel into the change when it starts. `--risk high` later adds the tech lead's approval to
  the spec and plan gates.

### On screen (for the video)

- The terminal and `openspec/backlog.md` side by side; each command adds a block to the file.
- Highlight the `Ready` column, then the `missing` field of the JSON.

---

## Lesson 4.2 — Planning with Claude Code: `/sdlc:backlog`            (video: ~7 min)

**Role:** Megan, with Claude Code   **Project:** tasklet   **You need:** lesson 4.1

**Goal.** Let the agent break an epic into ready items and refine an item, while every write goes through the
`sdlc backlog` commands and every decision stays with Megan.

### Steps

1. Megan opens Claude Code in `tasklet` and asks for the backlog with no input:

   > /sdlc:backlog

   The agent runs `sdlc backlog list` and `sdlc backlog next`. It names the next ready item (B1) and says what blocks
   the others: B2 has no acceptance criterion and waits for B1; B3 and B4 have no outcome and no criterion.

2. She asks the agent to decompose an idea:

   > /sdlc:backlog Shared task lists: a list owner shares a list with teammates

   The agent reads the code and the specs first (`sdlc openspec list --specs`). It proposes items small enough for one
   change each, every one with a title, an outcome, at least one criterion and its dependencies. It asks Megan to
   confirm with a choice: all, a subset, or revise. Only after her answer does it run, for example:

   ```bash
   sdlc backlog epic add "Shared task lists" --goal "Teams plan together in one list instead of copying tasks"
   sdlc backlog add "Share a list with a teammate" --epic E2 --outcome "..." --accept "..."
   ```

3. She asks the agent to bring an item to ready:

   > /sdlc:backlog B3

   The agent asks what is missing, then writes her answers with `sdlc backlog edit`:

   ```bash
   sdlc backlog edit B3 --outcome "Team leads open their tasks in a spreadsheet" \
     --accept "GET /tasks.csv returns one row per task with a header row"
   ```

   ```text
   B3 Export tasks as CSV
   ```

   It then offers to start the item (`sdlc backlog start B3`). Megan says "not yet".

4. Show the guard. Megan asks the agent to "just fix the typo in backlog.md". The agent tries to edit the file and the
   hook denies it (real reason, wrapped):

   ```text
   [sdlc:state-integrity] openspec/backlog.md is changed through the CLI: refine items with `sdlc backlog add` or
   `sdlc backlog edit`; the order and removal of items are a person's decision (`sdlc backlog move`,
   `sdlc backlog drop`). Why, and what to do: `sdlc guide denials#state-integrity`.
   ```

   The agent fixes the title with `sdlc backlog edit B3 --title "…"` instead.

5. Megan asks the agent to put B3 before B2. The agent does not run the command. It gives her the command for her
   own terminal (lesson 4.4).

### Check yourself

- `sdlc backlog list` shows B3 as ready.
- `git diff openspec/backlog.md` shows only changes the commands made.
- The agent never ran `sdlc backlog move` or `sdlc backlog drop`.

### Pitfalls

- "Yes, add them" in the chat is a confirmation of the agent's proposal, not a priority decision. The order is still
  set by `sdlc backlog move`, in Megan's terminal.
- An item the agent adds goes to the end of its epic. A new item is not the most important one just because it is
  new.
- Denials in this lesson: `sdlc guide denials#state-integrity` and `denials#separation-of-duties`.

### On screen (for the video)

- `/sdlc:backlog` with no input: highlight the agent's list of "what blocks the others".
- The confirmation question with three choices.
- The denied direct edit, then the same fix done with `sdlc backlog edit`.

---

## Lesson 4.3 — GitHub issues into the backlog, through the agent and the `github` server            (video: ~7 min)

**Role:** Megan, with Claude Code   **Project:** tasklet
**You need:** lesson 4.2; the `github` MCP server in `mcp.servers` (Module 2) and Claude Code allowed to use it

**Goal.** Bring the planned GitHub issues of `northwind/tasklet` into the backlog, each one linked to its issue.

### Steps

1. Say it plainly first: **sdlc has no built-in GitHub Issues sync.** Nothing in sdlc reads or writes issues by itself,
   and nothing keeps the two lists in step. The agent does the work: it reads issues through the `github` MCP server
   and runs `sdlc backlog add` for each one that Megan confirms.

2. Check the server. Steven described it once in `openspec/sdlc.yaml`:

   ```yaml
   mcp:
     servers:
       github:
         type: http
         url: https://api.githubcopilot.com/mcp/
         headers: { Authorization: "Bearer ${GITHUB_TOKEN}" }
         stages: [plan, build, test, deploy]
   ```

   `sdlc mcp check` lists the tools the server exposes. Use the names your server shows; the official GitHub server
   exposes tools such as `list_issues` and `get_issue`.

3. Megan asks the agent in plain words:

   > Read the open issues with the label "planned" in northwind/tasklet through the github MCP server. For each one,
   > propose a backlog item under E1 with an outcome and acceptance criteria taken from the issue. Skip issues that are
   > already in the backlog (compare the source refs). Ask me before you add anything.

   The agent calls the issue tool of the server (for example `list_issues`), reads each issue, and checks
   `sdlc backlog list --json` for items whose `source` already names the issue. It shows Megan a table of proposed
   items and asks her to confirm.

4. For each confirmed issue, the agent runs `sdlc backlog add` with the issue as the source:

   ```bash
   sdlc backlog add "Add due dates to tasks" --epic E1 --kind feature --risk medium \
     --outcome "A task can carry a due date, and overdue tasks are easy to find" \
     --accept "a task created with a due date returns it in GET /tasks/:id" \
     --source-type ticket --source-ref "northwind/tasklet#12"
   ```

   ```text
   B1 Add due dates to tasks
   ```

   The item in `backlog.md` now carries `- **Source**: ticket northwind/tasklet#12`. When the item starts, the change
   inherits the link: the draft intent says `Source: backlog B1 (ticket northwind/tasklet#12)`.

5. Show why the duplicate check matters. sdlc does not compare sources. Adding the same issue a second time creates a
   second item (real output from the trial):

   ```text
   B8 Add due dates to tasks
   ```

   `sdlc backlog list --json` then shows two items with `"source": "ticket northwind/tasklet#12"`. Megan removes the
   extra one with `sdlc backlog drop B8 --note "Duplicate of B1"` in her own terminal.

6. Show the stage rule. The `github` server is allowed at the stages `plan, build, test, deploy`. While an active
   change is at the design stage, an agent's call to it is denied in `block` mode (real reason):

   ```text
   [sdlc:mcp-stage] The MCP server github is for the stages plan, build, test, deploy; the active changes are at
   design. Call it once a change reaches one of them, or ask a person to add the stage to mcp.servers.github.stages.
   Why, and what to do: `sdlc guide denials#mcp-stage`.
   ```

   With no active change, calls are not checked. Plan the import when no change is in design, or ask Steven to add
   `design` to the server's stages.

7. Close the loop by hand. When the change is archived, sdlc marks the backlog item `done`, but it does not close or
   comment on the GitHub issue. Megan asks the agent to do it at the end of `/sdlc:archive`:

   > Comment on northwind/tasklet#12 with a link to the archived change and close the issue.

### Check yourself

- Each new item shows `Source: ticket northwind/tasklet#<n>` in `openspec/backlog.md`.
- `sdlc backlog list --json` has no two open items with the same `source`.
- No item was added that Megan did not confirm.

### Pitfalls

- There is no two-way sync. An issue edited in GitHub after the import does not change the backlog item.
- `sdlc backlog add` has no `--source-url`. The issue is kept as a reference string (`owner/repo#n`); `sdlc new`
  has `--source-url` when you start a change directly.
- Write access to issues through MCP is a real write. Keep the token's permissions narrow, and keep servers that can
  write files out of the registry (`sdlc mcp check` warns about them).
- Never paste a token into `sdlc.yaml`: use `${GITHUB_TOKEN}` (`mcp_secret_literal` otherwise).

### On screen (for the video)

- A "No built-in sync" title card first.
- The GitHub issue page next to the item in `backlog.md`; highlight the `Source` line.
- The duplicate `B8`, then Megan's `drop`.

---

## Lesson 4.4 — Order, drop and start: the product owner's commands            (video: ~6 min)

**Role:** Megan (person commands), Oliver's agent (start)   **Project:** tasklet   **You need:** lessons 4.1 and 4.2

**Goal.** Megan sets the order and removes work in her own terminal. The agent starts the next ready item as a change.

### Steps

1. In the chat, Megan asks the agent to move B3 before B2. The agent may not decide the order. If it tries, the hook
   denies the call; the CLI refuses as well:

   ```text
   error: Backlog priority is a product decision. Ask a person to run this command.
   fix: Run it yourself in your own terminal, not in the agent chat (a `!` command there runs in the agent's shell):
   sdlc backlog move B3 --before B2
   ```

2. Megan runs it herself, in her own terminal:

   ```bash
   sdlc backlog move B3 --before B2
   ```

   ```text
   B3 Export tasks as CSV
   ```

   Other forms: `--top`, `--after B<n>`, `--epic E<n>` (move into another epic).

3. She drops an item that is no longer needed. `--note` gives the reason:

   ```bash
   sdlc backlog drop B4 --note "tasklet has no web client yet"
   ```

   ```text
   B4 Dark mode for the web client
   ```

   The item stays in the file as `[dropped]` with the date and the reason. Its id is never reused.

4. She checks the result:

   ```bash
   sdlc backlog list
   ```

   ```text
   E1 Task planning  ░░░░░░░░░░  0/3
   ID  Status   Ready  Title                         Change
   B1  open     ✓      Add due dates to tasks        -
   B3  open     ✓      Export tasks as CSV           -
   B2  open     -      Reminders for overdue tasks   -
   B4  dropped  -      Dark mode for the web client  -
   ```

5. Show what comes next. With no active change, `sdlc next` proposes the next ready item:

   ```bash
   sdlc next
   ```

   ```text
   B1: Start backlog item B1: Add due dates to tasks.
   $ sdlc backlog start B1
   ```

6. Oliver asks his agent to start it. Starting is not a decision, so the agent may run it:

   ```bash
   sdlc backlog start B1 --change add-due-dates
   ```

   ```text
   Started B1 as add-due-dates.
   Next: person — Megan (product-owner) must review and approve the intent gate (intent): sdlc approve intent --change add-due-dates --as product-owner
   ```

   This creates the change folder with a draft `intent.md` built from the item (outcome and acceptance criteria) and
   sets B1 to `in-progress`. The agent continues with `/sdlc:intent add-due-dates` to complete the intent (Module 5).

7. Show the end of the loop. When the change is archived, B1 becomes `done` and the epic bar moves:

   ```text
   E1 Task planning  ███░░░░░░░  1/3
   ID  Status   Ready  Title                         Change
   B1  done     -      Add due dates to tasks        add-due-dates
   ```

   An item that depended on B1 can now become ready.

### Check yourself

- B3 is above B2 in `openspec/backlog.md`, and B4 shows `[dropped]` with Megan's note.
- After `backlog start`, `openspec/changes/add-due-dates/intent.md` exists and B1 is `in-progress`.
- `git log` shows the move and the drop committed by Megan, not by the agent.

### Pitfalls

- Right after `backlog start`, the `Next:` line already asks Megan to approve the intent. The intent is only a draft
  at that point: wait until the agent has run `/sdlc:intent` and says the intent is ready.
- `sdlc backlog move` and `drop` check that you are a person, not that you are the product owner. At Northwind only
  Megan runs them; agree on this in your team.
- `sdlc backlog done B<n> --note "…"` marks an item done without a change. Use it for work that was finished another
  way, and say how in the note.
- Denial in this lesson: `sdlc guide denials#separation-of-duties`.

### On screen (for the video)

- Split screen: the agent's refusal on the left, Megan's terminal on the right.
- `backlog.md` before and after the move: highlight the block that moves.
- The new change folder after `backlog start`.

---

## Lesson 4.5 — Explore an idea before intent, and defer work for later            (video: ~6 min)

**Role:** Megan, with Claude Code   **Project:** tasklet   **You need:** lesson 4.1

**Goal.** Pressure-test an unclear idea before anyone writes an intent, and record work the team chose to postpone so
that it is not lost.

### Steps

1. Explain when to explore. Exploration is optional and decides nothing. Use it when an idea is not clear enough to
   write acceptance criteria. Skip it when the idea is clear: add the item instead.

2. Megan is not sure what "reminders" should mean (B2). She asks the agent:

   > /sdlc:explore Reminders for overdue tasks: email, chat, or both? How often?

   The agent creates a note and fills it section by section:

   ```bash
   sdlc explore due-date-reminders
   ```

   ```text
   Created exploration openspec/explorations/due-date-reminders.md
   ```

   The note has fixed sections: Problem, What exists, Research, Alternatives, Pressure test, Open questions,
   Recommendation. The agent delegates research to the `sdlc-researcher` subagent, compares two or three options
   (including "do nothing"), and tests each through four lenses: user, technical, cost and risk. It does not edit
   code.

3. The agent recommends **proceed**, **reshape** or **stop**, and asks Megan to choose. She chooses "reshape: email
   only, one reminder per task". The agent brings B2 to ready:

   ```bash
   sdlc backlog edit B2 --outcome "Owners get one reminder per overdue task, by email" \
     --accept "one email per overdue open task, sent once" --accept "no email for a task that is done"
   ```

   For a new idea that should proceed, the agent adds an item linked to the note instead:

   ```bash
   sdlc backlog add "<title>" --outcome "<outcome>" --accept "<measure>" \
     --source-type exploration --source-ref openspec/explorations/<slug>.md
   ```

4. List the notes:

   ```bash
   sdlc explore list
   ```

   ```text
   due-date-reminders  openspec/explorations/due-date-reminders.md
   ```

5. Now the second half: **deferred work**. While planning B1, Megan decides that time zones are out of scope for the
   first version. She does not want the decision to be lost. She (or the agent) records it:

   ```bash
   sdlc defer add "Time zones for due dates" --why "First version stores dates in UTC only" \
     --revisit "When a customer outside UTC asks"
   ```

   ```text
   D1 Time zones for due dates
   ```

   The registry is `openspec/deferred-work.md`. During a review, the agent links a postponed finding to its change
   with `--change <id> --finding F<n>` (lesson 5.8).

6. List and close deferred work:

   ```bash
   sdlc defer list --open
   sdlc defer close D1 --status dropped --note "Covered by D2"
   ```

   ```text
   D1 dropped Time zones for due dates
   ```

   `--status` is `done` or `dropped`. Reports and the dashboard show the registry; `sdlc health` warns about deferred
   items that stay open too long.

### Check yourself

- `openspec/explorations/due-date-reminders.md` has a Recommendation section and Megan's choice.
- `sdlc backlog list` shows B2 as ready once B1 is done.
- `sdlc defer list` shows D1 with its reason.

### Pitfalls

- An exploration is not a gate and not an approval. Proceeding still needs an intent and Megan's approval.
- If the agent stops to wait for an answer, it marks unfinished sections `_pending: …_` in the note. Run
  `/sdlc:explore` again with the same idea and it continues from the first pending section.
- A deferred item is not a backlog item. When the team decides to do it, add a backlog item for it and close the
  deferred item with a note.

### On screen (for the video)

- The exploration note filling up, section by section; highlight the four pressure-test lenses.
- The choice question: proceed, reshape, stop.
- `openspec/deferred-work.md` with D1.

---

## Lesson 4.6 — Import planning documents from BMAD            (video: ~5 min)

**Role:** Megan, with Ethan   **Project:** tasklet   **You need:** lesson 4.1; BMAD output in the repository

**Goal.** Turn BMAD planning artifacts into backlog epics and items, or into the artifacts of one change, without
approving anything.

### Steps

1. Explain the two modes. Give exactly one of them:

   | Mode | What it writes |
   |---|---|
   | `--to-backlog` | BMAD epics and tickets (or a PRD/SPEC without tickets) become backlog epics and items |
   | `--change <id>` | a PRD, SPEC and architecture spine become `intent.md`, `proposal.md`, `specs/`, `design.md`, and deferred bullets go to `openspec/deferred-work.md` |

2. The team planned "Shared task lists" in BMAD. The output is in `_bmad-output/epic-sharing/` inside the repository:
   `epic-sharing.md` and `tickets.toml`. Megan previews the import first:

   ```bash
   sdlc import bmad _bmad-output/epic-sharing --to-backlog --dry-run
   ```

   The preview prints JSON (shortened):

   ```json
   {
     "epics": [ { "key": "1", "title": "Shared task lists",
                  "goal": "Teams plan together in one list instead of copying tasks." } ],
     "items": [
       { "key": "1.1", "title": "Share a list with a teammate", "kind": "feature", "risk": "medium", ... },
       { "key": "1.2", "title": "Can we reuse the existing auth tokens for invites", "kind": "chore", ... },
       { "key": "1.3", "title": "Shared list shows the owner's private tasks", "kind": "bugfix",
         "dependsOnKeys": ["1.1"], ... }
     ],
     "unmapped": [],
     "warnings": []
   }
   ```

3. Explain the mapping:

   | BMAD | Backlog |
   |---|---|
   | epic | epic; the epic's Outcome becomes the goal |
   | `story` / `bug` / `spike` | item of kind `feature` / `bugfix` / `chore` |
   | `description` | outcome |
   | the story's criteria, else `verify` | acceptance |
   | `after` | `Depends on` |
   | the ticket | source (`bmad <path>#<key>`) |

4. She runs the import:

   ```bash
   sdlc import bmad _bmad-output/epic-sharing --to-backlog
   ```

   ```text
   Imported 1 epics and 3 backlog items.
   ```

   ```bash
   sdlc backlog list --epic E2
   ```

   ```text
   E2 Shared task lists  ░░░░░░░░░░  0/3
   ID  Status  Ready  Title                                              Change
   B5  open    ✓      Share a list with a teammate                       -
   B6  open    ✓      Can we reuse the existing auth tokens for invites  -
   B7  open    -      Shared list shows the owner's private tasks        -
   ```

   B7 is not ready because it depends on B5.

5. For one change built from a PRD, Ethan uses the other mode, then validates:

   ```bash
   sdlc import bmad _bmad-output/prd-sharing.md --change share-lists --dry-run
   sdlc import bmad _bmad-output/prd-sharing.md --change share-lists
   sdlc validate --change share-lists
   ```

   The source copies are kept under `openspec/changes/share-lists/sources/bmad/`. Nothing is approved: Megan still
   approves the intent and the spec.

### Check yourself

- `sdlc backlog list --epic E2` shows three items with BMAD sources.
- `openspec/backlog.md` shows `- **Source**: bmad _bmad-output/epic-sharing/tickets.toml#1.1` under B5.
- No gate of any change changed state because of the import.

### Pitfalls

- The path must be inside the project. A folder outside it gives the same message as an empty folder:
  `No BMAD artifacts found.`
- `--dry-run` prints JSON even without `--json`. Read it before you import: the import adds items, and only Megan can
  drop extra ones.
- Running the same import twice adds a second epic with the same items (in the trial: E3 with B8 to B10). sdlc does
  not check for repeats.
- In `--change` mode, sdlc recognises the documents by their content: a PRD starts with `# PRD:`, an architecture
  spine with `# Architecture Spine —`, a SPEC has `id: SPEC-…` in its front matter.
- Imported items keep the BMAD order. Megan reorders them with `sdlc backlog move` afterwards.

### On screen (for the video)

- `tickets.toml` on the left and the dry-run JSON on the right; draw lines for the mapping table.
- The epic bar of E2 after the import.

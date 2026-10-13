# 4. Backlog and planning

This chapter is about planned work before it becomes a change. It is for **Megan**, the product owner, who plans the
`tasklet` backlog with Claude Code and decides the order. Oliver and Ethan read the first two lessons to see where their
changes come from. The outputs come from a trial run of `tasklet` with sdlc 0.14.4.

## Contents

- [4.1 The backlog: epics, items and when an item is ready](#s4-1)
- [4.2 Planning with Claude Code: `/sdlc:backlog`](#s4-2)
- [4.3 GitHub issues into the backlog](#s4-3)
- [4.4 Order, drop and start: the product owner's commands](#s4-4)
- [4.5 Explore an idea before intent, and defer work for later](#s4-5)
- [4.6 Import planning documents from BMAD](#s4-6)


<a id="s4-1"></a>
## 4.1 The backlog: epics, items and when an item is ready

*Megan  ·  tasklet  · needs: sdlc initialized (Chapter 1); a terminal in `tasklet`*

Create an epic and its items with the CLI, read `openspec/backlog.md`, and tell a ready item from one that
is not ready.

### Procedure

1. Understand the model. The backlog lives in one file, `openspec/backlog.md`.
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

6. Understand readiness. sdlc computes it every time; nobody sets it. An open item is **ready** when it has:
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
   file. Agents may not edit it directly ([lesson 4.2](#s4-2)).

### You are done when

- `sdlc backlog list --ready` shows only B1.
- `sdlc backlog next` prints `B1 Add due dates to tasks`.
- You can say why B2 is not ready (no acceptance criterion, and B1 is not done).

### Pitfalls

- `--accept` and `--depends` on `sdlc backlog edit` **replace** the list. Use `--add-accept` to append one criterion.
- `sdlc backlog edit` changes the text of an item, never its place or status. The place is changed with `move`
  ([lesson 4.4](#s4-4)).
- Kind and risk set here travel into the change when it starts. `--risk high` later adds the tech lead's approval to
  the spec and plan gates.


<a id="s4-2"></a>
## 4.2 Planning with Claude Code: `/sdlc:backlog`

*Megan, with Claude Code  ·  tasklet  · needs: [lesson 4.1](#s4-1)*

Let the agent break an epic into ready items and refine an item, while every write goes through the
`sdlc backlog` commands and every decision stays with Megan.

### Procedure

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

4. See the guard. Megan asks the agent to "just fix the typo in backlog.md". The agent tries to edit the file and the
   hook denies it (real reason, wrapped):

   ```text
   [sdlc:state-integrity] openspec/backlog.md is changed through the CLI: refine items with `sdlc backlog add` or
   `sdlc backlog edit`; the order and removal of items are a person's decision (`sdlc backlog move`,
   `sdlc backlog drop`). Why, and what to do: `sdlc guide denials#state-integrity`.
   ```

   The agent fixes the title with `sdlc backlog edit B3 --title "…"` instead.

5. Megan asks the agent to put B3 before B2. The agent does not run the command. It gives her the command for her
   own terminal ([lesson 4.4](#s4-4)).

### You are done when

- `sdlc backlog list` shows B3 as ready.
- `git diff openspec/backlog.md` shows only changes the commands made.
- The agent never ran `sdlc backlog move` or `sdlc backlog drop`.

### Pitfalls

- "Yes, add them" in the chat is a confirmation of the agent's proposal, not a priority decision. The order is still
  set by `sdlc backlog move`, in Megan's terminal.
- An item the agent adds goes to the end of its epic. A new item is not the most important one just because it is
  new.
- Denials in this lesson: `sdlc guide denials#state-integrity` and `denials#separation-of-duties`.


<a id="s4-3"></a>
## 4.3 GitHub issues into the backlog

*Megan, with Claude Code  ·  tasklet  · needs: [lesson 4.2](#s4-2); the `github` MCP server in `mcp.servers`
(Chapter 2)*

Bring the open GitHub issues of `northwind/tasklet` into the backlog, each one linked to its issue, and
close that link when the change is archived.

### Procedure

1. Understand it plainly first. Since 0.19.0, sdlc can import open GitHub issues into the backlog through the team's
   GitHub MCP server. Steven names the server and the repository once; Megan (or anyone) runs the import. The agent
   still helps with the outcome and acceptance of each item. A person orders the backlog.

2. Steven adds the `issues` setting next to the `github` server in `openspec/sdlc.yaml`:

   ```yaml
   mcp:
     servers:
       github:
         type: http
         url: https://api.githubcopilot.com/mcp/
         headers: { Authorization: "Bearer ${GITHUB_TOKEN}" }
         stages: [plan, build, test, deploy]
   issues:
     server: github
     repo: northwind/tasklet
   ```

   `github` is the name of the team's GitHub MCP server in `mcp.servers`. sdlc holds no token; the server uses
   `${GITHUB_TOKEN}` as in Chapter 2. Without `issues`, the import is refused (`issues_not_configured`).

3. Megan imports the open issues:

   ```bash
   sdlc backlog import --issues
   ```

   ```text
   Imported 2 issues.
   ```

   One backlog item per open issue that is not linked yet. Pull requests are skipped. The item carries the field
   `Issue: GH-<n>` (for example `Issue: GH-12`). A second import adds nothing. Use `--json` in a script.

4. The agent still adds value on the wording. Megan opens `/sdlc:backlog B1` and asks the agent to draft an outcome
   and acceptance criteria from the issue text. The agent proposes text; Megan confirms; then the agent runs
   `sdlc backlog edit` (it cannot edit `backlog.md` by hand). Megan sets the order herself:

   ```bash
   sdlc backlog move B1 --top
   ```

5. See the stage rule. The `github` server is allowed at the stages `plan, build, test, deploy`. While an active
   change is at the design stage, an agent's call to it is denied in `block` mode (real reason):

   ```text
   [sdlc:mcp-stage] The MCP server github is for the stages plan, build, test, deploy; the active changes are at
   design. Call it once a change reaches one of them, or ask a person to add the stage to mcp.servers.github.stages.
   Why, and what to do: `sdlc guide denials#mcp-stage`.
   ```

   The import itself is a CLI command, so the stage rule does not block it. Plan agent calls to the issue tools when
   no change is in design, or ask Steven to add `design` to the server's stages.

6. Close the loop on archive. When the change started from that item is archived, sdlc marks the backlog item
   `done` and, since 0.19.0, comments on the linked GitHub issue and closes it (through the event outbox). A failing
   server does not fail the archive; `sdlc events flush` delivers the comment and the close later. An item without
   `Issue: GH-<n>` calls nothing.

### You are done when

- Each imported item shows `Issue: GH-<n>` in `openspec/backlog.md`.
- A second `sdlc backlog import --issues` adds no new item.
- After archive of a linked change, the GitHub issue is closed (or waits in the outbox until `events flush`).

### Pitfalls

- There is no two-way sync. An issue edited in GitHub after the import does not change the backlog item.
- `sdlc backlog add` still has no `--source-url`. The import uses the `Issue: GH-<n>` field instead of a free-form
  source ref.
- Write access to issues through MCP is a real write. Keep the token's permissions narrow, and keep servers that can
  write files out of the registry (`sdlc mcp check` warns about them).
- Never paste a token into `sdlc.yaml`: use `${GITHUB_TOKEN}` (`mcp_secret_literal` otherwise).


<a id="s4-4"></a>
## 4.4 Order, drop and start: the product owner's commands

*Megan (person commands), Oliver's agent (start)  ·  tasklet  · needs: [lessons 4.1](#s4-1) and 4.2*

Megan sets the order and removes work in her own terminal. The agent starts the next ready item as a change.

### Procedure

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

5. See what comes next. With no active change, `sdlc next` proposes the next ready item:

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
   Next: agent — Write intent (intent.md) for the intent gate.
   ```

   This creates the change folder with a draft `intent.md` built from the item (outcome and acceptance criteria) and
   sets B1 to `in-progress`. The agent continues with `/sdlc:intent add-due-dates` to complete the intent (Chapter 5).

7. See the end of the loop. When the change is archived, B1 becomes `done` and the epic bar moves:

   ```text
   E1 Task planning  ███░░░░░░░  1/3
   ID  Status   Ready  Title                         Change
   B1  done     -      Add due dates to tasks        add-due-dates
   ```

   An item that depended on B1 can now become ready.

### You are done when

- B3 is above B2 in `openspec/backlog.md`, and B4 shows `[dropped]` with Megan's note.
- After `backlog start`, `openspec/changes/add-due-dates/intent.md` exists and B1 is `in-progress`.
- `git log` shows the move and the drop committed by Megan, not by the agent.

### Pitfalls

- After `backlog start`, the draft intent goes to the agent. Megan approves it after `/sdlc:intent` completes it.
- Since 0.18.0, with `roles.yaml`, `sdlc backlog move` and `drop` need the `product-owner` role. Without the file any
  person may run them, as before; an agent never may. At Northwind only Megan holds `product-owner`; anyone else is
  refused with `missing_role`, and the message names who may.
- `sdlc backlog done B<n> --note "…"` marks an item done without a change. Use it for work that was finished another
  way, and say how in the note.
- Denial in this lesson: `sdlc guide denials#separation-of-duties`.


<a id="s4-5"></a>
## 4.5 Explore an idea before intent, and defer work for later

*Megan, with Claude Code  ·  tasklet  · needs: [lesson 4.1](#s4-1)*

Pressure-test an unclear idea before anyone writes an intent, and record work the team chose to postpone so
that it is not lost.

### Procedure

1. Understand when to explore. Exploration is optional and decides nothing. Use it when an idea is not clear enough to
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
   with `--change <id> --finding F<n>` ([lesson 5.8](05-lifecycle-greenfield.md#s5-8)).

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

### You are done when

- `openspec/explorations/due-date-reminders.md` has a Recommendation section and Megan's choice.
- `sdlc backlog list` shows B2 as ready once B1 is done.
- `sdlc defer list` shows D1 with its reason.

### Pitfalls

- An exploration is not a gate and not an approval. Proceeding still needs an intent and Megan's approval.
- If the agent stops to wait for an answer, it marks unfinished sections `_pending: …_` in the note. Run
  `/sdlc:explore` again with the same idea and it continues from the first pending section.
- A deferred item is not a backlog item. When the team decides to do it, add a backlog item for it and close the
  deferred item with a note.


<a id="s4-6"></a>
## 4.6 Import planning documents from BMAD

*Megan, with Ethan  ·  tasklet  · needs: [lesson 4.1](#s4-1); BMAD output in the repository*

Turn BMAD planning artifacts into backlog epics and items, or into the artifacts of one change, without
approving anything.

### Procedure

1. Understand the two modes. Give exactly one of them:

   | Mode | What it writes |
   |---|---|
   | `--to-backlog` | BMAD epics and tickets (or a PRD/SPEC without tickets) become backlog epics and items |
   | `--change <id>` | a PRD, SPEC and architecture spine become `intent.md`, `proposal.md`, `specs/`, `design.md`, and deferred bullets go to `openspec/deferred-work.md` |

2. The team planned "Shared task lists" in BMAD. The output is in `_bmad-output/epic-sharing/` inside the repository:
   `epic-sharing.md` and `tickets.toml`. Megan previews the import first:

   ```bash
   sdlc import bmad _bmad-output/epic-sharing --to-backlog --dry-run --json
   ```

   This JSON preview is from the trial with sdlc 0.14.4. Since 0.15.2, use `--json` to request it:

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

3. Understand the mapping:

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

### You are done when

- `sdlc backlog list --epic E2` shows three items with BMAD sources.
- `openspec/backlog.md` shows `- **Source**: bmad _bmad-output/epic-sharing/tickets.toml#1.1` under B5.
- No gate of any change changed state because of the import.

### Pitfalls

- The path must be inside the project. This output is from the trial with sdlc 0.14.4. Since 0.15.4, an outside path
  or a link to one is refused with `path_outside_project` (`Path outside project: …`), also with `--change`.
- Since 0.15.2, `--dry-run` prints a text summary unless `--json` is given. Read it before importing.
- Repeating the import skips matching BMAD epics and items and reports `Already imported: …`.
- In `--change` mode, sdlc recognises the documents by their content: a PRD starts with `# PRD:`, an architecture
  spine with `# Architecture Spine —`, a SPEC has `id: SPEC-…` in its front matter.
- Imported items keep the BMAD order. Megan reorders them with `sdlc backlog move` afterwards.

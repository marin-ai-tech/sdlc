# Module 2. Connecting the toolchain through MCP

Sergey connects `tasklet` to the team's systems: GitHub (the task manager and the build server), the team's
knowledge server and a Telegram bot. He also lets other AI systems read the process. Every step here is
configuration in `openspec/sdlc.yaml`, so only a person makes it. The same steps work for `billing-api`.

In this module:

- Lesson 2.1 — The MCP registry: github, knowledge, telegram
- Lesson 2.2 — Check the servers with `sdlc mcp check`
- Lesson 2.3 — The stage rule: which server the agent may call when
- Lesson 2.4 — GitHub Actions as gate evidence, and the inbox
- Lesson 2.5 — Release checks: `release.mcp` and `sdlc release check`
- Lesson 2.6 — Events to Telegram: waits, approvals, overdue gates
- Lesson 2.7 — Other AI systems read the process: `sdlc mcp serve`

At the end of the module: **Gaps found** — what the scenario wanted and sdlc does not do (yet).

One rule holds for the whole module: **nothing over MCP makes a decision.** No server, tool, inbox item or event can
approve, reject, waive, rework, take over, unlock tests, set the license or uninstall. Those stay with a person at
their own terminal.

---

## Lesson 2.1 — The MCP registry: github, knowledge, telegram            (video: ~8 min)

**Role:** Sergey (platform engineer)   **Project:** tasklet
**You need:** Module 1; a GitHub token, the knowledge server and the Telegram bot server installed on the machine

**Goal.** The team's MCP servers are described once in `openspec/sdlc.yaml`, with secrets as references, and sdlc
writes them into the agent tool's own configuration.

### Steps

1. Explain the idea. Without a registry, every developer configures the same servers by hand, in each tool, with
   tokens pasted into files. With the registry, Sergey writes the servers once, and `sdlc update` lays them out for
   every tool of the project (`.mcp.json` for Claude Code; the other tools get their own files).

2. Sergey adds this block to `openspec/sdlc.yaml` in his editor. The server package names are Northwind's examples:

   ```yaml
   project:
     name: tasklet
   mcp:
     serve: true
     servers:
       github:
         type: http
         url: https://api.githubcopilot.com/mcp/
         headers:
           Authorization: "Bearer ${GITHUB_TOKEN}"
         stages: [plan, build, test, deploy]
       knowledge:
         type: stdio
         command: [northwind-knowledge-mcp]
         env:
           KNOWLEDGE_TOKEN: "${KNOWLEDGE_TOKEN}"
         stages: [plan, design, build, test, deploy, maintain]
       telegram:
         type: stdio
         command: [northwind-telegram-mcp]
         env:
           TELEGRAM_BOT_TOKEN: "${TELEGRAM_BOT_TOKEN}"
   ```

   | Key | Meaning |
   |---|---|
   | `type` | `http` (a remote server: `url`, `headers`) or `stdio` (a local program: `command`, `env`); default `stdio` |
   | `command` | the program and its arguments, as a list |
   | `env`, `headers` | values passed to the server; secrets only as `${VAR}` references |
   | `stages` | the stages at which the agent may call the server (lesson 2.3) |
   | `project.name` | the project's name in events and in `sdlc mcp serve` (lessons 2.6, 2.7) |

   - `github` is the official GitHub MCP server, here as its remote endpoint. Check the URL and the header in the
     server's own documentation.
   - `knowledge` is the team's own server with docs, ADRs, the glossary, and the registry of agent roles and skills.
   - `telegram` is the team's bot server. The CLI sends events to it (lesson 2.6). The agent does not need it.

3. Each person sets the variables in their own environment, for example from the team's password manager:

   ```bash
   export GITHUB_TOKEN=…           # each person's own token
   export KNOWLEDGE_TOKEN=…
   export TELEGRAM_BOT_TOKEN=…
   ```

4. Sergey lays the registry out:

   ```bash
   sdlc update
   ```

   ```text
     files: 0 created, 18 updated, 31 unchanged, 0 removed
     MCP servers of the registry in .mcp.json: added github, knowledge, telegram; updated -; removed -
   ```

   `.mcp.json` now holds four servers: `sdlc` (from lesson 1.2) and the three new ones, with `${GITHUB_TOKEN}` and the
   other references kept as references. Claude Code expands them from the environment when it starts a server.
   The workflows were updated too: each one now names the servers of its stage (lesson 2.3).

5. Show the refusal of a literal secret. Sergey pastes a token into the header by mistake and runs `sdlc update`:

   ```text
   error: The MCP server github has a secret written out in headers.Authorization; nothing was written.
   fix: Write a reference instead (e.g. `${VAR}`) under mcp.servers.github and set the variable in the environment.
   ```

   The message names the server and the key, never the value. Nothing was written.

6. Commit `openspec/sdlc.yaml`, `.mcp.json` and the updated workflow files in one commit.

### Check yourself

- `.mcp.json` lists `sdlc`, `github`, `knowledge` and `telegram`.
- `grep -n '\${' .mcp.json` shows only references, no token values.
- A server Sergey added to `.mcp.json` by hand earlier is still there: sdlc touches only the entries it wrote.

### Pitfalls

- Never write a token into `openspec/sdlc.yaml`; the update refuses it (`mcp_secret_literal`).
- A server removed from the registry disappears from `.mcp.json` on the next `sdlc update`.
- The agent cannot do this lesson for you: `openspec/sdlc.yaml` and `.mcp.json` configure the guard, and the hook
  denies the agent's edits of them (`sdlc guide denials#guard-config`).
- A `stdio` server started with `npx -y <package>` downloads the package when it starts. Event delivery has only five
  seconds (lesson 2.6), so prefer an installed command, as here.
- The name `sdlc` is reserved for sdlc's own server.

### On screen (for the video)

- The YAML block, server by server; highlight `${GITHUB_TOKEN}`.
- `sdlc update` output, then `.mcp.json` side by side with the YAML.
- The refused literal token: highlight "nothing was written".

---

## Lesson 2.2 — Check the servers with `sdlc mcp check`            (video: ~5 min)

**Role:** Sergey   **Project:** tasklet   **You need:** lesson 2.1

**Goal.** You can see which registry servers answer, which tools they offer, and which of them could write files
behind the guard's back.

### Steps

1. Run the check:

   ```bash
   sdlc mcp check
   ```

   sdlc connects to each server, lists its tools and closes. A server that does not answer within 10 seconds is
   marked unavailable. Real output on a machine where the variables are not set and the two local servers are not
   installed:

   ```text
   ✗ github (http): unavailable (Streamable HTTP error: Error POSTing to endpoint: bad request: Authorization header is badly formatted
   )
   ✗ knowledge (stdio): unavailable (MCP error -32000: Connection closed)
   ✗ telegram (stdio): unavailable (MCP error -32000: Connection closed)
   ```

   An unset `${GITHUB_TOKEN}` becomes an empty value, so the header is just `Bearer` and GitHub refuses it.

2. Sergey sets the variables, installs the two servers and runs the check again. Described: each server shows a
   line `<name>: available, N tool(s)` followed by the names of its tools. Note the tool names: lessons 2.4 to 2.6
   use them.

3. Read the warnings. A tool whose name looks like a file write (a verb such as write, edit, create, delete, move,
   rename or patch together with file, dir or path) gets a warning: "… looks like it writes files; the hook does not
   see what an MCP server writes." The official GitHub server has file tools in its repository toolset. GitHub lets
   you choose the toolsets the server offers (see its documentation). Sergey keeps issues, pull requests, Actions
   and projects, and leaves out the tools that write repository files.

4. For a script, use JSON:

   ```bash
   sdlc mcp check --json
   ```

   It returns `{ servers: [{ name, type, available, tools, warnings, error }] }`.

### Check yourself

- Every server shows "available".
- No warning is left, or you know why you accept it.

### Pitfalls

- `sdlc mcp check` always exits 0. Read the output, or check `available` in the JSON.
- The file-write warning is a guess from tool names. A server that writes files under another name is not flagged.
  Read a server's documentation before you add it.
- `sdlc mcp check` lists tool names, not their arguments. Take the argument names from the server's documentation.

### On screen (for the video)

- The red output first, then the green output after the variables are set.
- Highlight one warning line and the decision to remove that toolset.

---

## Lesson 2.3 — The stage rule: which server the agent may call when            (video: ~6 min)

**Role:** Sergey; Oleg sees the effect   **Project:** tasklet   **You need:** lesson 2.1

**Goal.** You can give each server the stages where the agent needs it, and you know what the agent sees outside
those stages.

### Steps

1. Explain `stages`. Each server lists the stages where the agent may call it. The Claude Code hook sees every MCP
   tool call (`mcp__<server>__<tool>`) and compares the server's `stages` with the stages of the active changes:

   | Server | `stages` | Why |
   |---|---|---|
   | `github` | plan, build, test, deploy | issues while planning, Actions while building and testing, pull requests at deploy |
   | `knowledge` | all six | docs, ADRs and the glossary help at every stage |
   | `telegram` | none | the CLI sends events to it; the agent has no reason to call it |

   The design stage is left out of `github` on purpose: the spec is written from the approved intent, not from the
   tracker.

2. Show the effect. `add-due-dates` is at the design stage. In Claude Code, Oleg's agent tries to list the GitHub
   issues. In `block` mode the hook denies the call (real text, wrapped):

   ```text
   [sdlc:mcp-stage] The MCP server github is for the stages plan, build, test, deploy; the active changes are at
   design. Call it once a change reaches one of them, or ask a person to add the stage to
   mcp.servers.github.stages. Why, and what to do: `sdlc guide denials#mcp-stage`.
   ```

   In `warn` mode the same text is a reminder and the call goes through.

3. Show the guidance side. Each workflow ends with a "Stage resources" section. The spec workflow of `tasklet` now
   says:

   ```text
   ## Stage resources (design)

   - MCP servers for this stage: `knowledge` (tools `mcp__knowledge__*`).
   - Other skills, subagents and MCP servers of the project are not for this stage.
   ```

   The Claude Code skill also pre-allows those tools (`allowed-tools: Bash(sdlc *), mcp__knowledge__*`).

4. Explain what the rule does not cover:
   - the `sdlc` server;
   - servers that are not in the registry;
   - a server without `stages` (like `telegram` here);
   - any call while there is no active change;
   - calls the CLI makes itself (`verify.mcp`, `release.mcp`, events, `sdlc team sync`).

5. Optional: give each stage its skills and subagents. They are listed in the same "Stage resources" section:

   ```yaml
   stages:
     design: { skills: [architecture-review], agents: [sdlc-researcher] }
     build:  { skills: [test-driven-development], agents: [sdlc-simplifier] }
   ```

### Check yourself

- `.claude/skills/sdlc-spec/SKILL.md` names `knowledge` and not `github`.
- In `block` mode, a GitHub call during the design stage is denied with `[sdlc:mcp-stage]`.

### Pitfalls

- When two changes are active at different stages, a server is allowed if any of those stages is in its list.
- `stages: []` or no `stages` means "not checked", not "never". The agent can still call `telegram`. Claude Code
  asks the person before it uses an MCP tool that is not allowed; Oleg should not allow `mcp__telegram__*`.
- An open change is never at the `maintain` stage: its stage is plan, design, build, test or deploy. A server listed
  only for `maintain` is therefore outside its stages whenever a change is active.
- Hook denial in this lesson: `sdlc guide denials#mcp-stage`.

### On screen (for the video)

- The stages table, then `sdlc status` showing `add-due-dates` at `design`.
- The denied call in Claude Code; highlight the stage list and the current stage in the reason.
- The "Stage resources" section of the spec workflow.

---

## Lesson 2.4 — GitHub Actions as gate evidence, and the inbox            (video: ~8 min)

**Role:** Sergey configures; Oleg and Anna see the result   **Project:** tasklet
**You need:** lessons 2.1 and 2.2; a CI workflow in GitHub Actions

**Goal.** The verify gate passes only when the CI run for the exact head commit is green. The CLI asks GitHub
itself, so the evidence does not depend on what the agent says. Results from runs outside the agent's session
reach the agent through the inbox.

### Steps

1. Sergey adds the CI workflow, `.github/workflows/ci.yml`:

   ```yaml
   name: ci
   on: push
   jobs:
     test:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: 22 }
         - run: npm ci
         - run: npm run build
         - run: npm run lint
         - run: npm test
   ```

2. Sergey adds an MCP check to the `verify` block of `openspec/sdlc.yaml`:

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
         args:                        # argument names of that tool: take them from the server's documentation
           owner: northwind-labs
           repo: tasklet
           workflow_id: ci.yml
           head_sha: "${HEAD}"
           per_page: 1
         expect:
           workflow_runs:
             - { status: completed, conclusion: success }
   ```

   | Key | Meaning |
   |---|---|
   | `server`, `tool` | the registry server and the tool the CLI calls |
   | `args` | the tool's arguments; `${HEAD}` becomes the head commit, `${CHANGE}` the change id |
   | `expect` | what the answer must contain (a deep subset: objects by key, lists item by item) |
   | `required` | `true` by default; a failing required check fails the verification |

3. Explain the run. Oleg's agent finishes the build, commits, and Oleg pushes the branch. CI runs on that commit.
   Then the agent runs `/sdlc:verify`, which calls `sdlc verify`:
   - the CLI runs `build`, `lint` and `test` locally;
   - then it calls `list_workflow_runs` on the GitHub server itself, with the head commit;
   - the answer must match `expect`. A mismatch, a tool error, a timeout (60 seconds) or an unreachable server fails
     the check with a reason. For a mismatch the reason names the key, the expected and the actual value, in the form
     `workflow_runs[0].conclusion: expected "success", got null`.

4. Show a failed run. Real output when the GitHub server could not be reached:

   ```text
   → ci-green: github/list_workflow_runs (MCP)
   ✗ ci-green (github/list_workflow_runs, 0.2s)
       the server github could not be reached: Streamable HTTP error: Error POSTing to endpoint: bad request: …

   Verification failed - fix the code (not the tests) and run `sdlc verify` again.
   ```

   The result goes into `verification.md` and `.sdlc.yaml` next to the command results, under `mcp`.

5. **The inbox.** Anna runs `sdlc verify` in her own terminal in the evening, not in an agent session. The MCP
   check results of such a run are also written to `openspec/.sdlc/inbox/`, for the agent. She commits them with
   the rest. The next morning Oleg's Claude Code session starts with this line in its context (real):

   ```text
   - inbox: add-due-dates, check ci-green: failed (once read: `sdlc inbox done 20261009T202717197Z-ci-green-4715ea`)
   ```

6. The agent works through the inbox and marks each item read. `inbox done` decides nothing, so the agent may run it:

   ```bash
   sdlc inbox list
   sdlc inbox done 20261009T202717197Z-ci-green-4715ea
   ```

   ```text
   20261009T202717197Z-ci-green-4715ea  add-due-dates  ci-green (github/list_workflow_runs)  failed
   Marked read: 20261009T202717197Z-ci-green-4715ea
   ```

### Check yourself

- `sdlc status --change add-due-dates` shows the verify gate as passed only after CI is green for the head commit.
- `verification.md` lists `ci-green` with its result next to `build`, `lint` and `test`.
- After `inbox done`, `sdlc inbox list` shows the item as `(read)`.

### Pitfalls

- Commit and push before you verify. `${HEAD}` is the last commit; uncommitted code is not what CI tested.
- A CI run that is still in progress fails the check (`status` is not `completed`). Wait for CI, then verify again.
- `expect` compares lists item by item and by length. A tool that returns a list of runs needs a filter that
  returns exactly the run you mean (here `head_sha` and `per_page: 1`).
- `sdlc verify --only ci-green` runs only that check. It records evidence but never passes the gate.
- `sdlc verify --list` lists the commands only, not the MCP checks.
- The agent cannot edit the evidence or the inbox files: the hook denies it (`sdlc guide denials#state-integrity`).
- When CI produces inbox results, CI has to commit them; the inbox travels by git.

### On screen (for the video)

- The CI run on GitHub, then the `verify.mcp` block; draw an arrow from `${HEAD}` to the commit SHA of the run.
- `sdlc verify` output with the MCP check line.
- The session-start inbox line, then `inbox list` and `inbox done`.

---

## Lesson 2.5 — Release checks: `release.mcp` and `sdlc release check`            (video: ~6 min)

**Role:** Sergey configures; Elena (release manager) approves   **Project:** tasklet   **You need:** lesson 2.4

**Goal.** Elena cannot approve a release until an outside system agrees, for example the release workflow passed
for the commit she is releasing. Anyone can run the checks beforehand.

### Steps

1. Sergey makes the release gate required for `tasklet` and adds the release check:

   ```yaml
   gates:
     release: { required: true, approvers: [release-manager] }
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

   `release.mcp` has the same format as `verify.mcp`. Here `release.yml` is Northwind's workflow that deploys to
   staging and runs smoke tests.

2. While the agent prepares the release (`/sdlc:release`), it runs the checks. They write nothing, so the agent may:

   ```bash
   sdlc release check --change add-due-dates
   ```

   Real output when the check fails:

   ```text
   ✗ staging-deploy-green (github/list_workflow_runs, 0.1s)
       the server github could not be reached: Streamable HTTP error: Error POSTing to endpoint: bad request: …

   Required release checks failed: 1.
   ```

   The command exits 1. When everything passes it prints "Every required release check passed."

3. Elena approves in her own terminal:

   ```bash
   sdlc approve release --change add-due-dates
   ```

   The CLI runs the checks again. While a required check fails, the approval is refused:

   ```text
   The release cannot be approved: required release.mcp checks failed: … Nothing was written.
   ```

   with the fix "Fix the cause and check again: `sdlc release check --change add-due-dates`". When the checks pass,
   the approval is recorded together with the check results.

### Check yourself

- `sdlc release check --change add-due-dates` exits 0 after the release workflow is green.
- `.sdlc.yaml` of the change shows the release approval by Elena with the check results kept next to it.

### Pitfalls

- With `release.required: false` (the default) nobody asks for the release gate, so `release.mcp` rarely matters.
- `sdlc approve release` is a person's command; an agent's attempt is denied (`denials#separation-of-duties`).
- A production deploy command run by the agent is denied until the release is approved
  (`sdlc guide denials#release-gate`).
- Elena needs `${GITHUB_TOKEN}` in her own environment: the CLI calls GitHub from her machine.

### On screen (for the video)

- The `release.mcp` block next to the `verify.mcp` block: same shape, different gate.
- The failing `release check`, then Elena's refused approval, then the green check and the approval.

---

## Lesson 2.6 — Events to Telegram: waits, approvals, overdue gates            (video: ~8 min)

**Role:** Sergey configures; Maria and Olga receive   **Project:** tasklet
**You need:** lesson 2.1; a team Telegram bot server whose tool accepts sdlc's `event` argument

**Goal.** The team's Telegram chat learns when a gate waits for someone, when a gate is approved or sent back, and
when a wait is overdue, without anyone asking `sdlc next`.

### Steps

1. Sergey describes the receiver in `openspec/sdlc.yaml`:

   ```yaml
   events:
     - server: telegram
       tool: report_event             # the tool name your server exposes
       on:
         - "gate.*.awaiting"
         - "gate.*.overdue"
         - "gate.*.approved"
         - "gate.*.rejected"
         - "gate.*.rework"
         - "verify.failed"
         - "change.archived"
       args: { chat: tasklet-team }
   gates:
     intent: { required: true, approvers: [product-owner], overdue_hours: 24 }
     review: { required: true, approvers: [code-owner], overdue_hours: 8 }
   ```

   | Key | Meaning |
   |---|---|
   | `server`, `tool` | a registry server and the tool sdlc calls for each event |
   | `on` | patterns of event names; `*` stands for any text. Without `on`: `gate.*`, `verify.*`, `change.created`, `change.archived`, `backlog.*`, `health.degraded`, `health.recovered` |
   | `args` | static arguments sent with every event |
   | `gates.<g>.overdue_hours` | a wait longer than this raises `gate.<g>.overdue` once |

   Hook events (`hook.denied`, …) are sent only when a pattern names them.

2. Explain what the bot receives. After each sdlc command, sdlc calls the tool with the static `args` and an `event`
   object. Real example, from `sdlc events list --json`:

   ```json
   {
     "id": "01e35e4a45f2a8403f052bf5",
     "project": "tasklet",
     "event": "gate.intent.awaiting",
     "change": "add-due-dates",
     "gate": "intent",
     "at": "2026-10-09T20:26:09.312Z",
     "sdlc": "0.14.4",
     "waitingFor": ["maria"]
   }
   ```

   `waitingFor` holds the person ids from `roles.yaml`; an approval carries `by` instead. An event never carries an
   email, a command, its output or a note. The bot turns it into a message such as "add-due-dates waits for Maria:
   intent". Mapping `maria` to her Telegram account is the bot's job.

3. Show the queue. Delivery takes at most five seconds after a command and never fails the command. What could not
   be sent waits in `.git/sdlc/outbox/`, which is never committed:

   ```bash
   sdlc events list
   ```

   ```text
   Receiver telegram/report_event: gate.*.awaiting, gate.*.overdue, gate.*.approved, gate.*.rejected, gate.*.rework, verify.failed, change.archived
   Events waiting for delivery: 3
     2026-10-09T20:26:09.312Z  gate.intent.awaiting  add-due-dates
     2026-10-09T20:27:17.643Z  verify.failed  add-due-dates
     2026-10-09T20:34:17.743Z  gate.intent.approved  add-due-dates
   ```

4. Deliver now, for example after the bot was down:

   ```bash
   sdlc events flush
   ```

   ```text
   Delivered: 0; not delivered (they wait): 1.
   ```

   This real output is from a machine where the bot server was not installed. `flush` also records the waiting and
   overdue gates first, as `status` and `next` do. It exits 0 either way.

5. **Overdue gates on time.** sdlc has no daemon: a wait is found overdue by the next command, session start or
   `sdlc events flush`. Sergey runs the flush on a schedule, from a dedicated clone on a team machine that keeps its
   log between runs:

   ```bash
   # every 30 minutes (cron, or Windows Task Scheduler)
   cd /srv/sdlc/tasklet && git pull --autostash && sdlc events flush
   ```

   `--autostash` keeps the clone's own log entries across the pull; the log merges line by line (`merge=union`).

6. **The daily summary.** sdlc ships an example script, `assets/examples/daily-summary.mjs` in the installed package
   (`$(npm root -g)/sdlc/assets/examples/`). It writes `daily-summary-<date>.md`: what was approved or archived in
   the last day, what comes next, what is blocked and what waits on people. It publishes nothing by itself. Northwind
   sends the file with the Bot API, outside sdlc:

   ```bash
   # every weekday at 08:00, in the same dedicated clone
   node "$(npm root -g)/sdlc/assets/examples/daily-summary.mjs" --out reports
   curl -F chat_id="$TASKLET_CHAT_ID" -F document=@"reports/daily-summary-$(date +%F).md" \
     "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument"
   ```

### Check yourself

- After Maria's approval, the chat shows `gate.intent.approved` for `add-due-dates` by `maria`.
- `sdlc events list` shows "No events wait for delivery." on a machine with the token set.
- 24 hours after an unanswered intent, the chat gets one `gate.intent.overdue` message naming Maria.

### Pitfalls

- Events are sent from the machine where the command ran. Every person who runs sdlc commands, and the agent's
  shell, needs `${TELEGRAM_BOT_TOKEN}`. Without it, the events wait in that clone's outbox.
- A fresh CI checkout starts from the committed log each time. A scheduled flush there can announce the same wait
  again and miss an overdue gate. Use a clone that keeps its log, as in step 5.
- Several clones can each announce the same wait before their logs are merged. The event ids then differ, so the
  bot cannot drop such repeats by `id`; it can by change, gate and event name.
- A generic Telegram server with only `send_message(chat_id, text)` cannot take sdlc's `event` object. The team's
  bot server needs a tool that accepts it.
- `events` must name a server of `mcp.servers`; an unknown name is a configuration error.

### On screen (for the video)

- The `events` block; highlight `on` and `overdue_hours`.
- The JSON event next to the Telegram message it becomes.
- `events list`, the bot coming back, `events flush`, the chat filling up.
- The scheduled job and the daily summary file in the chat.

---

## Lesson 2.7 — Other AI systems read the process: `sdlc mcp serve`            (video: ~6 min)

**Role:** Sergey sets up; Olga (engineering manager) and Maria use it   **Project:** both
**You need:** lesson 1.2 (`--mcp`); Claude Desktop or another MCP client

**Goal.** Olga asks a chat assistant about both projects ("what waits for Maria?") and gets answers from sdlc's own
data. The assistant can read, but it cannot decide anything.

### Steps

1. Explain the server. `sdlc mcp serve` speaks MCP over stdio. `sdlc init --mcp` registered it for the project's
   tools in lesson 1.2. Its tools answer exactly what the matching CLI command prints with `--json`:

   | Tool | Answers like |
   |---|---|
   | `status` | `sdlc status --json` |
   | `next` | `sdlc next --json` |
   | `instructions` | `sdlc instructions <artifact> --change <id> --json` |
   | `trace` | `sdlc trace <change> --json` |
   | `audit` | `sdlc audit --json` |
   | `help` | `sdlc help --json` |
   | `guide` | `sdlc guide --json` |

   Read-only resources: `sdlc://context/<file>`, `sdlc://spec/<capability>`, `sdlc://change/<id>/<artifact>` and
   `sdlc://doc/<path>`. State, configuration, the log and the inbox are never offered.

2. Show a real connection. A small script lists the tools and calls `next` in `tasklet`:

   ```text
   [sdlc mcp] serving C:\work\tasklet over stdio (version 0.14.4)
   status, next, instructions, trace, audit, help, guide
   {"change":"add-due-dates","stage":"plan","stageTitle":"Plan (intent)","track":"full","next":{"actor":"human", …
   "message":"Maria (product-owner) must review and approve the intent gate (intent)." …
   ```

3. Set up Olga's Claude Desktop for both projects. She edits `claude_desktop_config.json`:

   ```json
   {
     "mcpServers": {
       "sdlc": {
         "command": "sdlc",
         "args": ["mcp", "serve", "--project", "C:\\work\\tasklet", "--project", "C:\\work\\billing-api"]
       }
     }
   }
   ```

   With several projects, each tool takes a `project` argument: `project.name` from `openspec/sdlc.yaml`
   (`tasklet`), else the folder name. `status` without it answers for all projects.

4. Olga asks in plain words:

   > Which gates are waiting for a person in tasklet and billing-api, and for how long?

   > What did we rework this month, and why?

   The assistant answers from `next`, `status` and `audit`. Described: it names `add-due-dates` waiting for Maria
   at the intent gate.

5. Maria asks her own assistant to prepare an approval:

   > Summarize the intent of add-due-dates and what changed since I last looked.

   The assistant reads `sdlc://change/add-due-dates/intent`. Approving is still `sdlc approve intent` in Maria's
   own terminal. There is no approve tool.

6. The knowledge server's roles and skills. With `team: { registry: knowledge }` in `openspec/sdlc.yaml`,
   `sdlc team sync` takes the agent roles and skills from the knowledge server first (its tools `list_roles`,
   `get_role`, `list_skills`, `get_skill`), checks each item against its checksum and writes drafts. A person
   accepts each role. Module 3 (People and the agent team) covers it.

### Check yourself

- Olga's assistant lists both projects by name.
- Asking the assistant to approve a gate gets an explanation and the command for the right person, not an approval.

### Pitfalls

- The server runs locally over stdio; there is no HTTP endpoint for another machine. Central reports read each
  repository instead (`sdlc report --format json`, `sdlc dashboard`).
- A folder that is not an sdlc project, or two projects with the same name, stop the server at start.
- Treat a connected chat client as someone with read access to the repository: it sees change names, people from
  `roles.yaml`, file paths and the audit history.
- Each tool call starts the CLI anew, about half a second per call.

### On screen (for the video)

- The tools table, then the script output with the seven tool names.
- Olga's Claude Desktop answering about both projects.
- Maria's assistant summarizing the intent; then Maria's own terminal for the approval.

---

## Gaps found

Things this scenario wanted that sdlc 0.14.4 does not do. One line each, for the backlog.

1. No sync between GitHub Issues or Projects and `openspec/backlog.md`; only `--source-ref` links and the agent.
2. No built-in CI check: `verify.mcp` needs the GitHub server's tool and argument names; sdlc does not validate them.
3. `expect` matches lists by exact length; a list of runs needs a filter that returns one item ("any item" is missing).
4. `verify.mcp` and `release.mcp` do not wait for a CI run in progress; a pending run fails and must be rerun.
5. `sdlc verify --list` lists the commands only, not the `verify.mcp` checks.
6. `sdlc mcp check` lists tool names only, not their input arguments.
7. `sdlc mcp check` always exits 0; a CI step must parse the JSON to fail on an unreachable server.
8. `sdlc doctor` does not check that the registry's `${VAR}` references are set in the environment.
9. A registry server cannot be marked CLI-only (event receiver, check target); every one is laid out for the agents.
10. `stages: []` means "not checked", not "never"; the agent cannot be forbidden a server outright.
11. An open change is never at `maintain`, so a `maintain`-only server is out of stage during `/sdlc:triage`.
12. Events carry person ids; `roles.yaml` has no chat handle, so each receiver keeps its own mapping.
13. Events are a structured `event` argument with no message template; a plain `send_message` server cannot receive.
14. Events are sent only from the clone where the command ran; every person needs the receiver's secret.
15. A scheduled `events flush` in a fresh CI checkout can repeat waits and miss overdue gates; it needs a kept clone.
16. Several clones can announce one wait with different event ids, so a receiver cannot deduplicate by `id`.
17. The daily summary example only writes a file; sending it to a chat is outside sdlc.
18. `sdlc mcp serve` is stdio only; no remote endpoint for a chat client on another machine.
19. Context packs come only from local `docs/context/`; sdlc does not pull documents from the knowledge server.
20. `sdlc init` with flags cannot create a starter `roles.yaml`; only the wizard (or `sdlc adopt --apply`) does.
21. Doc gap: 10-integrations.md (10.1) lists six `sdlc mcp serve` tools; the server also has `guide`.

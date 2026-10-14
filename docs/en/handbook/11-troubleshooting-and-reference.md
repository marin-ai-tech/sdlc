# 11. Troubleshooting and quick reference

The first part of this chapter is three short lessons: checking the installation, reading a hook denial, and moving a
change that does not move. The rest is reference material to keep open next to the terminal: common problems, the
questions people ask, a cheat sheet per role, a glossary and the reference of every command. The chapter ends with
the gaps this handbook found in sdlc. All outputs are real, from a trial run of `tasklet` with sdlc 0.14.4, unless a
step says otherwise. The command reference (11.8) and the rows for 0.19.0 and 0.20.0 were checked against sdlc
0.20.0.

## Contents

- [11.1 Check the installation with `sdlc doctor`](#s11-1)
- [11.2 Why the hook said no](#s11-2)
- [11.3 A change that does not move](#s11-3)
- [11.4 Common problems](#s11-4)
- [11.5 Questions people ask](#s11-5)
- [11.6 Cheat sheet per role](#s11-6)
- [11.7 Glossary](#s11-7)
- [11.8 Command reference](#s11-8)
- [Known limitations](#known-limitations)


<a id="s11-1"></a>
## 11.1 Check the installation with `sdlc doctor`

*Steven (anyone may run it)  ·  both  · needs: sdlc installed*

Run `sdlc doctor`, read each line, and apply the fix it names.

### Procedure

1. Run it in the project folder:

   ```bash
   sdlc doctor
   ```

   Each line has a mark, a check name, the finding and, for a problem, a `fix:` line:

   ```text
   ✓ node             Node.js 24.21.0
   ✓ harness          sdlc 0.14.4
   ✓ openspec         OpenSpec 1.13.2 (bundled)
   ✓ sdlc.yaml        enforcement block, tools claude, cursor, codex, qwen
   ✓ generated files  159 tracked, 0 missing, 0 edited locally
   ! qwen             Hooks and permissions.deny installed in .qwen/settings.json; Project hooks run only in a trusted
                      folder; folder trust is off by default
                      fix: Turn folder trust on and trust this folder
   ✓ cli on PATH      `sdlc` is on PATH (hooks, plugin and skills call `sdlc`)
   ✓ verify commands  test
   ✓ git hook         prepare-commit-msg in .git/hooks/prepare-commit-msg: commits made in agent sessions get an
                      SDLC-Agent trailer
   ```

   In sdlc 0.20.0 the output starts with one `Required Notice:` line of the license.

   `✓` is fine, `!` is a warning, `✗` is an error. The command exits 1 when there is an error, else 0. It never changes
   anything itself: it tells a person what to do.

2. Know what each check looks at:

   | Check | What it looks at | Fix it names |
   |---|---|---|
   | `node` | Node.js version | install Node.js 20.19 or newer |
   | `harness` | the sdlc version | — |
   | `openspec` | the bundled OpenSpec runs, version 1.13.2 or newer | reinstall sdlc, or `npm install -g @fission-ai/openspec` |
   | `openspec cli`, `codegraph` | optional tools on PATH; whether codegraph indexed the project | optional |
   | `project` | an `openspec/` folder here or above | `sdlc init` |
   | `sdlc.yaml` | `openspec/sdlc.yaml` exists; enforcement mode and tools | `sdlc init` |
   | `openspec config` | `openspec/config.yaml` and its default schema | — |
   | `sdlc schema` | `openspec/schemas/sdlc` installed and valid | `sdlc update` |
   | `generated files` | files tracked, missing, edited locally, made by an older sdlc | `sdlc update` (`--force` restores edited files) |
   | `license` | the project's license and the sdlc license it uses | a person records it with `sdlc license set` |
   | `project log` | entries in `openspec/.sdlc/log.jsonl`, or the log is off | `log.enabled` in `sdlc.yaml` |
   | `approval signing` | the `signing` mode of `roles.yaml` | — |
   | `claude hooks` | sdlc's hooks in `.claude/settings.json` | `sdlc update` |
   | `hooks disabled` | `disableAllHooks: true` in a Claude Code settings file | a person removes it |
   | `opencode plugin` | `.opencode/plugins/sdlc.js` | `sdlc update` |
   | `cursor`, `codex`, `qwen`, `gigacode` | the tool's hooks and rules, and the trust step it needs | [Section 10.3](10-multi-agent.md#s10-3) |
   | `cli on PATH` | the command in `cli` can be found | install globally, or `cli: npx --no-install sdlc` and `sdlc update` |
   | `verify commands` | `verify.commands` exist ("none configured - the verify gate cannot pass") | add build, test and lint commands |
   | `review policy` | `REVIEW.md` (or `review.policy`) exists | `sdlc init` creates a starter |
   | `change <id>` | each active change can be read; its stage | — |
   | `git` | a git repository, and `user.email` set (needed to record approvals) | `git init`; `git config user.email you@example.com` |
   | `git hook` | the `prepare-commit-msg` hook: current, chained, the project's own, missing, outdated, or a shared hooks folder | `sdlc update`, or add the one chain line to your hook |

3. Since 0.16.1, run `sdlc doctor --fix` for fixes sdlc owns. Its JSON output lists `fixed` and `manual`.
   A person handles the remaining configuration findings: `openspec/sdlc.yaml` and tool settings are protected
   from the agent. After the fixes, run `sdlc doctor` again.

### You are done when

- `sdlc doctor` exits 0 and has no `✗` line.
- `cli on PATH` and `git hook` are `✓`.

### Pitfalls

- `cli on PATH` must be true in the shell the tool uses for hooks: PowerShell for Cursor and Codex on Windows, cmd.exe
  for Qwen Code. A `sdlc` that only Git Bash can find is not enough.
- A tool that answers `--version` very slowly is still found, but its version may stay unknown.
- The `!` lines for Cursor, Codex, Qwen Code and GigaCode stay after you do the trust step; they remind, they do not
  fail.


<a id="s11-2"></a>
## 11.2 Why the hook said no

*Oliver (anyone working with an agent)  ·  tasklet  · needs: Claude Code with sdlc's hooks*

Read a denial, find its rule, and know the right next step for each of the twelve rules.

### Procedure

1. Read the denial. Every denial starts with its rule in brackets and ends with the guide section. Oliver asks the
   agent to start coding before the plan is approved:

   ```text
   [sdlc:plan-gate] No active change has an approved plan yet (fix-empty-title). Finish the plan and have an engineer
   run `sdlc approve plan --change <id>` before editing src/title.js. Why, and what to do:
   `sdlc guide denials#plan-gate`.
   ```

2. Open the guide section, in the terminal or by asking the agent:

   ```bash
   sdlc guide denials#plan-gate
   ```

   > /sdlc:guide why did the hook deny the edit of src/title.js?

3. Know the two kinds of rules. **Hard rules** deny in `warn` and `block` mode. **Process rules** deny only in
   `block` mode; in `warn` mode they remind. `enforcement.mode: off` switches the process rules off.

4. Use the denials index:

   | Rule | Kind | Why it stops the agent | What to do |
   |---|---|---|---|
   | `plan-gate` | process | code (or a shell write to code) before any plan is approved | the agent writes the plan; an engineer runs `sdlc approve plan --change <id>` |
   | `protected-path` | hard | the path is in `enforcement.protected_paths` | change it through its owning process, outside the agent session |
   | `tests-locked` | hard | the bug fix locked the tests (`sdlc tests lock`) | fix the code; if the test is wrong, a person runs `sdlc tests unlock --change <id>` |
   | `state-integrity` | hard | `.sdlc.yaml`, `roles.yaml`, the log, the inbox, the team record, the backlog are written only by the CLI | use the commands: `sdlc backlog add`, `sdlc verify`, a person's `sdlc approve` |
   | `guard-config` | hard | the file configures the guard (`sdlc.yaml`, hook and MCP files, generated sdlc files, `REVIEW.md`, the schema) | a person makes the change; `sdlc update` restores generated files |
   | `separation-of-duties` | hard | the command is a person's decision (`approve`, `reject`, `waive`, `rework`, `takeover`, `track set`, `backlog move`, `uninstall`, ...) | the agent gives the person the exact command for their own terminal |
   | `agent-marker` | hard | the command clears an agent marker (`CLAUDECODE`, `CODEX_CI`, `QWEN_CODE`, ...) | run it without touching these variables |
   | `cli-removal` | hard | the command would uninstall the sdlc CLI | a person removes it, if that is really wanted |
   | `secret-in-edit` | hard | the edit adds a key, a token or a password | read it from an environment variable (`process.env.X`, `${VAR}`); test data goes under `enforcement.secret_allow` (a person adds it) |
   | `release-gate` | hard | a production release command (`release.commands`) before the release approval | prepare `release.md`; the release manager runs `sdlc approve release --change <id>` |
   | `takeover` | hard | a person holds the change (`sdlc takeover`) | wait for `sdlc release-control`; read-only commands still work |
   | `mcp-stage` | process | the MCP server is not meant for the current stage (`mcp.servers.<name>.stages`) | wait for a listed stage, or a person adds the stage |

5. See a hard rule in action. The agent tries to lower the enforcement mode:

   ```text
   [sdlc:guard-config] openspec/sdlc.yaml configures the sdlc guard (enforcement mode, hooks, plugin, MCP servers); an
   agent may not change it. Ask a person to make the change themselves; `sdlc update` restores the generated files.
   Why, and what to do: `sdlc guide denials#guard-config`.
   ```

### You are done when

- For any denial, you can name its kind (hard or process) and the person who unblocks it.
- `sdlc guide denials#takeover` prints the takeover section.

### Pitfalls

- Do not try to get around a denial with another spelling (a script, `cmd /c`, `node -e`). Shell writes are read from
  the command text in every tool; most spellings are caught, and repeated denials appear in `sdlc health` as
  `discipline.denials`.
- A `!sdlc approve ...` typed in the agent chat runs in the agent's shell and is refused. Use your own terminal.
- To relax the process rules for a while, a person sets `enforcement.mode: warn` in `openspec/sdlc.yaml`. Hard rules
  still apply.


<a id="s11-3"></a>
## 11.3 A change that does not move

*Megan, Ethan, Oliver  ·  tasklet  · needs: an active change*

Find out why a change is stuck and unblock it: open questions, a stale approval, a rework, a takeover.

### Procedure

1. Ask the one question that answers most cases:

   ```bash
   sdlc explain --change fix-empty-title
   ```

   ```text
   fix-empty-title: Plan (intent)
   Open gate: intent (pending): awaiting approval (product-owner; 0 of 1).

   Waiting for: person. Approval still missing from: product-owner.

   What unblocks it:
     1. person: 1 open question(s) in intent.md wait for a person's answer before the intent gate can be approved ...
        $ sdlc answer 1 --change fix-empty-title --text "…"
   ```

   It writes nothing; the agent may ask it as often as it likes.

2. Open questions. Megan answers in her own terminal; then the gate can be approved:

   ```bash
   sdlc answer --change fix-empty-title --list
   sdlc answer 1 --change fix-empty-title --text "Yes: a title of spaces only is empty"
   sdlc approve intent --change fix-empty-title
   ```

   An answer typed into `intent.md` by hand or by the agent does not count; only `sdlc answer` records it.

3. A stale approval. Someone edits `intent.md` after Megan approved it. `sdlc status --change fix-empty-title` shows:

   ```text
   gates
     intent   ↻ stale              content changed after approval; re-approval needed
   next      person: The intent artifacts changed after approval; Megan (product-owner) must re-approve.
              $ sdlc approve intent --change fix-empty-title --as product-owner
   ```

   Before approving again, Megan looks at what changed:

   ```bash
   sdlc approve intent --change fix-empty-title --preview
   ```

   ```text
   Approval preview: gate intent of change fix-empty-title (stale)
   Artifacts:
     intent  intent.md
   Changed since the last approval: intent.md
   Approvals: 0 of 1
   You may approve it:
   $ sdlc approve intent --change fix-empty-title
   ```

4. A rework. A person sent a gate back (`sdlc rework <gate> --reason ... --note ...`). The gate counts as rejected
   until it is approved again, and the approvals of the later gates stop counting too. The agent revises the
   artifacts. Then the gate waits for the person again: `sdlc next` names them, `next --me` lists it, and
   `gate.<gate>.awaiting` is sent; the person approves again. Approving the same content again after a rework
   needs `--note` (`unchanged_after_rework`). After `rework.max_cycles` reworks of one gate (default 3),
   `sdlc next` asks a person to take the change over or review its scope.

5. A held change. Ethan took the change over:

   ```bash
   sdlc takeover --change fix-empty-title --note "I will rewrite the intent myself"
   ```

   Until he hands it back, the agent is denied:

   ```text
   [sdlc:takeover] fix-empty-title is taken over by Ethan <ethan@northwind.example> (I will rewrite the intent myself)
   and has no plan.md, so the agent is paused in the whole project until the person hands it back with
   `sdlc release-control --change fix-empty-title`. ...
   ```

   With a `plan.md`, the agent is paused only in the change folder and the plan's files. Ethan hands it back:

   ```bash
   sdlc release-control --change fix-empty-title --note "Intent rewritten, carry on"
   ```

6. What waits for me? Each person can ask for their own list: `sdlc next --me`. It lists the gates, across the
   active changes, that this git identity may decide now, with the command. It prints `Nothing is waiting for you.`
   when there are none (a gate that still waits for answers is not listed yet).

### You are done when

- `sdlc explain` names who the change waits for and the command that unblocks it.
- After a stale approval, `--preview` lists the changed files, and a new approval clears `stale`.

### Pitfalls

- Committing does not make an approval stale; editing does. Review and release approvals are bound to the code as
  well as to the artifacts.
- Answering an open question after the gate was approved changes the artifact, so that approval goes stale.
- With several active changes, most commands need `--change <id>`.


<a id="s11-4"></a>
## 11.4 Common problems


| Problem | Likely cause | What to do |
|---|---|---|
| The agent edits code before the plan is approved, with no denial | `sdlc` is not on the PATH of the tool's shell (the hooks let the call through), the hooks are not trusted (Codex, Qwen Code), or the mode is `off` | `sdlc doctor`; fix `cli on PATH`; trust the hooks; check `enforcement.mode` |
| The plan gate denies an agent's code edit although its change has an approved plan | several changes are active, and the file is not listed under `## Files that change` in an approved plan, or `plan.md` was edited after its approval | add the file to the plan and have the plan approved again, or finish the other change first |
| `sdlc: command not found` in hooks | sdlc installed per project, or only Git Bash finds it | install globally, or set `cli: npx --no-install sdlc` and run `sdlc update` |
| Codex ignores the hooks | the hooks are not trusted, or changed since | open `/hooks` in Codex and trust sdlc's hooks |
| Qwen Code or GigaCode ignores the hooks | folder trust is off (the default) | turn folder trust on and trust the project folder |
| Cursor's hooks fail on Windows | Cursor runs hooks through PowerShell; a Git Bash terminal can break them | set Cursor's terminal to PowerShell |
| `sdlc approve` says it "cannot run inside an agent session" | you ran it in the agent's terminal or as `!sdlc approve` | run it in your own terminal |
| `sdlc approve` refuses with `unknown_person` or `missing_role` | your git email is not in `roles.yaml`, or you do not hold the role | `sdlc roles who <gate> --change <id>`; ask the maintainer to change `roles.yaml` |
| The review approval is refused for the author | `author_cannot_approve: [review, release]` | `sdlc review suggest --change <id>` names who may approve |
| The intent or spec gate refuses with `open_questions` | open questions have no recorded answer | `sdlc answer --list`, then `sdlc answer <n> --text "…"` |
| The spec gate refuses with `debate_required` | `design.debate: true` and design.md has no full `## Debate` | the agent runs the debate in `/sdlc:spec` |
| The verify gate cannot pass | no `verify.commands`, or a required check fails | add the commands (a person); fix the code; `sdlc verify` again |
| Verification became stale with no code change | a new file outside `openspec/` (a report, a dashboard, an export) or a regenerated agent file | add `reports/` to `.gitignore`; write exports outside the repository; run `sdlc verify` again |
| The review gate stays blocked | open findings at a blocking severity, or lens coverage missing | `sdlc review check --change <id>`; fix or defer (`sdlc defer add`) |
| The release approval is refused with `release_checks_failed` | a `release.mcp` check did not agree | `sdlc release check --change <id>` shows which and why |
| An approval stopped counting | the artifact or the code changed after it (stale), or a rework of an earlier gate | `sdlc approve <gate> --change <id> --preview`, then approve again |
| Approving again is refused with `unchanged_after_rework` | nothing changed since the approval before the rework | change the artifact, or approve with `--note` saying why nothing had to change |
| The agent is paused everywhere | a person took a change over that has no plan.md | the person runs `sdlc release-control --change <id> --note "…"` |
| Plan drift says every planned file is untouched | you commit on the base branch itself (the default base is `origin/HEAD`, then `main`, then `master`) | work on a branch, or set `review.base` |
| `--out must stay inside the project` | `sdlc report` or `sdlc dashboard` with an outside path | write inside the project (and ignore it), or redirect: `sdlc report > ../file.md` |
| The audit export is refused | the folder exists and is not empty, or it is inside `openspec/` | choose a new folder outside the repository |
| Events never arrive | the receiver's server is unreachable, or the tool rejects the `event` argument | `sdlc events list`; `sdlc mcp check`; `sdlc events flush` |
| `mcp_secret_literal` | a literal token in `mcp.servers` | write `${VAR}` and keep the value in the environment |
| The daily summary does not arrive | no receiver names `summary.daily` (it is opt-in), or it was already sent today | add `summary.daily` (or `summary.*`) to a receiver's `on`; `sdlc events summary --json` shows `alreadySent` |
| `sdlc mcp serve --http` does not start: `token_required` | `SDLC_MCP_TOKEN` is not set, or shorter than 16 characters | export a secret of 16 characters or more in the environment; it is never a flag |
| An HTTP MCP client gets 401 or 403 | no token or another token (401); an `Origin` header of another host (403) | send `Authorization: Bearer <token>`; use the address the server printed |
| `sdlc backlog import --issues` refuses with `issues_not_configured` | `openspec/sdlc.yaml` has no `issues:` | a person adds `issues: { server: <a server of mcp.servers>, repo: <owner/name> }` |
| The linked GitHub issue stays open after the archive | the GitHub server failed during the archive; the comment and the close wait in the outbox | `sdlc events list`; `sdlc events flush` |
| `sdlc triage intake` refuses with `invalid_alert` | the input is not one JSON object with a non-empty `id` and `title` | pass `{"id":"…","title":"…"}` on stdin; `severity` and `url` are optional |
| `sdlc task export` refuses with `plan_not_approved` | the plan gate is not approved, or `plan.md` changed after the approval | have the plan approved (again), then export |
| `sdlc task export` or `check-result` names `unknown_task` | the task is not in the change's `tasks.md` | `sdlc task export --change <id> --json` lists the open tasks |
| `sdlc task export` names `executor_required`, `unknown_executor` or `executor_not_allowed` | the registry is in use: no executor named, the id is not in it, or its `max_risk`/`kinds` do not cover the change | `sdlc task executors` lists the registry; pick an allowed id or have a person extend it |
| `sdlc task executors` or `export` names `executors_invalid` | `openspec/executors.yaml` is broken (bad id, unknown type or field, missing or bad `max_risk`, a `token_sha256` that is not 64 lowercase hex) | a person fixes the file; the message names the executor and the field |
| `sdlc task check-result` names `missing_agent`, `unknown_executor` or `executor_not_allowed` | a commit's first `SDLC-Agent` trailer is missing, or names an executor that is not in the registry or not allowed | the executor ends commits with `SDLC-Agent: <executor>/<agent>`; a person updates the registry |
| `sdlc task check-result` names `missing_trailer` or `forbidden_path` | a commit has no `SDLC-Change` or `SDLC-Task` trailer, or the branch touches a forbidden path | add the trailers to the commits; undo the changes to the forbidden paths |
| `sdlc board claim` names `task_claimed`, `task_done` or `task_submitted` | a live claim holds the task, it is done, or already submitted | `sdlc board list` shows who holds it and until when |
| `sdlc board heartbeat`, `release` or `submit` names `claim_unknown` or `claim_expired` | the claim id is wrong or ended, or the lease ran out | only a live claim heartbeats, releases or submits; claim again with `board claim` |
| a `board` command names `board_invalid` or `board_locked` | `openspec/.sdlc/board.json` is broken, or another process holds the lock | fix the file by hand; a lock older than ~30 s is broken automatically |
| `sdlc approve` says "cannot be approved yet: waiting for the judge" | the gate has a judge (`gates.<g>.judge`) and no passing verdict for the current artifacts | the agent runs `sdlc judge --gate <g> --change <id>` and reworks until the verdict passes (Lesson 5.11) |
| `sdlc judge` says "The judge answer was not a verdict" (`judge_invalid_answer`) | the judge printed no JSON verdict `{ pass, route, rework }` | fix the judge (the team's command or tool), then run `sdlc judge` again; nothing was recorded |
| `sdlc next` hands the gate to a person: "the author-critic loop stopped" | the judge rejected the artifacts `max_loops` times | the person reads the judge's notes and decides: approve, reject or `sdlc rework` |
| `sdlc team sync` or `sdlc team accept --pack` names `pack_not_pinned` | a pack with workflows or checks points at a tag or a branch | set `ref` to the commit (`git rev-parse <tag>`) or `npm` to an exact version; `sdlc team sync`; accept again |
| `pack_forbidden_command` | a check or a workflow of the pack calls a person's command (`approve`, `tests unlock`, ...) | remove that command from the pack; a pack can never approve or unlock (Lesson 3.7) |
| A pack's lens, workflow or check is not in effect | nobody accepted the pack, or its content changed after the acceptance | a person (with `roles.yaml`, a maintainer) runs `sdlc team accept --pack <name>` || A change commits with no `SDLC-Agent` trailer | a person committed, the project has its own git hook, or the tool set no marker | `sdlc doctor` (`git hook` line); [Section 10.4](10-multi-agent.md#s10-4) |



<a id="s11-5"></a>
## 11.5 Questions people ask


**I typed "approve" in the chat. Why is the gate still waiting?**
An answer in the chat is never an approval. Run `sdlc approve <gate> --change <id>` in your own terminal.

**The gate says "stale". What happened?**
An approved artifact (or, for review and release, the code) changed after the approval. Look with
`sdlc approve <gate> --change <id> --preview`, then approve again.

**Verification was green, now it is stale.**
The code changed after `sdlc verify`. Editing makes it stale; committing does not. Run `sdlc verify` again.

**What is waiting for me?**
`sdlc next --me`.

**Who should review this?**
`sdlc review suggest --change <id>`.

**How do I skip intent and spec for a small fix?**
The lite track: `sdlc track set lite --change <id>`, a person's decision (`sdlc guide tracks`).

**The agent did something wrong in an earlier stage.**
`sdlc rework <gate> --change <id> --reason <category> --note "…"` (`sdlc guide rework`).

**I want to fix it myself without the agent interfering.**
`sdlc takeover --change <id> --note "…"`, and `sdlc release-control --change <id> --note "…"` when you are done.

**Can the agent run the reports and the audit?**
Yes. `report`, `dashboard`, `health`, `audit`, `trace`, `changelog`, `log`, `explain` and `approvals verify` only
read. Since 0.19.0, so do `sdlc task export` and `sdlc task check-result`. The agent cannot approve, reject, waive,
rework, take over, unlock tests, order the backlog or set the license.

**Where is the history of decisions?**
`sdlc audit --change <id>`, `sdlc log`, and `sdlc trace <id>` from intent to evidence.

**An auditor asks for evidence.**
`sdlc audit --export <new folder> [--since <date>]`, and `sdlc approvals verify` for the signatures.

**How much of the code did agents commit?**
`sdlc audit` prints `agent commits: N of M`; each agent commit carries `SDLC-Agent: <tool>`.

**Can I use Cursor while my colleague uses Claude Code?**
Yes. `sdlc init --tools claude,cursor` (or `sdlc update --tools ...`) serves both from the same `openspec/`.

**Is GigaCode supported?**
Experimentally. Check on your installation that an early edit is denied and `sdlc approve` is refused ([Lesson
10.3](10-multi-agent.md#s10-3)).

**Does sdlc send anything to Telegram, Slack or email by itself?**
No. `events` call a tool of an MCP server you configure. Since 0.19.0 the daily summary is such an event too
(`sdlc events summary`). Your MCP server does the sending.

**Can a person or a tool outside the team's agent tools do a task?**
Yes. Since 0.19.0 `sdlc task export --change <id> --json` gives the work item, and
`sdlc task check-result --change <id> --branch <ref> --json` checks the branch that comes back. The gates stay the same.

**Can a model approve a gate for us?**
No. A judge (`gates.<g>.judge`, Lesson 5.11) checks the artifacts by the team's rubric and records a verdict. A
passing verdict lets a person approve; it never approves. After `max_loops` failing verdicts a person decides.

**Can a company pack change our process?**
Only after a person accepts it with `sdlc team accept --pack <name>` (Lesson 3.7). A pack brings lenses, workflows
and checks; it can never approve or unlock, and its checks run as an agent.
**I am new. Where do I start?**
`sdlc guide tour`: seven short steps through the calculator demo. `sdlc guide` lists every topic.



<a id="s11-6"></a>
## 11.6 Cheat sheet per role


Commands marked **(person)** refuse inside an agent session; run them in your own terminal. Workflows are shown in
Claude Code spelling; in Cursor, OpenCode, Qwen Code and GigaCode use `/sdlc-<name>`, in Codex `$sdlc-<name>`.

### Megan — product owner

| Run in the terminal | Ask the agent |
|---|---|
| `sdlc next --me` | `/sdlc:backlog` — see the backlog, decompose an epic into items |
| `sdlc answer --change <id> --list`, `sdlc answer <n> --change <id> --text "…"` **(person)** | `/sdlc:explore <idea>` — research an idea first |
| `sdlc approve intent --change <id> [--preview]` **(person)** | `/sdlc:intent "…"` — capture an idea as intent.md |
| `sdlc approve spec --change <id>` **(person)** | `/sdlc:status` — where every change is |
| `sdlc reject <gate> --change <id> --note "…"` **(person)** | |
| `sdlc rework intent --change <id> --reason <r> --note "…"` **(person)** | |
| `sdlc backlog move B<n> --top`, `sdlc backlog drop B<n> --note "…"` **(person)** | |

### Ethan — tech lead and architect

| Run in the terminal | Ask the agent |
|---|---|
| `sdlc approve spec --change <id> --as tech-lead` (high risk) **(person)** | `/sdlc:spec` — proposal, delta specs, design |
| `sdlc approve plan --change <id>` **(person)** | `/sdlc:plan` — plan.md and tasks.md |
| `sdlc rework plan --change <id> --reason <r> --note "…"` **(person)** | `/sdlc:team` — the agent team's roles |
| `sdlc track set lite --change <id>` **(person)** | `/sdlc:adopt` — prepare an existing project |
| `sdlc waive <gate> --change <id> --note "…"` **(person)** | `/sdlc:guide` — how sdlc works |
| `sdlc takeover`, `sdlc release-control` **(person)** | |
| `sdlc roles who <gate> --change <id>`, `sdlc explain --change <id>` | |
| `sdlc backlog import --issues [--json]` (with `issues:` in `openspec/sdlc.yaml`) | |
| `sdlc task executors [--json]` | |
| `sdlc task executors token <id> [--json]` **(person)** | |
| `sdlc task export --change <id> [--task <n.m>] [--executor <id>] --json` | |
| `sdlc task check-result --change <id> --branch <ref> --json` | |
| `sdlc board list [--change <id>] --json` | |
| `sdlc board dispatch --change <id> --task <n.m> --executor <id> [--lease <s>] --json` | |
| `sdlc board claim --change <id> --task <n.m> --executor <id> --agent <name> --json` | |
| `sdlc board heartbeat|release|submit --claim <id>` | |
| `sdlc board reopen --change <id> --task <n.m> --reason <text> [--escalate] [--json]` | |

### Oliver — developer (Claude Code)

| Run in the terminal | Ask the agent |
|---|---|
| `sdlc status`, `sdlc next`, `sdlc explain --change <id>` | `/sdlc:next` — the next step of the change |
| `sdlc new <id>`, `sdlc backlog start B<n>` | `/sdlc:build` — implement from the approved plan |
| `sdlc verify --change <id>` | `/sdlc:verify` — evidence and independent verification |
| `sdlc tests lock --change <id>` | `/sdlc:triage <alert>` — an incident becomes an intent |
| `sdlc triage intake [--json]` (one alert as JSON on stdin) | |
| `sdlc guide denials#<rule>` | `/sdlc:guide why was this denied?` |
| `sdlc judge --gate <gate> --change <id>` (when the gate has a judge) | |

### Grace — QA engineer

| Run in the terminal | Ask the agent |
|---|---|
| `sdlc verify --change <id> --check [--strict]` (scenarios without a verification row) | `/sdlc:verify` |
| `sdlc verify --list`, `sdlc verify --only <names>` | `/sdlc:triage <failing build>` |
| `sdlc trace <id>` (scenarios without evidence) | |
| `sdlc tests unlock --change <id>` **(person)**, only when a locked test is really wrong | |
| `sdlc defer add "<title>" --why "…" --change <id>` | |

### Paul — code owner and reviewer

| Run in the terminal | Ask the agent |
|---|---|
| `sdlc review suggest --change <id>` | `/sdlc:review` — review passes and findings in review.md |
| `sdlc review context --change <id>`, `sdlc review check --change <id>` | |
| `sdlc approve review --change <id> [--preview]` **(person)** | |
| `sdlc reject review --change <id> --note "…"` **(person)** | |
| `sdlc rework review --change <id> --reason <r> --note "…"` **(person)** | |

### Emily — release manager

| Run in the terminal | Ask the agent |
|---|---|
| `sdlc release check --change <id>` | `/sdlc:release` — release.md with changelog, rollout, rollback |
| `sdlc changelog --change <id>` or `--since <date>` | `/sdlc:archive` — close the change |
| `sdlc approve release --change <id> [--preview]` **(person)** | |
| `sdlc reject release --change <id> --note "…"` **(person)** | |

### Steven — platform engineer

| Run in the terminal | Ask the agent |
|---|---|
| `sdlc init --tools … --mcp`, `sdlc update [--tools …]`, `sdlc doctor` | `/sdlc:adopt` |
| `sdlc mcp check`, `sdlc events list`, `sdlc events flush` | `/sdlc:team` |
| `sdlc events summary [--since <date>] [--json]` (scheduled every morning) | |
| `sdlc context pull [--name <name>] [--json]` (packs from the knowledge server) | |
| `sdlc adopt --apply` **(person)**, `sdlc roles migrate` **(person)**, `sdlc roles check` | |
| `sdlc team sync`, `sdlc team list`, `sdlc team check`, `sdlc team accept <role>` **(person)** | |
| `sdlc team accept --pack <name>` **(person)**, `sdlc ci init --provider github` **(person)** | |
| `sdlc license set community` or `commercial --agreement <id> --licensee "<name>"` **(person)** | |
| `sdlc uninstall --dry-run`, `sdlc uninstall` **(person)** | |
| edits `openspec/sdlc.yaml` and `openspec/roles.yaml` by hand (the agent cannot) | |

### Laura — engineering manager

| Run in the terminal | Ask the agent |
|---|---|
| `sdlc report [--since <date>] [--format md\|json\|html] [--out reports/<file>]` | `/sdlc:health` — explain findings, draft backlog items |
| `sdlc dashboard --out reports/dashboard.html` | `/sdlc:status` |
| `sdlc health`, `sdlc audit [--change <id>]`, `sdlc explain --change <id>` | |
| `sdlc trace <id>`, `sdlc changelog`, `sdlc log [--change <id>] [--limit <n>]` | |
| `sdlc approvals verify [--mode required]` | |
| `sdlc audit --export ../evidence-<period> --since <date>` | |
| `sdlc mcp serve --project <path> --project <path>` (in Claude Desktop) | |
| `sdlc mcp serve --http <host:port>` with `SDLC_MCP_TOKEN` in the environment (a central dashboard) | |

### The external auditor

| Do | With |
|---|---|
| read the evidence bundle | `index.md`, `index.json`, `changes/`, `log.jsonl` from Laura's export |
| check signatures in a clone of the repository | `sdlc approvals verify --mode required --json` |
| follow one change from intent to evidence | `sdlc trace <id>`, `sdlc audit --change <id>` |



<a id="s11-7"></a>
## 11.7 Glossary


| Term | Meaning |
|---|---|
| change | one unit of work: an OpenSpec change folder `openspec/changes/<id>/` plus its sdlc record |
| intent | `intent.md`: the problem, the outcome and the open questions; the first gate |
| spec | `proposal.md`, the delta specs under `specs/` and `design.md`; the second gate |
| delta spec | the requirements a change adds, modifies or removes; merged into the living specs on archive |
| living spec | `openspec/specs/<capability>/spec.md`: what the system does now |
| plan | `plan.md` (files that change, order, risks, proof, rollback) and `tasks.md`; the third gate |
| gate | a point where a person decides that the work may go on: intent, spec, plan, review, release (since 0.18.0 also the optional qa gate); verify is a gate of evidence |
| approval | a person's decision on a gate, recorded with the role and a digest of what was approved |
| digest | a hash of the artifacts (and, for review and release, the code) at the time of approval |
| stale | an approval or verification whose content changed afterwards; it no longer counts |
| waiver | a person's decision that a gate does not apply (`sdlc waive`); `auto_waive` is a waiver by policy |
| rework | sending a change back to a gate's stage with a reason (`sdlc rework`) |
| checkpoint | the state saved when a gate was approved (`refs/sdlc/<change>/<gate>`); `rework --reset` restores from it |
| takeover | a person holds a change; the agent may not edit it until `sdlc release-control` |
| track | `full` (all gates) or `lite` (starts at the plan); a person sets it |
| evidence | `verification.md`: the literal output of the checks `sdlc verify` ran, and the behavioral verification table |
| first-pass rate | the share of changes whose first verification passed |
| review finding | an entry in `review.md` with a severity, a pass or lens, and a status |
| pass, lens | the perspectives of a review: passes (bugs, security, compliance) and lenses (adversarial, edge cases, ...) |
| deferred work | a postponed item in `openspec/deferred-work.md` (`D<n>`) |
| backlog item, epic | planned work in `openspec/backlog.md` (`B<n>`, `E<n>`) before a change exists |
| archive | closing a change: every gate checked, delta specs merged into the living specs |
| hook | the tool's own hook that asks sdlc about every edit, shell command and MCP call of the agent |
| hard rule, process rule | hard rules deny in `warn` and `block`; process rules deny only in `block` |
| enforcement mode | `off`, `warn` or `block` in `enforcement.mode` |
| agent marker | the environment variable that marks an agent's shell (`CLAUDECODE`, `CURSOR_AGENT`, `CODEX_CI`, `QWEN_CODE`, ...) |
| `SDLC-Agent` trailer | the commit line that marks a commit made in an agent's shell |
| `SDLC-Approval` trailer | the commit line that ties a commit to one approval |
| `SDLC-Change`, `SDLC-Task` trailers | the commit lines that tie a commit to a change and a task, for `sdlc trace` and `sdlc task check-result` |
| `SDLC-Agent` trailer | `<executor>/<agent>` on each result commit: which registry executor and which of its agents did the work |
| roles.yaml | `openspec/roles.yaml`: people, their emails and signing keys, roles, separation rules |
| separation of duties | rules on who may approve: not the author, different people for gate pairs, a per-person limit |
| signing | approvals arrive in commits signed by the approver; `sdlc approvals verify` checks it |
| MCP registry | `mcp.servers` in `openspec/sdlc.yaml`; sdlc writes it into every tool's MCP file |
| stages (MCP) | the stages at which the agent may call a registry server |
| event receiver | an entry under `events`: a server and tool sdlc calls for matching process events |
| wait id | the id of a `gate.<g>.awaiting` or `gate.<g>.overdue` event: built from the project, the change, the gate, the event and the digest, so it is the same in every clone and in CI |
| chat handle | a person's name in a chat, under `people.<id>.chat` in `roles.yaml` (for example `telegram: "@megan_tg"`); a receiver with `chat:` mentions it |
| daily summary | the event `summary.daily` from `sdlc events summary`: counts and the waiting changes, once per project and day |
| work item | one open task given to an executor by `sdlc task export`, in the contract `sdlc.task/1` |
| executor | an agent swarm of type `representative`, `board`, `market` or `mesh` a person lists in `openspec/executors.yaml` with `max_risk`, optional `kinds` and the `token_sha256` of its access token; agents cannot edit the registry |
| outbox | events that could not be delivered yet, in `.git/sdlc/outbox/`; `sdlc events flush` sends them |
| inbox | MCP check results from runs outside an agent session, for the agent's next session |
| health finding | one observation of `sdlc health`: area, level, facts, recommendation |
| trace gap | a requirement without a scenario, a scenario without evidence, a task without a commit, a finding without a status |
| plan drift | files changed but not in the plan, and planned files not touched |
| judge | an independent model or tool that checks a gate's artifacts by a rubric before a person approves (`gates.<g>.judge`, `sdlc judge`) |
| verdict | the judge's answer `{ pass, route, rework }`, bound to the digest of the artifacts; evidence only, never an approval |
| extension pack | a pack whose lenses, workflows and checks a person accepts with `sdlc team accept --pack <name>`; pinned to a commit or an exact version || manifest | `openspec/.sdlc/manifest.json`: the files sdlc generated, so `update` and `uninstall` touch only those |
| project log | `openspec/.sdlc/log.jsonl`: every harness event with the sdlc version and license |
| context pack | a file in `docs/context/` with an owner, a source and a freshness date, given to the agent at its stages; `sdlc context pull` writes packs from `context.sources` |



<a id="s11-8"></a>
## 11.8 Command reference

Every command of sdlc 0.20.0 and every workflow, from `sdlc help --json`. "Who" is the `actor` of the
command: **anyone** means a person or an agent; **a person** means the command refuses inside an agent session and
the hook denies it to the agent. Options are the common ones; `sdlc <command> --help` lists all of them. Most
commands also take `--json` and, with several active changes, `--change <id>`.

### Set up and maintain the installation

| Command | Who | What it does |
|---|---|---|
| `sdlc init [--tools …] [--mcp]` | anyone | set up the harness: OpenSpec, the sdlc schema, `openspec/sdlc.yaml`, the agent integrations |
| `sdlc init --roles` | a person | create a starter `roles.yaml` for your git identity |
| `sdlc update [--tools …] [--force]` | anyone | regenerate the schema, skills, commands, agents, hooks and plugin after an upgrade |
| `sdlc uninstall [--dry-run]` | a person | remove the generated agent files and hooks; `openspec/` and the planning data stay |
| `sdlc doctor [--fix]` | anyone | check the installation and name a fix for each problem (Lesson 11.1) |
| `sdlc adopt` | anyone | analyze an existing project and draft the sdlc settings |
| `sdlc adopt --apply` | a person | apply the adoption draft: merge the settings, write `roles.yaml` if it does not exist |
| `sdlc layout check` | anyone | check the project layout (the documents agents read) |
| `sdlc layout scaffold` | anyone | create the recommended layout |
| `sdlc layout adapt` | anyone | adapt an existing layout to the recommended one |
| `sdlc layout convert` | anyone | convert the project layout |
| `sdlc ci init --provider github\|gitlab` | a person | write a starter CI configuration that runs the sdlc checks and ends with `sdlc events flush` |
| `sdlc plugin build [dir]` | anyone | render the workflows, subagents and hooks as a Claude Code plugin (default `./plugin`) |
| `sdlc hook pre-tool\|session-start\|stop` | anyone | the policy dispatcher the agent tools call; reads JSON on stdin (you do not run it by hand) |
| `sdlc statusline` | anyone | print the Claude Code status line |
| `sdlc openspec [args]` | anyone | run the bundled OpenSpec CLI, for example `sdlc openspec list --specs` |
| `sdlc license` | anyone | show the sdlc version and the license the project uses sdlc under |
| `sdlc license set community\|commercial` | a person | record a change of the license |

### Roles and the agent team

| Command | Who | What it does |
|---|---|---|
| `sdlc roles check` | anyone | check who can approve each gate |
| `sdlc roles who <gate> --change <id>` | anyone | show the people who may approve a gate |
| `sdlc roles migrate` | a person | move the roles of `sdlc.yaml` into `roles.yaml` |
| `sdlc team sync` | anyone | write role drafts from the registry, the packs and the built-in set; report the packs |
| `sdlc team accept <role> \| --skill <id> \| --pack <name>` | a person | accept a role, a skill or a pack (with `roles.yaml`, the maintainer) |
| `sdlc team list` | anyone | list the roles of the team with their status |
| `sdlc team check` | anyone | check the team skills: checksums, scripts, tool grants, URLs |

### Backlog, deferred work and ideas

| Command | Who | What it does |
|---|---|---|
| `sdlc backlog epic add "<title>" [--goal "…"]` | anyone | add an epic (`E<n>`) |
| `sdlc backlog epic edit E<n>` | anyone | change the title or the goal of an epic |
| `sdlc backlog add "<title>"` | anyone | add a backlog item (`B<n>`) |
| `sdlc backlog edit B<n>` | anyone | refine an item: title, outcome, acceptance criteria, dependencies, kind, risk |
| `sdlc backlog list` | anyone | list the backlog items in order |
| `sdlc backlog next` | anyone | show the next ready item |
| `sdlc backlog start B<n>` | anyone | start an item as a change |
| `sdlc backlog move B<n> --top` | a person | reorder an item (with `roles.yaml`, the product owner) |
| `sdlc backlog drop B<n> --note "…"` | a person | drop an item (with `roles.yaml`, the product owner) |
| `sdlc backlog done B<n>` | anyone | mark an item done |
| `sdlc backlog import [--issues]` | anyone | import open issues into the backlog (`--issues`: GitHub issues through `issues:`) |
| `sdlc defer add "<title>" --why "…"` | anyone | record deferred work (`D<n>`) |
| `sdlc defer list` | anyone | list the deferred work |
| `sdlc defer close D<n> --status done --note "…"` | anyone | resolve a deferred item |
| `sdlc triage intake` | anyone | add one alert (JSON on stdin) as a backlog item |
| `sdlc import bmad <path> [--to-backlog] [--dry-run]` | anyone | import a BMAD planning artifact |
| `sdlc explore [slug]` | anyone | create an optional exploration note before intent |
| `sdlc explore list` | anyone | list the exploration notes |

### A change through its gates

| Command | Who | What it does |
|---|---|---|
| `sdlc new <id>` | anyone | start a change: an OpenSpec change folder and its sdlc record |
| `sdlc status [--change <id>]` | anyone | the dashboard: stage, gates, approvals, evidence, who acts next |
| `sdlc explain --change <id>` | anyone | why a change is where it is and what unblocks it (read-only) |
| `sdlc next [--change <id>] [--me]` | anyone | the next action and who performs it; `--me` lists what waits for you |
| `sdlc instructions <artifact>` | anyone | the instructions for an artifact (intent, proposal, specs, design, plan, tasks, apply, verification, review, release) |
| `sdlc validate` | anyone | `openspec validate --strict` plus the harness checks and overlaps between changes |
| `sdlc judge --gate <gate> --change <id>` | anyone | run the gate's judge and record its verdict (Lesson 5.11) |
| `sdlc answer <n> --change <id> --text "…"` | a person | answer an open question of an intent, proposal or design |
| `sdlc approve <gate> --change <id> [--preview]` | a person | approve a gate, bound to the current content |
| `sdlc reject <gate> --change <id> --note "…"` | a person | reject a gate with a note |
| `sdlc waive <gate> --change <id> --note "…"` | a person | waive a gate with a recorded reason |
| `sdlc rework <gate> --change <id> --reason <r> --note "…"` | a person | send a change back to a gate's stage |
| `sdlc takeover --change <id> --note "…"` | a person | take a change over: no agent edits until you hand it back |
| `sdlc release-control --change <id> --note "…"` | a person | hand a taken-over change back to the agent |
| `sdlc track set full\|lite --change <id>` | a person | set the full or the lite track |
| `sdlc tests lock --change <id>` | anyone | lock the test files of a bug fix |
| `sdlc tests unlock --change <id>` | a person | unlock the test files |
| `sdlc verify [--change <id>] [--check] [--list]` | anyone | run the configured checks and record literal evidence (the verify gate) |
| `sdlc review context\|check --change <id>` | anyone | the review context (diff, policy, plan drift, lenses), or the open blocking findings |
| `sdlc review suggest --change <id>` | anyone | suggest a reviewer, owners of the changed files first |
| `sdlc release check --change <id>` | anyone | run the `release.mcp` checks without approving; writes nothing |
| `sdlc task executors` | anyone | list the executors of `openspec/executors.yaml` (read-only) |
| `sdlc task executors token <id>` | a person | issue the executor a new token for `sdlc mcp serve --http`: printed once, only its SHA-256 is kept; a new token or removing the executor revokes the old one at once |
| `sdlc task export --change <id> [--task <n.m>] [--executor <id>] --json` | anyone | export the open tasks as `sdlc.task/1` work items (needs an approved plan; with a registry, `--executor` names who gets the work) |
| `sdlc task check-result --change <id> --branch <ref>` | anyone | check a returned branch: trailers, forbidden paths, files outside the plan (read-only) |
| `sdlc board list [--change <id>]` | anyone | the open tasks on the board and their claim state (read-only) |
| `sdlc board dispatch --change <id> --task <n.m> --executor <id>` | anyone | reserve a task for a lease |
| `sdlc board claim --change <id> --task <n.m> --executor <id> --agent <name>` | anyone | claim one task for an executor's agent under a lease (writes the board state file) |
| `sdlc board heartbeat|release|submit --claim <id>` | the claim holder | renew the lease, give the task back, or submit the result branch |
| `sdlc board reopen` | anyone | reopen a submitted result; escalation excludes its executor |
| `sdlc archive <id>` | anyone | check every required gate, then merge the delta specs into the living specs |

### Reports and audit (read-only)

| Command | Who | What it does |
|---|---|---|
| `sdlc audit [--change <id>] [--export <dir>]` | anyone | the audit trail and the SDLC metrics; `--export` writes an evidence bundle |
| `sdlc report [--format md\|json\|html]` | anyone | the project progress report |
| `sdlc dashboard --out reports/dashboard.html` | anyone | a self-contained HTML dashboard |
| `sdlc health` | anyone | process health findings, each with facts and a recommendation (no score) |
| `sdlc trace <id>` | anyone | trace a change from intent to evidence, with the gaps |
| `sdlc changelog --change <id> \| --since <date>` | anyone | the changelog from the delta specs |
| `sdlc log [--change <id>] [--limit <n>]` | anyone | the project log: harness events with the sdlc version and license |
| `sdlc approvals verify [--mode required]` | anyone | verify the approval and roles commit signatures |

### MCP, events and context

| Command | Who | What it does |
|---|---|---|
| `sdlc mcp serve [--project <path>] [--http <host:port>]` | anyone | serve the process read-only to other AI systems (stdio or HTTP) |
| `sdlc mcp check` | anyone | connect to each registry server and list its tools |
| `sdlc context pull [--name <name>]` | anyone | pull context packs from the knowledge servers into `docs/context/` |
| `sdlc events list` | anyone | list the events that wait for delivery and their receivers |
| `sdlc events flush` | anyone | deliver the waiting events now |
| `sdlc events summary [--since <date>]` | anyone | record and send the daily summary, once per day |
| `sdlc inbox list` | anyone | list the inbox (check results from runs outside an agent session), newest first |
| `sdlc inbox done <id>` | anyone | mark an inbox item read |

### Help

| Command | Who | What it does |
|---|---|---|
| `sdlc help [--json]` | anyone | list the workflows and the commands, with who may run each |
| `sdlc guide [topic]` | anyone | explain how sdlc works: the topics, one article or one section |

### Workflows

You ask the agent for these. Claude Code spelling; in Cursor, OpenCode, Qwen Code and GigaCode use `/sdlc-<name>`,
in Codex `$sdlc-<name>`. A workflow runs as the agent, so it never approves.

| Workflow | What it does |
|---|---|
| `/sdlc:help` | show the workflows and the current project state |
| `/sdlc:guide` | explain how sdlc works in this project, or why the hook said no |
| `/sdlc:next` | move a change to its next step |
| `/sdlc:status` | every active change, its gates and who acts next |
| `/sdlc:health` | explain the health findings and draft improvements as backlog items |
| `/sdlc:adopt` | prepare an existing project for agents |
| `/sdlc:team` | set up the agent team: role drafts for a person to accept |
| `/sdlc:backlog` | see the backlog, decompose an epic, bring an item to ready and start it |
| `/sdlc:explore` | research an idea before intent |
| `/sdlc:intent` | capture an idea as `intent.md` (stage 1, Plan) |
| `/sdlc:spec` | proposal, delta specs and design (stage 2, Design) |
| `/sdlc:plan` | `plan.md` and `tasks.md` for the engineer (stage 3, Build) |
| `/sdlc:build` | implement from the approved plan |
| `/sdlc:verify` | evidence with `sdlc verify` and an independent check (stage 4, Test) |
| `/sdlc:review` | review passes and findings in `review.md` (stage 5, Deploy) |
| `/sdlc:release` | `release.md` up to the production gate |
| `/sdlc:archive` | close the change and merge its specs |
| `/sdlc:triage` | turn an alert or an incident into an intent (stage 6, Maintain) |


<a id="known-limitations"></a>
## Known limitations


What this handbook needed and sdlc does not offer, or does differently from its documentation, checked against sdlc
0.20.0. One line each.

- The health thresholds can be set only in `openspec/sdlc.yaml`.

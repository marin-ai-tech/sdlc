# Module 11. Troubleshooting and quick reference

The first part of this module is three short lessons: checking the installation, reading a hook denial, and moving a
change that does not move. The rest is reference material to keep open next to the terminal: common problems, the
questions people ask, a cheat sheet per role and a glossary. The module ends with the gaps this course found in sdlc.

In this module:

- Lesson 11.1 — Check the installation with `sdlc doctor`
- Lesson 11.2 — Why the hook said no
- Lesson 11.3 — A change that does not move
- Reference 11.4 — Common problems
- Reference 11.5 — Questions people ask
- Reference 11.6 — Cheat sheet per role
- Reference 11.7 — Glossary
- Gaps found

All outputs are real, from a trial run of `tasklet` with sdlc 0.14.4, unless a step says otherwise.

---

## Lesson 11.1 — Check the installation with `sdlc doctor`            (video: ~5 min)

**Role:** Sergey (anyone may run it)   **Project:** both   **You need:** sdlc installed

**Goal.** Run `sdlc doctor`, read each line, and apply the fix it names.

### Steps

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
   | `cursor`, `codex`, `qwen`, `gigacode` | the tool's hooks and rules, and the trust step it needs | Lesson 10.3 |
   | `cli on PATH` | the command in `cli` can be found | install globally, or `cli: npx --no-install sdlc` and `sdlc update` |
   | `verify commands` | `verify.commands` exist ("none configured - the verify gate cannot pass") | add build, test and lint commands |
   | `review policy` | `REVIEW.md` (or `review.policy`) exists | `sdlc init` creates a starter |
   | `change <id>` | each active change can be read; its stage | — |
   | `git` | a git repository, and `user.email` set (needed to record approvals) | `git init`; `git config user.email you@example.com` |
   | `git hook` | the `prepare-commit-msg` hook: current, chained, the project's own, missing, outdated, or a shared hooks folder | `sdlc update`, or add the one chain line to your hook |

3. Apply the fixes. Configuration fixes are a person's work: `openspec/sdlc.yaml` and the tools' settings are protected
   from the agent. After a fix, run `sdlc doctor` again.

### Check yourself

- `sdlc doctor` exits 0 and has no `✗` line.
- `cli on PATH` and `git hook` are `✓`.

### Pitfalls

- `cli on PATH` must be true in the shell the tool uses for hooks: PowerShell for Cursor and Codex on Windows, cmd.exe
  for Qwen Code. A `sdlc` that only Git Bash can find is not enough.
- A tool that answers `--version` very slowly is still found, but its version may stay unknown.
- The `!` lines for Cursor, Codex, Qwen Code and GigaCode stay after you do the trust step; they remind, they do not
  fail.

### On screen (for the video)

- Run `sdlc doctor` on a fresh clone of `billing-api`; read the marks from top to bottom.
- Break one thing on purpose (remove `verify.commands`), run it again, show the `fix:` line, then restore it.

---

## Lesson 11.2 — Why the hook said no            (video: ~6 min)

**Role:** Oleg (anyone working with an agent)   **Project:** tasklet   **You need:** Claude Code with sdlc's hooks

**Goal.** Read a denial, find its rule, and know the right next step for each of the twelve rules.

### Steps

1. Read the denial. Every denial starts with its rule in brackets and ends with the guide section. Oleg asks the
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

### Check yourself

- For any denial, you can name its kind (hard or process) and the person who unblocks it.
- `sdlc guide denials#takeover` prints the takeover section.

### Pitfalls

- Do not try to get around a denial with another spelling (a script, `cmd /c`, `node -e`). Shell writes are read from
  the command text in every tool; most spellings are caught, and repeated denials appear in `sdlc health` as
  `discipline.denials`.
- A `!sdlc approve ...` typed in the agent chat runs in the agent's shell and is refused. Use your own terminal.
- To relax the process rules for a while, a person sets `enforcement.mode: warn` in `openspec/sdlc.yaml`. Hard rules
  still apply.

### On screen (for the video)

- Trigger three denials in a row: `plan-gate`, `separation-of-duties`, `guard-config`.
- For each, highlight the bracket, then run the `sdlc guide denials#…` command it names.
- Show the index table as the closing slide.

---

## Lesson 11.3 — A change that does not move            (video: ~7 min)

**Role:** Maria, Ivan, Oleg   **Project:** tasklet   **You need:** an active change

**Goal.** Find out why a change is stuck and unblock it: open questions, a stale approval, a rework, a takeover.

### Steps

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

2. Open questions. Maria answers in her own terminal; then the gate can be approved:

   ```bash
   sdlc answer --change fix-empty-title --list
   sdlc answer 1 --change fix-empty-title --text "Yes: a title of spaces only is empty"
   sdlc approve intent --change fix-empty-title
   ```

   An answer typed into `intent.md` by hand or by the agent does not count; only `sdlc answer` records it.

3. A stale approval. Someone edits `intent.md` after Maria approved it. `sdlc status --change fix-empty-title` shows:

   ```text
   gates
     intent   ↻ stale              content changed after approval; re-approval needed
   next      person: The intent artifacts changed after approval; Maria (product-owner) must re-approve.
              $ sdlc approve intent --change fix-empty-title --as product-owner
   ```

   Before approving again, Maria looks at what changed:

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
   artifacts; the person approves again. Approving the same content again after a rework needs `--note`
   (`unchanged_after_rework`). After `rework.max_cycles` reworks of one gate (default 3), `sdlc next` asks a person to
   take the change over or review its scope.

5. A held change. Ivan took the change over:

   ```bash
   sdlc takeover --change fix-empty-title --note "I will rewrite the intent myself"
   ```

   Until he hands it back, the agent is denied:

   ```text
   [sdlc:takeover] fix-empty-title is taken over by Ivan <ivan@northwind.example> (I will rewrite the intent myself)
   and has no plan.md, so the agent is paused in the whole project until the person hands it back with
   `sdlc release-control --change fix-empty-title`. ...
   ```

   With a `plan.md`, the agent is paused only in the change folder and the plan's files. Ivan hands it back:

   ```bash
   sdlc release-control --change fix-empty-title --note "Intent rewritten, carry on"
   ```

6. What waits for me? Each person can ask for their own list: `sdlc next --me`. It lists the gates, across the
   active changes, that this git identity may decide now, with the command. It prints `Nothing is waiting for you.`
   when there are none (a gate that still waits for answers is not listed yet).

### Check yourself

- `sdlc explain` names who the change waits for and the command that unblocks it.
- After a stale approval, `--preview` lists the changed files, and a new approval clears `stale`.

### Pitfalls

- Committing does not make an approval stale; editing does. Review and release approvals are bound to the code as
  well as to the artifacts.
- Answering an open question after the gate was approved changes the artifact, so that approval goes stale.
- With several active changes, most commands need `--change <id>`.

### On screen (for the video)

- Start with a stuck change on the dashboard; run `sdlc explain`.
- Show the stale gate in `sdlc status`, then `--preview`, then Maria's new approval.
- Show the takeover denial in Claude Code and the hand-back note that the agent reads next.

---

## Reference 11.4 — Common problems

| Problem | Likely cause | What to do |
|---|---|---|
| The agent edits code before the plan is approved, with no denial | `sdlc` is not on the PATH of the tool's shell (the hooks let the call through), the hooks are not trusted (Codex, Qwen Code), or the mode is `off` | `sdlc doctor`; fix `cli on PATH`; trust the hooks; check `enforcement.mode` |
| The agent edits code of one change while another change has an approved plan | the plan gate opens code edits once any active change has an approved plan | keep one active change per checkout, or review the diff against the plan (`sdlc review context`) |
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
| `--since works only together with --export` | `sdlc audit --since` without `--export` | use `sdlc report --since`, or add `--export <dir>` |
| The audit export is refused | the folder exists and is not empty, or it is inside `openspec/` | choose a new folder outside the repository |
| Events never arrive | the receiver's server is unreachable, or the tool rejects the `event` argument | `sdlc events list`; `sdlc mcp check`; `sdlc events flush` |
| `mcp_secret_literal` | a literal token in `mcp.servers` | write `${VAR}` and keep the value in the environment |
| A change commits with no `SDLC-Agent` trailer | a person committed, the project has its own git hook, or the tool set no marker | `sdlc doctor` (`git hook` line); Lesson 10.4 |

---

## Reference 11.5 — Questions people ask

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
read. The agent cannot approve, reject, waive, rework, take over, unlock tests, order the backlog or set the license.

**Where is the history of decisions?**
`sdlc audit --change <id>`, `sdlc log`, and `sdlc trace <id>` from intent to evidence.

**An auditor asks for evidence.**
`sdlc audit --export <new folder> [--since <date>]`, and `sdlc approvals verify` for the signatures.

**How much of the code did agents commit?**
`sdlc audit` prints `agent commits: N of M`; each agent commit carries `SDLC-Agent: <tool>`.

**Can I use Cursor while my colleague uses Claude Code?**
Yes. `sdlc init --tools claude,cursor` (or `sdlc update --tools ...`) serves both from the same `openspec/`.

**Is GigaCode supported?**
Experimentally. Check on your installation that an early edit is denied and `sdlc approve` is refused (Lesson 10.3).

**Does sdlc send anything to Telegram, Slack or email by itself?**
No. `events` call a tool of an MCP server you configure, and the daily summary script writes a file. Your server or
your script does the sending.

**I am new. Where do I start?**
`sdlc guide tour`: seven short steps through the calculator demo. `sdlc guide` lists every topic.

---

## Reference 11.6 — Cheat sheet per role

Commands marked **(person)** refuse inside an agent session; run them in your own terminal. Workflows are shown in
Claude Code spelling; in Cursor, OpenCode, Qwen Code and GigaCode use `/sdlc-<name>`, in Codex `$sdlc-<name>`.

### Maria — product owner

| Run in the terminal | Ask the agent |
|---|---|
| `sdlc next --me` | `/sdlc:backlog` — see the backlog, decompose an epic into items |
| `sdlc answer --change <id> --list`, `sdlc answer <n> --change <id> --text "…"` **(person)** | `/sdlc:explore <idea>` — research an idea first |
| `sdlc approve intent --change <id> [--preview]` **(person)** | `/sdlc:intent "…"` — capture an idea as intent.md |
| `sdlc approve spec --change <id>` **(person)** | `/sdlc:status` — where every change is |
| `sdlc reject <gate> --change <id> --note "…"` **(person)** | |
| `sdlc rework intent --change <id> --reason <r> --note "…"` **(person)** | |
| `sdlc backlog move B<n> --top`, `sdlc backlog drop B<n> --note "…"` **(person)** | |

### Ivan — tech lead and architect

| Run in the terminal | Ask the agent |
|---|---|
| `sdlc approve spec --change <id> --as tech-lead` (high risk) **(person)** | `/sdlc:spec` — proposal, delta specs, design |
| `sdlc approve plan --change <id>` **(person)** | `/sdlc:plan` — plan.md and tasks.md |
| `sdlc rework plan --change <id> --reason <r> --note "…"` **(person)** | `/sdlc:team` — the agent team's roles |
| `sdlc track set lite --change <id>` **(person)** | `/sdlc:adopt` — prepare an existing project |
| `sdlc waive <gate> --change <id> --note "…"` **(person)** | `/sdlc:guide` — how sdlc works |
| `sdlc takeover`, `sdlc release-control` **(person)** | |
| `sdlc roles who <gate> --change <id>`, `sdlc explain --change <id>` | |

### Oleg — developer (Claude Code)

| Run in the terminal | Ask the agent |
|---|---|
| `sdlc status`, `sdlc next`, `sdlc explain --change <id>` | `/sdlc:next` — the next step of the change |
| `sdlc new <id>`, `sdlc backlog start B<n>` | `/sdlc:build` — implement from the approved plan |
| `sdlc verify --change <id>` | `/sdlc:verify` — evidence and independent verification |
| `sdlc tests lock --change <id>` | `/sdlc:triage <alert>` — an incident becomes an intent |
| `sdlc guide denials#<rule>` | `/sdlc:guide why was this denied?` |

### Anna — QA engineer

| Run in the terminal | Ask the agent |
|---|---|
| `sdlc verify --change <id> --check [--strict]` (scenarios without a verification row) | `/sdlc:verify` |
| `sdlc verify --list`, `sdlc verify --only <names>` | `/sdlc:triage <failing build>` |
| `sdlc trace <id>` (scenarios without evidence) | |
| `sdlc tests unlock --change <id>` **(person)**, only when a locked test is really wrong | |
| `sdlc defer add "<title>" --why "…" --change <id>` | |

### Pavel — code owner and reviewer

| Run in the terminal | Ask the agent |
|---|---|
| `sdlc review suggest --change <id>` | `/sdlc:review` — review passes and findings in review.md |
| `sdlc review context --change <id>`, `sdlc review check --change <id>` | |
| `sdlc approve review --change <id> [--preview]` **(person)** | |
| `sdlc reject review --change <id> --note "…"` **(person)** | |
| `sdlc rework review --change <id> --reason <r> --note "…"` **(person)** | |

### Elena — release manager

| Run in the terminal | Ask the agent |
|---|---|
| `sdlc release check --change <id>` | `/sdlc:release` — release.md with changelog, rollout, rollback |
| `sdlc changelog --change <id>` or `--since <date>` | `/sdlc:archive` — close the change |
| `sdlc approve release --change <id> [--preview]` **(person)** | |
| `sdlc reject release --change <id> --note "…"` **(person)** | |

### Sergey — platform engineer

| Run in the terminal | Ask the agent |
|---|---|
| `sdlc init --tools … --mcp`, `sdlc update [--tools …]`, `sdlc doctor` | `/sdlc:adopt` |
| `sdlc mcp check`, `sdlc events list`, `sdlc events flush` | `/sdlc:team` |
| `sdlc adopt --apply` **(person)**, `sdlc roles migrate` **(person)**, `sdlc roles check` | |
| `sdlc team sync`, `sdlc team check`, `sdlc team accept <role>` **(person)** | |
| `sdlc license set community` or `commercial --agreement <id> --licensee "<name>"` **(person)** | |
| `sdlc uninstall --dry-run`, `sdlc uninstall` **(person)** | |
| edits `openspec/sdlc.yaml` and `openspec/roles.yaml` by hand (the agent cannot) | |

### Olga — engineering manager

| Run in the terminal | Ask the agent |
|---|---|
| `sdlc report [--since <date>] [--format md\|json\|html] [--out reports/<file>]` | `/sdlc:health` — explain findings, draft backlog items |
| `sdlc dashboard --out reports/dashboard.html` | `/sdlc:status` |
| `sdlc health`, `sdlc audit [--change <id>]`, `sdlc explain --change <id>` | |
| `sdlc trace <id>`, `sdlc changelog`, `sdlc log [--change <id>] [--limit <n>]` | |
| `sdlc approvals verify [--mode required]` | |
| `sdlc audit --export ../evidence-<period> --since <date>` | |
| `sdlc mcp serve --project <path> --project <path>` (in Claude Desktop) | |

### The external auditor

| Do | With |
|---|---|
| read the evidence bundle | `index.md`, `index.json`, `changes/`, `log.jsonl` from Olga's export |
| check signatures in a clone of the repository | `sdlc approvals verify --mode required --json` |
| follow one change from intent to evidence | `sdlc trace <id>`, `sdlc audit --change <id>` |

---

## Reference 11.7 — Glossary

| Term | Meaning |
|---|---|
| change | one unit of work: an OpenSpec change folder `openspec/changes/<id>/` plus its sdlc record |
| intent | `intent.md`: the problem, the outcome and the open questions; the first gate |
| spec | `proposal.md`, the delta specs under `specs/` and `design.md`; the second gate |
| delta spec | the requirements a change adds, modifies or removes; merged into the living specs on archive |
| living spec | `openspec/specs/<capability>/spec.md`: what the system does now |
| plan | `plan.md` (files that change, order, risks, proof, rollback) and `tasks.md`; the third gate |
| gate | a point where a person decides that the work may go on: intent, spec, plan, review, release; verify is a gate of evidence |
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
| `SDLC-Change`, `SDLC-Task` trailers | the commit lines that tie a commit to a change and a task, for `sdlc trace` |
| roles.yaml | `openspec/roles.yaml`: people, their emails and signing keys, roles, separation rules |
| separation of duties | rules on who may approve: not the author, different people for gate pairs, a per-person limit |
| signing | approvals arrive in commits signed by the approver; `sdlc approvals verify` checks it |
| MCP registry | `mcp.servers` in `openspec/sdlc.yaml`; sdlc writes it into every tool's MCP file |
| stages (MCP) | the stages at which the agent may call a registry server |
| event receiver | an entry under `events`: a server and tool sdlc calls for matching process events |
| outbox | events that could not be delivered yet, in `.git/sdlc/outbox/`; `sdlc events flush` sends them |
| inbox | MCP check results from runs outside an agent session, for the agent's next session |
| health finding | one observation of `sdlc health`: area, level, facts, recommendation |
| trace gap | a requirement without a scenario, a scenario without evidence, a task without a commit, a finding without a status |
| plan drift | files changed but not in the plan, and planned files not touched |
| manifest | `openspec/.sdlc/manifest.json`: the files sdlc generated, so `update` and `uninstall` touch only those |
| project log | `openspec/.sdlc/log.jsonl`: every harness event with the sdlc version and license |
| context pack | a file in `docs/context/` with an owner, a source and a freshness date, given to the agent at its stages |

---

## Gaps found

What this course needed and sdlc 0.14.4 does not offer, or does differently from its documentation. One line each.

- `sdlc dashboard` has no watch or serve mode; `scripts/examples/dashboard-watch.mjs` does it, but it is not in the npm
  package (`files` lists no `scripts/`), so users must copy it from the repository.
- The daily summary only writes a file; sdlc has no built-in delivery to Telegram (or any channel) and no "daily
  summary" event.
- Event receivers get `{ ...args, event }` with no message template; a typical Telegram MCP server's send tool (chat id
  and text) cannot take it without an adapter tool.
- `sdlc mcp serve` has no `health`, `report` or `explain` tool, so a portfolio view of health over MCP is not possible;
  it needs the CLI per repository.
- `sdlc report --out` and `sdlc dashboard --out` must stay inside the project, and a file written there (untracked, not
  ignored) makes the verification of active changes stale; sdlc does not warn or suggest `.gitignore`.
- `sdlc audit --export` into a folder inside the project (outside `openspec/`) also makes verification stale, with no
  warning.
- `sdlc audit --since` works only with `--export`; the plain audit has no period filter for its metrics.
- `sdlc approvals verify` text output does not show `trailer: found | missing`, which docs/en/13-process-health.md says
  it reports; only `--json` and the export show it.
- After a change is archived, `sdlc audit --change <id>` lists only the commits after the folder moved ("commits
  touching the change folder" does not follow the rename).
- The agents' share of commits is project-wide only; there is no per-change or per-tool share in `sdlc audit`.
- `sdlc doctor` has no option to apply its fixes; every fix is manual.
- Commits from GigaCode carry `SDLC-Agent: qwen`; the audit cannot tell GigaCode from Qwen Code.
- The documentation does not say whether the `mcp-stage` rule works in Codex CLI, Qwen Code and GigaCode (it names
  Claude Code, OpenCode and Cursor tool names only).
- `sdlc guide denials` says "The Claude Code hook and the OpenCode plugin check every edit"; it does not mention Cursor,
  Codex, Qwen Code and GigaCode, which apply the same rules.
- The plan gate is project-wide: once any active change has an approved plan, the agent may edit any code file, also for
  another change that has no plan (seen in a trial; not documented).
- `sdlc next --me` does not list a gate that waits for a person's answers to open questions, although that person is the
  one who must act.
- `sdlc explain` names the missing role ("Approval still missing from: product-owner") but not the people, while
  `sdlc next` and `sdlc status` name them from `roles.yaml`.
- The health thresholds can be set only in `openspec/sdlc.yaml`; `sdlc health` has no `--since` or window option for a
  one-off look.

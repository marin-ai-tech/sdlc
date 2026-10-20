# Changelog

All notable changes to sdlc. Versions follow [Semantic Versioning](https://semver.org/); while the major version is 0, a minor version may change behavior.

## 0.24.0 — 2026-10-20

### Added
- `sdlc approve <gate> --expect-digest <digest>` approves only the version the person read. When the gate's digest
  changed since, the approval is refused with the error code `digest_changed`, naming both versions, before anything
  is written: no approval, no log entry, no wait record, no checkpoint. It takes the full `sha256:<hex>` or the 12
  characters that `approve` prints; programs should pass the full digest. With `--preview`, the same check is listed
  as a refusal.
- `sdlc report --json`: each gate gains `digest` (when it has one), `approvals` and `staleApprovals`, each approval as
  `{role, by, person?, at, digest}`.
- `sdlc next --me --json`: an `approve-gate` item gains `digest`, from the same evaluation as its `cli`.
- `sdlc approve --preview --json` gives the gate's current `digest`.
- The `gate.<g>.approved` and `gate.<g>.rejected` log entries carry `digest` as a field, so `sdlc log --json` shows
  which version was decided. Integration event bodies are unchanged.

### Compatibility
- Every JSON output only gains fields. Older log entries without `digest` read as before, and older versions read the
  new entries.

## 0.23.7 — 2026-10-18

### Changed
- `sdlc next` names the unticked tasks whose commits (trailers `SDLC-Change` and `SDLC-Task`) are already in HEAD and
  says to mark them done in tasks.md, for example after board results were merged.
- `sdlc board list` says when `openspec/.sdlc/log.jsonl` has uncommitted changes: the board host writes the board trail
  there and has to commit it.

### Fixed
- A queued wait event whose gate no longer waits on that digest (approved, rejected, waived, archived or changed) is
  dropped when the queue is sent, instead of reaching the chat out of date.
- Reading commands never create or rewrite a tracked file: when `openspec/.sdlc/.gitignore` lacks the queue's rule,
  it goes into `.git/info/exclude`; an existing file that has the rule is not rewritten (CRLF or LF).

## 0.23.6 — 2026-10-18

### Changed
- `sdlc init` and `sdlc update` change only the lines of the keys they set in `openspec/sdlc.yaml` (for example
  `tools`); every other line stays byte for byte.
- One name per tool: hook decisions record Claude Code as `claude-code`, like commit trailers and log events; the
  audit groups older `claude` entries with it.
- A team role that takes the place of a built-in subagent keeps what sdlc parses: the reviewer role keeps the exact
  finding format and the coverage line of `review.md`.
- `sdlc doctor` and the Codex guide say that a headless `codex exec` may run no project hooks after trusting them in
  `/hooks`; sdlc's command rules still apply.

### Fixed
- On Windows, `sdlc doctor` warns when Claude Code will not find Git Bash (no `CLAUDE_CODE_GIT_BASH_PATH`, no Git under
  Program Files): sdlc's hooks would not run and every tool call would be blocked. The fix names the variable and the
  bash.exe next to the git on PATH.
- A denied shell command records the files it writes in the hook decision, like an edit.
- `sdlc mcp serve --http` keeps idle connections for 65 seconds: a client that paused about five seconds between
  calls (an executor between board calls) no longer got `fetch failed` / `ECONNRESET`.

## 0.23.5 — 2026-10-18

### Changed
- `outputPath` in the JSON of `sdlc instructions` is relative to the project root (`openspec/changes/<id>/plan.md`),
  so an agent that writes it from the repository root puts the artifact into the change folder.
- Each claim of a task gets its own result branch: the first is `sdlc/<change>/<task>`, later ones
  `sdlc/<change>/<task>-<n>`. A retry no longer overwrites a rejected attempt, and `previousAttempts` keeps the head
  commit (`head`) of each one.
- The board tools over MCP accept numbers (`lease`, `minutes`, `cost`) as JSON numbers as well as strings.

### Fixed
- `sdlc board submit` and `sdlc task check-result` fetch a result branch the executor pushed to `origin` when the board
  host does not have it yet; only from `origin`, only a valid branch name, into a private ref. A name that is not a
  branch name is refused before any git call.
- `sdlc board list` shows a dispatched task without an agent as its executor, not `executor/?`.

## 0.23.4 — 2026-10-18

### Changed
- A settings proposal refuses an unknown key in an `mcp.servers` entry, an `events` receiver or a `context.sources`
  entry, and a source without `server`, naming the path (for example `events[0].events` written instead of
  `events[0].on`). A file already in place keeps working; `sdlc doctor` names its unknown keys.
- `sdlc config show` warns about an empty value in `args`, `headers` or `env` (a shell may have expanded `${…}`); the
  `sdlc-config` workflow says to single-quote such values.
- Event texts and the event's `project` field name `project.name`, else the package.json (or pyproject.toml,
  Cargo.toml, go.mod) name, else the folder. The stable event id still uses only `project.name`, so it stays the same
  in every clone.
- A secret in a person's free text (every `--note`, `answer --text`, `config propose --reason`, backlog titles) is
  masked before it reaches the log, the change record, events or the output, and the command says so.

### Fixed
- `${VAR}` in a receiver's `args` is expanded from the environment when the event is sent; the outbox keeps the
  reference. An unset variable keeps the event waiting and is named by `sdlc events list`, `flush` and `sdlc doctor`.
- The hint about an artifact at the repository root matches the exact file name (the project's `REVIEW.md` is not a
  misplaced `review.md`) and is translated.
- Russian messages write MCP plainly.

## 0.23.3 — 2026-10-18

### Fixed
- Records written before 0.23.2 stay readable. A closed settings proposal (applied or dismissed) whose roles.yaml
  content has a `signing_key` that 0.23.2 no longer accepts no longer breaks `sdlc config show` and `sdlc config propose`;
  an open one is listed, `config show` marks its validation as failed and `config apply` refuses it. Past roles.yaml
  versions read by `sdlc approvals verify` treat such a key as no key; the current roles.yaml stays strict.

## 0.23.2 — 2026-10-18

### Added
- `sdlc health` reports `discipline.log-gaps` when a gate decision in a change record (approved, rejected, waived)
  has no entry in the log, for example after a line was deleted from `openspec/.sdlc/log.jsonl` by hand.
- `sdlc tests unlock --note <text>` records why the tests were unlocked; the log and `sdlc audit` show it.
- The evidence bundle of `sdlc audit --export` names the signing mode and the `signing_since` cutoff, and its legend
  explains `pre-signing`.
- `sdlc trace` lists every task, numbered or not, and reports the gaps `task-without-number` and
  `review-coverage-mismatch` (a coverage count in review.md that the findings do not match).

### Changed
- Commands that only read (status, next, list, show, log, health, audit, the dashboard) record waits in the
  git-ignored local queue, like hook decisions: running them, or an agent that runs them, leaves the working copy
  clean. The next command that writes the log moves the waits into the shared log.
- `sdlc config propose --set` changes only the lines of the keys it sets and keeps everything else byte for byte:
  alignment, flow mappings, comments and CRLF line ends. `sdlc config show` prints a minimal line diff.
- A proposal names the other open proposals for the same file; the `sdlc-config` workflow asks for one proposal per
  change.
- A roles.yaml proposal that turns signing on without `signing_since` says how many approvals are unsigned and will
  fail `sdlc approvals verify`.
- `sdlc next` says where an artifact found at the repository root belongs (`openspec/changes/<id>/plan.md`); the
  plan, build, verify, review and release workflows name `resolvedOutputPath`. The agent guide (AGENTS.md) says that
  the process settings change only through `sdlc config propose`.
- Review coverage may use one `### <pass>` heading per pass; the refusal shows the line a pass needs.

### Fixed
- `signing_key` in roles.yaml must be an OpenSSH public key line; a path or other text is refused naming the person.

## 0.23.1 — 2026-10-17

### Added
- `signing_since: <commit>` in `openspec/roles.yaml`: with `signing: warn` or `required`, approvals recorded in that
  commit or before it count as pre-signing, so a project with history can require signatures from now on. `sdlc
  approvals verify` names the cutoff; a value git cannot resolve is refused there, in the evidence export and in a
  roles.yaml proposal, and `sdlc doctor` reports it. A proposal that adds the key or moves it later is a weakening.

### Changed
- `sdlc guide bugfix` follows the plan gate: the plan names the test that reproduces the bug, a person approves the
  plan, then the agent writes the failing test, `sdlc tests lock`, the fix. The plan workflow says the same.
- The gates topic of the guide describes the judge: it runs before the person, records a verdict and never approves;
  its answer needs `pass`, `route` and `rework`, and `route` is recorded as advice.
- With `signing: off`, `sdlc approvals verify` says that signatures are not checked and how to turn signing on; the
  CI files from `sdlc ci init` say so next to the step.
- Hook decisions (`hook.denied`, `hook.warned`) go to the git-ignored `openspec/.sdlc/hook-log.jsonl` and move into
  the shared log with the next CLI command that writes it, so an agent's denied attempts no longer leave the working
  copy dirty. `sdlc log`, `health`, `audit`, the report and the dashboard read both; agents cannot write the queue.
- The log of config proposals names the person as `Name <email>`, like every other event; `sdlc config show` of an
  applied or dismissed proposal shows the diff as it was then.

### Fixed
- The read and search tools of Qwen Code and GigaCode (`grep_search`, `read_many_files`, `list_directory`,
  `search_file_content`, `web_fetch`, `google_web_search`) are reads: they work before the plan is approved and
  during a takeover, as the denials guide says.
- `sdlc validate` and `--all`, the CI step, report missing delta specs only for a full-track change that reached its
  spec stage; a new change and a lite or docs change pass. `sdlc approve spec` still refuses a gate without deltas.
- `sdlc license set` changes only the license block of `openspec/sdlc.yaml`; the YAML writer no longer adds default
  values the file did not have.

## 0.23.0 — 2026-10-17

### Added
- Settings changes by proposal. Agents cannot edit `openspec/sdlc.yaml` and `openspec/roles.yaml`; now an agent
  (or a person) runs `sdlc config propose --set <key>=<value> --reason <text>` (or `--file`, `--target roles`):
  the result is validated with the CLI's own parser and stored against the file as it is, and the file does not
  change.
- `sdlc config show [id]` lists the proposals or shows one: the diff, the validation and the warnings when it weakens
  the process (a lower enforcement mode, a gate no longer required, removed verify commands, protected or test paths,
  `auto_waive` on lite, fewer approvals; signing turned down or an emptied role in roles.yaml).
- `sdlc config apply <id>` and `sdlc config dismiss <id> --note` are a person's decisions: refused to agents by the
  CLI and the hooks, a maintainer with roles.yaml, a weakening needs `--yes`, and a proposal made before the file
  changed is stale. Applying keeps the file's header and logs `config.applied`.
- The `sdlc-config` workflow: the agent proposes the change, explains the warnings and gives the person the exact
  apply command; the health and adoption workflows use it for settings outside the adoption draft.

## 0.22.4 — 2026-10-17

### Changed
- The adoption draft shows each person's last commit; `sdlc adopt --apply` writes into roles.yaml only people with a
  commit in the last 12 months, the current git identity and people CODEOWNERS resolved, and says how many it left out.
- `sdlc new` prints the track it suggests, why, and the command a person runs (`sdlc track set lite --change <id>`).
- Scaffolded documents take the project name from package.json, pyproject.toml, Cargo.toml or go.mod instead of the
  folder name.

### Fixed
- `sdlc init` no longer adds a verify command that the test script's `pretest` or `posttest` already runs, so
  lint does not run twice; the summary says where it runs.
- The audit plans the high-risk approvals: on a change with risk high, a gate with `high_risk_approvers` counts one
  more approval per extra role.

## 0.22.3 — 2026-10-16

### Added
- `sdlc drop <change> --note <text>`, a person's decision: closes a change created by mistake. It is logged, moved
  to the archive with the reason (the record says `dropped`), its deltas never reach the living specs, and its backlog
  item goes back to open. Agents are refused, as for approvals.
- `sdlc backlog link <B-id> --change <id>` ties a change created with `sdlc new` to a backlog item: the item is in
  progress with the change, and archiving the change marks the item done.
- `sdlc init` and `sdlc doctor` say when git ignores the process files (`openspec/`, the agent folders, REVIEW.md) and
  which lines to add to `.gitignore`; projects whose `.gitignore` is an allow-list need them.
- `sdlc doctor` names a change record with git conflict markers and how to merge it, and warns when an `auto_waive`
  policy lists the `lite` track, which waives the gate for every change on lite.
- `sdlc status` and `sdlc next` warn when a gate of the change has no one who may approve it (roles, distinct
  approvers, the per-person limit), pointing to `sdlc roles who <gate> --change <id>`.
- Two worked examples in the documentation: adopting a large existing codebase, and tracks, small changes and human
  decisions.

### Changed
- On a high-risk change, `sdlc approve --preview` and `sdlc roles who` name every role the gate needs, so the product
  owner sees that the tech lead must approve as well.
- The guide and the `openspec/sdlc.yaml` header say that `auto_waive` matches the kind or the track.
- The adoption draft leaves out bots named "bot" or "robot" and addresses such as `npm-cli+bot@github.com`.

### Fixed
- After `sdlc rework`, the next step is the agent revising the artifact from the rework note, also when the gate had
  been rejected and approved before; the person is asked to approve only once the artifact changed.
- `sdlc new` and `sdlc backlog start --change` refuse the id of an archived change instead of creating a second change
  with the same id.
- A change whose plan gate was waived needs no tasks.md: a passing `sdlc verify` satisfies the verify gate.
- Running `sdlc approve` again for content you already approved records nothing and says "already approved".

## 0.22.2 — 2026-10-16

### Added
- Changes on other branches are named as a hint: `sdlc next --me` (`otherBranches` in JSON), `sdlc health` (the
  `info` finding `flow.branches`), `sdlc report` and the dashboard list the changes found on other local and
  remote-tracking branches as of the last fetch, with the branch to switch to. Health and the report still count only
  the checked-out branch.
- The health finding `quality.rejections`: a gate of one change rejected two times or more inside the window, with
  the threshold `health.rejections`.
- The dashboard shows the agent's share of the log ("Agent log events") next to the agent's commits.
- The first tour step opens with what a person joining a project that already uses sdlc runs: clone, `npm install`,
  `sdlc doctor --fix`, an entry in `openspec/roles.yaml`, `sdlc next --me`.
- Two worked examples in the documentation: a newcomer's first change, and the dashboard and the process health.

### Changed
- `sdlc report` in Markdown lists the events newest first: the latest 20, or with `--since` the whole period.
- `sdlc trace` reports one `tasks-without-trailers` gap for a change whose commits name none of its tasks, instead of
  one gap per task.
- `sdlc guide lifecycle` shows the qa gate and says how the agent's workflows are called in each tool; they are not
  `sdlc` subcommands.
- The health workflow gives the exact `sdlc backlog move` forms a person runs to order the drafted items.

### Fixed
- Fractional day thresholds (`stalled_days`, `lock_days`, `deferred_days`) work: the age is no longer rounded down to
  whole days before the comparison, and facts show it to one decimal.
- `sdlc explain` with no active change points to the ready backlog item instead of `sdlc new`.
- `sdlc backlog start` names the change `b<n>` when the item's title has no Latin letters, instead of an id made of
  its digits only.
- On the lite track the stepper no longer marks intent as the current step.

## 0.22.1 — 2026-10-16

### Fixed
- An open rejection stays visible: a gate whose latest decision is a rejection shows it on its row in `sdlc status`,
  with the person and the note, even while an earlier gate blocks it, and `sdlc next` carries the note until the gate
  is approved. Before, a qa rejection that sent a change back to build disappeared from both.
- `sdlc approve spec` validates the delta specs first: errors (a requirement without a scenario, no deltas) refuse the
  approval as `spec_invalid`; warnings such as the RFC 2119 "SHALL or MUST" advice are shown to the approver and
  recorded with the approval. `sdlc validate` judges the same way, so requirements written in another language than
  English are valid.
- The tasks template no longer ends with a "Run sdlc verify" task, which the verify gate itself kept blocked. In a
  change that still has such a task, a passing `sdlc verify` ticks it once every other task is done.

### Added
- Two worked examples in the documentation: a team adopting sdlc on an existing project, and a team building an
  application from scratch.

## 0.22.0 — 2026-10-15

### Added
- Market mode for the task board (B119): a person or the lead agent opens a timed auction for an open task
  (`sdlc board auction`); executors of the registry bid with an estimate (`sdlc board bid … --minutes [--cost]`, also
  the MCP tool `board_bid` for an executor token); when the window ends the next board command reserves the task for
  the winner by `board.market.rule` (`fastest`, `cheapest` or `first`); a person may award at once or reassign
  (`sdlc board award`). Auctions, bids and awards are in the log.
- Mesh executors (B120): every board write takes a request key (`--request <key>`, MCP argument `request`); a relayed
  or retried call with the same key and arguments answers as the first one and writes nothing new, the same key with
  other arguments is refused with `request_conflict`.
- Two process rules for agents (deny in `block`, a reminder in `warn`): `living-specs` — the living specs
  (`openspec/specs/**`) change only through `sdlc archive`, never by an agent's edit or shell write;
  `change-not-created` — an agent writes into a change folder only after `sdlc new` (or `sdlc backlog start`)
  created it; `openspec new change` from an agent's shell gets the same answer.
- The log records the agent of every CLI step run in an agent session (`agent`, next to the person's `by`); `sdlc log`
  shows it, and `sdlc audit` counts the agent's entries (`agentEvents`) next to the commit trailers.

### Fixed
- `sdlc backlog start` with a title without Latin letters starts the change as `b<n>` instead of failing on an empty
  id; a refused id points to `--change`.
- `sdlc update` in a fresh clone installs the local git hook and leaves the working tree clean: the manifest keeps one
  key order and is not rewritten, and nothing is logged, when nothing changed.
- `sdlc doctor` reads Qwen Code's folder trust: with folder trust off (Qwen Code's default) every folder is trusted;
  with it on, doctor warns only when the project folder is not trusted, the case where Qwen Code ignores the
  project's hooks and deny rules. The documentation said the opposite and is corrected.
- The `agent-marker` refusal names the variables the command clears, Qwen Code's and Codex CLI's included.
- A project without the `claude` tool gets no `CLAUDE.md` from the AI-ready layout, and its `AGENTS.md` lists the
  commands of the project's own agents.

## 0.21.3 — 2026-10-15

### Fixed
- A table in `sdlc guide` fits the terminal window: the widest columns are narrowed and their cells wrap by words
  within the column, instead of the whole row breaking at the window edge. The width is the terminal's, or `COLUMNS`
  when the output is not a terminal; output to a file or a pipe keeps the natural width.

## 0.21.2 — 2026-10-15

### Changed
- `sdlc guide` prints plain text in a person's terminal: headings underlined, tables as aligned columns, code blocks
  indented, without Markdown marks. An agent session still gets the Markdown; `--markdown` asks for it anywhere, and
  `--json` is unchanged.
- In every locale the names of the stages and the gates stay the English identifiers: a stage title starts with the
  stage name and its gates, as in "Plan (intent)", and the messages, the report and the built-in guide name the gates
  as intent, spec, plan, verify, qa, review and release.

## 0.21.1 — 2026-10-14

### Changed
- The documentation covers 0.21.0 everywhere: the README, the overview and roles lessons of the course and the
  handbook, and their command references (every command of the CLI) describe the executor registry, executor
  tokens and the task board.
- The built-in guide (`sdlc guide`) explains the executor registry and tokens (`roles`), the board tools over MCP
  (`mcp`), the registry and the board file among the records agents cannot edit (`denials#state-integrity`), and how
  to hand tasks to a swarm (`faq`).

### Fixed
- The documentation said that sdlc offers only read tools over MCP, and that executor tokens came in 0.20.x; a
  glossary row of the command reference held two terms.

## 0.21.0 — 2026-10-14

### Added
- An executor registry, `openspec/executors.yaml`: a person lists the executors (swarms of type representative,
  board, market or mesh), the highest risk and the kinds of change each may take, and labels for what it can do.
  It is a state file: agents cannot edit it. `sdlc task executors` shows it. With a registry, `sdlc task export`
  hands work only to a named executor allowed for the change (`--executor`), and `sdlc task check-result` wants
  every commit to carry `SDLC-Agent: <executor>/<agent>` naming such an executor. Each handed-out task and each
  check is in the log.
- Executor tokens: a person issues an executor its own token with `sdlc task executors token <id>`; the token is
  printed once and only its SHA-256 is kept in the registry. `sdlc mcp serve --http` accepts it besides
  `SDLC_MCP_TOKEN` and knows the calling executor from it; a new token or a removed executor revokes the old one at
  once.
- A task board: `sdlc board list|claim|heartbeat|release|submit`. The open tasks of changes whose plan is approved
  are on the board; an executor's agent claims a task with a lease, keeps it with heartbeats, releases it or submits
  a result branch, which goes through the result check. Two agents cannot hold one task; a task whose agent stops
  sending heartbeats is open again. The board lives in `openspec/.sdlc/board.json` of the clone that serves it (not
  committed, agents cannot edit it); every claim, release, expiry and submission is in the log.
- `sdlc board reopen --change <id> --task <n.m> --reason <text> [--escalate]`: a rejected result opens its task again
  with the reason, which the board and the next work item show; `--escalate` keeps the executors that failed it from
  claiming it again.
- `sdlc board dispatch`: a person or the lead agent reserves a task for one executor, typically a swarm's
  representative, with a lease; unanswered, the task returns to the pool.
- Board tools over MCP: `board_list` for every client; `board_claim`, `board_heartbeat`, `board_release` and
  `board_submit` only for a client that presents an executor token, and the executor always comes from the token,
  never from the arguments. No MCP tool dispatches, reopens or takes any decision.
- The dashboard and `sdlc report` show the board: open, dispatched, claimed and submitted tasks per change with
  their executor, agent and lease end, and the count per executor. They only read.

### Changed
- The task contract (`schemas/contracts/task.schema.json`, `result.schema.json`) gains the executor, the
  `SDLC-Agent` trailer, the earlier attempts of a reopened task and the new problem codes.
## 0.20.3 — 2026-10-14

### Fixed
- A plan-gate denial points to `sdlc guide denials#plan-gate` once instead of twice.
- `sdlc next` after a debate no longer names the next step as an agent's.
- A literal credential after `Bearer`, `Basic`, `Token` or `Bot` in the MCP registry is refused whatever its shape,
  and an agent edit that adds a credential after `Bearer` or `Basic` is denied.
- `sdlc next` and the Claude Code status line name the stage in the reader's language, as `sdlc status` does.
- The daily summary text names the active changes and the changes waiting for people separately; with nothing
  waiting, it no longer calls the active changes waiting.

### Changed
- The documentation: the status line reads the session on stdin; `sdlc mcp check` exits 1 for an unavailable server
  only with `--strict`; `unknown_person` is the `--json` code; the guide warns that `sdlc audit --export` into a
  folder inside the project that git does not ignore makes the verification of the active changes stale.

## 0.20.2 — 2026-10-13

### Fixed
- `sdlc status` shows who approved a gate in the reader's language (an English word was left in other languages), and
  with no active change it names only the project's own tools to start one.
- The approval line in other languages no longer assumes the approver's gender.

## 0.20.1 — 2026-10-13

### Fixed
- A person's note, a reason or a judge's text that ends with a period no longer reads with two periods in a message
  (for example after a failing judge verdict in `sdlc next`); the message after `max_loops` puts a colon before the
  judge's text.
- `sdlc team list` shows the packs of `openspec/sdlc.yaml`: whether each is synced, waits for a person
  (`sdlc team accept --pack <name>`) or is in effect, and its lenses, workflows and checks (JSON `packs`).
- The 0.19.0 section of this changelog had lost its heading.

### Changed
- The documentation is checked against the CLI: every command and workflow is described in the reference documents
  and in the command reference of the course and the handbook; the course and the handbook have lessons on the judge
  gate and on extension packs; the demo accepts a company pack with a review lens.

## 0.20.0 — 2026-10-13

### Added
- A judge gate. `gates.<g>.judge` names a judge for an approval gate: a command (`run`) or an MCP tool of the registry
  (`server`, `tool`), a rubric file of the project (`rubric`) and `max_loops` (default 3). `sdlc judge --gate <g>
  --change <id> [--json]` (anyone, an agent too) sends the rubric and the gate's artifacts to the judge and records its
  verdict `{ pass, route, rework }`, bound to the digest of those artifacts. Until a verdict passes for the current
  artifacts, the gate is blocked: a person cannot approve, and `sdlc next` asks the agent to run the judge or to rework
  the artifacts with the judge's instruction. A changed artifact makes the verdict stale. A passing verdict is
  evidence only: a person still approves. After `max_loops` failing verdicts the loop stops and `sdlc next` hands the
  gate to a person. A command judge runs as an agent, so it can never approve or unlock. An answer that is not a
  verdict is refused (`judge_invalid_answer`) and records nothing.
- Extension packs bring review lenses, workflows and gate checks, next to roles and skills. A pack may hold
  `lenses/<id>.md` (a review lens named `<pack>-<id>`: `sdlc review context` gives its text and `sdlc review check`
  requires its coverage line), `workflows/<id>.md` (a workflow generated as the skill `sdlc-<pack>-<id>`; it never
  replaces a built-in one) and `checks.yaml` (`verify:` checks, named `<pack>/<name>` and run by `sdlc verify` as an
  agent). Nothing a pack brings is in effect before a person accepts it with `sdlc team accept --pack <name>` (the
  maintainer role with `openspec/roles.yaml`), bound to the digest of its contents: a new version waits for a new
  acceptance. A pack with workflows or checks must be pinned to a git commit (40 hex digits) or an exact npm version
  (`pack_not_pinned` otherwise). A pack that calls a person's sdlc command in a check or a workflow is refused
  (`pack_forbidden_command`).

## 0.19.0 — 2026-10-13

### Added
- `sdlc mcp serve --http <host:port>` serves the same read-only tools to remote MCP clients over Streamable HTTP at
  `/mcp`. A bearer token is always required, on localhost too: the environment variable `SDLC_MCP_TOKEN`, at least
  16 characters (there is no flag for it). Without it the server does not start (`token_required`). A request without
  the token or with another one gets 401, a browser `Origin` of another host or port gets 403, any path but `/mcp`
  gets 404, and a request body is at most 1 MB. Port 0 picks a free port; the server prints its URL on stderr. New
  read-only tools in both transports: `health`, `report` and `explain`. There is still no decision over MCP.
- Events across clones. `gate.<g>.awaiting` and `gate.<g>.overdue` get an id from `project.name` (when set), the
  change, the gate, the event and the digest the gate waits on, not from the time. Every clone and CI send the same
  id for the same wait, so a receiver keeps one. A person in `openspec/roles.yaml` may list chat handles
  (`chat: { telegram: "@alice_tg", slack: U0ALICE }`). A receiver in `events` with `chat: telegram` gets
  `waitingForChat` with those handles, and its message mentions them; a receiver without `chat` never gets handles.
- `sdlc events summary [--since <date>] [--json]` records the event `summary.daily`: the counts of changes done,
  active, waiting for people and blocked, and the waiting changes. It goes to the receivers whose `on` matches
  (`summary.*` or `summary.daily`). It is not in the default patterns, so a receiver opts in. One summary per project
  and day. A Telegram MCP server is a receiver like any other: sdlc has no chat API of its own. The example script
  `assets/examples/daily-summary.mjs` still writes a file.
- `sdlc triage intake [--json]` reads one alert as JSON on stdin (`{ id, title, severity?, url? }`) and adds a backlog
  item with the source `alert:<id>`. The same alert again adds nothing (`duplicate: true`); input that is not JSON, or
  an alert without an id or a title, is refused with `invalid_alert`. It never sets the priority: a person orders the
  backlog.
- GitHub Issues and the backlog stay linked through the team's GitHub MCP server:
  `issues: { server: github, repo: owner/name }` in `openspec/sdlc.yaml`, where `github` is a server in `mcp.servers`
  (sdlc holds no token). `sdlc backlog import --issues` adds one item per open issue that is not linked yet, with the
  field `Issue: GH-<n>`; pull requests are skipped, and a second import adds nothing. Without `issues` it is refused
  with `issues_not_configured`. Archiving a change whose item has an issue comments on the issue and closes it,
  through the event outbox: a failing server does not fail the archive, and `sdlc events flush` delivers later.
- Context packs from the team's knowledge server: `context.sources` in `openspec/sdlc.yaml`, a list of
  `{ name, server, resource | tool, args?, stages, owner, fresh_days? }`. `sdlc context pull [--name <name>] [--json]`
  writes `docs/context/<name>.md` with the usual header (`source: mcp:<server> <resource or tool>`, `updated:` today).
  The packs stay in git and under review, and `sdlc instructions` stays offline. A failing source leaves its file as
  it was.
- The task contract for executors of any type. `sdlc task export --change <id> [--task <n.m>] --json` gives one work
  item per open task (contract `sdlc.task/1`): the task, the risk, the base commit, the plan's files, the spec
  scenarios, the verify checks, the forbidden paths, and where the result goes (the branch `sdlc/<change>/<task>` and
  the trailers `SDLC-Change` and `SDLC-Task`). It works only while the plan gate is approved and fresh
  (`plan_not_approved` otherwise). `sdlc task check-result --change <id> --branch <ref> --json` checks a returned
  branch: a missing trailer, an unknown task or a forbidden path is a problem (exit code 1); files outside the plan are
  a warning. Both commands only read: they merge nothing and approve nothing, and any actor may run them. The JSON
  Schemas are `schemas/contracts/task.schema.json` and `schemas/contracts/result.schema.json`.

### Changed
- The CI configuration from `sdlc ci init` (GitHub and GitLab) now ends with `sdlc events flush`, also when a check
  failed, so the waits seen in CI reach the receivers. An existing file gets the step with `sdlc ci init --force`.
- Internal: the lifecycle code is split into one module per gate, with no change in behaviour.

## 0.18.0 — 2026-10-13

### Added
- `verify.require_behaviour: true` (default `false`) makes the verify gate also need the behavioural table of
  `verification.md`: one row per spec scenario, as `sdlc verify --check --strict` checks it. Without the rows the gate
  is not satisfied, its reason names the uncovered scenarios, and `sdlc next` asks the agent to fill the table.
- An optional `qa` gate between verify and review: `gates.qa: { required: true }` (default `required: false`,
  `approvers: [qa]`). After verification passes, a person with the `qa` role accepts the evidence with
  `sdlc approve qa --change <id>`; review waits for it. The approval covers `verification.md` and the recorded verify
  run, so a new `sdlc verify` makes it stale and `sdlc next` asks again. `sdlc reject qa` sends the change back to the
  agent to fix and verify again. When the gate is not required, it does not appear. An agent can never approve it.

### Changed
- Team decisions go by role. With `openspec/roles.yaml`, `sdlc team accept` needs the `maintainer` role, and
  `sdlc backlog move` and `sdlc backlog drop` need `product-owner`. A person without the role is refused with
  `missing_role`, and the message names who may. Without the file any person may decide, as before; an agent never.
- `sdlc team list` shows "a newer draft waits" (JSON `newerDraft: true`) when a draft in `docs/agents/drafts/` differs
  from the accepted role.

## 0.17.0 — 2026-10-13

### Added
- `sdlc ci init --provider github|gitlab [--check <server>] [--force]` writes a starter CI configuration. It installs
  this sdlc version from the release package and runs `sdlc validate --all` and `sdlc approvals verify` on a full
  clone. GitHub gets `.github/workflows/sdlc.yml` (`fetch-depth: 0`, Node 20). GitLab gets `.gitlab/sdlc.yml` (one
  job, `GIT_DEPTH: "0"`) and, only when there is none, a `.gitlab-ci.yml` with `include: [{ local: .gitlab/sdlc.yml }]`.
  An existing `.gitlab-ci.yml` is never edited: the command prints the include line to add. An existing file is kept;
  `--force` rewrites it. Only a person may run the command: it is refused in an agent session and by the hook.
- `sdlc ci init --check <server>` adds a `ci-green` check of that registry server to `verify.mcp`: GitHub
  `list_workflow_runs` with `head_sha: "${HEAD}"`, GitLab `list_pipelines` with `sha: "${HEAD}"`, waiting up to
  900 seconds while a run is pending. Confirm the server's tool and argument names with `sdlc mcp check --args`.
- The build workflow runs the `sdlc-simplifier` subagent after the last task and before `sdlc verify` by default.
  `stages.build.simplify: false` turns it off; only the build stage takes `simplify`. Existing projects get the step
  with `sdlc update`.

### Changed
- A `verify.mcp` or `release.mcp` check whose arguments use `${HEAD}` is not called while the working tree has
  uncommitted changes outside `openspec/` (modified, staged or untracked files). It fails with a reason to commit (and
  push) first. Checks without `${HEAD}` run as before.

## 0.16.3 — 2026-10-12

### Fixed
- `signing: required` can pass after a signed first-key bootstrap in an existing `roles.yaml` history.
- A stale branch merge, deleted `roles.yaml`, shallow clone or graft can no longer make required verification pass.

### Changed
- Roles history reports `pre-signing`, `bootstrap`, `merge` and `bootstrap-conflict` statuses.
- Required verification needs the full git history. CI should check out with `fetch-depth: 0`.

## 0.16.2 — 2026-10-12

### Added
- Registry servers can set `agents: false` to serve the CLI without being added to agent MCP settings or workflows.
  Turning it on removes sdlc's entries and keeps entries added by a person. The default is `true`.
- `sdlc audit --since <date>` filters the plain audit; archived change audits include active-period commits and
  `agentCommits: { agent, total }` for commits with that change's `SDLC-Change` trailer.
- Personal CODEOWNERS handles in `roles.yaml` resolve for reviewer suggestions and adoption drafts; adoption text
  names unresolved handles.

### Docs
- List all seven `sdlc mcp serve` tools, including `guide`.
- Explain where `mcp-stage` recognizes MCP tool names and where live tool names remain unverified.
- Document the signed `roles.yaml` key bootstrap and the verification output observed in a temporary repository.

## 0.16.1 — 2026-10-12

### Added
- `sdlc init --roles` creates or keeps the starter `openspec/roles.yaml`; only a person may run it.
- `sdlc dashboard --watch` rebuilds on `openspec/` changes and can serve the page with auto-refresh.
- `sdlc doctor --fix` repairs sdlc-owned files, hooks and a missing `REVIEW.md`, and lists manual work.
- Event receivers can opt into masked rejection or rework notes with `include_note: true`.

## 0.16.0 — 2026-10-12

### Added
- `$any` matches at least one item in an MCP check's answer list for `expect` and `wait_while`.
- `sdlc mcp check` shows tool argument schemas in JSON and with `--args` in text.
- `sdlc log` filters by event and date; `sdlc health` supports one-run windows with `--since` or `--days`.

## 0.15.4 — 2026-10-12

### Fixed
- Git hooks installed by `sdlc init` and `sdlc update` mark GigaCode-only commits as `SDLC-Agent: gigacode`.
- `report --out`, `dashboard --out` and `audit --export` warn when an unignored project output makes verification stale.
- `import bmad` rejects paths outside the project, including links; `--change` used to read and import such folders.
- `approvals verify` keeps committed approvals' status after `archive`, before the archive move is committed.

## 0.15.3 — 2026-10-12

### Fixed
- The `Next:` line after a command, the status line, `sdlc instructions` and the waits recorded by `sdlc events` now
  check whether the code changed after verification, as `sdlc next` and `sdlc status` do. Before, after a later code
  change and a new `sdlc verify`, the `Next:` line said "archive" while a code owner had to re-approve the review,
  and the status line said "Done" while the code was unverified. The status line takes about 0.3 s longer.

## 0.15.2 — 2026-10-12

### Fixed
- `next --me` lists questions awaiting my answer; `next` asks for the answer first, and `explain` names the people.
- `backlog start` sends an incomplete draft intent to the agent before asking the product owner to approve it.
- With `min_approvals: 2`, hints name only people who have not yet approved.
- `roles who --change` uses the change's risk and omits people refused only for lacking the required role.
- With `design.debate: true`, `next` sends an incomplete debate to the agent, not the product owner.
- The `state-integrity` denial for `openspec/roles.yaml` names that file and its approval policy.
- `trace` preserves `deferred (D1)` findings and their deferred item links.
- `approvals verify` text output reports each approval's trailer status.
- `import bmad --dry-run` prints a text summary unless `--json` is given.
- Repeated `import bmad --to-backlog` skips epics and items already imported and reports them.
- The BMAD importer renders actor-first requirements as "The system SHALL let the policyholder see …".

### Changed
- Imported backlog epics may record `Source: bmad <folder>#<key>` below `Goal:`; older files still read as before.

## 0.15.1 — 2026-10-11

### Added
- `verify.mcp` and `release.mcp` checks can wait for a pending answer with `wait_while` and `wait_seconds`.
- `sdlc mcp check --strict` exits 1 when a registry server cannot be reached, for CI use.
- `sdlc doctor` warns when a registry `${VAR}` in `env` or `headers` is unset, naming the server and variable.
- `sdlc backlog add` refuses an open item with the same source type and ref; `--allow-duplicate` overrides this.

### Fixed
- The test suite uses one temporary root per run and removes it, leaving no temporary folders behind.

## 0.15.0 — 2026-10-11

### Added
- **Events as a ready message.** A receiver in `events` may set `message: <argument>` (for example `message: text`). sdlc then calls the tool with the static `args` plus that argument set to one line of text, and without the `event` object, so a Telegram bot's `send_message(chat_id, text)` takes events directly, with no adapter. The text names the project, the change, the gate and the people by their names from `roles.yaml`, in the locale of the command; it never carries an email, a note, a command or its output. The text is built when the event is queued, so an event that waits in the outbox reads the same when it is sent.
- **`sdlc verify --list` shows the MCP checks.** The `verify.mcp` checks are listed with their name, server, tool and whether they are required, next to the commands.

### Fixed
- **After a rework or a rejection, the gate waits for a person again.** Before, `sdlc next` kept asking the agent to revise. Now, once the agent has changed the gate's artifacts, `sdlc next` names the person, `sdlc next --me` lists the gate for them, and the `gate.<g>.awaiting` event is sent. Until then the agent revises. A rejected review works the same way: the agent fixes what review.md asks, then the reviewer decides again.

## 0.14.7 — 2026-10-11

### Added
- **Team skills for every configured tool.** When a person accepts a role, its vetted skills are installed into the skills folder of every tool the project is set up for: `.claude/skills/<id>` (Claude Code; OpenCode reads it too, so with Claude Code there is no `.opencode` copy), `.opencode/skills/<id>` (a project with OpenCode but without Claude Code), `.cursor/skills/<id>` (Cursor), `.agents/skills/<id>` (Codex CLI), `.qwen/skills/<id>` (Qwen Code) and `.gigacode/skills/<id>` (GigaCode). Before, only Claude Code and OpenCode projects got the team's skills. The hook guards every copy, and `sdlc team check` checks every copy. `openspec/.sdlc/team.json` records all the folders of a skill (`dirs`); older records with only `dir` are still read.

### Fixed
- **Cursor's user-level hooks are the guard's configuration.** An agent's edits and shell writes of `~/.cursor/hooks.json` are denied (rule `guard-config`), as for the user settings of Claude Code, OpenCode, Codex CLI, Qwen Code and GigaCode: they can switch the guard's hooks off. This is a security fix of the guard.

## 0.14.6 — 2026-10-11

### Changed
- **The plan gate opens only the files of the plan when several changes are active.** With one active change, an approved plan opens code edits as before. With several, the agent may edit code, or write it through the shell, only in files that an approved plan lists under "Files that change"; any other file meets the plan gate (denied in `block` mode, a reminder in `warn` mode). An approved plan that lists no file opens nothing while another change is active. Editing plan.md after its approval voids the approval.

### Fixed
- **The takeover holds every path the plan lists.** Under "Files that change", plain list items (`- src/greet.js (modified)`) and globs (`src/legacy/**`) now count as well as paths in backticks. The takeover, rework and the warning about planned files the change did not touch read this list with one parser; plan drift in the review context still reads the whole plan.
- **The takeover fails closed.** A plan whose "Files that change" list names no path holds the whole project, as a change without plan.md does.
- **The `Next:` line and the status line agree with `sdlc next`** after a review or release approval, instead of naming the review gate again.

## 0.14.5 — 2026-10-09

### Added
- **A course for every role.** [sdlc in practice](docs/en/course/README.md): twelve modules of short lessons that take a team — product owner, tech lead, developer, QA, code owner, release manager, platform engineer, engineering manager and an auditor — through a new project and the conversion of an existing one, with Claude Code and MCP servers for GitHub (issues, pull requests, Actions), a knowledge base and Telegram. Every command in it was checked against the CLI, and the outputs come from real runs. It is written to be cut into training videos.
- **A supported-tools table** in the user guide: for each of the six tools, how a workflow is called, what holds the gates, the agent marker and the main limit.

### Fixed
- **`sdlc help` knows every supported tool.** `sdlc help --json` gives each workflow's invocation for Claude Code, OpenCode, Cursor, Codex CLI, Qwen Code and GigaCode; the text help shows the invocations of the tools the project is set up for. Help never fails on a broken `openspec/sdlc.yaml`.
- **The health and team workflows have a title and a description** in `sdlc help`, in English and other languages, instead of their key names.
- **The documentation covers every supported tool** where it still spoke of Claude Code and OpenCode only.

## 0.14.4 — 2026-10-09

### Security
- **No code of an npm pack runs, on any npm.** npm 10 runs a package's `prepare` script when `npm pack` is given a folder or a git spec, even with `--ignore-scripts` (npm 11 does not), so with npm 10 a team pack listed as `npm: ./folder` or `npm: github:…` could run its code during `sdlc team sync`. An npm pack is now only a registry package (`name`, `name@1.2.3`, `@scope/name@^1`) or a `.tgz` (a path or an `https://` URL); a folder or a repository is refused when the configuration is read — put a repository in a `git:` pack, which never runs anything. npm also runs with `npm_config_ignore_scripts=true`. If you used a folder or a git spec under `npm:` with npm 10, review what its `prepare` script does.

### Fixed
- **The release build on Linux.** A test wrote a team's own git hook without the executable bit, which Linux ignores; the product was not affected. Every push and pull request is now tested on Linux with npm 10 and npm 11 before a release is tagged.

## 0.14.3 — 2026-10-09

### Fixed
- **A failing hook no longer opens the gates in Codex, Qwen Code and GigaCode.** Codex lets a tool call through when its hook exits non-zero (exit 2 too), crashes, prints bad JSON or times out — only a JSON `deny` blocks (checked live with codex-cli 0.158.0); Qwen Code documents the same. When sdlc's pre-tool hook fails to load or throws, the sdlc command now answers that `deny` itself for these tools, as Claude Code's guard and the OpenCode plugin already block a hook that cannot run. A CLI that is not installed still lets the call through, and `sdlc doctor` warns about it.

## 0.14.2 — 2026-10-09

### Changed
- **More shell writes count as edits, in every tool.** Before the plan is approved, `git checkout -- <paths>`, `git restore`, `git mv`, `git apply` and `patch` (the files the patch names), downloads (`curl -o`, `wget -O`, `Invoke-WebRequest -OutFile`), file writes in one-line `node -e` and `python -c`, and commands inside `iex`, `Invoke-Expression` and `Start-Process` are denied like an edit of code. Branch switches, `git restore --staged`, `git apply --check`, reads and discarded downloads are not affected.
- **The second layer covers more spellings.** With `cli: sdlc`, Codex's command rules and Qwen Code's and GigaCode's `permissions.deny` also refuse a person's commands spelled `scdl`, `sdlc.cmd` and `scdl.cmd`, and they refuse `sdlc adopt --apply`; `sdlc uninstall` removes these entries too.

### Fixed
- **Codex's `config.toml` with multi-line strings.** A line inside a `"""…"""` or `'''…'''` string that looks like a table header is no longer taken for one, so adding or removing sdlc's MCP tables keeps such a file intact.

## 0.14.1 — 2026-10-09

### Added
- **Qwen Code and GigaCode as tools.** `sdlc init --tools qwen` (or `gigacode`) writes the workflows as skills with thin commands (`/sdlc-next` and the like), the subagents (read-only roles cannot write files) and, in `.qwen/settings.json` or `.gigacode/settings.json`, the tool's own hooks, `permissions.deny` rules for a person's commands and the MCP servers; your own settings stay. Edits before the plan is approved (`write_file`, `edit`, a shell write) and a person's decisions in the agent's shell are denied — the deny rules hold even in YOLO mode — protected files stay protected, and the session starts with the change and who acts next. `QWEN_CODE=1` marks the agent's shell, so `sdlc approve` refuses there and commits from it carry `SDLC-Agent: qwen`; clearing it is denied, also in cmd.exe syntax (`set QWEN_CODE=`). `sdlc doctor` reminds you that Qwen Code runs a project's hooks only in a trusted folder. An agent cannot write `~/.qwen/settings.json` or `~/.gigacode/settings.json`. **GigaCode support is experimental**: it follows GigaCode's formats and Qwen Code's behaviour and was not checked on a live installation. See [Qwen Code and GigaCode](docs/en/17-qwen-gigacode.md).

## 0.14.0 — 2026-10-09

### Added
- **Codex CLI as a tool.** `sdlc init --tools codex` writes the workflows as skills (`.agents/skills/sdlc-*`, `$sdlc-next` and the like), the subagents (`.codex/agents/sdlc-*.toml`), the sdlc MCP server and the team's servers as `[mcp_servers.*]` tables in `.codex/config.toml` (your own tables stay), Codex's own hooks (`.codex/hooks.json`) and command rules (`.codex/rules/sdlc.rules`). An `apply_patch` or a shell write to code before the plan is approved is denied, a person's decisions in the agent's shell are denied by the hook and refused by the rules, protected files stay protected, and the session starts with the change and who acts next. `CODEX_CI=1` and `CODEX_SESSION_ID` mark the agent's shell, so `sdlc approve` refuses there and commits from it carry `SDLC-Agent: codex`. `sdlc doctor` reminds you that Codex runs a project's hooks only after you trust them in `/hooks`. Checked live with codex-cli 0.158.0. See [Codex CLI](docs/en/16-codex.md).

### Changed
- **A write through the shell counts as an edit, in every tool.** Before the plan is approved, `echo … > src/app.js`, `tee`, `cp`, `mv`, `install`, `sed -i`, `perl -i`, `touch`, `truncate`, `dd of=`, PowerShell's `Set-Content`, `Add-Content`, `Clear-Content`, `Out-File`, `Tee-Object`, `New-Item`, `Copy-Item`, `Move-Item`, `Rename-Item` and the .NET `File` writers to code are denied like an edit — also inside `bash -c`, `cmd /c` and `powershell -Command`, and for an `apply_patch` run through the shell — and so are such writes to locked tests and to `enforcement.protected_paths`. Quoted text and here-strings are content, not commands; reads, `2>&1`, `/dev/null`, paths outside the project and the change folder under `openspec/` are not affected.
- **Codex's user-level settings are the guard's configuration.** An agent's edits and shell writes of `~/.codex/config.toml` and `~/.codex/hooks.json` (or under `CODEX_HOME`) are denied, as for Claude Code's and OpenCode's user settings: they can switch the project's hooks off.

### Fixed
- **A `cli` with a Windows drive letter.** `cli: node C:/tools/sdlc/bin/sdlc.js` was written by `sdlc init` but refused when the configuration was loaded, so every later command failed and the hooks let everything through. The colon is allowed now, and `sdlc init --cli` refuses a value the configuration could not load before it writes anything.
- **`npm test *> $null` in PowerShell** is no longer denied as a write to the guard's configuration (`*>` is PowerShell's all-streams redirect, not a glob).

## 0.13.1 — 2026-10-08

### Added
- **The team's MCP servers in Cursor.** `sdlc update` lays the registry (`mcp.servers`) out into `.cursor/mcp.json` too — stdio as `{ command, args, env }`, http as `{ url, headers }`, secrets as Cursor's `${env:VAR}` — next to the sdlc server; servers added by hand stay.

## 0.13.0 — 2026-10-08

### Added
- **Cursor IDE as a tool.** `sdlc init --tools cursor` writes the workflows as skills (`.cursor/skills/sdlc-*`) with thin commands, the subagents, an always-applied rule about the process, the sdlc MCP server (`--mcp`) and Cursor's own hooks (`.cursor/hooks.json`): edits before the plan is approved and a person's decisions in the agent's shell are denied, protected files stay protected, the session starts with the change and who acts next. `CURSOR_AGENT=1` marks the agent's terminal, so `sdlc approve` refuses there, and commits from it carry `SDLC-Agent: cursor`. `sdlc doctor` checks the hooks and says that separation of duties in Cursor rests on that marker, and on Windows that Git Bash terminals can break Cursor's hooks. See [Cursor IDE](docs/en/15-cursor.md).

## 0.12.0 — 2026-10-08

### Added
- **Evidence export for auditors.** `sdlc audit --export <folder> [--since <date>] [--change <id>]` writes one folder with every approval and its signature and trailer status (`index.json`, `index.md`), the change folders and the project log of the period. Only files inside openspec/ go in; links are skipped; an existing non-empty folder is refused.
- **Changelog from the specs.** `sdlc changelog [--change <id> | --since <date>]` lists the requirements added, changed and removed by the delta specs; the release workflow puts it into release.md.
- **Commits made by agents are marked.** sdlc installs a `prepare-commit-msg` git hook that adds `SDLC-Agent: <agent>` to commits made in an agent session (also with `--no-verify`) and never to a person's; `sdlc audit` and the dashboard show the agents' share. A hook the project already has is kept (doctor shows how to chain it), and a hooks folder outside the project is never written.
- **The debate lens.** With `design.debate: true`, two read-only `sdlc-advocate` subagents argue the key design decision from opposite priorities, and the spec gate waits for the `## Debate` section in design.md with both positions and the decision. Off by default.
- **A daily summary example.** `assets/examples/daily-summary.mjs` writes done, next, blocked and waiting on people to a file from `sdlc report`; run it from a scheduler. It publishes nothing by itself.

## 0.11.4 — 2026-10-08

### Added
- **People answer the open questions.** `sdlc answer <n> --change <id> --text "…"` records a person's answer to an open question of intent.md, proposal.md or design.md, in the artifact and in the change record; `sdlc answer --list` shows them. The intent and spec gates cannot be approved while a question has no recorded answer; an answer written into the file by hand or by an agent does not count, and a reworded question needs a new answer. `questions.required: false` turns it off; approvals given before are not touched. A change record with answers is format version 3, so an older sdlc refuses it instead of dropping the answers.
- **Participation of people, planned vs actual.** `sdlc audit` and the dashboard compare, per change and for the project, the decisions the track plans (gates and approvals, counting `min_approvals`) with what happened: approvals, reworks, takeovers, waivers, answers and the hours gates waited for a person.
- **A guided tour.** `sdlc guide tour [step]` walks a newcomer through the calculator demo in seven short steps, in English and other languages.

### Fixed
- **A policy waiver stays as it was.** The first evaluation by a person's command that applies an `auto_waive` policy records the waiver on the change (an agent's session never does), so removing the policy later does not un-waive it, and archived changes are never waived by a policy.
- **Rework cycles of older records.** A rework recorded before 0.11.2 counted as one cycle; the count now comes from the change history, so the rework-limit hint appears when it should.

## 0.11.3 — 2026-10-08

### Added
- **Project health.** `sdlc health` lists findings on flow, quality, discipline and configuration — long waits on people, stalled changes, old deferred work, first-pass verification, the most common rework reason, plan drift, open findings, trace gaps, frequent waivers, the lite track on behaviour changes, forced archives, repeated approvals, repeated hook denials of one rule, long test locks, missing verification commands, enforcement off or warn, one person holding every role, signing off, stale context packs and doctor problems — each with a level, the facts and a recommended improvement. No single score; thresholds under `health` in `openspec/sdlc.yaml`.
- **The health workflow** (`/sdlc:health`) and a read-only `sdlc-health` subagent explain the findings and draft improvements as backlog items with source `health`; ordering them stays a person's decision.
- **Health where people look.** A bad finding shows as one line at the agent's session start, `health.degraded` / `health.recovered` go to the log and to event receivers (both are among the default events), and the dashboard has a health section.
- **`sdlc explain --change <id>`** says why a change is where it is: the stage, the open gate and its reason, what it waits for, the steps that unblock it and the latest decisions.
- Guide topic `sdlc guide health`.

### Fixed
- **A slow tool is no longer reported missing.** `sdlc doctor` (and the init wizard) said "not on PATH" for codegraph or the OpenSpec CLI when they answered `--version` slowly on a busy machine; a tool that is on PATH is now found, and doctor's own PATH check no longer spawns a shell.
- The init wizard tests no longer run the real dependency installer or the codegraph indexer.

## 0.11.2 — 2026-10-08

### Added
- **Re-approval after a rework needs a change or a reason.** Approving a gate again with nothing changed since the approval before the rework is refused without `--note`; `approve --preview` shows it.
- **Auto-waive policy.** `gates.<gate>.auto_waive: { kinds, tracks }` waives the intent, spec or plan gate for matching changes (never verify, review or release; a kind chosen by an agent does not count), logged as `gate.<gate>.auto_waived` and shown in the audit as a policy, not a person's decision.
- **Approval trailer.** `sdlc approve` proposes a commit message with `SDLC-Approval: <change>:<gate>:<digest>`; `sdlc approvals verify` reports whether that commit exists.
- **Rework cycle limit.** After `rework.max_cycles` reworks of one gate (default 3), `sdlc next` asks a person to take over or review the scope.
- **Planned files that did not change** (listed under "Files that change" in plan.md) are reported by `sdlc verify` and in the evidence (a warning, not a failure).
- **Verification limits and attachments.** `verification.md` has a "Not run / limits" section, and the files in the change's `verification/` folder are listed as links.

## 0.11.1 — 2026-10-07

### Fixed
- **Agents cannot weaken the review policy or the artifact rules.** The review policy (`REVIEW.md`, its usual places, or the path in `review.policy`), the sdlc schema in `openspec/schemas/sdlc/` and OpenSpec's `openspec/config.yaml` are guard files: an agent's edits and shell writes are denied, also in `warn` mode; `sdlc init` and `sdlc layout scaffold` still write them. The adopt workflow proposes policy changes to the person instead of editing.

## 0.11.0 — 2026-10-07

### Added
- **The agent team.** Role agents — analyst, architect, developer, tester and reviewer — defined in `docs/agents/<role>.md` and generated as subagents for Claude Code and OpenCode, wired to their stages. sdlc adds to every role where it writes (the artifacts of its stages) and the facts of the project (checks, protected and test paths, people and separation rules, language, documents, context packs and MCP servers of its stages), so roles follow the project. The built-in roles (in several languages) are written for sdlc's artifacts and boundaries.
- **Where roles come from:** `sdlc team sync` takes them from the team's MCP registry (`team.registry`: list_roles, get_role, list_skills, get_skill, checked by checksum), then from packs (`packs`: a git repository at a pinned ref or an npm package; no code of a pack runs), then from the built-in set; everything arrives as drafts. The team workflow (`/sdlc:team`) drafts a Project rules section into each role from the code, or from the idea of an empty project.
- **A person accepts.** `sdlc team accept <role>` (a person's command) makes a draft the role, says whether it differs from its source, and records it in `openspec/.sdlc/team.json`; a role edited afterwards is not generated until accepted again. Skills install with a matching checksum only, and skills with scripts only after `sdlc team accept --skill <id>`; `sdlc team check` reports every skill. Accepted tester and reviewer roles replace `sdlc-verifier` and `sdlc-reviewer`.
- **Guide topic** `sdlc guide team`, and a documentation chapter with user cases: [The agent team](docs/en/12-agent-team.md).

### Fixed
- **Agents cannot edit the files sdlc generates for them** (the `sdlc-*` subagents, workflow skills and commands) or accepted roles and team skills: an agent could rewrite the tester or the verify workflow to pass anything.

## 0.10.0 — 2026-10-07

### Added
- **Events to other systems.** `events` in `openspec/sdlc.yaml` names MCP servers that receive process events (gates waiting for a person, approvals, verification results, archives) after each command, with a stable id, the project name and the people a waiting gate waits for (from `roles.yaml`, never emails). Delivery never fails or noticeably slows a command; undelivered events wait in `.git/sdlc/outbox/` for the next command or `sdlc events flush`. `gates.<gate>.overdue_hours` raises `gate.<gate>.overdue` once when a gate waits too long.
- **One MCP server for several projects.** `sdlc mcp serve --project <path>` (repeatable) serves projects from outside their folders; with several, tools take the project's name (`project.name`, else the folder name).
- **MCP resources.** The sdlc server offers the team's knowledge read-only: context packs (with owner, date and a stale mark), living specs, change artifacts and documents for agents. State, configuration and anything outside the project are never offered.
- **MCP checks in the release gate.** `release.mcp` checks (for example an approved change ticket) are called when a person approves the release; a failing one refuses the approval, and the results are kept with it. `sdlc release check` runs them beforehand.

## 0.9.1 — 2026-10-07

### Added
- **Ask the agent how sdlc works.** A guide workflow (`/sdlc:guide`, `/sdlc-guide`, or a plain question) answers how to work with sdlc for your project: stages, gates and approvals, roles, tracks, bug fixes, the backlog, rework and takeover, verification, review, MCP, configuration and hook denials. The material ships with sdlc in English and other languages (`sdlc guide [topic[#section]]`), so it always matches the installed version; the session start mentions it; every hook denial names the section that explains it (`sdlc guide denials#<rule>`); the sdlc MCP server offers it as the `guide` tool.
- **`sdlc next --me`**: every gate across the active changes that you may take now, with the command.
- **`sdlc approve <gate> --change <id> --preview`**: what you are about to approve — the artifacts, what changed since the last approval, the approvals so far and needed, open findings and verification for review and release, and whether you may approve. It writes nothing.

## 0.9.0 — 2026-10-06

### Added
- **sdlc as an MCP server.** `sdlc mcp serve` (stdio) lets other AI systems read the process: `status`, `next`, `instructions`, `trace`, `audit`, `help`, each answering exactly what the CLI's `--json` prints. It offers no decisions. `sdlc init --mcp` (or the wizard's question) registers it in `.mcp.json` and `opencode.json`, keeping other servers.
- **The team's MCP servers, described once.** `mcp.servers` in `openspec/sdlc.yaml` is laid out into `.mcp.json` (Claude Code) and `opencode.json` (OpenCode). Secrets are only `${VAR}` references; a literal secret is refused (`mcp_secret_literal`). `sdlc mcp check` connects to each server, lists its tools and warns about servers that can write files.
- **MCP checks as gate evidence.** `verify.mcp` checks are called by the CLI itself during `sdlc verify` (`${HEAD}`, `${CHANGE}` in the arguments, `expect` as a subset); a mismatch or an unreachable server fails the verification with the reason.
- **The inbox.** MCP check results from runs outside an agent session (a person's terminal, CI) wait in `openspec/.sdlc/inbox/`; the next agent session sees them, and the agent marks them read with `sdlc inbox done <id>`.
- **Skills, subagents and MCP servers per stage.** `stages.<stage>.skills` and `.agents` in `openspec/sdlc.yaml`, with the registry's `stages` for servers: each generated workflow lists only its stage's resources, and the Claude Code skill pre-allows that stage's MCP tools.
- **MCP servers by stage.** The Claude Code hook also sees MCP tools; a call to a registry server outside its `stages` is denied in `block` and reminded in `warn` (rule `mcp-stage`).
- **No secrets in agent edits.** An agent's edit or shell write that adds an AWS key, a GitHub, GitLab or Slack token, a Google API key, a private key, a password in a URL or a long assigned password is denied, also in `warn` (rule `secret-in-edit`). The reason names the kind and the file, never the value; `enforcement.secret_allow` exempts test data.
- **`sdlc review suggest`** proposes a reviewer: the people who may approve the review gate, owners of the changed paths by CODEOWNERS first, then fewer open reviews; the code's authors never.
- **Context packs.** Files in `docs/context/` with a header (owner, source, updated, fresh_days, stages) reach the agent through `sdlc instructions` at their stage; stale ones are marked.
- **Documentation:** a new chapter with user cases, [Integrations: MCP, context, secrets and reviewers](docs/en/10-integrations.md).

### Changed
- New dependency: `@modelcontextprotocol/sdk` (the official MCP SDK).

## 0.8.2 — 2026-10-06

### Fixed
- **An agent can no longer switch the guard off.** Its edits and shell writes of the files that configure the guard are denied, also in `warn` mode (rule `guard-config`): `openspec/sdlc.yaml`, `.claude/settings.json` and `.claude/settings.*.json`, `.opencode/plugins/sdlc.js`, `.mcp.json`, `opencode.json(c)` and the manifest `openspec/.sdlc/manifest.json`. In an agent session `sdlc init` and `sdlc update` refuse a lower enforcement mode, a dropped tool, `--no-hooks` and another `--cli` (`agent_cannot_weaken_guard`); without such flags they still restore the generated files. `sdlc uninstall` is a person's command.
- **User-level agent settings are protected too.** `disableAllHooks` in the user's Claude Code settings or the global OpenCode config switches the hooks off for every project: an agent's edits and shell writes of `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`), `~/.config/opencode/opencode.json(c)` and `$OPENCODE_CONFIG` are denied, and `sdlc doctor` warns when user or project settings already carry `disableAllHooks: true`.
- **Claude Code: writes through the PowerShell tool reach the rules.** The PreToolUse matcher covers `PowerShell`; run `sdlc update` to refresh `.claude/settings.json`.

## 0.8.1 — 2026-10-06

### Fixed
- **The order of decisions no longer depends on the clocks of the machines.** `.sdlc.yaml` travels through git between machines; an approval recorded where the clock ran ahead kept counting after a later rework, and a rework or rejection recorded with a skewed clock hid a real re-approval. Every decision now carries a sequence number in the record and is ordered by it; records written before keep the time rule.
- **An edit of a hard link to a state file is denied** (the file is compared with the state files by inode when it has more than one link).

## 0.8.0 — 2026-10-05

### Added
- **The `Next:` hint names people.** With `openspec/roles.yaml`, a decision that needs a person names the people who may take it now (the same as `sdlc roles who`, minus those who already approved); JSON `next.people`. The workflows name them too.
- **Several approvers for one gate:** `gates.<g>.min_approvals: N` waits for approvals from N different people. A second approver of the same role no longer displaces the first.
- **`sdlc rework <gate>`** sends a change back to a gate's stage with a reason category and a note; approvals made before it stop counting. Approving a gate records a checkpoint, and `rework --reset` restores the planned files and the change folder from it. Human-only.
- **`sdlc takeover` / `sdlc release-control`**: a person takes a change from the agent (the hook denies agent edits of its files meanwhile) and hands it back with a note the agent sees. Human-only.
- **The audit shows waits, reworks and attempts.** The log records when a gate starts waiting for a person (`gate.<g>.awaiting`, once per digest); `sdlc audit` reports the wait per gate, the reworks with reasons, approvals per gate and verify attempts to the first pass, and the project audit adds median waits and the most frequent rework reasons.
- **A page per change in the dashboard:** the timeline, waits on people, reworks with reasons, trace gaps and who acts now by name, linked from the list of changes.
- **`sdlc trace <change>`** links intent, requirements, scenarios, tasks, commits, verification evidence and review findings, and lists the gaps. Commits link to tasks through the trailers `SDLC-Change` and `SDLC-Task`, which `/sdlc:build` now asks for.

### Fixed
- **Claude Code: a failed check no longer lets the call through.** The PreToolUse command ended with `|| true`; it now runs the check once more and then blocks the call with the reason (a machine without the CLI still works), as the OpenCode plugin does since 0.7.1.
- **Agents cannot pass for a person by clearing their markers:** unsetting, blanking or un-exporting `CLAUDECODE`, `OPENCODE`, `AGENT` or `SDLC_AGENT` is denied.
- **State files are protected however the path is spelled:** a write after `cd` by bare name, through a glob, or through a symbolic link is denied, as are Windows and PowerShell writes (`del`, `copy`, `[IO.File]::WriteAllText`), `sed -E -i`, `perl -pi`, `find -delete`, `git -C … checkout`, writes to a whole folder that holds state (`rm -rf openspec/changes/<id>`, `git checkout -- openspec/`), creating a hard link to a state file, and uninstalling the sdlc CLI.

### Changed
- A change record that holds a rework or a takeover is written as `version: 2` of `.sdlc.yaml`; older sdlc versions refuse it with an explicit error instead of silently dropping what they do not know. Other records stay `version: 1`.
- Without `roles.yaml`, `sdlc approve --by` is refused on a gate that needs several approvers: the text after `--by` is not an identity check and must not add approvers.

## 0.7.3 — 2026-10-05

### Fixed
- **CLI writes keep what people wrote in `openspec/backlog.md`.** Every backlog command rewrote the whole file from what it understood and dropped notes under items and epics, unknown fields, fenced blocks, extra sections and an unknown status such as `[blocked]`. Since agents may change the backlog only through the CLI, a routine agent edit could erase a person's notes. A command now changes its own item or epic and leaves everything else as it was.
- **Settings writes keep comments and hand-added keys in `openspec/sdlc.yaml`.** `adopt --apply`, `license set`, `init` and `layout adapt` rewrote the file; now only the changed keys are written, and a file with nothing new is not touched.
- After `sdlc init --layout worktree` the output leads with the new worktree; the start hints that follow belong to the worktree, not to the main copy, which has no sdlc.

### Documentation
- The guide (5.2) and the README describe the path for an existing project step by step: `sdlc init` → `/sdlc:adopt` → `/sdlc:explore` per idea → `/sdlc:backlog` → `backlog start` → the gates → `archive` → the next item; where each step needs a person.

## 0.7.2 — 2026-10-05

### Added
- `sdlc backlog epic edit <E-id>` changes an epic's title or goal (`--title`, `--goal`, `--clear-goal`), for example to retarget an epic to another version; items and their order never change. Any actor may run it.

## 0.7.1 — 2026-10-05

### Fixed
- **OpenCode: a failed check no longer lets the call through.** On Windows OpenCode sometimes kills the plugin's `sdlc hook` run after a few milliseconds; the plugin took every failure for "sdlc is not installed" and allowed the call, so an agent's edit of a protected file could pass unchecked (gate approvals were still refused by the CLI). The plugin now runs a failed check once more and then blocks the call with the reason; only a missing CLI is let through, with a warning.

### Changed
- A refused human decision gives the exact command to run in your own terminal and explains that a `!` command in the OpenCode or Claude Code chat runs in the agent's shell, so it counts as the agent's.

### Added
- **`sdlc init` makes the project AI-ready.** In an empty folder the wizard creates the agent documents at once and offers `git init`. In an existing project it shows how the project differs from the AI-ready layout and offers to build the AI-ready project in a new git worktree in a folder you name — the setup, the moved documents and the missing ones in one commit on `sdlc/ai-ready`, your working copy untouched — or to adapt in place. Flags: `--layout scaffold|adapt|worktree|none`, `--worktree <path>`, `--git-init`; only a person may create the worktree.

## 0.7.0 — 2026-10-05

### Added
- **`/sdlc:backlog` (`/sdlc-backlog`): the backlog from the agent.** Without input it shows the list, the next ready item and what blocks the others; with an epic or an idea it proposes items with an outcome and acceptance criteria and adds only the ones you confirm; with `B<n>` it brings the item to ready and offers to start it. Reordering and dropping stay yours: the workflow gives you the command.
- **`sdlc backlog edit <B-id>`** changes an open or in-progress item's title, outcome, acceptance criteria, dependencies, kind or risk, never its place or status.
- **`sdlc adopt`** analyses an existing project (stack, CI, CODEOWNERS, git authors) and drafts the verify commands, protected paths and `openspec/roles.yaml`; `sdlc adopt --apply` writes them, and only a person may run it.
- **`/sdlc:adopt` (`/sdlc-adopt`)** prepares an existing project for agents: layout check, adapt and scaffold, documents filled from the code with file references, then the settings draft. `sdlc init` suggests it.

### Fixed
- The hook catches state-file writes it used to miss: `git checkout`/`restore` of an older copy, PowerShell cmdlets (`Set-Content`, `Copy-Item`…), backslash and `./` spellings, `ln`, patch renames, and paths written in another letter case on Windows and macOS (protected and test paths too). Human-only commands are recognized after global options (`sdlc --locale en approve …`), through `sdlc.cmd` and across line continuations.
- `sdlc backlog add` refuses a dependency on a dropped item.

### Changed
- Agents can no longer edit `openspec/backlog.md` directly; they use the `sdlc backlog` commands, so the order and removal of items stay a person's decision. People still edit the file by hand.

## 0.6.4 — 2026-10-04

### Added
- **The rest of the CLI follows the locale.** Commander's own messages (missing argument, unknown command or option, "did you mean"), every command's `--help` (titles, the description of every option, `-h` and `-V`) and the key hints of the init wizard's prompts are translated. English output is unchanged; the JSON help catalog stays English.
- CONTRIBUTING.md explains how to add a language: copy `assets/locales/en.json`, translate the values, add the code to `LOCALES` and run the tests, which check completeness and placeholders.

### Fixed
- A translated catalog no longer leaves English words in its messages (owner, workflow, branch, drift and others); a test keeps it that way.

## 0.6.3 — 2026-10-04

### Added
- **Every command speaks the locale.** Besides help, status, hints, the wizard, hook reasons and reports, the text output of every command, all error messages with their fixes and all warnings now follow `--locale`, `SDLC_LOCALE`, `locale:` in `sdlc.yaml` or the system locale (in every shipped language). JSON output and error codes stay English and identical in every locale.
- The demo scenario runs in the deck's language, so a deck in another language shows the CLI output in that language.

### Fixed
- `/sdlc:explore`, `/sdlc:intent` and `/sdlc:triage` started without a subject now ask for it instead of inventing one.
- Indexing with codegraph from the init wizard no longer writes `.claude/` into an OpenCode-only project: a bare `codegraph init` asked its own questions and defaulted to Claude Code. The wizard now runs `codegraph install --target <the chosen tools> --location local --yes --init` (index only, `codegraph init --yes`, when no tool is chosen).
- An exploration that pauses for answers or research leaves the note saying where it stopped: open questions go under the new **Open questions** section, unfinished sections are marked `_pending: …_`, and the next run continues from there; without answers the agent continues on recorded assumptions.
- Every workflow talks to the person, and writes notes and artifacts, in their language (or the project's `locale:`), keeping command names, ids and template headings as they are.
- `sdlc doctor` no longer prints Node's DEP0190 deprecation warning on Windows.

## 0.6.2 — 2026-10-04

### Changed
- **The package is now called `sdlc`**, like its command and its repository (`marin-ai-tech/sdlc`). The old name `scdl` pointed every link and install command at a repository that does not exist. Renamed: the npm package, the Claude Code plugin marketplace (`/plugin marketplace add marin-ai-tech/sdlc`, then `/plugin install sdlc@sdlc`; if you added the old marketplace, add the new one and reinstall the plugin), the license names (`sdlc Additional Permissions`, `sdlc Commercial License`, `LICENSES/sdlc-Additional-Permissions.md`) and all links.
- Projects written by `scdl` keep working: records with the old `scdl:` key and the old provenance line are read as before, so approvals do not go stale; new records use `sdlc:`. The `scdl` command still works for one more version and prints a deprecation warning; the hook still denies `scdl approve` and the other human-only commands to agents.

### Fixed
- **Installing works again.** `npm install -g github:marin-ai-tech/sdlc` failed with "tsc is not recognized": npm 11 leaks `-g` into the dependency install it runs to build a git package, which installs the clone globally on top of the real install. Install the latest release instead: `npm install -g https://github.com/marin-ai-tech/sdlc/releases/latest/download/sdlc.tgz`, or from git with the `release` branch, which carries the built code: `npm install -g github:marin-ai-tech/sdlc#release`. A version tag now runs `.github/workflows/release.yml`: tests, the `npm pack` archive attached to the GitHub release (as `sdlc-<version>.tgz` and `sdlc.tgz`), and the `release` branch updated.
- Hints no longer say `npm install -g sdlc` or `npx sdlc`: an unrelated package named `sdlc` is on the npm registry. Project-local installs use `cli: npx --no-install sdlc`.

### Added
- **English and other languages.** Help, `Next:` hints, `sdlc status`, the init wizard, hook reasons, the session context, the Markdown report and the dashboard follow the locale: `--locale <code>`, then `SDLC_LOCALE`, then `locale:` in `openspec/sdlc.yaml`, then the system locale; English when there is no translation. JSON output, the log and change records stay English.
- **Interactive `sdlc init`, like `openspec init`.** Run in a terminal with no flags, it welcomes you, asks for the tools (detected ones preselected), enforcement mode, Claude Code status line, OpenSpec `/opsx` workflows, artifact language and an optional starter `openspec/roles.yaml`, and writes nothing until you confirm the summary. Re-running it offers the current settings. Flags, `--json`, non-terminals and agent sessions never prompt.
- **Interactive `sdlc init` offers the OpenSpec CLI and codegraph.** When either is missing, it asks to install it (OpenSpec pinned to the version sdlc ships, codegraph from npm) and offers to index the project with `codegraph init`; installs run only after a yes, once the settings are written, and a failed install warns with the command to run by hand. Agents, scripts and flag runs never install anything. `sdlc doctor` reports both tools and whether the project is indexed.

## 0.6.1 — 2026-10-01

### Fixed
- `sdlc help` examples are runnable: 13 of them used the word `example` as a gate, id or path (`sdlc roles who example --change example`), three added `--json` to commands that do not have it (`statusline`, `dashboard`, `hook`), and some lacked options the CLI checks at run time (`import bmad`, `defer add`/`close`, `archive`).

### Changed
- The calculator demo shows working with OpenSpec: the change is a plain OpenSpec change (`openspec list`, `status`, `show`), strict validation refuses a delta requirement without a scenario, the `sdlc` schema validates as an OpenSpec schema, and the archived requirement lives in the spec. The deck has three more slides (20).
- The demo team's surnames follow the deck's language (`SDLC_DEMO_PEOPLE`); `npm run demo:deck` runs the scenario once per language, and each deck has its own transcript (`docs/demo/calculator-transcript.en.json`).
- Documentation brought up to date: architecture (roles and signing in the gate model and data model, the full CLI list, which commands have `--json`), README features (AI-ready layout, reports and dashboard, people and roles), the playbook mapping, a CODEOWNERS line for `openspec/roles.yaml`.

## 0.6.0 — 2026-09-30

### Added
- **People and roles in git: `openspec/roles.yaml`** (optional). The file holds:
  - people with their emails and optional SSH signing keys;
  - the roles each person holds;
  - separation rules: the authors of a change's code cannot approve its review or release; listed gate pairs need different people; a per-person gate limit.

  With the file, `sdlc approve` identifies the person by the git email, requires a role the gate accepts, and applies the separation rules. `--by` can no longer record someone else. The approval record gains `person: <id>`. Without the file, behavior is unchanged.
- `sdlc roles who <gate> --change <id>` (who may approve and why others may not), `sdlc roles check`, `sdlc roles migrate` (moves `roles:` from `sdlc.yaml`; human-only). Agents cannot edit `roles.yaml`: the hook and the plugin deny it.
- **Signed approvals: `sdlc approvals verify [--mode off|warn|required]`**:
  - every approval must arrive in a commit signed (SSH) by the key of the person who approved;
  - every change to `roles.yaml` must be signed by a maintainer of the version before it.

  `warn` reports problems; `required` fails, for CI.
- **The calculator demo**: `test/e2e-calculator.test.ts` runs every CLI command on a small project with three people and agents and records a transcript. `npm run demo:deck` turns the transcript into a PowerPoint deck in English and other languages (`scripts/demo/`).
- **Example background process** `scripts/examples/dashboard-watch.mjs`: rebuilds the dashboard page when `openspec/` changes and can serve it on localhost with an auto-refresh. Examples run it as a Windows task, a systemd or launchd service, or a CI step.

## 0.5.0 — 2026-09-30

### Added
- **`sdlc help [topic] [--json]`** and the **`/sdlc:help`** workflow: every workflow with its invocation in Claude Code and OpenCode, every CLI command with usage, example and who runs it (an agent or a person).
- **`Next:` hints**: commands that change state (`new`, `approve`, `reject`, `waive`, `verify`, `archive`, `track set`, `defer add`, `backlog start`, `import`) end with who acts next and how — the exact command when a person must act — and add `next` to their JSON. The session-start context names the next ready backlog item when no change is active.
- **Questions with choices and todo lists in the tools' own UI**: workflows ask through Claude Code's `AskUserQuestion` or OpenCode's `question` tool with 2–4 choices; `/sdlc:build` mirrors `tasks.md` into the todo list (TodoWrite / `todowrite`); `/sdlc:status`, `/sdlc:next` and `/sdlc:help` inline live CLI output. Tool names are rendered per tool, never mixed.
- **Progress drawing**: a stage stepper and a task bar in `sdlc status --change`, a bar per epic in `sdlc backlog list`, Mermaid diagrams (lifecycle per change, epic progress) in the Markdown report with sanitized labels.
- **Claude Code status line**: `sdlc statusline` (one line: change · stage · who acts), opt-in with `sdlc init --statusline`; a user-defined status line is never replaced.

### Changed
- The workflow contract states that an answer in chat is never an approval: human decisions are commands the person runs in their own terminal.
- One list of human-only commands drives both `sdlc help` and the hook; the hook now also denies `sdlc license set` from agents.

## 0.4.0 — 2026-09-30

### Added
- **Backlog in the repository**: `openspec/backlog.md` lists planned changes (one item = one future OpenSpec change) grouped by epics; the order in the file is the priority; ids are never reused. An item is ready when it has an outcome, at least one acceptance criterion and every dependency is done — readiness is computed, never stored.
- `sdlc backlog add | epic add | list | next | start | move | drop | done`. `start` turns a ready item into a change (kind, risk and source from the item, track rules unchanged) with a draft `intent.md`; the intent gate still needs the product owner. `move` and `drop` are human decisions: refused in agent sessions and denied by the hook.
- Archiving a change closes its backlog item (and a deferred-work item the item came from), which unblocks the items that depend on it.
- `sdlc next` with no active change proposes the first ready backlog item.
- `sdlc import bmad <path> --to-backlog [--dry-run]`: BMAD-METHOD epics and tickets (`tickets.toml`, epic and story files) or a PRD/SPEC become backlog epics and items with their acceptance criteria and dependencies.
- The report and the dashboard show the backlog: counts, progress per epic, what is next and what is blocked.

### Changed
- `/sdlc:explore` hands a proceeding idea to the backlog; `/sdlc:next` starts the proposed backlog item.

## 0.3.0 — 2026-09-30

### Added
- **`/sdlc:explore`** and `sdlc explore <slug> | list`: an optional step before intent that researches an idea and pressure-tests it through four lenses (user, technical, cost, risk) and ends with proceed / reshape / stop. Notes live in `openspec/explorations/`; a change can name one as its source (`--source-type exploration`).
- **Review lenses with recorded coverage**: besides the passes from `REVIEW.md`, reviews run the lenses adversarial, edge-cases and verification-gaps (`review.passes`, `review.lenses` in `openspec/sdlc.yaml`). `review.md` records a `## Coverage` line per pass and lens — a count of findings or `none found — checked: …`. `sdlc review check` and the review gate block on missing or unevidenced coverage when `review.require_lens_coverage` is true (the default for new projects).
- **Track suggestion with human confirmation**: `sdlc new` suggests a track from kind and risk. `full` is applied directly; `lite` is only suggested (also when an agent passes `--track lite`) until a person runs `sdlc track set lite --change <id>`. `track set` is refused in agent sessions and denied by the hook, and not allowed after the plan is approved.
- **Deferred-work registry** `openspec/deferred-work.md` with `sdlc defer add | list | close`. A review finding with status `deferred (D<n>)` must point at a registry item (`sdlc review check` blocks otherwise). Open items appear in `sdlc report` and the dashboard.
- **`sdlc import bmad <path> --change <id> [--dry-run]`**: BMAD-METHOD PRD, SPEC and architecture spine become a draft OpenSpec change (intent, proposal, delta specs with traced CAP/FR ids, design) that passes `sdlc validate`; sources are kept in `sources/bmad/`, BMAD "Deferred" items go to the registry, nothing is approved.

### Changed
- An agent can no longer create a `lite` change by itself: its `--track lite` becomes a suggestion for a person to confirm.
- New projects require review coverage of every pass and lens. Existing projects keep working and get warnings until they set `review.require_lens_coverage: true`.

## 0.2.0 — 2026-09-30

### Added
- **AI-ready project layout** (`docs/en/07-ai-ready-project.md`): ten document roles with canonical paths and common aliases — `AGENTS.md` as the main agent guide, a thin `CLAUDE.md` that imports it, `README.md`, `REVIEW.md`, `docs/architecture.md`, `conventions.md`, `glossary.md`, `runbook.md`, `security.md` and `docs/decisions/`. Templates for every role in `assets/project/ai-ready/`.
- `sdlc layout check`: readiness per role (canonical, mapped, alias, missing), `ready` and a 0–100 score.
- `sdlc layout scaffold`: creates the missing documents from templates; never overwrites.
- `sdlc layout adapt`: adaptation mode — records documents found at aliases in the new `layout:` section of `openspec/sdlc.yaml` and creates only what is missing; moves nothing.
- `sdlc layout convert`: conversion mode — a dry-run plan by default; `--apply` converts in a new git worktree on a new branch and commits there, leaving the main working copy untouched; `--in-place` converts the current working copy. Moves use `git mv`; relative Markdown links are rewritten; pinned paths and `openspec/` are never moved. Agent sessions may plan but not apply in worktree mode.
- `sdlc report --format md|json|html [--since] [--change] [--out]`: progress report with stages, blocked changes, changes awaiting a person, lead-time medians, verification first-pass rate, project-log events and layout readiness.
- `sdlc dashboard`: the same model as one self-contained HTML page (no network, light and dark themes, responsive).

### Changed
- Lead-time metrics are shared by `sdlc audit` and the report.
- `dist/` is built on install by the `prepare` script and is no longer expected in git.

### Fixed
- Every file copied from the package (plugin legal files, the OpenSpec schema and templates) is emitted with LF; `.gitattributes` enforces LF checkouts.

## 0.1.0

Initial release: lifecycle stages and gates on top of OpenSpec, content-bound approvals, separation of duties, verification evidence, multi-pass review, deterministic guardrails for Claude Code and OpenCode, audit and metrics.

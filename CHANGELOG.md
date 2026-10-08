# Changelog

All notable changes to sdlc. Versions follow [Semantic Versioning](https://semver.org/); while the major version is 0, a minor version may change behavior.

## 0.11.1 — 2026-10-07

### Fixed
- **Agents cannot weaken the review policy or the artifact rules.** The review policy (`REVIEW.md`, its usual places, or the path in `review.policy`), the sdlc schema in `openspec/schemas/sdlc/` and OpenSpec's `openspec/config.yaml` are guard files: an agent's edits and shell writes are denied, also in `warn` mode; `sdlc init` and `sdlc layout scaffold` still write them. The adopt workflow proposes policy changes to the person instead of editing.

## 0.11.0 — 2026-10-07

### Added
- **The agent team.** Role agents — analyst, architect, developer, tester and reviewer — defined in `docs/agents/<role>.md` and generated as subagents for Claude Code and OpenCode, wired to their stages. sdlc adds to every role where it writes (the artifacts of its stages) and the facts of the project (checks, protected and test paths, people and separation rules, language, documents, context packs and MCP servers of its stages), so roles follow the project. The built-in roles (en, ru) are written for sdlc's artifacts and boundaries.
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
- **Ask the agent how sdlc works.** A guide workflow (`/sdlc:guide`, `/sdlc-guide`, or a plain question) answers how to work with sdlc for your project: stages, gates and approvals, roles, tracks, bug fixes, the backlog, rework and takeover, verification, review, MCP, configuration and hook denials. The material ships with sdlc in English and Russian (`sdlc guide [topic[#section]]`), so it always matches the installed version; the session start mentions it; every hook denial names the section that explains it (`sdlc guide denials#<rule>`); the sdlc MCP server offers it as the `guide` tool.
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
- The Russian catalog no longer leaves English words in its messages (owner, workflow, branch, drift and others); a test keeps it that way.

## 0.6.3 — 2026-10-04

### Added
- **Every command speaks the locale.** Besides help, status, hints, the wizard, hook reasons and reports, the text output of every command, all error messages with their fixes and all warnings now follow `--locale`, `SDLC_LOCALE`, `locale:` in `sdlc.yaml` or the system locale (English and Russian). JSON output and error codes stay English and identical in every locale.
- The demo scenario runs in the deck's language, so the Russian deck shows Russian CLI output.

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
- **English and Russian.** Help, `Next:` hints, `sdlc status`, the init wizard, hook reasons, the session context, the Markdown report and the dashboard follow the locale: `--locale <code>`, then `SDLC_LOCALE`, then `locale:` in `openspec/sdlc.yaml`, then the system locale; English when there is no translation. JSON output, the log and change records stay English.
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
- **The calculator demo**: `test/e2e-calculator.test.ts` runs every CLI command on a small project with three people and agents and records a transcript. `npm run demo:deck` turns the transcript into a PowerPoint deck in English and Russian (`scripts/demo/`).
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

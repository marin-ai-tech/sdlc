# 10. Integrations: MCP, context, secrets and reviewers

Since 0.9.0, sdlc connects to other AI systems through MCP in both directions:

- it runs **its own MCP server**, so another system can read the process;
- it **calls other MCP servers** itself, so a gate can rest on what they answer.

The same release keeps secrets out of agent edits, proposes a reviewer, and gives the agent the team's knowledge at the right stage. Each section below starts from a situation a team runs into. Chapter 11 shows how to put the MCP features to work: connecting clients, orchestrators, reports and their limits.

One rule holds for everything in this chapter: **nothing here makes a decision.** Over MCP, through the inbox, or in a reviewer suggestion, no one can approve, reject, waive, rework, take over, unlock tests, set the license or uninstall. Those stay with a person at their own terminal.

## 10.1. Another AI system reads the process

*Situation.* The team runs an orchestrator, an IDE assistant or a chat client next to its agent tools. It needs to know what stage each change is in, what is next and who acts. It should not scrape text output, and it must not be able to approve anything.

```bash
sdlc init --mcp            # or answer "yes" to the MCP question in the init wizard
```

`--mcp` writes `mcp: { serve: true }` to `openspec/sdlc.yaml` and registers the server for the configured tools:

- `.mcp.json` (Claude Code): `mcpServers.sdlc = { "type": "stdio", "command": "sdlc", "args": ["mcp", "serve"] }`
- `opencode.json` (OpenCode): `mcp.sdlc = { "type": "local", "command": ["sdlc", "mcp", "serve"], "enabled": true }`
- `.cursor/mcp.json` (Cursor): `mcpServers.sdlc = { "command": "sdlc", "args": ["mcp", "serve"] }`
- `.codex/config.toml` (Codex CLI): `[mcp_servers.sdlc]` with `command = "sdlc"` and `args = ["mcp", "serve"]`
- `.qwen/settings.json` (Qwen Code) and `.gigacode/settings.json` (GigaCode): `mcpServers.sdlc = { "command": "sdlc", "args": ["mcp", "serve"] }`

Other servers in those files are kept. `sdlc update` keeps the entry; `sdlc uninstall` removes only the `sdlc` entry. With `cli: npx --no-install sdlc`, the command becomes `npx` and the arguments `--no-install sdlc mcp serve`.

Any other MCP client starts the same command over stdio in the project folder. The tools:

| Tool | Arguments | Answers what this prints |
|---|---|---|
| `status` | `change?` | `sdlc status [--change] --json` |
| `next` | `change?` | `sdlc next [--change] --json` |
| `instructions` | `artifact`, `change` | `sdlc instructions <artifact> --change <id> --json` |
| `trace` | `change` | `sdlc trace <change> --json` |
| `audit` | `change?` | `sdlc audit [--change] --json` |
| `help` | `topic?` | `sdlc help [topic] --json` |
| `guide` | `topic?` | `sdlc guide [topic] --json` |
| `explain` | `change` | `sdlc explain --change <id> --json` (0.19.0) |
| `health` | `since?`, `days?` | `sdlc health [--since] [--days] --json` (0.19.0) |
| `report` | `since?`, `change?` | `sdlc report [--since] [--change] --format json` (0.19.0) |

Each tool runs the CLI command as a separate process and returns its JSON both as structured content and as text. A failed command becomes a tool error carrying the CLI's error code. An argument that the CLI would read as an option (one starting with `-`) is refused.

*Why it is safe.* The server only reads. `status` and `next` may record that a gate started waiting for a person, the same as the CLI does. The decision commands are not tools at all.

**Remote clients over HTTP (since 0.19.0).** `sdlc mcp serve --http <host:port>` serves the same tools over MCP
Streamable HTTP at `/mcp`, for a client that does not start sdlc itself: a central server, a chat assistant, an IDE
on another machine.

```bash
export SDLC_MCP_TOKEN="<a secret of at least 16 characters>"
sdlc mcp serve --http 127.0.0.1:8765     # prints http://127.0.0.1:8765/mcp on stderr; port 0 picks a free port
```

- A bearer token is always required, on localhost too. It comes only from `SDLC_MCP_TOKEN` (at least 16 characters),
  never from a flag, and it is never printed. Without it the server does not start (`token_required`).
- A request without `Authorization: Bearer <token>`, or with another token, gets 401 and reaches no tool.
- A browser `Origin` of another host or port is refused with 403, against DNS rebinding. A client that sends no
  `Origin` passes.
- Only `/mcp` is served (404 otherwise), and a request body is at most 1 MB.
- The server speaks plain HTTP. Between machines, keep it on a private network or behind a TLS proxy.

A client names the URL and the header, for example in `.mcp.json`:

```json
{ "mcpServers": { "sdlc": { "type": "http", "url": "http://build-host:8765/mcp",
  "headers": { "Authorization": "Bearer ${SDLC_MCP_TOKEN}" } } } }
```

Over HTTP, too, the server only reads, and no decision is a tool.

## 10.2. The team's MCP servers, described once

*Situation.* Every developer configures the same Jira and CI servers by hand, in every tool the team uses, with tokens pasted into config files.

```yaml
# openspec/sdlc.yaml
mcp:
  serve: true
  servers:
    jira:
      type: http
      url: https://mcp.corp.example/jira
      headers: { Authorization: "Bearer ${JIRA_TOKEN}" }
      stages: [plan, deploy]
    build:
      type: stdio
      command: [npx, -y, corp-build-mcp]
      env: { CI_TOKEN: "${CI_TOKEN}" }
      stages: [build, test]
```

`sdlc update` lays the registry out for every tool:

| Registry | `.mcp.json` (Claude Code) | `opencode.json` (OpenCode) | `.cursor/mcp.json` (Cursor) | `.codex/config.toml` (Codex) |
|---|---|---|---|---|
| `type: stdio`, `command`, `env` | `type: stdio`, `command`, `args`, `env` | `type: local`, `command` (array), `environment` | `command`, `args`, `env` | `[mcp_servers.<name>]`: `command`, `args`, `.env` |
| `type: http`, `url`, `headers` | `type: http`, `url`, `headers` | `type: remote`, `url`, `headers` | `url`, `headers` | `url`, `.http_headers` |
| `${VAR}` | `${VAR}` | `{env:VAR}` | `${env:VAR}` | env `KEY: "${KEY}"` → `env_vars`; header `"${VAR}"` → `env_http_headers`; `Authorization: "Bearer ${VAR}"` → `bearer_token_env_var` |

Qwen Code and GigaCode get the same servers under `mcpServers` in `.qwen/settings.json` or `.gigacode/settings.json`: stdio as `{ command, args, env }`, http as `{ httpUrl, headers }`, secrets as `${VAR}`, which the tools expand.

sdlc remembers which entries it wrote. A server removed from the registry disappears on the next `update`, and a server someone added by hand is never touched.

Since 0.16.2, set `agents: false` on a registry server used only by the CLI, such as an event receiver or a
verification or release check target. The default is `true`. The CLI can still call it for events, checks and
`sdlc mcp check`, but sdlc omits it from agent MCP settings and stage workflow text. If you change an existing
server to `agents: false`, `sdlc update` removes entries sdlc wrote in `.mcp.json`, `opencode.json`,
`.cursor/mcp.json` and `.codex/config.toml`; entries added by a person stay. `stages: []` still means the
`mcp-stage` rule does not check it; use `agents: false` to keep the server away from agents.

**Secrets only as references.** A literal key or token in `env` or `headers` is a configuration error (`mcp_secret_literal`). Nothing is written, and the message names the server and the key, never the value.

`sdlc doctor` checks "mcp variables". An unset `${VAR}` in a registry server's `env` or `headers` produces a warning
that names the server and variable, never its value.

**Check before you rely on it.**

```bash
sdlc mcp check --json
```

It connects to every server, lists its tools and marks the unreachable ones. It also warns about a server whose tools can write files: such a server could change files behind the hook's back, so keep it out of the registry.
JSON gives each server an `args` map from tool name to `[{ name, type, required }]`, taken from the tool's input schema.
Use `sdlc mcp check --args` for text such as `name(arg: type, opt?: type)`, one tool per line.
Without `--args`, the text output is unchanged.
Use `sdlc mcp check --strict` in CI: it exits 1 if a registry server cannot be reached. Without `--strict`, it exits 0.

## 10.3. CI status as gate evidence

*Situation.* The verify gate should pass only when the CI pipeline for this exact commit is green. Asking the agent "is CI green?" is not evidence.

```yaml
verify:
  commands:
    - { name: test, run: npm test }
  mcp:
    - name: ci-green
      server: github
      tool: list_workflow_runs
      args: { head_sha: "${HEAD}" }
      expect: { workflow_runs: { $any: { conclusion: success } } }
      wait_while: { workflow_runs: { $any: { status: [queued, in_progress] } } }
      wait_seconds: 600
```

`sdlc verify` calls the tool itself; the CLI is the MCP client:

- `${HEAD}` becomes the head commit and `${CHANGE}` the change id.
- The answer must contain `expect` (a deep subset).
- In `expect` and `wait_while`, `{ $any: <pattern> }` matches when at least one answer-list item contains the
  pattern; patterns can nest. Plain lists still match item by item and by exact length. Another `$` key, or `$any`
  beside another key, is invalid configuration.
- Use the tool and argument names your GitHub server exposes. `wait_while` uses the same deep subset shape as
  `expect`; a list value matches any listed value. While it matches, the CLI asks again, pausing from 1 to 15 seconds.
  `wait_seconds` accepts 0..3600 and defaults to 0 (no wait). After the limit, the check fails with
  `Still pending after N seconds`. The same options work in `release.mcp`.
- A mismatch, a tool error, a timeout or an unreachable server fails the check with the reason (for a mismatch: the key, the expected and the actual value).
- A required MCP check that fails fails the verification, just like a failing command.
- Results go into the evidence next to the commands' results. The JSON answer lists them under `mcp`.
- `sdlc verify --list` shows the MCP checks (name, server, tool, required) next to the commands.
- `${HEAD}` is the last commit, but `sdlc verify` checks the working tree. Since 0.17.0, a check whose arguments use
  `${HEAD}` is not called while the working tree has uncommitted changes outside `openspec/` (modified, staged or
  untracked files). It fails with a reason to commit (and push) first. Checks without `${HEAD}` run as before. The
  same rule holds for `release.mcp`.

*Why it is safe.* The agent never reports the result: the CLI calls the server and records what it got. An agent cannot edit the evidence or `openspec/sdlc.yaml`, because the hook denies both.

**A ready CI configuration (since 0.17.0).** `sdlc ci init --provider github|gitlab [--check <server>] [--force]`
writes a starter CI configuration that runs the sdlc checks. It is a person's command: in an agent session it is
refused, and the hook denies it too.

- `--provider github` writes `.github/workflows/sdlc.yml`. The job checks out the full history (`fetch-depth: 0`),
  sets up Node 20, installs this sdlc version from the release package, and runs `sdlc validate --all` and
  `sdlc approvals verify`.
- `--provider gitlab` writes `.gitlab/sdlc.yml`: one job on a full clone (`GIT_DEPTH: "0"`) with the same commands.
  When the project has no `.gitlab-ci.yml`, the command creates one with `include: [{ local: .gitlab/sdlc.yml }]`.
  An existing `.gitlab-ci.yml` is never edited: the command prints the include line to add.
- An existing file is kept. `--force` rewrites it.
- `--check <server>` adds the `ci-green` check to `verify.mcp` for that registry server. For GitHub it calls
  `list_workflow_runs` with `head_sha: "${HEAD}"` and expects `{ workflow_runs: { $any: { conclusion: success } } }`.
  For GitLab it calls `list_pipelines` with `sha: "${HEAD}"` and puts `$any` at the top level, because the answer is
  a list. Both wait (`wait_while`) while a run is queued or in progress, for up to `wait_seconds: 900`. A check named
  `ci-green` that already exists is kept.
- The tool and argument names are the server's own and may differ: confirm them with `sdlc mcp check --args`.

```bash
sdlc ci init --provider github --check github
```

## 10.4. A result for the agent who was not there

*Situation.* A person runs `sdlc verify` in their terminal, or CI runs it at night, and a check fails. The agent should learn about it in its next session without anyone having to tell it.

- **Inside an agent session**, the result goes back to the agent in the command's answer.
- **Outside one**, each MCP check result is also written to `openspec/.sdlc/inbox/`.

At the start of its next session, the agent sees one line per open item: the change, the check, and whether it passed. It works through them and marks each one as read:

```bash
sdlc inbox list --json
sdlc inbox done <id>
```

`inbox done` marks an item as read; it decides nothing, so an agent may run it. The inbox files themselves are written only by the CLI: the hook denies agent edits of them, as it does for the log.

## 10.5. What the agent uses at each stage

*Situation.* The deploy server must not be called while the change is still being planned, and the Jira server is not needed while code is being written. The team also wants the build stage to use its test-driven-development skill and the simplifier subagent, and the design stage its architecture review.

```yaml
stages:
  design: { skills: [architecture-review], agents: [sdlc-researcher] }
  build:  { skills: [test-driven-development], agents: [sdlc-simplifier] }
```

Each generated workflow belongs to a stage:

| Workflows | Stage |
|---|---|
| explore, intent | plan |
| spec | design |
| plan, build | build |
| verify | test |
| review, release | deploy |
| archive, triage | maintain |

A workflow ends with a short **Stage resources** section listing its stage's skills, subagents and MCP servers, and nothing from other stages. The MCP servers of a stage come from the registry's `stages`, so they are written down only once. The Claude Code skill also pre-allows the tools of those servers (`allowed-tools: Bash(sdlc *), mcp__build__*`). Projects without `stages` and without servers get exactly the files they had before.

The list is guidance for the agent. The servers are also enforced:

`stages` in the registry say when a server may be used. The `mcp-stage` rule recognizes Claude Code tool names
`mcp__<server>__<tool>` and OpenCode names `<server>_<tool>`. Cursor is checked when it reports the former form;
a bare tool name is not checked by stage (see [15.4](15-cursor.md#154-limits-we-accept)). Codex CLI, Qwen Code
and GigaCode send every tool call to sdlc's hook, but their MCP tool names are not verified live. For these tools,
`mcp-stage` applies only when the reported name has one of the two recognized forms. A call to a registry server
outside the active changes' stages is denied in `block` mode and reminded in `warn` mode.

These are not checked:

- the `sdlc` server;
- servers outside the registry;
- any call while there is no active change.

## 10.6. No secrets in agent edits

*Situation.* An agent pastes a token into a config file to make a test pass. Once committed, it has leaked.

The hook denies an agent's edit, or a shell write, that **adds** a secret (rule `secret-in-edit`). It is a hard rule, so it also applies in `warn` mode. It recognises:

- AWS access keys;
- GitHub, GitLab and Slack tokens;
- Google API keys;
- private key headers;
- passwords in URLs;
- assignments such as `password = "…"` with a long value.

What is **not** a secret:

- references and placeholders: `${VAR}`, `$VAR`, `{{ … }}`, `<your-password>`, `process.env.X`;
- AWS's documented `…EXAMPLE` keys;
- public keys;
- removing a secret, or keeping one that was already there.

The reason names the kind of secret and the file, never the value. Test data that needs real-looking keys goes under paths that a person lists in `openspec/sdlc.yaml`:

```yaml
enforcement:
  secret_allow: ['test/fixtures/**']
```

The patterns are fixed prefixes, with no entropy guessing. That keeps false alarms rare, but a secret in an unusual format will not be caught.

## 10.7. Who should review this change

*Situation.* A change reaches review and someone has to choose the reviewer. Choosing by hand ignores who owns the code and who is already overloaded.

```bash
sdlc review suggest --change add-export --json
```

1. **Candidates** are the people who may approve the review gate of this change under `openspec/roles.yaml` and its separation rules. The authors of the code are never candidates.
2. **Owners first.** Owners of the changed files by CODEOWNERS come first, those who own more of them ahead. As in git, the last matching rule decides who owns a file.
3. **Ties.** Between equals, the one with fewer open reviews comes first. An open review is another active change waiting for a review approval that this person may give.

People who hold the role but may not approve are listed under `excluded` with their rules. Without `roles.yaml` the command reports `roles_required`.

It is read-only, so an agent may run it and name the suggestion to the person. The person still approves.

## 10.8. Team knowledge at the right stage

*Situation.* The agent keeps forgetting a domain rule ("a refund never exceeds the charge"). Meanwhile the wiki page that holds it has not been updated for a year.

Put each piece of knowledge in `docs/context/` with a header:

```markdown
---
owner: alice
source: https://wiki.corp.example/payments
updated: 2026-09-01
fresh_days: 90
stages: [design, build]
---

Refunds never exceed the charge.
```

`sdlc instructions <artifact>` adds to the instructions the sources whose `stages` include the artifact's stage. A planning artifact's stage is the stage of its gate; for the records, verify is in `test`, and review and release are in `deploy`. The JSON answer lists them under `contextSources`, with owner, source, date and content.

A source older than `fresh_days` is marked `stale`, and the agent is told to check it with its owner. A file without a valid header is skipped and named under `contextSkipped`.

**Packs from the knowledge server (since 0.19.0).** When the knowledge lives on the team's knowledge server, list it
in `openspec/sdlc.yaml` and pull it into files:

```yaml
context:
  sources:
    - { name: glossary, server: kb, resource: "kb://glossary", stages: [design], owner: docs-team, fresh_days: 30 }
    - { name: faq, server: kb, tool: search_docs, args: { query: claims }, stages: [build], owner: support }
```

`server` is a name in `mcp.servers`. `sdlc context pull [--name <name>] [--json]` reads each source, an MCP resource
or the text a tool answers, and writes `docs/context/<name>.md` with the header above: `owner`,
`source: mcp:<server> <resource or tool>`, `updated:` today, `fresh_days` and `stages`. JSON:
`{ pulled: [{ name, file }], failed: [] }`.

- The packs stay files: they are in git and go through review like any change, and `sdlc instructions` stays offline.
- A source that fails is listed under `failed` (exit code 1), and its existing file stays as it was.
- A `name` that is not a plain file name (`../x`, `a/b`), or a `server` that is not in `mcp.servers`, is an invalid
  configuration, and nothing is written.

Pull by hand or on a schedule, and commit what changed.

## 10.9. The guard protects its own configuration (0.8.2)

Everything above depends on the agent not being able to switch the guard off. Since 0.8.2, the hook denies agent edits and shell writes of the files that configure it:

- `openspec/sdlc.yaml`;
- `.claude/settings*.json`;
- `.opencode/plugins/sdlc.js`;
- `.mcp.json`, `opencode.json(c)`, `.cursor/mcp.json`, `.cursor/hooks.json`, `.codex/config.toml`, `.codex/hooks.json`, `.codex/rules/sdlc.rules`, `.qwen/settings.json` and `.gigacode/settings.json`;
- the manifest;
- the user-level agent settings that can disable every hook.

In an agent session, `sdlc init` and `sdlc update` refuse to weaken the guard: a lower mode, fewer tools, `--no-hooks` or another `--cli`. `sdlc uninstall` is a person's command. `sdlc doctor` warns about `disableAllHooks`.

## 10.10. Since 0.10.0

- `sdlc mcp serve --project <path>` serves projects from outside their folders; several projects in one server.
- The server offers read-only resources: context packs, living specs, change artifacts, documents for agents.
- `release.mcp` checks hold the release approval until an outside system agrees; `sdlc release check` runs them beforehand.
- `events` push process events to an MCP server, with the people a gate waits for and overdue gates.

Since 0.15.0 a receiver may ask for a ready message. With `message: text`, sdlc calls the tool with the static
`args` plus `text`: one line naming the project, change, gate and people by name from `roles.yaml`, in the command's
locale. The `event` object is then not sent. The text is built when queued, so an outbox event keeps the same text.
By default, it contains no email, note, command or output. Since 0.16.1, `include_note: true` opts a receiver into
rejection and rework notes. The note is one line, at most 200 characters, with secrets masked. An event object gains
`note`; a ready message appends ` — <note>` after its text. The default is off.

```yaml
events:
  - server: telegram
    tool: send_message
    on: ["gate.*"]
    args: { chat_id: "${TELEGRAM_CHAT_ID}" }
    message: text
    include_note: true
```

Chapter 11 shows the use cases.

## 10.11. Since 0.19.0: GitHub Issues and the team chat

**GitHub Issues and the backlog.** *Situation.* Requests arrive as GitHub issues, but the team plans in
`openspec/backlog.md`. Copying them by hand loses some, and nobody closes the issue when the change is done.

```yaml
mcp:
  servers:
    github: { type: http, url: https://mcp.corp.example/github, headers: { Authorization: "Bearer ${GITHUB_TOKEN}" } }
issues: { server: github, repo: acme/claims }
```

- `issues.server` names the team's GitHub MCP server in `mcp.servers`, and `repo` is `owner/name`. sdlc holds no
  token: the server has its own.
- `sdlc backlog import --issues [--json]` asks the server for the open issues and adds one backlog item per issue that
  is not linked yet: the title and the field `**Issue**: GH-<n>`. Pull requests are not issues and are skipped. A
  second import adds nothing. Without `issues` the command is refused with `issues_not_configured` and calls nothing.
- The order of the backlog stays a person's decision (`sdlc backlog move`).
- When a change whose backlog item has an issue is archived, sdlc comments on the issue (the comment names the change)
  and closes it. The calls go through the event outbox: a failing server does not fail the archive, and
  `sdlc events flush` delivers them later. An item without an issue never causes a GitHub call.
- sdlc calls the tools `list_issues`, `add_issue_comment` and `update_issue`, as GitHub's MCP server names them.
  `sdlc mcp check --args` shows whether your server has them.

**Telegram as an event receiver.** *Situation.* The team works in a Telegram chat. It wants the daily summary there,
and a gate that waits should mention the person who must act.

```yaml
events:
  - server: telegram                  # a Telegram MCP server in mcp.servers
    tool: send_message
    on: ["gate.*", "summary.daily"]
    args: { chat_id: "${TELEGRAM_CHAT_ID}" }
    message: text
    chat: telegram
```

```yaml
# openspec/roles.yaml
people:
  alice:
    name: Alice
    emails: [alice@corp.example]
    chat: { telegram: "@alice_tg", slack: U0ALICE }
```

- `sdlc events summary [--since <date>] [--json]` records the event `summary.daily`: the counts of changes done,
  active, waiting for people and blocked, and the waiting changes. Only a receiver whose `on` names `summary.*` or
  `summary.daily` gets it; the default patterns do not. With `message`, the text names the project and the waiting
  changes. One summary per project and day, so run it once a day from a scheduler or a CI job.
- `chat: telegram` gives the receiver `waitingForChat`, the telegram handles of the people in `waitingFor`, and its
  text mentions them. A receiver without `chat` never gets a handle: handles go only to a receiver that names their
  channel.
- A wait has the same event id in every clone and in CI. The id comes from `project.name` (when set), the change, the
  gate, the event and the digest, so a receiver that keeps event ids drops the repeats.
- The CI configuration from `sdlc ci init` runs `sdlc events flush` at the end, also when a check failed, so waits
  seen in CI reach the chat.

sdlc has no chat API of its own. A Telegram MCP server is a receiver like any other; any chat server with a tool that
takes the text works the same way.

## 10.12. Limits we accept

- **The secret patterns** are a floor, not a scanner: keep a secret scanner in CI as well.
- **The shell rules are heuristics on the command text.** A path built at run time (`cd "$DIR"`, a variable set in the same command) can slip past them. A computed path is much rarer in an agent's command than a literal one.
- **`mcp check`'s warning about file access is a guess from tool names.** A server that writes files under another name is not flagged. Review a server before adding it to the registry.
- **The MCP server's tools start the CLI anew for each call.** That keeps it simple and identical to the CLI, at a cost of about half a second per call.

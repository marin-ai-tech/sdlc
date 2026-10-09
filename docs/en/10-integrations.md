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

Each tool runs the CLI command as a separate process and returns its JSON both as structured content and as text. A failed command becomes a tool error carrying the CLI's error code. An argument that the CLI would read as an option (one starting with `-`) is refused.

*Why it is safe.* The server only reads. `status` and `next` may record that a gate started waiting for a person, the same as the CLI does. The decision commands are not tools at all.

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

**Secrets only as references.** A literal key or token in `env` or `headers` is a configuration error (`mcp_secret_literal`). Nothing is written, and the message names the server and the key, never the value.

**Check before you rely on it.**

```bash
sdlc mcp check --json
```

It connects to every server, lists its tools and marks the unreachable ones. It also warns about a server whose tools can write files: such a server could change files behind the hook's back, so keep it out of the registry.

## 10.3. CI status as gate evidence

*Situation.* The verify gate should pass only when the CI pipeline for this exact commit is green. Asking the agent "is CI green?" is not evidence.

```yaml
verify:
  commands:
    - { name: test, run: npm test }
  mcp:
    - name: ci-green
      server: build
      tool: pipeline_status
      args: { ref: "${HEAD}" }
      expect: { status: success }
```

`sdlc verify` calls the tool itself; the CLI is the MCP client:

- `${HEAD}` becomes the head commit and `${CHANGE}` the change id.
- The answer must contain `expect` (a deep subset).
- A mismatch, a tool error, a timeout or an unreachable server fails the check with the reason (for a mismatch: the key, the expected and the actual value).
- A required MCP check that fails fails the verification, just like a failing command.
- Results go into the evidence next to the commands' results. The JSON answer lists them under `mcp`.

*Why it is safe.* The agent never reports the result: the CLI calls the server and records what it got. An agent cannot edit the evidence or `openspec/sdlc.yaml`, because the hook denies both.

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

`stages` in the registry say when a server may be used. The Claude Code hook now also sees MCP tools (`mcp__<server>__<tool>`), and the OpenCode plugin sees `<server>_<tool>`. The hooks of Cursor, Codex CLI, Qwen Code and GigaCode check a tool by the same names; Cursor's tool name does not always say the server, and then the call is not checked by stage (see [15.4](15-cursor.md#154-limits-we-accept)). A call to a registry server is checked against the stages of the active changes. If its `stages` include none of them, rule `mcp-stage` applies: the call is denied in `block` mode and the agent is reminded in `warn` mode.

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

Chapter 11 shows the use cases.

## 10.11. Limits we accept

- **The secret patterns** are a floor, not a scanner: keep a secret scanner in CI as well.
- **The shell rules are heuristics on the command text.** A path built at run time (`cd "$DIR"`, a variable set in the same command) can slip past them. A computed path is much rarer in an agent's command than a literal one.
- **`mcp check`'s warning about file access is a guess from tool names.** A server that writes files under another name is not flagged. Review a server before adding it to the registry.
- **The MCP server's tools start the CLI anew for each call.** That keeps it simple and identical to the CLI, at a cost of about half a second per call.

---
title: Why the hook said no
summary: Every hook rule - why it stopped the agent, and what to do.
---
# Why the hook said no

The Claude Code hook and the OpenCode plugin check every edit, shell command and MCP call of the agent. A denial names
its rule in brackets, for example `[sdlc:plan-gate]`. Hard rules apply in `warn` mode too; process rules deny only in
`block` mode and remind in `warn`.

## plan-gate

Process rule. Code was about to be written with no approved plan. **Do:** write `plan.md` and `tasks.md` (the plan
workflow) and have a person run `sdlc approve plan --change <id>`. Docs and `openspec/` are exempt.
Since 0.14.0 a shell command counts too, in every tool: the files it writes (`>`, `tee`, `cp`, `mv`,
`Set-Content`/`sc`, `Tee-Object`, `Out-File`, `New-Item`, `Copy-Item`/`Move-Item`, `Rename-Item`,
`.NET File` writers, `sed -i`, `perl -i`, `touch`, `truncate`, `dd of=`, `git checkout`/`restore`/`mv`/`apply`, `patch`,
`curl -o`, `wget -O`, `Invoke-WebRequest -OutFile`, `node -e`, `python -c`, commands inside `iex` and
`Start-Process`, and `apply_patch`) are checked like an edit;
reading never is.

## protected-path

Hard rule. The path is in `enforcement.protected_paths`. **Do:** change it through its owning process, outside the
agent session.

## tests-locked

Hard rule. A bug fix locked the tests (`sdlc tests lock`). **Do:** fix the code, not the test. If the test is really
wrong, a person runs `sdlc tests unlock --change <id>`.

## state-integrity

Hard rule. `.sdlc.yaml`, `openspec/roles.yaml`, the log, the inbox, the team record and the backlog are records only the CLI
writes.
**Do:** use the commands: `sdlc approve` (a person), `sdlc backlog add|edit`, `sdlc verify`.

## guard-config

Hard rule. The file configures the guard itself: `openspec/sdlc.yaml`, `.claude/settings*.json`, the OpenCode plugin,
`.mcp.json`, `opencode.json`, the manifest, the user's agent settings, the accepted team roles in `docs/agents/`,
the files sdlc generates for the agents (`sdlc-*` subagents, workflow skills and commands), the review policy
(`REVIEW.md` or `review.policy`), the sdlc schema and `openspec/config.yaml`. **Do:** ask a person to make the change;
`sdlc update` restores generated files.

## separation-of-duties

Hard rule. The command records a person's decision (`sdlc approve`, `sdlc reject`, `sdlc waive`, `sdlc rework`,
`sdlc takeover`, `sdlc track set`, `sdlc backlog move`, `sdlc uninstall`…). **Do:** give the person the exact command
for their own terminal — not a `!` command in the agent chat.

## agent-marker

Hard rule. The command clears `CLAUDECODE`, `OPENCODE`, `AGENT`, `SDLC_AGENT`, `CURSOR_AGENT`, `CODEX_CI`, `QWEN_CODE` or
`CODEX_SESSION_ID` (Codex) or `QWEN_CODE_SESSION_ID` (Qwen), which would let an agent pass for a person.
**Do:** run it without touching these variables.

## cli-removal

Hard rule. Uninstalling the sdlc CLI would switch the checks off. **Do:** a person removes it, if that is really wanted.

## secret-in-edit

Hard rule. The edit adds a key, a token or a password. **Do:** read it from an environment variable or a secret store
(`process.env.X`, `${VAR}`). Test data with real-looking keys goes under `enforcement.secret_allow` (a person adds it).

## release-gate

Hard rule. A production release command (`release.commands`) before the release approval. **Do:** prepare
`release.md`; a release manager runs `sdlc approve release --change <id>`.

## takeover

Hard rule. A person holds the change (`sdlc takeover`). **Do:** wait for `sdlc release-control`; read-only commands
still work.

## mcp-stage

Process rule. The MCP server is not meant for the current stage (`mcp.servers.<name>.stages`). **Do:** wait for a stage
it is listed for, or ask a person to add the stage.

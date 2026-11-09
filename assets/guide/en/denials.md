---
title: Why the hook said no
summary: Every hook rule - why it stopped the agent, and what to do.
---
# Why the hook said no

The guard of your tool checks every edit, shell command and MCP call of the agent: the hooks of Claude Code, Cursor,
Codex CLI, Qwen Code and GigaCode, or the OpenCode plugin. A denial names its rule in brackets, for example
`[sdlc:plan-gate]`. Hard rules apply in `warn` mode too; process rules deny only in `block` mode and remind in `warn`.
Hook denials and warnings first append to the ignored local queue. `sdlc log` and `sdlc health` read them immediately;
the next CLI command that writes the shared log moves them there in order.

## config-load

Every agent call is denied when `openspec/sdlc.yaml` cannot be loaded, unless its raw `enforcement.mode` is exactly
`off`. A person must fix the file and can run `sdlc doctor` to see the error. If the `cli` value was refused, set an
accepted value and run `sdlc update` to rewrite the hook commands already installed in agent settings.

## plan-gate

Process rule. Code was about to be written with no approved plan. **Do:** write `plan.md` and `tasks.md` (the plan
workflow) and have a person run `sdlc approve plan --change <id>`. Docs and `openspec/` are exempt.
With several active changes, code may be written only to files listed under "## Files that change" in an approved
plan, including matching globs; with one active change, an approved plan opens code edits as before.
Since 0.14.0 a shell command counts too, in every tool: the files it writes (`>`, `tee`, `cp`, `mv`,
`Set-Content`/`sc`, `Tee-Object`, `Out-File`, `New-Item`, `Copy-Item`/`Move-Item`, `Rename-Item`,
`.NET File` writers, `sed -i`, `perl -i`, `touch`, `truncate`, `dd of=`, `git checkout`/`restore`/`mv`/`apply`, `patch`,
`curl -o`, `wget -O`, `Invoke-WebRequest -OutFile`, `node -e`, `python -c`, commands inside `iex` and
`Start-Process`, and `apply_patch`) are checked like an edit;
reading never is. Read and search tools stay available before plan approval and during a takeover, even when their
input names a path. Tools that can write remain subject to the guard.

## protected-path

Hard rule. The path is in `enforcement.protected_paths`. **Do:** change it through its owning process, outside the
agent session.

## tests-locked

Hard rule. A bug fix locked the tests (`sdlc tests lock`). **Do:** fix the code, not the test. If the test is really
wrong, a person runs `sdlc tests unlock --change <id>`.

## state-integrity

Hard rule. `.sdlc.yaml`, `openspec/roles.yaml`, the shared log, the local hook decision queue
`openspec/.sdlc/hook-log.jsonl`, the inbox, the team record, the backlog,
`openspec/.sdlc/board.json` and its lock `openspec/.sdlc/board.lock` are records only the CLI writes.
Only a person edits the executor registry `openspec/executors.yaml`.
**Do:** use `sdlc approve` (a person), `sdlc backlog add|edit` or `sdlc verify` for their records.
Have a person edit the registry; change board state through `sdlc board`.
Reads with stderr redirected to `/dev/null`, `nul` or `$null`, or with a descriptor duplicated or closed, remain reads.
An uncertain copy names its unresolved source or destination; use a literal path to make the target inspectable.
An inline script string that could match state only as a glob names that string. Put the script in a file to avoid the
inline string scan.

## guard-config

Hard rule. The file configures the guard itself: `openspec/sdlc.yaml`, `.claude/settings*.json`, the OpenCode plugin,
`.mcp.json`, `opencode.json`, `.cursor/hooks.json`, `.cursor/mcp.json`, `.codex/hooks.json`, `.codex/config.toml`,
`.codex/rules/sdlc.rules`, `.qwen/settings.json`, `.gigacode/settings.json`, the manifest, the user's agent settings
(Cursor's user-level hooks `~/.cursor/hooks.json` among them), the accepted team roles in `docs/agents/`, the files
sdlc generates for the agents (`sdlc-*` subagents, workflow skills and commands), the review policy (`REVIEW.md` or
`review.policy`), the sdlc schema, `openspec/config.yaml` and the configured launcher (`package.json` `scripts.sdlc`
or the shim the `cli:` setting runs).
**Do:** ask a person to make the change; `sdlc update` restores generated files.
Reading these files with stderr sent to `/dev/null`, `nul` or `$null`, or with a descriptor duplicated or closed,
is allowed. A second redirect to a guarded file and other writes still receive this denial.

## shell-parse

Hard rule. The shell command could not be read safely: an unterminated quote, too deep nesting, a command over the
size or word limit, Unicode whitespace inside a recognized command, or an sdlc operation and its target that cannot be
resolved without running the command. With literal shell values, it also means too many spellings ("Split the
loop or put the commands in a script file.") or spellings that took too long to check ("Checking the literal
shell values took too long."). **Do:** write the command plainly - literal words, no command substitution or
computed sdlc words - or split it into simpler commands.

## plugin

Hard rule. An accepted runtime plugin's hook or command catalog refused the call or failed while checking it; the
reason carries the plugin's code. A plugin can only add a restriction, never lift a core one. **Do:** read the
reason; a person checks `sdlc plugins inspect <name>` and `sdlc doctor`, and see `sdlc guide plugins`.

## separation-of-duties

Hard rule. The command records a person's decision (`sdlc approve`, `sdlc reject`, `sdlc waive`, `sdlc rework`,
`sdlc takeover`, `sdlc track set`, `sdlc backlog move`, `sdlc uninstall`…). **Do:** give the person the exact command
for their own terminal — not a `!` command in the agent chat.

## living-specs

Process rule. Living specs under `openspec/specs/` change only when `sdlc archive` merges an approved change.
**Do:** write the delta spec at `openspec/changes/<id>/specs/<capability>/spec.md`.

## change-not-created

Process rule. The change folder has neither `.sdlc.yaml` nor `.openspec.yaml`.
**Do:** create it with `sdlc new <id>` or `sdlc backlog start B<n> --change <id>`.

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

## Limits of a static reading

The hook reads the text of one command. It stops mistakes and casual workarounds; it is not a security boundary.
Where an approval must hold, turn signing on and run `sdlc approvals verify --mode required` in CI.

What it follows: a literal assignment in the same command, so `T=openspec/roles.yaml; rm "$T"` is refused like
`rm openspec/roles.yaml`, also through `export`, a `for` list, PowerShell `$T = '...'` and cmd `set`. One list of
known writers feeds every check. A delete counts for the plan gate and locked tests. `git stash` in its writing forms,
`git reset --hard` and `git clean -f` count for those two checks as a write of the whole tree, in any folder, since
the hook cannot tell which tree another folder belongs to. An input redirect
before a git subcommand, a `cd` it cannot resolve and a variable prefix such as `$PWD/` do not hide a state, guarded,
protected or test path.

A command whose variables give more than 16 possible spellings is refused: split the loop or put the commands in a
script file. So is a long command when its spellings, counted with the command itself, times its words pass 512.
It is also refused when its spellings together hold more than 512 words or more than 32,768 characters; the words
of nested shell bodies count too. These budgets bound words and characters, not time. So the work that literal
values add also has a time limit, measured between steps. Building the spellings with values has half a second
from its start. The command as written is then checked with no limit and keeps its own refusal. Checking the
added spellings has 5 s, ending by 20 s after the check started. Past either limit the command is refused with
shell-parse. A command
substitution is refused; make a temporary file with plain `mktemp`. A variable set to an empty value is read as an
empty word, and a file argument set to it is refused as an empty path.
Text after a `#` is read like any other command text, so a path named in a comment can be refused; keep comments
out of commands.

What it does not follow:

- an assignment in an earlier shell call, or an export read by a script;
- a script or program given a protected path, or holding one, and any program the agent wrote;
- `source`, aliases and functions; `xargs`; `find ... -delete` for the plan gate and locked tests (the state and
  guard checks refuse it);
- a delete of a folder that holds protected paths or locked tests, such as `rm -rf src`;
- a variable prefix is read as the project root, so with tests locked `"$TMPDIR/test/out.log"` counts as a test path;
- values read at run time (`read`, `printf -v`, a substitution) and file names built by program logic;
- `mkdir`;
- `git stash`, `git reset --hard` and `git clean` after the plan is approved, and branch switches, merges, pulls and
  rebases, which rewrite tracked files without naming them;
- the plan gate after a directory that cannot be resolved, since any relative path would match it;
- a quoted or escaped `}` in the default text of a braced use, such as `${T:-'}'}`;
- a PowerShell assignment followed by a comment on its line;
- a write target after a quoted `#` or a `<# #>` block, and a whole-tree git write followed by a comment, such as
  `git clean -fd # -n`;
- a `cd` to a variable before a nested shell body, such as `cd $D; bash -c '...'`;
- one long step of the added checks: the time limit is checked between steps, so a write through a value after a
  `cd` into a folder hundreds of levels deep can still keep the hook past the host timeout, which then allows the
  call (a watchdog in the hook is planned).

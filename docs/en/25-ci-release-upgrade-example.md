# 25. Example: CI, release protection and upgrading sdlc

This example ran on October 17, 2026, on the TodoMVC project of the [from-scratch example](19-team-greenfield-example.md).
The team upgraded sdlc to a new version, put the sdlc checks into CI, closed the release commands to agents through a
settings proposal, and checked that changing the license and removing the integrations stay a person's decisions.

## 25.1. Upgrading sdlc

Before the upgrade Linda added her own line to a generated agent file, `.qwen/commands/sdlc-status.md`. Then:

```bash
npm install -g https://github.com/marin-ai-tech/sdlc/releases/latest/download/sdlc.tgz
sdlc doctor
sdlc update
```

`sdlc doctor` said the files came from the previous version and one was edited by hand, and asked for `sdlc update`.
`sdlc update`:

```text
warning: kept .qwen/commands/sdlc-status.md (edited locally; run with --force to overwrite)
  Qwen Code hooks and deny rules: installed in .qwen/settings.json
```

The other files and the hooks were updated, a new agent workflow `sdlc-config` appeared, and `openspec/sdlc.yaml` and
`openspec/roles.yaml` stayed byte for byte the same. Linda's line was still there.

## 25.2. The sdlc checks in CI

`sdlc ci init` from an agent was refused: "Only a person may write CI configuration". Linda:

```bash
sdlc ci init --provider github
```

`.github/workflows/sdlc.yml` has a full clone (`fetch-depth: 0`; without it `approvals verify` refuses), Node 20, the
install of the sdlc version that wrote the file, and three steps:

```yaml
- run: sdlc validate --all          # changes and specs are valid
- run: sdlc approvals verify        # approvals are in place (and signed where roles.yaml asks for it)
- if: always()
  run: sdlc events flush            # queued waits reach the event sink, also after a failed check
```

The CI token is read-only. The steps run locally on `main` passed.

## 25.3. Release protection through a settings proposal

Agents cannot change `openspec/sdlc.yaml`. Linda asked her agent, through `/sdlc-config`, to close releasing to agents
without a release approval: `git push --tags`, `npm publish`, `npm run deploy`. The agent prepared a proposal:

```bash
sdlc config propose --set 'release.commands=[…, "git\\s+push\\s+--tags", "npm\\s+publish", "npm\\s+run\\s+deploy"]' \
  --reason "Keep agents from releasing without a release approval"
```

and gave Linda the commands. Linda looked at it:

```text
$ sdlc config show C1
C1: open — Keep agents from releasing without a release approval … (Linda Carter)
--- current
+++ proposed
+    - git\s+push\s+--tags
+    - npm\s+publish
+    - npm\s+run\s+deploy
Validation: valid
```

and applied it in her own terminal: `sdlc config apply C1`. The header of `sdlc.yaml` stayed, and the log has
`config.proposed` (from the agent) and `config.applied` (from Linda). Asked to push the tags, the agent was refused by
the hook `[sdlc:release-gate]`, and no tag reached the shared repository.

## 25.4. The license and removing the integrations

- `sdlc license set` from an agent was refused. Linda recorded a commercial license with an agreement number:
  `sdlc license set commercial --agreement TODO-2026-001 --licensee "Todo Team"` — recorded in `sdlc.yaml` and the
  log, and `sdlc doctor` said "✓ license commercial license, agreement TODO-2026-001". Back with
  `sdlc license set community`.
- `sdlc uninstall` (in a separate clone): an agent was refused; Linda got "files removed: 43", the Qwen hooks removed,
  the file she had edited kept, and "openspec/ … was left untouched": 108 files before and after, with the log, the
  archive and the settings proposals.

## 25.5. Lessons for a team

- **An upgrade is safe for manual edits.** `sdlc update` does not overwrite files people changed unless `--force`, and
  does not touch the settings and roles.
- **CI is a person's file.** Only a person writes it with `sdlc ci init`; the full clone is needed to check approvals.
- **Settings go through a proposal.** The agent prepares and explains the change, a person sees the diff and applies
  it; every step stays in the log.
- **Release commands go into `release.commands`.** Until the release is approved, an agent does not run them.
- **The license and removing the integrations are a person's decisions**; removal leaves `openspec/` alone.

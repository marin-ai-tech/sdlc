# 5. User guide

## 5.1. Installation

```bash
# CLI (the required OpenSpec version is installed with it)
npm install -g github:marin-ai-tech/scdl
sdlc --version

# in the project root (a git repository)
sdlc init --tools claude,opencode      # or --tools claude / --tools opencode
sdlc doctor                            # check the installation
```

`sdlc init`:
- creates `openspec/` by running `openspec init` if it does not exist, and makes `sdlc` the default schema. In an existing OpenSpec project, the default schema does not change;
- copies the schema to `openspec/schemas/sdlc/` and creates `openspec/sdlc.yaml`. Verification commands are detected automatically from `package.json`, `Makefile`, `pyproject`, `go.mod` or `Cargo.toml`;
- generates skills, commands, subagents and hooks (Claude) or a plugin (OpenCode), plus `REVIEW.md` if it does not exist.

Useful flags: `--mode block` — strict enforcement; `--cli "npx sdlc"` — if the CLI is installed locally in the project (`npm i -D github:marin-ai-tech/scdl`); `--opsx` — also install OpenSpec's own `/opsx:*` workflows alongside; `--delivery skills|commands|both`; `--no-hooks`.

**Claude Code plugin (organization-wide):**
```text
/plugin marketplace add marin-ai-tech/scdl
/plugin install sdlc@scdl
```
After you install the plugin, it is enough to run `sdlc init --tools none` (or `--tools opencode`) in the project, so that skills are not duplicated. To make the plugin installation mandatory, use `extraKnownMarketplaces` and `enabledPlugins` in `.claude/settings.json` or in managed settings.

After `init`, commit the generated files: they are shared by the team.

**License.** By default, a project uses scdl under the free Community License. It covers noncommercial use, open source projects and a 30-day evaluation. `sdlc init` and `sdlc doctor` warn you if the project has no OSI-approved license. Commercial use requires a commercial license. After the agreement is signed, record the license with `sdlc license set commercial --agreement <id> --licensee "<company>"`.

## 5.2. Lifecycle of a change

| Step | Who | Claude Code | OpenCode | CLI |
|---|---|---|---|---|
| Idea → intent.md | agent + idea author | `/sdlc:intent "customers call to check the status of their request"` | `/sdlc-intent …` | `sdlc new <id>` |
| Approve the intent | product owner | | | `sdlc approve intent --change <id>` |
| proposal, deltas, design | agent | `/sdlc:spec` | `/sdlc-spec` | `sdlc validate` |
| Approve the spec | product owner (+ tech lead if high risk) | | | `sdlc approve spec --change <id> [--as tech-lead]` |
| plan.md + tasks.md (plan mode) | agent + engineer | `/sdlc:plan` | `/sdlc-plan` | |
| Approve the plan | engineer | | | `sdlc approve plan --change <id>` |
| Implementation with a feedback loop | agent | `/sdlc:build` | `/sdlc-build` | |
| Evidence + independent verification | agent + verifier subagent | `/sdlc:verify` | `/sdlc-verify` | `sdlc verify`, `sdlc verify --check` |
| Review against REVIEW.md, fixing findings | agent + reviewer subagent | `/sdlc:review` | `/sdlc-review` | `sdlc review context\|check` |
| Approve the review | code owner | | | `sdlc approve review --change <id>` |
| Release (if enabled) | agent → release manager | `/sdlc:release` | `/sdlc-release` | `sdlc approve release --change <id>` |
| Archive: deltas → living specs | agent | `/sdlc:archive` | `/sdlc-archive` | `sdlc archive <id> --yes` |
| Alert/incident → new intent | agent | `/sdlc:triage <alert>` | `/sdlc-triage` | |

At any point, `/sdlc:next` (`/sdlc-next`) runs the next step or tells you who must do it and with which command. `sdlc status` shows all changes, and `sdlc status --markdown` produces a report for a PR or a wiki.

**A human runs approvals in their own terminal.** Inside an agent session, `sdlc approve` refuses to run. This is by design.

### Explore before intent

Use `/sdlc:explore` (`/sdlc-explore`) to research and pressure-test an idea. `sdlc explore <slug>` creates `openspec/explorations/<slug>.md`; `sdlc explore list` lists notes. Start a linked change with `sdlc new <id> --source-type exploration --source-ref openspec/explorations/<slug>.md`. Exploration is optional and does not approve intent.

### Track suggestion and confirmation

`sdlc new` suggests `lite` for eligible small changes from their kind and risk and records `track_suggestion` in `.sdlc.yaml`. Read the reason, then run `sdlc track set <full|lite> --change <id>` yourself. The CLI refuses agent sessions and changes after the plan is approved; the hook also denies agents.

### Lite track (small edits)
```bash
sdlc new fix-null-name --kind bugfix --risk low --track lite [--skip-specs]
```
The intent and the spec are optional: the change starts with plan.md and tasks.md, followed by the same verify and review steps. `--skip-specs` sets `skip_specs: true` for a change that does not alter external behavior.

### Bug-fix protocol
1. The first task is a test that reproduces the bug. Make sure it fails for the right reason, and commit it.
2. `sdlc tests lock --change <id>` — from then on, hooks do not let the agent change the tests.
3. Fix the code. Only a human can remove the lock: `sdlc tests unlock`.

### Review with lenses and coverage

`review.passes` and `review.lenses` in `openspec/sdlc.yaml` define the perspectives to check. In `review.md`, record each under `## Coverage`, including work checked when no finding was made:

```md
## Findings

### F1 [important][adversarial] Replayed token is accepted
- **Where**: src/auth/session.ts:88
- **Status**: open

## Coverage
- bugs: none found — checked: changed error paths
- adversarial: 1 finding
```

`sdlc review check --change <id>` checks missing entries, mismatched finding counts, empty `checked:` evidence, and deferred links. The review gate uses that result. New projects require lens coverage; older projects warn until `review.require_lens_coverage: true` opts in.

### Defer a finding

Record postponed work with `sdlc defer add <title> --why <text> [--change <id>] [--finding <F-id>] [--revisit <text>]`, inspect it with `sdlc defer list [--open] [--change <id>]`, and close it with `sdlc defer close <D-id> --status done|dropped --note <text>`. The registry is `openspec/deferred-work.md`; each `### D<n> [open] Title` entry has `**Change**`, optional `**Finding**`, `**Why**`, `**Revisit when**`, and `**Created**` fields. Mark the review finding `deferred (D<n>)`; the review check requires a link to an open item. Reports and dashboards show the registry.

### Import BMAD planning

Run `sdlc import bmad <path> --change <id> [--dry-run]` on BMAD PRD, SPEC and architecture spine artifacts. The importer keeps source copies under `sources/bmad/` and maps PRD vision to `intent.md`, SPEC purpose to `proposal.md`, capabilities or PRD requirements to `specs/`, architecture decisions to `design.md`, and deferred bullets to `openspec/deferred-work.md`. Nothing is approved by the import. Review the output and run `sdlc validate --change <id>`.

## 5.3. Configuring `openspec/sdlc.yaml`

```yaml
version: 1
schema: sdlc                  # schema for sdlc new
cli: sdlc                     # or "npx sdlc"
tools: [claude, opencode]
gates:
  intent:  { required: true,  approvers: [product-owner] }
  spec:    { required: true,  approvers: [product-owner], high_risk_approvers: [tech-lead] }
  plan:    { required: true,  approvers: [engineer],      high_risk_approvers: [tech-lead] }
  review:  { required: true,  approvers: [code-owner] }
  release: { required: false, approvers: [release-manager] }
  verify:  { required: true }
roles:                        # optional: who may approve for a role
  product-owner: [anna@example.com]
  code-owner: [lead@example.com, dev2@example.com]
verify:
  commands:
    - { name: build, run: npm run build }
    - { name: test,  run: npm test }
    - { name: lint,  run: npm run lint, required: false }
  timeout_seconds: 900
  output_lines: 40
review:
  policy: REVIEW.md
  passes: [bugs, security, compliance]
  lenses: [adversarial, edge-cases, verification-gaps]
  require_lens_coverage: true
  base: main                  # base for the diff (default: origin/HEAD)
  block_on: [important]
release:
  commands: ['\bdeploy\b.*\bprod(uction)?\b']   # regexes for the agent's production commands
enforcement:
  mode: warn                  # off | warn | block
  require_approved_plan: true
  exempt_paths: ['openspec/**', '**/*.md', '.claude/**', '.opencode/**']
  protected_paths: ['src/generated/**', 'db/migrations/**']
  test_paths: ['**/*.test.*', '**/tests/**']
  forbid_agent_approvals: true
  session_context: true
  verify_before_stop: false
license:
  type: community             # community | commercial (changed with sdlc license set)
  # agreement: ACME-2026-001  # for commercial
  # licensee: Acme Corp
log:
  enabled: true               # log in openspec/.sdlc/log.jsonl
  hook_decisions: true        # write hook denials and warnings to the log
```

Project context and rules for artifacts are set in the same place as in OpenSpec: `openspec/config.yaml` → `context:` and `rules.<artifact>`. They are included in the instructions for intent, proposal, specs, design, plan and tasks.

## 5.4. CI and headless mode

```bash
sdlc validate --all --json            # deltas + cross-change overlaps
sdlc status --json                    # stages and gates of all changes
sdlc review check --change <id>       # exit 1 if important findings are open
sdlc audit --json                     # playbook metrics (lead times, first-pass)
sdlc log --json                       # project log with the scdl version and license of each entry
```

For `claude -p`, allow the required tools in advance: `--allowedTools "Bash(sdlc *),Read,Write,Edit"`. In CI, it is convenient to add `sdlc status --markdown` to the PR description.

## 5.5. Updating and uninstalling

```bash
npm install -g github:marin-ai-tech/scdl   # new version
sdlc update                             # regenerate files (manually edited ones are kept; --force overwrites them)
sdlc update --tools claude              # change the set of agents
sdlc uninstall                          # remove agent files and hooks; openspec/ remains
```

# 1. OpenSpec: principles, internals and integration with agents

This analysis is based on the source code of OpenSpec **v1.13.2** (`@fission-ai/openspec`, MIT, ~48.6K lines of TypeScript in 197 files under `src/`), its repository documentation and live CLI runs. Everything marked "verified" was reproduced by hand during this research.

## 1.1. Purpose and philosophy

OpenSpec is a lightweight specification layer on top of any AI agent: the human and the agent agree on *what* to build before code is written. The project's philosophy:

```
fluid not rigid         — no rigid phase gates
iterative not waterfall — artifacts are edited as work progresses
easy not complex        — minimal ceremony
brownfield-first        — changes to existing systems through deltas
```

The key idea is to separate the **source of truth** from **proposed changes**:

```
openspec/
├── specs/<capability>/spec.md        # how the system works now (living specs)
├── changes/<change-id>/              # one change = one folder
│   ├── proposal.md                   # why and what
│   ├── specs/<capability>/spec.md    # DELTAS: ADDED / MODIFIED / REMOVED / RENAMED
│   ├── design.md                     # how (technical decisions)
│   ├── tasks.md                      # implementation checklist
│   └── .openspec.yaml                # metadata: schema, created, skip_specs, ...
├── changes/archive/YYYY-MM-DD-<id>/  # completed changes (history)
├── schemas/<name>/                   # custom workflow schemas (optional)
└── config.yaml                       # default schema, context, rules, operations
```

The cycle: `propose → apply → archive`. On archive, the deltas are merged into `openspec/specs/`, and the specification grows along with the system.

## 1.2. Command line

The CLI (`openspec`) is both a tool for humans and a **machine contract for the agent**. Almost all commands support `--json`, and in this mode stdout contains exactly one JSON document (documented in `docs/agent-contract.md`).

| Group | Commands | Purpose |
|---|---|---|
| Setup | `init`, `update` | create `openspec/`, generate skills/commands for the selected agents |
| Viewing | `list [--specs]`, `show`, `view` | changes and specs |
| Validation | `validate [--strict] [--all]` | delta structure, scenarios, SHALL/MUST, checking MODIFIED against main specs |
| Lifecycle | `archive <id> [--yes] [--skip-specs]` | merge deltas and move to the archive |
| Workflow | `new change`, `status`, `instructions`, `templates`, `schemas` | artifact engine for agents |
| Schemas | `schema init/fork/validate/which` | custom workflows |
| Stores (beta) | `store setup/register/list/doctor`, `context`, `doctor`, `workset` | planning in a separate repository, multiple repositories |
| Other | `config`, `feedback`, `completion` | profiles, telemetry, autocompletion |

In JSON mode, errors are returned in a uniform diagnostic envelope `{severity, code, message, target?, fix?}` with exit code 1. The OpenSpec root is selected by a fixed priority (`--store` → nearest `openspec/` → declared store → global default → implicit).

## 1.3. Core

### Schema as an artifact graph
A workflow is described by a YAML schema (`schemas/spec-driven/schema.yaml`): each artifact has an `id`, `generates` (a path or glob), `template`, `instruction` and `requires`. The `apply` block defines which artifacts are needed before implementation (`requires`) and which file tracks progress (`tracks: tasks.md`).

```
proposal ──► specs ──┐
    └──────► design ─┴──► tasks ──► apply
```

- **Order** — Kahn's algorithm; ties are broken by declaration order in the schema (not alphabetically).
- **State** — file presence only: `done` (at least one file matches `generates`), `ready` (all dependencies are complete), `blocked`, `skipped` (with `skip_specs: true`, artifacts under `specs/` count as complete).
- **"Dependencies are enablers, not gates"** — dependencies suggest an order but do not forbid anything.
- Schema lookup: project (`openspec/schemas/`) → user (`$XDG_DATA_HOME/openspec/schemas`) → bundled with the package.

### Instruction generation
`openspec instructions <artifact> --change <id> --json` assembles for the agent: `template` (the output format), `instruction` from the schema, `context` from `config.yaml` (up to 50 KB), `rules` for this artifact, the list of dependencies with their paths, `unlocks` and the exact `resolvedOutputPath`. For `apply`: `contextFiles`, task progress and the `blocked | ready | all_done` state. This mechanism is what lets skills stay thin: the CLI provides the logic and the data.

### Deltas and merging (archive)
Delta format:

```markdown
## ADDED Requirements
### Requirement: <name>
The system SHALL ...
#### Scenario: <name>
- **WHEN** ...
- **THEN** ...
## MODIFIED Requirements      # the full requirement block, in its entirety
## REMOVED Requirements       # with **Reason** and **Migration**
## RENAMED Requirements       # FROM:/TO:
```

`archive` validates the change, asks for confirmation, claims its place in the archive, applies the operations strictly in the order **RENAMED → REMOVED → MODIFIED → ADDED** (idempotently for deltas that are already synced), moves the folder to `archive/YYYY-MM-DD-<id>/` and rolls back the specs on failure. The merge code (`specs-apply.ts`, 1.4K lines, and `archive.ts`, 2.4K lines) is the most hard-won part of the project: most fixes in the CHANGELOG concern silent data loss during merges.

### Validation
`openspec validate` checks deltas (`### Requirement:`, exactly 4 hash marks in `#### Scenario:`, a scenario for every requirement, SHALL/MUST), missing deltas when `skip_specs` is not set, whether MODIFIED matches the main spec and, with `--strict`, the Purpose length. A proposal is expected to have the sections `## Why` (50–1000 characters) and `## What Changes`.

### Configuration
- `openspec/config.yaml`: `schema`, `context`, `rules.<artifact>[]`, `operations.apply|archive.guidance[]`, `references` (stores), `store`. Unknown top-level keys are **silently ignored** (verified).
- `.openspec.yaml` of a change: `schema`, `created`, `goal`, `affected_areas`, `skip_specs`, `retire_capabilities`.
- Global profile: `core` (propose, explore, apply, update, sync, archive) or `custom` (+ new, continue, ff, verify, bulk-archive, onboard); delivery mode `skills | commands | both`.

## 1.4. How OpenSpec works with Claude Code and OpenCode

`openspec init --tools claude,opencode` (verified) generates:

| | Claude Code | OpenCode |
|---|---|---|
| Commands | `.claude/commands/opsx/<id>.md` → **`/opsx:propose`** | `.opencode/commands/opsx-<id>.md` → **`/opsx-propose`** |
| Command frontmatter | `name`, `description`, `allowed-tools: Bash(openspec:*)`, `category`, `tags` | `description` only |
| Arguments | Claude appends the arguments itself | `**Provided arguments**: $ARGUMENTS` is inserted into the body (otherwise OpenCode loses them) |
| Skills | `.claude/skills/openspec-*/SKILL.md` | `.opencode/skills/openspec-*/SKILL.md` |
| Skill frontmatter | `name`, `description`, `allowed-tools`, `license`, `compatibility`, `metadata.generatedBy` | the same |

How each workflow is built (using `/opsx:propose` as an example):
1. "Planning boundary": touching code is forbidden; artifacts only.
2. "Project check": `openspec list --json` → whether a root exists; if not, do not create one silently.
3. `openspec new change "<name>"` → `openspec status --change --json` → loop over the artifacts: `openspec instructions <id> --json` → read the dependencies from disk → study the code → write the file → `status` again.
4. Stop and suggest `/opsx:apply`.

In other words, **the agent is the executor; the CLI is the source of state and templates**. Commands and skills contain the same text (a skill is for automatic invocation by the model, a command is for an explicit `/…`).

Observations on generation (verified):
- skills are heavy: 10–22 KB each (`explore` is 22 KB), the six core skills total ≈ 90 KB, and the commands duplicate the same text;
- when both agents are selected, the same `openspec-*` skills are written to both `.claude/skills` and `.opencode/skills`. But OpenCode reads **both** directories, and when names collide, a random copy wins (see [06](06-openspec-upstream.md));
- for OpenCode, only the `description` frontmatter is generated, without `agent:` — after bug #334 (a hard-coded `agent: build`);
- `update` touches only its own `openspec-*` directories and `opsx*` files, so neighboring namespaces (for example, our `sdlc-*`) do not conflict.

Integration with `CLAUDE.md`/`AGENTS.md` through marker blocks is a thing of the past (before 1.0): since OPSX, OpenSpec does not create them, and `update` cleans out old markers.

## 1.5. What the live runs showed

| Experiment | Result |
|---|---|
| `openspec archive <id> --yes` with 1 of 2 tasks done | **archived** — there are no gates; this is a deliberate decision ("fluid") |
| Extra files in the change folder (`.sdlc.yaml`, `review.md`) | do not interfere with `validate`/`status` and **move to the archive** together with the change |
| An unknown `sdlc:` key in `config.yaml` | silently ignored |
| A custom schema with `intent` and `plan` artifacts | `openspec schema validate` passes, `status`/`instructions` work, `/opsx:*` understand it |

These four facts determined the harness architecture: OpenSpec can be used **as an unmodified subsystem**, extended only through its standard mechanisms (our own schema, our own files alongside).

## 1.6. Strengths and weaknesses (summary)

**Strengths:** deltas for brownfield development; living specs that grow when changes are archived; schemas as an extensible DAG; thin skills on top of the CLI's JSON contract; support for 30+ tools; very active maintenance (1.0 → 1.13 in 9 months).

**Weaknesses (from an SDLC point of view):** no gates or approvals; no verification evidence (verify is a prompt, not a test run); phases are held in place only by prompt text; no review or release role; parallel changes overwrite the same requirement unnoticed; no audit of who approved what; heavy prompts. A summary of community reviews is in [03](03-landscape-and-reviews.md).

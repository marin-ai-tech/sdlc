# 14. Traceability and audit: use cases

A team that works with agents gets asked three questions sooner or later: "Show me who approved this and that it was
really them", "What changed for users in this release?" and "How much of this did the agent write?". sdlc 0.12.0
answers them from what the process already records, and adds two practices around them: a debate before a key design
decision, and a daily summary.

## 14.1. What the team gets

| Need | What sdlc does |
|---|---|
| Evidence for an auditor | `sdlc audit --export <folder>`: approvals with signature and trailer status, change folders, the log |
| Release notes that match the specs | `sdlc changelog`: requirements added, changed and removed by the delta specs |
| Know which commits agents made | a git hook marks them `SDLC-Agent: <agent>`; the audit shows the share |
| Both sides of a key design decision on record | the debate lens: two advocates argue it before the spec gate |
| A short morning digest | an example script writes done, next, blocked and waiting on people to a file |

## 14.2. Use cases

### The quarterly audit

The compliance officer asks for the evidence of the third quarter. The team lead runs, in their own terminal:

```bash
sdlc audit --export evidence-q3 --since 2026-07-01
```

`evidence-q3/` holds `index.md` (a readable table per change), `index.json` (the same for tools), the folders of every
change (intent, specs, design, plan, verification evidence, review, the change record) and `log.jsonl` with the
decisions of the period. Each approval shows who gave it, in which role, the digest of what was signed, the signature
status (`valid`, `unsigned`, `wrong-signer`, … with `roles.yaml` and signing on; `not-checked` otherwise) and whether
the commit with its `SDLC-Approval` trailer exists. Nothing from outside openspec/ goes in — no source code, no
secrets — and an existing folder with files in it is refused, so the export never mixes into something else.

### Release notes that match the specs

Before the release, the agent writes release.md (`/sdlc:release`). Its changelog is not written from memory:

```bash
sdlc changelog --change add-export
```

```markdown
### Added
- CSV export (reporting, add-export)
### Changed
- Report period (reporting, add-export)
```

For a whole release made of several changes, `sdlc changelog --since 2026-10-01` lists everything archived since that
date. A change without delta specs adds nothing.

### How much did the agents write?

After `sdlc init` (or `sdlc update`), the project's git has a `prepare-commit-msg` hook. A commit made in an agent's
terminal (Claude Code, OpenCode, Cursor, Codex CLI, Qwen Code, GigaCode, or anything that sets `SDLC_AGENT`) gets a
trailer:

```text
Add CSV export

SDLC-Agent: claude-code
```

A person's commit is never touched, and the hook works with `--no-verify` too. `sdlc audit` shows how many commits
there are and how many came from agents; the dashboard shows the share. If the project already has its own
prepare-commit-msg hook, sdlc leaves it and `sdlc doctor` shows the one line that calls sdlc's from it; a hooks folder
shared by every repository on the machine (`core.hooksPath` outside the project) is never written.

### A design decision with both sides on record

The team wants every key design decision argued before it is approved. A person sets, in `openspec/sdlc.yaml`:

```yaml
design:
  debate: true
  debate_sides: [simplicity and speed, robustness and safety]
```

During `/sdlc:spec`, the agent hands the decision with the most at stake to two read-only `sdlc-advocate` subagents,
one per priority, and writes the result into design.md:

```markdown
## Debate
### Position: simplicity and speed
...
### Position: robustness and safety
...
### Decision
...
```

Until both positions and the decision are there, `sdlc approve spec` refuses (`debate_required`).

### A summary every morning

`daily-summary.mjs` ships with sdlc (`assets/examples/` in the package). Scheduled every morning, it writes
`daily-summary-<date>.md`: what was approved or archived in the last day, what the agents do next, what is blocked,
what waits on people (with the commands). It never sends anything; mail it, post it or open it — the team decides.

```bash
schtasks /Create /SC DAILY /ST 08:00 /TN sdlc-daily /TR "cmd /c cd /d C:\work\shop && node daily-summary.mjs --out reports"
```

## 14.3. Limits we accept

- The agent marker comes from the environment of the agent's terminal; a commit made outside it (for example, a person
  committing what an agent wrote) is a person's commit.
- `sdlc audit --since` works together with `--export`; the plain audit covers all time.
- The debate is recorded text: sdlc checks that both positions and the decision are there, not how good they are.

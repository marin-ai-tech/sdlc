# 2. Anthropic's "The AI-Native SDLC playbook": analysis and mapping to OpenSpec

Source: https://claude.com/blog/the-ai-native-sdlc-playbook (Louis Claxton, August 21, 2026). Below is the summary the harness is built on.

## 2.1. Thesis

Code is no longer the bottleneck: agents write it in hours, but the process around it still runs at human speed. As a result:
1. the bottleneck shifts left and right of the build: planning, review/testing, deployment;
2. controls stop matching reality (line-by-line review cannot keep up with agents);
3. the cost of governance grows (exceptions go through committees).

An **AI-native SDLC** keeps the same control objectives but changes how they are met: instead of a linear process, it is a loop where an agent works at every node and handoffs between stages are automated.

## 2.2. Main principle: a committed artifact at every stage

> Each stage ends by writing one [artifact] to version control … and the next stage begins by reading it. The chain of commits is also the audit trail: who asked for what, what the agent produced, and who approved it.

```
intent.md ──► spec.md ──► plan.md ──► diff + tests ──► PR + review findings ──► incident ──► intent.md …
  (Plan)      (Design)     (Build)        (Test)            (Deploy)            (Maintain)
```

Accepting an artifact **triggers** the next stage: an accepted intent → a requirements+design pass; an approved spec → plan mode; a merged PR → the pipeline; a breached control band in production → a new intent.md. People remain accountable for decisions that require judgment; their attention is focused **on the gates**.

## 2.3. Stages and "plays"

Every play is described the same way: what changes, where to start (prerequisites, infrastructure), how to run it, governance (what is ensured, where the evidence is, who approves), how to measure it (leading/lagging indicators).

| Stage | Plays | Artifact | Gate / who decides |
|---|---|---|---|
| **1. Plan** | Capture as intent.md | `intent.md`: Problem, Proposed outcome, Affected users and systems, Constraints, Open questions; Author, Status | Product owner accepts (merge or closed review) |
| **2. Design** | Requirements and design in one session, policies as skills | `spec.md` with flagged "areas of concern" | PO; for high risk, tech lead; policy conflicts go to policy owners |
| **3. Build** | Plan mode by default; auto mode; CLAUDE.md; skills as institutional knowledge; hooks as guardrails; parallel sessions (worktrees) and subagents | `plan.md`: files that change, order of work, risks, proof; diff | Engineer accepts the plan; for high risk, tech lead/architect |
| **4. Test** | Feedback loop (the agent checks its own work); continuous evals in CI | test/build/screenshot output as evidence; eval suite | Code owner sees the evidence already attached |
| **5. Deploy** | AI in PR review (REVIEW.md); hooks as approval gates; CI/CD, sandbox, MCP deployment, rollback | PR with findings; hook decisions | Code owner via branch protection; release manager at the production gate |
| **6. Maintain** | Closing the loop (deterministic detection → intent.md); regular security scans; Claude on call (Claude Tag) | incident record, lessons, new intent.md | Service owner triages |

Key details carried into the implementation:
- **Separation of duties**: "the agent that wrote the code has no way to approve it".
- **A skill is an advisory control; a hook is a deterministic one**: "The skill makes violations rare and the hook makes them close to impossible".
- **Bug fix**: a failing test first; then a hook that blocks test edits during the fix.
- **Plan drift**: "When implementation departs from the plan, update plan.md in the same commit. Consider using a hook to enforce synchronization"; review checks the diff against plan.md.
- **REVIEW.md**: bugs / security / compliance passes (against spec.md, plan.md and design principles), important versus minor comments (Important vs Nit), a limit on the number of comments.
- **Agent acts up to the production gate, not past it**: a hook blocks production deployment until the release manager has authorized it.
- **Measures**: time from intent to spec, requirement rework after plan.md, the share of changes that get through on the first pass, the CI first-pass rate, review time, etc. — all from git history and PR metadata.
- **Source of truth sidebar**: for each artifact, name one system as the source of truth (the repository, a legacy system such as Jira, or at minimum cross-references record ID ↔ commit SHA).

The adoption order of the plays is set by their prerequisites. No dependencies: intent.md, CLAUDE.md, skills, feedback loop, hooks as approval gates. Next: requirements+design (needs intent and policy skills), plan mode, parallel sessions, evals, PR review, CI/CD (needs review and hooks), closing the loop (needs intent, review, hooks, rollback).

## 2.4. Mapping the playbook to OpenSpec

| Playbook | OpenSpec | What the harness adds |
|---|---|---|
| `intent.md` (Stage 1) | none (closest: `/opsx:explore` + the Why section in the proposal) | `intent` artifact in the `sdlc` schema, `intent` gate (product owner) |
| `spec.md` requirements + design (Stage 2) | `proposal.md` + `specs/` deltas + `design.md` | "Policy compliance" and "Areas of concern" sections, `spec` gate (+ tech lead for high risk), delta checks before the merge |
| `plan.md` from plan mode (Stage 3) | `tasks.md` (partly) | `plan` artifact (files, order, risks, alternatives, proof, rollback), `plan` gate (engineer), plan drift at review |
| diff + tests, feedback loop (Stage 4) | `/opsx:apply`, `/opsx:verify` (a prompt; runs nothing) | `sdlc verify`: real check runs, literal output as evidence, bound to the worktree contents; verifier subagent in a clean context; scenario coverage |
| PR review per REVIEW.md (Stage 5) | none | `review.md` with classified findings, reviewer subagent, gate blocked while important findings are open, code owner approval |
| Hooks as approval gates (Stage 5) | none | `sdlc hook` for Claude Code and the OpenCode plugin: plan gate, locked tests, protected paths, self-approval, production release |
| Separation of duties between people | none | optional `openspec/roles.yaml` in git: people and roles, the author does not approve their own review or release, paired gates need different people; `sdlc approvals verify` checks signed approval commits |
| Maintain → new intent (Stage 6) | none | `/sdlc:triage`: alert/incident/finding → diagnosed intent |
| Audit trail | archive history | `.sdlc.yaml` (who approved what and when, with the digest), `sdlc audit` (timeline + playbook metrics) |
| **Living specs** | **yes: deltas are merged into `openspec/specs/`** | used as is; the playbook has nothing like this, and it is OpenSpec's main contribution to the combination |

Conclusion: the playbook and OpenSpec complement each other. The playbook defines **process, roles, gates and evidence**, but does not define how specs evolve over time. OpenSpec defines **the model of specs and changes**, but deliberately rejects gates. The harness connects them: OpenSpec is responsible for the specs, and the SDLC layer for the process around them.

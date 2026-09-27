# 6. OpenSpec shortcomings: what to fix, where, and whether to

The question: "Is it worth fixing all the shortcomings in the OpenSpec implementation?" The short answer is **no, not all of them, and not inside OpenSpec**. The goal is maximum compatibility, and OpenSpec is evolving fast: 1.0 → 1.13 in 9 months, dozens of merge fixes. A fork would fall behind within a couple of releases. The right setup: OpenSpec stays an unmodified, pinned dependency, the SDLC layer closes the process gaps, and real core bugs are sent upstream.

## 6.1. Three categories

### A. Closed in the SDLC layer (this is the job of the process, not of OpenSpec)

| OpenSpec shortcoming | Why it is not an OpenSpec bug | What the harness does |
|---|---|---|
| No gates or approvals; `archive --yes` archives unfinished work (verified) | a deliberate "fluid not rigid" philosophy | gates with approvals bound to digests; `sdlc archive` checks all required gates |
| Phases rely only on the prompt text (#1577, #405) | OpenSpec does not control the agent's permissions | Claude Code hooks and the OpenCode plugin: code cannot be written without an approved plan (`block`) |
| Spec ↔ code divergence (#169, #880) | no model of "evidence" | `sdlc verify` with a worktree fingerprint, scenario coverage (`verify --check`), plan drift in review |
| No testing step and no TDD (#900, #1760) | outside the artifact model | the verify gate, a bug-fix protocol with `tests lock` |
| No review or release | outside the model | `review.md` + reviewer + a code owner gate; a release gate and blocking of production commands |
| Parallel changes overwrite each other (#1669) | a delta model without a base version | overlap warnings + base drift after spec approval |
| No visibility for non-technical roles | no reporting | `status --markdown`, `audit`, playbook metrics |
| Too much ceremony for small things | a trade-off of the model | the lite track, `--skip-specs` |
| Heavy prompts (#749, #611) | their choice | short workflows (3–5 KB), the CLI provides the state; `/opsx` workflows are not installed by default |
| The hard-coded `openspec` binary breaks local installs (#1624) | their choice | the `cli:` prefix (`npx sdlc`) in all generated files; OpenSpec is called from inside `sdlc` |

### B. Real core bugs or gaps: send upstream (issue/PR); until they are fixed, the harness provides a safeguard

1. **Duplicate skills when Claude and OpenCode are selected at the same time.** OpenSpec writes `openspec-*` both to `.claude/skills/` and to `.opencode/skills/`. OpenCode reads both directories. *Verified against the OpenCode 1.18.32 source code* (`packages/opencode/src/skill/index.ts`): discovery collects matches from `.claude`/`.agents` and `.opencode`, then `loadSkills` reads all the files with `concurrency: "unbounded"`. When a name matches, a `duplicate skill name` warning is written and the entry is overwritten: the copy whose asynchronous read finished last wins. Right now the copies are identical, and the harm is mostly noise. But edit one of them (or update OpenSpec for only one tool), and it is unknown which version will be loaded. This was not reproduced by running OpenCode itself. *Upstream proposal:* if `claude` is selected, write only commands for `opencode`, or make `.opencode/skills` optional. *Harness:* writes skills once, to `.claude/skills/`.
2. **MODIFIED with a nonexistent header (#1918, closed as not planned).** A requirement that is not in the main spec can turn into an ADD on sync and leave a duplicate. *Harness:* `sdlc validate`/`archive` reject MODIFIED and RENAMED with a nonexistent target, and ADDED that collides with an existing requirement, before `openspec archive` is even called.
3. **No "base version" for MODIFIED.** A delta does not remember which requirement text it was written against. *Proposal:* store a hash of the base requirement in the delta. *Harness:* records the main spec digest on spec approval and warns about drift.
4. **Headless permissions (#1642).** `allowed-tools: Bash(openspec:*)` is not enough to write artifacts in `claude -p`. *Harness:* documents `--allowedTools`.

### C. Do not touch (design trade-offs or out of scope)

- Stores and multi-repository (beta in OpenSpec): wait until they stabilize, then pass `--store` through.
- Generating specs from existing code (#739, #199): a separate product; the maintainers deliberately declined it.
- Support for 40 agents: the harness needs Claude Code and OpenCode; the others can be added as adapters.
- Different invocation syntax in different tools: an objective reality of the tools. The harness only documents `/sdlc:x` (Claude) and `/sdlc-x` (OpenCode, and also skills in Claude).

## 6.2. Course of action

1. Keep OpenSpec pinned (`^1.13.2`) and run the harness e2e tests (`npm test`) on every new version before upgrading.
2. Send items B.1–B.3 upstream as issues with a reproduction. Drafts can be assembled from this document and the tests `test/deltas-config.test.ts` and `test/integrations.test.ts`.
3. When OpenSpec fixes an item from B, remove the corresponding safeguard from the harness if it duplicates the core check.

# 22. Example: adopting a large existing codebase

This example ran on October 16, 2026. The team of the [TodoMVC examples](19-team-greenfield-example.md) takes over an
internal fork of [npm/node-semver](https://github.com/npm/node-semver): 557 commits, 113 authors, bots, CODEOWNERS
naming npm teams, eight CI workflows, the ISC license. The goal: prepare the project for agents (Qwen Code) and take a
first change through the process.

## 22.1. The team

| Person | sdlc roles | Does |
|---|---|---|
| Linda Carter | tech-lead, maintainer, code-owner, release-manager | adoption, roles, review |
| Peter Owen | product-owner | item B1, the intent and spec gates |
| David Smith | engineer | B1 with an agent |
| Kate Brown | engineer | the plan gate |

## 22.2. The project before sdlc

```bash
git clone <fork> lead && cd lead
npm install
npx tap          # 51 test files, all pass, 100% coverage
npm test         # red: after the tests it runs lint and template-oss-check
```

`npm test` is red before the first change: `posttest` runs `npm run lint`, whose `postlint` runs
`template-oss-check`, and the npm template check does not recognise the fork by its `repository` field. Worth knowing
before choosing the verification commands.

## 22.3. Adoption: init and the adopt draft

```bash
sdlc init --tools qwen
sdlc adopt
```

`init` installed the process, the Qwen hooks and the git hook, found the verification commands in `package.json` and
compared the project with the AI-ready layout: no `AGENTS.md`, `docs/architecture.md`, glossary, runbook or decision
records; `CONTRIBUTING.md` and `SECURITY.md` exist under their own names.

This project's `.gitignore` is an allow-list ("ignore everything in the root"), so the sdlc files have to be added to
it, or they stay on Linda's machine only:

```gitignore
!/.qwen/
!/AGENTS.md
!/openspec/
!/REVIEW.md
```

The `sdlc adopt` draft collected from the repository:

- the node stack and eight workflows; `.github/workflows/**` and `.github/CODEOWNERS` as protected paths;
- 94 people from the git history with their commit counts;
- the CODEOWNERS teams `@npm/cli-team`, `@npm/cli-triage` as "handles with no person": a team does not become a
  person;
- roles for the current user (Linda) only, marked "to check".

## 22.4. The agent writes the documents from the code

Linda ran `/sdlc-adopt`. The agent created the document skeletons (`sdlc layout scaffold`) but did not fill them, and
to the second request it answered "all files are filled, nothing to check" while no file had changed. Narrow requests,
one file each with a check of the result, worked: `grep -c "<!--" docs/architecture.md` must give 0.

After that `docs/architecture.md` described the real modules: `index.js`, `classes/` (SemVer, Range, Comparator),
`internal/` (regular expressions, constants, cache), `bin/semver.js`, and the data path parse → SemVer → compare.
Linda checked the dependencies against the `require` calls and fixed three places: the circular link
`classes/comparator.js` → `classes/range.js`, the missing `internal/constants`, and an "empty" `dependencies` field
that `package.json` does not have at all. In `docs/runbook.md` she fixed the install step (`npm install` in a clone,
not `npm install semver`) and added what matters most for a fork: the jobs of `.github/workflows/ci.yml` run only when
`github.repository_owner == 'npm'`, so CI does not test the fork.

## 22.5. Applying the draft is a person's decision

When Linda asked the agent to apply the draft itself, the hook refused it with `[sdlc:separation-of-duties]`. Linda
applied it:

```bash
sdlc adopt --apply
```

and brought the settings to a working state:

- `openspec/roles.yaml` lists the five people of the team; the history's authors and bots are neither people nor
  role holders;
- verification runs `npx tap` and `npm run eslint` (both green) instead of the red `npm test` and `npm run lint`;
- `enforcement.mode: block`.

`sdlc layout check` said "Layout ready", `sdlc roles check` showed the five people and their roles, `sdlc doctor`
reported nothing.

`sdlc layout convert` showed a plan with no moves: `CONTRIBUTING.md` and `SECURITY.md` are pinned by the GitHub
convention; `--apply --worktree ../lead-layout` answered "Nothing to convert" and left the main working copy alone.
`sdlc license` confirmed that the project declares ISC, so the open source permission applies while its source is
public.

## 22.6. B1: hidden behaviour of old code

Peter added the item "semver --version prints the package version" with three criteria: `--version` prints the
version and exits 0; `-v` does the same; other arguments and output do not change.

| Step | Who | What happened |
|---|---|---|
| intent | David's agent, Peter | two criteria lost, Out of scope against `-v`: rejected; fixed, approved |
| spec | the agent, Peter | requirements for the README and `--help` outside the item: rejected; then no scenario "without the flags nothing changes": rejected again; approved |
| plan | Kate (engineer) | `-v` and `--version` already exist in the CLI (`bin/semver.js:60`) as an alias for "the next argument is a version": `semver --version 1.2.3` prints `1.2.3`. The approved spec broke it: `sdlc reject plan` |
| rework | Peter | `sdlc rework spec --reason wrong-assumption`: without a value after the flag, the package version; with a value, the old behaviour |
| plan | Kate | two more rejections: `-V` instead of `-v`, and the output "SemVer 7.8.5" with a hard-coded number; approved |
| build, verify | the agent, David | the test red (exit 1), the change green; `sdlc verify`: `npx tap` 15 s, `eslint` 4 s |
| review | Linda | `semver 1.2.3 -v` printed `1.2.3` and now printed `7.8.5`: scripts with a trailing flag would break; `sdlc reject review` |
| rework | Peter | `sdlc rework spec --reason missing-requirement`: the version only when the flag is the only argument |
| build | the agent, David | the first fix printed the last version of the list: green tests, but sorting, the `-r` filter and invalid input broke. David compared eight invocations with `main`; with the second fix only `semver -v` and `semver --version` differ |
| review, archive | Linda | a review with F1 (fixed) and F2 (accepted), `approve review`, the merge, `sdlc archive`: `+1 added` to the living specs |

Peter closed the item: `sdlc backlog done B1 --note "Done in change b1-version"`.

## 22.7. The result in the audit

```text
verification first-pass rate: 1; rejections 6; waivers 0 (+0 by policy)
median wait for a person (seconds): intent 2 · spec 2 · plan 1 · review 2; rework reasons: missing-requirement 1 · wrong-assumption 1
agent commits: 0 of 594 (SDLC-Agent trailer)
```

594 commits are the whole history of node-semver plus the team's work; none are agent commits, because people
committed.

## 22.8. Lessons for a team

- **Read `.gitignore` before the first commit.** In a project with an allow-list, the process files must be allowed
  explicitly.
- **The adopt draft is material, not a decision.** People from the history are candidates; the tech-lead writes the
  roles for the team.
- **Verification commands are green before the first change.** A red `npm test` caused by a CI template makes every
  verify useless; choose commands that check the code.
- **Check the agent's documents against the code.** A narrow request for one file with a check of the result works
  better than a general one.
- **In old code, people at plan and review find what matters most.** The hidden `-v` alias and the trailing flag were
  invisible to the spec and the agent's tests; comparing invocations with `main` is an independent check.
- **A mistake in an approved spec goes back with `rework` and a reason**; the reasons show in the audit.

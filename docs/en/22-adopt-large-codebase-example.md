# 22. Example: adopting a large existing codebase

On October 16, 2026, the team from the [TodoMVC examples](19-team-greenfield-example.md) adopted sdlc for an
internal fork of [npm/node-semver](https://github.com/npm/node-semver). Follow how they prepare a large existing
codebase for Qwen Code agents and take one change through the process.

## On this page

- [Meet the team](#221-the-team)
- [Inspect the project](#222-the-project-before-sdlc)
- [Draft adoption](#223-adoption-init-and-the-adopt-draft)
- [Write the documents](#224-the-agent-writes-the-documents-from-the-code)
- [Apply the draft](#225-applying-the-draft-is-a-persons-decision)
- [Follow the first change](#226-hidden-behaviour-of-old-code)
- [Read the audit](#227-the-result-in-the-audit)
- [Lessons](#228-lessons-for-a-team)
- [Terms](#terms)
- [See also](#see-also)

## 22.1. The team

These people review the adoption draft and the first change.

| Person | sdlc roles | Does |
|---|---|---|
| Linda Carter | tech-lead, maintainer, code-owner, release-manager | adoption, roles, review |
| Peter Owen | product-owner | the version item, the intent and spec gates |
| David Smith | engineer | the version change with an agent |
| Kate Brown | engineer | the plan gate |

## 22.2. The project before sdlc

The fork has 557 commits, 113 authors, bots and CODEOWNERS naming npm teams. It also has eight CI workflows and an
ISC license. Linda checks its existing tests before setting verification commands.

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

Linda installs sdlc, then collects an adoption draft from the repository.

```bash
sdlc init --tools qwen
sdlc adopt
```

`init` installed the process, Qwen hooks and the git hook. It found verification commands in `package.json`.
The layout comparison found missing AI-ready documents:

- `AGENTS.md` and `docs/architecture.md`;
- a glossary, runbook and decision records.

`CONTRIBUTING.md` and `SECURITY.md` existed under their own names.

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

Linda checks each document against the code after the agent writes it.

Linda ran `/sdlc-adopt`. The agent created the document skeletons (`sdlc layout scaffold`) but did not fill them, and
to the second request it answered "all files are filled, nothing to check" while no file had changed. Narrow requests,
one file each with a check of the result, worked: `grep -c "<!--" docs/architecture.md` must give 0.

After that, `docs/architecture.md` described the real modules:

- `index.js` and `classes/` (SemVer, Range, Comparator);
- `internal/` (regular expressions, constants, cache);
- `bin/semver.js` and the data path parse → SemVer → compare.
Linda checked the dependencies against the `require` calls and fixed three places: the circular link
`classes/comparator.js` → `classes/range.js`, the missing `internal/constants`, and an "empty" `dependencies` field
that `package.json` does not have at all. In `docs/runbook.md` she fixed the install step (`npm install` in a clone,
not `npm install semver`) and added what matters most for a fork: the jobs of `.github/workflows/ci.yml` run only when
`github.repository_owner == 'npm'`, so CI does not test the fork.

## 22.5. Applying the draft is a person's decision

Linda applies the draft after reviewing the roles and checks.

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

## 22.6. Hidden behaviour of old code

The first change exposes an existing CLI behaviour that the initial spec missed.

Peter added the item "semver --version prints the package version" with three criteria: `--version` prints the
version and exits 0; `-v` does the same; other arguments and output do not change.

1. **Intent:** David's agent lost two criteria and put `-v` out of scope. Peter rejected it; the agent fixed it.
1. **Spec:** Peter rejected requirements for the README and `--help` outside the item. He rejected it again because
   it lacked a scenario saying "without the flags nothing changes". The agent fixed it and Peter approved.
1. **Plan:** Kate found that `-v` and `--version` already exist in `bin/semver.js:60`. They mean the next argument
   is a version: `semver --version 1.2.3` prints `1.2.3`. The approved spec broke this, so she ran `sdlc reject plan`.
1. **Spec rework:** Peter ran `sdlc rework spec --reason wrong-assumption`. Without a value after the flag, the CLI
   should print the package version. With a value, it should keep the old behaviour.
1. **Plan again:** Kate rejected `-V` in place of `-v`, then a hard-coded "SemVer 7.8.5" output. She approved after
   those fixes.
1. **Build and verify:** The agent and David saw the test fail with exit 1, then pass after the change.
   `sdlc verify` ran `npx tap` in 15 s and `eslint` in 4 s.
1. **Review:** Linda found that `semver 1.2.3 -v` used to print `1.2.3` but now printed `7.8.5`. Scripts with a
   trailing flag would break, so she ran `sdlc reject review`.
1. **Spec rework:** Peter ran `sdlc rework spec --reason missing-requirement`. The package version should appear
   only when the flag is the only argument.
1. **Build again:** The first fix printed the last version of the list. Tests were green, but sorting, the `-r`
   filter and invalid input broke. David compared eight invocations with `main`. After the second fix, only
   `semver -v` and `semver --version` differed.
1. **Review and archive:** Linda marked F1 fixed and F2 accepted. She ran `approve review`, merged and ran
   `sdlc archive`. The living specs gained `+1 added`.

Peter closed the item: `sdlc backlog done B1 --note "Done in change b1-version"`.

## 22.7. The result in the audit

The audit shows six rejections and two recorded rework reasons.

```text
verification first-pass rate: 1; rejections 6; waivers 0 (+0 by policy)
median wait for a person (seconds): intent 2 · spec 2 · plan 1 · review 2; rework reasons: missing-requirement 1 · wrong-assumption 1
agent commits: 0 of 594 (SDLC-Agent trailer)
```

594 commits are the whole history of node-semver plus the team's work; none are agent commits, because people
committed.

## 22.8. Lessons for a team

These lessons came from checking the fork's history, configuration and CLI behaviour.

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

## Terms

- [Adopt](07-ai-ready-project.md): preparing an existing project for sdlc and agent work.
- [Living spec](glossary.md#-ip): a requirement kept after its change is archived.
- [Rework](glossary.md#-rw): a person's decision to send artifacts back for revision.

## See also

- [AI-ready project](07-ai-ready-project.md) explains adoption and layout.
- [Existing-project example](18-team-example.md) follows a smaller project.

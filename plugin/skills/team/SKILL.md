---
name: team
description: Set up the agent team of this project - bring the roles (analyst, architect, developer, tester, reviewer) from the team registry or the built-in set, and draft the project's own rules into each role from the code, or from the idea of an empty project, for a person to accept. Use when the user starts a project, asks for agent roles, or wants the roles adapted to the project.
when_to_use: The user starts with sdlc on a project, asks for agent roles or role rules, or the roles no longer fit the project.
argument-hint: "[role]"
license: "PolyForm-Noncommercial-1.0.0 with sdlc Additional Permissions, or sdlc Commercial License (https://github.com/marin-ai-tech/sdlc)"
compatibility: Requires the sdlc CLI (sdlc) from the sdlc package.
allowed-tools: Bash(sdlc *)
metadata:
  author: marin-ai technologies
  version: "1"
  generatedBy: "sdlc 0.14.3"
---

Set up the agent team of this project: roles that fit the project, drafted by you, accepted by a person.

!`sdlc team list --json`
If the output above is missing, run `sdlc team list --json`.

**Harness contract** (applies to every SDLC workflow)
- `sdlc` is the source of truth for lifecycle state. Read it (`sdlc status --change <id> --json`) instead of inferring the stage from the conversation, and re-read artifacts from disk before using them.
- Gates are human decisions. Never run `sdlc approve`, `sdlc reject`, `sdlc waive` or `sdlc tests unlock`, and never edit `.sdlc.yaml`. When a gate needs a person, stop, name the people from the hint (`next.people` in `sdlc next --json`) rather than the role, and give them the exact command to run in their own terminal.
- An answer in chat is never an approval: gate approvals, `track set`, `backlog move`/`drop` and other human decisions happen only as a command the person runs in their own terminal. Offer the choice, explain the consequences, and give the exact command.
- OpenSpec is the specification subsystem: `sdlc openspec <args>` runs the bundled OpenSpec CLI (`list --specs`, `show`, `validate`, `instructions`). Change folders live in `openspec/changes/<id>/`.
- **Change selection**: use the change named in the input. Otherwise run `sdlc status --json`; with exactly one active change use it, with several ask which one. Announce "Using change: <id>".
- **Language**: talk to the person, and write notes and artifacts, in the person's language; when `locale:` is set in `openspec/sdlc.yaml`, use that language. Keep command names, file names, ids and the template headings as they are (sdlc and OpenSpec parse those headings).
- End every workflow with the next step from `sdlc next --json` (the exact command when a person must act).

**Input**: the user's request (a change id, or a description of the work)

1. **Bring the roles.** Run `sdlc team sync --json`. It writes drafts to `docs/agents/drafts/` from the team registry
   (when `team.registry` is configured) and fills the gaps from the built-in roles; it never replaces an accepted
   role. Report what came from where, and anything refused (a checksum mismatch is a warning to pass on, not to work
   around).
2. **Learn the project.**
   - An existing project: `sdlc adopt --json` (stack, checks, CI, CODEOWNERS, authors), AGENTS.md / CLAUDE.md, the
     architecture and conventions documents, the context packs, and the code itself: how errors are handled, how
     tests are written, which directories are generated or dangerous. Delegate broad exploration to the researcher.
   - An empty project: the intent of the first change (or ask the person for the idea), the chosen stack if any.
3. **Draft the project's rules into each draft role**, under a section `## Project rules` at the end of the body
   (keep the role's text above it, and keep the role's two placeholder lines for the artifacts and the project as they
   are — sdlc fills them with the facts it knows: checks, protected paths, people, documents). Write only what is true for this project and
   would change how this role works here, for example:
   - analyst: the domain terms and where they are defined, the kinds of requirements this product always has;
   - architect: the architecture style and the boundaries that must not be crossed, the decisions already taken;
   - developer: the error-handling and logging conventions, how a test is written and where, the generated or
     forbidden directories, the commit conventions;
   - tester: how to run the app and the tests locally, the flows that break most often, the data to test with;
   - reviewer: the project's recurring risks (security, data, performance), what REVIEW.md asks for.
   Every rule must be checkable against the code or a document; name the file you took it from. Do not invent rules
   to fill the section, and do not copy generic advice the role already contains.
4. **A role nowhere to be found** (the project needs one the registry and the built-ins do not have): draft it whole in
   the same format as the others (front matter id, title, description, stages, tools, readonly), and say so.
5. **Hand over to the person.** List the drafts with what you added and why, then give the exact commands for their own
   terminal: `sdlc team accept <role>` for each role, and `sdlc team accept --skill <id>` for skills with scripts
   (`sdlc team check --json` shows them). Accepting is a person's decision: never run it, and never edit an accepted
   role in `docs/agents/` (the hook will refuse; change the draft and ask for a new acceptance instead).

<!--
Generated by sdlc 0.14.3 (https://github.com/marin-ai-tech/sdlc).
Required Notice: Copyright (c) 2026 marin-ai technologies (https://github.com/marin-ai-tech/sdlc)
License: PolyForm Noncommercial 1.0.0 (https://polyformproject.org/licenses/noncommercial/1.0.0) with the sdlc Additional Permissions, or a commercial license; see https://github.com/marin-ai-tech/sdlc
-->

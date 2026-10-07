---
id: team
title: "SDLC: Team"
description: Set up the agent team of this project - bring the roles (analyst, architect, developer, tester, reviewer) from the team registry or the built-in set, and draft the project's own rules into each role from the code, or from the idea of an empty project, for a person to accept. Use when the user starts a project, asks for agent roles, or wants the roles adapted to the project.
when-to-use: The user starts with sdlc on a project, asks for agent roles or role rules, or the roles no longer fit the project.
command-description: Set up the agent team - roles and the project's rules, for a person to accept
argument-hint: "[role]"
---
Set up the agent team of this project: roles that fit the project, drafted by you, accepted by a person.

{{inject:team list --json}}

{{contract}}

**Input**: {{input}}

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

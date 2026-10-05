---
id: adopt
title: "SDLC: Adopt"
description: Prepare an existing project for agents - check the layout, adapt or scaffold the documents, fill them from the code, and draft the sdlc settings and roles for a person to apply.
when-to-use: sdlc was just installed in an existing project, or the agent documents are missing, empty or out of date.
command-description: Prepare an existing project for agents
argument-hint: "[area to focus on]"
---
Prepare an existing project for work with agents: the documents agents rely on, filled from the real code, and the sdlc settings drafted from the repository.

{{contract}}

**Input**: {{input}}

**Rules**
- Fill documents from the code, not from guesses. Every statement carries a file reference (a file path, with a line when it helps). Mark anything you could not confirm with "to check" so the person reviews it.
- Moving files is the person's decision: `sdlc layout convert` is only proposed (show the plan from `sdlc layout convert`; the person runs `--apply` in their own terminal if they want it).
- Applying the settings is the person's step: `sdlc adopt --apply` writes `openspec/sdlc.yaml` and `openspec/roles.yaml`. Give the person the command; do not run it yourself.

**Steps**

1. **Check the layout.** Run `sdlc layout check` and list the documents that are missing or empty.
2. **Existing documents stay where they are.** If the project already has them under other names (`ARCHITECTURE.md`, `docs/adr/`, `CONTRIBUTING.md`…), run `sdlc layout adapt --dry-run`, show the mapping, then `sdlc layout adapt`. If canonical paths would serve the project better, suggest `sdlc layout convert` and show its plan; the person decides.
3. **Missing documents.** Run `sdlc layout scaffold`, then fill each new file from the code: architecture (modules and how they connect), conventions (style, naming, error handling as the code actually does it), build and test commands (from the build files and CI), glossary (domain terms from the code and specs), sensitive areas (security, money, data, migrations) and decisions already visible in the history. `AGENTS.md` is the main file for OpenCode; keep it short and link to the others. Work through the input's area first when one is given.
4. **Settings and roles.** Run `sdlc adopt` and show the draft: stack, CI, verify commands, protected paths, people from git and CODEOWNERS, and the proposed `openspec/roles.yaml`. Point out what looks wrong (bots among the people, a maintainer who left). To apply it, the person runs `sdlc adopt --apply` in their own terminal.
5. **Finish** with a summary: which documents were created or filled, every "to check" item for the person, whether the settings draft still needs to be applied, and the next step from `sdlc next --json`.

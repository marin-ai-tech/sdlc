# 12. The agent team

Since 0.11.0, a project can have role agents: an **analyst**, an **architect**, a **developer**, a **tester** and a **reviewer**. Each is a short file the team reads and edits. sdlc turns an accepted role into a subagent for Claude Code and OpenCode, wires it to its stages, and adds what it knows about the project.

This chapter starts from situations a team runs into.

## 12.1. What a role is

A role lives in `docs/agents/<role>.md`:

```markdown
---
id: tester
title: Tester
description: Independently verifies a change against its specs ...
stages: [test]
tools: [read, grep, glob, bash]
readonly: true
---
# Role: tester
... responsibilities, how to work, the verdict rules, boundaries ...
```

The **body** says *how* the role works. sdlc adds two blocks the role does not need to know:

- **Where to write.** The artifacts of the role's stages:

  | Role | Writes |
  |---|---|
  | analyst | intent, proposal and spec scenarios |
  | architect | `design.md` |
  | developer | plan, tasks and code |
  | tester | the behavioural table and the verdict in `verification.md` |
  | reviewer | findings in `review.md` |

- **This project.** The facts sdlc knows:
  - the verify commands;
  - protected paths and test paths;
  - who holds which role in `roles.yaml`, and the separation rules;
  - the project's language;
  - the AI-ready documents;
  - the context packs and MCP servers of the role's stages.

  Change a check, and the next `sdlc update` updates every role.

The built-in roles are rewritten from common role prompts to fit sdlc. For example:

- the developer writes a failing test first;
- the tester runs before it reads, and treats a case it could not run as NOT RUN, never PASS;
- the architect does not change an existing project's stack without a person's decision.

## 12.2. Starting on an empty project

*Situation.* A new repository, only an idea.

```bash
sdlc init
sdlc team sync           # drafts of the five roles in docs/agents/drafts/, in the project's language
```

Then ask the agent to set up the team (`/sdlc:team`):

1. The agent reads the intent of the first change, or asks you for the idea and the chosen stack.
2. It adds a **Project rules** section to each draft, with only what is true for this project.

Read the drafts, then accept them in your own terminal:

```bash
sdlc team accept analyst
sdlc team accept tester
```

## 12.3. Starting on an existing project

*Situation.* A codebase with its own conventions, CI and owners.

`/sdlc:team` learns the project before it drafts:

- `sdlc adopt --json` gives the stack, the checks, the CI, CODEOWNERS and the git authors;
- AGENTS.md, the architecture and conventions documents;
- the code itself: error handling, how tests are written, generated or dangerous folders.

It writes rules into each role, naming the file each rule comes from. For example:

- the developer's logging convention;
- how the tester starts the app;
- the reviewer's recurring security risks.

## 12.4. The team's registry

*Situation.* A company keeps its roles and skills in one place, and every project should use the same version.

```yaml
# openspec/sdlc.yaml
mcp:
  servers:
    team-roles: { type: http, url: https://mcp.corp.example/roles, headers: { Authorization: "Bearer ${ROLES_TOKEN}" }, stages: [] }
team:
  registry: team-roles
```

The registry is an MCP server with four tools: `list_roles`, `get_role`, `list_skills`, `get_skill`.

- `sdlc team sync` takes roles from it first and fills the gaps from the built-ins. Each item is checked against its checksum, and a mismatch is refused.
- A draft records the server, the version and the checksum.
- A newer version of an accepted role arrives as a draft. It never replaces the accepted one silently.

## 12.5. Packs from git or npm

*Situation.* No registry server, but the roles live in a repository or a package.

```yaml
packs:
  - { name: corp, git: https://git.corp.example/sdlc-pack.git, ref: v1.2.0 }
  - { name: corp-npm, npm: "@corp/sdlc-pack@1.2.0" }
```

A pack holds `roles/<id>.md` (or `roles/<locale>/<id>.md`) and `skills/<id>/…`.

- `sdlc team sync` reads the registry first, then the packs, then the built-ins.
- **Pin the version.** For git, prefer a commit or a tag; for npm, an exact version.
- No code of a pack runs: no git hooks or submodules, no npm scripts.
- An npm pack is a registry package (`@corp/sdlc-pack@1.2.0`) or a `.tgz` (a path or an `https://` URL). A
  folder or a repository is refused for `npm:` — npm 10 runs a package's `prepare` script for those even with
  `--ignore-scripts` — so put a repository in a `git:` pack.
- An unreachable pack is reported, and sync goes on with the next source.

## 12.6. Skills that reach the agents

The skills a role lists are installed when the role is accepted, and only with a matching checksum.

- **A skill that carries more than Markdown** (scripts, binaries) waits for a person: `sdlc team accept --skill <id>`.
- **`sdlc team check`** lists every skill with:
  - its source and version;
  - whether the checksum matches;
  - its scripts;
  - its allowed tools, with a warning when they grant unrestricted shell or file writes.

Take only what the team needs, from sources it trusts. A skill is instructions and code your agents will follow.

## 12.7. Accepting, changing and protecting roles

- **Accepting is a person's command.** `sdlc team accept <role>` is refused in an agent session, and the hook blocks it. It moves the draft into place, records it in `openspec/.sdlc/team.json` and generates the subagent. It also says whether the draft differs from its source, so you see what an agent changed.
- **Agents cannot edit what is accepted.** Agents cannot change:
  - the accepted roles;
  - the team record;
  - the installed team skills;
  - the generated `sdlc-*` subagents, skills and commands.

  Otherwise an agent could make the tester pass anything.
- **A person may edit a role.** `sdlc team list` then shows it as `changed`. Like an approval bound to content, a changed role is not generated until it is accepted again. Meanwhile verify and review fall back to the built-in subagents.
- **Two roles replace built-ins.** The accepted tester and reviewer take the place of `sdlc-verifier` and `sdlc-reviewer` in the verify and review workflows. The old names stay for one version.

## 12.8. Commands

| Command | Who | What |
|---|---|---|
| `sdlc team sync [--json]` | anyone | drafts from the registry, packs and built-ins |
| `sdlc team list [--json]` | anyone | roles, sources, status: draft, accepted, changed |
| `sdlc team check [--json]` | anyone | the skills of the accepted roles, vetted |
| `sdlc team accept <role>` / `--skill <id>` | a person | accept a role or a skill with scripts |
| `/sdlc:team` (`/sdlc-team`) | the agent | sync, learn the project, draft the project's rules |

## 12.9. Limits we accept

- **Project facts follow the project only through `sdlc update`.** A role reflects the last update, not the live state.
- **A Project rules section is as good as what the agent found.** A person reads it before accepting.
- **The registry and packs are trusted sources the team chose.** The checksum proves that the content did not change on the way, not that the content is good.

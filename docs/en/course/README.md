# sdlc in practice: a course for every role

This course teaches the whole team to work with sdlc — the people who decide and the people who work with the agent.
It follows one company, Northwind Labs, through two projects:

- **tasklet** — a new task-tracking web API, started from an empty folder (Modules 1–7);
- **billing-api** — an existing service with code, tests and CI, converted to the AI SDLC (Module 8).

## On this page

- [The team](#the-team) — meet the people in the lessons.
- [Modules](#modules) — choose a topic.
- [Tracks by role](#tracks-by-role) — find your lessons.
- [Before you start](#before-you-start) — prepare your tools.
- [Current capabilities and limits](#current-capabilities-and-limits) — know what to expect.
- [Terms](#terms) — understand process language.
- [See also](#see-also) — continue with the handbook or guide.

The agent is **Claude Code** in the terminal. The team uses MCP servers for:

- **GitHub:** issues, pull requests and Actions as the build server;
- **knowledge:** project data, roles and skills;
- **Telegram:** notifications;
- **sdlc:** process information.

Module 10 shows the same process in Cursor, Codex CLI, Qwen Code, GigaCode and OpenCode.

This is the video version. To read the same material as a book, open [the sdlc handbook](../handbook/README.md).

Each lesson is one short video of about 5–8 minutes. It gives you a role and goal, then steps with real commands
and output. A self-check, pitfalls and video notes help you review what you learned.

## The team

These people carry decisions through the lessons. Their roles stay the same across both projects.

| Person | Role | Main gates and commands |
|---|---|---|
| Megan | Product owner | approves intent and spec; orders the backlog; answers open questions |
| Ethan | Tech lead, architect | approves the plan; sends work back (`rework`) |
| Oliver | Developer | works with Claude Code through the workflows |
| Grace | QA engineer | checks the evidence and the behaviour |
| Paul | Code owner, reviewer | approves the review |
| Emily | Release manager | approves the release |
| Steven | Platform engineer | installs and configures sdlc, MCP and CI |
| Laura | Engineering manager | reports, health, audit |

## Modules

Follow the modules in order for the full story, or choose the topic you need now.

| Module | Lessons | For |
|---|---|---|
| [0. Introduction](00-introduction.md) | 0.1–0.4 | everyone |
| [1. Setting up a new project](01-setup-greenfield.md) | 1.1–1.6 | Steven; 1.3 and 1.6 for everyone |
| [2. Connecting the toolchain through MCP](02-toolchain-mcp.md) | 2.1–2.7 | Steven; 2.6 for everyone |
| [3. People and the agent team](03-roles-and-team.md) | 3.1–3.7 | Steven, Ethan; 3.2 for everyone who approves |
| [4. Backlog and planning](04-backlog.md) | 4.1–4.6 | Megan, Ethan, Laura |
| [5. One change from idea to archive](05-lifecycle-greenfield.md) | 5.1–5.11 | everyone |
| [6. The developer's day with Claude Code](06-developer.md) | 6.1–6.9 | Oliver, Ethan |
| [7. Quality, review and release](07-qa-review-release.md) | 7.1–7.8 | Grace, Paul, Emily |
| [8. Converting an existing project](08-brownfield.md) | 8.1–8.8 | Steven, Ethan; 8.8 for everyone |
| [9. Managing and auditing the process](09-management-and-audit.md) | 9.1–9.8 | Laura, the auditor, Megan |
| [10. One project, several agent tools](10-multi-agent.md) | 10.1–10.7 | Steven, developers on other tools; 10.7 for Ethan |
| [11. Troubleshooting and quick reference](11-troubleshooting-and-reference.md) | 11.1–11.3 and reference | everyone |

## Tracks by role

Watch Module 0 and Module 5 first, whatever your role. Then:

| Role | Lessons |
|---|---|
| Product owner (Megan) | 1.3, 3.2, 4.1–4.6, 5.2–5.3, 5.5, 5.11, 2.6, 9.1, 9.3, 11.6 (her cheat sheet) |
| Tech lead (Ethan) | 3.1–3.7, 4.2, 5.4–5.5, 6.1–6.8, 7.4–7.5, 8.1–8.7, 9.4, 10.7 |
| Developer (Oliver) | 1.6, 3.2, 5.11, 6.1–6.9, 7.1–7.4, 10.1–10.4, 11.2, 11.8 |
| QA engineer (Grace) | 3.2, 6.7, 7.1–7.3, 9.5, 11.3 |
| Code owner (Paul) | 3.2–3.3, 7.4–7.6, 9.5 |
| Release manager (Emily) | 2.5, 3.2, 7.7–7.8, 9.6 |
| Platform engineer (Steven) | Modules 1, 2, 3, 8 and 10; 6.4, 9.2, 9.7, 11.1 |
| Engineering manager (Laura) | 4.1, 9.1–9.8, 11.6 |
| Auditor | 0.2, 3.3, 9.5–9.6 |

## Before you start

- sdlc on the PATH (`sdlc --version`), Node.js 20.19 or later, and git.
- Claude Code installed and signed in.
- For Module 2: a GitHub token, a Telegram bot token and the address of your knowledge server, as environment
  variables (`GITHUB_TOKEN`, `TELEGRAM_BOT_TOKEN`). The course never writes a secret into a file.

## Current capabilities and limits

The course says so where it matters. The main points:

- CI evidence calls the tool your GitHub server exposes; a run that is still in progress fails the check until it is
  run again (Lesson 2.4).

sdlc also supports these tasks:

- Import open GitHub issues and close them on archive with `sdlc backlog import --issues` (Lessons 4.3 and 8.5).
- Send a daily summary event with `sdlc events summary` (Lesson 9.7).
- Take monitoring alerts with `sdlc triage intake` (Lesson 6.9).
- Serve MCP tools over HTTP with a token using `sdlc mcp serve --http` (Lesson 9.8).
- Export tasks to executors with `sdlc task export` (Lesson 10.7).
- Check gate artifacts against a rubric with `sdlc judge` before a person approves (Lesson 5.11).
- Accept a pack's review lenses, workflows and verify checks with `sdlc team accept --pack` (Lesson 3.7).
- List executors in `openspec/executors.yaml` and let their agents claim board tasks with `sdlc board` (Lesson 10.7).

The dashboard and report show the board.

## Terms

The [glossary](../glossary.md) defines gates, evidence, MCP and other process terms.

## See also

- [Handbook](../handbook/README.md) — read the same material at your own pace.
- [User guide](../05-guide.md) — follow a change through its stages.

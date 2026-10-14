# sdlc in practice: a course for every role

This course teaches the whole team to work with sdlc — the people who decide and the people who work with the agent.
It follows one company, Northwind Labs, through two projects:

- **tasklet** — a new task-tracking web API, started from an empty folder (Modules 1–7);
- **billing-api** — an existing service with code, tests and CI, converted to the AI SDLC (Module 8).

The agent is **Claude Code** in the terminal. The team's tools come in through MCP servers: **GitHub** (issues as
the task manager, pull requests, Actions as the build server), a **knowledge** server (project data, roles and
skills), **Telegram** (notifications) and **sdlc** itself. Module 10 shows the same process in Cursor, Codex CLI,
Qwen Code, GigaCode and OpenCode.

This is the video version. To read the same material as a book, open [the sdlc handbook](../handbook/README.md).

Every lesson has the same parts: the role, the goal, the steps with real commands and real output, a self-check,
the pitfalls and notes for the video. A lesson is one short video (about 5–8 minutes).

## The team

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

- sdlc 0.14.5 or later on the PATH (`sdlc --version`), Node.js 20.19 or later, git. Lessons 3.7 and 5.11 need
  sdlc 0.20.0; Lesson 10.7 and Reference 11.8 need sdlc 0.21.0.
- Claude Code installed and signed in.
- For Module 2: a GitHub token, a Telegram bot token and the address of your knowledge server, as environment
  variables (`GITHUB_TOKEN`, `TELEGRAM_BOT_TOKEN`). The course never writes a secret into a file.

## What sdlc does not do (yet)

The course says so where it matters. The main points:

- CI evidence calls the tool your GitHub server exposes; a run that is still in progress fails the check until it is
  run again (Lesson 2.4).

Since 0.19.0 sdlc brings open GitHub issues into the backlog and closes them on archive
(`sdlc backlog import --issues`, Lessons 4.3 and 8.5), sends the daily summary as an event (`sdlc events summary`,
Lesson 9.7), takes alerts from monitoring (`sdlc triage intake`, Lesson 6.9), serves the read-only MCP tools over HTTP
with a token (`sdlc mcp serve --http`, Lesson 9.8), and hands a task to any executor (`sdlc task export`, Lesson 10.7).

Since 0.20.0 a judge checks a gate's artifacts by the team's rubric before a person approves (`sdlc judge`,
Lesson 5.11), and a pack brings review lenses, workflows and verify checks that a person accepts
(`sdlc team accept --pack`, Lesson 3.7).

Since 0.21.0 a person lists executors in `openspec/executors.yaml`, and their agents claim tasks from the board
(`sdlc board`, Lesson 10.7). The dashboard and report show the board.

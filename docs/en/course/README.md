# sdlc in practice: a course for every role

This course teaches the whole team to work with sdlc — the people who decide and the people who work with the agent.
It follows one company, Northwind Labs, through two projects:

- **tasklet** — a new task-tracking web API, started from an empty folder (Modules 1–7);
- **billing-api** — an existing service with code, tests and CI, converted to the AI SDLC (Module 8).

The agent is **Claude Code** in the terminal. The team's tools come in through MCP servers: **GitHub** (issues as
the task manager, pull requests, Actions as the build server), a **knowledge** server (project data, roles and
skills), **Telegram** (notifications) and **sdlc** itself. Module 10 shows the same process in Cursor, Codex CLI,
Qwen Code, GigaCode and OpenCode.

Every lesson has the same parts: the role, the goal, the steps with real commands and real output, a self-check,
the pitfalls and notes for the video. A lesson is one short video (about 5–8 minutes).

## The team

| Person | Role | Main gates and commands |
|---|---|---|
| Maria | Product owner | approves intent and spec; orders the backlog; answers open questions |
| Ivan | Tech lead, architect | approves the plan; sends work back (`rework`) |
| Oleg | Developer | works with Claude Code through the workflows |
| Anna | QA engineer | checks the evidence and the behaviour |
| Pavel | Code owner, reviewer | approves the review |
| Elena | Release manager | approves the release |
| Sergey | Platform engineer | installs and configures sdlc, MCP and CI |
| Olga | Engineering manager | reports, health, audit |

## Modules

| Module | Lessons | For |
|---|---|---|
| [0. Introduction](00-introduction.md) | 0.1–0.4 | everyone |
| [1. Setting up a new project](01-setup-greenfield.md) | 1.1–1.6 | Sergey; 1.3 and 1.6 for everyone |
| [2. Connecting the toolchain through MCP](02-toolchain-mcp.md) | 2.1–2.7 | Sergey; 2.6 for everyone |
| [3. People and the agent team](03-roles-and-team.md) | 3.1–3.6 | Sergey, Ivan; 3.2 for everyone who approves |
| [4. Backlog and planning](04-backlog.md) | 4.1–4.6 | Maria, Ivan, Olga |
| [5. One change from idea to archive](05-lifecycle-greenfield.md) | 5.1–5.10 | everyone |
| [6. The developer's day with Claude Code](06-developer.md) | 6.1–6.9 | Oleg, Ivan |
| [7. Quality, review and release](07-qa-review-release.md) | 7.1–7.8 | Anna, Pavel, Elena |
| [8. Converting an existing project](08-brownfield.md) | 8.1–8.8 | Sergey, Ivan; 8.8 for everyone |
| [9. Managing and auditing the process](09-management-and-audit.md) | 9.1–9.8 | Olga, the auditor, Maria |
| [10. One project, several agent tools](10-multi-agent.md) | 10.1–10.6 | Sergey, developers on other tools |
| [11. Troubleshooting and quick reference](11-troubleshooting-and-reference.md) | 11.1–11.3 and reference | everyone |

## Tracks by role

Watch Module 0 and Module 5 first, whatever your role. Then:

| Role | Lessons |
|---|---|
| Product owner (Maria) | 1.3, 3.2, 4.1–4.6, 5.2–5.3, 5.5, 2.6, 9.1, 9.3, 11.6 (her cheat sheet) |
| Tech lead (Ivan) | 3.1–3.6, 4.2, 5.4–5.5, 6.1–6.8, 7.4–7.5, 8.1–8.7, 9.4 |
| Developer (Oleg) | 1.6, 3.2, 6.1–6.9, 7.1–7.4, 10.1–10.4, 11.2 |
| QA engineer (Anna) | 3.2, 6.7, 7.1–7.3, 9.5, 11.3 |
| Code owner (Pavel) | 3.2–3.3, 7.4–7.6, 9.5 |
| Release manager (Elena) | 2.5, 3.2, 7.7–7.8, 9.6 |
| Platform engineer (Sergey) | Modules 1, 2, 3, 8 and 10; 6.4, 9.2, 9.7, 11.1 |
| Engineering manager (Olga) | 4.1, 9.1–9.8, 11.6 |
| Auditor | 0.2, 3.3, 9.5–9.6 |

## Before you start

- sdlc 0.14.5 or later on the PATH (`sdlc --version`), Node.js 20.19 or later, git.
- Claude Code installed and signed in.
- For Module 2: a GitHub token, a Telegram bot token and the address of your knowledge server, as environment
  variables (`GITHUB_TOKEN`, `TELEGRAM_BOT_TOKEN`). The course never writes a secret into a file.

## What sdlc does not do (yet)

The course says so where it matters. The main points:

- There is no built-in sync between GitHub Issues and the sdlc backlog: the agent reads issues through the GitHub
  MCP server and adds backlog items (Lesson 4.3); archiving a change does not close its issue.
- Events go to an MCP server as structured data; a Telegram server that only takes text needs a small adapter tool
  (Lesson 2.6). The daily summary example writes a file; sending it is a scheduler's job (Lesson 9.7).
- CI evidence calls the tool your GitHub server exposes; a run that is still in progress fails the check until it is
  run again (Lesson 2.4).

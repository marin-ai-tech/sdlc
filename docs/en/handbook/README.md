# The sdlc handbook

Read this handbook from start to finish or open the chapter you need.
It follows Northwind Labs as the team uses sdlc to plan, build, verify and release changes.

**tasklet** is a new task-tracking web API, started from an empty folder.
**billing-api** is an existing service with code, tests and CI that the team converts to the AI SDLC.

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

## Chapters

- [0. Introduction](00-introduction.md) — everyone.
- [1. Setting up a new project](01-setup-greenfield.md) — Steven; 1.3 and 1.6 for everyone.
- [2. Connecting the toolchain through MCP](02-toolchain-mcp.md) — Steven; 2.6 for everyone.
- [3. People and the agent team](03-roles-and-team.md) — Steven, Ethan; 3.2 for everyone who approves.
- [4. Backlog and planning](04-backlog.md) — Megan, Ethan, Laura.
- [5. One change from idea to archive (tasklet)](05-lifecycle-greenfield.md) — everyone.
- [6. The developer's day with Claude Code](06-developer.md) — Oliver, Ethan.
- [7. Quality, review and release](07-qa-review-release.md) — Grace, Paul, Emily.
- [8. Converting an existing project](08-brownfield.md) — Steven, Ethan; 8.8 for everyone.
- [9. Managing and auditing the process](09-management-and-audit.md) — Laura, the auditor, Megan.
- [10. One project, several agent tools](10-multi-agent.md) — Steven, developers on other tools.
- [11. Troubleshooting and quick reference](11-troubleshooting-and-reference.md) — everyone.

## Tracks by role

Start with chapters 0 and 5, then use the sections for your role.

### Product owner (Megan)

- [1.3](01-setup-greenfield.md#s1-3)
- [3.2](03-roles-and-team.md#s3-2)
- [4.1–4.6](04-backlog.md#s4-1)
- [5.2–5.3](05-lifecycle-greenfield.md#s5-2)
- [5.5](05-lifecycle-greenfield.md#s5-5)
- [2.6](02-toolchain-mcp.md#s2-6)
- [9.1](09-management-and-audit.md#s9-1)
- [9.3](09-management-and-audit.md#s9-3)
- [11.6 (her cheat sheet)](11-troubleshooting-and-reference.md#s11-6)

### Tech lead (Ethan)

- [3.1–3.6](03-roles-and-team.md#s3-1)
- [4.2](04-backlog.md#s4-2)
- [5.4–5.5](05-lifecycle-greenfield.md#s5-4)
- [6.1–6.8](06-developer.md#s6-1)
- [7.4–7.5](07-qa-review-release.md#s7-4)
- [8.1–8.7](08-brownfield.md#s8-1)
- [9.4](09-management-and-audit.md#s9-4)

### Developer (Oliver)

- [1.6](01-setup-greenfield.md#s1-6)
- [3.2](03-roles-and-team.md#s3-2)
- [6.1–6.9](06-developer.md#s6-1)
- [7.1–7.4](07-qa-review-release.md#s7-1)
- [10.1–10.4](10-multi-agent.md#s10-1)
- [11.2](11-troubleshooting-and-reference.md#s11-2)

### QA engineer (Grace)

- [3.2](03-roles-and-team.md#s3-2)
- [6.7](06-developer.md#s6-7)
- [7.1–7.3](07-qa-review-release.md#s7-1)
- [9.5](09-management-and-audit.md#s9-5)
- [11.3](11-troubleshooting-and-reference.md#s11-3)

### Code owner (Paul)

- [3.2–3.3](03-roles-and-team.md#s3-2)
- [7.4–7.6](07-qa-review-release.md#s7-4)
- [9.5](09-management-and-audit.md#s9-5)

### Release manager (Emily)

- [2.5](02-toolchain-mcp.md#s2-5)
- [3.2](03-roles-and-team.md#s3-2)
- [7.7–7.8](07-qa-review-release.md#s7-7)
- [9.6](09-management-and-audit.md#s9-6)

### Platform engineer (Steven)

- Chapters 1
- 2
- 3
- 8 and 10
- [6.4](06-developer.md#s6-4)
- [9.2](09-management-and-audit.md#s9-2)
- [9.7](09-management-and-audit.md#s9-7)
- [11.1](11-troubleshooting-and-reference.md#s11-1)

### Engineering manager (Laura)

- [4.1](04-backlog.md#s4-1)
- [9.1–9.8](09-management-and-audit.md#s9-1)
- [11.6](11-troubleshooting-and-reference.md#s11-6)

### Auditor

- [0.2](00-introduction.md#s0-2)
- [3.3](03-roles-and-team.md#s3-3)
- [9.5–9.6](09-management-and-audit.md#s9-5)


## Before you start

- sdlc 0.14.5 or later on the PATH (`sdlc --version`), Node.js 20.19 or later, git.
- Claude Code installed and signed in.
- For Chapter 2: a GitHub token, a Telegram bot token and the address of your knowledge server, as environment
  variables (`GITHUB_TOKEN`, `TELEGRAM_BOT_TOKEN`). The handbook never writes a secret into a file.

There is also a [video course](../course/README.md) with the same examples and commands.

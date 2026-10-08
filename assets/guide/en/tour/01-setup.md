---
title: Set up the project
---
# 1. Set up the project

The tour follows the calculator demo: a small team builds a calculator for a shop till. Alice is the product owner,
Bob the engineer, Carol the code owner who reviews. The agent writes the artifacts and the code; people decide.

```bash
sdlc init --tools claude,opencode --statusline   # hooks, workflows, subagents, openspec/sdlc.yaml
sdlc doctor                                      # is the installation sound?
sdlc help                                        # workflows, commands, and the decisions only people take
sdlc guide                                       # short articles: how sdlc works
sdlc layout check                                # the documents agents rely on (AGENTS.md, architecture, runbook)
```

What to notice:

- `openspec/sdlc.yaml` holds the gates, who approves each, the verification commands and the enforcement mode. It is
  protected: the agent cannot edit it, a person does.
- `openspec/roles.yaml` (optional) names the people, their roles and the separation rules; with it, approvals can be
  signed.
- The hooks see every edit of the agent. `enforcement.mode: block` denies what skips a gate; `warn` only says so.

In your session the agent learns at the start which change it is on and who acts next. You can always ask it how
the process works: it answers from `sdlc guide`.

Next: plan the work.

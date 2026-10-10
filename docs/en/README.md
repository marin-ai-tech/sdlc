# Documentation (English)

Research and design of the SDLC harness for Claude Code, OpenCode, Cursor, Codex CLI, Qwen Code and GigaCode, built on OpenSpec.

1. [OpenSpec: principles, internals, integration with Claude Code and OpenCode](01-openspec-analysis.md)
2. [The Anthropic AI-Native SDLC playbook, mapped to OpenSpec](02-sdlc-playbook.md)
3. [OpenSpec reviews and other spec-driven and SDLC tools](03-landscape-and-reviews.md)
4. [Harness architecture](04-architecture.md)
5. [User guide](05-guide.md)
6. [OpenSpec shortcomings: what to fix, where, and whether to](06-openspec-upstream.md)
7. [The AI-ready project](07-ai-ready-project.md)
8. [Roles, separation of duties and signed approvals](08-roles-and-signing.md)
9. [The calculator demo and keeping the dashboard current](09-demo-and-automation.md)
10. [Integrations: MCP, context, secrets and reviewers](10-integrations.md)
11. [Working with sdlc over MCP: capabilities and use cases](11-mcp-use-cases.md)
12. [The agent team](12-agent-team.md)
13. [Process hygiene and project health: capabilities and use cases](13-process-health.md)
14. [Traceability and audit: use cases](14-traceability.md)
15. [Cursor IDE: setup, what is enforced, use cases](15-cursor.md)
16. [Codex CLI: setup, what is enforced, use cases](16-codex.md)
17. [Qwen Code and GigaCode: setup, what is enforced, use cases](17-qwen-gigacode.md)
18. [The sdlc handbook](handbook/README.md) — the user guide for every role, to read: a new project and the conversion of an existing one
19. [sdlc in practice: the video course](course/README.md) — the same material as scripts for short training videos

In short: **OpenSpec is the specification subsystem** (deltas, living specs, validation, archive), and **`sdlc` is
the process layer** that follows the Anthropic playbook. It adds stages, gates with human approvals, verification
evidence, review, release gates, an audit trail, and deterministic enforcement in every supported tool:

- Claude Code: hooks in `.claude/settings.json`;
- OpenCode: a plugin, `.opencode/plugins/sdlc.js`;
- Cursor: its own hooks (`.cursor/hooks.json`) and an always-applied rule;
- Codex CLI: its own hooks (`.codex/hooks.json`) and command rules (`.codex/rules/sdlc.rules`);
- Qwen Code and GigaCode: their own hooks and `permissions.deny` rules in `settings.json` (GigaCode is experimental).

The [Supported tools](05-guide.md#supported-tools) table compares them: how a workflow is called, what holds the
gates, the agent marker and the main limit of each.

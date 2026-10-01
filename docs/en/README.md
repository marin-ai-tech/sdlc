# Documentation (English)

Research and design of the SDLC harness for Claude Code and OpenCode, built on OpenSpec. 

1. [OpenSpec: principles, internals, integration with Claude Code and OpenCode](01-openspec-analysis.md)
2. [The Anthropic AI-Native SDLC playbook, mapped to OpenSpec](02-sdlc-playbook.md)
3. [OpenSpec reviews and other spec-driven and SDLC tools](03-landscape-and-reviews.md)
4. [Harness architecture](04-architecture.md)
5. [User guide](05-guide.md)
6. [OpenSpec shortcomings: what to fix, where, and whether to](06-openspec-upstream.md)
7. [The AI-ready project](07-ai-ready-project.md)
8. [Roles, separation of duties and signed approvals](08-roles-and-signing.md)
9. [The calculator demo and keeping the dashboard current](09-demo-and-automation.md)

In short: **OpenSpec is the specification subsystem** (deltas, living specs, validation, archive), and **`sdlc` is the process layer** that follows the Anthropic playbook. It adds stages, gates with human approvals, verification evidence, review, release gates, an audit trail, and deterministic enforcement through hooks (Claude Code) and a plugin (OpenCode).

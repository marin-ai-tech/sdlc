# sdlc documentation

Start with the guide if you are setting up sdlc. Use the handbook or course to learn your role.
The topic guides explain a particular decision or tool, and the examples show how teams use them together.

## 🚀 Start here

These paths help you get oriented and make your first change.

- [Why work with sdlc](32-why-sdlc.md) — what it costs to run, and what skipping the gates cost.
- [User guide](05-guide.md) — install sdlc, follow the lifecycle and use the CLI.
- [Handbook](handbook/README.md) — read the workflow for every role.
- [Video course](course/README.md) — teach or learn in short lessons.
- [Glossary](glossary.md) — check a term while you read.

## 🧭 Guides by topic

Pick the part of the process you need today.

- [AI-ready project](07-ai-ready-project.md) — prepare project context for agents.
- [Roles and signed approvals](08-roles-and-signing.md) — assign decisions and protect them.
- [Calculator demo and dashboard](09-demo-and-automation.md) — keep the demo's view current.
- [Integrations and MCP](10-integrations.md) — connect checks, context and events.
- [MCP use cases](11-mcp-use-cases.md) — see who can connect and what they can do.
- [Agent team](12-agent-team.md) — create and accept role agents.
- [Process health](13-process-health.md) — spot friction and plan improvements.
- [Traceability and audit](14-traceability.md) — follow requirements and decisions.

## 🔌 Tools

Each tool has its own setup and gate enforcement details.

- [Cursor](15-cursor.md) — set up IDE hooks and rules.
- [Codex CLI](16-codex.md) — set up hooks and command rules.
- [Qwen Code and GigaCode](17-qwen-gigacode.md) — set up their hooks and permissions.
- [Supported tools table](05-guide.md#supported-tools) — compare workflow names and limits across all six tools.

## 💡 Worked examples

Follow a complete run when a topic guide is too narrow.

- [Adopting an existing project](18-team-example.md) — add gates to a live product.
- [Building from scratch](19-team-greenfield-example.md) — start with an intent.
- [A newcomer's first change](20-onboarding-example.md) — use the next-step hints.
- [Dashboard and health](21-dashboard-health-example.md) — read the process view.
- [A large existing codebase](22-adopt-large-codebase-example.md) — adopt incrementally.
- [Tracks and decisions](23-tracks-and-decisions-example.md) — choose the path for a change.
- [A bug fix from an alert](24-bugfix-incident-example.md) — protect locked tests.
- [CI, release and upgrade](25-ci-release-upgrade-example.md) — connect checks to release.
- [Signed approvals and audit](26-signed-audit-example.md) — inspect the approval trail.
- [MCP and events](27-mcp-integrations-example.md) — connect other systems.
- [Executors and an auction](28-executor-swarm-example.md) — distribute board tasks.
- [A team with different agents](29-mixed-tools-example.md) — share one process.
- [Finishing with executors](30-finishing-with-executors-example.md) — close the change and issue.

## 🧭 Research and design

- [Harness Runtime prototype](31-harness-runtime-prototype.md) — adapter components and remaining integration work.

These pages explain the foundations and the choices behind the process.

- [OpenSpec analysis](01-openspec-analysis.md) — understand its internals and integrations.
- [AI-Native SDLC playbook](02-sdlc-playbook.md) — map the playbook to OpenSpec.
- [Landscape and reviews](03-landscape-and-reviews.md) — compare other approaches.
- [OpenSpec shortcomings](06-openspec-upstream.md) — see proposed upstream improvements.
- [Harness architecture](04-architecture.md) — see how sdlc fits together.

## 🛡️ How the gates hold

**OpenSpec is the specification subsystem** for deltas, living specs, validation and archive.
**sdlc is the process layer** that follows the Anthropic playbook. It adds:

- stages and gates with human approvals;
- verification evidence and review;
- release gates and an audit trail;
- deterministic enforcement in every supported tool.

Each tool enforces the process through its own integration:

- Claude Code uses hooks in `.claude/settings.json`.
- OpenCode uses a plugin at `.opencode/plugins/sdlc.js`.
- Cursor uses hooks in `.cursor/hooks.json` and an always-applied rule.
- Codex CLI uses hooks in `.codex/hooks.json` and command rules in `.codex/rules/sdlc.rules`.
- Qwen Code and GigaCode use their hooks and `permissions.deny` rules in `settings.json`.
  GigaCode is experimental.

The [supported tools table](05-guide.md#supported-tools) compares each workflow call, gate mechanism,
agent marker and main limit.

## Runtime extensions

- [Runtime plugins](33-plugins.md) — accepted Wasm packages, pure hooks, facts and reproducible examples.

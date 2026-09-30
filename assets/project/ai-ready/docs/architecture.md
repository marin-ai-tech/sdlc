# Architecture

Describe how {{project.name}} is structured so agents and people share one mental model. Replace the placeholders below with real modules as the system grows. Cross-link decisions under [docs/decisions/]({{path:decisions}}) and OpenSpec design notes.

## Context

<!-- One paragraph: what the system does, who uses it, and what sits outside it. -->
{{project.name}} delivers its product through a small set of modules with clear boundaries. External users and services talk to the system only through documented interfaces.

## Modules and boundaries

List each module, what it owns, and what it must not import.

| Module | Owns | Must not |
|--------|------|----------|
| <!-- e.g. api --> | <!-- HTTP adapters, auth at the edge --> | <!-- domain rules, persistence details --> |
| <!-- e.g. domain --> | <!-- business rules, entities --> | <!-- frameworks, I/O --> |
| <!-- e.g. infra --> | <!-- DB, queues, third-party clients --> | <!-- UI concerns --> |

Prefer dependency direction: adapters to application to domain. Infrastructure implements ports declared inward.

## Data flow

1. Request or event enters at an adapter boundary.
2. Application use-case validates input and loads aggregates.
3. Domain rules decide; infra persists or emits side effects.
4. Response or event leaves through the same adapter layer.

Document async flows (queues, webhooks) separately when they appear.

## External dependencies

| Dependency | Role | Failure mode |
|------------|------|--------------|
| <!-- database --> | Durable state | Retry / degrade read-only |
| <!-- identity provider --> | AuthN | Fail closed |
| <!-- object storage --> | Blobs | Queue and retry |

Pin versions in the lockfile; record non-obvious choices as ADRs.

## Cross-cutting concerns

- Configuration: environment variables and secrets (never commit secrets; see [security]({{path:security}})).
- Observability: structured logs, metrics, traces with correlation ids.
- Errors: typed failures at boundaries; map to HTTP/RPC codes once.
- Feature flags: named, default-safe, documented in the runbook when used.

## Where to look first

| Question | Start here |
|----------|------------|
| How do I run or debug locally? | [runbook]({{path:runbook}}) |
| What words mean in this domain? | [glossary]({{path:glossary}}) |
| How should new code look? | [conventions]({{path:conventions}}) |
| What must agents never touch lightly? | [security]({{path:security}}) |
| Why was a design chosen? | [decisions]({{path:decisions}}) |
| How do agents work here? | [AGENTS.md]({{path:agents-guide}}) |

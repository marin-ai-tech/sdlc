# Conventions

Coding standards for {{project.name}}. Agents and humans follow these so reviews stay about behavior, not style debates. Align OpenSpec plans with this file.

## Naming

- Files and directories: match the language ecosystem (for example kebab-case paths in JS/TS repos, snake_case in Python).
- Types and classes: PascalCase. Functions and variables: camelCase or language default.
- Tests: mirror the unit under test (foo.test.ts next to or under test/ as the repo already does).
- Specs and change ids: stable kebab-case ids under openspec/.

## Errors

- Fail fast at trust boundaries; validate input once.
- Use typed or enumerated error codes for expected failures; reserve free-text messages for operators.
- Do not swallow errors. Log with context, then rethrow or return a mapped failure.
- Never put secrets or PII in error messages or logs (see [security]({{path:security}})).

## Logging

- Structured logs (JSON or key=value), one event per line.
- Include correlation / request id when available.
- Levels: error for failed user-visible operations, warn for degraded paths, info for lifecycle, debug for verbose local work.
- Do not log bodies that may contain credentials or tokens.

## Tests

- Prefer outside-in: start from behavior at the boundary the user cares about, then fill units.
- Bug fixes: write a failing test first (fail-to-pass), then fix product code. Do not weaken or delete locked tests during a bug fix unless a human plan explicitly allows it.
- Keep tests deterministic: no real network or clock unless the suite isolates them.
- Name tests after observable behavior, not implementation details.

## Dependencies

- Add a dependency only when the plan justifies it; prefer the standard library.
- Pin versions via the lockfile; avoid floating ranges in published artifacts.
- Do not vendor secrets or large binaries into source control.
- Record significant library choices in [decisions]({{path:decisions}}) when they shape architecture.

# 0001. Record architecture decisions

Date: 2026-01-01

## Status

Accepted

## Context

{{project.name}} will accumulate design choices that are hard to recover from chat logs or pull request threads alone. Coding agents and new contributors need a durable place for those choices. OpenSpec already carries per-change design notes under openspec/changes/<id>/design.md, but cross-cutting decisions that outlive a single change still need a stable index.

We follow Michael Nygard's Architecture Decision Record (ADR) practice: one Markdown file per decision, numbered, with status and consequences.

## Decision

- Store ADRs as Markdown files under docs/decisions/ (this directory).
- Name files NNNN-short-title.md with a monotonic number.
- Each ADR includes at least: Status, Context, Decision, and Consequences.
- Reference relevant ADRs from OpenSpec design.md when a change depends on or amends a decision.
- Prefer updating Status (e.g. Superseded by 00NN) over deleting history.

## Consequences

- Architecture rationale remains searchable next to [architecture]({{path:architecture}}) and [conventions]({{path:conventions}}).
- Agents can link decisions instead of re-arguing them in every change.
- OpenSpec design docs stay change-scoped; ADRs stay product-scoped.
- Slight process overhead: authors must add an ADR when a decision is truly architectural; skip ADRs for trivial local choices.

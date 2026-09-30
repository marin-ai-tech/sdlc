# Glossary

Shared vocabulary for {{project.name}}. Specs, code, and agents should use these terms the same way. Add rows as the domain grows; keep "not to be confused with" honest.

| Term | Meaning | Not to be confused with |
|------|---------|-------------------------|
| Intent | Why we want a change; the first lifecycle step before a formal spec | A full OpenSpec change folder |
| Spec | Requirements (living under openspec/specs/ or delta under openspec/changes/) | Informal chat notes or a plan |
| Plan | Approved implementation steps for a change | The living product spec |
| Change | A WIP folder under openspec/changes/<id>/ | A git commit or a release tag |
| Verify | Running project checks before review | Human approval of a gate |
| Review | Structured passes defined in REVIEW.md | Merging or deploying |
| Archive | Promoting a finished change into living specs | Deleting the change folder without promotion |
| ADR | Architecture decision record under docs/decisions/ | A transient design note only in chat |
| Agent | Coding assistant following AGENTS.md | A human code owner who approves gates |
| Gate | Lifecycle checkpoint a human must approve in their terminal | An automated CI job alone |

<!-- Example domain rows to replace:
| Account | Billable customer tenant | End-user login identity |
| Ledger entry | Immutable money movement | Mutable wallet cache |
-->

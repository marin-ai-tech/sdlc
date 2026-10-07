---
title: Roles and separation of duties
summary: openspec/roles.yaml, who may approve which gate, and signed approvals.
---
# Roles and separation of duties

Without `openspec/roles.yaml`, anyone with a git identity may approve. With it, approvals are tied to named people.

```yaml
version: 1
signing: warn                 # off | warn | required
people:
  alice: { name: Alice Walker, emails: [alice@corp.example] }
  bob:   { name: Bob Turner,   emails: [bob@corp.example] }
roles:
  product-owner: [alice]
  engineer: [bob]
  code-owner: [bob]
  maintainer: [alice]         # may change this file
separation:
  author_cannot_approve: [review, release]
  distinct_approvers: [[plan, review]]
  max_gates_per_person: 3
```

## What is checked on approval

- Your git email belongs to a person, and the person holds one of the gate's roles (`approvers` in `sdlc.yaml`).
- **author_cannot_approve**: authors of the change's code (commit authors and `Co-authored-by`) may not approve these
  gates.
- **distinct_approvers**: the paired gates need different people.
- **max_gates_per_person**: how many gates of one change one person may approve.

## Useful commands

- `sdlc roles who review --change <id>` — who may approve now, and why the others may not.
- `sdlc roles check` — a matrix of people, roles and gates.
- `sdlc review suggest --change <id>` — a proposed reviewer (code owners of the changed files first, never an author).
- `sdlc approvals verify` — checks that every approval arrived in a commit signed by its approver (with `signing`).
- `sdlc roles migrate` — moves `roles:` from `sdlc.yaml` into `roles.yaml` (a person's command).

Agents cannot edit `roles.yaml`; protect it in git with CODEOWNERS and branch protection as well.

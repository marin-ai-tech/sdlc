---
id: intent
title: "SDLC: Intent"
description: Capture an idea, request, ticket or problem as intent.md, the Stage 1 (Plan) artifact of the AI-native SDLC, for product-owner approval. Use when the user describes something they want built or fixed, or says "new idea", "capture intent", "start a change".
command-description: Stage 1 (Plan) - capture an idea as intent.md for product-owner approval
argument-hint: "<idea, request, or ticket id>"
---
Capture an idea as `intent.md` - Stage 1 (Plan). The intent is the originator's proto-spec: what is wanted, why, and under which constraints, in their own words.

{{contract}}

**Input**: {{input}}

**Steps**

1. **Choose the change.** If the input names an existing change, use it. Otherwise derive a short kebab-case name (e.g. "customers keep calling about claim status" -> `claims-status-self-service`) and create it:
   ```bash
   sdlc new <name> --kind <feature|bugfix|refactor|chore|docs|security|incident> --risk <low|medium|high> [--source-type ticket --source-ref <id>]
   ```
   Infer kind and risk; ask only when unclear. Risk is `high` for security, privacy, payments, data migration, compliance, or a wide blast radius.
2. **Get the instructions**: `sdlc instructions intent --change <name> --json`. Use `template` as the structure, follow `instruction`, treat `context` and `rules` as constraints (never copy them into the file), write to `resolvedOutputPath`.
3. **Brainstorm until the idea is concrete.** Ask the questions an analyst would ask - scope, affected users, constraints, what success looks like - one or two at a time. Read the code and existing specs (`sdlc openspec list --specs`) instead of asking what they already answer.
4. **Write `intent.md`** with `Status: draft`. No solution design, file names or task lists.
5. **Confirm with the originator** and correct anything misunderstood.
6. **Stop at the gate.** Tell the user the intent is ready for the product owner, who accepts it with `sdlc approve intent --change <name>` or sends it back with `sdlc reject intent --change <name> --note "<why>"`. The spec is written only after acceptance ({{cmd:spec}}).

**Guardrails**
- Planning only: do not edit project code in this workflow, even if the request asks for implementation.
- One page. Record assumptions as Open questions rather than guessing.
- If a change with that name already exists, ask whether to continue it or start a new one.

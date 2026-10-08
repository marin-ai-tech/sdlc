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

If the input is empty, stop and ask the user in plain text for the idea or problem to capture (and the change it belongs to, if any). Do not invent one and do not create a change until they answer.

**Steps**

1. **Choose the change.** If the input names an existing change, use it. Otherwise derive a short kebab-case name (e.g. "customers keep calling about claim status" -> `claims-status-self-service`) and create it:
   ```bash
   sdlc new <name> --kind <feature|bugfix|refactor|chore|docs|security|incident> --risk <low|medium|high> [--source-type ticket --source-ref <id>]
   ```
   Infer kind and risk; when unclear use {{tool:ask}} with 2-4 plausible choices and a recommended one. Risk is `high` for security, privacy, payments, data migration, compliance, or a wide blast radius.
2. **Get the instructions**: `sdlc instructions intent --change <name> --json`. Use `template` as the structure, follow `instruction`, treat `context` and `rules` as constraints (never copy them into the file), write to `resolvedOutputPath`.
   If the change's source is an exploration, or the user points to `openspec/explorations/<slug>.md`, read that note first. Do not ask again what it already answers; carry its unresolved questions into intent's Open questions.
3. **Brainstorm until the idea is concrete.** For open questions with a small answer set, use {{tool:ask}} with 2-4 choices and a recommended one. Ask about scope, users, constraints and success one or two at a time. Read the code and existing specs (`sdlc openspec list --specs`) first.
4. **Write `intent.md`** with `Status: draft`. No solution design, file names or task lists.
5. **Confirm with the originator** and correct anything misunderstood.
6. **Stop at the gate.** Tell the user the intent is ready for the product owner, who accepts it with `sdlc approve intent --change <name>` or sends it back with `sdlc reject intent --change <name> --note "<why>"`. The spec is written only after acceptance ({{cmd:spec}}).

**Guardrails**
- Planning only: do not edit project code in this workflow, even if the request asks for implementation.
- One page. Record assumptions as Open questions rather than guessing.
- Open questions are the person's to answer. Never write an answer yourself (an `Answer` line you add does not count); keep them as list items under the `## Open questions` heading. When you stop at the gate, name them in your message (read them from the file: `sdlc answer` is a person's command, never run it) and give the command for each: `sdlc answer <n> --change <name> --text "<answer>"`. The intent cannot be approved while one is unanswered.
- If a change with that name already exists, ask whether to continue it or start a new one.

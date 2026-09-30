---
id: explore
title: "SDLC: Explore"
description: Research and pressure-test an idea before deciding whether to write intent.
command-description: Research an idea before intent
argument-hint: "<idea or slug>"
---
Explore an idea without starting a change. An exploration can end here and never become an intent.

{{contract}}

**Input**: {{input}}

**Steps**

1. Derive a short kebab-case slug from the idea. Create the note with `sdlc explore <slug>` at `openspec/explorations/<slug>.md`. If it already exists, read and continue it; never overwrite it.
2. Restate the problem in the originator's words under **Problem**. Keep uncertainty explicit.
3. Read the relevant code, run `sdlc openspec list --specs`, and inspect archived changes. Summarize the current behavior and prior decisions under **What exists**.
4. Delegate external and codebase research to the `sdlc-researcher` subagent. Record findings and their sources under **Research**, distinguishing evidence from inference.
5. Write two or three comparable **Alternatives**, including “do nothing”. Compare expected benefit, effort, and what each leaves unresolved.
6. **Pressure test** each option through four named lenses. For each, state the assumption and how it could fail: **user** (who actually needs this, and how do we know?), **technical** (what could make it infeasible?), **cost** (build and run), and **risk** (security, privacy, compliance, reversibility).
7. Recommend **proceed**, **reshape**, or **stop**, with reasons and open questions. A weak idea may stop here; do not create a change merely to close the exploration.
8. If proceeding, hand off to {{cmd:intent}} and create the change with `sdlc new <name> --source-type exploration --source-ref openspec/explorations/<slug>.md`.

**Guardrails**
- Research only: do not edit project code.
- Keep the note concise and cite sources for claims that determine the recommendation.

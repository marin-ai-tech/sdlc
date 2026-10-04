---
id: explore
title: "SDLC: Explore"
description: Research and pressure-test an idea before deciding whether to write intent.
when-to-use: The user wants to explore an idea, compare alternatives, or decide whether to proceed.
command-description: Research an idea before intent
argument-hint: "<idea or slug>"
---
Explore an idea without starting a change. An exploration can end here and never become an intent.

{{contract}}

**Input**: {{input}}

If the input is empty, stop and ask the user in plain text which idea to explore: what it is, why now, and any constraints. Do not invent a topic and do not create a note until they answer.

**Steps**

1. Derive a short kebab-case slug from the idea. Create the note with `sdlc explore <slug>` at `openspec/explorations/<slug>.md`. If it already exists, read and continue it; never overwrite it.
2. Restate the problem in the originator's words under **Problem**. Keep uncertainty explicit.
3. Read the relevant code, run `sdlc openspec list --specs`, and inspect archived changes. Summarize the current behavior and prior decisions under **What exists**.
4. Delegate external and codebase research to the `sdlc-researcher` subagent. Record findings and their sources under **Research**, distinguishing evidence from inference.
5. Write two or three comparable **Alternatives**, including “do nothing”. Compare expected benefit, effort, and what each leaves unresolved.
6. **Pressure test** each option through four named lenses. For each, state the assumption and how it could fail: **user** (who actually needs this, and how do we know?), **technical** (what could make it infeasible?), **cost** (build and run), and **risk** (security, privacy, compliance, reversibility).
7. Recommend **proceed**, **reshape**, or **stop**, with reasons and open questions. Use {{tool:ask}} to offer those three choices, mark the recommendation, and explain each consequence. A weak idea may stop here.
8. If proceeding, add the idea with `sdlc backlog add <title> --outcome <outcome> --accept <measure> --source-type exploration --source-ref openspec/explorations/<slug>.md`. The backlog priority determines when it starts. Once started, continue with {{cmd:intent}}.

**Pausing and resuming**
- Before you stop to wait for the person's answer or for research, write your questions under **Open questions** in the note and mark every unfinished section with `_pending: <what is missing>_`. The note, not the chat, must show where the exploration stopped.
- When the note already exists, read it and continue from the first pending section; do not restart.
- If the person cannot answer, continue with explicit assumptions, record them under **Open questions**, and say how the recommendation would change if an assumption is wrong.

**Guardrails**
- Research only: do not edit project code.
- Keep the note concise and cite sources for claims that determine the recommendation.

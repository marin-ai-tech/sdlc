---
id: health
title: "SDLC: Health"
description: Review the health of the project's process and practices - waits on people, stalled changes, rework reasons, first-pass verification, waivers, hook denials, configuration gaps - and draft improvements as backlog items for a person to order. Use when the user asks how the process is going, why things are slow, what to improve, or after a release or retrospective.
when-to-use: The user asks how the process is going, what slows the team down, or what to improve.
command-description: Review project health findings and draft improvements for the backlog
argument-hint: "[area: flow | quality | discipline | config]"
---
Review where the process and its practices suffer, and propose improvements a person can order.

{{inject:health --json}}

{{contract}}

**Input**: {{input}}

**Steps**

1. Run `sdlc health --json` (or use the result above). Every finding has an `id`, an `area`, a `level` (`bad`, `warn`, `info`), the facts and a recommendation. There is no single score: never invent one.
2. Delegate to the `{{agent:health}}` subagent when the findings need digging (which changes, which reworks, which denials); it reads only and reports back.
3. Explain the findings in plain words, `bad` first: what happens, the facts behind it, why it matters to the team, and the recommended improvement. When an area is named in the input, keep to it. Say plainly when there is nothing worth acting on.
4. Ask the user which improvements to draft. For each one they choose, add a backlog item that names the finding it comes from: `sdlc backlog add "<title>" --kind chore --outcome "<what improves>" --accept "<how we know>" --source-type health --source-ref <finding id>`. Do not set its priority or move it: ordering the backlog is a person's decision (`sdlc backlog move`).
5. Configuration findings (enforcement, verify commands, roles, signing, thresholds) are changes to protected files: propose the exact change to `openspec/sdlc.yaml` or `openspec/roles.yaml` for the user to make; never edit those files.
6. End with the drafted items and the commands a person runs to order them.

---
id: triage
title: "SDLC: Triage"
description: Close the loop (Stage 6, Maintain) - turn an alert, incident, failing build, security finding or ticket into a diagnosed, evidence-backed intent.md that re-enters the lifecycle. Use when the user pastes an alert, incident, error report or scan finding, or asks to investigate a production problem.
command-description: Stage 6 (Maintain) - diagnose an alert/incident/finding into a new intent
argument-hint: "<alert, incident id, finding, or ticket>"
---
Close the loop - Stage 6 (Maintain). What production or a scan reveals re-enters the pipeline as an intent; people triage and approve it.

{{contract}}

**Input**: {{input}}

**Steps**

1. **Diagnose read-only.** Gather evidence: the alert or finding payload, logs, metrics, recent deploys and commits (`git log --since`), failing CI runs, related specs (`sdlc openspec list --specs`). Reproduce when possible. No fixes, no deploys, no config changes.
2. **Classify.** A bounded fix that fits one small change, or wider work (architectural weakness, repeated pattern). Assess severity and blast radius.
3. **Create the change**:
   ```bash
   sdlc new <name> --kind <incident|bugfix|security> --risk <low|medium|high> --source-type <incident|alert|scan|ticket> --source-ref <id> [--track lite]
   ```
   Use `--track lite` only for a bounded fix with no behavior change to specify.
4. **Write `intent.md`** (`sdlc instructions intent --change <name> --json`): the anomaly and its evidence in Problem, the desired end state, affected systems, and open questions.
5. **Recommend, do not act**: whether a rollback or runbook should run now (a person triggers it unless it is pre-approved), and which regression eval/test should be added once fixed.
6. **Stop at the gate.** Route to the service or product owner: `sdlc approve intent --change <name>` to fix now, or `sdlc reject intent --change <name> --note "<reason>"` to dismiss (dismissals tune the alert bands).

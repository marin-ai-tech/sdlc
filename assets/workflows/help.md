---
id: help
title: "SDLC: Help"
description: Show available SDLC workflows and the current project state.
when-to-use: The user asks for help, what can scdl do, or which command to run.
command-description: Show SDLC workflows, state, and human decision commands
---
Show the available workflows and the current state.

{{inject:help --json}}
{{inject:status --json}}

{{contract}}

**Input**: {{input}}

Summarize what exists now from the live output. Give a short cheat sheet with the invocation for this tool:
{{cmd:explore}} investigates an idea; {{cmd:intent}} captures it; {{cmd:spec}} designs it.
{{cmd:plan}} plans work; {{cmd:build}} implements; {{cmd:verify}} checks; {{cmd:review}} reviews.
{{cmd:status}} shows state; {{cmd:next}} advances the next available step.

Name decisions reserved for the person, including approvals, track changes, and backlog moves or drops.
Explain their consequences and give the exact CLI command for each decision that is currently needed.

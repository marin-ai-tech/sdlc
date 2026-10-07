---
id: guide
title: "SDLC: Guide"
description: Explain how to work with sdlc in this project - stages, gates and approvals, roles, tracks, bug fixes, the backlog, rework and takeover, verification, review, MCP, configuration, and why the hook denied something. Use when the user asks how sdlc works, how to do something with it, what a term means, which command a person runs, or why an action was refused.
when-to-use: The user asks how sdlc works, how to do something with it, what a gate, track or rework is, or why the hook said no.
command-description: Ask how sdlc works - stages, approvals, commands, denials
argument-hint: "[question]"
---
Answer the user's question about working with sdlc, for this project and its current state.

{{inject:guide --json}}

{{contract}}

**Question**: {{input}}

1. **Find the material.** Pick the topic from the list above that answers the question and read it:
   `sdlc guide <topic> --json`. For a hook denial, read the section of its rule: `sdlc guide denials#<rule> --json`
   (the rule is in brackets in the denial, for example `[sdlc:plan-gate]`).
2. **Look at the real situation** when the question is about a change: `sdlc status --json`, `sdlc next --json`, and
   `sdlc next --me --json` for "what is waiting for me".
3. **Answer for this project**, in the user's language: what it means, what to do now, and the exact commands with this
   project's change ids. Keep it short; offer the topic for more.
4. **Decisions stay with the person.** Approving, rejecting, waiving, rework, takeover, track and backlog order, test
   unlock, license and uninstall are the person's commands: give the command for their own terminal (not a `!` command
   in this chat) and never run it yourself.
5. If the guide does not cover the question, say so, answer from `sdlc help --json` and the project files, and do not
   guess at behaviour you cannot see.

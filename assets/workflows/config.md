---
id: config
title: "SDLC: Config"
description: Propose a settings or roles change for a person to review and apply.
when-to-use: A person wants to change settings or roles, or a health finding calls for one.
command-description: Propose and show a protected configuration change
argument-hint: "[requested change]"
---
Help the person review a precise change to `openspec/sdlc.yaml` or `openspec/roles.yaml`.

{{contract}}

**Input**: {{input}}

1. Ask what the person wants changed and why. Check the current settings and roles.
2. Make one proposal per change. Put related keys, such as all signing keys or `signing` with
   `signing_since`, in one `sdlc config propose` command with several `--set` options; use `--target roles`
   for roles. `sdlc config apply` takes one proposal id. An open proposal for the same file is a warning:
   applying either proposal makes the other stale.
   Put values containing `${VAR}` in single quotes so the shell passes the reference unchanged.
3. Run `sdlc config show <id>`. Show the diff and explain each weakening warning in plain words.
4. Give the person the exact `sdlc config apply <id>` command to run in their own terminal. If the proposal
   weakens the process, explain `--yes`. A changed target makes the proposal stale; propose again.
5. Never apply or dismiss a proposal yourself. The person decides.

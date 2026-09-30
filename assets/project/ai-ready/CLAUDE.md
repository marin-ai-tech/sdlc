# Claude Code notes for {{project.name}}

@AGENTS.md

This file is the thin Claude Code entry point. Shared agent rules live in AGENTS.md (imported above). Keep Claude-only notes here so other agents are not confused by Claude-specific paths.

## Claude-specific commands

Skills and slash commands use the Claude Code form `/sdlc:<step>` (colon), for example `/sdlc:intent`, `/sdlc:spec`, `/sdlc:plan`, `/sdlc:build`, `/sdlc:verify`, `/sdlc:review`, and `/sdlc:archive`.

## Gates via hooks

Hooks in `.claude/settings.json` enforce lifecycle gates. Do not bypass them. Humans still approve gates in their own terminal; never run `sdlc approve` from the agent.

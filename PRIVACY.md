# Privacy

This policy covers sdlc: the command-line tool, its Claude Code plugin and the files it generates for other coding
agents. It is published by marin-ai technologies (https://github.com/marin-ai-tech).

## What we collect

Nothing. sdlc runs on your machine. It has no telemetry, no account and no server of ours; marin-ai technologies
receives no data from it.

## What sdlc stores on your machine

sdlc keeps its records in the project's own files, inside your repository (mostly under `openspec/`):

- approvals and rejections, with the git name and email of the person who made them, the time and a digest of the
  artifacts they cover; optionally an SSH signature;
- the output of the project's checks recorded by `sdlc verify`, reviews and the project's event log.

These records stay where your repository is stored and follow its retention. To remove them, remove the files.

## What sdlc can send, and only if your project configures it

In `openspec/sdlc.yaml` a project can name services that sdlc then contacts. By default none are named.

- Event receivers (MCP servers, for example a chat or GitHub). After a CLI command, sdlc delivers queued events: the
  project, the change id, the gate, the decision and the ids of the people from `roles.yaml`. Chat handles go only
  to a receiver set up with `chat`; the note of a rejection only to a receiver with `include_note: true`.
- MCP servers that `sdlc context pull` reads.
- Extension pack sources (git repositories or npm packages) that `sdlc team sync` fetches.

`sdlc mcp serve` serves the project's state to tools on your machine; with `--http` it listens on the network only
when a person starts it, with a token.

Each of these services handles the data under its own terms.

## Coding agents

The coding agent you use (Claude Code, Codex CLI, Cursor and others) reads sdlc's output like any other command
output, under that agent's own terms. sdlc does not send anything to the agent's provider itself.

## Contact

Questions about this policy: https://github.com/marin-ai-tech (open an issue in the sdlc repository).

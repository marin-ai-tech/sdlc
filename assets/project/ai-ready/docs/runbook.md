# Runbook

How to set up, build, run, test, and debug {{project.name}}. Keep commands accurate; agents and humans both rely on this file.

## Setup

1. Clone the repository and install the toolchain required by this stack.
2. Install project dependencies (see the repository lockfile / package manifest).
3. Copy example env files if present; fill secrets locally — never commit them.
4. Confirm `{{cli}} status` runs from the project root.

## Build

Build artifacts with the project's standard build command (document the exact command here as the stack settles). Clean rebuilds should be documented when caches cause drift.

## Run

Start the local app or service the way developers do day to day. Note ports, required sidecars (database, queue), and how to stop cleanly.

## Test / verify

Before review or archive, run:

{{verify.commands}}

If a check fails, fix product code (or follow the approved plan). Do not skip red checks to claim done.

## Debug

- Reproduce with the smallest failing verify command.
- Check recent changes under openspec/changes/ for the active plan.
- Inspect structured logs and correlation ids (see [conventions]({{path:conventions}})).
- For architecture questions, start at [architecture]({{path:architecture}}).

## Environments

| Environment | Purpose | Notes |
|-------------|---------|-------|
| local | Developer machines | Secrets in ignored env files |
| ci | Automated verify | No interactive approve |
| staging | Pre-production | Mirrors prod config shape |
| production | Live traffic | Changes only via approved release process |

Document how config differs per environment without pasting secret values. Security-sensitive zones: [security]({{path:security}}).

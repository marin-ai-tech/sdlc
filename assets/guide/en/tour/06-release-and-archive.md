---
title: Release and archive
---
# 6. Release and archive

When the release gate is on, the agent prepares `release.md` (`/sdlc:release`): the changelog, the rollout per
environment, the control bands, the rollback. The release manager approves it; the release checks configured as MCP
tools run at that moment.

```bash
sdlc approve release --change basic-arithmetic
sdlc approvals verify                          # signed approvals and their commits
sdlc archive basic-arithmetic --yes            # re-checks every gate, then merges the delta specs
```

- Archiving merges the change's delta specs into the living specs (`openspec/specs/`): the next change starts from what
  the product actually does.
- The backlog item of the change is closed, and `sdlc next` proposes the next ready one.
- Archiving past an open gate needs a person and a note (`--force`); it shows in the audit and in health.

Other flows of the demo, in short: an alert becomes a new intent (`/sdlc:triage`), a rejected idea stops early
(`sdlc reject`), a small fix takes the lite track (`sdlc track set lite`), and BMAD planning artifacts can be imported
(`sdlc import bmad`).

Next: keep an eye on the process.

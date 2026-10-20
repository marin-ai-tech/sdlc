# sdlc glossary

Use this alphabetical list when a process term is unfamiliar. Each entry gives you a short meaning and a page
where you can learn how it works in a change.

## 🧭 A–D

- **Approval:** A person's decision to let a gate move forward. It is tied to the approved content's digest.
  See [roles and approvals](08-roles-and-signing.md).
- **Archive:** The step that closes a change and folds its delta specs into living specs.
  See the [lifecycle guide](05-guide.md).
- **Audit:** A view of recorded decisions, waits, reworks and verification for a project or change.
  See [traceability and audit](14-traceability.md).
- **Board:** The task board where work is dispatched to external executors and their claims are tracked.
  See the [executor example](28-executor-swarm-example.md).
- **Change:** The working record for one proposed piece of work, including its artifacts and gate history.
  See the [user guide](05-guide.md).
- **Delta:** A change's proposed additions or edits to requirements before they become living specs.
  See [OpenSpec analysis](01-openspec-analysis.md).
- **Digest:** A fingerprint of covered artifact content used to tell whether an approval still applies.
  See [roles and approvals](08-roles-and-signing.md).

## 🧭 E–H

- **Enforcement mode:** The configured way a guard handles a rule, such as blocking an action or reporting it.
  See the [user guide](05-guide.md).
- **Event receiver:** A configured MCP tool that receives selected process events from sdlc.
  See [integrations](10-integrations.md).
- **Evidence:** Recorded output from checks run by `sdlc verify`, tied to the working tree it checked.
  See the [user guide](05-guide.md).
- **Executor:** A registered external worker that receives a task and returns a result for review.
  See the [executor example](28-executor-swarm-example.md).
- **Gate:** A decision point that must be satisfied before a change can advance.
  See the [user guide](05-guide.md).
- **Guard:** A process rule checked around an agent action to protect gates and files.
  See [architecture](04-architecture.md).
- **Hook:** A tool's callback that lets sdlc enforce a guard during an agent session.
  See [architecture](04-architecture.md).

## 🧭 I–P

- **Intent:** The early artifact that states the need and open questions before detailed specifications.
  See the [user guide](05-guide.md).
- **Judge:** An optional check of a gate's artifacts against the team's rubric before a person approves.
  See [process health](13-process-health.md).
- **Lens:** A named viewpoint the review covers and records; with `review.require_lens_coverage: true` (the
  default for new projects) missing coverage blocks the review gate.
  See the [agent team](12-agent-team.md).
- **Living spec:** The current requirement kept after a change's delta is archived.
  See [OpenSpec analysis](01-openspec-analysis.md).
- **Locked tests:** Tests protected during a bug fix so the agent cannot change the expected result to pass.
  See the [bug fix example](24-bugfix-incident-example.md).
- **MCP:** Model Context Protocol, used here to expose sdlc resources and tools or connect to a team's servers.
  See [MCP use cases](11-mcp-use-cases.md).
- **OpenSpec:** The specification subsystem that manages deltas, living specs, validation and archive.
  See [OpenSpec analysis](01-openspec-analysis.md).
- **Pack:** A source of team roles, skills and optionally accepted lenses, workflows or checks.
  See the [agent team](12-agent-team.md).
- **Plan:** The artifact that names the work and files before a person authorizes the build.
  See the [user guide](05-guide.md).
- **Process health:** Findings with facts and recommendations about flow, quality, discipline and configuration.
  See [process health](13-process-health.md).

## 🧭 R–W

- **Rework:** A person's decision to send a gate's artifacts back for revision.
  See [process health](13-process-health.md).
- **Review:** The gate where findings and their status are checked before approval.
  See the [user guide](05-guide.md).
- **`roles.yaml`:** The project file that names people and their roles for decisions and separation rules.
  See [roles and approvals](08-roles-and-signing.md).
- **Separation of duties:** Rules that keep an author from approving their own review and require distinct people
  at paired gates. See [roles and approvals](08-roles-and-signing.md).
- **Signed approval:** An approval required to arrive in a signed commit.
  See [roles and approvals](08-roles-and-signing.md).
- **Spec:** A requirement description that guides implementation and verification.
  See [OpenSpec analysis](01-openspec-analysis.md).
- **Stage:** A part of the change lifecycle, such as intent, plan or build.
  See the [user guide](05-guide.md).
- **Stale approval:** An approval whose covered artifact content changed after the decision.
  See [roles and approvals](08-roles-and-signing.md).
- **Trace:** The view that connects requirements, tasks, commits and evidence and names gaps.
  See [traceability](14-traceability.md).
- **Track:** A configured path through gates for a kind of change, including the smaller `lite` path.
  See the [tracks example](23-tracks-and-decisions-example.md).
- **Verify:** The command and gate that run configured checks and record their evidence.
  See the [user guide](05-guide.md).
- **Waiver:** A recorded decision to skip a gate, made by a person or by configured policy where allowed.
  See [process health](13-process-health.md).

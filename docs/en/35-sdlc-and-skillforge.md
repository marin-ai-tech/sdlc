# 35. Two environments: sdlc and SkillForge

A team can keep its roles, skills and rules in SkillForge and run its process with sdlc. This page explains how the
two fit together. It is based on an end-to-end run on OpenCode in November 2026. A kids calculator went from intent
to archive with SkillForge 0.5.8 as the team registry, sdlc 0.31.1 as the process and OpenCode as the agent. The
team rules, the source marker and the stage skills step came with sdlc 0.32.0 and SkillForge 0.5.9. They were
checked on the same project with probes, not with a second full change.

## On this page

- [Who does what](#351-who-does-what)
- [Connect SkillForge as the team registry](#352-connect-skillforge-as-the-team-registry)
- [Bring the team in](#353-bring-the-team-in)
- [What lands where](#354-what-lands-where)
- [A change from intent to archive](#355-a-change-from-intent-to-archive)
- [What goes back to SkillForge](#356-what-goes-back-to-skillforge)
- [Limits](#357-limits)
- [Checklist](#358-checklist)
- [See also](#-see-also)

## 35.1. Who does what

Each environment owns one side of the work.

| Concern | SkillForge | sdlc |
|---|---|---|
| Roles, skills and rules | Stores them, versions them, reviews them | Fetches them and checks their checksums |
| Acceptance | Promotes a version to active | A person accepts it for this project |
| Agent files | - | Writes the role agents, skills and rules for each tool |
| Process | - | Stages, gates, human approvals, evidence, review, release |
| Enforcement | - | Hooks and the OpenCode plugin refuse what skips a gate |
| Usage | Counts use and help per version | Sends gate and verify events |

The rule of thumb: SkillForge answers "what does the team know", and sdlc answers "what may happen next, and who
decides". Nothing an agent does in sdlc can approve a gate, and nothing a registry sends can change the process.

## 35.2. Connect SkillForge as the team registry

sdlc talks to the registry over MCP. The server named by `team.registry` must answer `list_roles`, `get_role`,
`list_skills` and `get_skill`, and may answer `list_rules` and `get_rule`. The [agent team](12-agent-team.md) page
gives the exact contract. Since SkillForge 0.5.10, its plugin `sdlc-registry` serves this contract on SkillForge's
own `/mcp` endpoint. No adapter is needed. An administrator enables the plugin in `/admin/plugins`.

Connect SkillForge as two servers on the same address, each with its own token:

- `skillforge` uses an ordinary MCP token and is the team registry.
- `skillforge-events` uses an integration token and receives sdlc's events. Create it on SkillForge's token page with
  "For an integration, not an agent". Only such a token sees the `report_outcome` tool.

```yaml
# openspec/sdlc.yaml
mcp:
  servers:
    skillforge:
      type: http
      url: https://skillforge.example/mcp
      headers:
        Authorization: Bearer ${SF_MCP_TOKEN}
      agents: false
    skillforge-events:
      type: http
      url: https://skillforge.example/mcp
      headers:
        Authorization: Bearer ${SF_EVENTS_TOKEN}
      agents: false
events:
  - server: skillforge-events
    tool: report_outcome
    on: [gate.*, verify.*]
team:
  mode: team
  registry: skillforge
```

Write the headers in block style, as above. A header map on one line, such as `{ Authorization: Bearer ${X} }`, is
not valid YAML without quotes.

When the plugin is off, SkillForge still answers but has no `list_roles` or `get_role`. Then `team sync`,
`team accept` and `team check` stop with exit code 1, name the missing tools and write nothing. A registry that does
not answer at all is different: `team sync` says so and the built-in roles fill the team.

A server named by `team.registry` or by `events` serves the CLI only, unless you set `agents: true` on it. sdlc does
not lay it out for the agents, and the hook refuses an agent's MCP call to the events tool. That rule covers MCP calls
only: the CLI delivers events with the environment of the command that runs. Set `SF_MCP_TOKEN` and
`SF_EVENTS_TOKEN` only in people's terminals, not in the agent's environment. Events from an agent's command then
wait until a person's command delivers them.

## 35.3. Bring the team in

A maintainer brings the roles, skills and rules in. Every step that changes what agents get is a person's command.

```bash
sdlc team sync
sdlc team check
```

`team sync` writes role drafts to `docs/agents/drafts/` and lists the registry's rules, saying which fit the project.
A rule fits when it has the tag `sdlc`, a tag of the project's stack, or a path that matches a project file.
`team check` shows which skills will install, which wait for a person and which are refused, and each rule's
checksum.

The maintainer reads the drafts, adds the project's own rules to them, and accepts. SkillForge installs the
registry's rules. `team sync` prints one install line per rule that fits, for each agent:

```bash
sdlc team accept analyst
sdlc team accept --skill plan-mode
skillforge install rule/people-decide-gates --runtime opencode
```

A rule that does not fit gets no line. `skillforge sync --type rule --runtime opencode` is the alternative: it
installs every active rule of the registry, fitting or not. SkillForge's agent ids are `claude-code`, `cursor`,
`opencode`, `codex` and `qwen`. With OpenCode and Codex both, `team sync` prints the Codex lines only: OpenCode reads
the Codex rules in `AGENTS.md` too. `team check` names an installed rule that the registry lists and the fit notes
do not propose, with its `skillforge uninstall rule/<id> --runtime <agent>` line.

`skillforge sync` refuses the MCP registry credential with `mcp_token_forbidden` (exit code 4). The person signs in
with `skillforge login` first, or uses an ordinary API credential instead of the MCP one.

A skill with only Markdown installs with its role. A skill with any other file waits for `--skill`. A skill over the
limits is refused even when a person asks. A skill has at most 64 files; in the run, a 150-file skill was refused
this way. Each accepted role and skill is bound to its checksum in `openspec/.sdlc/team.json`.

## 35.4. What lands where

| Item | Claude Code | OpenCode |
|---|---|---|
| A role | `.claude/agents/sdlc-<role>.md` with its skills preloaded | `.opencode/agents/sdlc-<role>.md`, a subagent |
| A skill | `.claude/skills/<id>/` | `.opencode/skills/<id>/`, or `.claude/skills/<id>/` when Claude Code is also configured |
| A registry rule | `.claude/rules/`, written by `skillforge sync` | `.opencode/rules/`, written by `skillforge sync` |
| The registry source | The registry's `marker`, for example `skillforge-source:`, in the role's front matter | The same |

The `CLAUDE.md` that sdlc creates imports `AGENTS.md`; an existing `CLAUDE.md` needs an `@AGENTS.md` line. sdlc owns
only the block between `<!-- sdlc:rules:start -->` and `<!-- sdlc:rules:end -->`, and since sdlc 0.32.1 that block
holds no registry rule. With sdlc 0.32.0 both tools placed the rules, and agents read each one twice. After the first
`sdlc update` on 0.32.1, run `skillforge sync --type rule` once: the update removes what 0.32.0 placed. SkillForge
0.5.12 and newer install rules for Codex (a block in `AGENTS.md`) and Qwen Code (a block in `QWEN.md`) too. For
GigaCode SkillForge installs no rules yet, and `sdlc doctor` says so.

## 35.5. A change from intent to archive

Five fictional people held the roles in the run. The project owner answered the intent's questions and approved it.
The spec, plan, review and release decisions were run by the test operator for the personas, from the same scripts a
person would use. The verify gate passes on recorded evidence, without a person. The agent wrote every artifact, the
code and the tests. What the team saw:

- **Intent and spec.** The agent loaded the analyst's skills itself, wrote the intent with open questions, and
  offered editable answers.
- **Plan.** The plan named one test per scenario. The accepted roles carried a wrong project rule, "tests are
  agent-locked". The design repeated it. The agent read `testsLocked: false` in `sdlc status` and corrected the
  design's wording in the plan.
- **Build.** Red tests came first, every task got its own commit with `SDLC-Task` and the agent's trailer, and the
  plan's file list held.
- **Verify.** `sdlc verify` recorded the checks. The tester subagent failed on a permission prompt, and its report was
  lost. The verifier then exercised every scenario in Chrome and Edge, and named the browsers and devices it did not
  test.
- **Review.** The six reviewer subagents could not start in headless OpenCode, so the main agent ran the six passes and
  lenses itself and said so. They recorded three nits, and the code owner approved.
- **Release and archive.** The agent rehearsed the rollback in a scratch folder. Archive merged the spec into
  `openspec/specs/`.

The hook refused the agent 14 times. One was a real refusal: a copy to a shell variable during the release rehearsal,
which the agent redid with literal paths. The rest were false positives on here-document bodies and `node -e`
scripts; see the limits below.

## 35.6. What goes back to SkillForge

sdlc sends `gate.*` and `verify.*` events to `skillforge-events`. Each event names its stage in `stage`: the intent
gate is `plan`, spec is `design`, plan is `build`, verify is `test`, review and release are `deploy`. The plugin turns
each stage outcome into usage records with the basis `assigned` for the skills of the roles that have that stage.
A plugin that matches the gate id in the event name against the roles' stages instead credits the wrong roles; it
must read `stage`. Those records do not count
towards SkillForge's transfer rate. sdlc knows that a skill was assigned, not that it was loaded or helped, so it
never calls `record_usage`. Real use comes from the agents' sessions: `skillforge sessions import` reads them, for
OpenCode from the files of `opencode export`. With SkillForge 0.5.9 or later, `skillforge agent scan` ties the role
agents to their registry source through the marker line. For a role accepted before sdlc 0.32.0, `sdlc team sync`
keeps a draft with the marker and names the `sdlc team accept` command that records it. Codex role agents are TOML
files and carry no marker, so SkillForge cannot tie them to their source.

## 35.7. Limits

- On OpenCode a role's skills reach a subagent only as a line in its text. Since sdlc 0.32.1 the stage command, such
  as `/sdlc-build`, prints the texts of the stage's skills itself, up to 48 KiB. A stage started in plain words
  gets only the step that asks the agent to load them, and its report then shows what it loaded.
- Registry rules reach an agent only as SkillForge installs them. For Codex, Qwen Code and GigaCode it installs none
  yet.
- An agent can edit the team rules block of `AGENTS.md`. `sdlc doctor` names any rule in it, and `sdlc update`
  empties it again.
- Every line of a here-document body is read as a command. Write a helper file with the editor tool instead.
- A `node -e` script that writes through a variable is refused. Put the script in a file.
- A headless OpenCode run cannot answer a permission prompt. Since sdlc 0.32.0, read-only subagents run shell
  commands without asking, and the plugin still checks the writes that matter.
- Free hosted models can stop answering. Keep each step small so that a retry costs little.

## 35.8. Checklist

1. The plugin `sdlc-registry` is on, and `sdlc team check` lists the skills you expect.
2. `team.registry` and `events` name servers the agents do not see, so `opencode.json` has no registry entry.
3. Both tokens are set only in people's terminals, and only the events server has the integration token.
4. A person accepted every role and every skill with scripts, and ran `skillforge sync --type rule` for each tool.
5. `sdlc doctor` names no rule in the team rules block.
6. Each gate has a different person where `roles.yaml` says so.

## 📚 See also

- [Agent team](12-agent-team.md) — the registry contract, acceptance and limits.
- [Integrations and MCP](10-integrations.md) — servers, events and the `agents` setting.
- [AI-ready project](07-ai-ready-project.md) — `AGENTS.md` and the rules block.
- [A team with different agents](29-mixed-tools-example.md) — one process across tools.

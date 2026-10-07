# 11. Working with sdlc over MCP: capabilities and use cases

Chapter 10 describes each MCP feature. This chapter is about using them: who connects to what, which situations they help in, and where the limits are today. Everything here works in 0.9.0 unless a limit says otherwise.

## 11.1. What sdlc offers over MCP

MCP works in two directions here:

- **sdlc as a server.** Agents and other systems read the process.
- **sdlc as a client.** The CLI calls your team's servers and records what they answer.

| Capability | Direction | Command or setting | Who uses it |
|---|---|---|---|
| Read the process: status, next step, artifact instructions, trace, audit, help | sdlc → others | `sdlc mcp serve`, registered by `sdlc init --mcp` | agents, orchestrators, chat clients, IDE assistants |
| One registry of the team's MCP servers for Claude Code and OpenCode | config → tools | `mcp.servers` in `openspec/sdlc.yaml` | the team lead, once |
| Check that the servers are reachable and what they can do | sdlc → servers | `sdlc mcp check` | whoever adds a server |
| A server's answer as gate evidence | sdlc → servers | `verify.mcp` | the verify gate |
| Results for the agent from runs it was not part of | sdlc → agent | `sdlc inbox`, the session-start summary | the agent |
| Which servers an agent may call at which stage | hook | `mcp.servers.<name>.stages` | enforced on every agent |
| Which skills, subagents and servers a stage uses | generated workflows | `stages.<stage>` | the agent, as guidance |

**What is never offered:** approving, rejecting, waiving, sending back, taking over, unlocking tests, setting the license or uninstalling. Over MCP, sdlc reads and reports. A person decides at their own terminal.

## 11.2. Connecting a client

**Claude Code and OpenCode** in the project:

```bash
sdlc init --mcp          # writes the sdlc entry into .mcp.json and opencode.json
```

Claude Code asks once, in an interactive session, before it starts a project server.

**Claude Desktop or another client** that starts servers outside the project. `sdlc mcp serve` serves the project of the folder it starts in, so the command has to go to the project first. In Claude Desktop, edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sdlc-claims": {
      "command": "cmd",
      "args": ["/c", "cd /d C:\\work\\claims && sdlc mcp serve"]
    }
  }
}
```

On macOS and Linux, use `"command": "sh", "args": ["-c", "cd ~/work/claims && exec sdlc mcp serve"]`. Use one entry per project.

**Your own script** with the official SDK (`@modelcontextprotocol/sdk`):

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: 'sdlc', args: ['mcp', 'serve'], cwd: '/work/claims' });
const client = new Client({ name: 'report', version: '1.0.0' });
await client.connect(transport);
const { structuredContent } = await client.callTool({ name: 'status', arguments: {} });
console.log(structuredContent.changes.map((c) => `${c.change}: ${c.stage}`));
await client.close();
```

Every tool answers with exactly the JSON of the matching CLI command (`sdlc status --json` and so on). A script can therefore be written and tested against the CLI first.

## 11.3. Use cases

### The agent analyses the process itself

*Who:* the coding agent in its own session.

*How:* with the `sdlc` server registered, the agent calls `status`, `next`, `trace` and `audit` as tools instead of shell commands. For example:

- "Which changes are stuck, and on whom?" — `next` for each change names the actor and, with `roles.yaml`, the people.
- "Does every requirement have a task and evidence?" — `trace` lists the gaps.
- "Where does our time go?" — `audit` gives the wait per gate, reworks with their reasons and first-pass verification.

*What you get:* the same answers as the CLI, as structured data the agent can reason over, with no decision within its reach.

### An orchestrator hands out the work

*Who:* a script or an orchestrating agent that runs several coding agents.

*How:* it calls `status` for all changes and `next` for each of them, and sends every change whose next actor is the agent to a free executor. A change whose next actor is a person is put on a list for that person. `instructions` gives the executor the template and rules of the artifact it has to write.

*What you get:* the dispatch rule comes from the gates, not from the orchestrator's guess. An executor can never be handed a step that belongs to a person.

### A reviewer's assistant prepares the review

*Who:* the code owner's own assistant, for example Claude Desktop pointed at the project.

*How:* before reviewing, the person asks the assistant for a brief:

- `trace` for the change: requirements, tasks, commits and evidence, and the gaps;
- `audit` for the change: who approved what, the reworks and the verify attempts;
- `instructions review` for the review rules.

`sdlc review suggest` (CLI) says who should review in the first place.

*What you get:* the reviewer starts from the risk and the gaps rather than from a raw diff. Approving is still `sdlc approve review` in their own terminal.

### A manager asks in a chat client

*Who:* a product owner or a release manager who does not use a terminal.

*How:* connect Claude Desktop to the project (11.2) and ask in plain words:

- "What blocks the release of add-export?"
- "Which gates are waiting for me?"
- "What did we rework this month, and why?"

The assistant answers from `next`, `status` and `audit`.

*What you get:* the process is visible to the people who decide, without asking a developer.

### Reports across the team

*Who:* a team lead or a PMO that wants one picture of many developers and repositories.

*How:* the process state lives in the repository (`openspec/`, `.sdlc.yaml`, the log), not on a developer's machine. A central job therefore does not need to reach anyone's laptop. It checks out each repository (or its main branch) and reads the state in one of two ways:

- through `sdlc mcp serve` started in that checkout;
- directly with `sdlc status --json`, `sdlc audit --json` or `sdlc report --format json`.

It then merges the answers. `sdlc dashboard` builds the HTML page per repository.

*What you get:* team-wide reports from the source of truth, consistent with what each developer sees.

### CI status as gate evidence

*Who:* the verify gate.

*How:* describe the CI server in `mcp.servers` and add a `verify.mcp` check (chapter 10.3). `sdlc verify` asks the CI server about the exact head commit and fails if the pipeline is not green.

*What you get:* "CI is green" becomes recorded evidence, obtained by the CLI, not a claim by the agent. The same pattern works for any system that can answer a yes/no question about a commit or a change:

- a security scanner: "no high findings for this commit";
- a test-management tool: "the regression suite passed";
- a change-management system: "change CHG-123 is approved".

### Night runs and the inbox

*Who:* CI, or a person running `sdlc verify` outside an agent session.

*How:* the MCP results of such a run are written to `openspec/.sdlc/inbox/`. In the morning, the agent's session starts with one line per open item and the agent works through them (`sdlc inbox list`, `sdlc inbox done <id>`).

When CI produces the results, CI has to commit the inbox files so the agent's checkout gets them.

*What you get:* failures found while nobody was watching reach the agent without anyone retelling them.

### Tools that belong to a stage

*Who:* the team lead.

*How:* give each server its `stages`:

- Jira for planning and deploy;
- the build server for build and test;
- the deploy server for deploy only.

Give each stage its skills and subagents in `stages.<stage>`. The workflows list them, and the hook denies a server outside its stages in `block` mode.

*What you get:* the agent sees the right tools at the right time. A deploy tool cannot be reached while a change is still being designed.

### Keeping risky servers away

*Who:* whoever adds a server to the registry.

*How:* run `sdlc mcp check` before adding a server. A warning that a server's tools can write files means it could change files behind the hook's back: keep it out of the registry. Secrets stay out of the repository as `${VAR}` references, and sdlc refuses a literal one. Answers that carry a secret are masked before they reach the evidence or the inbox.

*What you get:* the integration does not open a way around the rules it is meant to support.

### Being told, not asking

*Who:* the agent and the people.

*How* (today):

- the session-start summary lists the inbox items and every gate that waits for a person;
- `sdlc next` names who acts;
- the project log (`openspec/.sdlc/log.jsonl`) records when a gate starts waiting for a person (`gate.<g>.awaiting`), every approval, verification and rework. A job that reads the log can notify a channel.

*What you get:* problems and waits surface by themselves inside the agent's session and in the log. sdlc does not yet push events to an outside server: see the limits.

## 11.4. Security model in short

- **Who can call the sdlc server:** whoever can start a process in the project folder. That person can read the repository anyway.
- **What it can read:** the same as the CLI's JSON: change names, stages, people from `roles.yaml`, file paths in traces, audit history. Treat a connected chat client as someone with read access to the repository.
- **What it cannot do:** decide anything, write project files, or run arbitrary commands. Tool arguments that look like options are refused.
- **What sdlc sends to other servers:** only the arguments of your `verify.mcp` checks (`${HEAD}`, `${CHANGE}`, your literals) and the `${VAR}` values for that server.

## 11.5. Limits today

- **Local servers only.** `sdlc mcp serve` speaks stdio; there is no HTTP endpoint to reach from another machine. Central reporting reads the repository instead (11.3).
- **No project option.** `sdlc mcp serve` serves the folder it starts in, so clients outside the project need the `cd` wrapper (11.2).
- **One CLI process per tool call.** That costs about half a second, which matters only for scripts that make many calls.
- **No push of events** to an outside system. The log and the inbox are the integration points.
- **MCP checks run in the verify gate only.** The release gate cannot yet rest on an external approval answered over MCP.
- **Tools only.** The server offers tools; it does not offer MCP resources or prompts.
- **The inbox travels by git.** Results produced in CI reach the agent only after they are committed.

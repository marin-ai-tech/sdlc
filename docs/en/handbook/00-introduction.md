# 0. Introduction

This chapter explains what sdlc is, who does what, and how the handbook is built. It has no setup steps. Start here,
whatever your role is. The examples use sdlc 0.14 and the `tasklet` project of Northwind Labs ([lesson 0.4](#s0-4)).

## Contents

- [0.1 What sdlc is: stages and gates on top of OpenSpec](#s0-1)
- [0.2 People decide, agents work](#s0-2)
- [0.3 The artifacts of a change, and the two tracks](#s0-3)
- [0.4 Northwind Labs, the toolchain and how to read this handbook](#s0-4)


<a id="s0-1"></a>
## 0.1 What sdlc is: stages and gates on top of OpenSpec

*everyone  ·  tasklet  · needs: nothing; a terminal with sdlc if you want to follow along*

You can say in two sentences what sdlc adds to a coding agent. You can name the six stages and the six
gates, and you know where sdlc keeps its state.

### Procedure

1. Start with the idea. sdlc is a **process layer**. It runs the lifecycle of Anthropic's AI-native SDLC playbook
   inside your coding agent. [OpenSpec](https://github.com/Fission-AI/OpenSpec) is the specification subsystem
   underneath it. sdlc does not fork OpenSpec: it calls the OpenSpec CLI for all spec work. Your `openspec/` folder
   stays a plain OpenSpec project, so `openspec` and `/opsx:*` keep working on it.

2. See the lifecycle in the terminal:

   ```bash
   sdlc guide lifecycle
   ```

   You sees the path of a change and a table of stages. In short:

   ```
   explore → intent → spec → plan → build → verify → review → (release) → archive
     Plan      Plan    Design  Build  Build   Test     Deploy    Deploy     Maintain
   ```

3. Understand the six stages and the gate at the end of each one:

   | Stage | What is written | Gate | Who approves (default role) |
   |---|---|---|---|
   | plan | `intent.md`: problem, outcome, success measures | intent | product-owner |
   | design | `proposal.md`, `specs/`, `design.md` | spec | product-owner; also tech-lead when the risk is high |
   | build | `plan.md`, `tasks.md`, then the code | plan | engineer; also tech-lead when the risk is high |
   | test | `verification.md`, written by `sdlc verify` | verify | nobody: the checks must pass |
   | deploy | `review.md`, then `release.md` | review, release | code-owner; release-manager |
   | maintain | `sdlc archive` merges the spec deltas into the living specs | — | — |

   The release gate is optional by default. A team turns it on in `openspec/sdlc.yaml`.

4. See one change in detail. This is real output from the `tasklet` project:

   ```bash
   sdlc status --change add-due-dates
   ```

   ```text
   add-due-dates  [feature · risk medium · full track · schema sdlc]
     stage     Plan (intent)
     artifacts intent ✓  proposal ○  specs ·  design ·  plan ·  tasks ·
     intent ● ─ spec ○ ─ plan ○ ─ build ○ ─ verify ○ ─ review ○ ─ archive ○
     tasks     none yet
     gates
       intent   … pending            awaiting approval (product-owner; 0 of 1)
       spec     · blocked            missing artifacts: proposal, specs, design
       plan     · blocked            missing artifacts: plan, tasks
       verify   · blocked            waiting on the intent gate
       review   · blocked            waiting on the intent gate
       release  · blocked            (optional) waiting on the intent gate
     next      person: Megan (product-owner) must review and approve the intent gate (intent).
                $ sdlc approve intent --change add-due-dates --as product-owner
   ```

5. Understand two rules that make the gates worth something:
   - **An approval is bound to the content.** sdlc stores a digest (a hash) of the approved files. If someone edits
     an approved artifact, the approval goes stale and the gate needs a new approval. A typo fix counts too.
   - **The stage is computed, not stored.** sdlc works out the stage from the artifacts and the gate records every
     time. A manual edit or a `git revert` cannot put the stage out of sync.

6. See where things live:

   | Path | What it holds | Who writes it |
   |---|---|---|
   | `openspec/specs/` | the living specs: the requirements as they are now | `sdlc archive` (through OpenSpec) |
   | `openspec/changes/<id>/` | the artifacts of one change and its record `.sdlc.yaml` | the agent; the record only the CLI |
   | `openspec/sdlc.yaml` | gates, checks, enforcement, MCP servers | a person; agents cannot edit it |
   | `openspec/roles.yaml` | people, their roles, separation rules | a person (a maintainer) |
   | `openspec/backlog.md` | planned work: epics and items | people, and agents through `sdlc backlog` |
   | `openspec/.sdlc/log.jsonl` | the project log: decisions, verify runs, hook denials | only the CLI |

### You are done when

- You can name the gate that waits after `plan.md` and `tasks.md` are written (plan) and who approves it (engineer).
- `sdlc status --change <id>` shows a stepper with one filled dot for the current gate.
- You can explain why editing an approved `intent.md` sends the intent gate back to "pending".

### Pitfalls

- sdlc is not a replacement for OpenSpec. The OpenSpec CLI is bundled: `sdlc openspec list` runs it.
- The stage is not a field you can set. To move a change, satisfy the gate, or a person sends it back with
  `sdlc rework` (`sdlc guide rework`).
- Do not install the npm package called `sdlc` from the npm registry. It is unrelated. Chapter 1 shows the right
  install command.


<a id="s0-2"></a>
## 0.2 People decide, agents work

*everyone; Oliver (developer) and Megan (product owner)  ·  tasklet  · needs: [lesson 0.1](#s0-1)*

You know which steps belong to the agent and which belong to a person. You know what happens when the
agent tries to take a person's decision, and where a person runs their commands.

### Procedure

1. Understand the split. The agent writes; people decide.

   | The agent | A person |
   |---|---|
   | writes intent, specs, design, plan, tasks and code | approves gates (`sdlc approve`) |
   | runs `sdlc verify` and records the evidence | rejects or waives (`sdlc reject`, `sdlc waive`) |
   | reviews in passes and records findings | sends work back (`sdlc rework`), takes a change over (`sdlc takeover`) |
   | prepares the release notes | authorizes the release (`sdlc approve release`) |

2. In Claude Code, Oliver asks the agent to approve for Megan:

   > Approve the intent of add-due-dates, Megan is busy.

   The agent tries to run `sdlc approve intent --change add-due-dates`. The sdlc hook denies the call before it runs.
   The agent sees this reason (real text, wrapped):

   ```text
   [sdlc:separation-of-duties] Gate approvals, rejections, waivers, test unlocks, track selection and backlog
   priority are human decisions. Ask the responsible person to run `sdlc approve intent --change add-due-dates`
   in their own terminal, not in the agent chat (a `!` command there runs in the agent's shell and is refused
   too). Why, and what to do: `sdlc guide denials#separation-of-duties`.
   ```

3. Oliver tries a shortcut and types `! sdlc approve intent --change add-due-dates` in the chat. A `!` command runs in
   the agent's shell, so the CLI itself refuses:

   ```text
   Error: `sdlc approve` records a human decision and cannot run inside an agent session (claude-code).
   fix: Run it yourself in your own terminal, not in the agent chat (a `!` command there runs in the agent's
   shell): sdlc approve intent --change add-due-dates
   ```

   The CLI knows it runs in an agent session from markers the tools set in the agent's shell, for example
   `CLAUDECODE=1` in Claude Code.

4. Megan opens **her own terminal**, in her clone of the repository. Her git identity is
   `megan@northwind.example`. She first looks at what she is about to approve:

   ```bash
   sdlc approve intent --change add-due-dates --preview
   ```

   ```text
   Approval preview: gate intent of change add-due-dates (pending)
   Artifacts:
     intent  intent.md
   Changed since the last approval: nothing
   Approvals: 0 of 1
   You may approve it:
   $ sdlc approve intent --change add-due-dates
   ```

5. Megan reads `intent.md`, then approves:

   ```bash
   sdlc approve intent --change add-due-dates
   ```

   ```text
   ✓ intent gate: Megan <megan@northwind.example> approved as product-owner (ca24099d2dc4)
   Suggested commit message (its trailer ties the commit to this approval):
     $ git commit -m "chore(add-due-dates): approve the intent gate" -m "SDLC-Approval: add-due-dates:intent:ca24099d2dc4"
   Next: agent — Write proposal (proposal.md) for the spec gate. (/sdlc:spec)
   ```

   She commits the approval with the suggested message and pushes it.

6. See the full list of person commands. Each one is refused in an agent session and denied by the hook:

   | Command | Decision |
   |---|---|
   | `sdlc approve`, `sdlc reject`, `sdlc waive` | a gate decision |
   | `sdlc rework` | send a change back to a gate's stage |
   | `sdlc answer` | answer an open question of an intent, proposal or design |
   | `sdlc takeover`, `sdlc release-control` | take a change from the agent, hand it back |
   | `sdlc tests unlock` | unlock tests during a bug fix |
   | `sdlc track set` | confirm the full or lite track |
   | `sdlc backlog move`, `sdlc backlog drop` | backlog priority and removal |
   | `sdlc license set` | the license the project uses sdlc under |
   | `sdlc roles migrate`, `sdlc adopt --apply`, `sdlc team accept` | who holds roles, the settings, the agent team |
   | `sdlc uninstall` | remove the agent files and hooks |

   `sdlc help` marks each command with its actor (agent or person).

7. Understand the guard in one table. The hooks are installed into each agent tool (Chapter 1). They check every edit,
   shell command and MCP call of the agent:

   | Rule | Kind | In `warn` mode | In `block` mode |
   |---|---|---|---|
   | No code before an approved plan | process | a reminder | denied |
   | MCP server outside its stages | process | a reminder | denied |
   | A person's command run by the agent | hard | denied | denied |
   | Edits of `.sdlc.yaml`, `roles.yaml`, the log | hard | denied | denied |
   | Edits of the guard's configuration (`openspec/sdlc.yaml`, hook settings, `.mcp.json`) | hard | denied | denied |
   | A key or token added in an edit | hard | denied | denied |
   | Locked tests, protected paths | hard | denied | denied |
   | A production deploy command without a release approval | hard | denied | denied |

### You are done when

- `sdlc status --change add-due-dates` shows the intent gate approved by Megan.
- `sdlc log` lists the hook denial (`hook.denied`, rule `separation-of-duties`) and, after it, Megan's approval.
- You can say why a `!` command in the chat is not "your own terminal".

### Pitfalls

- An answer in the chat ("yes, approved") is never an approval. Only the command in a person's terminal counts.
- Any shell the agent started carries the agent marker, so an approval there fails like a `!` command. Use a
  terminal you opened yourself.
- Hook denials are explained in `sdlc guide denials`; this lesson can hit `denials#separation-of-duties`,
  `denials#guard-config` and `denials#state-integrity`.


<a id="s0-3"></a>
## 0.3 The artifacts of a change, and the two tracks

*everyone  ·  tasklet  · needs: [lessons 0.1](#s0-1) and 0.2*

You can open a change folder and say what each file is for, who writes it and which gate it feeds. You
know when a change may take the short `lite` track and who decides that.

### Procedure

1. Open `openspec/changes/add-due-dates/` in the editor. A finished change holds these files:

   | File | Stage | Written by | Gate it feeds |
   |---|---|---|---|
   | `intent.md` | plan | the agent, from the idea of a person | intent |
   | `proposal.md` | design | the agent | spec |
   | `specs/<capability>/spec.md` (delta specs) | design | the agent | spec |
   | `design.md` | design | the agent (the architect role) | spec |
   | `plan.md` | build | the agent: files that change, order of work, risks, proof, rollback | plan |
   | `tasks.md` | build | the agent; checkboxes ticked during the build | plan |
   | `verification.md` | test | `sdlc verify` writes the evidence block; the verifier adds a table per scenario | verify |
   | `verification/` | test | screenshots and browser results, listed in the evidence | verify |
   | `review.md` | deploy | the reviewer: findings with severity, and coverage of each pass | review |
   | `release.md` | deploy | the agent: changelog, rollout, monitoring signals, rollback | release |
   | `.sdlc.yaml` | all | **only the CLI**: kind, risk, track, approvals with digests, verify result, history | — |

2. Inspect the evidence. `verification.md` holds the literal output of the real checks (build, lint, tests),
   not a summary written by the agent. The result is tied to a fingerprint of the working tree. Committing the code
   keeps it valid; changing the code makes it stale.

3. Inspect the record. `.sdlc.yaml` is written only by the CLI. The hook denies an agent's edit of it
   (`sdlc guide denials#state-integrity`).

4. Understand the two tracks:
   - **full** — every gate: intent, spec, plan, verify, review (and release when it is required).
   - **lite** — for small, bounded work: a fix, a docs change, a tooling tweak. The change starts at the plan. The
     plan is still approved before any code, the evidence is still required, and a code owner still reviews.

5. See how the track is chosen. Oliver's agent starts a small bug fix:

   ```bash
   sdlc new fix-empty-title --kind bugfix --risk low
   ```

   ```text
   Created change fix-empty-title (sdlc schema, bugfix, risk low, full track)
     openspec\changes\fix-empty-title
   Next: agent — Write intent (intent.md) for the intent gate. (/sdlc:intent)
   ```

   The record keeps a suggestion: `track_suggestion: lite`, reason "bugfix with low risk". The change stays on the
   full track until a person confirms. The agent cannot:

   ```text
   error: An agent session (claude-code) cannot set the track.
   ```

6. Ethan, the tech lead, confirms the track in his own terminal:

   ```bash
   sdlc track set lite --change fix-empty-title --note "One validation rule, covered by a test"
   ```

   ```text
   Track for fix-empty-title: full → lite
   Next: agent — Write plan (plan.md) for the plan gate. (/sdlc:plan)
   ```

### You are done when

- You can point to the file that the spec gate covers and the file only the CLI writes.
- After `sdlc track set lite`, `sdlc next --change fix-empty-title` asks for a plan, not an intent.

### Pitfalls

- Do not use lite for new behaviour that users will notice, for anything that touches security, data or public
  APIs, or when the scope is unclear (`sdlc guide tracks`).
- The track can only change before the plan is approved.
- `sdlc track set` is a person's command; the agent offers it and gives you the command.


<a id="s0-4"></a>
## 0.4 Northwind Labs, the toolchain and how to read this handbook

*everyone  ·  both  · needs: [lessons 0.1](#s0-1) to 0.3*

You know the team and the two projects used in every lesson, the tools the team works with, and which
lessons to read for your role.

### Procedure

1. Introduce the company and its two projects:

   | Project | Kind | What it is | How it gets sdlc |
   |---|---|---|---|
   | `tasklet` | greenfield | a small task-tracking web API (Node.js, TypeScript), started from an empty folder | `sdlc init` in an empty folder (Chapter 1) |
   | `billing-api` | brownfield | an existing service with code, tests, CI and no sdlc | `sdlc adopt`, the layout adapted or converted in a worktree, enforcement from `warn` to `block` |

2. Introduce the team. One person holds each role. The role names in the third column are the ids in
   `openspec/roles.yaml` that the gates use.

   | Person | Job | Role in `roles.yaml` | What they do with sdlc |
   |---|---|---|---|
   | Megan | product owner | `product-owner` | approves intent and spec |
   | Ethan | tech lead, architect | `tech-lead` | approves high-risk specs and plans; confirms tracks |
   | Oliver | developer | `engineer` | works with Claude Code; approves the plan |
   | Grace | QA engineer | — (no gate role) | reads the evidence, checks the verifier's table, fixes test gaps with the agent |
   | Paul | code owner, reviewer | `code-owner` | approves the review |
   | Emily | release manager | `release-manager` | approves the release |
   | Steven | platform engineer | `maintainer` | installs and configures sdlc, MCP and CI; may change `roles.yaml` |
   | Laura | engineering manager | — (no gate role) | reports, health, audit |

   An external **auditor** appears once, to receive the evidence bundle (`sdlc audit --export`).

3. See the toolchain. The agent is **Claude Code CLI** in the terminal. It reaches other systems through MCP
   servers, which Steven lists once in `mcp.servers` of `openspec/sdlc.yaml` (Chapter 2):

   | Server | What it is | What the team uses it for |
   |---|---|---|
   | `github` | the official GitHub MCP server | issues and projects (the task manager), pull requests, Actions (the build server) |
   | `knowledge` | the team's own server | project data (docs, ADRs, glossary) and the team registry of agent roles and skills |
   | `telegram` | a Telegram bot server | receives process events: a gate waits for Megan, approvals, overdue gates |
   | `sdlc` | sdlc itself (`sdlc mcp serve`) | lets other AI systems read the process; it cannot decide anything |

4. See the six supported agent tools. The process is the same in each one; only the file locations, the way you
   call a workflow and the enforcement mechanism differ.

   | Tool | `--tools` id | Call a workflow | What holds the gates | Agent marker | One-time step |
   |---|---|---|---|---|---|
   | Claude Code | `claude` | `/sdlc:next` | hooks in `.claude/settings.json` | `CLAUDECODE=1` | approve the project's MCP servers once |
   | OpenCode | `opencode` | `/sdlc-next` | plugin `.opencode/plugins/sdlc.js` | `OPENCODE=1`, `AGENT=1`, `SDLC_AGENT` | — |
   | Cursor | `cursor` | `/sdlc-next` | hooks in `.cursor/hooks.json` | `CURSOR_AGENT=1` | — |
   | Codex CLI | `codex` | `$sdlc-next` | hooks in `.codex/hooks.json`, rules in `.codex/rules/sdlc.rules` | `CODEX_CI=1`, `CODEX_SESSION_ID` | trust sdlc's hooks in `/hooks` |
   | Qwen Code | `qwen` | `/sdlc-next` | hooks and `permissions.deny` in `.qwen/settings.json` | `QWEN_CODE=1` | trust the project folder |
   | GigaCode (experimental) | `gigacode` | `/sdlc-next` | hooks and `permissions.deny` in `.gigacode/settings.json` | `QWEN_CODE=1` | trust the project folder |

   Northwind uses Claude Code. One later lesson shows the differences for the other tools.

5. Understand how to read the handbook:
   - Every lesson names a **role**, a **project** and what **you need** before it. Each one stands on its own.
   - Commands a person must run are always run by that named person in their own terminal. The lesson says so
     each time, and shows what happens when the agent tries.
   - Prompts to Claude Code are written as `> /sdlc:intent "…"` or as plain text in a block quote.
   - Output in a `text` block is real output from sdlc 0.14. When a lesson only describes the screen, it says so.

6. Where to start, by role:

   | You are | Read first |
   |---|---|
   | platform engineer (Steven) | Chapter 1, Chapter 2 |
   | developer (Oliver) | Chapter 0, [lessons 1.2](01-setup-greenfield.md#s1-2) and 1.5 for the setup you will meet |
   | product owner, tech lead, code owner, release manager | Chapter 0, [lesson 1.3](01-setup-greenfield.md#s1-3) (roles), [lesson 0.2](#s0-2) again before your first approval |
   | QA engineer (Grace) | Chapter 0, [lesson 2.4](02-toolchain-mcp.md#s2-4) (CI as evidence) |
   | engineering manager (Laura) | Chapter 0, [lesson 2.6](02-toolchain-mcp.md#s2-6) (events) and [lesson 2.7](02-toolchain-mcp.md#s2-7) (reading the process from a chat client) |

### You are done when

- You can name the person who approves each gate in `tasklet`.
- You can say which MCP server is the build server and which one receives events.
- You know how a workflow is called in Claude Code (`/sdlc:next`) and in Codex CLI (`$sdlc-next`).

### Pitfalls

- A role in `roles.yaml` is a gate role, not a job title. Grace and Laura hold no gate role, and that is correct.
- GigaCode support is experimental: it was not checked against a live installation.

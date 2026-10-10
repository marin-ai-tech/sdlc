# Module 1. Setting up a new project

Steven, the platform engineer, sets up sdlc for `tasklet`, a new project that starts from an empty folder. Then the
rest of the team joins. By the end of the module the repository has the sdlc files, the team's roles, working
checks and a clean `sdlc doctor`.

In this module:

- Lesson 1.1 — Install the CLI
- Lesson 1.2 — `sdlc init`: the wizard and the flags
- Lesson 1.3 — People and roles: `openspec/roles.yaml`
- Lesson 1.4 — What init wrote, the verify commands and `sdlc doctor`
- Lesson 1.5 — Enforcement modes and the license line
- Lesson 1.6 — Commit the setup, bring in the team, and update after an upgrade

---

## Lesson 1.1 — Install the CLI            (video: ~5 min)

**Role:** Steven (platform engineer); later every team member   **Project:** tasklet
**You need:** Node.js 20.19 or newer, git, Claude Code CLI

**Goal.** sdlc is installed on your machine, and you know why every person in the team needs it, not only the
developers.

### Steps

1. Check Node.js. sdlc needs version 20.19 or newer:

   ```bash
   node --version
   ```

2. Install the latest release. The package carries sdlc and the OpenSpec version it drives:

   ```bash
   npm install -g https://github.com/marin-ai-tech/sdlc/releases/latest/download/sdlc.tgz
   ```

   To pin a version for the whole team, use the versioned file instead:

   ```bash
   npm install -g https://github.com/marin-ai-tech/sdlc/releases/download/v0.14.4/sdlc-0.14.4.tgz
   ```

3. Check the version:

   ```bash
   sdlc --version
   ```

   ```text
   0.14.4
   ```

4. Explain who needs the CLI:
   - the developers, because the agent's hooks and workflows call `sdlc`;
   - **every person who approves**, because approvals run in the person's own terminal (`sdlc approve`). Megan,
     Ethan, Paul and Emily install it too.

### Check yourself

- `sdlc --version` prints the version.
- `sdlc help` lists the workflows and the commands, each with its actor (agent or person).

### Pitfalls

- Never install the package named `sdlc` from the npm registry. It is unrelated to this project; use the release URL
  or the `release` branch.
- Installing from git needs the `release` branch: `npm install -g github:marin-ai-tech/sdlc#release`. The default
  branch builds from source, and npm 11 cannot build a git package during a global install.
- If `sdlc` is not on the PATH, the hooks let every call through. `sdlc doctor` reports it (lesson 1.4).

### On screen (for the video)

- The install command and `sdlc --version`.
- A slide: "who needs sdlc installed" with the four approvers highlighted.

---

## Lesson 1.2 — `sdlc init`: the wizard and the flags            (video: ~8 min)

**Role:** Steven   **Project:** tasklet   **You need:** lesson 1.1

**Goal.** You can set up sdlc in an empty folder, either with the interactive wizard or with flags in one command,
and you know what each choice means.

### Steps

1. Create the folder and set the git identity. sdlc identifies people by their git email:

   ```bash
   mkdir tasklet && cd tasklet
   git init
   git config user.name "Steven"
   git config user.email steven@northwind.example
   ```

2. **The wizard.** Run `sdlc init` with no flags, in a terminal you opened yourself. The wizard writes nothing until
   you confirm a summary. It asks, in this order:

   | Question | What Steven answers for tasklet |
   |---|---|
   | "Initialize a git repository here?" (only in an empty folder without git) | yes, if he skipped `git init` |
   | "Which coding tools?" (claude, opencode, cursor, codex, qwen, gigacode) | Claude Code only |
   | "Install …?" for a missing OpenSpec CLI or codegraph, then whether to index with codegraph | his choice |
   | Enforcement mode: off, warn, block | block (lesson 1.5 explains why) |
   | "Install the Claude Code status line?" (only when Claude Code is chosen) | yes |
   | "Also install OpenSpec /opsx workflows?" | no |
   | "Artifact language (empty = OpenSpec default)?" | empty |
   | "Create a starter openspec/roles.yaml?" | no: he writes the team's file in lesson 1.3 |
   | "Register sdlc as an MCP server for the chosen tools …?" | yes |

   In an empty folder the wizard also makes the project AI-ready at once: it creates the agent documents
   (`AGENTS.md`, `CLAUDE.md`, `docs/…`).

3. **The flags.** The same setup in one command, for a script or a second machine:

   ```bash
   sdlc init --git-init --tools claude --mcp --mode block --statusline --layout scaffold
   ```

   | Flag | Meaning |
   |---|---|
   | `--git-init` | run `git init` when the folder is not a repository |
   | `--tools claude` | generate the files for Claude Code (a list is allowed: `claude,codex`) |
   | `--mcp` | register `sdlc mcp serve` for the chosen tools (`mcp.serve: true`) |
   | `--mode block` | enforcement mode: `off`, `warn` or `block` |
   | `--statusline` | install the Claude Code status line |
   | `--layout scaffold` | create the AI-ready documents (`scaffold`, `adapt`, `worktree` or `none`) |

   Other flags: `--opsx`, `--delivery skills|commands|both`, `--no-hooks`, `--language`,
   `--cli "npx --no-install sdlc"` for a project-local install, `--force`, `--json`.

4. Read the output. Real output in an empty `tasklet` folder:

   ```text
   SDLC harness initialized in C:\work\tasklet
     OpenSpec: created openspec/ (via openspec init), default schema: sdlc
     config: created openspec/sdlc.yaml (enforcement: block)
     verify.commands is empty - add your build/test/lint commands to openspec/sdlc.yaml
     review policy: created REVIEW.md
     tools: Claude Code
     sdlc 0.14.4, license: community (PolyForm-Noncommercial-1.0.0 + sdlc-Additional-Permissions-1.0)
     git hook .git/hooks/prepare-commit-msg: installed (commits made in agent sessions get an SDLC-Agent trailer)
   warning: community license, but the project declares no OSI-approved license. …
     files: 49 created, 0 updated, 0 unchanged, 0 removed
     Claude Code hooks: installed in .claude/settings.json
     MCP server entries (sdlc) in .mcp.json: installed

   Start a change:
     Claude Code  /sdlc:intent "<your idea>"   then /sdlc:next
   ```

   The output then lists the documents of the AI-ready layout it created. Two lines need action: the empty
   `verify.commands` (lesson 1.4) and the license warning (lesson 1.5).

### Check yourself

- `openspec/sdlc.yaml` exists and shows `mode: block`, `statusline: true`, `tools: [claude]` and `mcp: { serve: true }`.
- `.claude/settings.json` has `SessionStart`, `PreToolUse` and `Stop` hooks that call `sdlc hook`.
- `.mcp.json` has an `sdlc` server that runs `sdlc mcp serve`.

### Pitfalls

- The wizard appears only in a real terminal, outside an agent session and with no setup flags. Any flag, `--json`
  or an agent session gives the non-interactive behaviour.
- Run `init` yourself. In an agent session, `sdlc init` refuses any choice that weakens the guard, for example a
  lower mode: "This setup would weaken the sdlc guard and cannot run inside an agent session (claude-code): --mode:
  warn -> off." (`sdlc guide denials#guard-config`).
- Init with flags does not create `roles.yaml`. That is the next lesson.

### On screen (for the video)

- First the wizard, question by question, ending on the summary screen.
- Then, on a second empty folder, the one-line flag command. Highlight that the result is the same.
- Highlight the two lines that need action in the output.

---

## Lesson 1.3 — People and roles: `openspec/roles.yaml`            (video: ~7 min)

**Role:** Steven (maintainer); the team reviews   **Project:** tasklet   **You need:** lesson 1.2

**Goal.** The repository names the people of the team, the gate roles they hold and the separation rules, so that
sdlc refuses an approval from the wrong person.

### Steps

1. Explain why the file matters. Without `roles.yaml`, any person with a git identity may approve any gate. With
   it, sdlc checks the approver's git email against the people and their roles, and applies separation rules.

2. Steven writes `openspec/roles.yaml` in his editor. The agent may not write it: the hook denies agent edits of
   this file (`sdlc guide denials#state-integrity`).

   ```yaml
   version: 1
   signing: warn
   people:
     megan:  { name: Megan,  emails: [megan@northwind.example] }
     ethan:  { name: Ethan,  emails: [ethan@northwind.example] }
     oliver: { name: Oliver, emails: [oliver@northwind.example] }
     grace:  { name: Grace,  emails: [grace@northwind.example] }
     paul:   { name: Paul,   emails: [paul@northwind.example] }
     emily:  { name: Emily,  emails: [emily@northwind.example] }
     steven: { name: Steven, emails: [steven@northwind.example] }
     laura:  { name: Laura,  emails: [laura@northwind.example] }
   roles:
     product-owner:   [megan]
     tech-lead:       [ethan]
     engineer:        [oliver]
     code-owner:      [paul]
     release-manager: [emily]
     maintainer:      [steven]
   separation:
     author_cannot_approve: [review, release]
     distinct_approvers: [[spec, review], [plan, review]]
     max_gates_per_person: 3
   ```

   - `roles` use the role names of the gates in `openspec/sdlc.yaml` (`approvers`, `high_risk_approvers`).
     `maintainer` is the role that may change this file.
   - `author_cannot_approve`: the authors of a change's code cannot approve its review or release.
   - `distinct_approvers`: the plan and the review, and the spec and the review, need two different people.
   - `max_gates_per_person`: one person approves at most three gates of one change.

3. Check the file:

   ```bash
   sdlc roles check
   ```

   ```text
   ID      Name    Roles
   megan   Megan   product-owner
   ethan   Ethan   tech-lead
   oliver  Oliver  engineer
   grace   Grace    
   paul    Paul    code-owner
   emily   Emily   release-manager
   steven  Steven  maintainer
   laura   Laura    
   ```

4. Explain signing. `signing: warn` makes `sdlc approvals verify` report approvals that did not arrive in a commit
   signed by the approver. Each person sets up SSH signing once (git 2.34 or newer):

   ```bash
   git config gpg.format ssh
   git config user.signingkey ~/.ssh/id_ed25519.pub
   git config commit.gpgsign true
   ```

   Then the person's public key goes into `signing_key` in `roles.yaml`, for example
   `megan: { name: Megan, emails: [megan@northwind.example], signing_key: "ssh-ed25519 AAAA… megan" }`. When every
   approver signs, Steven switches to `signing: required` and runs `sdlc approvals verify --mode required` in CI.

5. Protect the file in code review. Steven adds one line to `.github/CODEOWNERS`:

   ```text
   /openspec/roles.yaml @northwind-labs/maintainers
   ```

6. Later, once a change exists, anybody can ask who may approve a gate:

   ```bash
   sdlc roles who intent --change add-due-dates
   ```

   ```text
   intent · add-due-dates — may approve: Megan (megan)
     Ethan (ethan): missing_role — Ethan does not hold product-owner; ask Megan.
     …
   ```

### Check yourself

- `sdlc roles check` lists eight people; six of them hold a role.
- `sdlc doctor` shows `approval signing mode warn`.
- `sdlc approvals verify` prints `0 approvals checked, 0 invalid (warn: not blocking)` on the new project.

### Pitfalls

- An email may belong to one person only. A duplicate is an error that names the field.
- A person whose git email is not in the file cannot approve (`unknown_person`). Check `git config user.email` on
  each approver's machine.
- Grace and Laura hold no gate role. Do not give Grace `code-owner` "to help": she would then be a reviewer.
- If the wizard created a starter `roles.yaml`, it has one person holding every role and separation switched off.
  Replace it with the team's file before the first change.

### On screen (for the video)

- The YAML file, block by block: people, roles, separation.
- `sdlc roles check` output.
- A slide with the separation rules and an example: Oliver wrote the code, so Oliver can never approve its review.

---

## Lesson 1.4 — What init wrote, the verify commands and `sdlc doctor`            (video: ~7 min)

**Role:** Steven; Ethan chooses the stack   **Project:** tasklet   **You need:** lessons 1.2 and 1.3

**Goal.** You know what each generated file is for, the verify gate has real commands to run, and `sdlc doctor`
shows a healthy installation.

### Steps

1. Walk through what init wrote:

   | Path | Why it exists |
   |---|---|
   | `openspec/config.yaml` | OpenSpec's own config: default schema `sdlc`, project context and rules |
   | `openspec/schemas/sdlc/` | the sdlc schema and the artifact templates (intent, proposal, spec, design, plan, tasks) |
   | `openspec/sdlc.yaml` | gates, verify commands, review policy, release commands, enforcement, license, MCP |
   | `openspec/specs/`, `openspec/changes/archive/` | where the living specs and archived changes will live |
   | `openspec/.sdlc/log.jsonl` | the project log; `.gitattributes` there sets `merge=union`, so branches merge |
   | `openspec/.sdlc/manifest.json` | checksums of the generated files, so `sdlc update` never overwrites your edits |
   | `.claude/skills/sdlc-*/`, `.claude/commands/sdlc/` | the 18 workflows (`/sdlc:intent`, `/sdlc:next`, …) |
   | `.claude/agents/sdlc-*.md` | subagents: verifier, reviewer, researcher, simplifier, health, advocate |
   | `.claude/settings.json` | the hooks (the guard) and the status line |
   | `.mcp.json` | the `sdlc` MCP server; the team's servers come in Module 2 |
   | `REVIEW.md` | the review policy: passes and severities |
   | `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/…` | the AI-ready documents; `CLAUDE.md` imports `AGENTS.md` |
   | `.git/hooks/prepare-commit-msg` | adds `SDLC-Agent: <tool>` to commits made in an agent session (not committed) |

2. Ethan chooses the stack: TypeScript, Vitest, ESLint. Steven writes `package.json` himself. With `block` mode the
   agent may not create code files before a plan is approved, and `package.json` counts as code.

   ```json
   {
     "name": "tasklet",
     "version": "0.1.0",
     "private": true,
     "type": "module",
     "scripts": {
       "build": "tsc -p .",
       "lint": "eslint .",
       "test": "vitest run"
     }
   }
   ```

3. Give the verify gate its commands. The easy way is the adoption draft, which detects the scripts:

   ```bash
   sdlc adopt
   ```

   ```text
   Adoption draft
   Stack: node
   CI: -
   Verify: npm run build
   Verify: npm run lint
   Verify: npm test
   Person: Steven <steven@northwind.example>
   Roles (written to openspec/roles.yaml only if it does not exist):
     …
   A person can apply this draft with: sdlc adopt --apply
   ```

   `roles.yaml` already exists, so applying keeps it. Steven applies the draft in his own terminal:

   ```bash
   sdlc adopt --apply
   ```

   ```text
   Adoption draft applied
   ```

   `openspec/sdlc.yaml` now has:

   ```yaml
   verify:
     commands:
       - name: build
         run: npm run build
       - name: lint
         run: npm run lint
       - name: test
         run: npm test
   ```

   Editing `verify.commands` by hand works too. Mark a check that should not fail the gate with
   `required: false`.

4. Run the doctor:

   ```bash
   sdlc doctor
   ```

   ```text
   ✓ node             Node.js 24.21.0
   ✓ harness          sdlc 0.14.4
   ✓ openspec         OpenSpec 1.13.2 (bundled)
   ✓ openspec cli     1.13.2
   ✓ codegraph        1.6.1 - not indexed (codegraph init --yes)
   ✓ project          root C:\work\tasklet
   ✓ approval signing mode warn
   ✓ sdlc.yaml        enforcement block, tools claude
   ✓ openspec config  default schema sdlc
   ✓ sdlc schema      openspec/schemas/sdlc is valid
   ✓ generated files  49 tracked, 0 missing, 0 edited locally
   ! license          community license, but the project declares no OSI-approved license
   ✓ project log      4 entries in openspec/.sdlc/log.jsonl
   ✓ claude hooks     installed in .claude/settings.json
   ✓ cli on PATH      `sdlc` is on PATH (hooks, plugin and skills call `sdlc`)
   ✓ verify commands  build, lint, test
   ✓ review policy    REVIEW.md
   ✓ git              identity Steven <steven@northwind.example>
   ✓ git hook         prepare-commit-msg in .git/hooks/prepare-commit-msg: commits made in agent sessions get an …
   ```

   The license line is handled in lesson 1.5.

### Check yourself

- `sdlc verify --list` prints the three checks: `build`, `lint`, `test`.
- `sdlc doctor` has no `!` line except the license (until lesson 1.5).

### Pitfalls

- Without verify commands the verify gate can never pass. `sdlc doctor` says: "none configured - the verify gate
  cannot pass".
- `sdlc init` run again does not add the commands later; use `sdlc adopt --apply` or edit the file.
- `sdlc adopt --apply` is a person's command. The agent may run `sdlc adopt` (the draft) and give you the command.
- Do not let the agent edit `openspec/sdlc.yaml`. The hook denies it (`sdlc guide denials#guard-config`).

### On screen (for the video)

- The file tree after init, with the table as an overlay.
- `sdlc adopt`, then `--apply`, then the `verify:` block in the YAML file.
- The doctor output; highlight the `verify commands` line turning from `!` to `✓`.

---

## Lesson 1.5 — Enforcement modes and the license line            (video: ~6 min)

**Role:** Steven; Laura for the license decision   **Project:** tasklet (billing-api for contrast)
**You need:** lesson 1.4

**Goal.** You can choose `off`, `warn` or `block` for a project and change it later. You know which license the
project uses sdlc under and how to record a commercial one.

### Steps

1. Explain the three modes:

   | Mode | Process rules (plan gate, MCP stages) | Hard rules (approvals, records, guard config, secrets, locked tests, release) |
   |---|---|---|
   | `off` | not checked | not checked |
   | `warn` | the agent gets a reminder, the call goes through | denied |
   | `block` | denied | denied |

2. Show the difference on one call. The agent tries to write `src/tasks.ts` before any plan is approved.

   In `block` mode the hook denies:

   ```text
   [sdlc:plan-gate] No active change has an approved plan yet (add-due-dates). Finish the plan and have an
   engineer run `sdlc approve plan --change <id>` before editing src/tasks.ts. Why, and what to do:
   `sdlc guide denials#plan-gate`.
   ```

   In `warn` mode the same text arrives as a reminder, and the file is written.

3. Explain when to choose which:
   - **`block` for a new project.** `tasklet` has no old habits and no code yet, so Steven starts strict.
   - **`warn` first for an existing project.** `billing-api` has work in progress. The team starts in `warn`, reads
     the reminders and the hook entries in `sdlc health`, then switches to `block`.
   - **`off`** only to pause the guard for a short time. `sdlc health` reports it as a configuration finding.

4. Change the mode later, in your own terminal. Real output from a project that was in `warn` mode:

   ```bash
   sdlc init --mode block
   ```

   ```text
   SDLC harness initialized in C:\work\tasklet
     OpenSpec: using existing openspec/
     config: kept openspec/sdlc.yaml (enforcement: block)
     …
   ```

   The rest of `openspec/sdlc.yaml` is kept. Editing `enforcement.mode` by hand works too. Commit the change.

5. Read the license line. Every sdlc record names the license the project uses sdlc under:

   ```bash
   sdlc license
   ```

   The Community License is free for noncommercial use, for public open source projects, and for a 30-day
   evaluation. `tasklet` is a private company project, so `sdlc doctor` warns. Northwind signs a commercial
   agreement (Laura owns that decision).

6. Steven records the agreement in his own terminal:

   ```bash
   sdlc license set commercial --agreement NWL-2026-014 --licensee "Northwind Labs"
   ```

   ```text
   ✓ sdlc 0.14.4, license: commercial (sdlc-Commercial, agreement NWL-2026-014, licensee Northwind Labs)
     recorded in openspec/sdlc.yaml and openspec/.sdlc/log.jsonl; 43 generated file(s) updated
   ```

   The agreement id here is an example.

### Check yourself

- `sdlc doctor` shows `✓ sdlc.yaml  enforcement block, tools claude`.
- `sdlc doctor` shows `✓ license  commercial license, agreement NWL-2026-014 (Northwind Labs)`.

### Pitfalls

- In an agent session, `sdlc init` refuses a lower mode (`agent_cannot_weaken_guard`). A stronger mode is allowed.
- `warn` is not "no rules": the hard rules deny in `warn` too.
- `sdlc license set` is a person's command; the agent cannot set the license.
- Hook denials this lesson can hit: `sdlc guide denials#plan-gate`, `denials#guard-config`.

### On screen (for the video)

- The mode table, then the same tool call in `block` (red, denied) and in `warn` (yellow, reminder).
- `sdlc license` before and after `license set`.

---

## Lesson 1.6 — Commit the setup, bring in the team, and update after an upgrade            (video: ~7 min)

**Role:** Steven; then Oliver and the approvers   **Project:** tasklet   **You need:** lessons 1.1 to 1.5

**Goal.** The setup is in git and shared by the team. Each person has a working installation. You can upgrade sdlc
and regenerate the files without losing local edits.

### Steps

1. Steven commits everything init and he wrote, from his own terminal:

   ```bash
   git add -A
   git commit -m "chore: set up sdlc for tasklet"
   git branch -M main
   git remote add origin git@github.com:northwind-labs/tasklet.git
   git push -u origin main
   ```

   Commit the generated files, `openspec/`, `.mcp.json` and the documents. The whole team shares them.

2. Each team member clones the repository and checks their machine:

   ```bash
   git clone git@github.com:northwind-labs/tasklet.git && cd tasklet
   git config user.email megan@northwind.example
   sdlc doctor
   ```

   The approvers need only the CLI and git. Oliver also needs Claude Code.

3. Oliver starts Claude Code in the project:

   ```bash
   claude
   ```

   What he sees (described):
   - Claude Code asks once whether to use the project's MCP server `sdlc` from `.mcp.json`.
   - Once a change exists, each session starts with an sdlc summary: the active changes, their stage and who
     acts next. With no change yet, the agent is only told that it can answer questions about sdlc from
     `sdlc guide`.
   - The status line shows the active change, its stage and who acts, for example
     `add-due-dates · Plan (intent) · next: person`. With no active change it stays empty.

4. Months later a new sdlc release comes out. Steven upgrades and previews the update:

   ```bash
   npm install -g https://github.com/marin-ai-tech/sdlc/releases/latest/download/sdlc.tgz
   sdlc update --dry-run
   ```

   ```text
   Would update SDLC harness files in C:\work\tasklet (sdlc 0.14.4, license: …)
     files: 0 created, 0 updated, 48 unchanged, 0 removed
   warning: kept .claude/commands/sdlc/status.md (edited locally; run with --force to overwrite)
   ```

   Here someone had edited a generated file. `update` keeps it. `--force` would overwrite it.

5. Steven runs the update and commits the result in one commit:

   ```bash
   sdlc update
   git add -A
   git commit -m "chore: update sdlc files to <version>"
   ```

   The others upgrade their CLI with the same `npm install -g` command. Pin the version in the team's notes so
   everybody runs the same one.

### Check yourself

- `git log -1` shows Steven's setup commit with **no** `SDLC-Agent` trailer.
- On each machine, `sdlc doctor` shows `generated files  49 tracked, 0 missing, 0 edited locally` and the same
  sdlc version.

### Pitfalls

- Commit from your own terminal. A commit made from the agent's shell gets the trailer `SDLC-Agent: claude-code`.
  The audit then counts the commit as agent work.
- `sdlc update --tools …` changes the set of tools. In an agent session, fewer tools or `--no-hooks` count as
  weakening the guard and are refused.
- After an update that changed the hooks, Codex CLI users trust the hooks again in `/hooks`, and Qwen Code users
  check that the folder is still trusted. `sdlc doctor` reminds them.
- `sdlc uninstall` removes the agent files and hooks and keeps `openspec/`. It is a person's command.

### On screen (for the video)

- `git status` before the commit: a long list of new files, grouped by folder.
- Oliver's first Claude Code session: the MCP approval prompt, the session summary, the status line.
- The dry run with the "kept … edited locally" warning; highlight `--force`.

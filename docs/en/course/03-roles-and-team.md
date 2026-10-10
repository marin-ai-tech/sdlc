# Module 3. People and the agent team

This module ties the gates to named people and sets up the agents that do the work. It is for **Steven** (platform
engineer), who writes the configuration, for **Ethan** (tech lead), who accepts the agent roles, and for everyone who
approves a gate.

In this module:

- Lesson 3.1 — `roles.yaml`: people, roles and the gates they approve
- Lesson 3.2 — Who may approve: `roles check`, `roles who`, `next --me` and `--preview`
- Lesson 3.3 — Signed approvals and `sdlc approvals verify`
- Lesson 3.4 — The agent team: sync, drafts and a person's acceptance
- Lesson 3.5 — Roles and skills from the `knowledge` registry and from packs
- Lesson 3.6 — The built-in subagents

The outputs come from a trial run of `tasklet` with sdlc 0.14.4. The `github`, `knowledge` and `telegram` servers
in that run were small local stand-ins with the same tool names, so the answers they gave are simple.

---

## Lesson 3.1 — `roles.yaml`: people, roles and the gates they approve            (video: ~7 min)

**Role:** Steven (writes the files), the whole team (reads them)   **Project:** tasklet
**You need:** sdlc initialized in `tasklet` (Module 1); every person has a git identity with their work email

**Goal.** Write `openspec/roles.yaml` for the Northwind team, connect its roles to the gates in
`openspec/sdlc.yaml`, and check the result with `sdlc roles check`.

### Steps

1. Explain the idea in one sentence. Without `roles.yaml`, anyone with a git identity may approve any gate. With it,
   sdlc reads the git email of the person who runs `sdlc approve`, finds that person in the file, and checks that the
   person holds a role the gate accepts.

2. Steven opens `openspec/sdlc.yaml` in his editor and checks the `gates` section. It names **roles**, not people:

   ```yaml
   gates:
     intent:  { required: true, approvers: [product-owner], overdue_hours: 24 }
     spec:    { required: true, approvers: [product-owner], high_risk_approvers: [tech-lead] }
     plan:    { required: true, approvers: [engineer], high_risk_approvers: [tech-lead] }
     review:  { required: true, approvers: [code-owner] }
     release: { required: true, approvers: [release-manager] }
     verify:  { required: true }
   ```

   | Key | Meaning |
   |---|---|
   | `approvers` | any one of these roles may approve |
   | `high_risk_approvers` | for a change with `risk: high`, **each** of these roles must approve as well |
   | `min_approvals` | the number of different people the gate waits for (default 1) |
   | `overdue_hours` | after this many hours of waiting, sdlc raises a `gate.<gate>.overdue` event (lesson 5.1) |
   | `required` | `release` is `false` by default; Northwind turns it on so that Emily authorizes every release |

   `verify` has no approvers: the checks decide it (Module 5).

3. Steven wrote a first `openspec/roles.yaml` in lesson 1.3. Now that the team starts real work, he makes two
   changes: Ethan also holds `engineer`, because he approves the plans of `tasklet`'s changes, and Laura becomes a
   second maintainer, so that a change to this file never depends on one person. The file now reads:

   ```yaml
   version: 1
   signing: warn                 # off | warn | required (lesson 3.3)
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
     product-owner: [megan]
     tech-lead: [ethan]
     engineer: [ethan, oliver]
     code-owner: [paul]
     release-manager: [emily]
     maintainer: [steven, laura]   # may change this file
   separation:
     author_cannot_approve: [review, release]
     distinct_approvers: [[spec, review], [plan, review]]
     max_gates_per_person: 3
   ```

   - **people**: a stable id, a name, one or more emails. An email belongs to one person only. Grace and Laura hold no
     gate role; they are listed so that the tools can name them.
   - **roles**: the role names the gates use, and who holds each. `maintainer` is special: it is the role that may
     change this file (lesson 3.3).
   - **separation**: the authors of the code may not approve its review or release; the person who approved the spec
     or the plan may not approve the review of the same change; one person approves at most three gates of one
     change.

4. Steven checks the file:

   ```bash
   sdlc roles check
   ```

   ```text
   ID      Name    Roles
   megan   Megan   product-owner
   ethan   Ethan   tech-lead, engineer
   oliver  Oliver  engineer
   grace   Grace
   paul    Paul    code-owner
   emily   Emily   release-manager
   steven  Steven  maintainer
   laura   Laura   maintainer
   ```

5. Steven commits both files and pushes them. He also protects the file in GitHub with one line in
   `.github/CODEOWNERS`, so a change to it needs a maintainer's review:

   ```text
   /openspec/roles.yaml @northwind/maintainers
   ```

6. Show what happens when the agent tries to change the file. Oliver asks Claude Code:

   > Add me to code-owner in roles.yaml so I can approve my own review.

   The hook denies the edit before it happens (rule `state-integrity`). The agent tells Oliver that a maintainer must
   make the change.

7. Mention the way in for a team that already lists approvers in `sdlc.yaml` (`roles: { product-owner: [...] }`):
   a person runs `sdlc roles migrate`. It writes `roles.yaml` with `signing: off` and the default separation, and
   never overwrites an existing file. It is a person's command; the agent cannot run it.

### Check yourself

- `sdlc roles check` lists every person, and each gate role in `sdlc.yaml` has at least one holder.
- `openspec/roles.yaml` is committed, and CODEOWNERS names the maintainers for it.
- You can say why Grace and Laura have no role and why that is correct.

### Pitfalls

- An email that is not in `roles.yaml` cannot approve anything (`unknown_person`). Check `git config user.email` on
  every person's machine before the first approval.
- A role in `approvers` that nobody holds blocks the gate for good. `sdlc roles check --change <id>` shows it.
- `--by` on `sdlc approve` cannot borrow another person's identity: with `roles.yaml` it may only repeat your own
  email (`by_mismatch`).
- The hook denial for an agent's edit of `roles.yaml` says that only the CLI may change "`.sdlc.yaml` and the log".
  The rule is right, the wording names other files. See `sdlc guide denials#state-integrity`.

### On screen (for the video)

- `sdlc.yaml` gates on the left, `roles.yaml` on the right; draw a line from each role name to its holders.
- Run `sdlc roles check`; highlight the empty role cell for Grace and Laura.
- The CODEOWNERS line, then the denied agent edit in Claude Code.

---

## Lesson 3.2 — Who may approve: `roles check`, `roles who`, `next --me` and `--preview`            (video: ~7 min)

**Role:** Megan, Ethan, Paul, Emily (approvers); Oliver (author)   **Project:** tasklet
**You need:** lesson 3.1; a change in progress (`add-due-dates`, Module 5)

**Goal.** Each approver finds what waits for them, sees who else may approve and why, and looks at exactly what
they are about to approve before they approve it.

### Steps

1. Explain the four read-only commands. Anyone may run them, including the agent.

   | Command | Answers |
   |---|---|
   | `sdlc roles check --change <id>` | for every gate of the change: who may approve, who may not and why |
   | `sdlc roles who <gate> --change <id>` | the same for one gate |
   | `sdlc next --me` | every gate, across all active changes, that **you** may decide now, with the command |
   | `sdlc approve <gate> --change <id> --preview` | what you would approve, what changed, and whether you may |

2. The change `add-due-dates` waits for its plan. Ethan opens his own terminal and asks what waits for him:

   ```bash
   sdlc next --me
   ```

   ```text
   Waiting for you (1):
     add-due-dates, gate plan: sdlc approve plan --change add-due-dates --as engineer
   ```

   Oliver also holds `engineer`, so the same line waits for him. Megan, Grace, Steven and Laura see:

   ```text
   Nothing is waiting for you.
   ```

   A person whose email is not in `roles.yaml` sees a clear answer, not an empty list:

   ```text
   guest@example.com is not a person in openspec/roles.yaml, so nothing waits for you.
   ```

3. Later the change reaches review. Paul asks who may approve it:

   ```bash
   sdlc roles who review --change add-due-dates
   ```

   ```text
   review · add-due-dates — may approve: Paul (paul)
     Megan (megan): missing_role — Megan does not hold code-owner; ask Paul.; distinct_approvers — Megan already approved the paired gate spec/review.
     Ethan (ethan): missing_role — Ethan does not hold code-owner; ask Paul.; distinct_approvers — Ethan already approved the paired gate plan/review.
     Oliver (oliver): missing_role — Oliver does not hold code-owner; ask Paul.; author_cannot_approve — Oliver authored code in this change.
     Grace (grace): missing_role — Grace does not hold code-owner; ask Paul.
     Emily (emily): missing_role — Emily does not hold code-owner; ask Paul.
     Steven (steven): missing_role — Steven does not hold code-owner; ask Paul.
     Laura (laura): missing_role — Laura does not hold code-owner; ask Paul.
   ```

   Read the three rule names aloud: `missing_role`, `distinct_approvers`, `author_cannot_approve`. Oliver wrote the
   code, so he may not approve its review even if he held the role.

4. Show the refusal. Oliver tries anyway, in his own terminal:

   ```bash
   sdlc approve review --change add-due-dates
   ```

   ```text
   error: Oliver does not hold code-owner; ask Paul. Oliver authored code in this change.
   fix: Ask one of: Paul.
   ```

5. Before deciding, Paul previews the gate. `--preview` writes nothing:

   ```bash
   sdlc approve review --change add-due-dates --preview
   ```

   ```text
   Approval preview: gate review of change add-due-dates (pending)
   Artifacts:
     review  review.md
   Changed since the last approval: nothing
   Approvals: 0 of 1
   Open blocking findings: 0
   Verification: passed 2026-10-09T21:03:10.898Z, matches the current code
   You may approve it:
   $ sdlc approve review --change add-due-dates
   ```

   When a gate has been approved before and the content changed since, the line "Changed since the last approval"
   lists the files. When something blocks the gate, the preview says "You may not approve it now" and gives the
   reason, for example an open question that has no answer yet.

6. Show `min_approvals` on a busier project. Steven can make a gate wait for two different people:

   ```yaml
   review: { required: true, approvers: [code-owner], min_approvals: 2 }
   ```

   After the first approval, the approver sees `still needed: 1 of 2 approvals`, and `sdlc status` shows the gate
   as `awaiting approval (1 of 2)`. One person approving twice counts once.

### Check yourself

- Each approver runs `sdlc next --me` and sees only their own gates.
- `sdlc roles who review --change <id>` names Paul and explains every other person.
- You ran `--preview` before an approval and read the "Changed since the last approval" line.

### Pitfalls

- `sdlc next --me` lists a gate only when you may decide it **now**. While the intent has an open question,
  Megan's list is empty even though the intent waits for her: `sdlc answer --change <id> --list` shows the questions
  (lesson 5.2).
- `roles who spec` for a medium-risk change also names Ethan, because `tech-lead` is a high-risk approver of the spec.
  For a medium-risk change, only a `product-owner` approval satisfies the gate.
- With `min_approvals: 2`, `sdlc approve review` accepts any two holders of the listed roles. sdlc cannot require
  "one approval from each role" except through `high_risk_approvers` on a high-risk change.

### On screen (for the video)

- Four terminals in a grid (Megan, Ethan, Paul, Emily), each running `sdlc next --me`.
- `sdlc roles who review`: highlight the three rule names in different colours.
- Paul's `--preview`: highlight "Verification: … matches the current code".

---

## Lesson 3.3 — Signed approvals and `sdlc approvals verify`            (video: ~8 min)

**Role:** Steven (setup), every approver (signs), CI   **Project:** tasklet
**You need:** lesson 3.1; git 2.34 or newer; an SSH key per person

**Goal.** Make every approval provable: each approval arrives in a commit signed by the person who gave it, and
every change to `roles.yaml` is signed by a maintainer. Check it locally and in CI.

### Steps

1. Explain the gap that signing closes. A git email is easy to fake: anyone can run
   `git config user.email megan@northwind.example`. A signature made with Megan's private key cannot be faked.

2. Each person sets up SSH signing once on their machine:

   ```bash
   git config gpg.format ssh
   git config user.signingkey ~/.ssh/id_ed25519.pub
   git config commit.gpgsign true
   ```

3. Steven adds each public key to `roles.yaml`. Signing stays in `warn` mode (set in lesson 1.3) until everyone
   signs:

   ```yaml
   signing: warn
   people:
     megan:  { name: Megan,  emails: [megan@northwind.example],  signing_key: "ssh-ed25519 AAAA... megan@northwind" }
     steven: { name: Steven, emails: [steven@northwind.example], signing_key: "ssh-ed25519 AAAA... steven@northwind" }
   ```

   He commits the change signed: `git commit -S -m "chore: signing keys"`.

4. Megan approves the intent of a change in her own terminal. `sdlc approve` prints the commit to make:

   ```text
   ✓ intent gate: Megan <megan@northwind.example> approved as product-owner (b5a9bc0504a1)
   Suggested commit message (its trailer ties the commit to this approval):
     $ git commit -m "chore(export-csv): approve the intent gate" -m "SDLC-Approval: export-csv:intent:b5a9bc0504a1"
   ```

   She stages the change record and commits with `-S` and the suggested message. The `SDLC-Approval` trailer lets
   `sdlc approvals verify` find the commit.

5. Anyone checks the approvals:

   ```bash
   sdlc approvals verify
   ```

   ```text
   ✓ export-csv/intent megan valid 3a9c4294
   ✗ add-due-dates/intent megan unsigned 3be65de2
   ✗ add-due-dates/plan ethan unsigned 874de62d
   ✗ openspec/roles.yaml steven@northwind.example bad-signature de01b076
   ✗ openspec/roles.yaml steven@northwind.example unsigned b202d5d4
   7 approvals checked, 8 invalid (warn: not blocking)
   Sign commits: git config gpg.format ssh; git config user.signingkey <key>; git commit -S
   ```

   (Shortened.) The older approvals were made before signing was on, so they show `unsigned`.

6. Explain the statuses:

   | Status | Meaning |
   |---|---|
   | `valid` | the approval is in a commit signed by the approver's key |
   | `unsigned` | the commit has no signature |
   | `wrong-signer` | signed by someone else, for example Paul signing a commit that claims Megan's approval |
   | `bad-signature` | the signature does not verify against the keys sdlc knows |
   | `not-committed` | the approval record is not in a commit yet |
   | `not-maintainer` | a `roles.yaml` commit signed by someone who was not a maintainer in the version before |

   A change to `roles.yaml` is checked against the maintainers **of the previous version**. Nobody can add
   themselves as a maintainer and sign that commit with their own key.

7. Turn it into a CI check. The mode on the command line overrides the file, so CI can require signatures while
   local work only warns:

   ```bash
   sdlc approvals verify --mode required
   ```

   It exits 1 when any approval is invalid. Steven adds it as a required check on the default branch, together with
   branch protection.

8. When everyone signs, Steven changes `signing: warn` to `signing: required` in `roles.yaml`.

### Check yourself

- `sdlc approvals verify` shows `valid` for an approval you made after the setup.
- `sdlc approvals verify --json` shows `"trailer": "found"` for approvals committed with the suggested message.
- CI fails a pull request whose approval commit is not signed.

### Pitfalls

- The commit that first adds the maintainers' keys cannot be verified: the version before it has no keys, so it
  shows `bad-signature`. Plan this first commit and record why it is expected.
- Commit the change folder after `sdlc archive`. Until the move is committed, every approval of that change shows
  `not-committed`.
- With `signing: off`, `sdlc approvals verify` prints "Approval signing is off." and checks nothing. Use
  `--mode warn` to see the state before you switch it on.
- Signing does not protect against someone who can disable CI. Protect the default branch.

### On screen (for the video)

- A fake `git config user.email` on Oliver's machine, then the same approval failing `approvals verify` as
  `wrong-signer` or `unsigned`: show why an email alone is not proof.
- The status table as an overlay.
- The CI job turning red, then green after a signed commit.

---

## Lesson 3.4 — The agent team: sync, drafts and a person's acceptance            (video: ~7 min)

**Role:** Ethan (accepts), Oliver (asks the agent), Claude Code   **Project:** tasklet
**You need:** lesson 3.1

**Goal.** Give the project five role agents (analyst, architect, developer, tester, reviewer) that know the project's
rules, and accept them as a person.

### Steps

1. Explain what a role is. A role is a short Markdown file in `docs/agents/<role>.md`: front matter (id, title,
   stages, tools, read-only or not) and a body that says how the role works. sdlc turns an **accepted** role into a
   subagent of Claude Code (`.claude/agents/sdlc-<role>.md`) and adds two blocks to it: where the role writes, and
   the facts of this project (verify commands, protected paths, people from `roles.yaml`, documents).

   | Role | Stages | Writes |
   |---|---|---|
   | analyst | plan, design | intent, proposal and spec scenarios |
   | architect | design | `design.md` |
   | developer | build | plan, tasks and code |
   | tester | test | the behavioural table and the verdict in `verification.md` |
   | reviewer | deploy | findings in `review.md` |

2. Oliver asks Claude Code to set up the team:

   > /sdlc:team

   The agent runs `sdlc team sync`, reads the project (for an empty project: the intent of the first change, or it
   asks Oliver for the idea and the stack) and adds a `## Project rules` section to each draft. Every rule names the
   file it comes from. The sync part looks like this (real output, run directly):

   ```bash
   sdlc team sync
   ```

   ```text
   Draft written: docs/agents/drafts/analyst.md
   Draft written: docs/agents/drafts/architect.md
   Draft written: docs/agents/drafts/developer.md
   Draft written: docs/agents/drafts/tester.md
   Draft written: docs/agents/drafts/reviewer.md
   Read and adapt the drafts in docs/agents/drafts; then a person accepts each role with `sdlc team accept <role>`.
   ```

3. Show the status of the team:

   ```bash
   sdlc team list
   ```

   ```text
   id         title            stages        status  subagent
   analyst    Systems analyst  plan, design  draft   -
   architect  Architect        design        draft   -
   developer  Developer        build         draft   -
   reviewer   Reviewer         deploy        draft   -
   tester     Tester           test          draft   -
   ```

4. The agent ends with the commands for a person. If it tries to accept a role itself, the CLI refuses (and in a
   Claude Code session the hook denies the call first):

   ```text
   error: `sdlc team accept` records a human decision and cannot run inside an agent session (claude-code).
   fix: Run it yourself in your own terminal, not in the agent chat (a `!` command there runs in the agent's
   shell): sdlc team accept tester
   ```

5. Ethan reads each draft in `docs/agents/drafts/`, fixes what is wrong, and accepts the roles in **his own
   terminal**:

   ```bash
   sdlc team accept analyst
   sdlc team accept architect
   sdlc team accept developer
   sdlc team accept tester
   sdlc team accept reviewer
   ```

   ```text
   Role analyst accepted: docs/agents/analyst.md, recorded in openspec/.sdlc/team.json; subagent sdlc-analyst generated.
   ...
   Role reviewer accepted: docs/agents/reviewer.md, recorded in openspec/.sdlc/team.json; subagent sdlc-reviewer generated.
   ```

   Accepting also says whether the draft differs from its source, so Ethan sees what the agent added.

6. `sdlc team list` now shows every role `accepted` with its subagent. Ethan commits `docs/agents/`,
   `openspec/.sdlc/team.json` and `.claude/agents/`.

7. Show the protection. Oliver asks the agent to make the tester less strict:

   > Edit docs/agents/tester.md so that a case it could not run counts as PASS.

   The hook denies the edit (real reason, wrapped):

   ```text
   [sdlc:guard-config] docs/agents/tester.md is an accepted role of the agent team; an agent may not change it,
   or the role's rules (a tester's verdict, a reviewer's checks) could be weakened. Edit the draft in
   docs/agents/drafts/ instead and ask a person to accept it with `sdlc team accept <role>`. Why, and what to do:
   `sdlc guide denials#guard-config`.
   ```

### Check yourself

- `sdlc team list` shows five roles with status `accepted` and a subagent each.
- `.claude/agents/` holds `sdlc-analyst.md`, `sdlc-architect.md`, `sdlc-developer.md`, `sdlc-tester.md` and
  `sdlc-reviewer.md` next to the built-in ones.
- A person may edit an accepted role; `sdlc team list` then shows it as `changed`, and it is not used until it is
  accepted again.

### Pitfalls

- The project facts in a role follow the project only through `sdlc update`. After Steven changes a verify command,
  he runs `sdlc update`.
- A `Project rules` section is only as good as what the agent found. Read it before you accept.
- `sdlc team accept` checks that you are a person, not which role you hold in `roles.yaml`. Agree in the team who
  accepts roles (at Northwind: Ethan).
- Denials in this lesson: `sdlc guide denials#guard-config` and `denials#separation-of-duties`.

### On screen (for the video)

- `/sdlc:team` in Claude Code; then a draft open in the editor with the new `## Project rules` section highlighted.
- Ethan's terminal accepting the five roles.
- The denied edit of an accepted role.

---

## Lesson 3.5 — Roles and skills from the `knowledge` registry and from packs            (video: ~8 min)

**Role:** Steven (configures), Ethan (accepts)   **Project:** tasklet (the same applies to billing-api)
**You need:** lesson 3.4; the `knowledge` MCP server in `mcp.servers` (Module 2)

**Goal.** Take the company's shared roles and skills from one place, with versions and checksums, and accept a skill
that carries a script.

### Steps

1. Explain the sources. `sdlc team sync` reads them in this order and fills each role from the first source that has
   it:
   1. the team **registry**: an MCP server with four tools, `list_roles`, `get_role`, `list_skills`, `get_skill`;
   2. **packs**: a git repository or an npm package with `roles/<id>.md` and `skills/<id>/…`;
   3. the **built-in** roles of sdlc.

2. At Northwind the registry is the `knowledge` server that Steven registered in lesson 2.1. He points the team at
   it in `openspec/sdlc.yaml`:

   ```yaml
   mcp:
     servers:
       knowledge:
         type: stdio
         command: [northwind-knowledge-mcp]
         env:
           KNOWLEDGE_TOKEN: "${KNOWLEDGE_TOKEN}"
         stages: [plan, design, build, test, deploy, maintain]
   team:
     registry: knowledge
   ```

   He runs `sdlc mcp check` to see that the server answers with the four registry tools (the trial's stand-in had
   only these four; the real server also offers its documents):

   ```text
   ✓ knowledge (stdio): available, 4 tool(s)
       list_roles, get_role, list_skills, get_skill
   ```

3. Packs, when there is no registry server. Steven can add them to the same file:

   ```yaml
   packs:
     - { name: northwind, git: https://git.northwind.example/sdlc-pack.git, ref: v1.2.0 }
     - { name: northwind-npm, npm: "@northwind/sdlc-pack@1.2.0" }
   ```

   - Pin the version: a tag or a commit for git, an exact version for npm.
   - An `npm:` pack is a registry package or a `.tgz` file (a path or an `https://` URL). A folder or a repository is
     refused for `npm:`, because npm runs a package's `prepare` script for those even with `--ignore-scripts`. Put a
     repository in a `git:` pack.
   - No code of a pack runs: no git hooks or submodules, no npm scripts.
   - An unreachable pack is reported, and sync goes on with the next source.

4. Run the sync. The team already accepted the five built-in roles in lesson 3.4. The registry has a company tester
   (version 2.1.0) that needs the skill `api-smoke-test`:

   ```bash
   sdlc team sync
   ```

   ```text
   Roles from the team registry knowledge: 1
   Draft written: docs/agents/drafts/tester.md
   analyst: already accepted, left as it is
   architect: already accepted, left as it is
   developer: already accepted, left as it is
   reviewer: already accepted, left as it is
   ```

   The registry tester arrives as a **draft** next to the accepted built-in tester; nothing is replaced yet. The draft
   records where it came from (`source: kind: registry`, the server, the version and the checksum). A role whose
   checksum does not match is refused. In a new project with no accepted roles, the same sync writes the registry
   tester and the four built-in roles as drafts.

5. Ethan reads the draft and accepts the registry tester in his own terminal. It replaces the built-in tester. The role
   lists a skill with a script, so the skill waits:

   ```bash
   sdlc team accept tester
   ```

   ```text
   Role tester accepted: docs/agents/tester.md, recorded in openspec/.sdlc/team.json; subagent sdlc-tester generated.
   Skill api-smoke-test has files that are not Markdown (scripts/smoke.sh); it is installed only when a person runs `sdlc team accept --skill api-smoke-test`.
   ```

6. Before accepting the skill, Ethan vets it. `sdlc team check` is read-only:

   ```bash
   sdlc team check
   ```

   ```text
   api-smoke-test 1.0.0 (registry): not installed: waits for a person (`sdlc team accept --skill api-smoke-test`)
     scripts: scripts/smoke.sh
     URLs: http://localhost:3000/health
   ```

   `team check` lists for each skill its source and version, whether the checksum matches, its scripts, the URLs
   inside, and the tools it allows, with a warning when they grant unrestricted shell or file writes.

7. Ethan reads `scripts/smoke.sh`, then accepts the skill:

   ```bash
   sdlc team accept --skill api-smoke-test
   ```

   ```text
   Skill api-smoke-test 1.0.0 accepted and installed in .claude/skills/api-smoke-test; recorded in openspec/.sdlc/team.json.
   Its scripts, now available to the agents: scripts/smoke.sh
   ```

   `sdlc team check` now says `installed, files as checked`.

8. Explain updates. Step 4 already showed the rule: when the registry publishes tester 2.2.0, the next
   `sdlc team sync` writes it as a draft next to the accepted 2.1.0. An accepted role is never replaced silently; a
   person accepts the new version.

### Check yourself

- `sdlc team list` shows `Tester (Northwind)` as accepted.
- `sdlc team check` shows `api-smoke-test` as installed, with its script listed.
- `openspec/.sdlc/team.json` records the registry, the version and the checksum of the tester.

### Pitfalls

- A checksum proves that the content did not change on the way, not that it is good. Take roles and skills only from
  sources the team trusts, and read the scripts.
- `sdlc team list` does not show that a newer draft waits next to an accepted role. Look in `docs/agents/drafts/`
  after each sync.
- `team.registry` must name a server of `mcp.servers`; otherwise `sdlc.yaml` does not load (`invalid_config`).
- Never put a literal token in `env` or `headers`; use `${KNOWLEDGE_TOKEN}`. sdlc refuses a literal
  (`mcp_secret_literal`).

### On screen (for the video)

- The order of sources as three stacked boxes: registry, packs, built-ins.
- The draft's front matter with the `source` block highlighted.
- `sdlc team check` before and after `accept --skill`.

---

## Lesson 3.6 — The built-in subagents            (video: ~5 min)

**Role:** Oliver, Ethan, Steven   **Project:** tasklet   **You need:** lesson 3.4

**Goal.** Know the six subagents that come with sdlc, which workflow calls each, and how the accepted team roles take
the place of two of them.

### Steps

1. Open `.claude/agents/`. `sdlc init` writes six subagents there. They run in a fresh context, so their verdict is
   not shaped by the conversation that produced the code.

   | Subagent | What it does | Called by | Can edit |
   |---|---|---|---|
   | `sdlc-verifier` | runs the app and the tests, exercises every spec scenario and the nearest flows, reports evidence and mismatches; fixes nothing | `/sdlc:verify` | no |
   | `sdlc-reviewer` | reviews one pass or lens at a time and records findings with severity, evidence and a fix | `/sdlc:review` | no |
   | `sdlc-researcher` | answers a focused question about the code, specs and history, concisely | `/sdlc:explore`, `/sdlc:spec`, `/sdlc:plan`, `/sdlc:team` | no |
   | `sdlc-simplifier` | removes needless complexity from green code without changing behaviour | no workflow calls it by itself; list it for the build stage (step 4) or ask for it by name | yes |
   | `sdlc-advocate` | argues one side of a key design decision for the debate lens | `/sdlc:spec` with `design: { debate: true }` | no |
   | `sdlc-health` | digs into one finding of `sdlc health` and reports the evidence | `/sdlc:health` | no |

2. Show the replacement. When the team accepts its own **tester** and **reviewer** (lessons 3.4 and 3.5), the verify
   and review workflows call `sdlc-tester` and the accepted `sdlc-reviewer` instead of the built-ins. The generated
   verify workflow in `tasklet` says:

   ```text
   3. **Independent verification.** Delegate to the `sdlc-tester` subagent with the change id. ...
   ```

   If a person edits an accepted role and has not accepted it again, the workflows fall back to the built-ins.

3. Show the debate lens. Steven turns it on in `openspec/sdlc.yaml` for decisions with a lot at stake:

   ```yaml
   design: { debate: true }    # debate_sides: [simplicity and speed, robustness and safety]
   ```

   The spec workflow then asks two `sdlc-advocate` subagents to argue the key decision, writes `## Debate` into
   `design.md`, and asks a person to decide. The spec gate waits for that decision.

4. Show how to give a stage its own subagents and skills:

   ```yaml
   stages:
     design: { agents: [sdlc-researcher] }
     build:  { skills: [test-driven-development], agents: [sdlc-simplifier] }
   ```

   Each generated workflow ends with a short **Stage resources** section that lists its stage's subagents, skills and
   MCP servers, for example in `/sdlc:verify`:

   ```text
   ## Stage resources (test)

   - Subagents for this stage: `sdlc-tester`.
   - MCP servers for this stage: `github` (tools `mcp__github__*`), `knowledge` (tools `mcp__knowledge__*`).
   - Other skills, subagents and MCP servers of the project are not for this stage.
   ```

5. Show the protection. The generated `sdlc-*` files are part of the guard. An agent's edit of
   `.claude/agents/sdlc-verifier.md` is denied (rule `guard-config`); `sdlc update` restores a changed file.

### Check yourself

- You can name the subagent that `/sdlc:verify` calls in `tasklet` (`sdlc-tester`, because the team accepted a
  tester) and the one it would call without it (`sdlc-verifier`).
- After `sdlc update`, `.claude/agents/` still holds the six built-ins and the five team roles.

### Pitfalls

- The read-only subagents have no Edit or Write tools. Asking the verifier to "just fix it" will not work, by design.
- `stages.<stage>` is guidance in the workflow text. MCP servers outside their `stages` are also enforced by the hook
  (`sdlc guide denials#mcp-stage`); skills and subagents are not.

### On screen (for the video)

- The `.claude/agents/` folder; open the front matter of `sdlc-verifier.md` and `sdlc-tester.md` side by side.
- The "Stage resources" section at the end of a workflow.

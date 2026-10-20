# 20. Example: a newcomer learns sdlc from its hints

On October 16, 2026, Evan Turner joins the team from the [from-scratch example](19-team-greenfield-example.md).
Their plain JavaScript TodoMVC project has reached release 1.0.0. Evan is new to sdlc. Follow his first feature from
backlog item to release using the CLI's hints and a Qwen Code agent.

## On this page

- [Meet the team](#201-the-team)
- [Add Evan](#202-linda-adds-evan)
- [Prepare a working copy](#203-evan-prepares-his-working-copy)
- [Use the tour](#204-the-tour-and-the-help-in-the-terminal)
- [Make a first approval](#205-the-first-approval)
- [Follow the feature](#206-from-a-backlog-item-to-release)
- [See where the agent stopped](#207-where-the-agent-stopped-on-its-own)
- [Read the audit](#208-the-result-in-the-audit)
- [Lessons](#209-lessons-for-a-team)
- [Terms](#terms)
- [See also](#see-also)

## 20.1. The team

Evan joins these people and their existing approval roles.

| Person | sdlc roles | Does |
|---|---|---|
| Linda Carter | tech-lead, maintainer, release-manager, code-owner | adds Evan, review, release |
| Peter Owen | product-owner | adds the title-length item, the intent and spec gates |
| David Smith | engineer | the plan gate for Evan, his own documentation change |
| Olivia Miller | qa | checks in a browser, the qa gate |
| Evan Turner | engineer | the newcomer: title-length feature with an agent |

## 20.2. Linda adds Evan

Linda registers Evan as an engineer before he makes a gate decision.

Linda updated sdlc in the project (`sdlc update`) and added Evan to `openspec/roles.yaml`, to the people and to the
engineer role:

```yaml
people:
  evan: { name: Evan Turner, emails: [evan@todo.example] }
roles:
  engineer:        [david, kate, evan]
```

One commit, push. The roles file is protected: agents do not change it, only people do.

## 20.3. Evan prepares his working copy

Evan clones the project and checks its hooks before using his agent.

```bash
git clone <shared repository> evan
npm install
sdlc doctor
sdlc doctor --fix
```

`sdlc doctor` warned that the git hook is not installed (hooks are not cloned); `sdlc doctor --fix` installed it and
the tree stayed clean. The `qwen` row of `doctor` shows that the project's hooks and denials apply to the agent.

## 20.4. The tour and the help in the terminal

The CLI tour gives Evan a short route through the process.

```bash
sdlc guide tour
sdlc guide tour 2
sdlc guide lifecycle
```

The tour is seven short steps; each ends with a pointer to the next one, for example "Next: sdlc guide tour 2 (…)".
In the terminal it is plain text without markup. Every command the tour names exists: `sdlc <command> --help` exits
without an error for each of them.

Then Evan asked his agent `/sdlc-guide` how to take a backlog item to release and who approves what. He checked the
answer against what sdlc itself says, and that is how he ran the feature from then on: `sdlc next` and `sdlc
explain` at every step.

## 20.5. The first approval

Evan starts by reading and approving a colleague's plan.

David opened a small documentation change `readme-run` on the lite track, and its plan was waiting for an engineer.
Evan read the plan and approved it in his own clone:

```bash
sdlc approve plan --change readme-run
git commit -am "chore(readme-run): approve the plan gate" -m "SDLC-Approval: …"
git push
```

`sdlc approve` prints the `SDLC-Approval` trailer itself; the approval is bound to the plan's content.

## 20.6. From a backlog item to release

Evan uses `sdlc next` and `sdlc explain` to follow each stage of his first feature.

Peter added the item:

```bash
sdlc backlog add "Task title at most 200 characters" --epic E1 --risk low \
  --outcome "Overlong titles do not break the list" \
  --accept "A title longer than 200 characters is cut to 200 when added" \
  --accept "A title longer than 200 characters is cut to 200 when edited" \
  --accept "A title of exactly 200 characters is kept unchanged"
```

`sdlc next` for Evan: `Start backlog item B4 — sdlc backlog start B4`. Evan's agent started the item with
`/sdlc-next` on the branch `feat/b4-length`; the change got the id `200`. From then on `sdlc explain` named, at every
step, the stage, the open gate, who it waits for (by name from `roles.yaml`) and the command for that person.

| Step | Who | What happened |
|---|---|---|
| intent | Evan's agent, Peter | an intent from the three criteria; Peter approved it after 19 minutes |
| spec | Evan's agent | the delta spec added requirements beyond the item. |
| spec gate | Peter | `sdlc reject spec --note "Only the three B4 criteria …"`; the second version approved |
| plan | Evan's agent | the plan refuses an overlong title with an error, while the item asks to cut it |
| plan gate | David (engineer) | `sdlc reject plan`; the tests must cover cutting titles. |
| rework | Peter | `sdlc rework spec --change 200 --reason wrong-assumption --note "…"` |
| build, verify | Evan's agent | tests first: 14 passed, 2 failed; after the code 16 of 16, `sdlc verify` passed |
| qa gate | Olivia (qa) | browser checks passed; approved |
| review, release | Linda | review, `approve release`, merge into `main`, `sdlc archive 200 --yes` |

The delta spec had added trimming while typing, an interface hint, `localStorage` errors and compatibility. David
wanted titles over 200 characters cut, with tests for `add` and `update` at 201+ and exactly 200 characters. The
approved spec caused the wrong plan. After Peter's rework, the agent fixed both artifacts and both were approved
again. Olivia checked 242 characters on add → 200, an edit to 230 → 200 and exactly 200 unchanged.

After the archive, the item became `done` and the epic reached 4 of 5.

## 20.7. Where the agent stopped on its own

The agent explained why it could not start coding or approve an intent for Evan.

At the intent stage Evan asked his agent: "let's start coding right away, and if it refuses, explain why; can you
approve the intent yourself?". The agent did not write code: the plan is not approved, and the `plan-gate` rule
closes code writes until then. It explained this from `sdlc guide denials#plan-gate`, named Peter as the person who
approves the intent, gave the command for his terminal, and refused to approve: people make gate decisions, and
`sdlc approve` refuses inside an agent's environment.

## 20.8. The result in the audit

The audit shows the rework and the repeated spec approval.

The `200` line of `sdlc audit`:

```text
200: gates intent, spec, plan, qa, review, release; approvals 6 / 7; reworks 1, takeovers 0, waivers 0, answers 0; waits 0.4 h
```

Six gates, six decisions; the seventh approval is the second spec approval after the rework.

## 20.9. Lessons for a team

These steps helped Evan learn the process while doing a real change.

- **A newcomer to an existing project:** clone, `npm install`, `sdlc doctor`, `sdlc doctor --fix`, the agent's row
  in `doctor`, an entry in `roles.yaml` from the tech-lead, then `sdlc guide tour`.
- **sdlc's hints are the source of truth.** `sdlc next` says what to do, `sdlc explain` says why and who it waits
  for; check the agent's answers about the process against them.
- **The first approval is someone else's.** Approving a colleague's plan teaches reading the artifacts before your own
  gate.
- **A mistake in an approved artifact is sent back, not worked around.** `sdlc rework <gate> --reason` records the
  reason; it shows in the audit and in the project's health.
- **Gate decisions belong to people.** The agent explains a denial and names the person, but does not approve.

## Terms

- [Gate](glossary.md#-eh): a decision point before work advances.
- [Rework](glossary.md#-rw): a person's decision to send an artifact back for revision.
- [Track](glossary.md#-rw): a configured path through gates.

## See also

- [Build an application from scratch](19-team-greenfield-example.md) for the project Evan joins.
- [Tracks and decisions](23-tracks-and-decisions-example.md) for more human gate decisions.

---
title: Questions people ask
summary: Short answers to the questions that come up most.
---
# Questions people ask

**I typed "approve" in the chat. Why is the gate still waiting?**
An answer in the chat is never an approval. Run `sdlc approve <gate> --change <id>` in your own terminal.

**Can I run the approval as `!sdlc approve …` in the agent chat?**
No: a `!` command runs in the agent's shell, so the CLI treats it as the agent's and refuses.

**The gate says "stale". What happened?**
An approved artifact (or, for review and release, the code) changed after the approval. Look with
`sdlc approve <gate> --change <id> --preview`, then approve again.

**Verification was green, now it is stale.**
The code changed after `sdlc verify`. Committing does not make it stale; editing does. Run `sdlc verify` again.

**What is waiting for me?**
`sdlc next --me`.

**Who should review this?**
`sdlc review suggest --change <id>`.

**How do I skip intent and spec for a small fix?**
The lite track: `sdlc track set lite --change <id>` (a person's decision; `sdlc guide tracks`).

**The agent did something wrong in an earlier stage.**
`sdlc rework <gate> --change <id> --reason <category> --note "…"` (`sdlc guide rework`).

**I want to fix it myself without the agent interfering.**
`sdlc takeover --change <id> --note "…"`, and `sdlc release-control` when you are done.

**The hook keeps saying no.**
Read the rule in brackets and `sdlc guide denials`. To relax the process rules for a while, a person can set
`enforcement.mode: warn` in `openspec/sdlc.yaml`.

**Is everything installed correctly?**
`sdlc doctor`.

**Where is the history of decisions?**
`sdlc audit --change <id>`, `sdlc log`, and `sdlc trace <id>` from intent to evidence. The audit also compares the
people's decisions the track planned with what happened (approvals, reworks, takeovers, waivers, answers, waits).

**I am new. Where do I start?**
`sdlc guide tour`: seven short steps through the calculator demo.

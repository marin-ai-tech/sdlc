# 9. The calculator demo and keeping the dashboard current

## 9.1. The demo: a calculator built with every command

`test/e2e-calculator.test.ts` is both an acceptance test and the script of the demo. A team of three builds a till calculator with AI agents:

- **Alice**: product owner, release manager, maintainer of `roles.yaml`;
- **Bob**: engineer and tech lead, who writes the code;
- **Carol**: engineer and code owner, who reviews it.

The scenario covers every step of the product:

- **Setup**: `init` for both tools, `doctor`, `license`, `help`, the `layout` commands, `update`.
- **Roles**: `roles.yaml` with signing in `warn` mode.
- **Planning**: exploration; a backlog with an epic, dependencies and priorities.
- **The change**: a change started from a backlog item, then the gates with the right people. Bob is refused as product owner and as the author of the code he would review. Next come verification with evidence, a review with lenses and a deferred finding, the release, `approvals verify` and the archive.
- **Other flows**: a bug fix with locked tests, a rejected idea, a waiver, closing deferred work and a backlog item, and a BMAD import.
- **Visibility**: `status`, `report`, `dashboard`, `audit`, `log`, `statusline`, the session hook, the plugin and `uninstall`.

The test fails if any CLI command is missing from the story.

Each step is recorded with who ran it, the command, the exit code, an excerpt of the output and a note. The deck is built from that transcript:

```bash
npm run demo:deck                  # runs the scenario, then builds the English and Russian decks
node scripts/demo/build-deck.mjs --transcript docs/demo/calculator-transcript.json --lang en --out deck.pptx
```

The story (which steps each slide shows, the words in English and Russian) is in `scripts/demo/deck-content.mjs`; `scripts/demo/build-deck.mjs` renders it with pptxgenjs. The English deck is `docs/demo/scdl-calculator-demo.en.pptx`.

## 9.2. A background process that keeps the dashboard current

`sdlc dashboard --out reports/dashboard.html` writes one self-contained page. `scripts/examples/dashboard-watch.mjs` keeps it current: it watches `openspec/` and rebuilds the page after changes. Rebuilds are debounced, never run two at a time and are spaced by a minimum interval. The script can also serve the page on localhost with an auto-refresh.

```bash
node scripts/examples/dashboard-watch.mjs --once                     # build once
node scripts/examples/dashboard-watch.mjs                            # watch and rebuild
node scripts/examples/dashboard-watch.mjs --serve 127.0.0.1:8123     # and serve with auto-refresh
node scripts/examples/dashboard-watch.mjs --cli "npx sdlc" --debounce 2000 --min-interval 10000
```

[`scripts/examples/README.md`](../../scripts/examples/README.md) shows how to run it in the background:

- as a Windows Task Scheduler task (`register-dashboard-task.ps1`);
- as a `systemd --user` service;
- as a `launchd` agent;
- as a CI step that keeps the page as a build artifact.

Everything stays local; nothing is published.

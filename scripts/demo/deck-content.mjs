/** English story content. Other language modules are installed in scripts/demo/lang at run time. */
export const LANGS = ['en'];
export const ROLES = {
  "alice": [
    "product-owner",
    "release-manager",
    "maintainer"
  ],
  "bob": [
    "engineer",
    "tech-lead",
    "code-owner"
  ],
  "carol": [
    "engineer",
    "code-owner"
  ],
  "agent": []
};
export const ACTOR_LABEL = {
  "alice": {
    "en": "Alice · product owner"
  },
  "bob": {
    "en": "Bob · engineer"
  },
  "carol": {
    "en": "Carol · reviewer"
  },
  "agent": {
    "en": "AI agent"
  }
};
export const STAGES = [
  "explore",
  "backlog",
  "intent",
  "spec",
  "plan",
  "build",
  "verify",
  "review",
  "release",
  "archive"
];
export const STAGE_LABEL = {
  "explore": {
    "en": "Explore"
  },
  "backlog": {
    "en": "Backlog"
  },
  "intent": {
    "en": "Intent"
  },
  "spec": {
    "en": "Spec"
  },
  "plan": {
    "en": "Plan"
  },
  "build": {
    "en": "Build"
  },
  "verify": {
    "en": "Verify"
  },
  "review": {
    "en": "Review"
  },
  "release": {
    "en": "Release"
  },
  "archive": {
    "en": "Archive"
  }
};
export const SLIDES = [
  {
    "id": "cover",
    "layout": "title",
    "title": {
      "en": "Building a calculator with sdlc"
    },
    "subtitle": {
      "en": "Every command of the SDLC harness, on one small real project. People decide, agents do the work."
    },
    "notes": {
      "en": "A three-person team builds a till calculator with AI agents. Everything shown was produced by an automated end-to-end test, so the outputs are real."
    }
  },
  {
    "id": "team",
    "layout": "people",
    "title": {
      "en": "The team and who may approve what"
    },
    "lead": {
      "en": "Roles live in openspec/roles.yaml, versioned in git. The file names people, their emails and signing keys, and the separation rules."
    },
    "steps": [
      "roles-check",
      "roles-migrate"
    ],
    "notes": {
      "en": "Separation rules: the author of the code does not approve its review or release; spec and review, plan and review need different people; at most three gates per person. An agent cannot edit the file."
    }
  },
  {
    "id": "map",
    "layout": "flow",
    "highlight": [
      "explore",
      "backlog",
      "intent",
      "spec",
      "plan",
      "build",
      "verify",
      "review",
      "release",
      "archive"
    ],
    "layer": {
      "en": "Spec layer: OpenSpec (changes, delta specs, validation, living specs). sdlc adds the people, gates, evidence and guardrails around it."
    },
    "groups": [
      {
        "from": "explore",
        "to": "backlog",
        "label": {
          "en": "Idea"
        },
        "text": {
          "en": "Research the idea, then plan it as backlog items with an outcome and acceptance criteria."
        }
      },
      {
        "from": "intent",
        "to": "review",
        "label": {
          "en": "Gates approved by people"
        },
        "text": {
          "en": "Agents write intent, spec, plan, code, evidence and review; a person with the right role approves each."
        }
      },
      {
        "from": "release",
        "to": "archive",
        "label": {
          "en": "Release"
        },
        "text": {
          "en": "The release manager authorises; the delta merges into the living spec."
        }
      }
    ],
    "title": {
      "en": "The path of a change"
    },
    "lead": {
      "en": "An idea is explored, lands in the backlog, becomes a change and passes gates. Each gate is approved by a person, bound to the exact content."
    },
    "notes": {
      "en": "If an approved artifact changes, the approval goes stale and must be given again."
    }
  },
  {
    "id": "setup",
    "layout": "steps",
    "title": {
      "en": "Setup: one command, two tools"
    },
    "lead": {
      "en": "Alice installs sdlc for Claude Code and OpenCode; an agent makes the repository AI-ready."
    },
    "steps": [
      "init",
      "layout-check",
      "layout-scaffold"
    ],
    "more": [
      "doctor",
      "health",
      "license",
      "help",
      "guide",
      "layout-adapt",
      "layout-convert",
      "adopt",
      "adopt-apply-agent",
      "update"
    ]
  },
  {
    "id": "explore",
    "layout": "steps",
    "title": {
      "en": "Explore before committing"
    },
    "lead": {
      "en": "Does the till need its own calculator? The agent researches and writes a recommendation; nothing is decided yet."
    },
    "steps": [
      "explore",
      "explore-list"
    ]
  },
  {
    "id": "backlog",
    "layout": "steps",
    "title": {
      "en": "The backlog: agents propose, people prioritise"
    },
    "lead": {
      "en": "Items carry an outcome, acceptance criteria and dependencies. Moving and dropping items is a product decision."
    },
    "steps": [
      "add-b1",
      "move-agent",
      "list"
    ],
    "more": [
      "epic-add",
      "epic-edit",
      "add-b2",
      "add-b3",
      "move",
      "add-b4",
      "edit-b4",
      "drop",
      "backlog-next"
    ]
  },
  {
    "id": "start",
    "layout": "steps",
    "title": {
      "en": "From item to change"
    },
    "lead": {
      "en": "`next` points at the ready item; the change starts with a draft intent. The track is suggested, but only a person may choose it."
    },
    "steps": [
      "next-empty",
      "start",
      "status"
    ],
    "more": [
      "track-agent",
      "instructions",
      "takeover",
      "release-control"
    ]
  },
  {
    "id": "gates",
    "layout": "steps",
    "title": {
      "en": "Gates: the right person, or no one"
    },
    "lead": {
      "en": "The agent cannot approve. Bob is not the product owner. Alice approves the intent and the spec; Bob, the engineer, the plan."
    },
    "steps": [
      "approve-intent-agent",
      "approve-intent-bob",
      "answer",
      "approve-intent"
    ],
    "more": [
      "approve-spec",
      "approve-plan",
      "rework",
      "explain",
      "judge",
      "approve-spec-again",
      "approve-plan-again"
    ]
  },
  {
    "id": "openspec-change",
    "layout": "steps",
    "title": {
      "en": "OpenSpec underneath: the change is an OpenSpec change"
    },
    "lead": {
      "en": "sdlc does not fork OpenSpec. The change lives in openspec/changes and OpenSpec reads it as its own: list, status, deltas."
    },
    "steps": [
      "os-list",
      "os-status",
      "os-show"
    ],
    "notes": {
      "en": "OpenSpec does the spec work through its JSON CLI: changes, artifact instructions, validation and the delta merge on archive. /opsx:* commands keep working on the same folder."
    }
  },
  {
    "id": "openspec-validate",
    "layout": "steps",
    "title": {
      "en": "Delta specs and strict validation"
    },
    "lead": {
      "en": "Requirements change as deltas (ADDED, MODIFIED, REMOVED). A requirement without a scenario is refused before anyone approves the spec."
    },
    "steps": [
      "validate-bad",
      "validate",
      "os-schema"
    ],
    "notes": {
      "en": "sdlc validate runs openspec validate --strict and adds checks OpenSpec lacks: delta targets exist, ADDED does not collide, overlaps between open changes."
    }
  },
  {
    "id": "build",
    "layout": "steps",
    "highlight": [
      "build",
      "verify"
    ],
    "title": {
      "en": "Build and verify with evidence"
    },
    "lead": {
      "en": "Bob writes the code on a branch. `verify` runs the real checks and records the evidence; every spec scenario needs a row."
    },
    "steps": [
      "verify",
      "verify-check"
    ]
  },
  {
    "id": "review",
    "layout": "steps",
    "title": {
      "en": "Review: lenses, a deferred finding, and not your own code"
    },
    "lead": {
      "en": "Every pass and lens is covered or says what was checked. One finding is deferred to the registry. Bob wrote the code, so Carol approves."
    },
    "steps": [
      "roles-who",
      "approve-review-bob",
      "approve-review"
    ],
    "more": [
      "review-context",
      "defer",
      "review-check",
      "defer-list"
    ]
  },
  {
    "id": "release",
    "layout": "steps",
    "title": {
      "en": "Release and signed approvals"
    },
    "lead": {
      "en": "Alice authorises the release. Every approval is checked against the commit that brought it: signed by the person who approved."
    },
    "steps": [
      "approve-release",
      "approvals-verify"
    ],
    "more": [
      "changelog",
      "release-check"
    ],
    "notes": {
      "en": "Signing modes: off (no signatures), warn (report), required (CI fails). A commit signed by Bob with Alice's email is reported as wrong-signer."
    }
  },
  {
    "id": "openspec-living",
    "layout": "steps",
    "title": {
      "en": "Archive: the delta becomes the living spec"
    },
    "lead": {
      "en": "sdlc archive re-checks the gates, then OpenSpec merges the delta into openspec/specs. The requirement now lives in the spec; B1 closes."
    },
    "steps": [
      "archive",
      "openspec",
      "os-spec-show"
    ],
    "more": [
      "trace",
      "list-after"
    ]
  },
  {
    "id": "safety",
    "layout": "refusals",
    "title": {
      "en": "Safety nets: what agents cannot do"
    },
    "lead": {
      "en": "Every refusal in the demo, with the reason the CLI gave. Decisions stay with people and are recorded."
    }
  },
  {
    "id": "bugfix",
    "layout": "steps",
    "title": {
      "en": "A bug fix, a rejected idea, a waiver"
    },
    "lead": {
      "en": "Bug fixes go on the lite track with tests locked first. Alice rejects voice input with a reason and waives the release step for an internal fix."
    },
    "steps": [
      "tests-lock",
      "reject",
      "waive"
    ],
    "more": [
      "new-fix",
      "track",
      "tests-unlock-agent",
      "tests-unlock",
      "new-idea",
      "defer-close",
      "backlog-done"
    ]
  },
  {
    "id": "bmad",
    "layout": "steps",
    "title": {
      "en": "BMAD planning comes in as backlog items"
    },
    "lead": {
      "en": "An epic and its tickets from BMAD-METHOD become backlog items with their dependencies."
    },
    "steps": [
      "import"
    ]
  },
  {
    "id": "visibility",
    "layout": "steps",
    "title": {
      "en": "The whole picture, always current"
    },
    "lead": {
      "en": "Status, a report with diagrams, an offline dashboard, metrics and a log. A background script keeps the dashboard page fresh."
    },
    "steps": [
      "status-all",
      "audit",
      "log"
    ],
    "more": [
      "status-md",
      "report",
      "dashboard",
      "statusline",
      "hook",
      "plugin",
      "ci-init",
      "uninstall"
    ],
    "notes": {
      "en": "scripts/examples/dashboard-watch.mjs watches openspec/ and rebuilds reports/dashboard.html; examples run it as a Windows task, a systemd or launchd service, or a CI step."
    }
  },
  {
    "id": "integrations",
    "layout": "steps",
    "title": {
      "en": "Other AI systems, over MCP"
    },
    "lead": {
      "en": "Other systems read the process over MCP; sdlc calls their servers itself. CI status becomes gate evidence, and results wait in the agent inbox."
    },
    "steps": [
      "mcp-check",
      "verify-mcp",
      "inbox-list"
    ],
    "more": [
      "inbox-done",
      "events-list",
      "events-flush",
      "events-summary",
      "triage-intake",
      "mcp",
      "context-pull"
    ],
    "notes": {
      "en": "No decision is offered over MCP. The registry lives in openspec/sdlc.yaml with secrets as ${VAR} references; the hook allows each server only at its stages. Chapter 10 of the docs has the user cases."
    }
  },
  {
    "id": "coverage",
    "layout": "coverage",
    "title": {
      "en": "Every command, one scenario"
    },
    "lead": {
      "en": "The demo is an acceptance test: it fails if a command is missing from the story."
    }
  },
  {
    "id": "why",
    "layout": "closing",
    "title": {
      "en": "Why sdlc: almost nothing to run"
    },
    "points": {
      "en": [
        "Node.js, git and the agent you already use, plus one package from the GitHub release.",
        "No server, database, container or cloud account: the state is files in git.",
        "Simple: sdlc init sets a project up, sdlc next names the next step and who acts.",
        "Console first: decisions in a person's terminal, --json for agents and CI."
      ]
    },
    "reproduce": [
      "npm install -g https://github.com/marin-ai-tech/sdlc/releases/latest/download/sdlc.tgz",
      "sdlc init"
    ],
    "notes": {
      "en": "There is nothing to host and nothing to sign in to. The audit, the report and the dashboard are built from the files in the repository and work offline. The same commands run on a laptop, over SSH and in a CI job."
    }
  },
  {
    "id": "cost",
    "layout": "closing",
    "title": {
      "en": "What skipping the rules cost"
    },
    "points": {
      "en": [
        "One release shipped six changes in one batch, with no tests first and no review before it.",
        "The review afterwards found 18 important findings, two of them security.",
        "The bill: a fix right after the release and three follow-up changes.",
        "With the gates, review finds such defects before the release, not users."
      ]
    },
    "notes": {
      "en": "A real case from one of our releases. The gates were approved after the fact, against code that had already shipped. Examples: an agent could switch off the check that blocks its stop, and a project opened through a linked folder could not approve anything. Changes made by the rules get review findings too; the difference is that they surface before the release."
    }
  },
  {
    "id": "closing",
    "layout": "closing",
    "title": {
      "en": "People decide. Agents do. Git remembers."
    },
    "points": {
      "en": [
        "Approvals come from people in roles.yaml, bound to content, optionally signed.",
        "Nobody pushes through their own work: authors do not approve their review or release.",
        "Everything is files in the repository: backlog, specs, evidence, decisions."
      ]
    },
    "reproduce": [
      "npx vitest run test/e2e-calculator.test.ts",
      "npm run demo:deck"
    ]
  }
];

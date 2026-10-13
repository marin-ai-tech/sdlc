import * as fs from 'node:fs';
import * as path from 'node:path';
import { write } from './helpers.js';

/** A small change that reaches the verify gate: intent, spec and plan files, a test and the code (0.18.0). */

export const FILES: Record<string, string> = {
  'intent.md': ['# Intent: say goodbye', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem',
    'Sessions end without a goodbye.', '', '## Proposed outcome', 'Users see a named farewell.', '',
    '## Affected users and systems', 'All users.', '', '## Constraints', 'None', '', '## Success measures',
    'Shown on sign-out.', '', '## Out of scope', 'Localization.', '', '## Open questions', 'None', ''].join('\n'),
  'proposal.md': ['# Proposal', '', '## Why', '',
    'Sessions end abruptly because users never see a farewell message that uses their name.', '',
    '## What Changes', '', '- Add farewell(name).', '', '## Capabilities', '', '### New Capabilities',
    '- `greeting`: greeting and farewell messages', '', '## Impact', '', 'src/greet.js', ''].join('\n'),
  'specs/greeting/spec.md': ['# Spec Delta', '', '## Purpose', '',
    'Provide friendly, personalized greeting and farewell messages to users.', '', '## ADDED Requirements', '',
    '### Requirement: Farewell message', "The system SHALL produce a farewell message that includes the user's name.",
    '', '#### Scenario: Named farewell', '- **WHEN** Ada signs out', '- **THEN** the message is "Goodbye, Ada"',
    ''].join('\n'),
  'design.md': ['# Design', '', '## Context', 'src/greet.js', '', '## Decisions', 'Add farewell next to greet.', '',
    '## Policy compliance', 'None apply.', '', '## Areas of concern', 'None identified', ''].join('\n'),
  'plan.md': ['# Plan', '', '## Files that change', '- `src/greet.js` (modified)', '- `test/greet.test.js` (new)',
    '', '## Order of work', '1. Test. 2. Implement.', '', '## Proof', '`npm test`', '', '## Rollback', 'Revert.',
    ''].join('\n'),
  'tasks.md': ['# Tasks', '', '## 1. Farewell', '', '- [x] 1.1 Add test/greet.test.js and verify it fails first',
    '- [x] 1.2 Implement farewell and verify npm test passes', ''].join('\n'),
  'review.md': ['# Review: add-farewell', '', '## Findings', '', '### F1 [important][bugs] Empty name',
    '- **Where**: src/greet.js:5', '- **Status**: fixed (default name)', '', '## Coverage', '- bugs: 1 finding',
    '- security: none found — checked: no input reaches a shell', '- compliance: none found — checked: no data',
    '- adversarial: none found — checked: very long names', '- edge-cases: none found — checked: empty names',
    '- verification-gaps: none found — checked: exact message asserted', ''].join('\n'),
};
export const TEST = ["import { test } from 'node:test';", "import assert from 'node:assert/strict';",
  "import { farewell } from '../src/greet.js';", "test('f', () => assert.equal(farewell('Ada'), 'Goodbye, Ada'));",
  ''].join('\n');

/** The code and its test, and every task checked, for the change `id` under `root`. */
export function writeWork(root: string, id: string): void {
  write(path.join(root, 'test/greet.test.js'), TEST);
  const farewell = '\nexport function farewell(name = "friend") {\n  return `Goodbye, ${name}`;\n}\n';
  fs.appendFileSync(path.join(root, 'src/greet.js'), farewell);
  write(path.join(root, 'openspec/changes', id, 'tasks.md'), FILES['tasks.md']);
}

/** Fills the behavioural table of verification.md with one PASS row for the change's scenario. */
export function fillBehaviour(root: string, id: string): void {
  const file = path.join(root, 'openspec/changes', id, 'verification.md');
  const text = fs.readFileSync(file, 'utf8');
  const row = '| Named farewell | node --test | Goodbye, Ada | PASS |\n';
  fs.writeFileSync(file, text.replace(/(## Behavioral verification[\s\S]*?\|---\|---\|---\|---\|\n)/, `$1${row}`));
}

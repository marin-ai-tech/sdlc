import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B88: the `Next:` line printed after a command and the status line show the same next step as `sdlc next` and
 * `sdlc status`. Both used to evaluate the change without the worktree fingerprint, so after a later code change
 * they trusted the recorded verification and review approval: `sdlc verify` said "archive" while `sdlc next` asked
 * for a new review approval, and the status line said "Done" while the code was unverified.
 */

const FILES: Record<string, string> = {
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
const TEST = ["import { test } from 'node:test';", "import assert from 'node:assert/strict';",
  "import { farewell } from '../src/greet.js';", "test('f', () => assert.equal(farewell('Ada'), 'Goodbye, Ada'));",
  ''].join('\n');

describe('B88: the Next: line and the status line are as fresh as sdlc next', () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  const cli = (args: string[], input?: string) => runCli(args, root, env, input);
  const change = (file: string) => path.join(root, 'openspec/changes/add-farewell', file);
  const nextLine = (stdout: string) => stdout.split('\n').find((line) => line.startsWith('Next:')) ?? '';
  const statusLine = () => cli(['statusline'], JSON.stringify({ cwd: root })).stdout.trim();
  const fullNext = () => cli(['next', '--change', 'add-farewell', '--json']).json().next;
  const stageTitle = () => cli(['status', '--change', 'add-farewell', '--json']).json().change.stageTitle;

  beforeAll(() => {
    root = tempDir('sdlc-b88-');
    env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    const pkg = { name: 'demo', type: 'module', scripts: { test: 'node --test' } };
    write(path.join(root, 'package.json'), JSON.stringify(pkg));
    write(path.join(root, 'src/greet.js'), 'export function greet(name) {\n  return `Hello, ${name}`;\n}\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'init']);
    expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    expect(cli(['new', 'add-farewell', '--kind', 'feature', '--risk', 'low', '--json']).code).toBe(0);
    write(change('intent.md'), FILES['intent.md']);
    expect(cli(['approve', 'intent', '--change', 'add-farewell']).code).toBe(0);
    for (const file of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(change(file), FILES[file]);
    expect(cli(['approve', 'spec', '--change', 'add-farewell']).code).toBe(0);
    for (const file of ['plan.md', 'tasks.md']) write(change(file), FILES[file]);
    expect(cli(['approve', 'plan', '--change', 'add-farewell']).code).toBe(0);
    write(path.join(root, 'test/greet.test.js'), TEST);
    const farewell = '\nexport function farewell(name = "friend") {\n  return `Goodbye, ${name}`;\n}\n';
    fs.appendFileSync(path.join(root, 'src/greet.js'), farewell);
    expect(cli(['verify', '--change', 'add-farewell']).code).toBe(0);
    write(change('review.md'), FILES['review.md']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'work']);
  }, 240000);

  it('negative: right after approve review, the Next: line is the step sdlc next gives (archive)', () => {
    const approved = cli(['approve', 'review', '--change', 'add-farewell']);
    expect(approved.code, approved.stdout + approved.stderr).toBe(0);
    expect(fullNext()).toMatchObject({ action: 'archive' });
    expect(nextLine(approved.stdout)).toMatch(/archive/i);
    expect(statusLine()).toContain(stageTitle());
  }, 120000);

  it('after a later code change the status line no longer says the change is done', () => {
    fs.appendFileSync(path.join(root, 'src/greet.js'), '\n// a later edit\n');
    expect(fullNext()).toMatchObject({ action: 'verify' });
    expect(statusLine()).toContain(stageTitle());
    expect(statusLine()).not.toMatch(/Done/);
  }, 120000);

  it('after verify again, the Next: line asks for a new review approval, as sdlc next does', () => {
    const verified = cli(['verify', '--change', 'add-farewell']);
    expect(verified.code, verified.stdout + verified.stderr).toBe(0);
    expect(fullNext()).toMatchObject({ actor: 'human', action: 'approve-gate', gate: 'review' });
    expect(nextLine(verified.stdout)).toContain('approve review');
    expect(nextLine(verified.stdout)).not.toMatch(/archive/i);
    expect(statusLine()).toContain(stageTitle());
    expect(statusLine()).toMatch(/person/);
    const log = read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n').map((line) => JSON.parse(line));
    expect(log.filter((entry) => entry.event === 'gate.review.awaiting').length).toBeGreaterThanOrEqual(1);
  }, 120000);

  it('the next step that sdlc instructions shows the agent is the one sdlc next gives', () => {
    const expected = fullNext().message;
    const text = cli(['instructions', 'tasks', '--change', 'add-farewell']).stdout;
    const shown = text.split('\n').find((line) => line.startsWith('[sdlc] stage:')) ?? '';
    expect(shown).toContain(stageTitle());
    expect(shown).toContain(expected);
    expect(shown).not.toMatch(/archive/i);
  }, 120000);
});

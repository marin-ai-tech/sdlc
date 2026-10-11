import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.15.0: after a rework or a rejection, the change goes to the agent to revise; once the agent has changed the
 * artifacts, the gate waits for a person again — `sdlc next` names the person, `next --me` lists the gate for them,
 * and the gate's `awaiting` entry is logged (so events reach them). Before, the gate stayed "rejected" until somebody
 * approved it, and `next` kept saying "agent: revise".
 */

const FILES: Record<string, string> = {
  'intent.md': '# Intent: say goodbye\n\nAuthor: Pat. Status: draft. Source: idea\n\n'
    + '## Problem\nSessions end without a goodbye.\n\n## Proposed outcome\nUsers see a named farewell.\n\n## Affected users and systems\nAll users.\n\n'
    + '## Constraints\nNone\n\n## Success measures\nShown on sign-out.\n\n## Out of scope\nLocalization.\n\n'
    + '## Open questions\nNone\n',
  'proposal.md': '# Proposal\n\n## Why\n\nSessions end abruptly because users never see a farewell message that uses '
    + 'their name.\n\n## What Changes\n\n- Add farewell(name).\n\n## Capabilities\n\n### New Capabilities\n'
    + '- `greeting`: greeting and farewell messages\n\n## Impact\n\nsrc/greet.js\n',
  'specs/greeting/spec.md': '# Spec Delta\n\n## Purpose\n\nProvide friendly, personalized greeting and farewell '
    + 'messages to users.\n\n## ADDED Requirements\n\n### Requirement: Farewell message\nThe system SHALL produce a '
    + 'farewell message that includes the user\'s name.\n\n#### Scenario: Named farewell\n- **WHEN** Ada signs out\n'
    + '- **THEN** the message is "Goodbye, Ada"\n',
  'design.md': '# Design\n\n## Context\nsrc/greet.js\n\n## Decisions\nAdd farewell next to greet.\n\n'
    + '## Policy compliance\nNone apply.\n\n## Areas of concern\nNone identified\n',
};
const CHANGE = 'add-farewell';

function project() {
  const root = tempDir('sdlc-next-rework-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(cli(['new', CHANGE, '--json']).code).toBe(0);
  const dir = path.join(root, 'openspec/changes', CHANGE);
  for (const [file, text] of Object.entries(FILES)) write(path.join(dir, file), text);
  for (const gate of ['intent', 'spec']) {
    const r = cli(['approve', gate, '--change', CHANGE, '--json']);
    expect(r.code, `${gate}: ${r.stdout}${r.stderr}`).toBe(0);
  }
  const next = () => cli(['next', '--change', CHANGE, '--json']).json().next;
  const mine = () => JSON.stringify(cli(['next', '--me', '--json']).json());
  const awaiting = (gate: string) => read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n')
    .map((line) => JSON.parse(line)).filter((e) => e.event === `gate.${gate}.awaiting`).length;
  const edit = (file: string) => fs.appendFileSync(path.join(dir, file), '\n- Empty names get "Goodbye, friend".\n');
  return { cli, next, mine, awaiting, edit };
}

describe('next after a rework', () => {
  it('right after the rework the agent revises; once it has changed the artifacts, a person approves again', () => {
    const p = project();
    const r = p.cli(['rework', 'spec', '--change', CHANGE, '--reason', 'missing-requirement', '--note', 'Empty name?']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(p.next()).toMatchObject({ actor: 'agent', action: 'revise-artifact', gate: 'spec' });
    const before = p.awaiting('spec');
    p.edit('proposal.md');
    expect(p.next()).toMatchObject({ actor: 'human', action: 'approve-gate', gate: 'spec' });
    expect(p.mine()).toContain('"spec"');
    expect(p.awaiting('spec')).toBeGreaterThan(before);
  }, 180000);

  it('negative: an edit outside the gate artifacts does not end the revision', () => {
    const p = project();
    const r = p.cli(['rework', 'spec', '--change', CHANGE, '--reason', 'missing-requirement', '--note', 'n']);
    expect(r.code).toBe(0);
    p.edit('notes.md');
    expect(p.next()).toMatchObject({ actor: 'agent', action: 'revise-artifact', gate: 'spec' });
  }, 180000);
});

describe('next after a rejection', () => {
  it('the agent revises after a rejection, and the person approves once the artifacts changed', () => {
    const p = project();
    expect(p.cli(['reject', 'spec', '--change', CHANGE, '--note', 'Say what happens without a name']).code).toBe(0);
    expect(p.next()).toMatchObject({ actor: 'agent', action: 'revise-artifact', gate: 'spec' });
    p.edit('specs/greeting/spec.md');
    expect(p.next()).toMatchObject({ actor: 'human', action: 'approve-gate', gate: 'spec' });
  }, 180000);
});

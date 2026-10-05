import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/** B2: a person sends a change back to a stage with a reason category and a note; later approvals stop counting. */

const FILES: Record<string, string> = {
  'intent.md': '# Intent: say goodbye\n\nAuthor: Pat. Status: draft. Source: idea\n\n## Problem\nSessions end without a goodbye.\n\n## Proposed outcome\nUsers see a named farewell.\n\n## Affected users and systems\nAll users.\n\n## Constraints\nNone\n\n## Success measures\nShown on sign-out.\n\n## Out of scope\nLocalization.\n\n## Open questions\nNone\n',
  'proposal.md': '# Proposal\n\n## Why\n\nSessions end abruptly because users never see a farewell message that uses their name.\n\n## What Changes\n\n- Add farewell(name).\n\n## Capabilities\n\n### New Capabilities\n- `greeting`: greeting and farewell messages\n\n## Impact\n\nsrc/greet.js\n',
  'specs/greeting/spec.md': '# Spec Delta\n\n## Purpose\n\nProvide friendly, personalized greeting and farewell messages to users.\n\n## ADDED Requirements\n\n### Requirement: Farewell message\nThe system SHALL produce a farewell message that includes the user\'s name.\n\n#### Scenario: Named farewell\n- **WHEN** Ada signs out\n- **THEN** the message is "Goodbye, Ada"\n',
  'design.md': '# Design\n\n## Context\nsrc/greet.js\n\n## Decisions\nAdd farewell next to greet.\n\n## Policy compliance\nNone apply.\n\n## Areas of concern\nNone identified\n',
  'plan.md': '# Plan\n\n## Files that change\n- `src/greet.js` (modified)\n- `test/greet.test.js` (new)\n\n## Order of work\n1. Test. 2. Implement.\n\n## Proof\n`npm test`\n\n## Rollback\nRevert.\n',
  'tasks.md': '# Tasks\n\n## 1. Farewell\n\n- [ ] 1.1 Add test/greet.test.js and verify it fails first\n- [ ] 1.2 Implement farewell and verify npm test passes\n',
};

const AGENT = { CLAUDECODE: '1' };

function project(options: { approveUpTo?: 'intent' | 'plan'; reasons?: string[] } = {}) {
  const root = tempDir('sdlc-rework-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  if (options.reasons) {
    const file = path.join(root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    config.rework = { reasons: options.reasons };
    write(file, stringify(config));
  }
  expect(cli(['new', 'add-farewell', '--json']).code).toBe(0);
  const dir = path.join(root, 'openspec/changes/add-farewell');
  for (const [file, text] of Object.entries(FILES)) write(path.join(dir, file), text);
  const gates = options.approveUpTo === 'intent' ? ['intent'] : ['intent', 'spec', 'plan'];
  for (const gate of gates) {
    const r = cli(['approve', gate, '--change', 'add-farewell', '--json']);
    expect(r.code, `${gate}: ${r.stdout}${r.stderr}`).toBe(0);
  }
  const status = () => cli(['status', '--change', 'add-farewell', '--json']).json().change;
  const gate = (id: string) => status().gates.find((g: { id: string }) => g.id === id);
  const state = () => parse(read(path.join(dir, '.sdlc.yaml')));
  const events = () => read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
  return { root, cli, status, gate, state, events };
}

const REWORK = ['rework', 'spec', '--change', 'add-farewell', '--reason', 'missing-requirement',
  '--note', 'No behaviour for an empty name'];

describe('sdlc rework', () => {
  it('sends the change back to the spec stage, records why, and later approvals stop counting', () => {
    const p = project();
    expect(p.gate('plan').status).toBe('approved');
    const r = p.cli([...REWORK, '--json']);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    expect(p.gate('intent').status).toBe('approved');
    expect(p.gate('spec')).toMatchObject({ status: 'rejected', rework: { reason: 'missing-requirement' } });
    expect(p.gate('plan').status).not.toBe('approved');
    expect(p.gate('plan').satisfied).toBe(false);
    // The spec gate belongs to the design stage (GATE_STAGE): a rework of spec moves the change back there.
    expect(p.status().stage).toBe('design');
    expect(p.state().gates.spec.rework).toMatchObject({ reason: 'missing-requirement',
      note: 'No behaviour for an empty name', from: 'build' });
    const event = p.events().find((e) => e.event === 'gate.spec.rework');
    expect(event.detail).toMatch(/missing-requirement/);
  }, 240000);

  it('after a new spec approval the plan still needs its own new approval', () => {
    const p = project();
    expect(p.cli([...REWORK, '--json']).code).toBe(0);
    expect(p.cli(['approve', 'spec', '--change', 'add-farewell', '--json']).code).toBe(0);
    expect(p.gate('spec').status).toBe('approved');
    expect(p.gate('plan').status).not.toBe('approved');
    expect(p.cli(['approve', 'plan', '--change', 'add-farewell', '--json']).code).toBe(0);
    expect(p.gate('plan').status).toBe('approved');
  }, 240000);

  it('reasons come from a list: the default one, or rework.reasons in sdlc.yaml', () => {
    const p = project();
    const unknown = p.cli(['rework', 'spec', '--change', 'add-farewell', '--reason', 'whim', '--note', 'n', '--json']);
    expect(unknown.code).toBe(1);
    expect(unknown.json().status[0]).toMatchObject({ code: 'invalid_option' });
    expect(unknown.json().status[0].message).toMatch(/missing-requirement/);
    const custom = project({ reasons: ['customer-request', 'other'] });
    const ok = custom.cli(['rework', 'spec', '--change', 'add-farewell', '--reason', 'customer-request', '--note', 'n', '--json']);
    expect(ok.code, ok.stdout).toBe(0);
    const old = custom.cli(['rework', 'plan', '--change', 'add-farewell', '--reason', 'design-flaw', '--note', 'n', '--json']);
    expect(old.code).toBe(1);
  }, 360000);

  it('negative: a note is required, and a gate the change has not reached cannot be reworked', () => {
    const p = project({ approveUpTo: 'intent' });
    const noNote = p.cli(['rework', 'intent', '--change', 'add-farewell', '--reason', 'other', '--json']);
    expect(noNote.code).toBe(1);
    expect(noNote.json().status[0].code).toBe('note_required');
    const ahead = p.cli(['rework', 'plan', '--change', 'add-farewell', '--reason', 'other', '--note', 'n', '--json']);
    expect(ahead.code).toBe(1);
    expect(ahead.json().status[0].code).toBe('invalid_transition');
  }, 240000);

  it('only a person: the CLI refuses an agent, the hook denies it, help marks it human', () => {
    const p = project({ approveUpTo: 'intent' });
    const r = p.cli(['rework', 'intent', '--change', 'add-farewell', '--reason', 'other', '--note', 'n', '--json'], AGENT);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('agent_cannot_approve');
    const ctx = { paths: projectPaths(p.root), config: defaultConfig() };
    const call = normalizeToolCall('Bash', { command: 'sdlc rework spec --change x --reason other --note n' }, p.root);
    expect(evaluateToolCall(call, ctx)).toMatchObject({ decision: 'deny', rule: 'separation-of-duties' });
    const entry = p.cli(['help', '--json']).json().commands.find((c: { name: string }) => c.name === 'rework');
    expect(entry).toMatchObject({ actor: 'human' });
  }, 240000);
});

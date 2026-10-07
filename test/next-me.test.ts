import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.9.1: `sdlc next --me` — my queue. Every gate, across the active changes, that waits for a person and that I (the git
 * identity, matched to a person in openspec/roles.yaml) may take now, with the command to run. Without roles.yaml
 * anyone may act, so every gate that waits for a person is listed and marked so. Read-only: an agent may run it.
 */

const ROLES = [
  'version: 1', 'signing: off', 'people:',
  '  alice: { name: Alice Ivanova, emails: [alice@corp.example] }',
  '  bob: { name: Bob Petrov, emails: [bob@corp.example] }',
  'roles:', '  product-owner: [alice]', '  engineer: [bob]', '  code-owner: [bob]', '  maintainer: [alice]', '',
].join('\n');

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome', 'O.',
  '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');
const PLAN = '# Plan\n\n## Files that change\n- `src/a.js` (new)\n\n## Order of work\n1. Do.\n\n## Proof\n`node -e 0`\n\n## Rollback\nRevert.\n';
const TASKS = '# Tasks\n\n## 1. Work\n\n- [ ] 1.1 Do it and verify node -e 0 passes\n';

function project(withRoles = true) {
  const root = tempDir('sdlc-next-me-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  const as = (name: string, email: string) => {
    git(root, ['config', 'user.name', name]);
    git(root, ['config', 'user.email', email]);
  };
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  if (withRoles) write(path.join(root, 'openspec/roles.yaml'), ROLES);
  const change = (id: string, file: string) => path.join(root, 'openspec/changes', id, file);
  // Change a waits for its intent approval (product-owner: Alice).
  expect(cli(['new', 'a', '--json']).code).toBe(0);
  write(change('a', 'intent.md'), INTENT);
  // Change b waits for its plan approval (engineer: Bob).
  expect(cli(['new', 'b', '--json']).code).toBe(0);
  as('Alice Ivanova', 'alice@corp.example');
  expect(cli(['waive', 'intent', '--change', 'b', '--note', 't', '--json']).code).toBe(0);
  expect(cli(['waive', 'spec', '--change', 'b', '--note', 't', '--json']).code).toBe(0);
  write(change('b', 'plan.md'), PLAN);
  write(change('b', 'tasks.md'), TASKS);
  const mine = (extra: NodeJS.ProcessEnv = {}) => {
    const r = cli(['next', '--me', '--json'], extra);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    return r.json();
  };
  return { root, cli, as, mine, record: (id: string) => read(change(id, '.sdlc.yaml')) };
}

const gates = (out: { items: Array<{ change: string; gate: string }> }) => out.items.map((i) => `${i.change}:${i.gate}`);

describe('sdlc next --me', () => {
  it('lists the gates waiting for me, with the command, and not the ones waiting for others', () => {
    const p = project();
    const alice = p.mine();
    expect(alice.me).toMatchObject({ email: 'alice@corp.example', person: 'alice' });
    expect(gates(alice)).toEqual(['a:intent']);
    expect(alice.items[0].cli).toContain('sdlc approve intent --change a');
    p.as('Bob Petrov', 'bob@corp.example');
    expect(gates(p.mine())).toEqual(['b:plan']);
  }, 180000);

  it('negative: someone outside roles.yaml has nothing to do and is told why', () => {
    const p = project();
    p.as('Mallory', 'mallory@evil.example');
    const out = p.mine();
    expect(out.me.person).toBeNull();
    expect(out.items).toEqual([]);
    expect(out.reason).toBe('not_in_roles');
  }, 180000);

  it('without roles.yaml every gate waiting for a person is mine to take, and it says so', () => {
    const p = project(false);
    const out = p.mine();
    expect(gates(out).sort()).toEqual(['a:intent', 'b:plan']);
    expect(out.anyone).toBe(true);
  }, 180000);

  it('negative: an agent may run it, and it changes nothing', () => {
    const p = project();
    const before = [p.record('a'), p.record('b')];
    expect(gates(p.mine({ CLAUDECODE: '1' }))).toEqual(['a:intent']);
    expect([p.record('a'), p.record('b')]).toEqual(before);
    expect(p.cli(['next', '--me']).stdout).toContain('sdlc approve intent --change a');
  }, 180000);
});

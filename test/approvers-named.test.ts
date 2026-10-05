import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

const ROLES = [
  'version: 1', 'signing: off', 'people:',
  '  alice: { name: Alice Ivanova, emails: [alice@corp.example] }',
  '  bob: { name: Bob Petrov, emails: [bob@corp.example] }',
  '  carol: { name: Carol Smirnova, emails: [carol@corp.example] }',
  'roles:', '  product-owner: [alice, carol]', '  engineer: [bob]', '  code-owner: [bob, carol]', '  maintainer: [alice]', '',
].join('\n');

const INTENT = [
  '# Intent: demo', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome', 'O.',
  '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

function project(options: { roles?: boolean; minApprovals?: number } = {}) {
  const root = tempDir('sdlc-approvers-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  if (options.roles !== false) write(path.join(root, 'openspec/roles.yaml'), ROLES);
  if (options.minApprovals) {
    const file = path.join(root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    config.gates.intent.min_approvals = options.minApprovals;
    write(file, stringify(config));
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'setup']);
  expect(cli(['new', 'demo', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/changes/demo/intent.md'), INTENT);
  const as = (name: string, email: string) => {
    git(root, ['config', 'user.name', name]);
    git(root, ['config', 'user.email', email]);
  };
  const gate = () => cli(['status', '--change', 'demo', '--json']).json().change.gates
    .find((g: { id: string }) => g.id === 'intent');
  return { root, cli, as, gate };
}

describe('B1: the Next hint names the people who may take the decision', () => {
  it('with roles.yaml, next lists the same people as roles who, and the text names them', () => {
    const p = project();
    const next = p.cli(['next', '--change', 'demo', '--json']).json().next ?? p.cli(['next', '--change', 'demo', '--json']).json();
    const allowed = p.cli(['roles', 'who', 'intent', '--change', 'demo', '--json']).json().allowed
      .map((person: { id: string }) => person.id);
    expect(next.people.map((person: { id: string }) => person.id)).toEqual(allowed);
    expect(next.people[0]).toMatchObject({ id: 'alice', name: 'Alice Ivanova', role: 'product-owner' });
    const text = p.cli(['status', '--change', 'demo']).stdout;
    expect(text).toMatch(/Alice Ivanova/);
    expect(text).toMatch(/Carol Smirnova/);
    expect(text).not.toMatch(/Bob Petrov/);
    expect(p.cli(['status', '--change', 'demo', '--locale', 'ru']).stdout).toMatch(/Alice Ivanova/);
  }, 120000);

  it('negative: without roles.yaml the hint names the role as before', () => {
    const p = project({ roles: false });
    const json = p.cli(['next', '--change', 'demo', '--json']).json();
    const next = json.next ?? json;
    expect(next.people).toBeUndefined();
    expect(p.cli(['status', '--change', 'demo']).stdout).toMatch(/A product-owner/);
  }, 120000);

  it('the workflows tell the agent to name the people, not the role', () => {
    const p = project();
    expect(p.cli(['init', '--tools', 'opencode', '--json']).code).toBe(0);
    const workflow = read(path.join(p.root, '.opencode/commands/sdlc-next.md'));
    expect(workflow).toMatch(/name the people/i);
  }, 120000);
});

describe('B5: several approvers for one gate (min_approvals)', () => {
  it('the gate waits for N different people; one person approving twice counts once', () => {
    const p = project({ minApprovals: 2 });
    p.as('Alice Ivanova', 'alice@corp.example');
    expect(p.cli(['approve', 'intent', '--change', 'demo', '--json']).code).toBe(0);
    expect(p.gate()).toMatchObject({ status: 'pending', minApprovals: 2 });
    expect(p.gate().reason).toMatch(/1 of 2/);
    expect(p.cli(['approve', 'intent', '--change', 'demo', '--json']).code).toBe(0);
    expect(p.gate().status).toBe('pending');
    const next = p.cli(['next', '--change', 'demo', '--json']).json();
    expect((next.next ?? next).people.map((person: { id: string }) => person.id)).toEqual(['carol']);
    p.as('Carol Smirnova', 'carol@corp.example');
    expect(p.cli(['approve', 'intent', '--change', 'demo', '--json']).code).toBe(0);
    expect(p.gate().status).toBe('approved');
    expect(p.gate().approvals).toHaveLength(2);
  }, 180000);

  it('a second approver no longer displaces the first one of the same role', () => {
    const p = project();
    p.as('Alice Ivanova', 'alice@corp.example');
    expect(p.cli(['approve', 'intent', '--change', 'demo', '--json']).code).toBe(0);
    p.as('Carol Smirnova', 'carol@corp.example');
    expect(p.cli(['approve', 'intent', '--change', 'demo', '--json']).code).toBe(0);
    expect(p.gate().approvals.map((a: { by: string }) => a.by).join(' ')).toMatch(/alice.*carol|carol.*alice/i);
  }, 180000);

  it('negative: without min_approvals one approval is enough; an invalid value is refused', () => {
    const p = project();
    p.as('Alice Ivanova', 'alice@corp.example');
    expect(p.cli(['approve', 'intent', '--change', 'demo', '--json']).code).toBe(0);
    expect(p.gate().status).toBe('approved');
    const bad = project({ minApprovals: 1 });
    const file = path.join(bad.root, 'openspec/sdlc.yaml');
    write(file, read(file).replace('min_approvals: 1', 'min_approvals: 0'));
    const r = bad.cli(['status', '--change', 'demo', '--json']);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('invalid_config');
  }, 180000);
});

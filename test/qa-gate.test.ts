import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES, writeWork } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B110 (0.18.0), part 2: an optional `qa` gate between verify and review (the customer's decision). With
 * `gates.qa.required: true`, after verification passes a person with the `qa` role accepts the evidence
 * (`sdlc approve qa`); review waits for it. The approval is bound to the verification evidence: a new verification run
 * makes it stale. Off by default (`required: false`): the flow is exactly as before.
 */

const ROLES = ['version: 1', 'signing: off', 'people:',
  '  alice: { name: Alice Ivanova, emails: [alice@nw.example] }',
  '  carol: { name: Carol Hughes, emails: [carol@nw.example] }',
  '  anna: { name: Anna Kim, emails: [anna@nw.example] }',
  'roles:', '  product-owner: [alice]', '  engineer: [alice]', '  tech-lead: [alice]', '  code-owner: [carol]',
  '  qa: [anna]', '  maintainer: [alice]', 'separation:', '  author_cannot_approve: []', '  distinct_approvers: []',
  ''];

function project(qaRequired: boolean) {
  const root = tempDir('sdlc-qa-gate-');
  initGitRepo(root);
  const pkg = { name: 'demo', type: 'module', scripts: { test: 'node --test' } };
  write(path.join(root, 'package.json'), JSON.stringify(pkg));
  write(path.join(root, 'src/greet.js'), 'export function greet(name) {\n  return `Hello, ${name}`;\n}\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], person = 'alice') => {
    git(root, ['config', 'user.email', `${person}@nw.example`]);
    return runCli(args, root, env);
  };
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/roles.yaml'), ROLES.join('\n'));
  if (qaRequired) {
    const file = path.join(root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    config.gates.qa = { required: true };
    write(file, stringify(config));
  }
  const change = (file: string) => path.join(root, 'openspec/changes/add-farewell', file);
  expect(cli(['new', 'add-farewell', '--json']).code).toBe(0);
  write(change('intent.md'), FILES['intent.md']);
  expect(cli(['approve', 'intent', '--change', 'add-farewell', '--json']).code).toBe(0);
  for (const file of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(change(file), FILES[file]);
  expect(cli(['approve', 'spec', '--change', 'add-farewell', '--json']).code).toBe(0);
  for (const file of ['plan.md', 'tasks.md']) write(change(file), FILES[file]);
  expect(cli(['approve', 'plan', '--change', 'add-farewell', '--json']).code).toBe(0);
  writeWork(root, 'add-farewell');
  expect(cli(['verify', '--change', 'add-farewell', '--json']).code).toBe(0);
  write(change('review.md'), FILES['review.md']);
  const next = () => cli(['next', '--change', 'add-farewell', '--json']).json().next;
  return { root, cli, next, change };
}

describe('B110: the qa gate', () => {
  it('with gates.qa.required, a qa person accepts the evidence before review', () => {
    const p = project(true);
    expect(p.next()).toMatchObject({ actor: 'human', action: 'approve-gate', gate: 'qa' });
    expect(JSON.stringify(p.next())).toContain('Anna Kim');
    const early = p.cli(['approve', 'review', '--change', 'add-farewell', '--json'], 'carol');
    expect(early.code).not.toBe(0);
    const byCarol = p.cli(['approve', 'qa', '--change', 'add-farewell', '--json'], 'carol');
    expect(byCarol.code).not.toBe(0);
    const qa = p.cli(['approve', 'qa', '--change', 'add-farewell', '--json'], 'anna');
    expect(qa.code, qa.stdout + qa.stderr).toBe(0);
    expect(p.next()).toMatchObject({ actor: 'human', gate: 'review' });
    expect(p.cli(['approve', 'review', '--change', 'add-farewell', '--json'], 'carol').code).toBe(0);
  }, 300000);

  it('a new verification run makes the qa approval stale', () => {
    const p = project(true);
    expect(p.cli(['approve', 'qa', '--change', 'add-farewell', '--json'], 'anna').code).toBe(0);
    fs.appendFileSync(path.join(p.root, 'src/greet.js'), '\n// a later edit\n');
    expect(p.cli(['verify', '--change', 'add-farewell', '--json']).code).toBe(0);
    expect(p.next()).toMatchObject({ actor: 'human', action: 'approve-gate', gate: 'qa' });
  }, 300000);

  it('an agent cannot approve the qa gate', () => {
    const p = project(true);
    const r = runCli(['approve', 'qa', '--change', 'add-farewell', '--json'], p.root,
      { ...humanEnv(tempDir('sdlc-home-')), CLAUDECODE: '1' });
    expect(r.code).not.toBe(0);
  }, 300000);

  it('negative: by default there is no qa step; review follows verify as before', () => {
    const p = project(false);
    expect(p.next()).toMatchObject({ actor: 'human', gate: 'review' });
    expect(p.cli(['approve', 'review', '--change', 'add-farewell', '--json'], 'carol').code).toBe(0);
  }, 300000);
});

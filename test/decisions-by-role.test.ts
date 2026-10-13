import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B108 (0.18.0): with openspec/roles.yaml, decisions that only checked "a person" also check the role:
 * `sdlc team accept` needs a maintainer, `sdlc backlog move` / `sdlc backlog drop` need a product owner (the customer's
 * decision). A person without the role is refused with `missing_role`, and the message names who may. Without
 * roles.yaml any person may, as before; an agent is refused as before. `sdlc team list` shows that a newer draft
 * waits next to an accepted role.
 */

const ROLES = ['version: 1', 'signing: off', 'people:',
  '  maria: { name: Maria Ruiz, emails: [maria@nw.example] }',
  '  ivan: { name: Ivan Lee, emails: [ivan@nw.example] }',
  '  bob: { name: Bob Stone, emails: [bob@nw.example] }',
  'roles:', '  product-owner: [maria]', '  maintainer: [ivan]', '  engineer: [bob]', '  code-owner: [bob]',
  ''].join('\n');
type Role = { id: string; status: string; newerDraft?: boolean };

function project(withRoles = true) {
  const root = tempDir('sdlc-decisions-role-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const as = (person: string) => ({
    GIT_AUTHOR_EMAIL: `${person}@nw.example`, GIT_COMMITTER_EMAIL: `${person}@nw.example`,
  });
  const role = (id: string, person = 'bob'): Role =>
    runListAs(person).roles.find((item: Role) => item.id === id);
  const runListAs = (person: string) => cli(['team', 'list', '--json'], person).json();
  const cli = (args: string[], person = 'maria') => {
    git(root, ['config', 'user.email', `${person}@nw.example`]);
    return runCli(args, root, { ...env, ...as(person) });
  };
  expect(cli(['init', '--tools', 'claude', '--json']).code).toBe(0);
  if (withRoles) write(path.join(root, 'openspec/roles.yaml'), ROLES);
  for (const title of ['Export CSV', 'Import CSV']) {
    expect(cli(['backlog', 'add', title, '--outcome', 'o', '--accept', 'a', '--json']).code).toBe(0);
  }
  return { root, cli, role };
}

describe('B108: backlog order and the agent team by role', () => {
  it('backlog move and drop need a product owner', () => {
    const p = project();
    const refused = p.cli(['backlog', 'move', 'B2', '--top', '--json'], 'bob');
    expect(refused.code).not.toBe(0);
    expect(refused.json().status[0].code).toBe('missing_role');
    expect(refused.json().status[0].message).toContain('Maria Ruiz');
    const dropped = p.cli(['backlog', 'drop', 'B1', '--note', 'no', '--json'], 'ivan');
    expect(dropped.json().status[0].code).toBe('missing_role');
    expect(p.cli(['backlog', 'move', 'B2', '--top', '--json'], 'maria').code).toBe(0);
    expect(p.cli(['backlog', 'drop', 'B1', '--note', 'not needed', '--json'], 'maria').code).toBe(0);
  }, 180000);

  it('team accept needs a maintainer', () => {
    const p = project();
    expect(p.cli(['team', 'sync', '--json'], 'bob').code).toBe(0);
    const refused = p.cli(['team', 'accept', 'tester', '--json'], 'maria');
    expect(refused.code).not.toBe(0);
    expect(refused.json().status[0].code).toBe('missing_role');
    expect(refused.json().status[0].message).toContain('Ivan Lee');
    const accepted = p.cli(['team', 'accept', 'tester', '--json'], 'ivan');
    expect(accepted.code, accepted.stdout + accepted.stderr).toBe(0);
  }, 180000);

  it('negative: without roles.yaml any person may, as before', () => {
    const p = project(false);
    expect(p.cli(['backlog', 'move', 'B2', '--top', '--json'], 'bob').code).toBe(0);
    expect(p.cli(['team', 'sync', '--json'], 'bob').code).toBe(0);
    expect(p.cli(['team', 'accept', 'tester', '--json'], 'bob').code).toBe(0);
  }, 180000);

  it('team list shows a newer draft waiting next to an accepted role', () => {
    const p = project();
    expect(p.cli(['team', 'sync', '--json'], 'bob').code).toBe(0);
    expect(p.cli(['team', 'accept', 'tester', '--json'], 'ivan').code).toBe(0);
    const accepted = read(path.join(p.root, 'docs/agents/tester.md'));
    fs.mkdirSync(path.join(p.root, 'docs/agents/drafts'), { recursive: true });
    write(path.join(p.root, 'docs/agents/drafts/tester.md'), `${accepted}\nA newer paragraph from the registry.\n`);
    const tester = p.role('tester');
    expect(tester.status).toBe('accepted');
    expect(tester.newerDraft).toBe(true);
    expect(p.cli(['team', 'list'], 'bob').stdout).toMatch(/tester[\s\S]*(newer draft|draft waits)/i);
    // negative: a draft equal to the accepted text is not "newer"
    write(path.join(p.root, 'docs/agents/drafts/tester.md'), accepted);
    const same = p.role('tester');
    expect(same.newerDraft).toBe(false);
  }, 180000);
});

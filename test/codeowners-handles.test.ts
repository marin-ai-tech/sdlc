import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

/**
 * B107 (0.16.2): CODEOWNERS `@handles` map to people explicitly. A person in openspec/roles.yaml may list their
 * GitHub handles (`handles: [carol-s]`, with or without `@`, matched case-insensitively); a CODEOWNERS `@carol-s` then
 * owns for Carol in `sdlc review suggest`. A handle equal to the person id still matches, as before. Only personal
 * handles are allowed (`org/team` is not a person): anything else is an invalid roles.yaml. `sdlc adopt` prints the
 * handles it could not resolve in text, not only in `--json` (`owners_unresolved`).
 */

const ROLES = (carol: string) => [
  'version: 1', 'signing: off', 'people:',
  '  alice: { name: Alice Ivanova, emails: [alice@corp.example] }',
  '  bob: { name: Bob Petrov, emails: [bob@corp.example] }',
  `  carol: { name: Carol Smirnova, emails: [carol@corp.example]${carol} }`,
  '  dave: { name: Dave Orlov, emails: [dave@corp.example] }',
  'roles:', '  product-owner: [alice]', '  engineer: [alice]', '  code-owner: [bob, carol, dave]',
  '  maintainer: [alice]', 'separation:', '  author_cannot_approve: [review, release]', '',
].join('\n');

function project(roles: string, codeowners: string) {
  const root = tempDir('sdlc-codeowners-handles-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'Alice Ivanova']);
  git(root, ['config', 'user.email', 'alice@corp.example']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/roles.yaml'), roles);
  write(path.join(root, '.github/CODEOWNERS'), codeowners);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'setup']);
  return { root, cli };
}

function daveWrites(p: ReturnType<typeof project>, file: string): void {
  git(p.root, ['checkout', '-q', '-b', 'feature']);
  write(path.join(p.root, file), 'export const x = 1;\n');
  git(p.root, ['add', '-A']);
  git(p.root, ['-c', 'user.name=Dave Orlov', '-c', 'user.email=dave@corp.example', 'commit', '-qm', 'pay']);
  expect(p.cli(['new', 'pay', '--json']).code).toBe(0);
}

describe('B107: CODEOWNERS handles in roles.yaml', () => {
  it('a handle listed for a person owns for that person in review suggest', () => {
    const p = project(ROLES(', handles: ["@Carol-S"]'), '* @bob\n/src/payments/ @carol-s\n');
    daveWrites(p, 'src/payments/charge.js');
    const r = p.cli(['review', 'suggest', '--change', 'pay', '--base', 'main', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json().suggested).toBe('carol');
    expect(r.json().candidates[0].owns).toEqual(['src/payments/charge.js']);
    // `@bob` is Bob's id: it still matches without a handles field.
    const bob = r.json().candidates.find((candidate: { person: string }) => candidate.person === 'bob');
    expect(bob.owns).toEqual([]);
  }, 180000);

  it('negative: without the handle, @carol-s owns for nobody', () => {
    const p = project(ROLES(''), '/src/payments/ @carol-s\n');
    daveWrites(p, 'src/payments/charge.js');
    const out = p.cli(['review', 'suggest', '--change', 'pay', '--base', 'main', '--json']).json();
    for (const candidate of out.candidates) expect(candidate.owns).toEqual([]);
  }, 180000);

  it('negative: a team handle or a non-list is an invalid roles.yaml', () => {
    for (const bad of [', handles: ["@corp/payments"]', ', handles: carol-s']) {
      const p = project(ROLES(bad), '* @bob\n');
      const r = p.cli(['roles', 'check', '--json']);
      expect(r.code, bad).not.toBe(0);
      expect(r.json().status[0].code, bad).toBe('invalid_roles');
    }
  }, 180000);

  it('adopt prints the unresolved handles in text', () => {
    const root = tempDir('sdlc-adopt-handles-');
    initGitRepo(root);
    write(path.join(root, '.github/CODEOWNERS'), '* @ghost-owner\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'init']);
    const env = humanEnv(tempDir('sdlc-home-'));
    expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
    const r = runCli(['adopt'], root, env);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('@ghost-owner');
  }, 120000);
});

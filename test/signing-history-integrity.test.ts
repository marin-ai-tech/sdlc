import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

/**
 * B114 (0.16.3), from the independent review: `approvals verify --mode required` must not pass on a history it cannot
 * trust or does not have.
 * - roles.yaml deleted at HEAD while its history exists: the deletion is checked (an unsigned deletion fails); before,
 *   a missing roles.yaml made the command report ok: true.
 * - a shallow clone (CI's fetch-depth: 1) lacks the parents the check needs: required verification refuses with
 *   `shallow_history` instead of trusting what it sees.
 * - git grafts rewrite parents: required verification refuses with `rewritten_history`.
 * - a branch from before the keys that keeps its keyless roles.yaml with `git merge -s ours main` does not pass.
 */

function keypair(dir: string, name: string, email: string): { pubPath: string; pub: string } {
  const priv = path.join(dir, name);
  const r = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', email, '-f', priv], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`ssh-keygen failed: ${r.stderr}`);
  return { pubPath: `${priv}.pub`, pub: fs.readFileSync(`${priv}.pub`, 'utf-8').trim() };
}

type Key = { pubPath: string; pub: string };
type Who = { name: string; email: string; key?: Key };

function project() {
  const root = tempDir('sdlc-sign-integrity-');
  const keys = tempDir('sdlc-keys-');
  const env = humanEnv(tempDir('sdlc-home-'));
  const alice = keypair(keys, 'alice', 'alice@corp.example');
  const bob = keypair(keys, 'bob', 'bob@corp.example');
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'Alice']);
  git(root, ['config', 'user.email', 'alice@corp.example']);
  const cli = (args: string[], cwd = root) => runCli(args, cwd, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const roles = (signing: string, withKeys: boolean, maintainers = '[alice]') => [
    'version: 1', `signing: ${signing}`, 'people:',
    `  alice: { name: Alice, emails: [alice@corp.example]${withKeys ? `, signing_key: "${alice.pub}"` : ''} }`,
    `  bob: { name: Bob, emails: [bob@corp.example]${withKeys ? `, signing_key: "${bob.pub}"` : ''} }`,
    'roles:', '  product-owner: [alice]', '  engineer: [bob]', '  code-owner: [bob]', `  maintainer: ${maintainers}`,
    '',
  ].join('\n');
  const commitArgs = (as: Who, message: string) => {
    const sign = as.key ? ['-c', 'gpg.format=ssh', '-c', `user.signingkey=${as.key.pubPath}`] : [];
    return [...sign, '-c', `user.name=${as.name}`, '-c', `user.email=${as.email}`, 'commit', '-q',
      ...(as.key ? ['-S'] : []), '-m', message];
  };
  const commit = (text: string, message: string, as: Who) => {
    write(path.join(root, 'openspec/roles.yaml'), text);
    git(root, ['add', '-A']);
    git(root, commitArgs(as, message));
  };
  const ALICE = { name: 'Alice', email: 'alice@corp.example', key: alice };
  const BOB = { name: 'Bob', email: 'bob@corp.example', key: bob };
  const UNSIGNED = { name: 'Alice', email: 'alice@corp.example' };
  const verify = (cwd = root) => cli(['approvals', 'verify', '--mode', 'required', '--json'], cwd);
  return { root, cli, roles, commit, commitArgs, verify, ALICE, BOB, UNSIGNED };
}

describe('B114: required verification only on a history it can trust', () => {
  it('roles.yaml deleted at HEAD: an unsigned deletion fails required verification', () => {
    const p = project();
    p.commit(p.roles('required', true), 'roles with keys', p.ALICE);
    git(p.root, ['rm', '-q', 'openspec/roles.yaml']);
    git(p.root, p.commitArgs(p.UNSIGNED, 'delete roles.yaml'));
    const r = p.verify();
    expect(r.code).toBe(1);
    expect(r.json().ok).toBe(false);
    const statuses = r.json().results.map((x: { status: string }) => x.status);
    expect(statuses).toContain('unsigned');
  }, 180000);

  it('negative: a project that never had roles.yaml still passes as before (nothing to check)', () => {
    const p = project();
    const r = p.verify();
    expect(r.code).toBe(0);
    expect(r.json().ok).toBe(true);
  }, 120000);

  it('a shallow clone is refused for required verification', () => {
    const p = project();
    p.commit(p.roles('required', true), 'roles with keys', p.ALICE);
    p.commit(p.roles('required', true, '[bob]'), 'bob takes over, signed by bob', p.BOB);
    const clone = path.join(tempDir('sdlc-shallow-'), 'clone');
    git(path.dirname(clone), ['clone', '-q', '--depth', '1', `file://${p.root.replace(/\\/g, '/')}`, clone]);
    const r = p.verify(clone);
    expect(r.code).not.toBe(0);
    expect(r.json().status[0].code).toBe('shallow_history');
  }, 180000);

  it('git grafts are refused for required verification', () => {
    const p = project();
    p.commit(p.roles('required', true), 'roles with keys', p.ALICE);
    fs.mkdirSync(path.join(p.root, '.git/info'), { recursive: true });
    fs.writeFileSync(path.join(p.root, '.git/info/grafts'), '');
    const r = p.verify();
    expect(r.code).not.toBe(0);
    expect(r.json().status[0].code).toBe('rewritten_history');
  }, 120000);

  it('a branch from before the keys that merges main with -s ours does not pass', () => {
    const p = project();
    p.commit(p.roles('off', false), 'roles without keys', p.UNSIGNED);
    git(p.root, ['branch', 'side']);
    p.commit(p.roles('required', true), 'alice adds the keys', p.ALICE);
    git(p.root, ['checkout', '-q', 'side']);
    p.commit(p.roles('off', false, '[bob]'), 'bob as maintainer, no keys', p.UNSIGNED);
    git(p.root, ['-c', 'user.name=Carol', '-c', 'user.email=carol@corp.example', 'merge', '-q', '-s', 'ours',
      '-m', 'merge main, keep ours', 'main']);
    git(p.root, ['checkout', '-q', 'main']);
    git(p.root, ['merge', '-q', '--ff-only', 'side']);
    const r = p.verify();
    expect(r.code).toBe(1);
    expect(r.json().ok).toBe(false);
  }, 180000);
});

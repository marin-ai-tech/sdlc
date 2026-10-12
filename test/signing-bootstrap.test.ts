import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

/**
 * B114 (0.16.3): a team that turns signing on after roles.yaml already exists can reach `signing: required`.
 * Every commit of roles.yaml is checked against the roles file before it; before, the commit that added the first
 * signing keys was checked against a version without keys and stayed `bad-signature`, and the earlier unsigned commits
 * stayed `unsigned`, so `approvals verify --mode required` could never pass.
 * Trust on first keys (the customer's decision):
 * - a commit whose previous version has no signing key and that adds none is `pre-signing` (not a failure);
 * - the commit that adds the first keys is checked against its own version: signed by a maintainer listed there with
 *   a key there → `bootstrap` (not a failure); anything else fails as before;
 * - once a version has keys, every later commit needs a maintainer of the version before it, as before; removing all
 *   keys therefore needs a maintainer's signature too, so a new "first keys" cannot be forged.
 */

function keypair(dir: string, name: string, email: string): { pubPath: string; pub: string } {
  const priv = path.join(dir, name);
  const r = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', email, '-f', priv], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`ssh-keygen failed: ${r.stderr}`);
  return { pubPath: `${priv}.pub`, pub: fs.readFileSync(`${priv}.pub`, 'utf-8').trim() };
}

type Key = { pubPath: string; pub: string };

function project() {
  const root = tempDir('sdlc-sign-bootstrap-');
  const keys = tempDir('sdlc-keys-');
  const env = humanEnv(tempDir('sdlc-home-'));
  const alice = keypair(keys, 'alice', 'alice@corp.example');
  const bob = keypair(keys, 'bob', 'bob@corp.example');
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'Alice']);
  git(root, ['config', 'user.email', 'alice@corp.example']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const roles = (signing: string, withKeys: boolean, maintainers = '[alice]') => [
    'version: 1', `signing: ${signing}`, 'people:',
    `  alice: { name: Alice, emails: [alice@corp.example]${withKeys ? `, signing_key: "${alice.pub}"` : ''} }`,
    `  bob: { name: Bob, emails: [bob@corp.example]${withKeys ? `, signing_key: "${bob.pub}"` : ''} }`,
    'roles:', '  product-owner: [alice]', '  engineer: [bob]', '  code-owner: [bob]', `  maintainer: ${maintainers}`,
    '',
  ].join('\n');
  const commit = (text: string, message: string, as: { name: string; email: string; key?: Key }) => {
    write(path.join(root, 'openspec/roles.yaml'), text);
    git(root, ['add', '-A']);
    const sign = as.key ? ['-c', 'gpg.format=ssh', '-c', `user.signingkey=${as.key.pubPath}`] : [];
    const args = [...sign, '-c', `user.name=${as.name}`, '-c', `user.email=${as.email}`, 'commit', '-q'];
    git(root, [...args, ...(as.key ? ['-S'] : []), '-m', message]);
  };
  const remove = (message: string, as: { name: string; email: string; key?: Key }) => {
    git(root, ['rm', '-q', 'openspec/roles.yaml']);
    const sign = as.key ? ['-c', 'gpg.format=ssh', '-c', `user.signingkey=${as.key.pubPath}`] : [];
    const args = [...sign, '-c', `user.name=${as.name}`, '-c', `user.email=${as.email}`, 'commit', '-q'];
    git(root, [...args, ...(as.key ? ['-S'] : []), '-m', message]);
  };
  const person = ['-c', 'user.name=Carol', '-c', 'user.email=carol@corp.example'];
  const branch = (name: string) => git(root, ['branch', name]);
  const checkout = (name: string) => git(root, ['checkout', '-q', name]);
  /** An unsigned merge that keeps the branch's roles.yaml (the conflict resolved for the branch). */
  const mergeTakingTheirs = (name: string, message: string) => {
    spawnSync('git', [...person, 'merge', '-q', '--no-ff', '--no-commit', name], { cwd: root, encoding: 'utf-8' });
    // The branch's exact blob, as an attacker would take it (checkout --theirs may change the line endings).
    git(root, ['checkout', name, '--', 'openspec/roles.yaml']);
    git(root, ['add', '-A']);
    git(root, [...person, 'commit', '-q', '-m', message]);
  };
  /** An unsigned merge of `name` into the current branch that keeps the current branch's own roles.yaml blob. */
  const mergeKeepingOurs = (name: string, message: string) => {
    spawnSync('git', [...person, 'merge', '-q', '--no-ff', '--no-commit', name], { cwd: root, encoding: 'utf-8' });
    git(root, ['checkout', 'HEAD', '--', 'openspec/roles.yaml']);
    git(root, ['add', '-A']);
    git(root, [...person, 'commit', '-q', '-m', message]);
  };
  const fastForward = (name: string) => git(root, ['merge', '-q', '--ff-only', name]);
  /** An unsigned merge without conflict (main did not change roles.yaml after the branch point). */
  const mergeNoFf = (name: string, message: string) =>
    git(root, [...person, 'merge', '-q', '--no-ff', '-m', message, name]);
  const ALICE = { name: 'Alice', email: 'alice@corp.example', key: alice };
  const BOB = { name: 'Bob', email: 'bob@corp.example', key: bob };
  const UNSIGNED = { name: 'Alice', email: 'alice@corp.example' };
  const verify = () => {
    const r = cli(['approvals', 'verify', '--mode', 'required', '--json']);
    const statuses = r.json().results.filter((x: { file?: string }) => x.file === 'openspec/roles.yaml')
      .map((x: { status: string }) => x.status).reverse();
    return { code: r.code, ok: r.json().ok, statuses };
  };
  const oursMerge = (name: string, message: string) =>
    git(root, [...person, 'merge', '-q', '-s', 'ours', '-m', message, name]);
  return {
    root, cli, roles, commit, remove, verify, branch, checkout, mergeTakingTheirs, mergeKeepingOurs, fastForward,
    mergeNoFf, oursMerge, ALICE, BOB, UNSIGNED,
  };
}

describe('B114: trust on first keys for roles.yaml', () => {
  it('roles first, keys later, then required: approvals verify passes', () => {
    const p = project();
    p.commit(p.roles('off', false), 'roles without keys', p.UNSIGNED);
    p.commit(p.roles('off', true), 'add signing keys', p.ALICE);
    p.commit(p.roles('required', true), 'require signatures', p.ALICE);
    const r = p.verify();
    expect(r.statuses).toEqual(['pre-signing', 'bootstrap', 'valid']);
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
  }, 180000);

  it('negative: after the bootstrap an unsigned or a non-maintainer change still fails', () => {
    const p = project();
    p.commit(p.roles('off', false), 'roles without keys', p.UNSIGNED);
    p.commit(p.roles('required', true), 'add keys and require', p.ALICE);
    p.commit(p.roles('required', true, '[alice, bob]'), 'bob adds himself as maintainer', p.BOB);
    p.commit(p.roles('required', true, '[bob]'), 'unsigned takeover', p.UNSIGNED);
    const r = p.verify();
    expect(r.statuses).toEqual(['pre-signing', 'bootstrap', 'not-maintainer', 'unsigned']);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(1);
  }, 180000);

  it('negative: the first keys signed by a non-maintainer, or unsigned, are no bootstrap', () => {
    const byBob = project();
    byBob.commit(byBob.roles('off', false), 'roles without keys', byBob.UNSIGNED);
    byBob.commit(byBob.roles('required', true), 'keys signed by bob', byBob.BOB);
    expect(byBob.verify().statuses).toEqual(['pre-signing', 'not-maintainer']);
    const unsigned = project();
    unsigned.commit(unsigned.roles('off', false), 'roles without keys', unsigned.UNSIGNED);
    unsigned.commit(unsigned.roles('required', true), 'keys, unsigned', unsigned.UNSIGNED);
    expect(unsigned.verify().statuses).toEqual(['pre-signing', 'unsigned']);
    expect(unsigned.verify().ok).toBe(false);
  }, 180000);

  it('a commit that deletes roles.yaml is checked against the version before it, not a crash', () => {
    const p = project();
    p.commit(p.roles('required', true), 'roles with keys from the start', p.ALICE);
    p.remove('delete roles.yaml, unsigned', p.UNSIGNED);
    p.commit(p.roles('required', true, '[bob]'), 'roles again, bob as maintainer', p.BOB);
    const r = p.verify();
    expect(r.code).toBe(1);
    // Bob's re-added keys are a second set of first keys: both become bootstrap-conflict (one bootstrap only).
    expect(r.statuses).toEqual(['bootstrap-conflict', 'unsigned', 'bootstrap-conflict']);
    expect(r.ok).toBe(false);
  }, 180000);

  it('negative: removing all keys needs a maintainer, so a new bootstrap cannot be forged', () => {
    const p = project();
    p.commit(p.roles('required', true), 'roles with keys from the start', p.ALICE);
    p.commit(p.roles('off', false), 'drop every key, unsigned', p.UNSIGNED);
    p.commit(p.roles('required', true, '[bob]'), 'new keys, bob as maintainer', p.BOB);
    const r = p.verify();
    expect(r.statuses[1]).toBe('unsigned');
    expect(r.ok).toBe(false);
  }, 180000);

  it('negative: a second set of first keys is a conflict, even after a signed removal of every key', () => {
    const p = project();
    p.commit(p.roles('required', true), 'roles with keys from the start', p.ALICE);
    p.commit(p.roles('off', false), 'drop every key, signed by alice', p.ALICE);
    p.commit(p.roles('required', true, '[bob]'), 'new keys, bob as maintainer', p.BOB);
    const r = p.verify();
    expect(r.statuses).toEqual(['bootstrap-conflict', 'valid', 'bootstrap-conflict']);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(1);
  }, 180000);

  // Found while reviewing B114: a branch from a commit before the keys, with "first keys" of its own, merged with the
  // branch's roles.yaml. A plain `git log -- roles.yaml` simplifies the history and hides the main line and the merge.
  it('negative: first keys on a branch from before the keys, merged in, do not pass', () => {
    const p = project();
    p.commit(p.roles('off', false), 'roles without keys', p.UNSIGNED);
    p.branch('side');
    p.commit(p.roles('required', true), 'alice adds the keys', p.ALICE);
    p.checkout('side');
    p.commit(p.roles('required', true, '[bob]'), 'bob adds keys of his own, bob as maintainer', p.BOB);
    p.checkout('main');
    p.mergeTakingTheirs('side', 'merge side');
    const r = p.verify();
    expect(r.ok).toBe(false);
    expect(r.code).toBe(1);
    expect(r.statuses).toContain('bootstrap-conflict');
    expect(r.statuses).not.toContain('bootstrap');
  }, 180000);

  // Found in the lead's review of follow-up 2: a branch from before the keys changes roles.yaml without keys
  // (pre-signing) and is merged with its version, which silently drops the keys the main line had.
  it('negative: a stale branch merged in cannot drop the keys without a maintainer', () => {
    const p = project();
    p.commit(p.roles('off', false), 'roles without keys', p.UNSIGNED);
    p.branch('side');
    p.commit(p.roles('required', true), 'alice adds the keys', p.ALICE);
    p.checkout('side');
    p.commit(p.roles('off', false, '[bob]'), 'bob as maintainer, no keys', p.UNSIGNED);
    p.checkout('main');
    p.mergeTakingTheirs('side', 'merge side');
    const r = p.verify();
    expect(r.ok).toBe(false);
    expect(r.code).toBe(1);
    expect(r.statuses).not.toContain('merge');
  }, 180000);

  // Found by the second executor's threat model: the same downgrade with the parents swapped. The stale branch
  // merges main into itself keeping its own roles.yaml (equal to the merge's FIRST parent); main fast-forwards to it.
  it('negative: a stale branch that merges main into itself cannot drop the keys either', () => {
    const p = project();
    p.commit(p.roles('off', false), 'roles without keys', p.UNSIGNED);
    p.branch('side');
    p.commit(p.roles('required', true), 'alice adds the keys', p.ALICE);
    p.checkout('side');
    p.commit(p.roles('off', false, '[bob]'), 'bob as maintainer, no keys', p.UNSIGNED);
    p.mergeKeepingOurs('main', 'merge main into side');
    p.checkout('main');
    p.fastForward('side');
    const r = p.verify();
    expect(r.ok).toBe(false);
    expect(r.code).toBe(1);
    expect(r.statuses).not.toContain('merge');
  }, 180000);

  it('negative: a normal merge of a signed roles.yaml change passes', () => {
    const p = project();
    p.commit(p.roles('required', true), 'roles with keys from the start', p.ALICE);
    p.branch('side');
    p.checkout('side');
    p.commit(p.roles('required', true, '[alice, bob]'), 'alice adds bob as maintainer', p.ALICE);
    p.checkout('main');
    p.mergeNoFf('side', 'merge side');
    const r = p.verify();
    expect(r.statuses).toEqual(expect.arrayContaining(['bootstrap', 'valid', 'merge']));
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
  }, 180000);
});

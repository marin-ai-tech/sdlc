import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

const INTENT = '# Intent: x\n\nAuthor: Pat. Status: draft. Source: idea\n\n## Problem\nP.\n\n## Proposed outcome\nO.\n\n## Affected users and systems\nAll.\n\n## Constraints\nNone\n\n## Success measures\nM.\n\n## Out of scope\nNone\n\n## Open questions\nNone\n';

function keypair(dir: string, name: string, email: string): { pubPath: string; pub: string } {
  const priv = path.join(dir, name);
  const r = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', email, '-f', priv], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`ssh-keygen failed: ${r.stderr}`);
  return { pubPath: `${priv}.pub`, pub: fs.readFileSync(`${priv}.pub`, 'utf-8').trim() };
}

/**
 * Alice (product-owner, maintainer) and Bob (engineer) with ssh signing keys.
 * `commitAs` commits everything as a person, signed with a given key (or unsigned).
 */
function project(signing: 'off' | 'warn' | 'required') {
  const root = tempDir('sdlc-sign-');
  const keys = tempDir('sdlc-keys-');
  const env = humanEnv(tempDir('sdlc-home-'));
  const alice = keypair(keys, 'alice', 'alice@corp.example');
  const bob = keypair(keys, 'bob', 'bob@corp.example');
  initGitRepo(root);
  const identity = (name: string, email: string) => {
    git(root, ['config', 'user.name', name]);
    git(root, ['config', 'user.email', email]);
  };
  const commitAs = (name: string, email: string, key: { pubPath: string } | null, message: string) => {
    const sign = key ? ['-c', 'gpg.format=ssh', '-c', `user.signingkey=${key.pubPath}`] : [];
    git(root, ['add', '-A']);
    git(root, [...sign, '-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', ...(key ? ['-S'] : []), '-m', message]);
  };
  const cli = (args: string[]) => runCli(args, root, env);
  identity('Alice', 'alice@corp.example');
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/roles.yaml'), [
    'version: 1', `signing: ${signing}`, 'people:',
    `  alice: { name: Alice, emails: [alice@corp.example], signing_key: "${alice.pub}" }`,
    `  bob: { name: Bob, emails: [bob@corp.example], signing_key: "${bob.pub}" }`,
    'roles:', '  product-owner: [alice]', '  engineer: [bob]', '  code-owner: [bob]', '  maintainer: [alice]', '',
  ].join('\n'));
  commitAs('Alice', 'alice@corp.example', alice, 'sdlc init + roles');
  return { root, cli, identity, commitAs, alice, bob };
}

function approveIntent(p: ReturnType<typeof project>, change: string) {
  expect(p.cli(['new', change, '--json']).code).toBe(0);
  write(path.join(p.root, `openspec/changes/${change}/intent.md`), INTENT);
  const r = p.cli(['approve', 'intent', '--change', change, '--json']);
  expect(r.code, r.stdout).toBe(0);
}

describe('sdlc approvals verify', () => {
  // Signs commits with ssh-keygen and runs several approvals: ~20 s alone, past 60 s under a full parallel run.
  it('required: a valid signed approval passes; a forged one (Bob posing as Alice) fails; unsigned and uncommitted approvals fail', () => {
    const p = project('required');
    p.identity('Alice', 'alice@corp.example');
    approveIntent(p, 'good');
    p.commitAs('Alice', 'alice@corp.example', p.alice, 'approve intent good');

    p.identity('Alice', 'alice@corp.example'); // Bob sets Alice's email, but signs with his own key
    approveIntent(p, 'forged');
    p.commitAs('Alice', 'alice@corp.example', p.bob, 'approve intent forged');

    approveIntent(p, 'unsigned');
    p.commitAs('Alice', 'alice@corp.example', null, 'approve intent unsigned');

    approveIntent(p, 'pending');

    const r = p.cli(['approvals', 'verify', '--json']);
    expect(r.code).toBe(1);
    const byChange = Object.fromEntries(r.json().results.filter((x: { gate?: string }) => x.gate).map((x: { change: string; status: string }) => [x.change, x.status]));
    expect(byChange).toMatchObject({ good: 'valid', forged: 'wrong-signer', unsigned: 'unsigned', pending: 'not-committed' });
    expect(r.json()).toMatchObject({ mode: 'required', ok: false });
  }, 180000);

  it('warn: the same findings are reported but the command succeeds', () => {
    const p = project('warn');
    approveIntent(p, 'unsigned');
    p.commitAs('Alice', 'alice@corp.example', null, 'approve unsigned');
    const r = p.cli(['approvals', 'verify', '--json']);
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({ mode: 'warn', ok: false });
    expect(r.json().results.find((x: { change?: string }) => x.change === 'unsigned').status).toBe('unsigned');
  });

  it('off: nothing is checked (the mode without signatures)', () => {
    const p = project('off');
    approveIntent(p, 'unsigned');
    p.commitAs('Alice', 'alice@corp.example', null, 'approve unsigned');
    const r = p.cli(['approvals', 'verify', '--json']);
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({ mode: 'off', ok: true, results: [] });
  });

  it('roles.yaml changes must be signed by a maintainer; --mode required overrides the file for CI', () => {
    const p = project('warn');
    write(path.join(p.root, 'openspec/roles.yaml'), read(path.join(p.root, 'openspec/roles.yaml')).replace('code-owner: [bob]', 'code-owner: [bob, alice]'));
    p.commitAs('Bob', 'bob@corp.example', p.bob, 'bob widens code-owner');
    const r = p.cli(['approvals', 'verify', '--mode', 'required', '--json']);
    expect(r.code).toBe(1);
    expect(r.json().results).toEqual(expect.arrayContaining([expect.objectContaining({ file: 'openspec/roles.yaml', status: 'not-maintainer' })]));
    expect(r.json().results).toEqual(expect.arrayContaining([expect.objectContaining({ file: 'openspec/roles.yaml', status: 'valid' })]));
  });
});

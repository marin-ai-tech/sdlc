import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

/**
 * B92 (0.15.4): an approval committed (and signed) while the change was active stays valid right after the change is
 * archived, before the archive move itself is committed. `approvals verify` looked for the record in HEAD at the new
 * path under openspec/changes/archive/, found nothing and reported `not-committed`. A record that was never committed
 * is still `not-committed`.
 */

const INTENT = ['# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '',
  '## Proposed outcome', 'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '',
  '## Success measures', 'M.', '', '## Out of scope', 'None', '', '## Open questions', 'None', ''].join('\n');

function keypair(dir: string, name: string, email: string): { pubPath: string; pub: string } {
  const priv = path.join(dir, name);
  const r = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', email, '-f', priv], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`ssh-keygen failed: ${r.stderr}`);
  return { pubPath: `${priv}.pub`, pub: fs.readFileSync(`${priv}.pub`, 'utf-8').trim() };
}

function project() {
  const root = tempDir('sdlc-sign-archive-');
  const keys = tempDir('sdlc-keys-');
  const env = humanEnv(tempDir('sdlc-home-'));
  const alice = keypair(keys, 'alice', 'alice@corp.example');
  initGitRepo(root);
  git(root, ['config', 'user.name', 'Alice']);
  git(root, ['config', 'user.email', 'alice@corp.example']);
  const commit = (message: string) => {
    git(root, ['add', '-A']);
    git(root, ['-c', 'gpg.format=ssh', '-c', `user.signingkey=${alice.pubPath}`, 'commit', '-q', '-S', '-m', message]);
  };
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/roles.yaml'), ['version: 1', 'signing: required', 'people:',
    `  alice: { name: Alice, emails: [alice@corp.example], signing_key: "${alice.pub}" }`,
    'roles:', '  product-owner: [alice]', '  engineer: [alice]', '  code-owner: [alice]', '  maintainer: [alice]',
    ''].join('\n'));
  commit('sdlc init + roles');
  const approve = (change: string) => {
    expect(cli(['new', change, '--json']).code).toBe(0);
    write(path.join(root, `openspec/changes/${change}/intent.md`), INTENT);
    const r = cli(['approve', 'intent', '--change', change, '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
  };
  /** The archive move as `sdlc archive` makes it, not yet committed. */
  const moveToArchive = (change: string) => {
    const archive = path.join(root, 'openspec/changes/archive');
    fs.mkdirSync(archive, { recursive: true });
    fs.renameSync(path.join(root, 'openspec/changes', change), path.join(archive, `2026-10-12-${change}`));
  };
  const status = (change: string) => {
    const r = cli(['approvals', 'verify', '--json']);
    const result = r.json().results.find((item: { change?: string; gate?: string }) => item.change === change);
    return result?.status;
  };
  return { approve, commit, moveToArchive, status };
}

describe('B92: approvals of a change archived but not yet committed', () => {
  it('a committed, signed approval stays valid after the uncommitted archive move', () => {
    const p = project();
    p.approve('add-export');
    p.commit('approve intent');
    expect(p.status('add-export')).toBe('valid');
    p.moveToArchive('add-export');
    expect(p.status('add-export')).toBe('valid');
    p.commit('archive add-export');
    expect(p.status('add-export')).toBe('valid');
  }, 120000);

  it('negative: an approval never committed is still not-committed after the move', () => {
    const p = project();
    p.approve('add-import');
    p.moveToArchive('add-import');
    expect(p.status('add-import')).toBe('not-committed');
  }, 120000);
});

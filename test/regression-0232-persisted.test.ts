import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { writeProposal } from '../src/core/config-proposals.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir } from './helpers.js';

/**
 * Regression of 0.23.2 found in the E10 run (2026-10-18). 0.23.2 made `signing_key` strict (an OpenSSH public key
 * line). Records written under the old rule then broke the commands that read them:
 * - a dismissed proposal whose roles.yaml content had a path as `signing_key` made `sdlc config show` (the list) and
 *   `sdlc config propose` (the next id) fail with "contains invalid configuration";
 * - a roles.yaml version in git history with such a key would make `sdlc approvals verify` fail while it checks
 *   the history.
 * Records are history: closed proposals and past roles.yaml versions are read as they are. The strict rule applies to
 * what is decided now: the current roles.yaml and an open proposal.
 */

const ROLES = (key: string) => [
  'version: 1', 'signing: off', 'people:',
  `  pat: { name: Pat Owner, emails: [pat@example.com]${key ? `, signing_key: "${key}"` : ''} }`,
  'roles:', '  product-owner: [pat]', '  maintainer: [pat]', '',
].join('\n');

function project() {
  const root = tempDir('sdlc-0232-persisted-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  fs.writeFileSync(path.join(root, 'openspec/roles.yaml'), ROLES(''));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'sdlc']);
  return { root, cli };
}

function oldProposal(root: string, id: string, status: 'open' | 'dismissed'): void {
  const current = read(path.join(root, 'openspec/roles.yaml'));
  writeProposal(root, {
    id, target: 'roles', reason: 'Keys', by: 'Pat Owner', when: '2026-10-17T21:00:00.000Z',
    baseDigest: `sha256:${createHash('sha256').update(current).digest('hex')}`,
    content: ROLES('../keys/pat.pub'), status, ...(status === 'dismissed' ? { note: 'A path, not a key' } : {}),
  }, true);
}

describe('0.23.2 regression: records written under the old signing_key rule stay readable', () => {
  it('a dismissed proposal with a path key is listed and shown; propose still works', () => {
    const p = project();
    oldProposal(p.root, 'C1', 'dismissed');
    const list = p.cli(['config', 'show']);
    expect(list.code, list.stdout + list.stderr).toBe(0);
    expect(list.stdout).toMatch(/C1/);
    expect(p.cli(['config', 'show', 'C1']).code).toBe(0);
    const next = p.cli(['config', 'propose', '--target', 'roles', '--set', 'signing=warn', '--reason', 'R', '--json']);
    expect(next.code, next.stdout + next.stderr).toBe(0);
    expect(next.json<{ id: string }>().id).toBe('C2');
  }, 240000);

  it('negative: an open proposal with a path key is still refused when applied', () => {
    const p = project();
    oldProposal(p.root, 'C1', 'open');
    expect(p.cli(['config', 'show']).code).toBe(0);
    const apply = p.cli(['config', 'apply', 'C1', '--yes']);
    expect(apply.code).not.toBe(0);
    expect(apply.stdout + apply.stderr).toMatch(/signing_key|invalid/i);
  }, 240000);

  it('a roles.yaml version in history with a placeholder key does not break approvals verify', () => {
    const p = project();
    fs.writeFileSync(path.join(p.root, 'openspec/roles.yaml'), ROLES('ssh-ed25519 AAAA… pat@corp'));
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'keys from the docs example']);
    fs.writeFileSync(path.join(p.root, 'openspec/roles.yaml'), ROLES(''));
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'drop the placeholder']);
    const r = p.cli(['approvals', 'verify', '--mode', 'warn']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(/must be one OpenSSH public key line/);
  }, 240000);
});

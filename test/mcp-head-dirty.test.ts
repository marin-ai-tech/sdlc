import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B111 (0.17.0): a `verify.mcp` (or `release.mcp`) check whose arguments use `${HEAD}` asks about the last commit,
 * while `sdlc verify` checks the working tree. With uncommitted changes outside openspec/, the commit is not the code
 * that was verified, so such a check is not called: it fails with a reason that says to commit (and push) first.
 * A check without `${HEAD}` runs as before; changes only under openspec/ do not count (they are not code).
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');
const AGENT = { CLAUDECODE: '1' };

function project(args: Record<string, string>) {
  const root = tempDir('sdlc-head-dirty-');
  const calls = path.join(tempDir('sdlc-head-dirty-count-'), 'count.txt');
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_PENDING_FILE: calls, FAKE_PENDING_COUNT: '0' });
  initGitRepo(root);
  write(path.join(root, 'src/app.js'), 'export const a = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const cli = (argv: string[], extra: NodeJS.ProcessEnv = {}) => runCli(argv, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(cli(['new', 'add-export', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/changes/add-export/tasks.md'), '# Tasks\n\n- [x] 1.1 done\n');
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.mcp = { servers: { build: { type: 'stdio', command: ['node', FAKE], stages: ['build', 'test'] } } };
  config.verify.commands = [{ name: 'ok', run: 'node -e 0', required: true }];
  const check = { name: 'ci-green', server: 'build', tool: 'pipeline_status', args, expect: { status: 'success' } };
  config.verify.mcp = [check];
  write(file, stringify(config));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'sdlc']);
  const count = () => (fs.existsSync(calls) ? Number(read(calls)) : 0);
  const verify = () => cli(['verify', '--change', 'add-export', '--json'], AGENT);
  return { root, verify, count };
}

describe('B111: ${HEAD} only when the commit is the verified code', () => {
  it('with uncommitted code the ${HEAD} check is not called and fails with a reason to commit', () => {
    const p = project({ ref: '${HEAD}' });
    write(path.join(p.root, 'src/app.js'), 'export const a = 2;\n');
    const r = p.verify();
    expect(r.json().status).toBe('failed');
    expect(r.json().mcp[0].ok).toBe(false);
    expect(String(r.json().mcp[0].reason)).toMatch(/commit/i);
    expect(p.count()).toBe(0);
  }, 180000);

  it('an untracked file outside openspec/ counts as uncommitted code too', () => {
    const p = project({ ref: '${HEAD}' });
    write(path.join(p.root, 'src/new.js'), 'export const b = 1;\n');
    expect(p.verify().json().mcp[0].ok).toBe(false);
    expect(p.count()).toBe(0);
  }, 180000);

  it('negative: once committed the ${HEAD} check runs and passes', () => {
    const p = project({ ref: '${HEAD}' });
    write(path.join(p.root, 'src/app.js'), 'export const a = 2;\n');
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'work']);
    const r = p.verify();
    expect(r.json().mcp[0]).toMatchObject({ name: 'ci-green', ok: true });
    expect(p.count()).toBe(1);
  }, 180000);

  it('negative: changes only under openspec/ do not block the ${HEAD} check', () => {
    const p = project({ ref: '${HEAD}' });
    write(path.join(p.root, 'openspec/changes/add-export/notes.md'), 'notes\n');
    expect(p.verify().json().mcp[0].ok).toBe(true);
  }, 180000);

  it('negative: a check without ${HEAD} runs with uncommitted code as before', () => {
    const p = project({ ref: 'main' });
    write(path.join(p.root, 'src/app.js'), 'export const a = 2;\n');
    expect(p.verify().json().mcp[0].ok).toBe(true);
    expect(p.count()).toBe(1);
  }, 180000);
});

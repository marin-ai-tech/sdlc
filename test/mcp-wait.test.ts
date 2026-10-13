import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.15.1: a `verify.mcp` (or `release.mcp`) check may wait for a CI run that has not finished: `wait_while` is a
 * deep subset like `expect` (e.g. `{ status: in_progress }`, or a list of values `{ status: [queued, in_progress] }`)
 * and `wait_seconds` the longest wait (default 0 = no wait, as before). While the answer matches `wait_while`, the CLI
 * calls the tool again after a short pause; past `wait_seconds` the check fails with a reason that says the run is
 * still pending. Before, a pending run simply failed the check.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');
const AGENT = { CLAUDECODE: '1' };

function project(check: Record<string, unknown>) {
  const root = tempDir('sdlc-mcp-wait-');
  const pending = path.join(tempDir('sdlc-mcp-wait-count-'), 'count.txt');
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_PENDING_FILE: pending });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  // The change first: a check with an invalid configuration must not stop the setup itself.
  expect(cli(['new', 'add-export', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/changes/add-export/tasks.md'), '# Tasks\n\n- [x] 1.1 done\n');
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.mcp = { servers: { build: { type: 'stdio', command: ['node', FAKE], stages: ['build', 'test'] } } };
  config.verify.commands = [{ name: 'ok', run: 'node -e 0', required: true }];
  config.verify.mcp = [{ name: 'ci-green', server: 'build', tool: 'pipeline_status', args: { ref: '${HEAD}' },
    expect: { status: 'success' }, ...check }];
  write(file, stringify(config));
  // 0.17.0 (B111): a ${HEAD} check runs only on committed code, so the project is committed before verify.
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'sdlc']);
  const calls = () => (fs.existsSync(pending) ? Number(read(pending)) : 0);
  const verify = (extra: NodeJS.ProcessEnv) =>
    cli(['verify', '--change', 'add-export', '--json'], { ...AGENT, ...extra });
  return { cli, verify, calls };
}

describe('waiting for a CI run that has not finished', () => {
  it('waits while the answer matches wait_while, then passes on success', () => {
    const p = project({ wait_while: { status: ['queued', 'in_progress'] }, wait_seconds: 60 });
    const r = p.verify({ FAKE_PENDING_COUNT: '2' });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json().status).toBe('passed');
    expect(r.json().mcp[0]).toMatchObject({ name: 'ci-green', ok: true });
    expect(p.calls()).toBe(3);
  }, 180000);

  it('fails with a pending reason once wait_seconds is over', () => {
    const p = project({ wait_while: { status: 'in_progress' }, wait_seconds: 2 });
    const r = p.verify({ FAKE_PENDING_COUNT: '1000' });
    expect(r.json().status).toBe('failed');
    expect(r.json().mcp[0].ok).toBe(false);
    expect(String(r.json().mcp[0].reason)).toMatch(/pending|still|wait/i);
    expect(p.calls()).toBeGreaterThan(1);
  }, 180000);

  it('negative: without wait_while a pending run fails at once, as before (one call)', () => {
    const p = project({});
    const r = p.verify({ FAKE_PENDING_COUNT: '1' });
    expect(r.json().status).toBe('failed');
    expect(p.calls()).toBe(1);
  }, 180000);

  it('negative: wait_seconds that is not a number from 0 to 3600 is a configuration error', () => {
    const p = project({ wait_while: { status: 'in_progress' }, wait_seconds: 99999 });
    const r = p.cli(['status', '--json']);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('invalid_config');
  }, 180000);
});

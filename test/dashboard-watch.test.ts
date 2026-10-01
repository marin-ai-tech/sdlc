import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIN, git, humanEnv, initGitRepo, REPO_ROOT, runCli, tempDir } from './helpers.js';

const SCRIPT = path.join(REPO_ROOT, 'scripts/examples/dashboard-watch.mjs');
const CLI = `"${process.execPath}" "${BIN}"`;

function project() {
  const root = tempDir('sdlc-watch-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
  return { root, env, cli: (args: string[]) => runCli(args, root, env) };
}

const waitFor = async (check: () => boolean, ms: number) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return check();
};

describe('scripts/examples/dashboard-watch.mjs', () => {
  it('--once builds the dashboard and exits', () => {
    const { root, env } = project();
    const r = spawnSync(process.execPath, [SCRIPT, '--once', '--out', 'reports/dashboard.html', '--cli', CLI], { cwd: root, env, encoding: 'utf-8' });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(path.join(root, 'reports/dashboard.html'), 'utf-8')).toMatch(/^<!doctype html>/i);
  });

  it('watch mode rebuilds after openspec/ changes (debounced) and stops cleanly', async () => {
    const { root, env, cli } = project();
    const out = path.join(root, 'reports/dashboard.html');
    const child = spawn(process.execPath, [SCRIPT, '--out', 'reports/dashboard.html', '--cli', CLI, '--debounce', '300', '--min-interval', '0'], { cwd: root, env });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    try {
      expect(await waitFor(() => fs.existsSync(out), 20000), log).toBe(true);
      cli(['backlog', 'add', 'Watched item', '--json']);
      expect(await waitFor(() => fs.readFileSync(out, 'utf-8').includes('Watched item') || /Watched item/.test(log), 30000), log).toBe(true);
      expect(fs.readFileSync(out, 'utf-8')).toContain('Watched item');
    } finally {
      child.kill('SIGINT');
    }
    const code = await new Promise<number | null>((resolve) => child.on('exit', (c) => resolve(c)));
    expect([0, null]).toContain(code);
    expect(log).toMatch(/rebuilt|updated/i);
  }, 90000);

  it('--serve answers on localhost with the page and an auto-refresh', async () => {
    const { root, env } = project();
    const child = spawn(process.execPath, [SCRIPT, '--out', 'reports/dashboard.html', '--cli', CLI, '--serve', '127.0.0.1:0'], { cwd: root, env });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    try {
      expect(await waitFor(() => /http:\/\/127\.0\.0\.1:\d+/.test(log), 20000), log).toBe(true);
      const url = log.match(/http:\/\/127\.0\.0\.1:\d+\/?/)![0];
      const body = await new Promise<string>((resolve, reject) => {
        http.get(url, (res) => {
          let b = '';
          res.on('data', (d) => (b += d));
          res.on('end', () => resolve(b));
        }).on('error', reject);
      });
      expect(body).toMatch(/<!doctype html>/i);
      expect(body).toMatch(/http-equiv="refresh"|EventSource|location\.reload/i);
    } finally {
      child.kill('SIGINT');
    }
  }, 60000);

  it('negative: unknown options print usage and exit 2; outside a project it says so', () => {
    const bad = spawnSync(process.execPath, [SCRIPT, '--nope'], { encoding: 'utf-8' });
    expect(bad.status).toBe(2);
    expect(bad.stderr + bad.stdout).toMatch(/usage/i);
    const outside = tempDir('sdlc-watch-none-');
    const r = spawnSync(process.execPath, [SCRIPT, '--once', '--cli', CLI], { cwd: outside, encoding: 'utf-8', env: humanEnv(tempDir('sdlc-home-')) });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/openspec|sdlc init|project/i);
  });
});

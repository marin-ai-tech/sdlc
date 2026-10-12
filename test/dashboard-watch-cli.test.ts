import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIN, git, humanEnv, initGitRepo, runCli, tempDir } from './helpers.js';

/**
 * B103 (0.16.1): `sdlc dashboard --watch` keeps the dashboard page up to date: it builds the page, watches
 * openspec/ and rebuilds after changes (debounced, never two builds at once), and with `--serve host:port` serves
 * the page with an auto-refresh (the refresh tag goes into the response, never into the file). It stops cleanly on
 * SIGINT/SIGTERM. Before, this was only an example script that was not in the npm package.
 */

function project() {
  const root = tempDir('sdlc-watch-cli-');
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
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return check();
};

function watchProcess(root: string, env: NodeJS.ProcessEnv, extra: string[]) {
  const args = [BIN, 'dashboard', '--watch', '--out', 'reports/dashboard.html', ...extra];
  const child = spawn(process.execPath, args, { cwd: root, env });
  const out = { log: '' };
  child.stdout.on('data', (data) => (out.log += data));
  child.stderr.on('data', (data) => (out.log += data));
  // Listen from the start: a process that already exited must not make stop() wait for the timeout.
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  const stop = async () => {
    child.kill('SIGINT');
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 10000));
    const result = await Promise.race([exited, timeout]);
    if (result === 'timeout') child.kill('SIGKILL');
    return result;
  };
  return { out, stop };
}

function get(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (data) => (body += data));
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

describe('B103: sdlc dashboard --watch', () => {
  it('builds the page, rebuilds after an openspec/ change and stops cleanly', async () => {
    const { root, env, cli } = project();
    const page = path.join(root, 'reports/dashboard.html');
    const watch = watchProcess(root, env, ['--debounce', '300', '--min-interval', '0']);
    try {
      expect(await waitFor(() => fs.existsSync(page), 20000), watch.out.log).toBe(true);
      expect(fs.readFileSync(page, 'utf-8')).toMatch(/^<!doctype html>/i);
      expect(fs.readFileSync(page, 'utf-8')).not.toMatch(/http-equiv="refresh"/i);
      cli(['backlog', 'add', 'Watched item', '--json']);
      const rebuilt = () => fs.readFileSync(page, 'utf-8').includes('Watched item');
      expect(await waitFor(rebuilt, 30000), watch.out.log).toBe(true);
    } finally {
      expect([0, null]).toContain(await watch.stop());
    }
  }, 90000);

  it('--serve answers on localhost with the page and an auto-refresh', async () => {
    const { root, env } = project();
    const watch = watchProcess(root, env, ['--serve', '127.0.0.1:0']);
    try {
      const served = () => /http:\/\/127\.0\.0\.1:\d+/.test(watch.out.log);
      expect(await waitFor(served, 20000), watch.out.log).toBe(true);
      const url = watch.out.log.match(/http:\/\/127\.0\.0\.1:\d+\/?/)![0];
      const body = await get(url);
      expect(body).toMatch(/<!doctype html>/i);
      expect(body).toMatch(/http-equiv="refresh"|EventSource|location\.reload/i);
    } finally {
      await watch.stop();
    }
  }, 60000);

  it('negative: --serve without --watch, a bad address or a bad number is refused', () => {
    const { cli } = project();
    const refused = [['--serve', '127.0.0.1:0'], ['--watch', '--serve', 'nohost'], ['--watch', '--debounce', '-1']];
    for (const args of refused) {
      const r = cli(['dashboard', '--out', 'reports/d.html', ...args, '--json']);
      expect(r.code, args.join(' ')).not.toBe(0);
    }
  }, 60000);
});

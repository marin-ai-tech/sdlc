import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { runVerification } from '../src/core/verify.js';
import { initGitRepo, tempDir, write } from './helpers.js';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stop(pid: number): void {
  if (!alive(pid)) return;
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`], { windowsHide: true });
  } else process.kill(pid, 'SIGKILL');
}

describe('B131: verification timeouts terminate descendants', () => {
  it.each([false, true])('returns near the deadline with detached grandchild = %s', async (detached) => {
    const root = tempDir('sdlc-process-tree-');
    initGitRepo(root);
    write(path.join(root, 'grandchild.cjs'), [
      "require('fs').writeFileSync('grandchild.pid', String(process.pid));",
      'setTimeout(() => {}, 14000);',
    ].join('\n'));
    write(path.join(root, 'child.cjs'), [
      "require('fs').writeFileSync('child.pid', String(process.pid));",
      `require('child_process').spawn(process.execPath, ['grandchild.cjs'], { detached: ${detached}, stdio: 'inherit' });`,
      'setTimeout(() => {}, 14000);',
    ].join('\n'));
    const config = defaultConfig();
    config.verify.commands = [{ name: 'tree', run: 'node child.cjs', required: true }];
    config.verify.timeoutSeconds = 2;
    const started = Date.now();
    const result = await runVerification(root, config);
    const elapsed = Date.now() - started;
    const pids = ['child.pid', 'grandchild.pid'].map((file) => Number(fs.readFileSync(path.join(root, file), 'utf8')));
    try {
      expect(result.status).toBe('failed');
      expect(result.checks[0].timed_out).toBe(true);
      expect(result.checks[0].exit_code).toBeNull();
      expect(elapsed).toBeLessThan(9000);
      expect(pids.filter(alive)).toEqual([]);
    } finally {
      pids.forEach(stop);
    }
  }, 25000);

  it('preserves exit code and captured output for a normal check', async () => {
    const root = tempDir('sdlc-process-ok-');
    initGitRepo(root);
    const config = defaultConfig();
    config.verify.commands = [{ name: 'ok', run: 'node -e "console.log(42)"', required: true }];
    const result = await runVerification(root, config);
    expect(result.status).toBe('passed');
    expect(result.checks[0]).toMatchObject({ exit_code: 0, output: '42' });
    expect(result.checks[0]).not.toHaveProperty('timed_out');
  }, 20000);
});

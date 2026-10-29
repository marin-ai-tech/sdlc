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
      'setTimeout(() => {}, 30000);',
    ].join('\n'));
    write(path.join(root, 'child.cjs'), [
      "require('fs').writeFileSync('child.pid', String(process.pid));",
      `require('child_process').spawn(process.execPath, ['grandchild.cjs'], { detached: ${detached}, stdio: 'inherit' });`,
      'setTimeout(() => {}, 30000);',
    ].join('\n'));
    const config = defaultConfig();
    config.verify.commands = [{ name: 'tree', run: 'node child.cjs', required: true }];
    // The Windows wrapper compiles its job class before the command starts (2-3 s under load); the timeout must
    // outlast that start-up, or the wrapper is stopped before child.pid exists.
    config.verify.timeoutSeconds = 8;
    const started = Date.now();
    const result = await runVerification(root, config);
    const elapsed = Date.now() - started;
    const pids = ['child.pid', 'grandchild.pid'].map((file) => Number(fs.readFileSync(path.join(root, file), 'utf8')));
    try {
      expect(result.status).toBe('failed');
      expect(result.checks[0].timed_out).toBe(true);
      expect(result.checks[0].exit_code).toBeNull();
      expect(elapsed).toBeLessThan(15000);
      expect(pids.filter(alive)).toEqual([]);
    } finally {
      pids.forEach(stop);
    }
  }, 45000);

  // B133 review round 1 (F4): on Linux `sh -c 'node child.cjs'` replaces the shell with node, so the case above
  // never times out after the shell's exit. These two do; they run on POSIX only (Linux CI before the release tag).
  it.skipIf(process.platform === 'win32')('kills the group that outlived its shell after a timeout', async () => {
    const root = tempDir('sdlc-process-tree-exited-');
    initGitRepo(root);
    write(path.join(root, 'grandchild.cjs'), [
      "require('fs').writeFileSync('grandchild.pid', String(process.pid));",
      'setTimeout(() => {}, 30000);',
    ].join('\n'));
    write(path.join(root, 'child.cjs'), [
      "require('fs').writeFileSync('child.pid', String(process.pid));",
      "require('child_process').spawn(process.execPath, ['grandchild.cjs'], { stdio: 'inherit' });",
      'setTimeout(() => {}, 30000);',
    ].join('\n'));
    const config = defaultConfig();
    // The shell exits at once; the background child keeps the output open, so the check reaches its limit.
    config.verify.commands = [{ name: 'tree', run: 'node child.cjs & exit 0', required: true }];
    config.verify.timeoutSeconds = 3;
    const result = await runVerification(root, config);
    const pids = ['child.pid', 'grandchild.pid'].map((file) => Number(fs.readFileSync(path.join(root, file), 'utf8')));
    try {
      expect(result.checks[0].timed_out).toBe(true);
      expect(result.checks[0].exit_code).toBeNull();
      expect(result.checks[0].output).not.toContain('sent no signal');
      expect(pids.filter(alive)).toEqual([]);
    } finally {
      pids.forEach(stop);
    }
  }, 45000);

  it.skipIf(process.platform === 'win32')('notes that no signal was sent when only another session is left',
    async () => {
      const root = tempDir('sdlc-process-tree-escaped-');
      initGitRepo(root);
      write(path.join(root, 'daemon.cjs'), [
        "require('fs').writeFileSync('daemon.pid', String(process.pid));",
        'setTimeout(() => {}, 30000);',
      ].join('\n'));
      // The launcher starts a daemon in its own session that keeps the output open, then exits at once, so the
      // check's group is empty when the shell's exit is observed: the accepted limit, reported by the note.
      write(path.join(root, 'launcher.cjs'), [
        "require('child_process').spawn(process.execPath, ['daemon.cjs'], { detached: true, stdio: 'inherit' })",
        '  .unref();',
      ].join('\n'));
      const config = defaultConfig();
      config.verify.commands = [{ name: 'tree', run: 'node launcher.cjs', required: true }];
      config.verify.timeoutSeconds = 3;
      const result = await runVerification(root, config);
      const daemon = Number(fs.readFileSync(path.join(root, 'daemon.pid'), 'utf8'));
      try {
        expect(result.checks[0].timed_out).toBe(true);
        expect(result.checks[0].exit_code).toBeNull();
        expect(result.checks[0].output)
          .toContain("Process tree cleanup sent no signal: the check's shell had already exited.");
        expect(alive(daemon)).toBe(true);
      } finally {
        stop(daemon);
      }
    }, 45000);

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

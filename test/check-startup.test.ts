import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runOwnedCheck } from '../src/core/check-lifecycle.js';
import { CHECK_STARTUP_MS, resolveCheckPowerShell } from '../src/core/check-startup.js';
import { tempDir } from './helpers.js';

vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(), spawn: vi.fn(),
}));
vi.mock('node:fs', async (original) => ({
  ...await original<typeof import('node:fs')>(), statSync: vi.fn(),
}));
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

describe('Windows startup resolution boundary', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses an absolute platform runtime path instead of a PATH-dependent wrapper name', () => {
    const root = tempDir('sdlc-windows-directory-');
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats);
    const executable = resolveCheckPowerShell({ SystemRoot: root, PATH: '' });
    expect(path.isAbsolute(executable)).toBe(true);
    expect(executable).toBe(path.join(root, 'System32/WindowsPowerShell/v1.0/powershell.exe'));
  });

  it('a missing PowerShell refuses before starting any command and never reports a command timeout', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw Object.assign(new Error('not present'), { code: 'ENOENT' });
    });
    const result = await runOwnedCheck('/unused', { name: 'never', run: 'never-run', required: true }, 1, 20);
    expect(result.exit_code).toBe(1);
    expect(result.output).toMatch(/PowerShell.*missing/i);
    expect(result).not.toHaveProperty('timed_out');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('bounds an unready wrapper separately at 30000 ms without manufacturing command execution', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    vi.useFakeTimers();
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats);
    const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null,
      stdout: null, stderr: null, kill: vi.fn(() => false) });
    vi.mocked(spawn).mockReturnValue(child as never);
    const pending = runOwnedCheck('/unused', { name: 'unready', run: 'never-started', required: true }, 1, 20);
    await vi.advanceTimersByTimeAsync(CHECK_STARTUP_MS + 100);
    const result = await pending;
    expect(result.exit_code).toBe(1);
    expect(result.output).toContain('startup exceeded 30000 ms');
    expect(result).not.toHaveProperty('timed_out');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { stopProcessTree } from '../src/core/process-tree.js';
import { runVerification } from '../src/core/verify.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../src/core/process-tree.js', () => ({ stopProcessTree: vi.fn() }));
vi.mock('../src/core/git.js', () => ({ worktreeFingerprint: () => 'git-tree:abc', headCommit: () => 'abc',
  isDirty: () => false }));

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

describe('Handled termination forwards only to owned groups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    vi.useFakeTimers();
    vi.spyOn(process, 'kill').mockReturnValue(true);
    vi.mocked(stopProcessTree).mockResolvedValue({ signalled: true });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(['SIGINT', 'SIGTERM'] as const)('forwards %s, performs bounded cleanup and removes its handler', async (signal) => {
    const before = process.listeners(signal);
    const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null,
      stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    vi.mocked(spawn).mockReturnValue(child as never);
    const config = defaultConfig();
    config.verify.commands = [{ name: 'owned', run: 'command', required: true }];
    config.verify.timeoutSeconds = 10;
    const pending = runVerification('/unused', config);
    try {
      const handlers = process.listeners(signal).filter((handler) => !before.includes(handler));
      expect(handlers).toHaveLength(1);
      handlers[0](signal);
      await vi.advanceTimersByTimeAsync(8000);
      const result = await pending;
      expect(process.kill).toHaveBeenCalledWith(-123, signal);
      expect(vi.mocked(process.kill).mock.calls.some(([pid]) => pid === 123 || pid === 999)).toBe(false);
      expect(stopProcessTree).toHaveBeenCalledTimes(1);
      expect(result.checks[0]).not.toHaveProperty('timed_out');
      expect(result.status).toBe('failed');
      expect(process.listeners(signal)).toEqual(before);
    } finally {
      await vi.advanceTimersByTimeAsync(18000);
      await pending;
    }
  });
});

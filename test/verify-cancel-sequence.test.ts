import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { runVerification } from '../src/core/verify.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../src/core/process-tree.js', () => ({ stopProcessTree: vi.fn(async () => ({ signalled: true })) }));
vi.mock('../src/core/git.js', () => ({ worktreeFingerprint: () => 'git-tree:abc', headCommit: () => 'abc',
  isDirty: () => false }));
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

describe('Cancellation stops the remaining verification sequence', () => {
  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('records cancellation without timeout and never starts the next check', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    vi.useFakeTimers();
    vi.spyOn(process, 'kill').mockReturnValue(true);
    const before = process.listeners('SIGINT');
    vi.mocked(spawn).mockImplementation(() => Object.assign(new EventEmitter(), { pid: 123, exitCode: null,
      signalCode: null, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() }) as never);
    const config = defaultConfig();
    config.verify.commands = [{ name: 'first', run: 'first', required: true },
      { name: 'second', run: 'second', required: true }];
    config.verify.timeoutSeconds = 1;
    const pending = runVerification('/unused', config);
    const handler = process.listeners('SIGINT').find((candidate) => !before.includes(candidate));
    expect(handler).toBeDefined();
    handler!('SIGINT');
    await vi.advanceTimersByTimeAsync(10000);
    const result = await pending;
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({ cancelled: 'SIGINT', exit_code: null });
    expect(result.checks[0]).not.toHaveProperty('timed_out');
    expect(result.status).toBe('failed');
  });

  it('an ordinary failed command still allows the remaining configured checks to run', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    vi.useFakeTimers();
    vi.spyOn(process, 'kill').mockReturnValue(true);
    vi.mocked(spawn).mockClear();
    let invocation = 0;
    vi.mocked(spawn).mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null as number | null,
        signalCode: null, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
      const code = invocation++ === 0 ? 7 : 0;
      queueMicrotask(() => {
        child.exitCode = code;
        child.emit('exit', code, null);
      });
      return child as never;
    });
    const config = defaultConfig();
    config.verify.commands = [{ name: 'first', run: 'first', required: true },
      { name: 'second', run: 'second', required: true }];
    const pending = runVerification('/unused', config);
    await vi.advanceTimersByTimeAsync(10000);
    const result = await pending;
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(result.checks.map((check) => check.exit_code)).toEqual([7, 0]);
    expect(result.checks.some((check) => check.cancelled !== undefined)).toBe(false);
    expect(result.status).toBe('failed');
  });
});

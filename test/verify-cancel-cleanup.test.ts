import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { stopProcessTree } from '../src/core/process-tree.js';
import { runVerification } from '../src/core/verify.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../src/core/process-tree.js', () => ({ stopProcessTree: vi.fn(async () => ({ signalled: true })) }));
vi.mock('../src/core/git.js', () => ({ worktreeFingerprint: () => 'git-tree:abc', headCommit: () => 'abc',
  isDirty: () => false }));
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

describe('Cancellation during owned post-exit cleanup', () => {
  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([true, false])('stops later checks during post-exit cancellation; first required = %s', async (required) => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    vi.useFakeTimers();
    vi.spyOn(process, 'kill').mockReturnValue(true);
    const before = process.listeners('SIGTERM');
    let first: ReturnType<typeof fakeChild>;
    vi.mocked(spawn).mockClear();
    vi.mocked(spawn).mockImplementation(() => {
      const child = fakeChild();
      first ??= child;
      return child as never;
    });
    vi.mocked(stopProcessTree).mockImplementationOnce(() => new Promise(() => {}));
    const config = defaultConfig();
    config.verify.commands = [{ name: 'first', run: 'first', required },
      { name: 'second', run: 'second', required: true }];
    config.verify.timeoutSeconds = 1;
    const pending = runVerification('/unused', config);
    await vi.advanceTimersByTimeAsync(50);
    first!.exitCode = 0;
    first!.emit('exit', 0, null);
    process.listeners('SIGTERM').find((handler) => !before.includes(handler))!('SIGTERM');
    await vi.advanceTimersByTimeAsync(10000);
    const result = await pending;
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(result.checks[0]).toMatchObject({ exit_code: 0, cancelled: 'SIGTERM' });
    expect(result.checks[0]).not.toHaveProperty('timed_out');
    expect(result.status).toBe('failed');
    expect(process.kill).not.toHaveBeenCalledWith(-123, 'SIGTERM');
  });
});

function fakeChild() {
  return Object.assign(new EventEmitter(), { pid: 123, exitCode: null as number | null,
    signalCode: null, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
}

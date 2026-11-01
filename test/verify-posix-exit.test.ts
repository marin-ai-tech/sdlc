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

function child() {
  return Object.assign(new EventEmitter(), { pid: 123, exitCode: null as number | null,
    signalCode: null, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
}

describe('Observed POSIX exit is independent of lingering output', () => {
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

  it.each([0, 7])('preserves observed exit %s after bounded owned cleanup with no close event', async (code) => {
    const process = child();
    vi.mocked(spawn).mockReturnValue(process as never);
    const config = defaultConfig();
    config.verify.commands = [{ name: 'owned', run: 'command', required: true }];
    config.verify.timeoutSeconds = 1;
    const pending = runVerification('/unused', config);
    await vi.advanceTimersByTimeAsync(500);
    process.exitCode = code;
    process.emit('exit', code, null);
    await vi.advanceTimersByTimeAsync(8000);
    const result = await pending;
    expect(result.checks[0].exit_code).toBe(code);
    expect(result.checks[0]).not.toHaveProperty('timed_out');
    expect(result.status).toBe(code === 0 ? 'passed' : 'failed');
    expect(stopProcessTree).toHaveBeenCalledTimes(1);
    expect(process.stdout.destroyed).toBe(true);
    expect(process.stderr.destroyed).toBe(true);
  });

  it('never manufactures success when the shell exit was not observed', async () => {
    const process = child();
    vi.mocked(spawn).mockReturnValue(process as never);
    const config = defaultConfig();
    config.verify.commands = [{ name: 'owned', run: 'command', required: true }];
    config.verify.timeoutSeconds = 1;
    const pending = runVerification('/unused', config);
    await vi.advanceTimersByTimeAsync(8000);
    const result = await pending;
    expect(result.status).toBe('failed');
    expect(result.checks[0]).toMatchObject({ exit_code: null, timed_out: true });
  });
});

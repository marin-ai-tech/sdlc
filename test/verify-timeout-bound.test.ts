import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { runVerification } from '../src/core/verify.js';
import { stopProcessTree } from '../src/core/process-tree.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../src/core/process-tree.js', () => ({ stopProcessTree: vi.fn() }));
vi.mock('../src/core/git.js', () => ({
  worktreeFingerprint: () => `git-tree:${'a'.repeat(40)}`, headCommit: () => 'abc', isDirty: () => false,
}));

describe('B131: timeout completion does not depend on inherited pipes', () => {
  afterEach(() => vi.useRealTimers());

  it.each(['resolved', 'stuck'])('returns when cleanup is %s but no close event arrives', async (cleanup) => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      pid: 123, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
    });
    vi.mocked(spawn).mockReturnValue(child as never);
    vi.mocked(stopProcessTree).mockImplementation(() => cleanup === 'resolved'
      ? Promise.resolve() : new Promise(() => {}));
    const config = defaultConfig();
    config.verify.commands = [{ name: 'tree', run: 'node child.cjs', required: true }];
    config.verify.timeoutSeconds = 1;
    let result: Awaited<ReturnType<typeof runVerification>> | undefined;
    const pending = runVerification('/unused', config).then((value) => { result = value; });
    await vi.advanceTimersByTimeAsync(8500);
    expect(result?.checks[0]).toMatchObject({ exit_code: null, timed_out: true });
    expect(result?.status).toBe('failed');
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    await pending;
  });
});

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { renderEvidence, runVerification } from '../src/core/verify.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../src/core/process-tree.js', () => ({ stopProcessTree: vi.fn(async () => { throw new Error('ps unavailable'); }) }));
vi.mock('../src/core/git.js', () => ({ worktreeFingerprint: () => 'git-tree:abc', headCommit: () => 'abc',
  isDirty: () => false }));
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

describe('Cleanup failure preserves the real command code without granting verification authority', () => {
  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports failed verification when owned cleanup fails after the shell exits zero', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    vi.useFakeTimers();
    vi.spyOn(process, 'kill').mockReturnValue(true);
    const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null as number | null,
      signalCode: null, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    vi.mocked(spawn).mockReturnValue(child as never);
    const config = defaultConfig();
    config.verify.commands = [{ name: 'owned', run: 'command', required: true }];
    const pending = runVerification('/unused', config);
    child.exitCode = 0;
    child.emit('exit', 0, null);
    await vi.advanceTimersByTimeAsync(8000);
    const result = await pending;
    expect(result.status).toBe('failed');
    expect(result.checks[0].exit_code).toBe(0);
    expect(result.checks[0]).not.toHaveProperty('timed_out');
    expect(result.checks[0].output).toContain('Process tree cleanup failed: ps unavailable');
    const evidence = renderEvidence(result, 'demo');
    expect(evidence).toContain('FAILED (0/1 required checks)');
    expect(evidence).not.toContain('✅ exit 0');
    expect(evidence).toMatch(/cleanup failed/i);
  });
});

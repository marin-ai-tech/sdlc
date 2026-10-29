import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { runVerification } from '../src/core/verify.js';
import { stopProcessTree } from '../src/core/process-tree.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../src/core/process-tree.js', () => ({ stopProcessTree: vi.fn() }));
vi.mock('../src/core/git.js', () => ({
  worktreeFingerprint: () => `git-tree:${'a'.repeat(40)}`, headCommit: () => 'abc', isDirty: () => false,
}));

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const note = 'Process tree cleanup sent no signal: the check\'s shell had already exited.';
const failureLine = 'Process tree cleanup failed: ps unavailable';

type Run = Awaited<ReturnType<typeof runVerification>>;
type FakeChild = ReturnType<typeof fakeChild>;

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    pid: 123,
    exitCode: null as number | null,
    signalCode: null as string | null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
}

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

/** Runs one required check with a 1-second limit; the shell exits at 500 ms when `exits` is set. */
async function timedOutCheck(child: FakeChild, exits: boolean): Promise<Run> {
  vi.mocked(spawn).mockReturnValue(child as never);
  const config = defaultConfig();
  config.verify.commands = [{ name: 'tree', run: 'node child.cjs', required: true }];
  config.verify.timeoutSeconds = 1;
  let result: Run | undefined;
  const pending = runVerification('/unused', config).then((value) => { result = value; });
  await vi.advanceTimersByTimeAsync(500);
  if (exits) {
    child.exitCode = 0;
    child.emit('exit', 0, null);
  }
  await vi.advanceTimersByTimeAsync(8000);
  await pending;
  return result!;
}

function cleanupShell(): { exited?: () => boolean } | undefined {
  expect(stopProcessTree).toHaveBeenCalledTimes(1);
  const call = vi.mocked(stopProcessTree).mock.calls[0] as unknown[];
  expect(call[0]).toBe(123);
  expect(call[1]).toEqual(expect.objectContaining({ pid: 123 }));
  return call[1] as { exited?: () => boolean } | undefined;
}

function expectTimedOutAndFailed(run: Run): void {
  expect(run.checks[0]).toMatchObject({ exit_code: null, timed_out: true });
  expect(run.status).toBe('failed');
}

describe('B133: verification reports a cleanup that sent no signal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(stopProcessTree).mockReset();
    vi.mocked(spawn).mockReset();
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(['linux', 'win32'])('adds the no-signal line once when the shell exited and cleanup signalled nothing '
    + '(%s)', async (name) => {
    Object.defineProperty(process, 'platform', { ...platform, value: name });
    vi.mocked(stopProcessTree).mockResolvedValue({ signalled: false } as never);
    const run = await timedOutCheck(fakeChild(), true);
    expect(occurrences(run.checks[0].output, note)).toBe(1);
    expectTimedOutAndFailed(run);
    expect(cleanupShell()?.exited?.()).toBe(true);
  });

  it('adds the line after the failure line when cleanup failed without a signal', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    const failure = Object.assign(new Error('ps unavailable'), { signalled: false });
    vi.mocked(stopProcessTree).mockRejectedValue(failure);
    const run = await timedOutCheck(fakeChild(), true);
    const output = run.checks[0].output;
    expect(occurrences(output, failureLine)).toBe(1);
    expect(occurrences(output, note)).toBe(1);
    expect(output.indexOf(note)).toBeGreaterThan(output.indexOf(failureLine));
    expectTimedOutAndFailed(run);
    expect(cleanupShell()?.exited?.()).toBe(true);
  });

  it('adds no line while the shell still runs', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    vi.mocked(stopProcessTree).mockResolvedValue({ signalled: true } as never);
    const run = await timedOutCheck(fakeChild(), false);
    expect(run.checks[0].output).not.toContain(note);
    expect(run.checks[0].output).not.toContain('sent no signal');
    expectTimedOutAndFailed(run);
    expect(cleanupShell()?.exited?.()).toBe(false);
  });

  it('adds no line when the shell exited and cleanup killed the remaining group', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    vi.mocked(stopProcessTree).mockResolvedValue({ signalled: true } as never);
    const run = await timedOutCheck(fakeChild(), true);
    expect(run.checks[0].output).not.toContain(note);
    expect(run.checks[0].output).not.toContain('sent no signal');
    expectTimedOutAndFailed(run);
    expect(cleanupShell()?.exited?.()).toBe(true);
  });
});

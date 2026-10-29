import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkShell } from '../src/core/check-shell.js';

/**
 * B133 review round 1 (F3): the real `checkShell` decides at the shell's `exit` event whether its process group
 * still had a member (`kill(-pid, 0)`), and keeps that answer. The POSIX cleanup tests pass a hand-built shell, so
 * no other test proves that the probe targets the group, runs at exit time, or counts EPERM as a member. The child is
 * an EventEmitter with the fields `checkShell` reads; `process.kill` is a spy, so no real process is signalled.
 */

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

interface FakeChild extends EventEmitter {
  pid: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill: ReturnType<typeof vi.fn>;
}

function child(): FakeChild {
  return Object.assign(new EventEmitter(), {
    pid: 123, exitCode: null, signalCode: null, kill: vi.fn(() => true),
  }) as FakeChild;
}

function probe(answer: 'live' | 'EPERM' | 'ESRCH'): void {
  vi.spyOn(process, 'kill').mockImplementation(() => {
    if (answer === 'live') return true;
    throw Object.assign(new Error(answer), { code: answer });
  });
}

describe('B133 review round 1: the group probe of checkShell', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    vi.restoreAllMocks();
  });

  it.each([['live', true], ['EPERM', true], ['ESRCH', false]] as const)(
    'probes the group at exit: %s gives %s', (answer, live) => {
      const fake = child();
      const shell = checkShell(fake as unknown as ChildProcess);
      probe(answer);
      expect(shell.groupLiveAtExit()).toBe(false);
      fake.emit('exit', 0, null);
      expect(process.kill).toHaveBeenCalledWith(-123, 0);
      expect(process.kill).not.toHaveBeenCalledWith(123, 0);
      expect(shell.exited()).toBe(true);
      expect(shell.groupLiveAtExit()).toBe(live);
    });

  it('keeps the answer it had at exit when the group changes later', () => {
    const fake = child();
    const shell = checkShell(fake as unknown as ChildProcess);
    probe('live');
    fake.emit('exit', 0, null);
    vi.mocked(process.kill).mockImplementation(() => {
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    });
    expect(shell.groupLiveAtExit()).toBe(true);
    expect(vi.mocked(process.kill).mock.calls).toHaveLength(1);
  });

  it('negative: does not probe before the exit', () => {
    const fake = child();
    const shell = checkShell(fake as unknown as ChildProcess);
    probe('live');
    expect(shell.exited()).toBe(false);
    expect(shell.groupLiveAtExit()).toBe(false);
    expect(process.kill).not.toHaveBeenCalled();
  });

  it('kill resolves false without signalling once the exit code is set', async () => {
    const fake = child();
    const shell = checkShell(fake as unknown as ChildProcess);
    fake.exitCode = 0;
    await expect(shell.kill()).resolves.toBe(false);
    expect(fake.kill).not.toHaveBeenCalled();
  });

  it('kill resolves true after the exit it caused', async () => {
    const fake = child();
    fake.kill.mockImplementation(() => {
      setImmediate(() => fake.emit('exit', null, 'SIGKILL'));
      return true;
    });
    probe('ESRCH');
    const shell = checkShell(fake as unknown as ChildProcess);
    await expect(shell.kill()).resolves.toBe(true);
    expect(fake.kill).toHaveBeenCalledWith('SIGKILL');
  });
});

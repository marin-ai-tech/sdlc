import { execFile } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stopProcessTree } from '../src/core/process-tree.js';

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: vi.fn(),
}));

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

/** A wrapper object that follows the Shell contract in plan.md. */
function wrapper(exited: boolean) {
  return {
    pid: 4321,
    exited: () => exited,
    groupLiveAtExit: () => false,
    kill: vi.fn(async () => !exited),
  };
}

describe('B133: Windows cleanup stops the wrapper only through its handle', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    vi.mocked(execFile).mockReset();
    // Today's code starts PowerShell; the mock always calls back so a red case fails instead of hanging.
    vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
      const callback = args[args.length - 1] as (error: Error | null, stdout: string, stderr: string) => void;
      callback(null, '', '');
      return {};
    }) as typeof execFile);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    vi.restoreAllMocks();
  });

  it('stops a running wrapper through its handle and never by process id', async () => {
    const shell = wrapper(false);
    const result = await stopProcessTree(4321, shell);
    expect(shell.kill).toHaveBeenCalledTimes(1);
    expect(execFile).not.toHaveBeenCalled();
    expect(result).toEqual({ signalled: true });
  });

  it('stops nothing once the wrapper exit was observed', async () => {
    const shell = wrapper(true);
    const result = await stopProcessTree(4321, shell);
    expect(execFile).not.toHaveBeenCalled();
    expect(shell.kill).not.toHaveBeenCalled();
    expect(result).toEqual({ signalled: false });
  });

  it('rejects without a shell instead of falling back to a process id', async () => {
    await expect(stopProcessTree(4321)).rejects.toBeInstanceOf(Error);
    expect(execFile).not.toHaveBeenCalled();
  });
});

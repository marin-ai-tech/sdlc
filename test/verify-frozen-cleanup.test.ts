import { execFile } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stopProcessTree } from '../src/core/process-tree.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

describe('Bounded cleanup leaves no known descendant frozen', () => {
  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    vi.restoreAllMocks();
  });

  it('resumes a known frozen survivor when its kill fails, without touching an unrelated process', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    const alive = new Set([111, 222]);
    const frozen = new Set<number>();
    vi.mocked(execFile).mockImplementation(((_file: unknown, _args: unknown, _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      callback(null, '111 44 111\n222 111 111\n999 44 999\n', '');
      return {};
    }) as typeof execFile);
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 0 && !alive.has(pid)) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      if (signal === 'SIGSTOP') {
        if (pid === -111) frozen.add(111);
        frozen.add(Math.abs(pid));
      }
      if (signal === 'SIGKILL') {
        if (pid === 222) throw Object.assign(new Error('kill denied'), { code: 'EPERM' });
        alive.delete(111);
        frozen.delete(111);
      }
      if (signal === 'SIGCONT') frozen.delete(Math.abs(pid));
      return true;
    });
    await expect(stopProcessTree(111)).rejects.toThrow('kill denied');
    expect(frozen.has(222)).toBe(false);
    expect(process.kill).toHaveBeenCalledWith(222, 'SIGCONT');
    expect(vi.mocked(process.kill).mock.calls.some(([pid]) => [44, 999, -999].includes(pid))).toBe(false);
  }, 6000);
});

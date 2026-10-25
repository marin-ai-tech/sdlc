import { execFile } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stopProcessTree } from '../src/core/process-tree.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const initial = '111 44 111\n222 111 111\n777 222 777\n778 777 777\n999 44 999\n';

describe('B131: POSIX ancestry independent of process groups', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    vi.spyOn(process, 'kill').mockReturnValue(true);
    vi.mocked(execFile).mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    vi.restoreAllMocks();
  });

  function processTables(tables: string[], error?: Error): void {
    vi.mocked(execFile).mockImplementation(((_file: unknown, _args: unknown, _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      callback(error ?? null, tables.length > 1 ? tables.shift()! : tables[0], '');
      return {};
    }) as typeof execFile);
  }

  it('terminates a detached child and its grandchild without touching unrelated processes', async () => {
    processTables([initial]);
    await stopProcessTree(111);
    expect(process.kill).toHaveBeenCalledWith(777, 'SIGKILL');
    expect(process.kill).toHaveBeenCalledWith(778, 'SIGKILL');
    expect(process.kill).toHaveBeenCalledWith(-111, 'SIGKILL');
    expect(vi.mocked(process.kill).mock.calls.some(([pid]) => [44, 999, -999].includes(pid))).toBe(false);
  });

  it('freezes observed ancestors and discovers a child forked before its parent stopped', async () => {
    processTables([initial, `${initial}779 778 779\n`]);
    await stopProcessTree(111);
    expect(process.kill).toHaveBeenCalledWith(-111, 'SIGSTOP');
    expect(process.kill).toHaveBeenCalledWith(777, 'SIGSTOP');
    expect(process.kill).toHaveBeenCalledWith(779, 'SIGKILL');
    expect(vi.mocked(execFile).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('still kills the owned group and reports bounded process-table failure', async () => {
    processTables([''], new Error('ps unavailable'));
    await expect(stopProcessTree(111)).rejects.toThrow('ps unavailable');
    expect(process.kill).toHaveBeenCalledWith(-111, 'SIGKILL');
  });
});

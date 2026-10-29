import { execFile } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stopProcessTree } from '../src/core/process-tree.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const initial = '111 44 111\n222 111 111\n777 222 777\n778 777 777\n999 44 999\n';

describe('B131: POSIX ancestry independent of process groups', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    vi.spyOn(process, 'kill').mockImplementation((_pid, name) => {
      if (name === 0) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      return true;
    });
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

  it('waits for asynchronous signal delivery before reporting cleanup complete', async () => {
    processTables([initial]);
    const remaining = new Set([111, 222, 777, 778]);
    const delivery: ReturnType<typeof setTimeout>[] = [];
    vi.mocked(process.kill).mockImplementation((pid, name) => {
      if (name === 'SIGKILL' && remaining.has(pid)) {
        delivery.push(setTimeout(() => remaining.delete(pid), 30));
      }
      if (name === 0 && !remaining.has(pid)) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      return true;
    });
    try {
      await stopProcessTree(111);
      expect([...remaining]).toEqual([]);
    } finally { delivery.forEach(clearTimeout); }
  });

  it('reports unacknowledged exits within the cleanup deadline', async () => {
    processTables([initial]);
    vi.mocked(process.kill).mockReturnValue(true);
    const started = Date.now();
    await expect(stopProcessTree(111)).rejects.toThrow('did not exit after SIGKILL');
    expect(Date.now() - started).toBeLessThan(6000);
  });
});

describe('B133: cleanup after the shell exited', () => {
  let events: string[];

  beforeEach(() => {
    events = [];
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    vi.spyOn(process, 'kill').mockImplementation((pid, name) => {
      events.push(`${pid} ${String(name)}`);
      if (name === 0) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      return true;
    });
    vi.mocked(execFile).mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    vi.restoreAllMocks();
  });

  interface ShellState { exited: boolean; groupLive: boolean }

  /** A shell object that follows the Shell contract in plan.md. */
  function checkShell(state: ShellState) {
    return {
      pid: 111,
      exited: () => state.exited,
      groupLiveAtExit: () => state.exited && state.groupLive,
      kill: vi.fn(async () => false),
    };
  }

  function readTables(tables: string[], onRead: () => void = () => {}, error?: Error): void {
    vi.mocked(execFile).mockImplementation(((_file: unknown, _args: unknown, _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      events.push('ps');
      onRead();
      callback(error ?? null, tables.length > 1 ? tables.shift()! : tables[0], '');
      return {};
    }) as typeof execFile);
  }

  function callsFor(pids: number[]): unknown[][] {
    return vi.mocked(process.kill).mock.calls.filter(([pid]) => pids.includes(pid));
  }

  function signals(): unknown[][] {
    return vi.mocked(process.kill).mock.calls.filter(([, name]) => name !== 0);
  }

  it.each([true, false])('never signals an unrelated holder of the old id, its group or its child '
    + '(group live at exit: %s)', async (groupLive) => {
    readTables(['111 1 111\n112 111 111\n']);
    const result = await stopProcessTree(111, checkShell({ exited: true, groupLive }));
    expect(callsFor([111, -111, 112])).toEqual([]);
    expect(result).toEqual({ signalled: false });
  });

  it('stops the check\'s group that outlived its shell and ignores children of the old id', async () => {
    readTables(['222 1 111\n223 222 111\n555 111 555\n']);
    const result = await stopProcessTree(111, checkShell({ exited: true, groupLive: true }));
    for (const target of [-111, 222, 223]) {
      expect(process.kill).toHaveBeenCalledWith(target, 'SIGSTOP');
      expect(process.kill).toHaveBeenCalledWith(target, 'SIGKILL');
    }
    expect(callsFor([111, 555, -555])).toEqual([]);
    expect(result).toEqual({ signalled: true });
  });

  it('signals nothing when the group was empty at the shell\'s exit', async () => {
    readTables(['222 1 111\n']);
    const result = await stopProcessTree(111, checkShell({ exited: true, groupLive: false }));
    expect(signals()).toEqual([]);
    expect(result).toEqual({ signalled: false });
  });

  it('stops signalling the old id when the shell exits during discovery', async () => {
    const state = { exited: false, groupLive: true };
    readTables(['222 111 111\n333 111 333\n'], () => { state.exited = true; });
    await stopProcessTree(111, checkShell(state));
    const frozen = events.indexOf('-111 SIGSTOP');
    expect(frozen).toBeGreaterThanOrEqual(0);
    expect(frozen).toBeLessThan(events.indexOf('ps'));
    expect(process.kill).toHaveBeenCalledWith(-111, 'SIGKILL');
    expect(process.kill).toHaveBeenCalledWith(222, 'SIGKILL');
    expect(process.kill).not.toHaveBeenCalledWith(111, 'SIGKILL');
    expect(callsFor([333, -333])).toEqual([]);
  });

  it('drops a descendant that is already gone at its freeze signal', async () => {
    vi.mocked(process.kill).mockImplementation((pid, name) => {
      events.push(`${pid} ${String(name)}`);
      const gone = name === 0 || (pid === 777 && name === 'SIGSTOP');
      if (gone) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      return true;
    });
    readTables([initial, `${initial}780 777 780\n`]);
    await stopProcessTree(111, checkShell({ exited: false, groupLive: false }));
    expect(process.kill).toHaveBeenCalledWith(778, 'SIGKILL');
    expect(process.kill).not.toHaveBeenCalledWith(777, 'SIGKILL');
    expect(process.kill).not.toHaveBeenCalledWith(777, 0);
    expect(callsFor([780, -780])).toEqual([]);
  });

  // Review round 1 (F1, F2): the timeout fires after the shell exited but before Node collected it, so cleanup
  // freezes the group while the shell still counts as running; the exit is observed during the `ps` read.
  it('kills a group frozen before the shell was collected when the table still lists the exited shell', async () => {
    const state = { exited: false, groupLive: true };
    readTables(['111 44 111\n222 111 111\n'], () => { state.exited = true; });
    const result = await stopProcessTree(111, checkShell(state));
    expect(events.indexOf('-111 SIGSTOP')).toBeLessThan(events.indexOf('ps'));
    expect(process.kill).toHaveBeenCalledWith(-111, 'SIGKILL');
    expect(process.kill).toHaveBeenCalledWith(222, 'SIGKILL');
    expect(callsFor([111])).toEqual([]);
    expect(callsFor([44, -44])).toEqual([]);
    expect(result).toEqual({ signalled: true });
  });

  it('kills a group frozen before the shell was collected when the table read then fails', async () => {
    const state = { exited: false, groupLive: true };
    readTables([''], () => { state.exited = true; }, new Error('ps unavailable'));
    const error = await stopProcessTree(111, checkShell(state)).then(() => undefined, (reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('ps unavailable');
    expect(process.kill).toHaveBeenCalledWith(-111, 'SIGSTOP');
    expect(process.kill).toHaveBeenCalledWith(-111, 'SIGKILL');
    expect(callsFor([111])).toEqual([]);
    expect((error as { signalled?: unknown }).signalled).toBe(true);
  });

  // Review round 1, acceptance of card 071: the exited shell's row is a member of the frozen group, but after its exit
  // is observed its id must not become a parent through which other processes are adopted.
  it('does not adopt a child of the old id through the exited shell\'s row in a frozen group', async () => {
    const state = { exited: false, groupLive: true };
    readTables(['111 44 111\n222 111 111\n555 111 555\n'], () => { state.exited = true; });
    const result = await stopProcessTree(111, checkShell(state));
    expect(process.kill).toHaveBeenCalledWith(-111, 'SIGKILL');
    expect(process.kill).toHaveBeenCalledWith(222, 'SIGKILL');
    expect(callsFor([111, 555, -555])).toEqual([]);
    expect(result).toEqual({ signalled: true });
  });

  it('sends no signal and reports the ps failure after the shell\'s exit', async () => {
    readTables([''], undefined, new Error('ps unavailable'));
    const error = await stopProcessTree(111, checkShell({ exited: true, groupLive: true }))
      .then(() => undefined, (reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('ps unavailable');
    expect(process.kill).not.toHaveBeenCalled();
    expect((error as { signalled?: unknown }).signalled).toBe(false);
  });
});

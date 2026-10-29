import type { ChildProcess } from 'node:child_process';
import { stopProcessTree } from './process-tree.js';

export interface CheckShell {
  pid: number;
  exited(): boolean;
  groupLiveAtExit(): boolean;
  kill(): Promise<boolean>;
}

export function checkShell(child: ChildProcess): CheckShell {
  const pid = child.pid ?? 0;
  let exitObserved = false;
  let groupLive = false;
  child.on('exit', () => {
    exitObserved = true;
    if (process.platform === 'win32' || !pid) return;
    try {
      process.kill(-pid, 0);
      groupLive = true;
    } catch (error) {
      groupLive = (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  });
  const exited = () => exitObserved || child.exitCode != null || child.signalCode != null;
  return {
    pid,
    exited,
    groupLiveAtExit: () => exitObserved && groupLive,
    kill: () => new Promise((resolve) => {
      if (exited()) return resolve(false);
      const onExit = () => resolve(true);
      child.once('exit', onExit);
      if (!child.kill('SIGKILL')) {
        child.off('exit', onExit);
        resolve(false);
      }
    }),
  };
}

const noSignalNote = "Process tree cleanup sent no signal: the check's shell had already exited.";

function noteIfNoSignal(shell: CheckShell, signalled: unknown, keep: (chunk: Buffer) => void): void {
  if (signalled === false && shell.exited()) keep(Buffer.from(`\n${noSignalNote}\n`));
}

export async function cleanupCheckShell(shell: CheckShell, keep: (chunk: Buffer) => void,
  onFailure: () => void): Promise<void> {
  try {
    const result = await stopProcessTree(shell.pid, shell);
    noteIfNoSignal(shell, result?.signalled, keep);
  } catch (error) {
    const failure = error as Error & { signalled?: boolean };
    keep(Buffer.from(`\nProcess tree cleanup failed: ${failure.message}\n`));
    noteIfNoSignal(shell, failure.signalled, keep);
    onFailure();
  }
}

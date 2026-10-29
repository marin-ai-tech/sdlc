import { stopPosixProcessTree } from './posix-process-tree.js';
import type { CheckShell } from './check-shell.js';

/** Stop only the process group/tree created for one verification command. */
export async function stopProcessTree(pid: number, shell?: CheckShell): Promise<{ signalled: boolean }> {
  if (process.platform !== 'win32') {
    return stopPosixProcessTree(pid, shell);
  }
  if (!shell) {
    throw Object.assign(new Error('The verification check shell is required on Windows.'), { signalled: false });
  }
  if (shell.exited()) return { signalled: false };
  try {
    return { signalled: await shell.kill() };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    throw Object.assign(failure, { signalled: false });
  }
}

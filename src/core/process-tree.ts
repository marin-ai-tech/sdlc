import { execFile } from 'node:child_process';
import { stopPosixProcessTree } from './posix-process-tree.js';

/** Stop only the process group/tree created for one verification command. */
export function stopProcessTree(pid: number): Promise<void> {
  if (process.platform !== 'win32') {
    return stopPosixProcessTree(pid);
  }
  const script = [
    '$ErrorActionPreference = "Stop"',
    // The verification wrapper owns a kill-on-close Job Object containing all descendants.
    `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`,
  ].join('\n');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 6000 }, (error) => error ? reject(error) : resolve());
  });
}

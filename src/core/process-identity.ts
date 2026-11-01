import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

export type ProcessState = 'same' | 'dead' | 'different' | 'unknown';
let ownIdentity: string | undefined;

/** Birth identity comes from the operating system, never wall-clock arithmetic. */
export function processIdentity(pid: number): string | undefined {
  if (!Number.isSafeInteger(pid) || pid < 1) return undefined;
  if (pid === process.pid && ownIdentity) return ownIdentity;
  let identity: string | undefined;
  try {
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const ticks = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)[19];
      const boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
      if (/^\d+$/.test(ticks ?? '') && boot) identity = `linux:${boot}:${ticks}`;
    } else if (process.platform === 'win32') {
      const shell = path.join(process.env.SystemRoot ?? 'C:\\Windows',
        'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command',
        `[Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToUniversalTime().Ticks`],
      { encoding: 'utf8', timeout: 5000, windowsHide: true, maxBuffer: 4096 });
      const ticks = result.stdout?.trim();
      if (result.status === 0 && /^\d{10,20}$/.test(ticks)) identity = `windows:${ticks}`;
    }
  } catch { /* An unavailable provider supplies no authority to reclaim a live PID. */ }
  if (pid === process.pid && identity) ownIdentity = identity;
  return identity;
}

export function processState(pid: number, identity?: string): ProcessState {
  try { process.kill(pid, 0); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return 'dead'; }
  if (!identity || !/^(?:linux:[^:]+:\d+|windows:\d+)$/.test(identity)) return 'unknown';
  const actual = processIdentity(pid);
  return actual === undefined ? 'unknown' : actual === identity ? 'same' : 'different';
}

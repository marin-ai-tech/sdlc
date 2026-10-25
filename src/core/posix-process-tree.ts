import { execFile } from 'node:child_process';

interface ProcessEntry { pid: number; parent: number; group: number }

function signal(pid: number, name: NodeJS.Signals): void {
  try { process.kill(pid, name); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

function processTable(timeout: number): Promise<ProcessEntry[]> {
  return new Promise((resolve, reject) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid=,pgid='], { timeout, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(error);
        const rows = stdout.trim().split(/\r?\n/).filter(Boolean).map((row) => row.trim().split(/\s+/).map(Number));
        if (rows.some((row) => row.length !== 3 || row.some((n) => !Number.isSafeInteger(n) || n < 0)
          || row[0] === 0)) return reject(new Error('Invalid verification process table.'));
        resolve(rows.map(([pid, parent, group]) => ({ pid, parent, group })));
      });
  });
}

function descendants(rows: ProcessEntry[], ownedGroup: number, known: Set<number>): number[] {
  const found = new Set(known);
  for (const row of rows) if (row.group === ownedGroup) found.add(row.pid);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) if (found.has(row.parent) && !found.has(row.pid)) {
      found.add(row.pid);
      grew = true;
    }
  }
  return [...found].filter((pid) => !known.has(pid));
}

/** Freeze parents before collecting another table, so detached children cannot keep forking unnoticed. */
export async function stopPosixProcessTree(pid: number): Promise<void> {
  const known = new Set([pid]);
  const deadline = Date.now() + 3000;
  let failure: unknown;
  try {
    signal(-pid, 'SIGSTOP');
    for (let pass = 0; pass < 16; pass++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Verification process discovery timed out.');
      const added = descendants(await processTable(remaining), pid, known);
      for (const child of added) {
        known.add(child);
        signal(child, 'SIGSTOP');
      }
      if (added.length === 0) return;
    }
    throw new Error('Verification process tree did not stabilize.');
  } catch (error) {
    failure = error;
  } finally {
    // Even discovery failures must never leave our group or observed descendants suspended.
    for (const target of [...known].reverse().concat(-pid)) {
      try { signal(target, 'SIGKILL'); } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
  }
}

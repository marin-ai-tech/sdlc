import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DoctorCheck } from './doctor.js';
import { inspectWriterCoordination, inspectWriterLock } from './writer-lock.js';
import { storagePath } from '../plugins/activation.js';
import { readStore } from '../plugins/store.js';

function storageFindings(root: string): DoctorCheck[] | undefined {
  for (const relative of ['openspec', 'openspec/.sdlc']) {
    try {
      const stat = fs.lstatSync(path.join(root, relative));
      if (stat.isSymbolicLink() || !stat.isDirectory()) return [{ check: 'project log storage',
        status: 'error', code: 'log_write', message: 'Linked or non-directory project log storage is not writable.',
        fix: 'Preserve existing log bytes and restore a plain openspec/.sdlc directory before writing.' }];
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  return undefined;
}

function finding(root: string, file: string, name: string, cli: string): DoctorCheck[] {
  const relative = path.relative(root, file).split(path.sep).join('/');
  try {
    const owner = inspectWriterLock(file);
    const contenders = inspectWriterCoordination(file);
    if (owner.state === 'absent') return contenders ? [{ check: `${name} writer`, status: 'warn',
      code: 'writer_coordination', message: `${JSON.stringify(`${relative}.writers`)}: ${contenders} coordination records precede a fixed lock.`,
      fix: 'Retry after active writers finish. Preserve unknown live metadata; confirm all writers stopped and quiescence before manual recovery.' }] : [];
    const recover = name === 'board' ? `${cli} board recover --expect-owner ${owner.digest}` : `${cli} doctor`;
    const identity = owner.processState === 'different' ? 'proven process instance mismatch'
      : owner.processState === 'same' ? 'verified process instance'
      : owner.processState === 'dead' ? 'process not running' : 'process instance unverifiable';
    return [{ check: `${name} writer`, status: 'warn', code: `writer_${owner.state}`,
      message: `${JSON.stringify(relative)}: PID ${owner.pid ?? 'unknown'}; ${owner.state} ownership, ${identity} (${owner.digest}); age alone never authorizes removal.`,
      fix: owner.state === 'dead' || owner.state === 'partial'
        ? `Inspect the owner, stop competing writers, then run ${recover}. Partial publications require 120 seconds.`
        : 'Keep this lock. Confirm the original owner and all writers stopped before manual recovery; live legacy PIDs are not proof of ownership.' }];
  } catch {
    return [{ check: `${name} writer`, status: 'error', code: 'writer_metadata',
      message: `${JSON.stringify(relative)}: ownership metadata cannot be safely inspected.`,
      fix: 'Inspect linked or unreadable storage without replacing the owner record.' }];
  }
}

function pluginFindings(root: string, cli: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const base = storagePath(root);
  for (const name of ['activation', 'recovery']) checks.push(...finding(root, path.join(base, `${name}.lock`), name, cli));
  const recovery = storagePath(root, 'recovery-entries');
  if (fs.existsSync(recovery) && fs.readdirSync(recovery).length) checks.push({
    check: 'plugin recovery contenders', status: 'warn', code: 'writer_coordination',
    message: 'Plugin recovery contender metadata is present; partial or legacy live identities remain protected.',
    fix: 'Retry after active recovery finishes; preserve metadata and confirm all writers stopped before manual recovery.',
  });
  const states = storagePath(root, 'state');
  if (!fs.existsSync(states)) return checks;
  const names = fs.readdirSync(states);
  if (names.length > 128) throw new Error('Too many plugin namespaces');
  for (const name of names) {
    checks.push(...finding(root, storagePath(root, `state/${name}/store.lock`), `plugin ${name}`, cli));
    const store = readStore(root, name);
    if (!store?.pending.length) continue;
    const oldest = Math.min(...store.pending.map(event => Date.parse(String(event.record.ts))).filter(Number.isFinite));
    checks.push({ check: `plugin ${name} pending events`, status: 'warn', code: 'plugin_log_pending',
      message: `${store.pending.length} records, ${Buffer.byteLength(JSON.stringify(store.pending))} bytes; oldest ${Number.isFinite(oldest) ? new Date(oldest).toISOString() : 'unknown'}.`,
      fix: `Restore project logging, then retry the saved request or run ${cli} plugins recover ${name}; never delete pending events.` });
  }
  return checks;
}

/** Observational only: no directories, locks, receipts or authority are written. */
export function writerLockFindings(root: string, cli: string): DoctorCheck[] {
  const storage = storageFindings(root);
  if (storage) return storage;
  const base = path.join(root, 'openspec/.sdlc');
  const checks = ['board', 'log'].flatMap(name => finding(root, path.join(base, `${name}.lock`), name, cli));
  try { checks.push(...pluginFindings(root, cli)); }
  catch { checks.push({ check: 'plugin storage', status: 'warn', code: 'plugin_store',
    message: 'Plugin ownership or pending metadata cannot be safely inspected.',
    fix: `Run ${cli} plugins inspect and preserve the current storage for recovery.` }); }
  return checks;
}

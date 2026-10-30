import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fail, keys, object } from './api.js';
import { readStored, storagePath } from './activation.js';

const DIRECTORY = 'recovery-entries';
const MAX_ENTRIES = 128;
const ENTRY_BYTES = 512;
const NAME = /^(\d{1,16})-([a-f0-9]{32})\.(json|next)$/;
interface Owner { id: string; pid: number; nonce: string; choosing: boolean; ticket: number }

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

function remove(root: string, relative: string): void {
  try { fs.unlinkSync(storagePath(root, relative)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

function readOwner(root: string, id: string, pid: number, nonce: string): Owner | undefined {
  let raw;
  try { raw = readStored(root, `${DIRECTORY}/${id}.json`, ENTRY_BYTES); }
  catch { return fail('plugin_busy', 'A recovery contender is publishing metadata'); }
  if (raw === undefined) return undefined;
  const value = object(raw, 'recovery contender');
  keys(value, ['pid', 'nonce', 'choosing', 'ticket'], 'recovery contender');
  if (value.pid !== pid || value.nonce !== nonce || typeof value.choosing !== 'boolean'
    || !Number.isSafeInteger(value.ticket) || (value.ticket as number) < 0
    || (value.choosing ? value.ticket !== 0 : value.ticket === 0)) {
    fail('plugin_store', 'Recovery contender identity or ticket is invalid');
  }
  return { id, pid, nonce, choosing: value.choosing, ticket: value.ticket as number };
}

/** Dead entries have unique, never-reused names: cleanup cannot unlink a newer contender's path. */
function owners(root: string): Owner[] {
  const entries = fs.opendirSync(storagePath(root, DIRECTORY));
  const result: Owner[] = [];
  let count = 0;
  try {
    for (let entry = entries.readSync(); entry; entry = entries.readSync()) {
      if (++count > MAX_ENTRIES) fail('plugin_busy', 'Recovery contender metadata limit reached; retry after cleanup');
      const match = NAME.exec(entry.name);
      const pid = match ? Number(match[1]) : NaN;
      if (!match || !Number.isSafeInteger(pid) || pid < 1) fail('plugin_store', 'Invalid recovery contender path');
      if (!alive(pid)) { remove(root, `${DIRECTORY}/${entry.name}`); continue; }
      if (match[3] === 'next') continue;
      const owner = readOwner(root, `${match[1]}-${match[2]}`, pid, match[2]);
      if (owner) result.push(owner);
    }
  } finally { entries.closeSync(); }
  return result;
}

function publish(root: string, owner: Owner, initial: boolean): void {
  const relative = `${DIRECTORY}/${owner.id}.${initial ? 'json' : 'next'}`;
  const file = storagePath(root, relative, true);
  const { id: _id, ...value } = owner;
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  if (!initial) fs.renameSync(file, storagePath(root, `${DIRECTORY}/${owner.id}.json`));
}

function release(root: string, owner: Owner): void {
  const current = readStored(root, `${DIRECTORY}/${owner.id}.json`, ENTRY_BYTES);
  if (!current || typeof current !== 'object' || Array.isArray(current)
    || current.pid !== owner.pid || current.nonce !== owner.nonce) return;
  remove(root, `${DIRECTORY}/${owner.id}.next`);
  remove(root, `${DIRECTORY}/${owner.id}.json`);
}

/**
 * Nonblocking Lamport bakery entry, used only to serialize reclamation of the fixed recovery fence.
 * Publish choosing before reading tickets; publish the ticket atomically; refuse live choosing/lower owners.
 * All cooperating recoveries participate. No fixed reclaim lock is needed to recover a crashed contender.
 */
export function withRecoveryEntry<T>(root: string, action: () => T): T {
  const nonce = randomUUID().replaceAll('-', '');
  const owner: Owner = { id: `${process.pid}-${nonce}`, pid: process.pid, nonce, choosing: true, ticket: 0 };
  try {
    publish(root, owner, true);
    const maximum = Math.max(0, ...owners(root).map((entry) => entry.ticket));
    if (maximum >= Number.MAX_SAFE_INTEGER) fail('plugin_busy', 'Recovery ticket range exhausted');
    owner.ticket = maximum + 1;
    owner.choosing = false;
    publish(root, owner, false);
    for (const other of owners(root)) {
      if (other.id !== owner.id && (other.choosing || other.ticket < owner.ticket
        || other.ticket === owner.ticket && other.id < owner.id)) fail('plugin_busy', 'Another recovery contender is active');
    }
    return action();
  } finally { release(root, owner); }
}

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { SdlcError } from './errors.js';
import { processIdentity, processState, type ProcessState } from './process-identity.js';

const WAIT = new Int32Array(new SharedArrayBuffer(4));
const PARTIAL_AGE_MS = 120_000;
const MAX_ENTRIES = 128;
const UNKNOWN_INSTANCE = `unknown:${randomUUID()}`;
interface Ticket { pid: number; instance: string; nonce: string; choosing: boolean; ticket: number }
export interface WriterLease { fd: number; owner: string; release: () => void }
export interface WriterSnapshot {
  digest: string;
  state: 'absent' | 'dead' | 'live' | 'unknown' | 'partial';
  raw?: string;
  /** Read-only evidence sampled with this owner record; recovery still validates the current owner. */
  pid?: number;
  processState?: ProcessState;
}

function refused(detail: string): never { throw new SdlcError('writer_locked', detail); }
function hash(bytes: string): string { return `sha256:${createHash('sha256').update(bytes).digest('hex')}`; }
function dead(pid: number, instance?: string): boolean {
  return ['dead', 'different'].includes(processState(pid, instance));
}

function readRegular(file: string): { raw: string; age: number } | undefined {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4096) {
      refused('Unsafe writer ownership metadata');
    }
    return { raw: fs.readFileSync(file, 'utf8'), age: Date.now() - stat.mtimeMs };
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return undefined;
}

function ownerOf(raw: string): { pid: number; instance?: string } | undefined {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value && Number.isSafeInteger(value.pid) && (value.pid as number) > 0) {
      return { pid: value.pid as number, ...(typeof value.instance === 'string' ? { instance: value.instance } : {}) };
    }
  } catch { /* Board locks from older versions use a whitespace-separated PID. */ }
  const match = /^([1-9]\d*)\s+\S+/.exec(raw);
  const pid = Number(match?.[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? { pid } : undefined;
}

export function inspectWriterLock(file: string): WriterSnapshot {
  const record = readRegular(file);
  if (!record) return { digest: hash(''), state: 'absent' };
  const owner = ownerOf(record.raw);
  const process = owner ? processState(owner.pid, owner.instance) : undefined;
  const state = !owner ? 'partial' : process === 'dead' || process === 'different' ? 'dead'
    : process === 'same' ? 'live' : 'unknown';
  return { digest: hash(record.raw), state, raw: record.raw,
    ...(owner ? { pid: owner.pid } : {}), ...(process ? { processState: process } : {}) };
}

/** Read-only diagnostic inventory. A choosing record may precede publication of the fixed lock. */
export function inspectWriterCoordination(file: string): number {
  const dir = `${file}.writers`;
  try {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) refused('Unsafe writer coordination directory');
    const names = fs.readdirSync(dir);
    if (names.length > MAX_ENTRIES) refused('Writer contender metadata limit reached');
    for (const name of names) {
      if (!/^(\d+)-(?:([wlu])-)?([a-f0-9]{64})-([a-f0-9-]{36})\.(json|next)$/.test(name)) {
        refused('Invalid writer coordination path');
      }
      readRegular(path.join(dir, name));
    }
    return names.length;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return 0;
}

function directory(file: string): string {
  const dir = `${file}.writers`;
  try { fs.mkdirSync(dir, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) refused('Linked writer coordination directory');
  return dir;
}

function removeEntry(file: string): void {
  try { if (readRegular(file)) fs.unlinkSync(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

function parseTicket(raw: string, match: RegExpExecArray): Ticket {
  let value: Ticket;
  try { value = JSON.parse(raw) as Ticket; }
    catch { return { pid: Number(match[1]), instance: 'unknown', nonce: match[4], choosing: true, ticket: 0 }; }
  if (!value || value.pid !== Number(match[1]) || value.nonce !== match[4] || typeof value.instance !== 'string'
    || createHash('sha256').update(value.instance).digest('hex') !== match[3]
    || typeof value.choosing !== 'boolean' || !Number.isSafeInteger(value.ticket)
    || value.ticket < 0 || (value.choosing ? value.ticket !== 0 : value.ticket === 0)) {
    refused('Invalid writer coordination record');
  }
  return value;
}

function readTicket(dir: string, name: string, proven: Set<string>): (Ticket & { name: string }) | undefined {
  const match = /^(\d+)-(?:([wlu])-)?([a-f0-9]{64})-([a-f0-9-]{36})\.(json|next)$/.exec(name);
  if (!match) refused('Invalid writer coordination path');
  const file = path.join(dir, name);
  if (dead(Number(match[1]))) { removeEntry(file); return undefined; }
  if (match[2] && match[2] !== 'u' && !proven.has(name)) {
    const actual = processIdentity(Number(match[1]));
    if (actual && createHash('sha256').update(actual).digest('hex') !== match[3]) {
      removeEntry(file);
      return undefined;
    }
    if (actual) proven.add(name);
  }
  if (match[5] === 'next') return undefined;
  const record = readRegular(file);
  if (!record) return undefined;
  const value = parseTicket(record.raw, match);
  const state = proven.has(name) ? processState(value.pid) : processState(value.pid, value.instance);
  if (state === 'dead' || state === 'different') { removeEntry(file); return undefined; }
  if (state === 'same') proven.add(name);
  return { ...value, name };
}

function tickets(dir: string, proven: Set<string>): Array<Ticket & { name: string }> {
  const names = fs.readdirSync(dir);
  if (names.length > MAX_ENTRIES) refused('Writer contender limit reached; inspect abandoned metadata');
  for (const name of proven) if (!names.includes(name)) proven.delete(name);
  return names.flatMap(name => {
    const value = readTicket(dir, name, proven);
    return value ? [value] : [];
  });
}

function publish(file: string, ticket: Ticket, initial: boolean): void {
  // A partial ticket is a protected choosing owner. Publication needs no shared rename target.
  const fd = fs.openSync(file, initial ? 'wx' : 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(ticket)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

function enter(file: string, deadline: number): () => void {
  const instance = processIdentity(process.pid) ?? UNKNOWN_INSTANCE;
  const proven = new Set<string>();
  const dir = directory(file);
  const ticket: Ticket = { pid: process.pid, instance, nonce: randomUUID(), choosing: true, ticket: 0 };
  const kind = instance.startsWith('windows:') ? 'w' : instance.startsWith('linux:') ? 'l' : 'u';
  const prefix = `${process.pid}-${kind}-${createHash('sha256').update(instance).digest('hex')}-${ticket.nonce}`;
  const entry = path.join(dir, `${prefix}.json`);
  const release = () => {
    for (const suffix of ['next', 'json']) {
      try { fs.unlinkSync(path.join(dir, `${prefix}.${suffix}`)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  };
  try {
    publish(entry, ticket, true);
    ticket.ticket = Math.max(0, ...tickets(dir, proven).map((other) => other.ticket)) + 1;
    if (!Number.isSafeInteger(ticket.ticket)) refused('Writer ticket range exhausted');
    ticket.choosing = false;
    publish(entry, ticket, false);
    while (tickets(dir, proven).some((other) => other.nonce !== ticket.nonce && (other.choosing
      || other.ticket < ticket.ticket || other.ticket === ticket.ticket && other.name < `${prefix}.json`))) {
      if (performance.now() >= deadline) refused('Another writer is active; retry or run doctor');
      Atomics.wait(WAIT, 0, 0, 5);
    }
    return release;
  } catch (error) { release(); throw error; }
}

/** A failed publication owns only the still-open created file and its unchanged partial owner bytes. */
function discardOwnerPublication(file: string, fd: number, owner: string): void {
  try {
    const created = fs.fstatSync(fd);
    const current = fs.lstatSync(file);
    const raw = readRegular(file)?.raw;
    if (current.dev === created.dev && current.ino === created.ino
      && raw !== undefined && owner.startsWith(raw)) fs.unlinkSync(file);
  } catch { /* Preserve unprovable/replaced metadata and the original publication error. */ }
  try { fs.closeSync(fd); } catch { /* The publication error remains the caller's failure. */ }
}

/** Every new writer participates in the same recovery fence, including normal acquisition. */
export function acquireWriterLock(file: string, waitMs: number): WriterLease {
  const deadline = performance.now() + waitMs;
  const leave = enter(file, deadline);
  try {
    for (;;) {
      try {
        const fd = fs.openSync(file, 'wx', 0o600);
        const owner = JSON.stringify({ version: 1, pid: process.pid,
          instance: processIdentity(process.pid), nonce: randomUUID() });
        try { fs.writeFileSync(fd, owner); fs.fsyncSync(fd); }
        catch (error) { discardOwnerPublication(file, fd, owner); throw error; }
        return { fd, owner, release: () => {
          try {
            fs.closeSync(fd);
            if (readRegular(file)?.raw === owner) fs.unlinkSync(file);
          } finally { leave(); }
        } };
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const record = readRegular(file);
      if (!record) continue;
      const owner = ownerOf(record.raw);
      if (owner ? dead(owner.pid, owner.instance) : record.age >= PARTIAL_AGE_MS) {
        if (readRegular(file)?.raw === record.raw) fs.unlinkSync(file);
        continue;
      }
      if (performance.now() >= deadline) refused('Writer ownership is protected; run doctor before recovery');
      Atomics.wait(WAIT, 0, 0, 5);
    }
  } catch (error) { leave(); throw error; }
}

export function recoverWriterLock(file: string, expected?: string): WriterSnapshot {
  const leave = enter(file, performance.now() + 1000);
  try {
    const snapshot = inspectWriterLock(file);
    if (expected && snapshot.digest !== expected) refused('Writer changed since inspection');
    if (snapshot.state === 'absent') return snapshot;
    const record = readRegular(file);
    if (snapshot.state !== 'dead' && !(snapshot.state === 'partial' && record && record.age >= PARTIAL_AGE_MS)) {
      refused('Owner cannot be proven stopped; confirm quiescence and follow doctor recovery guidance');
    }
    if (readRegular(file)?.raw !== snapshot.raw) refused('Writer changed during recovery');
    fs.unlinkSync(file);
    return snapshot;
  } finally { leave(); }
}

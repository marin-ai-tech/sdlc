import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureLocalIgnore } from './local-ignore.js';
import { SdlcError } from './errors.js';

const WAIT = new Int32Array(new SharedArrayBuffer(4));

function refused(detail: string): never {
  throw new SdlcError('log_write', detail);
}

export function logFile(root: string, name: string): string {
  let dir = fs.realpathSync(root);
  for (const part of ['openspec', '.sdlc']) {
    dir = path.join(dir, part);
    try { fs.mkdirSync(dir); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) refused('Linked log storage is refused');
  }
  if (!/^[a-zA-Z0-9.-]+$/.test(name)) refused('Invalid log filename');
  const file = path.join(dir, name);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) refused('Linked log file is refused');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return file;
}

/** All log and local-queue writers cooperate; lock age never grants ownership. */
export function withLogWriter<T>(root: string, action: () => T): T {
  const lock = logFile(root, 'log.lock');
  ensureLocalIgnore(root, ['log.lock']);
  const deadline = performance.now() + 250;
  let fd: number;
  while (true) {
    try { fd = fs.openSync(lock, 'wx', 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (performance.now() >= deadline) refused('Project log writer is busy; reconcile a dead owner explicitly');
      Atomics.wait(WAIT, 0, 0, 5);
    }
  }
  const nonce = randomUUID();
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce }));
    fs.fsyncSync(fd);
    return action();
  } finally {
    fs.closeSync(fd);
    try {
      const current = JSON.parse(fs.readFileSync(lock, 'utf8')) as { nonce?: string };
      if (current.nonce === nonce) fs.unlinkSync(lock);
    } catch { /* An incomplete lock requires explicit recovery; never remove another writer's lock. */ }
  }
}

function writeComplete(fd: number, bytes: Buffer): void {
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (!count) refused('Incomplete project log append');
    offset += count;
  }
}

/** Caller holds the writer lock. Acknowledgement requires complete, parseable, flushed newline records. */
export function appendLogRecords(file: string, records: unknown[]): void {
  if (!records.length) return;
  const bytes = Buffer.from(records.map((record) => JSON.stringify(record)).join('\n') + '\n');
  const fd = fs.openSync(file, 'a+', 0o600);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) refused('Unsafe log append target');
    if (stat.size) {
      const tail = Buffer.alloc(1);
      if (fs.readSync(fd, tail, 0, 1, stat.size - 1) !== 1) refused('Cannot inspect project log tail');
      if (tail[0] !== 10) writeComplete(fd, Buffer.from('\n'));
    }
    const start = fs.fstatSync(fd).size;
    writeComplete(fd, bytes);
    fs.fsyncSync(fd);
    const confirmed = Buffer.alloc(bytes.length);
    let offset = 0;
    while (offset < confirmed.length) {
      const count = fs.readSync(fd, confirmed, offset, confirmed.length - offset, start + offset);
      if (!count) refused('Project log acknowledgement is incomplete');
      offset += count;
    }
    if (!confirmed.equals(bytes) || confirmed.at(-1) !== 10) refused('Project log acknowledgement differs');
    for (const line of confirmed.toString('utf8').trimEnd().split('\n')) JSON.parse(line);
  } finally { fs.closeSync(fd); }
}

export function recoverLogWriter(root: string): void {
  const file = logFile(root, 'log.lock');
  if (!fs.existsSync(file)) return;
  const lock = JSON.parse(fs.readFileSync(file, 'utf8')) as { pid?: number; nonce?: string };
  if (!Number.isSafeInteger(lock.pid) || !lock.pid || lock.pid < 1 || typeof lock.nonce !== 'string') {
    refused('Malformed project log lock requires inspection');
  }
  try { process.kill(lock.pid, 0); refused('Project log writer is still active'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  const current = JSON.parse(fs.readFileSync(file, 'utf8')) as { nonce?: string };
  if (current.nonce !== lock.nonce) refused('Project log writer changed');
  fs.unlinkSync(file);
}

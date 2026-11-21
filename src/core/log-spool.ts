import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LogEntry } from './log.js';
import { SdlcError } from './errors.js';
import { ensureLocalIgnore } from './local-ignore.js';
import { parseLogEntry } from './log-record.js';
import { appendLogRecords, logDirectory } from './log-write.js';
import { acknowledged } from './log-recovery.js';

const SPOOL = 'log-spool';
const NAME = /^\d+-\d+-[a-f0-9-]{36}\.json(?:\.claimed)?$/;
const CLAIMED = '.claimed';

function spoolDirectory(root: string, create: boolean): string | undefined {
  let parent = create ? logDirectory(root) : fs.realpathSync(root);
  if (!create) {
    for (const part of ['openspec', '.sdlc']) {
      parent = path.join(parent, part);
      try {
        const stat = fs.lstatSync(parent);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw new SdlcError('log_write', 'Linked log storage is refused');
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    }
  }
  const dir = path.join(parent, SPOOL);
  if (create) {
    try { fs.mkdirSync(dir, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  try {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new SdlcError('log_write', 'Linked log spool storage is refused');
    }
  } catch (error) {
    if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  return dir;
}

function spoolNames(root: string): { dir: string; names: string[] } | undefined {
  const dir = spoolDirectory(root, false);
  if (!dir) return undefined;
  return { dir, names: fs.readdirSync(dir).sort() };
}

function readRecord(file: string, name: string): LogEntry | undefined {
  if (!NAME.test(name)) return undefined;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) return undefined;
    const text = fs.readFileSync(file, 'utf8');
    if (!text.endsWith('\n') || text.trimEnd().includes('\n')) return undefined;
    return parseLogEntry(JSON.parse(text));
  } catch { return undefined; }
}

/** A failed lock attempt leaves one durable record without taking another lock. */
export function spoolLogRecord(root: string, entry: LogEntry): void {
  const dir = spoolDirectory(root, true);
  if (!dir) throw new SdlcError('log_write', 'Log spool storage is unavailable');
  const name = `${Date.now()}-${process.pid}-${randomUUID()}.json`;
  const file = path.join(dir, name);
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(entry)}\n`);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  try { ensureLocalIgnore(root, ['log-spool/']); }
  catch { /* A local exclude failure cannot discard a durable log record. */ }
}

/**
 * Caller holds the writer lock. Claimed files are replays; fresh files are distinct records even with equal content.
 */
export function drainLogSpool(root: string, target: string): void {
  const spool = spoolNames(root);
  if (!spool || spool.names.length === 0) return;
  const claimed = spool.names.filter((name) => name.endsWith(CLAIMED));
  const fresh = spool.names.filter((name) => !name.endsWith(CLAIMED));
  const known = claimed.length ? acknowledged(target) : new Set<string>();
  for (const name of [...claimed, ...fresh]) {
    const file = path.join(spool.dir, name);
    const record = readRecord(file, name);
    if (!record) continue;
    const key = JSON.stringify(record);
    if (!name.endsWith(CLAIMED)) fs.renameSync(file, `${file}${CLAIMED}`);
    if (!name.endsWith(CLAIMED) || !known.has(key)) {
      appendLogRecords(target, [record]);
      known.add(key);
    }
    fs.unlinkSync(name.endsWith(CLAIMED) ? file : `${file}${CLAIMED}`);
  }
}

export function spooledRecords(root: string): LogEntry[] {
  const spool = spoolNames(root);
  if (!spool) return [];
  const known = spool.names.some((name) => name.endsWith(CLAIMED))
    ? acknowledged(path.join(root, 'openspec/.sdlc/log.jsonl')) : new Set<string>();
  return spool.names.flatMap((name) => {
    const record = readRecord(path.join(spool.dir, name), name);
    if (!record || name.endsWith(CLAIMED) && known.has(JSON.stringify(record))) return [];
    return [record];
  });
}

export function unreadableSpoolFiles(root: string): string[] {
  const spool = spoolNames(root);
  if (!spool) return [];
  return spool.names.filter((name) => !readRecord(path.join(spool.dir, name), name));
}

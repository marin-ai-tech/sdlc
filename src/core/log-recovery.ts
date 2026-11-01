import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseLogEntry } from './log-record.js';
import { appendLogRecords, logFile } from './log-write.js';

function splitLines(bytes: Buffer): Buffer[] {
  const lines: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 10) { lines.push(bytes.subarray(start, i + 1)); start = i + 1; }
  }
  if (start < bytes.length) lines.push(bytes.subarray(start));
  return lines;
}

function acknowledged(file: string): Set<string> {
  try { return new Set(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return new Set();
}

function drain(root: string, name: string, target: string, known: Set<string>): void {
  const queue = logFile(root, name);
  let bytes: Buffer;
  try { bytes = fs.readFileSync(queue); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const retained: Buffer[] = [];
  const records: unknown[] = [];
  for (const line of splitLines(bytes)) {
    try {
      const raw: unknown = JSON.parse(line.toString('utf8'));
      if (!parseLogEntry(raw)) { retained.push(line); continue; }
      const key = JSON.stringify(raw);
      if (!known.has(key)) { records.push(raw); known.add(key); }
    } catch { retained.push(line); }
  }
  appendLogRecords(target, records);
  const remaining = Buffer.concat(retained);
  if (remaining.equals(bytes)) return;
  const temp = logFile(root, `${name}.${randomUUID()}.next`);
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, remaining); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try { fs.renameSync(temp, queue); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

/** Caller owns the log fence. Unknown bytes survive; replay uses acknowledged raw records. */
export function drainLocalLog(root: string, target: string): void {
  const dir = path.dirname(target);
  const drains = fs.readdirSync(dir).filter((name) => /^hook-log\.jsonl\.\d+\.\d+\.drain$/.test(name));
  const known = acknowledged(target);
  for (const name of [...drains, 'hook-log.jsonl']) drain(root, name, target, known);
}

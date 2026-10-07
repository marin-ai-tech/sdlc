import type { AwaitedGate } from './awaiting.js';
import type { ApprovalGateId, SdlcConfig } from './config.js';
import type { HarnessStamp } from './license.js';
import { appendLog, type LogEntry } from './log.js';
import type { QueueConfig } from '../mcp/outbox.js';

/**
 * Overdue gates (B55): `gates.<g>.overdue_hours` in sdlc.yaml. Where a waiting gate is recorded (status, next,
 * session start, approvals, `sdlc events flush`), a gate whose first `gate.<g>.awaiting` entry for the current
 * digest is older than the threshold gets one `gate.<g>.overdue` entry for that digest, naming who it waits for.
 * Never twice for one digest; without the threshold nothing is ever overdue.
 */
export type WaitConfig = Pick<SdlcConfig, 'license' | 'log'> & Partial<Pick<SdlcConfig, 'gates'>> & QueueConfig;

const HOUR_MS = 3_600_000;

function sameWait(entry: LogEntry, event: string, waiting: AwaitedGate): boolean {
  return entry.event === event && entry.change === waiting.change && entry.detail === waiting.digest;
}

/** The first awaiting entry for the change, gate and digest. */
function firstAwaiting(entries: LogEntry[], waiting: AwaitedGate): LogEntry | undefined {
  const event = `gate.${waiting.gate}.awaiting`;
  return entries.find((entry) => sameWait(entry, event, waiting));
}

/** Whether the gate has waited for this digest longer than its `overdue_hours`. */
export function isOverdue(config: WaitConfig, entries: LogEntry[], waiting: AwaitedGate, now = Date.now()): boolean {
  const hours = config.gates?.[waiting.gate as ApprovalGateId]?.overdueHours;
  if (!hours) return false;
  const since = Date.parse(firstAwaiting(entries, waiting)?.ts ?? '');
  if (Number.isNaN(since)) return false;
  return now - since > hours * HOUR_MS;
}

/** Appends `gate.<g>.overdue` once per change, gate and digest when the wait is over its threshold. */
export function recordOverdue(
  root: string,
  config: WaitConfig,
  entries: LogEntry[],
  waiting: AwaitedGate,
  stamp?: HarnessStamp,
): void {
  const event = `gate.${waiting.gate}.overdue`;
  if (!isOverdue(config, entries, waiting)) return;
  if (entries.some((entry) => sameWait(entry, event, waiting))) return;
  const waitingFor = waiting.people ?? firstAwaiting(entries, waiting)?.waitingFor;
  const input = { event, change: waiting.change, detail: waiting.digest, ...(waitingFor ? { waitingFor } : {}) };
  appendLog(root, config, input, stamp);
  entries.push({ ts: new Date().toISOString(), sdlc: '', license: '', ...input });
}

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SdlcConfig } from './config.js';
import { ensureDir, isFile, readText } from './fs-utils.js';
import { harnessStamp, type HarnessStamp } from './license.js';
import { queueEvent, type EventSummary, type QueueConfig } from '../mcp/outbox.js';
import { agentEnvironment } from './agent-env.js';
import { ensureLocalIgnore } from './local-ignore.js';
import { parseLogEntry } from './log-record.js';
import { appendLogRecords, logFile, withLogWriter } from './log-write.js';
import { SdlcError } from './errors.js';
import { drainLogSpool, spoolLogRecord, spooledRecords } from './log-spool.js';
import type { Json } from '../plugins/api.js';
import { deferObservation, isPreparation } from '../plugins/evaluation.js';
import { drainLocalLog } from './log-recovery.js';
import type { VerifyRunFacts } from './verify-runs.js';
import type { ReviewRoundFacts } from './review-rounds.js';

/**
 * Append-only project log: one JSON object per line in
 * `openspec/.sdlc/log.jsonl`. It records what the harness did and decided
 * across all changes (setup, gate decisions, verification runs, archives,
 * hook denials), and every entry carries the sdlc version and the license
 * the project uses sdlc under. The log is committed with the project; the
 * `merge=union` attribute written next to it lets branches append
 * concurrently without merge conflicts.
 */
export const LOG_PATH = 'openspec/.sdlc/log.jsonl';
export const HOOK_LOG_PATH = 'openspec/.sdlc/hook-log.jsonl';

export interface LogEntry {
  ts: string;
  event: string;
  change?: string;
  by?: string;
  detail?: string;
  run?: VerifyRunFacts;
  round?: ReviewRoundFacts;
  /** The version a gate decision was about. */
  digest?: string;
  /** Agent integration that triggered the entry (hook decisions). */
  agent?: string;
  /** Person ids from roles.yaml a waiting gate waits for (`gate.<g>.awaiting`, `gate.<g>.overdue`; B54). */
  waitingFor?: string[];
  approvals?: number;
  /** Counts for `summary.daily` only (B99); queued onto EventBody.summary. */
  summary?: EventSummary;
  /** Task number of a `task.exported` entry (B116). */
  task?: string;
  /** Executor id of `task.exported` / `task.result_checked` entries (B116). */
  executor?: string;
  plugin?: { name: string; version: string; digest: string; eventId: string; request: string; transaction: string; payload: Json };
  sdlc: string;
  license: string;
}

export type LogInput = Omit<LogEntry, 'ts' | 'sdlc' | 'license'>;

const GITATTRIBUTES = 'log.jsonl merge=union\n';

export function ensureHookIgnore(root: string): void {
  const file = path.join(root, 'openspec/.sdlc/.gitignore');
  ensureDir(path.dirname(file));
  const text = readText(file) ?? '';
  if (text.split(/\r?\n/).includes('hook-log.jsonl')) return;
  const separator = text && !text.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(file, `${text}${separator}hook-log.jsonl\n`, 'utf-8');
}

function logEntry(config: Pick<SdlcConfig, 'license'>, input: LogInput, stamp: HarnessStamp): LogEntry {
  const agent = input.agent ?? agentEnvironment();
  return {
    ts: new Date().toISOString(), event: input.event,
    ...(input.change ? { change: input.change } : {}),
    ...(input.by ? { by: input.by } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.run ? { run: input.run } : {}),
    ...(input.round ? { round: input.round } : {}),
    ...(input.digest ? { digest: input.digest } : {}),
    ...(agent ? { agent } : {}),
    ...(input.waitingFor ? { waitingFor: input.waitingFor } : {}),
    ...(input.approvals !== undefined ? { approvals: input.approvals } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.task ? { task: input.task } : {}),
    ...(input.executor ? { executor: input.executor } : {}),
    ...(input.plugin ? { plugin: input.plugin } : {}),
    sdlc: stamp.version, license: stamp.license,
  };
}

/** Hook processes only append; the next ordinary log write drains the local queue. */
export function appendHookLog(root: string, config: SdlcConfig & QueueConfig, input: LogInput): void {
  if (!config.log.enabled || !config.log.hookDecisions) return;
  appendLocalLog(root, config, input);
}

/** Reading commands queue observations without changing the tracked project log. */
export function appendLocalLog(
  root: string, config: Pick<SdlcConfig, 'license' | 'log'> & QueueConfig,
  input: LogInput, stamp: HarnessStamp = harnessStamp(config),
): void {
  if (isPreparation(root) || !config.log.enabled) return;
  if (deferObservation(root, () => appendLocalLog(root, config, structuredClone(input), stamp))) return;
  let entry: LogEntry | undefined;
  let wrote = false;
  try {
    entry = logEntry(config, input, stamp);
    withLogWriter(root, () => {
      const file = logFile(root, 'hook-log.jsonl');
      ensureLocalIgnore(root, ['hook-log.jsonl']);
      appendLogRecords(file, [entry]);
      wrote = true;
    });
    queueEvent(root, config, entry);
  } catch (error) {
    if (!wrote && entry && writerUnavailable(error, root)) {
      try {
        spoolLogRecord(root, entry);
        queueEvent(root, config, entry);
        return;
      } catch (spoolError) { logDiagnostic(spoolError); return; }
    }
    logDiagnostic(error);
  }
}

function drainHookLog(root: string, file: string): void {
  drainLocalLog(root, file);
}

function logDiagnostic(error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  try { process.stderr.write(`sdlc: project log pending: ${detail.slice(0, 500)}; run sdlc doctor\n`); }
  catch { /* Observation failures never alter a command or hook decision. */ }
}

function writerUnavailable(error: unknown, root: string): boolean {
  if (error instanceof SdlcError && error.code === 'writer_locked') return true;
  const failure = error as NodeJS.ErrnoException;
  if (!['EPERM', 'EACCES', 'EBUSY'].includes(failure?.code ?? '')) return false;
  if (typeof failure.path !== 'string') return false;
  // The writer lock lives under the real path of the root (logDirectory), not under a short or linked spelling.
  let real: string;
  try { real = fs.realpathSync(root); }
  catch { return false; }
  const lock = path.join(real, 'openspec', '.sdlc', 'log.lock');
  return failure.path.startsWith(`${lock}.writers${path.sep}`);
}

export function appendLog(
  root: string,
  config: Pick<SdlcConfig, 'license' | 'log'> & QueueConfig,
  input: LogInput,
  stamp: HarnessStamp = harnessStamp(config),
  options: { outbox?: boolean; strict?: boolean } = {},
): void {
  if (isPreparation(root) || !config.log.enabled) return;
  if (deferObservation(root, () => appendLog(root, config, structuredClone(input), stamp, options))) return;
  const file = path.join(root, LOG_PATH);
  let entry: LogEntry | undefined;
  let wrote = false;
  try {
    entry = logEntry(config, input, stamp);
    withLogWriter(root, () => {
      logFile(root, 'log.jsonl');
      ensureHookIgnore(root);
      const attributes = path.join(path.dirname(file), '.gitattributes');
      if (!isFile(attributes)) fs.writeFileSync(attributes, GITATTRIBUTES, 'utf-8');
      try { drainHookLog(root, file); }
      catch (error) { if (options.strict) throw error; logDiagnostic(error); }
      try { drainLogSpool(root, file); }
      catch (error) { if (options.strict) throw error; logDiagnostic(error); }
      appendLogRecords(file, [entry]);
      wrote = true;
    });
    if (options.outbox !== false) queueEvent(root, config, entry);
  } catch (error) {
    if (options.strict) throw error;
    if (!wrote && entry && writerUnavailable(error, root)) {
      try {
        spoolLogRecord(root, entry);
        if (options.outbox !== false) queueEvent(root, config, entry);
        return;
      } catch (spoolError) { logDiagnostic(spoolError); return; }
    }
    logDiagnostic(error);
  }
}

/** Shared entries in file order, followed by local queue entries in file order; malformed lines are skipped. */
export function readLog(root: string): LogEntry[] {
  const text = [readText(path.join(root, LOG_PATH)), readText(path.join(root, HOOK_LOG_PATH))]
    .filter((part): part is string => part !== undefined).join('\n');
  const entries: LogEntry[] = [];
  const pluginIds = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = parseLogEntry(JSON.parse(line));
      if (!parsed) continue;
      if (parsed.plugin) {
        if (pluginIds.has(parsed.plugin.eventId)) continue;
        pluginIds.add(parsed.plugin.eventId);
      }
      entries.push(parsed);
    } catch {
      // skip
    }
  }
  let pending: LogEntry[] = [];
  try { pending = spooledRecords(root); }
  catch { /* Doctor reports unsafe spool storage; ordinary log reads remain available. */ }
  for (const entry of pending) {
    if (entry.plugin && pluginIds.has(entry.plugin.eventId)) continue;
    if (entry.plugin) pluginIds.add(entry.plugin.eventId);
    entries.push(entry);
  }
  return entries;
}

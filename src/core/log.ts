import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SdlcConfig } from './config.js';
import { ensureDir, isFile, readText } from './fs-utils.js';
import { harnessStamp, type HarnessStamp } from './license.js';
import { queueEvent, type EventSummary, type QueueConfig } from '../mcp/outbox.js';
import { agentEnvironment } from './agent-env.js';
import { ensureLocalIgnore } from './local-ignore.js';
import { parseLogEntry } from './log-record.js';

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
  /** The version a gate decision was about. */
  digest?: string;
  /** Agent integration that triggered the entry (hook decisions). */
  agent?: string;
  /** Person ids from roles.yaml a waiting gate waits for (`gate.<g>.awaiting`, `gate.<g>.overdue`; B54). */
  waitingFor?: string[];
  /** Counts for `summary.daily` only (B99); queued onto EventBody.summary. */
  summary?: EventSummary;
  /** Task number of a `task.exported` entry (B116). */
  task?: string;
  /** Executor id of `task.exported` / `task.result_checked` entries (B116). */
  executor?: string;
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
    ...(input.digest ? { digest: input.digest } : {}),
    ...(agent ? { agent } : {}),
    ...(input.waitingFor ? { waitingFor: input.waitingFor } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.task ? { task: input.task } : {}),
    ...(input.executor ? { executor: input.executor } : {}),
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
  if (!config.log.enabled) return;
  try {
    const file = path.join(root, HOOK_LOG_PATH);
    ensureDir(path.dirname(file));
    ensureLocalIgnore(root, ['hook-log.jsonl']);
    const entry = logEntry(config, input, stamp);
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf-8');
    queueEvent(root, config, entry);
  } catch {
    // Logging cannot prevent a hook decision.
  }
}

function drainHookLog(root: string, file: string): void {
  const queue = path.join(root, HOOK_LOG_PATH);
  const drained = `${queue}.${process.pid}.${Date.now()}.drain`;
  try {
    fs.renameSync(queue, drained);
  } catch {
    return;
  }
  try {
    fs.appendFileSync(file, fs.readFileSync(drained));
    fs.rmSync(drained);
  } catch {
    try { fs.renameSync(drained, queue); } catch { /* keep the drain for recovery */ }
  }
}

export function appendLog(
  root: string,
  config: Pick<SdlcConfig, 'license' | 'log'> & QueueConfig,
  input: LogInput,
  stamp: HarnessStamp = harnessStamp(config)
): void {
  if (!config.log.enabled) return;
  const file = path.join(root, LOG_PATH);
  try {
    ensureDir(path.dirname(file));
    ensureHookIgnore(root);
    const attributes = path.join(path.dirname(file), '.gitattributes');
    if (!isFile(attributes)) fs.writeFileSync(attributes, GITATTRIBUTES, 'utf-8');
    drainHookLog(root, file);
    const entry = logEntry(config, input, stamp);
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf-8');
    queueEvent(root, config, entry);
  } catch {
    // The log is a record, not a gate: failing to write it never fails a command or a hook.
  }
}

/** Shared entries in file order, followed by local queue entries in file order; malformed lines are skipped. */
export function readLog(root: string): LogEntry[] {
  const text = [readText(path.join(root, LOG_PATH)), readText(path.join(root, HOOK_LOG_PATH))]
    .filter((part): part is string => part !== undefined).join('\n');
  if (!text) return [];
  const entries: LogEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = parseLogEntry(JSON.parse(line));
      if (parsed) entries.push(parsed);
    } catch {
      // skip
    }
  }
  return entries;
}

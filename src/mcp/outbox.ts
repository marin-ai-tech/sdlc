import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SdlcConfig } from '../core/config.js';
import { git } from '../core/git.js';
import type { LogEntry } from '../core/log.js';
import { personByEmail, readRolesFile } from '../core/roles.js';
import { receiverKey, receiversFor } from './event-config.js';

/**
 * The event queue (B45): a log entry that some receiver wants is written to `<git dir>/sdlc/outbox/<id>.json`
 * when it is appended to the project log, and delivered after the command (src/mcp/events.ts). The queue lives in
 * the git directory, so it never reaches a commit; outside a git repository nothing is queued. An event carries
 * the entry's name, change, gate, time, sdlc version, the person id of its identity (roles.yaml) and, for a waiting
 * gate, the ids of the people it waits for. Never an email, never the entry's detail, never command text or output.
 */
export interface EventBody {
  /** Stable for the entry (a hash of at, event, change and gate), so a receiver can drop repeats. */
  id: string;
  project: string;
  event: string;
  change?: string;
  gate?: string;
  at: string;
  sdlc: string;
  /** The person id from roles.yaml; absent without roles.yaml or when the identity is no person. */
  by?: string;
  waitingFor?: string[];
}

export interface QueuedEvent {
  event: EventBody;
  /** The receivers (`server/tool`) that have not taken the event yet. */
  receivers: string[];
}

export interface QueuedFile {
  file: string;
  item: QueuedEvent;
}

/** What the queue needs from sdlc.yaml; absent `events` = no receivers, nothing is ever queued. */
export type QueueConfig = Partial<Pick<SdlcConfig, 'events' | 'project'>>;

const GATE_EVENT = /^gate\.([^.]+)\./;
const EMAIL_IN_IDENTITY = /<([^>]+)>/;

/** `<git dir>/sdlc/outbox`, or undefined outside a git repository. */
export function outboxDir(root: string): string | undefined {
  const result = git(root, ['rev-parse', '--git-dir']);
  if (!result.ok || !result.stdout) return undefined;
  return path.join(path.resolve(root, result.stdout), 'sdlc', 'outbox');
}

/** The event id: the same entry always gets the same id. */
export function eventId(entry: Pick<LogEntry, 'ts' | 'event' | 'change'>, gate?: string): string {
  const source = [entry.ts, entry.event, entry.change ?? '', gate ?? ''].join('\n');
  return createHash('sha256').update(source).digest('hex').slice(0, 24);
}

function identityEmail(by: string | undefined): string | undefined {
  if (!by) return undefined;
  const bracketed = EMAIL_IN_IDENTITY.exec(by)?.[1];
  if (bracketed) return bracketed.trim();
  return by.includes('@') ? by.trim() : undefined;
}

/** The roles.yaml person id of a log identity; undefined without roles.yaml, an email, or a matching person. */
function personId(root: string, by: string | undefined): string | undefined {
  const email = identityEmail(by);
  if (!email) return undefined;
  try {
    const roles = readRolesFile(root);
    return roles ? personByEmail(roles, email)?.id : undefined;
  } catch {
    return undefined;
  }
}

/** The body a receiver gets for one log entry. */
export function eventBody(root: string, config: QueueConfig, entry: LogEntry): EventBody {
  const gate = GATE_EVENT.exec(entry.event)?.[1];
  const by = personId(root, entry.by);
  return {
    id: eventId(entry, gate),
    project: config.project?.name ?? path.basename(root),
    event: entry.event,
    ...(entry.change ? { change: entry.change } : {}),
    ...(gate ? { gate } : {}),
    at: entry.ts,
    sdlc: entry.sdlc,
    ...(by ? { by } : {}),
    ...(Array.isArray(entry.waitingFor) ? { waitingFor: [...entry.waitingFor] } : {}),
  };
}

/**
 * Queues the entry for every receiver whose `on` matches it. Without receivers it returns at once: no file, no
 * process. Never throws: a notification that cannot be queued never fails a command or a hook.
 */
export function queueEvent(root: string, config: QueueConfig, entry: LogEntry): void {
  const receivers = config.events?.length ? receiversFor(config.events, entry.event) : [];
  if (receivers.length === 0) return;
  try {
    const dir = outboxDir(root);
    if (!dir) return;
    const event = eventBody(root, config, entry);
    const item: QueuedEvent = { event, receivers: receivers.map(receiverKey) };
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${event.id}.json`);
    fs.writeFileSync(file, `${JSON.stringify(item, null, 2)}\n`, { encoding: 'utf-8', flag: 'wx' });
  } catch {
    // The log entry is written either way; only this notification is lost (or it was queued already).
  }
}

function readQueued(file: string): QueuedFile[] {
  try {
    const item = JSON.parse(fs.readFileSync(file, 'utf-8')) as QueuedEvent;
    const valid = typeof item?.event?.event === 'string' && Array.isArray(item.receivers);
    return valid ? [{ file, item }] : [];
  } catch {
    return [];
  }
}

/** The queued events, oldest first; unreadable files are skipped. */
export function readOutbox(root: string): QueuedFile[] {
  const dir = outboxDir(root);
  if (!dir || !fs.existsSync(dir)) return [];
  const names = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
  const queued = names.flatMap((name) => readQueued(path.join(dir, name)));
  return queued.sort((a, b) => a.item.event.at.localeCompare(b.item.event.at));
}

/** Removes receivers that took (or no longer want) the event; the file goes once no receiver is left. */
export function settleQueued(queued: QueuedFile, keys: string[]): void {
  queued.item.receivers = queued.item.receivers.filter((key) => !keys.includes(key));
  if (queued.item.receivers.length === 0) {
    fs.rmSync(queued.file, { force: true });
    return;
  }
  fs.writeFileSync(queued.file, `${JSON.stringify(queued.item, null, 2)}\n`, 'utf-8');
}

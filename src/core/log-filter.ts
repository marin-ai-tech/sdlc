import type { LogEntry } from './log.js';

/** What `sdlc log` keeps (B106). Every given part must match; a missing part keeps every entry. */
export interface LogFilter {
  /** Only the entries of this change. */
  change?: string;
  /** Only the entries whose event equals this name; `*` matches any text (`gate.*`, `*.approved`). */
  event?: string;
  /** ISO timestamp: only the entries at or after it. */
  since?: string;
}

type EntryCheck = (entry: LogEntry) => boolean;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A test for event names: `*` matches any text, every other character only itself (no regex from the user). */
export function eventMatcher(pattern: string): (event: string) => boolean {
  const parts = pattern.split('*').map(escapeRegExp);
  const regex = new RegExp(`^${parts.join('.*')}$`, 's');
  return (event) => regex.test(event);
}

function eventCheck(pattern: string): EntryCheck {
  const matches = eventMatcher(pattern);
  return (entry) => matches(entry.event);
}

function sinceCheck(since: string): EntryCheck {
  const start = Date.parse(since);
  return (entry) => {
    const at = Date.parse(entry.ts);
    return Number.isFinite(at) && at >= start;
  };
}

function checksOf(filter: LogFilter): EntryCheck[] {
  const checks: EntryCheck[] = [];
  const change = filter.change;
  if (change) checks.push((entry) => entry.change === change);
  if (filter.event !== undefined) checks.push(eventCheck(filter.event));
  if (filter.since !== undefined) checks.push(sinceCheck(filter.since));
  return checks;
}

/** The entries that match the filter, in log order. */
export function filterLog(entries: LogEntry[], filter: LogFilter): LogEntry[] {
  const checks = checksOf(filter);
  return entries.filter((entry) => checks.every((check) => check(entry)));
}
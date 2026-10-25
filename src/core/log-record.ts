import type { LogEntry } from './log.js';
import { recordObject, stringFields, stringList } from './record-values.js';

function validSummary(value: unknown): boolean {
  const raw = recordObject(value);
  if (!raw || !['done', 'active', 'awaitingHuman', 'blocked'].every((key) =>
    typeof raw[key] === 'number' && Number.isFinite(raw[key]))) return false;
  if (!stringList(raw.activeIds) || !Array.isArray(raw.waiting)) return false;
  return raw.waiting.every((entry) => {
    const item = recordObject(entry);
    return item && stringFields(item, ['id', 'gate']) && stringList(item.waitingFor);
  });
}

/** Parse before log filtering, rendering or digest/identity use. Unknown fields are not interpreted. */
export function parseLogEntry(value: unknown): LogEntry | undefined {
  const raw = recordObject(value);
  if (!raw) return undefined;
  const sdlc = raw.sdlc === undefined ? raw.scdl : raw.sdlc;
  const entry: Record<string, unknown> = { ...raw, sdlc };
  if (!stringFields(entry, ['ts', 'event', 'sdlc', 'license'],
    ['change', 'by', 'detail', 'digest', 'agent', 'task', 'executor'])) return undefined;
  if (raw.waitingFor !== undefined && !stringList(raw.waitingFor)) return undefined;
  if (raw.summary !== undefined && !validSummary(raw.summary)) return undefined;
  delete entry.scdl;
  return entry as unknown as LogEntry;
}

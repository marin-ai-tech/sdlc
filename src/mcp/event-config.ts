import { SdlcError } from '../core/errors.js';

/**
 * The event sink's receivers (B45): `events: [{ server, tool, on, args }]` in `openspec/sdlc.yaml`. Each receiver
 * names a registry server (`mcp.servers`) and the tool sdlc calls on it for every log event whose name matches one
 * of its `on` patterns (`*` stands for any text). Parsed into types here; config.ts only calls `parseEvents`.
 * Hook events (`hook.*`) reach a receiver only through a pattern that names them (`hook.denied`, `hook.*`).
 */
export interface EventReceiver {
  server: string;
  tool: string;
  /** Patterns of log event names. */
  on: string[];
  /** Static arguments passed next to `event`. */
  args: Record<string, unknown>;
}

/** The events a receiver gets when its `on` is absent. */
export const DEFAULT_EVENT_PATTERNS = ['gate.*', 'verify.*', 'change.created', 'change.archived', 'backlog.*'];

const HOOK_PREFIX = 'hook.';

type Raw = Record<string, unknown>;

function invalid(key: string, where: string, extra: Record<string, string> = {}): SdlcError {
  return new SdlcError('invalid_config', { key, params: { p1: where, where, ...extra } });
}

function mapping(value: unknown, where: string): Raw | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid('error.x_must_be_a_mapping', where);
  return value as Raw;
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid('error.x_must_be_a_non_empty_string', where);
  return value;
}

function patterns(value: unknown, where: string): string[] {
  if (value === undefined || value === null) return [...DEFAULT_EVENT_PATTERNS];
  const valid = Array.isArray(value) && value.length > 0;
  if (!valid || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw invalid('error.x_must_be_a_list_of_strings', where);
  }
  return value as string[];
}

function parseReceiver(value: unknown, where: string, servers: string[]): EventReceiver {
  const raw = mapping(value, where) ?? {};
  const server = text(raw.server, `${where}.server`);
  if (!servers.includes(server)) throw invalid('error.events_unknown_server', `${where}.server`, { server });
  return {
    server,
    tool: text(raw.tool, `${where}.tool`),
    on: patterns(raw.on, `${where}.on`),
    args: mapping(raw.args, `${where}.args`) ?? {},
  };
}

/** `events`: the receivers, in the file's order; absent = none. `servers` are the names of `mcp.servers`. */
export function parseEvents(value: unknown, where: (key: string) => string, servers: string[]): EventReceiver[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid('error.x_must_be_a_list', where('events'));
  return value.map((item, index) => parseReceiver(item, where(`events[${index}]`), servers));
}

function escapeRegExp(part: string): string {
  return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether `pattern` matches the event name; a hook event only through a pattern that starts with `hook.`. */
export function patternMatches(pattern: string, event: string): boolean {
  if (event.startsWith(HOOK_PREFIX) && !pattern.startsWith(HOOK_PREFIX)) return false;
  const source = pattern.split('*').map(escapeRegExp).join('.*');
  return new RegExp(`^${source}$`).test(event);
}

/** A stable key for a receiver in the queue: its server and tool. */
export function receiverKey(receiver: Pick<EventReceiver, 'server' | 'tool'>): string {
  return `${receiver.server}/${receiver.tool}`;
}

/** The receivers one event goes to (each server and tool once). */
export function receiversFor(receivers: EventReceiver[], event: string): EventReceiver[] {
  const matching = receivers.filter((receiver) => receiver.on.some((pattern) => patternMatches(pattern, event)));
  const seen = new Set<string>();
  return matching.filter((receiver) => {
    const key = receiverKey(receiver);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

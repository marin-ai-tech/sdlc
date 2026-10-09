import { SdlcError } from '../core/errors.js';
/** The events a receiver gets when its `on` is absent. */
export const DEFAULT_EVENT_PATTERNS = [
    'gate.*', 'verify.*', 'change.created', 'change.archived', 'backlog.*', 'health.degraded', 'health.recovered',
];
const HOOK_PREFIX = 'hook.';
function invalid(key, where, extra = {}) {
    return new SdlcError('invalid_config', { key, params: { p1: where, where, ...extra } });
}
function mapping(value, where) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'object' || Array.isArray(value))
        throw invalid('error.x_must_be_a_mapping', where);
    return value;
}
function text(value, where) {
    if (typeof value !== 'string' || value.trim() === '')
        throw invalid('error.x_must_be_a_non_empty_string', where);
    return value;
}
function patterns(value, where) {
    if (value === undefined || value === null)
        return [...DEFAULT_EVENT_PATTERNS];
    const valid = Array.isArray(value) && value.length > 0;
    if (!valid || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
        throw invalid('error.x_must_be_a_list_of_strings', where);
    }
    return value;
}
function parseReceiver(value, where, servers) {
    const raw = mapping(value, where) ?? {};
    const server = text(raw.server, `${where}.server`);
    if (!servers.includes(server))
        throw invalid('error.events_unknown_server', `${where}.server`, { server });
    return {
        server,
        tool: text(raw.tool, `${where}.tool`),
        on: patterns(raw.on, `${where}.on`),
        args: mapping(raw.args, `${where}.args`) ?? {},
    };
}
/** `events`: the receivers, in the file's order; absent = none. `servers` are the names of `mcp.servers`. */
export function parseEvents(value, where, servers) {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value))
        throw invalid('error.x_must_be_a_list', where('events'));
    return value.map((item, index) => parseReceiver(item, where(`events[${index}]`), servers));
}
function escapeRegExp(part) {
    return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}
/** Whether `pattern` matches the event name; a hook event only through a pattern that starts with `hook.`. */
export function patternMatches(pattern, event) {
    if (event.startsWith(HOOK_PREFIX) && !pattern.startsWith(HOOK_PREFIX))
        return false;
    const source = pattern.split('*').map(escapeRegExp).join('.*');
    return new RegExp(`^${source}$`).test(event);
}
/** A stable key for a receiver in the queue: its server and tool. */
export function receiverKey(receiver) {
    return `${receiver.server}/${receiver.tool}`;
}
/** The receivers one event goes to (each server and tool once). */
export function receiversFor(receivers, event) {
    const matching = receivers.filter((receiver) => receiver.on.some((pattern) => patternMatches(pattern, event)));
    const seen = new Set();
    return matching.filter((receiver) => {
        const key = receiverKey(receiver);
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}

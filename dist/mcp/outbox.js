import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projectNameFromManifest } from '../core/project-name.js';
import { git } from '../core/git.js';
import { personByEmail, readRolesFile } from '../core/roles.js';
import { maskSecrets } from './checks.js';
import { chatParts } from './event-chat.js';
import { patternMatches, receiverKey, receiversFor } from './event-config.js';
import { eventMessage, peopleNames } from './event-message.js';
const GATE_EVENT = /^gate\.([^.]+)\./;
const WAIT_EVENT = /^gate\.[^.]+\.(awaiting|overdue)$/;
const EMAIL_IN_IDENTITY = /<([^>]+)>/;
const NOTE_EVENT = /^gate\.[^.]+\.(rejected|rework)$/;
const NOTE_MAX = 200;
const ELLIPSIS = '\u2026';
/** `<git dir>/sdlc/outbox`, or undefined outside a git repository. */
export function outboxDir(root) {
    const result = git(root, ['rev-parse', '--git-dir']);
    if (!result.ok || !result.stdout)
        return undefined;
    return path.join(path.resolve(root, result.stdout), 'sdlc', 'outbox');
}
/** The event id: the same entry always gets the same id. */
export function eventId(entry, gate) {
    const source = [entry.ts, entry.event, entry.change ?? '', gate ?? ''].join('\n');
    return shortHash(source);
}
function shortHash(source) {
    return createHash('sha256').update(source).digest('hex').slice(0, 24);
}
/** The id of a wait: the same in every clone; project.name when set, else change/gate/event/digest only. */
export function waitId(projectName, entry, gate) {
    const shared = [entry.change ?? '', gate, entry.event, entry.detail ?? ''];
    const parts = projectName ? ['wait', projectName, ...shared] : ['wait', ...shared];
    return shortHash(parts.join('\n'));
}
/** The id of an entry's event: a wait with its digest gets `waitId`, every other entry `eventId`. */
export function entryEventId(projectName, entry, gate) {
    const wait = gate !== undefined && Boolean(entry.detail) && WAIT_EVENT.test(entry.event);
    return wait ? waitId(projectName, entry, gate) : eventId(entry, gate);
}
/**
 * Id for `summary.daily` only (B99): stable per project and local calendar day (YYYY-MM-DD), the same in every clone
 * like a wait (B98): project.name when set, never the folder name. A second `events summary` the same day collides.
 */
export function summaryDailyEventId(projectName, day) {
    const parts = projectName ? ['summary.daily', projectName, day] : ['summary.daily', day];
    return shortHash(parts.join('\n'));
}
/** Local YYYY-MM-DD (process timezone), for summary.daily. */
export function localDayOf(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
function identityEmail(by) {
    if (!by)
        return undefined;
    const bracketed = EMAIL_IN_IDENTITY.exec(by)?.[1];
    if (bracketed)
        return bracketed.trim();
    return by.includes('@') ? by.trim() : undefined;
}
/** The roles.yaml person id of a log identity; undefined without roles.yaml, an email, or a matching person. */
function personId(root, by) {
    const email = identityEmail(by);
    if (!email)
        return undefined;
    try {
        const roles = readRolesFile(root);
        return roles ? personByEmail(roles, email)?.id : undefined;
    }
    catch {
        return undefined;
    }
}
/** The body a receiver gets for one log entry. */
export function eventBody(root, config, entry) {
    const gate = GATE_EVENT.exec(entry.event)?.[1];
    const by = personId(root, entry.by);
    const project = config.project?.name ?? projectNameFromManifest(root);
    const idProject = config.project?.name;
    const id = entry.event === 'summary.daily'
        ? summaryDailyEventId(idProject, localDayOf(new Date(entry.ts)))
        : entryEventId(idProject, entry, gate);
    return {
        id,
        project,
        event: entry.event,
        ...(entry.change ? { change: entry.change } : {}),
        ...(gate ? { gate } : {}),
        at: entry.ts,
        sdlc: entry.sdlc,
        ...(by ? { by } : {}),
        ...(entry.agent ? { agent: entry.agent } : {}),
        ...(Array.isArray(entry.waitingFor) ? { waitingFor: [...entry.waitingFor] } : {}),
        ...(entry.summary ? { summary: entry.summary } : {}),
    };
}
/** The ready text when some receiver asks for one; nothing otherwise. */
function messageFor(root, receivers, event) {
    if (!receivers.some((receiver) => receiver.message))
        return {};
    return { message: eventMessage(event, peopleNames(root)) };
}
/** One line with the secrets masked (the masking of src/mcp/checks.ts), cut to NOTE_MAX ending with an ellipsis. */
export function cleanNote(detail) {
    const masked = String(maskSecrets(detail, []));
    const line = masked.replace(/\s+/g, ' ').trim();
    const chars = Array.from(line);
    if (chars.length <= NOTE_MAX)
        return line;
    return `${chars.slice(0, NOTE_MAX - 1).join('').trimEnd()}${ELLIPSIS}`;
}
/** Whether a receiver that takes the event opted in; every receiver counts, also two on one server and tool. */
function noteWanted(config, event) {
    const takes = (receiver) => receiver.on.some((pattern) => patternMatches(pattern, event));
    return (config.events ?? []).some((receiver) => receiver.includeNote === true && takes(receiver));
}
/** The cleaned note of a rejection or a rework when some receiver opted in to it; nothing otherwise. */
function noteFor(config, entry) {
    if (!entry.detail || !NOTE_EVENT.test(entry.event))
        return {};
    if (!noteWanted(config, entry.event))
        return {};
    const note = cleanNote(entry.detail);
    return note ? { note } : {};
}
/**
 * Queues the entry for every receiver whose `on` matches it. Without receivers it returns at once: no file, no
 * process. Never throws: a notification that cannot be queued never fails a command or a hook.
 */
export function queueEvent(root, config, entry) {
    const receivers = config.events?.length ? receiversFor(config.events, entry.event) : [];
    if (receivers.length === 0)
        return;
    try {
        const dir = outboxDir(root);
        if (!dir)
            return;
        const event = eventBody(root, config, entry);
        const item = {
            event,
            ...(WAIT_EVENT.test(entry.event) && entry.detail ? { waitDigest: entry.detail } : {}),
            receivers: receivers.map(receiverKey),
            ...messageFor(root, receivers, event),
            ...noteFor(config, entry),
            ...chatParts(root, receivers, event),
        };
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${event.id}.json`);
        fs.writeFileSync(file, `${JSON.stringify(item, null, 2)}\n`, { encoding: 'utf-8', flag: 'wx' });
    }
    catch {
        // The log entry is written either way; only this notification is lost (or it was queued already).
    }
}
/**
 * Queues tool calls a command owes (B93: the GitHub issue comment and close of an archive). They share the
 * outbox and its delivery (src/mcp/events.ts): queued here, sent after the command or by `sdlc events flush`.
 * Never throws: a call that cannot be queued never fails a command.
 */
export function queueCalls(root, config, entry, calls) {
    if (calls.length === 0)
        return;
    try {
        const dir = outboxDir(root);
        if (!dir)
            return;
        const event = eventBody(root, config, entry);
        const item = { event, receivers: [], calls };
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${event.id}.calls.json`);
        fs.writeFileSync(file, `${JSON.stringify(item, null, 2)}\n`, { encoding: 'utf-8', flag: 'wx' });
    }
    catch {
        // The command stands either way; only this call is lost (or it was queued already).
    }
}
function readQueued(file) {
    try {
        const item = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const valid = typeof item?.event?.event === 'string' && Array.isArray(item.receivers);
        return valid ? [{ file, item }] : [];
    }
    catch {
        return [];
    }
}
/** The queued events, oldest first; unreadable files are skipped. */
export function readOutbox(root) {
    const dir = outboxDir(root);
    if (!dir || !fs.existsSync(dir))
        return [];
    const names = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
    const queued = names.flatMap((name) => readQueued(path.join(dir, name)));
    return queued.sort((a, b) => a.item.event.at.localeCompare(b.item.event.at));
}
/** Rewrites the queue file, or removes it once no receiver and no call is left. */
function persist(queued) {
    const left = queued.item.receivers.length + (queued.item.calls?.length ?? 0);
    if (left === 0) {
        fs.rmSync(queued.file, { force: true });
        return;
    }
    fs.writeFileSync(queued.file, `${JSON.stringify(queued.item, null, 2)}\n`, 'utf-8');
}
/** Removes receivers that took (or no longer want) the event; the file goes once nothing waits for it. */
export function settleQueued(queued, keys) {
    queued.item.receivers = queued.item.receivers.filter((key) => !keys.includes(key));
    persist(queued);
}
/** Removes calls that went through; the file goes once nothing waits for it. */
export function settleCalls(queued, calls) {
    queued.item.calls = (queued.item.calls ?? []).filter((call) => !calls.includes(call));
    persist(queued);
}

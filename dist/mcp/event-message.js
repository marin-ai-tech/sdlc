import { t } from '../core/i18n.js';
import { readRolesFile } from '../core/roles.js';
/** The kinds of gate events (`gate.<gate>.<kind>`) and their templates. */
const GATE_TEMPLATES = {
    awaiting: 'events.message.awaiting',
    overdue: 'events.message.overdue',
    approved: 'events.message.approved',
    rejected: 'events.message.rejected',
    waived: 'events.message.waived',
    auto_waived: 'events.message.autoWaived',
    rework: 'events.message.rework',
};
/** Other events of a change and their templates. */
const CHANGE_TEMPLATES = {
    'verify.passed': 'events.message.verifyPassed',
    'verify.failed': 'events.message.verifyFailed',
    'change.created': 'events.message.created',
    'change.archived': 'events.message.archived',
    'change.archived.forced': 'events.message.archivedForced',
};
/** Person id to name from roles.yaml; empty without the file or when it cannot be read. */
export function peopleNames(root) {
    try {
        const people = readRolesFile(root)?.people ?? [];
        return new Map(people.map((person) => [person.id, person.name]));
    }
    catch {
        return new Map();
    }
}
function templateKey(event) {
    if (event.event === 'summary.daily')
        return 'events.message.summaryDaily';
    if (!event.change)
        return 'events.message.other';
    const kind = event.gate ? event.event.slice(`gate.${event.gate}.`.length) : undefined;
    const known = kind === undefined ? CHANGE_TEMPLATES[event.event] : GATE_TEMPLATES[kind];
    return known ?? 'events.message.otherChange';
}
function personName(id, names) {
    return names.get(id) ?? id;
}
function byParam(event, names) {
    if (!event.by)
        return { key: 'events.message.someone' };
    return personName(event.by, names);
}
/** The person's name followed by the handle to mention, when there is one. */
function mentioned(id, names, mentions) {
    const handle = mentions.get(id);
    return handle ? `${personName(id, names)} (${handle})` : personName(id, names);
}
function peopleParam(event, names, mentions) {
    const ids = event.waitingFor ?? [];
    if (ids.length === 0)
        return { key: 'events.message.anyApprover' };
    return ids.map((id) => mentioned(id, names, mentions)).join(', ');
}
/** The changes waiting for a person; never the active ones (0.20.3: the text called active changes waiting). */
function waitingParam(event) {
    const ids = event.summary?.waiting.map((item) => item.id) ?? [];
    if (ids.length === 0)
        return { key: 'events.message.noneWaiting' };
    return ids.join(', ');
}
function activeParam(event) {
    const ids = event.summary?.activeIds ?? [];
    if (ids.length === 0)
        return { key: 'events.message.noneWaiting' };
    return ids.join(', ');
}
function oneLine(text) {
    return text.replace(/\s+/g, ' ').trim();
}
/** The one-line text of the event; `mentions` (person id to chat handle) only for a receiver with `chat`. */
export function eventMessage(event, names, locale, mentions = new Map()) {
    const params = {
        project: event.project,
        change: event.change ?? '',
        gate: event.gate ?? '',
        event: event.event,
        by: byParam(event, names),
        people: peopleParam(event, names, mentions),
        waiting: waitingParam(event),
        active: activeParam(event),
    };
    return oneLine(t(templateKey(event), params, locale));
}
/** Between the ready text and the note of a receiver with `include_note`. */
const NOTE_SEPARATOR = ' \u2014 ';
/** The ready text followed by the note; the text alone without a note. */
export function withNote(text, note) {
    return note ? `${text}${NOTE_SEPARATOR}${note}` : text;
}

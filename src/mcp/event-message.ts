import type { Locale, MessageParams } from '../core/i18n.js';
import { t } from '../core/i18n.js';
import { readRolesFile } from '../core/roles.js';
import type { EventBody } from './outbox.js';

/**
 * The ready message of an event (0.15.0) for a receiver with `message: <argument>`: one line of text built only
 * from the event's fields - the project, the change, the gate, the kind of event and the people by their names
 * from roles.yaml (`people.<id>.name`; the id when roles.yaml has no such person). Never an email, a command or
 * its output: the event carries none of them. The note of a rejection or a rework is not part of the text either;
 * only a receiver with `include_note: true` (0.16.1) gets it, appended at delivery by `withNote`. The text is in
 * the given locale (default: the current one, as every other output); the outbox builds it when the event is
 * queued (src/mcp/outbox.ts).
 */
type Param = MessageParams[string];

/** The kinds of gate events (`gate.<gate>.<kind>`) and their templates. */
const GATE_TEMPLATES: Record<string, string> = {
  awaiting: 'events.message.awaiting',
  overdue: 'events.message.overdue',
  approved: 'events.message.approved',
  rejected: 'events.message.rejected',
  waived: 'events.message.waived',
  auto_waived: 'events.message.autoWaived',
  rework: 'events.message.rework',
};

/** Other events of a change and their templates. */
const CHANGE_TEMPLATES: Record<string, string> = {
  'verify.passed': 'events.message.verifyPassed',
  'verify.failed': 'events.message.verifyFailed',
  'change.created': 'events.message.created',
  'change.archived': 'events.message.archived',
  'change.archived.forced': 'events.message.archivedForced',
};

/** Person id to name from roles.yaml; empty without the file or when it cannot be read. */
export function peopleNames(root: string): Map<string, string> {
  try {
    const people = readRolesFile(root)?.people ?? [];
    return new Map(people.map((person) => [person.id, person.name]));
  } catch {
    return new Map();
  }
}

function templateKey(event: EventBody): string {
  if (!event.change) return 'events.message.other';
  const kind = event.gate ? event.event.slice(`gate.${event.gate}.`.length) : undefined;
  const known = kind === undefined ? CHANGE_TEMPLATES[event.event] : GATE_TEMPLATES[kind];
  return known ?? 'events.message.otherChange';
}

function personName(id: string, names: Map<string, string>): string {
  return names.get(id) ?? id;
}

function byParam(event: EventBody, names: Map<string, string>): Param {
  if (!event.by) return { key: 'events.message.someone' };
  return personName(event.by, names);
}

function peopleParam(event: EventBody, names: Map<string, string>): Param {
  const ids = event.waitingFor ?? [];
  if (ids.length === 0) return { key: 'events.message.anyApprover' };
  return ids.map((id) => personName(id, names)).join(', ');
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The one-line text of the event. */
export function eventMessage(event: EventBody, names: Map<string, string>, locale?: Locale): string {
  const params: MessageParams = {
    project: event.project,
    change: event.change ?? '',
    gate: event.gate ?? '',
    event: event.event,
    by: byParam(event, names),
    people: peopleParam(event, names),
  };
  return oneLine(t(templateKey(event), params, locale));
}

/** Between the ready text and the note of a receiver with `include_note`. */
const NOTE_SEPARATOR = ' \u2014 ';

/** The ready text followed by the note; the text alone without a note. */
export function withNote(text: string, note: string | undefined): string {
  return note ? `${text}${NOTE_SEPARATOR}${note}` : text;
}
/**
 * The backlog: `openspec/backlog.md`, the ordered list of planned changes.
 * One item is one future OpenSpec change; epics group items under a goal.
 * The order in the file is the priority: the first ready open item is next.
 * People and agents both edit the file; the CLI parses it tolerantly.
 *
 *   # Backlog
 *
 *   ## E1 Claims self-service
 *   Goal: policyholders see claim status without calling support.
 *
 *   ### B1 [open] Show claim stage in the portal
 *   - **Kind**: feature
 *   - **Risk**: medium
 *   - **Outcome**: policyholders see the stage of each open claim
 *   - **Acceptance**:
 *     - a claim in review shows "in review"
 *     - another policyholder's claim is never listed
 *   - **Depends on**: B4, B5
 *   - **Source**: bmad _bmad-output/claims/spec-claims-status.md CAP-1
 *   - **Change**: claims-status        (set by `sdlc backlog start`)
 *   - **Closed**: 2026-10-12 done — archived as 2026-10-12-claims-status
 *
 *   ## Unassigned
 *   ### B5 [open] …
 *
 * Status lives in the heading: open | in-progress | done | dropped. Readiness
 * is computed, never stored: an open item is ready when it has an Outcome, at
 * least one Acceptance criterion, and every Depends-on item is done.
 * Ids (`B<n>`, `E<n>`) are never reused.
 */
import * as path from 'node:path';
import { CHANGE_KINDS, RISK_LEVELS, type ChangeKind, type RiskLevel } from './change-state.js';
import { SdlcError } from './errors.js';
import { readText, writeTextAtomic } from './fs-utils.js';
import { parseBacklogText, renderBacklog } from './backlog-format.js';

export const BACKLOG_PATH = 'openspec/backlog.md';
export const BACKLOG_STATUSES = ['open', 'in-progress', 'done', 'dropped'] as const;
export type BacklogStatus = (typeof BACKLOG_STATUSES)[number];
/** Heading of the section for items without an epic. */
export const UNASSIGNED = 'Unassigned';

export interface BacklogEpic {
  /** `E<n>`. */
  id: string;
  title: string;
  goal?: string;
  line: number;
}

export interface BacklogItem {
  /** `B<n>`. */
  id: string;
  status: BacklogStatus;
  title: string;
  /** Epic id, absent for Unassigned. */
  epic?: string;
  kind?: ChangeKind;
  risk?: RiskLevel;
  outcome?: string;
  acceptance: string[];
  dependsOn: string[];
  source?: string;
  change?: string;
  closed?: string;
  line: number;
  /** Computed: open, has outcome and acceptance, all dependencies done. */
  ready: boolean;
  /** Computed: dependency ids that are not done (unknown ids included). */
  blockedBy: string[];
  /** Computed: what keeps an open item from being ready (e.g. "no outcome"). */
  missing: string[];
}

export interface Backlog {
  epics: BacklogEpic[];
  /** In file order, which is the priority order. */
  items: BacklogItem[];
}

export interface BacklogItemInput {
  title: string;
  epic?: string;
  kind?: ChangeKind;
  risk?: RiskLevel;
  outcome?: string;
  acceptance?: string[];
  dependsOn?: string[];
  source?: string;
}

export type BacklogMove =
  | { top: true }
  | { before: string }
  | { after: string }
  | { epic: string };

export interface EpicProgress {
  epic: BacklogEpic;
  total: number;
  open: number;
  inProgress: number;
  done: number;
  dropped: number;
}

const NEXT_ID_COMMENT_RE = (prefix: string): RegExp =>
  new RegExp(`<!-- next-${prefix}: (\\d+) -->`, 'g');

function oneLine(value: string, name: string): void {
  if (!value.trim() || /[\r\n]/.test(value)) {
    throw new SdlcError('invalid_option', { key: 'error.x_must_be_one_non_empty_line', params: { name: name } });
  }
}

/** Parses the backlog text (readiness included). Malformed headings are skipped; code blocks are ignored. */
export function parseBacklog(text: string): Backlog {
  return parseBacklogText(text);
}

/** Reads `openspec/backlog.md`; a missing file is an empty backlog. */
export function readBacklog(root: string): Backlog {
  return parseBacklog(readText(path.join(root, BACKLOG_PATH)) ?? '');
}

function save(root: string, backlog: Backlog): void {
  const file = path.join(root, BACKLOG_PATH);
  const previous = readText(file) ?? '';
  writeTextAtomic(file, renderBacklog(backlog, previous));
}

function itemOrThrow(backlog: Backlog, id: string): BacklogItem {
  const item = backlog.items.find((entry) => entry.id === id);
  if (!item) {
    throw new SdlcError('unknown_backlog_item', { key: 'error.unknown_backlog_item_x', params: { id: id } });
  }
  return item;
}

function epicOrThrow(backlog: Backlog, id: string): void {
  if (!backlog.epics.some((entry) => entry.id === id)) {
    throw new SdlcError('unknown_epic', { key: 'error.unknown_epic_x', params: { id: id } });
  }
}

function nextId(ids: string[], prefix: string): string {
  const max = Math.max(0, ...ids.map((id) => Number(id.slice(1))));
  return `${prefix}${max + 1}`;
}

function historicalId(root: string, prefix: string, current: string[]): string {
  const text = readText(path.join(root, BACKLOG_PATH)) ?? '';
  const saved = [...text.matchAll(NEXT_ID_COMMENT_RE(prefix))].map((match) => Number(match[1]));
  const fromCurrent = Number(nextId(current, prefix).slice(1));
  return `${prefix}${Math.max(fromCurrent, ...saved, 1)}`;
}

function validateItemInput(input: BacklogItemInput): void {
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      oneLine(value, key);
    }
  }
  for (const criterion of input.acceptance ?? []) {
    oneLine(criterion, 'acceptance');
  }
  if (input.kind && !CHANGE_KINDS.includes(input.kind)) {
    throw new SdlcError('invalid_option', { key: 'error.invalid_kind_x_2', params: { input_kind: input.kind } });
  }
  if (input.risk && !RISK_LEVELS.includes(input.risk)) {
    throw new SdlcError('invalid_option', { key: 'error.invalid_risk_x_2', params: { input_risk: input.risk } });
  }
}

function assertNoDependencyCycle(backlog: Backlog, dependsOn: string[]): void {
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) {
      throw new SdlcError('dependency_cycle', { key: 'error.dependency_cycle_at_x', params: { id: id } });
    }
    seen.add(id);
    for (const dep of itemOrThrow(backlog, id).dependsOn) {
      if (backlog.items.some((entry) => entry.id === dep)) {
        visit(dep);
      }
    }
    seen.delete(id);
  };
  for (const id of dependsOn) {
    visit(id);
  }
}

function insertIndexForNewItem(backlog: Backlog, epic: string | undefined): number {
  const section = backlog.items
    .map((item, index) => (item.epic === epic ? index : -1))
    .filter((index) => index >= 0);
  const following = epic
    ? backlog.items.findIndex((item) => {
        if (!item.epic) {
          return true;
        }
        const itemEpicIndex = backlog.epics.findIndex((entry) => entry.id === item.epic);
        const targetEpicIndex = backlog.epics.findIndex((entry) => entry.id === epic);
        return itemEpicIndex > targetEpicIndex;
      })
    : -1;
  if (section.length) {
    return section[section.length - 1] + 1;
  }
  if (following < 0) {
    return backlog.items.length;
  }
  return following;
}

/**
 * Appends an item (next free `B<n>`) at the end of its epic's section, or of
 * Unassigned. Creates the file with a header when missing. Errors:
 * `unknown_epic`, `unknown_backlog_item` (a dependency), `dependency_cycle`,
 * `invalid_option` (empty or multi-line text).
 */
export function addBacklogItem(root: string, input: BacklogItemInput): BacklogItem {
  validateItemInput(input);
  const backlog = readBacklog(root);
  if (input.epic) {
    epicOrThrow(backlog, input.epic);
  }
  for (const id of input.dependsOn ?? []) {
    itemOrThrow(backlog, id);
  }
  assertNoDependencyCycle(backlog, input.dependsOn ?? []);
  const id = historicalId(
    root,
    'B',
    backlog.items.map((item) => item.id)
  );
  const item: BacklogItem = {
    id,
    status: 'open',
    title: input.title,
    ...(input.epic ? { epic: input.epic } : {}),
    kind: input.kind,
    risk: input.risk,
    outcome: input.outcome,
    acceptance: input.acceptance ?? [],
    dependsOn: input.dependsOn ?? [],
    source: input.source,
    line: 0,
    ready: false,
    blockedBy: [],
    missing: [],
  };
  const at = insertIndexForNewItem(backlog, input.epic);
  backlog.items.splice(at, 0, item);
  save(root, backlog);
  return itemOrThrow(readBacklog(root), id);
}

/** Adds an epic section (next free `E<n>`) before Unassigned. */
export function addEpic(root: string, input: { title: string; goal?: string }): BacklogEpic {
  oneLine(input.title, 'title');
  if (input.goal !== undefined) {
    oneLine(input.goal, 'goal');
  }
  const backlog = readBacklog(root);
  const id = historicalId(
    root,
    'E',
    backlog.epics.map((epic) => epic.id)
  );
  backlog.epics.push({ id, title: input.title, goal: input.goal, line: 0 });
  save(root, backlog);
  return readBacklog(root).epics.find((epic) => epic.id === id)!;
}

/** The first open, ready item in priority order. */
export function nextBacklogItem(backlog: Backlog): BacklogItem | undefined {
  return backlog.items.find((item) => item.ready);
}

function moveTargetIndex(backlog: Backlog, item: BacklogItem, to: BacklogMove): number {
  if ('top' in to) {
    let at = backlog.items.findIndex((entry) => entry.epic === item.epic);
    if (at < 0) {
      at = backlog.items.length;
    }
    return at;
  }
  if ('epic' in to) {
    item.epic = to.epic;
    const last = backlog.items
      .map((entry, index) => (entry.epic === to.epic ? index : -1))
      .filter((index) => index >= 0)
      .at(-1);
    let at =
      last === undefined
        ? backlog.items.findIndex((entry) => !entry.epic)
        : last + 1;
    if (at < 0) {
      at = backlog.items.length;
    }
    return at;
  }
  const targetId = 'before' in to ? to.before : to.after;
  let at = backlog.items.findIndex((entry) => entry.id === targetId);
  if ('after' in to) {
    at++;
  }
  return at;
}

/** Moves an item to the top of its section, before/after another item
 * (joining that item's epic), or to the end of another epic. */
export function moveBacklogItem(root: string, id: string, to: BacklogMove): BacklogItem {
  const backlog = readBacklog(root);
  const item = itemOrThrow(backlog, id);
  if (Object.keys(to).length !== 1) {
    throw new SdlcError('invalid_option', { key: 'error.exactly_one_move_target_is_required' });
  }
  if ('epic' in to) {
    epicOrThrow(backlog, to.epic);
  }
  if ('before' in to || 'after' in to) {
    const targetId = 'before' in to ? to.before : to.after;
    const target = itemOrThrow(backlog, targetId);
    if (target.id === id) {
      throw new SdlcError('invalid_option', { key: 'error.cannot_move_relative_to_itself' });
    }
    item.epic = target.epic;
  }
  backlog.items.splice(backlog.items.indexOf(item), 1);
  const at = moveTargetIndex(backlog, item, to);
  backlog.items.splice(at, 0, item);
  save(root, backlog);
  return itemOrThrow(readBacklog(root), id);
}

function assertValidTransition(from: BacklogStatus, to: BacklogStatus): void {
  const openLeaving = from === 'open' && to !== 'open';
  const inProgressLeaving = from === 'in-progress' && to !== 'in-progress';
  if (!BACKLOG_STATUSES.includes(to) || !(openLeaving || inProgressLeaving)) {
    throw new SdlcError(
      'invalid_transition',
      { key: 'error.invalid_transition_x_to_x', params: { from: from, to: to } }
    );
  }
}

/**
 * Changes an item's status. `in-progress` needs `change` (written as **Change**);
 * `done` and `dropped` add a **Closed** line with the date and the note.
 * Allowed: open → in-progress | done | dropped; in-progress → done | dropped | open
 * (open clears **Change**). Anything else → `invalid_transition`.
 */
export function setBacklogStatus(
  root: string,
  id: string,
  status: BacklogStatus,
  extra: { change?: string; note?: string } = {},
  now: Date = new Date()
): BacklogItem {
  const backlog = readBacklog(root);
  const item = itemOrThrow(backlog, id);
  assertValidTransition(item.status, status);
  if (status === 'in-progress') {
    if (!extra.change) {
      throw new SdlcError('invalid_option', { key: 'error.change_is_required' });
    }
    oneLine(extra.change, 'change');
    item.change = extra.change;
  }
  if (status === 'done' || status === 'dropped') {
    if (!extra.note) {
      throw new SdlcError('invalid_option', { key: 'error.note_is_required_2' });
    }
    oneLine(extra.note, 'note');
    const date = now.toISOString().slice(0, 10);
    item.closed = `${date} ${status} — ${extra.note}`;
  }
  if (status === 'open') {
    delete item.change;
    delete item.closed;
  }
  item.status = status;
  save(root, backlog);
  return itemOrThrow(readBacklog(root), id);
}

/** Progress per epic, in file order (Unassigned is not an epic). */
export function epicProgress(backlog: Backlog): EpicProgress[] {
  return backlog.epics.map((epic) => {
    const items = backlog.items.filter((item) => item.epic === epic.id);
    return {
      epic,
      total: items.length,
      open: items.filter((item) => item.status === 'open').length,
      inProgress: items.filter((item) => item.status === 'in-progress').length,
      done: items.filter((item) => item.status === 'done').length,
      dropped: items.filter((item) => item.status === 'dropped').length,
    };
  });
}

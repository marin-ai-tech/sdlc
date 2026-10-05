/**
 * Parse and render `openspec/backlog.md`.
 * Kept separate so the backlog API module stays the public surface.
 * Lines the model does not hold are recorded by `backlog-keep.ts` and written back where they were.
 */
import { CHANGE_KINDS, RISK_LEVELS, type ChangeKind, type RiskLevel } from './change-state.js';
import {
  BACKLOG_STATUSES,
  UNASSIGNED,
  type Backlog,
  type BacklogEpic,
  type BacklogItem,
  type BacklogStatus,
} from './backlog.js';
import {
  headingStatus,
  keepDocument,
  keepEpic,
  keepItem,
  keptDocument,
  keptItemLines,
  keptPreamble,
  keptSectionLines,
  keptSectionsAtEnd,
  type KeptDocument,
  type KeptSection,
} from './backlog-keep.js';

const FENCE_RE = /^\s*```/;
const EPIC_HEADING_RE = /^## E(\d+) (.+)$/;
const ITEM_HEADING_RE = /^### B(\d+) \[([^\]]+)\] (.+)$/;
const GOAL_RE = /^Goal: (.+)$/;
const ACCEPTANCE_ITEM_RE = /^  [-*] (.+)$/;
const FIELD_RE =
  /^[-*] \*\*(Kind|Risk|Outcome|Acceptance|Depends on|Source|Change|Closed)\*\*: ?(.*)$/;
const NEXT_ID_COMMENT_RE = (prefix: string): RegExp =>
  new RegExp(`<!-- next-${prefix}: (\\d+) -->`, 'g');
const NEXT_ID_LINE_RE = /^<!-- next-[BE]: \d+ -->$/;
const DEFAULT_TITLE = '# Backlog';
const ORDER_LINE = 'Order is priority.';

interface ParseState {
  backlog: Backlog;
  epic: string | undefined;
  current: BacklogItem | undefined;
  fence: boolean;
  acceptance: boolean;
  kept: KeptDocument;
  /** Where the next line the model does not hold is kept: the preamble, a section, an epic or an item. */
  owner: string[];
}

function refresh(backlog: Backlog): void {
  const byId = new Map(backlog.items.map((item) => [item.id, item]));
  for (const item of backlog.items) {
    item.blockedBy = item.dependsOn.filter((id) => byId.get(id)?.status !== 'done');
    item.missing = [];
    if (!item.outcome?.trim()) {
      item.missing.push('no outcome');
    }
    if (!item.acceptance.length) {
      item.missing.push('no acceptance criteria');
    }
    item.ready = item.status === 'open' && !item.blockedBy.length && !item.missing.length;
  }
}

function parseEpicHeading(line: string, index: number, state: ParseState): boolean {
  const match = EPIC_HEADING_RE.exec(line);
  if (!match) {
    return false;
  }
  const id = `E${match[1]}`;
  const epic: BacklogEpic = { id, title: match[2], line: index + 1 };
  state.epic = id;
  state.current = undefined;
  state.backlog.epics.push(epic);
  state.owner = keepEpic(epic);
  return true;
}

function parseUnassignedOrOtherHeading(line: string, state: ParseState): boolean {
  if (line === `## ${UNASSIGNED}`) {
    state.epic = undefined;
    state.current = undefined;
    state.owner = state.kept.unassigned;
    return true;
  }
  if (line.startsWith('## ')) {
    const section: KeptSection = { heading: line, lines: [] };
    state.current = undefined;
    state.epic = undefined;
    state.kept.sections.push(section);
    state.owner = section.lines;
    return true;
  }
  return false;
}

function parseItemHeading(line: string, index: number, state: ParseState): boolean {
  const match = ITEM_HEADING_RE.exec(line);
  if (!match) {
    return false;
  }
  const statusText = match[2];
  const known = BACKLOG_STATUSES.includes(statusText as BacklogStatus);
  const status: BacklogStatus = known ? (statusText as BacklogStatus) : 'open';
  const item: BacklogItem = {
    id: `B${match[1]}`,
    status,
    title: match[3],
    ...(state.epic ? { epic: state.epic } : {}),
    acceptance: [],
    dependsOn: [],
    line: index + 1,
    ready: false,
    blockedBy: [],
    missing: [],
  };
  state.current = item;
  state.backlog.items.push(item);
  state.acceptance = false;
  state.owner = keepItem(item, known ? undefined : statusText);
  return true;
}

/** Header lines are rewritten by the renderer: the first `# ` title, the order line and the id watermarks. */
function parseHeaderLine(line: string, state: ParseState): boolean {
  const inPreamble = state.owner === state.kept.preamble;
  const watermark = NEXT_ID_LINE_RE.test(line);
  const title = inPreamble && state.kept.title === undefined && line.startsWith('# ');
  const order = inPreamble && line === ORDER_LINE;
  if (!watermark && !title && !order) {
    return false;
  }
  if (title) {
    state.kept.title = line;
  }
  if (inPreamble) {
    state.kept.headerEnd = state.kept.preamble.length;
  }
  return true;
}

function applyField(item: BacklogItem, name: string, value: string): void {
  switch (name) {
    case 'Kind':
      if (CHANGE_KINDS.includes(value as ChangeKind)) {
        item.kind = value as ChangeKind;
      }
      break;
    case 'Risk':
      if (RISK_LEVELS.includes(value as RiskLevel)) {
        item.risk = value as RiskLevel;
      }
      break;
    case 'Outcome':
      item.outcome = value;
      break;
    case 'Depends on':
      item.dependsOn = value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      break;
    case 'Source':
      item.source = value;
      break;
    case 'Change':
      item.change = value;
      break;
    case 'Closed':
      item.closed = value;
      break;
  }
}

function handleGoalLine(line: string, state: ParseState): boolean {
  const goal = GOAL_RE.exec(line);
  const epic = state.backlog.epics.find((entry) => entry.id === state.epic);
  if (!goal || !state.epic || !epic) {
    return false;
  }
  epic.goal = goal[1];
  return true;
}

/** Applies a known field, criterion or epic goal; false when the line is not part of the model. */
function handleItemBodyLine(line: string, state: ParseState): boolean {
  const current = state.current;
  if (!current) {
    return handleGoalLine(line, state);
  }
  if (state.acceptance) {
    const criterion = ACCEPTANCE_ITEM_RE.exec(line);
    if (criterion) {
      current.acceptance.push(criterion[1]);
      return true;
    }
  }
  const field = FIELD_RE.exec(line);
  if (!field) {
    state.acceptance = false;
    return false;
  }
  state.acceptance = field[1] === 'Acceptance';
  applyField(current, field[1], field[2]);
  return true;
}

/** A code block is kept as it is where it stands; a heading inside it is not a heading. */
function keepFencedLine(line: string, state: ParseState): void {
  if (FENCE_RE.test(line)) {
    state.fence = !state.fence;
  }
  state.owner.push(line);
}

function handleLine(line: string, index: number, state: ParseState): void {
  if (state.fence || FENCE_RE.test(line)) {
    keepFencedLine(line, state);
    return;
  }
  if (parseHeaderLine(line, state)) {
    return;
  }
  if (parseEpicHeading(line, index, state)) {
    return;
  }
  if (parseUnassignedOrOtherHeading(line, state)) {
    return;
  }
  if (parseItemHeading(line, index, state)) {
    return;
  }
  if (line.startsWith('### ')) {
    state.current = undefined;
    state.owner.push(line);
    return;
  }
  if (!handleItemBodyLine(line, state)) {
    state.owner.push(line);
  }
}

/** Parses the backlog text (readiness included). Malformed headings are skipped; code blocks are ignored. */
export function parseBacklogText(text: string): Backlog {
  const backlog: Backlog = { epics: [], items: [] };
  const kept = keepDocument(backlog);
  const state: ParseState = {
    backlog,
    epic: undefined,
    current: undefined,
    fence: false,
    acceptance: false,
    kept,
    owner: kept.preamble,
  };
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    handleLine(line, index, state);
  }
  refresh(state.backlog);
  return state.backlog;
}

function highestId(prefix: string, ids: string[], previous: string): number {
  const fromIds = ids.map((id) => Number(id.slice(1)));
  const fromComments = [...previous.matchAll(NEXT_ID_COMMENT_RE(prefix))].map(
    (match) => Number(match[1]) - 1
  );
  return Math.max(0, ...fromIds, ...fromComments);
}

function pushFields(lines: string[], fields: Array<[string, string | undefined]>): void {
  for (const [name, value] of fields) {
    if (value) {
      lines.push(`- **${name}**: ${value}`);
    }
  }
}

function renderFieldLines(item: BacklogItem): string[] {
  const lines: string[] = [];
  pushFields(lines, [
    ['Kind', item.kind],
    ['Risk', item.risk],
    ['Outcome', item.outcome],
  ]);
  if (item.acceptance.length) {
    lines.push('- **Acceptance**:');
    for (const criterion of item.acceptance) {
      lines.push(`  - ${criterion}`);
    }
  }
  if (item.dependsOn.length) {
    lines.push(`- **Depends on**: ${item.dependsOn.join(', ')}`);
  }
  pushFields(lines, [
    ['Source', item.source],
    ['Change', item.change],
    ['Closed', item.closed],
  ]);
  return lines;
}

/** An item: its heading, its known fields, then the lines people wrote under it. */
function renderItemLines(item: BacklogItem): string[] {
  const heading = `### ${item.id} [${headingStatus(item)}] ${item.title}`;
  return ['', heading, ...renderFieldLines(item), ...keptItemLines(item)];
}

function renderSectionLines(
  backlog: Backlog,
  epic: BacklogEpic | undefined,
  kept: KeptDocument | undefined
): string[] {
  const lines: string[] = [];
  const extra = keptSectionLines(kept, epic);
  const hasUnassigned = backlog.items.some((item) => !item.epic);
  if (!epic && !hasUnassigned && backlog.epics.length === 0 && !extra.length) {
    return lines;
  }
  lines.push('');
  lines.push(epic ? `## ${epic.id} ${epic.title}` : `## ${UNASSIGNED}`);
  if (epic?.goal) {
    lines.push(`Goal: ${epic.goal}`);
  }
  lines.push(...extra);
  const sectionItems = backlog.items.filter((item) => item.epic === epic?.id);
  for (const item of sectionItems) {
    lines.push(...renderItemLines(item));
  }
  return lines;
}

function renderHeaderLines(backlog: Backlog, previous: string, kept: KeptDocument | undefined): string[] {
  const itemIds = backlog.items.map((item) => item.id);
  const epicIds = backlog.epics.map((epic) => epic.id);
  const nextB = highestId('B', itemIds, previous) + 1;
  const nextE = highestId('E', epicIds, previous) + 1;
  return [
    kept?.title ?? DEFAULT_TITLE,
    '',
    ORDER_LINE,
    `<!-- next-B: ${nextB} -->`,
    `<!-- next-E: ${nextE} -->`,
    ...keptPreamble(kept),
  ];
}

/**
 * Renders a backlog document. Preserves next-id watermarks from previous text, and the hand-written lines the
 * parser kept beside the model: under their item or epic, after the header, and extra sections at the end.
 */
export function renderBacklog(backlog: Backlog, previous = ''): string {
  const kept = keptDocument(backlog);
  const lines = renderHeaderLines(backlog, previous, kept);
  const sections: Array<BacklogEpic | undefined> = [...backlog.epics, undefined];
  for (const epic of sections) {
    lines.push(...renderSectionLines(backlog, epic, kept));
  }
  lines.push(...keptSectionsAtEnd(kept));
  return `${lines.join('\n')}\n`;
}

/**
 * Parse and render `openspec/backlog.md`.
 * Kept separate so the backlog API module stays the public surface.
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

const FENCE_RE = /^\s*```/;
const EPIC_HEADING_RE = /^## E(\d+) (.+)$/;
const ITEM_HEADING_RE = /^### B(\d+) \[([^\]]+)\] (.+)$/;
const GOAL_RE = /^Goal: (.+)$/;
const ACCEPTANCE_ITEM_RE = /^  [-*] (.+)$/;
const FIELD_RE =
  /^[-*] \*\*(Kind|Risk|Outcome|Acceptance|Depends on|Source|Change|Closed)\*\*: ?(.*)$/;
const NEXT_ID_COMMENT_RE = (prefix: string): RegExp =>
  new RegExp(`<!-- next-${prefix}: (\\d+) -->`, 'g');

interface ParseState {
  backlog: Backlog;
  epic: string | undefined;
  current: BacklogItem | undefined;
  fence: boolean;
  acceptance: boolean;
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
  state.epic = id;
  state.current = undefined;
  state.backlog.epics.push({ id, title: match[2], line: index + 1 });
  return true;
}

function parseUnassignedOrOtherHeading(line: string, state: ParseState): boolean {
  if (line === `## ${UNASSIGNED}`) {
    state.epic = undefined;
    state.current = undefined;
    return true;
  }
  if (line.startsWith('## ')) {
    state.current = undefined;
    state.epic = undefined;
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
  const status: BacklogStatus = BACKLOG_STATUSES.includes(statusText as BacklogStatus)
    ? (statusText as BacklogStatus)
    : 'open';
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

function handleGoalLine(line: string, state: ParseState): void {
  const goal = GOAL_RE.exec(line);
  if (goal && state.epic) {
    const epic = state.backlog.epics.find((entry) => entry.id === state.epic);
    if (epic) {
      epic.goal = goal[1];
    }
  }
}

function handleItemBodyLine(line: string, state: ParseState): void {
  const current = state.current;
  if (!current) {
    handleGoalLine(line, state);
    return;
  }
  if (state.acceptance) {
    const criterion = ACCEPTANCE_ITEM_RE.exec(line);
    if (criterion) {
      current.acceptance.push(criterion[1]);
      return;
    }
  }
  const field = FIELD_RE.exec(line);
  if (!field) {
    state.acceptance = false;
    return;
  }
  state.acceptance = field[1] === 'Acceptance';
  applyField(current, field[1], field[2]);
}

function handleLine(line: string, index: number, state: ParseState): void {
  if (FENCE_RE.test(line)) {
    state.fence = !state.fence;
    return;
  }
  if (state.fence) {
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
    return;
  }
  handleItemBodyLine(line, state);
}

/** Parses the backlog text (readiness included). Malformed headings are skipped; code blocks are ignored. */
export function parseBacklogText(text: string): Backlog {
  const state: ParseState = {
    backlog: { epics: [], items: [] },
    epic: undefined,
    current: undefined,
    fence: false,
    acceptance: false,
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

function renderItemLines(item: BacklogItem): string[] {
  const lines: string[] = ['', `### ${item.id} [${item.status}] ${item.title}`];
  const simpleFields: Array<[string, string | undefined]> = [
    ['Kind', item.kind],
    ['Risk', item.risk],
    ['Outcome', item.outcome],
  ];
  for (const [name, value] of simpleFields) {
    if (value) {
      lines.push(`- **${name}**: ${value}`);
    }
  }
  if (item.acceptance.length) {
    lines.push('- **Acceptance**:');
    for (const criterion of item.acceptance) {
      lines.push(`  - ${criterion}`);
    }
  }
  if (item.dependsOn.length) {
    lines.push(`- **Depends on**: ${item.dependsOn.join(', ')}`);
  }
  const trailingFields: Array<[string, string | undefined]> = [
    ['Source', item.source],
    ['Change', item.change],
    ['Closed', item.closed],
  ];
  for (const [name, value] of trailingFields) {
    if (value) {
      lines.push(`- **${name}**: ${value}`);
    }
  }
  return lines;
}

function renderSectionLines(backlog: Backlog, epic: BacklogEpic | undefined): string[] {
  const lines: string[] = [];
  const hasUnassigned = backlog.items.some((item) => !item.epic);
  if (!epic && !hasUnassigned && backlog.epics.length === 0) {
    return lines;
  }
  lines.push('');
  lines.push(epic ? `## ${epic.id} ${epic.title}` : `## ${UNASSIGNED}`);
  if (epic?.goal) {
    lines.push(`Goal: ${epic.goal}`);
  }
  const sectionItems = backlog.items.filter((item) => item.epic === epic?.id);
  for (const item of sectionItems) {
    lines.push(...renderItemLines(item));
  }
  return lines;
}

/** Renders a backlog document. Preserves next-id watermarks from previous text. */
export function renderBacklog(backlog: Backlog, previous = ''): string {
  const nextB = highestId(
    'B',
    backlog.items.map((item) => item.id),
    previous
  ) + 1;
  const nextE = highestId(
    'E',
    backlog.epics.map((epic) => epic.id),
    previous
  ) + 1;
  const lines: string[] = [
    '# Backlog',
    '',
    'Order is priority.',
    `<!-- next-B: ${nextB} -->`,
    `<!-- next-E: ${nextE} -->`,
  ];
  const sections: Array<BacklogEpic | undefined> = [...backlog.epics, undefined];
  for (const epic of sections) {
    lines.push(...renderSectionLines(backlog, epic));
  }
  return `${lines.join('\n')}\n`;
}

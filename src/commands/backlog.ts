import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { bar } from '../cli/progress.js';
import { emitNextHint, resolveNext } from '../cli/next-hint.js';
import {
  addBacklogItem,
  addEpic,
  epicProgress,
  moveBacklogItem,
  nextBacklogItem,
  readBacklog,
  setBacklogStatus,
  BACKLOG_STATUSES,
  type BacklogMove,
} from '../core/backlog.js';
import { agentEnvironment } from '../core/agent-env.js';
import {
  CHANGE_KINDS,
  RISK_LEVELS,
  SOURCE_TYPES,
  type ChangeKind,
  type RiskLevel,
} from '../core/change-state.js';
import { SdlcError } from '../core/errors.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { appendLog } from '../core/log.js';
import * as path from 'node:path';
import { assertValidChangeId } from '../core/changes.js';
import { readChangeState } from '../core/change-state.js';
import { writeTextAtomic } from '../core/fs-utils.js';
import { createChange } from './changes.js';
import { t } from '../core/i18n.js';

type Options = Record<string, unknown> & { json?: boolean };

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function values(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function run(
  opts: Options,
  action: (ctx: ReturnType<typeof loadProject>) => unknown,
  event?: string
): void {
  try {
    const ctx = loadProject();
    const result = action(ctx);
    if (event) {
      const record = result as { id: string; title: string };
      appendLog(
        ctx.root,
        ctx.config,
        {
          event,
          by: formatIdentity(gitIdentity(ctx.root)),
          detail: `${record.id} ${record.title}`,
        },
        ctx.stamp
      );
    }
    if (opts.json) {
      const key = event === 'backlog.epic.added' ? 'epic' : 'item';
      printJson({ [key]: result ?? null, harness: ctx.stamp });
    } else {
      const message = result
        ? `${(result as { id: string }).id} ${(result as { title: string }).title}`
        : t('backlog.noReady');
      line(message);
    }
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export function backlogEpicAdd(title: string, opts: Options): void {
  run(
    opts,
    (ctx) => addEpic(ctx.root, { title, goal: text(opts.goal) }),
    'backlog.epic.added'
  );
}

export function backlogAdd(title: string, opts: Options): void {
  run(
    opts,
    (ctx) => {
      const kind = text(opts.kind);
      const risk = text(opts.risk);
      const sourceType = text(opts.sourceType);
      const sourceRef = text(opts.sourceRef);
      if (kind && !CHANGE_KINDS.includes(kind as ChangeKind)) {
        throw new SdlcError('invalid_option', { key: 'error.invalid_kind_x', params: { kind: kind } });
      }
      if (risk && !RISK_LEVELS.includes(risk as RiskLevel)) {
        throw new SdlcError('invalid_option', { key: 'error.invalid_risk_x', params: { risk: risk } });
      }
      const sourcePairOk = !!sourceType === !!sourceRef;
      const sourceTypeOk =
        !sourceType || SOURCE_TYPES.includes(sourceType as (typeof SOURCE_TYPES)[number]);
      if (!sourcePairOk || !sourceTypeOk) {
        throw new SdlcError(
      'invalid_option',
      { key: 'error.source_type_and_reference_must_be_valid_and_supp' }
    );
      }
      return addBacklogItem(ctx.root, {
        title,
        epic: text(opts.epic),
        kind: kind as ChangeKind | undefined,
        risk: risk as RiskLevel | undefined,
        outcome: text(opts.outcome),
        acceptance: values(opts.accept),
        dependsOn: values(opts.depends),
        source: sourceType ? `${sourceType} ${sourceRef}` : undefined,
      });
    },
    'backlog.added'
  );
}

function statusLabel(status: string): string {
  const key = `backlog.status.${status}`;
  const text = t(key);
  return text === key ? status : text;
}

function printListTable(items: ReturnType<typeof readBacklog>['items']): void {
  const rows = [
    [t('backlog.colId'), t('backlog.colStatus'), t('backlog.colReady'), t('backlog.colTitle'), t('backlog.colChange')],
    ...items.map((item) => [
      item.id,
      statusLabel(item.status),
      item.ready ? '✓' : '-',
      item.title,
      item.change ?? '-',
    ]),
  ];
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  const formatted = rows
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column]))
        .join('  ')
        .trimEnd()
    )
    .join('\n');
  line(formatted);
}

export function backlogList(opts: Options): void {
  try {
    const ctx = loadProject();
    const backlog = readBacklog(ctx.root);
    const status = text(opts.status);
    if (status && !BACKLOG_STATUSES.includes(status as (typeof BACKLOG_STATUSES)[number])) {
      throw new SdlcError('invalid_option', { key: 'error.invalid_status_x', params: { status: status } });
    }
    const items = backlog.items.filter(
      (item) =>
        (!opts.epic || item.epic === opts.epic) &&
        (!status || item.status === status) &&
        (!opts.ready || item.ready)
    );
    const epics = epicProgress(backlog)
      .filter((progress) => !opts.epic || progress.epic.id === opts.epic)
      .map(({ epic, ...counts }) => ({
        id: epic.id,
        title: epic.title,
        goal: epic.goal,
        ...counts,
      }));
    if (opts.json) {
      printJson({ epics, items, harness: ctx.stamp });
      return;
    }
    for (const epic of [...epics, { id: 'Unassigned', title: '', goal: undefined }]) {
      const section = items.filter((item) => (item.epic ?? 'Unassigned') === epic.id);
      if (!section.length && epic.id === 'Unassigned') {
        continue;
      }
      let epicBar = '';
      if ('done' in epic && typeof epic.done === 'number') {
        const done = epic.done;
        const total = epic.open + epic.inProgress + done;
        epicBar = `  ${bar(done, total)}  ${done}/${total}`;
      }
      const heading = epic.id === 'Unassigned' ? t('backlog.unassigned') : `${epic.id} ${epic.title}`;
      line(`${heading}${epicBar}`.trim());
      if (section.length) {
        printListTable(section);
      }
    }
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export function backlogNext(opts: Options): void {
  run(opts, (ctx) => nextBacklogItem(readBacklog(ctx.root)) ?? null);
}

function human(): void {
  if (agentEnvironment()) {
    throw new SdlcError(
      'agent_cannot_prioritize',
      { key: 'error.backlog_priority_is_a_product_decision_ask_a_per' }
    );
  }
}

export function backlogMove(id: string, opts: Options): void {
  run(
    opts,
    (ctx) => {
      human();
      const targets = [
        opts.top && { top: true as const },
        opts.before && { before: text(opts.before)! },
        opts.after && { after: text(opts.after)! },
        opts.epic && { epic: text(opts.epic)! },
      ].filter(Boolean);
      if (targets.length !== 1) {
        throw new SdlcError('invalid_option', { key: 'error.exactly_one_move_target_is_required' });
      }
      return moveBacklogItem(ctx.root, id, targets[0] as BacklogMove);
    },
    'backlog.moved'
  );
}

export function backlogClose(id: string, status: 'done' | 'dropped', opts: Options): void {
  run(
    opts,
    (ctx) => {
      if (status === 'dropped') {
        human();
      }
      const note = text(opts.note);
      if (!note) {
        throw new SdlcError('invalid_option', { key: 'error.note_is_required' });
      }
      return setBacklogStatus(ctx.root, id, status, { note });
    },
    status === 'done' ? 'backlog.done' : 'backlog.dropped'
  );
}

function draftIntent(item: ReturnType<typeof addBacklogItem>): string {
  return [
    `# Intent: ${item.title}`,
    '',
    `Author: agent. Status: draft. Source: backlog ${item.id}${item.source ? ` (${item.source})` : ''}`,
    '',
    '## Problem',
    item.outcome ?? '',
    '',
    '## Proposed outcome',
    item.outcome ?? '',
    '',
    '## Affected users and systems',
    '',
    '## Constraints',
    '',
    '## Success measures',
    ...item.acceptance.map(value => `- ${value}`),
    '',
    '## Out of scope',
    '',
    '## Open questions',
    '',
  ].join('\n');
}

export function backlogStart(id: string, opts: Options): void {
  try {
    const ctx = loadProject();
    const item = readBacklog(ctx.root).items.find(entry => entry.id === id);
    if (!item) throw new SdlcError('unknown_backlog_item', { key: 'error.unknown_backlog_item_x', params: { id: id } });
    if (item.status !== 'open') throw new SdlcError(
      'invalid_transition',
      { key: 'error.x_is_x', params: { id: id, item_status: item.status } }
    );
    if (!item.ready) {
      const missing = [...item.missing, ...item.blockedBy];
      throw new SdlcError(
        'backlog_item_not_ready',
        { key: 'error.x_is_not_ready_x', params: { id: id, p2: missing.join(', ') } }
      );
    }
    const changeId = text(opts.change) ?? item.title.toLowerCase().normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    assertValidChangeId(changeId);
    const { dir } = createChange(changeId, { kind: item.kind, risk: item.risk,
      sourceType: 'backlog', sourceRef: id });
    writeTextAtomic(path.join(dir, 'intent.md'), draftIntent(item));
    const started = setBacklogStatus(ctx.root, id, 'in-progress', { change: changeId });
    appendLog(ctx.root, ctx.config, { event: 'backlog.started', change: changeId,
      by: formatIdentity(gitIdentity(ctx.root)), detail: id }, ctx.stamp);
    const state = readChangeState(dir);
    const change = { id: changeId, kind: state.kind, risk: state.risk, track: state.track,
      ...(state.track_suggestion ? { trackSuggestion: state.track_suggestion } : {}) };
    const next = resolveNext(ctx, changeId);
    if (opts.json) printJson({ item: started, change, harness: ctx.stamp, ...(next ? { next } : {}) });
    else {
      line(t('backlog.started', { id, change: changeId }));
      emitNextHint(ctx, changeId);
    }
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { bar } from '../cli/progress.js';
import { emitNextHint, resolveNext } from '../cli/next-hint.js';
import { addBacklogItem, addEpic, epicProgress, moveBacklogItem, nextBacklogItem, readBacklog, setBacklogStatus, BACKLOG_STATUSES, } from '../core/backlog.js';
import { agentEnvironment } from '../core/agent-env.js';
import { CHANGE_KINDS, RISK_LEVELS, SOURCE_TYPES, } from '../core/change-state.js';
import { SdlcError } from '../core/errors.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { humanCommandFix } from '../core/human-command.js';
import { appendLog } from '../core/log.js';
import * as path from 'node:path';
import { assertValidChangeId } from '../core/changes.js';
import { readChangeState } from '../core/change-state.js';
import { writeTextAtomic } from '../core/fs-utils.js';
import { createChange } from './changes.js';
import { t } from '../core/i18n.js';
import { editBacklogItem } from '../core/backlog-edit.js';
import { editEpic } from '../core/backlog-epic-edit.js';
function text(value) {
    return typeof value === 'string' ? value : undefined;
}
function values(value) {
    return Array.isArray(value) ? value.map(String) : [];
}
function run(opts, action, event) {
    try {
        const ctx = loadProject();
        const result = action(ctx);
        if (event) {
            const record = result;
            appendLog(ctx.root, ctx.config, {
                event,
                by: formatIdentity(gitIdentity(ctx.root)),
                detail: `${record.id} ${record.title}`,
            }, ctx.stamp);
        }
        if (opts.json) {
            const key = event?.startsWith('backlog.epic.') ? 'epic' : 'item';
            printJson({ [key]: result ?? null, harness: ctx.stamp });
        }
        else {
            const message = result
                ? `${result.id} ${result.title}`
                : t('backlog.noReady');
            line(message);
        }
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
export function backlogEpicAdd(title, opts) {
    run(opts, (ctx) => addEpic(ctx.root, { title, goal: text(opts.goal) }), 'backlog.epic.added');
}
export function backlogEpicEdit(id, opts) {
    run(opts, (ctx) => editEpic(ctx.root, id, {
        title: text(opts.title),
        goal: text(opts.goal),
        clearGoal: opts.clearGoal === true,
    }), 'backlog.epic.edited');
}
export function backlogAdd(title, opts) {
    run(opts, (ctx) => {
        const kind = text(opts.kind);
        const risk = text(opts.risk);
        const sourceType = text(opts.sourceType);
        const sourceRef = text(opts.sourceRef);
        if (kind && !CHANGE_KINDS.includes(kind)) {
            throw new SdlcError('invalid_option', { key: 'error.invalid_kind_x', params: { kind: kind } });
        }
        if (risk && !RISK_LEVELS.includes(risk)) {
            throw new SdlcError('invalid_option', { key: 'error.invalid_risk_x', params: { risk: risk } });
        }
        const sourcePairOk = !!sourceType === !!sourceRef;
        const sourceTypeOk = !sourceType || SOURCE_TYPES.includes(sourceType);
        if (!sourcePairOk || !sourceTypeOk) {
            throw new SdlcError('invalid_option', { key: 'error.source_type_and_reference_must_be_valid_and_supp' });
        }
        return addBacklogItem(ctx.root, {
            title,
            epic: text(opts.epic),
            kind: kind,
            risk: risk,
            outcome: text(opts.outcome),
            acceptance: values(opts.accept),
            dependsOn: values(opts.depends),
            source: sourceType ? `${sourceType} ${sourceRef}` : undefined,
        });
    }, 'backlog.added');
}
export function backlogEdit(id, opts) {
    run(opts, (ctx) => editBacklogItem(ctx.root, id, {
        title: text(opts.title),
        outcome: text(opts.outcome),
        kind: text(opts.kind),
        risk: text(opts.risk),
        acceptance: values(opts.accept).length ? values(opts.accept) : undefined,
        addAcceptance: values(opts.addAccept).length ? values(opts.addAccept) : undefined,
        dependsOn: values(opts.depends).length ? values(opts.depends) : undefined,
        clearDepends: opts.clearDepends === true,
    }), 'backlog.edited');
}
function statusLabel(status) {
    const key = `backlog.status.${status}`;
    const text = t(key);
    return text === key ? status : text;
}
function printListTable(items) {
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
        .map((row) => row
        .map((cell, column) => cell.padEnd(widths[column]))
        .join('  ')
        .trimEnd())
        .join('\n');
    line(formatted);
}
export function backlogList(opts) {
    try {
        const ctx = loadProject();
        const backlog = readBacklog(ctx.root);
        const status = text(opts.status);
        if (status && !BACKLOG_STATUSES.includes(status)) {
            throw new SdlcError('invalid_option', { key: 'error.invalid_status_x', params: { status: status } });
        }
        const items = backlog.items.filter((item) => (!opts.epic || item.epic === opts.epic) &&
            (!status || item.status === status) &&
            (!opts.ready || item.ready));
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
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
export function backlogNext(opts) {
    run(opts, (ctx) => nextBacklogItem(readBacklog(ctx.root)) ?? null);
}
function human(cli, fallback) {
    if (agentEnvironment()) {
        throw new SdlcError('agent_cannot_prioritize', { key: 'error.backlog_priority_is_a_product_decision_ask_a_per' }, humanCommandFix(fallback, cli));
    }
}
export function backlogMove(id, opts) {
    run(opts, (ctx) => {
        human(ctx.config.cli, `backlog move ${id}`);
        const targets = [
            opts.top && { top: true },
            opts.before && { before: text(opts.before) },
            opts.after && { after: text(opts.after) },
            opts.epic && { epic: text(opts.epic) },
        ].filter(Boolean);
        if (targets.length !== 1) {
            throw new SdlcError('invalid_option', { key: 'error.exactly_one_move_target_is_required' });
        }
        return moveBacklogItem(ctx.root, id, targets[0]);
    }, 'backlog.moved');
}
export function backlogClose(id, status, opts) {
    run(opts, (ctx) => {
        if (status === 'dropped') {
            human(ctx.config.cli, `backlog drop ${id}`);
        }
        const note = text(opts.note);
        if (!note) {
            throw new SdlcError('invalid_option', { key: 'error.note_is_required' });
        }
        return setBacklogStatus(ctx.root, id, status, { note });
    }, status === 'done' ? 'backlog.done' : 'backlog.dropped');
}
function draftIntent(item) {
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
export function backlogStart(id, opts) {
    try {
        const ctx = loadProject();
        const item = readBacklog(ctx.root).items.find(entry => entry.id === id);
        if (!item)
            throw new SdlcError('unknown_backlog_item', { key: 'error.unknown_backlog_item_x', params: { id: id } });
        if (item.status !== 'open')
            throw new SdlcError('invalid_transition', { key: 'error.x_is_x', params: { id: id, item_status: item.status } });
        if (!item.ready) {
            const missing = [...item.missing, ...item.blockedBy];
            throw new SdlcError('backlog_item_not_ready', { key: 'error.x_is_not_ready_x', params: { id: id, p2: missing.join(', ') } });
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
        if (opts.json)
            printJson({ item: started, change, harness: ctx.stamp, ...(next ? { next } : {}) });
        else {
            line(t('backlog.started', { id, change: changeId }));
            emitNextHint(ctx, changeId);
        }
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}

import { SdlcError } from '../core/errors.js';
import * as path from 'node:path';
import { listActiveChanges, listArchivedChanges, resolveChange } from '../core/changes.js';
import { readChangeState } from '../core/change-state.js';
import { evaluateChange, sharedFingerprint, STAGES, STAGE_TITLES } from '../core/lifecycle.js';
import { aggregateMetrics, changeMetrics } from '../core/metrics.js';
import { agentCommits } from '../core/agent-commits.js';
import { changeLog } from '../core/awaiting.js';
import { readLog } from '../core/log.js';
import { detectLayout } from '../core/layout.js';
import { readText } from '../core/fs-utils.js';
import { readDeferred } from '../core/deferred.js';
import { epicProgress, readBacklog } from '../core/backlog.js';
import { buildChangePage } from './change-page.js';
import { collectHealth, healthReport } from '../core/health/index.js';
function deferredWork(root) {
    const items = readDeferred(root).filter((item) => item.status === 'open').sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    return { open: items.length, items };
}
function backlogWork(root) {
    const backlog = readBacklog(root);
    const counts = {
        open: backlog.items.filter((item) => item.status === 'open').length,
        'in-progress': backlog.items.filter((item) => item.status === 'in-progress').length,
        done: backlog.items.filter((item) => item.status === 'done').length,
        dropped: backlog.items.filter((item) => item.status === 'dropped').length,
    };
    const epics = epicProgress(backlog).map(({ epic, total, open, inProgress, done, dropped }) => ({
        id: epic.id,
        title: epic.title,
        ...(epic.goal ? { goal: epic.goal } : {}),
        total,
        open,
        inProgress,
        done,
        dropped,
    }));
    const next = backlog.items.filter((item) => item.ready).slice(0, 5);
    const blocked = backlog.items.filter((item) => item.status === 'open' && item.blockedBy.length > 0);
    return { counts, epics, next, blocked };
}
export function parseSince(value) {
    if (value === undefined)
        return undefined;
    const iso = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/;
    if (!iso.test(value) || !Number.isFinite(Date.parse(value))) {
        throw new SdlcError('invalid_option', { key: 'error.since_must_be_a_yyyy_mm_dd_date_or_iso_timestamp' });
    }
    return new Date(value).toISOString();
}
export function projectName(root) {
    const content = readText(path.join(root, 'package.json'));
    if (!content)
        return path.basename(root);
    try {
        const pkg = JSON.parse(content);
        return pkg.name || path.basename(root);
    }
    catch {
        return path.basename(root);
    }
}
function toReportChange(ref, view, state, since, now, page) {
    const ageHours = state.created
        ? Math.round((now.getTime() - Date.parse(state.created)) / 36e5 * 10) / 10
        : undefined;
    const next = { actor: view.next.actor, message: view.next.message, ...(view.next.cli ? { cli: view.next.cli } : {}) };
    return {
        id: ref.id,
        archived: ref.archived,
        kind: view.kind,
        risk: view.risk,
        track: view.track,
        stage: view.stage,
        stageTitle: view.stageTitle,
        gates: view.gates.map((gate) => ({ id: gate.id, status: gate.status, required: gate.required })),
        tasks: { complete: view.tasks.complete, total: view.tasks.total },
        verification: view.verification?.status ?? 'never',
        ...(view.review ? { review: { total: view.review.total, blockingOpen: view.review.blocking.length } } : {}),
        next,
        warnings: view.warnings,
        ...(ageHours !== undefined && Number.isFinite(ageHours) && ageHours >= 0 ? { ageHours } : {}),
        movedInPeriod: !since || state.history.some((event) => event.at >= since),
        participation: page.participation,
        page,
    };
}
function summarize(changes) {
    const active = changes.filter((change) => !change.archived);
    const blocked = (change) => change.gates.some((gate) => gate.status === 'rejected')
        || change.verification === 'failed'
        || (change.review?.blockingOpen ?? 0) > 0;
    return {
        active: active.length,
        archived: changes.length - active.length,
        byStage: STAGES.map((stage) => ({
            stage,
            title: STAGE_TITLES[stage],
            count: active.filter((change) => change.stage === stage).length,
        })),
        awaitingHuman: active.filter((change) => change.next.actor === 'human').length,
        blocked: active.filter(blocked).length,
    };
}
function periodEvents(root, since, change) {
    return readLog(root)
        .filter((event) => (!since || event.ts >= since) && (!change || event.change === change))
        .sort((a, b) => a.ts.localeCompare(b.ts))
        .slice(-200);
}
function projectHealth(ctx) {
    const drafts = collectHealth(ctx.root, ctx.paths, ctx.config, { light: true });
    return { ...healthReport(drafts, 'en'), drafts };
}
/** Builds the model for a loaded project. Read-only. */
export function buildReport(ctx, opts = {}) {
    const since = parseSince(opts.since);
    const now = opts.now ?? new Date();
    const active = listActiveChanges(ctx.paths);
    const archived = opts.archived === false ? [] : listArchivedChanges(ctx.paths);
    const refs = opts.change
        ? [resolveChange(ctx.paths, opts.change, { allowArchived: true })]
        : [...active, ...archived];
    const fingerprint = sharedFingerprint(ctx.root);
    const log = readLog(ctx.root);
    const rows = refs.map((ref) => {
        const state = readChangeState(ref.dir);
        const view = evaluateChange(ctx.root, ref, ctx.config, { fingerprint });
        const metrics = changeMetrics(state, changeLog(log, ref.id), ctx.config);
        const page = buildChangePage({ root: ctx.root, config: ctx.config, ref, state, view, metrics });
        return {
            change: toReportChange(ref, view, state, since, now, page),
            metrics,
        };
    });
    const changes = rows.map((row) => row.change);
    return {
        generatedAt: now.toISOString(),
        period: { ...(since ? { since } : {}), until: now.toISOString() },
        project: { name: projectName(ctx.root), root: ctx.root.replace(/\\/g, '/') },
        harness: ctx.stamp,
        summary: summarize(changes),
        metrics: { ...aggregateMetrics(rows.map((row) => row.metrics)), agentCommits: agentCommits(ctx.root, since) },
        changes,
        events: periodEvents(ctx.root, since, opts.change),
        layout: detectLayout(ctx.root, ctx.config.layout),
        deferred: deferredWork(ctx.root),
        backlog: backlogWork(ctx.root),
        health: projectHealth(ctx),
    };
}

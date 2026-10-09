import { readChangeState } from '../change-state.js';
import { listActiveChanges, listArchivedChanges } from '../changes.js';
import { evaluateChange } from '../lifecycle.js';
import { readLog } from '../log.js';
import { changeMetrics } from '../metrics.js';
import { changeLog } from '../awaiting.js';
import { healthThresholds } from './thresholds.js';
export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
function inWindow(at, since) {
    const ms = Date.parse(at ?? '');
    return Number.isFinite(ms) && ms >= since;
}
function readInfo(ref) {
    try {
        return { ref, state: readChangeState(ref.dir) };
    }
    catch {
        return undefined;
    }
}
function withView(root, config, info) {
    try {
        const view = evaluateChange(root, info.ref, config, { skipFingerprint: true, skipPeople: true });
        return { ...info, view };
    }
    catch {
        return info;
    }
}
function loadChanges(root, paths, config, archived) {
    const read = (refs) => refs.map(readInfo).filter((info) => info !== undefined);
    const active = read(listActiveChanges(paths)).map((info) => withView(root, config, info));
    return { active, archived: archived ? read(listArchivedChanges(paths)) : [] };
}
export function loadHealthContext(root, paths, config, options = {}) {
    const thresholds = healthThresholds(config);
    const now = (options.now ?? new Date()).getTime();
    const since = now - thresholds.windowDays * DAY_MS;
    const log = options.log ?? readLog(root);
    const recent = log.filter((entry) => inWindow(entry.ts, since));
    const badOnly = options.badOnly === true;
    const light = badOnly || options.light === true;
    const locale = options.locale ?? 'en';
    const changes = loadChanges(root, paths, config, !badOnly);
    return { root, paths, config, thresholds, light, badOnly, locale, now, since, log, recent, ...changes };
}
/** History events inside the window. */
export function recentHistory(ctx, state) {
    return state.history.filter((event) => inWindow(event.at, ctx.since));
}
/** Changes with any history event inside the window: the active ones and the archived ones. */
export function windowChanges(ctx) {
    const all = [...ctx.active, ...ctx.archived];
    return all.filter((info) => recentHistory(ctx, info.state).length > 0);
}
/** Metrics of the changes in the window, from their history and log entries inside the window. */
export function windowMetrics(ctx) {
    return windowChanges(ctx).map((info) => {
        const state = { ...info.state, history: recentHistory(ctx, info.state) };
        const metrics = changeMetrics(state, changeLog(ctx.recent, info.ref.id));
        return { info, metrics };
    });
}
/** Whole days (rounded down) from `at` to now; undefined for a missing or bad timestamp. */
export function daysSince(ctx, at) {
    const ms = Date.parse(at ?? '');
    if (!Number.isFinite(ms))
        return undefined;
    return Math.floor((ctx.now - ms) / DAY_MS);
}
export function hoursSince(ctx, at) {
    const ms = Date.parse(at ?? '');
    if (!Number.isFinite(ms))
        return undefined;
    return Math.round((ctx.now - ms) / HOUR_MS * 10) / 10;
}

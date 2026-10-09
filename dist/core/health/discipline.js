import { readChangeDeltas } from '../deltas.js';
import { daysSince, recentHistory, windowChanges, windowMetrics, } from './context.js';
/** Discipline findings: waivers, behaviour on the lite track, forced archives, re-approvals, denials, test locks. */
const MIN_CHANGES = 3;
/** discipline.waivers: people's waivers per change reach `waiver_share`, over 3 or more changes. */
export function waiversFinding(ctx) {
    const rows = windowMetrics(ctx);
    // Policy waivers live in the project log, not in the histories: `metrics.waivers` counts people's only.
    const waivers = rows.reduce((sum, row) => sum + row.metrics.waivers, 0);
    const share = rows.length > 0 ? waivers / rows.length : 0;
    const params = { share: Math.round(share * 100) / 100, threshold: ctx.thresholds.waiverShare };
    const facts = [];
    if (rows.length >= MIN_CHANGES && share >= ctx.thresholds.waiverShare) {
        facts.push({ key: 'health.fact.waivers', params: { waivers, changes: rows.length } });
    }
    return { id: 'discipline.waivers', area: 'discipline', level: 'warn', params, facts };
}
function hasDeltas(info) {
    return readChangeDeltas(info.ref.dir).map((delta) => delta.file);
}
/** discipline.lite_behaviour: a lite-track change carries spec deltas, so it changes behaviour. */
export function liteBehaviourFinding(ctx) {
    const facts = [];
    for (const info of ctx.active.filter((entry) => entry.state.track === 'lite')) {
        const files = hasDeltas(info);
        if (files.length === 0)
            continue;
        facts.push({ key: 'health.fact.liteBehaviour', params: { change: info.ref.id, files: files.join(', ') } });
    }
    return { id: 'discipline.lite_behaviour', area: 'discipline', level: 'warn', facts };
}
/** discipline.forced_archive: `change.archived.forced` inside the window. */
export function forcedArchiveFinding(ctx) {
    const facts = [];
    for (const info of ctx.archived) {
        const forced = recentHistory(ctx, info.state).filter((event) => event.event === 'change.archived.forced');
        for (const event of forced) {
            const detail = event.detail ?? '-';
            facts.push({ key: 'health.fact.forcedArchive', params: { change: info.ref.id, at: event.at, detail } });
        }
    }
    return { id: 'discipline.forced_archive', area: 'discipline', level: 'warn', facts };
}
/** discipline.restale: one change's gate approved `reapprovals` times or more inside the window. */
export function restaleFinding(ctx) {
    const facts = [];
    for (const row of windowMetrics(ctx)) {
        for (const [gate, count] of Object.entries(row.metrics.approvals)) {
            if (count < ctx.thresholds.reapprovals)
                continue;
            facts.push({ key: 'health.fact.restale', params: { change: row.info.ref.id, gate, count } });
        }
    }
    const params = { count: ctx.thresholds.reapprovals };
    return { id: 'discipline.restale', area: 'discipline', level: 'warn', params, facts };
}
/** Denials per hook rule inside the window (`hook.denied`, detail `<rule>: ...`), most first. */
function denialsByRule(ctx) {
    const counts = new Map();
    for (const entry of ctx.recent.filter((item) => item.event === 'hook.denied')) {
        const rule = /^\s*([\w.-]+)\s*:/.exec(entry.detail ?? '')?.[1];
        if (rule)
            counts.set(rule, (counts.get(rule) ?? 0) + 1);
    }
    const out = [...counts].map(([rule, count]) => ({ rule, count }));
    return out.sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));
}
/** discipline.denials: one hook rule denied `denials` times or more inside the window. */
export function denialsFinding(ctx) {
    const over = denialsByRule(ctx).filter((entry) => entry.count >= ctx.thresholds.denials);
    const base = { id: 'discipline.denials', area: 'discipline', level: 'warn' };
    if (over.length === 0)
        return { ...base, facts: [] };
    const days = ctx.thresholds.windowDays;
    const facts = over.map((entry) => ({ key: 'health.fact.denials', params: { ...entry, days } }));
    return { ...base, params: { rule: over[0].rule, count: over[0].count }, facts };
}
function lockedAt(info) {
    const locks = info.state.history.filter((event) => event.event === 'tests.locked');
    return locks.at(-1)?.at;
}
/** discipline.test_lock: tests stay locked longer than `lock_days`. */
export function testLockFinding(ctx) {
    const facts = [];
    for (const info of ctx.active.filter((entry) => entry.state.tests_locked === true)) {
        const days = daysSince(ctx, lockedAt(info));
        if (days === undefined || days < ctx.thresholds.lockDays)
            continue;
        facts.push({ key: 'health.fact.testLock', params: { change: info.ref.id, days } });
    }
    const params = { days: ctx.thresholds.lockDays };
    return { id: 'discipline.test_lock', area: 'discipline', level: 'warn', params, facts };
}
/** Changes counted by the window (exported for the summary line of the text output). */
export function changesInWindow(ctx) {
    return windowChanges(ctx).length;
}

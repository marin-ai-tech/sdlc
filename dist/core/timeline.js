import { createHash } from 'node:crypto';
import { approvalWaitSpans } from './approver-waits.js';
import { roundKey } from './review-rounds.js';
const MILESTONES = [
    { event: 'change.created', name: 'created' },
    { event: 'gate.intent.approved', name: 'intent' },
    { event: 'gate.spec.approved', name: 'spec' },
    { event: 'gate.plan.approved', name: 'plan' },
    { event: 'gate.review.approved', name: 'build-verify-review' },
    { event: 'gate.release.approved', name: 'release' },
    { event: 'change.archived', name: 'archive' },
];
function iso(value) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}
function hash(value, length) {
    return createHash('sha256').update(value).digest('hex').slice(0, length);
}
function span(change, kind, key, name, start, end, attrs = {}) {
    return { id: hash(`${change}\0${kind}\0${key}`, 16), kind, name, start,
        end, open: end === null, attrs };
}
/**
 * The last event of a milestone at or after the previous milestone. An approval older than an earlier gate's
 * re-approval (after a rework) no longer counts, so no stage ends before it starts.
 */
function milestoneAt(state, item, cursor) {
    if (item.name === 'created' && state.created && iso(state.created))
        return iso(state.created);
    const events = item.name === 'archive' ? [item.event, 'change.archived.forced'] : [item.event];
    return state.history
        .filter((row) => events.includes(row.event))
        .map((row) => iso(row.at))
        .filter((at) => at !== undefined && at >= cursor)
        .sort()
        .at(-1);
}
function stageSpans(change, state) {
    let cursor = '';
    const milestones = MILESTONES.map((item) => {
        const at = milestoneAt(state, item, cursor);
        if (at)
            cursor = at;
        return { ...item, at };
    });
    const present = milestones.filter((item) => item.at);
    const result = [];
    for (let i = 0; i < present.length; i += 1) {
        const current = present[i];
        const next = present[i + 1];
        const nextName = next?.name ?? milestones[milestones.indexOf(current) + 1]?.name;
        if (!nextName)
            continue;
        result.push(span(change, 'stage', nextName, nextName, iso(current.at), next ? iso(next.at) : null));
    }
    return result;
}
function waitSpans(change, state, log) {
    const waits = approvalWaitSpans(state, log);
    // A newer wait of the same gate replaces an unapproved one (its digest changed): only the newest stays open.
    const superseded = (wait) => wait.end === null
        && waits.some((other) => other !== wait && other.gate === wait.gate && other.start > wait.start);
    return waits.filter((wait) => !superseded(wait)).flatMap((wait) => {
        const start = iso(wait.start);
        if (!start)
            return [];
        const end = wait.end ? iso(wait.end) ?? null : null;
        const key = `${wait.gate}:${wait.digest}:${wait.approvals}:${start}`;
        return [span(change, 'wait', key, wait.gate, start, end, { gate: wait.gate, approvals: wait.approvals })];
    });
}
function runSpans(change, log) {
    const starts = new Map();
    const finishes = new Map();
    for (const entry of log) {
        const id = entry.run?.id;
        if (!id)
            continue;
        if (entry.event === 'verify.started' && !starts.has(id))
            starts.set(id, entry);
        if (/^verify\.(passed|failed)$/.test(entry.event) && !finishes.has(id))
            finishes.set(id, entry);
    }
    const ids = new Set([...starts.keys(), ...finishes.keys()]);
    const result = [];
    for (const id of ids) {
        const startEntry = starts.get(id);
        const finishEntry = finishes.get(id);
        const facts = finishEntry?.run ?? startEntry?.run;
        const start = iso(facts?.started_at ?? startEntry?.run?.started_at ?? startEntry?.ts ?? '');
        if (!start)
            continue;
        // An invalid finished_at falls back to the time the finish was logged: a finished run is never open.
        const end = finishEntry ? iso(finishEntry.run?.finished_at ?? '') ?? iso(finishEntry.ts) ?? null : null;
        const resultName = finishEntry?.event.slice('verify.'.length) ?? 'unfinished';
        const minutes = end ? Math.max(0, (Date.parse(end) - Date.parse(start)) / 60000) : null;
        result.push(span(change, 'run', id, resultName, start, end, {
            result: resultName,
            fingerprint: facts?.fingerprint ?? startEntry?.run?.fingerprint ?? 'unknown',
            trigger: facts?.trigger ?? null,
            minutes,
            partial: facts?.partial ?? false,
        }));
    }
    return result;
}
function roundSpans(change, log) {
    const seen = new Set();
    const result = [];
    for (const entry of log) {
        if (entry.event !== 'review.round' || !entry.round)
            continue;
        const key = roundKey(entry.round);
        const start = iso(entry.ts);
        if (seen.has(key) || !start)
            continue;
        seen.add(key);
        result.push(span(change, 'round', key, 'review', start, start, { n: entry.round.n }));
    }
    return result;
}
/** Length of the union of closed intervals, without counting overlap twice. */
function covered(spans, kind) {
    const intervals = spans.filter((item) => item.kind === kind && item.end)
        .map((item) => [Date.parse(item.start), Date.parse(item.end)])
        .filter(([start, end]) => end >= start)
        .sort((a, b) => a[0] - b[0]);
    let total = 0;
    let previousEnd = -Infinity;
    for (const [start, end] of intervals) {
        total += Math.max(0, end - Math.max(start, previousEnd));
        previousEnd = Math.max(previousEnd, end);
    }
    return total;
}
export function buildTimeline(change, archived, state, log) {
    const spans = [
        ...stageSpans(change, state),
        ...waitSpans(change, state, log),
        ...runSpans(change, log),
        ...roundSpans(change, log),
    ].sort((a, b) => a.start.localeCompare(b.start) || a.kind.localeCompare(b.kind));
    const first = spans[0]?.start;
    // The last recorded point: an open span still has a start that was observed.
    const last = spans.flatMap((item) => (item.end ? [item.start, item.end] : [item.start])).sort().at(-1);
    const wallMs = first && last ? Math.max(0, Date.parse(last) - Date.parse(first)) : 0;
    return { change, archived, traceId: hash(`sdlc-trace:${change}`, 32), spans,
        summary: { wallMs, covered: { run: covered(spans, 'run'), wait: covered(spans, 'wait') } } };
}

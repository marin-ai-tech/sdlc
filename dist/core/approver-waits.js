/** Match each approval to the wait recorded with that many prior approvals of its digest. */
export function approvalWaitSpans(state, log) {
    const spans = [];
    const matchedUntil = new Map();
    for (const [gate, record] of Object.entries(state.gates)) {
        const approvals = [...(record?.approvals ?? [])].sort((a, b) => a.at.localeCompare(b.at));
        const seen = new Map();
        for (const approval of approvals) {
            if (!approval.digest)
                continue;
            const count = seen.get(approval.digest) ?? 0;
            seen.set(approval.digest, count + 1);
            const event = `gate.${gate}.awaiting`;
            const awaiting = log.filter((entry) => entry.event === event && entry.detail === approval.digest
                && (entry.approvals ?? 0) === count && entry.ts <= approval.at)
                .sort((a, b) => a.ts.localeCompare(b.ts))[0];
            const ms = awaiting ? Date.parse(approval.at) - Date.parse(awaiting.ts) : NaN;
            if (!Number.isFinite(ms) || ms < 0)
                continue;
            spans.push({ gate, digest: approval.digest, approvals: count, start: awaiting.ts, end: approval.at });
            matchedUntil.set(JSON.stringify([gate, approval.digest, count]), approval.at);
        }
    }
    const open = new Map();
    for (const entry of log) {
        const gate = /^gate\.([^.]+)\.awaiting$/.exec(entry.event)?.[1];
        if (!gate || !entry.detail || !Number.isFinite(Date.parse(entry.ts)))
            continue;
        const count = entry.approvals ?? 0;
        const key = JSON.stringify([gate, entry.detail, count]);
        if (entry.ts <= (matchedUntil.get(key) ?? ''))
            continue;
        const previous = open.get(key);
        if (!previous || entry.ts < previous.start) {
            open.set(key, { gate, digest: entry.detail, approvals: count, start: entry.ts, end: null });
        }
    }
    return [...spans, ...open.values()];
}
export function approverWaitsOf(state, log) {
    const out = {};
    for (const span of approvalWaitSpans(state, log)) {
        if (!span.end)
            continue;
        const seconds = Math.round((Date.parse(span.end) - Date.parse(span.start)) / 1000);
        (out[span.gate] ??= []).push({ approvals: span.approvals, seconds });
    }
    return out;
}

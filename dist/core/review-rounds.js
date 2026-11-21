import { createHash } from 'node:crypto';
import { worktreeFingerprint } from './git.js';
import { FINGERPRINT_EXCLUDES } from './lifecycle.js';
import { appendLog, readLog } from './log.js';
/** The identity of a round fact: its source and its review, not its number, which merged branches can repeat. */
export function roundKey(round) {
    return JSON.stringify([round.fingerprint ?? null, round.review]);
}
/** Count distinct facts, since merged logs can contain the same round more than once. */
export function countReviewRounds(entries) {
    const keys = entries
        .filter((entry) => entry.event === 'review.round' && entry.round)
        .map((entry) => roundKey(entry.round));
    return new Set(keys).size;
}
function roundCounts(summary, blockOn) {
    const known = new Set(['important', 'nit', 'pre-existing', ...blockOn.map((severity) => severity.toLowerCase())]);
    const open_by_severity = {};
    for (const [severity, counts] of Object.entries(summary.bySeverity)) {
        if (counts.open === 0)
            continue;
        const key = known.has(severity) ? severity : 'other';
        open_by_severity[key] = (open_by_severity[key] ?? 0) + counts.open;
    }
    return { total: summary.total, open: summary.open, blocking: summary.blocking.length, open_by_severity };
}
/** Record only a new source and normalized review pair; no finding text enters the log. */
export function recordReviewRound(root, config, change, content, summary) {
    const review = createHash('sha256').update(content.replace(/\r\n?|\n/g, '\n')).digest('hex');
    const fingerprint = worktreeFingerprint(root, FINGERPRINT_EXCLUDES);
    const previous = readLog(root).filter((entry) => entry.event === 'review.round' && entry.change === change);
    const key = roundKey({ fingerprint, review });
    if (previous.some((entry) => entry.round && roundKey(entry.round) === key))
        return;
    const round = {
        n: countReviewRounds(previous) + 1,
        ...(fingerprint ? { fingerprint } : {}),
        review,
        counts: roundCounts(summary, config.review.blockOn),
    };
    appendLog(root, config, { event: 'review.round', change, round });
}

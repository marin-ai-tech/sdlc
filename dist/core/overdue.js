import { appendLog } from './log.js';
const HOUR_MS = 3_600_000;
function sameWait(entry, event, waiting) {
    return entry.event === event && entry.change === waiting.change && entry.detail === waiting.digest;
}
/** The first awaiting entry for the change, gate and digest. */
function firstAwaiting(entries, waiting) {
    const event = `gate.${waiting.gate}.awaiting`;
    return entries.find((entry) => sameWait(entry, event, waiting));
}
/** Whether the gate has waited for this digest longer than its `overdue_hours`. */
export function isOverdue(config, entries, waiting, now = Date.now()) {
    const hours = config.gates?.[waiting.gate]?.overdueHours;
    if (!hours)
        return false;
    const since = Date.parse(firstAwaiting(entries, waiting)?.ts ?? '');
    if (Number.isNaN(since))
        return false;
    return now - since > hours * HOUR_MS;
}
/** Appends `gate.<g>.overdue` once per change, gate and digest when the wait is over its threshold. */
export function recordOverdue(root, config, entries, waiting, stamp) {
    const event = `gate.${waiting.gate}.overdue`;
    if (!isOverdue(config, entries, waiting))
        return;
    if (entries.some((entry) => sameWait(entry, event, waiting)))
        return;
    const waitingFor = waiting.people ?? firstAwaiting(entries, waiting)?.waitingFor;
    const input = { event, change: waiting.change, detail: waiting.digest, ...(waitingFor ? { waitingFor } : {}) };
    appendLog(root, config, input, stamp);
    entries.push({ ts: new Date().toISOString(), sdlc: '', license: '', ...input });
}

import { recordAutoWaived } from './auto-waive.js';
import { readChangeState } from './change-state.js';
import { appendLocalLog, readLog } from './log.js';
import { recordOverdue } from './overdue.js';
/**
 * Waits for a person (B6): whenever the CLI computes a change's next action and an approval gate waits for a
 * person, the project log gets `gate.<g>.awaiting` with the digest that person would sign in the detail - once
 * per change, gate, digest and approval count. A changed artifact or another needed approval starts a new wait.
 * The audit measures how
 * long each gate waited from the first such entry to the approval of that digest. The entry names the people who
 * may take the gate now (`waitingFor`, the `next.people` ids; B54), and a wait past `gates.<g>.overdue_hours` gets
 * one `gate.<g>.overdue` entry (B55, src/core/overdue.ts).
 *
 * Commands call this with the view they already computed; the evaluation itself stays pure and the pre-tool hook
 * never calls it, so its hot path does not read the log.
 */
export const AWAITING_EVENT = /^gate\.(\w+)\.awaiting$/;
/** The approval gate the change waits on a person for, with the digest of what they sign; none otherwise. */
export function awaitedGate(view) {
    if (view.archived)
        return undefined;
    const next = view.next;
    if (next.actor !== 'human' || next.action !== 'approve-gate' || !next.gate)
        return undefined;
    const digest = view.gates.find((g) => g.id === next.gate)?.digest;
    if (!digest)
        return undefined;
    const state = readChangeState(view.dir);
    const approvals = state.gates[next.gate]?.approvals?.filter((approval) => approval.digest === digest).length ?? 0;
    const people = next.people?.map((person) => person.id);
    return { change: view.change, gate: next.gate, digest, approvals, ...(people ? { people } : {}) };
}
function alreadyLogged(entries, waiting) {
    const event = `gate.${waiting.gate}.awaiting`;
    return entries.some((e) => e.event === event && e.change === waiting.change && e.detail === waiting.digest
        && (e.approvals ?? 0) === waiting.approvals);
}
function logAwaiting(root, config, entries, waiting, stamp) {
    const people = waiting.people ? { waitingFor: waiting.people } : {};
    const approvals = waiting.approvals > 0 ? { approvals: waiting.approvals } : {};
    const input = { event: `gate.${waiting.gate}.awaiting`, change: waiting.change,
        detail: waiting.digest, ...approvals, ...people };
    appendLocalLog(root, config, input, stamp);
    entries.push({ ts: new Date().toISOString(), sdlc: '', license: '', ...input });
}
/**
 * Appends `gate.<g>.awaiting` for every view whose next step is a person approving a gate, unless the log already
 * has it for that change, gate, digest and approval count; a wait logged before is checked for overdue. Never
 * throws: the log is a record, not a gate.
 */
export function recordAwaiting(root, config, views, stamp, options = {}) {
    const list = Array.isArray(views) ? views : [views];
    // The same call sites record the gates an auto_waive policy waived (B59), on the change too (B78), unless a hook
    // calls: a hook never makes a policy waiver permanent.
    recordAutoWaived(root, config, list, stamp, options);
    if (!config.log.enabled)
        return;
    try {
        const waiting = list.map(awaitedGate);
        const pending = waiting.filter((w) => w !== undefined);
        if (pending.length === 0)
            return;
        const entries = readLog(root);
        for (const w of pending) {
            if (alreadyLogged(entries, w))
                recordOverdue(root, config, entries, w, stamp);
            else
                logAwaiting(root, config, entries, w, stamp);
        }
    }
    catch {
        // A wait that is not recorded only makes the audit less precise; it never fails the command.
    }
}
/** The project log entries that belong to one change (awaiting entries live only in the project log). */
export function changeLog(entries, change) {
    return entries.filter((e) => e.change === change);
}

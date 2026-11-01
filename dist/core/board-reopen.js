import { resolveChange } from './changes.js';
import { SdlcError } from './errors.js';
import { appendLog } from './log.js';
import { changeTasks } from './task-contract.js';
import { updateBoard } from './board-store.js';
/** Claim order is creation order; each reopen leaves its submitted branch as a terminal attempt. */
export function reopenedClaims(board, item) {
    return board.claims.filter((claim) => claim.item === item && claim.state === 'reopened');
}
export function previousAttempts(claims) {
    return claims.map((claim) => ({
        executor: claim.executor,
        agent: claim.agent,
        branch: claim.branch,
        ...(claim.head ? { head: claim.head } : {}),
        reason: claim.reason,
        reopenedAt: claim.reopenedAt,
    }));
}
export function excludedExecutors(claims) {
    return [...new Set(claims.filter((claim) => claim.escalate).map((claim) => claim.executor))].sort();
}
function notSubmitted(ref, task) {
    throw new SdlcError('task_not_submitted', {
        key: 'error.board_task_not_submitted', params: { task, change: ref.id },
    });
}
function requireOpenTask(ref, taskId) {
    const task = changeTasks(ref).find((entry) => entry.id === taskId);
    if (!task) {
        throw new SdlcError('unknown_task', {
            key: 'error.x_is_not_a_task_of_change_x', params: { task: taskId, change: ref.id },
        });
    }
}
function recordReopen(root, config, claim, reason, escalate) {
    claim.state = 'reopened';
    claim.reason = reason;
    claim.reopenedAt = new Date().toISOString();
    claim.escalate = escalate;
    appendLog(root, config, {
        event: 'task.reopened', change: claim.change, task: claim.task,
        executor: claim.executor, agent: claim.agent, detail: reason,
    });
    if (escalate) {
        appendLog(root, config, {
            event: 'task.escalated', change: claim.change, task: claim.task, executor: claim.executor,
        });
    }
}
/** Reopening is a board decision, available to people and agents; it never changes a gate. */
export function reopenTask(root, paths, config, opts) {
    const ref = resolveChange(paths, opts.change);
    requireOpenTask(ref, opts.task);
    const reason = opts.reason?.trim();
    if (!reason) {
        throw new SdlcError('reason_required', { key: 'error.board_reopen_reason_required' });
    }
    return updateBoard(root, (board) => {
        const item = `${ref.id}#${opts.task}`;
        const claim = board.claims.find((entry) => entry.item === item && entry.state === 'submitted');
        if (!claim)
            notSubmitted(ref, opts.task);
        recordReopen(root, config, claim, reason, opts.escalate === true);
        return claim;
    }, false);
}

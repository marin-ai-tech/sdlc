import { resolveChange } from './changes.js';
import { SdlcError } from './errors.js';
import { appendLog } from './log.js';
import { changeTasks, exportItems } from './task-contract.js';
import { excludedExecutors, reopenedClaims } from './board-reopen.js';
import { updateBoard } from './board-store.js';
import { refuseAuction, settleAuctions } from './board-market.js';
export function leaseSeconds(value) {
    if (value === undefined)
        return 900;
    const seconds = /^\d+$/.test(value) ? Number(value) : Number.NaN;
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86_400) {
        throw new SdlcError('invalid_lease', { key: 'error.x_is_not_a_valid_lease', params: { lease: value } });
    }
    return seconds;
}
export function activeDispatch(board, item) {
    return board.dispatches.find((dispatch) => dispatch.item === item);
}
export function refuseDispatch(dispatch) {
    throw new SdlcError('task_dispatched', {
        key: 'error.task_x_of_x_is_dispatched_to_x_until_x',
        params: { task: dispatch.task, change: dispatch.change,
            executor: dispatch.executor, expiresAt: dispatch.expiresAt },
    });
}
export function expireDispatches(root, config, board, now) {
    const expired = board.dispatches.filter((dispatch) => Date.parse(dispatch.expiresAt) <= now);
    board.dispatches = board.dispatches.filter((dispatch) => Date.parse(dispatch.expiresAt) > now);
    for (const dispatch of expired) {
        appendLog(root, config, {
            event: 'task.dispatch_expired', change: dispatch.change,
            task: dispatch.task, executor: dispatch.executor,
        });
    }
}
export function expireHeldClaims(root, config, board, now) {
    for (const claim of board.claims) {
        if (claim.state !== 'held' || Date.parse(claim.expiresAt) > now)
            continue;
        claim.state = 'expired';
        claim.expiredAt = new Date(now).toISOString();
        appendLog(root, config, {
            event: 'task.lease_expired', change: claim.change, task: claim.task,
            executor: claim.executor, agent: claim.agent,
        });
    }
}
function assertOpen(board, ref, task, executor) {
    const item = `${ref.id}#${task}`;
    refuseAuction(board, item);
    const submitted = board.claims.find((claim) => claim.item === item && claim.state === 'submitted');
    if (submitted)
        throw new SdlcError('task_submitted', {
            key: 'error.task_x_of_x_is_submitted', params: { task, change: ref.id },
        });
    const held = board.claims.find((claim) => claim.item === item && claim.state === 'held');
    if (held)
        throw new SdlcError('task_claimed', {
            key: 'error.task_x_of_x_is_held_by_x_until_x',
            params: { task, change: ref.id, executor: held.executor, expiresAt: held.expiresAt },
        });
    const dispatch = activeDispatch(board, item);
    if (dispatch)
        refuseDispatch(dispatch);
    if (excludedExecutors(reopenedClaims(board, item)).includes(executor)) {
        throw new SdlcError('executor_excluded', {
            key: 'error.board_executor_excluded', params: { executor, task, change: ref.id },
        });
    }
}
export function dispatchTask(root, paths, config, opts) {
    const duration = leaseSeconds(opts.lease);
    const ref = resolveChange(paths, opts.change);
    const task = changeTasks(ref).find((entry) => entry.id === opts.task);
    const { items, executor } = exportItems(root, ref, config, opts.task, opts.executor);
    if (task?.done)
        throw new SdlcError('task_done', {
            key: 'error.task_x_of_x_is_already_done', params: { task: opts.task, change: ref.id },
        });
    if (!items[0] || !executor)
        throw new SdlcError('unknown_task', {
            key: 'error.x_is_not_a_task_of_change_x', params: { task: opts.task, change: ref.id },
        });
    return updateBoard(root, (board) => {
        expireHeldClaims(root, config, board, Date.now());
        expireDispatches(root, config, board, Date.now());
        settleAuctions(root, config, board, Date.now());
        assertOpen(board, ref, opts.task, executor.id);
        const now = Date.now();
        const dispatch = { item: `${ref.id}#${opts.task}`, change: ref.id, task: opts.task,
            executor: executor.id, dispatchedAt: new Date(now).toISOString(),
            expiresAt: new Date(now + duration * 1000).toISOString(), leaseSeconds: duration };
        board.dispatches.push(dispatch);
        appendLog(root, config, { event: 'task.dispatched', change: ref.id,
            task: opts.task, executor: executor.id });
        return dispatch;
    });
}

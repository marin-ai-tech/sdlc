import { listActiveChanges } from './changes.js';
import { readChangeState } from './change-state.js';
import { readBoard } from './board-store.js';
import { taskView } from './board.js';
import { readExecutors } from './executors.js';
import { evaluateChange } from './lifecycle.js';
import { changeTasks, planOpen } from './task-contract.js';
import { winner } from './board-market.js';
/** A copy of the board as of `now`: expired held claims and dispatches dropped, nothing written. */
function boardAt(root, config, board, now) {
    const live = (expiresAt) => Date.parse(expiresAt) > now;
    const elapsed = board.auctions.filter((auction) => !live(auction.closesAt) && auction.bids.length);
    const awarded = elapsed.map((auction) => ({
        item: auction.item, change: auction.change, task: auction.task,
        executor: winner(root, auction.bids, config.board?.market.rule ?? 'fastest').executor,
        dispatchedAt: new Date(now).toISOString(), expiresAt: new Date(now + 900_000).toISOString(),
        leaseSeconds: 900,
    }));
    return {
        ...board,
        claims: board.claims.filter((claim) => claim.state !== 'held' || live(claim.expiresAt)),
        dispatches: [...board.dispatches.filter((dispatch) => live(dispatch.expiresAt)), ...awarded],
        auctions: board.auctions.filter((auction) => live(auction.closesAt)),
    };
}
function changeSnapshots(root, ref, config, board) {
    const view = evaluateChange(root, ref, config, { skipFingerprint: true, skipPeople: true });
    if (!planOpen(view))
        return [];
    const state = readChangeState(ref.dir);
    const open = changeTasks(ref).filter((task) => !task.done);
    return open.map((task) => taskView(ref, task, board, state));
}
function countOf(tasks, executor, status) {
    return tasks.filter((task) => task.executor === executor && task.status === status).length;
}
function executorCounts(tasks, ids) {
    const named = tasks.flatMap((task) => (task.executor ? [task.executor] : []));
    const names = [...new Set([...ids, ...named])].sort();
    return names.map((executor) => ({
        executor,
        claimed: countOf(tasks, executor, 'claimed'),
        submitted: countOf(tasks, executor, 'submitted'),
    }));
}
/** The board without writing anything; `undefined` without an executor registry. */
export function boardSnapshot(root, paths, config, now, changeId) {
    const registry = readExecutors(root);
    if (!registry)
        return undefined;
    const board = boardAt(root, config, readBoard(root), now.getTime());
    const refs = listActiveChanges(paths).filter((ref) => changeId === undefined || ref.id === changeId);
    const tasks = refs.flatMap((ref) => changeSnapshots(root, ref, config, board));
    return { tasks, byExecutor: executorCounts(tasks, [...registry.keys()]) };
}

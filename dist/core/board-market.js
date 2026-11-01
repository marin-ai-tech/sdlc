import { resolveChange } from './changes.js';
import { SdlcError } from './errors.js';
import { AGENT_NAME, executorRefusal, readExecutors } from './executors.js';
import { appendLog } from './log.js';
import { changeTasks, planOpen } from './task-contract.js';
import { evaluateChange } from './lifecycle.js';
import { readChangeState } from './change-state.js';
import { excludedExecutors, reopenedClaims } from './board-reopen.js';
import { activeDispatch, expireDispatches, expireHeldClaims } from './board-dispatch.js';
import { updateBoard } from './board-store.js';
import { recordFailure, recordRequest, replayRequest, validateRequest, RequestReplay, pruneRequests } from './board-requests.js';
import { assertHook, consumeExtensions, consumeHook, declareOperation, effectTime, evaluationTime } from '../plugins/evaluation.js';
import { parseExtensions } from '../plugins/api.js';
function error(code, key) {
    throw new SdlcError(code, { key });
}
function auctionOf(board, item) {
    return board.auctions.find((entry) => entry.item === item);
}
export function refuseAuction(board, item) {
    if (auctionOf(board, item))
        error('task_auction', 'error.board_task_auction');
}
function reservation(auction, executor, now) {
    return { item: auction.item, change: auction.change, task: auction.task, executor,
        dispatchedAt: new Date(now).toISOString(), expiresAt: new Date(now + 900_000).toISOString(),
        leaseSeconds: 900 };
}
function risk(root, executor) {
    const level = readExecutors(root)?.get(executor)?.maxRisk;
    return ['low', 'medium', 'high'].indexOf(level ?? 'low');
}
export function winner(root, bids, rule) {
    const ordered = [...bids];
    ordered.sort((left, right) => {
        const value = rule === 'first' ? Date.parse(left.at) - Date.parse(right.at)
            : rule === 'cheapest' ? (left.cost ?? Infinity) - (right.cost ?? Infinity)
                : left.minutes - right.minutes;
        return value || risk(root, right.executor) - risk(root, left.executor)
            || Date.parse(left.at) - Date.parse(right.at);
    });
    return ordered[0];
}
export function settleAuctions(root, config, board, now) {
    const expired = board.auctions.filter((entry) => Date.parse(entry.closesAt) <= now);
    const prepared = expired.map((auction) => {
        if (!auction.bids.length)
            return { auction };
        const selected = winner(root, auction.bids, config.board?.market.rule ?? 'fastest');
        const verdict = consumeHook(root, config, 'award', { mode: 'settlement',
            task: { id: auction.item, change: auction.change, task: auction.task }, executor: selected.executor, bid: selected });
        return { auction, selected, verdict };
    });
    board.auctions = board.auctions.filter((entry) => Date.parse(entry.closesAt) > now);
    for (const { auction, selected, verdict } of prepared) {
        if (!selected) {
            appendLog(root, config, { event: 'task.auction_expired', change: auction.change, task: auction.task });
            continue;
        }
        const rule = config.board?.market.rule ?? 'fastest';
        if (verdict?.decision === 'deny') {
            appendLog(root, config, { event: 'task.award_refused', change: auction.change, task: auction.task,
                executor: selected.executor, detail: verdict.message ?? verdict.code ?? 'Plugin restriction' });
            continue;
        }
        board.dispatches.push(reservation(auction, selected.executor, effectTime(root, now)));
        appendLog(root, config, { event: 'task.awarded', change: auction.change, task: auction.task,
            executor: selected.executor, detail: rule });
    }
}
function updateMarket(root, config, fn) {
    return updateBoard(root, (board) => {
        const now = evaluationTime(root);
        expireHeldClaims(root, config, board, now);
        expireDispatches(root, config, board, now);
        settleAuctions(root, config, board, now);
        return fn(board);
    });
}
function requireTask(root, paths, config, change, task, executor) {
    const ref = resolveChange(paths, change);
    const found = changeTasks(ref).find((entry) => entry.id === task);
    const view = evaluateChange(root, ref, config, { skipFingerprint: true, skipPeople: true });
    if (!planOpen(view))
        error('plan_not_approved', 'error.board_plan_not_approved');
    if (found?.done)
        error('task_done', 'error.board_task_done');
    if (!found)
        error('unknown_task', 'error.board_unknown_task');
    if (executor)
        assertAllowed(root, ref.dir, executor);
    return `${ref.id}#${task}`;
}
function assertAllowed(root, changeDir, executor) {
    const allowed = readExecutors(root)?.get(executor);
    if (!allowed)
        error('unknown_executor', 'error.board_unknown_executor');
    const state = readChangeState(changeDir);
    if (executorRefusal(allowed, state.risk, state.kind)) {
        error('executor_not_allowed', 'error.board_executor_not_allowed');
    }
}
function assertFree(board, item) {
    if (board.claims.some((entry) => entry.item === item && entry.state === 'submitted')) {
        error('task_submitted', 'error.board_task_submitted');
    }
    if (board.claims.some((entry) => entry.item === item && entry.state === 'held')) {
        error('task_claimed', 'error.board_task_claimed');
    }
    if (activeDispatch(board, item))
        error('task_dispatched', 'error.board_task_dispatched');
    refuseAuction(board, item);
}
export function openAuction(root, paths, config, opts) {
    declareOperation(root, config, 'auction', opts);
    const seconds = opts.window === undefined ? config.board?.market.windowSeconds ?? 300
        : /^\d+$/.test(opts.window) ? Number(opts.window) : NaN;
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86_400) {
        error('invalid_window', 'error.board_invalid_window');
    }
    const item = requireTask(root, paths, config, opts.change, opts.task);
    return updateMarket(root, config, (board) => {
        assertFree(board, item);
        const now = effectTime(root);
        const auction = { item, change: opts.change, task: opts.task,
            openedAt: new Date(now).toISOString(), closesAt: new Date(now + seconds * 1000).toISOString(), bids: [] };
        board.auctions.push(auction);
        appendLog(root, config, { event: 'task.auction_opened', change: opts.change, task: opts.task });
        return auction;
    });
}
function bidValues(opts) {
    const minutes = /^\d+$/.test(opts.minutes) ? Number(opts.minutes) : NaN;
    const cost = opts.cost === undefined ? undefined : Number(opts.cost);
    if (!Number.isSafeInteger(minutes) || minutes < 1 || (cost !== undefined
        && (!Number.isFinite(cost) || cost < 0)) || !AGENT_NAME.test(opts.agent)) {
        error('invalid_bid', 'error.board_invalid_bid');
    }
    return { minutes, cost };
}
function placeBid(root, paths, config, board, opts) {
    const { minutes, cost } = bidValues(opts);
    const now = evaluationTime(root);
    expireHeldClaims(root, config, board, now);
    expireDispatches(root, config, board, now);
    settleAuctions(root, config, board, now);
    const ref = resolveChange(paths, opts.change);
    const item = `${ref.id}#${opts.task}`;
    const auction = auctionOf(board, item);
    if (!auction)
        error('no_auction', 'error.board_no_auction');
    assertAllowed(root, ref.dir, opts.executor);
    if (excludedExecutors(reopenedClaims(board, item)).includes(opts.executor)) {
        error('executor_excluded', 'error.board_bid_excluded');
    }
    const ext = consumeExtensions(root, 'bidExt', opts.ext);
    const bid = { executor: opts.executor, agent: opts.agent, minutes,
        ...(ext === undefined ? {} : { ext }),
        ...(cost === undefined ? {} : { cost }), at: new Date(now).toISOString() };
    const state = readChangeState(ref.dir);
    assertHook(root, config, 'bid', { task: { id: item, change: ref.id, task: opts.task, risk: state.risk, kind: state.kind }, bid });
    auction.bids = auction.bids.filter((entry) => entry.executor !== opts.executor);
    auction.bids.push(bid);
    const detail = `minutes ${minutes}, cost ${cost ?? 'unspecified'}`
        + (opts.note === undefined ? '' : `, note ${opts.note}`);
    appendLog(root, config, { event: 'task.bid', change: opts.change, task: opts.task,
        executor: opts.executor, agent: opts.agent, detail });
    return bid;
}
export function bidTask(root, paths, config, opts) {
    declareOperation(root, config, 'bid', opts);
    validateRequest(opts.request);
    const ext = parseExtensions(opts.ext);
    const spec = { key: opts.request, command: 'bid', args: [opts.change, opts.task,
            opts.executor, opts.agent, opts.minutes, opts.cost, opts.note, ...(ext === undefined ? [] : [ext])] };
    try {
        return updateBoard(root, (board) => {
            board.requests = pruneRequests(board.requests, evaluationTime(root));
            replayRequest(board.requests, spec, root);
            try {
                const bid = placeBid(root, paths, config, board, opts);
                recordRequest(board.requests, spec, bid);
                return bid;
            }
            catch (caught) {
                recordFailure(board.requests, spec, caught);
                throw caught;
            }
        });
    }
    catch (caught) {
        if (caught instanceof RequestReplay) {
            if (caught.exitCode === 0)
                return caught.result;
            const response = caught.result;
            const diagnostic = response.status[0];
            throw new SdlcError(diagnostic.code, diagnostic.message, diagnostic.fix);
        }
        throw caught;
    }
}
export function awardTask(root, paths, config, opts) {
    declareOperation(root, config, 'award', opts);
    const item = requireTask(root, paths, config, opts.change, opts.task, opts.executor);
    return updateMarket(root, config, (board) => {
        const auction = auctionOf(board, item);
        const dispatch = activeDispatch(board, item);
        if (!auction && !dispatch)
            error('no_auction', 'error.board_no_auction');
        if (board.claims.some((entry) => entry.item === item && entry.state === 'held')) {
            error('task_claimed', 'error.board_task_claimed');
        }
        if (excludedExecutors(reopenedClaims(board, item)).includes(opts.executor)) {
            error('executor_excluded', 'error.board_executor_excluded');
        }
        assertHook(root, config, 'award', { mode: 'manual', task: { id: item, change: opts.change, task: opts.task }, executor: opts.executor });
        board.auctions = board.auctions.filter((entry) => entry.item !== item);
        board.dispatches = board.dispatches.filter((entry) => entry.item !== item);
        const next = reservation(auction ?? { item, change: opts.change, task: opts.task,
            openedAt: '', closesAt: '', bids: [] }, opts.executor, effectTime(root));
        board.dispatches.push(next);
        appendLog(root, config, { event: 'task.awarded', change: opts.change, task: opts.task,
            executor: opts.executor, detail: 'by award' });
        return next;
    });
}

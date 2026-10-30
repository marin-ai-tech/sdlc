import * as crypto from 'node:crypto';
import { listActiveChanges, resolveChange } from './changes.js';
import { readChangeState } from './change-state.js';
import { SdlcError } from './errors.js';
import { AGENT_NAME } from './executors.js';
import { git } from './git.js';
import { evaluateEach } from './evaluate-each.js';
import { appendLog } from './log.js';
import { changeTasks, exportItems } from './task-contract.js';
import { planOpen } from './task-contract.js';
import { checkResult } from './task-result.js';
import { updateBoard } from './board-store.js';
import { excludedExecutors, previousAttempts, reopenedClaims } from './board-reopen.js';
import { activeDispatch, expireDispatches, expireHeldClaims, leaseSeconds, refuseDispatch } from './board-dispatch.js';
import { refuseAuction, settleAuctions } from './board-market.js';
import { recordFailure, recordRequest, replayRequest, validateRequest, RequestReplay, pruneRequests } from './board-requests.js';
import { assertHook, declareOperation, effectTime, evaluationTime } from '../plugins/evaluation.js';
import { parseExtensions } from '../plugins/api.js';
/**
 * The task board (B118a, epic E16): the open tasks of every active change whose plan gate is open, on which the
 * agents of the executors of `openspec/executors.yaml` claim work. A claim holds its task for a lease (default
 * 900 s, at most a day), is kept by heartbeats, given back by release and closed by submit, which runs the
 * TASK 115 result check on the branch the agent returns. The board is state, not truth: `board.json` is
 * git-ignored and agent-untouchable, the committed trail is one log entry per claim, release, lease expiry and
 * submit. There is no expiry timer: every command first drops the held claims whose lease ran out (one
 * `task.lease_expired` entry each, exactly once — the claim record stays as a tombstone so heartbeat still
 * answers `claim_expired` and the event is not logged twice). A submitted claim is terminal until B121 reopens
 * it; keeping the record is the seam. The board approves nothing: it changes no `.sdlc.yaml`, touches no gate.
 */
export const DEFAULT_LEASE_SECONDS = 900;
export const MAX_LEASE_SECONDS = 86_400;
function iso(ms) {
    return new Date(ms).toISOString();
}
function fail(code, key, params) {
    throw new SdlcError(code, { key, params });
}
/** Every board command inside the lock: drop the dead claims, then run `fn` on the rest. */
function withBoard(root, config, fn, request) {
    validateRequest(request?.key);
    try {
        return updateBoard(root, (board) => {
            const now = evaluationTime(root);
            board.requests = pruneRequests(board.requests, now);
            replayRequest(board.requests, request, root);
            expireHeldClaims(root, config, board, now);
            expireDispatches(root, config, board, now);
            settleAuctions(root, config, board, now);
            try {
                const result = fn(board);
                recordRequest(board.requests, request, result);
                return result;
            }
            catch (error) {
                recordFailure(board.requests, request, error);
                throw error;
            }
        });
    }
    catch (error) {
        if (error instanceof RequestReplay) {
            if (error.exitCode === 0)
                return error.result;
            const diagnostic = error.result.status[0];
            throw new SdlcError(diagnostic.code, diagnostic.message, diagnostic.fix);
        }
        throw error;
    }
}
function liveClaim(board, item, state) {
    return board.claims.find((claim) => claim.item === item && claim.state === state);
}
/** One task's row of the board; also the dashboard's, over a board copy without the expired leases (B122). */
export function taskView(ref, task, board, state) {
    const id = `${ref.id}#${task.id}`;
    const claim = liveClaim(board, id, 'submitted') ?? liveClaim(board, id, 'held');
    const dispatch = activeDispatch(board, id);
    const auction = board.auctions.find((entry) => entry.item === id);
    const view = {
        id, change: ref.id, task: { id: task.id, text: task.text },
        risk: state.risk, kind: state.kind,
        status: claim ? (claim.state === 'held' ? 'claimed' : 'submitted')
            : auction ? 'auction' : dispatch ? 'dispatched' : 'open',
    };
    if (auction && !claim) {
        view.closesAt = auction.closesAt;
        view.bids = auction.bids;
    }
    if (claim !== undefined) {
        view.executor = claim.executor;
        view.agent = claim.agent;
        if (claim.state === 'held')
            view.expiresAt = claim.expiresAt;
    }
    if (claim === undefined && dispatch !== undefined) {
        view.executor = dispatch.executor;
        view.expiresAt = dispatch.expiresAt;
    }
    const attempts = reopenedClaims(board, id);
    if (attempts.length > 0) {
        view.attempts = attempts.length;
        view.lastReason = attempts.at(-1).reason;
        const excluded = excludedExecutors(attempts);
        if (excluded.length > 0)
            view.excluded = excluded;
    }
    return view;
}
/** The board list: every open task of every active change with an open plan gate, plus its claim state. */
export function boardTasks(root, paths, config, changeId) {
    return boardTaskListing(root, paths, config, changeId).tasks;
}
export function boardTaskListing(root, paths, config, changeId) {
    declareOperation(root, config, 'list', { change: changeId });
    return withBoard(root, config, (board) => {
        const refs = changeId === undefined ? listActiveChanges(paths) : [resolveChange(paths, changeId)];
        const { evaluated, errors } = evaluateEach(root, refs, config, { skipFingerprint: true, skipPeople: true });
        const tasks = [];
        for (const { ref, view } of evaluated) {
            if (!planOpen(view))
                continue;
            const state = readChangeState(ref.dir);
            for (const task of changeTasks(ref)) {
                if (task.done)
                    continue;
                tasks.push(taskView(ref, task, board, state));
            }
        }
        return { tasks, errors };
    });
}
/** The task one claim holds: `<change>#<task>`; a held claim blocks, a submitted one is terminal. */
function assertClaimable(board, ref, taskId, executor) {
    const item = `${ref.id}#${taskId}`;
    refuseAuction(board, item);
    const submitted = liveClaim(board, item, 'submitted');
    if (submitted !== undefined) {
        fail('task_submitted', 'error.task_x_of_x_is_submitted', { task: taskId, change: ref.id });
    }
    const held = liveClaim(board, item, 'held');
    if (held !== undefined) {
        fail('task_claimed', 'error.task_x_of_x_is_held_by_x_until_x', {
            task: taskId, change: ref.id, executor: held.executor, expiresAt: held.expiresAt,
        });
    }
    const dispatch = activeDispatch(board, item);
    if (dispatch !== undefined && dispatch.executor !== executor)
        refuseDispatch(dispatch);
    if (excludedExecutors(reopenedClaims(board, item)).includes(executor)) {
        fail('executor_excluded', 'error.board_executor_excluded', {
            executor, task: taskId, change: ref.id,
        });
    }
}
/**
 * Claim one open task for `<executor>/<agent>`: the refusals are the `task export` ones, plus `task_done`,
 * `task_claimed` and `task_submitted`. The returned work item carries the agent in `SDLC-Agent`; the claim id
 * is a random secret - whoever holds it heartbeats, releases or submits.
 */
export function claimTask(root, paths, config, opts) {
    declareOperation(root, config, 'claim', opts);
    const ext = parseExtensions(opts.ext);
    const request = { key: opts.request, command: 'claim', args: [opts.change, opts.task,
            opts.executor, opts.agent, opts.lease, ...(ext === undefined ? [] : [ext])] };
    return withBoard(root, config, (board) => {
        const duration = leaseSeconds(opts.lease);
        if (!AGENT_NAME.test(opts.agent)) {
            fail('invalid_agent', 'error.x_is_not_a_valid_agent_name', { agent: opts.agent });
        }
        const ref = resolveChange(paths, opts.change);
        const task = changeTasks(ref).find((entry) => entry.id === opts.task);
        const { items, executor } = exportItems(root, ref, config, opts.task, opts.executor, ext);
        if (task !== undefined && task.done) {
            fail('task_done', 'error.task_x_of_x_is_already_done', { task: opts.task, change: ref.id });
        }
        const item = items[0];
        if (item === undefined || executor === undefined) {
            fail('unknown_task', 'error.x_is_not_a_task_of_change_x', { task: opts.task, change: ref.id });
        }
        item.result.trailers['SDLC-Agent'] = `${executor.id}/${opts.agent}`;
        assertClaimable(board, ref, opts.task, executor.id);
        const attempts = reopenedClaims(board, `${ref.id}#${opts.task}`);
        if (attempts.length > 0)
            item.previousAttempts = previousAttempts(attempts);
        const claimNumber = board.claims.filter((claim) => claim.item === item.id).length + 1;
        if (claimNumber > 1)
            item.result.branch += `-${claimNumber}`;
        assertHook(root, config, 'claim', { task: item, executor: executor.id, agent: opts.agent, leaseSeconds: duration });
        const now = effectTime(root);
        const created = {
            id: crypto.randomBytes(16).toString('hex'),
            item: `${ref.id}#${opts.task}`, change: ref.id, task: opts.task,
            executor: executor.id, agent: opts.agent,
            claimedAt: iso(now), expiresAt: iso(now + duration * 1000), leaseSeconds: duration,
            state: 'held',
            ...(ext === undefined ? {} : { ext }),
        };
        board.claims.push(created);
        board.dispatches = board.dispatches.filter((dispatch) => dispatch.item !== created.item);
        appendLog(root, config, {
            event: 'task.claimed', change: ref.id, task: opts.task, executor: executor.id, agent: opts.agent,
        });
        return { claim: created, item };
    }, request);
}
function heldClaim(board, claimId, executor) {
    const claim = board.claims.find((entry) => entry.id === claimId);
    if (claim === undefined || (executor !== undefined && claim.executor !== executor)
        || claim.state === 'released' || claim.state === 'submitted') {
        fail('claim_unknown', 'error.there_is_no_live_claim_x', { claim: claimId });
    }
    if (claim.state === 'expired') {
        fail('claim_expired', 'error.claim_x_expired_at_x', { claim: claimId, expiresAt: claim.expiresAt });
    }
    return claim;
}
/** A heartbeat pushes the lease end out by the claim's own `leaseSeconds`; it writes no log entry. */
export function heartbeatClaim(root, config, claimId, executor, requestKey) {
    declareOperation(root, config, 'heartbeat', { claim: claimId, executor, request: requestKey });
    return withBoard(root, config, (board) => {
        const claim = heldClaim(board, claimId, executor);
        claim.expiresAt = iso(effectTime(root) + claim.leaseSeconds * 1000);
        return claim;
    }, { key: requestKey, command: 'heartbeat', args: [claimId, executor] });
}
/** Release gives the task back to the open list; the note lands in the log's `detail`. */
export function releaseClaim(root, config, claimId, note, executor, requestKey) {
    declareOperation(root, config, 'release', { claim: claimId, note, executor, request: requestKey });
    return withBoard(root, config, (board) => {
        const claim = heldClaim(board, claimId, executor);
        claim.state = 'released';
        claim.releasedAt = iso(effectTime(root));
        appendLog(root, config, {
            event: 'task.released', change: claim.change, task: claim.task,
            executor: claim.executor, agent: claim.agent,
            ...(note !== undefined && note !== '' ? { detail: note } : {}),
        });
        return claim;
    }, { key: requestKey, command: 'release', args: [claimId, note, executor] });
}
/**
 * Submit runs the TASK 115 result check on the branch the agent returns; every commit must also carry the
 * claim's executor in `SDLC-Agent` (else `wrong_executor`). A pass closes the claim; a fail keeps it held so
 * the agent can fix and resubmit. Nothing here approves, merges or edits `.sdlc.yaml`.
 */
export function submitClaim(root, paths, config, claimId, branch, base, executor, requestKey) {
    declareOperation(root, config, 'submit', { claim: claimId, branch, base, executor, request: requestKey });
    return withBoard(root, config, (board) => {
        const claim = heldClaim(board, claimId, executor);
        const ref = resolveChange(paths, claim.change);
        const result = checkResult(root, ref, config, branch, base, claim.executor);
        if (!result.ok)
            return { claim, result };
        claim.state = 'submitted';
        claim.branch = branch;
        claim.head = result.commits.at(-1)?.sha ?? git(root, ['rev-parse', branch]).stdout;
        appendLog(root, config, {
            event: 'task.submitted', change: claim.change, task: claim.task,
            executor: claim.executor, agent: claim.agent,
            detail: `${branch} ${claim.head ?? ''}`.trim(),
        });
        return { claim, result };
    }, { key: requestKey, command: 'submit', args: [claimId, branch, base, executor] });
}

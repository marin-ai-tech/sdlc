import * as path from 'node:path';
import { SdlcError } from './errors.js';
import { ensureDir, readText, writeTextAtomic } from './fs-utils.js';
import { parseAuctions } from './board-market-state.js';
import { parseRequests, pruneRequests, RequestReplay } from './board-requests.js';
import { ensureLocalIgnore } from './local-ignore.js';
import { beforeBoardCommit, boardLockWait, finalizeBoard, flushObservations, preparationBoard, publicationAllowed } from '../plugins/evaluation.js';
import { parseExtensions } from '../plugins/api.js';
import { acquireWriterLock } from './writer-lock.js';
import { logFile } from './log-write.js';
/**
 * The board file and its lock (B118a, epic E16): `openspec/.sdlc/board.json` holds the claims the agents of the
 * executors hold on open tasks, plus dispatch reservations. It is a state file, never committed —
 * `openspec/.sdlc/.gitignore` carries it and
 * the lock — and only the CLI writes it. The whole read-change-write of a board command runs under `board.lock`,
 * created exclusively behind an ownership fence, so two processes cannot claim the same task. A proven dead
 * instance is reclaimed; unknown live owners remain protected. Ordinary contention retains ~10 s of headroom.
 */
export const BOARD_PATH = 'openspec/.sdlc/board.json';
export const BOARD_LOCK = 'openspec/.sdlc/board.lock';
export const BOARD_IGNORE = 'openspec/.sdlc/.gitignore';
const LOCK_TIMEOUT_MS = 10_000;
function dispatchOf(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        invalid('a dispatch must be a mapping');
    const raw = value;
    for (const name of ['item', 'change', 'task', 'executor', 'dispatchedAt', 'expiresAt']) {
        if (typeof raw[name] !== 'string' || raw[name] === '')
            invalid(`dispatches[].${name} must be nonempty`);
    }
    if (!Number.isInteger(raw.leaseSeconds) || raw.leaseSeconds < 1
        || raw.leaseSeconds > 86_400)
        invalid('dispatches[].leaseSeconds is invalid');
    for (const name of ['dispatchedAt', 'expiresAt']) {
        if (Number.isNaN(Date.parse(raw[name])))
            invalid(`dispatches[].${name} is invalid`);
    }
    if (raw.item !== `${raw.change}#${raw.task}`)
        invalid('dispatches[].item is inconsistent');
    return raw;
}
function invalid(detail) {
    throw new SdlcError('board_invalid', { key: 'error.the_board_file_x_is_broken_x', params: { file: BOARD_PATH, detail } });
}
function parseReopenFields(raw, claim) {
    if (raw.reason !== undefined) {
        if (typeof raw.reason !== 'string' || raw.reason.trim() === '')
            invalid('claims[].reason must be nonempty');
        claim.reason = raw.reason;
    }
    if (raw.reopenedAt !== undefined) {
        if (typeof raw.reopenedAt !== 'string' || Number.isNaN(Date.parse(raw.reopenedAt))) {
            invalid('claims[].reopenedAt must be an ISO timestamp');
        }
        claim.reopenedAt = raw.reopenedAt;
    }
    if (raw.escalate !== undefined) {
        if (typeof raw.escalate !== 'boolean')
            invalid('claims[].escalate must be a boolean');
        claim.escalate = raw.escalate;
    }
    if (claim.state === 'reopened' && (!claim.branch || !claim.reason || !claim.reopenedAt
        || claim.escalate === undefined)) {
        invalid('reopened claims require branch, reason, reopenedAt and escalate');
    }
}
function claimOf(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        invalid('a claim must be a mapping');
    const raw = value;
    const text = (name) => {
        if (typeof raw[name] !== 'string' || raw[name] === '')
            invalid(`claims[].${name} must be a nonempty string`);
        return raw[name];
    };
    const claim = {
        id: text('id'), item: text('item'), change: text('change'), task: text('task'),
        executor: text('executor'), agent: text('agent'),
        claimedAt: text('claimedAt'), expiresAt: text('expiresAt'),
        leaseSeconds: 0,
        state: text('state'),
    };
    const ext = parseExtensions(raw.ext);
    if (ext !== undefined)
        claim.ext = ext;
    if (!Number.isInteger(raw.leaseSeconds) || raw.leaseSeconds < 1) {
        invalid('claims[].leaseSeconds must be a positive integer');
    }
    claim.leaseSeconds = raw.leaseSeconds;
    if (!['held', 'released', 'expired', 'submitted', 'reopened'].includes(claim.state)) {
        invalid('claims[].state is unknown');
    }
    if (Number.isNaN(Date.parse(claim.claimedAt)) || Number.isNaN(Date.parse(claim.expiresAt))) {
        invalid('claims[] timestamps must be ISO strings');
    }
    for (const name of ['releasedAt', 'expiredAt', 'branch', 'head']) {
        if (typeof raw[name] === 'string')
            claim[name] = raw[name];
    }
    parseReopenFields(raw, claim);
    return claim;
}
/** The board, parsed at the boundary; a missing file is an empty board, a broken one is `board_invalid`. */
export function readBoard(root) {
    const text = readText(path.join(root, BOARD_PATH));
    if (text === undefined)
        return { version: 1, claims: [], dispatches: [], auctions: [], requests: [] };
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch (error) {
        invalid(error instanceof Error ? error.message : String(error));
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        invalid('the root must be a mapping');
    const raw = parsed;
    if (raw.version !== 1)
        invalid('version must be 1');
    if (!Array.isArray(raw.claims))
        invalid('claims must be a list');
    if (raw.dispatches !== undefined && !Array.isArray(raw.dispatches))
        invalid('dispatches must be a list');
    return { version: 1, claims: raw.claims.map(claimOf),
        dispatches: (raw.dispatches ?? []).map(dispatchOf),
        auctions: parseAuctions(raw.auctions), requests: pruneRequests(parseRequests(raw.requests), Date.now()) };
}
/**
 * One exclusive read-change-write of the board: the work `fn` does (and the board write after it) is atomic
 * against other sdlc processes. By default the board is written even when `fn` throws, so expired claims are
 * not applied twice. Reopen opts out on refusal so the board file stays unchanged.
 */
export function updateBoard(root, fn, writeOnError = true) {
    const preview = preparationBoard(root);
    if (preview)
        return fn(preview);
    const file = path.join(root, BOARD_PATH);
    const lock = logFile(root, 'board.lock');
    ensureDir(path.dirname(file));
    let lease;
    try {
        lease = acquireWriterLock(lock, boardLockWait(root, LOCK_TIMEOUT_MS));
    }
    catch (error) {
        if (error instanceof SdlcError && error.code === 'writer_locked') {
            throw new SdlcError('board_locked', { key: 'error.the_board_is_locked_by_another_process' });
        }
        throw error;
    }
    try {
        const board = readBoard(root);
        return finalizeBoard(root, board, () => {
            let completed = false;
            let replayed = false;
            try {
                const result = fn(board);
                completed = true;
                return result;
            }
            catch (error) {
                const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
                replayed = error instanceof RequestReplay || code.startsWith('plugin_evaluation_') || code === 'plugin_busy';
                throw error;
            }
            finally {
                if (!replayed && (completed || writeOnError) && publicationAllowed(root)) {
                    beforeBoardCommit(root);
                    ensureLocalIgnore(root, ['board.json', 'board.lock', 'board.lock.writers/']);
                    writeTextAtomic(file, `${JSON.stringify(board)}\n`);
                    flushObservations(root);
                }
            }
        });
    }
    finally {
        lease.release();
    }
}

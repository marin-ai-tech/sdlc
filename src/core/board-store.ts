import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SdlcError } from './errors.js';
import { ensureDir, readText, writeTextAtomic } from './fs-utils.js';
import { parseAuctions, type BoardAuction } from './board-market-state.js';
import { parseRequests, pruneRequests, RequestReplay, type BoardRequest } from './board-requests.js';
import { ensureLocalIgnore } from './local-ignore.js';
import { beforeBoardCommit, boardLockWait, finalizeBoard, flushObservations, preparationBoard, publicationAllowed } from '../plugins/evaluation.js';
import { parseExtensions, type Extensions } from '../plugins/api.js';

/**
 * The board file and its lock (B118a, epic E16): `openspec/.sdlc/board.json` holds the claims the agents of the
 * executors hold on open tasks, plus dispatch reservations. It is a state file, never committed —
 * `openspec/.sdlc/.gitignore` carries it and
 * the lock — and only the CLI writes it. The whole read-change-write of a board command runs under `board.lock`,
 * created with `fs.openSync 'wx'`, so two processes cannot claim the same task. A lock left by a crashed process
 * is broken after ~30 s; a live one is retried for ~10 s. Writes go through a temp file and a rename.
 */
export const BOARD_PATH = 'openspec/.sdlc/board.json';
export const BOARD_LOCK = 'openspec/.sdlc/board.lock';
export const BOARD_IGNORE = 'openspec/.sdlc/.gitignore';

const STALE_LOCK_MS = 30_000;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 50;

export type ClaimState = 'held' | 'released' | 'expired' | 'submitted' | 'reopened';

export interface BoardClaim {
  ext?: Extensions;
  /** The random secret the caller must pass back to heartbeat, release or submit; never in `board list`. */
  id: string;
  /** `<change>#<task>`. */
  item: string;
  change: string;
  task: string;
  executor: string;
  agent: string;
  claimedAt: string;
  expiresAt: string;
  leaseSeconds: number;
  state: ClaimState;
  releasedAt?: string;
  expiredAt?: string;
  branch?: string;
  head?: string;
  reason?: string;
  reopenedAt?: string;
  escalate?: boolean;
}

export interface BoardDispatch {
  item: string;
  change: string;
  task: string;
  executor: string;
  dispatchedAt: string;
  expiresAt: string;
  leaseSeconds: number;
}

export interface Board {
  version: 1;
  claims: BoardClaim[];
  dispatches: BoardDispatch[];
  auctions: BoardAuction[];
  requests: BoardRequest[];
}

function dispatchOf(value: unknown): BoardDispatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('a dispatch must be a mapping');
  const raw = value as Record<string, unknown>;
  for (const name of ['item', 'change', 'task', 'executor', 'dispatchedAt', 'expiresAt']) {
    if (typeof raw[name] !== 'string' || raw[name] === '') invalid(`dispatches[].${name} must be nonempty`);
  }
  if (!Number.isInteger(raw.leaseSeconds) || (raw.leaseSeconds as number) < 1
    || (raw.leaseSeconds as number) > 86_400) invalid('dispatches[].leaseSeconds is invalid');
  for (const name of ['dispatchedAt', 'expiresAt']) {
    if (Number.isNaN(Date.parse(raw[name] as string))) invalid(`dispatches[].${name} is invalid`);
  }
  if (raw.item !== `${raw.change}#${raw.task}`) invalid('dispatches[].item is inconsistent');
  return raw as unknown as BoardDispatch;
}

function invalid(detail: string): never {
  throw new SdlcError(
    'board_invalid',
    { key: 'error.the_board_file_x_is_broken_x', params: { file: BOARD_PATH, detail } },
  );
}

function parseReopenFields(raw: Record<string, unknown>, claim: BoardClaim): void {
  if (raw.reason !== undefined) {
    if (typeof raw.reason !== 'string' || raw.reason.trim() === '') invalid('claims[].reason must be nonempty');
    claim.reason = raw.reason;
  }
  if (raw.reopenedAt !== undefined) {
    if (typeof raw.reopenedAt !== 'string' || Number.isNaN(Date.parse(raw.reopenedAt))) {
      invalid('claims[].reopenedAt must be an ISO timestamp');
    }
    claim.reopenedAt = raw.reopenedAt;
  }
  if (raw.escalate !== undefined) {
    if (typeof raw.escalate !== 'boolean') invalid('claims[].escalate must be a boolean');
    claim.escalate = raw.escalate;
  }
  if (claim.state === 'reopened' && (!claim.branch || !claim.reason || !claim.reopenedAt
    || claim.escalate === undefined)) {
    invalid('reopened claims require branch, reason, reopenedAt and escalate');
  }
}

function claimOf(value: unknown): BoardClaim {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('a claim must be a mapping');
  const raw = value as Record<string, unknown>;
  const text = (name: string) => {
    if (typeof raw[name] !== 'string' || raw[name] === '') invalid(`claims[].${name} must be a nonempty string`);
    return raw[name] as string;
  };
  const claim: BoardClaim = {
    id: text('id'), item: text('item'), change: text('change'), task: text('task'),
    executor: text('executor'), agent: text('agent'),
    claimedAt: text('claimedAt'), expiresAt: text('expiresAt'),
    leaseSeconds: 0,
    state: text('state') as ClaimState,
  };
  const ext = parseExtensions(raw.ext);
  if (ext !== undefined) claim.ext = ext;
  if (!Number.isInteger(raw.leaseSeconds) || (raw.leaseSeconds as number) < 1) {
    invalid('claims[].leaseSeconds must be a positive integer');
  }
  claim.leaseSeconds = raw.leaseSeconds as number;
  if (!['held', 'released', 'expired', 'submitted', 'reopened'].includes(claim.state)) {
    invalid('claims[].state is unknown');
  }
  if (Number.isNaN(Date.parse(claim.claimedAt)) || Number.isNaN(Date.parse(claim.expiresAt))) {
    invalid('claims[] timestamps must be ISO strings');
  }
  for (const name of ['releasedAt', 'expiredAt', 'branch', 'head'] as const) {
    if (typeof raw[name] === 'string') claim[name] = raw[name] as string;
  }
  parseReopenFields(raw, claim);
  return claim;
}

/** The board, parsed at the boundary; a missing file is an empty board, a broken one is `board_invalid`. */
export function readBoard(root: string): Board {
  const text = readText(path.join(root, BOARD_PATH));
  if (text === undefined) return { version: 1, claims: [], dispatches: [], auctions: [], requests: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    invalid(error instanceof Error ? error.message : String(error));
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalid('the root must be a mapping');
  const raw = parsed as Record<string, unknown>;
  if (raw.version !== 1) invalid('version must be 1');
  if (!Array.isArray(raw.claims)) invalid('claims must be a list');
  if (raw.dispatches !== undefined && !Array.isArray(raw.dispatches)) invalid('dispatches must be a list');
  return { version: 1, claims: raw.claims.map(claimOf),
    dispatches: (raw.dispatches ?? []).map(dispatchOf),
    auctions: parseAuctions(raw.auctions), requests: pruneRequests(parseRequests(raw.requests), Date.now()) };
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Age is insufficient: only an old record whose process is provably dead may be reclaimed. */
function staleLock(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    if (stat.mtimeMs >= Date.now() - STALE_LOCK_MS || stat.size > 256) return false;
    const pid = Number(fs.readFileSync(file, 'utf8').split(/\s/)[0]);
    if (!Number.isSafeInteger(pid) || pid < 1) return false;
    try { process.kill(pid, 0); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
  } catch {
    return false;
  }
}

function acquireLock(file: string, wait: number): { fd: number; owner: string } {
  const deadline = performance.now() + wait;
  for (;;) {
    try {
      const fd = fs.openSync(file, 'wx');
      const owner = `${process.pid} ${randomUUID()}`;
      fs.writeSync(fd, `${owner} ${new Date().toISOString()}`);
      return { fd, owner };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (staleLock(file)) {
        fs.rmSync(file, { force: true });
      } else if (performance.now() >= deadline) {
        throw new SdlcError('board_locked', { key: 'error.the_board_is_locked_by_another_process' });
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }
}

/**
 * One exclusive read-change-write of the board: the work `fn` does (and the board write after it) is atomic
 * against other sdlc processes. By default the board is written even when `fn` throws, so expired claims are
 * not applied twice. Reopen opts out on refusal so the board file stays unchanged.
 */
export function updateBoard<T>(root: string, fn: (board: Board) => T, writeOnError = true): T {
  const preview = preparationBoard(root);
  if (preview) return fn(preview);
  const file = path.join(root, BOARD_PATH);
  const lock = path.join(root, BOARD_LOCK);
  ensureDir(path.dirname(file));
  const { fd, owner } = acquireLock(lock, boardLockWait(root, LOCK_TIMEOUT_MS));
  try {
    const board = readBoard(root);
    return finalizeBoard(root, board, () => {
      let completed = false;
      let replayed = false;
      try {
        const result = fn(board);
        completed = true;
        return result;
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        replayed = error instanceof RequestReplay || code.startsWith('plugin_evaluation_') || code === 'plugin_busy';
        throw error;
      } finally {
        if (!replayed && (completed || writeOnError) && publicationAllowed(root)) {
          beforeBoardCommit(root);
          ensureLocalIgnore(root, ['board.json', 'board.lock']);
          writeTextAtomic(file, `${JSON.stringify(board)}\n`);
          flushObservations(root);
        }
      }
    });
  } finally {
    fs.closeSync(fd);
    if (readText(lock)?.startsWith(`${owner} `)) fs.rmSync(lock, { force: true });
  }
}

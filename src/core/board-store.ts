import * as fs from 'node:fs';
import * as path from 'node:path';
import { SdlcError } from './errors.js';
import { ensureDir, readText, writeTextAtomic } from './fs-utils.js';

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
  if (text === undefined) return { version: 1, claims: [], dispatches: [] };
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
    dispatches: (raw.dispatches ?? []).map(dispatchOf) };
}

/** `openspec/.sdlc/.gitignore` keeps board.json and board.lock out of every commit; extended, never replaced. */
function ensureGitignore(root: string): void {
  const file = path.join(root, BOARD_IGNORE);
  const entries = ['board.json', 'board.lock'];
  const text = readText(file);
  if (text === undefined) {
    writeTextAtomic(file, `${entries.join('\n')}\n`);
    return;
  }
  const present = new Set(text.split('\n').map((line) => line.trim()).filter(Boolean));
  const missing = entries.filter((entry) => !present.has(entry));
  if (missing.length === 0) return;
  const join = text.endsWith('\n') || text === '' ? '' : '\n';
  writeTextAtomic(file, `${text}${join}${missing.join('\n')}\n`);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** A lock older than ~30 s is a crashed holder's; broken and retried. A missing file is not stale. */
function staleLock(file: string): boolean {
  try {
    return fs.statSync(file).mtimeMs < Date.now() - STALE_LOCK_MS;
  } catch {
    return false;
  }
}

function acquireLock(file: string): number {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}`);
      return fd;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (staleLock(file)) {
        fs.rmSync(file, { force: true });
      } else if (Date.now() > deadline) {
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
  const file = path.join(root, BOARD_PATH);
  const lock = path.join(root, BOARD_LOCK);
  ensureDir(path.dirname(file));
  const fd = acquireLock(lock);
  try {
    const board = readBoard(root);
    let completed = false;
    try {
      const result = fn(board);
      completed = true;
      return result;
    } finally {
      if (completed || writeOnError) {
        ensureGitignore(root);
        writeTextAtomic(file, `${JSON.stringify(board)}\n`);
      }
    }
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}

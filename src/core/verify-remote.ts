import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CommandRemoteReason, VerifyCommandRecord } from './change-state.js';
import type { VerifyCommand } from './config.js';
import { worktreeFingerprint } from './git.js';
import { t } from './i18n.js';
import { FINGERPRINT_EXCLUDES } from './lifecycle.js';
import { commitFingerprint, treeDifference } from './tree-commit.js';
import type { CheckOutcome } from './verify.js';

/**
 * A verify command marked `remote: true` hands the committed tree to the project's own script, which runs the suite
 * on a server. sdlc refuses a tree that is not HEAD, gives the script the commit, a fresh answer path and a log path,
 * and passes the check only on exit 0 with an answer that names the same commit with status `passed`.
 * The transport (ssh, locks, retries) stays in the script: nothing here reaches the network or retries.
 */

const ANSWER_LIMIT = 64 * 1024;
const LOG_LIMIT = 8 * 1024 * 1024;
const LISTED_FILES = 10;
const UNAVAILABLE = new Set(['busy', 'unavailable']);

export interface RemoteRun {
  root: string;
  /** The change folder; the kept log lives under its `verification/remote/`. */
  changeDir?: string;
  runId: string;
  commit?: string;
  /** The worktree fingerprint the run's evidence is bound to. */
  fingerprint?: string;
}

interface Session {
  dir: string;
  answer: string;
  log: string;
  /** The log path relative to the change folder; absent when the log is not kept. */
  logRel?: string;
  env: Record<string, string>;
}

interface Verdict {
  reason?: CommandRemoteReason;
  failed: boolean;
  note?: string;
}

type Runner = (env: Record<string, string>) => Promise<CheckOutcome>;

/** Runs a remote check: the preflight, the command with its three variables, then the judge. Never retries. */
export async function runRemoteCheck(run: RemoteRun, check: VerifyCommand, start: Runner): Promise<CheckOutcome> {
  const refusal = preflight(run);
  if (refusal) return refused(check, refusal);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-remote-answer-'));
  try {
    const session = openSession(run, check, dir);
    const outcome = await start(session.env);
    return judged(outcome, session, run.commit!);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Why the tree may not go out, or undefined when the disk is the commit at HEAD outside openspec/. */
function preflight(run: RemoteRun): Verdict | undefined {
  if (!run.commit) return { reason: 'remote_no_commit', failed: true, note: t('verify.remoteNoCommit') };
  const committed = commitFingerprint(run.root, run.commit, FINGERPRINT_EXCLUDES);
  const now = worktreeFingerprint(run.root, FINGERPRINT_EXCLUDES);
  if (committed && now === committed && run.fingerprint === committed) return undefined;
  const files = committed && now ? treeDifference(run.root, now, committed) : undefined;
  return { reason: 'remote_dirty', failed: true, note: dirtyNote(run.commit, files) };
}

function dirtyNote(commit: string, files: string[] | undefined): string {
  if (!files || files.length === 0) return t('verify.remoteDirtyUnknown', { commit: commit.slice(0, 12) });
  const more = files.length > LISTED_FILES ? `; ${files.length - LISTED_FILES} more` : '';
  const listed = files.slice(0, LISTED_FILES).join(', ');
  return t('verify.remoteDirty', { commit: commit.slice(0, 12), files: listed, more });
}

function refused(check: VerifyCommand, verdict: Verdict): CheckOutcome {
  return {
    name: check.name,
    command: check.run,
    exit_code: null,
    duration_ms: 0,
    required: check.required,
    remote: true,
    reason: verdict.reason,
    output: verdict.note ?? '',
  };
}

/** The answer path and the log path; the log goes to the temporary folder when the kept log folder is blocked. */
function openSession(run: RemoteRun, check: VerifyCommand, dir: string): Session {
  const answer = path.join(dir, 'answer.json');
  const file = `${check.name.replace(/[^A-Za-z0-9._-]/g, '_')}.log`;
  const kept = run.changeDir ? keptLogPath(run.changeDir, file) : undefined;
  const log = kept ?? path.join(dir, file);
  const logRel = kept ? `verification/remote/${file}` : undefined;
  const env = { SDLC_VERIFY_COMMIT: run.commit!, SDLC_VERIFY_ANSWER: answer, SDLC_VERIFY_LOG: log };
  return { dir, answer, log, ...(logRel ? { logRel } : {}), env };
}

/** The one log file of the check under `verification/remote/`, removed before the run; undefined when blocked. */
function keptLogPath(changeDir: string, file: string): string | undefined {
  try {
    const folder = logFolder(changeDir);
    if (!folder) return undefined;
    const log = path.join(folder, file);
    fs.rmSync(log, { force: true });
    return log;
  } catch {
    return undefined;
  }
}

/** `verification/remote/` of the change, created when missing; undefined when it is a link or lies outside. */
function logFolder(changeDir: string): string | undefined {
  const verification = path.join(changeDir, 'verification');
  const remote = path.join(verification, 'remote');
  if (!plainFolder(verification) || !plainFolder(remote)) return undefined;
  const relative = path.relative(fs.realpathSync(changeDir), fs.realpathSync(remote));
  const outside = relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`);
  if (outside || path.isAbsolute(relative)) return undefined;
  return remote;
}

/** Creates a missing folder; false when the path is a link, a junction or not a folder. */
function plainFolder(folder: string): boolean {
  if (!fs.existsSync(folder)) fs.mkdirSync(folder);
  const stat = fs.lstatSync(folder);
  return stat.isDirectory() && !stat.isSymbolicLink();
}

function judged(outcome: CheckOutcome, session: Session, commit: string): CheckOutcome {
  const kept = keptLog(session);
  const base: CheckOutcome = { ...outcome, remote: true, ...(kept ? { log: kept } : {}) };
  if (outcome.cancelled) return base;
  const verdict = judge(outcome, session.answer, commit);
  if (!verdict.failed) return base;
  const output = [outcome.output, verdict.note].filter(Boolean).join('\n');
  return {
    ...base,
    ...(verdict.reason ? { reason: verdict.reason } : {}),
    ...(outcome.exit_code === 0 ? { answer_failed: true } : {}),
    output,
  };
}

/** The kept log relative to the change folder, cut to its last part; undefined when there is none. */
function keptLog(session: Session): string | undefined {
  if (!session.logRel || !isRegularFile(session.log)) return undefined;
  try {
    boundLog(session.log);
    return session.logRel;
  } catch {
    return undefined;
  }
}

/** Keeps only the last 8 MiB of a larger log, after one first line that says it was cut. */
function boundLog(file: string): void {
  const size = fs.statSync(file).size;
  if (size <= LOG_LIMIT) return;
  const tail = Buffer.alloc(LOG_LIMIT);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, tail, 0, LOG_LIMIT, size - LOG_LIMIT);
  } finally {
    fs.closeSync(fd);
  }
  const head = Buffer.from(`[sdlc] log cut: kept the last ${LOG_LIMIT} of ${size} bytes\n`, 'utf8');
  fs.writeFileSync(file, Buffer.concat([head, tail]));
}

/** The judge: exit 0, not timed out, and a regular answer file naming the commit with status `passed`. */
function judge(outcome: CheckOutcome, answerFile: string, commit: string): Verdict {
  if (outcome.timed_out) return { reason: 'remote_no_answer', failed: true, note: t('verify.remoteTimedOut') };
  const answer = readAnswer(answerFile);
  if (!answer) return { reason: 'remote_no_answer', failed: true, note: t('verify.remoteNoAnswer') };
  if (answer.commit !== commit) {
    return { failed: true, note: t('verify.remoteOtherCommit', { commit: commit.slice(0, 12) }) };
  }
  if (typeof answer.status === 'string' && UNAVAILABLE.has(answer.status)) {
    const note = t('verify.remoteUnavailable', { status: answer.status });
    return { reason: 'remote_unavailable', failed: true, note };
  }
  if (answer.status !== 'passed') return { failed: true, note: t('verify.remoteNotPassed') };
  if (outcome.exit_code !== 0) return { failed: true, note: t('verify.remoteExitCode') };
  return { failed: false };
}

/**
 * The answer as a JSON object, or undefined when it is missing, a link, too large, unreadable or not an object.
 * One leading byte order mark is dropped: PowerShell writes one.
 */
function readAnswer(file: string): Record<string, unknown> | undefined {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > ANSWER_LIMIT) return undefined;
    const text = fs.readFileSync(file, 'utf8');
    const value: unknown = JSON.parse(text.startsWith('\uFEFF') ? text.slice(1) : text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function isRegularFile(file: string): boolean {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
}

/** The evidence row's note on the kept log of a remote check; empty for a local one. */
export function remoteLogNote(check: Pick<VerifyCommandRecord, 'remote' | 'log'>): string {
  if (!check.remote) return '';
  return check.log ? `, log \`${check.log}\`` : ', no log written';
}

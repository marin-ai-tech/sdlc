import type { RemoteRunReason, VerifyCommandRecord } from './change-state.js';

/** Name a failed run only when the missing fingerprint is its sole cause. */
export function fingerprintFailureReason(
  run: {
    status: 'passed' | 'failed';
    fingerprint?: string;
    checks: ReadonlyArray<{ required: boolean; exit_code: number | null }>;
    mcp?: ReadonlyArray<{ required: boolean; ok: boolean }>;
  },
  partial: boolean,
): 'fingerprint_unavailable' | undefined {
  if (run.status !== 'failed' || run.fingerprint || partial) {
    return undefined;
  }
  if (run.checks.length + (run.mcp?.length ?? 0) === 0) {
    return undefined;
  }
  if (run.checks.some((check) => check.required && check.exit_code !== 0)) {
    return undefined;
  }
  if (run.mcp?.some((check) => check.required && !check.ok)) {
    return undefined;
  }
  return 'fingerprint_unavailable';
}

/** Whether a command check passed: exit 0, no timeout, no cleanup failure, not cancelled, no rejected answer. */
export function commandPassed(check: {
  exit_code: number | null;
  timed_out?: boolean;
  cleanup_failed?: boolean;
  cancelled?: string;
  answer_failed?: boolean;
}): boolean {
  return check.exit_code === 0 && check.timed_out !== true
    && check.cleanup_failed !== true && !check.cancelled && check.answer_failed !== true;
}

const REFUSALS: readonly unknown[] = ['remote_dirty', 'remote_no_commit'];
const NO_ANSWER: readonly unknown[] = ['remote_unavailable', 'remote_no_answer'];

/**
 * The run-level reason: only when every failed required check was refused for its tree (`remote_dirty`), or failed
 * because the remote gave no usable answer.
 */
export function remoteFailureReason(run: {
  status: 'passed' | 'failed';
  checks: ReadonlyArray<VerifyCommandRecord>;
  mcp?: ReadonlyArray<{ required: boolean; ok: boolean }>;
}): RemoteRunReason | undefined {
  if (run.status !== 'failed') return undefined;
  if (run.mcp?.some((check) => check.required && !check.ok)) return undefined;
  const failed = run.checks.filter((check) => check.cancelled || (check.required && !commandPassed(check)));
  if (failed.length === 0) return undefined;
  const reasons = failed.map((check) => check.reason);
  if (reasons.every((reason) => REFUSALS.includes(reason))) return 'remote_dirty';
  if (!reasons.every((reason) => NO_ANSWER.includes(reason))) return undefined;
  return reasons.every((reason) => reason === 'remote_unavailable') ? 'remote_unavailable' : 'remote_no_answer';
}

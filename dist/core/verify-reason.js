/** Name a failed run only when the missing fingerprint is its sole cause. */
export function fingerprintFailureReason(run, partial) {
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
export function commandPassed(check) {
    return check.exit_code === 0 && check.timed_out !== true
        && check.cleanup_failed !== true && !check.cancelled && check.answer_failed !== true;
}
const REFUSALS = ['remote_dirty', 'remote_no_commit'];
const NO_ANSWER = ['remote_unavailable', 'remote_no_answer'];
/**
 * The run-level reason: only when every failed required check was refused for its tree (`remote_dirty`), or failed
 * because the remote gave no usable answer.
 */
export function remoteFailureReason(run) {
    if (run.status !== 'failed')
        return undefined;
    if (run.mcp?.some((check) => check.required && !check.ok))
        return undefined;
    const failed = run.checks.filter((check) => check.cancelled || (check.required && !commandPassed(check)));
    if (failed.length === 0)
        return undefined;
    const reasons = failed.map((check) => check.reason);
    if (reasons.every((reason) => REFUSALS.includes(reason)))
        return 'remote_dirty';
    if (!reasons.every((reason) => NO_ANSWER.includes(reason)))
        return undefined;
    return reasons.every((reason) => reason === 'remote_unavailable') ? 'remote_unavailable' : 'remote_no_answer';
}

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

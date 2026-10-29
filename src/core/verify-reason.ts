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

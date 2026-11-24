import { createHash } from 'node:crypto';
import type { SdlcConfig } from './config.js';
import type { VerifyCommandRecord, VerifyMcpRecord, VerifyRecord } from './change-state.js';
import { SdlcError } from './errors.js';
import type { VerificationRun } from './verify.js';
import { commandPassed, remoteFailureReason } from './verify-reason.js';

type CheckRecord = VerifyCommandRecord | VerifyMcpRecord;

function validText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function attemptOf(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function digestArgs(args: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(args)).digest('hex');
}

function fingerprintOf(result: CheckRecord, record: VerifyRecord): string | undefined {
  const own = validText(result.fingerprint);
  if (own) return own;
  if (result.run_id !== undefined || result.attempt !== undefined) return undefined;
  return validText(record.fingerprint);
}

function sameIdentity(result: CheckRecord, config: SdlcConfig, allowMissingMcpDigest = false): boolean {
  if ('command' in result) {
    const check = config.verify.commands.find((item) => item.name === result.name);
    // An absent mark means local. `--failed` reruns a check that gained the mark instead of refusing it.
    const sameMark = (result.remote === true) === (check?.remote === true)
      || (allowMissingMcpDigest && result.remote === undefined);
    return !!check && result.command === check.run && result.required === check.required && sameMark;
  }
  const check = (config.verify.mcp ?? []).find((item) => item.name === result.name);
  return !!check && result.server === check.server && result.tool === check.tool
    && result.required === check.required
    && ((allowMissingMcpDigest && result.args_digest === undefined)
      || result.args_digest === digestArgs(check.args));
}

function passed(result: CheckRecord): boolean {
  return 'command' in result ? commandPassed(result) : result.ok === true;
}

function configured(config: SdlcConfig): Array<{ name: string; required: boolean }> {
  return [...config.verify.commands, ...(config.verify.mcp ?? [])];
}

function resultFor(record: VerifyRecord, name: string): CheckRecord | undefined {
  const matches = [...(Array.isArray(record.results) ? record.results : []),
    ...(Array.isArray(record.mcp) ? record.mcp : [])].filter((item) => item.name === name);
  return matches.length === 1 ? matches[0] : undefined;
}

function isCancelled(result: CheckRecord): boolean {
  return 'cancelled' in result && result.cancelled !== undefined;
}

/**
 * A check that must pass needs a passed result; any other needs a result that was not cancelled. The caller passes
 * the flag from the configuration, never the one stored in the record.
 */
function outcomeOk(result: CheckRecord, mustPass: boolean): boolean {
  if (mustPass) return passed(result);
  return !isCancelled(result);
}

function checksPassed(record: VerifyRecord, config: SdlcConfig, fingerprint: string | undefined,
  skipFingerprint: boolean, requirePassed: boolean): boolean {
  const checks = configured(config);
  if (checks.length === 0) return record.status === 'passed';
  if (!fingerprint && !skipFingerprint) return false;
  return checks.every(({ name, required }) => {
    const result = resultFor(record, name);
    if (!result) return false;
    const fingerprintMatches = !fingerprint && skipFingerprint
      || fingerprintOf(result, record) === fingerprint;
    const mustPass = requirePassed || required;
    return fingerprintMatches && sameIdentity(result, config) && outcomeOk(result, mustPass);
  });
}

export function allChecksPassed(record: VerifyRecord, config: SdlcConfig, fingerprint?: string,
  skipFingerprint = false): boolean {
  return checksPassed(record, config, fingerprint, skipFingerprint, false);
}

/** Strict: every configured check passed. Reuse uses this so a failed optional is not a source. */
export function allConfiguredChecksPassed(record: VerifyRecord, config: SdlcConfig, fingerprint?: string,
  skipFingerprint = false): boolean {
  return checksPassed(record, config, fingerprint, skipFingerprint, true);
}

function refuse(key: string, params?: Record<string, string>): never {
  throw new SdlcError('verify_failed_refused', { key, params });
}

export function failedSelection(record: VerifyRecord | undefined, config: SdlcConfig,
  fingerprint: string | undefined, only?: string[]): string[] {
  if (only !== undefined) refuse('error.verifyFailedWithOnly');
  if (!record) refuse('error.verifyFailedNoRecord');
  if (!fingerprint || record.fingerprint !== fingerprint) refuse('error.verifyFailedFingerprint');
  for (const { name } of configured(config)) {
    const result = resultFor(record, name);
    if (result && !sameIdentity(result, config, true)) refuse('error.verifyFailedChangedCheck', { name });
  }
  const selected = configured(config).filter(({ name }) => {
    const result = resultFor(record, name);
    return !result || fingerprintOf(result, record) !== fingerprint
      || !sameIdentity(result, config) || !passed(result);
  }).map(({ name }) => name);
  if (selected.length === 0) refuse('error.verifyFailedNothingToRun');
  return selected;
}

function bind<T extends CheckRecord>(result: T, previous: CheckRecord | undefined,
  record: VerifyRecord | undefined, run: VerificationRun): T {
  const same = previous && record && fingerprintOf(previous, record) === run.fingerprint;
  return { ...result, ...(run.fingerprint ? { fingerprint: run.fingerprint } : {}),
    run_id: run.id, attempt: same ? attemptOf(previous.attempt) + 1 : 1 };
}

function keptResult<T extends CheckRecord>(item: T, base: VerifyRecord): T {
  if (item.fingerprint !== undefined || item.run_id !== undefined || item.attempt !== undefined) return item;
  return { ...item, ...(base.fingerprint ? { fingerprint: base.fingerprint } : {}),
    ...(base.id ? { run_id: base.id } : {}), attempt: 1 };
}

/** B183: the unstable list stays on the record only when every kept result ran under the same list. */
function mergedDigest(run: VerificationRun, base: VerifyRecord | undefined, kept: number): string | undefined {
  if (kept === 0) return run.unstableDigest;
  return base?.unstable_digest === run.unstableDigest ? run.unstableDigest : undefined;
}

/** Replace just the checks this run executed; old output is deliberately not persisted. */
export function mergeVerification(run: VerificationRun, previous: VerifyRecord | undefined,
  config: SdlcConfig): VerificationRun {
  const base = run.fingerprint && previous?.fingerprint === run.fingerprint ? previous : undefined;
  const commands = run.checks.map((item) => bind(item, base && resultFor(base, item.name), base, run));
  const mcp = (run.mcp ?? []).map((item) => {
    const check = (config.verify.mcp ?? []).find((entry) => entry.name === item.name);
    const result = { ...item, ...(check ? { args_digest: digestArgs(check.args) } : {}) };
    return bind(result, base && resultFor(base, item.name), base, run);
  });
  const keptCommands = (base?.results ?? []).filter((item) =>
    config.verify.commands.some((check) => check.name === item.name)
      && !!base && fingerprintOf(item, base) === run.fingerprint
      && sameIdentity(item, config)
      && !commands.some((next) => next.name === item.name));
  const keptMcp = (base?.mcp ?? []).filter((item) =>
    (config.verify.mcp ?? []).some((check) => check.name === item.name)
      && !!base && fingerprintOf(item, base) === run.fingerprint
      && sameIdentity(item, config)
      && !mcp.some((next) => next.name === item.name));
  const mergedCommands = [...keptCommands.map((item) => ({ ...keptResult(item, base!), output: '', kept: true })),
    ...commands]
    .sort((a, b) => config.verify.commands.findIndex((item) => item.name === a.name)
      - config.verify.commands.findIndex((item) => item.name === b.name));
  const mergedMcp = [...keptMcp.map((item) => ({ ...keptResult(item, base!), result: undefined, kept: true })),
    ...mcp]
    .sort((a, b) => (config.verify.mcp ?? []).findIndex((item) => item.name === a.name)
      - (config.verify.mcp ?? []).findIndex((item) => item.name === b.name));
  const candidate: VerifyRecord = { status: 'failed', at: run.at, fingerprint: run.fingerprint,
    results: mergedCommands, mcp: mergedMcp };
  const status = allChecksPassed(candidate, config, run.fingerprint) ? 'passed' : 'failed';
  const digest = mergedDigest(run, base, keptCommands.length + keptMcp.length);
  const { reason: executedReason, unstableDigest: _unstable, ...rest } = run;
  const reason = executedReason === 'fingerprint_unavailable'
    ? executedReason : remoteFailureReason({ status, checks: mergedCommands, mcp: mergedMcp });
  return { ...rest, status, checks: mergedCommands, mcp: mergedMcp,
    ...(reason ? { reason } : {}), ...(digest ? { unstableDigest: digest } : {}) };
}

import { randomBytes } from 'node:crypto';
import { listActiveChanges, listArchivedChanges } from './changes.js';
import { readChangeState } from './change-state.js';
import { SdlcError } from './errors.js';
import { t } from './i18n.js';
import { readLog } from './log.js';
import { allConfiguredChecksPassed } from './verify-merge.js';
import { unstableDigest } from './verify-unstable.js';
/** The text of a history entry written for a reused record; metrics skip such entries. */
const HISTORY_PREFIX = 'reused from ';
export function parseReuse(value, where) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'boolean') {
        throw new SdlcError('invalid_config', { key: 'error.x_must_be_true_or_false', params: { where: where('verify.reuse') } });
    }
    return value;
}
export function serializeReuse(reuse) {
    return reuse === true ? { reuse: true } : {};
}
export function reuseWeakeningWarnings(before, after) {
    return after === true && before !== true ? [t('config.warning.reuse')] : [];
}
export function reuseHistoryDetail(from) {
    return `${HISTORY_PREFIX}${from.change} ${from.run_id}`;
}
export function isReusedHistory(entry) {
    return /^verify\./.test(entry.event) && (entry.detail ?? '').startsWith(HISTORY_PREFIX);
}
/** The timeout `runVerification` applies to a command: its own or the project default. */
function effectiveTimeouts(config) {
    return new Map(config.verify.commands.map((check) => [check.name, check.timeoutSeconds ?? config.verify.timeoutSeconds]));
}
function sameTimeouts(record, config) {
    const expected = effectiveTimeouts(config);
    const results = Array.isArray(record.results) ? record.results : [];
    return [...expected].every(([name, seconds]) => results.some((result) => result.name === name && result.timeout_seconds === seconds));
}
/** Finished runs of the source change on the record's fingerprint; a reuse entry is no run and never counts. */
function loggedRuns(log, change, fingerprint) {
    if (!fingerprint)
        return [];
    return log.filter((entry) => entry.change === change
        && (entry.event === 'verify.passed' || entry.event === 'verify.failed')
        && entry.run?.trigger !== 'reuse'
        && entry.run?.fingerprint === fingerprint);
}
function onlyResult(items, name) {
    const matches = (Array.isArray(items) ? items : []).filter((item) => item.name === name);
    return matches.length === 1 ? matches[0] : undefined;
}
/** The logged run a command result names must have run that command and passed it there. */
function ranCommand(runs, record, name) {
    const runId = onlyResult(record.results, name)?.run_id;
    if (!runId)
        return false;
    return runs.some((entry) => entry.run?.id === runId
        && (entry.run.checks ?? []).some((check) => check.name === name
            && check.exit_code === 0 && check.timed_out !== true));
}
/** The logged run an MCP result names must have called that check and got ok there. */
function ranMcp(runs, record, name) {
    const runId = onlyResult(record.mcp, name)?.run_id;
    if (!runId)
        return false;
    return runs.some((entry) => entry.run?.id === runId
        && (entry.run.mcp ?? []).some((check) => check.name === name && check.ok === true));
}
/**
 * The log must hold a `verify.passed` for this very run of the source change, and every configured result must
 * name a logged run of that change that ran the check and passed it: a planted record or result has none.
 */
function confirmedByLog(log, change, record, config) {
    const runs = loggedRuns(log, change, record.fingerprint);
    const finished = runs.some((entry) => entry.event === 'verify.passed' && entry.run?.id === record.id);
    if (!finished)
        return false;
    const commands = config.verify.commands.every((check) => ranCommand(runs, record, check.name));
    const mcp = (config.verify.mcp ?? []).every((check) => ranMcp(runs, record, check.name));
    return commands && mcp;
}
/** The record must name the unstable list it ran under, and that list must be today's (fail closed). */
function sameUnstable(record, config) {
    return typeof record.unstable_digest === 'string'
        && record.unstable_digest === unstableDigest(config.verify.unstable);
}
function usable(record, config, fingerprint) {
    return !!record && !!record.id && record.status === 'passed' && !record.reused_from
        && record.fingerprint === fingerprint
        && allConfiguredChecksPassed(record, config, fingerprint)
        && sameTimeouts(record, config)
        && sameUnstable(record, config);
}
function newer(a, b) {
    return b.record.at.localeCompare(a.record.at) || a.change.localeCompare(b.change);
}
export function findReuseSource(paths, root, config, current) {
    const refs = [...listActiveChanges(paths), ...listArchivedChanges(paths)];
    const candidates = refs.filter((ref) => ref.id !== current.change)
        .map((ref) => ({ change: ref.id, record: readChangeState(ref.dir).verify }))
        .filter((item) => usable(item.record, config, current.fingerprint))
        .sort(newer);
    if (candidates.length === 0)
        return undefined;
    const log = readLog(root);
    return candidates.find((item) => confirmedByLog(log, item.change, item.record, config));
}
/** The source results of the configured checks, in configured order; others are not carried over. */
function configuredResults(items, checks) {
    return checks.map((check) => onlyResult(items, check.name)).filter((item) => item !== undefined);
}
/** The run recorded for the reusing change: the source results are kept, their output is not stored. */
export function reusedRun(source, tree, config) {
    const now = new Date().toISOString();
    return {
        id: randomBytes(6).toString('hex'),
        started_at: now,
        status: 'passed',
        at: now,
        ...(tree.commit ? { commit: tree.commit } : {}),
        dirty: tree.dirty,
        fingerprint: tree.fingerprint,
        reusedFrom: { change: source.change, run_id: source.record.id },
        ...(source.record.unstable_digest ? { unstableDigest: source.record.unstable_digest } : {}),
        checks: configuredResults(source.record.results, config.verify.commands)
            .map((result) => ({ ...result, output: '', kept: true })),
        mcp: configuredResults(source.record.mcp, config.verify.mcp ?? [])
            .map((item) => ({ ...item, result: undefined, kept: true })),
    };
}
/** Log facts of a reused run: no checks ran, so no durations; summaries skip `trigger: 'reuse'`. */
export function reusedRunFacts(run) {
    return {
        id: run.id,
        started_at: run.started_at,
        finished_at: run.at,
        duration_ms: 0,
        ...(run.fingerprint ? { fingerprint: run.fingerprint } : {}),
        ...(run.commit ? { commit: run.commit } : {}),
        trigger: 'reuse',
        partial: false,
        reused_from: run.reusedFrom,
        checks: [],
    };
}
/** The text shown next to every kept result of a reused run. */
export function reuseNote(run) {
    if (!run.reusedFrom)
        return '';
    return ` ${t('verify.reusedFrom', { change: run.reusedFrom.change, run: run.reusedFrom.run_id })}`;
}

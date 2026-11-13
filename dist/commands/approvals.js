import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure, warn } from '../cli/output.js';
import { approvalTrailers } from '../core/approval-hygiene.js';
import { allChanges, approvalSignature, approvalSites, hasRolesHistory, rolesSignatures, trailerStatus, withAllowedSigners, withSignersFile, } from '../core/approval-signatures.js';
import { SdlcError, toDiagnostic } from '../core/errors.js';
import { historyErrors } from '../core/history-trust.js';
import { readRolesFile, SIGNING_MODES } from '../core/roles.js';
import { t } from '../core/i18n.js';
import { resolveSigningSince } from '../core/signing-since.js';
function verify(root, paths, roles, signers, signingSince) {
    const results = [];
    const trailers = approvalTrailers(root);
    for (const site of approvalSites(root, allChanges(paths))) {
        const { ref, gate, record } = site;
        const trailer = trailerStatus(trailers, ref.id, gate, record.digest);
        const base = { change: ref.id, gate, role: record.role, by: record.by, person: record.person, trailer };
        results.push({ ...base, ...approvalSignature(root, roles, signers, site, signingSince) });
    }
    results.push(...rolesSignatures(root, signers));
    return results;
}
function passing(status) {
    return status === 'valid' || status === 'pre-signing' || status === 'bootstrap' || status === 'merge';
}
function printResults(results, mode, cutoff) {
    for (const result of results) {
        const subject = result.file ?? `${result.change}/${result.gate}`;
        const mark = passing(result.status) ? '✓' : '✗';
        const status = t(`approvals.status.${result.status}`);
        const trailer = typeof result.trailer === 'string' ? ` ${t('approvals.trailer', { status: result.trailer })}` : '';
        const commit = result.commit?.slice(0, 8) ?? '-';
        line(`${mark} ${subject} ${result.person ?? result.by} ${status} ${commit}${trailer}`);
    }
    const approvals = results.filter((result) => result.change).length;
    const failures = results.filter((result) => !passing(result.status));
    const blocking = mode === 'warn' ? t('approvals.warnNotBlocking') : '';
    line(t('approvals.summary', { approvals, invalid: failures.length, blocking }));
    if (cutoff)
        line(t('approvals.signingSince', { commit: cutoff }));
    if (failures.length)
        line(t('approvals.signHint'));
}
function signingMode(flag, roles) {
    const mode = flag ?? roles?.signing ?? 'off';
    if (!SIGNING_MODES.includes(mode)) {
        throw new SdlcError('invalid_mode', { key: 'error.unknown_signing_mode_x', params: { mode: mode } });
    }
    return mode;
}
/**
 * B114: a shallow clone or grafts make the history untrustworthy. Required verification refuses (the first problem
 * is thrown); warn mode returns the problems, reported as warnings, and goes on.
 */
function trustProblems(root, mode) {
    const problems = historyErrors(root);
    if (mode === 'required' && problems.length)
        throw problems[0];
    return problems;
}
function asWarning(problem) {
    return { ...toDiagnostic(problem), severity: 'warning' };
}
/** B114: roles.yaml is deleted at HEAD, so only its history is checked (no current roles to check approvals with). */
function verifyRolesHistory(root) {
    return withSignersFile('', (signers) => rolesSignatures(root, signers));
}
function printOff(mode, json) {
    if (json)
        printJson({ mode, ok: true, results: [] });
    else
        line(t('approvals.off'));
}
function printWarnings(problems) {
    for (const problem of problems)
        warn(`${problem.localizedMessage()} ${problem.localizedFix() ?? ''}`.trimEnd());
}
function printOutcome(mode, results, problems, json, cutoff) {
    const ok = results.every((result) => passing(result.status));
    const warnings = problems.length ? { warnings: problems.map(asWarning) } : {};
    if (json) {
        printJson({ mode, ok, results, ...warnings, ...(cutoff ? { signingSince: cutoff } : {}) });
    }
    else {
        printWarnings(problems);
        printResults(results, mode, cutoff);
    }
    if (mode === 'required' && !ok)
        process.exitCode = 1;
}
export function approvalsVerify(opts) {
    try {
        const ctx = loadProject();
        const roles = readRolesFile(ctx.root);
        const mode = signingMode(opts.mode, roles);
        const checking = mode !== 'off' && (roles !== undefined || mode === 'required');
        const problems = checking ? trustProblems(ctx.root, mode) : [];
        if (!checking || (!roles && !hasRolesHistory(ctx.root))) {
            printOff(mode, opts.json);
            return;
        }
        const signingSince = roles?.signingSince ? resolveSigningSince(ctx.root, roles.signingSince) : undefined;
        const results = roles
            ? withAllowedSigners(roles, (signers) => verify(ctx.root, ctx.paths, roles, signers, signingSince))
            : verifyRolesHistory(ctx.root);
        printOutcome(mode, results, problems, opts.json, roles?.signingSince);
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}

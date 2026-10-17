/**
 * The qa gate (B110, 0.18.0): an optional approval gate between verify and review. With `gates.qa.required`, a person
 * with a qa role accepts the verification evidence (`sdlc approve qa`) before review; the review gate waits for it.
 * The approval is bound to the evidence: verification.md and the recorded verify run (result, time, commit and
 * worktree fingerprint), so a new `sdlc verify` run makes it stale. Off by default: then the gate is not shown at
 * all, unless the change already has a qa decision or a command asks for it (`sdlc approve qa`, as for release).
 */
import { createHash } from 'node:crypto';
import { digestFiles } from './digest.js';
import { t } from './i18n.js';
import { evaluateApprovalGate } from './approval-gate.js';
import { awaitedRoles } from './approval-quorum.js';
/** The evidence file a qa approval covers, relative to the change folder. */
export const QA_EVIDENCE = 'verification.md';
function hasDecision(record) {
    if (!record)
        return false;
    return (record.approvals?.length ?? 0) > 0 || !!record.rejection || !!record.waived || !!record.rework;
}
/** True when the change shows the qa gate: the project requires it, the change has a qa decision, or it is asked. */
export function qaInUse(config, state, asked = false) {
    return asked || config.gates.qa.required || hasDecision(state.gates.qa);
}
/** The recorded verify run as the approval sees it; `never` before the first run. */
function recordedRun(state) {
    const run = state.verify;
    if (!run)
        return 'never';
    return [run.status, run.at, run.commit ?? '', run.fingerprint ?? ''].join('\0');
}
/** What a qa approval covers: the recorded verify run and verification.md (provenance aside). */
export function qaDigest(changeDir, state) {
    const hash = createHash('sha256');
    hash.update(recordedRun(state));
    hash.update('\0');
    hash.update(digestFiles(changeDir, [QA_EVIDENCE]));
    return `sha256:${hash.digest('hex')}`;
}
/**
 * The qa-gate evaluation while the gate is in use; undefined when the change does not show it.
 * Recorded approvals are trusted when the change is archived or the reader cannot fingerprint.
 */
export function evaluateQaGate(ref, config, state, gateState, blocked, options = {}) {
    if (!qaInUse(config, state, options.withQa))
        return undefined;
    const trustRecorded = ref.archived || options.skipFingerprint === true;
    return evaluateApprovalGate('qa', config, state, gateState, qaDigest(ref.dir, state), blocked, [], trustRecorded, ref.archived);
}
function withKey(action, key, params) {
    return { ...action, key, params, message: t(key, params, 'en') };
}
/** QA rejected the evidence: the agent fixes the change and runs the verification again (new evidence). */
function qaRevision(view, gate) {
    const reason = gate.reasonKey ? { key: gate.reasonKey, params: gate.reasonParams ?? {} } : gate.reason ?? '';
    const action = { actor: 'agent', action: 'verify', workflow: 'verify', gate: 'qa' };
    return withKey({ ...action, cli: `sdlc verify --change ${view.change}` }, 'next.qaRejected', { reason });
}
/** A person with a qa role accepts (or re-accepts) the verification evidence. */
function qaApproval(view, gate, config) {
    const key = gate.status === 'stale' ? 'next.qaReapprove' : 'next.qaApprove';
    const roles = awaitedRoles(gate.missingRoles, config.gates.qa).join(', ');
    const action = { actor: 'human', action: 'approve-gate', gate: 'qa' };
    return withKey({ ...action, workflow: 'verify', cli: `sdlc approve qa --change ${view.change}` }, key, { roles });
}
/** The next step while a required qa gate holds the change; undefined when it does not. */
export function qaNext(view, config) {
    const gate = view.gates.find((item) => item.id === 'qa');
    if (!gate || !gate.required || gate.satisfied)
        return undefined;
    if (gate.status === 'rejected')
        return qaRevision(view, gate);
    return qaApproval(view, gate, config);
}
/** Whether a required qa gate follows the verification (explain's "what comes next"). */
export function qaRequired(view) {
    return view.gates.some((gate) => gate.id === 'qa' && gate.required);
}

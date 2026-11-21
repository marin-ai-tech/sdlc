import { behaviourGapParams } from './verify-behaviour.js';
import { lr, withLocalizedReason } from './approval-gate.js';
import { allChecksPassed } from './verify-merge.js';
/** The gate reason of a failed run by its record reason; a code failure has none. */
const FAILED_KEYS = {
    fingerprint_unavailable: 'gate.verifyFingerprintUnavailable',
    remote_unavailable: 'gate.verifyRemoteUnavailable',
    remote_no_answer: 'gate.verifyRemoteNoAnswer',
    remote_dirty: 'gate.verifyRemoteDirty',
};
/** The verify-gate evaluation, the recorded run as the view shows it and the updated `upstreamOpen`. */
export function evaluateVerifyGate(input) {
    const { ref, config, state, schema, tracks, taskProgress, remaining } = input;
    let upstreamOpen = input.upstreamOpen;
    const verifyRequired = config.gates.verify.required;
    let verification = { status: 'never' };
    if (state.verify) {
        const fresh = ref.archived
            || (!!input.fingerprint && !!state.verify.fingerprint && state.verify.fingerprint === input.fingerprint);
        const fingerprint = input.skipFingerprint ? state.verify.fingerprint : input.fingerprint;
        // An archived change keeps the verify state it was archived with: today's checks do not judge it (B330).
        const passed = state.verify.status === 'passed'
            && (ref.archived || allChecksPassed(state.verify, config, fingerprint, input.skipFingerprint));
        verification = {
            status: passed ? (fresh ? 'passed' : 'stale') : state.verify.status === 'passed' ? 'stale' : 'failed',
            at: state.verify.at,
            ...(state.verify.commit ? { commit: state.verify.commit } : {}),
        };
        // Fast mode cannot fingerprint the worktree; it still checks the configured command identities.
        if (input.skipFingerprint && passed)
            verification.status = 'passed';
    }
    let status;
    let info;
    const waiver = input.decided?.waived;
    if (waiver) {
        status = 'waived';
        info = lr('gate.waived', { by: waiver.by, note: waiver.note });
    }
    else if (upstreamOpen) {
        status = 'blocked';
        info = upstreamOpen;
    }
    else if (!taskProgress && schema.apply && !input.planWaived) {
        status = 'blocked';
        info = lr('gate.noTasksFile', { file: tracks });
    }
    else if (remaining > 0) {
        status = 'blocked';
        info = lr('gate.tasksOpen', { remaining, file: tracks });
    }
    else if (verification.status === 'passed') {
        status = 'passed';
        const gap = behaviourGapParams(ref.dir, config.verify.requireBehaviour);
        if (gap)
            info = lr('gate.verifyBehaviour', gap);
    }
    else if (verification.status === 'stale') {
        status = 'stale';
        info = lr('gate.verifyStale');
    }
    else if (verification.status === 'failed') {
        status = 'failed';
        info = lr(FAILED_KEYS[state.verify?.reason ?? ''] ?? 'gate.verifyFailed');
    }
    else {
        status = 'pending';
        info = config.verify.commands.length === 0
            ? lr('gate.verifyNoCommands')
            : lr('gate.verifyRun');
    }
    const behaviourBlocks = info?.reasonKey === 'gate.verifyBehaviour';
    const satisfied = (status === 'passed' && !behaviourBlocks) || status === 'waived' || !verifyRequired;
    const verifyBase = {
        id: 'verify', stage: 'test', required: verifyRequired, status, satisfied,
        artifacts: [], approvals: [], staleApprovals: [], missingRoles: [],
    };
    const evaluation = info ? withLocalizedReason(verifyBase, info) : verifyBase;
    if (!satisfied && !upstreamOpen)
        upstreamOpen = lr('gate.waitingOn', { gate: 'verify' });
    return { evaluation, verification, upstreamOpen };
}

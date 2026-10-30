import { behaviourGapParams } from './verify-behaviour.js';
import { lr, withLocalizedReason } from './approval-gate.js';
/** The verify-gate evaluation, the recorded run as the view shows it and the updated `upstreamOpen`. */
export function evaluateVerifyGate(input) {
    const { ref, config, state, schema, tracks, taskProgress, remaining } = input;
    let upstreamOpen = input.upstreamOpen;
    const verifyRequired = config.gates.verify.required;
    let verification = { status: 'never' };
    if (state.verify) {
        const fresh = ref.archived
            || (!!input.fingerprint && !!state.verify.fingerprint && state.verify.fingerprint === input.fingerprint);
        verification = {
            status: state.verify.status === 'passed' ? (fresh ? 'passed' : 'stale') : 'failed',
            at: state.verify.at,
            ...(state.verify.commit ? { commit: state.verify.commit } : {}),
        };
        // Fast mode cannot fingerprint the worktree; trust the last recorded result.
        if (input.skipFingerprint && state.verify.status === 'passed')
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
        info = lr(state.verify?.reason === 'fingerprint_unavailable'
            ? 'gate.verifyFingerprintUnavailable' : 'gate.verifyFailed');
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

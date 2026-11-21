import { evaluateApprovalGate } from './approval-gate.js';
/** The release-gate evaluation. */
export function evaluateReleaseGate(config, state, gateState, digest, blocked, trustRecorded, ignoreBlockedWithApproval) {
    return evaluateApprovalGate('release', config, state, gateState, digest, blocked, [], trustRecorded, ignoreBlockedWithApproval);
}

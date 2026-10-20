import type { ApprovalGateId } from './config.js';
import { SdlcError } from './errors.js';
import type { GateEvaluation } from './lifecycle.js';

/** `gate_blocked` / `gate_not_ready`, as `sdlc approve` raises them. */
export function assertReady(gate: ApprovalGateId, evaluation: GateEvaluation): void {
  if (evaluation.status === 'blocked') {
    // The reason as a catalog reference: English in JSON (the text `sdlc approve` gives), localized in text output.
    const reason = evaluation.reasonKey ? { key: evaluation.reasonKey, params: evaluation.reasonParams } : undefined;
    const params = { gate, evaluation_reason: reason ?? evaluation.reason ?? '' };
    throw new SdlcError('gate_blocked', { key: 'error.the_x_gate_cannot_be_approved_yet_x', params });
  }
  if (!evaluation.digest) {
    throw new SdlcError('gate_not_ready', { key: 'error.nothing_to_approve_for_the_x_gate_yet', params: { gate } });
  }
}

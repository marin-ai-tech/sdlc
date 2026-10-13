/**
 * The release gate (moved out of lifecycle.ts, B123): a person's approval to ship, bound to the code
 * under review plus review.md and release.md (the `codeDigest` of approval-gate.ts), so any later code
 * change makes it stale.
 */
import type { ChangeState, GateState } from './change-state.js';
import type { SdlcConfig } from './config.js';
import { evaluateApprovalGate, type LocalizedReason } from './approval-gate.js';
import type { GateEvaluation } from './lifecycle.js';

/** The release-gate evaluation. */
export function evaluateReleaseGate(
  config: SdlcConfig,
  state: ChangeState,
  gateState: GateState | undefined,
  digest: string | undefined,
  blocked: LocalizedReason | undefined,
  trustRecorded: boolean,
  ignoreBlockedWithApproval: boolean
): GateEvaluation {
  return evaluateApprovalGate('release', config, state, gateState, digest, blocked, [],
    trustRecorded, ignoreBlockedWithApproval);
}

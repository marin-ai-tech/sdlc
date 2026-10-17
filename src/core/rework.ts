import { ALL_GATES, type GateId, type SdlcConfig } from './config.js';
import { awaitingReason, quorum } from './approval-quorum.js';
import type { ChangeState, GateState } from './change-state.js';
import { decidedAfter, decidedAfterAll, orderOf, type Ordered } from './decision-order.js';
import { SdlcError } from './errors.js';
import { t } from './i18n.js';
import type { GateEvaluation, NextAction } from './lifecycle.js';
export { filesThatChange } from './plan-files.js';

/**
 * Rework: a person sends a change back to a gate's stage with a reason category and a note
 * (`sdlc rework`). The gate counts as rejected until its artifacts change or an approval follows, and
 * approvals and waivers of that gate and of every later gate made before the rework stop counting.
 */
export const REWORK_GATES = ['intent', 'spec', 'plan', 'qa', 'review'] as const;
export type ReworkGateId = (typeof REWORK_GATES)[number];

/**
 * Per gate, the latest rework at it or at an earlier gate: decisions recorded before then no longer count.
 * "Before" follows the order the decisions were recorded in (`decision-order.ts`), else their time.
 */
function cutoffs(state: ChangeState): Partial<Record<GateId, Ordered>> {
  const out: Partial<Record<GateId, Ordered>> = {};
  let latest: Ordered | undefined;
  for (const id of ALL_GATES) {
    const rework = state.gates[id]?.rework;
    if (rework?.at && (!latest || decidedAfter(rework, latest))) latest = orderOf(rework);
    if (latest) out[id] = latest;
  }
  return out;
}

/** The gate's rejection once its rework counts as one, unless a rejection was recorded after the rework. */
function reworkRejection(gate: GateState): GateState['rejection'] {
  const rework = gate.rework;
  if (!rework || (gate.rejection && decidedAfter(gate.rejection, rework))) return gate.rejection;
  return { by: rework.by, ...orderOf(rework), note: rework.note, digest: rework.digest };
}

/** A changed digest ends the revision phase only for decisions that recorded their artifact digest. */
export function revisedGates(gates: GateEvaluation[], state: ChangeState, config: SdlcConfig): GateEvaluation[] {
  return gates.map((gate) => {
    if (gate.status !== 'rejected' || !gate.digest) return gate;
    if (gate.id === 'verify' || gate.id === 'release') return gate;
    const record = state.gates[gate.id];
    const decision = record?.rework && (!record.rejection || decidedAfter(record.rework, record.rejection))
      ? record.rework
      : record?.rejection;
    if (!decision?.digest || decision.digest === gate.digest) return gate;
    const [reasonKey, reasonParams] = awaitingReason(gate.missingRoles, quorum(gate.approvals, config.gates[gate.id]));
    return { ...gate, status: 'pending', reason: t(reasonKey, reasonParams, 'en'), reasonKey, reasonParams };
  });
}

/** The next agent step for a gate that still needs a revision. */
export function reviseNext(gate: GateId, artifacts: string, reason: string): NextAction {
  const params = { gate, reason, artifacts };
  return {
    actor: 'agent', action: 'revise-artifact', workflow: gate, gate,
    key: 'next.reviseArtifact', params, message: t('next.reviseArtifact', params, 'en'),
  };
}

/** A review rejection remains an agent task even when review.md has independent coverage blockers. */
export function activeReviewRevision(gate: GateEvaluation, state: ChangeState): string | undefined {
  if (gate.id !== 'review' || gate.satisfied || !gate.digest) return undefined;
  const record = effectiveGates(state).review;
  const rejection = record?.rejection;
  if (!rejection || (rejection.digest && rejection.digest !== gate.digest)) return undefined;
  if (!decidedAfterAll(rejection, record?.approvals ?? [])) return undefined;
  const rework = record?.rework;
  const useRework = rework && !decidedAfter(rejection, rework) && !decidedAfter(rework, rejection);
  if (useRework) {
    return t('gate.reworkNote', { by: rework.by, reason: rework.reason, note: rework.note }, 'en');
  }
  return rejection?.note
    ? t('gate.rejectedNote', { by: rejection.by, note: rejection.note }, 'en')
    : t('gate.rejected', { by: rejection?.by ?? '' }, 'en');
}

function afterCutoff(gate: GateState, cutoff: Ordered): GateState {
  const rejection = gate.rejection && decidedAfter(gate.rejection, cutoff) ? gate.rejection : undefined;
  const ownRework = gate.rework && !decidedAfter(cutoff, gate.rework) ? gate.rework : undefined;
  return {
    ...gate,
    approvals: (gate.approvals ?? []).filter((a) => decidedAfter(a, cutoff)),
    waived: gate.waived && decidedAfter(gate.waived, cutoff) ? gate.waived : undefined,
    rejection: ownRework ? reworkRejection({ ...gate, rejection }) : rejection,
  };
}

/** The gate records as the evaluation must read them once reworks are taken into account. */
export function effectiveGates(state: ChangeState): ChangeState['gates'] {
  const limits = cutoffs(state);
  const out: ChangeState['gates'] = { ...state.gates };
  for (const id of ALL_GATES) {
    const gate = state.gates[id];
    const cutoff = limits[id];
    if (gate && cutoff) out[id] = afterCutoff(gate, cutoff);
  }
  return out;
}

/** A gate rejected by its rework says so: the reason category, the note, who and when. */
export function markReworks(gates: GateEvaluation[], state: ChangeState): GateEvaluation[] {
  return gates.map((gate) => {
    const rework = state.gates[gate.id]?.rework;
    const rejection = state.gates[gate.id]?.rejection;
    if (!rework || gate.status !== 'rejected' || (rejection && decidedAfter(rejection, rework))) return gate;
    const params = { by: rework.by, reason: rework.reason, note: rework.note };
    return {
      ...gate,
      reason: t('gate.reworkNote', params, 'en'),
      reasonKey: 'gate.reworkNote',
      reasonParams: params,
      rework: { reason: rework.reason, note: rework.note, by: rework.by, at: rework.at },
    };
  });
}

export function assertReworkReason(config: SdlcConfig, reason: string | undefined): string {
  const reasons = config.rework.reasons;
  if (reason && reasons.includes(reason)) return reason;
  throw new SdlcError(
    'invalid_option',
    { key: 'error.rework_reason_unknown', params: { reason: reason ?? '', reasons: reasons.join(', ') } },
  );
}

function hasDecision(gate: GateState | undefined): boolean {
  if (!gate) return false;
  return (gate.approvals?.length ?? 0) > 0 || !!gate.rejection || !!gate.waived || !!gate.rework;
}

/** A gate is reached once it was approved or waived, or a later gate has a decision. */
export function gateReached(state: ChangeState, gate: GateId): boolean {
  const own = state.gates[gate];
  if ((own?.approvals?.length ?? 0) > 0 || own?.waived) return true;
  return ALL_GATES.slice(ALL_GATES.indexOf(gate) + 1).some((id) => hasDecision(state.gates[id]));
}

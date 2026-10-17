/**
 * The verify gate (moved out of lifecycle.ts, B123): deterministic evidence from `sdlc verify`, bound
 * to the worktree fingerprint so a later edit makes it stale. Also derives the `verification` view
 * field; fast readers (`skipFingerprint`) trust the last recorded result.
 */
import type { ChangeRef } from './changes.js';
import type { ChangeState, GateState } from './change-state.js';
import type { SdlcConfig } from './config.js';
import type { SchemaInfo } from './openspec-schema.js';
import type { TaskProgress } from './tasks.js';
import { behaviourGapParams } from './verify-behaviour.js';
import { lr, withLocalizedReason, type LocalizedReason } from './approval-gate.js';
import type { GateEvaluation, GateStatus, LifecycleView } from './lifecycle.js';

export interface VerifyGateInput {
  ref: ChangeRef;
  config: SdlcConfig;
  state: ChangeState;
  /** The recorded verify decision, after effective/auto-waive rewriting (`decided.verify`). */
  decided: GateState | undefined;
  fingerprint?: string;
  skipFingerprint?: boolean;
  schema: SchemaInfo;
  tracks: string;
  taskProgress?: TaskProgress;
  remaining: number;
  planWaived: boolean;
  upstreamOpen?: LocalizedReason;
}

/** The verify-gate evaluation, the recorded run as the view shows it and the updated `upstreamOpen`. */
export function evaluateVerifyGate(input: VerifyGateInput): {
  evaluation: GateEvaluation;
  verification: LifecycleView['verification'];
  upstreamOpen?: LocalizedReason;
} {
  const { ref, config, state, schema, tracks, taskProgress, remaining } = input;
  let upstreamOpen = input.upstreamOpen;
  const verifyRequired = config.gates.verify.required;
  let verification: LifecycleView['verification'] = { status: 'never' };
  if (state.verify) {
    const fresh = ref.archived
      || !input.fingerprint
      || !state.verify.fingerprint
      || state.verify.fingerprint === input.fingerprint;
    verification = {
      status: state.verify.status === 'passed' ? (fresh ? 'passed' : 'stale') : 'failed',
      at: state.verify.at,
      ...(state.verify.commit ? { commit: state.verify.commit } : {}),
    };
    // Fast mode cannot fingerprint the worktree; trust the last recorded result.
    if (input.skipFingerprint && state.verify.status === 'passed') verification.status = 'passed';
  }
  let status: GateStatus;
  let info: LocalizedReason | undefined;
  const waiver = input.decided?.waived;
  if (waiver) {
    status = 'waived';
    info = lr('gate.waived', { by: waiver.by, note: waiver.note });
  } else if (upstreamOpen) {
    status = 'blocked';
    info = upstreamOpen;
  } else if (!taskProgress && schema.apply && !input.planWaived) {
    status = 'blocked';
    info = lr('gate.noTasksFile', { file: tracks });
  } else if (remaining > 0) {
    status = 'blocked';
    info = lr('gate.tasksOpen', { remaining, file: tracks });
  } else if (verification.status === 'passed') {
    status = 'passed';
    const gap = behaviourGapParams(ref.dir, config.verify.requireBehaviour);
    if (gap) info = lr('gate.verifyBehaviour', gap);
  } else if (verification.status === 'stale') {
    status = 'stale';
    info = lr('gate.verifyStale');
  } else if (verification.status === 'failed') {
    status = 'failed';
    info = lr('gate.verifyFailed');
  } else {
    status = 'pending';
    info = config.verify.commands.length === 0
      ? lr('gate.verifyNoCommands')
      : lr('gate.verifyRun');
  }
  const behaviourBlocks = info?.reasonKey === 'gate.verifyBehaviour';
  const satisfied = (status === 'passed' && !behaviourBlocks) || status === 'waived' || !verifyRequired;
  const verifyBase = {
    id: 'verify' as const, stage: 'test' as const, required: verifyRequired, status, satisfied,
    artifacts: [] as string[], approvals: [], staleApprovals: [], missingRoles: [] as string[],
  };
  const evaluation = info ? withLocalizedReason(verifyBase, info) : verifyBase;
  if (!satisfied && !upstreamOpen) upstreamOpen = lr('gate.waitingOn', { gate: 'verify' });
  return { evaluation, verification, upstreamOpen };
}

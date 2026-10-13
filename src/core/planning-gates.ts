/**
 * The planning gates (moved out of lifecycle.ts, B123): intent, spec and plan. Each covers a set of
 * schema artifacts (`gateArtifacts`); a gate missing artifacts is blocked, and a gate left unsatisfied
 * blocks the gates after it (`upstreamOpen`).
 */
import type { ChangeRef } from './changes.js';
import type { ChangeState } from './change-state.js';
import type { SdlcConfig } from './config.js';
import { digestFiles, withoutCheckboxState } from './digest.js';
import type { ArtifactState, SchemaInfo } from './openspec-schema.js';
import {
  evaluateApprovalGate,
  lr,
  withLocalizedReason,
  type LocalizedReason,
} from './approval-gate.js';
import { GATE_STAGE } from './stages.js';
import type { GateEvaluation } from './lifecycle.js';

/** The three planning-gate evaluations plus the first reason a later gate is waiting on. */
export function evaluatePlanningGates(
  ref: ChangeRef,
  config: SdlcConfig,
  state: ChangeState,
  decided: ChangeState['gates'],
  schema: SchemaInfo,
  mapping: Record<'intent' | 'spec' | 'plan', string[]>,
  artifacts: ArtifactState[],
  tracks: string
): { gates: GateEvaluation[]; upstreamOpen?: LocalizedReason } {
  const byId = new Map(artifacts.map((a) => [a.id, a]));
  const coveredFiles = (ids: string[]) => ids.flatMap((id) => byId.get(id)?.files ?? []);
  const missingOf = (ids: string[]) => ids.filter((id) => {
    const s = byId.get(id)?.status;
    return s !== 'done' && s !== 'skipped';
  });

  const gates: GateEvaluation[] = [];
  let upstreamOpen: LocalizedReason | undefined;
  for (const id of ['intent', 'spec', 'plan'] as const) {
    const covered = mapping[id];
    if (covered.length === 0) {
      gates.push(withLocalizedReason(
        { id, stage: GATE_STAGE[id], required: false, status: 'n/a' as const, satisfied: true,
          artifacts: [], approvals: [], staleApprovals: [], missingRoles: [] },
        lr('gate.noArtifacts', { schema: schema.name }),
      ));
      continue;
    }
    const missing = missingOf(covered);
    const blocked = missing.length > 0
      ? lr('gate.missingArtifacts', { artifacts: missing.join(', ') })
      : upstreamOpen;
    const digest = missing.length === 0
      ? digestFiles(ref.dir, coveredFiles(covered), (rel, content) => (rel === tracks ? withoutCheckboxState(content) : content))
      : undefined;
    const evaluation = evaluateApprovalGate(id, config, state, decided[id], digest, blocked, covered, ref.archived);
    gates.push(evaluation);
    if (!evaluation.satisfied && !upstreamOpen) upstreamOpen = lr('gate.waitingOn', { gate: id });
  }
  return { gates, upstreamOpen };
}

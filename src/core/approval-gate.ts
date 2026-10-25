/**
 * The shared approval-gate evaluation (moved out of lifecycle.ts, B123): required roles, the localized
 * "why it cannot move on" helpers and `evaluateApprovalGate`, which every approval gate (intent, spec,
 * plan, qa, review, release) runs against the digest of what it covers.
 */
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type { ApprovalGateId, SdlcConfig } from './config.js';
import type { ChangeState, GateState } from './change-state.js';
import { t } from './i18n.js';
import { decidedAfterAll } from './decision-order.js';
import { digestFiles, type DigestCapture } from './digest.js';
import { isFile } from './fs-utils.js';
import { awaitingReason, quorum } from './approval-quorum.js';
import { GATE_STAGE } from './stages.js';
import type { GateEvaluation } from './lifecycle.js';

function requiredRoles(config: SdlcConfig, gate: ApprovalGateId, state: ChangeState): {
  anyOf: string[];
  allOf: string[];
} {
  const g = config.gates[gate];
  return { anyOf: g.approvers, allOf: state.risk === 'high' ? g.highRiskApprovers : [] };
}

/**
 * Evaluates an approval gate against the digest of what it covers. Approvals
 * whose digest no longer matches are "stale": the approver signed off on
 * content that has since changed, so the gate needs a fresh approval.
 */

export interface LocalizedReason {
  reason: string;
  reasonKey: string;
  reasonParams?: Record<string, string | number>;
}

export function lr(key: string, params: Record<string, string | number> = {}): LocalizedReason {
  return {
    reason: t(key, params, 'en'),
    reasonKey: key,
    ...(Object.keys(params).length > 0 ? { reasonParams: params } : {}),
  };
}

export function withLocalizedReason<T extends object>(base: T, info: LocalizedReason): T & LocalizedReason {
  return { ...base, ...info };
}

export function evaluateApprovalGate(
  id: ApprovalGateId,
  config: SdlcConfig,
  state: ChangeState,
  gateState: GateState | undefined,
  digest: string | undefined,
  blocked: LocalizedReason | undefined,
  artifacts: string[],
  trustRecorded = false,
  ignoreBlockedWithApproval = trustRecorded
): GateEvaluation {
  const required = config.gates[id].required && !(state.track === 'lite' && (id === 'intent' || id === 'spec'));
  const all = gateState?.approvals ?? [];
  const valid = trustRecorded ? all : digest ? all.filter((a) => a.digest === digest) : [];
  const q = quorum(valid, config.gates[id]);
  const base = { id, stage: GATE_STAGE[id], required, artifacts, minApprovals: q.min, ...(digest ? { digest } : {}) };
  const stale = trustRecorded ? [] : digest ? all.filter((a) => a.digest !== digest) : all;
  const roles = requiredRoles(config, id, state);
  const validRoles = new Set(valid.map((a) => a.role));
  const anySatisfied = roles.anyOf.length === 0 ? valid.length > 0 : roles.anyOf.some((r) => validRoles.has(r));
  const missingRoles = [
    ...(anySatisfied ? [] : roles.anyOf.length > 0 ? [roles.anyOf.join(' | ')] : ['any approver']),
    ...roles.allOf.filter((r) => !validRoles.has(r)),
  ];

  const open = { approvals: valid, staleApprovals: stale, missingRoles };
  if (gateState?.waived) {
    const info = lr('gate.waived', { by: gateState.waived.by, note: gateState.waived.note });
    return withLocalizedReason(
      { ...base, status: 'waived' as const, satisfied: true, ...open, missingRoles: [] },
      info,
    );
  }
  if (blocked && !(ignoreBlockedWithApproval && valid.length > 0)) {
    return withLocalizedReason(
      { ...base, status: 'blocked' as const, satisfied: !required, ...open },
      blocked,
    );
  }
  const rejection = gateState?.rejection;
  // Rejected unless an approval was recorded after the rejection (by `seq`, else by time: decision-order.ts).
  if (rejection && decidedAfterAll(rejection, valid)) {
    const info = rejection.note
      ? lr('gate.rejectedNote', { by: rejection.by, note: rejection.note })
      : lr('gate.rejected', { by: rejection.by });
    return withLocalizedReason(
      { ...base, status: 'rejected' as const, satisfied: !required, ...open },
      info,
    );
  }
  if (missingRoles.length === 0 && q.met) {
    return { ...base, status: 'approved', satisfied: true, ...open };
  }
  if (stale.length > 0 && valid.length === 0) {
    return withLocalizedReason(
      { ...base, status: 'stale' as const, satisfied: !required, ...open },
      lr('gate.stale'),
    );
  }
  const awaiting = lr(...awaitingReason(missingRoles, q));
  return withLocalizedReason(
    { ...base, status: 'pending' as const, satisfied: !required, ...open },
    awaiting,
  );
}

/**
 * Review and release approvals are bound to the code under review (worktree
 * fingerprint) plus the record files, so any later code change makes them stale.
 */
export function codeDigest(changeDir: string, fingerprint: string | undefined, extra: string[],
  capture?: DigestCapture): string | undefined {
  if (!fingerprint) return undefined;
  const files = extra.filter((f) => isFile(path.join(changeDir, f)));
  const artifactDigest = digestFiles(changeDir, files, undefined, capture);
  const digest = `sha256:${createHash('sha256')
    .update(fingerprint)
    .update('\0')
    .update(artifactDigest)
    .digest('hex')}`;
  if (capture) capture.set(digest, { digest, files: capture.get(artifactDigest)!.files, fingerprint });
  return digest;
}

/**
 * The shared approval-gate evaluation (moved out of lifecycle.ts, B123): required roles, the localized
 * "why it cannot move on" helpers and `evaluateApprovalGate`, which every approval gate (intent, spec,
 * plan, qa, review, release) runs against the digest of what it covers.
 */
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { t } from './i18n.js';
import { decidedAfterAll } from './decision-order.js';
import { digestFiles } from './digest.js';
import { isFile } from './fs-utils.js';
import { awaitingReason, quorum } from './approval-quorum.js';
import { GATE_STAGE } from './stages.js';
function requiredRoles(config, gate, state) {
    const g = config.gates[gate];
    return { anyOf: g.approvers, allOf: state.risk === 'high' ? g.highRiskApprovers : [] };
}
export function lr(key, params = {}) {
    return {
        reason: t(key, params, 'en'),
        reasonKey: key,
        ...(Object.keys(params).length > 0 ? { reasonParams: params } : {}),
    };
}
export function withLocalizedReason(base, info) {
    return { ...base, ...info };
}
export function evaluateApprovalGate(id, config, state, gateState, digest, blocked, artifacts, trustRecorded = false, ignoreBlockedWithApproval = trustRecorded) {
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
        return withLocalizedReason({ ...base, status: 'waived', satisfied: true, ...open, missingRoles: [] }, info);
    }
    if (blocked && !(ignoreBlockedWithApproval && valid.length > 0)) {
        return withLocalizedReason({ ...base, status: 'blocked', satisfied: !required, ...open }, blocked);
    }
    const rejection = gateState?.rejection;
    // Rejected unless an approval was recorded after the rejection (by `seq`, else by time: decision-order.ts).
    if (rejection && decidedAfterAll(rejection, valid)) {
        const info = rejection.note
            ? lr('gate.rejectedNote', { by: rejection.by, note: rejection.note })
            : lr('gate.rejected', { by: rejection.by });
        return withLocalizedReason({ ...base, status: 'rejected', satisfied: !required, ...open }, info);
    }
    if (missingRoles.length === 0 && q.met) {
        return { ...base, status: 'approved', satisfied: true, ...open };
    }
    if (stale.length > 0 && valid.length === 0) {
        return withLocalizedReason({ ...base, status: 'stale', satisfied: !required, ...open }, lr('gate.stale'));
    }
    const awaiting = lr(...awaitingReason(missingRoles, q));
    return withLocalizedReason({ ...base, status: 'pending', satisfied: !required, ...open }, awaiting);
}
/**
 * Review and release approvals are bound to the code under review (worktree
 * fingerprint) plus the record files, so any later code change makes them stale.
 */
export function codeDigest(changeDir, fingerprint, extra) {
    const files = extra.filter((f) => isFile(path.join(changeDir, f)));
    return `sha256:${createHash('sha256')
        .update(fingerprint ?? 'no-git')
        .update('\0')
        .update(digestFiles(changeDir, files))
        .digest('hex')}`;
}

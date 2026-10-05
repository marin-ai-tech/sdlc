/**
 * Several approvers for one gate: `gates.<g>.min_approvals: N` in sdlc.yaml (default 1). The gate is approved
 * when valid approvals come from N different people and the role rules hold. A person is the roles.yaml id
 * recorded with the approval, else the email of `by`, so one person approving twice counts once.
 */
import type { ApprovalRecord } from './change-state.js';
import type { GateConfig } from './config.js';
import { SdlcError } from './errors.js';
import { t } from './i18n.js';

export interface Quorum {
  /** Different people with a valid approval. */
  count: number;
  /** People the gate needs (`min_approvals`, default 1). */
  min: number;
  met: boolean;
}

/** `min_approvals` from sdlc.yaml: undefined when unset, else an integer of 1 or more (`invalid_config`). */
export function parseMinApprovals(value: unknown, where: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new SdlcError('invalid_config', { key: 'error.x_must_be_an_integer_of_1_or_more', params: { where } });
  }
  return value;
}

/** The email of `Name <email>` (or the whole text), lower-cased. */
export function approverEmail(by: string): string {
  return (/<([^>]+)>/.exec(by)?.[1] ?? by).trim().toLowerCase();
}

/** Who gave an approval: the roles.yaml person id when recorded, else the email. */
export function approverKey(record: Pick<ApprovalRecord, 'by' | 'person'>): string {
  return record.person ? `person:${record.person}` : `email:${approverEmail(record.by)}`;
}

export function quorum(valid: ApprovalRecord[], gate: GateConfig): Quorum {
  const count = new Set(valid.map(approverKey)).size;
  const min = gate.minApprovals ?? 1;
  return { count, min, met: count >= min };
}

/**
 * Without roles.yaml `--by` is unauthenticated text: on a gate that needs several people it would let one person
 * add approvers to the quorum by typing names, so it is refused (`by_not_allowed`).
 */
export function assertByAllowed(gate: GateConfig, hasRoles: boolean, by: string | undefined): void {
  const min = gate.minApprovals ?? 1;
  if (by === undefined || hasRoles || min <= 1) return;
  throw new SdlcError('by_not_allowed', { key: 'error.by_not_allowed', params: { min } });
}

/** True when `record` was given by the person approving now (same roles.yaml id or same email). */
export function sameApprover(record: ApprovalRecord, identity: string, person: string | undefined): boolean {
  if (person && record.person === person) return true;
  return approverEmail(record.by) === approverEmail(identity);
}

/** Catalog key and params of a pending gate's reason: missing roles, too few people, or both. */
export function awaitingReason(missingRoles: string[], q: Quorum): [string, Record<string, string | number>] {
  const roles = missingRoles.join(', ');
  if (q.met) return ['gate.awaiting', { roles }];
  if (missingRoles.length === 0) return ['gate.awaitingCount', { count: q.count, min: q.min }];
  return ['gate.awaitingRolesCount', { roles, count: q.count, min: q.min }];
}

/** Roles a Next hint asks for: the missing ones, or the gate's roles when only people are short. */
export function awaitedRoles(missingRoles: string[], gate: GateConfig): string[] {
  if (missingRoles.length > 0) return missingRoles;
  return [gate.approvers.length > 0 ? gate.approvers.join(' | ') : 'any approver'];
}

/** What a gate still needs after an approval: the missing roles and, when people are short, "1 of 2". */
export function stillNeeded(gate: { missingRoles: string[]; approvals: ApprovalRecord[]; minApprovals?: number }) {
  const count = new Set(gate.approvals.map(approverKey)).size;
  const min = gate.minApprovals ?? 1;
  const parts = [...gate.missingRoles];
  if (count < min) parts.push(t('gate.countOf', { count, min }));
  return parts.join(', ');
}

import { SdlcError } from './errors.js';
import { t } from './i18n.js';
/** `min_approvals` from sdlc.yaml: undefined when unset, else an integer of 1 or more (`invalid_config`). */
export function parseMinApprovals(value, where) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw new SdlcError('invalid_config', { key: 'error.x_must_be_an_integer_of_1_or_more', params: { where } });
    }
    return value;
}
/** The email of `Name <email>` (or the whole text), lower-cased. */
export function approverEmail(by) {
    return (/<([^>]+)>/.exec(by)?.[1] ?? by).trim().toLowerCase();
}
/** Who gave an approval: the roles.yaml person id when recorded, else the email. */
export function approverKey(record) {
    return record.person ? `person:${record.person}` : `email:${approverEmail(record.by)}`;
}
export function quorum(valid, gate) {
    const count = new Set(valid.map(approverKey)).size;
    const min = gate.minApprovals ?? 1;
    return { count, min, met: count >= min };
}
/**
 * Without roles.yaml `--by` is unauthenticated text: on a gate that needs several people it would let one person
 * add approvers to the quorum by typing names, so it is refused (`by_not_allowed`).
 */
export function assertByAllowed(gate, hasRoles, by) {
    const min = gate.minApprovals ?? 1;
    if (by === undefined || hasRoles || min <= 1)
        return;
    throw new SdlcError('by_not_allowed', { key: 'error.by_not_allowed', params: { min } });
}
/** True when `record` was given by the person approving now (same roles.yaml id or same email). */
export function sameApprover(record, identity, person) {
    if (person && record.person === person)
        return true;
    return approverEmail(record.by) === approverEmail(identity);
}
/** Catalog key and params of a pending gate's reason: missing roles, too few people, or both. */
export function awaitingReason(missingRoles, q) {
    const roles = missingRoles.join(', ');
    if (q.met)
        return ['gate.awaiting', { roles }];
    if (missingRoles.length === 0)
        return ['gate.awaitingCount', { count: q.count, min: q.min }];
    return ['gate.awaitingRolesCount', { roles, count: q.count, min: q.min }];
}
/** Roles a Next hint asks for: the missing ones, or the gate's roles when only people are short. */
export function awaitedRoles(missingRoles, gate) {
    if (missingRoles.length > 0)
        return missingRoles;
    return [gate.approvers.length > 0 ? gate.approvers.join(' | ') : 'any approver'];
}
/** What a gate still needs after an approval: the missing roles and, when people are short, "1 of 2". */
export function stillNeeded(gate) {
    const count = new Set(gate.approvals.map(approverKey)).size;
    const min = gate.minApprovals ?? 1;
    const parts = [...gate.missingRoles];
    if (count < min)
        parts.push(t('gate.countOf', { count, min }));
    return parts.join(', ');
}

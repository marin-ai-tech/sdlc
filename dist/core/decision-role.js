/**
 * Decisions that need a role (B108). With openspec/roles.yaml, `sdlc team accept` (what a role of the agent team
 * says) needs a maintainer, and `sdlc backlog move` / `sdlc backlog drop` (the order and removal of backlog items)
 * need a product owner. A person without the role is refused with `missing_role`; the message names who may.
 * Without roles.yaml any person may, as before. The agent refusal stays in the commands and runs first.
 */
import { SdlcError } from './errors.js';
import { gitIdentity } from './git.js';
import { personByEmail, readRolesFile } from './roles.js';
/** The role each decision needs when openspec/roles.yaml exists. */
export const DECISION_ROLES = {
    'team accept': 'maintainer',
    'backlog move': 'product-owner',
    'backlog drop': 'product-owner',
};
/** Names (from roles.yaml) of the people holding a role, each once. */
function holderNames(roles, role) {
    const ids = [...new Set(roles.roles[role] ?? [])];
    return ids.map((id) => roles.people.find((person) => person.id === id)?.name ?? id);
}
function holdsRole(roles, role, email) {
    const person = personByEmail(roles, email);
    return person !== undefined && (roles.roles[role] ?? []).includes(person.id);
}
function noIdentity() {
    return new SdlcError('no_identity', { key: 'error.cannot_tell_who_is_deciding_git_user_name_user_e' }, { key: 'fix.set_them_with_git_config_user_email_you_example_' });
}
function missingRole(roles, decision, email) {
    const role = DECISION_ROLES[decision];
    const who = personByEmail(roles, email)?.name ?? email;
    const holders = holderNames(roles, role).join(', ');
    const params = { who, role, action: decision, holders };
    const message = holders ? 'decisionRole.missing' : 'decisionRole.nobody';
    const fix = holders ? 'decisionRole.missingFix' : 'decisionRole.nobodyFix';
    return new SdlcError('missing_role', { key: message, params }, { key: fix, params });
}
/** Refuses a person without the decision's role (`missing_role`); does nothing without openspec/roles.yaml. */
export function assertDecisionRole(root, decision) {
    const roles = readRolesFile(root);
    if (!roles)
        return;
    const email = gitIdentity(root).email;
    if (!email)
        throw noIdentity();
    if (holdsRole(roles, DECISION_ROLES[decision], email))
        return;
    throw missingRole(roles, decision, email);
}

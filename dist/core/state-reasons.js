import { t } from './i18n.js';
/** Keep untrusted command operands readable without letting them dominate a hook reason. */
export function namedPart(part) {
    return part.length > 120 ? `${part.slice(0, 117)}...` : part;
}
/** Give single-purpose state files their own reason; mixed writes use the general state reason. */
export function stateReason(paths, edit) {
    const allMatch = (pattern) => paths.length > 0 && paths.every((file) => pattern.test(file));
    if (allMatch(/(?:^|\/)backlog\.md$/i))
        return t('hook.backlogIntegrity');
    if (allMatch(/(?:^|\/)roles\.yaml$/i))
        return t('hook.rolesIntegrity');
    if (allMatch(/(?:^|\/)executors\.yaml$/i))
        return t('hook.executorsIntegrity');
    if (allMatch(/(?:^|\/)team\.json$/i))
        return t('hook.teamIntegrity');
    if (allMatch(/(?:^|\/)board\.(?:json|lock)$/i))
        return t('hook.boardIntegrity');
    if (allMatch(/(?:^|\/)inbox(?:\/|$)/i))
        return t('hook.inboxIntegrity');
    return t(edit ? 'hook.stateIntegrityEdit' : 'hook.stateIntegrityBash');
}

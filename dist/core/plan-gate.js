import { t } from './i18n.js';
import { matchesPlanFile, readPlanFiles } from './plan-files.js';
import { folderLabel } from './folder-name.js';
/** The first code file outside every approved plan, if there is one. */
function uncoveredFile(code, changes) {
    const planned = changes
        .filter((change) => change.planApproved)
        .flatMap((change) => readPlanFiles(change.dir, true) ?? []);
    return code.find((file) => !planned.some((entry) => matchesPlanFile(entry, file)));
}
/** With one active change, approval still opens all code; with several, it opens listed files only. */
export function planGateDenial(code, changes, soft) {
    if (code.length === 0)
        return undefined;
    const approved = changes.some((change) => change.planApproved);
    if (changes.length === 1 && approved)
        return undefined;
    const path = approved ? uncoveredFile(code, changes) : code[0];
    if (path === undefined)
        return undefined;
    if (changes.length === 0)
        return soft('plan-gate', t('hook.planGateNone', { path }));
    const pending = changes.filter((change) => !change.planApproved).map((change) => folderLabel(change.id));
    if (!approved) {
        return soft('plan-gate', t('hook.planGatePending', { changes: pending.join(', '), path }));
    }
    const key = pending.length > 0 ? 'hook.planGateOtherPending' : 'hook.planGateUnplanned';
    return soft('plan-gate', t(key, { changes: pending.join(', '), path }));
}

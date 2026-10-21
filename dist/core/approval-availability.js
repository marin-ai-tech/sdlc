import { readChangeState } from './change-state.js';
import { gatesWithoutApprovers } from './named-approvers.js';
import { t } from './i18n.js';
export function approvalAvailabilityWarnings(root, config, view) {
    const state = readChangeState(view.dir);
    return gatesWithoutApprovers(root, config, view, state).map((gate) => t('warn.noApprover', { gate, change: view.change, cli: config.cli }, 'en'));
}

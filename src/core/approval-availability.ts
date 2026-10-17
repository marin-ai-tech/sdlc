import type { SdlcConfig } from './config.js';
import type { LifecycleView } from './lifecycle.js';
import { readChangeState } from './change-state.js';
import { gatesWithoutApprovers } from './named-approvers.js';
import { t } from './i18n.js';

export function approvalAvailabilityWarnings(root: string, config: SdlcConfig,
  view: LifecycleView): string[] {
  const state = readChangeState(view.dir);
  return gatesWithoutApprovers(root, config, view, state).map((gate) =>
    t('warn.noApprover', { gate, change: view.change, cli: config.cli }, 'en'));
}

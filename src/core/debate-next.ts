import type { SdlcConfig } from './config.js';
import { debateOn, debateRecorded } from './debate.js';
import { t } from './i18n.js';
import type { LifecycleView, NextAction } from './lifecycle.js';

/** The spec cannot be approved until the same debate record checked by approve exists. */
export function debateNext(view: LifecycleView, config: SdlcConfig, next: NextAction): NextAction {
  if (next.action !== 'approve-gate' || next.gate !== 'spec') return next;
  if (!debateOn(config) || debateRecorded(view.dir)) return next;
  return {
    actor: 'agent',
    action: 'write-artifact',
    workflow: 'spec',
    artifact: 'design',
    cli: `sdlc instructions design --change ${view.change} --json`,
    key: 'next.recordDebate',
    message: t('next.recordDebate', {}, 'en'),
  };
}

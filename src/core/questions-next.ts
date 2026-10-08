import { blockingQuestions, answerCli } from './answers.js';
import type { ChangeState } from './change-state.js';
import type { SdlcConfig } from './config.js';
import { t } from './i18n.js';
import type { LifecycleView, NextAction } from './lifecycle.js';

/**
 * The next step while open questions wait (0.11.4, B62): when the intent or spec gate is otherwise ready for a
 * person's approval and one of its questions has no recorded answer, a person answers first (`sdlc answer`).
 * Any other step is returned as it is.
 */
export function questionsNext(view: LifecycleView, config: SdlcConfig, state: ChangeState,
  next: NextAction): NextAction {
  if (next.action !== 'approve-gate' || (next.gate !== 'intent' && next.gate !== 'spec')) return next;
  const open = blockingQuestions(config, view.dir, state, next.gate);
  if (open.length === 0) return next;
  const artifacts = [...new Set(open.map((question) => `${question.artifact}.md`))].join(', ');
  const params = { gate: next.gate, count: open.length, artifacts, change: view.change };
  return {
    actor: 'human',
    action: 'answer-questions',
    gate: next.gate,
    cli: answerCli(view.change, open[0]),
    key: 'next.answerQuestions',
    params,
    message: t('next.answerQuestions', params, 'en'),
  };
}

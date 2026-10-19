import type { ChangeRef } from './changes.js';
import type { NextAction } from './lifecycle.js';
import { t } from './i18n.js';
import { buildTrace } from './trace.js';

/** Unticked tasks whose change and task trailers already occur in HEAD. */
export function mergedTaskHint(root: string, ref: ChangeRef, next: NextAction): NextAction {
  if (next.action !== 'implement') return next;
  const tasks = buildTrace(root, ref).tasks
    .filter((task) => !task.done && task.id && task.commits.length > 0)
    .map((task) => task.id!);
  if (tasks.length === 0) return next;
  const params = { tasks: tasks.join(', ') };
  return { ...next, key: 'next.markMergedTasks', params,
    message: `${next.message} ${t('next.markMergedTasks', params, 'en')}` };
}

import * as path from 'node:path';
import { readText } from '../fs-utils.js';
import type { MessageRef } from '../i18n.js';
import { HOOK_LOG_PATH, LOG_PATH } from '../log.js';
import type { HealthContext } from './context.js';
import type { FindingDraft } from './model.js';

const DECISION = /^gate\.([a-z]+)\.(approved|rejected|waived)$/;

/** A damaged source is handled by log integrity checks, not by a flood of inferred gaps. */
function readableSources(root: string): boolean {
  const shared = readText(path.join(root, LOG_PATH));
  if (shared === undefined) return false;
  const queue = readText(path.join(root, HOOK_LOG_PATH)) ?? '';
  try {
    for (const line of `${shared}\n${queue}`.split(/\r?\n/).filter((item) => item.trim())) {
      if (typeof JSON.parse(line)?.event !== 'string') return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Compare decision counts in change histories with the shared log and local queue. */
export function logGapsFinding(ctx: HealthContext): FindingDraft {
  const facts: MessageRef[] = [];
  const logged = new Map<string, number>();
  for (const entry of ctx.log) {
    if (!entry.change || !DECISION.test(entry.event)) continue;
    const key = `${entry.change}\0${entry.event}`;
    logged.set(key, (logged.get(key) ?? 0) + 1);
  }
  for (const info of [...ctx.active, ...ctx.archived]) {
    const recorded = new Map<string, number>();
    for (const event of info.state.history) {
      if (!DECISION.test(event.event)) continue;
      recorded.set(event.event, (recorded.get(event.event) ?? 0) + 1);
    }
    for (const [event, count] of recorded) {
      const missing = count - (logged.get(`${info.ref.id}\0${event}`) ?? 0);
      if (missing <= 0) continue;
      const gate = DECISION.exec(event)?.[1] ?? '';
      facts.push({ key: 'health.fact.logGap', params: { change: info.ref.id, gate, event, count: missing } });
    }
  }
  return { id: 'discipline.log-gaps', area: 'discipline', level: 'warn',
    facts: facts.length > 0 && readableSources(ctx.root) ? facts : [] };
}

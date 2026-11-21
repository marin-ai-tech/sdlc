import type { HealthContext } from './context.js';
import type { FindingDraft } from './model.js';

/** One warning for each test that has stayed on the unstable list past its configured window. */
export function unstableFindings(ctx: HealthContext): FindingDraft[] {
  return ctx.config.verify.unstable.flatMap((entry) => {
    const age = (ctx.now - Date.parse(`${entry.since}T00:00:00.000Z`)) / 86_400_000;
    if (age <= ctx.thresholds.unstableDays) return [];
    const params = { file: entry.file, item: entry.item, days: Math.floor(age) };
    return [{ id: `config.unstable:${entry.file}`, catalogKey: 'health.config.unstable',
      area: 'config' as const, level: 'warn' as const, params,
      facts: [{ key: 'health.fact.unstable', params }] }];
  });
}

import { line } from '../cli/output.js';
import { t } from '../core/i18n.js';
import type { ChangeMetrics, FlowAggregate } from '../core/metrics.js';

/**
 * Text lines of `sdlc audit` for the flow of work (B6): how long gates waited for a person, the reworks with their
 * reasons, verify attempts until the first pass and how many times each gate was approved.
 */

/** `intent 12 · spec 340`, or `-` when nothing was measured. */
function pairs(values: Record<string, number>): string {
  const entries = Object.entries(values);
  if (entries.length === 0) return '-';
  return entries.map(([key, value]) => `${key} ${value}`).join(' · ');
}

export function printChangeFlow(metrics: ChangeMetrics): void {
  const waits = Object.fromEntries(Object.entries(metrics.waits).map(([gate, wait]) => [gate, wait.seconds]));
  line(`  ${t('audit.waits', { waits: pairs(waits) })}`);
  const list = metrics.reworks.map((r) => `${r.gate} (${r.reason}, ${r.at})`).join('; ');
  line(`  ${t('audit.reworks', { count: metrics.reworks.length, list: list || '-' })}`);
  const attempts = metrics.verifyAttemptsToPass ?? '-';
  line(`  ${t('audit.attempts', { attempts, approvals: pairs(metrics.approvals) })}`);
}

export function printProjectFlow(aggregate: FlowAggregate): void {
  const reasons = aggregate.reworkReasons.map((r) => `${r.reason} ${r.count}`).join(' · ');
  line(`  ${t('audit.medianWaits', { waits: pairs(aggregate.medianWaitSeconds), reasons: reasons || '-' })}`);
}
